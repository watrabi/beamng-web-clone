import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded gradient noise
// ---------------------------------------------------------------------------
export function makeNoise(seed = 1337) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => { const g = h & 7; const u = g < 4 ? x : y, v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
    const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
    return (l1 + v * (l2 - l1)) * 0.25;
  }
  return { noise, rnd };
}

export function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------------------
// Static colliders: oriented boxes and capsules, bucketed in a uniform grid.
// ---------------------------------------------------------------------------
export class Box {
  constructor(cx, cy, cz, hx, hy, hz, yaw = 0, pitch = 0, roll = 0, friction = 0.9) {
    this.c = new THREE.Vector3(cx, cy, cz);
    this.h = [hx, hy, hz];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    this.quat = q;
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    // local axes (columns)
    this.ax = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    this.friction = friction;
    const r = Math.hypot(hx, hy, hz);
    this.min = [cx - r, cy - r, cz - r];
    this.max = [cx + r, cy + r, cz + r];
  }
  contact(x, y, z, rad, out) {
    const a = this.ax, h = this.h;
    const dx = x - this.c.x, dy = y - this.c.y, dz = z - this.c.z;
    const lx = dx * a[0] + dy * a[1] + dz * a[2];
    const ly = dx * a[3] + dy * a[4] + dz * a[5];
    const lz = dx * a[6] + dy * a[7] + dz * a[8];
    const ox = Math.abs(lx) - h[0], oy = Math.abs(ly) - h[1], oz = Math.abs(lz) - h[2];
    if (ox > rad || oy > rad || oz > rad) return 0;
    let nlx, nly, nlz, depth;
    if (ox <= 0 && oy <= 0 && oz <= 0) {
      // inside: push out through the nearest face
      if (ox >= oy && ox >= oz) { nlx = Math.sign(lx) || 1; nly = 0; nlz = 0; depth = rad - ox; }
      else if (oy >= oz) { nlx = 0; nly = Math.sign(ly) || 1; nlz = 0; depth = rad - oy; }
      else { nlx = 0; nly = 0; nlz = Math.sign(lz) || 1; depth = rad - oz; }
    } else {
      const cx = Math.max(-h[0], Math.min(h[0], lx));
      const cy = Math.max(-h[1], Math.min(h[1], ly));
      const cz = Math.max(-h[2], Math.min(h[2], lz));
      let ex = lx - cx, ey = ly - cy, ez = lz - cz;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d >= rad || d < 1e-9) return 0;
      nlx = ex / d; nly = ey / d; nlz = ez / d; depth = rad - d;
    }
    out.nx = nlx * a[0] + nly * a[3] + nlz * a[6];
    out.ny = nlx * a[1] + nly * a[4] + nlz * a[7];
    out.nz = nlx * a[2] + nly * a[5] + nlz * a[8];
    out.friction = this.friction;
    return depth;
  }
}

