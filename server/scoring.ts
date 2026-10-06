import type { Award, PlayerStats } from '../shared/protocol.ts';

/** Competition ranking: equal totals share a rank (1, 1, 3). */
export function rankOf(totals: Record<string, number>): Record<string, number> {
  const ids = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const ranks: Record<string, number> = {};
  ids.forEach((id, i) => {
    ranks[id] = i > 0 && totals[id] === totals[ids[i - 1]] ? ranks[ids[i - 1]] : i + 1;
  });
  return ranks;
}

export function mergeStats(into: PlayerStats, add: PlayerStats): PlayerStats {
  const out: PlayerStats = { ...into };
  for (const [k, v] of Object.entries(add) as [keyof PlayerStats, number | undefined][]) {
    if (v === undefined) continue;
    if (k === 'bestReactionMs') out[k] = out[k] === undefined ? v : Math.min(out[k]!, v);
    else out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export function chaosScore(s: PlayerStats): number {
  return (s.falseStarts ?? 0) * 3 + (s.explosions ?? 0) * 4 + (s.wrong ?? 0) + (s.misses ?? 0) * 0.5 + (s.bombHolds ?? 0);
}

function best<T>(ids: string[], score: (id: string) => T | undefined, better: (a: T, b: T) => boolean): string | null {
  let winner: string | null = null;
  let top: T | undefined;
  for (const id of ids) {
    const s = score(id);
    if (s === undefined) continue;
    if (top === undefined || better(s, top)) {
      top = s;
      winner = id;
    }
  }
  return winner;
}

/**
 * @param rankHistory ranks after each game, oldest first (for comebacks)
 */
export function computeAwards(
  ids: string[],
  stats: Record<string, PlayerStats>,
  rankHistory: Record<string, number>[],
  finalRanks: Record<string, number>,
): Award[] {
  const awards: Award[] = [];
  const st = (id: string) => stats[id] ?? {};

  const fastest = best(ids, (id) => st(id).bestReactionMs, (a, b) => a < b);
  if (fastest) awards.push({ key: 'fastest', title: 'Fastest Reaction', emoji: '⚡', playerId: fastest, detail: `${st(fastest).bestReactionMs}ms` });

  const acc = (id: string) => {
    const s = st(id);
    const tries = (s.answered ?? 0) + (s.hits ?? 0) + (s.misses ?? 0);
    return tries >= 3 ? ((s.correct ?? 0) + (s.hits ?? 0)) / tries : undefined;
  };
  const accurate = best(ids, acc, (a, b) => a > b);
  if (accurate) awards.push({ key: 'accurate', title: 'Most Accurate', emoji: '🎯', playerId: accurate, detail: `${Math.round(acc(accurate)! * 100)}% on target` });

  if (rankHistory.length >= 2 && ids.length >= 2) {
    // Biggest climb from their worst position (after the first game) to the final rank.
    const climb = (id: string) => {
      const worst = Math.max(...rankHistory.map((r) => r[id] ?? 0));
      const gain = worst - finalRanks[id];
      return gain > 0 ? gain : undefined;
    };
    const comeback = best(ids, climb, (a, b) => a > b);
    if (comeback) awards.push({ key: 'comeback', title: 'Biggest Comeback', emoji: '📈', playerId: comeback, detail: `climbed ${climb(comeback)} place${climb(comeback)! > 1 ? 's' : ''}` });
  }

  const chaotic = best(ids, (id) => (chaosScore(st(id)) > 0 ? chaosScore(st(id)) : undefined), (a, b) => a > b);
  if (chaotic) {
    const s = st(chaotic);
    const bits = [
      s.falseStarts && `${s.falseStarts} false start${s.falseStarts > 1 ? 's' : ''}`,
      s.explosions && `${s.explosions} explosion${s.explosions > 1 ? 's' : ''}`,
      s.wrong && `${s.wrong} wrong`,
    ].filter(Boolean);
    awards.push({ key: 'chaotic', title: 'Most Chaotic', emoji: '🌪️', playerId: chaotic, detail: bits.join(' · ') || 'pure vibes' });
  }
  return awards;
}
