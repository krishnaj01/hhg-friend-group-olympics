import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { BombView } from '../../../shared/protocol';
import { Avatar, PlayerName, usePlayer } from '../components/ui';
import { buzz, shake } from '../lib/fx';
import { onGameEvent, send, useNet } from '../lib/net';
import { sfx } from '../lib/sound';

export function Bomb({ view }: { view: BombView }) {
  const { room, session } = useNet();
  const me = session?.playerId;
  const iHold = view.holderId === me;
  const iAmOut = !!me && view.eliminated.includes(me);
  const heatRef = useRef(view.heat);
  heatRef.current = view.heat;

  // Ticking speeds up with heat.
  useEffect(() => {
    if (view.stage !== 'fuse') return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      const h = heatRef.current;
      sfx.fuse(h);
      t = setTimeout(loop, 650 - h * 520);
    };
    loop();
    return () => clearTimeout(t);
  }, [view.stage, view.round]);

  useEffect(
    () =>
      onGameEvent((name) => {
        if (name === 'incoming') {
          sfx.alarm();
          buzz([100, 50, 100]);
          shake();
        } else if (name === 'solved') sfx.correct();
      }),
    [],
  );

  // Players in a circle; the bomb flies to whoever holds it.
  const ids = view.alive.concat(view.eliminated);
  const pos = (i: number) => {
    const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + 38 * Math.cos(a), y: 50 + 38 * Math.sin(a) };
  };
  const holderIdx = view.holderId ? ids.indexOf(view.holderId) : -1;
  const seat = holderIdx >= 0 ? pos(holderIdx) : { x: 50, y: 50 };
  const bombAt = { x: 50 + (seat.x - 50) * 0.55, y: 50 + (seat.y - 50) * 0.55 };
  const pulse = 0.9 - view.heat * 0.7;

  return (
    <div className={`flex flex-1 flex-col gap-3 rounded-[2rem] ${iHold ? 'bg-red-600/25' : ''}`}>
      <div className="flex items-center justify-between font-display text-white/70">
        <span>
          ROUND {Math.min(view.round + 1, view.rounds)}/{view.rounds}
        </span>
        <span>{view.alive.length} alive</span>
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-sm">
        {/* fuse ring */}
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        {ids.map((id, i) => (
          <Seat key={id} id={id} x={pos(i).x} y={pos(i).y} out={view.eliminated.includes(id)} holder={id === view.holderId} me={id === me} />
        ))}
        {view.stage === 'fuse' && (
          <motion.div
            className="pointer-events-none absolute text-5xl"
            animate={{ left: `${bombAt.x}%`, top: `${bombAt.y}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 12 }}
            style={{ translate: '-50% -50%' }}
          >
            <motion.div animate={{ scale: [1, 1.25, 1], rotate: [-8, 8, -8] }} transition={{ repeat: Infinity, duration: pulse }}>
              💣
            </motion.div>
          </motion.div>
        )}
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-28 text-center">
            <div className="h-3 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full"
                style={{ width: `${view.heat * 100}%`, background: `linear-gradient(90deg,#ffb800,#ff3d7f ${100 - view.heat * 40}%,#ff0000)` }}
              />
            </div>
            <div className="mt-1 font-display text-xs text-white/60">{view.heat > 0.7 ? '🔥 CRITICAL' : view.heat > 0.4 ? 'HEATING UP' : 'FUSE LIT'}</div>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view.stage === 'boom' || view.stage === 'over' ? (
          <Boom key={`boom-${view.round}`} victim={view.explodedId} isMe={view.explodedId === me} />
        ) : iHold ? (
          <motion.div key="hold" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col gap-3">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: pulse }}
              className="text-center font-display text-3xl text-hot"
            >
              {view.canThrow ? 'THROW IT!' : 'YOU HAVE THE BOMB!'}
            </motion.div>
            {view.challenge && (
              <>
                <div className="text-center font-display text-3xl">{view.challenge.prompt}</div>
                <div className="grid grid-cols-4 gap-2">
                  {view.challenge.options.map((o, i) => (
                    <motion.button
                      key={`${view.challenge!.prompt}-${o}-${i}`}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: i * 0.04 }}
                      data-choice={i}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => send({ t: 'input', data: { choice: i } })}
                      className="btn btn-ghost h-16 px-0 text-2xl"
                    >
                      {o}
                    </motion.button>
                  ))}
                </div>
              </>
            )}
            {view.canThrow && (
              <div className="grid grid-cols-2 gap-2">
                {view.alive
                  .filter((id) => id !== me)
                  .map((id) => (
                    <ThrowButton key={id} id={id} />
                  ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="watch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-4 text-center">
            <div className="font-display text-2xl">
              {view.holderId ? <PlayerName id={view.holderId} /> : '???'} has the bomb
            </div>
            <div className="mt-1 font-bold text-white/60">
              {iAmOut ? '💀 You exploded. Enjoy the chaos.' : 'Pray it stays over there…'}
            </div>
            {view.lastThrow && room && (
              <div className="mt-2 text-sm font-bold text-white/50">
                <PlayerName id={view.lastThrow.from} /> → <PlayerName id={view.lastThrow.to} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Seat({ id, x, y, out, holder, me }: { id: string; x: number; y: number; out: boolean; holder: boolean; me: boolean }) {
  const p = usePlayer(id);
  if (!p) return null;
  return (
    <motion.div
      className="absolute flex w-20 flex-col items-center"
      style={{ left: `${x}%`, top: `${y}%`, translate: '-50% -50%' }}
      animate={holder ? { scale: [1, 1.1, 1] } : { scale: 1 }}
      transition={{ repeat: holder ? Infinity : 0, duration: 0.5 }}
    >
      <div className={out ? 'opacity-40 grayscale' : ''}>
        <Avatar player={p} size={46} ring={me} />
      </div>
      <span className="max-w-full truncate text-xs font-bold" style={{ color: p.color }}>
        {out ? '💀 ' : ''}
        {p.name}
      </span>
    </motion.div>
  );
}

function ThrowButton({ id }: { id: string }) {
  const p = usePlayer(id);
  if (!p) return null;
  return (
    <motion.button
      data-throw
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      whileTap={{ scale: 0.9 }}
      onClick={() => {
        sfx.whoosh();
        send({ t: 'input', data: { throwTo: id } });
      }}
      className="btn btn-hot flex-col gap-1 py-3 text-base"
      style={{ ['--btn-bg' as string]: p.color }}
    >
      <span className="text-3xl">{p.avatar}</span>
      <span className="max-w-full truncate text-ink">{p.name}</span>
    </motion.button>
  );
}

function Boom({ victim, isMe }: { victim: string | null; isMe: boolean }) {
  const p = usePlayer(victim);
  return (
    <motion.div
      initial={{ scale: 0.2, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 10 }}
      className="text-center"
    >
      <motion.div animate={{ scale: [1, 1.4, 1.2], rotate: [0, 10, -5] }} transition={{ duration: 0.6 }} className="text-8xl">
        💥
      </motion.div>
      <div className="title-xl text-6xl text-sun">KABOOM!</div>
      <div className="mt-2 font-display text-2xl">
        {isMe ? 'YOU EXPLODED 💀' : p ? <><span style={{ color: p.color }}>{p.name}</span> is toast</> : ''}
      </div>
    </motion.div>
  );
}
