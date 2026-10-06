import type { GameId } from './games.ts';

export const MAX_PLAYERS = 12;
export const CODE_LENGTH = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export const AVATARS = ['🦊', '🐸', '🐼', '🦄', '🐙', '🦖', '🐯', '🐧', '👽', '🤖', '🦁', '🐵', '🐲', '🦩', '🐨', '🍕'];
export const COLORS = ['#ff3d7f', '#ffb800', '#00e0ff', '#7cff4f', '#b46bff', '#ff6b3d', '#3dffc5', '#ff4fd8', '#4f8bff', '#f4ff4f', '#ff9ec7', '#9effa8'];

export type Phase = 'lobby' | 'intro' | 'countdown' | 'playing' | 'results' | 'vote' | 'podium';

// ---------- host settings ----------

export type Difficulty = 'chill' | 'normal' | 'chaos';
export type GameLength = 'short' | 'normal' | 'long';
export type OrderMode = 'fixed' | 'random' | 'vote';

export interface RoomSettings {
  rounds: number; // games in the show; repeats when > selected games
  length: GameLength;
  difficulty: Difficulty;
  order: OrderMode;
  /** Rounds inside each game (reaction rounds, questions, bomb rounds...). null = auto from length. */
  perGame: number | null;
}

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 10;
export const MAX_PER_GAME = 10;
export const DEFAULT_SETTINGS: RoomSettings = { rounds: 5, length: 'normal', difficulty: 'normal', order: 'fixed', perGame: null };

// ---------- host-written quiz questions ----------

export interface CustomQuestion {
  id: string;
  prompt: string;
  options: string[]; // 2..4
  answer: number;
  explain?: string;
  authorId: string;
}

export const CUSTOM_LIMITS = { max: 20, prompt: 140, option: 40, explain: 120, minOptions: 2, maxOptions: 4 };

export interface VoteState {
  options: GameId[];
  votes: Record<string, GameId>; // playerId -> choice (public, it's a party)
  winner: GameId | null;
  tieBreak: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  color: string;
  connected: boolean;
  score: number;
  isHost: boolean;
}

/** Aggregated per-player stats used for awards. All optional per game. */
export interface PlayerStats {
  bestReactionMs?: number;
  falseStarts?: number;
  correct?: number;
  answered?: number;
  hits?: number;
  misses?: number;
  explosions?: number;
  wrong?: number;
  bombHolds?: number;
}

export interface ResultRow {
  playerId: string;
  gained: number;
  total: number;
  rank: number;
  prevRank: number;
  highlight?: string; // e.g. "214ms best"
}

export interface RoundResults {
  gameId: GameId;
  endedEarly: boolean; // host stopped the game before it finished
  rows: ResultRow[]; // sorted by rank
}

export interface Award {
  key: 'fastest' | 'accurate' | 'comeback' | 'chaotic';
  title: string;
  emoji: string;
  playerId: string;
  detail: string;
}

export interface PodiumData {
  standings: { playerId: string; total: number; rank: number }[];
  awards: Award[];
}

export interface RoomView {
  code: string;
  phase: Phase;
  hostId: string;
  players: PlayerView[];
  games: GameId[]; // games the host enabled (the pool)
  settings: RoomSettings;
  /** Games locked in so far. Future slots are only revealed in 'fixed' order. */
  playlist: GameId[];
  gameIndex: number; // index into playlist, -1 in lobby
  phaseEndsAt: number | null; // server ms timestamp
  phaseMs: number | null; // total length of the current timed phase
  results: RoundResults | null;
  vote: VoteState | null;
  podium: PodiumData | null;
  customQuestionCount: number;
}

/** Sent only to the host, so nobody else can peek at the answers. */
export interface HostData {
  customQuestions: CustomQuestion[];
}

// ---------- messages ----------

export type ClientMsg =
  | { t: 'create'; name: string; avatar: string }
  | { t: 'join'; code: string; name: string; avatar: string }
  | { t: 'rejoin'; code: string; playerId: string; token: string }
  | { t: 'leave' }
  | { t: 'profile'; name?: string; avatar?: string }
  | { t: 'setGames'; games: GameId[] }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'addQuestion'; prompt: string; options: string[]; answer: number; explain?: string }
  | { t: 'removeQuestion'; id: string }
  | { t: 'vote'; gameId: GameId }
  | { t: 'start' }
  | { t: 'next' }
  | { t: 'restart' }
  | { t: 'endGame' } // host: stop the current game, keep points so far
  | { t: 'endShow' } // host: jump straight to the podium
  | { t: 'kick'; playerId: string }
  | { t: 'input'; data: unknown }
  | { t: 'ping'; ct: number };

export type ServerMsg =
  | { t: 'joined'; code: string; playerId: string; token: string }
  | { t: 'state'; room: RoomView; game: unknown; now: number; host?: HostData }
  | { t: 'event'; name: string; data?: unknown }
  | { t: 'error'; message: string; fatal?: boolean }
  | { t: 'pong'; ct: number; st: number };

// ---------- per-game views (what the server sends each player) ----------

export interface ReactionView {
  kind: 'reaction';
  round: number;
  rounds: number;
  stage: 'wait' | 'fake' | 'go' | 'reveal'; // 'fake' = chaos-mode decoy flash
  goAt: number | null; // only set once stage === 'go'
  stageEndsAt: number | null;
  myResult: { ms: number | null; falseStart: boolean } | null;
  roundResults: { playerId: string; ms: number | null; falseStart: boolean; points: number }[];
  done: string[]; // players who already reacted this round
}

export interface MemoryView {
  kind: 'memory';
  stage: 'memorize' | 'question' | 'reveal';
  grid: string[] | null; // only during memorize
  gridSize: number;
  qIndex: number;
  qCount: number;
  question: { prompt: string; options: string[]; cell?: number } | null;
  stageEndsAt: number;
  stageMs: number;
  myAnswer: number | null;
  correctIndex: number | null; // only during reveal
  myPoints: number;
  answeredCount: number;
  fullGrid: string[] | null; // shown again during reveal
}

export interface PrecisionView {
  kind: 'precision';
  stage: 'play' | 'break';
  round: number;
  rounds: number;
  seed: number; // new path every round
  startedAt: number; // current round
  endsAt: number; // current round (or the break)
  myRoundHits: number; // target shrinks with hits this round
  speed: number; // target speed multiplier
  size: number; // target size multiplier
  myHits: number;
  myMisses: number;
  myPoints: number;
  board: { playerId: string; hits: number }[];
}

export interface QuizView {
  kind: 'quiz';
  stage: 'question' | 'reveal';
  qIndex: number;
  qCount: number;
  prompt: string;
  options: string[];
  stageEndsAt: number;
  stageMs: number;
  authorId: string | null; // set for house (custom) questions
  myAnswer: number | null;
  correctIndex: number | null;
  explain: string | null;
  tally: number[] | null; // answers per option, on reveal
  answeredCount: number;
  myPoints: number;
}

export interface BombChallenge {
  prompt: string;
  options: string[];
}

export interface BombView {
  kind: 'bomb';
  stage: 'fuse' | 'boom' | 'over';
  round: number;
  rounds: number;
  holderId: string | null;
  alive: string[];
  eliminated: string[];
  heat: number; // 0..1, visual intensity — fuse length itself is secret
  challenge: BombChallenge | null; // only for holder
  canThrow: boolean; // holder solved the challenge
  lastThrow: { from: string; to: string; at: number } | null;
  explodedId: string | null;
  stageEndsAt: number | null;
}

export type GameView = ReactionView | MemoryView | PrecisionView | QuizView | BombView;
