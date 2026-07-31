import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { QUALITY, degrade } from './quality.js';
import { Sun } from './scene/sun.js';
import { Starfield } from './scene/starfield.js';

const _trackScratch = new THREE.Vector3();

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.modules = [];
    this.listeners = {};

    this._initRenderer();
    this._initScene();
    this._initControls();
    this._initComposer();

    this.tween = null;
    // True while a scripted move (a tween, or a locked shot like totality)
    // owns the camera. See frame() for why this can't just disable the controls.
    this.camLocked = false;
    this._frames = 0;
    this._fpsAccum = 0;
    this._degradeChecked = false;

    // Observing the canvas catches every reason its box can change — URL bar,
    // orientation, split view — including the ones that never fire a window
    // resize event.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.canvas);
    }
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
    this.resize(true);
  }

  /* ---------------------------------------------------------------- setup */

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: QUALITY.tier !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(QUALITY.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.localClippingEnabled = true;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 4000);
    this.camera.position.set(0.9, 0.75, 4.3);

    this.starfield = new Starfield();
    this.scene.add(this.starfield.group);
    this.modules.push(this.starfield);

    this.sun = new Sun();
    this.scene.add(this.sun.group);
    this.modules.push(this.sun);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.045;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.75;
    this.controls.panSpeed = 0.5;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.35;
    this.controls.maxDistance = 12;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.16;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    // Any manual input cancels an in-flight camera move.
    const cancel = () => {
      if (this.tween) this._endTween(false);
      this._nudgeAutoRotate();
    };
    this.canvas.addEventListener('pointerdown', cancel);
    this.canvas.addEventListener('wheel', cancel, { passive: true });
  }

  _initComposer() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const res = new THREE.Vector2(
      Math.max(64, size.x * QUALITY.bloomResolution),
      Math.max(64, size.y * QUALITY.bloomResolution),
    );
    this.bloom = new UnrealBloomPass(res, QUALITY.bloom.strength, QUALITY.bloom.radius, QUALITY.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /* ------------------------------------------------------------ camera fly */

  flyTo({ position, target, duration = 2.4, ease = easeInOutCubic, onDone = null }) {
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: (target || new THREE.Vector3()).clone(),
      t: 0,
      duration: QUALITY.reducedMotion ? Math.min(duration, 0.4) : duration,
      ease,
      onDone,
    };
    this.controls.enabled = false;
    // Widen the leash while we travel so the tween is never clamped mid-flight.
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 4000;
  }

  /**
   * Fly to a *moving* target.
   *
   * A fixed destination is wrong for anything in orbit: Earth travels more
   * than a frame's width during a three-second flight. Re-evaluating the
   * destination every frame lands the camera where the body actually is on
   * arrival.
   *
   * `rotateFrame` additionally carries the camera round with a heliocentric
   * orbit, so the sun stays put relative to the body.
   */
  flyToTracked({ trackFn, offset, duration = 2.4, ease = easeInOutCubic, rotateFrame = true, lookAt = null, targetOffset = null, onDone = null }) {
    const cur = new THREE.Vector3();
    trackFn(cur);
    this.tween = {
      tracked: true,
      trackFn,
      offset: offset.clone(),
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: cur.clone().add(offset),
      toTarget: (lookAt ?? cur).clone(),
      lookAt: lookAt ? lookAt.clone() : null,
      // Aims a fixed distance off the tracked body rather than straight at it,
      // so the body can be framed away from screen furniture. Tracked, unlike
      // lookAt, so it stays correct while the body moves along its orbit.
      targetOffset: targetOffset ? targetOffset.clone() : null,
      rotateFrame,
      t: 0,
      duration: QUALITY.reducedMotion ? Math.min(duration, 0.4) : duration,
      ease,
      onDone,
    };
    this.controls.enabled = false;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 4000;
  }

  /**
   * Hand the camera to a scripted writer (or give it back).
   *
   * Used for shots that must hold exactly still — the controls would otherwise
   * keep nudging them, since their update() ignores `enabled`.
   */
  lockCamera(v) {
    this.camLocked = v;
    this.controls.enabled = !v; // this *does* gate input handlers
    if (!v) this._nudgeAutoRotate();
  }

  _endTween(completed) {
    const done = this.tween?.onDone;
    this.tween = null;

    // Restore the leash however the move ended. flyTo widens it so a flight is
    // never clamped mid-air, and this used to be undone only when a tween ran
    // to completion — but any touch cancels a tween, so grabbing the view
    // during the three-second fly-out left minDistance 0.01 / maxDistance 4000
    // in place for good. You could then pull back until the whole solar system
    // was fourteen pixels wide.
    if (this._limits) {
      this.controls.minDistance = this._limits.min;
      this.controls.maxDistance = this._limits.max;
    }

    if (!this.camLocked) this.controls.enabled = true;
    // Don't let auto-rotate snap straight back on the frame we land.
    this._nudgeAutoRotate();
    if (completed && done) done();
  }

  setDistanceLimits(min, max) {
    this._limits = { min, max };
    if (!this.tween) {
      this.controls.minDistance = min;
      this.controls.maxDistance = max;
    }
  }

  _nudgeAutoRotate() {
    this.controls.autoRotate = false;
    clearTimeout(this._autoRotateTimer);
    this._autoRotateTimer = setTimeout(() => {
      this.controls.autoRotate = true;
    }, 9000);
  }

  /* ---------------------------------------------------------------- events */

  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }

  emit(evt, payload) {
    for (const fn of this.listeners[evt] || []) fn(payload);
  }

  /* ----------------------------------------------------------------- frame */

  /**
   * Measure the canvas, not the window.
   *
   * The canvas is sized entirely by CSS — 100% of an element that is 100dvh
   * tall — and setSize() is called with updateStyle false, so JS never writes
   * the canvas box. This used to read window.innerHeight instead, and on iOS
   * those two disagree: dvh and innerHeight settle at different moments as the
   * URL bar collapses and across an orientation change. Whenever they differ,
   * the camera is set up for one shape while the canvas is another, and every
   * sphere in the scene renders as an egg. Reading the element removes the
   * question — the aspect is the canvas aspect by construction.
   */
  resize(force = false) {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (!force && w === this._sizeW && h === this._sizeH) return;
    this._sizeW = w;
    this._sizeH = h;

    this.renderer.setPixelRatio(QUALITY.devicePixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    if (this.bloom) {
      // Setting `.resolution` does nothing — UnrealBloomPass sizes its mip
      // chain from the arguments to setSize() and never reads that field, so
      // the quality knob was silently inert. Resize the pass itself, after
      // composer.setSize has already called it with the full size.
      //
      // In *device* pixels. The composer works in device pixels, so passing
      // CSS pixels quietly quartered the bloom's linear resolution (the pass
      // halves again internally): a 2880x1720 buffer was blurred through a
      // 720x430 chain. A bright point then covered well under one texel, and
      // bilinearly upsampling a sub-texel source produces a tent — a
      // soft-edged square with a hot middle. That is the box that kept
      // appearing around bright stars. Cheap in absolute terms: on a phone
      // this takes the first mip from 146x316 to 292x633.
      const pr = this.renderer.getPixelRatio();
      this.bloom.setSize(
        Math.max(64, Math.round(w * pr * QUALITY.bloomResolution)),
        Math.max(64, Math.round(h * pr * QUALITY.bloomResolution)),
      );
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.emit('resize', { w, h });
  }

  start() {
    const loop = () => {
      this.frameId = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    /**
     * Camera ownership.
     *
     * OrbitControls.update() ignores `enabled` completely — there is not one
     * reference to it in the method. Every call re-derives the camera from its
     * own spherical state, folds in autoRotate and any leftover damping, then
     * unconditionally rewrites position and calls lookAt(target). So it cannot
     * be "switched off" for a scripted move; it can only be made to lose.
     *
     * Hence: controls run first, the script writes last, and autoRotate is
     * suppressed while a script owns the camera so nothing is competing for
     * the same transform. This was the shared cause of the fly-to shake and
     * the totality jitter.
     */
    const scripted = this.tween !== null || this.camLocked;
    if (scripted) this.controls.autoRotate = false;

    this.controls.update();

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const e = tw.ease(tw.t);
      if (tw.tracked) {
        tw.trackFn(_trackScratch);
        if (!tw.lookAt) {
          tw.toTarget.copy(_trackScratch);
          if (tw.targetOffset) tw.toTarget.add(tw.targetOffset);
        }
        tw.toPos.copy(_trackScratch).add(tw.offset);
      }
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (tw.t >= 1) this._endTween(true);
    }

    // Modules run after the controls, so trackers and the totality lock also
    // write last and are never overridden.
    for (const m of this.modules) m.update(dt, this.time, this.camera, this);

    // Orientation has exactly one writer, and it runs after every position
    // writer — so the camera can never be aimed from where it used to be.
    this.camera.lookAt(this.controls.target);

    this.composer.render();
    this._watchPerf(dt);
  }

  /** One-shot quality drop if the first few seconds are clearly too heavy. */
  _watchPerf(dt) {
    if (this._degradeChecked) return;
    this._frames++;
    this._fpsAccum += dt;
    if (this._fpsAccum > 4) {
      const fps = this._frames / this._fpsAccum;
      if (fps < 26 && degrade()) {
        this.renderer.setPixelRatio(QUALITY.devicePixelRatio);
        this.sun.applyQuality();
        this.bloom.strength = QUALITY.bloom.strength;
        this.bloom.radius = QUALITY.bloom.radius;
        this.bloom.threshold = QUALITY.bloom.threshold;
        this.resize(true);
        this.emit('quality', QUALITY.tier);
      }
      this._degradeChecked = true;
    }
  }
}

export { easeInOutCubic, easeOutQuint };
