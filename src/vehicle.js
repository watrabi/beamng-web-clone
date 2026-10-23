import * as THREE from 'three';
import { BEAM_NORMAL } from './physics.js';

// Local vehicle space: x = right, y = up, z = forward. y = 0 is the ground at rest.

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
    engine: { torque: 520, peakRpm: 3200, redline: 5600, idle: 700, gears: [3.9, 2.4, 1.6, 1.2, 1.0, 0.8], final: 3.55, reverse: 3.5, drive: 'awd' },
    spring: 62000, damp: 5200, color: 0xe8e4da,
  },
};

function lerpProfile(prof, z) {
  // profile is ordered front (high z) to rear (low z)
  if (z >= prof[0][0]) return prof[0].slice(1);
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1];
    if (z <= a[0] && z >= b[0]) {
      const t = (a[0] - z) / (a[0] - b[0] || 1);
      return [1, 2, 3, 4].map(k => a[k] + (b[k] - a[k]) * t);
    }
  }
  return prof[prof.length - 1].slice(1);
}

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
    this.lastImpulse = 0;
    this.build(pos, yaw);
    this.buildVisual();
    this._substep = (dt) => this.substep(dt);
    this.world.onSubstep.push(this._substep);
  }

  // ------------------------------------------------------------------
  // jbeam-like structure generation
  // ------------------------------------------------------------------
  build(pos, yaw) {
    const T = this.type, W = this.world;
    const body = this.body = W.createBody(T.label);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.spawn = { pos: pos.clone(), yaw };
    const toWorld = (x, y, z) => [pos.x + x * cy + z * sy, pos.y + y, pos.z - x * sy + z * cy];
    const rest = this.restPos = []; // local rest positions per node (relative index)
    const nodes = this.nodes = [];
    const addNode = (x, y, z, m, o = {}) => {
      const [wx, wy, wz] = toWorld(x, y, z);
      const id = W.addNode(body, wx, wy, wz, m, o);
      rest.push([x, y, z]);
      nodes.push(id);
      return id;
    };

    // stations along the length
    const zF = T.front, zR = T.front - T.length;
    const nSt = Math.max(8, Math.round(T.length / 0.42));
    const stations = [];
    const bodyNodes = [];
    for (let s = 0; s <= nSt; s++) {
      const z = zF - (s / nSt) * T.length;
      const [belt, roof, hw, rhw] = lerpProfile(T.profile, z);
      const end = s === 0 || s === nSt;
      const st = { z, ids: [] };
      const fl = T.floor + (end ? 0.12 : 0);
      const xs = end ? [-hw * 0.8, 0, hw * 0.8] : [-hw * 0.92, 0, hw * 0.92];
      for (const x of xs) st.ids.push(addNode(x, fl, z, 1));
      for (const x of [-hw, hw]) st.ids.push(addNode(x, (fl + belt) * 0.5, z, 1));
      for (const x of [-hw * 0.98, 0, hw * 0.98]) st.ids.push(addNode(x, belt + (x === 0 ? 0.03 : 0), z, 1));
      if (roof - belt > 0.2) {
        for (const x of [-rhw, 0, rhw]) st.ids.push(addNode(x, roof + (x === 0 ? 0.02 : 0), z, 1));
      }
      stations.push(st);
      bodyNodes.push(...st.ids);
    }

    // suspension mounts (part of the body lattice)
    const half = T.track / 2;
    const mounts = [];
    for (const [az, front] of [[T.axleF, true], [T.axleR, false]]) {
      for (const side of [-1, 1]) {
        const [belt] = lerpProfile(T.profile, az);
        const m = {
          lf: addNode(side * (half - 0.42), T.floor + 0.04, az + 0.3, 1),
          lr: addNode(side * (half - 0.42), T.floor + 0.04, az - 0.3, 1),
          top: addNode(side * (half - 0.22), belt - 0.04, az, 1),
          side, front, az,
        };
        mounts.push(m);
        bodyNodes.push(m.lf, m.lr, m.top);
      }
    }

    const mountIds = new Set(mounts.flatMap(m => [m.lf, m.lr, m.top]));
    // mass distribution: engine heavy at the front
    const sprungMass = T.mass - 4 * 32;
    let wsum = 0;
    const weights = bodyNodes.map(id => {
      const r = rest[nodes.indexOf(id)];
      let w = 1;
      if (r[2] > T.axleF - 0.5 && r[1] < (T.floor + 0.5)) w += T.engine.drive === 'fwd' ? 1.0 : 0.6; // engine bay
      if (r[1] < T.floor + 0.1) w += 1.4; // floor
      if (r[1] > T.floor + 0.8) w *= 0.45; // light roof
      wsum += w; return w;
    });
    bodyNodes.forEach((id, i) => {
      const m = sprungMass * weights[i] / wsum;
      W.mass[id] = m; W.invMass[id] = 1 / m;
      W.friction[id] = 0.6; W.radius[id] = 0.05; W.cradius[id] = 0.24;
    });

    // auto-generate the beam lattice: connect nodes within a radius
    const R = T.latticeR || 1.05;
    const bodyBeams = [];
    for (let i = 0; i < bodyNodes.length; i++) for (let j = i + 1; j < bodyNodes.length; j++) {
      const a = bodyNodes[i], b = bodyNodes[j];
      const ra = rest[nodes.indexOf(a)], rb = rest[nodes.indexOf(b)];
      const d = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]);
      if (d > R || d < 0.02) continue;
      const roofish = ra[1] > 1.1 && rb[1] > 1.1;
      const floorish = ra[1] < T.floor + 0.15 && rb[1] < T.floor + 0.15;
      let yieldF = 15000, k = 1.4e6;
      if (floorish) { yieldF = 30000; k = 2.2e6; }
      if (roofish) { yieldF = 17000; }
      if (mountIds.has(a) || mountIds.has(b)) yieldF *= 2.5;
      // crumple zones are softer
      const zz = Math.max(ra[2], rb[2]), zm = Math.min(ra[2], rb[2]);
      if (zz > T.axleF + 0.1 || zm < T.axleR - 0.2) yieldF *= 0.6;
      bodyBeams.push(W.addBeam(body, a, b, { k, d: 340, yieldF, breakStrain: 0.55 }));
    }
    this.bodyBeamRange = [bodyBeams[0], bodyBeams[bodyBeams.length - 1] + 1];

    // wheels: one hub node each, held by a 2-link wishbone + spring/damper strut
    const g = 9.81;
    this.wheels = [];
    const totalMass = T.mass;
    // static front axle share from the actual mass distribution
    let mom = 0;
    bodyNodes.forEach((id, i) => { mom += W.mass[id] * (rest[nodes.indexOf(id)][2] - T.axleR); });
    const fFrac = Math.min(0.75, Math.max(0.25, (mom / sprungMass + 0) / (T.axleF - T.axleR)));
    for (const m of mounts) {
      const cornerLoad = sprungMass * g * 0.5 * (m.front ? fFrac : 1 - fFrac);
      const hub = addNode(m.side * half, T.wheelR, m.az, 32, { collides: false, cradius: T.wheelR });
      const linkOpts = { k: 2.5e6, d: 400, yieldF: 90000, breakStrain: 0.25 };
      const l1 = W.addBeam(body, hub, m.lf, linkOpts);
      const l2 = W.addBeam(body, hub, m.lr, linkOpts);
      // spring beam with preload so the car sits at design height
      const [hx, hy, hz] = rest[nodes.indexOf(hub)], [tx, ty, tz] = rest[nodes.indexOf(m.top)];
      const L = Math.hypot(hx - tx, hy - ty, hz - tz);
      const mr = Math.abs(hy - ty) / L;
      const k = T.spring;
      const preload = cornerLoad / (k * mr * mr) * mr;
      const spring = W.addBeam(body, hub, m.top, { k, d: T.damp, rest: L + preload, limit: (0.12 + preload) / (L + preload), yieldF: Infinity, breakStrain: Infinity });
      const e = T.engine;
      this.wheels.push({
        hub, top: m.top, links: [l1, l2], spring, side: m.side, front: m.front, arb: m.front ? T.mass * 26 : T.mass * 14,
        steer: m.front, driven: e.drive === 'awd' || (e.drive === 'fwd' ? m.front : !m.front),
        omega: 0, angle: 0, R: T.wheelR, I: 1.3 * (T.wheelR / 0.33) ** 2,
        brakeMax: m.front ? 2600 : 1600, contact: false, slip: 0, load: 0, detached: false, surf: 1,
        steerAngle: 0, lastPos: new THREE.Vector3(),
      });
    }

    // frame reference nodes
    const mid = stations[Math.round(nSt / 2)];
    const sF = stations[Math.max(1, Math.round(nSt * 0.15))], sR = stations[Math.min(nSt - 1, Math.round(nSt * 0.85))];
    this.ref = { f: sF.ids[1], r: sR.ids[1], l: mid.ids[0], ri: mid.ids[2], c: mid.ids[1] };
    this.bodyNodes = bodyNodes;
    this.stations = stations;
    this.restFrame = this.computeFrame(true);
    this.maxSpeedSteerRef = 0;
  }

  // Orthonormal frame from reference nodes. With useRest=true, from local rest positions.
  computeFrame(useRest = false, out = {}) {
    const W = this.world, r = this.ref;
    const P = (id) => useRest ? this.restPos[this.nodes.indexOf(id)] : [W.px[id], W.py[id], W.pz[id]];
    const f = P(r.f), b = P(r.r), l = P(r.l), ri = P(r.ri);
    let fx = f[0] - b[0], fy = f[1] - b[1], fz = f[2] - b[2];
    let fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let rx = ri[0] - l[0], ry = ri[1] - l[1], rz = ri[2] - l[2];
    // up = fwd x right
    let ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
    let ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    // right = up x fwd
    rx = uy * fz - uz * fy; ry = uz * fx - ux * fz; rz = ux * fy - uy * fx;
    out.r = [rx, ry, rz]; out.u = [ux, uy, uz]; out.f = [fx, fy, fz];
    out.o = [(l[0] + ri[0]) / 2, (l[1] + ri[1]) / 2, (l[2] + ri[2]) / 2];
    return out;
  }

  // ------------------------------------------------------------------
  // per-frame logic (gearbox, inputs)
  // ------------------------------------------------------------------
  preFrame(dt) {
    const W = this.world, T = this.type, e = T.engine;
    this.frame = this.computeFrame(false, this.frame || {});
    const fr = this.frame;
    // speed along forward
    let vx = 0, vy = 0, vz = 0, msum = 0;
    for (const id of this.bodyNodes) { const m = W.mass[id]; vx += W.vx[id] * m; vy += W.vy[id] * m; vz += W.vz[id] * m; msum += m; }
    vx /= msum; vy /= msum; vz /= msum;
    this.vel = [vx, vy, vz];
    this.speed = vx * fr.f[0] + vy * fr.f[1] + vz * fr.f[2];
    this.absSpeed = Math.hypot(vx, vy, vz);

    const inp = this.input;
    // arcade style: brake at standstill engages reverse
    let throttle = inp.throttle, brake = inp.brake;
    if (this.gear === -1) {
      if (inp.throttle > 0.1 && Math.abs(this.speed) < 0.6) this.gear = 1;
      else { throttle = inp.brake; brake = inp.throttle; }
    } else if (inp.brake > 0.1 && Math.abs(this.speed) < 0.6 && inp.throttle < 0.1) {
      this.gear = -1; throttle = inp.brake; brake = 0;
    }
    this.throttleEff = throttle; this.brakeEff = brake;

    // automatic gearbox
    if (this.gear > 0) {
      const wheelRpm = this.drivenOmega() * 60 / (2 * Math.PI);
      const rpmAt = (g) => Math.abs(wheelRpm * e.gears[g - 1] * e.final);
      this.shiftTimer = (this.shiftTimer || 0) - dt;
      if (this.shiftTimer <= 0) {
        if (this.gear < e.gears.length && rpmAt(this.gear) > e.redline * 0.93) { this.gear++; this.shiftTimer = 0.4; }
        else if (this.gear > 1 && rpmAt(this.gear) < e.redline * (throttle > 0.6 ? 0.5 : 0.33) && rpmAt(this.gear - 1) < e.redline * 0.82) { this.gear--; this.shiftTimer = 0.4; }
      }
    }

    // speed sensitive steering
    const maxSteer = 0.62 / (1 + Math.abs(this.speed) / 14);
    const target = inp.steer * maxSteer;
    const rate = 2.6 * dt;
    this.steerSmooth += Math.max(-rate, Math.min(rate, target - this.steerSmooth));

    // aero drag spread over nodes, as accelerations
    const v2 = this.absSpeed;
    this.dragK = 0.5 * 1.22 * 0.33 * 2.2 / T.mass;
    this._v = v2;

    // damage readout
    this.damage = W.deformEnergy[this.body.id];
    this.lastImpulse = W.contactImpulse[this.body.id];
    W.contactImpulse[this.body.id] = 0;
  }

  drivenOmega() {
    let s = 0, n = 0;
    for (const w of this.wheels) if (w.driven && !w.detached) { s += w.omega; n++; }
    return n ? s / n : 0;
  }

  engineTorque(rpm) {
    const e = this.type.engine;
    const x = rpm / e.peakRpm;
    // simple bell curve, falls off after peak
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

    // drag
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
    let wOmega = this.drivenOmega();
    let rpm = Math.abs(wOmega * ratio) * 60 / (2 * Math.PI);
    const clutchSlip = rpm < e.idle * 1.3;
    if (rpm < e.idle) rpm = e.idle;
    // engine rpm approaches wheel rpm (with clutch slip at low speed)
    const targetRpm = clutchSlip ? Math.max(rpm, e.idle + throttle * 2500) : rpm;
    this.rpm += (Math.min(targetRpm, e.redline * 1.04) - this.rpm) * Math.min(1, dt * 20);
    let engT = 0;
    if (this.rpm < e.redline) engT = this.engineTorque(this.rpm) * throttle;
    else this.limiter = 1;
    // engine braking
    engT -= (1 - throttle) * (this.rpm / e.redline) * e.torque * 0.18 * (clutchSlip ? 0 : 1);
    const nDriven = this.wheels.filter(w => w.driven && !w.detached).length || 1;
    const wheelDrive = engT * ratio * 0.9 / nDriven;

    const col = this.game.worldMap;
    const cands = this.body.worldCandidates;
    const out = this._cout || (this._cout = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 1 });
    const steer = this.steerSmooth;

    // anti-roll bars: resist left/right compression difference on each axle
    for (let a = 0; a < 4; a += 2) {
      const wl = this.wheels[a], wr = this.wheels[a + 1];
      if (wl.detached || wr.detached) continue;
      const comp = (w) => {
        const dx = W.px[w.hub] - W.px[w.top], dy = W.py[w.hub] - W.py[w.top], dz = W.pz[w.hub] - W.pz[w.top];
        return -(dx * ux + dy * uy + dz * uz); // vertical distance hub->mount
      };
      const F = wl.arb * (comp(wr) - comp(wl));
      // F>0: left side more compressed -> push left hub down, right hub up
      W.fx[wl.hub] -= F * ux; W.fy[wl.hub] -= F * uy; W.fz[wl.hub] -= F * uz;
      W.fx[wl.top] += F * ux; W.fy[wl.top] += F * uy; W.fz[wl.top] += F * uz;
      W.fx[wr.hub] += F * ux; W.fy[wr.hub] += F * uy; W.fz[wr.hub] += F * uz;
      W.fx[wr.top] -= F * ux; W.fy[wr.top] -= F * uy; W.fz[wr.top] -= F * uz;
    }

    for (const w of this.wheels) {
      const h = w.hub;
      if (!w.detached && W.broken[w.links[0]] && W.broken[w.links[1]]) { w.detached = true; W.broken[w.spring] = 1; }
      // wheel axis (steered)
      let sa = 0;
      if (w.steer && !w.detached) {
        // Ackermann: inner wheel turns more
        const inner = (steer > 0) === (w.side < 0);
        sa = steer * (inner ? 1.08 : 0.93);
      }
      w.steerAngle = sa;
      const cs = Math.cos(sa), sn = Math.sin(sa);
      // axis = right*cos + fwd*sin
      const axx = rx * cs + fx * sn, axy = ry * cs + fy * sn, axz = rz * cs + fz * sn;

      // drive & brake torques on the wheel
      let T_drive = w.driven && !w.detached ? wheelDrive : 0;
      // traction control: trim torque on a wheel that spins much faster than the ground
      if (this.game.tcs && T_drive !== 0 && w.contact) {
        const over = Math.abs(w.omega * w.R) - Math.abs(w.vlong || 0) - Math.max(1.2, Math.abs(w.vlong || 0) * 0.12);
        w.tc = Math.max(0.05, Math.min(1, (w.tc ?? 1) + (over > 0 ? -dt * 25 : dt * 4)));
        T_drive *= w.tc;
      } else w.tc = 1;
      let brakeT = brake * w.brakeMax * 1.25;
      // simple ABS: release when the wheel is close to locking
      if (brakeT > 0 && w.contact && w.vlong > 3 && Math.abs(w.omega * w.R) < w.vlong * 0.82) brakeT *= 0.2;
      if (!w.front && this.input.handbrake > 0.5) brakeT = Math.max(brakeT, 5000);

      const wasContact = w.contact; w.contact = false; w.slip = 0; w.load = 0;
      const px = W.px[h], py = W.py[h], pz = W.pz[h];
      const hit = col.contact(px, py, pz, w.R, cands, out);
      if (hit) {
        const nx = out.nx, ny = out.ny, nz = out.nz;
        const vx = W.vx[h], vy = W.vy[h], vz = W.vz[h];
        const vn = vx * nx + vy * ny + vz * nz;
        let Fn = 2.6e5 * out.depth - 2400 * vn;
        if (Fn > 0) {
          if (Fn > 60000) Fn = 60000;
          // rolling direction F = axis x N
          let Fx = axy * nz - axz * ny, Fy = axz * nx - axx * nz, Fz = axx * ny - axy * nx;
          const fl = Math.hypot(Fx, Fy, Fz) || 1; Fx /= fl; Fy /= fl; Fz /= fl;
          // lateral L = N x F
          const Lx = ny * Fz - nz * Fy, Ly = nz * Fx - nx * Fz, Lz = nx * Fy - ny * Fx;
          const vlong = vx * Fx + vy * Fy + vz * Fz;
          const vlat = vx * Lx + vy * Ly + vz * Lz;
          const sx = w.omega * w.R - vlong; // longitudinal slip velocity
          const sy = -vlat;
          const av = Math.abs(vlong);
          const px_ = Math.max(0.6, 0.09 * av), py_ = Math.max(0.5, 0.07 * av);
          const nxs = sx / px_, nys = sy / py_;
          const sl = Math.hypot(nxs, nys);
          const mu = 1.1 * out.friction;
          let fLong = 0, fLat = 0;
          if (sl > 1e-6) {
            // peaky curve: rises to 1 near sl=1, settles to 0.85 when sliding
            const c = Math.sin(1.35 * Math.atan(2.4 * sl));
            const Fm = mu * Fn * c / sl;
            fLong = Fm * nxs; fLat = Fm * nys;
            // keep the explicit integration stable: never overshoot the slip in one step
            const mLong = Math.abs(sx) / (dt * (w.R * w.R / w.I + 1 / 32)) * 0.8;
            if (fLong > mLong) fLong = mLong; else if (fLong < -mLong) fLong = -mLong;
            const mLat = Math.abs(sy) * 32 / dt * 0.8;
            if (fLat > mLat) fLat = mLat; else if (fLat < -mLat) fLat = -mLat;
          }
          w.vlong = vlong;
          w.slip = sl; w.load = Fn; w.contact = true; w.surf = out.friction;
          const ffx = nx * Fn + Fx * fLong + Lx * fLat;
          const ffy = ny * Fn + Fy * fLong + Ly * fLat;
          const ffz = nz * Fn + Fz * fLong + Lz * fLat;
          W.fx[h] += ffx; W.fy[h] += ffy; W.fz[h] += ffz;
          T_drive -= fLong * w.R;
          // rolling resistance
          T_drive -= Math.sign(w.omega) * Fn * 0.012 * w.R;
        }
      }
      // integrate wheel spin
      w.omega += T_drive / w.I * dt;
      // brakes: never reverse the wheel
      const dB = brakeT / w.I * dt;
      if (Math.abs(w.omega) <= dB) w.omega = 0; else w.omega -= Math.sign(w.omega) * dB;
      if (w.omega > 400) w.omega = 400; else if (w.omega < -400) w.omega = -400;
      w.angle += w.omega * dt;
    }
  }

  // ------------------------------------------------------------------
  // visuals: lofted body skinned to the nodes ("flexbody")
  // ------------------------------------------------------------------
  buildVisual() {
    const T = this.type, scene = this.game.scene;
    const NZ = 70, ring = [];
    const zF = T.front, zR = T.front - T.length;
    const verts = [], groupsOf = [];
    const axles = [T.axleF, T.axleR];
    const archR = T.wheelR + 0.07;
    const crown = 0.03;
    const section = (z) => {
      let [belt, roof, hw, rhw] = lerpProfile(T.profile, z);
      if (roof - belt < 0.05) { roof = belt + crown; rhw = hw * 0.75; }
      const f = T.floor;
      let a = f;
      for (const az of axles) {
        const dz = z - az;
        if (Math.abs(dz) < archR) a = Math.max(a, T.wheelR + Math.sqrt(archR * archR - dz * dz) * 0.95);
      }
      // round off the bumpers in plan & elevation
      const endD = Math.min(zF - z, z - zR);
      let sc = 1, lift = 0;
      if (endD < 0.22) { const u = 1 - endD / 0.22; sc = 0.8 + 0.2 * Math.sqrt(1 - u * u); lift = u * u * 0.08; }
      hw *= sc; rhw *= sc;
      const P = [];
      P.push([0, f + lift]);
      P.push([hw * 0.55, f + lift]);
      P.push([hw * 0.6, a + lift * 0.5]);
      P.push([hw * 0.97, a + lift * 0.5]);
      P.push([hw, a + (belt - a) * 0.4]);
      P.push([hw, a + (belt - a) * 0.8]);
      P.push([hw * 0.985, belt]);
      const ts = [0.12, 0.45, 0.8, 1];
      for (const t of ts) {
        const e = 1 - (1 - t) * (1 - t);
        P.push([hw + (rhw - hw) * t, belt + (roof - belt) * e]);
      }
      P.push([rhw * 0.5, roof + crown * 0.7]);
      P.push([0, roof + crown]);
      return { P, belt, roof, hw, rhw };
    };
    const right = section(0).P.length;
    const ringN = right * 2 - 2; // mirrored, sharing the two centre points
    const ringInfo = [];
    for (let s = 0; s <= NZ; s++) {
      const z = zF - (s / NZ) * T.length;
      const sec = section(z);
      ringInfo.push({ z, ...sec });
      const P = sec.P;
      // right half bottom->top, then left half top->bottom
      for (let i = 0; i < right; i++) verts.push([P[i][0], P[i][1], z]);
      for (let i = right - 2; i >= 1; i--) verts.push([-P[i][0], P[i][1], z]);
    }
    const idx = [];
    for (let s = 0; s < NZ; s++) for (let i = 0; i < ringN; i++) {
      const a = s * ringN + i, b = s * ringN + (i + 1) % ringN;
      const c = a + ringN, d = b + ringN;
      idx.push(a, c, b, b, c, d);
    }
    // end caps
    for (const s of [0, NZ]) {
      const base = s * ringN;
      let cx = 0, cy = 0;
      for (let i = 0; i < ringN; i++) { cy += verts[base + i][1]; }
      cy /= ringN;
      const ci = verts.length; verts.push([cx, cy, verts[base][2]]);
      for (let i = 0; i < ringN; i++) {
        const a = base + i, b = base + (i + 1) % ringN;
        if (s === 0) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }

    // classify triangles into material groups
    const cab = T.cabin;
    const classify = (x, y, z) => {
      const sec = section(z);
      const ax = Math.abs(x);
      if (z <= cab[0] - 0.04 && z >= cab[1] + 0.04 && y > sec.belt + 0.05 && y < sec.roof - 0.04 && Math.abs(z - T.bPillar) > 0.07) return 1; // glass
      if (z > zF - 0.12 && y > sec.belt - 0.2 && y < sec.belt - 0.04 && ax > sec.hw - 0.42 && ax < sec.hw - 0.05) return 2; // headlight
      if (z < zR + 0.12 && y > sec.belt - 0.22 && y < sec.belt - 0.06 && ax > sec.hw - 0.4 && ax < sec.hw - 0.04) return 3; // taillight
      if (y < T.floor + 0.1 || (Math.min(zF - z, z - zR) < 0.1 && y < sec.belt - 0.3)) return 4; // black trim / bumpers
      if (z > zF - 0.1 && ax < 0.42 && y > sec.belt - 0.3 && y < sec.belt - 0.08) return 4; // grille
      return 0;
    };
    const buckets = [[], [], [], [], []];
    // classify whole quads (pairs of triangles) so material edges stay clean
    const nQuad = NZ * ringN * 6;
    for (let t = 0; t < idx.length; t += 6) {
      if (t >= nQuad) {
        for (let u = t; u < idx.length; u += 3) buckets[0].push(idx[u], idx[u + 1], idx[u + 2]);
        break;
      }
      let cx = 0, cy = 0, cz = 0;
      for (let u = 0; u < 6; u++) { const q = verts[idx[t + u]]; cx += q[0]; cy += q[1]; cz += q[2]; }
      const g = classify(cx / 6, cy / 6, cz / 6);
      buckets[g].push(...idx.slice(t, t + 6));
    }
    // pickup bed: hollow it by making the bed top darker trim (simple)
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const allIdx = [];
    let start = 0;
    buckets.forEach((b, gi) => { geo.addGroup(start, b.length, gi); allIdx.push(...b); start += b.length; });
    geo.setIndex(allIdx);
    geo.computeVertexNormals();
    // fix winding so normals point outward (check a roof vertex)
    const ni = right - 1; // top centre of first ring
    if (geo.attributes.normal.getY(ni + ringN * Math.round(NZ / 2)) < 0) {
      const ix = geo.index.array;
      for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
      geo.computeVertexNormals();
    }
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const env = this.game.envMap;
    const mats = [
      new THREE.MeshPhysicalMaterial({ color: this.color, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.0 }),
      new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.2, roughness: 0.05, envMapIntensity: 1.4 }),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1.2, roughness: 0.2 }),
      new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 0.5, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7, metalness: 0.1 }),
    ];
    this.tailMat = mats[3];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.mesh = mesh;

    // skin: each vertex follows its 4 nearest body nodes
    const K = 4;
    const nv = verts.length;
    this.skinIdx = new Int32Array(nv * K);
    this.skinW = new Float32Array(nv * K);
    this.skinOff = new Float32Array(nv * K * 3);
    const bn = this.bodyNodes.map(id => ({ id, r: this.restPos[this.nodes.indexOf(id)] }));
    for (let v = 0; v < nv; v++) {
      const p = verts[v];
      const best = [];
      for (const n of bn) {
        const d = Math.hypot(p[0] - n.r[0], p[1] - n.r[1], p[2] - n.r[2]);
        if (best.length < K || d < best[K - 1].d) {
          best.push({ n, d }); best.sort((a, b) => a.d - b.d); if (best.length > K) best.pop();
        }
      }
      let ws = 0;
      const w = best.map(b => { const x = 1 / Math.pow(b.d + 0.05, 2); ws += x; return x; });
      best.forEach((b, k) => {
        this.skinIdx[v * K + k] = b.n.id;
        this.skinW[v * K + k] = w[k] / ws;
        // offset in rest frame coordinates (rest frame is ~identity)
        this.skinOff[(v * K + k) * 3] = p[0] - b.n.r[0];
        this.skinOff[(v * K + k) * 3 + 1] = p[1] - b.n.r[1];
        this.skinOff[(v * K + k) * 3 + 2] = p[2] - b.n.r[2];
      });
    }
    this.skinK = K;

    // wheels
    this.wheelMeshes = this.wheels.map(w => this.makeWheelMesh(w));
  }

  makeWheelMesh(w) {
    const T = this.type, R = T.wheelR, W = T.wheelW;
    const g = new THREE.Group();
    if (!Vehicle._wheelCache) Vehicle._wheelCache = {};
    const key = this.typeKey;
    let c = Vehicle._wheelCache[key];
    if (!c) {
      // tyre: lathe profile around the axle (x)
      const pts = [];
      const rr = R * 0.66;
      const prof = [[rr, -W / 2], [R * 0.92, -W / 2], [R * 0.99, -W * 0.42], [R, -W * 0.25], [R, W * 0.25], [R * 0.99, W * 0.42], [R * 0.92, W / 2], [rr, W / 2]];
      for (const [r, x] of prof) pts.push(new THREE.Vector2(r, x));
      const tire = new THREE.LatheGeometry(pts, 28);
      tire.rotateZ(-Math.PI / 2);
      const rim = new THREE.CylinderGeometry(rr, rr, W * 0.8, 20, 1, false);
      rim.rotateZ(Math.PI / 2);
      const spokes = [];
      for (let i = 0; i < 5; i++) {
        const s = new THREE.BoxGeometry(0.03, rr * 1.9, 0.06);
        s.rotateX((i / 5) * Math.PI);
        s.translate(W * 0.36, 0, 0);
        spokes.push(s);
      }
      const hubCap = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12); hubCap.rotateZ(Math.PI / 2); hubCap.translate(W * 0.4, 0, 0);
      c = Vehicle._wheelCache[key] = {
        tire, rim, spokes, hubCap,
        tireMat: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 }),
        rimMat: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }),
        darkMat: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.7 }),
      };
    }
    const tire = new THREE.Mesh(c.tire, c.tireMat);
    const rim = new THREE.Mesh(c.rim, c.darkMat);
    g.add(tire, rim);
    for (const s of c.spokes) g.add(new THREE.Mesh(s, c.rimMat));
    g.add(new THREE.Mesh(c.hubCap, c.rimMat));
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    this.game.scene.add(g);
    return g;
  }

  updateVisual() {
    const W = this.world;
    const fr = this.computeFrame(false, this._vf || (this._vf = {}));
    const [r0, r1, r2] = fr.r, [u0, u1, u2] = fr.u, [f0, f1, f2] = fr.f;
    const pos = this.mesh.geometry.attributes.position.array;
    const K = this.skinK, si = this.skinIdx, sw = this.skinW, so = this.skinOff;
    const px = W.px, py = W.py, pz = W.pz;
    const nv = pos.length / 3;
    for (let v = 0; v < nv; v++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < K; k++) {
        const j = v * K + k, id = si[j], w = sw[j];
        const ox = so[j * 3], oy = so[j * 3 + 1], oz = so[j * 3 + 2];
        x += w * (px[id] + r0 * ox + u0 * oy + f0 * oz);
        y += w * (py[id] + r1 * ox + u1 * oy + f1 * oz);
        z += w * (pz[id] + r2 * ox + u2 * oy + f2 * oz);
      }
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    // brake lights
    this.tailMat.emissiveIntensity = (this.brakeEff > 0.1 || this.gear === -1) ? 2.2 : 0.45;

    // wheels
    const m = this._m || (this._m = new THREE.Matrix4());
    const rot = this._rq || (this._rq = new THREE.Matrix4());
    this.wheels.forEach((w, i) => {
      const g = this.wheelMeshes[i];
      const sa = w.steerAngle, cs = Math.cos(sa), sn = Math.sin(sa);
      // axle, up, forward for the steered wheel
      const ax = [r0 * cs + f0 * sn, r1 * cs + f1 * sn, r2 * cs + f2 * sn];
      const fw = [f0 * cs - r0 * sn, f1 * cs - r1 * sn, f2 * cs - r2 * sn];
      const s = w.side;
      m.set(
        ax[0] * s, u0, fw[0], W.px[w.hub],
        ax[1] * s, u1, fw[1], W.py[w.hub],
        ax[2] * s, u2, fw[2], W.pz[w.hub],
        0, 0, 0, 1);
      rot.makeRotationX(w.angle);
      m.multiply(rot);
      g.matrixAutoUpdate = false;
      g.matrix.copy(m);
      g.matrixWorldNeedsUpdate = true;
    });
  }

  // position & orientation helpers for the camera
  center() {
    const W = this.world, c = this.ref.c;
    const f = this.frame || this.computeFrame();
    return new THREE.Vector3(W.px[c], W.py[c], W.pz[c]);
  }

  dispose() {
    const idx = this.world.onSubstep.indexOf(this._substep);
    if (idx >= 0) this.world.onSubstep.splice(idx, 1);
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    for (const g of this.wheelMeshes) this.game.scene.remove(g);
  }

  // numbers for the debug overlay
  stats() {
    return { nodes: this.body.nodeEnd - this.body.nodeStart, beams: this.body.beamEnd - this.body.beamStart };
  }
}
