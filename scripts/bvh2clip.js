/* BVH -> Stick Leap clip baker.
 *
 * Reads a CMU-style .bvh, runs forward kinematics, projects the skeleton onto a
 * side view, auto-locates the sword cut (peak hand speed), and extracts the
 * animation tracks our clip system uses. The VALUE we keep from mocap is the
 * timing + shape of each track over the move; body tracks are normalised and
 * re-scaled to our controlled amplitudes (so realism comes from the motion, size
 * stays art-directable), while the weapon-arm angles keep their true radians.
 *
 *   node scripts/bvh2clip.js <file.bvh> [windowFrames]
 */
'use strict';
const fs = require('fs');

// ---- tiny 3x3 / vec3 math ----
const mul = (A, B) => { const C = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return C; };
const apply = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const d2r = d => d * Math.PI / 180;
const Rx = a => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const Ry = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const Rz = a => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

// ---- parse BVH ----
function parseBVH(text) {
  const tokens = text.split(/\r?\n/);
  const joints = [];           // {name, offset, channels:[names], parent, isEnd}
  const stack = [];
  let i = 0, motionAt = -1;
  for (; i < tokens.length; i++) {
    const line = tokens[i].trim();
    if (line === 'MOTION') { motionAt = i; break; }
    if (line.startsWith('ROOT') || line.startsWith('JOINT')) {
      const name = line.split(/\s+/)[1];
      const j = { name, offset: [0, 0, 0], channels: [], parent: stack.length ? stack[stack.length - 1] : -1, isEnd: false };
      joints.push(j); stack.push(joints.length - 1);
    } else if (line.startsWith('End Site')) {
      const j = { name: joints[stack[stack.length - 1]].name + '_End', offset: [0, 0, 0], channels: [], parent: stack[stack.length - 1], isEnd: true };
      joints.push(j); stack.push(joints.length - 1);
    } else if (line.startsWith('OFFSET')) {
      const p = line.split(/\s+/).slice(1).map(Number); joints[stack[stack.length - 1]].offset = p;
    } else if (line.startsWith('CHANNELS')) {
      const p = line.split(/\s+/); joints[stack[stack.length - 1]].channels = p.slice(2);
    } else if (line === '}') { stack.pop(); }
  }
  // motion
  let frames = 0, frameTime = 0; const data = [];
  for (i = motionAt + 1; i < tokens.length; i++) {
    const line = tokens[i].trim();
    if (line.startsWith('Frames:')) frames = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith('Frame Time:')) frameTime = parseFloat(line.split(/\s+/)[2]);
    else if (line) data.push(line.split(/\s+/).map(Number));
  }
  return { joints, frames, frameTime, data };
}

// ---- forward kinematics: world position of every joint for one frame ----
function fkFrame(joints, row) {
  const pos = new Array(joints.length), rot = new Array(joints.length);
  let ch = 0;
  for (let j = 0; j < joints.length; j++) {
    const J = joints[j];
    let t = [0, 0, 0], R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const rotv = { X: 0, Y: 0, Z: 0 };
    for (const c of J.channels) {
      const v = row[ch++];
      if (c === 'Xposition') t[0] = v; else if (c === 'Yposition') t[1] = v; else if (c === 'Zposition') t[2] = v;
      else if (c === 'Xrotation') rotv.X = v; else if (c === 'Yrotation') rotv.Y = v; else if (c === 'Zrotation') rotv.Z = v;
    }
    // compose in channel order (CMU/MotionBuilder = Z,Y,X)
    for (const c of J.channels) {
      if (c === 'Zrotation') R = mul(R, Rz(d2r(rotv.Z)));
      else if (c === 'Yrotation') R = mul(R, Ry(d2r(rotv.Y)));
      else if (c === 'Xrotation') R = mul(R, Rx(d2r(rotv.X)));
    }
    if (J.parent === -1) { pos[j] = add(J.offset, t); rot[j] = R; }
    else { pos[j] = add(pos[J.parent], apply(rot[J.parent], J.offset)); rot[j] = mul(rot[J.parent], R); }
  }
  return { pos, rot };
}

