# Gatewaze Arcade SDK

One file, `gatewaze-arcade.js`, no dependencies and no build step. Copy it into
your game repo next to `index.html` and load it with a plain script tag. It works
from `file://`, from `python -m http.server`, from GitHub Pages, and on the
Gatewaze portal — the same code, with no configuration and no keys.

```html
<script src="gatewaze-arcade.js"></script>
```

You can also reference the copy the games origin serves, if your game is only
ever played on the portal:

```html
<script src="/sdk/gatewaze-arcade-1.js"></script>
```

Vendoring the file is recommended: it is what keeps local development working
with nothing else installed.

## Two modes

**local** — no portal around your game. Everything maps to namespaced
`localStorage` under `gw:<game>:state` and `gw:<game>:board`, including a working
hall of fame. This is exactly the workflow you have today, so your development
loop does not change.

**portal** — your game is embedded on the portal and the player is signed in.
Progress and scores are saved server-side against their profile, and the
leaderboard is shared across everyone who plays.

You do not choose. `init()` detects it. A signed-out player on the portal stays
in local mode, but `requestSignIn()` works there and the SDK flips to portal mode
after they come back.

## Getting started

```js
const arcade = await GatewazeArcade.init({ game: "mcp-quest" });

// Restore progress (server-side on the portal, localStorage otherwise).
const state = await arcade.load();
startGame(state);

// Save whenever something meaningful changes. Saves are batched, so calling
// this often is fine.
arcade.save({ level, answers, seenIntro: true });

// End of a run.
const { bestScore, rank } = await arcade.submitScore(score);

// Let the player carve their name onto the board.
await arcade.setDisplayName("ADA");

// Render the board.
for (const entry of await arcade.leaderboard()) {
  console.log(entry.rank, entry.displayName, entry.score);
}
```

## API

| Member | Behaviour |
|---|---|
| `GatewazeArcade.init({ game })` | Resolves with the arcade object. `game` is your slug, `^[a-z][a-z0-9-]{1,60}$`. Waits at most 800 ms for the portal; falls back to local mode. |
| `arcade.mode` | `"portal"` or `"local"`. Live property — read it, do not cache it. |
| `arcade.signedIn` | `true` only in portal mode. |
| `arcade.user` | `{ profileName, avatarUrl }` or `null`. For an in-game greeting only — **never** render it as public identity; the leaderboard alias is separate and opt-in. |
| `await arcade.load()` | The saved state object, `{}` if there is none. |
| `arcade.save(state)` | Queues a save of a plain object. Debounced 2 s in portal mode, written straight through locally. |
| `await arcade.submitScore(score)` | `{ bestScore, rank }`. Non-negative integers; the server keeps the best. |
| `await arcade.setDisplayName(name)` | Sets the public leaderboard alias. `null`, `""` or whitespace clears it. Trimmed to 40 characters. |
| `await arcade.leaderboard()` | `[{ rank, displayName, score, at }]`. |
| `arcade.requestSignIn()` | Asks the portal to start sign-in. No-op with no portal around. |
| `arcade.on("change", fn)` | Fires when mode, sign-in state or identity changes. Returns an unsubscribe function. |
| `await arcade.flush()` | Forces a pending save out now. Rarely needed — see below. |

## Things worth knowing

**Saves are batched, and flushed when the tab goes away.** `save()` waits two
seconds for further changes before sending. On `pagehide` and on
`visibilitychange` to hidden, any pending save is sent immediately with
`fetch(..., { keepalive: true })`, so closing the tab mid-level does not lose
progress. Call `save()` freely; you do not need `flush()`.

**It never throws.** Every call resolves. A dropped network, an expired session
or a rate limit degrades to local mode and fires `change`; nothing you `await`
will reject and no exception will escape into your game loop.

**Wrap the leaderboard render in a `change` handler** if you want it to update
after a sign-in round trip:

```js
arcade.on("change", async () => {
  renderLeaderboard(await arcade.leaderboard());
  signInButton.hidden = arcade.signedIn;
});
```

**Local-to-server merge is yours to offer.** When a signed-out player signs in,
you get a `change` event. If they built up a local score, that is the moment to
ask "Submit your score of 1,240 to the leaderboard?" and call `submitScore()`.

**Storage keys.** Local mode uses `gw:<game>:state` and `gw:<game>:board` only.
The games origin is shared between games, so do not write generic keys like
`state` or `highscores` yourself — namespace anything of your own the same way.

