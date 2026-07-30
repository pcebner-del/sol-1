import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import { FLARE_PRESETS } from '../data.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

/* --------------------------------------------------------- strand shader */

const ARC_VERT = /* glsl */ `
attribute float aSeed;

varying vec2  vUv;
varying float vSeed;
varying vec3  vNormalW;
varying vec3  vWorld;

void main(){
  vUv = uv;
  vSeed = aSeed;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ARC_FRAG = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform float uTime;
uniform float uProgress;    // 0..1, head travelling along the loop
uniform float uEnv;         // impulsive-decay envelope
uniform float uHeat;        // 1 at ignition -> 0 as the plasma cools
uniform float uBrightness;
uniform vec3  uCameraPos;

varying vec2  vUv;
varying float vSeed;
varying vec3  vNormalW;
varying vec3  vWorld;

/**
 * Plasma cooling ramp. Fresh ejecta is white-hot; as it expands and radiates
 * it drops through yellow and orange to a deep chromospheric red.
 */
vec3 coolingRamp(float h){
  h = clamp(h, 0.0, 1.0);
  vec3 c = vec3(0.62, 0.055, 0.020);                       // deep red
  c = mix(c, vec3(1.00, 0.230, 0.040), smoothstep(0.00, 0.32, h));
  c = mix(c, vec3(1.00, 0.520, 0.110), smoothstep(0.28, 0.58, h));
  c = mix(c, vec3(1.00, 0.790, 0.330), smoothstep(0.54, 0.80, h));
  c = mix(c, vec3(1.00, 0.960, 0.860), smoothstep(0.78, 1.00, h));
  return c;
}

void main(){
  float along = vUv.x;
  float around = vUv.y;

  // The head sweeps out along the loop; everything behind it stays lit.
  float head = uProgress * 1.32;
  float mask = 1.0 - smoothstep(head - 0.26, head, along);
  if (mask <= 0.002) discard;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(uCameraPos - vWorld);
  // clamp before pow(): |dot| of two normalised vectors can land a hair
  // above 1.0 in float, and pow() of a negative base is undefined -> NaN.
  float edge = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.9);

  // Each strand is a thin ribbon of plasma; noise along it breaks it into
  // wisps and knots rather than a smooth uniform tube.
  float wisp = turbulence(vec3(along * 16.0, around * 3.0 + vSeed * 9.0, uTime * 1.9 + vSeed * 4.0), 3, 2.1, 0.55);
  float knots = turbulence(vec3(along * 42.0 + vSeed * 20.0, uTime * 2.6, 0.0), 2, 2.0, 0.5);

  // Thicker over the apex, pinched into the footpoints.
  float taper = 0.18 + 0.82 * sin(clamp(along, 0.0, 1.0) * 3.14159);

  float body = mask * taper * (0.42 + 0.80 * edge);
  body *= max(0.0, 0.30 + 1.25 * wisp * (0.55 + 0.75 * knots));
  body = max(body, 0.0);

  // Hot leading edge right at the head of the eruption.
  float front = smoothstep(0.13, 0.0, abs(along - head)) * mask;

  // Material cools both with age and with distance travelled from the surface.
  float heat = clamp(uHeat * (1.0 - 0.45 * sin(along * 3.14159)) + front * 0.9, 0.0, 1.0);
  vec3 col = coolingRamp(heat);

  float amp = uEnv * uBrightness;
  float a = clamp((body + front * 0.8) * amp, 0.0, 1.0);
  // Belt and braces: nothing leaves this shader negative or unbounded, so it
  // can never subtract under additive blending or poison the bloom chain.
  gl_FragColor = vec4(clamp(col * (body + front * 1.4) * amp, 0.0, 32.0), a);
}
`;

/* -------------------------------------------------------- particle shader */

const PART_VERT = /* glsl */ `
attribute vec3  aVel;
attribute float aSeed;
attribute float aSize;
attribute float aLife;

uniform float uAge;
uniform float uGravity;
uniform vec3  uUp;
uniform float uPixelRatio;
uniform float uScale;

varying float vAlpha;
varying float vHeat;

void main(){
  float t = uAge;
  float life = clamp(t / aLife, 0.0, 1.0);

  vec3 p = position + aVel * t - uUp * (0.5 * uGravity * t * t);

  vAlpha = (1.0 - life) * smoothstep(0.0, 0.05, t);
  vHeat = pow(1.0 - life, 1.6);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float ps = aSize * uPixelRatio * uScale * (0.35 + 0.65 * (1.0 - life)) / max(-mv.z, 0.1) * 12.0;
  // A particle drifting close to the near plane would otherwise blow up into a
  // screen-filling sprite.
  gl_PointSize = clamp(ps, 0.0, 96.0);
}
`;

