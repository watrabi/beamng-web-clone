// Procedural engine / tyre / crash sounds with WebAudio (no samples needed).
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // engine: two detuned saws + a sub sine through a lowpass
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900; this.engFilter.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.oscs = [];
    for (const [type, mul, g] of [['sawtooth', 1, 0.35], ['sawtooth', 0.5, 0.35], ['square', 2, 0.08], ['sine', 0.25, 0.5]]) {
      const o = ctx.createOscillator(); o.type = type;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(this.engFilter); o.start();
      this.oscs.push({ o, mul });
    }
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // tyre squeal: band-passed noise
    const sq = ctx.createBufferSource(); sq.buffer = buf; sq.loop = true;
    this.sqFilter = ctx.createBiquadFilter(); this.sqFilter.type = 'bandpass'; this.sqFilter.frequency.value = 1100; this.sqFilter.Q.value = 9;
    this.sqGain = ctx.createGain(); this.sqGain.gain.value = 0;
    sq.connect(this.sqFilter); this.sqFilter.connect(this.sqGain); this.sqGain.connect(this.master); sq.start();

    // wind / road rumble
    const wn = ctx.createBufferSource(); wn.buffer = buf; wn.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wn.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master); wn.start();
    this.lastCrash = 0;
  }

  update(v) {
    if (!this.ctx || !v) return;
    const t = this.ctx.currentTime;
    const on = this.enabled ? 1 : 0;
    const f0 = v.rpm / 60 * 2; // 4 cylinder firing frequency
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f0 * mul, t, 0.02);
    const thr = v.throttleEff || 0;
    this.engFilter.frequency.setTargetAtTime(500 + thr * 1800 + v.rpm * 0.15, t, 0.05);
    this.engGain.gain.setTargetAtTime(on * (0.12 + thr * 0.22), t, 0.05);
    let slip = 0;
    for (const w of v.wheels) if (w.contact && w.surf > 0.95) slip = Math.max(slip, Math.min(1, (w.slip - 1.1) * 0.6));
    slip = Math.max(0, slip) * Math.min(1, v.absSpeed / 4);
    this.sqGain.gain.setTargetAtTime(on * slip * 0.25, t, 0.04);
    this.sqFilter.frequency.setTargetAtTime(900 + slip * 500, t, 0.1);
    const sp = Math.min(1, v.absSpeed / 50);
    this.windGain.gain.setTargetAtTime(on * sp * sp * 0.5, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + sp * 900, t, 0.1);
  }

  crash(strength) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (t - this.lastCrash < 0.08) return;
    this.lastCrash = t;
    const s = Math.min(1, strength);
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.5 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600 + s * 2500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9 * s, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + s * 0.6);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + 1);
    // metallic clang
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 120 + Math.random() * 200;
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.25 * s, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.35);
  }
}
