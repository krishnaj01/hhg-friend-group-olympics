# 🏆 Friend Group Olympics

Create a private room, share the 6-character code, and battle your friends across 5 chaotic mini-games — live, on your phones.

⚡ **Reaction Rush** · 🧠 **Memory Blitz** · 🎯 **Precision** · 🤯 **Impossible Quiz** · 💣 **Pass the Bomb**

## Run it

```bash
npm install
npm run dev          # server on :3001 + Vite on :5173 (proxied /ws)
```

Open http://localhost:5173 in a few tabs (each tab is its own player). To play from phones on the same Wi-Fi, open `http://<your-computer's-LAN-IP>:5173`.

Production (single port, serves the built client + WebSocket):

```bash
npm run build
npm start            # http://localhost:3001  (PORT env to change)
```

Other scripts: `npm test` (unit + multiplayer integration tests), `npm run typecheck`.

## Architecture

```
shared/            Types + logic used by both sides
  games.ts         Game ids & metadata (names, emoji, how-to, gradients)
  protocol.ts      WebSocket messages, RoomView, per-game view types
  target.ts        Deterministic Precision target path (same math on server & client)
server/
  index.ts         HTTP static server + `ws` WebSocket transport, room registry, 50ms ticker
  room.ts          Room state machine: lobby → intro → countdown → playing → results → … → podium
  engine.ts        GameModule / GameInstance / GameCtx contract
  scoring.ts       Ranking, stats merging, end-of-show awards
  games/*.ts       One file per mini-game (authoritative logic)
client/src/
  lib/net.ts       Socket + external store, auto-reconnect, session rejoin, clock sync
  lib/sound.ts     WebAudio-synthesised SFX (no audio assets)
  lib/fx.ts        Screen shake, confetti, vibration, server-clock hooks
  screens/         Landing, Lobby, Intro/Countdown, Results, Vote, Podium
  components/      Shared UI, lobby settings + house-question editor
  games/*.tsx      One component per mini-game + registry
```

**The server is authoritative.** Clients send intents (`{t:'input', data}`); the server validates them, runs every timer against its own clock, and broadcasts a per-player snapshot (`room` + that player's `game` view). Deadlines are sent as server timestamps; clients estimate their clock offset via ping/pong and render countdowns locally, so timers line up across devices.

Fairness details:
- **Reaction Rush** — the GO moment is hidden until it happens. Reaction time is measured on the client from the frame GO was painted (so a laggy connection isn't a handicap), and the server caps it at its own elapsed time (so it can't be faked low). Tapping before GO counts as a false start.
- **Precision** — the target path is a pure function of `(seed, elapsed)`. The client renders it at 60fps, sends `{x, y, t}` for each tap, and the server re-evaluates the path at `t` (clamped to the last 500ms) to judge hit or miss.
- **Pass the Bomb** — the fuse length is secret. The heat bar is normalized to the *maximum* possible fuse, so it can't be read as a countdown. Wrong answers burn the fuse faster.

**Disconnects.** Each tab keeps `{code, playerId, token}` in `sessionStorage`. If the socket drops, the client reconnects with backoff and rejoins as the same player with the same score. Opening a second tab as the same player replaces the first. Games never wait on disconnected players: rounds end early once every *connected* player has acted, and a disconnected bomb holder auto-throws after 2.5s. The host role moves to another connected player if the host drops. Disconnected players are pruned after 20s in the lobby. Empty rooms are reaped after 5 minutes.

**Late joiners** can join mid-show. They spectate the current game and are scored from the next one.

## Host settings

Set in the lobby by the host; everyone else sees them read-only.

| Setting | Options | What it changes |
|---|---|---|
| Rounds | 1–10 | Games in the show. Toggling games resets it to the number selected; going higher makes games repeat. |
| Rounds per game | Auto / 1–10 | Auto follows Game length. A number sets reaction rounds, memory questions, quiz questions (house questions can add more) and Precision rounds (8/12/16s each, fresh path and full-size target every round). Pass the Bomb is capped at players − 1 explosions. |
| Game length | Short / Normal / Long | Reaction rounds 2/3/5 · memory questions 3/4/5 · Precision 12/20/30s · quiz questions 3/5/7 · bomb rounds up to 2/3/4 |
| Difficulty | Chill / Normal / Chaos | Memory grid 3×3 / 4×4 / 5×5 and its timers · target speed ×0.75/1/1.35 and size ×1.25/1/0.8 · fuse 18–28s / 14–24s / 9–16s · quiz timer 15/11/7s · false-start penalty · **decoy flashes** in Reaction Rush on Chaos |
| Game order | In order / Random / Vote | Random shuffles (never the same game twice in a row, upcoming games hidden). Vote: everyone votes between rounds; the game just played isn't on the ballot, voting closes early once everyone has voted, majority wins, ties are a coin flip, no votes = random. The first game is picked at random. |

Each game reads its tuning through `byDifficulty(ctx, {...})` / `byLength(ctx, {...})` (`server/engine.ts`), so all of a game's knobs sit in one table at the top of its file.

**Ending early.** During a show the host gets a ⏹ button in the top bar:
- *End this game now* (while a game is running): stops it, keeps every point earned so far, shows the leaderboard (marked "ended early"), and the show continues.
- *End the show* (any time after the start): banks the points from a game in progress and jumps straight to the podium with awards.

Everyone sees a toast when the host does either.

**House questions.** The host can write up to 20 inside-joke quiz questions (2–4 answers, optional punchline). They are only sent to the host's client; other players only see a count. Every house question is played in the next Impossible Quiz (up to 12 per game), padded with bank questions to the game length, shuffled in among them, and tagged "🏠 HOUSE QUESTION · by …". The author can't answer their own questions, and those don't count against their score.

## Adding a mini-game

1. Add an id + metadata in `shared/games.ts` and its view type in `shared/protocol.ts` (`GameView` union).
2. Write `server/games/<id>.ts` implementing `GameInstance` (`tick`, `input`, `view`, `outcome`), export a `GameModule`, and register it in `server/games/index.ts`.
3. Write `client/src/games/<Id>.tsx` that renders the view and sends `{t:'input'}`, and register it in `client/src/games/index.tsx`.

The room handles intros, countdowns, the leaderboard, ranks, and awards. A game only reports `points` and `stats` from `outcome()`.

Scoring: each game is designed to award roughly 0–1,250 points. Awards come from the merged stats: fastest reaction (`bestReactionMs`), most accurate (`(correct + hits) / attempts`), biggest comeback (largest climb from worst rank to final rank), and most chaotic (false starts, explosions, wrong answers, misses).

## Testing

`npm test` runs:
- **Unit tests**: ranking ties, reaction scoring, memory grid/question generation (200 seeds), bomb challenges, the quiz bank, Precision hit detection, and awards.
- **Multiplayer integration**: real WebSocket bots play a full 5-game show at 10× speed (`timeScale: 0.1`). The tests assert that every client ends with an identical podium state, that totals and ranks are consistent, and that the awards are correct. Separate tests cover a mid-game disconnect and rejoin with a token (a bad token is rejected), host migration, restart, late joiners, full rooms, kicks, and garbage input.
- **Settings** (`tests/settings.test.ts`): setting validation and host-only control, playlist rules (300 random seeds), house-question validation and secrecy (a guest's state never contains the prompts), the author sitting out, Chaos decoys and grid sizes, full vote rounds (majority, early close, tie → coin flip), rounds per game in every game (including 10 distinct memory questions on a 3×3 grid and Precision's round breaks), and ending a game or the show early with points kept.

`FGO_TIME_SCALE=0.3 npm start` speeds up every timer for manual testing.
