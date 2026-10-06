import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import {
  CUSTOM_LIMITS,
  MAX_PER_GAME,
  MAX_ROUNDS,
  MIN_ROUNDS,
  type CustomQuestion,
  type Difficulty,
  type GameLength,
  type OrderMode,
  type RoomSettings,
  type RoomView,
} from '../../../shared/protocol';
import { useOnChange } from '../lib/fx';
import { send } from '../lib/net';
import { sfx } from '../lib/sound';

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-1 rounded-2xl bg-black/30 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            disabled={disabled}
            onClick={() => {
              if (on) return;
              sfx.click();
              onChange(o.value);
            }}
            className={`relative rounded-xl px-2 py-2 text-sm font-black transition ${on ? 'text-ink' : 'text-white/60'} ${disabled ? '' : 'active:scale-95'}`}
          >
            {on && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-xl bg-sun" />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const DIFFICULTY_HINT: Record<Difficulty, string> = {
  chill: '3×3 memory grid · big slow target · long fuse · relaxed timers',
  normal: 'The classic experience',
  chaos: '5×5 grid · tiny fast target · short fuse · decoy flashes 😈',
};

const LENGTH_HINT: Record<GameLength, string> = {
  short: '2 reaction rounds · 3 quiz Qs · 12s of Precision',
  normal: '3 reaction rounds · 5 quiz Qs · 20s of Precision',
  long: '5 reaction rounds · 7 quiz Qs · 30s of Precision',
};

/** What the "auto" rounds-per-game means for each length (mirrors the server tables). */
const AUTO_PER_GAME: Record<GameLength, number> = { short: 3, normal: 3, long: 5 };

const ORDER_HINT: Record<OrderMode, string> = {
  fixed: 'Games play in the order listed below',
  random: 'Shuffled — nobody knows what’s next',
  vote: 'Everyone votes on the next game between rounds',
};

