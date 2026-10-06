import type { GameId } from '../shared/games.ts';
import type { CustomQuestion, Difficulty, GameLength, GameView, PlayerStats, RoomSettings } from '../shared/protocol.ts';

export interface GamePlayer {
  id: string;
  name: string;
}

/** Everything a mini-game is allowed to touch. The room owns the real state. */
export interface GameCtx {
  /** Participants, fixed when the game starts. */
  players: GamePlayer[];
  /** Host settings (difficulty, length, ...) frozen at game start. */
  settings: RoomSettings;
  /** Host-written quiz questions (only the quiz uses them today). */
  customQuestions: CustomQuestion[];
  now(): number;
  /** Scale a design-time duration (lets tests run the whole show fast). */
  dur(ms: number): number;
  rng(): number;
  isConnected(playerId: string): boolean;
  /** Mark state dirty so it is broadcast on the next flush. */
  changed(): void;
  /** Fire a one-shot event (sound/shake cue) at one player or everyone (null). */
  emit(to: string | null, name: string, data?: unknown): void;
  /** Signal the game is over; the room will collect outcome() and move on. */
  finish(): void;
}

export interface GameOutcome {
  points: Record<string, number>;
  stats: Record<string, PlayerStats>;
  highlights?: Record<string, string>;
}

export interface GameInstance {
  tick(now: number): void;
  input(playerId: string, data: unknown, now: number): void;
  view(playerId: string): GameView;
  outcome(): GameOutcome;
  onDisconnect?(playerId: string): void;
}

export interface GameModule {
  id: GameId;
  create(ctx: GameCtx): GameInstance;
}

// ---------- small helpers shared by games ----------

/** Pick a tuning value for the room's difficulty: byDifficulty(ctx, { chill: 8, normal: 6, chaos: 4 }). */
export function byDifficulty<T>(ctx: GameCtx, table: Record<Difficulty, T>): T {
  return table[ctx.settings.difficulty];
}

/** Rounds inside a game: the host's explicit "rounds per game", else the auto value for the length. */
export function perGame(ctx: GameCtx, auto: Record<GameLength, number>): number {
  return ctx.settings.perGame ?? auto[ctx.settings.length];
}

/** Pick a tuning value for the room's game length. */
export function byLength<T>(ctx: GameCtx, table: Record<GameLength, T>): T {
  return table[ctx.settings.length];
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function zeroMap(players: GamePlayer[]): Record<string, number> {
  return Object.fromEntries(players.map((p) => [p.id, 0]));
}
