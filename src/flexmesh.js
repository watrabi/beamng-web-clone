import * as THREE from 'three';

// Merge [{ geo, mat (material index) }] into one indexed geometry with groups.
export function mergeByMaterial(list) {
  const byMat = new Map();
  for (const it of list) {
    if (!byMat.has(it.mat)) byMat.set(it.mat, []);
    byMat.get(it.mat).push(it.geo);
  }
  const pos = [], uv = [], idx = [], groups = [];
  for (const [mat, geos] of [...byMat.entries()].sort((a, b) => a[0] - b[0])) {
    const start = idx.length;
    for (const g0 of geos) {
      const g = g0.index ? g0 : g0.toNonIndexed();
      const base = pos.length / 3;
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      const u = g.attributes.uv ? g.attributes.uv.array : null;
      const n = p.length / 3;
      for (let i = 0; i < n; i++) { uv.push(u ? u[i * 2] : 0, u ? u[i * 2 + 1] : 0); }
      if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base); }
      else for (let i = 0; i < n; i++) idx.push(base + i);
    }
    groups.push({ start, count: idx.length - start, mat });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  for (const g of groups) geo.addGroup(g.start, g.count, g.mat);
  return geo;
}

function frameOf(a, b, c, out) {
  let ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
  let l = Math.hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l;
  const tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
  let nx = ey * tz - ez * ty, ny = ez * tx - ex * tz, nz = ex * ty - ey * tx;
  l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const bx = ny * ez - nz * ey, by = nz * ex - nx * ez, bz = nx * ey - ny * ex;
  // columns: e, b, n
  out[0] = ex; out[1] = bx; out[2] = nx;
  out[3] = ey; out[4] = by; out[5] = ny;
  out[6] = ez; out[7] = bz; out[8] = nz;
  return out;
}

// A mesh whose vertices follow a set of physics nodes (BeamNG "flexbody").
// Each vertex is bound to its K nearest nodes; the rotation of a 3-node
// reference frame carries the vertex offsets, so the mesh stays correct
// even when the whole part tumbles away after detaching.
export class FlexMesh {
  constructor(world, geo, materials, bindIds, restOf, frameIds, opts = {}) {
    this.world = world;
    const K = this.K = Math.min(opts.K ?? 4, bindIds.length);
    const p = geo.attributes.position.array;
    const nv = p.length / 3;
    this.idx = new Int32Array(nv * K);
    this.w = new Float32Array(nv * K);
    this.off = new Float32Array(nv * K * 3);
    const rp = bindIds.map(restOf);
    const bd = new Float32Array(K), bi = new Int32Array(K);
    for (let v = 0; v < nv; v++) {
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      bd.fill(Infinity);
      for (let n = 0; n < rp.length; n++) {
        const r = rp[n];
        const d = Math.hypot(x - r[0], y - r[1], z - r[2]);
        if (d >= bd[K - 1]) continue;
        let j = K - 1;
        while (j > 0 && bd[j - 1] > d) { bd[j] = bd[j - 1]; bi[j] = bi[j - 1]; j--; }
        bd[j] = d; bi[j] = n;
      }
      let ws = 0;
      for (let k = 0; k < K; k++) ws += 1 / ((bd[k] + 0.04) ** 2);
      for (let k = 0; k < K; k++) {
        const j = v * K + k, r = rp[bi[k]];
        this.idx[j] = bindIds[bi[k]];
        this.w[j] = 1 / ((bd[k] + 0.04) ** 2) / ws;
        this.off[j * 3] = x - r[0]; this.off[j * 3 + 1] = y - r[1]; this.off[j * 3 + 2] = z - r[2];
      }
    }
    this.frameIds = frameIds;
    this.R0 = frameOf(...frameIds.map(restOf), new Float64Array(9));
    this.R = new Float64Array(9);
    this.D = new Float64Array(9);
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(geo, materials);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.restOf = restOf;
  }

  // world rotation of this piece relative to its rest pose
  updateFrame() {
    const W = this.world, f = this.frameIds;
    const P = (id) => [W.px[id], W.py[id], W.pz[id]];
    frameOf(P(f[0]), P(f[1]), P(f[2]), this.R);
    const R = this.R, R0 = this.R0, D = this.D;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      D[i * 3 + j] = R[i * 3] * R0[j * 3] + R[i * 3 + 1] * R0[j * 3 + 1] + R[i * 3 + 2] * R0[j * 3 + 2];
    return D;
  }

  update(normals = true) {
    const W = this.world, D = this.updateFrame();
    const px = W.px, py = W.py, pz = W.pz;
    const pos = this.mesh.geometry.attributes.position.array;
    const K = this.K, idx = this.idx, w = this.w, off = this.off;
    const d0 = D[0], d1 = D[1], d2 = D[2], d3 = D[3], d4 = D[4], d5 = D[5], d6 = D[6], d7 = D[7], d8 = D[8];
    const nv = pos.length / 3;
    for (let v = 0; v < nv; v++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < K; k++) {
        const j = v * K + k, id = idx[j], wt = w[j];
        const ox = off[j * 3], oy = off[j * 3 + 1], oz = off[j * 3 + 2];
        x += wt * (px[id] + d0 * ox + d1 * oy + d2 * oz);
        y += wt * (py[id] + d3 * ox + d4 * oy + d5 * oz);
        z += wt * (pz[id] + d6 * ox + d7 * oy + d8 * oz);
      }
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    if (normals) g.computeVertexNormals();
  }
}
