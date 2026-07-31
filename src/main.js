import './style.css';
import './ui/hud.css';

import * as THREE from 'three';
import { App, easeInOutCubic, easeOutQuint } from './app.js';
import { HUD } from './ui/hud.js';
import { installGrain } from './ui/grain.js';
import { LabelLayer, updateLabelLayers } from './ui/labels.js';
import { SolarSystem } from './scene/solarSystem.js';
import { FlareSystem } from './scene/flares.js';
import { Cutaway } from './scene/cutaway.js';
import { SunAudio } from './audio/sunAudio.js';
import { LAYERS, PLANETS, SUNSPOT_INFO, ASTEROID, ECLIPSE_INFO } from './data.js';
import { QUALITY } from './quality.js';
import { distanceFromSun, fromKm } from './format.js';

const app = new App(document.getElementById('scene'));
const overlay = document.getElementById('overlay');
installGrain(document.getElementById('grain'));

/* ------------------------------------------------------------ scene setup */

const system = new SolarSystem();
app.scene.add(system.group);
app.modules.push(system);

const flares = new FlareSystem(app.sun);
app.modules.push(flares);

const cutaway = new Cutaway(app.sun);
app.scene.add(cutaway.group);
app.modules.push(cutaway);

const audio = new SunAudio();

/* ---------------------------------------------------------------- labels */

const planetLabels = new LabelLayer(overlay);
const moonLabels = new LabelLayer(overlay);
const layerLabels = new LabelLayer(overlay);

const _tmp = new THREE.Vector3();
const _eclTarget = new THREE.Vector3();
const _eclScratch = new THREE.Vector3();

PLANETS.forEach((p, i) => {
  const item = planetLabels.add({
    id: i,
    title: p.name,
    sub: distanceFromSun(p.au).short,
    onClick: (id) => followPlanet(id),
  });
  item.anchor = (out) => {
    system.worldPosition(i, out);
    out.y += p.radius * 1.9 + 0.12;
    return out;
  };
});

system.moons.forEach((rec, k) => {
  const item = moonLabels.add({
    id: k,
    title: rec.data.name,
    sub: rec.planet.name,
    className: 'moon-label',
    onClick: () => followPlanet(rec.planetIndex),
  });
  item.anchor = (out) => {
    system.moonWorldPosition(rec, out);
    out.y += rec.planet.radius * rec.data.r * 1.8 + 0.02;
    return out;
  };
});

const objectLabels = new LabelLayer(overlay);

{
  const it = objectLabels.add({
    id: 'asteroid',
    title: ASTEROID.name,
    sub: ASTEROID.kind,
    className: 'object-label',
    onClick: () => showAsteroid(),
  });
  it.anchor = (out) => {
    system.asteroid.worldPosition(out);
    out.y += ASTEROID.radius * 2.4 + 0.05;
    return out;
  };
}

LAYERS.forEach((l) => {
  const item = layerLabels.add({
    id: l.id,
    title: l.name,
    sub: l.temp,
    className: 'layer-label',
    onClick: () => pinLayer(l),
    onHover: (_id, entering) => {
      if (!pinned) requestLayer(entering ? l : null);
    },
  });
  item.el.style.setProperty('--label-accent', l.accent);
  item.anchor = (out) => cutaway.layerAnchor(l.id, out);
});

// Sunspots aren't a layer, but they're the most recognisable thing on the
// surface — anchored on the intact hemisphere, opposite the cut.
{
  const item = layerLabels.add({
    id: SUNSPOT_INFO.id,
    title: SUNSPOT_INFO.name,
    sub: SUNSPOT_INFO.temp,
    className: 'layer-label',
    onClick: () => pinLayer(SUNSPOT_INFO),
    onHover: (_id, entering) => {
      if (!pinned) requestLayer(entering ? SUNSPOT_INFO : null);
    },
  });
  item.el.style.setProperty('--label-accent', SUNSPOT_INFO.accent);
  item.anchor = (out) => cutaway.sunspotAnchor(out);
}

/* -------------------------------------------------------------- view modes */

let mode = 'surface';
let followIndex = -1;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * What the camera is currently glued to. `get` yields a world position;
 * `rotateFrame` carries the camera around a heliocentric orbit so the sun stays
 * put relative to the body.
 */
let track = null;

