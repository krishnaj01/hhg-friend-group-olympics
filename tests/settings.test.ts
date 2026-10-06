import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_IDS, type GameId } from '../shared/games.ts';
import { DEFAULT_SETTINGS, type CustomQuestion, type PrecisionView, type ReactionView, type RoomSettings } from '../shared/protocol.ts';
import type { GameCtx } from '../server/engine.ts';
import { reaction } from '../server/games/reaction.ts';
import { memory } from '../server/games/memory.ts';
import { buildQuiz, quiz } from '../server/games/quiz.ts';
import { precision } from '../server/games/precision.ts';
import { bomb } from '../server/games/bomb.ts';
import { applySettings, buildPlaylist, cleanQuestion } from '../server/room.ts';
import { startServer, type RunningServer } from '../server/index.ts';
import { Bot } from './bot.ts';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Minimal hand-cranked context for driving a game module directly. */
function fakeCtx(settings: Partial<RoomSettings>, rng = () => 0.5) {
  const clock = { t: 0 };
  const events: string[] = [];
  const ctx: GameCtx = {
    players: [{ id: 'a', name: 'A' }],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    customQuestions: [],
    now: () => clock.t,
    dur: (ms) => ms,
    rng,
    isConnected: () => true,
    changed: () => {},
    emit: (_to, name) => events.push(name),
    finish: () => events.push('finish'),
  };
  return { ctx, clock, events };
}

describe('settings rules (unit)', () => {
  test('applySettings clamps and ignores junk', () => {
    const s = applySettings(DEFAULT_SETTINGS, { rounds: 99, difficulty: 'chaos', length: 'bogus', order: 'vote', extra: 1 });
    assert.deepEqual(s, { rounds: 10, length: 'normal', difficulty: 'chaos', order: 'vote', perGame: null });
    assert.equal(applySettings(s, { perGame: 99 }).perGame, 10);
    assert.equal(applySettings(s, { perGame: 0 }).perGame, 1);
    assert.equal(applySettings({ ...s, perGame: 4 }, { perGame: 'lots' }).perGame, 4, 'junk ignored');
    assert.equal(applySettings({ ...s, perGame: 4 }, { perGame: null }).perGame, null, 'back to auto');
    assert.equal(applySettings(s, { rounds: -3 }).rounds, 1);
    assert.equal(applySettings(s, { rounds: 4.6 }).rounds, 5);
    assert.deepEqual(applySettings(s, null), s);
  });

  test('playlists: fixed cycles, random is a fair shuffle with no back-to-back repeats, vote picks only the opener', () => {
    const pool: GameId[] = ['reaction', 'memory', 'quiz'];
    assert.deepEqual(buildPlaylist(pool, { ...DEFAULT_SETTINGS, rounds: 7, order: 'fixed' }, Math.random), [
      'reaction', 'memory', 'quiz', 'reaction', 'memory', 'quiz', 'reaction',
    ]);
    for (let seed = 1; seed < 300; seed++) {
      const rng = seeded(seed);
      const five = buildPlaylist([...GAME_IDS], { ...DEFAULT_SETTINGS, rounds: 5, order: 'random' }, rng);
      assert.deepEqual([...five].sort(), [...GAME_IDS].sort(), 'each game exactly once');
      const ten = buildPlaylist(pool, { ...DEFAULT_SETTINGS, rounds: 10, order: 'random' }, rng);
      assert.equal(ten.length, 10);
      for (let i = 1; i < ten.length; i++) assert.notEqual(ten[i], ten[i - 1], `no repeat at ${i} (seed ${seed})`);
    }
    assert.equal(buildPlaylist(pool, { ...DEFAULT_SETTINGS, rounds: 5, order: 'vote' }, Math.random).length, 1);
  });

  test('house question validation', () => {
    const ok = cleanQuestion({ prompt: '  Who   is late? ', options: ['Rahul', ' Priya '], answer: 1, explain: '' }, 'h');
    assert.equal(ok.prompt, 'Who is late?');
    assert.deepEqual(ok.options, ['Rahul', 'Priya']);
    assert.equal(ok.explain, undefined);
    const bad: [object, RegExp][] = [
      [{ prompt: '', options: ['a', 'b'], answer: 0 }, /question/i],
      [{ prompt: 'q', options: ['a'], answer: 0 }, /2-4/],
      [{ prompt: 'q', options: ['a', 'b', 'c', 'd', 'e'], answer: 0 }, /2-4/],
      [{ prompt: 'q', options: ['a', 'A'], answer: 0 }, /different/],
      [{ prompt: 'q', options: ['a', ' '], answer: 0 }, /empty/],
      [{ prompt: 'q', options: ['a', 'b'], answer: 2 }, /correct/],
      [{ prompt: 'x'.repeat(141), options: ['a', 'b'], answer: 0 }, /too long/],
    ];
    for (const [raw, re] of bad) assert.throws(() => cleanQuestion(raw, 'h'), re);
  });

  test('quiz plays every house question, padded with the bank', () => {
    const house = (n: number): CustomQuestion[] =>
      Array.from({ length: n }, (_, i) => ({ id: `${i}`, prompt: `house ${i}`, options: ['yes', 'no'], answer: 1, authorId: 'h' }));
    const rng = seeded(3);
    assert.equal(buildQuiz(3, [], rng).length, 3);
    const mixed = buildQuiz(5, house(2), rng);
    assert.equal(mixed.length, 5);
    assert.equal(mixed.filter((q) => q.authorId === 'h').length, 2);
    for (const q of mixed.filter((q) => q.authorId)) assert.equal(q.options[q.answer], 'no', 'answer survives option shuffle');
    assert.equal(buildQuiz(3, house(8), rng).length, 8, 'more house questions than the length → all of them');
    assert.equal(buildQuiz(3, house(20), rng).length, 12, 'capped per game');
  });
});

