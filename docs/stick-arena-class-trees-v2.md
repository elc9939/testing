# Stick Arena Class Trees V2

Goal: design the trees before implementing more abilities. The previous pass
proved the data structure, but the abilities need stronger identity, clearer
animations, and more meaningful visual upgrades.

This doc drafts the major branches for each current class:

- Knight: Guardian, Avenger, Earthbreaker
- Rogue: Bladeslinger, Acrobat, Nightshade
- Lancer: Phalanx, Dragoon, Harpooner
- Mage: Graviturge, Stormcaller, Riftweaver
- Ranger: Sharpshooter, Trapper, Beastwarden

## Tree Rules

Each class has three major branches. A run should usually go deep into one
branch, with only a little hybrid flavor.

Branch shape:

```text
Class
|- Branch: Core fantasy
|  |- Root identity
|  |- Attack fork
|  |- Movement fork
|  |- Utility / object interaction
|  |- Q / ultimate
|  |- Keystone
```

Power curve:

- Tier 0: starting kit, readable and simple.
- Tier 1: branch identity; the player starts to feel the playstyle.
- Tier 2: first fork; choose how the branch solves problems.
- Tier 3: map/object interaction; the class starts using the room differently.
- Tier 4: ultimate; a big, clear moment that changes a fight.
- Tier 5: keystone; rule change that makes the build feel complete.

Every node needs:

- Gameplay effect: what changes mechanically.
- Animation read: anticipation, active moment, follow-through, recovery.
- Visual language: particles, trails, screen shake, silhouettes.
- Weapon/body upgrade: what looks different on the character.
- Map interaction: crates, barrels, walls, ledges, platforms, allies, enemy bodies.

## Class-Wide Mechanics

These are the systems that make each class feel different before any branch is
chosen. Branches should upgrade, bend, or spend these mechanics rather than
replace them.

### Knight: Guard And Resolve

The Knight has a forward guard cone and a Resolve meter.

- Blocking or taking reduced shield damage builds Resolve.
- A well-timed block gives extra Resolve and a stronger hit pause.
- Resolve is spent by heavier shield, counter, and ground-impact upgrades.
- The shield should visibly widen, crackle, or thicken as Resolve rises.
- The Knight moves a little slower while guarding, but should still be able to
  step, turn, and protect space without feeling frozen.

Branch hooks:

- Guardian spends Resolve on barriers, domes, and ally protection.
- Avenger stores blocked damage and releases it through counters.
- Earthbreaker turns Resolve into sword impact, shockwaves, and terrain hits.

### Rogue: Knives And Tempo

The Rogue has three physical knives and a Tempo meter.

- Thrown knives consume one knife and leave a recoverable knife on the ground.
- Knives slowly regenerate only if the Rogue is not already full.
- Melee chains build Tempo when the Rogue alternates hands, attacks from behind,
  or attacks shortly after movement.
- Tempo is lost when the Rogue waits too long, misses badly, or gets hit.
- The character should fidget with knives at idle only when at least two knives
  are available.

Branch hooks:

- Bladeslinger improves knife throwing as the main ranged archetype. Its later
  subpaths can become Trickshot, Bladecaller, or Volley.
- Acrobat converts slides, wall kicks, vaults, and aerial hits into movement
  offense. It should use body routes, not tiny melee timing checks.
- Nightshade uses smoke, partial invisibility, poison, and ambush windows. It
  creates safe openings instead of asking for parries or frame-perfect melee.

Current Rogue redraft:

- The older Duelist/Saboteur framing should be treated as superseded. In this
  game, melee range is too fast and noisy for a whole branch built around
  micro-parries, perfect counters, or tiny backstab timing windows.
- Rogue should be macro-trickery first: knife placement, routes through the
  arena, stealth windows, traps, and escapes.
- Bladeslinger is the general throwing branch. Bladecaller is a deeper magical
  knife-control subpath inside it, not the whole branch.
- Nightshade should remain readable: the player sees a faint silhouette in
  smoke/invisibility, while enemies lose target lock unless close or recently
  hit.

Proposed Rogue branch structure:

```text
Rogue
|- Bladeslinger: ranged throwing knives, stuck knives, recovery, burst
|  |- Trickshot: ricochets, wall pins, terrain-angle shots
|  |- Bladecaller: recalls, knife anchors, blade lines, zip/reel options
|  |- Volley: fast throws, fan knives, temporary spectral ammo
|- Acrobat: slides, vaults, wall kicks, aerial flips, route attacks
|- Nightshade: smoke, poison, partial invisibility, ambush and escape windows
```

### Lancer: Commitment And Brace

The Lancer has a Commitment state and a Brace meter.

- Lancer attacks choose a direction and commit to it for a short window.
- During commitment, the lance should have a clear lane and a long hurt line.
- Missing or being flanked is the weakness; holding space is the strength.
- Standing still, crouching, or attacking into incoming pressure builds Brace.
- Brace improves pins, wall hits, charge startup armor, and object shoves.

Branch hooks:

- Phalanx uses Brace to deny lanes and create spear walls.
- Dragoon spends Brace for longer, scarier charge windows.
- Harpooner uses Brace to anchor tethers and pull heavy objects or enemies.

### Mage: Focus And Float Control

The Mage has Focus and Float Control.

- Tapping jump gives a normal jump.
- Holding jump after the tap starts a slower controlled hover.
- Hover is not ammo; it is a movement state with capped height and slower travel.
- Casting builds small orbiting focus motes around the staff.
- Focus motes are spent by bigger spell effects, early detonations, portals, or
  chain reactions depending on branch.
- The staff should act as the center of intent: aim, pull, release, and recovery
  all read through the staff tip.

Branch hooks:

- Graviturge spends Focus to increase gravity field size, pull, and implosion.
- Stormcaller spends Focus on chained lightning and air movement bursts.
- Riftweaver spends Focus on swaps, portals, and delayed collapse zones.

Current Mage direction:

- Mage should not read as three colors of projectile. Mage should feel like the
  class that changes the rules of the arena.
- The staff is the source of intent. Startup, aiming, pull, release, recovery,
  and idle float should all be readable through staff position.
- Every spell needs visible cause and effect: staff action, field/force forming,
  objects or bodies reacting, then payoff.
- Focus motes orbit the staff and are spent on stronger fields, early
  detonations, chained effects, portals, or controlled movement.

Proposed Mage branch structure:

```text
Mage
|- Graviturge: mass, gravity, falling, hovering, pulling, crushing
|  |- Event Horizon: persistent gravity core, orbiting objects, implosion rhythm
|  |- Liftbinder: levitate enemies/objects, suspend hazards, controlled drops
|  |- Crusher: gravity slams, heavy knockdowns, terrain shockwaves
|- Stormcaller: air, lightning, momentum, smoother caster movement
|  |- Tempest Dancer: slower controlled flight, air casting, wind bursts
|  |- Chaincaller: lightning arcs through enemies, crates, metal/future water
|  |- Pressure Mage: gusts, projectile deflection, vortex wind lanes
|- Riftweaver: portals, swaps, echoes, delayed space collapse
|  |- Portal Architect: linked portals for projectiles, bodies, and objects
|  |- Echo Caster: decoys, delayed repeat casts, fake positions
|  |- Displacer: swaps, short blinks, enemy/object repositioning
```

### Ranger: Draw And Focus

The Ranger has a Draw state and Focus stacks.

- Holding attack draws the bow; release fires.
- The longer draw should visibly change body pose, string tension, and trajectory
  preview.
- Perfect releases build Focus.
- Moving, rolling, or getting hit reduces draw stability.
- Arrows come from a visible quiver and should be readable as individual shots.

Branch hooks:

- Sharpshooter spends Focus on precision, wall pins, pierce, and critical shots.
- Trapper spends Focus to arm stronger traps and object-trigger shots.
- Beastwarden spends Focus to command allies, mark targets, and coordinate
  pressure.

## Knight Branch 1: Guardian

Fantasy: a shield-first protector who wins by controlling space, blocking
pressure, and shoving enemies or objects into bad positions.

Core loop:

1. Raise shield or Guard Step into danger.
2. Absorb or interrupt an enemy action.
3. Bash, wall, or dome to reposition enemies and crates.
4. Protect allies and turn the arena into a shielded lane.

Visual language:

- Rectangular blue-white shield plates.
- Dust kicking forward from planted feet.
- Shield particles travel outward in straight panels, not sparkles.
- The shield visibly grows thicker as Guardian nodes are chosen.

Weapon/body progression:

- Tier 1: shield gains a bright rim.
- Tier 3: shield has a flat tower-shield silhouette during guard abilities.
- Tier 5: shield leaves faint panel afterimages during blocks and bashes.

### Root: Guardian Oath

Slot: branch identity / passive helper

Gameplay:

- First Guardian pick.
- Blocking or using Shield Bash grants one `Guard Plate`.
- Guard Plates are small charges used by later Guardian abilities.
- Max 2 plates early, max 4 after Keystone.

Animation read:

- On gain: shield flashes with a small rectangular plate snapping onto it.
- On spend: plate breaks outward in a flat shard.

Map interaction:

- Guard Plate spend increases shove force on crates, barrels, and enemies.

### Attack Fork

#### Shield-Cut

Slot: Attack

Gameplay:

- Replaces Slash with a safer sword cut from behind the shield.
- Shorter reach than normal Slash, but the front of the body is protected during
  the active frames.
- If a Guard Plate is available, the cut spends one to add a forward shove.

Animation read:

- Anticipation: shield comes up first, sword draws low behind it.
- Active: sword cuts around the shield edge.
- Follow-through: shield shoulder stays forward so the character reads protected.

Visual:

- Small blue rim on the shield, sword trail is shorter and tighter.

Map interaction:

- Good near ledges because the extra plate shove is horizontal.

#### Guard Breaker

Slot: Attack

Gameplay:

- Replaces Slash with shield edge hit into short sword thrust.
- Slower than Shield-Cut, higher stagger and better vs guarding enemies.
- If it hits a crate/barrel first, the object is punched forward harder.

Animation read:

- Anticipation: shield pulls back like a battering ram.
- Active 1: shield edge impact.
- Active 2: sword thrust follows the opening.
- Recovery: heavy shoulder recoil.

Visual:

- Shield impact ring, then a narrow sword glint.

Map interaction:

- Designed to punt boxes/barrels into enemies.

### Movement Fork

#### Guard Step

Slot: Shift

Gameplay:

- Short armored forward step.
- Reduces knockback while moving.
- Body-checks close enemies and nudges crates.
- Spending a Guard Plate makes the shove stronger but increases recovery.

Animation read:

- Anticipation: knees bend, shield drops to centerline.
- Active: one heavy step forward.
- Follow-through: shield remains high.

Visual:

- Two ground dust puffs and one rectangular shield afterimage.

Map interaction:

- Lets Knight move through clutter and create space without feeling fast.

#### Cover Hop

Slot: Shift

Gameplay:

- Short backward hop while facing forward.
- Leaves a tiny fading shield panel for a moment.
- More defensive than Guard Step, less shove.

Animation read:

- Shield stays pointed at the threat while legs hop backward.

Visual:

- Shield panel lingers briefly where the hop started.

Map interaction:

- Lets Knight retreat behind a crate or shield wall without turning around.

### Utility / Object Interaction

#### Shield Wall

Slot: E

Gameplay:

- Places a temporary physical shield wall.
- Blocks bodies and many projectiles.
- Can be shoved by Knight attacks, becoming a moving slab.
- Spending Guard Plates increases size/lifetime.

Animation read:

- Anticipation: shield plants into the ground.
- Active: a wall panel unfolds upward.
- Recovery: Knight pulls the arm back and returns to stance.

Visual:

- Blue-white rectangular wall with black outline, matching stickman style.

Map interaction:

- Creates cover, blocks lanes, traps enemies against ledges, and catches barrels.

#### Bulwark Bash

Slot: E alternative

Gameplay:

