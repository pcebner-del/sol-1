import * as THREE from 'three';
import { LAYERS } from '../data.js';
import { QUALITY } from '../quality.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

const WEDGE_HALF_ANGLE = THREE.MathUtils.degToRad(46);

/* ------------------------------------------------------- interior shells */

const LAYER_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>

varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldPos;

void main(){
  vObj = normalize(position);
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const LAYER_FRAG = /* glsl */ `
precision highp float;

#include <clipping_planes_pars_fragment>

${NOISE_GLSL}

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uTime;
uniform float uScaleN;    // noise frequency
uniform float uFlow;      // how fast the texture churns
uniform float uEmissive;
uniform float uOpacity;
uniform float uHighlight;
uniform vec3  uCameraPos;

varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldPos;

void main(){
  #include <clipping_planes_fragment>

  vec3 p = normalize(vObj);
  float t = uTime * uFlow;

  float n = fbm(p * uScaleN + vec3(0.0, t * 0.25, 0.0), 5, 2.05, 0.55);
  float rough = turbulence(p * uScaleN * 3.4 + vec3(t * 0.4, 0.0, 0.0), 3, 2.1, 0.5) - 0.7;

  vec3 base = mix(uColorA, uColorB, clamp(0.5 + n * 1.5 + rough * 0.8, 0.0, 1.0));

  // Headlight shading so the concave inner faces still read as curved.
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(uCameraPos - vWorldPos);
  float d = abs(dot(N, V));
  float shade = 0.30 + 0.85 * d;

  vec3 col = base * shade * uEmissive;
  col += base * uHighlight * 0.55;

  gl_FragColor = vec4(col, uOpacity);
}
`;

/* ------------------------------------------------------------- cut faces */

const FACE_VERT = /* glsl */ `
varying vec2 vP;
void main(){
  vP = position.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const FACE_FRAG = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform float uTime;
uniform float uOpacity;
uniform vec3  uCore;
uniform vec3  uRad;
uniform vec3  uConv;
uniform vec3  uPhoto;
uniform float uHighlightR0;
uniform float uHighlightR1;

varying vec2 vP;

void main(){
  float r = length(vP);
  if (r > 1.0) discard;

  float t = uTime;
  float ang = atan(vP.y, vP.x);

  // Per-zone texture: smooth radial streaming in the radiative zone, big
  // rolling cells in the convective zone.
  float radial = turbulence(vec3(r * 26.0, ang * 2.4, t * 0.05), 3, 2.1, 0.5);
  float cellsN = fbm(vec3(cos(ang) * 7.0, sin(ang) * 7.0, r * 9.0 - t * 0.12), 4, 2.05, 0.55);
  float grain = fbm(vec3(vP * 40.0, t * 0.1), 3, 2.0, 0.5);

  vec3 col = uCore * (1.05 + 0.30 * grain);
  col = mix(col, uRad * (0.80 + 0.45 * radial), smoothstep(0.235, 0.265, r));
  col = mix(col, uConv * (0.70 + 0.70 * (0.5 + cellsN)), smoothstep(0.685, 0.715, r));
  col = mix(col, uPhoto * (0.85 + 0.40 * grain), smoothstep(0.975, 0.992, r));

  // Temperature falls off outward — the core should visibly blaze.
  float heat = mix(1.05, 0.34, smoothstep(0.0, 0.72, r));
  col *= heat;

  // Bright hairlines at every boundary.
  float rings =
      exp(-pow((r - 0.25) * 190.0, 2.0)) +
      exp(-pow((r - 0.70) * 190.0, 2.0)) +
      exp(-pow((r - 1.00) * 240.0, 2.0));
  col += vec3(1.0, 0.93, 0.78) * rings * 0.45;

  // Highlight band for the layer under the cursor.
  float hl = step(uHighlightR0, r) * step(r, uHighlightR1);
  col += col * hl * 0.60;

  float edge = smoothstep(1.0, 0.985, r);
  gl_FragColor = vec4(col * edge, uOpacity * edge);
}
`;

/* -------------------------------------------------------------------------- */

export class Cutaway {
  constructor(sun) {
    this.sun = sun;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.open = 0; // 0 closed, 1 fully open
    this.target = 0;
    this.centerAngle = 0;
    this.highlight = null;

    // Two world-space planes whose normals swing apart to carve the wedge.
    this.planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)];

    this._camWorld = new THREE.Vector3();
    this._buildShells();
    this._buildFaces();
  }

  /* ------------------------------------------------------------- building */

  _buildShells() {
    const seg = QUALITY.layerSegments;
    const specs = [
      { id: 'core', r: 0.25, a: 0xfff0c4, b: 0xffc24a, scale: 3.0, flow: 0.9, emissive: 1.15 },
      { id: 'radiative', r: 0.7, a: 0xff9c34, b: 0xd85c12, scale: 2.2, flow: 0.35, emissive: 0.62 },
      { id: 'convective', r: 0.998, a: 0xd9491a, b: 0x8e2606, scale: 4.5, flow: 0.6, emissive: 0.52 },
    ];

    this.shells = specs.map((s) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: LAYER_VERT,
        fragmentShader: LAYER_FRAG,
        uniforms: {
          uColorA: { value: new THREE.Color(s.a) },
          uColorB: { value: new THREE.Color(s.b) },
          uTime: { value: 0 },
          uScaleN: { value: s.scale },
          uFlow: { value: s.flow },
          uEmissive: { value: s.emissive },
          uOpacity: { value: 1 },
          uHighlight: { value: 0 },
          uCameraPos: { value: new THREE.Vector3() },
        },
        side: THREE.DoubleSide,
        clipping: true,
        clippingPlanes: this.planes,
        clipIntersection: true,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(s.r, seg, Math.round(seg / 2)), mat);
      mesh.userData.layerId = s.id;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      return { ...s, mesh, mat };
    });
  }

  _buildFaces() {
    const seg = QUALITY.tier === 'low' ? 64 : 160;
    const geo = new THREE.CircleGeometry(1, seg, -Math.PI / 2, Math.PI);

    const mkMat = () =>
      new THREE.ShaderMaterial({
        vertexShader: FACE_VERT,
        fragmentShader: FACE_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uCore: { value: new THREE.Color(0xfff0bc) },
          uRad: { value: new THREE.Color(0xff9526) },
          uConv: { value: new THREE.Color(0xd8441a) },
          uPhoto: { value: new THREE.Color(0xffbe62) },
          uHighlightR0: { value: 9 },
          uHighlightR1: { value: 9 },
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
      });

    this.faceMats = [mkMat(), mkMat()];
    this.faces = this.faceMats.map((mat) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      m.userData.isFace = true;
      this.group.add(m);
      return m;
    });
  }

  /* -------------------------------------------------------------- control */

  enter(camera) {
    // Offset the opening from the view axis so the leading cut face is turned
    // toward the viewer — you see the banded slice *and* into the cavity,
    // rather than staring edge-on at both walls.
    const az = Math.atan2(camera.position.x, camera.position.z);
    this.centerAngle = az - 0.42;
    this.group.visible = true;
    this.target = 1;
    this.sun.setClippingPlanes(this.planes);
  }

  exit() {
    this.target = 0;
  }

  get isOpen() {
    return this.open > 0.02;
  }

  /* -------------------------------------------------------------- highlight */


  setHighlight(layer) {
    this.highlight = layer;
    for (const s of this.shells) {
      s.mat.uniforms.uHighlight.value = layer && layer.id === s.id ? 1 : 0;
    }
    for (const m of this.faceMats) {
      m.uniforms.uHighlightR0.value = layer ? layer.vr0 : 9;
      m.uniforms.uHighlightR1.value = layer ? Math.min(layer.vr1, 1.0) : 9;
    }
  }

  /**
   * Anchor point for a layer's label: sits on the leading cut face at the
   * layer's mid-radius, fanned vertically so the six labels never collide.
   */
  layerAnchor(id, out) {
    const idx = LAYERS.findIndex((l) => l.id === id);
    const l = LAYERS[idx];
    const mid = (l.vr0 + l.vr1) * 0.5;
    // Fan the six labels across the face; inner layers get the widest angles
    // because their small radius gives them so little room to move.
    const elev = -1.15 + idx * 0.46;
    const a = this.centerAngle - WEDGE_HALF_ANGLE * this.open;

    const horiz = Math.cos(elev) * mid;
    out.set(Math.sin(a) * horiz, Math.sin(elev) * mid, Math.cos(a) * horiz);
    return out;
  }

  /**
   * Anchor for the sunspot callout: on the intact hemisphere, well round from
   * the cut, at the active-latitude band where spots actually form.
   */
  sunspotAnchor(out) {
    const a = this.centerAngle + 1.52;
    const elev = 0.30;
    const h = Math.cos(elev) * 1.03;
    out.set(Math.sin(a) * h, Math.sin(elev) * 1.03, Math.cos(a) * h);
    return out;
  }

  /* ----------------------------------------------------------------- frame */

  update(dt, time, camera) {
    const speed = QUALITY.reducedMotion ? 6 : 1.9;
    this.open += (this.target - this.open) * Math.min(1, dt * speed);
    if (this.target === 0 && this.open < 0.004) {
      this.open = 0;
      this.group.visible = false;
    }

    const w = WEDGE_HALF_ANGLE * this.open;
    const a0 = this.centerAngle - w;
    const a1 = this.centerAngle + w;

    // Normals point away from the wedge; with clipIntersection the fragment
    // survives if *either* plane keeps it, so only the wedge is removed.
    const nA = this.planes[0].normal.set(Math.sin(a0 - Math.PI / 2), 0, Math.cos(a0 - Math.PI / 2));
    const nB = this.planes[1].normal.set(Math.sin(a1 + Math.PI / 2), 0, Math.cos(a1 + Math.PI / 2));
    this.planes[0].constant = 0;
    this.planes[1].constant = 0;

    if (!this.group.visible) return;

    // Park each cut face on its plane, nudged a hair to the kept side.
    const eps = 0.0016;
    this.faces[0].rotation.set(0, a0 - Math.PI / 2, 0);
    this.faces[0].position.set(nA.x * eps, 0, nA.z * eps);
    this.faces[1].rotation.set(0, a1 - Math.PI / 2, 0);
    this.faces[1].position.set(nB.x * eps, 0, nB.z * eps);

    const faceFade = THREE.MathUtils.smoothstep(this.open, 0.04, 0.35);
    for (const m of this.faceMats) {
      m.uniforms.uTime.value = time;
      m.uniforms.uOpacity.value = faceFade;
    }
    for (const f of this.faces) f.visible = faceFade > 0.01;

    camera.getWorldPosition(this._camWorld);
    for (const s of this.shells) {
      s.mat.uniforms.uTime.value = time;
      s.mat.uniforms.uCameraPos.value.copy(this._camWorld);
      s.mat.uniforms.uOpacity.value = 1;
    }
  }
}
