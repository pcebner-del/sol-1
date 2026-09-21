import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import { auToScene } from '../orbit.js';

/**
 * Lit solid, matching the convention the planets use: there are no lights in
 * this scene, so every shader works out its own lighting from the fact that
 * the Sun sits at the origin.
 */
const CAR_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;

void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vL = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CAR_FRAG = /* glsl */ `
precision mediump float;

uniform vec3  uColor;
uniform float uGloss;
uniform float uClearcoat;
uniform float uEmissive;
uniform float uOpacity;
uniform vec3  uCameraPos;

varying vec3 vN;
varying vec3 vW;
varying vec3 vL;

void main(){
  vec3 N = normalize(vN);
  vec3 L = normalize(-vW);              // the sun sits at the origin
  vec3 V = normalize(uCameraPos - vW);
  vec3 H = normalize(L + V);

  float ndl = dot(N, L);

  // Vacuum: one source, no sky, no bounce. The terminator is hard and the
  // shadow side falls to almost nothing — that severity is most of what makes
  // a spacecraft read as lit by the Sun rather than by a studio.
  float lambert = max(ndl, 0.0);
  vec3 col = uColor * (0.055 + 0.95 * lambert);

  // Two specular lobes: a broad one for the paint itself and a tight one for
  // the clearcoat over it, which is what gives car paint its hard highlight.
  float spec = pow(max(dot(N, H), 0.0), 26.0) * 0.35 * uGloss;
  float coat = pow(max(dot(N, H), 0.0), 220.0) * uClearcoat;
  col += vec3(1.0, 0.98, 0.94) * (spec + coat) * step(0.0, ndl);

  // Grazing angles go reflective, so panels turn bright where they curve away.
  float fres = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 4.0);
  col += vec3(1.0, 0.86, 0.72) * fres * max(ndl, 0.0) * 0.38 * uClearcoat;

  // A sliver of light on the dark side, so silhouettes don't vanish entirely.
  col += uColor * pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 2.0)
       * smoothstep(-0.55, -0.02, ndl) * 0.10;

  col += uColor * uEmissive;

  // Clamped like the planets: bloom is tuned for the photosphere, and an
  // unclamped highlight here would blow out next to it.
  gl_FragColor = vec4(min(col, vec3(0.95)), uOpacity);
}
`;

/**
 * The body is lofted, not extruded.
 *
 * Extruding one silhouette gives flat slab flanks, which is what makes a car
 * model read as a toy: a real body curves in two directions at once. These are
 * cross-sections down the length — half-width, deck height, floor height and
 * how square the section is — and the surface is stitched between them. The
 * width swells over each axle and pinches at the waist between them, which is
 * the single thing that most makes it look like a car.
 */
const SECTIONS = [
  //  x,     halfW,  yTop,   yBot,  squareness
  [-0.500, 0.092, 0.052, 0.020, 2.8],
  [-0.470, 0.132, 0.070, 0.008, 3.0],
  [-0.430, 0.160, 0.085, 0.000, 3.2],
  [-0.385, 0.172, 0.098, -0.006, 3.2],
  [-0.325, 0.186, 0.114, -0.008, 3.9],   // front axle: fender bulge
  [-0.260, 0.178, 0.120, -0.008, 3.9],
  [-0.200, 0.170, 0.123, -0.008, 3.8],   // waist
  [-0.120, 0.170, 0.130, -0.008, 3.7],
  [-0.040, 0.172, 0.142, -0.008, 3.6],   // cowl
  [ 0.020, 0.176, 0.152, -0.008, 3.6],
  [ 0.100, 0.180, 0.156, -0.008, 3.7],   // cockpit deck
  [ 0.200, 0.184, 0.163, -0.008, 3.8],
  [ 0.275, 0.192, 0.172, -0.006, 4.0],   // rear haunch
  [ 0.325, 0.194, 0.172, -0.002, 4.0],   // rear axle
  [ 0.395, 0.184, 0.166, 0.008, 3.8],
  [ 0.455, 0.168, 0.152, 0.022, 3.1],
  [ 0.500, 0.146, 0.132, 0.038, 2.8],
];

