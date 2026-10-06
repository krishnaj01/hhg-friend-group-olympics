import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { GAME_META } from '../../../shared/games';
import { Screen, TimerBar } from '../components/ui';
import { buzz, useOnChange, useSecondsLeft } from '../lib/fx';
import { currentGame, send, useMe, useNet } from '../lib/net';
import { sfx } from '../lib/sound';

export function Intro() {
  const { room } = useNet();
  const me = useMe();
  useEffect(() => sfx.whoosh(), []);
  if (!room) return null;
  const meta = GAME_META[currentGame(room)!];
  return (
    <Screen className="justify-center gap-6 py-4 text-center">
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-display text-lg tracking-widest text-white/60">
        GAME {room.gameIndex + 1} OF {room.settings.rounds}
      </motion.p>
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 12 }}
        className={`mx-auto grid h-36 w-36 place-items-center rounded-[2.5rem] bg-gradient-to-br text-8xl shadow-2xl ${meta.gradient}`}
      >
        {meta.emoji}
      </motion.div>
      <motion.h1
        initial={{ y: 60, opacity: 0, skewY: 8 }}
        animate={{ y: 0, opacity: 1, skewY: -3 }}
        transition={{ delay: 0.25, type: 'spring', stiffness: 220, damping: 14 }}
        className={`title-xl text-gradient bg-gradient-to-r text-[min(11vw,3.75rem)] ${meta.gradient}`}
      >
        {meta.name.toUpperCase()}
      </motion.h1>
      <p className="text-xl font-bold text-white/80">{meta.tagline}</p>
      <div className="card flex flex-col gap-2 p-4 text-left">
        {meta.howTo.map((h, i) => (
          <motion.div
            key={h}
            initial={{ x: -40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.6 + i * 0.25 }}
            className="flex items-center gap-3 text-lg font-bold"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sun font-display text-ink">{i + 1}</span>
            {h}
          </motion.div>
        ))}
      </div>
      {room.phaseEndsAt && room.phaseMs && <TimerBar endsAt={room.phaseEndsAt} total={room.phaseMs} />}
      {me?.isHost && (
        <button className="btn btn-ghost text-lg" onClick={() => send({ t: 'next' })}>
          Skip ⏭
        </button>
      )}
    </Screen>
  );
}

export function Countdown() {
  const { room } = useNet();
  const left = useSecondsLeft(room?.phaseEndsAt);
  const n = Math.min(3, left);
  useOnChange(
    n,
    (v) => {
      if (v > 0) {
        sfx.beep();
        buzz(40);
      }
    },
    true,
  );
  if (!room) return null;
  const meta = GAME_META[currentGame(room)!];
  return (
    <Screen className="items-center justify-center">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={n}
          initial={{ scale: 3, opacity: 0, rotate: -20 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.2, opacity: 0, rotate: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          className={`title-xl text-gradient bg-gradient-to-b text-[12rem] ${meta.gradient}`}
        >
          {n > 0 ? n : 'GO!'}
        </motion.div>
      </AnimatePresence>
      <p className="mt-4 font-display text-xl text-white/70">
        {meta.emoji} {meta.name}
      </p>
    </Screen>
  );
}