describe('rounds per game (unit)', () => {
  test('an explicit count overrides the length-based default in every game', () => {
    const n = 7;
    assert.equal((reaction.create(fakeCtx({ perGame: n }).ctx).view('a') as ReactionView).rounds, n);
    assert.equal((reaction.create(fakeCtx({ perGame: null, length: 'short' }).ctx).view('a') as ReactionView).rounds, 2);
    const q = quiz.create(fakeCtx({ perGame: n }, seeded(4)).ctx).view('a');
    assert.equal(q.kind === 'quiz' && q.qCount, n);

    // Memory can serve 10 different questions even on the small chill grid.
    for (let seed = 1; seed < 50; seed++) {
      const { ctx, clock } = fakeCtx({ perGame: 10, difficulty: 'chill' }, seeded(seed));
      const game = memory.create(ctx);
      const seen = new Set<string>();
      for (clock.t = 0; clock.t < 200000; clock.t += 100) {
        game.tick(clock.t);
        const v = game.view('a');
        if (v.kind === 'memory' && v.question) seen.add(`${v.question.prompt}#${v.question.cell ?? ''}`);
      }
      assert.equal(seen.size, 10, `seed ${seed}: 10 distinct questions`);
    }
  });

  test('bomb never runs more rounds than there are people to eliminate', () => {
    const { ctx } = fakeCtx({ perGame: 10 });
    ctx.players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    const v = bomb.create(ctx).view('a');
    assert.equal(v.kind === 'bomb' && v.rounds, 2);
  });

  test('precision splits into rounds with a break, a fresh path, and a fresh target', () => {
    const { ctx, clock, events } = fakeCtx({ perGame: 3 }); // normal length: 12s rounds
    const game = precision.create(ctx);
    const seeds = new Set<number>();
    const stages: string[] = [];
    for (clock.t = 0; !events.includes('finish') && clock.t < 60000; clock.t += 50) {
      game.tick(clock.t);
      const v = game.view('a') as PrecisionView;
      seeds.add(v.seed);
      if (stages.at(-1) !== `${v.stage}${v.round}`) stages.push(`${v.stage}${v.round}`);
      if (v.stage === 'break') game.input('a', { x: 0.5, y: 0.5, t: clock.t }, clock.t); // ignored during breaks
    }
    assert.deepEqual(stages, ['play0', 'break0', 'play1', 'break1', 'play2']);
    assert.equal(seeds.size, 3);
    assert.equal(clock.t, 3 * 12000 + 2 * 1800 + 50);
    assert.equal((game.view('a') as PrecisionView).myMisses, 0, 'break taps never count');
  });
});

