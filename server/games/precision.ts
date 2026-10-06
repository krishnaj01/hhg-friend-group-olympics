import type { PrecisionView } from '../../shared/protocol.ts';
import { targetPosition, targetRadius } from '../../shared/target.ts';
import { byDifficulty, byLength, isObj, perGame, zeroMap, type GameCtx, type GameInstance, type GameModule } from '../engine.ts';

const TUNING = {
  chill: { speed: 0.75, size: 1.25 },
  normal: { speed: 1, size: 1 },
  chaos: { speed: 1.35, size: 0.8 },
};
const BREAK_MS = 1800; // "Round 2!" pause between rounds
const HIT_POINTS = 40;
const BULLSEYE_BONUS = 20;
const MISS_PENALTY = 10;
const MIN_TAP_GAP = 70; // anti-autoclicker
const MAX_LAG = 500; // how far back a tap timestamp may claim to be
const TOLERANCE = 1.2; // forgive edge taps / tiny clock drift

export function judgeTap(seed: number, elapsed: number, hits: number, x: number, y: number, speed = 1, size = 1) {
  const r = targetRadius(hits, size);
  let best = Infinity;
  // Check a small window to absorb clock-sync error.
  for (const dt of [0, -40, 40, -80, 80]) {
    const p = targetPosition(seed, elapsed + dt, speed);
    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  }
  return { hit: best <= r * TOLERANCE, bullseye: best <= r * 0.35 };
}

class Precision implements GameInstance {
  private readonly baseSeed: number;
  private seed: number;
  private stage: PrecisionView['stage'] = 'play';
  private round = 0;
  private readonly rounds: number;
  private readonly roundMs: number;
  private startedAt: number;
  private endsAt: number;
  private roundHits: Record<string, number>;
  private hits: Record<string, number>;
  private misses: Record<string, number>;
  private points: Record<string, number>;
  private lastTap: Record<string, number> = {};
  private readonly tune: (typeof TUNING)['normal'];

  constructor(private ctx: GameCtx) {
    this.tune = byDifficulty(ctx, TUNING);
    this.baseSeed = this.seed = Math.floor(ctx.rng() * 1e6);
    // Auto = one long round; an explicit "rounds per game" splits it into shorter rounds.
    this.rounds = ctx.settings.perGame ?? 1;
    this.roundMs =
      ctx.settings.perGame === null
        ? byLength(ctx, { short: 12000, normal: 20000, long: 30000 })
        : byLength(ctx, { short: 8000, normal: 12000, long: 16000 });
    this.startedAt = ctx.now();
    this.endsAt = this.startedAt + ctx.dur(this.roundMs);
    this.roundHits = zeroMap(ctx.players);
    this.hits = zeroMap(ctx.players);
    this.misses = zeroMap(ctx.players);
    this.points = zeroMap(ctx.players);
  }

  tick(now: number) {
    if (now < this.endsAt) return;
    if (this.stage === 'play') {
      if (this.round + 1 >= this.rounds) return this.ctx.finish();
      this.stage = 'break';
      this.endsAt = now + this.ctx.dur(BREAK_MS);
    } else {
      this.round++;
      this.stage = 'play';
      this.seed = this.baseSeed + this.round * 7919; // fresh path each round
      this.roundHits = zeroMap(this.ctx.players); // target grows back
      this.startedAt = now;
      this.endsAt = now + this.ctx.dur(this.roundMs);
    }
    this.ctx.changed();
  }

  input(playerId: string, data: unknown, now: number) {
    if (!isObj(data) || this.stage !== 'play' || now >= this.endsAt) return;
    const { x, y, t } = data;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof t !== 'number') return;
    if (!isFinite(x) || !isFinite(y) || !isFinite(t)) return;
    if (now - (this.lastTap[playerId] ?? 0) < MIN_TAP_GAP) return;
    this.lastTap[playerId] = now;

    const at = Math.min(now, Math.max(now - MAX_LAG, t));
    const { speed, size } = this.tune;
    const { hit, bullseye } = judgeTap(this.seed, Math.max(0, at - this.startedAt), this.roundHits[playerId], x, y, speed, size);
    if (hit) {
      this.hits[playerId]++;
      this.roundHits[playerId]++;
      this.points[playerId] += HIT_POINTS + (bullseye ? BULLSEYE_BONUS : 0);
      this.ctx.emit(playerId, 'hit', { bullseye, x, y });
    } else {
      this.misses[playerId]++;
      this.points[playerId] -= MISS_PENALTY;
      this.ctx.emit(playerId, 'miss', { x, y });
    }
    this.ctx.changed();
  }

  view(playerId: string): PrecisionView {
    return {
      kind: 'precision',
      stage: this.stage,
      round: this.round,
      rounds: this.rounds,
      seed: this.seed,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      speed: this.tune.speed,
      size: this.tune.size,
      myRoundHits: this.roundHits[playerId] ?? 0,
      myHits: this.hits[playerId] ?? 0,
      myMisses: this.misses[playerId] ?? 0,
      myPoints: this.points[playerId] ?? 0,
      board: this.ctx.players.map((p) => ({ playerId: p.id, hits: this.hits[p.id] })).sort((a, b) => b.hits - a.hits),
    };
  }

  outcome() {
    const stats: Record<string, { hits: number; misses: number }> = {};
    const highlights: Record<string, string> = {};
    const points: Record<string, number> = {};
    for (const p of this.ctx.players) {
      const h = this.hits[p.id], m = this.misses[p.id];
      stats[p.id] = { hits: h, misses: m };
      points[p.id] = Math.max(0, this.points[p.id]);
      highlights[p.id] = `${h} hits · ${h + m ? Math.round((100 * h) / (h + m)) : 0}%`;
    }
    return { points, stats, highlights };
  }
}

export const precision: GameModule = { id: 'precision', create: (ctx) => new Precision(ctx) };
