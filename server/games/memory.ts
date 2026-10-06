import type { MemoryView } from '../../shared/protocol.ts';
import { byDifficulty, isObj, perGame, pick, shuffle, zeroMap, type GameCtx, type GameInstance, type GameModule } from '../engine.ts';

const SYMBOLS = ['🍕', '🐸', '⭐', '💎', '🔥', '🍩', '🎈'];

const TUNING = {
  chill: { size: 3, memorizeMs: 8000, questionMs: 11000 },
  normal: { size: 4, memorizeMs: 6000, questionMs: 9000 },
  chaos: { size: 5, memorizeMs: 6000, questionMs: 7000 },
};

/** Symbols on the board for a given grid size (one more is held back as "missing"). */
const USED_SYMBOLS: Record<number, number> = { 3: 4, 4: 5, 5: 6 };

interface Question {
  prompt: string;
  options: string[];
  answer: number;
  cell?: number;
}

/** size² cells, every used symbol present, a unique most-common symbol, and one symbol held back. */
export function makeGrid(rng: () => number, size = 4): { grid: string[]; missing: string; used: string[] } {
  const pool = shuffle(SYMBOLS, rng).slice(0, (USED_SYMBOLS[size] ?? 5) + 1);
  const missing = pool.pop()!;
  for (;;) {
    const grid = Array.from({ length: size * size }, () => pick(pool, rng));
    const counts = pool.map((s) => grid.filter((g) => g === s).length);
    const max = Math.max(...counts);
    if (counts.every((c) => c > 0) && counts.filter((c) => c === max).length === 1) return { grid, missing, used: pool };
  }
}

function optionsWith(answer: string, pool: string[], rng: () => number): { options: string[]; answer: number } {
  const others = shuffle(pool.filter((p) => p !== answer), rng).slice(0, 3);
  const options = shuffle([answer, ...others], rng);
  return { options, answer: options.indexOf(answer) };
}

export function makeQuestions(grid: string[], missing: string, rng: () => number, count = 4): Question[] {
  const size = Math.round(Math.sqrt(grid.length));
  const used = SYMBOLS.filter((s) => grid.includes(s));
  const countOf = (s: string) => grid.filter((g) => g === s).length;

  // How many X? (one per symbol on the board)
  const counting: Question[] = shuffle(used, rng).map((sym) => {
    const n = countOf(sym);
    const nums = new Set([n]);
    for (const d of shuffle([-2, -1, 1, 2, 3], rng)) if (nums.size < 4 && n + d >= 0) nums.add(n + d);
    const options = shuffle([...nums].map(String), rng);
    return { prompt: `How many ${sym} were there?`, options, answer: options.indexOf(String(n)) };
  });

  // What was in a corner?
  const corners: [number, string][] = [
    [0, 'TOP-LEFT'],
    [size - 1, 'TOP-RIGHT'],
    [size * (size - 1), 'BOTTOM-LEFT'],
    [size * size - 1, 'BOTTOM-RIGHT'],
  ];
  const cornerQs: Question[] = shuffle(corners, rng).map(([cell, name]) => ({
    prompt: `What was in the ${name} corner?`,
    cell,
    ...optionsWith(grid[cell], SYMBOLS, rng),
  }));

  // Which appeared most? / Which never appeared? (distractors must all be on the board,
  // or there'd be several right answers)
  const most = used.reduce((a, b) => (countOf(b) > countOf(a) ? b : a));
  const oneOffs: Question[] = shuffle(
    [
      { prompt: 'Which appeared the MOST?', ...optionsWith(most, used, rng) },
      { prompt: 'Which one was NOT in the grid?', ...optionsWith(missing, [missing, ...used], rng) },
    ],
    rng,
  );

  // Highlighted cells (never a corner, those have their own questions)
  const cornerSet = new Set(corners.map(([c]) => c));
  const cellQs: Question[] = shuffle(
    grid.map((_, i) => i).filter((i) => !cornerSet.has(i)),
    rng,
  ).map((cell) => ({ prompt: 'What was in the glowing cell?', cell, ...optionsWith(grid[cell], SYMBOLS, rng) }));

  // Deal round-robin across the kinds so a long game stays varied.
  const piles = shuffle([counting, cornerQs, oneOffs, cellQs], rng);
  const qs: Question[] = [];
  while (qs.length < count && piles.some((p) => p.length)) for (const p of piles) if (p.length && qs.length < count) qs.push(p.shift()!);
  return qs;
}

