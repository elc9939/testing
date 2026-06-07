#!/usr/bin/env node
'use strict';
/*
 * pose-shot.js — headless Pose Studio harness for Stick Arena.
 *
 * Two jobs, both dependency-free (vanilla repo rule):
 *
 *  1. SAFETY NET / regression gate (run with `--check`, also wired into
 *     `npm test`). It boots the whole game under a stub DOM + a NaN-checking 2D
 *     canvas, then:
 *       • validates weaponPose()/poseSkeleton() return finite geometry for every
 *         attack archetype across t = 0..1 (so a bad keyframe edit can't ship),
 *       • smoke-drives all five classes through the Ability Lab and the new Pose
 *         Studio render path for a few frames, asserting nothing NaN reaches the
 *         canvas and nothing throws.
 *
 *  2. EYES for poses (default mode). It writes an SVG "contact sheet" — the
 *     weapon-arm pose sampled across the whole swing, one frame per cell — so a
 *     pose can be *seen* without a browser. This is how Claude reviews/iterates
 *     on poses you author in the in-game Pose Studio.
 *
 * Usage:
 *   node scripts/pose-shot.js                 # validate + write pose-slash.svg
 *   node scripts/pose-shot.js crush out.svg   # contact sheet for 'crush'
 *   node scripts/pose-shot.js --check         # validate only (CI gate), no file
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'games', 'stickrun.js');

// ---------------------------------------------------------------------------
// Minimal, permissive headless DOM + a NaN-checking 2D context.
// ---------------------------------------------------------------------------
let nanError = null;
function noteNan(method, args) {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a)) {
      if (!nanError) nanError = `ctx.${method} got non-finite arg: ${a}`;
    }
  }
}
function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  const ctx = {
    canvas,
    save() {}, restore() {}, beginPath() {}, closePath() {}, stroke() {}, fill() {},
    clip() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, resetTransform() {},
    clearRect() {}, fillText() {}, strokeText() {},
    setLineDash() {}, drawImage() {}, createPattern() { return grad; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    measureText(s) { return { width: s ? String(s).length * 7 : 0 }; },
    getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {},
  };
  // methods whose numeric args we NaN-check
  for (const m of ['moveTo', 'lineTo', 'rect', 'fillRect', 'strokeRect', 'arc', 'arcTo',
    'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'roundRect']) {
    ctx[m] = (...a) => noteNan(m, a);
  }
  // settable style props
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'lineCap',
    'lineJoin', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'globalCompositeOperation',
    'miterLimit', 'lineDashOffset']) ctx[p] = 0;
  return ctx;
}
function makeEl(tag) {
  const children = [];
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children, attributes: {},
    _html: '', value: '', checked: false, disabled: false,
    width: 960, height: 540, clientWidth: 960, clientHeight: 540,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { children.push(c); return c; },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c; },
    append() {}, remove() {}, insertBefore(c) { children.push(c); return c; },
    setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; }, hasAttribute(k) { return k in this.attributes; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 }; },
    getContext() { return makeCtx(el); },
    querySelector() { return makeEl('div'); }, querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {}, closest() { return null; }, contains() { return false; },
    requestPointerLock() {}, scrollIntoView() {},
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = v; } });
  Object.defineProperty(el, 'textContent', { get() { return el._html; }, set(v) { el._html = String(v); } });
  return el;
}

function makeSandbox() {
  const documentStub = {
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    getElementById: () => makeEl('div'),
    querySelector: () => makeEl('div'),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
    hidden: false, visibilityState: 'visible',
  };
  const windowStub = {
    document: documentStub,
    devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
    location: { search: '', href: 'http://localhost/', hash: '' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; })(),
    performance: { now: () => Date.now() },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;
  windowStub.globalThis = windowStub;

  // the lazy-load shell: capture the registered game
  let registered = null;
  const Arcade = {
    define() {}, register(pub) { registered = pub; },
    games: {}, version: 'test',
  };
  windowStub.Arcade = Arcade;

  const sandbox = Object.assign({}, windowStub, {
    document: documentStub, window: windowStub, Arcade,
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, Symbol,
    Map, Set, WeakMap, WeakSet, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray,
    Int32Array, ArrayBuffer, isFinite, isNaN, parseInt, parseFloat,
    URLSearchParams, performance: windowStub.performance,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    cancelAnimationFrame: windowStub.cancelAnimationFrame,
    setTimeout: windowStub.setTimeout, clearTimeout: windowStub.clearTimeout,
  });
  sandbox.global = sandbox;
  return { sandbox, getRegistered: () => registered, getWindow: () => windowStub };
}

// ---------------------------------------------------------------------------
// Boot the game and grab its test API.
// ---------------------------------------------------------------------------
function boot() {
  const code = fs.readFileSync(SRC, 'utf8');
  const { sandbox, getRegistered, getWindow } = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'stickrun.js' });
  const pub = getRegistered();
  if (!pub || typeof pub.start !== 'function') throw new Error('stickrun did not register a start()');

  let testApi = null;
  getWindow().__stickTest = (api) => { testApi = api; };

  const canvas = makeEl('canvas');
  let loopCb = null;
  const api = {
    makeCanvas() { return { canvas, ctx: makeCtx(canvas), w: 960, h: 540, dpr: 1 }; },
    on() {}, onCleanup() {}, loop(cb) { loopCb = cb; },
    getBest() { return 0; }, setBest() {},
    perf: {
      particleCount: n => n, particleLimit: n => n, trailLimit: n => n,
      quality: () => 'high', snapshot: () => ({ tier: 'high', fps: 60 }),
    },
  };
  const root = makeEl('div');
  pub.start(root, api);
  if (!testApi) throw new Error('window.__stickTest was never called — no test API');
  return { testApi, loopCb: () => loopCb, root };
}

const ATTACK_TYPES = [
  'slash', 'crush', 'dualSlash', 'rogueStab', 'stab', 'braceThrust', 'lanceCharge',
  'throw', 'cast', 'arcaneBloom', 'spiritSummon',
  'pyroFirebolt', 'pyroIgnite', 'pyroBreath', 'pyroDragon', 'pyroGroundFlow',
  'arrow', 'volley', 'shieldBash',
];
const CLASSES = ['knight', 'rogue', 'lancer', 'mage', 'ranger'];

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function finitePt(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y); }

function validate(testApi, loopCb) {
  // 1) every attack pose is finite across the whole swing
  for (const type of ATTACK_TYPES) {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      for (let v = 0; v < 4; v++) {
        const sk = testApi.poseStudio.skeleton(type, t, { var: v });
        const c = sk.channels;
        assert(Number.isFinite(c.sh) && Number.isFinite(c.el) && Number.isFinite(c.wr),
          `non-finite channels: ${type} t=${t} var=${v}`);
        for (const k of Object.keys(sk.points)) {
          assert(finitePt(sk.points[k]), `non-finite point ${k}: ${type} t=${t} var=${v}`);
        }
      }
    }
  }
  // 2) capture / export round-trips into kfa-ready stops
  testApi.poseStudio.open();
  testApi.poseStudio.setType('slash');
  testApi.poseStudio.clear();
  for (const t of [0.1, 0.5, 0.9]) { testApi.poseStudio.setT(t); testApi.poseStudio.capture(); }
  const exp = testApi.poseStudio.export();
  assert(exp.keys.length === 3, 'expected 3 captured keyframes');
  assert(exp.stops.shAng.length === 3 && exp.stops.elBend.length === 3 && exp.stops.wrBend.length === 3,
    'export stops malformed');
  testApi.poseStudio.close();

  // 3) smoke: drive each class through the lab + the Pose Studio render path
  const cb = loopCb();
  assert(typeof cb === 'function', 'no loop callback captured');
  for (const c of CLASSES) {
    testApi.startLab(c, 'base');
    for (let i = 0; i < 6; i++) cb(16.7);
    testApi.poseStudio.open();
    for (const type of ['slash', 'crush', 'stab', 'cast', 'throw']) {
      testApi.poseStudio.setType(type);
      testApi.poseStudio.setT(0.5);
      cb(16.7); cb(16.7);
    }
    testApi.poseStudio.close();
    cb(16.7);
    assert(!nanError, `NaN reached canvas (class ${c}): ${nanError}`);
  }
}

// ---------------------------------------------------------------------------
// SVG contact sheet — one cell per sampled frame of the swing.
// ---------------------------------------------------------------------------
function buildSvg(testApi, type) {
  const cols = 6, cell = 150, pad = 10, frames = 11;        // t = 0.0 .. 1.0
  const rows = Math.ceil(frames / cols);
  const W = cols * cell, H = rows * cell + 28;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f4f6fa"/>`,
    `<text x="10" y="19" font-family="monospace" font-size="14" fill="#161616">weaponPose("${type}") — swing t=0→1 (left→right)</text>`,
  ];
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const col = i % cols, row = (i / cols) | 0;
    const ox = col * cell + cell / 2, oy = 28 + row * cell + cell * 0.72;   // local origin (feet)
    const sk = testApi.poseStudio.skeleton(type, t, { f: 1 });
    const P = sk.points;
    const X = p => (ox + p.x).toFixed(1);
    const Y = p => (oy + p.y).toFixed(1);   // skeleton y is up-negative; oy is the floor line
    parts.push(`<g stroke="#161616" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
    parts.push(`<rect x="${col * cell + 2}" y="${28 + row * cell + 2}" width="${cell - 4}" height="${cell - 4}" fill="#fff" stroke="#dfe4ee" stroke-width="1"/>`);
    parts.push(`<line x1="${col * cell + 8}" y1="${(oy).toFixed(1)}" x2="${col * cell + cell - 8}" y2="${(oy).toFixed(1)}" stroke="#e6ebf3" stroke-width="1"/>`);
    // reference legs (straight, just for grounding the figure)
    parts.push(`<line x1="${X(P.hip)}" y1="${Y(P.hip)}" x2="${(ox - 8).toFixed(1)}" y2="${oy.toFixed(1)}"/>`);
    parts.push(`<line x1="${X(P.hip)}" y1="${Y(P.hip)}" x2="${(ox + 8).toFixed(1)}" y2="${oy.toFixed(1)}"/>`);
    // spine + head
    parts.push(`<line x1="${X(P.hip)}" y1="${Y(P.hip)}" x2="${X(P.sh)}" y2="${Y(P.sh)}"/>`);
    parts.push(`<circle cx="${X(P.head)}" cy="${Y(P.head)}" r="${sk.headR}" fill="#161616" stroke="none"/>`);
    // weapon arm: shoulder → elbow → hand
    parts.push(`<polyline points="${X(P.sh)},${Y(P.sh)} ${X(P.elbow)},${Y(P.elbow)} ${X(P.hand)},${Y(P.hand)}"/>`);
    // weapon (hand → tip), highlighted
    parts.push(`<line x1="${X(P.hand)}" y1="${Y(P.hand)}" x2="${X(P.tip)}" y2="${Y(P.tip)}" stroke="#d23b3b" stroke-width="4"/>`);
    parts.push(`</g>`);
    parts.push(`<text x="${col * cell + 6}" y="${28 + row * cell + cell - 8}" font-family="monospace" font-size="11" fill="#888">t=${t.toFixed(1)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const positional = args.filter(a => !a.startsWith('--'));
  const type = positional[0] || 'slash';
  const outArg = positional[1] || path.join(ROOT, `pose-${type}.svg`);

  const { testApi, loopCb } = boot();
  validate(testApi, loopCb);

  if (checkOnly) {
    console.log(`pose-shot OK — validated ${ATTACK_TYPES.length} attacks × 11 frames × 4 variants, smoke-drove ${CLASSES.length} classes through the Pose Studio, no NaN reached the canvas.`);
    return;
  }
  if (!ATTACK_TYPES.includes(type)) {
    console.error(`unknown attack "${type}". known: ${ATTACK_TYPES.join(', ')}`);
    process.exit(2);
  }
  const svg = buildSvg(testApi, type);
  fs.writeFileSync(outArg, svg);
  console.log(`pose-shot OK — wrote ${path.relative(ROOT, outArg)} (contact sheet for "${type}", t=0→1).`);
}

try { main(); }
catch (e) { console.error('pose-shot FAILED:', e && e.message || e); process.exit(1); }
