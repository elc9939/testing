import RAPIER from '@dimforge/rapier2d-compat';
import { Application, Graphics, Text, type Ticker } from 'pixi.js';

export interface StickArenaLabHandle {
  destroy(): void;
  reset(): void;
}

export interface StickArenaLabOptions {
  onTelemetry?: (event: { type: string; payload: Record<string, unknown> }) => void;
}

interface BodySprite {
  body: RAPIER.RigidBody;
  view: Graphics;
  width: number;
  height: number;
}

function makeBox(app: Application, world: RAPIER.World, x: number, y: number, width: number, height: number, color: number, dynamic = false): BodySprite {
  const bodyDesc = dynamic
    ? RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y)
    : RAPIER.RigidBodyDesc.fixed().setTranslation(x, y);
  const body = world.createRigidBody(bodyDesc);
  const collider = RAPIER.ColliderDesc.cuboid(width / 2, height / 2).setFriction(0.9);
  world.createCollider(collider, body);

  const view = new Graphics().roundRect(-width / 2, -height / 2, width, height, 4).fill(color);
  app.stage.addChild(view);
  return { body, view, width, height };
}

export async function createStickArenaLab(container: HTMLElement, options: StickArenaLabOptions = {}): Promise<StickArenaLabHandle> {
  await RAPIER.init();

  const app = new Application();
  await app.init({
    antialias: true,
    background: '#10121f',
    resizeTo: container
  });
  container.replaceChildren(app.canvas);

  const world = new RAPIER.World({ x: 0, y: 36 });
  const bodies: BodySprite[] = [];
  let elapsed = 0;

  const title = new Text({
    text: 'Ability Lab: Rapier bodies + Pixi render layer',
    style: { fill: '#f5f7fb', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 16 }
  });
  title.x = 16;
  title.y = 14;
  app.stage.addChild(title);

  function seedArena(): void {
    for (const item of bodies) {
      world.removeRigidBody(item.body);
      item.view.destroy();
    }
    bodies.length = 0;

    bodies.push(makeBox(app, world, 320, 410, 560, 24, 0x4fb477));
    bodies.push(makeBox(app, world, 112, 315, 128, 18, 0x5aa9e6));
    bodies.push(makeBox(app, world, 520, 255, 132, 18, 0xf2c14e));
    bodies.push(makeBox(app, world, 380, 140, 96, 18, 0xff9f6e));

    bodies.push(makeBox(app, world, 235, 260, 34, 34, 0xb87cff, true));
    bodies.push(makeBox(app, world, 285, 226, 34, 34, 0xb87cff, true));
    bodies.push(makeBox(app, world, 485, 120, 34, 34, 0xb87cff, true));

    const hero = makeBox(app, world, 110, 220, 30, 46, 0xf5f7fb, true);
    hero.body.setLinvel({ x: 7.5, y: -5 }, true);
    bodies.push(hero);

    options.onTelemetry?.({ type: 'lab.reset', payload: { bodies: bodies.length } });
  }

  seedArena();

  const tick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    world.timestep = Math.min(1 / 30, ticker.deltaMS / 1000);
    world.step();

    for (const item of bodies) {
      const translation = item.body.translation();
      const rotation = item.body.rotation();
      item.view.x = translation.x;
      item.view.y = translation.y;
      item.view.rotation = rotation;
    }

    if (elapsed > 1800) {
      const crate = bodies.find((item) => item.body.isDynamic());
      crate?.body.applyImpulse({ x: 70, y: -115 }, true);
      elapsed = 0;
    }
  };

  app.ticker.add(tick);

  return {
    reset: seedArena,
    destroy() {
      app.ticker.remove(tick);
      world.free();
      app.destroy(true, { children: true, texture: true });
    }
  };
}
