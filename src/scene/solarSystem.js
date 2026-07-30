import * as THREE from 'three';
import { PLANETS, ASTEROID } from '../data.js';
import { QUALITY } from '../quality.js';
import { buildEarthTexture } from './earthMap.js';
import { Asteroid } from './asteroid.js';
import {
  PLANET_VERT,
  PLANET_FRAG,
  CLOUD_FRAG,
  ATMO_FRAG,
  RING_VERT,
  RING_FRAG,
} from '../shaders/planet.glsl.js';

const Y_UP = new THREE.Vector3(0, 1, 0);

const TYPE_DEFINE = {
  rocky: 'TYPE_ROCKY',
  venus: 'TYPE_VENUS',
  earth: 'TYPE_EARTH',
  gas: 'TYPE_GAS',
  ice: 'TYPE_ICE',
};

export class SolarSystem {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.opacity = 0;

    this.planets = [];
    this.moons = []; // flat list for labels + picking
    this.materials = [];
    this.lineMats = [];
    this.moonLineMats = [];

    this._camWorld = new THREE.Vector3();

    const seg = QUALITY.tier === 'low' ? 28 : QUALITY.tier === 'medium' ? 44 : 64;
    const moonSeg = QUALITY.tier === 'low' ? 12 : QUALITY.tier === 'medium' ? 18 : 26;

    // One geometry per size class, scaled per instance.
    this.bodyGeo = new THREE.SphereGeometry(1, seg, Math.round(seg / 2));
    this.landMap = buildEarthTexture();
    this.moonGeo = new THREE.SphereGeometry(1, moonSeg, Math.round(moonSeg / 2));

    PLANETS.forEach((p, i) => this._buildPlanet(p, i));

    this.meshes = this.planets.map((p) => p.mesh);

    // --- asteroid
    this.asteroid = new Asteroid(ASTEROID, this.bodyGeo);
    this.group.add(this.asteroid.group);

    this.earthIndex = PLANETS.findIndex((p) => p.type === 'earth');
    const earth = this.planets[this.earthIndex];