function setTrack(getFn, rotateFrame = true) {
  if (!getFn) {
    track = null;
    return;
  }
  const p = new THREE.Vector3();
  getFn(p);
  track = { get: getFn, rotateFrame, prev: p.clone(), angle: Math.atan2(p.x, p.z) };
}

const fade = {
  system: 0,
  atmosphere: 1,
  systemTarget: 0,
  atmosphereTarget: 1,
};

/** Frames the sun with a little breathing room whatever the aspect ratio. */
/**
 * True for phone-sized viewports in either orientation, matching the CSS
 * breakpoint that restructures the HUD. Tablets and desktops are excluded.
 */
function isPhone() {
  return window.innerWidth < 560 || (window.innerHeight < 460 && window.innerWidth > window.innerHeight);
}

function sectionDistance() {
  const vFov = (app.camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * app.camera.aspect);
  // How much room to leave around the disc. The generous figure exists to keep
  // the corona in frame, but on a phone that reads as a small sun adrift in a
  // lot of black. 1.12 still clears the photosphere itself by 12%, so it can't
  // clip at any viewport, it just crops the outer corona.
  const fit = isPhone() ? 1.12 : 1.3;
  return Math.max(fit / Math.tan(hFov / 2), fit / Math.tan(vFov / 2)) * (isPhone() ? 1.0 : 1.06);
}

/**
 * Surface view pulls back further than the cross-section, but only where
 * there's width to spare — on a tall phone that headroom just becomes dead
 * space, so we sit closer.
 */
function surfaceDistance() {
  if (isPhone()) return sectionDistance();
  return sectionDistance() * (app.camera.aspect < 0.85 ? 1.06 : 1.32);
}

function systemDistance() {
  const maxR = PLANETS[PLANETS.length - 1].orbit + 2.5;
  const vFov = (app.camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * app.camera.aspect);
  // The near half of the ecliptic is closer to the camera than the far
  // half, so perspective magnifies it — pad generously.
  return Math.max(maxR / Math.tan(hFov / 2), (maxR * 0.66) / Math.tan(vFov / 2)) * 1.14;
}

function setMode(next, { silent = false } = {}) {
  const prev = mode;
  mode = next;
  followIndex = -1;
  setTrack(null);
  hud.setResetVisible(false);
  hud.setEclipseVisible(next === 'system');
  abortEclipse();
  hud.setMode(next);
  if (!pinned) setActiveLayer(null);
  pinned = false;
  hud.hideCard();
  syncFlares();

  if (next === 'surface') {
    fade.systemTarget = 0;
    fade.atmosphereTarget = 1;
    cutaway.exit();
    flares.setVisible(true);
    app.setDistanceLimits(1.32, 11);
    app.flyTo({
      position: orbitPosition(surfaceDistance(), 0.19),
      target: new THREE.Vector3(),
      duration: prev === 'system' ? 3.0 : 2.0,
      ease: easeInOutCubic,
    });
    if (!silent) hud.log('PHOTOSPHERE IMAGING ONLINE');
  }

  if (next === 'section') {
    fade.systemTarget = 0;
    fade.atmosphereTarget = 0.22;
    flares.setVisible(false);
    cutaway.enter(app.camera);
    app.setDistanceLimits(0.42, 9);
    app.flyTo({
      position: orbitPosition(sectionDistance(), 0.26),
      target: new THREE.Vector3(),
      duration: 2.2,
      ease: easeInOutCubic,
    });
    if (!silent) hud.log('INTERIOR CROSS-SECTION ENGAGED', 'warn');
  }

  if (next === 'system') {
    fade.systemTarget = 1;
    fade.atmosphereTarget = 1;
    cutaway.exit();
    flares.setVisible(true);
    const d = systemDistance();
    app.setDistanceLimits(5, d * 1.9);
    app.flyTo({
      position: orbitPosition(d, 0.58),
      target: new THREE.Vector3(),
      duration: 3.4,
      ease: easeInOutCubic,
    });
    if (!silent) hud.log('WIDE-FIELD SURVEY · 8 BODIES TRACKED');
  }
}

/**
 * Orbit vs. free move. Orbiting is always about the current target, which is
 * awkward once that target is a planet way out on an outer ring — so "MOVE"
 * hands the left button to panning and releases the follow lock, letting you
 * fly the camera anywhere.
 */
