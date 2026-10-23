import * as THREE from 'three';

// Map definitions. Each map supplies a height function, roads, flat pads,
// ground layers, props and spawn points; World (world.js) builds the rest.

const PI = Math.PI;
const V = (x, z) => new THREE.Vector3(x, 0, z);

// mountains around the map edge keep you in
function rim(x, z, w, height = 55, width = 130) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  return Math.pow(w.smoothstep(w.half - width, w.half, r), 1.6) * height * (0.75 + 0.5 * w.noise(x * 0.02, z * 0.02 + 9));
}

function crateStack(x, z, rows = 4) {
  const spots = [];
  for (let row = 0; row < rows; row++) for (let i = 0; i < rows - row; i++) spots.push([x + (i + row * 0.5) * 1.25, 0.6 + row * 1.2, z]);
  return spots;
}

// procedural building facade (windows on a 3 m grid)
const facadeCache = {};
function facade(kind) {
  if (facadeCache[kind]) return facadeCache[kind];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const base = { glass: '#5b6670', brick: '#8a4a36', stone: '#b9ae9a', white: '#d9d6cf' }[kind];
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  if (kind === 'brick') {
    g.strokeStyle = 'rgba(40,20,10,0.35)'; g.lineWidth = 1;
    for (let y = 0; y < 256; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); for (let x = (y / 8) % 2 ? 0 : 8; x < 256; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 8); g.stroke(); } }
  }
  // 4 x 4 windows per tile
  for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
    const x = fx * 64, y = fy * 64;
    if (kind === 'glass') {
      g.fillStyle = `hsl(205, 30%, ${18 + Math.random() * 14}%)`; g.fillRect(x + 3, y + 4, 58, 52);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 3, y + 4, 58, 10);
    } else {
      g.fillStyle = Math.random() < 0.15 ? '#e8d9a0' : `hsl(210, 20%, ${14 + Math.random() * 10}%)`;
      g.fillRect(x + 16, y + 14, 32, 38);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 14, y + 52, 36, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'glass' ? 0.25 : 0.85, metalness: kind === 'glass' ? 0.4 : 0 });
  return (facadeCache[kind] = m);
}

