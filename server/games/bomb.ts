import type { BombChallenge, BombView, PlayerStats } from '../../shared/protocol.ts';
import { byDifficulty, isObj, perGame, pick, shuffle, zeroMap, type GameCtx, type GameInstance, type GameModule } from '../engine.ts';

const TUNING = {
  chill: { minFuse: 18000, maxFuse: 28000, wrongPenalty: 800 },
  normal: { minFuse: 14000, maxFuse: 24000, wrongPenalty: 1200 }, // wrong answers burn the fuse faster
  chaos: { minFuse: 9000, maxFuse: 16000, wrongPenalty: 2000 },
};
const SURVIVE_POINTS = 200;
const LAST_STANDING_BONUS = 150;
const SOLVE_POINTS = 30;
const AUTO_PASS_MS = 2500; // disconnected holder auto-throws

interface Challenge extends BombChallenge {
  answer: number;
}

export function makeChallenge(rng: () => number): Challenge {
  const kind = Math.floor(rng() * 3);
  if (kind === 0) {
    const ops = [
      () => { const a = 2 + Math.floor(rng() * 9), b = 2 + Math.floor(rng() * 9); return { p: `${a} + ${b}`, v: a + b }; },
      () => { const a = 2 + Math.floor(rng() * 8), b = 2 + Math.floor(rng() * 8); return { p: `${a} × ${b}`, v: a * b }; },
      () => { const a = 10 + Math.floor(rng() * 20), b = 1 + Math.floor(rng() * 9); return { p: `${a} − ${b}`, v: a - b }; },
    ];
    const { p, v } = pick(ops, rng)();
    const set = new Set([v]);
    while (set.size < 4) set.add(v + pick([-10, -2, -1, 1, 2, 3, 10], rng));
    const options = shuffle([...set].map(String), rng);
    return { prompt: `${p} = ?`, options, answer: options.indexOf(String(v)) };
  }
  if (kind === 1) {
    const pairs = [['🐶', '🐱'], ['🍎', '🍅'], ['😀', '😃'], ['🌕', '🌝'], ['🔴', '🟠'], ['👻', '💀'], ['🐸', '🐢']];
    const [same, odd] = shuffle(pick(pairs, rng), rng);
    const options = shuffle([same, same, same, odd], rng);
    return { prompt: 'Tap the odd one out!', options, answer: options.indexOf(odd) };
  }
  const nums = new Set<number>();
  while (nums.size < 4) nums.add(Math.floor(rng() * 90) + 10);
  const options = shuffle([...nums].map(String), rng);
  const biggest = Math.max(...nums);
  return { prompt: 'Tap the BIGGEST number!', options, answer: options.indexOf(String(biggest)) };
}

class PassTheBomb implements GameInstance {
  private round = 0;
  private rounds: number;
  private stage: BombView['stage'] = 'fuse';
  private alive: string[];
  private eliminated: string[] = [];
  private holder: string | null = null;
  private challenge: Challenge | null = null;
  private canThrow = false;
  private fuseStart = 0;
  private fuseEnd = 0;
  private stageEndsAt: number | null = null;
  private lastThrow: BombView['lastThrow'] = null;
  private explodedId: string | null = null;
  private disconnectedSince: number | null = null;
  private points: Record<string, number>;
  private explosions: Record<string, number>;
  private wrong: Record<string, number>;
  private holds: Record<string, number>;
  private solves: Record<string, number>;
  private readonly tune: (typeof TUNING)['normal'];

  constructor(private ctx: GameCtx) {
    this.tune = byDifficulty(ctx, TUNING);
    this.alive = ctx.players.map((p) => p.id);
    this.rounds = Math.max(1, Math.min(this.alive.length - 1, perGame(ctx, { short: 2, normal: 3, long: 4 })));
    this.points = zeroMap(ctx.players);
    this.explosions = zeroMap(ctx.players);
    this.wrong = zeroMap(ctx.players);
    this.holds = zeroMap(ctx.players);
    this.solves = zeroMap(ctx.players);
    this.startRound(ctx.now());
  }

  private startRound(now: number) {
    this.stage = 'fuse';
    this.explodedId = null;
    this.lastThrow = null;
    this.fuseStart = now;
    const { minFuse, maxFuse } = this.tune;
    this.fuseEnd = now + this.ctx.dur(minFuse + this.ctx.rng() * (maxFuse - minFuse));
    this.stageEndsAt = null;
    const connected = this.alive.filter((id) => this.ctx.isConnected(id));
    this.giveTo(pick(connected.length ? connected : this.alive, this.ctx.rng), now);
  }

  private giveTo(id: string, now: number) {
    const from = this.holder;
    this.holder = id;
    this.holds[id]++;
    this.canThrow = false;
    this.challenge = makeChallenge(this.ctx.rng);
    this.disconnectedSince = null;
    if (from && from !== id) this.lastThrow = { from, to: id, at: now };
    this.ctx.emit(id, 'incoming', { from });
    this.ctx.changed();
  }