describe('difficulty tuning (unit)', () => {
  test('chaos reaction flashes a decoy, and tapping it is a false start', () => {
    const { ctx, clock } = fakeCtx({ difficulty: 'chaos' });
    const game = reaction.create(ctx);
    const stages: string[] = [];
    let tapped = false;
    for (clock.t = 0; clock.t < 6000; clock.t += 50) {
      game.tick(clock.t);
      const v = game.view('a') as ReactionView;
      if (stages.at(-1) !== v.stage) stages.push(v.stage);
      if (v.stage === 'fake' && !tapped) {
        game.input('a', { tap: true }, clock.t);
        tapped = true;
        assert.equal((game.view('a') as ReactionView).myResult?.falseStart, true);
      }
    }
    assert.deepEqual(stages.slice(0, 4), ['wait', 'fake', 'wait', 'go']);
  });

  test('chill reaction never fakes; length sets the number of rounds', () => {
    for (const [length, rounds] of [['short', 2], ['normal', 3], ['long', 5]] as const) {
      const { ctx, clock } = fakeCtx({ difficulty: 'chill', length });
      const game = reaction.create(ctx);
      assert.equal((game.view('a') as ReactionView).rounds, rounds);
      for (clock.t = 0; clock.t < 6000; clock.t += 50) {
        game.tick(clock.t);
        assert.notEqual((game.view('a') as ReactionView).stage, 'fake');
      }
    }
  });

  test('memory grid grows with difficulty', () => {
    for (const [difficulty, size] of [['chill', 3], ['normal', 4], ['chaos', 5]] as const) {
      const v = memory.create(fakeCtx({ difficulty }, seeded(9)).ctx).view('a');
      assert.equal(v.kind === 'memory' && v.grid?.length, size * size);
    }
  });
});

// ---------------- over the wire ----------------

let server: RunningServer;
let url: string;
const bots: Bot[] = [];

before(async () => {
  server = await startServer({ port: 0, timeScale: 0.1, staticDir: null });
  url = `ws://localhost:${server.port}/ws`;
});

after(async () => {
  for (const b of bots) b.close();
  await server.close();
});

async function room(...names: string[]) {
  const list = names.map((n) => {
    const b = new Bot(n, url);
    bots.push(b);
    return b;
  });
  await Promise.all(list.map((b) => b.connect()));
  const [host, ...guests] = list;
  host.send({ t: 'create', name: host.name, avatar: '🦊' });
  await host.waitFor((b) => !!b.room, 3000, 'room');
  for (const g of guests) g.send({ t: 'join', code: host.room!.code, name: g.name, avatar: '🐸' });
  await Promise.all(list.map((b) => b.waitFor((x) => x.room?.players.length === list.length, 3000, 'everyone joined')));
  return list;
}

describe('host settings over the wire', () => {
  test('only the host changes settings; rounds follow the game selection', async () => {
    const [h, g] = await room('Hosty', 'Guesty');
    assert.equal(h.room!.settings.rounds, 5);
    g.send({ t: 'settings', settings: { difficulty: 'chaos' } });
    h.send({ t: 'settings', settings: { length: 'long' } });
    await g.waitFor((b) => b.room!.settings.length === 'long', 2000, 'host change applied');
    assert.equal(g.room!.settings.difficulty, 'normal', 'guest change ignored');

    h.send({ t: 'setGames', games: ['quiz', 'memory'] });
    await g.waitFor((b) => b.room!.settings.rounds === 2, 2000, 'rounds follow selection');
    h.send({ t: 'settings', settings: { rounds: 4 } });
    await g.waitFor((b) => b.room!.settings.rounds === 4, 2000, 'rounds raised for repeats');
  });

  test('chaos + short settings reach the games', async () => {
    const [h] = await room('Tuner');
    h.skill = { precise: true };
    h.send({ t: 'setGames', games: ['memory', 'precision'] });
    h.send({ t: 'settings', settings: { difficulty: 'chaos', length: 'short' } });
    await h.waitFor((b) => b.room!.settings.difficulty === 'chaos' && b.room!.settings.length === 'short', 2000);
    h.send({ t: 'start' });
    await h.waitFor((b) => b.game?.kind === 'memory' && !!b.game.grid, 10000, 'memorize');
    const m = h.game!;
    assert.ok(m.kind === 'memory' && m.grid!.length === 25 && m.qCount === 3, '5x5 grid, 3 questions');
    await h.waitFor((b) => b.game?.kind === 'precision', 20000, 'precision');
    const p = h.game!;
    assert.ok(p.kind === 'precision' && p.speed === 1.35 && p.size === 0.8);
    assert.equal(p.kind === 'precision' && p.endsAt - p.startedAt, 1200, '12s scaled by 0.1');
    await h.waitFor((b) => b.room?.phase === 'podium', 20000, 'podium');
  });
});