    // --- eclipse state
    this.eclipse = 0;
    this.eclipseTarget = 0;
    this.eclipseSlide = 0;
    this._alignedMoon = null;
    this.earthMoon = earth.moons[0];
    this.earthRec = earth;
    this._eclipseVec = new THREE.Vector3();
  }

  /* --------------------------------------------------------------- shaders */

  _bodyMaterial(p, { moon = null } = {}) {
    const defines = { PLANET_DETAIL: moon ? Math.max(0, QUALITY.planetDetail - 1) : QUALITY.planetDetail };
    defines[moon ? 'TYPE_ROCKY' : TYPE_DEFINE[p.type]] = '';
    if (!moon && p.name === 'JUPITER') defines.GREAT_SPOT = '';
    if (!moon && p.name === 'NEPTUNE') defines.DARK_SPOT = '';

    const c = new THREE.Color(moon ? moon.color : p.color);
    const c2 = moon ? c.clone().multiplyScalar(0.45) : new THREE.Color(p.color2);

    return new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      defines,
      uniforms: {
        uColorA: { value: c },
        uColorB: { value: c2 },
        uSeed: { value: (moon ? moon.name : p.name).length * 7.13 + i2seed(p, moon) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uBump: { value: moon ? 1.6 : (p.bump ?? 1.3) },
        uCraters: { value: moon ? 1.0 : (p.craters ?? 0.0) },
        uRough: { value: moon ? 1.0 : (p.rough ?? 0.5) },
        uCaps: { value: moon ? 0 : (p.caps ?? 0) },
        uBandFreq: { value: p.bandFreq ?? 18 },
        uBandWarp: { value: p.bandWarp ?? 0.06 },
        uStorm: { value: p.storm ?? 0 },
        uIcy: { value: moon ? (moon.icy ?? 0) : 0 },
        ...(!moon && p.type === 'earth' ? { uLandMap: { value: this.landMap } } : {}),
      },
      transparent: true,
      depthWrite: true,
    });
  }

  /* -------------------------------------------------------------- building */

  _buildPlanet(p, i) {
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(pivot);

    // `holder` carries the planet out to its orbital radius but never spins,
    // so moons and rings don't inherit the planet's own rotation.
    const holder = new THREE.Group();
    holder.position.x = p.orbit;
    pivot.add(holder);

    const tilt = new THREE.Group();
    tilt.rotation.z = p.tilt;
    holder.add(tilt);

    const mat = this._bodyMaterial(p);
    const mesh = new THREE.Mesh(this.bodyGeo, mat);
    mesh.scale.setScalar(p.radius);
    mesh.userData.planetIndex = i;
    tilt.add(mesh);
    this.materials.push(mat);

    const extras = { clouds: null, atmo: null, ring: null };

    if (p.type === 'earth') {
      extras.clouds = this._cloudLayer(p);
      tilt.add(extras.clouds.mesh);
      extras.atmo = this._atmosphere(p, 0x6fa8ff, 1.05, 3.6, 0.34);
      tilt.add(extras.atmo.mesh);
    } else if (p.type === 'venus') {
      extras.atmo = this._atmosphere(p, 0xffdca8, 1.045, 3.8, 0.26);
      tilt.add(extras.atmo.mesh);
    } else if (p.type === 'gas' || p.type === 'ice') {
      const tint = p.type === 'ice' ? 0x8fd8ff : 0xffd7a8;
      extras.atmo = this._atmosphere(p, tint, 1.03, 4.0, 0.22);
      tilt.add(extras.atmo.mesh);
    }

    if (p.ring) {
      extras.ring = this._ring(p);
      tilt.add(extras.ring.mesh);
    }

    // --- orbit trace
    this.group.add(this._orbitLine(p.orbit, 0x6fd6ff, this.lineMats));

    // --- moons
    const moons = (p.moons ?? []).map((m, j) => {
      const mPivot = new THREE.Group();
      mPivot.rotation.y = Math.random() * Math.PI * 2;
      // A little inclination so they don't all sit in one flat line.
      mPivot.rotation.x = (Math.random() - 0.5) * 0.22;
      tilt.add(mPivot);

      const mMat = this._bodyMaterial(p, { moon: m });
      const mMesh = new THREE.Mesh(this.moonGeo, mMat);
      mMesh.scale.setScalar(p.radius * m.r);
      mMesh.position.x = p.radius * m.d;
      mMesh.userData.moon = { planetIndex: i, moonIndex: j };
      mPivot.add(mMesh);
      this.materials.push(mMat);

      const line = this._orbitLine(p.radius * m.d, 0x9fd8ff, this.moonLineMats, 96);
      mPivot.add(line);

      const rec = { data: m, planet: p, planetIndex: i, mesh: mMesh, pivot: mPivot, rate: m.speed };
      this.moons.push(rec);
      return rec;
    });

    this.planets.push({
      data: p,
      index: i,
      pivot,
      holder,
      tilt,
      mesh,
      extras,
      moons,
      // Period ratios compressed so the inner planets don't blur past.
      rate: Math.pow(p.speed, 0.45),
    });
  }

  _cloudLayer(p) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uSeed: { value: 4.2 },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.bodyGeo, mat);
    mesh.scale.setScalar(p.radius * 1.016);
    mesh.renderOrder = 1;
    this.materials.push(mat);
    return { mesh, mat };
  }

  _atmosphere(p, color, scale, power, strength) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0 },
        uPower: { value: power },
        uCameraPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    mat.userData.opacityScale = strength;
    const mesh = new THREE.Mesh(this.bodyGeo, mat);
    mesh.scale.setScalar(p.radius * scale);
    mesh.renderOrder = 2;
    this.materials.push(mat);
    return { mesh, mat };
  }

  _ring(p) {
    const inner = p.radius * (1 + p.ring[0]);
    const outer = p.radius * (1 + p.ring[1]);
    const geo = new THREE.RingGeometry(inner, outer, QUALITY.tier === 'low' ? 64 : 160, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color(0xf0e3c0) },
        uColorB: { value: new THREE.Color(0x9c8a68) },
        uOpacity: { value: 0 },
        uInner: { value: inner },
        uOuter: { value: outer },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    this.materials.push(mat);
    return { mesh, mat };
  }

  _orbitLine(radius, color, sink, segments) {
    const n = segments ?? (QUALITY.tier === 'low' ? 96 : 220);
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    sink.push(mat);
    return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
  }

  /* ---------------------------------------------------------------- public */


  /** Cross-fades the whole system in and out with the view transition. */
  setOpacity(v) {
    this.opacity = v;
    this.group.visible = v > 0.005;
    for (const m of this.materials) {
      if (m.uniforms.uOpacity) m.uniforms.uOpacity.value = v * (m.userData.opacityScale ?? 1);
    }
    for (const m of this.lineMats) m.opacity = v * 0.24;
    this.asteroid.setOpacity(v);
  }

  /* ---------------------------------------------------------------- eclipse */

  /**
   * Totality placement.
   *
   * The Moon is put on the Sun–Earth line and, during entry and exit, offset
   * sideways so it visibly slides across the solar disc. Earth keeps orbiting
   * throughout, so this is re-solved every frame.
   *
   * Rather than solving the pivot angle trigonometrically — easy to get
   * sign-wrong — the Moon is simply *placed* in its parent frame with the pivot
   * zeroed. Its original transform is restored on exit.
   */
  _alignEclipse() {
    const moon = this.earthMoon;
    if (!moon) return;

    if (!moon._saved) {
      moon._saved = {
        px: moon.mesh.position.x,
        rx: moon.pivot.rotation.x,
        ry: moon.pivot.rotation.y,
      };
    }

    this.earthRec.mesh.getWorldPosition(this._eclipseVec);
    const orbitR = this.earthRec.data.radius * moon.data.d;
    const sunward = this._eclipseVec.clone().negate().normalize();

    // Where the Moon sits when dead centre on the disc. The camera aims from
    // here, so the Sun stays put in frame while the Moon slides across it.
    this._alignedMoon = this._eclipseVec.clone().addScaledVector(sunward, orbitR);

    const want = this._alignedMoon.clone();
    if (Math.abs(this.eclipseSlide) > 1e-4) {
      const lateral = new THREE.Vector3().crossVectors(sunward, Y_UP).normalize();
      const moonR = this.earthRec.data.radius * moon.data.r;
      want.addScaledVector(lateral, this.eclipseSlide * moonR * 3.6);
    }

    this.earthRec.tilt.updateWorldMatrix(true, false);
    const local = this.earthRec.tilt.worldToLocal(want);
    moon.pivot.rotation.set(0, 0, 0);
    moon.mesh.position.copy(local);
    moon.mesh.updateWorldMatrix(true, false);
  }

  _restoreMoon() {
    const moon = this.earthMoon;
    if (!moon || !moon._saved) return;
    moon.mesh.position.set(moon._saved.px, 0, 0);
    moon.pivot.rotation.set(moon._saved.rx, moon._saved.ry, 0);
    moon._saved = null;
  }

  setEclipse(on) {
    this.eclipseTarget = on ? 1 : 0;
    if (!on) this.eclipseSlide = 0;
    // The Moon is *not* restored here: `eclipse` fades out over about a second
    // and `_alignEclipse` keeps running (and re-saving) until it reaches zero,
    // so restoring now would just be undone. It happens at the end of the fade.
  }

  /** 0 = centred on the disc; ±1 = clear of it on either side. */
  setEclipseSlide(v) {
    this.eclipseSlide = v;
  }

  /**
   * Where to put the camera for totality: directly behind the Moon on the
   * Sun–Moon line, at the distance where the Moon's angular radius matches the
   * Sun's. Solving R_moon / x = R_sun / (x + L) gives
   * x = R_moon·L / (R_sun − R_moon). Sitting a little closer than that makes the
   * Moon slightly overfill the disc, which is what leaves a clean corona ring
   * instead of a blinding sliver of photosphere.
   */
  eclipseVantage(out) {
    const aligned = this._alignedMoon;
    if (!aligned) return out.set(0, 0, 12);
    const L = aligned.length();
    const moonR = this.earthRec.data.radius * this.earthMoon.data.r;
    const x = ((moonR * L) / Math.max(1 - moonR, 1e-3)) * 0.94;
    return out.copy(aligned).multiplyScalar((L + x) / L);
  }

  /** Moon orbit traces only earn their keep once you're close to a planet. */
  setMoonDetail(v) {
    for (const m of this.moonLineMats) m.opacity = v * 0.13;
  }

  worldPosition(index, out) {
    return this.planets[index].mesh.getWorldPosition(out);
  }

  moonWorldPosition(rec, out) {
    return rec.mesh.getWorldPosition(out);
  }

  update(dt, time, camera) {
    if (!this.group.visible) return;
    camera.getWorldPosition(this._camWorld);

    this.eclipse += (this.eclipseTarget - this.eclipse) * Math.min(1, dt * 2.2);

    // Earth is pinned while the eclipse is engaged. Re-solving the alignment
    // against a moving Earth every frame keeps the Moon *aligned* but not
    // *still*: the whole arrangement, camera vantage included, creeps along the
    // orbit. Freezing the one planet involved makes the held shot genuinely
    // stationary. The rest of the system carries on.
    const pinned = this.eclipse > 0.01 ? this.earthIndex : -1;

    for (const p of this.planets) {
      if (p.index === pinned) {
        // Its own spin is harmless — the Moon hangs off the tilt group, not
        // the mesh — but leave the moons alone; _alignEclipse drives them.
        p.mesh.rotation.y += dt * 0.30;
        if (p.extras.clouds) p.extras.clouds.mesh.rotation.y += dt * 0.36;
        continue;
      }
      p.pivot.rotation.y += dt * 0.055 * p.rate;
      p.mesh.rotation.y += dt * 0.30;
      if (p.extras.clouds) p.extras.clouds.mesh.rotation.y += dt * 0.36;
      for (const m of p.moons) m.pivot.rotation.y += dt * 0.22 * m.rate;
    }

    // The eclipse override runs after the normal advance, so it wins.
    if (this.eclipse > 0.01) this._alignEclipse();
    else if (this.earthMoon?._saved) this._restoreMoon();

    this.asteroid.update(dt, time, camera);

    for (const m of this.materials) {
      if (m.uniforms.uTime) m.uniforms.uTime.value = time;
      if (m.uniforms.uCameraPos) m.uniforms.uCameraPos.value.copy(this._camWorld);
    }
  }
}

/** Small deterministic per-body seed so no two surfaces repeat. */
function i2seed(p, moon) {
  const s = (moon ? moon.name : p.name) + p.name;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return (h / 9973) * 40;
}
