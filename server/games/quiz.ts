import type { CustomQuestion, QuizView } from '../../shared/protocol.ts';
import { byDifficulty, isObj, perGame, shuffle, zeroMap, type GameCtx, type GameInstance, type GameModule } from '../engine.ts';

interface Q {
  prompt: string;
  options: string[];
  answer: number;
  explain: string;
  authorId?: string; // house questions: the author can't answer their own
}

// Options are shuffled per game so the answer position can't be learned.
export const QUESTION_BANK: Q[] = [
  { prompt: 'How many months have 28 days?', options: ['1', 'Only February', '2', '12'], answer: 3, explain: 'All of them. Some just keep going.' },
  { prompt: 'A farmer has 17 sheep. All but 9 die. How many are left?', options: ['8', '17', '9', '0'], answer: 2, explain: '"All but 9" = 9 survive.' },
  { prompt: 'What do cows drink?', options: ['Milk', 'Chai', 'Water', 'Protein shake'], answer: 2, explain: 'Cows MAKE milk. They drink water.' },
  { prompt: 'Which is heavier: 1kg of feathers or 1kg of bricks?', options: ['Bricks', 'Feathers', 'Same', 'Depends on the bird'], answer: 2, explain: 'A kilo is a kilo.' },
  { prompt: 'You overtake the person in 2nd place. What place are you in?', options: ['1st', '3rd', '2nd', 'Disqualified'], answer: 2, explain: 'You took their spot — 2nd.' },
  { prompt: 'How many animals of each kind did Moses take on the ark?', options: ['2', '7', '1', '0'], answer: 3, explain: 'It was Noah, not Moses.' },
  { prompt: 'How many times can you subtract 5 from 25?', options: ['5', '4', 'Infinite', 'Once'], answer: 3, explain: 'After the first time, it is 20.' },
  { prompt: 'What goes up but never comes down?', options: ['A balloon', 'Smoke', 'Your age', 'Rent'], answer: 2, explain: 'Your age. (Rent was emotionally correct.)' },
  { prompt: 'There are 3 apples. You take away 2. How many do YOU have?', options: ['1', '3', '0', '2'], answer: 3, explain: 'You took 2. You have 2.' },
  { prompt: 'A plane crashes on the India–Nepal border. Where are the survivors buried?', options: ['India', 'Nepal', 'Split 50/50', 'Nowhere'], answer: 3, explain: "You don't bury survivors." },
  { prompt: 'What is 2 + 2 × 2?', options: ['8', '222', '6', '4'], answer: 2, explain: 'Multiplication first. BODMAS strikes again.' },
  { prompt: 'Which word is spelled incorrectly in every dictionary?', options: ['Rhythm', 'Dictionary', 'Definitely', 'Incorrectly'], answer: 3, explain: '"Incorrectly" — always spelled I-N-C-O-R-R-E-C-T-L-Y.' },
  { prompt: 'Before Mount Everest was discovered, what was the tallest mountain?', options: ['K2', 'Kangchenjunga', 'Olympus Mons', 'Mount Everest'], answer: 3, explain: 'It was still Everest. Nobody had measured it.' },
  { prompt: 'How many birthdays does the average person have?', options: ['~73', '365', '1', '0'], answer: 2, explain: 'You are born once. The rest are anniversaries.' },
  { prompt: 'Divide 30 by half and add 10.', options: ['25', '15', '40', '70'], answer: 3, explain: '30 ÷ ½ = 60. Plus 10 = 70.' },
  { prompt: 'What has to be broken before you can use it?', options: ['A promise', 'A record', 'An egg', 'Your spirit'], answer: 2, explain: 'An egg. Hopefully not your spirit.' },
  { prompt: 'An electric train heads north. Wind blows south. Which way does the smoke go?', options: ['South', 'North', 'Straight up', 'There is no smoke'], answer: 3, explain: 'Electric trains have no smoke.' },
  { prompt: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Kangaroo City', 'Canberra'], answer: 3, explain: 'Canberra. Sydney just has better PR.' },
  { prompt: 'If a red house is made of red bricks, what is a greenhouse made of?', options: ['Green bricks', 'Plants', 'Glass', 'Envy'], answer: 2, explain: 'Glass. Obviously.' },
  { prompt: 'Tap the SMALLEST number.', options: ['0', '0.001', '1/1000000', '-1'], answer: 3, explain: 'Negative numbers exist. Sorry.' },
  { prompt: "Mary's father has 5 daughters: Nana, Nene, Nini, Nono. Who is the 5th?", options: ['Nunu', 'Nina', 'Mary', 'Nobody'], answer: 2, explain: "It's in the question — Mary." },
  { prompt: 'What weighs more: a ton of bricks or a ton of exam stress?', options: ['Bricks', 'Exam stress', 'Same', 'Ask my therapist'], answer: 2, explain: 'A ton is a ton. Emotionally: stress.' },
];

const MAX_HOUSE_QUESTIONS = 12; // per quiz game, so one host can't make it endless
const HOUSE_FALLBACK_EXPLAIN = 'Inside joke. You had to be there.';

/**
 * Every house question gets played (up to a cap), padded with bank questions up
 * to the game-length count, then shuffled so house questions land anywhere.
 */
export function buildQuiz(bankCount: number, custom: CustomQuestion[], rng: () => number): Q[] {
  const house: Q[] = shuffle(custom, rng)
    .slice(0, MAX_HOUSE_QUESTIONS)
    .map((c) => ({ prompt: c.prompt, options: c.options, answer: c.answer, explain: c.explain || HOUSE_FALLBACK_EXPLAIN, authorId: c.authorId }));
  const total = Math.max(bankCount, house.length);
  const bank = shuffle(QUESTION_BANK, rng).slice(0, total - house.length);
  return shuffle([...house, ...bank], rng).map((q) => {
    // Options are shuffled per game so the answer position can't be learned.
    const options = shuffle(q.options, rng);
    return { ...q, options, answer: options.indexOf(q.options[q.answer]) };
  });
}

class ImpossibleQuiz implements GameInstance {
  private qs: Q[];
  private q = 0;
  private stage: QuizView['stage'] = 'question';
  private stageStartedAt: number;
  private stageEndsAt: number;
  private answers = new Map<string, { choice: number; at: number }>();
  private points: Record<string, number>;
  private correct: Record<string, number>;
  private answered: Record<string, number>;
  private readonly questionMs: number;

  constructor(private ctx: GameCtx) {
    this.qs = buildQuiz(perGame(ctx, { short: 3, normal: 5, long: 7 }), ctx.customQuestions, ctx.rng);
    this.questionMs = byDifficulty(ctx, { chill: 15000, normal: 11000, chaos: 7000 });
    this.points = zeroMap(ctx.players);
    this.correct = zeroMap(ctx.players);
    this.answered = zeroMap(ctx.players);
    this.stageStartedAt = ctx.now();
    this.stageEndsAt = this.stageStartedAt + ctx.dur(this.questionMs);
  }

  tick(now: number) {
    const author = this.qs[this.q].authorId;
    const allIn =
      this.stage === 'question' &&
      this.ctx.players.every((p) => this.answers.has(p.id) || !this.ctx.isConnected(p.id) || p.id === author);
    if (now < this.stageEndsAt && !allIn) return;
    if (this.stage === 'question') {
      const q = this.qs[this.q];
      const span = this.stageEndsAt - this.stageStartedAt;
      for (const [id, a] of this.answers) {
        this.answered[id]++;
        if (a.choice === q.answer) {
          this.correct[id]++;
          this.points[id] += 150 + Math.round(100 * Math.max(0, 1 - (a.at - this.stageStartedAt) / span));
          this.ctx.emit(id, 'correct');
        } else {
          this.ctx.emit(id, 'wrong');
        }
      }
      this.stage = 'reveal';
      this.stageStartedAt = now;
      this.stageEndsAt = now + this.ctx.dur(3800);
    } else {
      this.q++;
      if (this.q >= this.qs.length) return this.ctx.finish();
      this.answers.clear();
      this.stage = 'question';
      this.stageStartedAt = now;
      this.stageEndsAt = now + this.ctx.dur(this.questionMs);
    }
    this.ctx.changed();
  }

  input(playerId: string, data: unknown, now: number) {
    if (this.stage !== 'question' || !isObj(data) || typeof data.choice !== 'number') return;
    if (this.answers.has(playerId) || !Number.isInteger(data.choice)) return;
    if (data.choice < 0 || data.choice >= this.qs[this.q].options.length) return;
    if (this.qs[this.q].authorId === playerId) return; // no points for knowing your own joke
    this.answers.set(playerId, { choice: data.choice, at: now });
    this.ctx.changed();
  }

  view(playerId: string): QuizView {
    const q = this.qs[this.q];
    const reveal = this.stage === 'reveal';
    let tally: number[] | null = null;
    if (reveal) {
      tally = q.options.map(() => 0);
      for (const a of this.answers.values()) tally[a.choice]++;
    }
    return {
      kind: 'quiz',
      stage: this.stage,
      qIndex: this.q,
      qCount: this.qs.length,
      prompt: q.prompt,
      options: q.options,
      stageEndsAt: this.stageEndsAt,
      stageMs: this.stageEndsAt - this.stageStartedAt,
      authorId: q.authorId ?? null,
      myAnswer: this.answers.get(playerId)?.choice ?? null,
      correctIndex: reveal ? q.answer : null,
      explain: reveal ? q.explain : null,
      tally,
      answeredCount: this.answers.size,
      myPoints: this.points[playerId] ?? 0,
    };
  }

  outcome() {
    const stats: Record<string, { correct: number; answered: number; wrong: number }> = {};
    const highlights: Record<string, string> = {};
    for (const p of this.ctx.players) {
      stats[p.id] = { correct: this.correct[p.id], answered: this.answered[p.id], wrong: this.answered[p.id] - this.correct[p.id] };
      const answerable = this.qs.filter((q) => q.authorId !== p.id).length; // authors sit out their own
      highlights[p.id] = `${this.correct[p.id]}/${answerable} not fooled`;
    }
    return { points: this.points, stats, highlights };
  }
}

export const quiz: GameModule = { id: 'quiz', create: (ctx) => new ImpossibleQuiz(ctx) };
