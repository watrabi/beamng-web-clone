import * as THREE from 'three';
import { BEAM_SUPPORT } from './physics.js';
import { CarShape, buildSkin, buildDetails, plateTexture, tireTexture } from './carbody.js';
import { FlexMesh, mergeByMaterial } from './flexmesh.js';

// Local vehicle space: +x = the car's left, y = up, z = forward. y = 0 is the ground at rest.

export const VEHICLE_TYPES = {
  hatch: {
    label: 'Hatchback',
    length: 4.1, front: 2.0, axleF: 1.27, axleR: -1.25,
    track: 1.52, wheelR: 0.31, wheelW: 0.2,
    floor: 0.26, mass: 1150,
    // body profile: z, belt height, roof height, half width, roof half width
    profile: [
      [2.0, 0.66, 0.70, 0.78, 0.55],
      [1.75, 0.82, 0.86, 0.86, 0.62],
      [1.2, 0.86, 0.9, 0.87, 0.64],
      [0.6, 0.9, 0.94, 0.87, 0.66],
      [0.0, 0.92, 1.42, 0.87, 0.68],
      [-0.35, 0.93, 1.46, 0.87, 0.69],
      [-1.3, 0.94, 1.42, 0.86, 0.68],
      [-1.8, 0.94, 1.22, 0.84, 0.64],
      [-2.08, 0.88, 0.96, 0.8, 0.6],
      [-2.1, 0.64, 0.68, 0.76, 0.55],
    ],
    cabin: [0.55, -1.95], bPillar: -0.45,
    parts: { hood: [0.62, 1.8], trunk: [-2.1, -1.45], doors: [[0.8, -0.45]] },
    engine: { torque: 220, peakRpm: 4500, redline: 6800, idle: 850, gears: [3.4, 2.05, 1.4, 1.05, 0.84], final: 4.1, reverse: 3.2, drive: 'fwd' },
    spring: 36000, damp: 3000, color: 0xd23a2a,
  },
  sedan: {
    label: 'Sport Sedan',
    length: 4.7, front: 2.35, axleF: 1.45, axleR: -1.4,
    track: 1.58, wheelR: 0.33, wheelW: 0.24,
    floor: 0.24, mass: 1450,
    profile: [
      [2.35, 0.62, 0.66, 0.8, 0.55],
      [2.1, 0.78, 0.82, 0.88, 0.62],
      [1.5, 0.84, 0.88, 0.9, 0.64],
      [0.75, 0.88, 0.93, 0.9, 0.66],
      [0.15, 0.9, 1.38, 0.9, 0.7],
      [-0.6, 0.91, 1.4, 0.9, 0.7],
      [-1.15, 0.93, 1.3, 0.9, 0.68],
      [-1.7, 0.97, 1.01, 0.89, 0.66],
      [-2.25, 0.96, 0.99, 0.84, 0.6],
      [-2.35, 0.66, 0.7, 0.8, 0.55],
    ],
    cabin: [0.75, -1.7], bPillar: -0.25,
    parts: { hood: [0.82, 2.1], trunk: [-2.28, -1.74], doors: [[1.0, -0.21], [-0.29, -0.98]] },
    engine: { torque: 380, peakRpm: 4200, redline: 7000, idle: 800, gears: [3.6, 2.2, 1.5, 1.15, 0.92, 0.75], final: 3.7, reverse: 3.3, drive: 'rwd' },
    spring: 46000, damp: 3600, color: 0x2a5bd2,
  },
  pickup: {
    label: 'Pickup Truck',
    length: 5.3, front: 2.6, axleF: 1.75, axleR: -1.6,
    track: 1.7, wheelR: 0.4, wheelW: 0.27,
    floor: 0.42, mass: 2000,
    profile: [
      [2.6, 0.95, 0.99, 0.88, 0.6],
      [2.4, 1.15, 1.19, 0.95, 0.68],
      [1.2, 1.2, 1.24, 0.97, 0.7],
      [0.65, 1.22, 1.27, 0.97, 0.72],
      [0.15, 1.24, 1.86, 0.97, 0.76],
      [-0.85, 1.25, 1.88, 0.97, 0.76],
      [-1.0, 1.25, 1.3, 0.97, 0.75],
      [-2.55, 1.2, 1.24, 0.96, 0.7],
      [-2.7, 0.95, 0.99, 0.92, 0.6],
    ],
    cabin: [0.6, -0.95], bPillar: -0.2, latticeR: 1.3,
    parts: { hood: [0.68, 2.38], trunk: [-2.6, -1.06], doors: [[0.8, -0.88]] },
    engine: { torque: 520, peakRpm: 3200, redline: 5600, idle: 700, gears: [3.9, 2.4, 1.6, 1.2, 1.0, 0.8], final: 3.55, reverse: 3.5, drive: 'awd' },
    spring: 62000, damp: 5200, color: 0xe8e4da,
  },
};

const PART_LABELS = { hood: 'Hood', trunk: 'Trunk', bumperF: 'Front bumper', bumperR: 'Rear bumper', mirrorL: 'Left mirror', mirrorR: 'Right mirror' };

export class Vehicle {
  constructor(game, typeKey, pos, yaw, opts = {}) {
    this.game = game;
    this.type = VEHICLE_TYPES[typeKey];
    this.typeKey = typeKey;
    this.world = game.phys;
    this.color = opts.color ?? this.type.color;
    this.controlled = !!opts.controlled;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.steerSmooth = 0;
    this.gear = 1;
    this.rpm = this.type.engine.idle;
    this.speed = 0;
    this.damage = 0;
    this.engineHealth = 1;
    this.lastImpulse = 0;
    this.shape = new CarShape(this.type);
    this.build(pos, yaw);
    this.buildVisual();
    this._substep = (dt) => this.substep(dt);
    this.world.onSubstep.push(this._substep);
  }

