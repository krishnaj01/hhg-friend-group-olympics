import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { CODE_ALPHABET, CODE_LENGTH, type ClientMsg, type ServerMsg } from '../shared/protocol.ts';
import { Room, RoomError, type Conn } from './room.ts';

const ROOM_IDLE_MS = 5 * 60_000; // rooms with nobody connected are reaped
const TICK_MS = 50;
const MAX_MSGS_PER_SEC = 40;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

export interface StartOptions {
  port?: number;
  timeScale?: number;
  staticDir?: string | null;
}

export interface RunningServer {
  port: number;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const rooms = new Map<string, Room>();
  const idleSince = new Map<string, number>();
  const timeScale = opts.timeScale ?? 1;
  const staticDir = opts.staticDir === undefined ? fileURLToPath(new URL('../dist', import.meta.url)) : opts.staticDir;

  const newCode = () => {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };

  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (!staticDir || !existsSync(staticDir)) {
      res.writeHead(404);
      res.end('Client not built. Run `npm run dev` (Vite on :5173) or `npm run build`.');
      return;
    }
    let file = normalize(join(staticDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(normalize(staticDir)) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(staticDir, 'index.html'); // SPA fallback (deep links like /ABC123)
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 8 * 1024 });

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let playerId: string | null = null;
    let budget = MAX_MSGS_PER_SEC;
    let budgetAt = Date.now();
    let alive = true;

    const conn: Conn = {
      send: (msg: ServerMsg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    };
    const fail = (message: string, fatal = false) => conn.send({ t: 'error', message, fatal });

    const leaveCurrent = () => {
      if (room && playerId) room.disconnect(playerId, conn);
      room = null;
      playerId = null;
    };

    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 10_000);

    ws.on('message', (raw) => {
      const now = Date.now();
      budget = Math.min(MAX_MSGS_PER_SEC, budget + ((now - budgetAt) / 1000) * MAX_MSGS_PER_SEC);
      budgetAt = now;
      if (budget < 1) return; // flood: silently drop
      budget--;

      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') throw 0;
      } catch {
        return fail('Bad message');
      }

      try {
        switch (msg.t) {
          case 'ping':
            return conn.send({ t: 'pong', ct: msg.ct, st: Date.now() });
          case 'create': {
            leaveCurrent();
            const code = newCode();
            const r = new Room(code, { timeScale });
            const p = r.addPlayer(msg.name, msg.avatar, conn);
            rooms.set(code, r);
            room = r;
            playerId = p.id;
            r.flush();
            return;
          }
          case 'join': {
            const code = String(msg.code ?? '').toUpperCase().trim();
            const r = rooms.get(code);
            if (!r) return fail(`No room with code ${code || '—'}`);
            leaveCurrent();
            const p = r.addPlayer(msg.name, msg.avatar, conn);
            room = r;
            playerId = p.id;
            r.flush();
            return;
          }
          case 'rejoin': {
            const r = rooms.get(String(msg.code ?? '').toUpperCase());
            if (!r || !r.reconnect(String(msg.playerId), String(msg.token), conn)) {
              return conn.send({ t: 'error', message: 'rejoin-failed' });
            }
            room = r;
            playerId = String(msg.playerId);
            r.flush();
            return;
          }
          case 'leave': {
            if (room && playerId) room.removePlayer(playerId);
            room = null;
            playerId = null;
            return;
          }
          default:
            if (!room || !playerId) return fail('Not in a room');
            room.handle(playerId, msg);
        }
      } catch (err) {
        if (err instanceof RoomError) fail(err.message);
        else {
          console.error('handler error', err);
          fail('Something broke 🫠');
        }
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      leaveCurrent();
    });
  });

  const ticker = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      try {
        room.tick();
      } catch (err) {
        console.error(`tick error in ${code}`, err);
      }
      if (room.players.size === 0) {
        rooms.delete(code);
        idleSince.delete(code);
      } else if (room.connectedCount === 0) {
        const since = idleSince.get(code) ?? now;
        idleSince.set(code, since);
        if (now - since > ROOM_IDLE_MS) {
          rooms.delete(code);
          idleSince.delete(code);
        }
      } else idleSince.delete(code);
    }
  }, TICK_MS);

  return new Promise((resolve) => {
    http.listen(opts.port ?? 3001, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port ?? 3001;
      resolve({
        port,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(ticker);
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

// Run directly: `tsx server/index.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3001);
  const timeScale = Number(process.env.FGO_TIME_SCALE ?? 1);
  startServer({ port, timeScale }).then((s) => {
    console.log(`🏟️  Friend Group Olympics server on http://localhost:${s.port}  (ws: /ws)`);
  });
}