export function SettingsCard({ room, isHost }: { room: RoomView; isHost: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<RoomSettings>) => send({ t: 'settings', settings: patch });
  const repeats = s.rounds > room.games.length && room.games.length > 0;

  return (
    <div className="card flex flex-col gap-4 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl">Settings</h2>
        {!isHost && <span className="text-xs font-bold text-white/50">host decides</span>}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-black">Rounds</div>
          <div className="text-xs font-bold text-white/50">{repeats ? 'More rounds than games → some repeat' : 'Games in the show'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="Fewer rounds"
            disabled={!isHost || s.rounds <= MIN_ROUNDS}
            onClick={() => (sfx.click(), set({ rounds: s.rounds - 1 }))}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 font-display text-xl disabled:opacity-30"
          >
            −
          </button>
          <motion.span key={s.rounds} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="w-8 text-center font-display text-3xl text-sun">
            {s.rounds}
          </motion.span>
          <button
            aria-label="More rounds"
            disabled={!isHost || s.rounds >= MAX_ROUNDS}
            onClick={() => (sfx.click(), set({ rounds: s.rounds + 1 }))}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 font-display text-xl disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="font-black">Game length</div>
        <Segmented<GameLength>
          value={s.length}
          disabled={!isHost}
          onChange={(length) => set({ length })}
          options={[
            { value: 'short', label: '⚡ Short' },
            { value: 'normal', label: '⏱️ Normal' },
            { value: 'long', label: '🐢 Long' },
          ]}
        />
        <div className="text-xs font-bold text-white/50">{LENGTH_HINT[s.length]}</div>
      </div>

      <PerGameRow value={s.perGame} length={s.length} isHost={isHost} onChange={(perGame) => set({ perGame })} />

      <div className="flex flex-col gap-1">
        <div className="font-black">Difficulty</div>
        <Segmented<Difficulty>
          value={s.difficulty}
          disabled={!isHost}
          onChange={(difficulty) => set({ difficulty })}
          options={[
            { value: 'chill', label: '😌 Chill' },
            { value: 'normal', label: '🙂 Normal' },
            { value: 'chaos', label: '😈 Chaos' },
          ]}
        />
        <div className="text-xs font-bold text-white/50">{DIFFICULTY_HINT[s.difficulty]}</div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="font-black">Game order</div>
        <Segmented<OrderMode>
          value={s.order}
          disabled={!isHost}
          onChange={(order) => set({ order })}
          options={[
            { value: 'fixed', label: '➡️ In order' },
            { value: 'random', label: '🎲 Random' },
            { value: 'vote', label: '🗳️ Vote' },
          ]}
        />
        <div className="text-xs font-bold text-white/50">{ORDER_HINT[s.order]}</div>
      </div>
    </div>
  );
}

function PerGameRow({
  value,
  length,
  isHost,
  onChange,
}: {
  value: number | null;
  length: GameLength;
  isHost: boolean;
  onChange: (v: number | null) => void;
}) {
  const auto = value === null;
  const shown = value ?? AUTO_PER_GAME[length];
  const step = (d: number) => {
    sfx.click();
    onChange(Math.min(MAX_PER_GAME, Math.max(1, shown + d)));
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-black">Rounds per game</div>
          <div className="text-xs font-bold text-white/50">
            {auto ? 'Auto — follows game length' : `${value} reaction rounds · ${value} questions · ${value} Precision rounds`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="Fewer rounds per game"
            disabled={!isHost || (!auto && shown <= 1)}
            onClick={() => step(-1)}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 font-display text-xl disabled:opacity-30"
          >
            −
          </button>
          <motion.span
            key={auto ? 'auto' : shown}
            initial={{ scale: 1.5 }}
            animate={{ scale: 1 }}
            className={`w-12 text-center font-display ${auto ? 'text-base text-white/70' : 'text-3xl text-sun'}`}
          >
            {auto ? 'AUTO' : shown}
          </motion.span>
          <button
            aria-label="More rounds per game"
            disabled={!isHost || (!auto && shown >= MAX_PER_GAME)}
            onClick={() => step(auto ? 0 : 1)}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 font-display text-xl disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>
      {!auto && isHost && (
        <button onClick={() => (sfx.click(), onChange(null))} className="self-end text-xs font-black text-ice">
          ↺ back to auto
        </button>
      )}
      {!auto && value! > 3 && <div className="text-xs font-bold text-white/50">Pass the Bomb: at most players − 1 explosions</div>}
    </div>
  );
}

// ---------------- house (custom) quiz questions ----------------

const EMPTY = { prompt: '', options: ['', ''], answer: 0, explain: '' };

function QuestionForm({ onCancel }: { onCancel: () => void }) {
  const [draft, setDraft] = useState(EMPTY);
  const L = CUSTOM_LIMITS;
  const filled = draft.prompt.trim() && draft.options.every((o) => o.trim());
  const dupes = new Set(draft.options.map((o) => o.trim().toLowerCase())).size !== draft.options.length;

  const setOption = (i: number, v: string) => setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? v.slice(0, L.option) : o)) }));
  const removeOption = (i: number) =>
    setDraft((d) => ({
      ...d,
      options: d.options.filter((_, j) => j !== i),
      answer: d.answer === i ? 0 : d.answer > i ? d.answer - 1 : d.answer,
    }));

  const save = () => {
    if (!filled || dupes) return;
    sfx.correct();
    send({ t: 'addQuestion', prompt: draft.prompt, options: draft.options, answer: draft.answer, explain: draft.explain || undefined });
    setDraft(EMPTY);
    onCancel();
  };

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="flex flex-col gap-2 rounded-2xl bg-black/30 p-3">
        <textarea
          value={draft.prompt}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value.slice(0, L.prompt) })}
          placeholder="e.g. Who has never once been on time for class?"
          rows={2}
          className="w-full resize-none rounded-xl border-2 border-white/15 bg-black/30 px-3 py-2 font-bold outline-none placeholder:text-white/30 focus:border-sun"
        />
        <div className="text-xs font-bold text-white/50">Tap ✓ to mark the right answer</div>
        {draft.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              aria-label={`Mark answer ${i + 1} correct`}
              onClick={() => (sfx.click(), setDraft({ ...draft, answer: i }))}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-display transition ${
                draft.answer === i ? 'bg-lime text-ink' : 'bg-white/10 text-white/30'
              }`}
            >
              ✓
            </button>
            <input
              value={o}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={i === 0 ? 'Rahul' : i === 1 ? 'Priya' : `Answer ${i + 1}`}
              className="min-w-0 flex-1 rounded-xl border-2 border-white/15 bg-black/30 px-3 py-2 font-bold outline-none placeholder:text-white/30 focus:border-sun"
            />
            {draft.options.length > L.minOptions && (
              <button aria-label="Remove answer" onClick={() => removeOption(i)} className="h-10 w-8 text-white/40">
                ✕
              </button>
            )}
          </div>
        ))}
        {draft.options.length < L.maxOptions && (
          <button onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })} className="self-start text-sm font-black text-ice">
            + add answer
          </button>
        )}
        <input
          value={draft.explain}
          onChange={(e) => setDraft({ ...draft, explain: e.target.value.slice(0, L.explain) })}
          placeholder="Punchline shown after (optional)"
          className="rounded-xl border-2 border-white/15 bg-black/30 px-3 py-2 text-sm font-bold outline-none placeholder:text-white/30 focus:border-sun"
        />
        {dupes && filled && <div className="text-sm font-bold text-hot">Answers must be different</div>}
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1 py-3 text-base" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-lime flex-1 py-3 text-base" disabled={!filled || dupes} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function QuestionRow({ q }: { q: CustomQuestion }) {
  return (
    <motion.div layout initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }} className="flex items-start gap-2 rounded-xl bg-white/5 p-3">
      <div className="min-w-0 flex-1">
        <div className="font-bold leading-snug">{q.prompt}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {q.options.map((o, i) => (
            <span key={i} className={`rounded-lg px-2 py-0.5 text-xs font-black ${i === q.answer ? 'bg-lime text-ink' : 'bg-white/10 text-white/60'}`}>
              {i === q.answer && '✓ '}
              {o}
            </span>
          ))}
        </div>
      </div>
      <button
        aria-label="Delete question"
        onClick={() => (sfx.click(), send({ t: 'removeQuestion', id: q.id }))}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black/30 text-white/60"
      >
        🗑
      </button>
    </motion.div>
  );
}

export function HouseQuestions({ room, isHost, questions }: { room: RoomView; isHost: boolean; questions: CustomQuestion[] }) {
  const [adding, setAdding] = useState(false);
  const quizOn = room.games.includes('quiz');
  useOnChange(room.customQuestionCount, (n, prev) => {
    if (prev !== undefined && n > prev && !isHost) sfx.join();
  });

  if (!isHost) {
    if (!room.customQuestionCount) return null;
    return (
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card p-4 text-center font-bold">
        🏠 The host wrote <span className="font-display text-sun">{room.customQuestionCount}</span> house question
        {room.customQuestionCount > 1 ? 's' : ''} 🤫
        <div className="text-sm text-white/60">Hope you know your friends…</div>
      </motion.div>
    );
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl">🏠 House questions</h2>
        <span className="font-bold text-white/60">
          {questions.length}/{CUSTOM_LIMITS.max}
        </span>
      </div>
      <p className="text-sm font-bold text-white/60">
        Inside jokes for the Impossible Quiz. Only you can see them — and you can’t answer your own.
      </p>
      {!quizOn && questions.length > 0 && (
        <p className="rounded-xl bg-hot/20 px-3 py-2 text-sm font-bold text-hot">Turn on Impossible Quiz below to play these!</p>
      )}
      <AnimatePresence initial={false}>
        {questions.map((q) => (
          <QuestionRow key={q.id} q={q} />
        ))}
      </AnimatePresence>
      <AnimatePresence>{adding && <QuestionForm key="form" onCancel={() => setAdding(false)} />}</AnimatePresence>
      {!adding && questions.length < CUSTOM_LIMITS.max && (
        <button className="btn btn-ghost py-3 text-base" onClick={() => (sfx.click(), setAdding(true))}>
          ✍️ Add a question
        </button>
      )}
    </div>
  );
}