- Strong close-range shield bash.
- If enemy hits wall/crate/barrel within a short time, a second impact triggers.
- Spending Guard Plate widens the hitbox.

Animation read:

- Very readable wind-up: shield pulls behind shoulder.
- Impact is one clear forward slam.

Visual:

- Impact panel appears between shield and target.

Map interaction:

- Best when bashing enemies into solid terrain or objects.

### Ultimate

#### Rally Dome

Slot: Q

Gameplay:

- Creates a large temporary shield dome around Knight.
- Allies inside gain guard.
- Enemies and loose objects are pushed outward from the dome edge.
- Barrels pushed by the dome are armed and flash.

Animation read:

- Anticipation: Knight kneels and plants shield.
- Active: dome expands in one strong pulse.
- Follow-through: Knight rises slowly, shield held overhead.

Visual:

- Big translucent shield circle made of segmented panels.
- Strong but brief screen shake on expansion.

Map interaction:

- Clears space, protects allies, pushes crates/barrels into enemy paths.

### Keystone

#### Bulwark Heart

Slot: Passive / Keystone

Gameplay:

- Guard Plate max increases to 4.
- Blocking grants plates faster.
- Shield Wall, Guard Step, and Rally Dome spend all plates for stronger size,
  force, or duration.
- Knight becomes a true space-control tank, not a damage character.

Visual:

- Shield has permanent glowing panel lines.
- Plate count appears as small shield ticks around the character or ability bar.

## Rogue Branch 1: Duelist

Fantasy: close-range knife specialist who feels fast, precise, and stylish. Wins
with timing, flank angles, and burst windows.

Core loop:

1. Approach with quick movement.
2. Build Tempo through alternating knife hits.
3. Spend Tempo on a burst cut, dodge cut, or backstab.
4. Execute or escape before retaliation.

Visual language:

- Thin green knife arcs.
- Short afterimages, never big magical blasts.
- Particles are sharp slivers and small speed lines.
- Knives visibly become longer/curved as the branch deepens.

Weapon/body progression:

- Tier 1: knives gain bright green tips.
- Tier 3: offhand knife trails independently during combos.
- Tier 5: successful Tempo spends briefly leave two afterimage arms.

### Root: Duelist Tempo

Slot: branch identity / passive helper

Gameplay:

- Alternating knife hits build `Tempo`.
- Max 3 Tempo.
- Missing or throwing a knife pauses Tempo gain briefly.
- Later Duelist moves spend Tempo.

Animation read:

- Each Tempo gain: offhand knife twirls once in idle or recovery.

Visual:

- Small green pips orbit the dagger hand for a moment.

Map interaction:

- Tempo spend adds extra force near ledges, encouraging risky close-range setup.

### Attack Fork

#### Needle Chain

Slot: Attack

Gameplay:

- Replaces Twin Slash with fast stabbing chain.
- Lower knockback, higher hit consistency.
- Third successful hit spends 1 Tempo for a forward puncture.

Animation read:

- Anticipation: crouched shoulder coil.
- Active: quick direct stab, then offhand follow-up.
- Follow-through: small step through the target.

Visual:

- Narrow straight green line, not wide slash.

Map interaction:

- Good for pinning enemies near walls before a push move.

#### Cross-Cut

Slot: Attack

Gameplay:

- Wider dual-knife X slash.
- Slower than Needle Chain but better against groups.
- Spending Tempo makes the X slash push both enemies and small objects sideways.

Animation read:

- Both hands open wide.
- Knives cross at chest height.
- Character leans past the target, then snaps back.

Visual:

- Clear X-shaped slash trail.

Map interaction:

- Cuts through clutter and knocks small crates/barrels sideways.

### Movement Fork

#### Dodge Cut

Slot: Shift

Gameplay:

- Short evasive dash through or around an enemy.
- If passing close, spends 1 Tempo to cut during movement.
- No long invulnerability; it is positional, not a panic button.

Animation read:

- Body drops low.
- Lead foot slides.
- Knife hand flicks backward as the Rogue passes.

Visual:

- Thin afterimage along the dash path.

Map interaction:

- Lets Rogue slip behind enemies near walls or ledges for backstab setup.

#### Duelist Step

Slot: Shift

Gameplay:

- Very short step with low cooldown.
- If timed during enemy wind-up, next attack gains Tempo.
- Less distance than Dodge Cut.

Animation read:

- Small shoulder feint, foot tap, body angle changes quickly.

Visual:

- One small foot dust puff, no big effect.

Map interaction:

- Helps micro-position near crates or platform edges without overshooting.

### Utility / Object Interaction

#### Backstab Mark

Slot: E

Gameplay:

- Marks the nearest enemy in front for a short duration.
- If Rogue hits from behind, consumes mark for a strong shove.
- Marked enemy shows their vulnerable back direction.

Animation read:

- Rogue points one knife at the target.
- Target gets a small mark behind the torso.

Visual:

- Green dagger mark on the enemy's back side.

Map interaction:

- Backstab shove gets bonus force toward ledges, walls, or barrels.

#### Parry Flick

Slot: E alternative

Gameplay:

- Brief knife parry.
- If it catches a melee hit or projectile, Rogue flicks it sideways.
- Successful parry grants 2 Tempo.

Animation read:

- Knife comes up beside face, elbow tucked.
- On success, wrist flicks outward.

Visual:

- Tiny bright spark, then a sideways streak.

Map interaction:

- Can redirect arrows/bolts into crates or barrels.

### Ultimate

#### Blade Waltz

Slot: Q

Gameplay:

- Rogue performs a short targeted dash sequence between nearby enemies.
- Each hit chooses a different knife hand.
- Ends by launching the final target in the player's aimed direction.
- More Tempo increases number of dashes.

Animation read:

- Anticipation: Rogue crouches, both knives reverse-gripped.
- Active: three to five quick body reposition cuts.
- Recovery: slide stop with knives out to sides.

Visual:

- Multiple short afterimages, but each impact is punctuated with a clean slash.

Map interaction:

- Lets Rogue choose final launch direction into ledges, walls, barrels, or traps.

### Keystone

#### Perfect Rhythm

Slot: Passive / Keystone

Gameplay:

- Tempo max becomes 5.
- Spending Tempo does not clear all of it; only spends the required amount.
- Perfect alternating attacks reduce Shift/E cooldown slightly.
- Rogue becomes a high-skill burst class instead of an ammo-only class.

Visual:

- Knives occasionally spin during idle when Tempo is full.
- Full Tempo gives faint green outlines on both blades.

## Lancer Branch 1: Phalanx

Fantasy: disciplined lane controller. The Lancer is not fast; they own a line
and punish anything that enters it.

Core loop:

1. Plant the lance.
2. Threaten a long lane.
3. Pin enemies to walls/crates or hold them away.
4. Use spear walls and fortress lines to shape routes.

Visual language:

- Gold line indicators.
- Dust at planted feet.
- Lance tip glints before every threatening stab.
- Particles travel in straight horizontal bands.

Weapon/body progression:

- Tier 1: lance gains a brighter point.
- Tier 3: small banner/ribbon near the back hand.
- Tier 5: when braced, a faint gold line extends from the lance tip.

### Root: Brace Discipline

Slot: branch identity / passive helper

Gameplay:

- Standing mostly still for a short time enters `Braced`.
- Braced attacks have extra reach and reduced self-knockback.
- Moving too much cancels Braced.

Animation read:

- Feet widen.
- Back hand slides down the lance.
- Lance levels horizontally.

Visual:

- Small gold line from lance tip showing controlled lane.

Map interaction:

- Braced hits pin harder into walls, crates, and shield walls.

### Attack Fork

#### Pinning Thrust

Slot: Attack

Gameplay:

- Replaces Brace Thrust.
- If target is close to wall/crate/barrier, pins them briefly.
- Braced version has a longer pin window.

Animation read:

- Anticipation: lance draws straight back.
- Active: pure forward extension.
- Follow-through: Lancer holds point extended for a beat.

Visual:

- Gold impact spark at the lance tip.

Map interaction:

- Turns walls and crates into temporary crowd-control tools.

#### Sweeping Butt

Slot: Attack

Gameplay:

- Short back-end sweep with the butt of the lance.
- Covers close blind spot.
- Low damage, good stagger, knocks enemies low.

Animation read:

- Front hand keeps point forward.
- Back end swings across the legs.

Visual:

- Short low dust arc.

Map interaction:

- Trips enemies into crates, barrels, or one-way platform edges.

### Movement Fork

#### Brace Step

Slot: Shift

Gameplay:

- Small controlled step that preserves Braced if not spammed.
- Can step through light object clutter.

Animation read:

- Lance remains pointed forward.
- Feet slide instead of jumping.

Visual:

- Two gold foot marks behind the step.

Map interaction:

- Lets Lancer adjust lane control around crates/platforms.

#### Plant Pivot

Slot: Shift alternative

Gameplay:

- Plants lance tip, pivots body to face the cursor/direction.
- No travel, but very quick re-aim.
- Next attack gains pin force.

Animation read:

- Lance tip digs into ground.
- Body rotates around it.

Visual:

- Small circular dust around planted tip.

Map interaction:

- Excellent on multi-level platforms where enemies approach from both sides.

### Utility / Object Interaction

#### Spear Wall

Slot: E

Gameplay:

- Creates a temporary braced lance line.
- Enemies crossing it are poked and slowed.
- Projectiles are not blocked; bodies are controlled.

Animation read:

- Lancer plants lance, then a ghost line remains.

Visual:

- Faint gold horizontal line with small points along it.

Map interaction:

- Denies a platform edge, protects ledges, and funnels enemies into hazards.

#### Anchor Stake

Slot: E alternative

Gameplay:

- Fires/stabs a short anchor into a wall, crate, or enemy.
- Recasting pulls the target slightly toward the stake.
- Braced version pulls harder.

Animation read:

- Thrust into anchor point.
- Hand tightens on recall.

Visual:

- Thin gold tether from lance to anchor.

Map interaction:

- Moves crates/barrels into lanes or holds an enemy near a wall.

### Ultimate

#### Fortress Line

Slot: Q

Gameplay:

- Lancer plants and creates a full-screen-ish horizontal danger lane.
- Enemies in the lane are pushed to the line ends.
- Objects in the lane slide outward.
- Lancer cannot move during the active channel.

Animation read:

- Long anticipation: lance lowers, feet dig in.
- Active: a clean gold line flashes across the lane.
- Recovery: Lancer pulls lance back with visible effort.

Visual:

- Bright gold line with dust trails from every object/enemy pushed.

Map interaction:

- Can clear a platform, shove enemies to ledges, or line up barrels.

### Keystone

#### Iron Formation

Slot: Passive / Keystone

Gameplay:

- Braced state activates faster.
- Braced attacks ignore some incoming knockback.
- Spear Wall and Fortress Line last longer if cast while Braced.
- Lancer becomes a true lane-control class.

Visual:

- Braced stance adds a faint triangular gold base under the feet.

## Mage Branch 1: Graviturge

Fantasy: a staff caster who controls mass, verticality, and clusters. Mage wins
by moving enemies and objects together, not by raw damage.

Core loop:

1. Tag space with Gravity Bloom or Gravity Well.
2. Lift enemies/crates with Updraft.
3. Cluster enemies into one location.
4. Collapse the field or shove the cluster into terrain.

Visual language:

- Pink/magenta rings with white cores.
- Particles drift upward or orbit inward.
- The staff gets floating ring ornaments as the branch deepens.

Weapon/body progression:

- Tier 1: staff tip gets a small orbiting mote.
- Tier 3: staff has two rotating rings during gravity casts.
- Tier 5: Mage hover posture becomes more controlled, legs trailing behind.

### Root: Gravity Motes

Slot: branch identity / passive helper

Gameplay:

- Gravity abilities create `Motes`.
- Motes orbit the staff.
- Casting Gravity Bloom or Updraft consumes motes for stronger pull/lift.

