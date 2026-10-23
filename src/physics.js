// Node/beam soft-body solver (BeamNG style).
// Every vehicle and prop is a set of point masses ("nodes") joined by
// damped springs ("beams"). Beams yield (dent permanently) past a force
// limit and break past a strain limit. Data lives in flat typed arrays so
// the inner loops stay allocation-free and fast.

export const GRAVITY = -9.81;

export const BEAM_NORMAL = 0;
export const BEAM_HYDRO = 1;   // rest length driven by an input (steering etc.)
export const BEAM_SUPPORT = 2; // only pushes, never pulls (bump stops)

export class SoftBodyWorld {
  constructor(maxNodes = 4096, maxBeams = 24576) {
    this.maxNodes = maxNodes;
    this.maxBeams = maxBeams;
    this.nodeCount = 0;
    this.beamCount = 0;

    // nodes
    this.px = new Float64Array(maxNodes);
    this.py = new Float64Array(maxNodes);
    this.pz = new Float64Array(maxNodes);
    this.vx = new Float64Array(maxNodes);
    this.vy = new Float64Array(maxNodes);
    this.vz = new Float64Array(maxNodes);
    this.fx = new Float64Array(maxNodes);
    this.fy = new Float64Array(maxNodes);
    this.fz = new Float64Array(maxNodes);
    this.mass = new Float64Array(maxNodes);
    this.invMass = new Float64Array(maxNodes);
    this.friction = new Float32Array(maxNodes);
    this.radius = new Float32Array(maxNodes);  // world contact radius
    this.cradius = new Float32Array(maxNodes); // body-vs-body radius
    this.body = new Int32Array(maxNodes);
    this.collides = new Uint8Array(maxNodes); // collides with world
    this.selfColl = new Uint8Array(maxNodes); // collides with other bodies

    // beams
    this.ba = new Int32Array(maxBeams);
    this.bb = new Int32Array(maxBeams);
    this.rest = new Float64Array(maxBeams);
    this.rest0 = new Float64Array(maxBeams);
    this.k = new Float64Array(maxBeams);
    this.d = new Float64Array(maxBeams);
    this.yieldF = new Float64Array(maxBeams);
    this.breakStrain = new Float32Array(maxBeams);
    this.broken = new Uint8Array(maxBeams);
    this.btype = new Uint8Array(maxBeams);
    this.hydroIn = new Float32Array(maxBeams);  // hydro factor
    this.hydroRef = new Int32Array(maxBeams);   // which input channel
    this.limit = new Float32Array(maxBeams);    // bump-stop limit (fraction)
    this.stress = new Float32Array(maxBeams);   // for debug view
    this.bbody = new Int32Array(maxBeams);

    this.bodies = [];
    this.hydroInputs = new Float32Array(64);
    this.collider = null;      // static world collider
    this.onSubstep = [];       // per-substep force callbacks (wheels, engine)
    this.time = 0;
    this.deformEnergy = new Float64Array(256); // per body
    this.contactImpulse = new Float64Array(256);
  }

  createBody(name) {
    const b = {
      id: this.bodies.length, name,
      nodeStart: this.nodeCount, nodeEnd: this.nodeCount,
      beamStart: this.beamCount, beamEnd: this.beamCount,
      min: [0, 0, 0], max: [0, 0, 0], active: true,
      worldCandidates: [],
    };
    this.bodies.push(b);
    return b;
  }

  addNode(body, x, y, z, m, opts = {}) {
    const i = this.nodeCount++;
    if (i >= this.maxNodes) throw new Error('node pool full');
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.mass[i] = m; this.invMass[i] = 1 / m;
    this.friction[i] = opts.friction ?? 0.8;
    this.radius[i] = opts.radius ?? 0.04;
    this.cradius[i] = opts.cradius ?? 0.25;
    this.collides[i] = opts.collides === false ? 0 : 1;
    this.selfColl[i] = opts.selfColl === false ? 0 : 1;
    this.body[i] = body.id;
    body.nodeEnd = this.nodeCount;
    return i;
  }

