import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { GAME_META } from '../../shared/games';
import { Backdrop, Hud, Screen } from './components/ui';
import { GameStage } from './games';
import { buzz, shake, useOnChange } from './lib/fx';
import { currentGame, onGameEvent, useNet, type NetState } from './lib/net';
import { sfx } from './lib/sound';
import { Landing } from './screens/Landing';
import { Lobby } from './screens/Lobby';
import { Podium } from './screens/Podium';
import { Results } from './screens/Results';
import { Countdown, Intro } from './screens/Transitions';
import { Vote } from './screens/Vote';

function useGlobalSfx() {
  // Cues shared by several games; game-specific cues live in the games.
  useEffect(
    () =>
      onGameEvent((name) => {
        switch (name) {
          case 'go':
            sfx.go();
            buzz(60);
            break;
          case 'correct':
            sfx.correct();
            buzz(30);
            break;
          case 'wrong':
            sfx.wrong();
            shake();
            buzz([60, 40, 60]);
            break;
          case 'boom':
            sfx.boom();
            shake('big');
            buzz([300, 80, 300]);
            break;
        }
      }),
    [],
  );
  const { room } = useNet();
  useOnChange(room?.phase, (phase) => {
    if (phase === 'playing') sfx.go();
  });
}

function Spectate() {
  const { room } = useNet();
  const id = room && currentGame(room);
  const meta = id ? GAME_META[id] : null;
  return (
    <Screen className="items-center justify-center gap-4 text-center">
      <div className="text-7xl">🍿</div>
      <h1 className="title-xl text-4xl">YOU'RE IN!</h1>
      <p className="font-bold text-white/70">
        {meta ? `${meta.emoji} ${meta.name}` : 'This game'} is already underway.
        <br />
        You'll jump in at the next game.
      </p>
    </Screen>
  );
}

// Plain function (not a component) so AnimatePresence sees each screen's key.
function renderStage({ room, game, session }: NetState) {
  if (!room || !session) return <Landing key="landing" />;
  switch (room.phase) {
    case 'lobby':
      return <Lobby key="lobby" />;
    case 'intro':
      return <Intro key={`intro-${room.gameIndex}`} />;
    case 'countdown':
      return <Countdown key={`cd-${room.gameIndex}`} />;
    case 'playing':
      return game ? (
        <Screen key={`play-${room.gameIndex}`} className="py-1">
          <GameStage view={game} />
        </Screen>
      ) : (
        <Spectate key={`spec-${room.gameIndex}`} />
      );
    case 'results':
      return <Results key={`res-${room.gameIndex}`} />;
    case 'vote':
      return <Vote key={`vote-${room.gameIndex}`} />;
    case 'podium':
      return <Podium key="podium" />;
  }
}

export function App() {
  const net = useNet();
  const { status, error, room, session } = net;
  useGlobalSfx();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(
    () =>
      onGameEvent((name, data) => {
        if (name !== 'endedEarly') return;
        sfx.whoosh();
        setNotice((data as { what: string }).what === 'show' ? '🏁 The host ended the show' : '⏹ The host ended this game early');
        setTimeout(() => setNotice(null), 3000);
      }),
    [],
  );
  return (
    <>
      <Backdrop />
      <div id="stage" className="relative z-10 flex min-h-dvh flex-col">
        {room && session && <Hud />}
        <AnimatePresence mode="wait">
          {renderStage(net)}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {status === 'reconnecting' && (
          <motion.div
            initial={{ y: -80 }}
            animate={{ y: 0 }}
            exit={{ y: -80 }}
            className="fixed top-0 right-0 left-0 z-50 bg-sun py-2 text-center font-display text-ink safe-pt"
          >
            📡 Reconnecting…
          </motion.div>
        )}
        {notice && (
          <motion.div
            key={notice}
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            className="fixed top-16 right-4 left-4 z-50 mx-auto max-w-md rounded-2xl bg-sun px-4 py-3 text-center font-display text-ink shadow-2xl"
          >
            {notice}
          </motion.div>
        )}
        {error && (
          <motion.div
            key={error}
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed right-4 bottom-6 left-4 z-50 mx-auto max-w-md rounded-2xl bg-hot px-4 py-3 text-center font-bold shadow-2xl"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