  private targets() {
    return this.alive.filter((id) => id !== this.holder);
  }

  tick(now: number) {
    if (this.stage === 'fuse') {
      if (now >= this.fuseEnd) return this.explode(now);
      // Holder vanished? Don't stall the room: auto-throw after a grace period.
      if (this.holder && !this.ctx.isConnected(this.holder) && this.targets().length) {
        this.disconnectedSince ??= now;
        if (now - this.disconnectedSince > AUTO_PASS_MS) {
          const live = this.targets().filter((id) => this.ctx.isConnected(id));
          this.giveTo(pick(live.length ? live : this.targets(), this.ctx.rng), now);
        }
      }
      // heat changes continuously; a ~4Hz refresh is plenty for the visuals
      if (Math.floor(now / 250) !== Math.floor((now - 50) / 250)) this.ctx.changed();
    } else if (this.stage === 'boom' && this.stageEndsAt !== null && now >= this.stageEndsAt) {
      this.round++;
      if (this.round < this.rounds && this.alive.length >= 2) this.startRound(now);
      else {
        for (const id of this.alive) this.points[id] += LAST_STANDING_BONUS;
        this.stage = 'over';
        this.ctx.changed();
        this.ctx.finish();
      }
    }
  }

  private explode(now: number) {
    const victim = this.holder!;
    this.explodedId = victim;
    this.explosions[victim]++;
    this.alive = this.alive.filter((id) => id !== victim);
    if (this.ctx.players.length > 1) this.eliminated.push(victim);
    else this.alive.push(victim); // solo practice: you can't be eliminated from nothing
    for (const id of this.alive) if (id !== victim) this.points[id] += SURVIVE_POINTS;
    this.holder = null;
    this.challenge = null;
    this.canThrow = false;
    this.stage = 'boom';
    this.stageEndsAt = now + this.ctx.dur(3500);
    this.ctx.emit(null, 'boom', { victim });
    this.ctx.changed();
  }

  input(playerId: string, data: unknown, now: number) {
    if (this.stage !== 'fuse' || playerId !== this.holder || !isObj(data)) return;
    if (typeof data.choice === 'number' && !this.canThrow && this.challenge) {
      if (data.choice === this.challenge.answer) {
        this.solves[playerId]++;
        this.points[playerId] += SOLVE_POINTS;
        if (this.targets().length) this.canThrow = true;
        else this.challenge = makeChallenge(this.ctx.rng); // solo: just keep solving
        this.ctx.emit(playerId, 'solved');
      } else {
        this.wrong[playerId]++;
        this.fuseEnd = Math.max(now + 300, this.fuseEnd - this.ctx.dur(this.tune.wrongPenalty));
        this.challenge = makeChallenge(this.ctx.rng);
        this.ctx.emit(playerId, 'wrong');
      }
      this.ctx.changed();
    } else if (typeof data.throwTo === 'string' && this.canThrow) {
      if (this.targets().includes(data.throwTo)) this.giveTo(data.throwTo, now);
    }
  }

  onDisconnect() {
    this.ctx.changed();
  }

  view(playerId: string): BombView {
    const maxFuse = this.ctx.dur(this.tune.maxFuse);
    const isHolder = playerId === this.holder;
    return {
      kind: 'bomb',
      stage: this.stage,
      round: this.round,
      rounds: this.rounds,
      holderId: this.holder,
      alive: this.alive,
      eliminated: this.eliminated,
      // Normalised to the MAX fuse so the bar can't tell you exactly when it blows.
      heat: this.stage === 'fuse' ? Math.min(1, (this.ctx.now() - this.fuseStart) / maxFuse) : 1,
      challenge: isHolder && this.challenge && !this.canThrow ? { prompt: this.challenge.prompt, options: this.challenge.options } : null,
      canThrow: isHolder && this.canThrow,
      lastThrow: this.lastThrow,
      explodedId: this.explodedId,
      stageEndsAt: this.stageEndsAt,
    };
  }

  outcome() {
    const stats: Record<string, PlayerStats> = {};
    const highlights: Record<string, string> = {};
    for (const p of this.ctx.players) {
      const solves = this.solves[p.id], wrong = this.wrong[p.id];
      stats[p.id] = { explosions: this.explosions[p.id], wrong, bombHolds: this.holds[p.id], correct: solves, answered: solves + wrong };
      highlights[p.id] = this.explosions[p.id] ? '💥 went boom' : this.alive.includes(p.id) ? '🛡️ survived' : '';
    }
    return { points: this.points, stats, highlights };
  }
}

export const bomb: GameModule = { id: 'bomb', create: (ctx) => new PassTheBomb(ctx) };