// ---------------------------------------------------------------------------
export const MAPS = {
  grounds: {
    label: 'Proving Grounds',
    desc: 'Hills, a road circuit and a test pad with jumps, walls and crates.',
    size: 960, seed: 20261023,
    height(x, z, w) {
      const n = w.noise;
      let h = n(x * 0.004, z * 0.004) * 38 + n(x * 0.011 + 7, z * 0.011) * 12 + n(x * 0.04, z * 0.04 + 3) * 2.5 + n(x * 0.12, z * 0.12) * 0.35;
      h *= w.smoothstep(95, 170, Math.max(Math.abs(x), Math.abs(z)));
      return h + rim(x, z, w);
    },
    roads(w) {
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * PI * 2, r = 300 + w.noise(i * 0.7, 3.3) * 120 + (i % 2 ? 25 : -15);
        pts.push(V(Math.cos(a) * r, Math.sin(a) * r * 0.92));
      }
      const loop = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      const spur = [V(0, 100), V(10, 160), V(-20, 220)];
      let best = null, bd = Infinity;
      for (let i = 0; i < 400; i++) { const p = loop.getPointAt(i / 400); const d = p.distanceTo(spur[2]); if (d < bd) { bd = d; best = p; } }
      spur.push(best.clone());
      return [{ pts, closed: true }, { pts: spur, startY: 0 }];
    },
    pads: [{ x: 0, z: 0, half: 100, y: 0, blend: 2 }],
    trees: { kind: 'pine', avoid: (x, z) => Math.max(Math.abs(x), Math.abs(z)) < 115 },
    build(w) {
      const concrete = w.mat('concrete'), D = PI / 180;
      w.mkRamp(-40, -26, 0, [4, 8, 12], 3, 6);
      w.mkRamp(-25, -28, 0, [5, 10, 15, 18], 3, 6);
      w.mkRamp(-24, 40, PI / 2, [3, 6, 9, 12, 15], 3.2, 8);
      w.addBox(14, 0.7, 40, 8, 0.7, 6, PI / 2, 0, 0, concrete, 0.8, 3);
      w.mkRamp(20 + 13.2, 40, -PI / 2, [6, 6, 6, 6], 3.3, 16, 0);
      w.addBox(40, 0.2, -40, 2, 0.6, 10, 0, 0, 14 * D, w.mat('wood'), 0.9, 2);
      w.addBox(0, 2, -92, 30, 2, 1.5, 0, 0, 0, concrete, 0.8, 3);
      w.addBox(80, 2, 0, 1.5, 2, 20, 0, 0, 0, concrete, 0.8, 3);
      w.addCapsule(60, -1, -60, 60, 6, -60, 0.25);
      const pole = new THREE.CylinderGeometry(0.25, 0.25, 7, 16); pole.translate(60, 2.5, -60); w.batch(w.mat('steel'), pole);
      for (let i = 0; i < 8; i++) w.addBox(-70 + i * 3.4, 0.45, 70, 1.6, 0.45, 0.3, 0, 0, 0, concrete, 0.8, 1);
      for (let i = 0; i < 5; i++) w.addBox(-85, 1.3, -60 + i * 3, 6.1, 1.3, 1.22, 0, 0, 0, w.mat(i % 2 ? 'metalRed' : 'metalBlue'), 0.6, 2);
      w.addBox(-85, 3.9, -54, 6.1, 1.3, 1.22, 0, 0, 0, w.mat('metalBlue'), 0.6, 2);
      for (let i = 0; i < 9; i++) {
        const z = 10 + i * 3.2;
        w.addCapsule(45, -0.05, z, 55, -0.05, z, 0.2, 0.9);
        const g = new THREE.CylinderGeometry(0.2, 0.2, 10, 10); g.rotateZ(PI / 2); g.translate(50, -0.05, z); w.batch(w.mat('bark'), g);
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * PI * 0.5, r = 14;
        w.addBox(20 + Math.sin(a) * r, 0.6, -70 + Math.cos(a) * r, 2.4, 0.4, 4.5, -a, 0, 25 * D, concrete, 0.9, 2);
      }
    },
    spawn: { x: 0, z: -10, yaw: 0 },
    parked: [{ type: 'hatch', x: -14, z: 30, yaw: PI / 2, color: 0xe0b020 }, { type: 'pickup', x: 18, z: 30, yaw: -PI / 2 + 0.2, color: 0x3c6e47 }],
    crates: crateStack(28, -20),
  },

  // -------------------------------------------------------------------------
  desert: {
    label: 'Desert Canyon',
    desc: 'Dunes, red rock mesas, a 1 km drag strip and a dirt jump park.',
    size: 1200, seed: 77,
    height(x, z, w) {
      const n = w.noise;
      const base = n(x * 0.0025, z * 0.0025) * 16;
      const dune = Math.pow(1 - Math.abs(n(x * 0.011 + 3, z * 0.005)), 3) * 7 + n(x * 0.05, z * 0.05) * 0.6;
      const m = n(x * 0.0045 + 11, z * 0.0045 - 4);
      const mesa = w.smoothstep(0.26, 0.31, m) * 34 + w.smoothstep(0.46, 0.5, m) * 18;
      const corridor = w.smoothstep(25, 120, Math.abs(z));
      return (base + dune + mesa) * corridor + rim(x, z, w, 60, 140);
    },
    roads(w) {
      const loop = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2, r = 380 + w.noise(i * 0.9, 1.7) * 90;
        loop.push(V(Math.cos(a) * r, Math.sin(a) * r));
      }
      return [
        { pts: [V(-460, 0), V(460, 0)], poly: true, flat: 0 },
        { pts: loop, closed: true, surface: 'dirt', markings: false },
      ];
    },
    pads: [
      { x: -400, z: 40, hx: 40, hz: 22, y: 0, blend: 30 },
      { x: 180, z: -170, half: 60, y: 2, blend: 40, surface: 'dirt' },
    ],
    layers: { ground: 'sand', dirt: 'redrock', groundScale: 14, dirtScale: 7, groundTint: [1.08, 0.94, 0.8], dirtTint: [1.05, 0.78, 0.62] },
    friction: { ground: 0.62, dirt: 0.86, road: 1.0 },
    slopeDirt: 0.32,
    dirt(x, z, w) { return w.smoothstep(0.55, 0.7, w.noise(x * 0.015 + 40, z * 0.015) * 0.5 + 0.5) * 0.7; },
    trees: [
      { kind: 'cactus', density: 0.35, cluster: -1, avoid: (x, z) => Math.abs(z) < 30 },
      { kind: 'boulder', density: 0.25, cluster: -1, rockMat: 'redrock', avoid: (x, z) => Math.abs(z) < 30 },
    ],
    build(w) {
      // drag strip: start/finish lines and distance boards
      const white = w.mat('white');
      for (const x of [-440, 440]) w.addBox(x, 0.02, 0, 0.5, 0.02, 5, 0, 0, 0, white, 1, 1, false);
      for (let d = 100; d <= 800; d += 100) {
        const x = -440 + d;
        w.addBox(x, 1.6, 9.5, 0.12, 0.9, 1.4, 0, 0, 0, white, 1, 1, false);
        w.addCapsule(x, 0, 9.5, x, 2.5, 9.5, 0.08);
        const post = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6); post.translate(x, 0.6, 9.5); w.batch(w.mat('dark'), post);
      }
      // gas station
      w.addBox(-410, 2.2, 54, 9, 2.2, 5, 0, 0, 0, w.mat('brick'), 0.8, 2);
      w.addBox(-390, 4.6, 34, 10, 0.25, 7, 0, 0, 0, w.mat('white'), 0.8, 2);
      for (const [px, pz] of [[-398, 29], [-382, 29], [-398, 39], [-382, 39]]) {
        w.addCapsule(px, 0, pz, px, 4.5, pz, 0.2);
        const g = new THREE.CylinderGeometry(0.2, 0.2, 4.5, 10); g.translate(px, 2.25, pz); w.batch(w.mat('steel'), g);
      }
      for (const px of [-394, -386]) w.addBox(px, 0.8, 34, 0.4, 0.8, 0.6, 0, 0, 0, w.mat('metalRed'), 0.8, 1);
      // jump park on the dirt pad
      const rr = w.mat('redrock');
      w.mkRamp(140, -200, 0, [4, 9, 14, 19], 3, 8, 2, rr);
      w.mkRamp(175, -210, 0, [6, 12, 18, 24], 3, 7, 2, rr);
      w.mkRamp(215, -215, 0, [5, 10, 15], 3.5, 10, 2, rr);
      w.mkRamp(180, -130, PI, [6, 12, 18], 3, 8, 2, rr);
      for (let i = 0; i < 6; i++) w.addBox(130 + i * 12, 2.2, -150, 2.5, 0.6, 2.5, i * 0.5, 0, 0.15, rr, 0.9, 2);
      // container stack as a crash target at the end of the strip
      for (let i = 0; i < 4; i++) w.addBox(482, 1.3, -6 + i * 2.6, 1.22, 1.3, 6.1, PI / 2, 0, 0, w.mat(i % 2 ? 'metalRed' : 'metalBlue'), 0.6, 2);
    },
    spawn: { x: -445, z: -2.5, yaw: PI / 2 },
    parked: [{ type: 'pickup', x: -408, z: 24, yaw: PI / 2, color: 0xb04020 }],
    crates: crateStack(200, -175, 3),
    fog: { color: 0xe6d3b5, near: 300, far: 1700 },
    sun: { color: 0xffe8c8, intensity: 3.0 },
  },

  // -------------------------------------------------------------------------
  alpine: {
    label: 'Alpine Pass',
    desc: 'A switchback mountain road with guardrails, snow and a jump off the summit.',
    size: 1100, seed: 9,
    height(x, z, w) {
      const n = w.noise;
      const climb = 190 * w.smoothstep(-470, 160, z);
      const ridge = 1 - Math.abs(n(x * 0.004, z * 0.004));
      let h = climb + ridge * ridge * 55 * w.smoothstep(-300, 120, z) + n(x * 0.01, z * 0.01) * 9 + n(x * 0.03, z * 0.03) * 2;
      h += 70 * w.smoothstep(330, 540, Math.abs(x)) * (0.7 + 0.6 * n(x * 0.01, z * 0.01 + 5));
      return h + rim(x, z, w, 80, 120);
    },
    roads(w) {
      const P = [V(-300, -450)];
      const xs = -250, xe = 180;
      for (let k = 0; k < 7; k++) {
        const z0 = -410 + 62 * k;
        const a = k % 2 ? xe : xs, b = k % 2 ? xs : xe;
        P.push(V(a, z0), V(b, z0 + 42));
        if (k < 6) {
          // hairpin: half circle bulging outward
          const s = b > a ? 1 : -1, cz = z0 + 52;
          for (const t of [0.25, 0.5, 0.75]) P.push(V(b + s * Math.sin(t * PI) * 14, cz - Math.cos(t * PI) * 10));
        }
      }
      const end = P[P.length - 1];
      P.push(V(end.x - 30, end.z + 30), V(end.x - 60, 80));
      const y0 = w.naturalHeight(P[0].x, P[0].z), y1 = w.naturalHeight(end.x - 60, 80);
      w._alpine = { start: P[0], end: P[P.length - 1], y0, y1, first: P[1] };
      return [{ pts: P, linear: [y0, y1], rails: true }];
    },
    get pads() { return this._pads || []; },
    layers: { ground: 'grass', dirt: 'rock', groundScale: 9, dirtScale: 8, groundTint: [0.82, 1.05, 0.78], dirtTint: [0.92, 0.92, 0.95], snowLine: 150 },
    friction: { ground: 0.78, dirt: 0.88, road: 1.0 },
    slopeDirt: 0.55,
    trees: { kind: 'pine', density: 1.7, maxY: 140, cluster: -0.25 },
    build(w) {
      const r = w.roads[0];
      w.addGuardrails(r, 1, 2);
      w.addGuardrails(r, -1, 2);
      const A = w._alpine;
      // summit lookout: ramp that launches you out over the switchbacks
      w.mkRamp(A.end.x - 10, A.end.z - 32, PI, [3, 6, 9, 12], 3, 8, A.y1);
      w.addBox(A.end.x + 25, A.y1 + 1.5, A.end.z + 20, 1.5, 1.5, 12, 0.3, 0, 0, w.mat('concrete'), 0.8, 3);
    },
    // pads depend on the road, so they are filled in before heights are built
    prepare(w) {
      const A = w._alpine;
      this._pads = [
        { x: A.start.x, z: A.start.z, half: 22, y: A.y0, blend: 30 },
        { x: A.end.x, z: A.end.z, half: 34, y: A.y1, blend: 40 },
      ];
    },
    spawnFn(w) { const A = w._alpine; return { x: A.start.x + 4, z: A.start.z - 4, yaw: Math.atan2(A.first.x - A.start.x, A.first.z - A.start.z) }; },
    parkedFn(w) { const A = w._alpine; return [{ type: 'hatch', x: A.end.x + 12, z: A.end.z + 8, yaw: 1.2, color: 0x2a8a9a }]; },
    cratesFn(w) { const A = w._alpine; return crateStack(A.end.x - 20, A.end.z + 10, 3); },
    fog: { color: 0xc4d4e4, near: 350, far: 1600 },
  },

  // -------------------------------------------------------------------------
  city: {
    label: 'Downtown',
    desc: 'A grid of streets, curbs, towers and a stunt plaza in the middle.',
    size: 800, seed: 5,
    height(x, z, w) {
      const r = Math.max(Math.abs(x), Math.abs(z));
      return w.smoothstep(330, 380, r) * (14 + w.noise(x * 0.01, z * 0.01) * 10) + rim(x, z, w, 30, 60);
    },
    roads() {
      const R = [];
      for (let i = 0; i < 8; i++) {
        const c = -280 + i * 80;
        R.push({ pts: [V(c, -300), V(c, 300)], poly: true, flat: 0 });
        R.push({ pts: [V(-300, c), V(300, c)], poly: true, flat: 0 });
      }
      return R;
    },
    pads: [{ x: 0, z: 0, half: 312, y: 0, blend: 25, surface: 'ground' }],
    layers: { ground: 'concrete', dirt: 'grass', groundScale: 4, dirtScale: 9, groundTint: [0.95, 0.95, 0.95], dirtTint: [0.95, 1.02, 0.9] },
    friction: { ground: 0.95, dirt: 0.78, road: 1.0 },
    dirt(x, z, w) {
      if (Math.max(Math.abs(x), Math.abs(z)) > 305) return 1;
      const bi = Math.floor((x + 280) / 80), bj = Math.floor((z + 280) / 80);
      const cx = -240 + bi * 80, cz = -240 + bj * 80;
      const park = MAPS.city._blockType(bi, bj) === 'park';
      return park && Math.max(Math.abs(x - cx), Math.abs(z - cz)) < 31 ? 1 : 0;
    },
    _blockType(i, j) {
      if (i === 3 && j === 3) return 'plaza';
      if (i < 0 || j < 0 || i > 6 || j > 6) return 'none';
      const h = ((i * 73856093) ^ (j * 19349663)) >>> 0;
      return h % 7 === 0 ? 'park' : h % 11 === 0 ? 'lot' : 'build';
    },
    trees: { kind: 'pine', density: 0.4, avoid: (x, z) => Math.max(Math.abs(x), Math.abs(z)) < 315 },
    build(w) {
      const curb = w.mat('concrete'), dark = w.mat('dark'), steel = w.mat('steel'), lamp = w.mat('lamp');
      const kinds = ['glass', 'brick', 'stone', 'white'];
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const cx = -240 + i * 80, cz = -240 + j * 80, type = MAPS.city._blockType(i, j);
        // curbs around every block
        const e = 34.8;
        for (const [x, z, hx, hz] of [[cx, cz - e, e, 0.25], [cx, cz + e, e, 0.25], [cx - e, cz, 0.25, e], [cx + e, cz, 0.25, e]]) w.addBox(x, 0.07, z, hx, 0.13, hz, 0, 0, 0, curb, 0.9, 1);
        // street lights on the corners
        for (const [sx, sz] of [[-1, -1], [1, 1]]) {
          const lx = cx + sx * 33, lz = cz + sz * 33;
          w.addCapsule(lx, 0, lz, lx, 6, lz, 0.12, 0.6);
          const p = new THREE.CylinderGeometry(0.08, 0.12, 6.5, 6); p.translate(lx, 3.25, lz); w.batch(steel, p);
          const hd = new THREE.BoxGeometry(0.5, 0.15, 1.2); hd.translate(lx, 6.5, lz + sz * 0.4); w.batch(lamp, hd);
        }
        const rnd = (k) => { const h = Math.sin((i * 12.9898 + j * 78.233 + k * 37.719)) * 43758.5453; return h - Math.floor(h); };
        if (type === 'build') {
          const n = 1 + Math.floor(rnd(1) * 4);
          const cells = n === 1 ? [[0, 0, 28, 28]] : n === 2 ? [[-14, 0, 13, 28], [14, 0, 13, 28]] : [[-14, -14, 13, 13], [14, -14, 13, 13], [-14, 14, 13, 13], [14, 14, 13, 13]].slice(0, n);
          cells.forEach(([ox, oz, hx, hz], k) => {
            const hgt = 8 + Math.pow(rnd(k + 2), 2) * (Math.abs(i - 3) + Math.abs(j - 3) < 3 ? 70 : 30);
            w.addBox(cx + ox, hgt / 2, cz + oz, hx - 1, hgt / 2, hz - 1, 0, 0, 0, facade(kinds[Math.floor(rnd(k + 9) * 4)]), 0.7, 6);
            w.addBox(cx + ox, hgt + 0.4, cz + oz, hx - 1.4, 0.4, hz - 1.4, 0, 0, 0, dark, 0.7, 2);
          });
        } else if (type === 'lot') {
          for (let k = -3; k <= 3; k++) w.addBox(cx + k * 6, 0.01, cz, 0.08, 0.01, 4, 0, 0, 0, w.mat('white'), 1, 1, false);
          w.addBox(cx, 0.45, cz - 20, 12, 0.45, 0.3, 0, 0, 0, curb, 0.8, 1);
        }
      }
      // stunt plaza in the centre block
      const D = PI / 180;
      w.mkRamp(-20, -25, 0, [4, 8, 12, 16], 3, 7);
      w.mkRamp(10, 25, PI, [5, 10, 15], 3, 7);
      w.addBox(20, 0.65, -12, 6, 0.65, 6, 0, 0, 0, curb, 0.8, 3);
      w.mkRamp(20, -27.2, 0, [8, 8, 8], 3.1, 12, 0, curb);
      for (let k = 0; k < 6; k++) w.addBox(-26 + k * 3.4, 0.45, 18, 1.6, 0.45, 0.3, 0.3, 0, 0, curb, 0.8, 1);
      for (let k = 0; k < 6; k++) { const a = (k / 5) * PI * 0.5; w.addBox(-12 + Math.sin(a) * 12, 0.6, 2 + Math.cos(a) * 12, 2.2, 0.4, 3.4, -a, 0, 24 * D, curb, 0.9, 2); }
    },
    spawn: { x: -42.5, z: -60, yaw: 0 },
    parked: [
      { type: 'sedan', x: 37, z: -100, yaw: 0, color: 0x9a9da3 },
      { type: 'hatch', x: -43, z: 140, yaw: PI, color: 0xd7c24a },
      { type: 'pickup', x: 117, z: 20, yaw: 0, color: 0x223a5c },
    ],
    crates: crateStack(-26, 4, 3),
    fog: { color: 0xb6c3cf, near: 220, far: 1100 },
  },

  // -------------------------------------------------------------------------
  arena: {
    label: 'Derby Arena',
    desc: 'A walled dirt oval. Four AI cars will try to ram you.',
    size: 420, seed: 3, resScale: 0.75,
    height(x, z, w) {
      return w.noise(x * 0.01, z * 0.01) * 6 * w.smoothstep(110, 160, Math.hypot(x, z)) + rim(x, z, w, 30, 60);
    },
    pads: [
      { x: 0, z: 0, hx: 74, hz: 48, round: true, y: 0, blend: 50, surface: 'dirt' },
      { x: 0, z: -95, hx: 60, hz: 22, y: 0, blend: 20 },
    ],
    layers: { ground: 'grass', dirt: 'dirt', dirtScale: 5, dirtTint: [0.78, 0.66, 0.52] },
    friction: { ground: 0.78, dirt: 0.82, road: 1.0 },
    dirt() { return 0; },
    trees: { kind: 'pine', density: 0.25, avoid: (x, z) => Math.hypot(x / 1.3, z) < 110 || Math.abs(z + 95) < 30 },
    build(w) {
      const wall = w.mat('concrete'), stripe = w.mat('stripe'), metal = w.mat('metal'), steel = w.mat('steel'), lamp = w.mat('lamp');
      // oval wall
      const N = 56, ax = 72, az = 46;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * PI * 2, a1 = ((i + 1) / N) * PI * 2;
        const x0 = Math.cos(a0) * ax, z0 = Math.sin(a0) * az, x1 = Math.cos(a1) * ax, z1 = Math.sin(a1) * az;
        const L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
        if (i === N / 4 * 3) continue; // gate toward the car park
        w.addBox((x0 + x1) / 2, 0.75, (z0 + z1) / 2, 0.5, 0.75, L / 2 + 0.3, yaw, 0, 0, i % 2 ? wall : stripe, 0.6, 1);
      }
      // grandstands on the long sides
      for (const s of [1]) for (let k = 0; k < 6; k++) {
        w.addBox(0, 0.6 + k * 0.9, s * (52 + k * 1.6), 50, 0.6 + k * 0.9, 0.8, 0, 0, 0, metal, 0.7, 2);
      }
      // light towers
      for (const [x, z] of [[-60, -40], [60, -40], [-60, 40], [60, 40]]) {
        const tx = x * 1.25, tz = z * 1.35;
        w.addCapsule(tx, 0, tz, tx, 18, tz, 0.4, 0.6);
        const p = new THREE.CylinderGeometry(0.3, 0.45, 18, 8); p.translate(tx, 9, tz); w.batch(steel, p);
        const hd = new THREE.BoxGeometry(3, 1.2, 0.4); hd.lookAt(new THREE.Vector3(-x, 0, -z)); hd.translate(tx, 18, tz); w.batch(lamp, hd);
      }
      // tyre stacks in the middle
      for (const [x, z] of [[-18, 0], [18, 0], [0, 12], [0, -12]]) {
        w.addCapsule(x, 0, z, x, 1.2, z, 0.75, 0.6);
        for (let k = 0; k < 4; k++) { const t = new THREE.TorusGeometry(0.55, 0.22, 6, 14); t.rotateX(PI / 2); t.translate(x, 0.22 + k * 0.4, z); w.batch(w.mat('dark'), t); }
      }
    },
    spawn: { x: 0, z: -30, yaw: 0 },
    ai: [
      { type: 'sedan', x: -45, z: 0, yaw: PI / 2, color: 0xc8a020 },
      { type: 'hatch', x: 45, z: 0, yaw: -PI / 2, color: 0x2f8f5a },
      { type: 'pickup', x: 0, z: 32, yaw: PI, color: 0x8a2be2 },
      { type: 'hatch', x: -30, z: 25, yaw: PI * 0.75, color: 0xe86020 },
    ],
    crates: crateStack(-4, 20, 3),
    fog: { color: 0xb9cfe0, near: 250, far: 900 },
  },
};
