import * as THREE from 'three';
import { RGBELoader } from 'three/addons/RGBELoader.js';
import { SoftBodyWorld } from './physics.js';
import { World } from './world.js';
import { MAPS } from './maps.js';
import { Vehicle, VEHICLE_TYPES } from './vehicle.js';
import { Crate } from './props.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

const PHYS_HZ = 2000;
const DT = 1 / PHYS_HZ;
const $ = (id) => document.getElementById(id);

const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const QUALITY = isMobile
  ? { terrainRes: 241, trees: 350, shadow: 1024, pixelRatio: Math.min(devicePixelRatio, 1.5), maxSubFrac: 1 / 30 }
  : { terrainRes: 321, trees: 700, shadow: 2048, pixelRatio: Math.min(devicePixelRatio, 2), maxSubFrac: 1 / 30 };

class Game {
  constructor() {
    this.canvas = $('c');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !isMobile, powerPreference: 'high-performance' });
    r.setPixelRatio(QUALITY.pixelRatio);
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2500);
    this.input = new Input();
    this.audio = new Audio();
    this.timeScale = 1;
    this.tcs = true;
    this.paused = false;
    this.camMode = 0;
    this.showBeams = false;
    this.acc = 0;
    this.vehicleType = 'sedan';
    this.orbit = { yaw: 0.6, pitch: 0.25, dist: 9 };
    const fit = () => {
      r.setSize(innerWidth, innerHeight);
      const a = innerWidth / innerHeight;
      this.camera.aspect = a;
      // keep a usable horizontal view in portrait
      this.camera.fov = a < 1 ? 78 : 62;
      this.portrait = a < 1;
      this.camera.updateProjectionMatrix();
    };
    fit();
    addEventListener('resize', fit);
  }

  async load(progress) {
    const tl = new THREE.TextureLoader();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const files = {
      sand: 'sand_diff.jpg', redrock: 'redrock_diff.jpg', rock: 'rock_diff.jpg', snow: 'snow_diff.jpg', brick: 'brick_diff.jpg',
      grass: 'grass_diff.jpg', dirt: 'dirt_diff.jpg', asphalt: 'asphalt_diff.jpg',
      concrete: 'concrete_diff.jpg', concreteN: 'concrete_nor.jpg', metal: 'metal_diff.jpg', wood: 'wood_diff.jpg', bark: 'bark_diff.jpg',
    };
    const keys = Object.keys(files);
    let done = 0;
    const total = keys.length + 1;
    this.textures = {};
    await Promise.all(keys.map(k => new Promise((res) => {
      tl.load('assets/tex/' + files[k], (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        if (!k.endsWith('N')) t.colorSpace = THREE.SRGBColorSpace;
        this.textures[k] = t;
        progress(++done / total); res();
      }, undefined, () => { progress(++done / total); this.textures[k] = new THREE.Texture(); res(); });
    })));
    const hdr = await new Promise((res) => new RGBELoader().load('assets/hdri/sky_1k.hdr', res, undefined, () => res(null)));
    progress(1);
    if (hdr) {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.envMap = pm.fromEquirectangular(hdr).texture;
      this.scene.environment = this.envMap;
      this.scene.background = hdr;
      this.scene.backgroundIntensity = 1.0;
      this.scene.environmentIntensity = 0.9;
    } else {
      this.scene.background = new THREE.Color(0x9cc4e8);
    }
  }

  init() {
    const s = this.scene;
    s.fog = new THREE.Fog(0xa9c3dc, 350, 1800);
    s.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a5a3a, 0.5));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(80, 140, 60);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
    sun.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    s.add(sun); s.add(sun.target);
    let saved = null;
    try { saved = localStorage.getItem('sbd-map'); } catch (e) { /* storage blocked */ }
    this.loadMap(MAPS[saved] ? saved : 'grounds');
    this.buildBeamView();
    this.camPos = new THREE.Vector3(0, 5, -10);
    this.camLook = new THREE.Vector3();
    this.setupUI();
  }

  loadMap(id) {
    if (this.vehicles) for (const v of this.vehicles) v.dispose();
    if (this.crates) for (const c of this.crates) c.dispose();
    this.vehicles = this.crates = null;
    if (this.worldMap) this.worldMap.dispose();
    const def = MAPS[id];
    this.mapId = id;
    try { localStorage.setItem('sbd-map', id); } catch (e) { /* storage blocked */ }
    this.worldMap = new World(this.scene, this.textures, QUALITY, def);
    const f = def.fog || { color: 0xa9c3dc, near: 350, far: 1800 };
    this.scene.fog = new THREE.Fog(f.color, f.near, f.far);
    const sun = def.sun || { color: 0xfff1dc, intensity: 2.6 };
    this.sun.color.setHex(sun.color); this.sun.intensity = sun.intensity;
    this.spawnAll();
    this.chaseYaw = undefined;
    const sel = document.getElementById('mapSel'); if (sel) sel.value = id;
  }

  mapSpawn() {
    const w = this.worldMap, d = w.def;
    const sp = d.spawnFn ? d.spawnFn(w) : d.spawn;
    return { pos: new THREE.Vector3(sp.x, w.heightAt(sp.x, sp.z) + 0.05, sp.z), yaw: sp.yaw };
  }

  // (re)build every soft body for the current map
  spawnAll() {
    if (this.vehicles) for (const v of this.vehicles) v.dispose();
    if (this.crates) for (const c of this.crates) c.dispose();
    const w = this.worldMap, d = w.def;
    this.phys = new SoftBodyWorld();
    this.phys.collider = w;
    this.grab = null;
    this.phys.onSubstep.push((dt) => this.grabStep(dt));
    this.vehicles = [];
    this.crates = [];
    const sp = this.mapSpawn();
    this.player = new Vehicle(this, this.vehicleType, sp.pos, sp.yaw, { controlled: true, color: this.color });
    this.player.body.noSleep = true;
    this.vehicles.push(this.player);
    const at = (o) => new THREE.Vector3(o.x, w.heightAt(o.x, o.z) + 0.05, o.z);
    for (const o of (d.parkedFn ? d.parkedFn(w) : d.parked) || []) this.vehicles.push(new Vehicle(this, o.type, at(o), o.yaw, { color: o.color }));
    for (const o of d.ai || []) {
      const v = new Vehicle(this, o.type, at(o), o.yaw, { color: o.color });
      v.ai = { stuck: 0, reverse: 0 };
      v.body.noSleep = true;
      this.vehicles.push(v);
    }
    for (const [x, y, z] of (d.cratesFn ? d.cratesFn(w) : d.crates) || []) this.crates.push(new Crate(this, x, w.heightAt(x, z) + y, z));
    this.lastDamage = 0;
  }

  // demolition-derby drivers: aim at the player, back up when stuck
  driveAI(dt) {
    const p = this.player.center();
    for (const v of this.vehicles) {
      if (!v.ai || !v.frame) continue;
      const a = v.ai, c = v.center(), f = v.frame.f, r = v.frame.r;
      const dx = p.x - c.x, dz = p.z - c.z;
      const ang = Math.atan2(dx * r[0] + dz * r[2], dx * f[0] + dz * f[2]);
      const upright = v.frame.u[1] > 0.4;
      if (a.reverse > 0) {
        a.reverse -= dt;
        Object.assign(v.input, { throttle: 0, brake: 1, steer: -Math.sign(ang), handbrake: 0 });
        continue;
      }
      a.stuck = Math.abs(v.speed) < 1.2 ? a.stuck + dt : 0;
      if (a.stuck > 1.8) { a.stuck = 0; a.reverse = 1.4; }
      const near = Math.hypot(dx, dz) < 12;
      Object.assign(v.input, {
        throttle: upright && v.engineHealth > 0.12 ? (near ? 1 : 0.75) : 0,
        brake: 0, handbrake: 0,
        steer: Math.max(-1, Math.min(1, ang * 2.2)),
      });
    }
  }

  resetPlayer(toSpawn) {
    const v = this.player;
    let pos, yaw;
    if (toSpawn) { const sp = this.mapSpawn(); pos = sp.pos; yaw = sp.yaw; }
    else {
      const c = v.center(); const f = v.frame.f;
      yaw = Math.atan2(f[0], f[2]);
      pos = new THREE.Vector3(c.x, this.worldMap.heightAt(c.x, c.z) + 0.4, c.z);
    }
    // rebuild in place: the pools are append only, so recreate everything
    // but keep other bodies' state by respawning just this vehicle at the end
    this.respawnVehicle(v, pos, yaw);
  }

  respawnVehicle(v, pos, yaw) {
    v.repair(pos, yaw);
    this.lastDamage = 0;
  }

  buildBeamView() {
    const geo = new THREE.BufferGeometry();
    const n = this.phys.maxBeams * 2;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
    this.beamLines = new THREE.LineSegments(geo, mat);
    this.beamLines.frustumCulled = false;
    this.beamLines.renderOrder = 10;
    this.beamLines.visible = false;
    this.scene.add(this.beamLines);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.phys.maxNodes * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.nodePoints = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffee55, size: 5, sizeAttenuation: false, depthTest: false }));
    this.nodePoints.frustumCulled = false; this.nodePoints.renderOrder = 11; this.nodePoints.visible = false;
    this.scene.add(this.nodePoints);
  }
  rebuildBeamView() { /* geometry is sized for the max pool, nothing to do */ }

  updateBeamView() {
    const W = this.phys;
    const p = this.beamLines.geometry.attributes.position.array;
    const c = this.beamLines.geometry.attributes.color.array;
    let o = 0;
    for (let i = 0; i < W.beamCount; i++) {
      if (W.broken[i]) continue;
      const a = W.ba[i], b = W.bb[i];
      p[o] = W.px[a]; p[o + 1] = W.py[a]; p[o + 2] = W.pz[a];
      p[o + 3] = W.px[b]; p[o + 4] = W.py[b]; p[o + 5] = W.pz[b];
      // stress colour: green relaxed -> red tension / blue compression; yellow if bent
      const s = Math.max(-1, Math.min(1, W.stress[i] / 15000));
      const plastic = Math.min(1, Math.abs(W.rest[i] / W.rest0[i] - 1) * 8);
      let r = 0.2 + Math.max(0, s) * 0.8, g = 0.9 - Math.abs(s) * 0.7, bl = 0.2 + Math.max(0, -s) * 0.8;
      r = r + (1 - r) * plastic; g = g + (0.85 - g) * plastic; bl = bl * (1 - plastic);
      c[o] = c[o + 3] = r; c[o + 1] = c[o + 4] = g; c[o + 2] = c[o + 5] = bl;
      o += 6;
    }
    this.beamLines.geometry.setDrawRange(0, o / 3);
    this.beamLines.geometry.attributes.position.needsUpdate = true;
    this.beamLines.geometry.attributes.color.needsUpdate = true;
    const np = this.nodePoints.geometry.attributes.position.array;
    for (let i = 0; i < W.nodeCount; i++) { np[i * 3] = W.px[i]; np[i * 3 + 1] = W.py[i]; np[i * 3 + 2] = W.pz[i]; }
    this.nodePoints.geometry.setDrawRange(0, W.nodeCount);
    this.nodePoints.geometry.attributes.position.needsUpdate = true;
  }

  setupUI() {
    const ms = $('mapSel');
    for (const [k, m] of Object.entries(MAPS)) { const o = document.createElement('option'); o.value = k; o.textContent = m.label; ms.appendChild(o); }
    ms.value = this.mapId;
    $('mapDesc').textContent = MAPS[this.mapId].desc;
    ms.onchange = () => {
      const id = ms.value; ms.blur();
      $('mapDesc').textContent = MAPS[id].desc;
      $('loading').style.display = 'flex'; $('loadtxt').textContent = 'Building ' + MAPS[id].label + '…';
      setTimeout(() => { this.loadMap(id); $('loading').style.display = 'none'; }, 40);
    };
    const sel = $('vehSel');
    for (const [k, t] of Object.entries(VEHICLE_TYPES)) {
      const o = document.createElement('option'); o.value = k; o.textContent = t.label; sel.appendChild(o);
    }
    sel.value = this.vehicleType;
    sel.onchange = () => { this.vehicleType = sel.value; this.color = undefined; this.spawnAll(); sel.blur(); };
    const colors = [0xd23a2a, 0x2a5bd2, 0xe8e4da, 0x1b1b1f, 0xf0a020, 0x2f8f5a, 0x8a2be2, 0xc0c4c8];
    const cw = $('colors');
    for (const col of colors) {
      const b = document.createElement('button');
      b.style.background = '#' + col.toString(16).padStart(6, '0');
      b.onclick = () => { this.color = col; this.player.setColor(col); };
      cw.appendChild(b);
    }
    const act = {
      reset: () => this.resetPlayer(false),
      spawn: () => this.resetPlayer(true),
      all: () => this.spawnAll(),
      cam: () => this.cycleCam(),
      beams: () => this.toggleBeams(),
      slow: () => this.cycleSlow(),
      pause: () => this.togglePause(),
      tcs: () => { this.tcs = !this.tcs; $('bTcs').classList.toggle('off', !this.tcs); },
      sound: () => { this.audio.enabled = !this.audio.enabled; $('bSound').classList.toggle('off', !this.audio.enabled); },
      menu: () => $('panel').classList.toggle('open'),
      grab: () => { this.grabMode = !this.grabMode; $('bGrab').classList.toggle('on', this.grabMode); },
    };
    document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => { act[b.dataset.act](); b.blur(); }));
    for (const [id, key] of [['tGas', 'throttle'], ['tBrake', 'brake'], ['tLeft', 'left'], ['tRight', 'right'], ['tHb', 'handbrake']]) this.input.bindTouch($(id), key);
    if (isMobile) document.body.classList.add('touch');

    // pointer: Ctrl (or the Grab button) + drag pulls a node, otherwise orbit the camera
    let drag = null;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (this.grabActive() && this.tryGrab(e.clientX, e.clientY, e.pointerType === 'touch' ? 60 : 36)) return;
      drag = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointerup', () => { drag = null; this.releaseGrab(); });
    addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      this.orbit.yaw -= dx * 0.006; this.orbit.pitch = Math.max(-0.1, Math.min(1.4, this.orbit.pitch + dy * 0.005));
      this.orbitTouched = performance.now();
    });
    this.canvas.addEventListener('wheel', (e) => { this.orbit.dist = Math.max(4, Math.min(40, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
  }

  grabActive() { return this.grabMode || this.input.keys.has('ControlLeft') || this.input.keys.has('ControlRight') || this.input.keys.has('MetaLeft'); }

  // pick the node closest to the pointer on screen
  tryGrab(sx, sy, maxPx) {
    const W = this.phys, cam = this.camera, v = new THREE.Vector3();
    let best = -1, bd = maxPx * maxPx, bz = Infinity;
    for (let i = 0; i < W.nodeCount; i++) {
      if (!W.collides[i] && !W.selfColl[i]) continue;
      v.set(W.px[i], W.py[i], W.pz[i]).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd - 4 || (d < bd + 4 && v.z < bz)) { bd = d; best = i; bz = v.z; }
    }
    if (best < 0) return false;
    // spread the pull over the node and its beam neighbours so it doesn't just rip one node out
    const body = W.bodies[W.body[best]];
    const group = new Set([best]);
    for (let b = body.beamStart; b < body.beamEnd && group.size < 9; b++) {
      if (W.broken[b]) continue;
      if (W.ba[b] === best) group.add(W.bb[b]); else if (W.bb[b] === best) group.add(W.ba[b]);
    }
    const p = new THREE.Vector3(W.px[best], W.py[best], W.pz[best]);
    const n = new THREE.Vector3(); cam.getWorldDirection(n);
    this.grab = { node: best, group: [...group], body, target: p.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, p) };
    W.wake(body);
    if (!this.grabLine) {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      this.grabLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff7a1a, depthTest: false }));
      this.grabLine.frustumCulled = false; this.grabLine.renderOrder = 12;
      this.scene.add(this.grabLine);
    }
    this.grabLine.visible = true;
    return true;
  }

  releaseGrab() { this.grab = null; if (this.grabLine) this.grabLine.visible = false; }

  updateGrabTarget() {
    const g = this.grab; if (!g || !this.pointer || !g.plane) return;
    const ndc = new THREE.Vector2(this.pointer.x / innerWidth * 2 - 1, -(this.pointer.y / innerHeight) * 2 + 1);
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    rc.setFromCamera(ndc, this.camera);
    rc.ray.intersectPlane(g.plane, g.target);
    const W = this.phys, i = g.node, a = this.grabLine.geometry.attributes.position.array;
    a[0] = W.px[i]; a[1] = W.py[i]; a[2] = W.pz[i]; a[3] = g.target.x; a[4] = g.target.y; a[5] = g.target.z;
    this.grabLine.geometry.attributes.position.needsUpdate = true;
  }

  // spring pulling the grabbed node toward the cursor (runs every physics substep)
  grabStep() {
    const g = this.grab; if (!g) return;
    const W = this.phys, i = g.node;
    let m = 0;
    for (const n of g.group) m += W.mass[n];
    const k = 30 * m + 9000, c = 2 * Math.sqrt(k * m);
    let Fx = k * (g.target.x - W.px[i]) - c * W.vx[i];
    let Fy = k * (g.target.y - W.py[i]) - c * W.vy[i];
    let Fz = k * (g.target.z - W.pz[i]) - c * W.vz[i];
    const F = Math.hypot(Fx, Fy, Fz), Fmax = 22000;
    if (F > Fmax) { Fx *= Fmax / F; Fy *= Fmax / F; Fz *= Fmax / F; }
    for (const n of g.group) {
      const w = W.mass[n] / m;
      W.fx[n] += Fx * w; W.fy[n] += Fy * w; W.fz[n] += Fz * w;
    }
  }

  cycleCam() { this.camMode = (this.camMode + 1) % 3; $('camName').textContent = ['Chase', 'Orbit', 'Hood'][this.camMode]; }
  toggleBeams() { this.showBeams = !this.showBeams; this.beamLines.visible = this.showBeams; this.player.setXray(this.showBeams); }
  cycleSlow() { const s = [1, 0.5, 0.25, 0.1]; this.timeScale = s[(s.indexOf(this.timeScale) + 1) % s.length]; $('slowTxt').textContent = this.timeScale === 1 ? '' : `${this.timeScale}x`; }
  togglePause() { this.paused = !this.paused; $('pauseTxt').style.display = this.paused ? 'block' : 'none'; }

  handleKeys() {
    const I = this.input;
    if (I.consume('KeyR')) this.resetPlayer(I.keys.has('ShiftLeft') || I.keys.has('ShiftRight'));
    if (I.consume('Home')) this.resetPlayer(true);
    if (I.consume('KeyC')) this.cycleCam();
    if (I.consume('KeyB')) this.toggleBeams();
    if (I.consume('KeyT')) this.cycleSlow();
    if (I.consume('KeyP') || I.consume('Escape')) this.togglePause();
    if (I.consume('KeyY')) document.querySelector('[data-act=tcs]').click();
    if (I.consume('KeyM')) document.querySelector('[data-act=sound]').click();
    if (I.consume('KeyN')) this.spawnAll();
    if (I.consume('KeyH')) $('help').classList.toggle('hide');
    if (I.consume('Digit1')) { this.vehicleType = 'hatch'; $('vehSel').value = 'hatch'; this.spawnAll(); }
    if (I.consume('Digit2')) { this.vehicleType = 'sedan'; $('vehSel').value = 'sedan'; this.spawnAll(); }
    if (I.consume('Digit3')) { this.vehicleType = 'pickup'; $('vehSel').value = 'pickup'; this.spawnAll(); }
  }

  updateCamera(dt) {
    const v = this.player, f = v.frame;
    const c = v.center();
    const up = new THREE.Vector3(...f.u), fwd = new THREE.Vector3(...f.f);
    const target = c.clone().addScaledVector(up, 0.6);
    const cam = this.camera;
    if (this.camMode === 2) {
      // hood / driver view rigidly attached to the chassis
      const p = c.clone().addScaledVector(up, 1.05).addScaledVector(fwd, 0.1).addScaledVector(new THREE.Vector3(...f.r), 0.37);
      cam.position.copy(p);
      cam.up.copy(up);
      cam.lookAt(p.clone().add(fwd));
      return;
    }
    cam.up.set(0, 1, 0);
    let yaw;
    if (this.camMode === 0) {
      // chase: follow heading, or direction of travel when reversing fast
      let hx = fwd.x, hz = fwd.z;
      const vel = v.vel;
      if (Math.hypot(vel[0], vel[2]) > 4 && v.speed < -2) { hx = -vel[0]; hz = -vel[2]; }
      if (Math.hypot(vel[0], vel[2]) > 4 && v.speed > 2) { hx = vel[0]; hz = vel[2]; }
      const base = Math.atan2(hx, hz);
      // let the user look around, then drift back
      if (!this.chaseYaw) this.chaseYaw = base;
      let d = base - this.chaseYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.chaseYaw += d * (1 - Math.exp(-dt * 5));
      const recent = performance.now() - (this.orbitTouched || 0) < 2500;
      if (!recent) { this.orbit.yaw *= Math.exp(-dt * 2); this.orbit.pitch += (0.22 - this.orbit.pitch) * (1 - Math.exp(-dt * 2)); }
      yaw = this.chaseYaw + Math.PI + this.orbit.yaw * (recent || Math.abs(this.orbit.yaw) > 0.01 ? 1 : 0);
      const dist = (6.5 + Math.min(3, Math.abs(v.speed) * 0.04)) * (this.portrait ? 1.3 : 1);
      const pitch = this.orbit.pitch;
      const want = new THREE.Vector3(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist + 0.8, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      const gh = this.worldMap.heightAt(want.x, want.z) + 0.5;
      if (want.y < gh) want.y = gh;
      this.camPos.lerp(want, 1 - Math.exp(-dt * 10));
      this.camLook.lerp(target, 1 - Math.exp(-dt * 18));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
    } else {
      const o = this.orbit;
      const want = new THREE.Vector3(target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, target.y + Math.sin(o.pitch) * o.dist, target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
      cam.position.copy(want);
      cam.lookAt(target);
      this.camPos.copy(want); this.camLook.copy(target);
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.input.update(dt);
    this.handleKeys();
    const v = this.player;
    v.input.throttle = this.input.throttle;
    v.input.brake = this.input.brake;
    v.input.steer = this.input.steer;
    v.input.handbrake = this.input.handbrake;
    for (const o of this.vehicles) if (o !== v && !o.ai) { o.input.brake = 0; o.input.handbrake = 1; }
    if (!this.paused) this.driveAI(dt * this.timeScale);

    let physMs = 0, steps = 0;
    if (!this.paused) {
      const W = this.phys;
      W.prepareFrame(dt * this.timeScale);
      this.acc += dt * this.timeScale;
      steps = Math.floor(this.acc / DT);
      const maxSteps = Math.ceil(QUALITY.maxSubFrac / DT);
      if (steps > maxSteps) { steps = maxSteps; this.acc = 0; } else this.acc -= steps * DT;
      for (const o of this.vehicles) o.preFrame(steps * DT || 1e-4);
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) W.step(DT);
      physMs = performance.now() - t0;
      // crash sounds from sudden deformation
      const E = W.deformEnergy[v.body.id];
      const dE = E - this.lastDamage;
      this.lastDamage = E;
      let hit = dE / 6000;
      for (const o of this.vehicles) hit = Math.max(hit, o.lastImpulse / 4000);
      if (hit > 0.15) this.audio.crash(Math.min(1, hit));
    } else {
      for (const o of this.vehicles) o.preFrame(1e-4);
    }

    for (const o of this.vehicles) o.updateVisual();
    for (const c of this.crates) c.updateVisual();
    const showNodes = this.showBeams || this.grabActive();
    this.nodePoints.visible = showNodes;
    if (this.showBeams || showNodes) this.updateBeamView();
    this.updateGrabTarget();
    this.updateCamera(dt);
    const c = v.center();
    this.sun.position.set(c.x + 60, c.y + 120, c.z + 40);
    this.sun.target.position.copy(c);
    this.audio.update(v);
    this.renderer.render(this.scene, this.camera);
    this.updateHUD(dt, physMs, steps);
    this.input.endFrame();
  }

  updateHUD(dt, physMs, steps) {
    const v = this.player;
    this._fps = (this._fps || 60) * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    this._pm = (this._pm || 0) * 0.9 + physMs * 0.1;
    this._t = (this._t || 0) + dt;
    if (this._t < 0.1) return;
    this._t = 0;
    $('speed').textContent = Math.round(Math.abs(v.speed) * 3.6);
    $('gear').textContent = v.gear === -1 ? 'R' : (Math.abs(v.speed) < 0.5 && v.throttleEff < 0.05 ? 'N' : v.gear);
    const e = v.type.engine;
    $('rpmbar').style.width = (Math.min(1, v.rpm / e.redline) * 100) + '%';
    $('rpmbar').classList.toggle('red', v.rpm > e.redline * 0.9);
    $('rpm').textContent = Math.round(v.rpm / 100) * 100;
    const dmg = 1 - Math.exp(-v.damage / 90000);
    $('dmgbar').style.width = (dmg * 100) + '%';
    $('dmg').textContent = Math.round(dmg * 100) + '%';
    const W = this.phys;
    let broken = 0;
    for (let i = v.body.beamStart; i < v.body.beamEnd; i++) broken += W.broken[i];
    const info = v.partsInfo();
    const chips = info.parts.map(p => `<span class="chip ${p.state}">${p.label}</span>`).join('')
      + (info.wheelsOff ? `<span class="chip off">${info.wheelsOff} wheel${info.wheelsOff > 1 ? 's' : ''} off</span>` : '')
      + (info.lights ? `<span class="chip loose">${info.lights} light${info.lights > 1 ? 's' : ''} broken</span>` : '')
      + (info.glass ? `<span class="chip loose">${info.glass} window${info.glass > 1 ? 's' : ''} smashed</span>` : '');
    const eng = Math.round(info.engine * 100);
    const html = `<div class="lbl"><span>Engine</span><span class="${eng < 12 ? 'bad' : eng < 70 ? 'warn' : ''}">${eng < 12 ? 'dead' : eng + '%'}</span></div><div class="chips">${chips}</div>`;
    if (html !== this._partsHtml) { $('parts').innerHTML = html; this._partsHtml = html; }
    $('stats').textContent = `${Math.round(this._fps)} fps · physics ${this._pm.toFixed(1)} ms · ${PHYS_HZ} Hz · ${W.nodeCount} nodes · ${W.beamCount} beams · ${broken} broken`;
  }
}

async function main() {
  const game = new Game();
  window.game = game;
  await game.load((p) => { $('loadbar').style.width = (p * 100) + '%'; });
  $('loadtxt').textContent = 'Building world…';
  await new Promise(r => setTimeout(r, 30));
  game.init();
  $('loadtxt').textContent = isMobile ? 'Tap to drive' : 'Click to drive';
  $('loading').classList.add('ready');
  const go = () => {
    $('loading').style.display = 'none';
    game.audio.start();
    removeEventListener('pointerdown', go); removeEventListener('keydown', go);
  };
  addEventListener('pointerdown', go); addEventListener('keydown', go);
  const loop = (t) => { game.frame(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

main().catch((e) => { console.error(e); $('loadtxt').textContent = 'Error: ' + e.message; });