let navMode = 'orbit';

function setNavMode(m) {
  navMode = m;
  const c = app.controls;
  if (m === 'pan') {
    c.enablePan = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // Panning while locked to a body would just be fought by the tracker.
    if (track || followIndex >= 0) {
      setTrack(null);
      followIndex = -1;
      hud.setResetVisible(true);
      syncFlares();
    }
  } else {
    c.enablePan = false;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  }
  hud.setNavMode(m);
}

/** Keeps the current azimuth so mode changes never feel like a jump cut. */
function orbitPosition(distance, elevation) {
  const az = Math.atan2(app.camera.position.x, app.camera.position.z);
  const horiz = Math.cos(elevation) * distance;
  return new THREE.Vector3(Math.sin(az) * horiz, Math.sin(elevation) * distance, Math.cos(az) * horiz);
}

/**
 * On a phone the info card is a large slab of screen, and a planet framed dead
 * centre ends up half behind it. Aim a little to the side of the body so it
 * sits in the part of the screen that is actually free: above the card in
 * portrait, beside it in landscape. Returns null on larger screens, where the
 * card sits in the margin and there is nothing to dodge.
 */
function cardClearance(offset, dist) {
  if (!isPhone()) return null;

  // Screen axes at the planet, derived from the view direction rather than
  // world up — the camera looks down at the ecliptic, so they are not the same.
  const viewDir = offset.clone().negate().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const screenUp = up.clone().addScaledVector(viewDir, -up.dot(viewDir));
  if (screenUp.lengthSq() < 1e-6) return null;
  screenUp.normalize();

  const vFov = (app.camera.fov * Math.PI) / 180;
  const viewH = 2 * dist * Math.tan(vFov / 2);

  if (window.innerHeight >= window.innerWidth) {
    // Portrait: card, dock and flare row own the bottom. Lift the planet by
    // about a fifth of the frame, which puts it in the middle of what's left.
    return screenUp.multiplyScalar(-viewH * 0.20);
  }
  // Landscape: the card docks to the right, so shift the planet left instead.
  const screenRight = new THREE.Vector3().crossVectors(viewDir, screenUp).normalize();
  return screenRight.multiplyScalar(viewH * app.camera.aspect * 0.16);
}

/** Flares belong to the Sun; hide the row whenever a planet has the camera. */
function syncFlares() {
  hud.setFlaresVisible(!(mode === 'system' && followIndex >= 0));
}

function followPlanet(index) {
  if (mode !== 'system') return;
  const p = PLANETS[index];
  followIndex = index;

  const getEarthLike = (out) => system.worldPosition(index, out);
  getEarthLike(_tmp);

  // Sit slightly sunward of the planet so we're looking at a lit hemisphere,
  // not a black disc, and off to one side so the moons aren't edge-on.
  const outward = _tmp.clone().normalize();
  const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
  const dist = Math.max(0.9, p.radius * 8.2);
  const offset = new THREE.Vector3()
    .addScaledVector(outward, -dist * 0.62)
    .addScaledVector(tangent, dist * 0.58)
    .add(new THREE.Vector3(0, dist * 0.3, 0));

  app.setDistanceLimits(p.radius * 1.8, systemDistance() * 1.9);
  app.flyToTracked({
    trackFn: getEarthLike,
    offset,
    duration: 2.4,
    ease: easeOutQuint,
    targetOffset: cardClearance(offset, dist),
    onDone: () => setTrack(getEarthLike, true),
  });
  hud.setResetVisible(true);
  syncFlares();

  hud.showCard({
    name: p.name,
    desc: `${p.fact}<br><span class="card-note">${p.moonNote}</span>`,
    accent: p.color,
    stats: [
      ['DISTANCE', distanceFromSun(p.au).au],
      ['', distanceFromSun(p.au).km],
      ['', distanceFromSun(p.au).mi],
      ['ORBITAL PERIOD', `${p.period.toLocaleString()} days`],
      ['KNOWN MOONS', p.moonCount === 0 ? 'none' : p.moonCount.toLocaleString()],
      ['RANK FROM SUN', `${index + 1} of 8`],
    ],
  });
  hud.log(`TRACKING ${p.name}`);
}