class MemoryBlitz implements GameInstance {
  private grid: string[];
  private size: number;
  private questions: Question[];
  private stage: MemoryView['stage'] = 'memorize';
  private stageStartedAt: number;
  private stageEndsAt: number;
  private q = 0;
  private answers = new Map<string, { choice: number; at: number }>();
  private points: Record<string, number>;
  private correct: Record<string, number>;
  private answered: Record<string, number>;
  private readonly tune: (typeof TUNING)['normal'];

  constructor(private ctx: GameCtx) {
    this.tune = byDifficulty(ctx, TUNING);
    this.size = this.tune.size;
    const { grid, missing } = makeGrid(ctx.rng, this.size);
    this.grid = grid;
    this.questions = makeQuestions(grid, missing, ctx.rng, perGame(ctx, { short: 3, normal: 4, long: 5 }));
    this.points = zeroMap(ctx.players);
    this.correct = zeroMap(ctx.players);
    this.answered = zeroMap(ctx.players);
    this.stageStartedAt = ctx.now();
    this.stageEndsAt = this.stageStartedAt + ctx.dur(this.tune.memorizeMs);
  }

  private setStage(stage: MemoryView['stage'], now: number, ms: number) {
    this.stage = stage;
    this.stageStartedAt = now;
    this.stageEndsAt = now + this.ctx.dur(ms);
    this.ctx.changed();
  }

  tick(now: number) {
    const allIn =
      this.stage === 'question' &&
      this.ctx.players.every((p) => this.answers.has(p.id) || !this.ctx.isConnected(p.id));
    if (now < this.stageEndsAt && !allIn) return;

    if (this.stage === 'memorize') {
      this.setStage('question', now, this.tune.questionMs);
    } else if (this.stage === 'question') {
      this.scoreQuestion();
      this.setStage('reveal', now, 2200);
    } else {
      this.q++;
      this.answers.clear();
      if (this.q >= this.questions.length) this.ctx.finish();
      else this.setStage('question', now, this.tune.questionMs);
    }
  }

  private scoreQuestion() {
    const q = this.questions[this.q];
    const span = this.stageEndsAt - this.stageStartedAt;
    for (const [id, a] of this.answers) {
      this.answered[id]++;
      if (a.choice === q.answer) {
        const left = Math.max(0, 1 - (a.at - this.stageStartedAt) / span);
        this.points[id] += 150 + Math.round(100 * left);
        this.correct[id]++;
        this.ctx.emit(id, 'correct');
      } else {
        this.ctx.emit(id, 'wrong');
      }
    }
  }

  input(playerId: string, data: unknown, now: number) {
    if (this.stage !== 'question' || !isObj(data) || typeof data.choice !== 'number') return;
    if (this.answers.has(playerId)) return;
    const q = this.questions[this.q];
    if (!Number.isInteger(data.choice) || data.choice < 0 || data.choice >= q.options.length) return;
    this.answers.set(playerId, { choice: data.choice, at: now });
    this.ctx.changed();
  }

  view(playerId: string): MemoryView {
    const q = this.stage === 'memorize' ? null : this.questions[this.q];
    return {
      kind: 'memory',
      stage: this.stage,
      grid: this.stage === 'memorize' ? this.grid : null,
      gridSize: this.size,
      qIndex: this.q,
      qCount: this.questions.length,
      question: q ? { prompt: q.prompt, options: q.options, cell: q.cell } : null,
      stageEndsAt: this.stageEndsAt,
      stageMs: this.stageEndsAt - this.stageStartedAt,
      myAnswer: this.answers.get(playerId)?.choice ?? null,
      correctIndex: this.stage === 'reveal' && q ? q.answer : null,
      myPoints: this.points[playerId] ?? 0,
      answeredCount: this.answers.size,
      fullGrid: this.stage === 'reveal' ? this.grid : null,
    };
  }

  outcome() {
    const stats: Record<string, { correct: number; answered: number; wrong: number }> = {};
    const highlights: Record<string, string> = {};
    for (const p of this.ctx.players) {
      stats[p.id] = { correct: this.correct[p.id], answered: this.answered[p.id], wrong: this.answered[p.id] - this.correct[p.id] };
      highlights[p.id] = `${this.correct[p.id]}/${this.questions.length} correct`;
    }
    return { points: this.points, stats, highlights };
  }
}

export const memory: GameModule = { id: 'memory', create: (ctx) => new MemoryBlitz(ctx) };
