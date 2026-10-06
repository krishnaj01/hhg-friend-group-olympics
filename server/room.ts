import { randomUUID } from 'node:crypto';
import { GAME_IDS, type GameId } from '../shared/games.ts';
import {
  AVATARS,
  COLORS,
  CUSTOM_LIMITS,
  DEFAULT_SETTINGS,
  MAX_PER_GAME,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_ROUNDS,
  type ClientMsg,
  type CustomQuestion,
  type Phase,
  type PlayerStats,
  type PodiumData,
  type RoomView,
  type RoomSettings,
  type RoundResults,
  type ServerMsg,
  type VoteState,
} from '../shared/protocol.ts';
import { shuffle, type GameCtx, type GameInstance } from './engine.ts';
import { GAMES } from './games/index.ts';
import { computeAwards, mergeStats, rankOf } from './scoring.ts';

/** Transport-agnostic connection so rooms can be driven by tests without sockets. */
export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

export interface RoomOptions {
  timeScale?: number;
  rng?: () => number;
  now?: () => number;
}

interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  conn: Conn | null;
  disconnectedAt: number | null;
}

const INTRO_MS = 5500;
const COUNTDOWN_MS = 3200;
const RESULTS_MS = 9000;
const VOTE_MS = 10000;
const VOTE_REVEAL_MS = 2600;
const LOBBY_DROP_MS = 20000; // disconnected lobby players are pruned (real time)

export class RoomError extends Error {}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!name) throw new RoomError('Pick a name first!');
  return name;
}

const DIFFICULTIES = ['chill', 'normal', 'chaos'] as const;
const LENGTHS = ['short', 'normal', 'long'] as const;
const ORDERS = ['fixed', 'random', 'vote'] as const;

/** Merge a partial settings patch, ignoring anything invalid. */
export function applySettings(current: RoomSettings, patch: unknown): RoomSettings {
  const next = { ...current };
  if (typeof patch !== 'object' || patch === null) return next;
  const p = patch as Record<string, unknown>;
  if (typeof p.rounds === 'number' && Number.isFinite(p.rounds))
    next.rounds = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(p.rounds)));
  if (DIFFICULTIES.includes(p.difficulty as never)) next.difficulty = p.difficulty as RoomSettings['difficulty'];
  if (LENGTHS.includes(p.length as never)) next.length = p.length as RoomSettings['length'];
  if (ORDERS.includes(p.order as never)) next.order = p.order as RoomSettings['order'];
  if (p.perGame === null) next.perGame = null;
  else if (typeof p.perGame === 'number' && Number.isFinite(p.perGame))
    next.perGame = Math.min(MAX_PER_GAME, Math.max(1, Math.round(p.perGame)));
  return next;
}