describe('house questions', () => {
  test('hidden from guests, all get played, and the author sits them out', async () => {
    const [h, g] = await room('Author', 'Friend');
    g.send({ t: 'addQuestion', prompt: 'sneaky', options: ['a', 'b'], answer: 0 });
    await g.waitFor((b) => b.errors.includes('Only the host can add questions'), 2000);

    h.send({ t: 'addQuestion', prompt: 'dup', options: ['x', 'X'], answer: 0 });
    await h.waitFor((b) => b.errors.includes('Answers must be different'), 2000);

    const prompts = ['Who is always late?', 'Who ate the last samosa?', 'Delete me'];
    for (const prompt of prompts)
      h.send({ t: 'addQuestion', prompt, options: ['Author', 'Friend', 'Nobody'], answer: 2, explain: 'classic' });
    await h.waitFor((b) => b.host?.customQuestions.length === 3, 2000, 'questions stored');
    h.send({ t: 'removeQuestion', id: h.host!.customQuestions[2].id });
    await g.waitFor((b) => b.room!.customQuestionCount === 2, 2000, 'guest sees only the count');
    assert.equal(g.host, null, 'guest gets no host data');
    assert.ok(!JSON.stringify(g.room).includes('samosa'), 'guest state never contains the prompts');

    h.send({ t: 'setGames', games: ['quiz'] });
    h.send({ t: 'settings', settings: { length: 'short' } });
    await h.waitFor((b) => b.room!.settings.rounds === 1 && b.room!.settings.length === 'short', 2000);
    h.send({ t: 'start' });
    await g.waitFor((b) => b.room?.phase === 'results', 30000, 'quiz done');

    for (const prompt of prompts.slice(0, 2)) {
      const seenByGuest = g.quizSeen.get(prompt);
      assert.ok(seenByGuest, `guest played "${prompt}"`);
      assert.equal(seenByGuest.authorId, h.playerId);
      assert.notEqual(seenByGuest.myAnswer, null, 'guest could answer');
      assert.equal(h.quizSeen.get(prompt)?.myAnswer, null, 'author could not answer their own');
    }
    assert.ok(!g.quizSeen.has('Delete me'), 'removed question not played');
    assert.equal(g.quizSeen.size, 3, 'short quiz = 3 questions incl. both house ones');
  });
});

