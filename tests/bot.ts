import WebSocket from 'ws';
import type { GameId } from '../shared/games.ts';
import type { ClientMsg, GameView, HostData, RoomView, ServerMsg } from '../shared/protocol.ts';
import { targetPosition } from '../shared/target.ts';

export interface BotSkill {
  reactionMs?: number; // how long to wait after GO before tapping
  falseStartRound?: number; // jump the gun in this reaction round
  precise?: boolean; // tap on the target vs. the corner
  quizChoice?: number;
  voteFor?: GameId; // vote for this game whenever it's on the ballot
}

/** Headless player that speaks the real protocol and plays every game. */
export class Bot {
  ws!: WebSocket;
  room: RoomView | null = null;
  game: GameView | null = null;
  host: HostData | null = null;
  /** Every quiz question this bot was shown, with what it could do about it. */
  quizSeen = new Map<string, { authorId: string | null; myAnswer: number | null; correct: number | null }>();
  playerId = '';
  token = '';
  code = '';
  events: { name: string; data?: unknown }[] = [];
  errors: string[] = [];
  offset = 0; // serverNow - localNow
  autoplay = true;
  private listeners = new Set<() => void>();
  private acted = new Set<string>();

  constructor(public name: string, private url: string, public skill: BotSkill = {}) {}

  connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (raw) => this.onMsg(JSON.parse(String(raw)) as ServerMsg));
    return new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws.close();
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  private onMsg(msg: ServerMsg) {
    if (msg.t === 'joined') {
      this.playerId = msg.playerId;
      this.token = msg.token;
      this.code = msg.code;
    } else if (msg.t === 'state') {
      this.room = msg.room;
      this.game = msg.game as GameView | null;
      this.host = msg.host ?? null;
      this.offset = msg.now - Date.now();
      const g = this.game;
      if (g?.kind === 'quiz') {
        const prev = this.quizSeen.get(g.prompt);
        this.quizSeen.set(g.prompt, {
          authorId: g.authorId,
          myAnswer: g.myAnswer ?? prev?.myAnswer ?? null,
          correct: g.correctIndex ?? prev?.correct ?? null,
        });
      }
      if (this.autoplay) this.play();
    } else if (msg.t === 'event') this.events.push({ name: msg.name, data: msg.data });
    else if (msg.t === 'error') this.errors.push(msg.message);
    for (const l of this.listeners) l();
  }

  waitFor(pred: (b: Bot) => boolean, timeoutMs = 15000, label = 'condition'): Promise<void> {
    if (pred(this)) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.listeners.delete(check);
        rej(new Error(`${this.name}: timed out waiting for ${label} (phase=${this.room?.phase}, game=${this.game?.kind})`));
      }, timeoutMs);
      t.unref();
      const check = () => {
        if (pred(this)) {
          clearTimeout(t);
          this.listeners.delete(check);
          res();
        }
      };
      this.listeners.add(check);
    });
  }

  private once(key: string, fn: () => void, delay = 0) {
    if (this.acted.has(key)) return;
    this.acted.add(key);
    if (delay) setTimeout(fn, delay);
    else fn();
  }

  private input(data: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.send({ t: 'input', data });
  }

  private play() {
    const v = this.room?.vote;
    if (this.room?.phase === 'vote' && v && !v.winner && this.skill.voteFor && !v.votes[this.playerId]) {
      const pickGame = v.options.includes(this.skill.voteFor) ? this.skill.voteFor : v.options[0];
      this.once(`vote:${this.room.gameIndex}`, () => this.send({ t: 'vote', gameId: pickGame }), 20);
    }
    const g = this.game;
    const gi = this.room?.gameIndex;
    if (!g || this.room?.phase !== 'playing') return;
    const k = `${gi}:${g.kind}`;
    switch (g.kind) {
      case 'reaction':
        if (g.myResult) return;
        if (g.stage === 'wait' && this.skill.falseStartRound === g.round) this.once(`${k}:${g.round}:fs`, () => this.input({ tap: true }));
        if (g.stage === 'go') {
          const ms = this.skill.reactionMs ?? 250;
          this.once(`${k}:${g.round}`, () => this.input({ tap: true, reactionMs: ms }), ms);
        }
        return;
      case 'memory':
        if (g.stage === 'question' && g.myAnswer === null) this.once(`${k}:${g.qIndex}`, () => this.input({ choice: 0 }), 20);
        return;
      case 'quiz':
        if (g.stage === 'question' && g.myAnswer === null)
          this.once(`${k}:${g.qIndex}`, () => this.input({ choice: this.skill.quizChoice ?? 0 }), 20);
        return;
      case 'precision':
        this.once(k, () => {
          const iv = setInterval(() => {
            const v = this.game;
            if (!v || v.kind !== 'precision' || this.serverNow() > v.endsAt) return clearInterval(iv);
            const t = this.serverNow();
            const p = this.skill.precise ? targetPosition(v.seed, t - v.startedAt) : { x: 0.01, y: 0.01 };
            this.input({ x: p.x, y: p.y, t });
          }, 120);
        });
        return;
      case 'bomb':
        if (g.challenge) {
          // Bots don't know the answer: cycle through options until one sticks.
          const key = `${k}:${g.round}:${g.challenge.prompt}:${g.challenge.options.join()}`;
          this.once(key, () => this.input({ choice: Math.floor(Math.random() * g.challenge!.options.length) }), 30);
        } else if (g.canThrow) {
          const to = g.alive.find((id) => id !== this.playerId);
          if (to) this.once(`${k}:throw:${g.lastThrow?.at ?? 0}:${g.round}`, () => this.input({ throwTo: to }), 30);
        }
        return;
    }
  }
}