function showAsteroid() {
  const get = (out) => system.asteroid.worldPosition(out);
  get(_tmp);
  followIndex = -1;
  hud.setResetVisible(true);
  const outward = _tmp.clone().normalize();
  const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
  const d = Math.max(0.9, ASTEROID.radius * 20);
  app.setDistanceLimits(ASTEROID.radius * 2, systemDistance() * 1.9);
  app.flyToTracked({
    trackFn: get,
    offset: new THREE.Vector3()
      .addScaledVector(outward, -d * 0.6)
      .addScaledVector(tangent, d * 0.6)
      .add(new THREE.Vector3(0, d * 0.3, 0)),
    duration: 2.4,
    ease: easeOutQuint,
    onDone: () => setTrack(get, true),
  });
  hud.showCard({
    name: ASTEROID.name,
    desc: `${ASTEROID.desc}<br><span class="card-note">${ASTEROID.composition}</span>`,
    accent: '#bfd8f0',
    stats: [
      ['CLASSIFICATION', ASTEROID.kind],
      ['DISTANCE', distanceFromSun(ASTEROID.au).au],
      ['', distanceFromSun(ASTEROID.au).km],
      ['', distanceFromSun(ASTEROID.au).mi],
      ['ORBITAL PERIOD', ASTEROID.period],
      ['DIAMETER', ASTEROID.diameter],
      ['WATER', ASTEROID.waterNote],
    ],
  });
  hud.log(`TRACKING ${ASTEROID.name}`);
}

/* ------------------------------------------------------------- eclipse */

/**
 * Totality.
 *
 * The camera goes behind the Moon and looks back at the Sun, at the distance
 * where the two discs subtend the same angle. The Moon is an ordinary opaque
 * mesh, so it occludes the photosphere by itself; the corona is a large
 * back-side sphere centred on the Sun that discards inside the disc, so its
 * inner edge is exactly where the ring wants to be. No new shader work — just
 * geometry, plus a boost to the corona so the ring clears the bloom threshold.
 *
 * The eclipsed state is *persistent*: only the slide-in and slide-out are
 * animated. Nothing times out, so there's as long as you like to read the card.
 */
const ECLIPSE = { APPROACH: 4.2, EXIT: 3.4 };

let eclipsePhase = 'off'; // 'in' | 'held' | 'out'
let eclipseT = 0;
let eclipseReady = false;

const eclipseActive = () => eclipsePhase !== 'off';

function toggleEclipse() {
  if (eclipsePhase === 'out') return; // already on its way out
  if (eclipsePhase === 'off') beginEclipse();
  else beginEclipseExit();
}

function beginEclipse() {
  eclipsePhase = 'in';
  eclipseT = 0;
  eclipseReady = false;
  setTrack(null);
  followIndex = -1;
  hud.setEclipseActive(true);
  hud.setResetVisible(true);

  // Solve the alignment once up front so there's a vantage point to aim at.
  system.setEclipse(true);
  system.eclipse = 1;
  system.setEclipseSlide(1);
  system.update(0, app.time, app.camera);

  app.setDistanceLimits(0.05, systemDistance() * 1.9);
  app.flyToTracked({
    trackFn: (out) => system.eclipseVantage(out),
    offset: new THREE.Vector3(),
    lookAt: eclipseLookTarget(new THREE.Vector3()),
    duration: 3.2,
    ease: easeInOutCubic,
    onDone: () => {
      eclipseReady = true;
      // The shot only works from one point, and the controls would keep
      // nudging it (their update() ignores `enabled`), so take the camera.
      app.lockCamera(true);
    },
  });

  hud.showCard({
    name: ECLIPSE_INFO.name,
    desc: ECLIPSE_INFO.desc,
    accent: ECLIPSE_INFO.accent,
    stats: ECLIPSE_INFO.stats,
  });
  hud.log('LUNAR OCCULTATION · TOTALITY', 'warn');
}

/** Slides the Moon back out of alignment, then returns to the wide shot. */
function beginEclipseExit() {
  eclipsePhase = 'out';
  eclipseT = 0;
  // If the approach never finished there's nothing to slide out of.
  if (!eclipseReady) finishEclipse();
  else hud.log('MOON EGRESSING');
}

