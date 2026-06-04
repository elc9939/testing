# AI Lab

Local experiments for game-playing agents live here. The arcade should stay
lightweight and browser-friendly; heavier training, evaluation, and self-play
belong in this folder.

## Connect Four baseline

The first lab target is Four in a Row. It uses a tiny dependency-free
policy/value neural net plus Monte Carlo Tree Search.

```bash
npm run ai:connect4:eval
npm run ai:connect4:train
```

The trainer writes browser-ready weights to:

```text
js/games/connect4-weights.json
```

Use smaller numbers when testing quickly:

```bash
node scripts/train-connect4.js 1 2 8
node scripts/eval-connect4.js 2 8
```

The long-term pattern is:

1. Keep each game's rules pure: state, legal moves, next state, reward.
2. Train locally from self-play or recorded games.
3. Export compact model data for the browser.
4. Let the browser run fast inference and lightweight search only.
