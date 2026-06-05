# Stick Arena — Progression & Tactical Combat Design

Working design doc for the next evolution of **Stick Arena** (`js/games/stickrun.js`).
Captures two pillars agreed in design: (1) an ability-loadout progression with no
stat-soup, and (2) a slower, more tactical, terrain-driven combat feel.

Status: **design + prototype**. A standalone feel-prototype lives at
`js/games/arenatactics.js` (kind: `prototype`) to validate the combat pace in
isolation before integrating into the main game.

---

## Pillar 1 — Loadout progression (no stat soup)

Your whole character is **one pick per slot**. Every slot is a small branching
tree; you walk it and end with exactly one selection per slot.

| Slot | Branches into |
| --- | --- |
| 🔑 **Passive** | one *keystone* → a different keystone. **Rule-changers, never stats.** |
| ⚔️ **Attack** | basic swing → a variant (wide cleave / piercing thrust / guard-counter …) |
| **Shift** | mobility ability → variant |
| **E** | ability → variant |
| **Q** | ultimate → variant |

Rules:
- **Mutually exclusive** = the forks *inside* a slot. You run one version of your
  attack, one keystone, one ability per slot.
- **Mixing** = freely across slots, plus a few **synergy "fusions"**: specific
  pairings light a bonus (e.g. a *pull* ability + a *cleave* attack ⇒ the cleave
  hits the whole pulled cluster).
- **End state:** 1 passive + 1 attack + 3 abilities (Shift/E/Q).
- **No passive stacking:** exactly one keystone, swappable not stackable.
- Progression currency: clear a wave → **draft 1 of 3** (unlock an ability into a
  slot / swap a variant / choose-or-swap the keystone). Variants & keystone are
  re-draftable, so a build *evolves* rather than bloats.

### Keystones are rule-changers (examples)
- **Knight — Vengeance:** damage you block is stored; your next slash releases it
  as a shockwave.
- **Rogue — Bloodrush:** each KO refunds your dash and lets you pass through
  enemies briefly.
- **Lancer — Iron Stance:** stand still 1s → rooted but reflect projectiles and
  ignore knockback.
- **Mage — Resonance:** every 4th spell echoes a free copy at a nearby enemy.
- **Ranger — Pack Bond:** KO'd foes can rise as wolf allies (the keystone *is* the
  ally system as a build choice).
- **Neutral — Overload:** abilities cost HP instead of cooldown · **Echo:** recast
  your last ability once within 2s.

### Attack variants (examples)
- Knight slash → **Cleave** (wide) / **Thrust** (piercing knockback line) / **Riposte** (guard-counter).
- Each ability likewise has 2–3 variants framed around a *role*, not numbers —
  push / pull / wall / reposition (see Pillar 2).

---

## Pillar 2 — Slower, terrain-driven tactical combat

Shift the feel from fast brawler to **deliberate, spatial**. The key inversion:
**make raw damage slow, and make the terrain the efficient way to kill.** Then
every fight is "how do I use this room?"

### Pace knobs
- ~30% slower movement.
- Real attack **wind-up + recovery** (commitment, not mashing).
- Dashes on **cooldown** (no spam-dodge).
- **Fewer but tankier** enemies — 3–6 readable threats, not a swarm.

### The kill loop: **Stagger → Reposition → Environmental KO**
1. Hits build a **Stagger** meter (they don't just chip HP).
2. A **staggered** enemy is briefly stunned and takes **massive knockback**.
3. Use a **push / pull / launch** to send it **into the terrain** — a pit
   (ring-out = instant KO), spikes, an explosive barrel, a crusher.
4. HP-killing still works but is intentionally slow, so **positioning wins**.

### Terrain kit
Ledges & bottomless pits (ring-outs), spike strips, explosive barrels you shove,
crusher platforms, conveyor floors, chokepoints to funnel, high ground,
destructible cover.

### Enemy archetypes that demand tactics
- **Armored** — immune to damage; *only* environmental kills work.
- **Shieldbearer** — blocks from the front; flank or pull it around.
- **Charger** — bait its rush into a wall/hazard.
- **Caster** — break line-of-sight with cover.
- **Swarm** — herd together, then one hazard/AoE clears the cluster.

### Why the pillars fuse
The slower terrain combat gives the variant choices *meaning*: your loadout
becomes "what's my plan for **moving** enemies" — *push* for ring-outs/barrels,
*pull* to clump a swarm onto one hazard, *wall* to seal a chokepoint, *reposition*
to control spacing. Build-crafting and positioning become the same decision.

---

## Prototype scope (`arenatactics.js`)

A self-contained feel slice — **not** the full game — to validate the pace:
- Side-view arena: two ledges split by a **central bottomless pit**, a **spike
  strip**, walls with ring-out at the screen edges.
- Player stick fighter: slowed move + jump, a committed **attack** (windup→active→
  recovery), **Push** (shove + knockback, huge if target is staggered), **Pull**
  (yank nearest enemy toward you), **Dash** on cooldown.
- **Stagger meter** per enemy; staggered = stunned + 3× knockback.
- 3 enemies that walk in and **telegraph** a lunge; high HP so raw killing is slow.
- Win = clear them, mostly by knocking them into the pit/spikes. Lose = HP 0 or
  fall in the pit.

Goal: prove the **deliberate, positional** feel. If it lands, port the stagger +
ring-out + push/pull tools into `stickrun.js` and layer the loadout draft on top.

## Open questions / next
- Exact stagger numbers & decay; knockback scaling vs. enemy mass.
- Camera: fixed single-screen (prototype) vs. the scrolling arena.
- How the between-wave **draft UI** presents slot trees (reuse Gambit's draft UX).
- Synergy "fusion" list once the variant pools are locked.
