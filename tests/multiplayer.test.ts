import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type RunningServer } from '../server/index.ts';
import { Bot } from './bot.ts';

let server: RunningServer;
let url: string;
const bots: Bot[] = [];

function bot(name: string, skill?: Bot['skill']) {
  const b = new Bot(name, url, skill);
  bots.push(b);
  return b;
}

before(async () => {
  server = await startServer({ port: 0, timeScale: 0.1, staticDir: null });
  url = `ws://localhost:${server.port}/ws`;
});

after(async () => {
  for (const b of bots) b.close();
  await server.close();
});

describe('full show: 3 players, all 5 games', () => {
  test('everyone ends on the same podium with consistent scores and awards', async () => {
    const ana = bot('Ana', { reactionMs: 180, precise: true });
    const bo = bot('Bo', { reactionMs: 420, falseStartRound: 0 });
    const cy = bot('Cy', { reactionMs: 300, precise: true, quizChoice: 1 });
    await Promise.all([ana, bo, cy].map((b) => b.connect()));

    ana.send({ t: 'create', name: 'Ana', avatar: '🦊' });
    await ana.waitFor((b) => !!b.room, 3000, 'room');
    const code = ana.room!.code;
    assert.match(code, /^[A-Z2-9]{6}$/);

    bo.send({ t: 'join', code: code.toLowerCase(), name: 'Bo', avatar: '🐸' }); // codes are case-insensitive
    cy.send({ t: 'join', code, name: 'Ana', avatar: '🐼' }); // duplicate name gets suffixed
    await ana.waitFor((b) => b.room!.players.length === 3, 3000, '3 players');
    assert.deepEqual(ana.room!.players.map((p) => p.name), ['Ana', 'Bo', 'Ana 2']);
    assert.equal(ana.room!.hostId, ana.playerId);
    assert.equal(new Set(ana.room!.players.map((p) => p.color)).size, 3, 'unique colors');

    // Non-host can't start.
    bo.send({ t: 'start' });
    await bo.waitFor((b) => b.errors.includes('Only the host can start'), 2000, 'host error');

    const seenGames: string[] = [];
    const resultsSeen: number[] = [];
    ana.waitFor((b) => {
      if (b.game && !seenGames.includes(b.game.kind)) seenGames.push(b.game.kind);
      if (b.room?.phase === 'results' && !resultsSeen.includes(b.room.gameIndex)) {
        resultsSeen.push(b.room.gameIndex);
        // Leaderboard invariant: totals == previous totals + gained
        const rows = b.room.results!.rows;
        const sorted = [...rows].sort((x, y) => y.total - x.total);
        assert.deepEqual(rows.map((r) => r.total), sorted.map((r) => r.total), 'rows sorted by total');
      }
      return false;
    }, 120000).catch(() => {});

    ana.send({ t: 'start' });
    await Promise.all([ana, bo, cy].map((b) => b.waitFor((x) => x.room?.phase === 'podium', 90000, 'podium')));

    assert.deepEqual(seenGames, ['reaction', 'memory', 'precision', 'quiz', 'bomb']);
    assert.deepEqual(resultsSeen, [0, 1, 2, 3, 4]);

    // All clients agree on the final room state.
    const views = [ana, bo, cy].map((b) => JSON.stringify({ ...b.room, players: b.room!.players }));
    assert.equal(views[0], views[1]);
    assert.equal(views[1], views[2]);

    const podium = ana.room!.podium!;
    assert.equal(podium.standings.length, 3);
    for (let i = 1; i < podium.standings.length; i++)
      assert.ok(podium.standings[i - 1].total >= podium.standings[i].total, 'standings sorted');
    for (const s of podium.standings) {
      assert.equal(s.total, ana.room!.players.find((p) => p.id === s.playerId)!.score);
    }

    const award = (k: string) => podium.awards.find((a) => a.key === k);
    assert.equal(award('fastest')?.playerId, ana.playerId, 'Ana reacted fastest');
    const fastMs = Number(award('fastest')!.detail.replace('ms', ''));
    assert.ok(fastMs >= 170 && fastMs <= 260, `fastest time plausible (${fastMs})`);
    assert.ok(award('chaotic'), 'chaos award exists (Bo false-started)');
    assert.ok(bo.events.some((e) => e.name === 'falseStart'), 'Bo got the false start cue');
    assert.ok(ana.events.some((e) => e.name === 'hit'), 'precise bot landed hits');
    assert.ok(bo.events.some((e) => e.name === 'boom'), 'bomb exploded for everyone to see');
  });
});

