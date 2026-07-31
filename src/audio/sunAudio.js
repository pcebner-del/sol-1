/**
 * "The sound of the Sun" — an artistic sonic interpretation, not a recording.
 *
 * Nothing here is sampled from NASA data: it is a synthesised bed of sub-bass,
 * a slow harmonic drone and filtered brown noise, shaped to suggest the scale
 * and churn of a star. The AudioContext is only created on a user gesture, so
 * browser autoplay policies are respected by construction.
 */

const FADE = 2.6;

export class SunAudio {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.ready = false;
  }

  _init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    // iOS silences Web Audio whenever the ringer switch is set to silent,
    // unless the page declares that it is playing back media rather than
    // making incidental interface noises. That single line is the difference
    // between a working iPad (no ringer switch) and a silent iPhone. Set it
    // before the context exists so the session is categorised from the start.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // Older Safari: no audio session API, so the ringer switch wins and
      // there is nothing further we can do from here.
    }

    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Gentle safety limiter — the layers sum to more than you'd think.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    comp.connect(this.master);
    this.bus = comp;

    this._buildSub();
    this._buildDrone();
    this._buildRoar();

    this.ready = true;
  }

  /** Two near-unison sines an octave apart: the floor of the whole piece. */
  _buildSub() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.36;
    g.connect(this.bus);

    for (const [freq, level, detune] of [
      [36.71, 1.0, 0],
      [55.0, 0.55, -6],
      [73.42, 0.3, 5],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start();

      // Very slow beating between the partials.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.033 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 5.5;
      lfo.connect(lg).connect(o.detune);
      lfo.start();
    }
    this.subGain = g;
  }

  /** Stacked saw partials through a slowly breathing low-pass. */
  _buildDrone() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;
    filter.Q.value = 5.5;

    const g = ctx.createGain();
    g.gain.value = 0.1;
    filter.connect(g).connect(this.bus);

    for (const [freq, detune] of [
      [110, -7],
      [110, 6],
      [164.81, 4],
      [220, -5],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o.connect(og).connect(filter);
      o.start();
    }

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.021;
    const lg = ctx.createGain();
    lg.gain.value = 105;
    lfo.connect(lg).connect(filter.frequency);
    lfo.start();

    this.droneFilter = filter;
    this.droneGain = g;
  }

  /** Brown noise through a sweeping band-pass: the convective roar. */
  _buildRoar() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.019 * white) / 1.019;
      d[i] = last * 3.6;
    }
    // Cross-fade the seam so the loop doesn't tick.
    const tail = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < tail; i++) {
      const k = i / tail;
      d[i] = d[i] * k + d[len - tail + i] * (1 - k);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 150;
    bp.Q.value = 0.9;

    const g = ctx.createGain();
    g.gain.value = 0.5;

    src.connect(bp).connect(g).connect(this.bus);
    src.start();

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.047;
    const lg = ctx.createGain();
    lg.gain.value = 92;
    lfo.connect(lg).connect(bp.frequency);
    lfo.start();

    this.roarGain = g;
    this.roarFilter = bp;
    this.noiseBuffer = buf;
  }

  /**
   * Synchronous by design: the auto-start listener and the toggle button can
   * both fire within a single tick, and an await between reading and writing
   * `on` would let them both see the old value and cancel each other out.
   */
  toggle() {
    this._init();
    if (!this.ctx) return false;

    // Resume can settle later; the gain ramp doesn't need to wait for it.
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._ramp(!this.on);
    return this.on;
  }

  /**
   * Bring the bed up on a user gesture. Unlike toggle() this is idempotent, so
   * the auto-arm can safely try again: on iOS the first gesture often hands
   * back a context that never leaves `suspended`, and a second tap fixes it.
   *
   * Resolves with whether the context genuinely reached `running`. Until it
   * has, nothing has actually started, however healthy the graph looks.
   */
  async start() {
    this._init();
    if (!this.ctx) return false;

    // Ramp up synchronously, before the first await. If this same gesture also
    // landed on the SOUND toggle, that handler runs in this tick and has to see
    // audio already on so it can turn it straight back off — which is what
    // pressing a control labelled "SOUND ON" is meant to do.
    if (!this.on) this._ramp(true);

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Gesture wasn't accepted. The caller stays armed and retries.
      }
    }
    return this.ctx.state === 'running';
  }

  /**
   * iOS suspends the context when the tab goes to the background and does not
   * resume it on return, so the sound would simply never come back after a
   * call, a lock, or an app switch.
   */
  resumeIfBackgrounded() {
    if (this.on && this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  _ramp(on) {
    this.on = on;

    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), t);
    this.master.gain.linearRampToValueAtTime(on ? 0.5 : 0.0001, t + (on ? FADE : 1.2));

    clearTimeout(this._suspendTimer);
    if (!on) {
      this._suspendTimer = setTimeout(() => {
        if (!this.on && this.ctx?.state === 'running') this.ctx.suspend();
      }, 1500);
    }
  }

  /* ------------------------------------------------------------ one-shots */

  /**
   * Flare eruption: a filtered noise whoosh, a low swell, and a scatter of
   * crackle transients. Deliberately understated — it's a texture under the
   * ambience, not a sound effect on top of it. Routed through the same bus as
   * everything else, so the toggle and master fade govern it.
   */
  flare(intensity = 1) {
    if (!this.on || !this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = Math.min(1.6, Math.max(0.3, intensity));

    // --- whoosh: brown noise swept up then down through a band-pass
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.4;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(120, t);
    bp.frequency.exponentialRampToValueAtTime(240 + 1100 * k, t + 0.28);
    bp.frequency.exponentialRampToValueAtTime(90, t + 2.4 * k);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20 * k, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 * k);

    src.connect(bp).connect(g).connect(this.bus);
    src.start(t);
    src.stop(t + 2.4 * k + 0.2);

    // --- low swell underneath
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.7 * k);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22 * k, t + 0.08);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.9 * k);
    o.connect(og).connect(this.bus);
    o.start(t);
    o.stop(t + 2.1 * k);

    // --- crackle: short high-passed noise ticks scattered over the decay
    const ticks = Math.round(10 + 22 * k);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const cg = ctx.createGain();
    cg.gain.value = 0.055 * k;
    hp.connect(cg).connect(this.bus);

    for (let i = 0; i < ticks; i++) {
      // Front-loaded: the impulsive phase crackles hardest.
      const at = t + Math.pow(Math.random(), 1.9) * 1.9 * k;
      const cs = ctx.createBufferSource();
      cs.buffer = this.noiseBuffer;
      cs.playbackRate.value = 1.4 + Math.random() * 1.6;
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(0.0001, at);
      eg.gain.linearRampToValueAtTime(0.6 + Math.random() * 0.8, at + 0.004);
      eg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05 + Math.random() * 0.09);
      cs.connect(eg).connect(hp);
      cs.start(at, Math.random() * 3);
      cs.stop(at + 0.2);
    }
  }

}
