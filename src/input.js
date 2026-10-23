// Keyboard, gamepad and on-screen touch controls -> smoothed driver inputs.
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, left: 0, right: 0, handbrake: 0 };
    this.pressed = new Set(); // one-shot actions this frame
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(el, key) {
    const on = (e) => { e.preventDefault(); this.touch[key] = 1; el.classList.add('on'); };
    const off = (e) => { e.preventDefault(); this.touch[key] = 0; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  update(dt) {
    const k = this.keys, t = this.touch;
    let thr = (k.has('KeyW') || k.has('ArrowUp') || t.throttle) ? 1 : 0;
    let brk = (k.has('KeyS') || k.has('ArrowDown') || t.brake) ? 1 : 0;
    let st = ((k.has('KeyA') || k.has('ArrowLeft') || t.left) ? 1 : 0) - ((k.has('KeyD') || k.has('ArrowRight') || t.right) ? 1 : 0);
    let hb = (k.has('Space') || t.handbrake) ? 1 : 0;
    let analog = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.08) { st = -ax; analog = true; }
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (rt > 0.05) thr = Math.max(thr, rt);
      if (lt > 0.05) brk = Math.max(brk, lt);
      if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) hb = 1;
      if (p.buttons[3]?.pressed && !this._padY) this.pressed.add('KeyR');
      this._padY = p.buttons[3]?.pressed;
      if (p.buttons[2]?.pressed && !this._padX) this.pressed.add('KeyC');
      this._padX = p.buttons[2]?.pressed;
    }

    // ramp keyboard inputs like a real pedal / wheel
    const ramp = (cur, target, up, down) => {
      const r = (target > cur ? up : down) * dt;
      return cur + Math.max(-r, Math.min(r, target - cur));
    };
    this.throttle = analog ? thr : ramp(this.throttle, thr, 4, 8);
    this.brake = analog ? brk : ramp(this.brake, brk, 5, 10);
    this.steer = analog ? st : ramp(this.steer, st, 3.2, 4.5);
    this.handbrake = hb;
  }

  endFrame() { this.pressed.clear(); }
}
