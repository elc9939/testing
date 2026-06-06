# Stick Arena Tomorrow Morning Playtest Plan

Target: have a decently polished, running Stick Arena playtest by the morning of
June 7, 2026.

This is a playable vertical slice, not the final class-tree game. The goal is
to make the important fantasies testable in the real arena and Ability Lab so
the next passes can tune feel instead of debating abstract names.

## Playtest Pillars

1. Clear class fantasies over huge ability count.
2. Every new ability needs a readable body/staff/weapon intent.
3. Effects must move bodies, objects, or space in a way the player can see.
4. Draft/help/UI should tell the player what they currently have.
5. Ability Lab should make the important builds easy to test quickly.

## Must-Have Scope

### Rogue Redraft

Rogue branches for this slice:

- Bladeslinger: broad throwing-knife archetype.
- Acrobat: movement-route offense with slides, vaults, and aerial attacks.
- Nightshade: smoke, poison, partial invisibility, ambush, and escape windows.

Important Rogue playtest requirements:

- Existing knife ammo and pickup readability stays intact.
- Draft and help UI should no longer present Duelist/Saboteur as the main
  fantasy names.
- Ability Lab should expose at least one Bladeslinger, Acrobat, and Nightshade
  preset.
- Nightshade can be first-pass, but it must be readable: smoke/invisibility
  should show a faint silhouette to the player and break enemy aim briefly.

### Mage Redraft

Mage branches for this slice:

- Graviturge: gravity core plus resonance shockwaves.
- Pyromancer: big AOE, burn zones, ignition, explosions.
- Spiritbinder: defeated enemies become temporary followers or spirit charges.

Important Mage playtest requirements:

- Gravity Core is the flagship Graviturge mechanic. It must visibly pull
  enemies, dummies, crates, barrels, and ragdolls toward a readable point.
- Resonance should give Graviturge an outward payoff: staff pulse, shockwave, or
  implosion-then-blast. The player should understand the push/pull loop.
- Pyromancer needs one direct fire attack, one lingering fire zone, and one big
  Q/explosion-style payoff.
- Spiritbinder needs one simple summon/recruit loop: defeated enemies or lab
  targets create spirit charges, and the Mage can spend or release them as
  temporary allies.
- Lightning is not a main Mage branch for this slice. It can become a
  Pyromancer evolution later as Stormfire/Plasma.
- Riftweaver is deferred. Portals/swaps are future advanced material, not part
  of this playtest target.

## Ability Lab Requirements

The Ability Lab should support quick testing without needing a full run:

- Mage presets:
  - Graviturge Core
  - Pyromancer
  - Spiritbinder
- Rogue presets:
  - Bladeslinger
  - Acrobat
  - Nightshade
- Tools:
  - Reset
  - Ready cooldowns
  - Spawn dummy/enemy/bot
  - Spawn crate/barrel/spring
  - Toggle hitboxes

## UI Requirements

- Bottom cooldown buttons should clearly show Attack, Secondary, Shift, E, Q,
  and passive/current branch information.
- Help screen should show current ability names, descriptions, branch labels,
  and tags.
- The top HUD should stay lightweight. Avoid turning it into a text wall.

## Implementation Strategy

Work in small vertical slices:

1. Update branch labels/data so the game stops advertising stale Rogue and Mage
   plans.
2. Add or expose Ability Lab presets for the new branch identities.
3. Implement Mage Pyromancer and Spiritbinder first-pass mechanics using shared
   verbs: projectile, field, radial impulse, particles, burn/poison/status, and
   ally spawn.
4. Add one Graviturge resonance payoff around the existing Gravity Core.
5. Keep each pass checkable with `scripts/check-all.js` and a browser smoke
   test.

## Cut Line

If time gets tight, prioritize:

1. Stable running game with no syntax/PWA failures.
2. Mage Graviturge Core, Pyromancer, and Spiritbinder visible in Ability Lab.
3. Rogue branch names/presets corrected.
4. Help/cooldown UI accurately describing current abilities.
5. Polish and balance after the mechanics are visible.

Do not chase a complete final tree before the playtest. The important thing is
that each branch has one or two real, readable actions that feel different.