Animation read:

- Each mote appears at the staff tip and joins a small orbit.

Visual:

- Small white/pink dots circling the staff.

Map interaction:

- Mote-enhanced abilities move crates and barrels more strongly.

### Attack Fork

#### Mass Bolt

Slot: Attack

Gameplay:

- Replaces Arc Bolt.
- Slower projectile, heavier push.
- On hit, target briefly becomes easier to pull/lift.

Animation read:

- Staff pulls backward as if the bolt is heavy.
- Projectile travels with a dense white core.

Visual:

- Thick bolt with orbiting dust specks.

Map interaction:

- Pushes crates/barrels more than normal bolt.

#### Orbit Bolt

Slot: Attack

Gameplay:

- Faster projectile.
- On hit, creates a small orbiting mote around the target.
- Next gravity field pulls that target harder.

Animation read:

- Staff flicks sideways, not forward.

Visual:

- Thin projectile that leaves a small ring on hit.

Map interaction:

- Sets up precise pulls rather than immediate knockback.

### Movement Fork

#### Float Step

Slot: Shift

Gameplay:

- Short controlled hover drift.
- Slower than a dash, but can cross small gaps and reposition while aiming.
- Casting during Float Step slightly bends the projectile downward/upward toward
  cursor.

Animation read:

- Feet lift and trail.
- Back hand steadies the staff like a rudder.

Visual:

- Soft upward particles under feet.

Map interaction:

- Lets Mage position over one-way platforms and gaps without high speed.

#### Gravity Brake

Slot: Shift alternative

Gameplay:

- Stops horizontal momentum quickly.
- Nearby enemies/objects keep moving, so Mage can dodge while crates/enemies
  slide past.

Animation read:

- Mage plants staff downward midair or on ground.

Visual:

- Small gravity ring appears around feet/staff base.

Map interaction:

- Useful around moving barrels/crates and platform edges.

### Utility / Object Interaction

#### Gravity Well

Slot: E

Gameplay:

- Creates a medium field at aimed location.
- Pulls enemies, crates, barrels, and ragdolls inward.
- Does low direct damage; value is positioning.

Animation read:

- Staff points to location.
- Hand closes into a fist as the well opens.

Visual:

- Ring expands, then particles stream inward.

Map interaction:

- Clusters objects/enemies for follow-up attacks or hazards.

#### Updraft

Slot: E alternative

Gameplay:

- Vertical gravity burst.
- Lifts enemies and objects.
- Stronger under crates/barrels than on enemies.

Animation read:

- Staff sweeps upward from ground to sky.

Visual:

- Vertical particle column, dust rising from floor.

Map interaction:

- Launches enemies onto platforms, into pits, or into aerial follow-up.

### Ultimate

#### Singularity

Slot: Q

Gameplay:

- Fires a seed that opens a large zero-gravity field.
- During field: enemies and objects drift toward center.
- End: implosion pulls everything inward, then pops it outward slightly.
- Motes increase radius and final pop.

Animation read:

- Long cast: Mage lifts staff overhead.
- Seed travels visibly.
- Field opens with a clear expanding ring.

Visual:

- Large magenta/white field, inward particle flow, final bright implosion.

Map interaction:

- Best around crates/barrels, ledges, or enemy clusters.

### Keystone

#### Resonant Gravity

Slot: Passive / Keystone

Gameplay:

- Gravity fields last longer.
- First enemy/object pulled into a field creates an extra small pulse.
- Motes persist between waves.
- Mage becomes a setup/control class with visible gravity rhythm.

Visual:

- Staff rings spin faster while a field is active.
- Motes pulse in sync with gravity wells.

## Ranger Branch 1: Sharpshooter

Fantasy: precision bow class. The Ranger reads the room, aims deliberately, and
turns walls, ledges, and crates into shot geometry.

Core loop:

1. Hold draw and choose angle.
2. Use trajectory, walls, and height.
3. Pin or pierce enemies/objects.
4. Finish with a high-commitment power shot or arrow storm.

Visual language:

- Cyan trajectory guides.
- Clean arrow trails, not noisy particle clouds.
- Pin shots create small impact crosses.
- The bow becomes larger and more angular as the branch deepens.

Weapon/body progression:

- Tier 1: bow limbs lengthen.
- Tier 3: arrow nock glows while fully drawn.
- Tier 5: full draw creates a steady cyan aim line.

### Root: Aim Discipline

Slot: branch identity / passive helper

Gameplay:

- Holding draw past a timing threshold grants `Focus`.
- Focus improves the next precision ability.
- Moving too much while drawing drains Focus.

Animation read:

- Bow arm fully extends.
- String hand anchors lower near cheek/chest, not above head.

Visual:

- Thin cyan line stabilizes as Focus builds.

Map interaction:

- Focus shots get bonus effects when hitting walls, crates, barrels, or ledges.

### Attack Fork

#### Power Draw

Slot: Attack

Gameplay:

- Heavier arrow with more knockback.
- Slower draw.
- Focus makes it shove enemies farther and arm barrels on hit.

Animation read:

- Archer leans backward slightly under tension.
- Release snaps the bow hand forward.

Visual:

- Thick arrow trail and small recoil shake.

Map interaction:

- Designed for ledge knockoffs and barrel setup.

#### Quick Draw

Slot: Attack

Gameplay:

- Faster, lower damage shot.
- Less knockback, better for interrupting enemies.
- Focus makes it refund a bit of draw/reload time.

Animation read:

- Smaller pullback.
- Faster nock-release cycle.

Visual:

- Short crisp cyan streak.

Map interaction:

- Better for triggering barrels/traps on demand.

### Movement Fork

#### Marksman Backstep

Slot: Shift

Gameplay:

- Backstep while keeping bow arm toward target.
- If used while drawing, preserves partial draw instead of canceling.

Animation read:

- Feet hop backward.
- Bow arm stays extended.
- String hand loosens but does not fully drop.

Visual:

- Small dust puff and a fading aim line.

Map interaction:

- Lets Ranger maintain aim while repositioning around crates/platforms.

#### High-Ground Roll

Slot: Shift alternative

Gameplay:

- Short evasive roll that ends in a crouched aiming stance.
- If landing on a one-way platform or higher ledge, next shot gains Focus.

Animation read:

- Body tucks into roll, then bow comes up at the end.

Visual:

- Low dust smear, then aim glint.

Map interaction:

- Rewards platform routing and high-ground shots.

### Utility / Object Interaction

#### Wall Pin

Slot: E

Gameplay:

- Fires a pinning arrow.
- If target is near wall/crate/barrier, pins briefly.
- If it hits a crate, pins crate in place for a moment.

Animation read:

- Longer aim hold.
- Release has a visible straight-line snap.

Visual:

- Impact cross and tiny vibration on pinned object/enemy.

Map interaction:

- Creates temporary terrain control and sets up ledge/barrel shots.

#### Piercing Line

Slot: E alternative

Gameplay:

- Fires a piercing arrow along a clean line.
- Passes through enemies and light crates.
- Focus increases pierce count.

Animation read:

- Bow held perfectly still.
- Body stops moving for the shot.

Visual:

- Long cyan beam-like arrow trail for a split second.

Map interaction:

- Can trigger barrels behind enemies or shove several bodies in a row.

### Ultimate

#### Deadeye Storm

Slot: Q

Gameplay:

- Ranger marks up to five aim points quickly.
- On release, fires a sequence of arrows along those lines.
- If no cursor targets are marked, fires a controlled fan in aimed direction.
- Focus makes the final arrow a Power Draw.

Animation read:

- Anticipation: rapid nock sequence, bow arm stable.
- Active: arrows release one after another, not all at once.
- Recovery: Ranger lowers bow and reaches toward quiver.

Visual:

- Thin cyan targeting ticks appear first, then arrows trace them.

Map interaction:

- Can hit barrels, pin enemies, or clear a platform lane.

### Keystone

#### Hunter's Focus

Slot: Passive / Keystone

Gameplay:

- Focus meter max increases.
- Full Focus shots get enhanced object interactions:
  - Power Draw arms barrels.
  - Wall Pin lasts longer.
  - Piercing Line pierces more objects.
  - Deadeye Storm final arrow becomes explosive knockback.
- Ranger becomes a deliberate precision/object-control class.

Visual:

- Full Focus creates a steady cyan glow along the bow string.
- The arrowhead glints before release.

## Knight Branch 2: Avenger

Fantasy: a counterattacker who invites pressure, blocks at the last moment, and
turns enemy force back into sword hits, shield sparks, and terrain shock.

Class-wide mechanic angle: Avenger turns Guard and Resolve into `Vengeance`.
Resolve still builds from blocking, but perfect blocks also store a portion of
the incoming hit as a visible charge. The branch should feel brave and reactive:
wait, catch, punish.

Visual language:

- Red-gold sparks on perfect blocks.
- Shield cracks glow briefly, then vent into the sword.
- Counter hits use sharper hit pause than Guardian, but shorter lingering VFX.
- At deep tiers the sword edge gains red-gold heat marks after a block.

Weapon/body progression:

- Tier 1: shield gets a small cracked center mark.
- Tier 3: sword flashes when Vengeance is stored.
- Tier 5: perfect block briefly shows a red-gold outline around the whole body.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Vengeance Guard | Passive | Perfect blocks grant `Vengeance` charges. Charges increase next counter effect. | Shield snaps up late, sparks inward, sword hand tightens. | Stronger counter force near walls and ledges. |
| 2 | Riposte Slash | Attack | After blocking, Attack becomes a fast sword cut that spends Vengeance for stagger. | Shield catches first, sword slices immediately from behind it. | Can rebound small crates into enemies. |
| 2 | Reprisal Edge | Attack | Slower heavy counter slash. More damage if hit within a short window after being struck. | Sword drags low, then carves upward with red-gold edge. | Ground scrape can arm barrels it passes through. |
| 2 | Counter Lunge | Shift | Short lunge toward the last attacker. Only strong when Vengeance is active. | Knight leans behind shield, then sword shoulder drives forward. | Punishes ranged enemies standing on platforms. |
| 2 | Iron Pivot | Shift | Quick defensive turn that keeps guard active while reversing facing. | Feet plant, shield stays up, body pivots under it. | Helps protect against enemies crossing over on one-way platforms. |
| 3 | Stored Shockwave | E | Releases stored Vengeance as a ground wave from shield or sword. | Knight slams shield edge down; red-gold line crawls along floor. | Wave travels through crates and detonates armed barrels. |
| 3 | Mirror Guard | E | Brief guard that reflects light projectiles and parries melee into knockback. | Shield tilts like a mirror; projectile leaves at a visible reflected angle. | Reflected shots can trigger barrels, traps, or pins. |
| 4 | Punish Quake | Q | Big radial punish. Damage/launch scales with recent blocked hits. | Shield plants, sword stabs ground, delayed quake pops outward. | Launches crates, barrels, ragdolls, and enemies away from Knight. |
| 5 | Unbroken Vow | Keystone | Taking lethal damage with high Vengeance consumes it to survive briefly and auto-pulse guard. | Body staggers backward, shield locks in front, red-gold cracks flare. | Survival pulse shoves enemies off ledges or away from allies. |

Feel target:

- Avenger should make the player look for enemy tells instead of constantly
  swinging.
- It should be satisfying even when defensive, because successful blocks create
  obvious stored power.
- Bad timing should leave the Knight ordinary and vulnerable, not useless.

## Knight Branch 3: Earthbreaker

Fantasy: a heavy sword bruiser who uses the ground, crates, and arena edges as
extensions of the blade.

Class-wide mechanic angle: Earthbreaker spends Resolve on `Impact`. Blocking is
still useful, but the branch wants to cash that defense into heavy sword slams
and floor control.

Visual language:

- Dust bursts, stone chips, and heavy white impact flashes.
- Sword trails are broad and low, not fast or elegant.
- Deep tiers add cracks in the floor that fade after the hit resolves.