function finishEclipse() {
  eclipsePhase = 'off';
  eclipseReady = false;
  system.setEclipse(false);
  hud.setEclipseActive(false);
  hud.hideCard();
  hud.setResetVisible(false);
  app.lockCamera(false);

  const d = systemDistance();
  app.setDistanceLimits(5, d * 1.9);
  app.flyTo({
    position: orbitPosition(d, 0.58),
    target: new THREE.Vector3(),
    duration: 2.8,
    ease: easeInOutCubic,
  });
  hud.log('TOTALITY ENDED');
}

/** Torn down without the animation — for mode changes and RESET VIEW. */
function abortEclipse() {
  if (!eclipseActive()) return;
  eclipsePhase = 'off';
  eclipseReady = false;
  system.setEclipse(false);
  hud.setEclipseActive(false);
  app.lockCamera(false);
}

/** Drives the slide-in / slide-out and keeps the camera on its mark. */
function updateEclipse(dt, camera) {
  if (!eclipseActive()) return;

  const { APPROACH, EXIT } = ECLIPSE;

  if (eclipsePhase === 'in') {
    if (eclipseReady) eclipseT += dt;
    if (eclipseT >= APPROACH) {
      eclipsePhase = 'held';
      system.setEclipseSlide(0);
    } else {
      system.setEclipseSlide(1 - easeInOutCubic(eclipseT / APPROACH));
    }
  } else if (eclipsePhase === 'held') {
    // Indefinite. Nothing to advance.
    system.setEclipseSlide(0);
  } else if (eclipsePhase === 'out') {
    eclipseT += dt;
    if (eclipseT >= EXIT) {
      finishEclipse();
      return;
    }
    system.setEclipseSlide(-easeInOutCubic(eclipseT / EXIT));
  }

  // Hold the camera on the vantage point once the approach flight is over.
  if (eclipseReady && !app.tween) {
    system.eclipseVantage(_tmp);
    camera.position.copy(_tmp);
    app.controls.target.copy(eclipseLookTarget(_eclTarget));
  }
}

/**
 * Where the totality shot aims. Normally the Sun itself, but on a phone the
 * info card owns the bottom of the screen and the corona ring is centred on
 * the Moon — so aim below the Sun, which lifts the whole ring into the part
 * of the frame that is actually visible. Aiming rather than moving keeps it a
 * pure rotation, so Moon and corona travel together.
 */
function eclipseLookTarget(out) {
  out.set(0, 0, 0);
  if (!isPhone() || window.innerHeight < window.innerWidth) return out;

  system.eclipseVantage(_eclScratch);
  const L = _eclScratch.length();
  if (L < 1e-4) return out;

  const viewDir = _eclScratch.clone().negate().normalize();
  const screenUp = new THREE.Vector3(0, 1, 0);
  screenUp.addScaledVector(viewDir, -screenUp.dot(viewDir));
  if (screenUp.lengthSq() < 1e-6) return out;
  screenUp.normalize();

  const vFov = (app.camera.fov * Math.PI) / 180;
  // 0.22 of the frame height; the card starts a little under halfway down.
  return out.addScaledVector(screenUp, -0.22 * 2 * L * Math.tan(vFov / 2));
}

/* ----------------------------------------------------- layer interaction */

let activeLayer = null;
let pinned = false;
let overCard = false;
let hoverTimer = null;

/**
 * Hover with a leave buffer.
 *
 * Without it the card flickers: showing the card reflows the label stack,
 * which can move the hovered label out from under the cursor, which hides the
 * card, which reflows it back — a feedback loop. Deferring the clear breaks it,
 * and hovering the card itself counts as staying on the layer.
 */
function requestLayer(layer) {
  clearTimeout(hoverTimer);
  if (layer) {
    setActiveLayer(layer);
    return;
  }
  hoverTimer = setTimeout(() => {
    if (!pinned && !overCard) setActiveLayer(null);
  }, 260);
}

function setActiveLayer(layer) {
  activeLayer = layer;
  cutaway.setHighlight(layer);
  if (!layer) {
    if (!pinned) hud.hideCard();
    return;
  }
  hud.showCard({
    name: layer.name,
    desc: layer.desc,
    accent: layer.accent,
    stats:
      layer.id === 'sunspots'
        ? [
            ['UMBRA TEMP', layer.temp],
            ['CONTRAST', layer.contrast],
            ['LIFETIME', layer.lifetime],
          ]
        : [
            ['TEMPERATURE', layer.temp],
            ['EXTENT', layer.thickness],
            ['DENSITY', layer.density],
          ],
  });
}

