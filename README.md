# SoftBody Drive

A BeamNG-style soft-body driving sandbox that runs in the browser. No build step, no install.

## Run it

Serve the folder with any static server and open `index.html`:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening the file directly with `file://` won't work because browsers block ES module and texture loads from disk.)

## What's in it

- **Node/beam soft-body physics** (`src/physics.js`) at 2000 Hz. Every vehicle is about 150 point masses joined by about 1,400 damped springs. Beams bend permanently past a force limit and snap past a strain limit, so crashes crumple the body and can tear wheels off.
- **Vehicles** (`src/vehicle.js`): hatchback (FWD), sport sedan (RWD), and pickup (AWD). The beam structure is generated from a body profile. Each wheel hangs on a 2-link wishbone with a spring/damper strut and bump stops, plus anti-roll bars. It also has a slip-based tire model, an engine torque curve, an automatic gearbox, ABS, and traction control.
- **Real parts**: the hood, trunk (or hatch or bed cover), doors, bumpers and mirrors are separate node/beam parts. Hinges and latches can break, so doors swing open, hoods pop up, and bumpers and mirrors fall off. Headlights, taillights and glass shatter when the metal around them bends. A crushed engine bay loses power and can kill the engine. The HUD lists the state of every part.
- **Details**: panel gaps, an interior with seats, a dash and a steering wheel that turns, an engine bay, a grille, license plates, an exhaust, wipers, 5-spoke rims with brake discs and calipers, and visible control arms and coil springs.
- **Node grabbing**: hold **Ctrl** and drag any node to pull a car around or flip it back over (on phones, use the ✋ Grab button).
- **Deformable visuals**: the car body is a lofted mesh skinned to the physics nodes, so dents show up exactly where the structure deformed. Press **B** to see the nodes and beams colored by stress.
- **World** (`src/world.js`): a 960 m procedural terrain with a road circuit (lane markings, smoothed grades) and forest. There's a proving ground with curved jump ramps, a landing table, crash walls, a pole, log bumps, a banked turn, shipping containers, and stacks of breakable crates. Two parked cars are there to crash into.
- **Performance**: flat typed arrays, no allocation in the physics loop, per-frame broad phase, and bodies at rest go to sleep. If a device can't keep up, the game slows down instead of exploding.
- Procedural WebAudio engine, tire squeal, wind, and crash sounds.
- Works with keyboard, gamepad, and touch.

## Controls

| Key | Action |
| --- | --- |
| W/S or arrows | throttle / brake (hold S at a stop to reverse) |
| A/D | steer |
| Space | handbrake |
| R / Shift+R | repair in place / back to spawn |
| C | camera (chase, orbit, hood); drag to look around |
| B | show nodes and beams |
| Ctrl + drag | grab a node and pull |
| T | slow motion |
| P | pause |
| Y | traction control on/off |
| 1 2 3 | switch vehicle |
| N | reset the whole world |

## Credits

- Textures and HDRI sky: [Poly Haven](https://polyhaven.com) (CC0)
- Rendering: [three.js](https://threejs.org) r169 (MIT, vendored in `vendor/three`)
