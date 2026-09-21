/**
 * Astrophysical reference data.
 * Figures are rounded/approximate but accurate to published values.
 */

/**
 * Corner readouts. Rows with `jitter` tick around their true value each
 * refresh so the panel reads like a live instrument feed.
 */
export const SUN_FACTS = [
  { key: 'PHOTOSPHERE', base: 5505, jitter: 7, dec: 0, unit: '°C' },
  { key: 'CORE', base: 15.7, jitter: 0.03, dec: 2, unit: '×10⁶ °C' },
  { key: 'CORONA', base: 1.4, jitter: 0.12, dec: 2, unit: '×10⁶ °C' },
  { key: 'MEAN RADIUS', text: '696,340', unit: 'km' },
  { key: 'MASS', text: '1.989×10³⁰', unit: 'kg' },
  { key: 'LUMINOSITY', text: '3.828×10²⁶', unit: 'W' },
  { key: 'SOLAR WIND', base: 428, jitter: 22, dec: 0, unit: 'km/s' },
  { key: 'AGE', text: '4.603', unit: 'Gyr' },
  { key: 'SPECTRAL CLASS', text: 'G2V', unit: 'main seq.' },
];

/**
 * Interior layers. `r0`/`r1` are fractions of the solar radius.
 * The three atmospheric layers are given exaggerated visual thickness
 * (`vr0`/`vr1`) so they are actually visible — real values are in `thickness`.
 */
export const LAYERS = [
  {
    id: 'core',
    name: 'CORE',
    r0: 0.0,
    r1: 0.25,
    vr0: 0.0,
    vr1: 0.25,
    color: '#fff6d8',
    accent: '#ffd76a',
    temp: '15,700,000 °C',
    thickness: '0 – 174,000 km (0–0.25 R☉)',
    density: '150 g/cm³',
    desc: 'Where hydrogen fuses into helium at 600 million tonnes per second. Every photon of sunlight begins here.',
  },
  {
    id: 'radiative',
    name: 'RADIATIVE ZONE',
    r0: 0.25,
    r1: 0.7,
    vr0: 0.25,
    vr1: 0.7,
    color: '#ffb347',
    accent: '#ff8a2b',
    temp: '7,000,000 → 2,000,000 °C',
    thickness: '~313,000 km thick',
    density: '20 → 0.2 g/cm³',
    desc: 'Energy crawls outward as radiation, scattering endlessly. A single photon can take 100,000 years to cross it.',
  },
  {
    id: 'convective',
    name: 'CONVECTIVE ZONE',
    r0: 0.7,
    r1: 1.0,
    vr0: 0.7,
    vr1: 1.0,
    color: '#ff6a1f',
    accent: '#ff4d00',
    temp: '2,000,000 → 5,500 °C',
    thickness: '~209,000 km thick',
    density: '0.2 → 0.0000002 g/cm³',
    desc: 'Plasma boils in giant convection cells, carrying heat to the surface. Its churn generates the solar magnetic field.',
  },
  {
    id: 'photosphere',
    name: 'PHOTOSPHERE',
    r0: 1.0,
    r1: 1.0007,
    vr0: 1.0,
    vr1: 1.022,
    color: '#ffd27a',
    accent: '#ffae3c',
    temp: '5,505 °C',
    thickness: '~400 km',
    density: '0.0000002 g/cm³',
    desc: 'The visible surface — a granular sea of rising cells the size of Texas. Sunspots here are cooler magnetic bruises.',
  },
  {
    id: 'chromosphere',
    name: 'CHROMOSPHERE',
    r0: 1.0007,
    r1: 1.003,
    vr0: 1.022,
    vr1: 1.06,
    color: '#ff4d5e',
    accent: '#ff2740',
    temp: '4,100 → 20,000 °C',
    thickness: '~2,000 km',
    density: '10⁻⁹ g/cm³',
    desc: 'A ragged rose-red shell of hydrogen, visible only in eclipse. Spicules of plasma jet upward through it constantly.',
  },
  {
    id: 'corona',
    name: 'CORONA',
    r0: 1.003,
    r1: 2.2,
    vr0: 1.06,
    vr1: 2.05,
    color: '#9fd8ff',
    accent: '#5fb6ff',
    temp: '1,000,000 – 3,000,000 °C',
    thickness: 'millions of km',
    density: '10⁻¹⁵ g/cm³',
    desc: 'The outer atmosphere, mysteriously 200× hotter than the surface. It streams away as the solar wind at 400 km/s.',
  },
];

/**
 * Planets. Distances and sizes are compressed (log-ish) so the whole system
 * is legible in one frame, but ordering, relative ranking and orbital periods
 * are faithful. `au` / `realRadius` / `period` hold the true values.
 */