Weapon/body progression:

- Tier 1: sword becomes wider and visibly heavier.
- Tier 3: sword leaves small floor sparks when dragged.
- Tier 5: heavy hits briefly bend the character's knees and shake nearby objects.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Impact Rhythm | Passive | Heavy attacks build Impact if they hit ground, enemies, or objects. Resolve can be spent to enhance Impact. | Sword shoulder drops; every heavy hit has visible recoil. | Crates/barrels gain more impulse from Knight hits. |
| 2 | Crush | Attack | Replaces Slash with a slow overhead chop. Big stagger, poor whiff recovery. | Sword lifts high, hangs for a beat, crashes down. | Breaks weak crates and launches barrel fragments upward. |
| 2 | Ground Splitter | Attack | Low forward sword slam that sends a short crack along the ground. | Sword tip scrapes floor before release. | Crack travels under enemies and pops small objects. |
| 2 | Stomp Launch | Shift | Short hop-stomp that launches close enemies/objects slightly upward. | Knight lifts one knee, drops weight hard. | Can bounce crates into enemies or start air juggles. |
| 2 | Shoulder Drive | Shift | Heavy shoulder step with sword braced behind. | Torso leans forward; sword trails behind like weight. | Moves through clutter and shoves barrels without attacking. |
| 3 | Crate Breaker | E | Targeted object smash. If it hits a crate/barrel/wall, creates a cone of debris force. | Sword pulls far behind back, then slams into object. | Turns crates into splash knockback tools. |
| 3 | Fault Plate | E | Raises a short temporary floor lip from the ground. | Sword hooks upward; ground panel kicks up. | Creates cover, trips chargers, bounces projectiles/objects low. |
| 4 | Faultline | Q | Long aimed ground fracture. Enemies hit are popped up, objects are thrown along the line. | Knight drags sword through floor, then rips it forward. | Can split a platform fight or fling barrels down a lane. |
| 5 | Aftershock Core | Keystone | Heavy hits leave delayed aftershocks. Hitting the same area again detonates them. | Dust ring remains, then thumps a second time. | Rewards fighting around terrain clusters and object piles. |

Feel target:

- Earthbreaker should feel slower than the base Knight but much more physical.
- The player should see the arena reacting to the sword.
- This branch should become the first big test case for destructible/object
  interactions.

## Rogue Branch 2: Saboteur

Fantasy: a knife trickster who wins by making the arena unsafe: ricochets,
tripwires, smoke slides, barrel triggers, and delayed explosions.

Class-wide mechanic angle: Saboteur changes the Rogue's three knives from ammo
into tools. A thrown knife is not "spent damage"; it becomes a trap, anchor, or
object trigger until recovered.

Visual language:

- Yellow-green warning glints on trapped knives.
- Thin tripwire lines, smoke puffs, and quick object flashes.
- Effects should be readable but sneaky: smaller than Mage, sharper than Ranger.

Weapon/body progression:

- Tier 1: knives get small ring loops on the handles.
- Tier 3: thrown knives leave faint wire trails.
- Tier 5: recovered knives spark briefly, showing trap readiness.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Trick Knives | Passive | Thrown knives stick into walls/crates/floor briefly before becoming recoverable. Stuck knives can be upgraded by later nodes. | Rogue tosses with a clean overhead throw; knife rotates minimally then sticks point-first. | Creates anchors on terrain and objects. |
| 2 | Ricochet Knife | Attack | Thrown knife bounces once off wall/crate before falling. Aim preview shows one bounce. | Overhead throw with wrist snap; bounce flashes yellow-green. | Rewards angled shots around platforms and crates. |
| 2 | Trap Cut | Attack | Melee cut primes a stuck knife nearby. Next enemy crossing it takes stagger. | Rogue slashes toward the planted knife, not just the enemy. | Turns existing knives into route denial. |
| 2 | Smoke Slide | Shift | Low dramatic slide that drops a smoke puff and briefly hides exact body position. | Body gets very low, back leg extended, knife hand skims floor. | Smoke breaks enemy aim and lets Rogue pass under some attacks. |
| 2 | Wire Vault | Shift | Vault over a stuck knife or crate, pulling the knife back during movement. | Rogue plants one hand/knife line, swings body over. | Recovers ammo while crossing obstacles. |
| 3 | Tripwire | E | Connects two stuck knives or a stuck knife and wall. Enemies crossing trip and fall. | Rogue flicks both hands outward; wire line tightens. | Uses walls, crates, and platforms as trap anchors. |
| 3 | Barrel Needle | E | Throws a low-damage knife that arms barrels/cracked crates without instantly detonating. | Careful two-finger throw; target flashes warning color. | Sets up delayed object explosions and chain reactions. |
| 4 | Explosive Knife | Q | Throws a knife that sticks, waits, then detonates. Recast detonates early. | Big overhead throw, Rogue leans back, knife flashes in pulses. | Sticks to enemies, crates, barrels, or walls; blast moves objects. |
| 5 | Trap Master | Keystone | Recovered knives keep one trap charge. First throw after recovery deploys faster and can chain with nearby traps. | Knife pickup spins into hand with a sharp green spark. | Encourages moving through the arena to reclaim and redeploy tools. |

Feel target:

- Saboteur should make the player think about where knives land.
- The arena should feel like a puzzle of angles, wires, barrels, and retrieval
  routes.
- The Rogue should still be quick, but this branch wins by setup rather than
  pure melee timing.

## Rogue Branch 3: Acrobat

Fantasy: a movement attacker who uses slides, wall kicks, vaults, aerial slashes,
and knockdowns to stay unpredictable.

Class-wide mechanic angle: Acrobat builds Tempo from movement. Sliding under an
attack, double-jump somersaulting near an enemy, or wall-kicking into a hit turns
mobility into offense.

Visual language:

- Green-white motion arcs around feet and knees.
- Knife trails follow body rotation, but limbs must tuck naturally.
- Effects should exaggerate the motion path without hiding the stick figure.

Weapon/body progression:

- Tier 1: knees/feet gain small green motion ticks during movement attacks.
- Tier 3: aerial knife slashes draw curved trails.
- Tier 5: successful movement chains leave brief full-body afterimages.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Flow State | Passive | Movement attacks build Tempo. Double jump near enemies grants a small Tempo burst. | Rogue's legs tuck during flips; arms counter-rotate with knives. | Rewards platform routes, walls, ledges, and gap crossings. |
| 2 | Slide Slash | Attack | Attack while crouching/sliding becomes a low slash. Trips enemies instead of launching. | Torso almost horizontal, lead knife cuts at shin height. | Slides under high attacks and knocks enemies into crates/barrels. |
| 2 | Vault Stab | Attack | Attack after jumping over an enemy becomes a downward stab. | Knees tuck, body rotates forward, knife points down. | Stronger when dropping from platforms or ledges. |
| 2 | Wall Kick | Shift | Kick off walls/crates/enemies for a diagonal burst. | Foot plants visibly, legs compress, body springs off. | Uses walls and big crates as movement surfaces. |
| 2 | Low Roll | Shift | Replaces old stiff roll with a short shoulder roll that ends crouched. | Head dips, knees tuck, spine curls, then feet plant under body. | Fits under some projectiles and sets up Slide Slash. |
| 3 | Leg Sweep | E | Close sweep that knocks enemies prone/low and changes their hitbox briefly. | Rogue drops one hand to floor and sweeps one leg. | Prone enemies slide farther on slopes/platform edges. |
| 3 | Vault Toss | E | Uses an enemy/crate as a vault point, tosses a knife downward during flip. | One hand plants, legs tuck, offhand throws at apex. | Can drop knives onto platforms below or recover from clutter. |
| 4 | Air Spiral | Q | Aerial multi-hit spiral. Direction is guided but not fully steerable. Ends with a chosen launch angle. | Body tucks/extends rhythmically, knives alternate around the spin. | Best through enemy clusters over pits, barrels, or spring traps. |
| 5 | Bloodrush Flow | Keystone | Movement Tempo spend refunds part of Shift on hit. Consecutive movement hits increase slide/jump control. | Green pulse travels from feet to knives after each hit. | Turns arena geometry into the Rogue's damage engine. |

Feel target:

- Acrobat should fix the current "rotated body" issue by defining actual poses:
  tuck, plant, spring, extend, recover.
- The branch should feel readable on mobile too; body silhouette matters more
  than flashy trails.

## Lancer Branch 2: Dragoon

Fantasy: a high-risk charging lancer. The player chooses a direction, commits to
it, and turns distance into devastating impact.

Class-wide mechanic angle: Dragoon spends Brace to strengthen Commitment. The
branch is powerful because it cannot casually stop or aim mid-charge.

Visual language:

- Long red-gold speed lines locked to a lane.
- Dust from both feet, lance level with the target line.
- Charge direction should be telegraphed before the body moves.

Weapon/body progression:

- Tier 1: lance tip gets a heavier triangular head.
- Tier 3: back half of lance gains a grip wrap/banner.
- Tier 5: full charge leaves a straight ground scar/dust line.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Charge Commitment | Passive | Charges lock direction at start. Brace reduces interruption but cannot cancel commitment. | Lancer lowers helmet/torso and levels lance before moving. | Direction choice matters around ledges and walls. |
| 2 | Skewer | Attack | Longer main stab that covers close and far range in one forward line. | Lance retracts, then fully extends point-first with no swing arc. | Pins enemies harder if they hit a wall during knockback. |
| 2 | Break Thrust | Attack | Shorter but armor-piercing thrust. Less range, more stagger on armored targets. | Back foot stomps, lance point punches forward. | Cracks crates/barriers directly in front. |
| 2 | Lance Charge | Shift | Long committed run. Big hit at lance tip, smaller body shove along shaft. | Three-part read: aim line, crouch, launch. | Can carry enemies into walls, pits, barrels, or spring traps. |
| 2 | Vault Pin | Shift | Shorter diagonal vault with lance downward. | Lance plants, body vaults forward, point lands first. | Crosses gaps/platforms and pins landing target. |
| 3 | Impale Carry | E | Next charge carries the first enemy/object hit for a short distance. | Target sticks on lance point with visible strain. | Carries enemies into walls/ledges; pushes barrels safely ahead. |
| 3 | Breaker Run | E | Briefly improves charge against objects and barriers. | Lance tip glows, feet kick heavier dust. | Smashes crates and triggers barrels at the end of the run. |
| 4 | Breaker Charge | Q | Very long unstoppable charge. Direction-only, no cursor steering after start. Huge damage and ring-out force. | Long anticipation, loud dust buildup, then one committed line. | Signature wall/ledge/barrel payoff tool. |
| 5 | Momentum Lance | Keystone | Consecutive committed hits build Momentum. Momentum boosts next charge distance/force but increases recovery on miss. | Speed lines lengthen with each stack. | Rewards choosing long lanes and punishes careless charges. |

Feel target:

- Dragoon should be scary because it is honest and committed.
- Every charge needs obvious startup, a clear lane, and heavy recovery.
- Good map design matters: lanes, platforms, blockers, and pits create the mind
  game.

## Lancer Branch 3: Harpooner

Fantasy: a control lancer who hooks enemies, crates, barrels, and bodies, then
reels them across the arena.

Class-wide mechanic angle: Harpooner uses Brace as anchoring strength. A braced
Lancer pulls harder and resists being dragged by heavier targets.

Visual language:

- Steel-blue chain/tether lines.
- Hook impacts use small metal sparks.
- Pulls should show tension: line straightens before movement begins.

Weapon/body progression:

