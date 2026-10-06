import type { ReactionView } from '../../shared/protocol.ts';
import { byDifficulty, isObj, perGame, zeroMap, type GameCtx, type GameInstance, type GameModule } from '../engine.ts';

const FASTEST_BONUS = 60;
const MIN_HUMAN_MS = 90;
const FAKE_MS = 700; // how long a chaos-mode decoy flash lasts

interface Tuning {
  waitMin: number;
  waitMax: number;
  goWindow: number;
  penalty: number;
  decoyChance: number; // chance per round of a fake-out flash before GO
}

const TUNING = {
  chill: { waitMin: 2000, waitMax: 5000, goWindow: 3000, penalty: -50, decoyChance: 0 },
  normal: { waitMin: 1500, waitMax: 4500, goWindow: 2500, penalty: -100, decoyChance: 0 },
  chaos: { waitMin: 2500, waitMax: 6000, goWindow: 1500, penalty: -150, decoyChance: 0.7 },
} satisfies Record<string, Tuning>;

interface Attempt {
  ms: number | null;
  falseStart: boolean;
  points: number;
}

export function reactionPoints(ms: number): number {
  // 200ms -> 300, 400ms -> 200, 800ms -> 0
  return Math.max(0, Math.round(400 - ms * 0.5));
}

class ReactionRush implements GameInstance {
  private round = 0;
  private stage: ReactionView['stage'] = 'wait';
  private stageEndsAt = 0;
  private goAt: number | null = null;
  private attempts = new Map<string, Attempt>();
  private points: Record<string, number>;
  private best: Record<string, number | undefined> = {};
  private falseStarts: Record<string, number>;
  private readonly rounds: number;
  private readonly tune: Tuning;
  private fakeAt: number | null = null;

  constructor(private ctx: GameCtx) {
    this.rounds = perGame(ctx, { short: 2, normal: 3, long: 5 });
    this.tune = byDifficulty(ctx, TUNING);
    this.points = zeroMap(ctx.players);
    this.falseStarts = zeroMap(ctx.players);
    this.startRound(ctx.now());
  }

  private startRound(now: number) {
    this.stage = 'wait';
    this.goAt = null;
    this.attempts.clear();
    // Random hidden delay — this is the whole game, so it is never sent to clients.
    const { waitMin, waitMax, decoyChance } = this.tune;
    const wait = waitMin + this.ctx.rng() * (waitMax - waitMin);
    this.stageEndsAt = now + this.ctx.dur(wait);
    // Chaos: maybe flash a decoy somewhere in the first part of the wait.
    this.fakeAt =
      this.ctx.rng() < decoyChance ? now + this.ctx.dur(600 + this.ctx.rng() * Math.max(0, wait - FAKE_MS - 1400)) : null;
    this.ctx.changed();
  }

  private activeIds() {
    return this.ctx.players.map((p) => p.id).filter((id) => this.ctx.isConnected(id));
  }

  tick(now: number) {
    if (this.fakeAt !== null && (this.stage === 'wait' || this.stage === 'fake')) {
      const faking = now >= this.fakeAt && now < this.fakeAt + this.ctx.dur(FAKE_MS);
      if (faking !== (this.stage === 'fake')) {
        this.stage = faking ? 'fake' : 'wait';
        if (!faking) this.fakeAt = null;
        this.ctx.changed();
      }
    }
    if (now < this.stageEndsAt && !(this.stage === 'go' && this.everyoneDone())) return;
    if (this.stage === 'wait' || this.stage === 'fake') {
      this.stage = 'go';
      this.goAt = now;
      this.stageEndsAt = now + this.ctx.dur(this.tune.goWindow);
      this.ctx.emit(null, 'go');
      this.ctx.changed();
    } else if (this.stage === 'go') {
      this.scoreRound();
      this.stage = 'reveal';
      this.stageEndsAt = now + this.ctx.dur(2800);
      this.ctx.changed();
    } else {
      this.round++;
      if (this.round >= this.rounds) this.ctx.finish();
      else this.startRound(now);
    }
  }

  private everyoneDone() {
    const active = this.activeIds();
    return active.length > 0 && active.every((id) => this.attempts.has(id));
  }

  private scoreRound() {
    let fastest: string | null = null;
    for (const p of this.ctx.players) {
      const a = this.attempts.get(p.id);
      if (!a) {
        this.attempts.set(p.id, { ms: null, falseStart: false, points: 0 });
        continue;
      }
      if (a.falseStart) continue;
      a.points = reactionPoints(a.ms!);
      if (!fastest || a.ms! < this.attempts.get(fastest)!.ms!) fastest = p.id;
    }
    if (fastest && this.ctx.players.length > 1) this.attempts.get(fastest)!.points += FASTEST_BONUS;
    for (const [id, a] of this.attempts) this.points[id] += a.points;
  }

  input(playerId: string, data: unknown, now: number) {
    if (!isObj(data) || data.tap !== true || this.stage === 'reveal') return;
    if (this.attempts.has(playerId)) return;
    const reported = typeof data.reactionMs === 'number' && isFinite(data.reactionMs) ? data.reactionMs : null;

    if (this.stage !== 'go' || reported === null) {
      // Tapped before GO (by the server's clock, or before the client saw GO), or fell for a decoy.
      this.attempts.set(playerId, { ms: null, falseStart: true, points: this.tune.penalty });
      this.falseStarts[playerId]++;
      this.ctx.emit(playerId, 'falseStart');
    } else {
      // Client measures from when it rendered GO (fair under latency); the
      // server bounds it by its own elapsed time so it can't be faked low.
      const serverElapsed = now - this.goAt!;
      const ms = Math.round(Math.max(MIN_HUMAN_MS, Math.min(reported, serverElapsed)));
      this.attempts.set(playerId, { ms, falseStart: false, points: 0 });
      if (this.best[playerId] === undefined || ms < this.best[playerId]!) this.best[playerId] = ms;
    }
    this.ctx.changed();
  }

  view(playerId: string): ReactionView {
    const mine = this.attempts.get(playerId);
    return {
      kind: 'reaction',
      round: this.round,
      rounds: this.rounds,
      stage: this.stage,
      goAt: this.goAt,
      stageEndsAt: this.stage === 'wait' || this.stage === 'fake' ? null : this.stageEndsAt,
      myResult: mine ? { ms: mine.ms, falseStart: mine.falseStart } : null,
      roundResults:
        this.stage === 'reveal'
          ? [...this.attempts].map(([id, a]) => ({ playerId: id, ...a })).sort((a, b) => (a.ms ?? 1e9) - (b.ms ?? 1e9))
          : [],
      done: [...this.attempts.keys()],
    };
  }

  outcome() {
    const stats: Record<string, { bestReactionMs?: number; falseStarts: number }> = {};
    const highlights: Record<string, string> = {};
    for (const p of this.ctx.players) {
      stats[p.id] = { bestReactionMs: this.best[p.id], falseStarts: this.falseStarts[p.id] };
      highlights[p.id] =
        this.best[p.id] !== undefined ? `best ${this.best[p.id]}ms` : this.falseStarts[p.id] ? 'too eager 😬' : 'asleep 💤';
    }
    return { points: this.points, stats, highlights };
  }
}

export const reaction: GameModule = { id: 'reaction', create: (ctx) => new ReactionRush(ctx) };
