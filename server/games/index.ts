import type { GameId } from '../../shared/games.ts';
import type { GameModule } from '../engine.ts';
import { reaction } from './reaction.ts';
import { memory } from './memory.ts';
import { precision } from './precision.ts';
import { quiz } from './quiz.ts';
import { bomb } from './bomb.ts';

/** Server-side game registry. Adding a game = one module + one line here. */
export const GAMES: Record<GameId, GameModule> = { reaction, memory, precision, quiz, bomb };
