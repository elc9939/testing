# Mini Arcade 🕹️

A pocketful of fun browser games behind one menu. Pure vanilla HTML/CSS/JS — **no build step, no dependencies**. Just open it and play.

## Play

Open `index.html` in any modern browser (desktop or mobile).

Or serve it locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Press **Esc** or the **‹ Menu** button to return to the arcade at any time. High scores are saved in your browser.

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
index.html              arcade shell + menu
css/style.css           shared styling
js/arcade.js            framework: game registry, menu, lifecycle, helpers
js/games/*.js           one self-contained module per game
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
