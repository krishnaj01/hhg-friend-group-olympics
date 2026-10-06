import { AnimatePresence, motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { GAME_META } from '../../../shared/games';
import type { PlayerView } from '../../../shared/protocol';
import { useServerClock } from '../lib/fx';
import { currentGame, send, useMe, useNet } from '../lib/net';
import { isMuted, setMuted, sfx } from '../lib/sound';

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="blob" style={{ background: '#ff3d7f', top: '-20%', left: '-20%' }} />
      <div className="blob" style={{ background: '#00e0ff', bottom: '-30%', right: '-25%', animationDelay: '-6s' }} />
      <div className="blob" style={{ background: '#b46bff', top: '30%', left: '30%', animationDelay: '-12s', opacity: 0.3 }} />
      <div className="grid" />
    </div>
  );
}

export function Avatar({ player, size = 48, ring = false }: { player: Pick<PlayerView, 'avatar' | 'color' | 'connected'>; size?: number; ring?: boolean }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: `radial-gradient(circle at 30% 30%, ${player.color}, ${player.color}88)`,
        boxShadow: ring ? `0 0 0 3px #14002e, 0 0 0 6px ${player.color}, 0 0 24px ${player.color}` : `0 3px 0 rgba(0,0,0,.35)`,
        opacity: player.connected ? 1 : 0.35,
        filter: player.connected ? undefined : 'grayscale(1)',
      }}
    >
      <span className="leading-none">{player.avatar}</span>
      {!player.connected && <span className="absolute -right-1 -bottom-1 text-xs">📡</span>}
    </div>
  );
}

/** Shrinking bar between `startsAt` and `endsAt` (server ms). */
export function TimerBar({ endsAt, total, color = '#ffb800' }: { endsAt: number; total: number; color?: string }) {
  const now = useServerClock();
  const frac = Math.max(0, Math.min(1, (endsAt - now) / total));
  const urgent = frac < 0.25;
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full"
        style={{ width: `${frac * 100}%`, background: urgent ? '#ff3d7f' : color, transition: 'background 200ms' }}
      />
    </div>
  );
}

export function MuteButton() {
  const [m, setM] = useState(isMuted());
  return (
    <button
      aria-label={m ? 'Unmute' : 'Mute'}
      className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-lg active:scale-90"
      onClick={() => {
        setMuted(!m);
        setM(!m);
        if (m) sfx.click();
      }}
    >
      {m ? '🔇' : '🔊'}
    </button>
  );
}

/** Persistent top strip during a show: room code, progress, my score. */
export function Hud() {
  const { room } = useNet();
  const me = useMe();
  if (!room) return null;
  const inShow = room.phase !== 'lobby' && room.phase !== 'podium';
  const gameId = currentGame(room);
  const rounds = room.settings.rounds;
  return (
    <div className="safe-pt relative z-20 flex items-center gap-2 px-4 pb-2">
      <div className="rounded-xl bg-white/10 px-3 py-1.5 font-display text-sm tracking-widest">{room.code}</div>
      {inShow && gameId && rounds <= 6 && (
        <div className="flex items-center gap-1">
          {Array.from({ length: rounds }, (_, i) => {
            const g = room.playlist[i];
            return (
              <div
                key={i}
                title={g ? GAME_META[g].name : 'Coming up'}
                className={`grid h-7 w-7 place-items-center rounded-lg text-sm transition ${
                  i === room.gameIndex ? 'scale-110 bg-sun' : i < room.gameIndex ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                {g ? GAME_META[g].emoji : room.settings.order === 'vote' ? '🗳️' : '❔'}
              </div>
            );
          })}
        </div>
      )}
      {inShow && gameId && rounds > 6 && (
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1 font-display text-sm">
          <span>{GAME_META[gameId].emoji}</span>
          <span>
            {Math.min(room.gameIndex + 1, rounds)}/{rounds}
          </span>
        </div>
      )}
      <div className="flex-1" />
      {me && inShow && (
        <motion.div key={me.score} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="font-display text-lg text-sun">
          {me.score.toLocaleString()}
        </motion.div>
      )}
      {me?.isHost && inShow && <HostMenu />}
      <MuteButton />
    </div>
  );
}

/** Host-only controls to cut a game or the whole show short. */
function HostMenu() {
  const { room } = useNet();
  const [open, setOpen] = useState(false);
  if (!room) return null;
  const playing = room.phase === 'playing';
  const act = (t: 'endGame' | 'endShow') => {
    sfx.click();
    send({ t });
    setOpen(false);
  };
  return (
    <>
      <button
        aria-label="Host controls"
        className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-lg active:scale-90"
        onClick={() => (sfx.click(), setOpen(true))}
      >
        ⏹
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="host-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 safe-pb"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 200 }}
              animate={{ y: 0 }}
              exit={{ y: 200 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="card flex w-full max-w-md flex-col gap-3 bg-ink/95 p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-center font-display text-2xl">Host controls</h2>
              {playing && (
                <button data-end-game className="btn btn-ice flex-col gap-0 py-3 text-lg" onClick={() => act('endGame')}>
                  ⏭ End this game now
                  <span className="font-sans text-xs font-bold text-ink/70">Points earned so far count · show continues</span>
                </button>
              )}
              <button data-end-show className="btn btn-hot flex-col gap-0 py-3 text-lg" onClick={() => act('endShow')}>
                🏁 End the show
                <span className="font-sans text-xs font-bold text-white/80">Skip to the podium with current scores</span>
              </button>
              <button className="btn btn-ghost py-3 text-base" onClick={() => setOpen(false)}>
                Keep playing
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -30, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className={`mx-auto flex w-full max-w-md flex-1 flex-col px-4 safe-pb ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function usePlayer(id: string | null | undefined) {
  const { room } = useNet();
  return room?.players.find((p) => p.id === id) ?? null;
}

export function PlayerName({ id }: { id: string }) {
  const p = usePlayer(id);
  if (!p) return <span className="opacity-60">someone</span>;
  return <span style={{ color: p.color }}>{p.name}</span>;
}