- Tier 1: lance tip becomes a hooked head.
- Tier 3: chain coil appears near the rear hand.
- Tier 5: active tethers pulse with small blue ticks toward the Lancer.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Hook Point | Passive | Some attacks attach a short-lived tether. Braced tethers last longer. | Lance tip opens slightly on hit, tether snaps taut. | Can tether enemies, crates, barrels, and ragdolls. |
| 2 | Hook Thrust | Attack | Forward stab that hooks on tip hit. Re-attack yanks lightly. | Pure stab, then rear hand pulls back. | Pulls enemies off platforms or crates out of cover. |
| 2 | Chain Sweep | Attack | Low sweep with chain/lance butt. Catches close enemies and drags them sideways. | Lance tip stays forward while rear chain arcs low. | Moves enemies across spring traps/barrels. |
| 2 | Reel Step | Shift | Step backward while pulling tethered target. | Lancer braces, steps back, arms pull in sequence. | Creates spacing and drags targets toward ledges or walls. |
| 2 | Anchor Walk | Shift | Slow armored walk while tethered, preserving tension. | Body leans away from target, feet dig in. | Lets player reposition objects/enemies without breaking tether. |
| 3 | Chain Lance | E | Fires a longer hook projectile. On hit, creates a stronger tether. | Lance extends on chain; hand pays out line. | Reaches across gaps and platforms; pulls barrels from distance. |
| 3 | Anchor Pull | E | Plants lance into ground/wall and pulls all tethered targets toward anchor. | Lance tip digs in, chain tightens from target to anchor. | Can pull enemies into walls, pits, or object piles. |
| 4 | Maw Line | Q | Throws multiple hooks in a cone, then violently reels everything inward. | Hooks fan out, pause, then snap back together. | Clusters enemies/objects for ally attacks or barrel explosions. |
| 5 | Tether Master | Keystone | Tethers can bounce from enemy to nearby object. Pull effects no longer break immediately on first collision. | Tether flashes at collision and reconnects. | Complex object/enemy chaining becomes the branch identity. |

Feel target:

- Harpooner should be positional and clever, not fast.
- Tether lines must be readable at a glance so the player understands what will
  move when they press E/Q.

## Mage Branch 2: Stormcaller

Fantasy: a faster caster who rides wind, chains lightning, and turns grouped
enemies or metal/object clusters into electrical paths.

Class-wide mechanic angle: Stormcaller spends Focus motes on `Charge`. Charge
can improve lightning chains or give brief air movement bursts. Float becomes
more expressive, but not faster than walking by default unless a node spends
Charge.

Visual language:

- Yellow-white lightning with soft blue wind curls.
- Staff tip crackles before chain effects.
- Wind movement uses curved air streaks around limbs and robe/legs.

Weapon/body progression:

- Tier 1: staff tip becomes forked or has a small lightning prong.
- Tier 3: tiny sparks jump between staff and offhand while charged.
- Tier 5: hover leaves brief wind rings under the feet.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Static Charge | Passive | Casting while airborne or hitting grouped enemies builds Charge. | Sparks crawl from staff tip to hand. | Charge builds faster near metal/crate clusters or wet future surfaces. |
| 2 | Wind Bolt | Attack | Faster bolt with light knockback. Charge makes it chain once to a nearby target/object. | Staff whips forward; offhand trails behind for balance. | Chains through barrels/crates tagged conductive in future. |
| 2 | Arc Spear | Attack | Thin lightning shot. Rewards direct aim, less area control. | Staff held like a javelin, straight thrust. | Pierces light objects and tags walls with static. |
| 2 | Gust Hover | Shift | Brief air shove in aimed direction. Slower than Rogue dash, smoother than jump. | Mage leans into wind; legs trail naturally. | Crosses small gaps and repositions around platforms. |
| 2 | Downburst | Shift | Quick downward wind push that cancels float and pops nearby enemies outward. | Staff points down; body drops with controlled landing. | Slams onto platforms, moves crates away, escapes juggling. |
| 3 | Chain Spark | E | Lightning jumps between nearby enemies/objects. More jumps with Charge. | Staff traces a zig-zag line in air. | Strong against clustered enemies, barrels, future water/metal objects. |
| 3 | Static Field | E | Creates a small field that slows enemies and primes chain effects. | Staff circles once; field crackles low to the ground. | Turns choke points/platforms into electrical traps. |
| 4 | Tempest | Q | Large storm zone. Wind lifts lightly, lightning strikes charged or clustered targets. | Mage rises, staff overhead, offhand pulls storm inward. | Moves objects unpredictably but visibly; chains through grouped crates/barrels. |
| 5 | Overcharge | Keystone | At full Charge, next spell overcharges: bigger chain, stronger gust, or extra strike. Overcharge adds brief self-recovery lag. | Staff flashes white-yellow; body recoils after release. | Big payoff when enemies are grouped by terrain or allies. |

Feel target:

- Stormcaller should be the Mage branch that feels snappiest, but still caster
  readable.
- The player should see lightning paths before or as they chain.

## Mage Branch 3: Riftweaver

Fantasy: a spatial trickster who swaps positions, bends projectiles, and creates
short-lived portals that reward planning.

Class-wide mechanic angle: Riftweaver spends Focus motes on `Rift Marks`.
Marks are placed by staff hits, movement, or utility. Abilities become stronger
when cast through or near marks.

Visual language:

- Purple-blue oval rifts with pale edges.
- Portal effects are clean silhouettes, not full-screen distortion.
- Every teleport/swap needs an origin flash and destination flash.

Weapon/body progression:

- Tier 1: staff gains a crescent ring near the tip.
- Tier 3: Focus motes stretch into small oval marks.
- Tier 5: casting briefly duplicates the staff arm as an echo.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Rift Marks | Passive | Some spells leave short-lived marks. Casting near marks refunds small Focus. | Staff tip draws a small oval that fades in place. | Marks can sit on platforms, walls, crates, or enemies. |
| 2 | Staff Sweep | Attack | Close staff attack that places a Rift Mark on hit. | Mage steps in, both hands swing full staff length. | Pushes small objects and tags enemies/crates for later swap. |
| 2 | Portal Shot | Attack | Projectile exits from nearest mark if one exists, otherwise fires normally. | Staff points at mark first, then target line. | Shoots around walls/platforms using pre-placed marks. |
| 2 | Phase Step | Shift | Short blink through thin threats or across small gaps. Leaves mark at start. | Body compresses into oval flash, reappears with legs catching balance. | Repositions around ledges and one-way platforms. |
| 2 | Echo Drift | Shift | Slower hover drift that leaves a decoy echo for a moment. | Mage slides sideways while translucent echo lags behind. | Baits enemy pathing and projectiles around platforms. |
| 3 | Swap Sigil | E | Places sigil. Recast swaps Mage with sigil or swaps two marked enemies/objects if aimed. | Staff taps ground/air; both endpoints flash before swap. | Swaps barrels into enemies, enemies onto platforms, or self out of danger. |
| 3 | Rift Snare | E | Creates a small portal loop that slows and redirects enemies/projectiles inward. | Staff draws a circle, offhand pinches it closed. | Turns choke points into setup zones without pure damage. |
| 4 | Rift Collapse | Q | Opens several marks, then collapses them into one point, pulling marked targets. | Marks appear one by one, then snap together. | Repositions enemies/objects through walls/gaps if marked first. |
| 5 | Echo Keystone | Keystone | First spell after Shift repeats at the nearest Rift Mark at reduced strength. | Echo staff arm mirrors the cast from a mark. | Doubles object interaction if setup is good, weak if played randomly. |

Feel target:

- Riftweaver should feel clever and spatial, but not confusing.
- The UI/particles must show linked endpoints clearly before movement happens.

## Ranger Branch 2: Trapper

Fantasy: a preparation hunter who controls enemy routes with snares, caltrops,
mines, barrel shots, and terrain denial.

Class-wide mechanic angle: Trapper spends Draw Focus to arm stronger traps. The
bow still matters, but shots are often used to place or trigger objects.

Visual language:

- Orange-cyan trap markers.
- Small ground icons/rings that show armed vs unarmed.
- Quiver arrows gain wrapped heads or small capsules.

Weapon/body progression:

- Tier 1: quiver visibly holds special arrow heads.
- Tier 3: bow has a small tool charm or trap spool.
- Tier 5: armed traps pulse in sync with the Ranger's Focus.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Prepared Ground | Passive | Standing still or full-drawing near a trap gives Focus. Ranger can see trap radius. | Ranger glances down/sets feet before drawing. | Rewards holding lanes and platform routes. |
| 2 | Snare Arrow | Attack | Shot leaves a snare on terrain if it misses an enemy. Enemy hit is slowed. | Arrow has a small wrapped head; impact unfolds a loop. | Snares floors, platforms, crate tops, and wall-adjacent spaces. |
| 2 | Trigger Shot | Attack | Low-damage shot that detonates/activates traps and armed barrels from range. | Quick precise shot with bright orange impact tick. | Lets Ranger play object-combo setups safely. |
| 2 | Trap Roll | Shift | Short roll that drops a tiny caltrop behind. | Ranger tucks with bow held tight, hand flicks trap down. | Creates retreat routes and anti-chase paths. |
| 2 | Grapple Step | Shift | Fires a small line to a wall/crate and pulls Ranger a short distance. | Bow dips, line fires, body slides low. | Repositions between platforms or behind cover. |
| 3 | Caltrops | E | Tosses a small spread of caltrops. Enemies crossing take stagger and slow. | Offhand pulls pouch from belt/quiver and scatters low. | Controls ladders, ledges, platform tops, and choke points. |
| 3 | Spring Trap | E | Places spring trap that launches enemies/objects upward. | Ranger kneels quickly, trap snaps open on ground. | Launches crates/barrels/enemies for aerial shots or ring-outs. |
| 4 | Mine Volley | Q | Fires several trap arrows that land in an aimed arc and arm after a beat. | Rapid arrow sequence, each with orange landing ring. | Creates a temporary minefield across platforms or object piles. |
| 5 | Route Master | Keystone | First enemy to trigger a trap becomes marked. Marked enemies take stronger knockback from Ranger shots. | Trap trigger sends orange line back to Ranger's bow. | Combines route control with precision finishers. |

Feel target:

- Trapper should make the player think about enemy pathing.
- Traps need obvious arm states so deaths feel earned, not random.

## Ranger Branch 3: Beastwarden

Fantasy: a party-pressure Ranger who marks prey, commands allies/decoys, and
uses coordinated shots to herd enemies into hazards.

Class-wide mechanic angle: Beastwarden spends Focus on `Commands`. Commands
direct allied pressure or decoys. This branch is the first foundation for future
ally systems without adding too many permanent entities at once.

Visual language:

- Green-cyan command lines from Ranger to target/ally.
- Marks look like simple hunting chevrons, not magic circles.
- Ally/decoy effects should be readable as team pressure.

Weapon/body progression:

- Tier 1: quiver gains a small whistle/marker charm.
- Tier 3: bow string glows briefly when issuing commands.
- Tier 5: marked target has a stronger tracking chevron visible through action.

| Tier | Node | Slot | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| 1 | Hunt Mark | Passive | Fully drawn shots mark enemies. Allies/decoys prefer marked targets. | Ranger releases, then points two fingers toward target. | Marked enemies take extra hazard/object knockback. |
| 2 | Mark Shot | Attack | Reliable shot that applies/refreshes mark with lower damage. | Clean steady shot, small chevron appears over target. | Marked targets are easier for traps/objects/allies to push. |
| 2 | Cover Shot | Attack | Shot aimed near ally/decoy causes them to pressure in that direction. | Ranger fires slightly ahead of ally route. | Herds enemies toward ledges, traps, or barrels. |
| 2 | Pack Step | Shift | Backstep that calls a small decoy/ally pressure point at prior position. | Ranger hops back and whistles/gestures with offhand. | Baits enemies across platforms or through traps. |
| 2 | Rally Roll | Shift | Roll toward ally/decoy and gain Focus if ending nearby. | Body tucks, then rises facing target line. | Encourages team positioning rather than solo kiting. |
| 3 | Decoy Call | E | Places a temporary decoy that attracts enemies and can be shot to burst knockback. | Ranger raises offhand whistle; decoy pops in with simple silhouette. | Pulls enemies into barrels/traps/ledge lanes. |
| 3 | Pack Command | E | Orders ally/decoy to shove or harry marked target. | Bow points, command line flashes from Ranger to target. | Converts ally pressure into repositioning. |
| 4 | Hunt | Q | Marks a priority target and calls coordinated volleys/ally pressure for a short window. | Ranger plants feet, raises bow high, target gets large chevron. | Team attacks try to drive target toward nearest hazard or wall. |
| 5 | Pack Bond | Keystone | Marked target hits generate Focus for Ranger and nearby allies. Commands cooldown faster when used around terrain hazards. | Command lines pulse with each coordinated hit. | Makes ally/object/hazard setups the core playstyle. |