export const PLANETS = [
  {
    name: 'MERCURY', au: 0.387, orbit: 4.2, radius: 0.085, period: 88, speed: 4.15,
    type: 'rocky', color: '#9b8f86', color2: '#5f574f', tilt: 0.001,
    craters: 1.0, bump: 1.7, rough: 1.0,
    moonCount: 0, moonNote: 'No moons — too close to the Sun to hold one.',
    fact: 'No atmosphere · 430 °C day, −180 °C night.',
    moons: [],
  },
  {
    name: 'VENUS', au: 0.723, orbit: 5.9, radius: 0.17, period: 225, speed: 1.62,
    type: 'venus', color: '#e8cfa0', color2: '#b98d45', tilt: 3.09,
    moonCount: 0, moonNote: 'No moons.',
    fact: 'Runaway greenhouse · surface 464 °C',
    moons: [],
  },
  {
    name: 'EARTH', au: 1.0, orbit: 7.8, radius: 0.185, period: 365, speed: 1.0,
    type: 'earth', color: '#3f7fd4', color2: '#2c6b3f', tilt: 0.41, bump: 0.55,
    moonCount: 1, moonNote: '1 moon; the Moon is shown here.',
    fact: 'The only world we know of with liquid surface water.',
    moons: [{ name: 'MOON', r: 0.27, d: 2.9, speed: 1.0, color: '#a8a29b', icy: 0 }],
  },
  {
    name: 'MARS', au: 1.524, orbit: 10.0, radius: 0.12, period: 687, speed: 0.53,
    type: 'rocky', color: '#c1552e', color2: '#7d3418', tilt: 0.44,
    craters: 0.55, bump: 1.4, rough: 0.9, caps: 1.0,
    moonCount: 2, moonNote: '2 moons; both Phobos and Deimos are shown.',
    fact: 'Olympus Mons · 22 km tall',
    moons: [
      { name: 'PHOBOS', r: 0.11, d: 2.1, speed: 2.4, color: '#8a7a6e', icy: 0 },
      { name: 'DEIMOS', r: 0.08, d: 3.0, speed: 1.4, color: '#7d6f64', icy: 0 },
    ],
  },
  {
    name: 'JUPITER', au: 5.204, orbit: 15.5, radius: 0.54, period: 4333, speed: 0.084,
    type: 'gas', color: '#d8b78e', color2: '#8f5c34', tilt: 0.05,
    bandFreq: 26.0, bandWarp: 0.10, storm: 1.0,
    moonCount: 95, moonNote: '95 known moons; the four largest — the Galilean moons — are shown here.',
    fact: '318 Earth masses · 400-year storm',
    moons: [
      { name: 'IO', r: 0.15, d: 1.85, speed: 2.6, color: '#e8d268', icy: 0 },
      { name: 'EUROPA', r: 0.13, d: 2.35, speed: 1.7, color: '#d9cfc0', icy: 1 },
      { name: 'GANYMEDE', r: 0.19, d: 3.05, speed: 1.1, color: '#9d9186', icy: 0.4 },
      { name: 'CALLISTO', r: 0.18, d: 3.85, speed: 0.7, color: '#7a6d62', icy: 0 },
    ],
  },
  {
    name: 'SATURN', au: 9.583, orbit: 20.5, radius: 0.47, period: 10759, speed: 0.034,
    type: 'gas', color: '#e6d6a8', color2: '#a8894f', tilt: 0.47,
    bandFreq: 20.0, bandWarp: 0.06, storm: 0.25, ring: [0.35, 1.15],
    moonCount: 274, moonNote: '274 known moons; the five largest are shown here.',
    fact: 'Rings only ~20 m thick',
    moons: [
      { name: 'MIMAS', r: 0.07, d: 3.1, speed: 2.3, color: '#b9b2a8', icy: 0.7 },
      { name: 'ENCELADUS', r: 0.08, d: 3.5, speed: 1.8, color: '#e6eef2', icy: 1 },
      { name: 'RHEA', r: 0.12, d: 4.0, speed: 1.2, color: '#bdb5aa', icy: 0.6 },
      { name: 'TITAN', r: 0.21, d: 4.7, speed: 0.8, color: '#d9a05c', icy: 0 },
      { name: 'IAPETUS', r: 0.11, d: 5.5, speed: 0.5, color: '#8e8377', icy: 0.3 },
    ],
  },
  {
    name: 'URANUS', au: 19.19, orbit: 25.5, radius: 0.31, period: 30687, speed: 0.012,
    type: 'ice', color: '#9fdfe2', color2: '#5e9ea8', tilt: 1.71,
    bandFreq: 12.0, bandWarp: 0.04, storm: 0.1,
    moonCount: 28, moonNote: '28 known moons; the five largest are shown here.',
    fact: 'Rolls on its side · 98° axial tilt',
    moons: [
      { name: 'MIRANDA', r: 0.07, d: 2.0, speed: 2.5, color: '#c4c0b8', icy: 0.8 },
      { name: 'ARIEL', r: 0.10, d: 2.5, speed: 1.8, color: '#c9c3b8', icy: 0.7 },
      { name: 'UMBRIEL', r: 0.10, d: 3.0, speed: 1.3, color: '#7f7871', icy: 0.2 },
      { name: 'TITANIA', r: 0.13, d: 3.6, speed: 0.9, color: '#b3aaa0', icy: 0.5 },
      { name: 'OBERON', r: 0.12, d: 4.2, speed: 0.65, color: '#9c9188', icy: 0.4 },
    ],
  },
  {
    name: 'NEPTUNE', au: 30.07, orbit: 30.0, radius: 0.29, period: 60190, speed: 0.006,
    type: 'ice', color: '#3f63c9', color2: '#22376f', tilt: 0.49,
    bandFreq: 14.0, bandWarp: 0.07, storm: 0.6,
    moonCount: 16, moonNote: '16 known moons; Triton, by far the largest, is shown here.',
    fact: 'Fastest winds in the system · 2,100 km/h',
    moons: [{ name: 'TRITON', r: 0.19, d: 3.0, speed: 1.0, color: '#d6cfc4', icy: 0.9 }],
  },
];