export class Capsule {
  constructor(ax, ay, az, bx, by, bz, r, friction = 0.8) {
    this.a = [ax, ay, az]; this.b = [bx, by, bz]; this.r = r; this.friction = friction;
    this.min = [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r];
    this.max = [Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    this.d = [dx, dy, dz]; this.len2 = Math.max(1e-9, dx * dx + dy * dy + dz * dz);
  }
  contact(x, y, z, rad, out) {
    const a = this.a, d = this.d;
    let t = ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / this.len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (a[0] + d[0] * t), ey = y - (a[1] + d[1] * t), ez = z - (a[2] + d[2] * t);
    const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const R = this.r + rad;
    if (dist >= R || dist < 1e-9) return 0;
    out.nx = ex / dist; out.ny = ey / dist; out.nz = ez / dist; out.friction = this.friction;
    return R - dist;
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// World: terrain + roads + static props, all driven by a map definition
// (see maps.js).
// ---------------------------------------------------------------------------
export class World {
  constructor(scene, textures, quality, def) {
    this.scene = scene;
    this.def = def;
    this.tex = textures;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.size = def.size;
    this.res = Math.round(quality.terrainRes * (def.resScale || 1)) | 1;
    this.cell = this.size / (this.res - 1);
    this.half = this.size / 2;
    this.colliders = [];
    this.gridCell = 16;
    this.grid = new Map();
    this.stamp = 0;
    this.batches = new Map();
    this.mats = {};
    this._tmp = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 1 };
    const { noise, rnd } = makeNoise(def.seed || 1337);
    this.noise = noise; this.rnd = rnd;
    this.smoothstep = smoothstep;
    this.fr = Object.assign({ ground: 0.78, dirt: 0.68, road: 1.0 }, def.friction);

    this.buildRoads();
    if (def.prepare) def.prepare(this);
    this.buildHeights();
    this.buildTerrainMesh();
    if (def.build) def.build(this);
    this.buildTrees();
    this.flushBatches();
    for (const c of this.colliders) this._insert(c);
  }

  add(o) { this.group.add(o); return o; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }

  naturalHeight(x, z) { return this.def.height(x, z, this); }

  // shared materials for props
  mat(name) {
    if (this.mats[name]) return this.mats[name];
    const t = this.tex, S = (o) => new THREE.MeshStandardMaterial(o);
    const m = {
      concrete: () => S({ map: t.concrete, normalMap: t.concreteN, roughness: 0.9 }),
      wood: () => S({ map: t.wood, color: 0xd8c6a0, roughness: 0.8 }),
      metalBlue: () => S({ map: t.metal, color: 0x6688bb, roughness: 0.6, metalness: 0.4 }),
      metalRed: () => S({ map: t.metal, color: 0xbb5544, roughness: 0.6, metalness: 0.4 }),
      metal: () => S({ map: t.metal, roughness: 0.6, metalness: 0.5 }),
      steel: () => S({ color: 0xbbbbbb, metalness: 0.85, roughness: 0.35 }),
      bark: () => S({ map: t.bark, roughness: 0.95 }),
      brick: () => S({ map: t.brick, roughness: 0.9 }),
      rock: () => S({ map: t.rock, roughness: 0.95 }),
      redrock: () => S({ map: t.redrock, color: 0xd8a080, roughness: 0.95 }),
      dark: () => S({ color: 0x1c1c1c, roughness: 0.8 }),
      white: () => S({ color: 0xeeeeee, roughness: 0.7 }),
      stripe: () => S({ color: 0xd8b020, roughness: 0.7 }),
      lamp: () => S({ color: 0xffffff, emissive: 0xfff0c8, emissiveIntensity: 1.2 }),
    }[name];
    return (this.mats[name] = m ? m() : S({ color: 0xff00ff }));
  }

  // ---------------------------------------------------------------------
  buildRoads() {
    this.roads = [];
    const defs = this.def.roads ? this.def.roads(this) : [];
    for (const r of defs) {
      const closed = !!r.closed;
      let samples = [];
      if (r.poly) {
        // straight segments
        const P = r.pts;
        let s = 0;
        const segs = closed ? P.length : P.length - 1;
        for (let i = 0; i < segs; i++) {
          const a = P[i], b = P[(i + 1) % P.length];
          const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 3));
          for (let k = 0; k < n; k++) samples.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n, s: s + L * k / n });
          s += L;
        }
        if (!closed) { const b = P[P.length - 1]; samples.push({ x: b.x, z: b.z, s }); }
      } else {
        const curve = new THREE.CatmullRomCurve3(r.pts, closed, 'centripetal');
        const len = curve.getLength(), n = Math.ceil(len / 3);
        for (let i = 0; i <= n; i++) {
          if (closed && i === n) break;
          const v = curve.getPointAt(i / n);
          samples.push({ x: v.x, z: v.z, s: (i / n) * len });
        }
      }
      const total = samples[samples.length - 1].s || 1;
      for (const q of samples) {
        if (r.flat !== undefined) q.y = r.flat;
        else if (r.linear) q.y = r.linear[0] + (r.linear[1] - r.linear[0]) * q.s / total;
        else q.y = this.naturalHeight(q.x, q.z);
      }
      if (r.flat === undefined && !r.linear) {
        // smooth the profile so grades are drivable
        for (let pass = 0; pass < (r.smooth ?? 30); pass++) {
          const ys = samples.map(q => q.y);
          for (let i = 0; i < samples.length; i++) {
            let sum = 0, c = 0;
            for (let k = -6; k <= 6; k++) {
              let j = i + k;
              if (closed) j = (j + samples.length) % samples.length; else if (j < 0 || j >= samples.length) continue;
              sum += ys[j]; c++;
            }
            samples[i].y = sum / c;
          }
          if (!closed && r.startY !== undefined) samples[0].y = r.startY;
        }
      }
      this.roads.push({ pts: samples, closed, width: 10, dirt: r.surface === 'dirt', markings: r.markings !== false, rails: r.rails });
    }
  }

  // bucket road segments into a grid so lookups only test nearby ones
  buildRoadGrid() {
    const G = 32, M = 40;
    this.segGrid = new Map();
    this.roads.forEach((r, ri) => {
      const p = r.pts, n = p.length, segs = r.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = p[i], b = p[(i + 1) % n];
        for (let cx = Math.floor((Math.min(a.x, b.x) - M) / G); cx <= Math.floor((Math.max(a.x, b.x) + M) / G); cx++)
          for (let cz = Math.floor((Math.min(a.z, b.z) - M) / G); cz <= Math.floor((Math.max(a.z, b.z) + M) / G); cz++) {
            const k = cx * 100003 + cz;
            let l = this.segGrid.get(k); if (!l) this.segGrid.set(k, l = []);
            l.push(ri, i);
          }
      }
    });
  }

  // nearest road info for a point (within ~40 m)
  roadQuery(x, z) {
    let best = Infinity, bu = 0, bs = 0, by = 0, br = null;
    if (!this.segGrid) this.buildRoadGrid();
    const list = this.segGrid.get(Math.floor(x / 32) * 100003 + Math.floor(z / 32));
    if (list) for (let li = 0; li < list.length; li += 2) {
      const r = this.roads[list[li]], i = list[li + 1];
      {
        const p = r.pts, n = p.length;
        const a = p[i], b = p[(i + 1) % n];
        const mx = Math.min(a.x, b.x) - 40, Mx = Math.max(a.x, b.x) + 40;
        if (x < mx || x > Mx) continue;
        const mz = Math.min(a.z, b.z) - 40, Mz = Math.max(a.z, b.z) + 40;
        if (z < mz || z > Mz) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const L2 = dx * dx + dz * dz;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a.x + dx * t - x, qz = a.z + dz * t - z;
        const d = Math.sqrt(qx * qx + qz * qz);
        if (d < best) {
          best = d;
          const cross = dx * (z - a.z) - dz * (x - a.x);
          bu = cross > 0 ? d : -d;
          bs = a.s + Math.sqrt(L2) * t;
          by = a.y + (b.y - a.y) * t;
          br = r;
        }
      }
    }
    return { d: best, u: bu, s: bs, y: by, road: br };
  }

  buildHeights() {
    const R = this.res, def = this.def;
    this.h = new Float32Array(R * R);
    this.road = new Float32Array(R * R);
    this.dirt = new Float32Array(R * R);
    this.roadU = new Float32Array(R * R);
    this.roadS = new Float32Array(R * R);
    const pads = def.pads || [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      const k = j * R + i;
      let h = this.naturalHeight(x, z);
      const rq = this.roadQuery(x, z);
      const hw = 5;
      let road = 0, dirtRoad = 0, u = rq.u;
      if (rq.road) {
        const w = 1 - smoothstep(hw - 0.5, hw + 1.0, rq.d);
        if (rq.road.dirt) dirtRoad = w; else road = w;
        if (!rq.road.markings) u = 99;
        if (rq.d < 40) {
          const b = 1 - smoothstep(hw + 1, hw + 14, rq.d);
          h = h + (rq.y - h) * b;
        }
      }
      for (const p of pads) {
        const hx = p.hx ?? p.half, hz = p.hz ?? p.half;
        const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z);
        // normalised distance: <1 inside the pad
        const n = p.round ? Math.hypot(dx / hx, dz / hz) : Math.max(dx / hx, dz / hz);
        const b = 1 - smoothstep(1, 1 + (p.blend ?? 60) / hx, n);
        h = h + (p.y - h) * b;
        if (n < 1) {
          const w = 1 - smoothstep(1 - 5 / hx, 1, n);
          if (p.surface === 'dirt') dirtRoad = Math.max(dirtRoad, w);
          else if (p.surface !== 'ground') { road = Math.max(road, w); u = 99; }
        }
      }
      this.h[k] = h;
      this.road[k] = road;
      this.roadU[k] = u;
      this.roadS[k] = rq.s;
      let dirt;
      if (def.dirt) dirt = def.dirt(x, z, this, rq);
      else {
        const dn = this.noise(x * 0.02 + 50, z * 0.02) * 0.5 + 0.5;
        dirt = Math.min(1, smoothstep(0.55, 0.75, dn) + (1 - smoothstep(hw + 1, hw + 3.5, rq.d)) * 0.8);
      }
      this.dirt[k] = Math.max(dirtRoad, Math.min(1, dirt)) * (1 - road);
    }
    // steep slopes show the dirt/rock layer
    const sl = def.slopeDirt ?? 0.45;
    for (let j = 1; j < R - 1; j++) for (let i = 1; i < R - 1; i++) {
      const k = j * R + i;
      const sx = (this.h[k + 1] - this.h[k - 1]) / (2 * this.cell), sz = (this.h[k + R] - this.h[k - R]) / (2 * this.cell);
      const slope = Math.hypot(sx, sz);
      this.dirt[k] = Math.max(this.dirt[k], smoothstep(sl, sl + 0.35, slope) * (1 - this.road[k]));
    }
  }

  // exact height matching the rendered triangles
  heightAt(x, z) {
    const R = this.res;
    let fx = (x + this.half) / this.cell, fz = (z + this.half) / this.cell;
    if (fx < 0) fx = 0; else if (fx > R - 1.001) fx = R - 1.001;
    if (fz < 0) fz = 0; else if (fz > R - 1.001) fz = R - 1.001;
    const i = fx | 0, j = fz | 0;
    const u = fx - i, v = fz - j;
    const k = j * R + i, H = this.h;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + R], h11 = H[k + R + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // terrain contact for a sphere; returns depth (>0 when touching)
  terrainContact(x, y, z, rad, out) {
    const R = this.res, c = this.cell;
    let fx = (x + this.half) / c, fz = (z + this.half) / c;
    if (fx < 0) fx = 0; else if (fx > R - 1.001) fx = R - 1.001;
    if (fz < 0) fz = 0; else if (fz > R - 1.001) fz = R - 1.001;
    const i = fx | 0, j = fz | 0;
    const u = fx - i, v = fz - j;
    const k = j * R + i, H = this.h;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + R], h11 = H[k + R + 1];
    let h, nx, ny, nz;
    if (u + v <= 1) {
      h = h00 + (h10 - h00) * u + (h01 - h00) * v;
      nx = -(h10 - h00); ny = c; nz = -(h01 - h00);
    } else {
      h = h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
      nx = -(h11 - h01); ny = c; nz = -(h11 - h10);
    }
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= inv; ny *= inv; nz *= inv;
    const dist = (y - h) * ny;
    const depth = rad - dist;
    if (depth <= 0) return 0;
    out.nx = nx; out.ny = ny; out.nz = nz;
    const rd = this.road[k], dt = this.dirt[k];
    out.friction = rd * this.fr.road + (1 - rd) * (this.fr.ground + (this.fr.dirt - this.fr.ground) * dt);
    return depth;
  }

  // full contact used by the physics: deepest of terrain + nearby colliders
  contact(x, y, z, rad, cands, out) {
    let best = this.terrainContact(x, y, z, rad, out);
    if (cands.length) {
      const t = this._tmp;
      for (let i = 0; i < cands.length; i++) {
        const d = cands[i].contact(x, y, z, rad, t);
        if (d > best) { best = d; out.nx = t.nx; out.ny = t.ny; out.nz = t.nz; out.friction = t.friction; }
      }
    }
    out.depth = best;
    return best > 0;
  }

  _insert(c) {
    const g = this.gridCell;
    for (let i = Math.floor(c.min[0] / g); i <= Math.floor(c.max[0] / g); i++)
      for (let j = Math.floor(c.min[2] / g); j <= Math.floor(c.max[2] / g); j++) {
        const key = i * 100003 + j;
        let l = this.grid.get(key); if (!l) this.grid.set(key, l = []);
        l.push(c);
      }
  }

  query(min, max, margin) {
    const g = this.gridCell, res = [];
    const st = ++this.stamp;
    for (let i = Math.floor((min[0] - margin) / g); i <= Math.floor((max[0] + margin) / g); i++)
      for (let j = Math.floor((min[2] - margin) / g); j <= Math.floor((max[2] + margin) / g); j++) {
        const l = this.grid.get(i * 100003 + j);
        if (!l) continue;
        for (const c of l) {
          if (c._st === st) continue; c._st = st;
          if (c.min[1] > max[1] + margin || c.max[1] < min[1] - margin) continue;
          res.push(c);
        }
      }
    return res;
  }

  // ---------------------------------------------------------------------
  buildTerrainMesh() {
    const R = this.res, def = this.def;
    const pos = new Float32Array(R * R * 3);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i;
      pos[k * 3] = -this.half + i * this.cell;
      pos[k * 3 + 1] = this.h[k];
      pos[k * 3 + 2] = -this.half + j * this.cell;
    }
    const idx = new Uint32Array((R - 1) * (R - 1) * 6);
    let o = 0;
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < R - 1; i++) {
      const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRoad', new THREE.BufferAttribute(this.road, 1));
    geo.setAttribute('aDirt', new THREE.BufferAttribute(this.dirt, 1));
    geo.setAttribute('aRoadU', new THREE.BufferAttribute(this.roadU, 1));
    geo.setAttribute('aRoadS', new THREE.BufferAttribute(this.roadS, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const t = this.tex, L = Object.assign({ ground: 'grass', dirt: 'dirt', road: 'asphalt', groundScale: 9, dirtScale: 5, groundTint: [0.95, 1.02, 0.9], dirtTint: [0.72, 0.64, 0.55], snowLine: 1e5 }, def.layers);
    const v3 = (a) => new THREE.Vector3(...a);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tGrass = { value: t[L.ground] };
      sh.uniforms.tDirt = { value: t[L.dirt] };
      sh.uniforms.tAsphalt = { value: t[L.road] };
      sh.uniforms.tSnow = { value: t.snow };
      sh.uniforms.uGTint = { value: v3(L.groundTint) };
      sh.uniforms.uDTint = { value: v3(L.dirtTint) };
      sh.uniforms.uScale = { value: new THREE.Vector2(L.groundScale, L.dirtScale) };
      sh.uniforms.uSnow = { value: L.snowLine };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aRoad; attribute float aDirt; attribute float aRoadU; attribute float aRoadS;
          varying float vRoad; varying float vDirt; varying float vRoadU; varying float vRoadS; varying vec3 vWPos; varying vec3 vWNorm;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRoad = aRoad; vDirt = aDirt; vRoadU = aRoadU; vRoadS = aRoadS; vWPos = (modelMatrix * vec4(position,1.0)).xyz; vWNorm = normal;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tAsphalt; uniform sampler2D tSnow;
          uniform vec3 uGTint; uniform vec3 uDTint; uniform vec2 uScale; uniform float uSnow;
          varying float vRoad; varying float vDirt; varying float vRoadU; varying float vRoadS; varying vec3 vWPos; varying vec3 vWNorm;
          vec3 antiTile(sampler2D s, vec2 uv){
            vec3 a = texture2D(s, uv).rgb;
            vec3 b = texture2D(s, uv * 0.27 + vec2(0.37, 0.71)).rgb;
            return mix(a, b, 0.4);
          }`)
        .replace('#include <map_fragment>', `
          vec2 wuv = vWPos.xz;
          vec3 grass = antiTile(tGrass, wuv / uScale.x) * uGTint;
          vec3 dirt = antiTile(tDirt, wuv / uScale.y) * uDTint;
          vec3 asph = antiTile(tAsphalt, wuv / 5.0) * 0.85;
          float rw = smoothstep(0.35, 0.65, vRoad);
          vec3 col = mix(grass, dirt, smoothstep(0.2, 0.8, vDirt));
          // snow on high ground, thinning on steep faces
          float sn = smoothstep(uSnow - 8.0, uSnow + 8.0, vWPos.y + (texture2D(tDirt, wuv / 31.0).r - 0.5) * 18.0) * smoothstep(0.55, 0.8, normalize(vWNorm).y);
          col = mix(col, antiTile(tSnow, wuv / 6.0) * 1.05, sn);
          col = mix(col, asph, rw);
          float au = abs(vRoadU);
          float dash = step(fract(vRoadS / 9.0), 0.5);
          float center = (1.0 - smoothstep(0.08, 0.13, au)) * dash;
          float edge = smoothstep(4.0, 4.06, au) * (1.0 - smoothstep(4.22, 4.28, au));
          float mark = max(center, edge) * rw * step(au, 50.0);
          col = mix(col, vec3(0.85, 0.82, 0.7), mark * 0.85);
          diffuseColor.rgb *= col;`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.97, 0.78, rw) - mark * 0.1;`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.add(mesh);
    this.terrainMesh = mesh;
  }

  // static box: collider + (batched) mesh
  addBox(cx, cy, cz, hx, hy, hz, yaw, pitch, roll, material, friction = 0.9, uvScale = 1, collide = true) {
    const box = new Box(cx, cy, cz, hx, hy, hz, yaw, pitch, roll, friction);
    if (collide) this.colliders.push(box);
    if (material) {
      const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
      const uv = g.attributes.uv, n = g.attributes.normal, p = g.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
        const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
        uv.setXY(i, u / (2 * uvScale), v / (2 * uvScale));
      }
      g.applyQuaternion(box.quat);
      g.translate(cx, cy, cz);
      this.batch(material, g);
    }
    return box;
  }

  addCapsule(ax, ay, az, bx, by, bz, r, friction = 0.8) {
    const c = new Capsule(ax, ay, az, bx, by, bz, r, friction);
    this.colliders.push(c);
    return c;
  }

  batch(material, geo) {
    if (!this.batches.has(material)) this.batches.set(material, []);
    this.batches.get(material).push(geo);
  }

  // merge all static geometry per material: a handful of draw calls per map
  flushBatches() {
    for (const [mat, geos] of this.batches) {
      let nv = 0, ni = 0;
      for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      const idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const g of geos) {
        const n = g.attributes.position.count;
        pos.set(g.attributes.position.array, vo * 3);
        if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
        if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + vo; }
        else for (let i = 0; i < n; i++) idx[io++] = vo + i;
        vo += n;
        g.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      this.add(m);
    }
    this.batches.clear();
  }

  // any geometry placed in world space joins the batch for its material
  addMesh(geo, material) { this.batch(material, geo.index ? geo : geo); }

  // curved kicker ramp from tilted box segments, forward = (sin yaw, cos yaw)
  mkRamp(x, z, yaw, angles, segLen, width, y0 = 0, material = this.mat('wood')) {
    const th = 0.5, fx = Math.sin(yaw), fz = Math.cos(yaw), D = Math.PI / 180;
    let s = 0, h = y0;
    for (const ang of angles) {
      const a = ang * D;
      const L = segLen + 0.08;
      const cs = Math.cos(a), sn = Math.sin(a);
      const cs_ = s + cs * segLen / 2 + sn * th / 2, ch = h + sn * segLen / 2 - cs * th / 2;
      this.addBox(x + fx * cs_, ch, z + fz * cs_, width / 2, th / 2, L / 2, yaw, -a, 0, material, 0.9, 2);
      s += cs * segLen; h += sn * segLen;
    }
    return { s, h };
  }

  // guardrail along a road edge where the ground drops away
  addGuardrails(road, side, minDrop = 1.5) {
    const p = road.pts, n = p.length, steel = this.mat('steel'), post = this.mat('dark');
    const segs = road.closed ? n : n - 1;
    for (let i = 0; i < segs; i += 2) {
      if (!road.closed && i + 2 >= n) break;
      const a = p[i], b = p[(i + 2) % n];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      if (L < 0.1) continue;
      const nx = -dz / L * side, nz = dx / L * side;
      const off = 5.6;
      const mx = (a.x + b.x) / 2 + nx * off, mz = (a.z + b.z) / 2 + nz * off;
      const drop = (a.y + b.y) / 2 - this.naturalHeight(mx + nx * 6, mz + nz * 6);
      if (drop < minDrop) continue;
      const ay = a.y + 0.55, by = b.y + 0.55;
      this.addCapsule(a.x + nx * off, ay, a.z + nz * off, b.x + nx * off, by, b.z + nz * off, 0.16, 0.5);
      const g = new THREE.BoxGeometry(0.06, 0.32, L + 0.1);
      g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(by - ay, L), Math.atan2(dx, dz), 0, 'YXZ')));
      g.translate(mx, (ay + by) / 2, mz);
      this.batch(steel, g);
      const pg = new THREE.BoxGeometry(0.1, 0.8, 0.1); pg.translate(a.x + nx * (off + 0.08), a.y + 0.3, a.z + nz * (off + 0.08));
      this.batch(post, pg);
    }
  }

  // ---------------------------------------------------------------------
  buildTrees() {
    const list = this.def.trees ? [].concat(this.def.trees) : [];
    for (const T of list) this.buildTreeLayer(T);
  }

  buildTreeLayer(T) {
    const cnt = Math.round(this.quality.trees * (T.density ?? 1));
    const items = [];
    let tries = 0;
    const margin = 60;
    while (items.length < cnt && tries++ < cnt * 30) {
      const x = (this.rnd() - 0.5) * (this.size - margin * 2), z = (this.rnd() - 0.5) * (this.size - margin * 2);
      if (T.avoid && T.avoid(x, z, this)) continue;
      const rq = this.roadQuery(x, z);
      if (rq.d < 10) continue;
      const k = this._k(x, z);
      if (this.road[k] > 0.1) continue;
      const cluster = this.noise(x * 0.01 + 20, z * 0.01 - 9);
      if (cluster < (T.cluster ?? -0.05) && this.rnd() > 0.15) continue;
      const y = this.heightAt(x, z);
      if (T.maxY !== undefined && y > T.maxY + this.rnd() * 20) continue;
      const s = 0.8 + this.rnd() * 0.7;
      items.push([x, y, z, s]);
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const kinds = {
      pine: () => {
        const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 7); trunk.translate(0, 2, 0);
        const t1 = new THREE.ConeGeometry(2.2, 7, 8); t1.translate(0, 6.5, 0);
        const t2 = new THREE.ConeGeometry(1.7, 5, 8); t2.translate(0, 9, 0);
        const leaf = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.95, flatShading: true });
        return { parts: [[trunk, this.mat('bark'), false], [t1, leaf, true], [t2, leaf, true]], r: 0.28, h: 6, hue: [0.27, 0.08, 0.35, 0.55] };
      },
      cactus: () => {
        const trunk = new THREE.CylinderGeometry(0.28, 0.32, 5, 9); trunk.translate(0, 2.5, 0);
        const top = new THREE.SphereGeometry(0.28, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2); top.translate(0, 5, 0);
        const arm1 = new THREE.CylinderGeometry(0.2, 0.2, 1.6, 8); arm1.translate(0.75, 3.3, 0);
        const arm1b = new THREE.CylinderGeometry(0.2, 0.2, 0.75, 8); arm1b.rotateZ(Math.PI / 2); arm1b.translate(0.42, 2.55, 0);
        const arm2 = new THREE.CylinderGeometry(0.18, 0.18, 1.2, 8); arm2.translate(-0.7, 3.0, 0);
        const arm2b = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 8); arm2b.rotateZ(Math.PI / 2); arm2b.translate(-0.4, 2.45, 0);
        const g = mergeSimple([trunk, top, arm1, arm1b, arm2, arm2b]);
        const m = new THREE.MeshStandardMaterial({ color: 0x5f7f3a, roughness: 0.8 });
        return { parts: [[g, m, true]], r: 0.35, h: 5, hue: [0.22, 0.06, 0.35, 0.4] };
      },
      boulder: () => {
        const g = new THREE.DodecahedronGeometry(1.6, 0); g.translate(0, 0.5, 0);
        return { parts: [[g, this.mat(T.rockMat || 'rock'), false]], r: 1.4, h: 1.2, sphere: true, hue: null };
      },
      lamp: null,
    };
    const spec = kinds[T.kind || 'pine']();
    const meshes = spec.parts.map(([g, m, tint]) => { const im = new THREE.InstancedMesh(g, m, items.length); im.userData.tint = tint; return im; });
    items.forEach(([x, y, z, s], i) => {
      dummy.position.set(x, y - (spec.sphere ? 0.6 * s : 0.2), z);
      dummy.scale.setScalar(s); dummy.rotation.set(spec.sphere ? this.rnd() * 3 : 0, this.rnd() * 6.28, 0); dummy.updateMatrix();
      for (const im of meshes) {
        im.setMatrixAt(i, dummy.matrix);
        if (im.userData.tint && spec.hue) { const h = spec.hue; col.setHSL(h[0] + this.rnd() * h[1], h[2] + this.rnd() * 0.2, h[3] + this.rnd() * 0.2); im.setColorAt(i, col); }
      }
      if (spec.sphere) this.addCapsule(x, y + 0.2 * s, z, x, y + 0.25 * s, z, spec.r * s, 0.8);
      else this.addCapsule(x, y - 1, z, x, y + spec.h * s, z, spec.r * s, 0.7);
    });
    for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; this.add(m); }
  }

  _k(x, z) {
    const R = this.res;
    const i = Math.max(0, Math.min(R - 1, Math.round((x + this.half) / this.cell)));
    const j = Math.max(0, Math.min(R - 1, Math.round((z + this.half) / this.cell)));
    return j * R + i;
  }
}

function mergeSimple(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
