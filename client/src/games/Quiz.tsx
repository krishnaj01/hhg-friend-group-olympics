import { AnimatePresence, motion } from 'framer-motion';
import type { QuizView } from '../../../shared/protocol';
import { PlayerName, TimerBar } from '../components/ui';
import { useSecondsLeft } from '../lib/fx';
import { send, useNet } from '../lib/net';
import { sfx } from '../lib/sound';

const TILES = [
  { bg: 'bg-hot', icon: '▲' },
  { bg: 'bg-ice', icon: '◆' },
  { bg: 'bg-sun', icon: '●' },
  { bg: 'bg-grape', icon: '■' },
];

export function Quiz({ view }: { view: QuizView }) {
  const secs = useSecondsLeft(view.stageEndsAt);
  const { session } = useNet();
  const reveal = view.stage === 'reveal';
  const mine = view.authorId !== null && view.authorId === session?.playerId;
  const total = view.tally?.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between font-display text-white/70">
        <span>
          Q{view.qIndex + 1}/{view.qCount}
        </span>
        {!reveal && <span className={`text-3xl ${secs <= 3 ? 'animate-pulse text-hot' : 'text-white'}`}>{secs}</span>}
        <span className="text-sun">{view.myPoints} pts</span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view.qIndex}
          initial={{ rotateX: 90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={{ rotateX: -90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          className={`card grid min-h-36 place-items-center p-5 text-center ${view.authorId ? 'ring-2 ring-sun' : ''}`}
        >
          {view.authorId && (
            <div className="mb-2 rounded-full bg-sun px-3 py-1 font-display text-xs text-ink">
              🏠 HOUSE QUESTION · by <PlayerName id={view.authorId} />
            </div>
          )}
          <h2 className="font-display text-2xl leading-snug sm:text-3xl">{view.prompt}</h2>
        </motion.div>
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-3">
        {view.options.map((o, i) => {
          const picked = view.myAnswer === i;
          const correct = reveal && view.correctIndex === i;
          const dim = (view.myAnswer !== null && !picked && !reveal) || (reveal && !correct && !picked) || (mine && !reveal);
          return (
            <motion.button
              key={`${view.qIndex}-${i}`}
              initial={{ x: i % 2 ? 60 : -60, opacity: 0 }}
              animate={{
                x: 0,
                opacity: dim ? 0.4 : 1, // must live here: framer's inline opacity beats a CSS class
                scale: correct ? [1, 1.06, 1] : 1,
              }}
              transition={{ delay: reveal ? 0 : 0.1 + i * 0.06 }}
              data-choice={i}
              whileTap={{ scale: 0.95 }}
              disabled={view.myAnswer !== null || reveal || mine}
              onClick={() => {
                sfx.click();
                send({ t: 'input', data: { choice: i } });
              }}
              className={`relative flex items-center gap-3 overflow-hidden rounded-2xl px-4 py-4 text-left text-ink shadow-lg ${
                correct ? 'bg-lime ring-4 ring-white' : reveal && picked ? 'bg-red-500' : reveal ? 'bg-white/15 text-white' : TILES[i].bg
              } ${picked && !reveal ? 'ring-4 ring-white' : ''}`}
            >
              {reveal && view.tally && (
                <motion.div
                  className="absolute inset-y-0 left-0 bg-black/15"
                  initial={{ width: 0 }}
                  animate={{ width: `${(view.tally[i] / total) * 100}%` }}
                  transition={{ duration: 0.8 }}
                />
              )}
              <span className="relative font-display text-xl">{correct ? '✓' : reveal && picked ? '✗' : TILES[i].icon}</span>
              <span className="relative flex-1 text-xl font-black">{o}</span>
              {reveal && view.tally && <span className="relative font-display">{view.tally[i]}</span>}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-auto">
        {reveal ? (
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card p-4 text-center">
            <div className="font-display text-2xl">
              {mine ? '😈 YOUR QUESTION' : view.myAnswer === view.correctIndex ? '🧠 BIG BRAIN' : view.myAnswer === null ? '⏰ FROZE' : '🤡 FOOLED'}
            </div>
            <div className="mt-1 font-bold text-white/80">{view.explain}</div>
          </motion.div>
        ) : (
          <>
            <p className="mb-2 text-center font-bold text-white/60">
              {mine
                ? `😏 You wrote this one — sit back and watch · ${view.answeredCount} answered`
                : view.myAnswer !== null
                  ? `🔒 Locked in · ${view.answeredCount} answered`
                  : view.authorId
                    ? 'Inside-joke time. Do you REALLY know your friends?'
                    : 'The obvious answer is probably wrong…'}
            </p>
            <TimerBar endsAt={view.stageEndsAt} total={view.stageMs} color="#b46bff" />
          </>
        )}
      </div>
    </div>
  );
}