function pinLayer(layer) {
  pinned = true;
  setActiveLayer(layer);
}

/* ------------------------------------------------------------------- HUD */

const hud = new HUD(document.getElementById('ui'), {
  onMode: (m) => {
    if (m === mode && m !== 'system') return;
    if (m === mode && m === 'system' && followIndex >= 0) {
      setMode('system');
      return;
    }
    setMode(m);
  },
  onFlare: (kind) => {
    const preset = flares.trigger(kind, app.camera);
    if (!preset) return;
    audio.flare(0.5 + preset.brightness * 0.25);
    hud.log(`FLARE ${preset.readout}`, kind === 'xclass' ? 'alert' : 'warn');
    if (mode === 'section') setMode('surface');
  },
  onAudio: () => {
    // toggle() calls resume() synchronously inside this click handler, which
    // is activation WebKit does accept — so if it took, stop auto-arming.
    const on = audio.toggle();
    if (audio.running) releaseArm();
    hud.setAudio(on);
    hud.log(on ? 'AUDIO BED ENGAGED · SYNTHESISED' : 'AUDIO BED MUTED');
  },
  onCardClose: () => {
    pinned = false;
    overCard = false;
    setActiveLayer(null);
  },
  onCardHover: (entering) => {
    overCard = entering;
    if (entering) clearTimeout(hoverTimer);
    else if (!pinned) requestLayer(null);
  },
  onCardClick: () => {
    if (activeLayer) pinned = true;
  },
  onReset: () => {
    followIndex = -1;
    setTrack(null);
    syncFlares();
    if (eclipseActive()) {
      beginEclipseExit();
      return;
    }
    hud.setResetVisible(false);
    hud.hideCard();
    // Reset means "back to how it started", and orbit is how it starts. MOVE
    // is a deliberate excursion, so it shouldn't outlive the view it was for.
    if (navMode !== 'orbit') setNavMode('orbit');
    const d = systemDistance();
    app.setDistanceLimits(5, d * 1.9);
    app.flyTo({
      position: orbitPosition(d, 0.58),
      target: new THREE.Vector3(),
      duration: 2.6,
      ease: easeInOutCubic,
    });
    hud.log('VIEW RESET · WIDE FIELD');
  },
  onNavMode: (m) => setNavMode(m),
  onEclipse: () => toggleEclipse(),
  onBoot: () => {
    app.flyTo({
      position: orbitPosition(surfaceDistance(), 0.19),
      target: new THREE.Vector3(),
      duration: 4.2,
      ease: easeOutQuint,
    });
    hud.log('OBSERVATION LINK ESTABLISHED');
    hud.log(`RENDER TIER ${QUALITY.tier.toUpperCase()}`);
  },
});

hud.setMode('surface');
setNavMode('orbit');

/**
 * Sound is on by default. Browsers won't let an AudioContext start without a
 * gesture, so we arm it on the first interaction *anywhere* rather than making
 * the viewer hunt for the toggle. The listener is capture-phase: if that first
 * click happens to land on the toggle itself, this turns audio on and the
 * button's own handler then turns it straight back off — which is exactly what
 * someone pressing a control labelled "SOUND ON" expects.
 */
hud.setAudio(true);

// WebKit is fussier about what counts as user activation for audio than the
// pointer events alone suggest, and a drag is not the same thing as a tap, so
// cast a wide net and let every one of them try.
const ARM_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'];
let audioArmed = false;

function releaseArm() {
  if (audioArmed) return;
  audioArmed = true;
  for (const evt of ARM_EVENTS) window.removeEventListener(evt, armAudio, true);
}

function armAudio(e) {
  if (audioArmed) return;

  // Let the sound button speak for itself. Auto-arming on the same gesture
  // would turn audio on and the button's own handler would turn it straight
  // back off, landing on the opposite of what was pressed.
  if (e?.target?.closest?.('.audio-toggle')) return;

  // Deliberately no in-flight guard. WebKit grants audio activation on some
  // gestures and not others — dragging the canvas is one it refuses — and the
  // events it does accept arrive while the pointerdown attempt is still
  // resolving its resume(). Skipping those because an attempt was already in
  // flight threw away exactly the gestures that work, which is why dragging
  // the sun never started the sound but tapping a flare did. start() is
  // idempotent, so letting every gesture have a go is both safe and the point.
  audio.start().then((running) => {
    if (!running || audioArmed) return;
    releaseArm();
    hud.setAudio(audio.on);
    if (audio.on) hud.log('AUDIO BED ENGAGED · SYNTHESISED');
  });
}