  // ------------------------------------------------------------------
  // jbeam-like structure generation
  // ------------------------------------------------------------------
  build(pos, yaw) {
    const T = this.type, W = this.world, S = this.shape;
    const body = this.body = W.createBody(T.label);
    body.selfCollide = true; body.selfTimer = 0; // panels can't pass through the car or themselves
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.spawn = { pos: pos.clone(), yaw };
    const toWorld = (x, y, z) => [pos.x + x * cy + z * sy, pos.y + y, pos.z - x * sy + z * cy];
    const restMap = this.restMap = new Map();
    const nodes = this.nodes = [];
    const addNode = (x, y, z, m, o = {}) => {
      const [wx, wy, wz] = toWorld(x, y, z);
      const id = W.addNode(body, wx, wy, wz, m, o);
      restMap.set(id, [x, y, z]);
      nodes.push(id);
      return id;
    };
    this.restOf = (id) => restMap.get(id);
    const dist = (a, b) => { const p = restMap.get(a), q = restMap.get(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

    // ---- chassis lattice: stations along the length ----
    const zF = T.front;
    const nSt = Math.max(8, Math.round(T.length / 0.42));
    const stations = [];
    const bodyNodes = [];
    for (let s = 0; s <= nSt; s++) {
      const z = zF - (s / nSt) * T.length;
      const sec = S.sec(z);
      const { belt, roofRaw: roof, hw, rhw } = sec;
      const end = s === 0 || s === nSt;
      const st = { z, ids: [] };
      const fl = T.floor + (end ? 0.12 : 0);
      const xs = end ? [-hw * 0.8, 0, hw * 0.8] : [-hw * 0.92, 0, hw * 0.92];
      for (const x of xs) st.ids.push(addNode(x, fl, z, 1));
      for (const x of [-hw, hw]) st.ids.push(addNode(x, (fl + belt) * 0.5, z, 1));
      for (const x of [-hw * 0.96, 0, hw * 0.96]) st.ids.push(addNode(x, belt + (x === 0 ? 0.02 : -0.01), z, 1));
      if (roof - belt > 0.2) {
        for (const x of [-rhw * 0.97, 0, rhw * 0.97]) st.ids.push(addNode(x, roof + (x === 0 ? 0.0 : -0.02), z, 1));
      }
      stations.push(st);
      bodyNodes.push(...st.ids);
    }

    // suspension mounts (part of the chassis)
    const half = T.track / 2;
    const mounts = [];
    for (const [az, front] of [[T.axleF, true], [T.axleR, false]]) {
      for (const side of [-1, 1]) {
        const belt = S.sec(az).belt;
        const m = {
          lf: addNode(side * (half - 0.42), T.floor + 0.04, az + 0.3, 1),
          lr: addNode(side * (half - 0.42), T.floor + 0.04, az - 0.3, 1),
          top: addNode(side * (half - 0.22), belt - 0.06, az, 1),
          side, front, az,
        };
        mounts.push(m);
        bodyNodes.push(m.lf, m.lr, m.top);
      }
    }
    const mountIds = new Set(mounts.flatMap(m => [m.lf, m.lr, m.top]));
    for (const id of bodyNodes) { W.friction[id] = 0.6; W.radius[id] = 0.05; W.cradius[id] = 0.24; }

    // auto-generated beam lattice. Sheet metal yields early so crashes leave real dents.
    const R = T.latticeR || 1.05;
    for (let i = 0; i < bodyNodes.length; i++) for (let j = i + 1; j < bodyNodes.length; j++) {
      const a = bodyNodes[i], b = bodyNodes[j];
      const ra = restMap.get(a), rb = restMap.get(b);
      const d = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
      if (d > R || d < 0.02) continue;
      const roofish = ra[1] > T.floor + 0.85 && rb[1] > T.floor + 0.85;
      const floorish = ra[1] < T.floor + 0.15 && rb[1] < T.floor + 0.15;
      let yieldF = 8500, k = 1.3e6;
      if (floorish) { yieldF = 19000; k = 2.0e6; }
      if (roofish) yieldF = 9500;
      if (mountIds.has(a) || mountIds.has(b)) yieldF *= 2.6;
      const zz = Math.max(ra[2], rb[2]), zm = Math.min(ra[2], rb[2]);
      if (zz > T.axleF + 0.1 || zm < T.axleR - 0.2) yieldF *= 0.55; // crumple zones
      W.addBeam(body, a, b, { k, d: 340, yieldF, breakStrain: 0.5 });
    }

    // ---- body panels as separate breakable parts ----
    this.parts = [];
    const nearest = (p, cands, n, minD = 0.04, maxD = 0.95) => {
      const arr = [];
      for (const c of cands) {
        const q = restMap.get(c);
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d >= minD && d <= maxD) arr.push([d, c]);
      }
      arr.sort((x, y) => x[0] - y[0]);
      return arr.slice(0, n).map(x => x[1]);
    };
    const mkPart = (key, label, pts, o) => {
      const ids = pts.map(q => addNode(q.p[0], q.p[1], q.p[2], o.mass, { friction: 0.5, radius: 0.035, cradius: 0.2 }));
      let cx = 0, cy2 = 0, cz = 0;
      for (const q of pts) { cx += q.p[0]; cy2 += q.p[1]; cz += q.p[2]; }
      cx /= pts.length; cy2 /= pts.length; cz /= pts.length;
      const part = { key, label, ids, hinge: [], latch: [], mount: [], support: [], internal: [], state: 'ok' };
      const k = o.k ?? 2.2e5;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        if (dist(ids[i], ids[j]) <= o.R) part.internal.push(W.addBeam(body, ids[i], ids[j], { k, d: 45, yieldF: o.yieldF, breakStrain: 0.9 }));
      }
      if (o.rigid !== false) {
        // "rigidifier" node behind the panel gives it bending stiffness
        const rid = addNode(cx + o.inward[0] * 0.14, cy2 + o.inward[1] * 0.14, cz + o.inward[2] * 0.14, o.mass, { collides: false, selfColl: false });
        part.rid = rid;
        for (const id of ids) part.internal.push(W.addBeam(body, rid, id, { k, d: 45, yieldF: o.yieldF * 1.6, breakStrain: 0.9 }));
      }
      const targets = o.attachTo || bodyNodes;
      pts.forEach((q, i) => {
        if (q.role === 'free') return;
        const F = o[q.role + 'F'];
        for (const t of nearest(q.p, targets, o.nAttach ?? 3)) {
          part[q.role].push(W.addBeam(body, ids[i], t, { k: o.attachK ?? (q.role === 'hinge' ? 5e5 : 3e5), d: 70, breakF: F, yieldF: F * 1.4, breakStrain: o.attachStrain ?? 0.6 }));
        }
      });
      if (o.support) {
        // push-only braces reaching deep into the car: a loose panel can swing
        // open but can't be pushed through the body (they can't be slipped past)
        const [ix_, iy_, iz_] = o.inward;
        pts.forEach((q, i) => {
          const cand = [];
          for (const t of targets) {
            const r = restMap.get(t);
            const dx = r[0] - q.p[0], dy = r[1] - q.p[1], dz = r[2] - q.p[2], d = Math.hypot(dx, dy, dz);
            if (d < 0.45 || d > 1.5) continue;
            const al = (dx * ix_ + dy * iy_ + dz * iz_) / d;
            if (al > 0.6) cand.push([al - d * 0.15, t, d]);
          }
          cand.sort((a, b) => b[0] - a[0]);
          for (const [, t, d] of cand.slice(0, 2)) part.support.push(W.addBeam(body, ids[i], t, { type: BEAM_SUPPORT, k: 3e5, d: 80, rest: d - 0.015 }));
          // plus a short stop to the nearest chassis node (also damps panel flutter)
          for (const t of nearest(q.p, targets, 1, 0.03, 0.6)) part.support.push(W.addBeam(body, ids[i], t, { type: BEAM_SUPPORT, k: 2.5e5, d: 60 }));
        });
      }
      // reference frame for the visual mesh: three well spread nodes
      const a = ids[0];
      let b = ids[1], bd = 0;
      for (const id of ids) { const d = dist(a, id); if (d > bd) { bd = d; b = id; } }
      let c = ids[2], ca = 0;
      for (const id of ids) {
        const pa = restMap.get(a), pb = restMap.get(b), pc = restMap.get(id);
        const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
        const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        if (ar > ca) { ca = ar; c = id; }
      }
      part.frame = [a, b, c];
      this.parts.push(part);
      return part;
    };

    const P = T.parts;
    // hood: hinged at the windscreen, latched at the front
    {
      const [h0, h1] = P.hood, zs = [h0 + 0.07, (h0 + h1) / 2, h1 - 0.07], pts = [];
      zs.forEach((z, zi) => {
        for (const [i, s] of [[10.2, -1], [16, 1], [10.2, 1]]) {
          let role = 'free';
          if (zi === 0 && i !== 16) role = 'hinge';
          if (zi === 2 && i === 16) role = 'latch';
          pts.push({ p: S.surf(z, i, s, 0.02), role });
        }
      });
      mkPart('hood', 'Hood', pts, { mass: 2.2, R: 1.3, yieldF: 2400, inward: [0, -1, 0], hingeF: 14000, latchF: 4500, support: true });
    }
    // trunk / hatch / bed cover: hinged at the front edge, latched at the back
    {
      const [t0, t1] = P.trunk, len = t1 - t0;
      const zs = len > 0.9 ? [t1 - 0.07, (t0 + t1) / 2, t0 + 0.07] : [t1 - 0.07, t0 + 0.07];
      const pts = [];
      zs.forEach((z, zi) => {
        for (const [i, s] of [[10.2, -1], [16, 1], [10.2, 1]]) {
          let role = 'free';
          if (zi === 0 && i !== 16) role = 'hinge';
          if (zi === zs.length - 1 && i === 16) role = 'latch';
          pts.push({ p: S.surf(z, i, s, 0.02), role });
        }
      });
      mkPart('trunk', this.typeKey === 'hatch' ? 'Hatch' : this.typeKey === 'pickup' ? 'Bed cover' : 'Trunk', pts,
        { mass: 2.0, R: 1.3, yieldF: 2400, inward: [0, -1, 0], hingeF: 12000, latchF: 4500, support: true });
    }
    // doors: hinged at the front edge, latched at the back
    P.doors.forEach(([d0, d1], k) => {
      for (const s of [1, -1]) {
        const key = `door${k}${s > 0 ? 'L' : 'R'}`;
        const zs = [d0 - 0.05, (d0 + d1) / 2, d1 + 0.05], pts = [];
        zs.forEach((z, zi) => {
          for (const i of [4.4, 6.5, 8.2]) {
            let role = 'free';
            if (zi === 0 && i !== 6.5) role = 'hinge';
            if (zi === 2 && i !== 4.4) role = 'latch';
            pts.push({ p: S.surf(z, i, s, 0.02), role });
          }
          if (S.inCabin(z) && S.fullRoof(z)) pts.push({ p: S.surf(z, 12, s, 0.01), role: 'free' });
        });
        const side = s > 0 ? 'Left' : 'Right';
        const label = P.doors.length > 1 ? `${side} ${k === 0 ? 'front' : 'rear'} door` : `${side} door`;
        mkPart(key, label, pts, { mass: 2.4, R: 0.95, yieldF: 3200, inward: [-s, 0, 0], hingeF: 20000, latchF: 6500, support: true });
      }
    });
    // bumpers: bolted on, tear off in a big hit
    for (const [key, z0, dir] of [['bumperF', T.front, 1], ['bumperR', T.front - T.length, -1]]) {
      const se = S.sec(z0), pts = [];
      for (const y of [T.floor + 0.14, se.belt - 0.2]) for (const xf of [-0.62, -0.3, 0, 0.3, 0.62]) pts.push({ p: [xf * se.hw, y, z0 + dir * 0.03], role: 'mount' });
      for (const s of [1, -1]) {
        pts.push({ p: S.surf(z0 - dir * 0.25, 4.5, s, 0.02), role: 'mount' });
        pts.push({ p: S.surf(z0 - dir * 0.25, 6.8, s, 0.02), role: 'mount' });
      }
      mkPart(key, PART_LABELS[key], pts, { mass: 1.3, R: 0.75, yieldF: 1800, inward: [0, 0, -dir], mountF: 4200, nAttach: 2, attachStrain: 0.25 });
    }
    // mirrors hang off the front doors
    for (const s of [1, -1]) {
      const door = this.parts.find(p => p.key === `door0${s > 0 ? 'L' : 'R'}`);
      const z = P.doors[0][0] - 0.14, se = S.sec(z);
      const pts = [
        { p: [s * (se.hw + 0.03), se.belt + 0.05, z], role: 'mount' },
        { p: [s * (se.hw + 0.19), se.belt + 0.15, z - 0.02], role: 'mount' },
        { p: [s * (se.hw + 0.19), se.belt + 0.05, z - 0.02], role: 'mount' },
      ];
      const key = s > 0 ? 'mirrorL' : 'mirrorR';
      mkPart(key, PART_LABELS[key], pts, { mass: 1.6, R: 0.5, k: 6e4, attachK: 1.2e5, yieldF: 1100, rigid: false, inward: [-s, 0, 0], mountF: 1600, nAttach: 4, attachTo: [...door.ids, door.rid] });
    }

    // ---- masses: whatever the parts don't weigh goes into the chassis ----
    const hubMass = 32;
    let partMass = 0;
    for (const p of this.parts) { for (const id of p.ids) partMass += W.mass[id]; if (p.rid !== undefined) partMass += W.mass[p.rid]; }
    const chassisMass = T.mass - 4 * hubMass - partMass;
    let wsum = 0;
    const weights = bodyNodes.map(id => {
      const r = restMap.get(id);
      let w = 1;
      if (r[2] > T.axleF - 0.5 && r[1] < (T.floor + 0.5)) w += T.engine.drive === 'fwd' ? 1.0 : 0.6; // engine
      if (r[1] < T.floor + 0.1) w += 0.3; // floor
      if (r[1] > T.floor + 0.8) w *= 1.0; // roof
      wsum += w; return w;
    });
    bodyNodes.forEach((id, i) => { const m = chassisMass * weights[i] / wsum; W.mass[id] = m; W.invMass[id] = 1 / m; });

    // ---- wheels: hub node on a 2-link wishbone + spring/damper strut ----
    const g = 9.81;
    this.wheels = [];
    let mom = 0, msum = 0;
    for (let id = body.nodeStart; id < body.nodeEnd; id++) { mom += W.mass[id] * (restMap.get(id)[2] - T.axleR); msum += W.mass[id]; }
    const fFrac = Math.min(0.75, Math.max(0.25, (mom / msum) / (T.axleF - T.axleR)));
    for (const m of mounts) {
      const cornerLoad = msum * g * 0.5 * (m.front ? fFrac : 1 - fFrac);
      const hub = addNode(m.side * half, T.wheelR, m.az, hubMass, { collides: false, cradius: T.wheelR });
      const linkOpts = { k: 2.5e6, d: 400, yieldF: 80000, breakStrain: 0.25 };
      const l1 = W.addBeam(body, hub, m.lf, linkOpts);
      const l2 = W.addBeam(body, hub, m.lr, linkOpts);
      const [hx, hy, hz] = restMap.get(hub), [tx, ty, tz] = restMap.get(m.top);
      const L = Math.hypot(hx - tx, hy - ty, hz - tz);
      const mr = Math.abs(hy - ty) / L;
      const k = T.spring;
      const preload = cornerLoad / (k * mr);
      const spring = W.addBeam(body, hub, m.top, { k, d: T.damp, rest: L + preload, limit: (0.12 + preload) / (L + preload) });
      const e = T.engine;
      this.wheels.push({
        hub, top: m.top, lf: m.lf, lr: m.lr, links: [l1, l2], spring, side: m.side, front: m.front, arb: m.front ? T.mass * 12 : T.mass * 6,
        steer: m.front, driven: e.drive === 'awd' || (e.drive === 'fwd' ? m.front : !m.front),
        omega: 0, angle: 0, R: T.wheelR, I: 1.3 * (T.wheelR / 0.33) ** 2,
        brakeMax: m.front ? 2600 : 1600, contact: false, slip: 0, load: 0, detached: false, surf: 1, steerAngle: 0,
      });
    }

    // frame reference nodes
    const mid = stations[Math.round(nSt / 2)];
    const sF = stations[Math.max(1, Math.round(nSt * 0.15))], sR = stations[Math.min(nSt - 1, Math.round(nSt * 0.85))];
    this.ref = { f: sF.ids[1], r: sR.ids[1], l: mid.ids[0], ri: mid.ids[2], c: mid.ids[1] };
    this.bodyNodes = bodyNodes;
    this.stations = stations;

    // node -> beams adjacency (for damage checks)
    this.nodeBeams = new Map();
    for (let b = body.beamStart; b < W.beamCount; b++) {
      for (const n of [W.ba[b], W.bb[b]]) { if (!this.nodeBeams.has(n)) this.nodeBeams.set(n, []); this.nodeBeams.get(n).push(b); }
    }
    // engine bay nodes for engine damage
    const eb = S.sec(T.axleF).belt;
    this.engineNodes = bodyNodes.filter(id => { const r = restMap.get(id); return r[2] > T.axleF - 0.45 && r[1] < eb - 0.05; });
  }

