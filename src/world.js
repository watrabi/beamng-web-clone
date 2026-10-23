import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded gradient noise
// ---------------------------------------------------------------------------
function makeNoise(seed = 1337) {
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

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------------------
// Static colliders: oriented boxes and capsules, bucketed in a uniform grid.
// ---------------------------------------------------------------------------
class Box {
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

class Capsule {
  constructor(ax, ay, az, bx, by, bz, r, friction = 0.8) {
    this.a = [ax, ay, az]; this.b = [bx, by, bz]; this.r = r; this.friction = friction;
    this.min = [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r];
    this.max = [Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    this.d = [dx, dy, dz]; this.len2 = dx * dx + dy * dy + dz * dz;
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
// World
// ---------------------------------------------------------------------------
export class World {
  constructor(scene, textures, quality) {
    this.scene = scene;
    this.tex = textures;
    this.quality = quality;
    this.size = 960;
    this.res = quality.terrainRes; // vertices per side
    this.cell = this.size / (this.res - 1);
    this.half = this.size / 2;
    this.colliders = [];
    this.gridCell = 16;
    this.grid = new Map();
    this.stamp = 0;
    this._tmp = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 1 };
    const { noise, rnd } = makeNoise(20261023);
    this.noise = noise; this.rnd = rnd;

    this.buildRoads();
    this.buildHeights();
    this.buildTerrainMesh();
    this.buildProvingGround();
    this.buildTrees();
    for (const c of this.colliders) this._insert(c);
  }

  // natural terrain before roads
  naturalHeight(x, z) {
    const n = this.noise;
    let h = n(x * 0.004, z * 0.004) * 38 + n(x * 0.011 + 7, z * 0.011) * 12 + n(x * 0.04, z * 0.04 + 3) * 2.5 + n(x * 0.12, z * 0.12) * 0.35;
    // flat proving ground around the origin
    const pad = Math.max(Math.abs(x), Math.abs(z));
    h *= smoothstep(95, 170, pad);
    // mountains at the map rim keep you in
    const rim = Math.max(Math.abs(x), Math.abs(z));
    h += Math.pow(smoothstep(this.half - 130, this.half, rim), 1.6) * 55 * (0.75 + 0.5 * this.noise(x * 0.02, z * 0.02 + 9));
    return h;
  }

  buildRoads() {
    // a closed circuit through the hills plus a spur back to the pad
    const pts = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 300 + this.noise(i * 0.7, 3.3) * 120 + (i % 2 ? 25 : -15);
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.92));
    }
    const loop = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const spurPts = [new THREE.Vector3(0, 0, 100), new THREE.Vector3(10, 0, 160), new THREE.Vector3(-20, 0, 220)];
    // end the spur on the loop point closest to its tip
    const tip = spurPts[spurPts.length - 1];
    let best = null, bd = Infinity;
    for (let i = 0; i < 400; i++) { const p = loop.getPointAt(i / 400); const d = p.distanceTo(tip); if (d < bd) { bd = d; best = p; } }
    spurPts.push(best.clone());
    const spur = new THREE.CatmullRomCurve3(spurPts, false, 'centripetal');

    this.roads = [];
    for (const [curve, closed] of [[loop, true], [spur, false]]) {
      const len = curve.getLength();
      const n = Math.ceil(len / 3);
      const p = [];
      for (let i = 0; i <= n; i++) {
        if (closed && i === n) break;
        const v = curve.getPointAt(i / n);
        p.push({ x: v.x, z: v.z, y: this.naturalHeight(v.x, v.z), s: (i / n) * len });
      }
      // smooth the road profile so grades are drivable
      for (let pass = 0; pass < 30; pass++) {
        const ys = p.map(q => q.y);
        for (let i = 0; i < p.length; i++) {
          let sum = 0, c = 0;
          for (let k = -6; k <= 6; k++) {
            let j = i + k;
            if (closed) j = (j + p.length) % p.length; else if (j < 0 || j >= p.length) continue;
            sum += ys[j]; c++;
          }
          p[i].y = sum / c;
        }
        if (!closed) { p[0].y = 0; }
      }
      this.roads.push({ pts: p, closed, width: 10 });
    }
  }

  // nearest road info for a point
  roadQuery(x, z) {
    let best = Infinity, bu = 0, bs = 0, by = 0;
    for (const r of this.roads) {
      const p = r.pts, n = p.length, segs = r.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = p[i], b = p[(i + 1) % n];
        // cheap reject
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
        }
      }
    }
    return { d: best, u: bu, s: bs, y: by };
  }

  buildHeights() {
    const R = this.res;
    this.h = new Float32Array(R * R);
    this.road = new Float32Array(R * R);
    this.dirt = new Float32Array(R * R);
    this.roadU = new Float32Array(R * R);
    this.roadS = new Float32Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      const k = j * R + i;
      let h = this.naturalHeight(x, z);
      const rq = this.roadQuery(x, z);
      const hw = 5;
      const pad = Math.max(Math.abs(x), Math.abs(z));
      let road = 1 - smoothstep(hw - 0.5, hw + 1.0, rq.d);
      if (rq.d < 40) {
        const b = 1 - smoothstep(hw + 1, hw + 14, rq.d);
        h = h + (rq.y - h) * b;
      }
      if (pad < 100) { road = Math.max(road, 1 - smoothstep(95, 100, pad)); }
      this.h[k] = h;
      this.road[k] = road;
      this.roadU[k] = pad < 100 ? 99 : rq.u;
      this.roadS[k] = rq.s;
      const dn = this.noise(x * 0.02 + 50, z * 0.02) * 0.5 + 0.5;
      this.dirt[k] = Math.min(1, smoothstep(0.55, 0.75, dn) + (1 - smoothstep(hw + 1, hw + 3.5, rq.d)) * 0.8) * (1 - road);
    }
    // slope-based dirt (needs heights)
    for (let j = 1; j < R - 1; j++) for (let i = 1; i < R - 1; i++) {
      const k = j * R + i;
      const sx = (this.h[k + 1] - this.h[k - 1]) / (2 * this.cell), sz = (this.h[k + R] - this.h[k - R]) / (2 * this.cell);
      const slope = Math.hypot(sx, sz);
      this.dirt[k] = Math.max(this.dirt[k], smoothstep(0.45, 0.8, slope) * (1 - this.road[k]));
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
    out.friction = rd * 1.0 + (1 - rd) * (0.78 - dt * 0.12);
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
    const R = this.res;
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

    const t = this.tex;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tGrass = { value: t.grass };
      sh.uniforms.tDirt = { value: t.dirt };
      sh.uniforms.tAsphalt = { value: t.asphalt };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aRoad; attribute float aDirt; attribute float aRoadU; attribute float aRoadS;
          varying float vRoad; varying float vDirt; varying float vRoadU; varying float vRoadS; varying vec3 vWPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRoad = aRoad; vDirt = aDirt; vRoadU = aRoadU; vRoadS = aRoadS; vWPos = (modelMatrix * vec4(position,1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tAsphalt;
          varying float vRoad; varying float vDirt; varying float vRoadU; varying float vRoadS; varying vec3 vWPos;
          vec3 antiTile(sampler2D s, vec2 uv){
            // blend two rotated/scaled lookups to hide repetition
            vec3 a = texture2D(s, uv).rgb;
            vec3 b = texture2D(s, uv * 0.27 + vec2(0.37, 0.71)).rgb;
            return mix(a, b, 0.4);
          }`)
        .replace('#include <map_fragment>', `
          vec2 wuv = vWPos.xz;
          vec3 grass = antiTile(tGrass, wuv / 9.0) * vec3(0.95, 1.02, 0.9);
          vec3 dirt = antiTile(tDirt, wuv / 5.0) * vec3(0.72, 0.64, 0.55);
          vec3 asph = antiTile(tAsphalt, wuv / 5.0) * 0.85;
          float rw = smoothstep(0.35, 0.65, vRoad);
          vec3 col = mix(mix(grass, dirt, smoothstep(0.2, 0.8, vDirt)), asph, rw);
          // lane markings
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
    this.scene.add(mesh);
    this.terrainMesh = mesh;
  }

  addBox(cx, cy, cz, hx, hy, hz, yaw, pitch, roll, material, friction = 0.9, uvScale = 1) {
    const box = new Box(cx, cy, cz, hx, hy, hz, yaw, pitch, roll, friction);
    this.colliders.push(box);
    if (material) {
      const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
      // world-scaled UVs so textures don't stretch
      const uv = g.attributes.uv, n = g.attributes.normal, p = g.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
        const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
        uv.setXY(i, u / (2 * uvScale), v / (2 * uvScale));
      }
      const m = new THREE.Mesh(g, material);
      m.position.copy(box.c); m.quaternion.copy(box.quat);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
    return box;
  }

  buildProvingGround() {
    const t = this.tex;
    const concrete = new THREE.MeshStandardMaterial({ map: t.concrete, normalMap: t.concreteN, roughness: 0.9 });
    const metalBlue = new THREE.MeshStandardMaterial({ map: t.metal, color: 0x6688bb, roughness: 0.6, metalness: 0.4 });
    const metalRed = new THREE.MeshStandardMaterial({ map: t.metal, color: 0xbb5544, roughness: 0.6, metalness: 0.4 });
    const ramp = new THREE.MeshStandardMaterial({ map: t.wood, color: 0xd8c6a0, roughness: 0.8 });
    const D = Math.PI / 180;

    // curved kicker ramps built from tilted box segments (forward = local +z rotated by yaw)
    const mkRamp = (x, z, yaw, angles, segLen, width, y0 = 0) => {
      const th = 0.5, fx = Math.sin(yaw), fz = Math.cos(yaw);
      let s = 0, h = y0;
      for (const ang of angles) {
        const a = ang * D;
        const L = segLen + 0.08; // slight overlap hides seams
        const cs = Math.cos(a), sn = Math.sin(a);
        // centre of the segment, pushed down by half the thickness along its normal
        const cs_ = s + cs * segLen / 2 + sn * th / 2, ch = h + sn * segLen / 2 - cs * th / 2;
        this.addBox(x + fx * cs_, ch, z + fz * cs_, width / 2, th / 2, L / 2, yaw, -a, 0, ramp, 0.9, 2);
        s += cs * segLen; h += sn * segLen;
      }
      return { s, h };
    };
    mkRamp(-40, -26, 0, [4, 8, 12], 3, 6);
    mkRamp(-25, -28, 0, [5, 10, 15, 18], 3, 6);
    // big jump toward +x with a table and a landing slope
    mkRamp(-24, 40, Math.PI / 2, [3, 6, 9, 12, 15], 3.2, 8);
    // landing table + slope back down (approach from -x at ~70 km/h)
    this.addBox(14, 0.7, 40, 8, 0.7, 6, Math.PI / 2, 0, 0, concrete, 0.8, 3);
    mkRamp(20 + 13.2, 40, -Math.PI / 2, [6, 6, 6, 6], 3.3, 16, 0);
    // side-tilted "two wheel" ramp
    this.addBox(40, 0.2, -40, 2, 0.6, 10, 0, 0, 14 * D, ramp, 0.9, 2);

    // crash walls
    this.addBox(0, 2, -92, 30, 2, 1.5, 0, 0, 0, concrete, 0.8, 3);
    this.addBox(80, 2, 0, 1.5, 2, 20, 0, 0, 0, concrete, 0.8, 3);
    // pole to wrap a car around
    const pole = new Capsule(60, -1, -60, 60, 6, -60, 0.25);
    this.colliders.push(pole);
    const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 16), new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.8, roughness: 0.35 }));
    pm.position.set(60, 2.5, -60); pm.castShadow = true; this.scene.add(pm);

    // jersey barriers lining a slalom
    for (let i = 0; i < 8; i++) this.addBox(-70 + i * 3.4, 0.45, 70, 1.6, 0.45, 0.3, 0, 0, 0, concrete, 0.8, 1);
    // shipping containers
    const cmat = [metalBlue, metalRed];
    for (let i = 0; i < 5; i++) this.addBox(-85, 1.3, -60 + i * 3, 6.1, 1.3, 1.22, 0, 0, 0, cmat[i % 2], 0.6, 2);
    this.addBox(-85, 3.9, -54, 6.1, 1.3, 1.22, 0, 0, 0, metalBlue, 0.6, 2);

    // log bumps (washboard)
    const logMat = new THREE.MeshStandardMaterial({ map: t.bark, roughness: 0.95 });
    for (let i = 0; i < 9; i++) {
      const z = 10 + i * 3.2;
      const cap = new Capsule(45, -0.05, z, 55, -0.05, z, 0.2, 0.9);
      this.colliders.push(cap);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10, 10), logMat);
      m.rotation.z = Math.PI / 2; m.position.set(50, -0.05, z); m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }

    // banked turn / quarter pipe made of segments
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 0.5;
      const r = 14;
      const yaw = -a;
      const x = 20 + Math.sin(a) * r, z = -70 + Math.cos(a) * r;
      this.addBox(x, 0.6, z, 2.4, 0.4, 4.5, yaw, 0, 25 * D, concrete, 0.9, 2);
    }
  }

  buildTrees() {
    const cnt = this.quality.trees;
    const trunks = [], tops = [];
    let tries = 0;
    while (trunks.length < cnt && tries++ < cnt * 20) {
      const x = (this.rnd() - 0.5) * (this.size - 120), z = (this.rnd() - 0.5) * (this.size - 120);
      if (Math.max(Math.abs(x), Math.abs(z)) < 115) continue;
      const rq = this.roadQuery(x, z);
      if (rq.d < 10) continue;
      const cluster = this.noise(x * 0.01 + 20, z * 0.01 - 9);
      if (cluster < -0.05 && this.rnd() > 0.15) continue;
      const y = this.heightAt(x, z);
      const s = 0.8 + this.rnd() * 0.7;
      trunks.push([x, y, z, s]);
      this.colliders.push(new Capsule(x, y - 1, z, x, y + 6 * s, z, 0.28 * s, 0.7));
    }
    const dummy = new THREE.Object3D();
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 4, 7); trunkGeo.translate(0, 2, 0);
    const topGeo = new THREE.ConeGeometry(2.2, 7, 8); topGeo.translate(0, 6.5, 0);
    const topGeo2 = new THREE.ConeGeometry(1.7, 5, 8); topGeo2.translate(0, 9, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ map: this.tex.bark, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.95, flatShading: true });
    const im1 = new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length);
    const im2 = new THREE.InstancedMesh(topGeo, leafMat, trunks.length);
    const im3 = new THREE.InstancedMesh(topGeo2, leafMat, trunks.length);
    const col = new THREE.Color();
    trunks.forEach(([x, y, z, s], i) => {
      dummy.position.set(x, y - 0.2, z); dummy.scale.setScalar(s); dummy.rotation.y = this.rnd() * 6.28; dummy.updateMatrix();
      im1.setMatrixAt(i, dummy.matrix); im2.setMatrixAt(i, dummy.matrix); im3.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.27 + this.rnd() * 0.08, 0.35 + this.rnd() * 0.2, 0.55 + this.rnd() * 0.2);
      im2.setColorAt(i, col); im3.setColorAt(i, col);
    });
    for (const m of [im1, im2, im3]) { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
  }

  // fresh crate positions for the stack on the pad
  crateSpots() {
    const spots = [];
    let id = 0;
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) {
      spots.push([30 + (i + row * 0.5) * 1.25 - 2, 0.6 + row * 1.2, -20, id++]);
    }
    return spots;
  }
}