// ---- main ----
const file = process.argv[2] || '/tmp/bvh/02_07.bvh';
const winN = parseInt(process.argv[3] || '110', 10);
const bvh = parseBVH(fs.readFileSync(file, 'utf8'));
const idx = {}; bvh.joints.forEach((j, n) => { if (!(j.name in idx)) idx[j.name] = n; });
const need = ['Hips', 'Spine1', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftFoot', 'RightUpLeg', 'RightFoot'];
for (const n of need) if (!(n in idx)) { console.error('missing joint', n, '\navailable:', Object.keys(idx).join(',')); process.exit(1); }
const P = (fr, name) => fr.pos[idx[name]];

// FK every frame
const FK = bvh.data.map(r => fkFrame(bvh.joints, r));

// which hand swings? bigger 3D path length wins
function pathLen(name) { let s = 0; for (let i = 1; i < FK.length; i++) s += Math.hypot(...sub(P(FK[i], name), P(FK[i - 1], name))); return s; }
const swordSide = pathLen('RightHand') >= pathLen('LeftHand') ? 'Right' : 'Left';
const offSide = swordSide === 'Right' ? 'Left' : 'Right';
const HAND = swordSide + 'Hand', FARM = swordSide + 'ForeArm', ARM = swordSide + 'Arm';
const OHAND = offSide + 'Hand', OARM = offSide + 'Arm';

// find the cut: the frame whose surrounding window sweeps the LARGEST arc of the
// sword hand about the shoulder (a big committed swing, not a fast little flick).
const half = Math.round(winN * 0.5);
function sweptArc(center) {
  let total = 0;
  for (let i = Math.max(1, center - half) + 1; i <= Math.min(FK.length - 1, center + half); i++) {
    const s0 = sub(P(FK[i - 1], HAND), P(FK[i - 1], ARM)), s1 = sub(P(FK[i], HAND), P(FK[i], ARM));
    const c = norm(cross(s0, s1)); const d = Math.max(-1, Math.min(1, dot(norm(s0), norm(s1))));
    total += Math.acos(d);
  }
  return total;
}
let peak = half, peakV = 0;
for (let i = half; i < FK.length - half; i += 2) { const v = sweptArc(i); if (v > peakV) { peakV = v; peak = i; } }
let a = Math.max(1, peak - Math.round(winN * 0.45)), b = Math.min(FK.length - 1, peak + Math.round(winN * 0.55));
console.error(`peak swept arc=${peakV.toFixed(2)} rad`);
console.error(`sword side=${swordSide}  peak frame=${peak}/${FK.length}  window=[${a},${b}]`);

// projection plane fixed at the contact frame: side view (forward x, up y)
const cf = FK[peak];
const hipAxis = norm([...sub(P(cf, swordSide + 'UpLeg'), P(cf, offSide + 'UpLeg'))]); // right-ish
const up = [0, 1, 0];
let fwd = norm(cross(up, hipAxis));            // forward on the ground
// orient forward so the cut travels +x in screen
const handVel = sub(P(FK[peak + 1], HAND), P(FK[peak - 1], HAND));
if (dot(handVel, fwd) < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];
const sx = p => dot(p, fwd);                    // screen x  (forward)
const sy = p => p[1];                           // screen y  (up)
const depth = p => dot(p, hipAxis);             // out-of-plane (for twist proxies)

// per-frame extraction over the window
const N = b - a;
const samp = [];
for (let i = a; i <= b; i++) {
  const fr = FK[i], t = (i - a) / N;
  const hips = P(fr, 'Hips'), chest = P(fr, 'Spine1'), head = P(fr, 'Head');
  const sh = P(fr, ARM), el = P(fr, FARM), ha = P(fr, HAND);
  const ang = (p, q) => Math.atan2(-(sy(q) - sy(p)), sx(q) - sx(p)); // screen angle (y down like canvas)
  const shAng = ang(sh, el), foreAng = ang(el, ha);
  samp.push({
    t,
    shAngRaw: shAng, foreAngRaw: foreAng,
    spine: ang(hips, chest) - (-Math.PI / 2),                 // lean from vertical
    shoulderShear: depth(P(fr, ARM)) - depth(P(fr, OARM)),    // torso twist (out-of-plane)
    hipPivot: depth(P(fr, swordSide + 'UpLeg')) - depth(P(fr, offSide + 'UpLeg')),
    hipX: sx(hips), hipY: sy(hips),
    head: sx(head) - sx(hips),
    offArm: ang(P(fr, OARM), P(fr, OHAND)),
    footF: sx(P(fr, swordSide + 'Foot')), footB: sx(P(fr, offSide + 'Foot')),
  });
}
// unwrap angle sequences (kill +-2pi jumps), then derive continuous arm angles
function unwrap(key) {
  for (let i = 1; i < samp.length; i++) {
    let d = samp[i][key] - samp[i - 1][key];
    while (d > Math.PI) { samp[i][key] -= 2 * Math.PI; d -= 2 * Math.PI; }
    while (d < -Math.PI) { samp[i][key] += 2 * Math.PI; d += 2 * Math.PI; }
  }
}
unwrap('shAngRaw'); unwrap('foreAngRaw'); unwrap('spine'); unwrap('offArm');
for (const p of samp) { p.shAng = p.shAngRaw; p.elBend = p.foreAngRaw - p.shAngRaw; }

// resample a track to K keyframes (averaging nearby samples), return [[t,v],...]
function track(key, K = 11) {
  const out = [];
  for (let k = 0; k < K; k++) {
    const tt = k / (K - 1);
    let s = 0, w = 0;
    for (const p of samp) { const d = Math.abs(p.t - tt); if (d < 0.7 / K) { s += p[key]; w++; } }
    if (!w) { let best = samp[0], bd = 9; for (const p of samp) { const d = Math.abs(p.t - tt); if (d < bd) { bd = d; best = p; } } s = best[key]; w = 1; }
    out.push([+tt.toFixed(3), s / w]);
  }
  return out;
}
const rel = key => { const tr = track(key); const v0 = tr[0][1]; return tr.map(([t, v]) => [t, v - v0]); }; // zero at t0
// normalise a relative track to peak |amp|, then scale to target
function shaped(key, amp) {
  const tr = rel(key); let m = 0; for (const [, v] of tr) m = Math.max(m, Math.abs(v));
  m = m || 1; return tr.map(([t, v]) => [t, +(v / m * amp).toFixed(3)]);
}

// aim = sword direction at contact (shoulder->hand), so arm tracks are aim-relative
const cs = samp.reduce((best, p) => Math.abs(p.t - 0.5) < Math.abs(best.t - 0.5) ? p : best, samp[0]);
const aim = Math.atan2(-(sy(P(FK[peak], HAND)) - sy(P(FK[peak], ARM))), sx(P(FK[peak], HAND)) - sx(P(FK[peak], ARM)));

const armSh = track('shAng').map(([t, v]) => [t, +(v - aim).toFixed(3)]);   // offset from aim (radians, real)
const armEl = track('elBend').map(([t, v]) => [t, +v.toFixed(3)]);
// weight shift 0=back .. 1=front foot
const wgt = track('hipX'); const ff = track('footF'), bf = track('footB');
const weight = wgt.map(([t, v], k) => { const den = (ff[k][1] - bf[k][1]) || 1; return [t, +clamp((v - bf[k][1]) / den, 0, 1).toFixed(3)]; });
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

const out = {
  meta: { file, swordSide, peak, window: [a, b], fps: Math.round(1 / bvh.frameTime), aim: +aim.toFixed(3) },
  // body tracks: real SHAPE/timing, our amplitudes
  spine: shaped('spine', 0.46),
  hipX: shaped('hipX', 14),
  hipY: shaped('hipY', 6),
  headX: shaped('head', 9),
  shoulderShear: shaped('shoulderShear', 12),
  hipPivot: shaped('hipPivot', 9),
  offArm: shaped('offArm', 1.0),
  weightShift: weight,
  // weapon arm: keep real radians
  armShAngOffset: armSh,
  armElBend: armEl,
};
console.log(JSON.stringify(out, null, 1));