/** Validate a host-written quiz question; throws RoomError with a friendly message. */
export function cleanQuestion(
  raw: { prompt?: unknown; options?: unknown; answer?: unknown; explain?: unknown },
  authorId: string,
): CustomQuestion {
  const L = CUSTOM_LIMITS;
  const text = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const prompt = text(raw.prompt);
  if (!prompt) throw new RoomError('Write a question first');
  if (prompt.length > L.prompt) throw new RoomError(`Question is too long (max ${L.prompt})`);
  if (!Array.isArray(raw.options)) throw new RoomError('Add some answers');
  const options = raw.options.map(text);
  if (options.length < L.minOptions || options.length > L.maxOptions) throw new RoomError(`Use ${L.minOptions}-${L.maxOptions} answers`);
  if (options.some((o) => !o)) throw new RoomError("Answers can't be empty");
  if (options.some((o) => o.length > L.option)) throw new RoomError(`Answers max ${L.option} characters`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new RoomError('Answers must be different');
  const answer = Number(raw.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw new RoomError('Mark the correct answer');
  const explain = text(raw.explain).slice(0, L.explain) || undefined;
  return { id: randomUUID().slice(0, 8), prompt, options, answer, explain, authorId };
}

/** The games for a whole show. Vote mode only locks in the first one up front. */
export function buildPlaylist(pool: GameId[], settings: RoomSettings, rng: () => number): GameId[] {
  const { rounds, order } = settings;
  if (order === 'fixed') return Array.from({ length: rounds }, (_, i) => pool[i % pool.length]);
  if (order === 'vote') return [pool[Math.floor(rng() * pool.length)]];
  // random: shuffled passes through the pool, never the same game twice in a row
  const list: GameId[] = [];
  while (list.length < rounds) {
    let pass = shuffle(pool, rng);
    if (pass.length > 1 && pass[0] === list[list.length - 1]) pass = [...pass.slice(1), pass[0]];
    list.push(...pass);
  }
  return list.slice(0, rounds);
}

export class Room {
  readonly players = new Map<string, Player>();
  phase: Phase = 'lobby';
  hostId = '';
  games: GameId[] = [...GAME_IDS];
  settings: RoomSettings = { ...DEFAULT_SETTINGS, rounds: GAME_IDS.length };
  customQuestions: CustomQuestion[] = [];
  playlist: GameId[] = [];
  gameIndex = -1;
  phaseEndsAt: number | null = null;
  phaseMs: number | null = null;
  results: RoundResults | null = null;
  vote: VoteState | null = null;
  podium: PodiumData | null = null;

  private game: GameInstance | null = null;
  private participants = new Set<string>();
  private gameDone = false;
  private stats: Record<string, PlayerStats> = {};
  private rankHistory: Record<string, number>[] = [];
  private pendingEvents: { to: string | null; msg: ServerMsg }[] = [];
  private dirty = true;
  private readonly timeScale: number;
  private readonly rng: () => number;
  readonly now: () => number;

  constructor(readonly code: string, opts: RoomOptions = {}) {
    this.timeScale = opts.timeScale ?? 1;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  private dur(ms: number) {
    return Math.round(ms * this.timeScale);
  }

  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }

  // ---------------- membership ----------------

  addPlayer(rawName: unknown, rawAvatar: unknown, conn: Conn): Player {
    if (this.players.size >= MAX_PLAYERS) throw new RoomError('Room is full (12 max)');
    let name = cleanName(rawName);
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${name.replace(/ \d+$/, '')} ${i}`;
    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const player: Player = {
      id: randomUUID().slice(0, 8),
      token: randomUUID(),
      name,
      avatar: typeof rawAvatar === 'string' && AVATARS.includes(rawAvatar) ? rawAvatar : AVATARS[Math.floor(this.rng() * AVATARS.length)],
      color: COLORS.find((c) => !usedColors.has(c)) ?? COLORS[this.players.size % COLORS.length],
      score: 0,
      conn,
      disconnectedAt: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    conn.send({ t: 'joined', code: this.code, playerId: player.id, token: player.token });
    this.touch();
    return player;
  }

  reconnect(playerId: string, token: string, conn: Conn): boolean {
    const p = this.players.get(playerId);
    if (!p || p.token !== token) return false;
    if (p.conn && p.conn !== conn) p.conn.close(); // newest tab wins
    p.conn = conn;
    p.disconnectedAt = null;
    if (!this.players.get(this.hostId)?.conn) this.hostId = p.id;
    conn.send({ t: 'joined', code: this.code, playerId: p.id, token: p.token });
    this.touch();
    return true;
  }

  disconnect(playerId: string, conn: Conn) {
    const p = this.players.get(playerId);
    if (!p || p.conn !== conn) return; // stale socket from a replaced tab
    p.conn = null;
    p.disconnectedAt = this.now();
    this.migrateHost();
    this.game?.onDisconnect?.(playerId);
    this.touch();
  }

  removePlayer(playerId: string) {
    if (!this.players.delete(playerId)) return;
    this.participants.delete(playerId);
    this.game?.onDisconnect?.(playerId);
    this.migrateHost();
    this.touch();
  }

  private migrateHost() {
    if (this.players.get(this.hostId)?.conn) return;
    const next = [...this.players.values()].find((p) => p.conn) ?? this.players.values().next().value;
    this.hostId = next?.id ?? '';
  }

  // ---------------- messages ----------------

  handle(playerId: string, msg: ClientMsg) {
    const p = this.players.get(playerId);
    if (!p) return;
    const isHost = playerId === this.hostId;
    switch (msg.t) {
      case 'input':
        if (this.phase === 'playing' && this.game && this.participants.has(playerId)) {
          this.game.input(playerId, msg.data, this.now());
          this.flush(); // inputs are latency-sensitive: don't wait for the next tick
        }
        return;
      case 'profile':
        if (msg.name !== undefined) {
          const name = cleanName(msg.name);
          if ([...this.players.values()].some((o) => o.id !== p.id && o.name.toLowerCase() === name.toLowerCase()))
            throw new RoomError('Name already taken');
          p.name = name;
        }
        if (typeof msg.avatar === 'string' && AVATARS.includes(msg.avatar)) p.avatar = msg.avatar;
        break;
      case 'setGames':
        if (!isHost || this.phase !== 'lobby') return;
        if (!Array.isArray(msg.games)) return;
        this.games = GAME_IDS.filter((g) => msg.games.includes(g));
        // Rounds follow the selection; the host can raise it afterwards to get repeats.
        this.settings.rounds = Math.max(MIN_ROUNDS, this.games.length);
        break;
      case 'settings':
        if (!isHost || this.phase !== 'lobby') return;
        this.settings = applySettings(this.settings, msg.settings);
        break;
      case 'addQuestion':
        if (!isHost) throw new RoomError('Only the host can add questions');
        if (this.phase !== 'lobby') return;
        if (this.customQuestions.length >= CUSTOM_LIMITS.max) throw new RoomError(`Max ${CUSTOM_LIMITS.max} house questions`);
        this.customQuestions.push(cleanQuestion(msg, playerId));
        break;
      case 'removeQuestion':
        if (!isHost || this.phase !== 'lobby') return;
        this.customQuestions = this.customQuestions.filter((q) => q.id !== msg.id);
        break;
      case 'vote':
        if (this.phase !== 'vote' || !this.vote || this.vote.winner) return;
        if (!this.vote.options.includes(msg.gameId)) return;
        this.vote.votes[playerId] = msg.gameId; // changing your mind is allowed until it closes
        break;
      case 'start':
        if (!isHost) throw new RoomError('Only the host can start');
        if (this.phase !== 'lobby') return;
        if (!this.games.length) throw new RoomError('Pick at least one game');
        this.startShow();
        break;
      case 'next':
        if (!isHost) return;
        if (this.phase === 'intro') this.setPhase('countdown', COUNTDOWN_MS);
        else if (this.phase === 'results') this.afterResults();
        else if (this.phase === 'vote') this.advanceVote();
        break;
      case 'endGame':
        if (!isHost || this.phase !== 'playing' || !this.game) return;
        this.pendingEvents.push({ to: null, msg: { t: 'event', name: 'endedEarly', data: { what: 'game' } } });
        this.finishGame(true);
        break;
      case 'endShow':
        if (!isHost || this.phase === 'lobby' || this.phase === 'podium') return;
        this.pendingEvents.push({ to: null, msg: { t: 'event', name: 'endedEarly', data: { what: 'show' } } });
        if (this.phase === 'playing' && this.game) this.finishGame(true, false); // bank the points so far
        this.vote = null;
        this.toPodium();
        break;
      case 'restart':
        if (!isHost || (this.phase !== 'podium' && this.phase !== 'results')) return;
        this.resetToLobby();
        break;
      case 'kick': {
        if (!isHost || msg.playerId === playerId) return;
        const target = this.players.get(msg.playerId);
        if (!target) return;
        target.conn?.send({ t: 'error', message: 'You were removed by the host', fatal: true });
        target.conn?.close();
        this.removePlayer(target.id);
        break;
      }
      default:
        return;
    }
    this.touch();
  }

  // ---------------- show flow ----------------

  private setPhase(phase: Phase, ms: number | null) {
    this.phase = phase;
    this.phaseMs = ms === null ? null : this.dur(ms);
    this.phaseEndsAt = ms === null ? null : this.now() + this.dur(ms);
    if (phase === 'playing') this.startGame();
    this.touch();
  }

  private startShow() {
    for (const p of this.players.values()) p.score = 0;
    this.stats = {};
    this.rankHistory = [];
    this.results = null;
    this.podium = null;
    this.vote = null;
    this.playlist = buildPlaylist(this.games, this.settings, this.rng);
    this.gameIndex = 0;
    this.setPhase('intro', INTRO_MS);
  }

  private startGame() {
    const id = this.playlist[this.gameIndex];
    this.participants = new Set(this.players.keys());
    this.gameDone = false;
    const ctx: GameCtx = {
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name })),
      settings: { ...this.settings },
      customQuestions: this.customQuestions.map((q) => ({ ...q, options: [...q.options] })),
      now: this.now,
      dur: (ms) => this.dur(ms),
      rng: this.rng,
      isConnected: (pid) => !!this.players.get(pid)?.conn,
      changed: () => this.touch(),
      emit: (to, name, data) => this.pendingEvents.push({ to, msg: { t: 'event', name, data } }),
      finish: () => {
        this.gameDone = true;
      },
    };
    this.game = GAMES[id].create(ctx);
    this.phaseEndsAt = null; // games own their own clocks
  }

  private finishGame(endedEarly = false, showResults = true) {
    const game = this.game!;
    this.game = null;
    const { points, stats, highlights } = game.outcome();
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (const p of this.players.values()) {
      before[p.id] = p.score;
      const gained = Math.round(points[p.id] ?? 0);
      p.score += gained;
      after[p.id] = p.score;
      if (stats[p.id]) this.stats[p.id] = mergeStats(this.stats[p.id] ?? {}, stats[p.id]);
    }
    const prevRanks = rankOf(before);
    const ranks = rankOf(after);
    this.rankHistory.push(ranks);
    this.results = {
      gameId: this.playlist[this.gameIndex],
      endedEarly,
      rows: [...this.players.values()]
        .map((p) => ({
          playerId: p.id,
          gained: after[p.id] - before[p.id],
          total: p.score,
          rank: ranks[p.id],
          prevRank: this.gameIndex === 0 ? ranks[p.id] : prevRanks[p.id],
          highlight: highlights?.[p.id] || undefined,
        }))
        .sort((a, b) => a.rank - b.rank || b.gained - a.gained),
    };
    if (showResults) this.setPhase('results', RESULTS_MS);
  }

  private afterResults() {
    if (this.gameIndex + 1 >= this.settings.rounds) return this.toPodium();
    if (this.settings.order === 'vote') return this.openVote();
    this.gameIndex++;
    this.setPhase('intro', INTRO_MS);
  }

  // ---------------- voting ----------------

  private openVote() {
    const last = this.playlist[this.gameIndex];
    const options = this.games.length > 1 ? this.games.filter((g) => g !== last) : [...this.games];
    if (options.length === 1) {
      // Nothing to decide.
      this.playlist.push(options[0]);
      this.gameIndex++;
      return this.setPhase('intro', INTRO_MS);
    }
    this.vote = { options, votes: {}, winner: null, tieBreak: false };
    this.setPhase('vote', VOTE_MS);
  }

  /** Voting open -> tally and reveal the winner; winner shown -> on to the game. */
  private advanceVote() {
    const vote = this.vote;
    if (!vote) return;
    if (vote.winner) {
      this.playlist.push(vote.winner);
      this.vote = null;
      this.gameIndex++;
      return this.setPhase('intro', INTRO_MS);
    }
    const tally = new Map<GameId, number>();
    for (const [pid, g] of Object.entries(vote.votes)) if (this.players.has(pid)) tally.set(g, (tally.get(g) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const leaders = top > 0 ? vote.options.filter((g) => tally.get(g) === top) : vote.options;
    vote.winner = leaders[Math.floor(this.rng() * leaders.length)];
    vote.tieBreak = leaders.length > 1;
    this.setPhase('vote', VOTE_REVEAL_MS);
  }

  private toPodium() {
    const totals = Object.fromEntries([...this.players.values()].map((p) => [p.id, p.score]));
    const ranks = rankOf(totals);
    const ids = Object.keys(totals);
    this.podium = {
      standings: ids.map((id) => ({ playerId: id, total: totals[id], rank: ranks[id] })).sort((a, b) => a.rank - b.rank),
      awards: computeAwards(ids, this.stats, this.rankHistory, ranks),
    };
    this.setPhase('podium', null);
  }

  private resetToLobby() {
    this.game = null;
    this.gameIndex = -1;
    this.playlist = [];
    this.vote = null;
    this.results = null;
    this.podium = null;
    for (const p of this.players.values()) p.score = 0;
    this.setPhase('lobby', null);
  }

  // ---------------- clock ----------------

  tick() {
    const now = this.now();
    if (this.phase === 'playing' && this.game) {
      this.game.tick(now);
      if (this.gameDone) this.finishGame();
    } else if (this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
      if (this.phase === 'intro') this.setPhase('countdown', COUNTDOWN_MS);
      else if (this.phase === 'countdown') this.setPhase('playing', null);
      else if (this.phase === 'results') this.afterResults();
      else if (this.phase === 'vote') this.advanceVote();
    }
    if (this.phase === 'vote' && this.vote && !this.vote.winner) {
      // Close early once every connected player has voted.
      const live = [...this.players.values()].filter((p) => p.conn);
      if (live.length > 0 && live.every((p) => this.vote!.votes[p.id])) this.advanceVote();
    }
    if (this.phase === 'lobby') {
      for (const p of [...this.players.values()])
        if (!p.conn && p.disconnectedAt !== null && now - p.disconnectedAt > LOBBY_DROP_MS) this.removePlayer(p.id);
    }
    this.flush();
  }

  private touch() {
    this.dirty = true;
  }

  view(): RoomView {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        connected: !!p.conn,
        score: p.score,
        isHost: p.id === this.hostId,
      })),
      games: this.games,
      settings: this.settings,
      // Random/vote orders keep upcoming games a surprise.
      playlist: this.settings.order === 'fixed' ? this.playlist : this.playlist.slice(0, this.gameIndex + 1),
      gameIndex: this.gameIndex,
      phaseEndsAt: this.phaseEndsAt,
      phaseMs: this.phaseMs,
      results: this.results,
      vote: this.vote,
      podium: this.podium,
      customQuestionCount: this.customQuestions.length,
    };
  }

  flush() {
    if (this.dirty) {
      this.dirty = false;
      const room = this.view();
      const now = this.now();
      for (const p of this.players.values()) {
        if (!p.conn) continue;
        const game = this.game && this.participants.has(p.id) ? this.game.view(p.id) : null;
        const host = p.id === this.hostId ? { customQuestions: this.customQuestions } : undefined;
        p.conn.send({ t: 'state', room, game, now, host });
      }
    }
    // Events go out after the state they describe.
    const events = this.pendingEvents.splice(0);
    for (const e of events) {
      if (e.to === null) for (const p of this.players.values()) p.conn?.send(e.msg);
      else this.players.get(e.to)?.conn?.send(e.msg);
    }
  }
}
