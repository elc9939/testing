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
.github/workflows/      GitHub Pages auto-deploy
```

### Adding a game

Each game self-registers with the shell:

```js
Arcade.register({
  id: 'mygame', name: 'My Game', emoji: '🎮',
  desc: 'One-line pitch shown on the menu card.',
  color: '#5ef2ff',
  start(root, api) { /* mount your game into `root` */ },
  stop() { /* optional: clean up timers etc. */ },
});
```

The `api` passed to `start` provides managed helpers that auto-clean on exit:
`makeCanvas(root)`, `loop(cb)`, `on(target, type, fn)`, and `getBest/setBest(key)`
for persistent high scores. Add a `<script>` tag for the new file in `index.html` and it appears on the menu.

Enjoy! ✦
