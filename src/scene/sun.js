import * as THREE from 'three';
import { QUALITY } from '../quality.js';
import {
  SUN_VERT,
  SUN_FRAG,
  SHELL_VERT,
  SHELL_FRAG,
  CORONA_VERT,
  CORONA_FRAG,
  GLARE_VERT,
  GLARE_FRAG,
} from '../shaders/sun.glsl.js';

const TAU = Math.PI * 2;

const CORONA_RADIUS = 7.0;

export class Sun {
  constructor() {
    // `group` is world-aligned; `spin` carries the axial tilt and rotation.
    this.group = new THREE.Group();
    this.spin = new THREE.Group();
    this.spin.rotation.z = THREE.MathUtils.degToRad(7.25); // solar axial tilt
    this.group.add(this.spin);

    this.activity = 0;
    this.materials = [];
    this.clippable = [];
    this._camWorld = new THREE.Vector3();

    this._buildPhotosphere();
    this._buildChromosphere();
    this._buildCorona();
    this._buildGlare();
  }

  _buildPhotosphere() {
    const seg = QUALITY.sunSegments;
    const geo = new THREE.SphereGeometry(1, seg, Math.round(seg / 2));

    this.surfaceMat = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      defines: {
        OCTAVES: QUALITY.noiseOctaves,
        WORLEY_OCTAVES: QUALITY.worleyOctaves,
        ...(QUALITY.granulation ? { GRANULATION: '' } : {}),
      },
      uniforms: {
        uTime: { value: 0 },
        uSpin: { value: 0 },
        uDiff: { value: 0 },
        uSpotSpin: { value: 0 },
        uActivity: { value: 0 },
        uBrightness: { value: 0.86 },
        uSpots: { value: 1.0 },
        uCameraPos: { value: new THREE.Vector3() },
        uFlareDir: { value: new THREE.Vector3(0, 1, 0) },
        uFlareAge: { value: 0 },
        uFlarePower: { value: 0 },
      },
      clipping: true,
      clippingPlanes: [],
      clipIntersection: true,
    });

    this.surface = new THREE.Mesh(geo, this.surfaceMat);
    this.surface.name = 'photosphere';
    this.spin.add(this.surface);
    this.materials.push(this.surfaceMat);
    this.clippable.push(this.surfaceMat);
  }

  _buildChromosphere() {
    const seg = QUALITY.coronaSegments;
    const geo = new THREE.SphereGeometry(1.012, seg, Math.round(seg / 2));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uActivity: { value: 0 },
        uColorA: { value: new THREE.Color(0xff2f1c) },
        uColorB: { value: new THREE.Color(0xff8a3c) },
        uPower: { value: 5.0 },
        uIntensity: { value: 1.1 },
        uFade: { value: 1 },
        uCameraPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
      clipping: true,
      clippingPlanes: [],
      clipIntersection: true,
    });
    this.chromoMat = mat;
    this.chromo = new THREE.Mesh(geo, mat);
    this.chromo.renderOrder = 2;
    this.spin.add(this.chromo);
    this.materials.push(mat);
    this.clippable.push(mat);
  }

  _buildCorona() {
    const seg = Math.max(32, Math.round(QUALITY.coronaSegments / 2));
    const geo = new THREE.SphereGeometry(CORONA_RADIUS, seg, Math.round(seg / 2));
    this.coronaMat = new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT,
      fragmentShader: CORONA_FRAG,
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uActivity: { value: 0 },
        uIntensity: { value: 0.70 },
        uExtent: { value: 1.0 },
        uColorHot: { value: new THREE.Color(0xffd9a0) },
        uColorMid: { value: new THREE.Color(0xff9a45) },
        uColorCool: { value: new THREE.Color(0x86b9ff) },
        uFade: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.corona = new THREE.Mesh(geo, this.coronaMat);
    this.corona.renderOrder = 3;
    this.corona.frustumCulled = false;
    this.group.add(this.corona);
    this.materials.push(this.coronaMat);
  }

  _buildGlare() {
    this.glareMat = new THREE.ShaderMaterial({
      vertexShader: GLARE_VERT,
      fragmentShader: GLARE_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color(0xfff3d4) },
        uColorB: { value: new THREE.Color(0xffa23c) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.glare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glareMat);
    this.glare.renderOrder = 20;
    this.glare.frustumCulled = false;
    this.glare.visible = false;
    this.group.add(this.glare);
    this.materials.push(this.glareMat);
  }

  /** Flares pump this; it decays back to rest. */
  pulse(amount) {
    this.activity = Math.min(1.2, this.activity + amount);
  }

  /**
   * Kick off a surface disturbance at a world-space direction. The photosphere
   * shader works in the spinning mesh's local space, so convert once here.
   */
  disturb(worldDir, power) {
    const u = this.surfaceMat.uniforms;
    this.surface.updateWorldMatrix(true, false);
    u.uFlareDir.value.copy(worldDir);
    this.surface.worldToLocal(u.uFlareDir.value).normalize();
    u.uFlareAge.value = 0;
    u.uFlarePower.value = power;
    this._disturbing = power > 0.001;
  }

  setClippingPlanes(planes) {
    for (const m of this.clippable) {
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
  }

  /** Corona fades independently so the cutaway stays readable. */
  setAtmosphereFade(v) {
    this.coronaMat.uniforms.uFade.value = v;
    this.corona.visible = v > 0.01;
    this.chromoMat.uniforms.uFade.value = Math.max(v, 0.35);
  }

  /** Recompile the surface shader after a runtime quality drop. */
  applyQuality() {
    this.surfaceMat.defines.OCTAVES = QUALITY.noiseOctaves;
    this.surfaceMat.defines.WORLEY_OCTAVES = QUALITY.worleyOctaves;
    if (QUALITY.granulation) this.surfaceMat.defines.GRANULATION = '';
    else delete this.surfaceMat.defines.GRANULATION;
    this.surfaceMat.needsUpdate = true;
  }

  update(dt, time, camera) {
    this.activity = Math.max(0, this.activity - dt * 0.32);

    if (this._disturbing) {
      const u = this.surfaceMat.uniforms;
      u.uFlareAge.value += dt;
      // The ring has crossed the whole disc by ~pi/0.85 seconds.
      if (u.uFlareAge.value > 4.6) {
        u.uFlarePower.value = 0;
        this._disturbing = false;
      }
    }
    const act = Math.min(1.0, this.activity);

    this.spin.rotation.y += dt * 0.018;

    camera.getWorldPosition(this._camWorld);

    // Once the disc shrinks to a few pixels, hand off to the glare card so the
    // sun still reads as a blazing point source in the wide shot.
    const dist = this._camWorld.length();
    const vis = THREE.MathUtils.smoothstep(dist, 13, 34);
    this.glareMat.uniforms.uOpacity.value = vis;
    this.glare.visible = vis > 0.01;
    if (this.glare.visible) {
      this.glare.scale.setScalar(dist * 0.16);
      this.glare.quaternion.copy(camera.quaternion);
    }

    // Surface rotation angles are derived here rather than in the shader, in
    // double precision, so they stay bounded however long the tab is open.
    // The rigid spin wraps (rotation is exactly 2pi-periodic, so this is
    // lossless) and the differential term is a bounded quasi-periodic wander
    // instead of an angle that accumulates forever — see the long note in the
    // surface fragment shader for why that distinction matters.
    const su = this.surfaceMat.uniforms;
    su.uSpin.value = (time * 0.030) % TAU;
    su.uSpotSpin.value = (time * 0.028) % TAU;
    su.uDiff.value = 0.28 * Math.sin(time * 0.043) + 0.16 * Math.sin(time * 0.0177);

    for (const m of this.materials) {
      if (m.uniforms.uTime) m.uniforms.uTime.value = time;
      if (m.uniforms.uActivity) m.uniforms.uActivity.value = act;
      if (m.uniforms.uCameraPos) m.uniforms.uCameraPos.value.copy(this._camWorld);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
