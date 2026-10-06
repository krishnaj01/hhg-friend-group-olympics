import { AnimatePresence, motion } from 'framer-motion';
import type { MemoryView } from '../../../shared/protocol';
import { TimerBar } from '../components/ui';
import { useSecondsLeft } from '../lib/fx';
import { send } from '../lib/net';
import { sfx } from '../lib/sound';

const TILE = ['bg-hot', 'bg-ice', 'bg-sun', 'bg-grape'];

function Grid({ cells, size, highlight, small }: { cells: (string | null)[]; size: number; highlight?: number; small?: boolean }) {
  return (
    <div className={`mx-auto grid w-full gap-2 ${small ? 'max-w-[220px]' : 'max-w-sm'}`} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
      {cells.map((c, i) => (
        <motion.div
          key={i}
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: small ? 0 : i * 0.03, type: 'spring', stiffness: 500, damping: 18 }}
          className={`grid aspect-square place-items-center rounded-xl ${small ? (size > 4 ? 'text-lg' : 'text-2xl') : size > 4 ? 'text-3xl' : 'text-4xl sm:text-5xl'} ${
            i === highlight ? 'bg-sun ring-4 ring-white pulse-glow' : 'bg-white/10'
          }`}
        >
          {c ?? (i === highlight ? '❓' : '')}
        </motion.div>
      ))}
    </div>
  );
}

export function Memory({ view }: { view: MemoryView }) {
  const secs = useSecondsLeft(view.stageEndsAt);
  const blanks = Array.from({ length: view.gridSize ** 2 }, () => null);

  if (view.stage === 'memorize') {
    return (
      <div className="flex flex-1 flex-col justify-center gap-5">
        <div className="text-center">
          <div className="title-xl text-5xl">MEMORIZE!</div>
          <div className="mt-1 font-display text-3xl text-sun">{secs}</div>
        </div>
        <Grid cells={view.grid ?? blanks} size={view.gridSize} />
        <TimerBar endsAt={view.stageEndsAt} total={view.stageMs} color="#00e0ff" />
      </div>
    );
  }

  const q = view.question!;
  const reveal = view.stage === 'reveal';
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between font-display text-white/70">
        <span>
          Q{view.qIndex + 1}/{view.qCount}
        </span>
        <span className="text-sun">{view.myPoints} pts</span>
      </div>

      <Grid cells={reveal && view.fullGrid ? view.fullGrid : blanks} size={view.gridSize} highlight={q.cell} small />

      <AnimatePresence mode="wait">
        <motion.h2
          key={view.qIndex}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          className="text-center font-display text-3xl leading-tight"
        >
          {q.prompt}
        </motion.h2>
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-3">
        {q.options.map((o, i) => {
          const picked = view.myAnswer === i;
          const correct = reveal && view.correctIndex === i;
          const wrongPick = reveal && picked && !correct;
          return (
            <motion.button
              key={`${view.qIndex}-${i}`}
              data-choice={i}
              whileTap={{ scale: 0.92 }}
              animate={correct ? { scale: [1, 1.12, 1] } : wrongPick ? { x: [0, -8, 8, -8, 0] } : {}}
              disabled={view.myAnswer !== null || reveal}
              onClick={() => {
                sfx.click();
                send({ t: 'input', data: { choice: i } });
              }}
              className={`grid h-24 place-items-center rounded-2xl text-5xl shadow-lg transition ${
                correct ? 'bg-lime ring-4 ring-white' : wrongPick ? 'bg-red-600' : picked ? `${TILE[i]} ring-4 ring-white` : view.myAnswer !== null || reveal ? 'bg-white/10 opacity-50' : TILE[i]
              } ${/^\d+$/.test(o) ? 'font-display text-ink' : ''}`}
            >
              {o}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-auto">
        {!reveal ? (
          <>
            <p className="mb-2 text-center font-bold text-white/60">
              {view.myAnswer !== null ? `🔒 Locked in · ${view.answeredCount} answered` : `${secs}s — faster = more points`}
            </p>
            <TimerBar endsAt={view.stageEndsAt} total={view.stageMs} />
          </>
        ) : (
          <p className="text-center font-display text-2xl">
            {view.myAnswer === view.correctIndex ? '✅ NAILED IT' : view.myAnswer === null ? '⏰ TOO SLOW' : '❌ NOPE'}
          </p>
        )}
      </div>
    </div>
  );
}