Feel target:

- Beastwarden should be the branch that introduces party play gradually.
- Even without full companion AI, decoys and command markers can prototype the
  team-fighting feel.

## Advanced Class Variations

The base branches above should be the early and mid-run structure. Advanced
variations are late-run evolution paths that unlock only when the player owns
specific lower-tier nodes.

Rules:

- A variation is not permanent account progression yet. It is a run-only build
  evolution.
- A variation should usually appear after wave 5, but only if its requirements
  are met.
- Picking a variation soft-locks future drafts toward its follow-up nodes.
- A run should usually finish with one advanced variation, not several.
- Each variation needs a new mechanic, a silhouette/stance change, and at least
  one map/object interaction.
- No advanced variation should be a simple damage/cooldown upgrade.

Offer logic:

```text
If requirements met:
  offer variation entry node in a draft
If variation entry owned:
  future drafts can offer its follow-up nodes
If 2 follow-up nodes owned:
  offer variation capstone / final rule change
```

Design goal: the player should be able to say "I am playing a Storm Dancer
Mage" or "I am playing a Ghost Saboteur Rogue", not just "I picked some Mage
upgrades."

### Knight Advanced Variations

#### Aegis Captain

Branch family: Guardian

Unlock requirements:

- Guardian Oath
- Shield Wall
- Guard Step or Bulwark Bash

New mechanic: `Formation Links`

- Shield Wall, Rally Dome, and allies can become linked cover points.
- Damage or knockback crossing a linked cover point is reduced.
- Knight gains Resolve when allies or cover points absorb hits.
- Links break if enemies pass through them or if cover is destroyed.

Stance / silhouette:

- Shield is held lower and wider, like a moving command wall.
- When linked cover exists, thin blue-white lines connect shield panels.
- The Knight's idle stance points the shield toward allies or the nearest lane.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Linked Cover | E upgrade | Aegis Captain | Shield Wall connects to nearby walls, crates, or allies. Linked cover reduces projectile/body force. | Shield panel unfolds, then link lines snap to valid anchors. | Turns crates, walls, and allies into a temporary bunker. |
| Intercept Step | Shift upgrade | Aegis Captain + Guard Step | Shift can target an ally/cover point and step into the lane between it and a threat. | Knight shoulder-checks into place with shield already raised. | Lets Knight protect allies from chargers or projectiles. |
| Captain's Rally | Q upgrade | Aegis Captain + Rally Dome or Linked Cover | Rally Dome becomes smaller but follows the linked group briefly. | Dome plates orbit outward, then settle around allies. | Moving protection for party fights and objective-style arena moments. |
| Last Line | Keystone | Any 2 Aegis follow-ups | If linked cover breaks from a hit, Knight releases a shove pulse and gains Resolve. | Broken panels burst outward, then shield flashes stronger. | Enemies who break cover can be shoved into pits, barrels, or walls. |

Why it is meaningfully different:

- Guardian controls space around self; Aegis Captain controls space around the
  team.
- It encourages staying near allies and cover instead of only bashing forward.

#### Vowbreaker

Branch family: Avenger / Earthbreaker hybrid

Unlock requirements:

- Vengeance Guard
- Stored Shockwave or Reprisal Edge
- Crush or Ground Splitter

New mechanic: `Pain Debt`

- Perfect blocks and heavy hits create Pain Debt on enemies.
- Debt is not damage yet; it marks stored punishment.
- Hitting terrain near a debt-marked enemy cashes the debt as a shock hit.
- If the enemy is near a wall/crate/barrel, the cashout is stronger.

Stance / silhouette:

- Shield is angled like bait while the sword rests low.
- Debt-marked enemies show a cracked red-gold line through the torso.
- Sword strikes produce heavy crack marks rather than clean arcs.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Debt Mark | Passive | Vowbreaker | Perfect blocks mark the attacker with Pain Debt. Heavy hits refresh it. | Block spark travels from shield to enemy as a cracked line. | Debt cashout gets bonus near walls, crates, barrels, and ledges. |
| Sentence Slam | Attack upgrade | Vowbreaker + Crush or Reprisal Edge | Heavy attack cashes Pain Debt if it hits ground near the enemy. | Sword hits floor first, then the enemy flashes a beat later. | Lets Knight punish enemies through terrain and object clusters. |
| Trial Pulse | E upgrade | Vowbreaker + Stored Shockwave | Sends a short pulse that only detonates debt-marked targets/objects. | Shield taps sword, pulse travels as thin red-gold wave. | Great for barrels, cracked crates, and enemies hiding behind cover. |
| No Escape | Keystone | Any 2 Vowbreaker follow-ups | Debt-marked enemies dragged/launched by terrain keep the mark longer. | Mark stretches as enemy moves, then snaps on cashout. | Encourages pinballing enemies through walls, shockwaves, and crates. |

Why it is meaningfully different:

- Avenger counters immediately; Vowbreaker delays punishment and uses terrain
  to cash it out.
- The player wants enemies near objects, not just in front of the shield.

#### Siege Knight

Branch family: Guardian / Earthbreaker hybrid

Unlock requirements:

- Guardian Oath or Impact Rhythm
- Shield Wall or Fault Plate
- Crate Breaker or Bulwark Bash

New mechanic: `Siege Objects`

- Knight can turn crates, broken barriers, and shield walls into heavy moving
  cover.
- Siege Objects take more force from Knight but less force from enemies.
- Some attacks ride behind the object, creating a slow push-line playstyle.

Stance / silhouette:

- Knight stands behind shield/object with sword held over the shoulder.
- Siege Objects get a white outline while Knight can command them.
- Heavy pushes show dust piling in front of the object.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Siege Push | Attack upgrade | Siege Knight | Attack behind a Siege Object shoves it forward and damages enemies it crushes. | Knight braces shoulder and sword against the object. | Turns crates/shield walls into moving hazards. |
| Lock Barricade | E upgrade | Siege Knight + Shield Wall or Fault Plate | Converts a wall/crate into a heavier barricade for a short time. | Shield/sword stamps a lock mark onto the object. | Creates temporary arena terrain. |
| Ramp Break | Shift upgrade | Siege Knight + Crate Breaker | Short heavy step that can climb/push over small obstacles while moving an object. | Knight plants foot on debris, heaves forward. | Lets Knight alter lanes without needing Mage-style float. |
| Castle Crusher | Keystone | Any 2 Siege follow-ups | Destroying a Siege Object creates a wide debris blast. Knight takes reduced force from it. | Object cracks, pauses, then explodes into dust/debris. | Makes object destruction a planned payoff. |

Why it is meaningfully different:

- Earthbreaker destroys objects; Siege Knight weaponizes objects as temporary
  terrain first.
- It makes the map feel moldable without full destructible-level complexity.

### Rogue Advanced Variations

#### Redline Duelist

Branch family: Duelist

Unlock requirements:

- Duelist Tempo
- Needle Chain or Cross-Cut
- Dodge Cut or Backstab Mark

New mechanic: `Redline`

- At max Tempo, Rogue enters Redline for a short window.
- During Redline, attacks are faster and alternate hands automatically if timed.
- Getting hit during Redline ends it and drops knives/Tempo.
- Redline is powerful but asks the player to stay close.

Stance / silhouette:

- Rogue crouches lower with both knives forward.
- Full Tempo creates two thin afterimage arms.
- The body leans toward the marked/flanked target.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Redline Entry | Passive | Redline Duelist | Full Tempo triggers Redline. First hit in Redline slows enemy recovery slightly. | Knives snap into reverse grip, screen hit pause is tiny but crisp. | Helps keep pressure near ledges/walls without huge knockback. |
| Heartbeat Stabs | Attack upgrade | Redline Entry + Needle Chain | Attack rhythm becomes three very fast stabs, then forced recovery. | Hands alternate clearly: right, left, right. | Excellent against pinned or cornered enemies. |
| Slip Counter | Shift upgrade | Redline Entry + Dodge Cut | Perfectly dodging through an attack extends Redline and cuts once. | Body slips under/around strike, offhand cuts backward. | Rewards fighting near clutter without getting stuck. |
| Finishing Beat | Keystone | Any 2 Redline follow-ups | Redline final hit executes low-health enemies or launches heavier targets. | Rogue pauses one beat, then both knives strike at different heights. | Converts corner pressure into ring-out or object impact. |

Why it is meaningfully different:

- Duelist is fast melee; Redline Duelist is a dangerous burst window with real
  risk.
- It should feel like choosing to stay in danger for style and damage.

#### Ghost Saboteur

Branch family: Saboteur

Unlock requirements:

- Trick Knives
- Smoke Slide or Tripwire
- Ricochet Knife or Barrel Needle

New mechanic: `Ghost Knives`

- Recovered knives leave a temporary ghost copy at the pickup spot.
- Ghost copies can trigger tripwires, smoke puffs, or delayed decoy slashes.
- Real knives remain the ammo limit; ghost knives are short-lived echoes.

Stance / silhouette:

- Rogue holds one real knife high and one low, as if ready to misdirect.
- Ghost knives are transparent yellow-green outlines.
- Smoke effects should reveal silhouette edges rather than hide everything.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Ghost Pickup | Passive | Ghost Saboteur | Picking up a thrown knife leaves a ghost knife behind briefly. | Knife spins into hand; transparent copy sticks in old spot. | Creates trap value from ammo recovery routes. |
| Phantom Wire | E upgrade | Ghost Pickup + Tripwire | Tripwire can connect real knife to ghost knife. Ghost end lasts shorter. | Wire flickers at ghost end so players know it is temporary. | Lets Rogue make quick traps while moving. |
| Vanish Slide | Shift upgrade | Ghost Pickup + Smoke Slide | Slide through a ghost knife detonates smoke and refunds a little slide cooldown. | Body passes through ghost, smoke peels off behind. | Lets Rogue cut through enemy lines and break bot aim. |
| Murder Board | Keystone | Any 2 Ghost follow-ups | Real and ghost knives form a visible trap network. First enemy hit by the network is marked for bonus backstab force. | Lines briefly connect all knives like a planning board. | Turns the arena into a route puzzle. |

Why it is meaningfully different:

- Saboteur sets traps; Ghost Saboteur makes movement and knife recovery part of
  the trap plan.
- It encourages constantly moving through your own setup.

#### Skyblade Acrobat

Branch family: Acrobat

Unlock requirements:

- Flow State
- Wall Kick or Vault Stab
- Leg Sweep or Air Spiral

New mechanic: `Aerial Flow`

- Rogue builds Aerial Flow while airborne after a wall kick, vault, or double
  jump somersault.
- Aerial Flow changes some attacks into diving, bouncing, or landing moves.
- Landing poorly drops Flow; landing with a hit converts it into Tempo.

Stance / silhouette:

- In air, knees tuck first, then extend for attack.
- Arms and knives counter-rotate so the body does not look like a flat sprite
  being spun.