/**
 * Not a layer of the Sun, but the most recognisable feature of the one you can
 * see — so it gets its own card in the cross-section view.
 */
export const SUNSPOT_INFO = {
  id: 'sunspots',
  name: 'SUNSPOTS',
  accent: '#c4642a',
  temp: '~3,500 °C',
  contrast: '~5,500 °C surrounding surface',
  lifetime: 'Days to months',
  desc:
    'Cooler, darker patches on the photosphere where concentrated magnetic field lines choke off the convection carrying heat up from below. They only look black by contrast — a sunspot is still glowing fiercely, just dimmer than the surface around it. They typically appear in pairs or clusters of opposite magnetic polarity, and their number rises and falls over the roughly 11-year solar cycle.',
};

export const FLARE_PRESETS = {
  minor: {
    label: 'C-CLASS',
    sub: 'MINOR',
    scale: 0.45,
    height: 0.20,
    duration: 3.0,
    brightness: 0.80,
    particles: 0.8,
    strands: 3,        // a small localised lick of plasma
    twist: 0.35,
    flashPeak: 1.6,
    shockwave: 0.0,    // too small to disturb the surface
    readout: 'C4.2 · minor radio blackout',
  },
  moderate: {
    label: 'M-CLASS',
    sub: 'MODERATE',
    scale: 0.85,
    height: 0.50,
    duration: 4.8,
    brightness: 1.10,
    particles: 1.9,
    strands: 5,        // a clear braided loop
    twist: 0.85,
    flashPeak: 3.2,
    shockwave: 0.22,
    readout: 'M6.8 · polar HF degradation',
  },
  xclass: {
    label: 'X-CLASS',
    sub: 'EXTREME',
    scale: 1.30,
    height: 0.88,
    duration: 8.5,     // a long decay tail
    brightness: 1.55,
    particles: 3.4,
    strands: 9,        // a dense braid of filaments
    twist: 1.45,
    flashPeak: 7.5,    // well past the bloom threshold
    shockwave: 0.62,
    readout: 'X9.3 · CME · geomagnetic storm',
  },
};


/**
 * Ceres — the largest object in the asteroid belt and the only dwarf planet
 * inside Neptune's orbit. Figures from Dawn (2015–18).
 */
export const ASTEROID = {
  name: 'CERES',
  kind: '1 Ceres · dwarf planet',
  orbit: 12.6,          // scene units, between Mars and Jupiter
  radius: 0.075,
  inclination: 0.185,   // real inclination is 10.6° to the ecliptic
  rate: 0.030,
  color: '#7d7469',
  color2: '#463f38',
  icy: 0.35,
  au: 2.77,
  period: '4.60 years',
  diameter: '939 km',
  desc:
    'The largest body in the asteroid belt, and the only dwarf planet inside Neptune. It holds about a quarter of the belt\u2019s entire mass and is round enough for its own gravity to have pulled it into a sphere.',
  composition:
    'A rocky core under a crust of water ice and hydrated clays: carbonates, ammoniated phyllosilicates, and bright sodium-carbonate salt deposits in Occator crater left by briny water reaching the surface.',
  waterNote: 'Roughly 25% water ice by mass — more fresh water than Earth has.',
};

