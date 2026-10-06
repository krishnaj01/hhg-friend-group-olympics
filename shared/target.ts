// Deterministic target motion for Precision. Server and client evaluate the
// same function of (seed, elapsed ms) so hits can be validated authoritatively
// without streaming positions at 60fps.

export interface TargetPos {
  x: number; // 0..1
  y: number; // 0..1
}

function hash(seed: number, k: number): number {
  const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function targetPosition(seed: number, elapsedMs: number, speed = 1): TargetPos {
  const t = (elapsedMs / 1000) * speed;
  // Speed ramps up over time so the end of the round is frantic.
  const tt = t + 0.025 * t * t;
  const a1 = 0.9 + hash(seed, 1) * 0.8;
  const a2 = 1.3 + hash(seed, 2) * 0.9;
  const b1 = 0.8 + hash(seed, 3) * 0.9;
  const b2 = 1.7 + hash(seed, 4) * 0.8;
  const p = hash(seed, 5) * Math.PI * 2;
  const x = 0.5 + 0.3 * Math.sin(a1 * tt + p) + 0.1 * Math.sin(a2 * tt * 1.7);
  const y = 0.5 + 0.3 * Math.cos(b1 * tt + p * 0.5) + 0.1 * Math.sin(b2 * tt);
  return { x, y };
}

/** Target radius (fraction of the arena's shorter side) given hits so far. */
export function targetRadius(hits: number, size = 1): number {
  return Math.max(0.045, 0.12 - hits * 0.005) * size;
}
