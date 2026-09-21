import { PLANETS, ROADSTER } from './data.js';

const DEG = Math.PI / 180;

/** Julian Day from a JS Date. Good to the second, which is far beyond need. */
export function julianDay(date = new Date()) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly.
 * Newton-Raphson; at e = 0.26 this converges in three or four steps.
 */
function eccentricAnomaly(M, e) {
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 24; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

const TAU = Math.PI * 2;
const wrap = (x) => ((x % TAU) + TAU) % TAU;

/**
 * Propagate the Roadster from its JPL epoch elements to a given moment.
 *
 * Two-body Kepler only. The real object is perturbed by the planets, but over
 * the handful of years either side of the epoch the drift is far smaller than
 * anything this readout claims.
 */
export function roadsterState(date = new Date()) {
  const el = ROADSTER.elements;
  const jd = julianDay(date);
  const dt = jd - el.epochJD;

  const M = wrap((el.M0 + el.n * dt) * DEG);
  const e = el.e;
  const E = eccentricAnomaly(M, e);

  // True anomaly and radius from the eccentric anomaly.
  const nu = wrap(
    2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)),
  );
  const r = el.a * (1 - e * Math.cos(E));

  // Rotate the orbital plane into ecliptic coordinates.
  const u = el.peri * DEG + nu;
  const i = el.i * DEG;
  const om = el.node * DEG;
  const cu = Math.cos(u), su = Math.sin(u);
  const co = Math.cos(om), so = Math.sin(om);
  const ci = Math.cos(i), si = Math.sin(i);

  const pos = {
    x: r * (co * cu - so * su * ci),
    y: r * (so * cu + co * su * ci),
    z: r * (su * si),
  };

  // M runs 0 at perihelion, so the fraction still to go gives the wait.
  const daysToPerihelion = ((TAU - M) / TAU) * ROADSTER.periodDays;

  return { jd, r, nu, M, pos, daysToPerihelion, inbound: nu > Math.PI };
}

/**
 * Earth's heliocentric position, low-precision series from the Astronomical
 * Almanac. Accurate to about 0.0002 AU, which is nothing next to the tens of
 * millions of kilometres this is used to report.
 */
export function earthState(date = new Date()) {
  const n = julianDay(date) - 2451545.0;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const L = (280.460 + 0.9856474 * n) * DEG;
  const lambdaSun = L + 1.915 * DEG * Math.sin(g) + 0.020 * DEG * Math.sin(2 * g);
  const r = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const lambda = lambdaSun + Math.PI; // Earth as seen from the Sun
  return { r, pos: { x: r * Math.cos(lambda), y: r * Math.sin(lambda), z: 0 } };
}

/** Straight-line distance from Earth to the Roadster, in AU. */
export function roadsterEarthDistance(date = new Date()) {
  const a = roadsterState(date).pos;
  const b = earthState(date).pos;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Map a real orbital radius onto the scene's compressed one by interpolating
 * through the planets themselves, so anything placed this way lands in the
 * right gap: inside Earth's ring, just past Mars's, and so on.
 */
export function auToScene(au) {
  const t = PLANETS;
  if (au <= t[0].au) return (au / t[0].au) * t[0].orbit;
  for (let k = 0; k < t.length - 1; k++) {
    if (au <= t[k + 1].au) {
      const f = (au - t[k].au) / (t[k + 1].au - t[k].au);
      return t[k].orbit + f * (t[k + 1].orbit - t[k].orbit);
    }
  }
  const last = t[t.length - 1];
  return last.orbit * (au / last.au);
}
