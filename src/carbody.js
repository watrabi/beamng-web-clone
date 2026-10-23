import * as THREE from 'three';

// Car body shape + panel layout.
// Local space: +x is the car's LEFT side, y up, z forward, y=0 = ground at rest.
// The outer skin is a loft of cross-sections. Each section is a 17-point
// polyline on one half (index 0 = bottom centre ... 16 = roof centre):
//   0-2 underbody, 3-8 side (sill .. belt line), 9-12 side glass / hood edge,
//   13-15 roof / windscreen, 16 centre.

export function lerpProfile(prof, z) {
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

export class CarShape {
  constructor(T) {
    this.T = T;
    this.zF = T.front; this.zR = T.front - T.length;
    this.archR = T.wheelR + 0.075;
    this.crown = 0.03;
    let full = 0;
    for (let z = this.zF; z > this.zR; z -= 0.05) {
      const [b, r] = lerpProfile(T.profile, z);
      full = Math.max(full, r - b);
    }
    this.cabinFull = full;
  }

  sec(z) {
    const T = this.T;
    let [belt, roof, hw, rhw] = lerpProfile(T.profile, z);
    const roofRaw = roof;
    if (roof - belt < 0.05) { roof = belt + this.crown; rhw = hw * 0.8; }
    const f = T.floor;
    let a = f + 0.06, flare = 0;
    for (const az of [T.axleF, T.axleR]) {
      const dz = z - az, R = this.archR;
      if (Math.abs(dz) < R) a = Math.max(a, T.wheelR + Math.sqrt(R * R - dz * dz) * 0.97);
      const u = Math.abs(dz) / (R + 0.2);
      if (u < 1) flare = Math.max(flare, 0.028 * (1 - u * u));
    }
    const endD = Math.min(this.zF - z, z - this.zR);
    let sc = 1, lift = 0;
    if (endD < 0.22) { const u = 1 - Math.max(0, endD) / 0.22; sc = 0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - u * u)); lift = u * u * 0.08; }
    hw *= sc; rhw *= sc;
    const hf = hw * (1 + flare);
    const P = [
      [0, f + lift],
      [hw * 0.55, f + lift],
      [hw * 0.6, a + lift * 0.5],
      [hf * 0.955, a + lift * 0.5],
      [hf * 0.995, a + (belt - a) * 0.14],
      [hf * 1.008, a + (belt - a) * 0.45],
      [hf * 1.012, a + (belt - a) * 0.72],
      [hw * 0.998, belt - 0.025],
      [hw * 0.975, belt + 0.004],
    ];
    for (const t of [0.1, 0.3, 0.52, 0.74, 0.92]) {
      const e = 1 - (1 - t) * (1 - t);
      P.push([hw + (rhw - hw) * t, belt + 0.004 + (roof - belt - 0.004) * e]);
    }
    P.push([rhw * 0.72, roof + this.crown * 0.55]);
    P.push([rhw * 0.38, roof + this.crown * 0.88]);
    P.push([0, roof + this.crown]);
    return { P, belt, roof, roofRaw, hw, rhw, a, f, cabinH: roofRaw - belt };
  }

  // point on the surface at fractional section index i; side +1 = +x
  surf(z, i, side, out = 0.0) {
    const s = this.sec(z);
    const i0 = Math.min(15, Math.floor(i)), t = i - i0;
    const a = s.P[i0], b = s.P[i0 + 1];
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    // outward normal of the polyline segment
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    return [side * (x + nx * out), y + ny * out, z];
  }

  inCabin(z) { const c = this.T.cabin; return z < c[0] && z > c[1]; }
  sloped(z) { const s = this.sec(z); return s.cabinH > 0.08 && s.cabinH < this.cabinFull * 0.9; }
  fullRoof(z) { return this.sec(z).cabinH >= this.cabinFull * 0.9; }
}