  // Orthonormal frame from reference nodes. r points to the car's left.
  computeFrame(useRest = false, out = {}) {
    const W = this.world, r = this.ref;
    const P = (id) => useRest ? this.restMap.get(id) : [W.px[id], W.py[id], W.pz[id]];
    const f = P(r.f), b = P(r.r), l = P(r.l), ri = P(r.ri);
    let fx = f[0] - b[0], fy = f[1] - b[1], fz = f[2] - b[2];
    let fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let rx = ri[0] - l[0], ry = ri[1] - l[1], rz = ri[2] - l[2];
    let ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
    let ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    rx = uy * fz - uz * fy; ry = uz * fx - ux * fz; rz = ux * fy - uy * fx;
    out.r = [rx, ry, rz]; out.u = [ux, uy, uz]; out.f = [fx, fy, fz];
    out.o = [(l[0] + ri[0]) / 2, (l[1] + ri[1]) / 2, (l[2] + ri[2]) / 2];
    return out;
  }

  // plastic strain around a set of nodes (0 = pristine)
  strainAround(ids, all = false) {
    const W = this.world;
    let s = 0, n = 0, mx = 0;
    for (const id of ids) {
      const bs = this.nodeBeams.get(id); if (!bs) continue;
      for (const b of bs) {
        const v = W.broken[b] ? 0.3 : Math.abs(W.rest[b] / W.rest0[b] - 1);
        s += v; n++; if (v > mx) mx = v;
      }
    }
    return all ? { avg: n ? s / n : 0, max: mx } : (n ? s / n : 0);
  }

