import * as THREE from 'three';

// A breakable wooden crate: 8 corner nodes + a centre node, fully braced.
export class Crate {
  constructor(game, x, y, z, size = 1.1, mass = 45) {
    this.game = game;
    const W = this.world = game.phys;
    const body = this.body = W.createBody('crate');
    const h = size / 2;
    this.corners = [];
    for (let i = 0; i < 8; i++) {
      const cx = (i & 1 ? h : -h), cy = (i & 2 ? h : -h), cz = (i & 4 ? h : -h);
      this.corners.push(W.addNode(body, x + cx, y + cy, z + cz, mass / 10, { friction: 0.6, radius: 0.03, cradius: 0.3 }));
    }
    this.center = W.addNode(body, x, y, z, mass / 5, { collides: false, cradius: h * 0.85 });
    const all = [...this.corners, this.center];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
      W.addBeam(body, all[i], all[j], { k: 4e5, d: 60, yieldF: 5500, breakStrain: 0.35 });

    if (!Crate.geo) {
      Crate.geo = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
      Crate.mat = new THREE.MeshStandardMaterial({ map: game.textures.wood, color: 0xe0c090, roughness: 0.85 });
    }
    const geo = Crate.geo.clone();
    geo.scale(size, size, size);
    this.rest = geo.attributes.position.array.slice();
    this.h = h;
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(geo, Crate.mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
  }

  updateVisual() {
    const W = this.world, c = this.corners, r = this.rest, h = this.h;
    const pos = this.mesh.geometry.attributes.position.array;
    for (let v = 0; v < r.length; v += 3) {
      // trilinear interpolation between the 8 corners
      const u = r[v] / (2 * h) + 0.5, s = r[v + 1] / (2 * h) + 0.5, t = r[v + 2] / (2 * h) + 0.5;
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < 8; i++) {
        const w = (i & 1 ? u : 1 - u) * (i & 2 ? s : 1 - s) * (i & 4 ? t : 1 - t);
        if (w === 0) continue;
        const n = c[i];
        x += W.px[n] * w; y += W.py[n] * w; z += W.pz[n] * w;
      }
      pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
