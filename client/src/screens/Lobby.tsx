import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { GAME_IDS, GAME_META, type GameId } from '../../../shared/games';
import { AVATARS, MAX_PLAYERS } from '../../../shared/protocol';
import { HouseQuestions, SettingsCard } from '../components/LobbySettings';
import { Avatar, Screen } from '../components/ui';
import { useOnChange } from '../lib/fx';
import { leaveRoom, send, useMe, useNet } from '../lib/net';
import { sfx } from '../lib/sound';

export function Lobby() {
  const { room, host } = useNet();
  const me = useMe();
  const [copied, setCopied] = useState(false);
  useOnChange(room?.players.length ?? 0, (n, prev) => {
    if (prev !== undefined && n > prev) sfx.join();
  });
  if (!room || !me) return null;
  const isHost = me.isHost;
  const link = `${location.origin}/${room.code}`;

  const share = async () => {
    sfx.click();
    try {
      if (navigator.share) await navigator.share({ title: 'Friend Group Olympics', text: `Join my room: ${room.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled */
    }
  };

  const toggleGame = (g: GameId) => {
    if (!isHost) return;
    sfx.click();
    const next = room.games.includes(g) ? room.games.filter((x) => x !== g) : [...room.games, g];
    send({ t: 'setGames', games: next });
  };

  const cycleAvatar = () => {
    sfx.click();
    send({ t: 'profile', avatar: AVATARS[(AVATARS.indexOf(me.avatar) + 1) % AVATARS.length] });
  };

  const connected = room.players.filter((p) => p.connected).length;

  return (
    <Screen className="gap-5 py-2">
      <div className="text-center">
        <p className="font-bold tracking-widest text-white/60 uppercase">Room code</p>
        <motion.button
          onClick={share}
          whileTap={{ scale: 0.95 }}
          className="title-xl text-gradient bg-gradient-to-r from-sun via-hot to-ice text-7xl tracking-wider"
        >
          {room.code}
        </motion.button>
        <button onClick={share} className="mt-1 text-sm font-bold text-ice">
          {copied ? '✅ Link copied!' : '📤 Tap to share invite link'}
        </button>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Players</h2>
          <span className="font-bold text-white/60">
            {room.players.length}/{MAX_PLAYERS}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <AnimatePresence>
            {room.players.map((p) => (
              <motion.div
                layout
                key={p.id}
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                className="relative flex flex-col items-center gap-1 rounded-2xl bg-white/5 p-2"
              >
                {p.isHost && <span className="absolute -top-2 left-1 text-lg">👑</span>}
                {isHost && p.id !== me.id && (
                  <button
                    aria-label={`Remove ${p.name}`}
                    onClick={() => send({ t: 'kick', playerId: p.id })}
                    className="absolute -top-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white/70"
                  >
                    ✕
                  </button>
                )}
                <button onClick={p.id === me.id ? cycleAvatar : undefined} className={p.id === me.id ? 'active:scale-90' : ''}>
                  <Avatar player={p} size={56} ring={p.id === me.id} />
                </button>
                <span className="w-full truncate text-center text-sm font-bold" style={{ color: p.color }}>
                  {p.name}
                  {p.id === me.id && ' (you)'}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {room.players.length < 2 && (
          <p className="mt-3 text-center text-sm font-bold text-white/60">Share the code — it's more fun with friends!</p>
        )}
      </div>

      <SettingsCard room={room} isHost={isHost} />

      <div className="card p-4">
        <h2 className="mb-3 font-display text-xl">
          Games <span className="text-white/50">({room.games.length})</span>
        </h2>
        <div className="flex flex-col gap-2">
          {GAME_IDS.map((g) => {
            const on = room.games.includes(g);
            return (
              <button
                key={g}
                disabled={!isHost}
                onClick={() => toggleGame(g)}
                className={`flex items-center gap-3 rounded-2xl p-3 text-left transition ${on ? 'bg-gradient-to-r ' + GAME_META[g].gradient : 'bg-white/5 opacity-50'} ${isHost ? 'active:scale-[0.98]' : ''}`}
              >
                <span className="text-3xl">{GAME_META[g].emoji}</span>
                <span className="flex-1">
                  <span className="block font-display text-lg leading-tight text-ink">{GAME_META[g].name}</span>
                  <span className="block text-sm font-bold text-ink/70">{GAME_META[g].tagline}</span>
                </span>
                {isHost && <span className="text-xl">{on ? '✅' : '⬜'}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <HouseQuestions room={room} isHost={isHost} questions={host?.customQuestions ?? []} />

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 bg-gradient-to-t from-ink via-ink/90 to-transparent px-4 pt-6 pb-2">
        {isHost ? (
          <button className="btn btn-lime pulse-glow text-3xl" disabled={!room.games.length || connected < 1} onClick={() => send({ t: 'start' })}>
            START 🚀
          </button>
        ) : (
          <div className="card py-4 text-center font-display text-lg">
            Waiting for host
            <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.2 }}>
              …
            </motion.span>
          </div>
        )}
        <button className="text-sm font-bold text-white/50 underline" onClick={leaveRoom}>
          Leave room
        </button>
      </div>
    </Screen>
  );
}