for (const evt of ARM_EVENTS) window.addEventListener(evt, armAudio, true);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) audio.resumeIfBackgrounded();
});

// Start well outside, then glide in once the viewer enters.
app.camera.position.set(1.6, 1.4, 9.4);
app.setDistanceLimits(1.32, 11);

/* -------------------------------------------------------------- pointers */

/**
 * Block the browser's own pinch-zoom.
 *
 * iOS Safari has ignored `user-scalable=no` since iOS 10, so a two-finger
 * gesture zoomed the *page* as well as the scene. That is what sent the HUD
 * shrinking into the top-left corner with no way back — the panels are fixed
 * to the viewport, and pinch-zoom moves the viewport out from under them —
 * and what made the render look savagely pixelated, since the browser was
 * upscaling an already-rendered canvas.
 *
 * These are Safari-only events and they don't exist elsewhere, so nothing is
 * taken away from any other browser. OrbitControls still gets the raw touch
 * events, so two-finger zoom of the scene is unaffected.
 */
for (const evt of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
}
// Double-tap to zoom is the other way in, and it isn't covered by the above.
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

app.canvas.addEventListener('pointermove', (e) => {
  updatePointer(e);
  // Cross-section deliberately does NOT pick against the sun: dragging the
  // body to rotate it would otherwise fight a card popping up under the
  // cursor. Layer cards are driven purely by their own labels.
  if (mode === 'system') {
    raycaster.setFromCamera(pointer, app.camera);
    const targets = [...system.meshes, system.asteroid.mesh];
    const hit = raycaster.intersectObjects(targets, false)[0];
    app.canvas.style.cursor = hit ? 'pointer' : '';
  } else {
    app.canvas.style.cursor = '';
  }
});

app.canvas.addEventListener('pointerleave', () => {
  app.canvas.style.cursor = '';
});

// Distinguish a click from an orbit drag.
let downAt = null;
app.canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});

app.canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const held = performance.now() - downAt.t;
  downAt = null;
  if (moved > 6 || held > 450) return;

  updatePointer(e);
  raycaster.setFromCamera(pointer, app.camera);

  if (mode === 'system') {
    const targets = [...system.meshes, system.asteroid.mesh];
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) {
      if (hit.object.userData.asteroid) showAsteroid();
      else {
        const idx = system.meshes.indexOf(hit.object);
        if (idx >= 0) followPlanet(idx);
      }
    }
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hud.setSheet(null);
    pinned = false;
    setActiveLayer(null);
    hud.hideCard();
  }
  if (e.key === '1') setMode('surface');
  if (e.key === '2') setMode('section');
  if (e.key === '3') setMode('system');
});

/* --------------------------------------------------------------- updates */