**No secrets, ever.** There is no API key, no token and no environment variable
in your repo. When the SDK holds an access token it lives in a closure variable
in memory only, never in `localStorage`, `sessionStorage`, IndexedDB or a cookie.

**Your styling is untouched.** The SDK renders nothing. Your document, your CSS,
your DOM.

## Migrating an existing game

Both current games already have the right shape: a load/save pair over
`localStorage` and a browser-local hall of fame. The refactor is a swap, not a
rewrite.

### mcp-quest ("Protocol Kwest")

**Before** — direct storage plus a local board:

```js
const SAVE_KEY = 'mcpQuestSave';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveState(state) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function getHallOfFame() {
  return JSON.parse(localStorage.getItem('mcpQuestHallOfFame') || '[]');
}

function addToHallOfFame(name, score) {
  const board = getHallOfFame();
  board.push({ name, score, date: Date.now() });
  board.sort((a, b) => b.score - a.score);
  localStorage.setItem('mcpQuestHallOfFame', JSON.stringify(board.slice(0, 10)));
}
```

**After** — one `arcade` object, everything else unchanged:

```html
<script src="gatewaze-arcade.js"></script>
```

```js
let arcade;

async function boot() {
  arcade = await GatewazeArcade.init({ game: 'mcp-quest' });
  const state = await arcade.load();      // was loadState()
  startGame(state);
  renderHallOfFame(await arcade.leaderboard());

  arcade.on('change', async () => {
    renderHallOfFame(await arcade.leaderboard());
    updateSignInPrompt();
  });
}

function saveState(state) {
  arcade.save(state);                     // debounced; flushed on tab close
}

async function finishRun(score, name) {
  if (name) await arcade.setDisplayName(name);   // "carve your name"
  const { bestScore, rank } = await arcade.submitScore(score);
  renderResult(bestScore, rank);
  renderHallOfFame(await arcade.leaderboard());
}

function updateSignInPrompt() {
  signInBanner.hidden = arcade.signedIn;
  // Optional greeting — private, never rendered as public identity.
  if (arcade.user) greeting.textContent = `Welcome back, ${arcade.user.profileName}`;
}

boot();
```

Point-by-point:

| Old | New |
|---|---|
| `loadState()` | `await arcade.load()` |
| `saveState(state)` | `arcade.save(state)` — drop the manual debounce or throttle if you had one |
| `getHallOfFame()` | `await arcade.leaderboard()` |
| `addToHallOfFame(name, score)` | `await arcade.setDisplayName(name)` then `await arcade.submitScore(score)` |
| `localStorage.removeItem(SAVE_KEY)` on reset | `arcade.save({})` |
| Your own `SAVE_KEY` / `HALL_OF_FAME_KEY` constants | delete them |

Leave the rest — the checksum, the scoring, the render functions — exactly as it
is. Score integrity on the platform is handled by a `max_score` cap, a monotonic
best score and one row per player, not by the game.

### protocol-trivia

Same swap, plus the data file. `questions.js` is served from the same versioned
directory as `index.html`, so `<script src="./questions.js"></script>` keeps
working unchanged after publishing. Nothing about the relative path needs to
change.

```js
const arcade = await GatewazeArcade.init({ game: 'protocol-trivia' });

// Per-round progress.
arcade.save({ questionIndex, correct, streak });

// End of quiz.
await arcade.submitScore(correct * 10);
```

## What runs on the portal

Your game runs in a sandboxed cross-origin iframe under a strict content
security policy. Inline `<script>`, inline `<style>` and `onclick=` attributes
all keep working. What does not:

- Loading scripts, stylesheets, fonts or images from another domain. Vendor them
  into your repo instead.
- `fetch()` to an external API. If you genuinely need one, ask for a per-game
  exception at registration; it is reviewed and audited.
- Opening modals through `window.showModalDialog`, submitting forms, requesting
  pointer lock, or navigating the top-level page. `arcade.requestSignIn()` is how
  you trigger a redirect.
- `window.open()` to an external link does work.

Your sync report flags off-origin references at publish time, so you find out
before players do rather than after.

## Files your repo may contain

- `index.html` — required, and it is the entry point.
- Any of: `html htm js mjs css json txt md png jpg jpeg gif webp svg ico mp3 ogg wav woff woff2`
- Limits: 200 files, 15 MB total, 5 MB per file. No symlinks. `.wasm` is not
  allowed yet.