/** One closed cross-section as a superellipse, flatter on top than an ellipse. */
function sectionPoints(sec, m) {
  const [x, w, yTop, yBot, n] = sec;
  const midY = (yTop + yBot) / 2;
  const halfY = (yTop - yBot) / 2;
  const p = 2 / n;
  const out = [];
  for (let j = 0; j < m; j++) {
    const th = (j / m) * Math.PI * 2;
    const cz = Math.cos(th);
    const cy = Math.sin(th);
    out.push(
      x,
      midY + halfY * Math.sign(cy) * Math.pow(Math.abs(cy), p),
      w * Math.sign(cz) * Math.pow(Math.abs(cz), p),
    );
  }
  return out;
}

function carBody() {
  const m = QUALITY.tier === 'low' ? 14 : 24;
  const n = SECTIONS.length;
  const verts = [];
  for (const sec of SECTIONS) verts.push(...sectionPoints(sec, m));

  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + j;
      const d = (i + 1) * m + ((j + 1) % m);
      idx.push(a, b, c, b, d, c);
    }
  }

  // Cap the nose and the tail with a fan to a centre vertex.
  const capCentre = (sec, dir) => {
    const [x, , yTop, yBot] = sec;
    verts.push(x + dir * 0.004, (yTop + yBot) / 2, 0);
    return verts.length / 3 - 1;
  };
  const nose = capCentre(SECTIONS[0], -1);
  for (let j = 0; j < m; j++) idx.push(nose, j, (j + 1) % m);
  const tail = capCentre(SECTIONS[n - 1], 1);
  const base = (n - 1) * m;
  for (let j = 0; j < m; j++) idx.push(tail, base + ((j + 1) % m), base + j);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tyre with a real sidewall, turned on a lathe rather than faked with a disc. */
function tyreGeometry(seg) {
  const pts = [
    [0.052, -0.038], [0.088, -0.038], [0.104, -0.032], [0.113, -0.020],
    [0.116, 0.000], [0.113, 0.020], [0.104, 0.032], [0.088, 0.038], [0.052, 0.038],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, seg);
}

/** A wheel face: alloy disc at the outboard side with a darker hub. */
function rimGeometry(seg) {
  return new THREE.CylinderGeometry(0.086, 0.086, 0.016, seg);
}

function hubGeometry(seg) {
  return new THREE.CylinderGeometry(0.034, 0.034, 0.020, seg);
}

export class Roadster {
  constructor(data) {
    this.data = data;
    this.mats = [];
    this._camWorld = new THREE.Vector3();

    this.group = new THREE.Group();

    // Orientation of the real orbital plane: node, then inclination, then the
    // argument of perihelion, so perihelion ends up pointing the right way
    // relative to the ecliptic rather than at an arbitrary angle.
    const el = data.elements;
    const node = new THREE.Group();
    node.rotation.y = -el.node * (Math.PI / 180);
    this.group.add(node);

    const tilt = new THREE.Group();
    tilt.rotation.x = el.i * (Math.PI / 180);
    node.add(tilt);

    this.plane = new THREE.Group();
    this.plane.rotation.y = -el.peri * (Math.PI / 180);
    tilt.add(this.plane);

    // The drawn ellipse and the car's position come from the same function, so
    // the body cannot drift off the line the way a mismatched pair would.
    const rp = auToScene(data.perihelionAU);
    const ra = auToScene(data.aphelionAU);
    this.semi = (rp + ra) / 2;
    this.ecc = (ra - rp) / (ra + rp);

    this.holder = new THREE.Group();
    this.plane.add(this.holder);

    this.car = this._buildCar();
    this.holder.add(this.car);

    // A tap target. The car itself is a thin tumbling wedge and at system
    // scale it is a couple of pixels wide, so picking against its own geometry
    // is hopeless. This sphere draws nothing and exists only to be hit.
    const pick = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    pick.scale.setScalar(data.size * 0.62);
    pick.userData.roadster = true;
    this.holder.add(pick);
    this.hitMeshes = [pick];

    this.plane.add(this._orbitLine());

    // Start it where it actually is: mean anomaly from the JPL epoch, carried
    // forward to today. Only the *rate* is compressed after that, to match the
    // planets — at its true rate it would look frozen beside them.
    this.meanAnomaly = 0;
    this.rate = 0.055 * Math.pow(data.speed, 0.45);
  }

  _mat({ color, gloss = 0.3, clearcoat = 0, emissive = 0, opacity = 1, side = THREE.FrontSide }) {
    const m = new THREE.ShaderMaterial({
      vertexShader: CAR_VERT,
      fragmentShader: CAR_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uGloss: { value: gloss },
        uClearcoat: { value: clearcoat },
        uEmissive: { value: emissive },
        uOpacity: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: true,
      side,
    });
    m.userData.baseOpacity = opacity;
    this.mats.push(m);
    return m;
  }

