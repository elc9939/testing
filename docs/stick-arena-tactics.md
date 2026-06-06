# Stick Arena — Progression & Tactical Combat Design

Working design doc for the next evolution of **Stick Arena** (`js/games/stickrun.js`).
Captures two pillars agreed in design: (1) an ability-loadout progression with no
stat-soup, and (2) a slower, more tactical, terrain-driven combat feel.

Status: **in-game (`stickrun.js`)**. The loadout/ability/UI system now lives in the
real **Stick Arena** game and we build directly on it.

> **Direction (decided 2026-06):** all this work targets **Stick Arena
> (`js/games/stickrun.js`)** — the existing game — *not* a clean-room prototype.
> The standalone `js/games/arenatactics.js` prototype went too far from the
> intended Stick Arena feel, so it has been **retired and disabled** (removed from
> the launcher catalog; the file is left in the repo only for reference and can be
> deleted). Do not invest further in `arenatactics.js`; evolve `stickrun.js`.

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

## Prototype scope (`arenatactics.js`) — RETIRED

> Kept for historical reference only. The prototype is disabled (not in the
> launcher); the live system is in `stickrun.js`. See the integration passes below.

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

**Implemented in the prototype so far** (both pillars, end-to-end slice):
- 3 escalating waves; clear a wave → **draft 1-of-3** that forks one slot or swaps
  the keystone (de-duped across slots, re-draftable so a build evolves).
- Loadout slots wired to real behavior: **Attack** (Slash → Cleave / Thrust),
  **E** (Push → Launch), **Q** (Pull → Vortex), **Shift** (Dash → Blink), and a
  **keystone Passive** (Momentum / Executioner / Bloodrush).
- One **fusion** live: Cleave + Vortex makes the wide swing rip a pulled cluster
  harder (+60% stagger).
- Pillar-2 archetypes seeded: **Armored** (damage-immune, terrain-only kills) and
  **Charger** (commits a long rush you bait into a hazard).
- Pace tuned ~25% slower with stickier stagger decay and heavier ring-out
  knockback.

**Class + ability-tree pass (current):**
- **Class select** with all 5 classes — Knight / Rogue / Lancer / Mage / Ranger —
  each with its own HP, move speed, starting kit, and class-scoped draft tree.
- **Data-driven ability engine:** abilities are specs (`kind` + params) dispatched
  by a small set of effect primitives (melee, ranged bolt, dash, push/launch,
  pull/vortex, shockwave, volley), so new kit is mostly data.
- **Signature keystones from the doc**, implemented: Knight **Vengeance** (stored
  damage → next-hit shockwave) & **Bulwark**; Rogue **Bloodrush** & **Assassinate**;
  Lancer **Iron Stance** (root → ignore knockback, heavy next hit); Mage
  **Resonance** (every 4th bolt echoes); Ranger **Pack Bond** (KO'd foes rise as
  wolf allies) & **Hunter's Mark**; plus neutral **Momentum / Executioner /
  Overload** draftable by any class.
- **Ranged combat:** projectile bolts (Mage bolts/frost, Ranger arrows/power/multi/
  volley); **slow** status (Frostbolt / Snare); **wolf-ally pets** (Pack Bond).
- **HP death now works** (slow, as designed) alongside terrain ring-outs.

**UI pass (current):**
- Decluttered top bar — class chip + HP bar + wave/foes only.
- **Bottom ability bar** that doubles as the touch controls and shows live
  per-slot **cooldown fills**.
- **Help screen** (`?` / button) listing your current loadout — every slot's
  equipped ability name + description + keybind.

**Stick Arena integration pass (current):**
- `stickrun.js` now has the same first-pass loadout vocabulary as the prototype:
  Attack / Secondary / Shift / E / Q / Keystone, with descriptions and class
  scoped draft branches for all five classes.
- The live Stick Arena HUD is decluttered into a compact top status pill, while
  the bottom action bar shows per-slot names, ammo hints, locks, and cooldown
  fills.
- The `?` / `H` help screen lists the current class loadout and descriptions in
  the real arena game.
- Clearing a wave in arena mode now pauses into a 1-of-3 draft that swaps one
  slot or picks a keystone, then starts the next wave.

**Deep 5-class branching pass (current):**
- The live Stick Arena tree now keeps the existing five classes but gives each
  three major run-only branches:
  Knight (Bulwark / Avenger / Earthbreaker), Rogue (Duelist / Saboteur /
  Acrobat), Lancer (Phalanx / Dragoon / Harpooner), Mage (Graviturge /
  Stormcaller / Riftweaver), and Ranger (Sharpshooter / Trapper / Beastwarden).
- Drafts track `runBuild` branch points. Before commitment, offers try to show
  one pick from each branch; after two picks in one branch, the run soft-locks
  so two choices favor that branch and one remains a hybrid/physics option.
- Ability specs now carry branch, tier, tags, and effect data. Draft/help UI
  exposes branch names plus interaction tags such as Crates, Barrels, Walls,
  Ledges, Gravity, Traps, and Allies.
- The arena has first-pass physics objects: explosive barrels, spring pads, and
  temporary shield walls/traps. New ability primitives include line/radial
  object impulses, barriers, pulls/tethers, traps, chain lightning, rift swaps,
  gravity fields, decoys, and pack commands.

## Open questions / next
- Exact stagger numbers & decay; knockback scaling vs. enemy mass.
- Camera: fixed single-screen (prototype) vs. the scrolling arena.
- How the between-wave **draft UI** presents slot trees (reuse Gambit's draft UX).
- Synergy "fusion" list once the variant pools are locked.
