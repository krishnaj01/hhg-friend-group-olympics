import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Avatar, Screen, usePlayer } from '../components/ui';
import { buzz, confettiBurst, confettiRain, shake } from '../lib/fx';
import { leaveRoom, send, useMe, useNet } from '../lib/net';
import { sfx } from '../lib/sound';
import { CountUp } from './Results';

const STEP_MS = [1800, 1300, 1300, 2200, 900]; // drumroll, 3rd, 2nd, 1st, awards...

function Pillar({ playerId, total, place, show }: { playerId: string; total: number; place: 1 | 2 | 3; show: boolean }) {
  const p = usePlayer(playerId);
  const h = { 1: 'h-40', 2: 'h-28', 3: 'h-20' }[place];
  const grad = { 1: 'from-sun to-orange-600', 2: 'from-slate-200 to-slate-500', 3: 'from-orange-300 to-amber-800' }[place];
  return (
    <div className="flex w-1/3 flex-col items-center justify-end">
      <AnimatePresence>
        {show && p && (
          <motion.div
            initial={{ y: -300, opacity: 0, scale: 0.5 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14 }}
            className="mb-2 flex flex-col items-center gap-1"
          >
            {place === 1 && (
              <motion.div animate={{ rotate: [-8, 8, -8], y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 1.4 }} className="text-4xl">
                👑
              </motion.div>
            )}
            <Avatar player={p} size={place === 1 ? 76 : 58} ring={place === 1} />
            <div className="max-w-full truncate px-1 text-center font-display text-sm" style={{ color: p.color }}>
              {p.name}
            </div>
            <div className="font-display text-lg">
              <CountUp from={0} to={total} duration={1200} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.2 + (3 - place) * 0.1, type: 'spring', stiffness: 120, damping: 14 }}
        style={{ originY: 1 }}
        className={`w-full ${h} grid place-items-start justify-center rounded-t-2xl bg-gradient-to-b pt-2 font-display text-4xl text-ink/80 ${grad}`}
      >
        {place}
      </motion.div>
    </div>
  );
}

function AwardCard({ i, playerId, emoji, title, detail }: { i: number; playerId: string; emoji: string; title: string; detail: string }) {
  const p = usePlayer(playerId);
  return (
    <motion.div
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ delay: i * 0.45, type: 'spring', stiffness: 200, damping: 16 }}
      className="card flex flex-col items-center gap-1 p-3 text-center"
    >
      <div className="text-3xl">{emoji}</div>
      <div className="font-display text-xs tracking-wide text-sun">{title.toUpperCase()}</div>
      {p && <Avatar player={p} size={36} />}
      <div className="truncate font-bold" style={{ color: p?.color }}>
        {p?.name ?? '—'}
      </div>
      <div className="text-xs font-bold text-white/60">{detail}</div>
    </motion.div>
  );
}

export function Podium() {
  const { room } = useNet();
  const me = useMe();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step === 0) sfx.drumroll(1.7);
    if (step === 1 || step === 2) {
      sfx.whoosh();
      shake();
    }
    if (step === 3) {
      sfx.fanfare();
      shake('big');
      buzz([80, 60, 200]);
      confettiBurst(1.5);
      confettiRain(3500);
    }
    if (step === 4) room?.podium?.awards.forEach((_, i) => setTimeout(() => sfx.correct(), i * 450));
    if (step >= STEP_MS.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS[step]);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!room?.podium) return null;
  const { standings, awards } = room.podium;
  const [first, second, third] = standings;
  const rest = standings.slice(3);
  const myPlace = standings.find((s) => s.playerId === me?.id);

  return (
    <Screen className="gap-5 py-2">
      <div className="text-center">
        <motion.h1
          initial={{ scale: 0 }}
          animate={{ scale: 1, rotate: -3 }}
          transition={{ type: 'spring', stiffness: 200, damping: 10 }}
          className="title-xl text-gradient bg-gradient-to-r from-sun via-hot to-grape text-5xl"
        >
          {step < 3 ? 'AND THE WINNER IS…' : 'CHAMPIONS!'}
        </motion.h1>
      </div>

      <div className="flex items-end gap-2 px-2 pt-6">
        {second ? <Pillar playerId={second.playerId} total={second.total} place={2} show={step >= 2} /> : <div className="w-1/3" />}
        {first && <Pillar playerId={first.playerId} total={first.total} place={1} show={step >= 3} />}
        {third ? <Pillar playerId={third.playerId} total={third.total} place={3} show={step >= 1} /> : <div className="w-1/3" />}
      </div>

      {step >= 4 && myPlace && (
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center font-display text-lg">
          {myPlace.rank === 1 ? '🎉 You are the champion! 🎉' : `You finished #${myPlace.rank}`}
        </motion.p>
      )}

      {step >= 4 && awards.length > 0 && (
        <div>
          <h2 className="mb-2 text-center font-display text-xl">🏅 Special Awards</h2>
          <div className="grid grid-cols-2 gap-2" style={{ perspective: 800 }}>
            {awards.map((a, i) => (
              <AwardCard key={a.key} i={i} playerId={a.playerId} emoji={a.emoji} title={a.title} detail={a.detail} />
            ))}
          </div>
        </div>
      )}

      {step >= 5 && rest.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-1">
          {rest.map((s) => (
            <RestRow key={s.playerId} id={s.playerId} rank={s.rank} total={s.total} />
          ))}
        </motion.div>
      )}

      {step >= 5 && (
        <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-auto flex flex-col gap-2 pt-2">
          {me?.isHost ? (
            <button className="btn btn-lime text-2xl" onClick={() => send({ t: 'restart' })}>
              🔁 Play again
            </button>
          ) : (
            <p className="text-center font-bold text-white/60">Host can start a rematch</p>
          )}
          <button className="text-sm font-bold text-white/50 underline" onClick={leaveRoom}>
            Leave room
          </button>
        </motion.div>
      )}
    </Screen>
  );
}

function RestRow({ id, rank, total }: { id: string; rank: number; total: number }) {
  const p = usePlayer(id);
  if (!p) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
      <span className="w-6 font-display">{rank}</span>
      <Avatar player={p} size={30} />
      <span className="flex-1 truncate font-bold" style={{ color: p.color }}>
        {p.name}
      </span>
      <span className="font-display">{total.toLocaleString()}</span>
    </div>
  );
}