describe('game order', () => {
  test('vote mode: ballot excludes the last game, majority wins, ties are coin-flipped', async () => {
    const [a, b, c] = await room('Ava', 'Ben', 'Cal');
    a.send({ t: 'setGames', games: ['reaction', 'memory', 'quiz'] });
    a.send({ t: 'settings', settings: { order: 'vote', length: 'short' } });
    await c.waitFor((x) => x.room!.settings.order === 'vote' && x.room!.settings.rounds === 3, 2000);
    a.send({ t: 'start' });

    await a.waitFor((x) => x.room?.phase === 'intro', 5000);
    assert.equal(a.room!.playlist.length, 1, 'only the opener is known');

    // Vote 1: two votes for the same game beat one.
    await a.waitFor((x) => x.room?.phase === 'vote', 40000, 'first vote');
    const first = a.room!.playlist[0];
    const ballot = a.room!.vote!.options;
    assert.ok(!ballot.includes(first), 'just-played game is not on the ballot');
    assert.equal(ballot.length, 2);
    a.send({ t: 'vote', gameId: ballot[0] }); // a changes their mind below
    a.send({ t: 'vote', gameId: ballot[1] });
    b.send({ t: 'vote', gameId: ballot[1] });
    c.send({ t: 'vote', gameId: ballot[0] });
    await a.waitFor((x) => !!x.room?.vote?.winner, 3000, 'vote closes once everyone voted');
    assert.equal(a.room!.vote!.winner, ballot[1]);
    assert.equal(a.room!.vote!.tieBreak, false);
    await a.waitFor((x) => x.room?.phase === 'playing', 10000);
    assert.equal(a.room!.playlist[1], ballot[1]);

    // Vote 2: one each and an abstention → closes on the timer with a coin flip.
    await a.waitFor((x) => x.room?.phase === 'vote', 40000, 'second vote');
    const ballot2 = a.room!.vote!.options;
    a.send({ t: 'vote', gameId: ballot2[0] });
    b.send({ t: 'vote', gameId: ballot2[1] });
    await a.waitFor((x) => !!x.room?.vote?.winner, 3000, 'timer closes vote');
    assert.equal(a.room!.vote!.tieBreak, true);
    assert.ok(ballot2.includes(a.room!.vote!.winner!));
    await a.waitFor((x) => x.room?.phase === 'podium', 40000, 'podium after 3 rounds');
    assert.equal(a.room!.podium!.standings.length, 3);
  });

  test('random order hides upcoming games; more rounds than games repeats them', async () => {
    const [h] = await room('Shuffler');
    h.send({ t: 'setGames', games: ['reaction', 'precision'] });
    h.send({ t: 'settings', settings: { order: 'random', length: 'short', rounds: 3 } });
    await h.waitFor((b) => b.room!.settings.rounds === 3 && b.room!.settings.order === 'random', 2000);
    h.send({ t: 'start' });
    const played: string[] = [];
    await h.waitFor((b) => {
      if (b.room?.phase === 'intro') assert.equal(b.room.playlist.length, b.room.gameIndex + 1, 'future stays hidden');
      if (b.room?.phase === 'results' && played.length === b.room.gameIndex) played.push(b.room.results!.gameId);
      return b.room?.phase === 'podium';
    }, 40000, 'podium');
    assert.equal(played.length, 3);
    for (let i = 1; i < played.length; i++) assert.notEqual(played[i], played[i - 1]);
  });
});

describe('ending early', () => {
  test('host can end a game (points so far count) and then end the whole show', async () => {
    const [h, g] = await room('Boss', 'Pal');
    h.skill = { precise: true, reactionMs: 200 };
    g.skill = { reactionMs: 250 };
    h.send({ t: 'setGames', games: ['precision', 'reaction', 'quiz'] });
    h.send({ t: 'settings', settings: { length: 'long' } });
    await g.waitFor((b) => b.room!.settings.length === 'long', 2000);
    h.send({ t: 'start' });

    // Games run in canonical order: reaction -> precision -> quiz.
    await h.waitFor((b) => b.game?.kind === 'reaction' && b.game.stage === 'reveal', 20000, 'one reaction round scored');
    g.send({ t: 'endGame' }); // guests can't
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(h.room!.phase, 'playing');

    h.send({ t: 'endGame' });
    await g.waitFor((b) => b.room?.phase === 'results', 2000, 'results right away');
    const res = g.room!.results!;
    assert.equal(res.endedEarly, true);
    assert.equal(res.gameId, 'reaction');
    assert.ok(res.rows.find((r) => r.playerId === h.playerId)!.gained > 0, 'points earned before the stop count');
    assert.ok(g.events.some((e) => e.name === 'endedEarly'), 'everyone is told');

    await h.waitFor((b) => b.game?.kind === 'precision' && b.game.myHits >= 2, 20000, 'show continues; some hits');
    const before = h.room!.players.find((p) => p.id === h.playerId)!.score;
    h.send({ t: 'endShow' });
    await g.waitFor((b) => b.room?.phase === 'podium', 2000, 'podium right away');
    const mine = g.room!.podium!.standings.find((s) => s.playerId === h.playerId)!;
    assert.ok(mine.total > before, 'precision points banked on the way out');
    assert.equal(g.room!.results!.gameId, 'precision');
    assert.equal(g.room!.results!.endedEarly, true);
  });

  test('end show also works between games and during a vote', async () => {
    const [h] = await room('Quitter');
    h.send({ t: 'setGames', games: ['reaction', 'quiz'] });
    h.send({ t: 'settings', settings: { order: 'vote', length: 'short', rounds: 3 } });
    await h.waitFor((b) => b.room!.settings.order === 'vote', 2000);
    h.send({ t: 'start' });
    await h.waitFor((b) => b.room?.phase === 'results', 20000);
    h.send({ t: 'endShow' });
    await h.waitFor((b) => b.room?.phase === 'podium' && b.room.vote === null, 2000, 'podium from results');
  });
});
