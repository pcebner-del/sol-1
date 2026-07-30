import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import { PLANET_VERT, PLANET_FRAG } from '../shaders/planet.glsl.js';

/**
 * A faint dust/vapour trail streaming behind the body.
 *
 * Stylised: Ceres does outgas water vapour, but not as a persistent visible
 * tail. It reads here as a motion cue that makes the asteroid findable in a
 * wide shot.
 */
const TRAIL_VERT = /* glsl */ `
attribute float aAge;      // 0 at the head, 1 at the tail
attribute float aSeed;

uniform float uPixelRatio;
uniform float uOpacity;

varying float vFade;
varying float vSeed;

void main(){
  vFade = pow(1.0 - aAge, 1.7) * uOpacity;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Clamped: a sprite near the near plane would otherwise be sized in the
  // thousands of pixels, past the driver's point-size limit (511 here), where
  // behaviour is undefined.
  float ps = (1.0 + 5.5 * aAge) * uPixelRatio / max(-mv.z, 0.1) * 9.0;
  gl_PointSize = clamp(ps, 0.0, 96.0);
}
`;

const TRAIL_FRAG = /* glsl */ `
precision mediump float;
varying float vFade;
varying float vSeed;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float a = exp(-pow(d * 2.2, 2.0)) * vFade;
  if (a < 0.004) discard;
  vec3 col = mix(vec3(0.72, 0.80, 0.92), vec3(0.42, 0.55, 0.78), vSeed);
  gl_FragColor = vec4(col * a * 1.3, a);
}
`;

const TRAIL_LEN = QUALITY.tier === 'low' ? 140 : 340;

export class Asteroid {
  constructor(data, bodyGeo) {
    this.data = data;
    this.group = new THREE.Group();

    // Its own inclined, slightly eccentric orbital plane — the belt isn't
    // perfectly coplanar with the ecliptic.
    this.pivot = new THREE.Group();
    this.pivot.rotation.y = Math.random() * Math.PI * 2;
    this.pivot.rotation.x = data.inclination;
    this.group.add(this.pivot);

    this.holder = new THREE.Group();
    this.holder.position.x = data.orbit;
    this.pivot.add(this.holder);

    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      defines: { TYPE_ROCKY: '', PLANET_DETAIL: QUALITY.planetDetail },
      uniforms: {
        uColorA: { value: new THREE.Color(data.color) },
        uColorB: { value: new THREE.Color(data.color2) },
        uSeed: { value: 21.7 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uBump: { value: 2.2 },
        uCraters: { value: 1.0 },
        uRough: { value: 1.0 },
        uCaps: { value: 0 },
        uBandFreq: { value: 18 },
        uBandWarp: { value: 0 },
        uStorm: { value: 0 },
        uIcy: { value: data.icy },
      },
      transparent: true,
      depthWrite: true,
    });
    this.mat = mat;

    this.mesh = new THREE.Mesh(bodyGeo, mat);
    // Ceres is nearly round; a slight squash gives it character without
    // pretending it's a potato-shaped small body.
    this.mesh.scale.set(data.radius, data.radius * 0.94, data.radius * 1.03);
    this.mesh.userData.asteroid = true;
    this.holder.add(this.mesh);

    this._buildTrail();

    // Orbit trace.
    const pts = [];
    const n = QUALITY.tier === 'low' ? 96 : 200;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * data.orbit, 0, Math.sin(a) * data.orbit));
    }
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0xbfd8f0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.pivot.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.lineMat));

    this._world = new THREE.Vector3();
    this._camWorld = new THREE.Vector3();
    this._head = 0;
    this._filled = 0;
    this._emitAccum = 0;
  }

  /**
   * The trail lives in world space, not parented to the body — otherwise it
   * would orbit along with it and never actually trail.
   */
  _buildTrail() {
    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_LEN * 3);
    this.trailAge = new Float32Array(TRAIL_LEN);
    const seeds = new Float32Array(TRAIL_LEN);
    for (let i = 0; i < TRAIL_LEN; i++) {
      seeds[i] = Math.random();
      this.trailAge[i] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setDrawRange(0, 0);

    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uPixelRatio: { value: QUALITY.devicePixelRatio },
        uOpacity: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = new THREE.Points(geo, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 3;
    this.group.add(this.trail);
  }

  setOpacity(v) {
    this.group.visible = v > 0.005;
    this.mat.uniforms.uOpacity.value = v;
    this.trailMat.uniforms.uOpacity.value = v * 0.8;
    this.lineMat.opacity = v * 0.14;
  }

  worldPosition(out) {
    return this.mesh.getWorldPosition(out);
  }

  update(dt, time, camera) {
    if (!this.group.visible) return;
    camera.getWorldPosition(this._camWorld);

    this.pivot.rotation.y += dt * this.data.rate;
    this.mesh.rotation.y += dt * 0.55;

    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCameraPos.value.copy(this._camWorld);

    // Age every existing particle, then push a fresh one at the head.
    const fade = dt / 5.5;
    for (let i = 0; i < this._filled; i++) this.trailAge[i] = Math.min(1, this.trailAge[i] + fade);

    this._emitAccum += dt;
    const step = 0.018;
    while (this._emitAccum >= step) {
      this._emitAccum -= step;
      this.worldPosition(this._world);
      const jitter = this.data.radius * 0.85;
      const i = this._head;
      this.trailPos[i * 3] = this._world.x + (Math.random() - 0.5) * jitter;
      this.trailPos[i * 3 + 1] = this._world.y + (Math.random() - 0.5) * jitter;
      this.trailPos[i * 3 + 2] = this._world.z + (Math.random() - 0.5) * jitter;
      this.trailAge[i] = 0;
      this._head = (this._head + 1) % TRAIL_LEN;
      this._filled = Math.min(TRAIL_LEN, this._filled + 1);
    }

    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aAge.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this._filled);
  }
}
