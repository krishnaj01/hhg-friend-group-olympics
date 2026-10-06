import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { GAME_META } from '../../../shared/games';
import { Avatar, Screen, TimerBar, usePlayer } from '../components/ui';
import { buzz, confettiBurst } from '../lib/fx';
import { send, useMe, useNet } from '../lib/net';
import { sfx } from '../lib/sound';
import type { ResultRow } from '../../../shared/protocol';

export function CountUp({ from, to, duration = 900, delay = 0 }: { from: number; to: number; duration?: number; delay?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const loop = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - start) / duration));
      const eased = 1 - (1 - k) ** 3;
      setV(Math.round(from + (to - from) * eased));
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [from, to, duration, delay]);
  return <>{v.toLocaleString()}</>;
}

const MEDAL = ['🥇', '🥈', '🥉'];

function Row({ row, revealed, isMe, index }: { row: ResultRow; revealed: boolean; isMe: boolean; index: number }) {
  const p = usePlayer(row.playerId);
  if (!p) return null;
  const delta = row.prevRank - row.rank;
  const rank = revealed ? row.rank : row.prevRank;
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      initial={{ x: -60, opacity: 0 }}
      animate={{ x: 0, opacity: 1, transition: { delay: index * 0.06 } }}
      className={`flex items-center gap-3 rounded-2xl p-3 ${isMe ? 'bg-white/20 ring-2 ring-sun' : 'bg-white/8'}`}
    >
      <div className="w-8 text-center font-display text-xl">{rank <= 3 ? MEDAL[rank - 1] : rank}</div>
      <Avatar player={p} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold" style={{ color: p.color }}>
          {p.name}
        </div>
        {row.highlight && <div className="truncate text-xs font-bold text-white/60">{row.highlight}</div>}
      </div>
      <div className="text-right">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3 + index * 0.08, type: 'spring', stiffness: 500, damping: 12 }}
          className={`font-display text-sm ${row.gained > 0 ? 'text-lime' : 'text-white/50'}`}
        >
          +{row.gained}
        </motion.div>
        <div className="font-display text-xl">
          <CountUp from={row.total - row.gained} to={revealed ? row.total : row.total - row.gained} />
        </div>
      </div>
      <div className="w-8 text-center font-display text-sm">
        {revealed && delta !== 0 && (
          <motion.span
            initial={{ scale: 0, y: delta > 0 ? 10 : -10 }}
            animate={{ scale: 1, y: 0 }}
            className={delta > 0 ? 'text-lime' : 'text-hot'}
          >
            {delta > 0 ? `▲${delta}` : `▼${-delta}`}
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}

export function Results() {
  const { room, session } = useNet();
  const me = useMe();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    sfx.drumroll(1.3);
    const t = setTimeout(() => {
      setRevealed(true);
      const mine = room?.results?.rows.find((r) => r.playerId === session?.playerId);
      if (mine && mine.rank === 1) {
        sfx.fanfare();
        confettiBurst(0.8);
        buzz([50, 50, 120]);
      } else if (mine && mine.rank < mine.prevRank) sfx.rankUp();
      else sfx.correct();
    }, 1400);
    return () => clearTimeout(t);
    // run once per results screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!room?.results) return null;
  const meta = GAME_META[room.results.gameId];
  const last = room.gameIndex + 1 >= room.settings.rounds;
  const upcoming = room.playlist[room.gameIndex + 1];
  const nextLabel = last
    ? '🏆 Final podium next…'
    : room.settings.order === 'vote'
      ? '🗳️ Next: you vote on the game!'
      : upcoming
        ? `Next: ${GAME_META[upcoming].emoji} ${GAME_META[upcoming].name}`
        : 'Next: 🎲 mystery game…';
  const rows = [...room.results.rows].sort((a, b) =>
    revealed ? a.rank - b.rank || b.gained - a.gained : a.prevRank - b.prevRank || a.total - a.gained - (b.total - b.gained),
  );
  const topGain = room.results.rows.reduce((a, b) => (b.gained > a.gained ? b : a), room.results.rows[0]);

  return (
    <Screen className="gap-4 py-2">
      <div className="text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1, rotate: [0, -10, 10, 0] }} className="text-5xl">
          {meta.emoji}
        </motion.div>
        <h1 className={`title-xl text-gradient bg-gradient-to-r text-4xl ${meta.gradient}`}>{meta.name.toUpperCase()}</h1>
        <p className="font-display text-lg text-white/70">{revealed ? 'LEADERBOARD' : 'TALLYING…'}</p>
        {room.results.endedEarly && (
          <span className="mt-1 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-black tracking-wide">⏹ ENDED EARLY BY HOST</span>
        )}
      </div>

      {revealed && topGain && topGain.gained > 0 && (
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="card px-4 py-2 text-center text-sm font-bold"
        >
          🔥 Round MVP: <MvpName id={topGain.playerId} /> with +{topGain.gained}
        </motion.div>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <Row key={r.playerId} row={r} revealed={revealed} isMe={r.playerId === me?.id} index={i} />
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <p className="text-center font-display text-white/70">{nextLabel}</p>
        {room.phaseEndsAt && room.phaseMs && <TimerBar endsAt={room.phaseEndsAt} total={room.phaseMs} color="#00e0ff" />}
        {me?.isHost && (
          <button className="btn btn-ice text-xl" onClick={() => send({ t: 'next' })}>
            {last ? 'Reveal podium 🏆' : room.settings.order === 'vote' ? 'Open the vote 🗳️' : 'Next game →'}
          </button>
        )}
      </div>
    </Screen>
  );
}

function MvpName({ id }: { id: string }) {
  const p = usePlayer(id);
  return <span style={{ color: p?.color }}>{p?.name ?? '???'}</span>;
}
