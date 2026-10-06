import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAwards, rankOf } from '../server/scoring.ts';
import { reactionPoints } from '../server/games/reaction.ts';
import { judgeTap } from '../server/games/precision.ts';
import { makeGrid, makeQuestions } from '../server/games/memory.ts';
import { makeChallenge } from '../server/games/bomb.ts';
import { QUESTION_BANK } from '../server/games/quiz.ts';
import { targetPosition, targetRadius } from '../shared/target.ts';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe('scoring', () => {
  test('competition ranking shares ties', () => {
    assert.deepEqual(rankOf({ a: 10, b: 30, c: 10, d: 5 }), { b: 1, a: 2, c: 2, d: 4 });
  });

  test('reaction points fall off with time and never go negative', () => {
    assert.equal(reactionPoints(200), 300);
    assert.ok(reactionPoints(250) > reactionPoints(400));
    assert.equal(reactionPoints(5000), 0);
  });

  test('awards', () => {
    const awards = computeAwards(
      ['a', 'b', 'c'],
      {
        a: { bestReactionMs: 210, correct: 4, answered: 5, hits: 10, misses: 1 },
        b: { bestReactionMs: 190, falseStarts: 2, explosions: 1, correct: 1, answered: 5 },
        c: { bestReactionMs: 300, correct: 3, answered: 5 },
      },
      [{ a: 3, b: 1, c: 2 }, { a: 2, b: 2, c: 1 }],
      { a: 1, b: 3, c: 2 },
    );
    const by = Object.fromEntries(awards.map((a) => [a.key, a.playerId]));
    assert.deepEqual(by, { fastest: 'b', accurate: 'a', comeback: 'a', chaotic: 'b' });
  });
});

describe('game generators', () => {
  test('memory grids are fair and questions answerable', () => {
    for (let s = 1; s < 200; s++) {
      const rng = seeded(s);
      const { grid, missing } = makeGrid(rng);
      assert.equal(grid.length, 16);
      assert.ok(!grid.includes(missing));
      for (const q of makeQuestions(grid, missing, rng)) {
        assert.equal(q.options.length, 4, q.prompt);
        assert.equal(new Set(q.options).size, 4, `distinct options: ${q.prompt} ${q.options}`);
        assert.ok(q.answer >= 0 && q.answer < 4);
      }
    }
  });

  test('bomb challenges always contain their answer', () => {
    const rng = seeded(7);
    for (let i = 0; i < 500; i++) {
      const c = makeChallenge(rng);
      assert.equal(c.options.length, 4);
      assert.ok(c.answer >= 0, c.prompt);
    }
  });

  test('quiz bank is well-formed', () => {
    assert.ok(QUESTION_BANK.length >= 15);
    for (const q of QUESTION_BANK) {
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4);
      assert.ok(q.answer >= 0 && q.answer < 4);
    }
  });

  test('precision: on-target taps hit, far taps miss, target stays in arena', () => {
    for (let t = 0; t < 20000; t += 137) {
      const p = targetPosition(42, t);
      assert.ok(p.x > 0.05 && p.x < 0.95 && p.y > 0.05 && p.y < 0.95, `in bounds at ${t}`);
      assert.equal(judgeTap(42, t, 0, p.x, p.y).hit, true);
      assert.equal(judgeTap(42, t, 0, p.x, p.y).bullseye, true);
      assert.equal(judgeTap(42, t, 0, p.x + 0.4, p.y).hit, false);
    }
    assert.ok(targetRadius(30) < targetRadius(0));
  });
});