/** Totality explainer for the System View demonstration. */
export const ECLIPSE_INFO = {
  name: 'TOTAL SOLAR ECLIPSE',
  accent: '#ffd76a',
  desc:
    'You are behind the Moon, looking back at the Sun. The Moon has slid across the solar disc and blocked it completely, leaving only the corona — the Sun\u2019s million-degree outer atmosphere, normally invisible against the glare of the surface.',
  stats: [
    ['WHY IT WORKS', 'The Moon is 400× smaller than the Sun and 400× closer'],
    ['HOW LONG', 'Totality lasts at most 7 min 32 s; usually 2–3 min'],
    ['AT ONE SPOT', 'A given place sees totality about once in 375 years'],
    ['HOW OFTEN', 'A total eclipse somewhere on Earth every ~18 months'],
    ['WHAT YOU SEE', 'Corona, prominences, and the horizon lit all round'],
  ],
};

/**
 * Elon Musk's Tesla Roadster, the dummy payload of the first Falcon Heavy.
 *
 * The orbital elements are the real ones: JPL Horizons osculating elements for
 * object -143205 (SpaceX Roadster), heliocentric, ecliptic J2000, at epoch
 * JD 2461302.5 (2026-09-19 TDB). They drive the live readout in the card. The
 * orbit *drawn* in the scene is compressed on the same radial scale as the
 * planets, so it keeps its shape — crossing Earth's ring at perihelion,
 * reaching past Mars at aphelion — without the inner system collapsing.
 */
export const ROADSTER = {
  name: 'STARMAN',
  kind: 'Tesla Roadster · Falcon Heavy test payload',
  size: 0.26,          // scene units, nose to tail — a deliberate exaggeration
  followSize: 4.3,     // multiples of that length to sit back when tracking

  // JPL Horizons, object -143205, epoch JD 2461302.5 (2026-09-19 TDB).
  elements: {
    epochJD: 2461302.5,
    a: 1.325282785724952,      // AU
    e: 0.2559431977004283,
    i: 1.074791897978510,      // degrees, to the ecliptic
    node: 316.8730122426341,   // longitude of ascending node, degrees
    peri: 177.7859072410449,   // argument of perihelion, degrees
    M0: 234.5613385419072,     // mean anomaly at epoch, degrees
    n: 0.6460129716962592,     // mean motion, degrees/day
  },

  perihelionAU: 0.9860856716891764,
  aphelionAU: 1.664479899760728,
  periodDays: 557.2643519134534,
  speed: 365.25 / 557.2643519134534,   // relative to Earth, for the scene rate

  launched: '6 Feb 2018 · 20:45 UTC',
  vehicle: 'Falcon Heavy FH-001 · Kennedy Space Center LC-39A',
  inclinationText: '1.07\u00b0 to the ecliptic',

  desc:
    'A cherry-red Tesla Roadster with a mannequin in a SpaceX pressure suit at the wheel, thrown into orbit around the Sun on the first flight of Falcon Heavy. It is still out there, and its orbit is tracked by JPL like any other object in the solar system.',

  why:
    'A maiden rocket flight carries a mass simulator rather than a real satellite, because it may well not survive. That ballast is normally concrete or steel blocks; Musk sent his own car instead, on the grounds that the boring option would be a waste of the occasion.',

  cargo:
    'A towel and a dashboard reading DON\u2019T PANIC, a copy of The Hitchhiker\u2019s Guide to the Galaxy, a Hot Wheels Roadster with its own tiny Starman, a plaque carrying the names of the SpaceX staff who built the rocket, Asimov\u2019s Foundation trilogy etched on a quartz disc, and a circuit board reading \u201cMade on Earth by humans\u201d. The stereo was left looping Bowie\u2019s Space Oddity \u2014 in a vacuum, to nobody.',

  fate:
    'It can never actually reach Mars. At 1.07\u00b0 its orbit is tilted too little to cross Mars\u2019s, so it only ever passes the planet\u2019s distance, never the planet.',

  decay:
    'Unshielded, the paint, leather and tyres will have been broken up by ultraviolet light and micrometeoroids within about a year of launch. The aluminium frame and carbon fibre last far longer \u2014 what is out there now is, in effect, a metal sculpture of a car.',

  passedMars: 'Oct 2020 \u00b7 about 8 million km',
  nextEarth: '2047 \u00b7 about 5 million km',
  odds: '~6% it hits Earth, 2.5% Venus, within 3 Myr',

  spin: '4.76 min per rotation',
};
