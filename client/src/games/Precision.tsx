import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { PrecisionView } from '../../../shared/protocol';
import { targetPosition, targetRadius } from '../../../shared/target';
import { Avatar, usePlayer } from '../components/ui';
import { buzz, shake, useSecondsLeft } from '../lib/fx';
import { onGameEvent, send, serverNow } from '../lib/net';
import { sfx } from '../lib/sound';

interface Fx {
  id: number;
  x: number;
  y: number;
  kind: 'hit' | 'bullseye' | 'miss';
}

let fxId = 0;

export function Precision({ view }: { view: PrecisionView }) {
  const arena = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const hitsRef = useRef(view.myRoundHits);
  hitsRef.current = view.myRoundHits; // target size resets every round
  const [fx, setFx] = useState<Fx[]>([]);
  const [combo, setCombo] = useState(0);
  const secs = useSecondsLeft(view.endsAt);

  // Animate the target outside React for a smooth 60fps.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = target.current;
      const box = arena.current;
      if (el && box) {
        const size = box.clientWidth;
        const p = targetPosition(view.seed, serverNow() - view.startedAt, view.speed);
        const r = targetRadius(hitsRef.current, view.size) * size;
        el.style.width = el.style.height = `${r * 2}px`;
        el.style.transform = `translate(${p.x * size - r}px, ${p.y * size - r}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view.seed, view.startedAt, view.speed, view.size]);

  useEffect(
    () =>
      onGameEvent((name, data) => {
        const d = data as { x: number; y: number; bullseye?: boolean };
        if (name === 'hit') {
          d.bullseye ? sfx.bullseye() : sfx.hit();
          buzz(15);
          setCombo((c) => c + 1);
          addFx(d.x, d.y, d.bullseye ? 'bullseye' : 'hit');
        } else if (name === 'miss') {
          sfx.miss();
          setCombo(0);
          addFx(d.x, d.y, 'miss');
          if (Math.random() < 0.3) shake();
        }
      }),
    [],
  );

  const addFx = (x: number, y: number, kind: Fx['kind']) => {
    const id = ++fxId;
    setFx((f) => [...f.slice(-12), { id, x, y, kind }]);
    setTimeout(() => setFx((f) => f.filter((e) => e.id !== id)), 700);
  };

  const onTap = (e: React.PointerEvent) => {
    const box = arena.current!.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    send({ t: 'input', data: { x, y, t: serverNow() } });
  };

  const acc = view.myHits + view.myMisses ? Math.round((100 * view.myHits) / (view.myHits + view.myMisses)) : 100;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat
          label={view.rounds > 1 ? `ROUND ${view.round + 1}/${view.rounds}` : 'TIME'}
          value={view.stage === 'break' ? '—' : `${secs}s`}
          hot={view.stage === 'play' && secs <= 5}
        />
        <Stat label="HITS" value={view.myHits} />
        <Stat label="ACC" value={`${acc}%`} />
      </div>

      <div
        ref={arena}
        data-arena
        onPointerDown={onTap}
        className="relative aspect-square w-full overflow-hidden rounded-[2rem] border-4 border-white/15 bg-[radial-gradient(circle,#1e0b45,#0a0018)] shadow-2xl"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
      >
        <div
          ref={target}
          data-target
          className="pointer-events-none absolute top-0 left-0 rounded-full"
          style={{
            visibility: view.stage === 'break' ? 'hidden' : 'visible',
            background: 'radial-gradient(circle, #fff 0 14%, #ff3d7f 15% 34%, #fff 35% 52%, #ff3d7f 53% 72%, #fff 73% 100%)',
            boxShadow: '0 0 24px #ff3d7f, 0 0 0 3px #14002e',
            willChange: 'transform',
          }}
        />
        {fx.map((f) => (
          <motion.div
            key={f.id}
            initial={{ scale: 0.4, opacity: 1, y: 0 }}
            animate={{ scale: f.kind === 'miss' ? 1 : 1.6, opacity: 0, y: -30 }}
            transition={{ duration: 0.65 }}
            className="pointer-events-none absolute font-display"
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, translate: '-50% -50%' }}
          >
            {f.kind === 'miss' ? <span className="text-2xl text-hot">✖</span> : f.kind === 'bullseye' ? <span className="text-2xl text-sun">BULLSEYE!</span> : <span className="text-2xl text-lime">+40</span>}
          </motion.div>
        ))}
        <AnimatePresence>
          {view.stage === 'break' && (
            <motion.div
              key={`break-${view.round}`}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.6, opacity: 0 }}
              className="pointer-events-none absolute inset-0 grid place-items-center text-center"
            >
              <div>
                <div className="font-display text-xl text-white/70">GET READY</div>
                <div className="title-xl text-6xl text-sun">ROUND {view.round + 2}</div>
                <div className="mt-1 font-bold text-white/60">new path · full-size target</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {combo >= 3 && view.stage === 'play' && (
          <motion.div key={combo} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="pointer-events-none absolute top-3 left-0 w-full text-center font-display text-2xl text-sun">
            🔥 x{combo} COMBO
          </motion.div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {view.board.slice(0, 5).map((b) => (
          <BoardRow key={b.playerId} id={b.playerId} hits={b.hits} max={Math.max(1, view.board[0]?.hits ?? 1)} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hot }: { label: string; value: string | number; hot?: boolean }) {
  return (
    <div className="card py-2">
      <div className="text-xs font-bold text-white/60">{label}</div>
      <div className={`font-display text-2xl ${hot ? 'animate-pulse text-hot' : ''}`}>{value}</div>
    </div>
  );
}

function BoardRow({ id, hits, max }: { id: string; hits: number; max: number }) {
  const p = usePlayer(id);
  if (!p) return null;
  return (
    <div className="flex items-center gap-2">
      <Avatar player={p} size={24} />
      <div className="h-4 flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div className="h-full rounded-full" style={{ background: p.color }} animate={{ width: `${(hits / max) * 100}%` }} />
      </div>
      <span className="w-6 text-right font-display text-sm">{hits}</span>
    </div>
  );
}
