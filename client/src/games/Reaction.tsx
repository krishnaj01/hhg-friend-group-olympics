import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactionView } from '../../../shared/protocol';
import { Avatar, usePlayer } from '../components/ui';
import { buzz, shake } from '../lib/fx';
import { send } from '../lib/net';
import { sfx } from '../lib/sound';

// Stage swaps must be instant: decoys last under a second and GO must never lag its green background.
const QUICK_EXIT = { opacity: 0, transition: { duration: 0.04 } };

export function Reaction({ view }: { view: ReactionView }) {
  // Reaction time is measured locally from the frame GO was painted, so
  // network latency doesn't decide the winner. The server bounds it.
  const goSeen = useRef<number | null>(null);
  const [localTap, setLocalTap] = useState<string | null>(null);
  const roundKey = `${view.round}`;
  const lastRound = useRef(roundKey);

  useLayoutEffect(() => {
    if (lastRound.current !== roundKey) {
      lastRound.current = roundKey;
      setLocalTap(null);
    }
    if (view.stage === 'go') {
      if (goSeen.current === null) goSeen.current = performance.now();
    } else goSeen.current = null;
  }, [view.stage, roundKey]);

  const tap = () => {
    if (view.myResult || localTap || view.stage === 'reveal') return;
    if (view.stage === 'wait' || goSeen.current === null) {
      setLocalTap(roundKey);
      sfx.buzzer();
      shake();
      buzz(200);
      send({ t: 'input', data: { tap: true } });
    } else {
      const ms = performance.now() - goSeen.current;
      setLocalTap(roundKey);
      sfx.hit();
      buzz(30);
      send({ t: 'input', data: { tap: true, reactionMs: ms } });
    }
  };

  const mine = view.myResult;
  const bg =
    view.stage === 'reveal'
      ? 'bg-grape/30'
      : mine?.falseStart
        ? 'bg-red-700'
        : view.stage === 'go'
          ? 'bg-lime'
          : view.stage === 'fake'
            ? 'bg-gradient-to-b from-sun to-orange-600'
            : 'bg-gradient-to-b from-rose-700 to-red-950';

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between font-display">
        <span className="text-white/70">
          ROUND {view.round + 1}/{view.rounds}
        </span>
        <div className="flex -space-x-2">
          {view.done.map((id) => (
            <DoneChip key={id} id={id} />
          ))}
        </div>
      </div>

      {view.stage !== 'reveal' ? (
        <motion.button
          data-tap
          onPointerDown={tap}
          className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-[2rem] ${bg} shadow-2xl transition-colors duration-75`}
          style={{ minHeight: '60vh', touchAction: 'none' }}
        >
          <AnimatePresence mode="popLayout">
            {mine ? (
              <motion.div key="res" initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
                {mine.falseStart ? (
                  <>
                    <div className="text-7xl">💀</div>
                    <div className="title-xl text-5xl">TOO SOON!</div>
                    <div className="mt-2 font-display text-2xl text-white/80">−100</div>
                  </>
                ) : (
                  <>
                    <div className="title-xl text-8xl text-ink" style={{ textShadow: 'none' }}>
                      {mine.ms}
                      <span className="text-4xl">ms</span>
                    </div>
                    <div className="mt-2 font-display text-xl text-ink/70">waiting for others…</div>
                  </>
                )}
              </motion.div>
            ) : view.stage === 'fake' ? (
              <motion.div key="fake" initial={{ scale: 0.3, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} exit={QUICK_EXIT} className="text-center">
                <div className="text-7xl">😈</div>
                <div className="title-xl text-6xl text-ink" style={{ textShadow: 'none' }}>
                  NOT YET
                </div>
                <div className="mt-2 font-bold text-ink/70">it's a trap</div>
              </motion.div>
            ) : view.stage === 'go' ? (
              <motion.div key="go" initial={{ scale: 0.3 }} animate={{ scale: 1 }} exit={QUICK_EXIT} transition={{ type: 'spring', stiffness: 600, damping: 12 }}>
                <div className="title-xl text-[9rem] text-ink" style={{ textShadow: 'none' }}>
                  TAP!
                </div>
              </motion.div>
            ) : (
              <motion.div key="wait" animate={{ opacity: [0.6, 1, 0.6] }} exit={QUICK_EXIT} transition={{ repeat: Infinity, duration: 1.4 }} className="text-center">
                <div className="text-7xl">✋</div>
                <div className="title-xl text-5xl">WAIT…</div>
                <div className="mt-3 font-bold text-white/70">for green</div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <h2 className="text-center font-display text-3xl">ROUND {view.round + 1} RESULTS</h2>
          {view.roundResults.map((r, i) => (
            <RoundRow key={r.playerId} i={i} {...r} />
          ))}
        </div>
      )}
    </div>
  );
}

function DoneChip({ id }: { id: string }) {
  const p = usePlayer(id);
  if (!p) return null;
  return (
    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
      <Avatar player={p} size={30} />
    </motion.div>
  );
}

function RoundRow({ i, playerId, ms, falseStart, points }: { i: number; playerId: string; ms: number | null; falseStart: boolean; points: number }) {
  const p = usePlayer(playerId);
  if (!p) return null;
  return (
    <motion.div
      initial={{ x: 80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: i * 0.12 }}
      className={`flex items-center gap-3 rounded-2xl p-3 ${i === 0 && ms ? 'bg-sun/30 ring-2 ring-sun' : 'bg-white/8'}`}
    >
      <span className="w-7 font-display text-xl">{i === 0 && ms ? '⚡' : i + 1}</span>
      <Avatar player={p} size={38} />
      <span className="flex-1 truncate font-bold" style={{ color: p.color }}>
        {p.name}
      </span>
      <span className="font-display text-lg">{falseStart ? '💀 early' : ms ? `${ms}ms` : '💤'}</span>
      <span className={`w-14 text-right font-display ${points >= 0 ? 'text-lime' : 'text-hot'}`}>
        {points >= 0 ? '+' : ''}
        {points}
      </span>
    </motion.div>
  );
}
