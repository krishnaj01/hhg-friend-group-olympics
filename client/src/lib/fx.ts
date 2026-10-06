import confetti from 'canvas-confetti';
import { useEffect, useRef, useState } from 'react';
import { serverNow } from './net';

/** Shake the whole stage. Intensity picks a CSS animation. */
export function shake(kind: 'small' | 'big' = 'small') {
  const el = document.getElementById('stage');
  if (!el) return;
  const cls = kind === 'big' ? 'shake-big' : 'shake';
  el.classList.remove('shake', 'shake-big');
  void el.offsetWidth; // restart animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), kind === 'big' ? 800 : 450);
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

const PARTY = ['#ff3d7f', '#ffb800', '#00e0ff', '#7cff4f', '#b46bff', '#ffffff'];

export function confettiBurst(power = 1) {
  confetti({ particleCount: Math.round(120 * power), spread: 90, startVelocity: 45, origin: { y: 0.6 }, colors: PARTY });
}

export function confettiRain(ms = 3000) {
  const end = Date.now() + ms;
  const frame = () => {
    confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: PARTY });
    confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: PARTY });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

/** Re-render every animation frame; returns current server time. */
export function useServerClock(active = true): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setNow(serverNow());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

/** Seconds remaining (ceil) until a server deadline; updates ~10x/sec. */
export function useSecondsLeft(endsAt: number | null | undefined): number {
  const [left, setLeft] = useState(() => (endsAt ? Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)) : 0));
  useEffect(() => {
    if (!endsAt) return;
    const upd = () => setLeft(Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)));
    upd();
    const iv = setInterval(upd, 100);
    return () => clearInterval(iv);
  }, [endsAt]);
  return left;
}

/** Run an effect when a value changes (not on first mount unless `initial`). */
export function useOnChange<T>(value: T, fn: (value: T, prev: T | undefined) => void, initial = false) {
  const prev = useRef<T | undefined>(initial ? undefined : value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current && !initial) {
      first.current = false;
      return;
    }
    first.current = false;
    if (prev.current !== value) fn(value, prev.current);
    prev.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