- Landing pose is low and springy, not upright.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Tucked Flip | Passive | Skyblade Acrobat | Double jump gains a proper tuck pose and builds Aerial Flow near enemies/objects. | Knees pull to chest, head follows arc, arms guard center. | Makes gaps/platform routes part of offense. |
| Heel Rebound | Shift upgrade | Tucked Flip + Wall Kick | Kicking an enemy, wall, or large crate rebounds Rogue diagonally. | Foot plants, leg compresses, body springs away. | Turns enemies and crates into movement surfaces. |
| Diving Needle | Attack upgrade | Tucked Flip + Vault Stab | Air attack becomes downward stab that pins briefly on wall/floor impact. | Body extends from tuck, knife points down, offhand balances. | Strong from platforms and over ledges. |
| Spiral Landing | Keystone | Any 2 Skyblade follow-ups | Air Spiral or aerial hits end in a controlled landing slash if aimed toward ground. | Spin slows into a crouched two-knife landing cut. | Fixes air recovery and gives clean finish near platforms/barrels. |

Why it is meaningfully different:

- Acrobat moves aggressively; Skyblade Acrobat turns the air itself into the
  combo space.
- This directly targets the unnatural somersault/roll animation problem.

### Lancer Advanced Variations

#### Pike Captain

Branch family: Phalanx

Unlock requirements:

- Brace Discipline
- Spear Wall
- Pinning Thrust or Plant Pivot

New mechanic: `Command Lanes`

- Braced Lancer can paint a short lane on the ground.
- Allies and objects moving through the lane gain shove resistance.
- Enemies crossing the lane are slowed or poked depending on follow-up nodes.

Stance / silhouette:

- Lance is held perfectly horizontal with rear hand near the middle-back.
- A small banner/ribbon marks the lane direction.
- Feet plant wide; movement is minimal but deliberate.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Hold The Line | Passive | Pike Captain | Bracing creates a Command Lane in lance direction. | Gold lane line fades in from lance tip. | Lanes define platform control and bot path choices. |
| Ordered Thrust | Attack upgrade | Hold The Line + Pinning Thrust | Stabbing down a Command Lane extends hit reach and pin strength. | Lance tip glints, line brightens, then thrust fires. | Pins enemies to crates/walls at lane end. |
| Formation Step | Shift upgrade | Hold The Line + Brace Step or Plant Pivot | Shift moves along or rotates the lane without fully losing Brace. | Feet slide along lane marks. | Lets Lancer maintain control on uneven platforms. |
| No Passage | Keystone | Any 2 Pike follow-ups | Enemies crossing Command Lane trigger a free weak poke cooldown. | Ghost lance flicks from lane marker. | Creates a true denial zone without constant button presses. |

Why it is meaningfully different:

- Phalanx holds a line personally; Pike Captain turns that line into a team/arena
  rule.

#### Meteor Dragoon

Branch family: Dragoon

Unlock requirements:

- Charge Commitment
- Lance Charge
- Impale Carry or Breaker Charge

New mechanic: `Runway`

- Dragoon gets stronger the longer the straight committed path before impact.
- Runway is shown before charge as a red-gold lane.
- Turning is not allowed once the charge starts.
- Hitting a wall at bad angle stuns the Lancer briefly.

Stance / silhouette:

- Lance lowers completely level with the target line.
- Body leans almost parallel to the lance during full charge.
- Dust/speed lines grow only along the chosen direction.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Runway Read | Passive | Meteor Dragoon | Aim preview shows charge lane and impact tier based on distance. | Lane has one, two, or three intensity bands. | Helps choose platform lanes and avoid walls. |
| Overrun | Shift upgrade | Runway Read + Lance Charge | Charge can hit multiple enemies if first impact has enough Runway. | Lance punches through first target, body does not stop. | Carries momentum through crowds and crates. |
| Wallbreaker | E upgrade | Runway Read + Breaker Run or Impale Carry | Next charge does bonus object/barrier impact and creates debris at endpoint. | Lance head flashes heavy red-gold before charge. | Makes walls/crates/barrels charge targets, not obstacles only. |
| Falling Star | Keystone | Any 2 Meteor follow-ups | Charging from higher ground or after Vault Pin adds downward slam force. | Lancer drops from lane into target with lance angled down at end. | Rewards vertical maps and platform drops. |

Why it is meaningfully different:

- Dragoon is commitment; Meteor Dragoon is route planning.
- It should make the player scan the map for a runway before pressing Shift/Q.

#### Chain Warden

Branch family: Harpooner

Unlock requirements:

- Hook Point
- Chain Lance
- Anchor Pull or Reel Step

New mechanic: `Warden Anchors`

- Harpooner can create up to two persistent anchors on walls, crates, or floor.
- Tethers can connect enemy-to-anchor, object-to-anchor, or Lancer-to-anchor.
- Pull strength depends on Brace and anchor stability.

Stance / silhouette:

- Chain coils visibly near the rear hand.
- Active anchors have steel-blue spikes and short pulsing lines.
- Lancer leans away from tethered targets to show tension.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Warden Anchor | E upgrade | Chain Warden | E can place persistent anchor if aimed at terrain/object. | Lance tip fires, chain locks, anchor spikes open. | Creates reusable pull points around the arena. |
| Cross-Tether | Attack upgrade | Warden Anchor + Hook Thrust | Hooked targets can be attached to nearest anchor instead of only Lancer. | Tether redirects with a visible snap. | Pins enemies between wall/crate anchors. |
| Winch Step | Shift upgrade | Warden Anchor + Reel Step | Shift pulls Lancer toward anchor or pulls lighter anchor target toward Lancer. | Chain winds around rear hand; body slides with braced feet. | New traversal and object movement tool. |
| Dragnet | Keystone | Any 2 Warden follow-ups | Two anchors form a dragnet line. Enemies crossing are slowed and can be yanked. | Blue line hums between anchors, ticks toward center. | Arena-control version of Harpooner with strong chokepoints. |

Why it is meaningfully different:

- Harpooner pulls things directly; Chain Warden builds a tether network.
- This creates mechanics for future moving platforms, doors, and heavy objects.

### Mage Advanced Variations

#### Event Horizon

Branch family: Graviturge

Unlock requirements:

- Gravity Motes
- Gravity Well
- Singularity or Updraft

New mechanic: `Gravity Core`

- Mage can maintain one Gravity Core.
- Wells, blooms, and singularities near the core become stronger.
- The core can be moved slowly by Mass Bolt or staff gestures.
- Enemies/objects orbit briefly instead of instantly collapsing.

Stance / silhouette:

- Mage holds staff with both hands toward the core.
- Orbiting motes stretch into small rings around the core.
- Legs trail backward while hovering near active gravity.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Gravity Core | E upgrade | Event Horizon | First Gravity Well creates a movable core instead of disposable field. | Staff draws a circle; core condenses with orbiting debris. | Pulls crates, barrels, ragdolls, enemies into orbit. |
| Orbital Cast | Attack upgrade | Gravity Core + Orbit Bolt or Mass Bolt | Bolts can curve around the core or push it slightly. | Projectile bends visibly along a curved guide. | Lets Mage attack around walls/platforms using core position. |
| Core Step | Shift upgrade | Gravity Core + Float Step | Hover near core is slower but more controlled; Mage can orbit around it. | Body leans tangent to core, staff stabilizes path. | Gives unique gap/platform positioning without wall-climb assist. |
| True Horizon | Keystone | Any 2 Horizon follow-ups | Singularity consumes the core for a massive pull/implode/pop sequence. | Core darkens, all particles freeze, then collapse. | Signature object/enemy cluster payoff. |

Why it is meaningfully different:

- Graviturge creates fields; Event Horizon plays around one central object that
  both sides can see and plan around.

#### Storm Dancer

Branch family: Stormcaller

Unlock requirements:

- Static Charge
- Gust Hover or Downburst
- Chain Spark or Wind Bolt

New mechanic: `Air Casting`

- Mage can cast some spells while drifting, but each air cast adds instability.
- Instability makes hover wobblier until grounded or discharged.
- Perfectly timed Downburst clears instability and creates a shock ring.

Stance / silhouette:

- Staff becomes a balancing pole during hover.
- Back hand and legs trail naturally in wind direction.
- Lightning arcs from staff to foot/ground on discharge.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Air Casting | Passive | Storm Dancer | Cast during hover at reduced movement speed. Builds instability. | Staff points at target while body continues drifting. | Lets Mage use vertical routes without becoming too fast. |
| Wind Weave | Shift upgrade | Air Casting + Gust Hover | Shift after casting creates a curved gust path instead of straight shove. | Feet and robe/legs arc with wind trail. | Weaves around platforms and object clusters. |
| Lightning Step | Attack/E upgrade | Air Casting + Chain Spark | First chain target after air cast pulls Mage slightly along the chain direction. | Bolt lands, then Mage glides a short amount. | Uses enemies/objects as movement anchors. |
| Storm Rhythm | Keystone | Any 2 Dancer follow-ups | Alternating air cast and ground discharge gives Overcharge without full Focus. | Staff pulses high-low-high; landing shock ring shows rhythm. | Turns vertical positioning into spell economy. |

Why it is meaningfully different:

- Stormcaller is fast casting; Storm Dancer is controlled aerial spell rhythm.
- It should make Mage flight look intentional instead of weird hopping.

#### Portal Architect

Branch family: Riftweaver

Unlock requirements:

- Rift Marks
- Swap Sigil or Portal Shot
- Phase Step or Rift Snare

New mechanic: `Linked Portals`

- Mage can maintain two portal endpoints.
- Projectiles, light objects, and some enemies can pass through if properly
  aligned.
- Portals have facing; entering from the wrong side bumps instead of teleports.

Stance / silhouette:

- Staff is held vertically like drawing a doorframe.
- Endpoints have clear front-facing bright edge and dim backside.
- Mage's offhand points to the exit before the swap fires.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Portal Pair | E upgrade | Portal Architect | E places/updates two linked portal endpoints. | Staff draws oval one, then flicks to oval two. | Connects platforms, walls, and projectile lanes. |
| Lens Shot | Attack upgrade | Portal Pair + Portal Shot | Shots through portals gain speed/angle correction. | Trajectory preview bends through portal pair. | Enables trick shots around cover or into barrels. |
| Doorstep | Shift upgrade | Portal Pair + Phase Step | Shift through own portal is safer and refunds small Focus. | Mage steps through with full-body silhouette visible in oval. | First real terrain-crossing portal movement. |
| Grand Collapse | Keystone | Any 2 Architect follow-ups | Rift Collapse pulls through portal exits, not only toward Mage/cursor. | Endpoints glow, pull lines bend through them. | Creates advanced reposition combos with objects/enemies. |

Why it is meaningfully different:

- Riftweaver swaps and marks; Portal Architect changes the geometry of the map.
- It should be powerful only if the player sets clean endpoints.

### Ranger Advanced Variations

#### Deadeye

Branch family: Sharpshooter

Unlock requirements:

- Aim Discipline
- Power Draw or Wall Pin
- Piercing Line or Deadeye Storm

New mechanic: `Weak Points`

- Full-draw hits can reveal a weak point on enemies or objects.
- Shooting the weak point causes a special effect based on target type:
  stagger, disarm, barrel vent, crate shatter, armor crack.
- Weak points expire if Ranger moves too much or misses.

Stance / silhouette:

- Bow arm fully extends, body very still.
- Aim guide narrows into a small reticle at full draw.
- Weak points are small cyan diamonds, not huge UI markers.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Weak Point Read | Passive | Deadeye | Full draw reveals weak point if aim is steady. | Reticle shrinks, arrowhead glints, target diamond appears. | Weak points can appear on barrels, crates, shields, armor. |
| Heart Shot | Attack upgrade | Weak Point Read + Power Draw | Hitting weak point does high stagger/knockback, not pure damage only. | Bow release has strong recoil and sharp hit pause. | Can crack armored enemies or fling targets off ledges. |
| Thread The Needle | E upgrade | Weak Point Read + Piercing Line | Piercing Line can hit multiple weak points if aligned. | Cyan line highlights valid targets before release. | Rewards lining enemies through platforms/object gaps. |
| Stillness Pays | Keystone | Any 2 Deadeye follow-ups | Staying steady after a shot preserves partial Focus and reveals next weak point faster. | Ranger lowers bow only slightly, breath line stays calm. | Creates sniper rhythm in arena chaos. |