const controller = {
  update(dt, _time, camera) {
    updateEclipse(dt, camera);

    // The corona has to blaze for the ring to read at all — and to clear the
    // bloom threshold, which is tuned for the photosphere it's normally beside.
    const coronaU = app.sun.coronaMat.uniforms;
    const wantCorona = eclipseActive() ? 1.85 : 0.7;
    coronaU.uIntensity.value += (wantCorona - coronaU.uIntensity.value) * Math.min(1, dt * 1.6);

    // Cross-fades
    fade.system += (fade.systemTarget - fade.system) * Math.min(1, dt * 2.2);
    fade.atmosphere += (fade.atmosphereTarget - fade.atmosphere) * Math.min(1, dt * 2.2);
    system.setOpacity(fade.system);
    app.sun.setAtmosphereFade(fade.atmosphere);

    // Keep the camera glued to whatever we're tracking. Translating alone
    // isn't enough for a heliocentric orbit — the sun would swing round behind
    // the body within half a minute — so the offset rotates with it too.
    if (track && mode === 'system' && !app.tween) {
      track.get(_tmp);
      let dAng = 0;
      if (track.rotateFrame) {
        const ang = Math.atan2(_tmp.x, _tmp.z);
        dAng = ang - track.angle;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        track.angle = ang;
      }
      const camOff = camera.position.clone().sub(track.prev);
      const tgtOff = app.controls.target.clone().sub(track.prev);
      if (dAng !== 0) {
        camOff.applyAxisAngle(Y_AXIS, dAng);
        tgtOff.applyAxisAngle(Y_AXIS, dAng);
      }
      camera.position.copy(_tmp).add(camOff);
      app.controls.target.copy(_tmp).add(tgtOff);
      track.prev.copy(_tmp);
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    // Keep labels clear of the HUD panels, which sit above them in z-order.
    // Phone collapses the side panels into chips, so the only reserved bands
    // are the title strip and the dock + flare row along the bottom edge.
    const landscape = h < 460 && w > h;
    const insets = landscape
      ? { top: 40, bottom: 68 }
      : w < 560
        ? { top: 76, bottom: 128 }
        : { top: 60, bottom: 62 };

    // Planet labels fade in as the system opens up.
    const dist = camera.position.length();
    const planetVis =
      mode === 'system' && !eclipseActive() ? THREE.MathUtils.smoothstep(dist, 9, 20) * fade.system : 0;
    // Every planet keeps its label after you select one — you still need them
    // to navigate. Unselected ones just step back.
    for (const it of planetLabels.items) {
      // 0.62, not 0.5: labels below 0.55 have pointer-events switched off so
      // fading ones don't eat taps, and dimming the unselected planets to 0.5
      // took every one of them out of play the moment you picked a planet.
      // Ceres is on a different layer, which is why it alone stayed clickable.
      it.target = planetVis * (followIndex >= 0 && it.id !== followIndex ? 0.62 : 1);
    }
    for (const it of objectLabels.items) it.target = planetVis;

    // Moons only earn labels once you're actually near their planet.
    let moonDetail = 0;
    if (mode === 'system' && fade.system > 0.4 && !eclipseActive()) {
      for (const rec of moonLabels.items) {
        const m = system.moons[rec.id];
        system.worldPosition(m.planetIndex, _tmp);
        const d = camera.position.distanceTo(_tmp);
        const r = m.planet.radius;
        const near = 1 - THREE.MathUtils.smoothstep(d, r * 11, r * 30);
        rec.target = near * fade.system;
        moonDetail = Math.max(moonDetail, near);
      }
    } else {
      for (const rec of moonLabels.items) rec.target = 0;
    }
    system.setMoonDetail(moonDetail * fade.system);

    // Layer label opacity deliberately does NOT depend on which layer is
    // active — changing it re-runs de-collision, which shifts labels under the
    // cursor and causes the hover to flicker. The active one gets a CSS class
    // instead, which changes nothing about layout.
    const layerVis = THREE.MathUtils.smoothstep(cutaway.open, 0.25, 0.7);
    for (const it of layerLabels.items) {
      it.target = layerVis;
      it.el.classList.toggle('is-active', !!activeLayer && activeLayer.id === it.id);
    }

    // One layout pass over every layer, so nothing lands on top of anything.
    updateLabelLayers([planetLabels, objectLabels, moonLabels, layerLabels], dt, camera, w, h, insets);


  },
};
app.modules.push(controller);

app.on('quality', (tier) => hud.log(`QUALITY AUTO-SCALED TO ${tier.toUpperCase()}`, 'warn'));

/**
 * Keep the framing sane when the viewport changes shape (phone rotation,
 * window resize): scale the current distance by how much the ideal framing
 * distance moved, so the user's own zoom level is preserved relative to it.
 */
let lastIdeal = null;
function idealDistance() {
  return mode === 'system' ? systemDistance() : mode === 'section' ? sectionDistance() : surfaceDistance();
}

app.on('resize', () => {
  const next = idealDistance();
  if (lastIdeal && !app.tween) {
    const dir = app.camera.position.clone().sub(app.controls.target);
    const d = dir.length();
    if (d > 1e-4) {
      dir.multiplyScalar((d * next) / lastIdeal / d);
      app.camera.position.copy(app.controls.target).add(dir);
    }
  }
  lastIdeal = next;
  if (mode === 'system') app.setDistanceLimits(5, next * 1.9);
});

app.start();

window.__sun = { app, system, flares, cutaway, hud, audio, setMode };