// --------------------------------------------------------------------------
// Skin: lofted outer surface split into panels (pieces) and materials.
// --------------------------------------------------------------------------
export function buildSkin(shape) {
  const T = shape.T, zF = shape.zF, zR = shape.zR;
  const NZ = 96, RN = 32;
  const rings = [];
  const ringPts = (s) => {
    const P = s.P, out = [];
    for (let i = 0; i <= 16; i++) out.push([P[i][0], P[i][1]]);
    for (let i = 15; i >= 1; i--) out.push([-P[i][0], P[i][1]]);
    return out;
  };
  const endRings = (z, dir) => {
    const s = shape.sec(z), pts = ringPts(s);
    let ym = 0; for (const p of pts) ym += p[1]; ym /= pts.length;
    const res = [];
    for (const [dz, sc] of [[0.035, 0.9], [0.06, 0.7]]) {
      res.push({ z: z + dir * dz, end: dir > 0 ? 'F' : 'R', pts: pts.map(([x, y]) => [x * sc, ym + (y - ym) * sc]) });
    }
    return { res, ym };
  };
  const ef = endRings(zF, 1), er = endRings(zR, -1);
  rings.push(ef.res[1], ef.res[0]);
  for (let s = 0; s <= NZ; s++) {
    const z = zF - (s / NZ) * T.length;
    rings.push({ z, end: null, pts: ringPts(shape.sec(z)) });
  }
  rings.push(er.res[0], er.res[1]);

  const verts = [];
  for (const r of rings) for (const p of r.pts) verts.push([p[0], p[1], r.z]);
  const capF = verts.length; verts.push([0, ef.ym, zF + 0.065]);
  const capR = verts.length; verts.push([0, er.ym, zR - 0.065]);

  // classify quads -> { piece, mat }
  const P = T.parts;
  const bP = T.bPillar;
  const classify = (zc, i, side, end) => {
    const s = shape.sec(Math.max(zR, Math.min(zF, zc)));
    if ((end === 'F' || zc > zF - 0.3) && i <= 7) return { piece: 'bumperF', mat: i <= 2 ? 'trim' : (i <= 3 ? 'trim' : 'paint') };
    if ((end === 'R' || zc < zR + 0.3) && i <= 7) return { piece: 'bumperR', mat: i <= 3 ? 'trim' : 'paint' };
    if (end) return { piece: 'body', mat: 'paint' };
    const sideGlass = i >= 9 && i <= 12 && shape.inCabin(zc) && zc < T.cabin[0] - 0.06 && zc > T.cabin[1] + 0.06 && Math.abs(zc - bP) > 0.05 && shape.fullRoof(zc);
    const topGlass = i >= 13 && i <= 15 && shape.inCabin(zc) && shape.sloped(zc);
    if (P.hood && zc > P.hood[0] && zc < P.hood[1] && i >= 9) return { piece: 'hood', mat: 'paint' };
    if (P.trunk && zc > P.trunk[0] && zc < P.trunk[1] && i >= 9) {
      if (topGlass) return { piece: 'trunk', mat: 'glass:trunk' };
      if (sideGlass) return { piece: 'body', mat: side > 0 ? 'glass:quarterL' : 'glass:quarterR' };
      return { piece: 'trunk', mat: 'paint' };
    }
    for (let k = 0; k < P.doors.length; k++) {
      const [d0, d1] = P.doors[k];
      if (zc < d0 && zc > d1 && i >= 4 && i <= 12) {
        const key = `door${k}${side > 0 ? 'L' : 'R'}`;
        return { piece: key, mat: sideGlass ? 'glass:' + key : 'paint' };
      }
    }
    if (topGlass) return { piece: 'body', mat: zc > bP ? 'glass:windshield' : 'glass:rear' };
    if (sideGlass) return { piece: 'body', mat: side > 0 ? 'glass:quarterL' : 'glass:quarterR' };
    if (i <= 2) return { piece: 'body', mat: 'under' };
    return { piece: 'body', mat: 'paint' };
  };

  const pieces = {};
  const add = (piece, mat, tri) => {
    const p = pieces[piece] || (pieces[piece] = { groups: {} });
    (p.groups[mat] || (p.groups[mat] = [])).push(...tri);
  };
  for (let r = 0; r < rings.length - 1; r++) {
    const R0 = rings[r], R1 = rings[r + 1];
    const end = R0.end || R1.end;
    const zc = (R0.z + R1.z) / 2;
    for (let p = 0; p < RN; p++) {
      const a = r * RN + p, b = r * RN + (p + 1) % RN, c = a + RN, d = b + RN;
      const i = p <= 15 ? p : 31 - p;
      const side = p <= 15 ? 1 : -1;
      const { piece, mat } = classify(zc, i, side, end);
      // winding chosen so normals face outward (checked at build)
      add(piece, mat, [a, c, b, b, c, d]);
    }
  }
  // end caps
  for (let p = 0; p < RN; p++) {
    const a = p, b = (p + 1) % RN;
    const i = p <= 15 ? p : 31 - p;
    add(i <= 7 ? 'bumperF' : 'body', i <= 3 ? 'trim' : 'paint', [capF, a, b]);
    const base = (rings.length - 1) * RN;
    add(i <= 7 ? 'bumperR' : 'body', i <= 3 ? 'trim' : 'paint', [capR, base + b, base + a]);
  }

  // build per-piece vertex sets, with panel gaps (boundary vertices pulled in)
  const out = {};
  for (const [name, pc] of Object.entries(pieces)) {
    const map = new Map(), pos = [];
    const groups = [];
    for (const [mat, idx] of Object.entries(pc.groups)) {
      const li = idx.map(g => {
        let l = map.get(g);
        if (l === undefined) { l = pos.length / 3; map.set(g, l); pos.push(...verts[g]); }
        return l;
      });
      groups.push({ mat, idx: li });
    }
    // boundary edges -> inset by a few mm so panels read as separate parts
    const edgeCount = new Map(), nbr = new Map();
    const ek = (a, b) => a < b ? a * 1e6 + b : b * 1e6 + a;
    for (const g of groups) for (let t = 0; t < g.idx.length; t += 3) {
      const tri = [g.idx[t], g.idx[t + 1], g.idx[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const k = ek(a, b); edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
        if (!nbr.has(a)) nbr.set(a, new Set()); nbr.get(a).add(b);
      }
    }
    const border = new Set();
    for (const [k, c] of edgeCount) if (c === 1) { border.add(Math.floor(k / 1e6)); border.add(k % 1e6); }
    const gap = name === 'body' ? 0.004 : 0.006;
    const moved = pos.slice();
    for (const v of border) {
      const ns = nbr.get(v); if (!ns) continue;
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (const u of ns) { if (border.has(u)) continue; cx += pos[u * 3]; cy += pos[u * 3 + 1]; cz += pos[u * 3 + 2]; n++; }
      if (!n) continue;
      cx = cx / n - pos[v * 3]; cy = cy / n - pos[v * 3 + 1]; cz = cz / n - pos[v * 3 + 2];
      const l = Math.hypot(cx, cy, cz) || 1;
      moved[v * 3] += cx / l * gap; moved[v * 3 + 1] += cy / l * gap; moved[v * 3 + 2] += cz / l * gap;
    }
    out[name] = { pos: moved, groups };
  }
  return out;
}

// --------------------------------------------------------------------------
// Detail meshes (lights, grille, plates, mirrors, interior, engine bay ...)
// Returns [{ piece, mat, geo }] with geometry in local car space.
// --------------------------------------------------------------------------
function box(w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')));
  g.translate(x, y, z);
  return g;
}
function cyl(r, len, x, y, z, axis = 'z', seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export function buildDetails(shape, opts = {}) {
  const T = shape.T, zF = shape.zF, zR = shape.zR, P = T.parts;
  const out = [];
  const D = (piece, mat, geo) => out.push({ piece, mat, geo });
  const sF = shape.sec(zF), sR = shape.sec(zR);
  const f = T.floor;

  // headlights: chrome housing + lens, swept back at the outer edge
  for (const s of [1, -1]) {
    const x = s * sF.hw * 0.6, y = sF.belt - 0.085, z = zF + 0.005;
    D('body', 'chrome', box(0.36, 0.1, 0.14, x, y, z - 0.02, s * 0.32));
    D('body', s > 0 ? 'light:headL' : 'light:headR', box(0.32, 0.075, 0.1, x + s * 0.0, y, z + 0.012, s * 0.32));
    // indicator strip
    D('body', 'amber', box(0.1, 0.02, 0.08, x + s * 0.12, y - 0.055, z - 0.04, s * 0.32));
  }
  // grille
  const gw = Math.max(0.3, sF.hw * 0.6 * 2 - 0.42);
  D('body', 'grille', box(gw, 0.11, 0.08, 0, sF.belt - 0.095, zF + 0.025));
  for (let k = 0; k < 3; k++) D('body', 'chrome', box(gw, 0.012, 0.02, 0, sF.belt - 0.135 + k * 0.035, zF + 0.065));
  // front bumper: intake, fog lights, plate
  D('bumperF', 'grille', box(sF.hw * 1.1, 0.09, 0.06, 0, f + 0.19, zF + 0.035));
  for (const s of [1, -1]) D('bumperF', 'light:fog', cyl(0.035, 0.03, s * sF.hw * 0.68, f + 0.2, zF + 0.035));
  D('bumperF', 'plate', box(0.5, 0.11, 0.012, 0, f + 0.31, zF + 0.065));

  // tail lights + rear plate + exhaust
  for (const s of [1, -1]) {
    const x = s * sR.hw * 0.62, y = sR.belt - 0.1, z = zR - 0.005;
    D('body', 'trim', box(0.38, 0.12, 0.13, x, y, z + 0.02, -s * 0.3));
    D('body', s > 0 ? 'light:tailL' : 'light:tailR', box(0.35, 0.1, 0.11, x, y, z - 0.012, -s * 0.3));
    D('body', 'light:reverse', box(0.08, 0.035, 0.1, x - s * 0.1, y - 0.03, z - 0.02, -s * 0.3));
  }
  D('bumperR', 'plate', box(0.5, 0.11, 0.012, 0, Math.max(f + 0.3, sR.belt - 0.3), zR - 0.06));
  D('bumperR', 'chrome', cyl(0.038, 0.24, -sR.hw * 0.55, f + 0.08, zR + 0.02));
  D('bumperR', 'under', cyl(0.028, 0.245, -sR.hw * 0.55, f + 0.08, zR + 0.02));

  // side indicators on the front fenders
  for (const s of [1, -1]) {
    const zz = T.axleF - shape.archR - 0.15, ss = shape.sec(zz);
    D('body', 'amber', box(0.012, 0.03, 0.08, s * ss.hw * 1.02, ss.belt - 0.12, zz));
  }

  // doors: handles; mirrors are their own parts
  P.doors.forEach(([d0, d1], k) => {
    for (const s of [1, -1]) {
      const key = `door${k}${s > 0 ? 'L' : 'R'}`;
      const zz = d1 + 0.2, ss = shape.sec(zz);
      D(key, 'chrome', box(0.022, 0.028, 0.15, s * (ss.hw * 1.0 + 0.012), ss.belt - 0.085, zz));
      D(key, 'trim', box(0.012, 0.02, d0 - d1 - 0.06, s * (ss.hw * 0.985 + 0.004), ss.belt + 0.012, (d0 + d1) / 2));
    }
  });
  const [md0] = P.doors[0];
  for (const s of [1, -1]) {
    const key = s > 0 ? 'mirrorL' : 'mirrorR';
    const zz = md0 - 0.14, ss = shape.sec(zz);
    D(key, 'trim', box(0.1, 0.03, 0.05, s * (ss.hw + 0.06), ss.belt + 0.05, zz));
    D(key, 'paint', box(0.17, 0.1, 0.09, s * (ss.hw + 0.15), ss.belt + 0.1, zz - 0.01, s * 0.12));
    D(key, 'mirror', box(0.145, 0.075, 0.01, s * (ss.hw + 0.15), ss.belt + 0.1, zz - 0.06, s * 0.12));
  }

  // wipers on the cowl
  const zc = P.hood[0] - 0.06, sc = shape.sec(zc);
  D('body', 'trim', box(0.55, 0.012, 0.025, 0.3, sc.roof + 0.03, zc, 0.12));
  D('body', 'trim', box(0.55, 0.012, 0.025, -0.32, sc.roof + 0.03, zc, 0.12));
  // antenna
  const za = T.cabin[1] + 0.35, sa = shape.sec(za);
  const ant = new THREE.CylinderGeometry(0.004, 0.006, 0.3, 6);
  ant.rotateX(-0.35); ant.translate(-0.2, sa.roof + shape.crown + 0.14, za);
  D('body', 'trim', ant);

  // interior
  const bP = T.bPillar, zs = bP + 0.32;
  const sz = shape.sec(zs);
  for (const s of [1, -1]) {
    const x = s * 0.37;
    D('body', 'interior', box(0.48, 0.12, 0.5, x, f + 0.3, zs));
    D('body', 'interior', box(0.48, 0.6, 0.12, x, f + 0.66, zs - 0.28, 0, -0.18));
    D('body', 'interior', box(0.26, 0.16, 0.1, x, f + 0.98 + Math.min(0, sz.roof - f - 1.1), zs - 0.36, 0, -0.18));
  }
  if (T.cabin[1] < bP - 0.75) {
    const zb = bP - 0.62;
    D('body', 'interior', box(1.25, 0.14, 0.5, 0, f + 0.32, zb));
    D('body', 'interior', box(1.25, 0.55, 0.12, 0, f + 0.66, zb - 0.27, 0, -0.2));
  }
  D('body', 'interior', box(0.2, 0.2, 0.7, 0, f + 0.3, zs + 0.1));
  const zd = T.cabin[0] - 0.14, sd = shape.sec(zd);
  D('body', 'interior', box(sd.hw * 1.75, 0.2, 0.42, 0, sd.belt - 0.04, zd));
  D('body', 'trim', box(0.3, 0.06, 0.12, 0.37, sd.belt + 0.08, zd - 0.12));

  // engine bay
  const hb = shape.sec(T.axleF).belt;
  const eh = (hb - f) * 0.42, ey = f + (hb - f) * 0.5;
  const ez = T.axleF + (T.engine.drive === 'fwd' ? 0.08 : -0.12);
  D('body', 'engine', box(0.62, eh, 0.55, 0, ey, ez));
  D('body', 'red', box(0.5, 0.06, 0.44, 0, ey + eh / 2 + 0.03, ez));
  D('body', 'engine', cyl(0.07, 0.42, 0.18, ey + eh / 2 + 0.04, ez + 0.05, 'x'));
  D('body', 'trim', box(0.22, 0.19, 0.27, 0.48, ey, ez + 0.15));
  D('body', 'grille', box(Math.min(1.3, sF.hw * 1.5), (hb - f) * 0.55, 0.05, 0, f + (hb - f) * 0.45, zF - 0.34));

  return out;
}

// license plate texture
export function plateTexture(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4ef'; g.fillRect(0, 0, 256, 56);
  g.strokeStyle = '#223'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 50);
  g.fillStyle = '#1a2340'; g.font = 'bold 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tyre tread / sidewall texture
export function tireTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 512, 64);
  // tread band in the middle of the profile
  g.fillStyle = '#141414'; g.fillRect(0, 18, 512, 28);
  g.strokeStyle = '#0a0a0a'; g.lineWidth = 3;
  for (const y of [24, 32, 40]) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.lineWidth = 2;
  for (let x = 0; x < 512; x += 12) { g.beginPath(); g.moveTo(x, 18); g.lineTo(x + 6, 32); g.lineTo(x, 46); g.stroke(); }
  // sidewall lettering hint
  g.fillStyle = '#2b2b2b';
  for (let x = 10; x < 512; x += 128) { g.fillRect(x, 4, 60, 5); g.fillRect(x, 55, 60, 5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}