  _buildCar() {
    const car = new THREE.Group();
    const low = QUALITY.tier === 'low';

    // Midnight cherry: nearly black in shadow, deep red where the Sun catches
    // it. The clearcoat is what sells it as paint rather than plastic.
    const paint = this._mat({ color: '#a8182a', gloss: 0.72, clearcoat: 0.95 });
    const dark = this._mat({ color: '#0c0d10', gloss: 0.25 });
    const cabin = this._mat({ color: '#141519', gloss: 0.2, side: THREE.DoubleSide });
    const rubber = this._mat({ color: '#0b0c0e', gloss: 0.06 });
    const alloy = this._mat({ color: '#9aa2ab', gloss: 0.8, clearcoat: 0.5 });
    const suit = this._mat({ color: '#dfe3e8', gloss: 0.35, clearcoat: 0.25 });
    const joints = this._mat({ color: '#2b2f36', gloss: 0.3 });
    const visor = this._mat({ color: '#0a0f16', gloss: 0.95, clearcoat: 1.0 });
    const lamp = this._mat({ color: '#cdd8e2', gloss: 0.9, clearcoat: 0.8, emissive: 0.1 });
    const glass = this._mat({ color: '#8fb9cc', gloss: 0.9, clearcoat: 1.0, opacity: 0.30, side: THREE.DoubleSide });

    car.add(new THREE.Mesh(carBody(), paint));

    // Cockpit. The body is a closed surface, so the opening is suggested by a
    // shallow dark cap that follows the deck's curvature and sits a hair proud
    // of it — a box cut straight through the curved deck instead.
    const tub = new THREE.Mesh(new THREE.SphereGeometry(1, low ? 12 : 22, low ? 8 : 14), cabin);
    tub.scale.set(0.155, 0.045, 0.118);
    tub.position.set(0.140, 0.132, 0);
    car.add(tub);

    // Seats and the headrest fairings behind them.
    for (const z of [0.068, -0.068]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.060, 0.080), dark);
      seat.position.set(0.222, 0.150, z);
      seat.rotation.z = -0.16;
      car.add(seat);