const PART_FRAG = /* glsl */ `
precision mediump float;
uniform float uEnv;
uniform float uHeat;
varying float vAlpha;
varying float vHeat;

vec3 coolingRamp(float h){
  h = clamp(h, 0.0, 1.0);
  vec3 c = vec3(0.62, 0.055, 0.020);
  c = mix(c, vec3(1.00, 0.230, 0.040), smoothstep(0.00, 0.32, h));
  c = mix(c, vec3(1.00, 0.520, 0.110), smoothstep(0.28, 0.58, h));
  c = mix(c, vec3(1.00, 0.790, 0.330), smoothstep(0.54, 0.80, h));
  c = mix(c, vec3(1.00, 0.960, 0.860), smoothstep(0.78, 1.00, h));
  return c;
}

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = exp(-pow(d * 2.5, 2.0));
  float halo = exp(-d * 2.8) * 0.32;
  float a = (core + halo) * vAlpha * uEnv;
  if (a < 0.004) discard;

  // Each ember cools along its own flight, biased by the flare's global heat.
  vec3 col = coolingRamp(min(vHeat * 0.65 + uHeat * 0.5, 1.0));
  gl_FragColor = vec4(col * a * 1.7, a);
}
`;

/* ------------------------------------------------------------ flash sprite */

const FLASH_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLASH_FRAG = /* glsl */ `
precision mediump float;
uniform float uEnv;
uniform float uPeak;   // linear HDR peak — drives the bloom pass hard
varying vec2 vUv;

void main(){
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;

  float core = exp(-pow(r * 6.0, 1.7));
  float glow = exp(-pow(r * 2.1, 1.2)) * 0.42;
  // Diffraction spikes sell it as a genuinely intense point of light.
  float sx = pow(max(0.0, 1.0 - abs(c.y) * 34.0), 2.0) * exp(-abs(c.x) * 4.0);
  float sy = pow(max(0.0, 1.0 - abs(c.x) * 34.0), 2.0) * exp(-abs(c.y) * 4.0);

  float g = (core + glow + (sx + sy) * 0.5) * uEnv;
  if (g < 0.004) discard;

  // White-hot at the centre, cooling outward through gold.
  vec3 col = mix(vec3(1.0, 0.99, 0.96), vec3(1.0, 0.62, 0.20), smoothstep(0.0, 0.7, r));
  gl_FragColor = vec4(col * g * uPeak, clamp(g, 0.0, 1.0));
}
`;

/* ------------------------------------------------------- strand geometry */

const _up = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _pt = new THREE.Vector3();

/**
 * Build the flare body as a bundle of thin twisting strands rather than one
 * fat tube. Each strand follows the same magnetic loop but is offset onto its
 * own helix around it, so the eruption reads as braided filaments of plasma.
 */
function buildStrandGeometry(curve, { strands, segments, radius, twist, spread }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const seeds = [];
  const indices = [];
  const radial = QUALITY.tier === 'low' ? 4 : 6;

  let vertexBase = 0;

  for (let s = 0; s < strands; s++) {
    const phase = (s / strands) * Math.PI * 2 + Math.random() * 0.6;
    const seed = Math.random();
    const wobble = 0.55 + Math.random() * 0.9;
    const strandRadius = radius * (0.45 + Math.random() * 0.85);

    // Offset the base curve onto a helix to get this strand's own path.
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      curve.getPoint(t, _pt);
      curve.getTangent(t, _tan).normalize();

      _up.set(0, 1, 0);
      if (Math.abs(_tan.y) > 0.92) _up.set(1, 0, 0);
      _n1.crossVectors(_tan, _up).normalize();
      _n2.crossVectors(_tan, _n1).normalize();

      // Fatter in the middle of the loop, pinched at both footpoints.
      const bulge = Math.sin(t * Math.PI);
      const off = spread * bulge * wobble;
      const a = phase + twist * t * Math.PI * 2;

      pts.push(
        new THREE.Vector3()
          .copy(_pt)
          .addScaledVector(_n1, Math.cos(a) * off)
          .addScaledVector(_n2, Math.sin(a) * off),
      );
    }

    const strandCurve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(strandCurve, segments, strandRadius, radial, false);

    const gp = geo.attributes.position.array;
    const gn = geo.attributes.normal.array;
    const gu = geo.attributes.uv.array;
    const gi = geo.index.array;

    for (let i = 0; i < gp.length; i++) positions.push(gp[i]);
    for (let i = 0; i < gn.length; i++) normals.push(gn[i]);
    for (let i = 0; i < gu.length; i++) uvs.push(gu[i]);
    for (let i = 0; i < gp.length / 3; i++) seeds.push(seed);
    for (let i = 0; i < gi.length; i++) indices.push(gi[i] + vertexBase);

    vertexBase += gp.length / 3;
    geo.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  out.setIndex(indices);
  return out;
}

