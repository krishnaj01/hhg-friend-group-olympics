import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { GAME_META, type GameId } from '../../../shared/games';
import { Avatar, Screen, TimerBar, usePlayer } from '../components/ui';
import { buzz, confettiBurst, useOnChange, useSecondsLeft } from '../lib/fx';
import { send, useMe, useNet } from '../lib/net';
import { sfx } from '../lib/sound';

export function Vote() {
  const { room } = useNet();
  const me = useMe();
  const vote = room?.vote;
  const secs = useSecondsLeft(room?.phaseEndsAt);

  useEffect(() => sfx.whoosh(), []);
  useOnChange(vote?.winner ?? null, (w) => {
    if (!w) return;
    sfx.fanfare();
    buzz([60, 40, 120]);
    confettiBurst(0.6);
  });
  const voteCount = vote ? Object.keys(vote.votes).length : 0;
  useOnChange(voteCount, (n, prev) => {
    if (prev !== undefined && n > prev) sfx.click();
  });

  if (!room || !vote || !me) return null;
  const myVote = vote.votes[me.id];
  const voters = (g: GameId) => Object.entries(vote.votes).filter(([, v]) => v === g).map(([pid]) => pid);
  const connected = room.players.filter((p) => p.connected).length;
  const decided = !!vote.winner;

  return (
    <Screen className="gap-4 py-2">
      <div className="text-center">
        <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} className="text-5xl">
          🗳️
        </motion.div>
        <h1 className="title-xl text-gradient bg-gradient-to-r from-sun via-hot to-grape text-5xl">
          {decided ? 'THE PEOPLE HAVE SPOKEN' : 'VOTE NEXT GAME'}
        </h1>
        <p className="mt-1 font-display text-white/70">
          GAME {room.gameIndex + 2} OF {room.settings.rounds}
          {!decided && ` · ${voteCount}/${connected} voted · ${secs}s`}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <AnimatePresence>
          {vote.options.map((g, i) => {
            const meta = GAME_META[g];
            const ids = voters(g);
            const winner = vote.winner === g;
            const mine = myVote === g;
            if (decided && !winner) {
              return (
                <motion.div key={g} exit={{ opacity: 0 }} animate={{ opacity: 0.25, scale: 0.95 }} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
                  <span className="text-2xl grayscale">{meta.emoji}</span>
                  <span className="flex-1 font-display text-white/60">{meta.name}</span>
                  <span className="font-display text-white/60">{ids.length}</span>
                </motion.div>
              );
            }
            return (
              <motion.button
                key={g}
                layout
                initial={{ x: i % 2 ? 80 : -80, opacity: 0 }}
                animate={winner ? { x: 0, opacity: 1, scale: [1, 1.08, 1.03] } : { x: 0, opacity: 1, scale: 1 }}
                transition={{ delay: decided ? 0 : i * 0.06, type: 'spring', stiffness: 300, damping: 18 }}
                whileTap={decided ? undefined : { scale: 0.95 }}
                disabled={decided}
                data-vote={g}
                onClick={() => {
                  sfx.click();
                  buzz(20);
                  send({ t: 'vote', gameId: g });
                }}
                className={`relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r p-4 text-left shadow-lg ${meta.gradient} ${
                  mine || winner ? 'ring-4 ring-white' : myVote ? 'opacity-70' : ''
                } ${winner ? 'py-6' : ''}`}
              >
                <span className={winner ? 'text-6xl' : 'text-4xl'}>{meta.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-xl leading-tight text-ink">{meta.name}</span>
                  <span className="block truncate text-sm font-bold text-ink/70">{meta.tagline}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="font-display text-2xl text-ink">{ids.length}</span>
                  <span className="flex -space-x-2">
                    {ids.slice(0, 5).map((pid) => (
                      <Voter key={pid} id={pid} />
                    ))}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {decided && (
        <motion.p initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center font-display text-xl">
          {vote.tieBreak ? '🪙 Tie! The coin flip decided.' : voteCount ? '🎉 Majority rules!' : '🎲 Nobody voted — random pick!'}
        </motion.p>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {!decided && <p className="text-center font-bold text-white/60">{myVote ? 'Tap another game to switch your vote' : 'Tap a game to vote'}</p>}
        {room.phaseEndsAt && room.phaseMs && <TimerBar endsAt={room.phaseEndsAt} total={room.phaseMs} color="#b46bff" />}
        {me.isHost && !decided && (
          <button className="btn btn-ghost text-lg" onClick={() => send({ t: 'next' })}>
            Close voting ⏭
          </button>
        )}
      </div>
    </Screen>
  );
}

function Voter({ id }: { id: string }) {
  const p = usePlayer(id);
  if (!p) return null;
  return (
    <motion.div initial={{ scale: 0, y: -10 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }}>
      <Avatar player={p} size={24} />
    </motion.div>
  );
}