describe('disconnects & reconnection', () => {
  test('game keeps going when a player drops; they can rejoin with their token', async () => {
    const host = bot('Host', { reactionMs: 200 });
    const flaky = bot('Flaky', { reactionMs: 200 });
    await Promise.all([host.connect(), flaky.connect()]);
    host.send({ t: 'create', name: 'Host', avatar: '🦊' });
    await host.waitFor((b) => !!b.room, 3000);
    flaky.send({ t: 'join', code: host.room!.code, name: 'Flaky', avatar: '🐸' });
    await host.waitFor((b) => b.room!.players.length === 2, 3000);

    host.send({ t: 'setGames', games: ['quiz', 'reaction'] });
    await host.waitFor((b) => b.room!.games.join() === 'reaction,quiz', 3000, 'game selection (canonical order)');
    host.send({ t: 'start' });
    await flaky.waitFor((b) => b.room?.phase === 'playing', 10000, 'playing');

    const { playerId, token, code } = flaky;
    flaky.close();
    await host.waitFor((b) => b.room!.players.find((p) => p.id === playerId)?.connected === false, 3000, 'marked offline');

    // The show must not stall waiting for the ghost.
    await host.waitFor((b) => b.room?.phase === 'results', 20000, 'results without flaky');

    const back = bot('Flaky-again', { reactionMs: 200 });
    await back.connect();
    back.send({ t: 'rejoin', code, playerId, token });
    await back.waitFor((b) => b.playerId === playerId && !!b.room, 3000, 'rejoined');
    assert.equal(back.room!.players.find((p) => p.id === playerId)!.connected, true);
    await back.waitFor((b) => b.room?.phase === 'podium', 30000, 'podium after rejoin');

    // Bad token is rejected.
    const imposter = bot('Imposter');
    await imposter.connect();
    imposter.send({ t: 'rejoin', code, playerId, token: 'nope' });
    await imposter.waitFor((b) => b.errors.includes('rejoin-failed'), 3000);
  });

  test('host migrates when the host disconnects; restart returns to lobby', async () => {
    const h = bot('H');
    const g = bot('G');
    await Promise.all([h.connect(), g.connect()]);
    h.send({ t: 'create', name: 'H', avatar: '🦊' });
    await h.waitFor((b) => !!b.room, 3000);
    g.send({ t: 'join', code: h.room!.code, name: 'G', avatar: '🐸' });
    await g.waitFor((b) => b.room?.players.length === 2, 3000);
    h.close();
    await g.waitFor((b) => b.room!.hostId === g.playerId, 3000, 'host migration');

    g.send({ t: 'setGames', games: ['precision'] });
    g.send({ t: 'start' });
    await g.waitFor((b) => b.room?.phase === 'podium', 20000, 'podium');
    g.send({ t: 'restart' });
    await g.waitFor((b) => b.room?.phase === 'lobby' && b.room.players.every((p) => p.score === 0), 3000, 'lobby reset');
  });

  test('late joiner spectates current game and is scored from the next one', async () => {
    const h = bot('H2', { reactionMs: 200 });
    await h.connect();
    h.send({ t: 'create', name: 'H2', avatar: '🦊' });
    await h.waitFor((b) => !!b.room, 3000);
    h.send({ t: 'setGames', games: ['reaction', 'quiz'] });
    h.send({ t: 'start' });
    await h.waitFor((b) => b.room?.phase === 'playing', 10000);
    const late = bot('Late');
    await late.connect();
    late.send({ t: 'join', code: h.room!.code, name: 'Late', avatar: '🐼' });
    await late.waitFor((b) => b.room?.phase === 'playing' && !!b.playerId, 3000);
    assert.equal(late.game, null, 'spectating the in-progress game');
    await late.waitFor((b) => b.room?.phase === 'playing' && b.game?.kind === 'quiz', 30000, 'plays quiz');
    await late.waitFor((b) => b.room?.phase === 'podium', 30000);
  });
});

describe('room validation', () => {
  test('bad codes, empty names, full rooms, kicks', async () => {
    const a = bot('A');
    await a.connect();
    a.send({ t: 'join', code: 'ZZZZZZ', name: 'A', avatar: '🦊' });
    await a.waitFor((b) => b.errors.some((e) => e.startsWith('No room')), 2000);
    a.send({ t: 'create', name: '   ', avatar: '🦊' });
    await a.waitFor((b) => b.errors.includes('Pick a name first!'), 2000);
    a.send({ t: 'create', name: 'A', avatar: '🦊' });
    await a.waitFor((b) => !!b.room, 2000);

    const extra: Bot[] = [];
    for (let i = 0; i < 12; i++) {
      const b = bot(`P${i}`);
      await b.connect();
      b.send({ t: 'join', code: a.room!.code, name: `P${i}`, avatar: '🐸' });
      extra.push(b);
    }
    await extra[11].waitFor((b) => b.errors.some((e) => e.includes('full')), 3000, 'room full');
    await a.waitFor((b) => b.room!.players.length === 12, 3000);

    const victim = extra[0];
    await victim.waitFor((b) => !!b.playerId, 2000);
    a.send({ t: 'kick', playerId: victim.playerId });
    await victim.waitFor((b) => b.errors.includes('You were removed by the host'), 2000);
    await a.waitFor((b) => b.room!.players.length === 11, 2000);

    // Garbage input never crashes the server.
    a.send({ t: 'input', data: { x: 'lol' } } as never);
    a.ws.send('not json');
    await a.waitFor((b) => b.errors.includes('Bad message'), 2000);
  });
});