/* -------------------------------------------------------------------------- */

class Flare {
  constructor(parent, maxParticles) {
    this.parent = parent;
    this.max = maxParticles;
    this.active = false;

    this.arcMat = new THREE.ShaderMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uEnv: { value: 0 },
        uHeat: { value: 1 },
        uBrightness: { value: 1 },
        uCameraPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.arc = new THREE.Mesh(new THREE.BufferGeometry(), this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 6;
    this.arc.visible = false;
    parent.add(this.arc);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(maxParticles), 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(maxParticles), 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(maxParticles), 1));
    geo.setDrawRange(0, 0);

    this.partMat = new THREE.ShaderMaterial({
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      uniforms: {
        uAge: { value: 0 },
        uGravity: { value: 0.6 },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uPixelRatio: { value: QUALITY.devicePixelRatio },
        uScale: { value: 1 },
        uEnv: { value: 0 },
        uHeat: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.partMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.visible = false;
    parent.add(this.points);

    this.flashMat = new THREE.ShaderMaterial({
      vertexShader: FLASH_VERT,
      fragmentShader: FLASH_FRAG,
      uniforms: { uEnv: { value: 0 }, uPeak: { value: 3 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat);
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 8;
    this.flash.visible = false;
    parent.add(this.flash);
  }

  trigger(preset, camera) {
    const { scale, height, duration, brightness, particles, strands, twist, flashPeak } = preset;

    // Footpoint on the visible limb, nudged toward the camera so the loop
    // reads in silhouette against space.
    const camDir = camera.position.clone().normalize();
    const worldUp = Math.abs(camDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(camDir, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, camDir).normalize();

    const ang = Math.random() * Math.PI * 2;
    const towardCam = 0.12 + Math.random() * 0.34;
    const ring = Math.sqrt(1 - towardCam * towardCam);
    const n1 = right
      .clone()
      .multiplyScalar(Math.cos(ang) * ring)
      .add(up.clone().multiplyScalar(Math.sin(ang) * ring))
      .add(camDir.clone().multiplyScalar(towardCam))
      .normalize();

    const tangent = new THREE.Vector3().crossVectors(n1, camDir).normalize();
    const sep = (0.34 + Math.random() * 0.26) * (0.75 + scale * 0.5);
    const n2 = n1.clone().add(tangent.clone().multiplyScalar(sep)).normalize();

    const splay = new THREE.Vector3().subVectors(n2, n1).normalize();
    const p0 = n1.clone().multiplyScalar(0.985);
    const p1 = n2.clone().multiplyScalar(0.985);
    const c0 = n1
      .clone()
      .multiplyScalar(1 + height * 1.05)
      .addScaledVector(splay, -height * 0.42);
    const c1 = n2
      .clone()
      .multiplyScalar(1 + height * 1.05)
      .addScaledVector(splay, height * 0.42);
    const curve = new THREE.CubicBezierCurve3(p0, c0, c1, p1);

    const segments = Math.max(24, Math.round(QUALITY.flareTubeSegments * (0.5 + scale * 0.4)));
    const strandCount = Math.max(2, Math.round(strands * (QUALITY.tier === 'low' ? 0.5 : 1)));

    this.arc.geometry.dispose();
    this.arc.geometry = buildStrandGeometry(curve, {
      strands: strandCount,
      segments,
      radius: 0.010 + 0.014 * scale,
      twist,
      spread: 0.030 + 0.055 * scale,
    });

    this.arcMat.uniforms.uBrightness.value = brightness;
    this.arcMat.uniforms.uProgress.value = 0;
    this.arcMat.uniforms.uEnv.value = 0;
    this.arcMat.uniforms.uHeat.value = 1;

    // --- particle spray from the footpoint region
    const count = Math.min(this.max, Math.round(QUALITY.flareParticles * particles * 0.45));
    const g = this.points.geometry;
    const pos = g.attributes.position.array;
    const vel = g.attributes.aVel.array;
    const seed = g.attributes.aSeed.array;
    const size = g.attributes.aSize.array;
    const life = g.attributes.aLife.array;

    for (let i = 0; i < count; i++) {
      const base = n1.clone().lerp(n2, Math.random()).normalize();
      const start = base
        .clone()
        .add(right.clone().multiplyScalar((Math.random() - 0.5) * 0.1))
        .add(up.clone().multiplyScalar((Math.random() - 0.5) * 0.1))
        .normalize()
        .multiplyScalar(1.0 + Math.random() * 0.02);

      pos[i * 3] = start.x;
      pos[i * 3 + 1] = start.y;
      pos[i * 3 + 2] = start.z;

      const speed = (0.22 + Math.random() * 0.55) * (0.55 + height * 0.85);
      const spread = 0.3 + Math.random() * 0.45;
      const v = base
        .clone()
        .multiplyScalar(speed)
        .add(tangent.clone().multiplyScalar((Math.random() - 0.5) * spread * speed))
        .add(up.clone().multiplyScalar((Math.random() - 0.5) * spread * speed));

      vel[i * 3] = v.x;
      vel[i * 3 + 1] = v.y;
      vel[i * 3 + 2] = v.z;

      seed[i] = Math.random();
      size[i] = (0.7 + Math.random() * 1.9) * (0.7 + scale * 0.7);
      life[i] = duration * (0.35 + Math.random() * 0.65);
    }

    for (const k of ['position', 'aVel', 'aSeed', 'aSize', 'aLife']) g.attributes[k].needsUpdate = true;
    g.setDrawRange(0, count);

    this.partMat.uniforms.uUp.value.copy(n1);
    this.partMat.uniforms.uGravity.value = 0.3 + 0.22 / Math.max(height, 0.3);
    this.partMat.uniforms.uAge.value = 0;
    this.partMat.uniforms.uEnv.value = 0;

    this.flash.position.copy(n1).multiplyScalar(1.02);
    this.flashMat.uniforms.uPeak.value = flashPeak;
    this.flashScale = 0.8 + scale * 2.2;

    this.age = 0;
    this.duration = duration;
    this.footpoint = n1.clone();
    this.active = true;
    this.arc.visible = true;
    this.points.visible = true;
    this.flash.visible = true;
  }

  update(dt, time, camera, camWorld) {
    if (!this.active) return;
    this.age += dt;
    const t = this.age / this.duration;

    if (t >= 1) {
      this.active = false;
      this.arc.visible = false;
      this.points.visible = false;
      this.flash.visible = false;
      return;
    }

    // Impulsive phase: a near-instant rise, then a long exponential decay —
    // the shape of a real flare's light curve, not a linear ramp.
    const rise = 1 - Math.exp(-this.age / (this.duration * 0.035));
    const decay = Math.exp(-this.age / (this.duration * 0.42));
    const env = rise * decay;

    // The plasma cools monotonically from ignition.
    const heat = Math.exp(-this.age / (this.duration * 0.30));

    this.arcMat.uniforms.uProgress.value = Math.min(1, Math.pow(t / 0.40, 0.75));
    this.arcMat.uniforms.uEnv.value = env;
    this.arcMat.uniforms.uHeat.value = heat;
    this.arcMat.uniforms.uTime.value = time;
    this.arcMat.uniforms.uCameraPos.value.copy(camWorld);

    this.partMat.uniforms.uAge.value = this.age;
    this.partMat.uniforms.uEnv.value = env;
    this.partMat.uniforms.uHeat.value = heat;

    // The ignition flash is far sharper than the body of the flare.
    const fl = Math.exp(-this.age / (this.duration * 0.055));
    this.flashMat.uniforms.uEnv.value = fl;
    this.flash.scale.setScalar(this.flashScale * (0.30 + 0.85 * (1 - fl)));
    this.flash.quaternion.copy(camera.quaternion);
  }
}

export class FlareSystem {
  constructor(sun) {
    this.sun = sun;
    this.group = new THREE.Group();
    sun.group.add(this.group);

    const poolSize = QUALITY.tier === 'low' ? 2 : 4;
    const maxParticles = Math.round(QUALITY.flareParticles * 1.6);
    this.pool = Array.from({ length: poolSize }, () => new Flare(this.group, maxParticles));
    this._camWorld = new THREE.Vector3();
  }

  trigger(kind, camera) {
    const preset = FLARE_PRESETS[kind];
    if (!preset) return null;
    const flare = this.pool.find((f) => !f.active) ?? this.pool[0];
    flare.trigger(preset, camera);
    this.sun.pulse(0.3 + preset.brightness * 0.16);
    if (preset.shockwave > 0.001) this.sun.disturb(flare.footpoint, preset.shockwave);
    return preset;
  }

  setVisible(v) {
    this.group.visible = v;
    if (!v) for (const f of this.pool) f.active = false;
  }

  update(dt, time, camera) {
    if (!this.group.visible) return;
    camera.getWorldPosition(this._camWorld);
    for (const f of this.pool) f.update(dt, time, camera, this._camWorld);
  }
}
