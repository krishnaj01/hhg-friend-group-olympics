import { useSyncExternalStore } from 'react';
import type { GameId } from '../../../shared/games';
import type { ClientMsg, GameView, HostData, RoomView, ServerMsg } from '../../../shared/protocol';

// Single WebSocket connection + tiny external store. The server is the source
// of truth; the client only renders snapshots and sends intents.

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export interface NetState {
  status: 'connecting' | 'open' | 'reconnecting';
  session: Session | null;
  room: RoomView | null;
  game: GameView | null;
  host: HostData | null; // only filled in for the host
  error: string | null;
  kicked: boolean;
}

const SESSION_KEY = 'fgo-session';

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: reconnect just won't survive a reload */
  }
}

let state: NetState = { status: 'connecting', session: loadSession(), room: null, game: null, host: null, error: null, kicked: false };
const listeners = new Set<() => void>();
const eventListeners = new Set<(name: string, data: unknown) => void>();

function set(patch: Partial<NetState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

// ---------- clock sync ----------
let offset = 0; // serverNow - Date.now()
let bestRtt = Infinity;
let haveSample = false;

export function serverNow() {
  return Date.now() + offset;
}

// ---------- socket ----------
let ws: WebSocket | null = null;
let retry = 0;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let errorTimer: ReturnType<typeof setTimeout> | undefined;
const outbox: ClientMsg[] = [];

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function connect() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    retry = 0;
    bestRtt = Infinity; // network path may have changed
    set({ status: 'open' });
    if (state.session) rawSend({ t: 'rejoin', ...state.session });
    for (const m of outbox.splice(0)) rawSend(m);
    for (let i = 0; i < 5; i++) setTimeout(() => rawSend({ t: 'ping', ct: Date.now() }), i * 200);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => rawSend({ t: 'ping', ct: Date.now() }), 10_000);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data) as ServerMsg);
  ws.onclose = () => {
    clearInterval(pingTimer);
    set({ status: 'reconnecting' });
    const delay = Math.min(4000, 300 * 2 ** retry++);
    setTimeout(connect, delay);
  };
}

function handle(msg: ServerMsg) {
  switch (msg.t) {
    case 'joined': {
      const session = { code: msg.code, playerId: msg.playerId, token: msg.token };
      saveSession(session);
      set({ session, error: null, kicked: false });
      try {
        history.replaceState(null, '', `/${msg.code}`);
      } catch {
        /* ignore */
      }
      break;
    }
    case 'state':
      if (!haveSample) offset = msg.now - Date.now();
      set({ room: msg.room, game: msg.game as GameView | null, host: msg.host ?? null });
      break;
    case 'pong': {
      const now = Date.now();
      const rtt = now - msg.ct;
      if (rtt <= bestRtt) {
        bestRtt = rtt;
        offset = msg.st + rtt / 2 - now;
        haveSample = true;
      }
      break;
    }
    case 'event':
      for (const l of eventListeners) l(msg.name, msg.data);
      break;
    case 'error':
      if (msg.message === 'rejoin-failed') {
        // Room expired or server restarted: back to the landing page quietly.
        saveSession(null);
        set({ session: null, room: null, game: null });
        try {
          history.replaceState(null, '', '/');
        } catch {
          /* ignore */
        }
        break;
      }
      if (msg.fatal) {
        saveSession(null);
        set({ session: null, room: null, game: null, kicked: true });
      }
      set({ error: msg.message });
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => set({ error: null }), 3500);
      break;
  }
}

function rawSend(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function send(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) rawSend(msg);
  else if (msg.t !== 'input' && msg.t !== 'ping') outbox.push(msg); // stale game inputs are useless
}

export function leaveRoom() {
  send({ t: 'leave' });
  saveSession(null);
  set({ session: null, room: null, game: null });
  try {
    history.replaceState(null, '', '/');
  } catch {
    /* ignore */
  }
}

export function onGameEvent(fn: (name: string, data: unknown) => void) {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

export function useNet(): NetState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The game being played right now (or just finished, on the results screen). */
export function currentGame(room: RoomView): GameId | undefined {
  return room.playlist[room.gameIndex];
}

export function useMe() {
  const { room, session } = useNet();
  return room?.players.find((p) => p.id === session?.playerId) ?? null;
}

connect();
