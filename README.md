# Mini Arcade 🕹️

A pocketful of fun browser games behind one menu. Pure vanilla HTML/CSS/JS — **no build step, no dependencies**. Just open it and play.

## 📱 Play on your phone (easiest)

This repo auto-deploys to **GitHub Pages**, so you get a link you can just tap open — no computer, no setup. The deploy workflow enables Pages for you on its first run, then publishes on every push to:

```
https://elc9939.github.io/testing/
```

> If the first deploy ever fails to self-enable, turn it on manually once at
> **Settings → Pages → Build and deployment → Source → "GitHub Actions"** and re-run the workflow.

Open that URL on your phone and play. To make it feel like a real app:

- **iPhone (Safari):** tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **⋮ → Install app** (or *Add to Home screen*).

It then launches full-screen from your home screen and **works offline** (it's an installable PWA). High scores are saved on your device.

> The Pages deploy publishes **only** the game files (`index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js`) — never `.env` or anything else in the repo.

## Play locally

Open `index.html` in any modern browser, or serve it:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000  (or http://<your-computer-ip>:8000 from a phone on the same Wi-Fi)
```

Press **Esc** or the **‹ Menu** button to return to the arcade at any time.

## The games

| Game | What it is |
| --- | --- |
| 🚀 **Star Drifter** | Dodge an endless asteroid storm. Grab orbs for points and 🛡️/🐢/✨ power-ups. |
| 🐍 **Neon Snake** | Classic snake — eat fruit, grow, don't crash. Speeds up as you go. |
| 🧱 **Brick Blaster** | Paddle-and-ball brick breaker with 9 increasingly tricky levels. |
| 🧠 **Memory Match** | Flip tiles to pair every emoji in the fewest moves. |
| 🎯 **Reaction Rush** | 30-second target-tapping frenzy with a combo multiplier. |
| ⭕ **Tic-Tac-Toe** | Face a flawless minimax AI. You can't win — but can you force a draw? |
| ⚔️ **Stick Arena** | Pick a class (Knight / Rogue / Lancer / Mage / Ranger), survive escalating waves of class bots, and turn the arena into a physics-heavy brawl. Left-click = main attack, right-click = special; aim with the cursor. Knock crates around, use platforms for space, and chain KOs for score. Want the older reach-the-flag platforming mode? Add `?classic` to the URL. |
| 🎯 **Neon Pinball** | A single-table pinball with real ball + flipper physics. Charge the plunger, flick the flippers (A/D, ←/→, or tap the table sides), light the bumpers, and ride the combo multiplier off the drain. |
| 🪐 **Orbit** | A gravity sandbox. Drag to fling planets around a star and watch them swing into glowing n-body orbits, pull on each other, and merge on contact. Chill and hypnotic. |
| 🔢 **2048** | The classic sliding-number puzzle with buttery tile animations. Swipe (or arrow keys / WASD) to merge equal tiles and chase 2048. |
| 🔴 **Four in a Row** | Connect Four against an AlphaZero-style AI: a small policy+value network, trained through the local AI lab (`ai/connect4`), guides an MCTS search you can watch "think." Learning Mode adds live coaching for center control, blocks, forks, and blunder checks. |
| 🃏 **Gambit** | A roguelike deckbuilder card battler. Pick a class (Knight / Rogue / Mage), spend energy on attack/block/ability cards, and beat foes that telegraph their next move. Draft a new card after each win and survive to the boss. |

## Project layout

```
index.html              arcade shell + menu (+ PWA meta & SW registration)
css/style.css           shared styling
js/arcade.js            framework: game registry, menu, lifecycle, helpers
js/games/*.js           one self-contained module per game
manifest.webmanifest    PWA manifest (installable app metadata)
sw.js                   service worker — caches everything for offline play
icons/                  app icons (192/512 for PWA, 180 for iOS)
scripts/gen-icons.js    regenerates the PNG icons (node scripts/gen-icons.js)
scripts/train-connect4.js  CLI wrapper for the Four-in-a-Row trainer
scripts/eval-connect4.js   quick local model evaluation
ai/connect4/            reusable rules, neural net, MCTS, training, evaluation
logminer/               standalone Java CSV log processing utility
.github/workflows/      GitHub Pages deploy + CI checks
```

## AI lab

The browser arcade only loads compact exported models. Training and evaluation
run locally in `ai/` so heavier experiments do not slow down the web app.

```bash
npm run ai:connect4:eval
npm run ai:connect4:train
```

For fast smoke tests, pass tiny positional arguments:

```bash
node scripts/eval-connect4.js 2 8
node scripts/train-connect4.js 1 2 8
```

The Connect Four trainer writes `js/games/connect4-weights.json`, which the
Four in a Row game loads at startup.

## LogMiner utility

`logminer/` is a standalone Java CLI for summarizing simple CSV event logs. It
expects non-recursive `.csv` inputs with this exact header:

```csv
timestamp,userId,action,bytes,status
```

Fields may be quoted with double quotes, and embedded quotes are escaped by
doubling them. Valid actions are `LOGIN`, `LOGOUT`, `UPLOAD`, and `DOWNLOAD`
(case-insensitive).

Run it from the repo root:

```bash
javac logminer/*.java
java logminer.Main --input path/to/logs --output path/to/out --threads 4 --topUsers 5
```

It writes `summary.json`, `summary.bin`, `users.csv`, and `errors.csv`.
Malformed data rows are counted and recorded in `errors.csv`; malformed headers
stop that file from being processed.

## Checks

GitHub Actions runs lightweight checks on every push and pull request. You can
run the same checks locally with:

```bash
npm test

# Or without npm:
node scripts/check-all.js

# Or run checks individually:
node scripts/check-js-syntax.js
node scripts/check-pwa-cache.js
node scripts/check-logminer.js
```

- JavaScript syntax checks for the arcade and helper scripts.
- PWA cache coverage for assets referenced by `index.html`, the web manifest, the arcade app catalog, and local assets fetched by app scripts.
- `javac logminer/*.java` plus a LogMiner smoke test.

### Adding an app

Each app gets a lightweight card entry in `js/app-manifest.js`:

```js
{
  id: 'mygame',
  name: 'My Game',
  emoji: 'game',
  desc: 'One-line pitch shown on the menu card.',
  color: '#5ef2ff',
  kind: 'game',
  src: 'js/games/mygame.js?v=1',
}
```

The app script is loaded only when its card is opened. Inside that script, the app
self-registers its runtime with the shell:

```js
Arcade.register({
  id: 'mygame',
  start(root, api) { /* mount your game into `root` */ },
  stop() { /* optional: clean up timers etc. */ },
});
```

The `api` passed to `start` provides managed helpers that auto-clean on exit:
`makeCanvas(root)`, `loop(cb)`, `on(target, type, fn)`, and `getBest/setBest(key)`
for persistent high scores. Add the script path to `sw.js` if it should work offline.

Enjoy! ✦