  addBeam(body, a, b, opts = {}) {
    const i = this.beamCount++;
    if (i >= this.maxBeams) throw new Error('beam pool full');
    const dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a], dz = this.pz[b] - this.pz[a];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.ba[i] = a; this.bb[i] = b;
    this.rest[i] = this.rest0[i] = opts.rest ?? L;
    this.k[i] = opts.k ?? 1.5e6;
    this.d[i] = opts.d ?? 120;
    this.yieldF[i] = opts.yieldF ?? Infinity;
    this.breakStrain[i] = opts.breakStrain ?? Infinity;
    this.broken[i] = 0;
    this.btype[i] = opts.type ?? BEAM_NORMAL;
    this.hydroIn[i] = opts.hydroFactor ?? 0;
    this.hydroRef[i] = opts.hydroChannel ?? 0;
    this.limit[i] = opts.limit ?? 0;
    this.bbody[i] = body.id;
    body.beamEnd = this.beamCount;
    return i;
  }

  // Remove the most recently created bodies (respawn support).
  truncate(bodyId) {
    const b = this.bodies[bodyId];
    this.nodeCount = b.nodeStart;
    this.beamCount = b.beamStart;
    this.bodies.length = bodyId;
  }

  translateBody(body, dx, dy, dz) {
    for (let i = body.nodeStart; i < body.nodeEnd; i++) {
      this.px[i] += dx; this.py[i] += dy; this.pz[i] += dz;
    }
  }

  updateBounds() {
    const { px, py, pz } = this;
    for (const b of this.bodies) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = b.nodeStart; i < b.nodeEnd; i++) {
        const x = px[i], y = py[i], z = pz[i];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      b.min[0] = x0; b.min[1] = y0; b.min[2] = z0;
      b.max[0] = x1; b.max[1] = y1; b.max[2] = z1;
    }
  }

  // Called once per rendered frame: refresh broad-phase data and sleeping.
  prepareFrame(frameDt = 1 / 60) {
    this.updateBounds();
    const { vx, vy, vz } = this;
    // sleep bodies that have been still for a while (big win for parked cars & crate stacks)
    for (const b of this.bodies) {
      if (b.sleeping || b.noSleep) continue;
      let mx = 0;
      for (let i = b.nodeStart; i < b.nodeEnd; i++) {
        const s = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
        if (s > mx) mx = s;
      }
      b.stillTime = mx < 0.0016 ? (b.stillTime || 0) + frameDt : 0;
      if (b.stillTime > 1.0) this.sleep(b);
    }
    if (this.collider) {
      for (const b of this.bodies) if (!b.sleeping) b.worldCandidates = this.collider.query(b.min, b.max, 4);
    }
    // body pairs that may touch (at least one awake; touching wakes the other)
    const pairs = this._pairs || (this._pairs = []);
    pairs.length = 0;
    const B = this.bodies, m = 1.0;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (!a.active || !b.active || (a.sleeping && b.sleeping)) continue;
      if (a.min[0] - m > b.max[0] || b.min[0] - m > a.max[0] ||
          a.min[1] - m > b.max[1] || b.min[1] - m > a.max[1] ||
          a.min[2] - m > b.max[2] || b.min[2] - m > a.max[2]) continue;
      if (a.sleeping) this.wake(a);
      if (b.sleeping) this.wake(b);
      pairs.push(a, b);
    }
  }

  sleep(b) {
    b.sleeping = true;
    for (let i = b.nodeStart; i < b.nodeEnd; i++) this.vx[i] = this.vy[i] = this.vz[i] = 0;
  }

  wake(b) {
    if (!b.sleeping) return;
    b.sleeping = false; b.stillTime = 0;
    if (this.collider) b.worldCandidates = this.collider.query(b.min, b.max, 4);
  }

  step(dt) {
    const B = this.bodies;
    for (let bi = 0; bi < B.length; bi++) {
      const b = B[bi];
      if (b.sleeping) continue;
      this._beams(b.nodeStart, b.nodeEnd, b.beamStart, b.beamEnd);
    }

    for (let c = 0; c < this.onSubstep.length; c++) this.onSubstep[c](dt);

    // ---- body vs body (node spheres) ----
    const pairs = this._pairs;
    if (pairs) for (let p = 0; p < pairs.length; p += 2) this._collideBodies(pairs[p], pairs[p + 1], dt);

    // ---- world contact ----
    if (this.collider) this._collideWorld(dt);

    // ---- integrate (symplectic Euler) ----
    const { px, py, pz, vx, vy, vz, fx, fy, fz, invMass } = this;
    for (let bi = 0; bi < B.length; bi++) {
      const b = B[bi];
      if (b.sleeping) continue;
      for (let i = b.nodeStart, e = b.nodeEnd; i < e; i++) {
        const im = invMass[i];
        vx[i] += fx[i] * im * dt;
        vy[i] += fy[i] * im * dt;
        vz[i] += fz[i] * im * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        pz[i] += vz[i] * dt;
      }
    }
    this.time += dt;
  }

  // gravity + internal beam forces for one body
  _beams(n0, n1, b0, b1) {
    const { px, py, pz, vx, vy, vz, fx, fy, fz, mass } = this;
    for (let i = n0; i < n1; i++) {
      fx[i] = 0; fy[i] = mass[i] * GRAVITY; fz[i] = 0;
    }

    // ---- beams ----
    const { ba, bb, rest, rest0, k, d, yieldF, breakStrain, broken, btype, stress, hydroIn, hydroRef, limit } = this;
    const hin = this.hydroInputs;
    const dE = this.deformEnergy;
    for (let i = b0; i < b1; i++) {
      if (broken[i]) continue;
      const a = ba[i], b = bb[i];
      const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9;
      const nx = dx / L, ny = dy / L, nz = dz / L;
      const vrel = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny + (vz[b] - vz[a]) * nz;
      const t = btype[i];
      let r = rest[i];
      if (t === BEAM_HYDRO) r = rest0[i] * (1 + hydroIn[i] * hin[hydroRef[i]]);
      let ext = L - r;
      let F;
      if (t === BEAM_SUPPORT) {
        if (ext >= 0) { stress[i] = 0; continue; }
        F = k[i] * ext + d[i] * vrel;
        if (F > 0) F = 0;
      } else {
        let Fs = k[i] * ext;
        const y = yieldF[i];
        if (Fs > y || Fs < -y) {
          // plastic flow: move rest length so the spring sits at the yield force
          const lim = Fs > 0 ? y : -y;
          const newRest = L - lim / k[i];
          dE[this.bbody[i]] += Math.abs(newRest - r) * y;
          rest[i] = r = newRest;
          ext = L - r;
          Fs = lim;
          const strain = r / rest0[i] - 1;
          if (strain > breakStrain[i] || strain < -breakStrain[i] * 1.5) { broken[i] = 1; stress[i] = 0; continue; }
        }
        F = Fs + d[i] * vrel;
        const lm = limit[i];
        if (lm > 0) {
          // progressive bump stop past +-limit
          const rel = ext / r;
          if (rel > lm) F += k[i] * 40 * (ext - lm * r);
          else if (rel < -lm) F += k[i] * 40 * (ext + lm * r);
        }
      }
      stress[i] = F;
      const Fx = F * nx, Fy = F * ny, Fz = F * nz;
      fx[a] += Fx; fy[a] += Fy; fz[a] += Fz;
      fx[b] -= Fx; fy[b] -= Fy; fz[b] -= Fz;
    }
  }

  _collideWorld(dt) {
    const { px, py, pz, vx, vy, vz, fx, fy, fz, mass, friction, radius, collides } = this;
    const col = this.collider;
    const out = this._cout || (this._cout = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 1 });
    const KC = 8.0e4, CC = 520;
    const CI = this.contactImpulse;
    for (const b of this.bodies) {
      if (!b.active || b.sleeping) continue;
      const cands = b.worldCandidates;
      for (let i = b.nodeStart; i < b.nodeEnd; i++) {
        if (!collides[i]) continue;
        if (!col.contact(px[i], py[i], pz[i], radius[i], cands, out)) continue;
        const m = mass[i];
        const nx = out.nx, ny = out.ny, nz = out.nz;
        const vn = vx[i] * nx + vy[i] * ny + vz[i] * nz;
        let Fn = m * (KC * out.depth - CC * vn);
        if (Fn <= 0) continue;
        if (vn < -3) CI[b.id] += -vn * m;
        // tangential friction (regularised Coulomb)
        const tx = vx[i] - vn * nx, ty = vy[i] - vn * ny, tz = vz[i] - vn * nz;
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        let fxi = Fn * nx, fyi = Fn * ny, fzi = Fn * nz;
        if (vt > 1e-6) {
          const mu = friction[i] * out.friction;
          const Ft = Math.min(mu * Fn, m * vt / dt * 0.5) / vt;
          fxi -= tx * Ft; fyi -= ty * Ft; fzi -= tz * Ft;
        }
        fx[i] += fxi; fy[i] += fyi; fz[i] += fzi;
      }
    }
  }

  _collideBodies(A, B, dt) {
    const { px, py, pz, vx, vy, vz, fx, fy, fz, mass, selfColl } = this;
    const radius = this.cradius;
    const K = 4.0e4, C = 380;
    const m = 0.6;
    // cull B's nodes to A's box once
    const bx0 = A.min[0] - m, bx1 = A.max[0] + m, by0 = A.min[1] - m, by1 = A.max[1] + m, bz0 = A.min[2] - m, bz1 = A.max[2] + m;
    const list = this._blist || (this._blist = new Int32Array(this.maxNodes));
    let cnt = 0;
    for (let j = B.nodeStart; j < B.nodeEnd; j++) {
      if (!selfColl[j]) continue;
      const x = px[j], y = py[j], z = pz[j];
      if (x < bx0 || x > bx1 || y < by0 || y > by1 || z < bz0 || z > bz1) continue;
      list[cnt++] = j;
    }
    if (!cnt) return;
    const CI = this.contactImpulse;
    for (let i = A.nodeStart; i < A.nodeEnd; i++) {
      if (!selfColl[i]) continue;
      const xi = px[i], yi = py[i], zi = pz[i], ri = radius[i];
      if (xi < B.min[0] - m || xi > B.max[0] + m || yi < B.min[1] - m || yi > B.max[1] + m || zi < B.min[2] - m || zi > B.max[2] + m) continue;
      for (let c = 0; c < cnt; c++) {
        const j = list[c];
        const dx = px[j] - xi, dy = py[j] - yi, dz = pz[j] - zi;
        const R = ri + radius[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R * R || d2 < 1e-12) continue;
        const dist = Math.sqrt(d2);
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const mr = (mass[i] * mass[j]) / (mass[i] + mass[j]);
        const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny + (vz[j] - vz[i]) * nz;
        let F = mr * (K * (R - dist) - C * vn);
        if (F <= 0) continue;
        if (vn < -3) { CI[A.id] += -vn * mr; CI[B.id] += -vn * mr; }
        // a little friction between bodies
        const tx = (vx[j] - vx[i]) - vn * nx, ty = (vy[j] - vy[i]) - vn * ny, tz = (vz[j] - vz[i]) - vn * nz;
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        let gx = F * nx, gy = F * ny, gz = F * nz;
        if (vt > 1e-6) {
          const Ft = Math.min(0.5 * F, mr * vt / dt * 0.5) / vt;
          gx -= tx * Ft; gy -= ty * Ft; gz -= tz * Ft;
        }
        fx[j] += gx; fy[j] += gy; fz[j] += gz;
        fx[i] -= gx; fy[i] -= gy; fz[i] -= gz;
      }
    }
  }
}
