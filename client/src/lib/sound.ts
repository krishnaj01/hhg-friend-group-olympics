// Tiny WebAudio synth — every SFX is generated, so there are no assets to load.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem('fgo-muted') === '1';
} catch {
  /* ignore */
}

function ac(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Browsers only allow audio after a gesture: unlock on the first tap.
if (typeof window !== 'undefined') {
  const unlock = () => {
    ac();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('fgo-muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = m ? 0 : 0.5;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; at?: number; slide?: number } = {}) {
  const c = ac();
  if (!c || !master || muted) return;
  const t0 = c.currentTime + (opts.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.25, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, opts: { vol?: number; at?: number; lowpass?: number } = {}) {
  const c = ac();
  if (!c || !master || muted) return;
  const t0 = c.currentTime + (opts.at ?? 0);
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(opts.lowpass ?? 3000, t0);
  filter.frequency.exponentialRampToValueAtTime(80, t0 + dur);
  const g = c.createGain();
  g.gain.value = opts.vol ?? 0.6;
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  click: () => tone(660, 0.06, { type: 'triangle', vol: 0.15 }),
  join: () => {
    tone(523, 0.1, { type: 'triangle' });
    tone(784, 0.15, { type: 'triangle', at: 0.08 });
  },
  tick: () => tone(880, 0.05, { type: 'square', vol: 0.1 }),
  beep: () => tone(440, 0.18, { type: 'square', vol: 0.2 }),
  go: () => {
    tone(880, 0.35, { type: 'sawtooth', vol: 0.25 });
    tone(1320, 0.35, { type: 'square', vol: 0.12 });
  },
  correct: () => {
    tone(784, 0.1, { type: 'triangle' });
    tone(1047, 0.2, { type: 'triangle', at: 0.09 });
  },
  wrong: () => tone(160, 0.35, { type: 'sawtooth', vol: 0.3, slide: 90 }),
  buzzer: () => {
    tone(120, 0.5, { type: 'sawtooth', vol: 0.35 });
    tone(127, 0.5, { type: 'square', vol: 0.2 });
  },
  hit: () => tone(1200, 0.08, { type: 'square', vol: 0.15, slide: 1800 }),
  bullseye: () => {
    tone(1400, 0.08, { type: 'square', vol: 0.15 });
    tone(2100, 0.12, { type: 'triangle', vol: 0.15, at: 0.06 });
  },
  miss: () => tone(200, 0.08, { type: 'triangle', vol: 0.15, slide: 120 }),
  whoosh: () => noise(0.4, { vol: 0.25, lowpass: 6000 }),
  boom: () => {
    noise(1.4, { vol: 1, lowpass: 1800 });
    tone(80, 0.9, { type: 'sine', vol: 0.6, slide: 30 });
  },
  alarm: () => {
    for (let i = 0; i < 3; i++) tone(988, 0.08, { type: 'square', vol: 0.15, at: i * 0.12 });
  },
  fuse: (heat: number) => tone(500 + heat * 900, 0.04, { type: 'square', vol: 0.06 + heat * 0.08 }),
  drumroll: (dur = 1.2) => {
    for (let t = 0; t < dur; t += 0.05) noise(0.05, { vol: 0.15 + (t / dur) * 0.2, at: t, lowpass: 900 });
  },
  rankUp: () => {
    tone(660, 0.08, { type: 'triangle' });
    tone(880, 0.08, { type: 'triangle', at: 0.07 });
    tone(1320, 0.15, { type: 'triangle', at: 0.14 });
  },
  fanfare: () => {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((n, i) => tone(n, i === notes.length - 1 ? 0.6 : 0.16, { type: 'square', vol: 0.18, at: i * 0.14 }));
    notes.forEach((n, i) => tone(n / 2, 0.16, { type: 'triangle', vol: 0.15, at: i * 0.14 }));
  },
};
