import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { GAME_IDS, GAME_META } from '../../../shared/games';
import { AVATARS, CODE_ALPHABET, CODE_LENGTH } from '../../../shared/protocol';
import { MuteButton, Screen } from '../components/ui';
import { send, useNet } from '../lib/net';
import { sfx } from '../lib/sound';

function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

function codeFromUrl() {
  const seg = location.pathname.replace(/^\//, '').toUpperCase();
  return seg.length === CODE_LENGTH && [...seg].every((c) => CODE_ALPHABET.includes(c)) ? seg : '';
}

export function Landing() {
  const { status, kicked } = useNet();
  const urlCode = codeFromUrl();
  const [mode, setMode] = useState<'home' | 'join'>(urlCode ? 'join' : 'home');
  const [name, setName] = useState(() => stored('fgo-name', ''));
  const [avatar, setAvatar] = useState(() => stored('fgo-avatar', AVATARS[Math.floor(Math.random() * AVATARS.length)]));
  const [code, setCode] = useState(urlCode);
  const [busy, setBusy] = useState(false);

  const ready = name.trim().length > 0 && status === 'open';

  const go = (kind: 'create' | 'join') => {
    if (!ready || busy) return;
    store('fgo-name', name.trim());
    store('fgo-avatar', avatar);
    sfx.join();
    setBusy(true);
    setTimeout(() => setBusy(false), 2000);
    if (kind === 'create') send({ t: 'create', name, avatar });
    else send({ t: 'join', code, name, avatar });
  };

  const cycleAvatar = () => {
    sfx.click();
    setAvatar(AVATARS[(AVATARS.indexOf(avatar) + 1) % AVATARS.length]);
  };

  return (
    <Screen className="justify-center gap-6 py-6">
      <div className="absolute top-4 right-4 safe-pt">
        <MuteButton />
      </div>

      <div className="text-center">
        <motion.div
          className="mb-3 flex justify-center gap-2 text-4xl"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          {GAME_IDS.map((g) => (
            <motion.span
              key={g}
              variants={{ hidden: { y: -40, opacity: 0, rotate: -30 }, show: { y: 0, opacity: 1, rotate: 0 } }}
              transition={{ type: 'spring', stiffness: 400, damping: 12 }}
            >
              <motion.span
                className="inline-block"
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, delay: GAME_IDS.indexOf(g) * 0.15 }}
              >
                {GAME_META[g].emoji}
              </motion.span>
            </motion.span>
          ))}
        </motion.div>
        <motion.h1
          initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
          animate={{ scale: 1, opacity: 1, rotate: -3 }}
          transition={{ type: 'spring', stiffness: 200, damping: 10, delay: 0.2 }}
          className="title-xl text-6xl sm:text-7xl"
        >
          <span className="text-gradient bg-gradient-to-br from-sun via-hot to-grape">FRIEND</span>
          <br />
          <span className="text-gradient bg-gradient-to-br from-ice via-lime to-sun">GROUP</span>
          <br />
          <span className="text-white">OLYMPICS</span>
        </motion.h1>
        <p className="mt-3 font-bold text-white/70">5 chaotic mini-games. 1 group chat champion.</p>
      </div>

      {kicked && <div className="card px-4 py-3 text-center font-bold text-hot">The host removed you from that room 💔</div>}

      <div className="card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <button
            onClick={cycleAvatar}
            aria-label="Change avatar"
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/10 text-4xl transition active:scale-90"
          >
            <motion.span key={avatar} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }}>
              {avatar}
            </motion.span>
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            placeholder="Your name"
            maxLength={16}
            autoComplete="nickname"
            enterKeyHint="go"
            onKeyDown={(e) => e.key === 'Enter' && go(mode === 'join' ? 'join' : 'create')}
            className="min-w-0 flex-1 rounded-2xl border-2 border-white/15 bg-black/30 px-4 py-4 text-xl font-bold outline-none placeholder:text-white/35 focus:border-sun"
          />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {mode === 'home' ? (
            <motion.div key="home" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex flex-col gap-3">
              <button className="btn btn-hot text-2xl" disabled={!ready || busy} onClick={() => go('create')}>
                🏟️ Create room
              </button>
              <button className="btn btn-ice text-2xl" disabled={status !== 'open'} onClick={() => (sfx.click(), setMode('join'))}>
                🎟️ Join room
              </button>
            </motion.div>
          ) : (
            <motion.div key="join" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-3">
              <input
                value={code}
                onChange={(e) =>
                  setCode(
                    [...e.target.value.toUpperCase()]
                      .filter((c) => CODE_ALPHABET.includes(c))
                      .join('')
                      .slice(0, CODE_LENGTH),
                  )
                }
                placeholder="CODE"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={(e) => e.key === 'Enter' && go('join')}
                className="w-full rounded-2xl border-2 border-white/15 bg-black/30 px-4 py-4 text-center font-display text-4xl tracking-[0.3em] outline-none placeholder:text-white/25 focus:border-ice"
              />
              <button className="btn btn-ice text-2xl" disabled={!ready || code.length !== CODE_LENGTH || busy} onClick={() => go('join')}>
                Let me in →
              </button>
              <button className="text-sm font-bold text-white/60 underline" onClick={() => setMode('home')}>
                back
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {status !== 'open' && <p className="text-center text-sm font-bold text-white/60 animate-pulse">Connecting to the arena…</p>}
    </Screen>
  );
}