  // ------------------------------------------------------------------
  // per-frame logic (gearbox, inputs, damage)
  // ------------------------------------------------------------------
  preFrame(dt) {
    const W = this.world, T = this.type, e = T.engine;
    this.frame = this.computeFrame(false, this.frame || {});
    const fr = this.frame;
    let vx = 0, vy = 0, vz = 0, msum = 0;
    for (const id of this.bodyNodes) { const m = W.mass[id]; vx += W.vx[id] * m; vy += W.vy[id] * m; vz += W.vz[id] * m; msum += m; }
    vx /= msum; vy /= msum; vz /= msum;
    this.vel = [vx, vy, vz];
    this.speed = vx * fr.f[0] + vy * fr.f[1] + vz * fr.f[2];
    this.absSpeed = Math.hypot(vx, vy, vz);

    const inp = this.input;
    let throttle = inp.throttle, brake = inp.brake;
    if (this.gear === -1) {
      if (inp.throttle > 0.1 && Math.abs(this.speed) < 0.6) this.gear = 1;
      else { throttle = inp.brake; brake = inp.throttle; }
    } else if (inp.brake > 0.1 && Math.abs(this.speed) < 0.6 && inp.throttle < 0.1) {
      this.gear = -1; throttle = inp.brake; brake = 0;
    }
    this.throttleEff = throttle; this.brakeEff = brake;

    if (this.gear > 0) {
      const wheelRpm = this.drivenOmega() * 60 / (2 * Math.PI);
      const rpmAt = (g) => Math.abs(wheelRpm * e.gears[g - 1] * e.final);
      this.shiftTimer = (this.shiftTimer || 0) - dt;
      if (this.shiftTimer <= 0) {
        if (this.gear < e.gears.length && rpmAt(this.gear) > e.redline * 0.93) { this.gear++; this.shiftTimer = 0.4; }
        else if (this.gear > 1 && rpmAt(this.gear) < e.redline * (throttle > 0.6 ? 0.5 : 0.33) && rpmAt(this.gear - 1) < e.redline * 0.82) { this.gear--; this.shiftTimer = 0.4; }
      }
    }

    // speed sensitive steering. Input +1 = left; the frame's r axis points left,
    // and a negative wheel angle turns the wheels toward +r.
    const maxSteer = 0.62 / (1 + Math.abs(this.speed) / 14);
    const target = -inp.steer * maxSteer;
    const rate = 2.6 * dt;
    this.steerSmooth += Math.max(-rate, Math.min(rate, target - this.steerSmooth));

    this.dragK = 0.5 * 1.22 * 0.33 * 2.2 / T.mass;

    this.damage = W.deformEnergy[this.body.id];
    this.lastImpulse = W.contactImpulse[this.body.id];
    W.contactImpulse[this.body.id] = 0;
    this.updateDamage();
  }

  updateDamage() {
    const W = this.world;
    for (const p of this.parts) {
      // bolts that got bent (crushed) let go too
      // and so do bolts whose mounting point on the chassis got crushed
      for (const b of p.mount) {
        if (W.broken[b]) continue;
        if (Math.abs(W.rest[b] / W.rest0[b] - 1) > 0.1 || this.strainAround([W.bb[b]], true).max > 0.14) W.broken[b] = 1;
      }
      const att = [...p.hinge, ...p.latch, ...p.mount];
      const nb = att.reduce((s, b) => s + W.broken[b], 0);
      let state = 'ok';
      if (nb === att.length) state = 'off';
      else if (p.latch.some(b => W.broken[b]) || p.hinge.some(b => W.broken[b]) || (p.mount.length && nb > p.mount.length * 0.3)) state = 'loose';
      if (state === 'off' && p.state !== 'off') for (const b of p.support) W.broken[b] = 1;
      p.state = state;
    }
    // engine: crushed engine bay loses power, then dies
    const es = this.strainAround(this.engineNodes);
    const h = Math.max(0, Math.min(1, 1 - (es - 0.006) * 14));
    this.engineHealth = Math.min(this.engineHealth, h);
    // lights and glass
    if (this.fragile) for (const f of this.fragile) {
      if (f.broken) continue;
      let bad = false;
      if (f.part && f.part.state === 'off' && f.breakWhenOff) bad = true;
      const st = this.strainAround(f.anchors, true);
      if (st.max > f.thr) bad = true;
      if (bad) { f.broken = true; f.onBreak(); this.game.audio?.glass?.(); }
    }
  }

