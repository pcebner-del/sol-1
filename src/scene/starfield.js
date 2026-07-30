import * as THREE from 'three';
import { QUALITY } from '../quality.js';

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3  aColor;

uniform float uTime;
uniform float uPixelRatio;
uniform float uScale;

varying float vTw;
varying vec3  vCol;

void main(){
  vCol = aColor;
  float speed = 0.45 + fract(aPhase * 1.7) * 1.6;
  float tw = 0.62 + 0.38 * sin(uTime * speed + aPhase * 6.2831);
  vTw = tw;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * uScale * (0.85 + 0.35 * tw);
}
`;

const STAR_FRAG = /* glsl */ `
precision mediump float;
varying float vTw;
varying vec3  vCol;
uniform float uOpacity;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = exp(-pow(d * 2.7, 2.0));
  float glow = exp(-d * 3.0) * 0.30;
  float a = (core + glow) * vTw * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a * 1.7, a);
}
`;

// Rough stellar colour temperatures, weighted toward the cool end.
const STAR_COLORS = [
  [0.62, 0.72, 1.0], // O/B blue
  [0.78, 0.85, 1.0],
  [1.0, 1.0, 1.0], // A/F white
  [1.0, 0.97, 0.88],
  [1.0, 0.9, 0.72], // G/K
  [1.0, 0.78, 0.58],
  [1.0, 0.66, 0.48], // M red
];

export class Starfield {
  constructor() {
    this.group = new THREE.Group();
    this.layers = [];
    this._sph = new THREE.Spherical();

    const layerCount = QUALITY.starLayers;
    const total = QUALITY.starCount;

    for (let i = 0; i < layerCount; i++) {
      const frac = layerCount === 1 ? 1 : [0.45, 0.33, 0.22][i] ?? 1 / layerCount;
      const count = Math.max(120, Math.round(total * frac));
      const radius = 320 + i * 130;
      const parallax = i * 0.055; // near layers swing more when you drag
      this.layers.push(this._makeLayer(count, radius, parallax, 1 - i * 0.18));
    }
  }

  _makeLayer(count, radius, parallax, brightness) {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const color = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // A quarter of the stars hug a tilted band — a whisper of the galactic plane.
      const inBand = Math.random() < 0.26;
      let u = Math.random() * 2 - 1;
      if (inBand) u = (Math.random() - 0.5) * 0.22;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);

      let x = s * Math.cos(theta);
      let y = u;
      let z = s * Math.sin(theta);

      if (inBand) {
        // tilt the band so it crosses the frame diagonally
        const a = 0.52;
        const y2 = y * Math.cos(a) - z * Math.sin(a);
        const z2 = y * Math.sin(a) + z * Math.cos(a);
        y = y2;
        z = z2;
      }

      const r = radius * (0.88 + Math.random() * 0.24);
      pos[i * 3] = x * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = z * r;

      // Mostly faint pinpricks, a handful of bright anchors.
      const roll = Math.random();
      const mag = roll > 0.985 ? 3.4 + Math.random() * 2.6 : roll > 0.9 ? 1.7 + Math.random() * 1.1 : 0.7 + Math.random() * 0.85;
      size[i] = mag * (inBand ? 0.72 : 1.0);
      phase[i] = Math.random();

      const c = STAR_COLORS[Math.floor(Math.pow(Math.random(), 1.6) * STAR_COLORS.length)] ?? STAR_COLORS[2];
      const dim = (inBand ? 0.55 : 1.0) * brightness;
      color[i * 3] = c[0] * dim;
      color[i * 3 + 1] = c[1] * dim;
      color[i * 3 + 2] = c[2] * dim;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: QUALITY.devicePixelRatio },
        uScale: { value: 1.35 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = -10;

    const g = new THREE.Group();
    g.add(points);
    g.userData.parallax = parallax;
    this.group.add(g);
    return { group: g, mat, points };
  }

  setOpacity(v) {
    for (const l of this.layers) l.mat.uniforms.uOpacity.value = v;
  }

  update(dt, time, camera) {
    this._sph.setFromVector3(camera.position);
    const az = this._sph.theta;
    const el = this._sph.phi - Math.PI / 2;

    for (const l of this.layers) {
      const k = l.group.userData.parallax;
      // Ease toward the target so the parallax lags the camera slightly.
      l.group.rotation.y += (az * k - l.group.rotation.y) * Math.min(1, dt * 3.2);
      l.group.rotation.x += (el * k * 0.6 - l.group.rotation.x) * Math.min(1, dt * 3.2);
      l.mat.uniforms.uTime.value = time;
    }
  }
}
