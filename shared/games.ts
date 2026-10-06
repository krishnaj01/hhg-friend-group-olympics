// Static metadata for every mini-game. Shared by server (ordering/validation)
// and client (title cards, colors). Add a new game here + a server module +
// a client component and it is wired into the whole flow.

export const GAME_IDS = ['reaction', 'memory', 'precision', 'quiz', 'bomb'] as const;
export type GameId = (typeof GAME_IDS)[number];

export interface GameMeta {
  id: GameId;
  name: string;
  emoji: string;
  tagline: string;
  howTo: string[];
  gradient: string; // tailwind gradient stops
}

export const GAME_META: Record<GameId, GameMeta> = {
  reaction: {
    id: 'reaction',
    name: 'Reaction Rush',
    emoji: '⚡',
    tagline: 'Fastest finger on campus',
    howTo: ['Wait for GREEN', 'Then TAP as fast as you can', 'Tap early = penalty 💀'],
    gradient: 'from-yellow-300 via-orange-500 to-red-600',
  },
  memory: {
    id: 'memory',
    name: 'Memory Blitz',
    emoji: '🧠',
    tagline: 'Stare. Remember. Panic.',
    howTo: ['Memorize the grid', 'It disappears', 'Answer fast for bonus points'],
    gradient: 'from-cyan-300 via-sky-500 to-indigo-600',
  },
  precision: {
    id: 'precision',
    name: 'Precision',
    emoji: '🎯',
    tagline: 'Hit it. Again. Again.',
    howTo: ['Tap the moving target', 'It shrinks every hit', 'Misses cost points'],
    gradient: 'from-lime-300 via-emerald-500 to-teal-700',
  },
  quiz: {
    id: 'quiz',
    name: 'Impossible Quiz',
    emoji: '🤯',
    tagline: 'The obvious answer is a trap',
    howTo: ['Read carefully', 'Think twice', 'Speed bonus for correct answers'],
    gradient: 'from-fuchsia-400 via-purple-500 to-violet-700',
  },
  bomb: {
    id: 'bomb',
    name: 'Pass the Bomb',
    emoji: '💣',
    tagline: "Don't be holding it.",
    howTo: ['Solve the challenge to unlock a throw', 'Throw the bomb at a friend', 'Holding it at BOOM = you lose'],
    gradient: 'from-red-400 via-rose-600 to-zinc-900',
  },
};