  drivenOmega() {
    let s = 0, n = 0;
    for (const w of this.wheels) if (w.driven && !w.detached) { s += w.omega; n++; }
    return n ? s / n : 0;
  }

  engineTorque(rpm) {
    const e = this.type.engine;
    const x = rpm / e.peakRpm;
    const t = x < 1 ? 0.55 + 0.45 * Math.sin(x * Math.PI / 2) : 1 - 0.35 * (x - 1) * (x - 1) * 2.2;
    return e.torque * Math.max(0.2, t);
  }

  // ------------------------------------------------------------------
  // per physics substep: engine, tires
  // ------------------------------------------------------------------
  substep(dt) {
    if (!this.body.active || this.body.sleeping) return;
    const W = this.world, T = this.type, e = T.engine;
    const fr = this.computeFrame(false, this._fr || (this._fr = {}));
    const [rx, ry, rz] = fr.r, [ux, uy, uz] = fr.u, [fx, fy, fz] = fr.f;

    const dk = this.dragK || 0;
    if (dk) {
      for (const id of this.bodyNodes) {
        const vx = W.vx[id], vy = W.vy[id], vz = W.vz[id];
        const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const m = W.mass[id] * dk * s;
        W.fx[id] -= vx * m; W.fy[id] -= vy * m; W.fz[id] -= vz * m;
      }
    }

    // engine
    const throttle = this.throttleEff || 0, brake = this.brakeEff || 0;
    const ratio = this.gear === -1 ? -e.reverse * e.final : e.gears[this.gear - 1] * e.final;
    const wOmega = this.drivenOmega();
    let rpm = Math.abs(wOmega * ratio) * 60 / (2 * Math.PI);
    const clutchSlip = rpm < e.idle * 1.3;
    if (rpm < e.idle) rpm = e.idle;
    const dead = this.engineHealth < 0.12;
    const targetRpm = dead ? Math.max(0, rpm * (clutchSlip ? 0 : 1)) : clutchSlip ? Math.max(rpm, e.idle + throttle * 2500) : rpm;
    this.rpm += (Math.min(targetRpm, e.redline * 1.04) - this.rpm) * Math.min(1, dt * 20);
    let engT = 0;
    if (!dead && this.rpm < e.redline) engT = this.engineTorque(this.rpm) * throttle * Math.sqrt(this.engineHealth);
    engT -= (1 - throttle) * (this.rpm / e.redline) * e.torque * 0.18 * (clutchSlip ? 0 : 1);
    let nDriven = 0;
    for (const w of this.wheels) if (w.driven && !w.detached) nDriven++;
    const wheelDrive = engT * ratio * 0.9 / (nDriven || 1);

    const col = this.game.worldMap;
    const cands = this.body.worldCandidates;
    const out = this._cout || (this._cout = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 1 });
    const steer = this.steerSmooth;

    // anti-roll bars
    for (let a = 0; a < 4; a += 2) {
      const wl = this.wheels[a], wr = this.wheels[a + 1];
      if (wl.detached || wr.detached) continue;
      const comp = (w) => {
        const dx = W.px[w.hub] - W.px[w.top], dy = W.py[w.hub] - W.py[w.top], dz = W.pz[w.hub] - W.pz[w.top];
        return -(dx * ux + dy * uy + dz * uz);
      };
      const F = wl.arb * (comp(wr) - comp(wl));
      W.fx[wl.hub] -= F * ux; W.fy[wl.hub] -= F * uy; W.fz[wl.hub] -= F * uz;
      W.fx[wl.top] += F * ux; W.fy[wl.top] += F * uy; W.fz[wl.top] += F * uz;
      W.fx[wr.hub] += F * ux; W.fy[wr.hub] += F * uy; W.fz[wr.hub] += F * uz;
      W.fx[wr.top] -= F * ux; W.fy[wr.top] -= F * uy; W.fz[wr.top] -= F * uz;
    }