      // Headrest fairings, sunk into the deck so they read as part of the
      // bodywork rather than as two balls resting on it.
      const hoop = new THREE.Mesh(new THREE.SphereGeometry(0.026, low ? 8 : 14, low ? 6 : 10), paint);
      hoop.scale.set(1.6, 0.55, 1.0);
      hoop.position.set(0.300, 0.163, z);
      car.add(hoop);
    }

    // Windscreen, raked back off the cowl.
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.072, 0.275), glass);
    screen.position.set(0.012, 0.183, 0);
    screen.rotation.z = 0.60;
    car.add(screen);

    const surround = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.080, 0.295), dark);
    surround.position.set(0.010, 0.180, 0);
    surround.rotation.z = 0.60;
    car.add(surround);

    const tyre = tyreGeometry(low ? 10 : 22);
    const rim = rimGeometry(low ? 10 : 20);
    const hub = hubGeometry(low ? 8 : 14);
    for (const [x, z] of [[-0.325, 0.185], [-0.325, -0.185], [0.325, 0.185], [0.325, -0.185]]) {
      const side = Math.sign(z);
      const w = new THREE.Mesh(tyre, rubber);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.050, z);
      car.add(w);

      const r = new THREE.Mesh(rim, alloy);
      r.rotation.x = Math.PI / 2;
      r.position.set(x, 0.050, z + side * 0.026);
      car.add(r);

      const h = new THREE.Mesh(hub, dark);
      h.rotation.x = Math.PI / 2;
      h.position.set(x, 0.050, z + side * 0.034);
      car.add(h);
    }

    // Headlamps, tucked into the front wings.
    for (const z of [0.108, -0.108]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.030, low ? 8 : 14, low ? 6 : 10), lamp);
      l.scale.set(0.55, 0.72, 1.0);
      l.position.set(-0.408, 0.092, z);
      car.add(l);
    }

    car.add(this._buildStarman(suit, joints, visor));

    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0075, 6, low ? 10 : 18), dark);
    wheel.position.set(0.098, 0.150, 0.068);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = 0.42;
    car.add(wheel);

    car.userData.roadster = true;
    for (const c of car.children) c.userData.roadster = true;

    // The body is a unit long in local space, so this is its length in scene
    // units. Wildly out of scale with the planets by necessity: a 4 m car at
    // true scale would be a millionth of a pixel.
    car.scale.setScalar(this.data.size);
    return car;
  }

  /** The mannequin: shoulders, a helmet with a neck ring, one hand on the wheel. */
  _buildStarman(suit, joints, visor) {
    const low = QUALITY.tier === 'low';
    const man = new THREE.Group();
    man.position.set(0.205, 0.150, 0.068);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.040, 0.055, 3, low ? 8 : 12), suit);
    torso.scale.set(1.0, 1.0, 1.18);
    torso.rotation.z = -0.26;
    man.add(torso);

    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.085, 3, low ? 6 : 10), suit);
    shoulders.rotation.x = Math.PI / 2;
    shoulders.position.set(-0.020, 0.048, 0);
    man.add(shoulders);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 5, low ? 8 : 14), joints);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(-0.026, 0.066, 0);
    man.add(collar);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.041, low ? 10 : 18, low ? 8 : 14), suit);
    helmet.position.set(-0.030, 0.095, 0);
    man.add(helmet);

    // The visor wraps the front of the helmet rather than sitting on it as a
    // disc, which is most of what makes the head read as a helmet.
    const v = new THREE.Mesh(
      new THREE.SphereGeometry(0.0425, low ? 10 : 18, low ? 8 : 12, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.26, Math.PI * 0.44),
      visor,
    );
    v.position.copy(helmet.position);
    man.add(v);

    // Right arm forward to the wheel, left elbow over the sill.
    const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, 0.085, 3, low ? 6 : 10), suit);
    armR.rotation.z = 1.05;
    armR.rotation.y = -0.25;
    armR.position.set(-0.080, 0.012, -0.004);
    man.add(armR);

    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, 0.070, 3, low ? 6 : 10), suit);
    armL.rotation.x = 1.15;
    armL.rotation.z = -0.35;
    armL.position.set(0.004, 0.018, 0.052);
    man.add(armL);

    for (const c of man.children) c.userData.roadster = true;
    return man;
  }


  _orbitLine() {
    const n = QUALITY.tier === 'low' ? 128 : 300;
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const nu = (k / n) * Math.PI * 2;
      pts.push(this._pointAt(nu, new THREE.Vector3()));
    }
    const mat = new THREE.LineBasicMaterial({
      color: 0xff6a52,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    mat.userData.baseOpacity = 0.30;
    this.mats.push(mat);
    this.orbitMat = mat;
    return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
  }

  /** Position on the ellipse at a true anomaly, with the Sun at the focus. */
  _pointAt(nu, out) {
    const r = (this.semi * (1 - this.ecc * this.ecc)) / (1 + this.ecc * Math.cos(nu));
    return out.set(r * Math.cos(nu), 0, -r * Math.sin(nu));
  }

  /** Seed the phase from the real orbit so it starts where the thing is. */
  setMeanAnomaly(m) {
    this.meanAnomaly = m;
  }

  setOpacity(v) {
    this.group.visible = v > 0.005;
    for (const m of this.mats) {
      const base = m.userData.baseOpacity ?? 1;
      if (m.uniforms) m.uniforms.uOpacity.value = v * base;
      else m.opacity = v * base;
    }
  }

  worldPosition(out) {
    return this.holder.getWorldPosition(out);
  }

  update(dt, time, camera) {
    if (!this.group.visible) return;
    camera.getWorldPosition(this._camWorld);

    this.meanAnomaly += dt * this.rate;

    // Kepler again, this time on the compressed ellipse, so the car speeds up
    // at perihelion and loiters at aphelion the way the real one does.
    const e = this.ecc;
    let E = this.meanAnomaly;
    for (let k = 0; k < 6; k++) {
      E -= (E - e * Math.sin(E) - this.meanAnomaly) / (1 - e * Math.cos(E));
    }
    const nu = 2 * Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2),
    );
    this._pointAt(nu, this.holder.position);

    // A slow tumble about a tilted axis, which is what a spinning free body
    // actually looks like — and unlike wobbling every axis independently it
    // keeps the car at a readable three-quarter angle most of the way round.
    // The real one was measured at one turn per 4.76 minutes shortly after
    // launch; this is far slower, to be watchable.
    this.car.rotation.y += dt * 0.085;
    this.car.rotation.x = 0.17;
    this.car.rotation.z = 0.12;

    for (const m of this.mats) {
      if (m.uniforms) m.uniforms.uCameraPos.value.copy(this._camWorld);
    }
  }
}