Why it is meaningfully different:

- Sharpshooter rewards aim; Deadeye rewards stillness, patience, and precise
  target anatomy.

#### Field Engineer

Branch family: Trapper

Unlock requirements:

- Prepared Ground
- Spring Trap or Caltrops
- Trigger Shot or Snare Arrow

New mechanic: `Trap Kit`

- Ranger carries a small kit with limited active trap parts.
- Picking up unused traps restores kit parts.
- Triggering object combos can temporarily overfill the kit.
- Trap placement becomes a route economy instead of cooldown spam.

Stance / silhouette:

- Quiver visibly shows trap capsules.
- Ranger kneels for bigger trap placement and keeps bow low.
- Armed traps pulse orange-cyan and show owner color.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Trap Kit | Passive | Field Engineer | Active trap limit becomes explicit. Reclaiming traps matters. | Ranger reaches to quiver/belt; kit ticks appear near ability bar. | Encourages maintaining an arena setup. |
| Remote Trigger | Attack upgrade | Trap Kit + Trigger Shot | Trigger Shot can activate any owned trap in line of sight. | Arrow impact sends orange line to trap. | Enables planned chain reactions. |
| Reinforced Spring | E upgrade | Trap Kit + Spring Trap | Spring Trap launches heavier enemies/objects and can be aimed slightly. | Trap compresses deeper before firing. | Launches barrels/crates/enemies into shots or pits. |
| Worksite | Keystone | Any 2 Engineer follow-ups | Standing near two owned traps grants Focus and faster trap arm time. | Ground between traps shows faint worksite grid. | Lets Ranger build a defensible arena zone. |

Why it is meaningfully different:

- Trapper controls routes; Field Engineer manages a limited physical setup.
- This gives the game a first pass at deployable-object economy.

#### Huntmaster

Branch family: Beastwarden

Unlock requirements:

- Hunt Mark
- Decoy Call or Pack Command
- Cover Shot or Hunt

New mechanic: `Pack Orders`

- Ranger can issue simple orders: pressure, hold, shove, bait.
- Orders target marked enemies or marked map points.
- Decoys/allies do not need full complex AI at first; they need reliable,
  readable behaviors.

Stance / silhouette:

- Ranger alternates between bow aim and command gestures.
- Command lines are green-cyan with arrowheads showing intent.
- Marked enemies show a hunting chevron and a small current-order icon.

Follow-up nodes:

| Node | Slot | Requires | Gameplay | Animation / Visual Read | Map Interaction |
| --- | --- | --- | --- | --- | --- |
| Pack Orders | Passive | Huntmaster | Marked targets unlock contextual ally/decoy orders. | Ranger points or whistles after shots. | Orders can target ledges, traps, barrels, and cover. |
| Bait Decoy | E upgrade | Pack Orders + Decoy Call | Decoy kites enemies toward a chosen point before fading. | Decoy backs away with visible lure line. | Pulls enemies into traps/platform edges/object setups. |
| Coordinated Push | E/Q upgrade | Pack Orders + Pack Command or Hunt | Ally/decoy pressure tries to shove marked target in player's aimed direction. | Command line flashes, ally/decoy shoulder-checks or fires. | Team ring-outs, barrel pushes, wall pins. |
| Alpha Signal | Keystone | Any 2 Huntmaster follow-ups | Q marks a priority target and all commands prefer it. Killing/ring-outing it refreshes one command. | Large chevron locks on target; allies/decoys briefly glow. | Gives party play a clear focus target. |

Why it is meaningfully different:

- Beastwarden applies pressure; Huntmaster becomes the first true party-command
  class variation.
- This should be built with simple, reliable orders before complex ally AI.

## Role Boundaries And Overlap Fixes

This tree is intended as the long-term plan. The special mechanics are the good
part and should stay, but each family needs a clear ownership boundary so the
classes do not collapse into the same playstyle.

### Protection Vs Lane Denial

Potential overlap:

- Knight Guardian / Aegis Captain
- Lancer Phalanx / Pike Captain

Final boundary:

- Knight protection is about `damage reduction`, `cover`, `allies`, and
  `moving safety`.
- Lancer lane denial is about `threat lines`, `pinning`, `spacing`, and
  `enemy movement restriction`.

Design rule:

- Knight creates safe space.
- Lancer creates dangerous space.
- Knight shield panels should block or reduce force.
- Lancer spear lines should threaten bodies crossing a lane.
- Aegis Captain can protect allies, but should not auto-poke enemies.
- Pike Captain can poke/pin enemies, but should not create shield-like cover.

### Trap Networks

Potential overlap:

- Rogue Saboteur / Ghost Saboteur
- Ranger Trapper / Field Engineer

Final boundary:

- Rogue traps are `knife-based`, `temporary`, `recoverable`, and tied to movement.
- Ranger traps are `prepared`, `visible`, `kit-limited`, and tied to route
  control.

Design rule:

- Rogue asks: "Where did my knives land, and how do I move through them?"
- Ranger asks: "Where will enemies path, and when should I trigger the setup?"
- Rogue traps should be fast, sneaky, and short-lived.
- Ranger traps should be clearer, more persistent, and more strategic.
- Ghost Saboteur gets ghost knives and moving trap networks.
- Field Engineer gets kit economy, reclaiming, and remote trigger chains.

### Pull And Reposition Control

Potential overlap:

- Mage Graviturge / Event Horizon
- Lancer Harpooner / Chain Warden

Final boundary:

- Mage pull is `area physics`, `mass`, `fields`, and `orbits`.
- Lancer pull is `single-target tension`, `anchors`, `chains`, and `line control`.

Design rule:

- Mage changes how space behaves.
- Lancer connects specific things with visible lines.
- Gravity should affect clusters and objects broadly.
- Tethers should affect selected enemies/objects with clear tension.
- Event Horizon centers the fight around one visible gravity core.
- Chain Warden centers the fight around two or more physical anchors.

### Aerial Movement

Potential overlap:

- Rogue Acrobat / Skyblade Acrobat
- Mage Stormcaller / Storm Dancer

Final boundary:

- Rogue air movement is `acrobatic burst`, `body skill`, `tucks`, `wall kicks`,
  and `knife finishers`.
- Mage air movement is `slow hover`, `casting control`, `instability`, and
  staff-guided drift.

Design rule:

- Rogue should look athletic.
- Mage should look suspended.
- Rogue uses the body as the weapon.
- Mage uses the staff as the center of control.
- Skyblade Acrobat gets fast arcs and landing cuts.
- Storm Dancer gets slower air casting and rhythm-based discharge.

### Team Play

Potential overlap:

- Knight Aegis Captain
- Ranger Beastwarden / Huntmaster

Final boundary:

- Knight team play is `protection`, `interception`, and `cover`.
- Ranger team play is `commands`, `marks`, and offensive pressure.

Design rule:

- Knight prevents allies from losing space.
- Ranger tells allies/decoys how to pressure a target.
- Aegis Captain should care about shielding the party.
- Huntmaster should care about directing the party.

### Heavy Impact

Potential overlap:

- Knight Earthbreaker / Siege Knight
- Lancer Dragoon / Meteor Dragoon

Final boundary:

- Knight impact is `grounded`, `object-heavy`, and `terrain-shaping`.
- Lancer impact is `directional`, `committed`, and `runway-based`.

Design rule:

- Knight makes the room move.
- Lancer becomes the moving spear.
- Earthbreaker/Siege Knight should alter objects and terrain around the player.
- Dragoon/Meteor Dragoon should reward choosing a clean lane and accepting
  recovery risk.

## Long-Term Implementation Contract

One big prompt can define the whole plan. The issue is not seriousness; the
issue is verification. A full tree like this has to be implemented in staged
passes so each mechanic gets real animation, hitboxes, particles, UI, AI, and
tests.

Definition of done for any special mechanic:

- It has a clear resource or rule in code.
- It has startup, active, follow-through, and recovery poses.
- Its weapon/body pose communicates intent before the effect lands.
- Its particles explain direction, timing, and impact without hiding the
  stick-figure silhouette.
- Its hitbox or field matches the visible weapon/effect.
- It appears in cooldown/resource UI.
- Bots can use or respond to it at least basically.
- It has one real object/map interaction.
- It has a smoke test or deterministic harness check where possible.

Suggested work cadence:

1. Design pass: write the tree and mechanics.
2. Foundation pass: animation state machine, hitbox debug, cooldown/resource UI,
   object tags, and draft/help data.
3. Vertical slice: one class-wide mechanic, one branch, one advanced variation.
4. Polish pass: make that one path feel excellent.
5. Repeat for the next class or branch family.
6. Bot pass: teach enemies/allies how to use and counter the new mechanics.
7. Balance pass: numbers, cooldowns, draft weights, mobile controls, and
   performance.

The tree should not be coded as "all nodes first, polish later." The better path
is "one mechanic family to quality, then expand."

## Ability Lab

The live game should include a controlled testing mode so new mechanics can be
played before they are balanced into normal runs.

Lab requirements:

- Accessible from the Stick Arena menu.
- Runs inside the real Stick Arena engine, not a fake separate mockup.
- Unlocks all ability slots for testing.
- Lets the player swap class and build preset without replaying waves.
- Includes controlled targets, enemy dummies, bots, crates, barrels, and spring
  traps.
- Has a reset button and a cooldown/resource refill button.
- Uses the normal cooldown bar and help screen so UI problems show up early.
- Should be mobile-checkable because touch-button overlap has been a repeated
  issue.

Implementation rule:

- Every advanced variation should first appear as a lab preset.
- A variation is not ready for normal drafts until it feels good in the lab.
- The lab can use prototype labels honestly. It is fine for a preset to say
  "Prototype" while the full mechanic is still being built.

## Redraft Notes Before Implementation

The current branch draft is strong enough as a structure, but several pieces
should be treated as placeholders until they receive clearer mechanics:

- Avoid nodes that only say "more damage", "more range", or "lower cooldown".
  Every node should alter timing, positioning, resource use, object interaction,
  or animation silhouette.
- Ranger reload and draw should be one coherent animation system before adding
  more arrow variants. Resting bow, nocking, drawing, release, and quiver refill
  need to be visible.
- Rogue aerial/roll/slide poses should be fixed before Skyblade/Acrobat nodes.
  The tree depends on real tuck, plant, spring, extend, recover poses.
- Lancer charge/stab should share one lance-lane hitbox model before Dragoon,
  Phalanx, or Harpooner get deeper mechanics.
- Mage float should be stable and slow first. Storm Dancer and Event Horizon
  should improve control/readability, not reintroduce jittery hover behavior.
- Knight shield/sword/body hitboxes should be split cleanly before Guardian,
  Avenger, and Earthbreaker effects are implemented.

Implementation principle: build fewer abilities at first, but make each one
have readable startup, real active frames, proper hitboxes, particles that tell
the player what happened, and recovery that feels physical.

## Implementation Notes For V2

Do not implement every node as a disconnected special case. Build the branch
system around shared verbs first:

- `guard`, `resolve`, `vengeance`, `impact`
- `knife`, `tempo`, `trap`, `recover`
- `brace`, `commit`, `charge`, `tether`
- `focus`, `float`, `field`, `portal`, `chain`
- `draw`, `mark`, `trap`, `command`

Every ability implementation should include:

- Startup pose.
- Active pose and hitbox/field timing.
- Follow-through/recovery pose.
- Cooldown/resource UI icon state.
- One clear particle family.
- At least one map/object interaction.

Recommended implementation order:

1. Class-wide mechanics and UI.
2. One complete branch end to end.
3. Shared object verbs: crate impulse, barrel arm/explode, spring launch,
   wall/platform tags, ledge bonus.
4. Remaining branches as data-driven nodes.
5. Draft/help screens with branch and tag previews.