    for (const w of this.wheels) {
      const h = w.hub;
      if (!w.detached && W.broken[w.links[0]] && W.broken[w.links[1]]) { w.detached = true; W.broken[w.spring] = 1; }
      let sa = 0;
      if (w.steer && !w.detached) {
        // Ackermann: the inner wheel turns more. sa<0 turns toward +x (left).
        const inner = (steer < 0) === (w.side > 0);
        sa = steer * (inner ? 1.08 : 0.93);
      }
      w.steerAngle = sa;
      const cs = Math.cos(sa), sn = Math.sin(sa);
      const axx = rx * cs + fx * sn, axy = ry * cs + fy * sn, axz = rz * cs + fz * sn;

      let T_drive = w.driven && !w.detached ? wheelDrive : 0;
      if (this.game.tcs && T_drive !== 0 && w.contact) {
        const over = Math.abs(w.omega * w.R) - Math.abs(w.vlong || 0) - Math.max(1.2, Math.abs(w.vlong || 0) * 0.12);
        w.tc = Math.max(0.05, Math.min(1, (w.tc ?? 1) + (over > 0 ? -dt * 25 : dt * 4)));
        T_drive *= w.tc;
      } else w.tc = 1;
      let brakeT = brake * w.brakeMax * 1.25;
      if (brakeT > 0 && w.contact && w.vlong > 3 && Math.abs(w.omega * w.R) < w.vlong * 0.82) brakeT *= 0.2;
      if (!w.front && this.input.handbrake > 0.5) brakeT = Math.max(brakeT, 5000);

      w.contact = false; w.slip = 0; w.load = 0;
      const hit = col.contact(W.px[h], W.py[h], W.pz[h], w.R, cands, out);
      if (hit) {
        const nx = out.nx, ny = out.ny, nz = out.nz;
        const vx = W.vx[h], vy = W.vy[h], vz = W.vz[h];
        const vn = vx * nx + vy * ny + vz * nz;
        let Fn = 2.6e5 * out.depth - 2400 * vn;
        if (Fn > 0) {
          if (Fn > 60000) Fn = 60000;
          // rolling direction F = axis x N (sign keeps F pointing forward)
          let Fx = axy * nz - axz * ny, Fy = axz * nx - axx * nz, Fz = axx * ny - axy * nx;
          const fl = Math.hypot(Fx, Fy, Fz) || 1; Fx /= fl; Fy /= fl; Fz /= fl;
          if (Fx * fx + Fy * fy + Fz * fz < 0) { Fx = -Fx; Fy = -Fy; Fz = -Fz; }
          const Lx = ny * Fz - nz * Fy, Ly = nz * Fx - nx * Fz, Lz = nx * Fy - ny * Fx;
          const vlong = vx * Fx + vy * Fy + vz * Fz;
          const vlat = vx * Lx + vy * Ly + vz * Lz;
          const sx = w.omega * w.R - vlong;
          const sy = -vlat;
          const av = Math.abs(vlong);
          const px_ = Math.max(0.6, 0.09 * av), py_ = Math.max(0.5, 0.07 * av);
          const nxs = sx / px_, nys = sy / py_;
          const sl = Math.hypot(nxs, nys);
          const mu = 1.1 * out.friction;
          let fLong = 0, fLat = 0;
          if (sl > 1e-6) {
            const c = Math.sin(1.35 * Math.atan(2.4 * sl));
            const Fm = mu * Fn * c / sl;
            fLong = Fm * nxs; fLat = Fm * nys;
            const mLong = Math.abs(sx) / (dt * (w.R * w.R / w.I + 1 / 32)) * 0.8;
            if (fLong > mLong) fLong = mLong; else if (fLong < -mLong) fLong = -mLong;
            const mLat = Math.abs(sy) * 32 / dt * 0.8;
            if (fLat > mLat) fLat = mLat; else if (fLat < -mLat) fLat = -mLat;
          }
          w.vlong = vlong;
          w.slip = sl; w.load = Fn; w.contact = true; w.surf = out.friction;
          W.fx[h] += nx * Fn + Fx * fLong + Lx * fLat;
          W.fy[h] += ny * Fn + Fy * fLong + Ly * fLat;
          W.fz[h] += nz * Fn + Fz * fLong + Lz * fLat;
          T_drive -= fLong * w.R;
          T_drive -= Math.sign(w.omega) * Fn * 0.012 * w.R;
        }
      }
      w.omega += T_drive / w.I * dt;
      const dB = brakeT / w.I * dt;
      if (Math.abs(w.omega) <= dB) w.omega = 0; else w.omega -= Math.sign(w.omega) * dB;
      if (w.omega > 400) w.omega = 400; else if (w.omega < -400) w.omega = -400;
      w.angle += w.omega * dt;
    }
  }

  // ------------------------------------------------------------------
  // visuals
  // ------------------------------------------------------------------
  makeMaterials() {
    this.mats = [];
    this.matIdx = {};
    const plate = plateTexture(String.fromCharCode(65 + (Math.random() * 26 | 0), 65 + (Math.random() * 26 | 0), 65 + (Math.random() * 26 | 0)) + ' ' + (100 + (Math.random() * 900 | 0)));
    const make = (key) => {
      const S = (o) => new THREE.MeshStandardMaterial(o);
      if (key === 'paint') return new THREE.MeshPhysicalMaterial({ color: this.color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
      if (key === 'trim') return S({ color: 0x161616, roughness: 0.65 });
      if (key === 'under') return S({ color: 0x0d0d0d, roughness: 0.95 });
      if (key === 'grille') return S({ color: 0x0b0b0b, roughness: 0.5, metalness: 0.3 });
      if (key === 'chrome') return S({ color: 0xdedede, metalness: 1, roughness: 0.12 });
      if (key === 'mirror') return S({ color: 0xf0f0f0, metalness: 1, roughness: 0.02 });
      if (key === 'amber') return S({ color: 0xff9a1a, emissive: 0xff7a00, emissiveIntensity: 0.35, roughness: 0.2 });
      if (key === 'plate') return S({ map: plate, roughness: 0.5 });
      if (key === 'interior') return S({ color: 0x2b2d31, roughness: 0.95 });
      if (key === 'engine') return S({ color: 0x3c3f45, metalness: 0.6, roughness: 0.45 });
      if (key === 'red') return S({ color: 0xb3201a, roughness: 0.45 });
      if (key === 'inner') return S({ color: 0x141518, roughness: 1, side: THREE.BackSide });
      if (key.startsWith('glass:')) return new THREE.MeshPhysicalMaterial({ color: 0x0e1820, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.42, envMapIntensity: 1.6, depthWrite: false });
      if (key === 'light:headL' || key === 'light:headR') return S({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.4, roughness: 0.08 });
      if (key === 'light:fog') return S({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0.6, roughness: 0.1 });
      if (key === 'light:tailL' || key === 'light:tailR') return S({ color: 0x5a0000, emissive: 0xff1408, emissiveIntensity: 0.5, roughness: 0.2 });
      if (key === 'light:reverse') return S({ color: 0xcccccc, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
      return S({ color: 0xff00ff });
    };
    this._make = make;
    this.mat = (key) => {
      if (this.matIdx[key] === undefined) {
        const m = make(key);
        m.userData.key = key;
        m.userData.opacity = m.opacity; m.userData.transparent = m.transparent;
        this.matIdx[key] = this.mats.length; this.mats.push(m);
      }
      return this.matIdx[key];
    };
  }

  buildVisual() {
    const S = this.shape, T = this.type, W = this.world, scene = this.game.scene;
    this.makeMaterials();
    const skin = buildSkin(S);
    const details = buildDetails(S);
    const pieceKeys = new Set([...Object.keys(skin), ...details.map(d => d.piece)]);
    this.flex = [];
    this.pieceMesh = {};
    for (const key of pieceKeys) {
      const list = [];
      const sk = skin[key];
      if (sk) {
        for (const g of sk.groups) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(sk.pos, 3));
          geo.setIndex(g.idx);
          list.push({ geo, mat: this.mat(g.mat) });
          // dark inside surface so gaps and windows show a cabin, not the sky
          if (!g.mat.startsWith('glass')) list.push({ geo, mat: this.mat('inner') });
        }
      }
      for (const d of details) if (d.piece === key) list.push({ geo: d.geo, mat: this.mat(d.mat) });
      if (!list.length) continue;
      const geo = mergeByMaterial(list);
      let bind, frame, K = 4;
      if (key === 'body') { bind = this.bodyNodes; frame = [this.ref.r, this.ref.f, this.ref.l]; }
      else {
        const p = this.parts.find(q => q.key === key);
        if (!p) continue;
        bind = p.ids; frame = p.frame; K = Math.min(3, p.ids.length);
      }
      const fm = new FlexMesh(W, geo, this.mats, bind, this.restOf, frame, { K });
      fm.key = key;
      scene.add(fm.mesh);
      this.flex.push(fm);
      this.pieceMesh[key] = fm;
    }
    this.bodyFlex = this.pieceMesh.body;

    // breakable lights and glass
    this.fragile = [];
    const chassisNear = (p, n) => {
      const arr = this.bodyNodes.map(id => { const r = this.restOf(id); return [Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]), id]; });
      arr.sort((a, b) => a[0] - b[0]);
      return arr.slice(0, n).map(a => a[1]);
    };
    const sF = S.sec(S.zF), sR = S.sec(S.zR);
    const breakLight = (key) => () => { const m = this.mats[this.matIdx[key]]; if (m) { m.emissiveIntensity = 0; m.color.setHex(0x2a2a2a); m.userData.broken = true; } };
    const breakGlass = (key) => () => { const m = this.mats[this.matIdx[key]]; if (m) { m.color.setHex(0xaab6bf); m.opacity = 0.85; m.roughness = 0.6; m.userData.opacity = 0.85; m.userData.broken = true; } };
    for (const s of [1, -1]) {
      this.fragile.push({ key: s > 0 ? 'light:headL' : 'light:headR', anchors: chassisNear([s * sF.hw * 0.6, sF.belt - 0.09, S.zF], 2), thr: 0.03, onBreak: breakLight(s > 0 ? 'light:headL' : 'light:headR') });
      this.fragile.push({ key: s > 0 ? 'light:tailL' : 'light:tailR', anchors: chassisNear([s * sR.hw * 0.6, sR.belt - 0.1, S.zR], 2), thr: 0.03, onBreak: breakLight(s > 0 ? 'light:tailL' : 'light:tailR') });
    }
    const bF = this.parts.find(p => p.key === 'bumperF');
    this.fragile.push({ key: 'light:fog', anchors: bF.ids, part: bF, breakWhenOff: true, thr: 0.06, onBreak: breakLight('light:fog') });
    // windscreen & rear glass: centre of the sloped region
    const glassCentre = (front) => {
      let zs = [];
      for (let z = S.zF; z > S.zR; z -= 0.05) if (S.inCabin(z) && S.sloped(z) && (front ? z > T.bPillar : z < T.bPillar)) zs.push(z);
      if (!zs.length) return null;
      const z = (zs[0] + zs[zs.length - 1]) / 2, se = S.sec(z);
      return [0, (se.belt + se.roofRaw) / 2, z];
    };
    const ws = glassCentre(true);
    if (ws) this.fragile.push({ key: 'glass:windshield', anchors: chassisNear(ws, 5), thr: 0.02, onBreak: breakGlass('glass:windshield') });
    const rg = glassCentre(false);
    if (rg && this.matIdx['glass:rear'] !== undefined) this.fragile.push({ key: 'glass:rear', anchors: chassisNear(rg, 5), thr: 0.02, onBreak: breakGlass('glass:rear') });
    const trunk = this.parts.find(p => p.key === 'trunk');
    if (this.matIdx['glass:trunk'] !== undefined) this.fragile.push({ key: 'glass:trunk', anchors: trunk.ids, thr: 0.03, onBreak: breakGlass('glass:trunk') });
    for (const p of this.parts) if (p.key.startsWith('door') && this.matIdx['glass:' + p.key] !== undefined) {
      this.fragile.push({ key: 'glass:' + p.key, anchors: p.ids, thr: 0.035, onBreak: breakGlass('glass:' + p.key) });
    }
    for (const side of ['L', 'R']) if (this.matIdx['glass:quarter' + side] !== undefined) {
      const s = side === 'L' ? 1 : -1, z = (T.parts.doors[T.parts.doors.length - 1][1] + T.cabin[1]) / 2, se = S.sec(z);
      this.fragile.push({ key: 'glass:quarter' + side, anchors: chassisNear([s * se.hw, se.belt + 0.2, z], 3), thr: 0.025, onBreak: breakGlass('glass:quarter' + side) });
    }

    // steering wheel (rigid, follows the chassis, turns with the steering)
    const zd = T.cabin[0] - 0.42, sd = S.sec(zd);
    const sw = new THREE.Group();
    const swMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 24), swMat);
    const hubm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateX(Math.PI / 2), swMat);
    sw.add(rim, hubm);
    for (const a of [0, 2.2, -2.2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.02), swMat); sp.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08 - 0.0, 0); sp.rotation.z = a; sw.add(sp); }
    sw.matrixAutoUpdate = false;
    scene.add(sw);
    this.steeringWheel = sw;
    this.swLocal = new THREE.Vector3(0.37, sd.belt + 0.06, zd);

    // wheels
    this.wheelMeshes = this.wheels.map(w => this.makeWheelMesh(w));

    // visible suspension: control arms, dampers, coil springs
    const armGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 6);
    const strutGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
    const pts = [];
    for (let i = 0; i <= 200; i++) { const t = i / 200; pts.push(new THREE.Vector3(Math.cos(t * Math.PI * 14) * 0.065, t - 0.5, Math.sin(t * Math.PI * 14) * 0.065)); }
    const coilGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.009, 5);
    this.rods = [];
    this.armMesh = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.4 }), 8);
    this.strutMesh = new THREE.InstancedMesh(strutGeo, new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.9 }), 4);
    this.coilMesh = new THREE.InstancedMesh(coilGeo, new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.4, metalness: 0.5 }), 4);
    for (const m of [this.armMesh, this.strutMesh, this.coilMesh]) { m.frustumCulled = false; m.castShadow = true; scene.add(m); }
  }

  makeWheelMesh(w) {
    const T = this.type, R = T.wheelR, Wd = T.wheelW;
    if (!Vehicle._wheelCache) Vehicle._wheelCache = {};
    let c = Vehicle._wheelCache[this.typeKey];
    if (!c) {
      const rr = R * 0.64;
      const prof = [[rr, -Wd / 2], [R * 0.9, -Wd / 2], [R * 0.985, -Wd * 0.44], [R, -Wd * 0.3], [R, Wd * 0.3], [R * 0.985, Wd * 0.44], [R * 0.9, Wd / 2], [rr, Wd / 2]];
      const tire = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r, x)), 36);
      tire.rotateZ(-Math.PI / 2);
      // 5-spoke rim face
      const shape = new THREE.Shape(); shape.absarc(0, 0, rr * 0.98, 0, Math.PI * 2);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
        const hole = new THREE.Path();
        const r0 = rr * 0.36, r1 = rr * 0.86, da = 0.42;
        hole.moveTo(Math.cos(a - da * 0.6) * r0, Math.sin(a - da * 0.6) * r0);
        hole.lineTo(Math.cos(a - da) * r1, Math.sin(a - da) * r1);
        hole.absarc(0, 0, r1, a - da, a + da, false);
        hole.lineTo(Math.cos(a + da * 0.6) * r0, Math.sin(a + da * 0.6) * r0);
        hole.lineTo(Math.cos(a - da * 0.6) * r0, Math.sin(a - da * 0.6) * r0);
        shape.holes.push(hole);
      }
      const face = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 1, curveSegments: 20 });
      face.rotateY(Math.PI / 2); face.translate(Wd * 0.22, 0, 0);
      const barrel = new THREE.CylinderGeometry(rr, rr, Wd * 0.85, 24, 1, true); barrel.rotateZ(Math.PI / 2);
      const disc = new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.026, 24); disc.rotateZ(Math.PI / 2); disc.translate(-Wd * 0.1, 0, 0);
      const cap = new THREE.CylinderGeometry(0.045, 0.05, 0.03, 14); cap.rotateZ(Math.PI / 2); cap.translate(Wd * 0.3, 0, 0);
      const nuts = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const n = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6); n.rotateZ(Math.PI / 2); n.translate(Wd * 0.28, Math.cos(a) * rr * 0.24, Math.sin(a) * rr * 0.24); nuts.push(n); }
      const caliper = new THREE.BoxGeometry(0.07, rr * 0.5, 0.1); caliper.translate(-Wd * 0.05, rr * 0.62, -0.02);
      c = Vehicle._wheelCache[this.typeKey] = {
        tire, face, barrel, disc, cap, nuts, caliper,
        tireMat: new THREE.MeshStandardMaterial({ map: tireTexture(), roughness: 0.92 }),
        rimMat: new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.22, metalness: 0.95 }),
        darkMat: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.7 }),
        discMat: new THREE.MeshStandardMaterial({ color: 0x77797c, roughness: 0.35, metalness: 0.9 }),
        calMat: new THREE.MeshStandardMaterial({ color: 0xb01c14, roughness: 0.4, metalness: 0.3 }),
      };
    }
    const g = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(c.tire, c.tireMat), new THREE.Mesh(c.face, c.rimMat), new THREE.Mesh(c.barrel, c.darkMat), new THREE.Mesh(c.disc, c.discMat), new THREE.Mesh(c.cap, c.rimMat));
    for (const n of c.nuts) spin.add(new THREE.Mesh(n, c.darkMat));
    g.add(spin, new THREE.Mesh(c.caliper, c.calMat));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData.spin = spin;
    g.matrixAutoUpdate = false;
    this.game.scene.add(g);
    return g;
  }

  updateVisual() {
    const W = this.world;
    const asleep = this.body.sleeping;
    if (asleep && this._drawnAsleep) return;
    this._drawnAsleep = asleep;
    for (const fm of this.flex) fm.update();
    const fr = this.computeFrame(false, this._vf || (this._vf = {}));
    const [r0, r1, r2] = fr.r, [u0, u1, u2] = fr.u, [f0, f1, f2] = fr.f;

    // lights
    const L = (k) => this.mats[this.matIdx[k]];
    for (const k of ['light:tailL', 'light:tailR']) { const m = L(k); if (m && !m.userData.broken) m.emissiveIntensity = (this.brakeEff > 0.1) ? 2.6 : 0.5; }
    const rv = L('light:reverse'); if (rv) rv.emissiveIntensity = this.gear === -1 ? 1.4 : 0;

    // steering wheel: chassis rotation * tilt * spin
    const D = this.bodyFlex.D, c = this.ref.c, rc = this.restOf(c), lp = this.swLocal;
    const ox = lp.x - rc[0], oy = lp.y - rc[1], oz = lp.z - rc[2];
    const m4 = this._swm || (this._swm = new THREE.Matrix4());
    m4.set(D[0], D[1], D[2], W.px[c] + D[0] * ox + D[1] * oy + D[2] * oz,
      D[3], D[4], D[5], W.py[c] + D[3] * ox + D[4] * oy + D[5] * oz,
      D[6], D[7], D[8], W.pz[c] + D[6] * ox + D[7] * oy + D[8] * oz,
      0, 0, 0, 1);
    const tilt = this._swt || (this._swt = new THREE.Matrix4());
    tilt.makeRotationFromEuler(new THREE.Euler(-0.4, 0, this.steerSmooth * 14, 'XYZ'));
    this.steeringWheel.matrix.multiplyMatrices(m4, tilt);
    this.steeringWheel.matrixWorldNeedsUpdate = true;

    // wheels
    const m = this._m || (this._m = new THREE.Matrix4());
    this.wheels.forEach((w, i) => {
      const g = this.wheelMeshes[i];
      const sa = w.steerAngle, cs = Math.cos(sa), sn = Math.sin(sa);
      const ax = [r0 * cs + f0 * sn, r1 * cs + f1 * sn, r2 * cs + f2 * sn];
      const fw = [f0 * cs - r0 * sn, f1 * cs - r1 * sn, f2 * cs - r2 * sn];
      const s = w.side;
      m.set(
        ax[0] * s, u0, fw[0], W.px[w.hub],
        ax[1] * s, u1, fw[1], W.py[w.hub],
        ax[2] * s, u2, fw[2], W.pz[w.hub],
        0, 0, 0, 1);
      g.matrix.copy(m);
      g.matrixWorldNeedsUpdate = true;
      g.userData.spin.rotation.x = w.angle;
    });

    // suspension rods
    const tmp = this._rod || (this._rod = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) });
    const place = (mesh, idx, na, nb, beam, frac0 = 0, frac1 = 1) => {
      tmp.a.set(W.px[na], W.py[na], W.pz[na]); tmp.b.set(W.px[nb], W.py[nb], W.pz[nb]);
      tmp.v.subVectors(tmp.b, tmp.a);
      const len = tmp.v.length();
      if (W.broken[beam] || len < 1e-4) { tmp.m.makeScale(0, 0, 0); mesh.setMatrixAt(idx, tmp.m); return; }
      tmp.q.setFromUnitVectors(tmp.up, tmp.v.clone().divideScalar(len));
      const c0 = tmp.a.clone().addScaledVector(tmp.v, (frac0 + frac1) / 2);
      tmp.s.set(1, len * (frac1 - frac0), 1);
      tmp.m.compose(c0, tmp.q, tmp.s);
      mesh.setMatrixAt(idx, tmp.m);
    };
    this.wheels.forEach((w, i) => {
      place(this.armMesh, i * 2, w.hub, w.lf, w.links[0]);
      place(this.armMesh, i * 2 + 1, w.hub, w.lr, w.links[1]);
      place(this.strutMesh, i, w.hub, w.top, w.spring, 0.05, 0.55);
      place(this.coilMesh, i, w.hub, w.top, w.spring, 0.35, 0.95);
    });
    this.armMesh.instanceMatrix.needsUpdate = true;
    this.strutMesh.instanceMatrix.needsUpdate = true;
    this.coilMesh.instanceMatrix.needsUpdate = true;
  }

  setColor(hex) { this.color = hex; const m = this.mats[this.matIdx.paint]; if (m) m.color.setHex(hex); }

  setXray(on) {
    for (const m of this.mats) {
      if (on) { m.transparent = true; m.opacity = Math.min(m.userData.opacity ?? 1, 0.22); }
      else { m.transparent = m.userData.transparent; m.opacity = m.userData.opacity ?? 1; }
      m.needsUpdate = true;
    }
  }

  // put everything back to factory condition at a new position
  repair(pos, yaw) {
    const W = this.world;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const id of this.nodes) {
      const [x, y, z] = this.restMap.get(id);
      W.px[id] = pos.x + x * cy + z * sy; W.py[id] = pos.y + y; W.pz[id] = pos.z - x * sy + z * cy;
      W.vx[id] = W.vy[id] = W.vz[id] = 0;
    }
    for (let b = this.body.beamStart; b < this.body.beamEnd; b++) { W.rest[b] = W.rest0[b]; W.broken[b] = 0; }
    for (const w of this.wheels) { w.omega = 0; w.detached = false; w.angle = 0; }
    for (const p of this.parts) p.state = 'ok';
    W.deformEnergy[this.body.id] = 0;
    this.engineHealth = 1;
    this.gear = 1; this.steerSmooth = 0; this.rpm = this.type.engine.idle;
    // restore lights & glass
    for (const f of this.fragile) {
      if (!f.broken) continue;
      f.broken = false;
      const m = this.mats[this.matIdx[f.key]], fresh = this._make(f.key);
      m.copy(fresh); fresh.dispose();
      m.userData = { key: f.key, opacity: m.opacity, transparent: m.transparent };
    }
    W.wake(this.body);
    this._drawnAsleep = false;
  }

  partsInfo() {
    const list = this.parts.map(p => ({ label: p.label, state: p.state }));
    const wheelsOff = this.wheels.filter(w => w.detached).length;
    const lights = this.fragile.filter(f => f.key.startsWith('light') && f.broken).length;
    const glass = this.fragile.filter(f => f.key.startsWith('glass') && f.broken).length;
    return { parts: list, wheelsOff, lights, glass, engine: this.engineHealth };
  }

  center() {
    const W = this.world, c = this.ref.c;
    return new THREE.Vector3(W.px[c], W.py[c], W.pz[c]);
  }

  dispose() {
    const idx = this.world.onSubstep.indexOf(this._substep);
    if (idx >= 0) this.world.onSubstep.splice(idx, 1);
    const sc = this.game.scene;
    for (const fm of this.flex) { sc.remove(fm.mesh); fm.mesh.geometry.dispose(); }
    for (const g of this.wheelMeshes) sc.remove(g);
    for (const m of [this.armMesh, this.strutMesh, this.coilMesh, this.steeringWheel]) sc.remove(m);
    for (const m of this.mats) m.dispose();
  }

  stats() {
    return { nodes: this.body.nodeEnd - this.body.nodeStart, beams: this.body.beamEnd - this.body.beamStart };
  }
}
