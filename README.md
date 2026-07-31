# SOL–1 · Interactive Heliophysics Observatory

A real-time WebGL exploration of the Sun: a procedurally shaded plasma surface,
a volumetric corona, triggerable solar flares, an animated interior
cross-section, and a zoom-out to the whole solar system — wrapped in a mission
control HUD.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

```bash
npm run build     # production bundle in dist/
npm run preview   # serve the built bundle
```

## What's in it

**Surface view** — The photosphere is a single fragment shader. Granulation is
Worley (cellular) noise rather than FBM: `F2 − F1` goes to exactly zero on a
cell boundary, which gives the dark intergranular lanes directly, while `F1`
gives the bright cell centres. Two generations at different scales run with
their feature points drifting quickly, so cells genuinely split and reform —
the pot-on-the-boil look — over a slow FBM brightness swell and ridged-noise
magnetic filaments underneath. A quadratic limb-darkening law
(`0.30 + 0.94μ − 0.24μ²`) dims the edge the way the real disc does. Sunspots are a sparse low-frequency
field masked to the active latitude bands either side of the equator, with dark
umbrae, filamented penumbrae and bright faculae around them. The whole texture
shears with latitude, so the equator leads the poles — but by a *bounded*
angle, recomputed on the CPU each frame rather than accumulated in the shader.
A latitude-dependent angle that grows without limit winds a static noise field
up like a spring, and since the twist and the feature size both scale as
1/frequency, every layer smears at the same rate: after half an hour each
granule is stretched across ~80 granule widths and the disc collapses into
horizontal ribbons. The real photosphere never winds up either — granules live
about ten minutes and differential rotation takes a month to lap, so a cell is
destroyed and reformed long before the shear can stretch it.

**Corona** — Not a shell. For each pixel the shader solves for the camera ray's
closest approach to the sun and evaluates an analytic three-term exponential
density profile there, so the glow falls off smoothly to nothing instead of
ending on a visible sphere edge. Streamer structure is sampled from 3D noise in
world space, so it stays put as you orbit, and the streamer belt is biased
toward the equator.

**Flares** — Three GOES classes, each picking a footpoint on the visible limb
and building a cubic-Bézier magnetic loop. The body is a *bundle* of thin
strands, each offset onto its own helix around that loop, so the eruption reads
as braided filaments rather than one fat tube. Colour is driven by a cooling
ramp — white-hot at ignition, falling through yellow and orange to deep
chromospheric red as the plasma expands. Brightness follows a real light curve:
a near-instant impulsive rise, then a long exponential decay. The ignition
flash peaks well above the bloom threshold so the postprocessing pass actually
fires. Moderate and X-class eruptions also disturb the photosphere itself — an
expanding Moreton-style wave (bright crest, rarefied trough behind) plus a
local flash across the granulation, so the flare reads as coming *out of* the
surface rather than floating in front of it. The tiers differ in strand count,
twist, flash peak, shockwave strength and decay length, not just size.

**Cross-section** — Two world-space clipping planes with `clipIntersection`
carve a wedge out of the sun (a fragment survives if *either* plane keeps it,
so only the wedge is removed). Nested shells show the core, radiative and
convective zones; two banded half-discs sit on the cut planes. The opening is
aimed off the view axis so you see both the banded slice and into the cavity.
Cards are driven by the layer *labels* only — the sun body itself is purely
something you grab and rotate, so dragging it never fights a card appearing
under the cursor. Hovering the card counts as staying on its layer, and the
matching region highlights. Sunspots get their own card even though they aren't
a layer.

**System view** — All eight planets on visible orbit rings, correctly ordered.
Distances and sizes are compressed so the system reads in one frame, and
orbital rates are compressed from the true period ratios (`period^0.45`) so the
inner planets don't blur past. Click any planet to track it — the camera rides
in that planet's *rotating* frame, so the sun stays where it was rather than
swinging round behind it. Once the sun shrinks to a few pixels a distance-scaled
glare card takes over so it still reads as a blazing point source.

**Planet surfaces** — One shader with five compile-time variants, so a gas giant
never pays for crater code:

| Type | Surface |
|---|---|
| Rocky (Mercury, Mars, most moons) | Worley crater fields at three scales — the per-cell id decides which cells are craters, the distance shapes the bowl and its raised rim — plus FBM terrain, bump-mapped. Mars gets polar caps. |
| Earth | Real coastlines. See below. |
| Venus | Thick superrotating sulphuric cloud deck: domain-warped FBM with heavy latitude shear and a bright polar hood. |
| Earth (detail) | Hand-simplified coastline outlines for every major landmass, rasterised at load into an equirectangular land mask (`scene/earthMap.js`) and sampled with a noise warp so the shoreline isn't visibly polygonal. Drives continental shelves, latitude-banded biomes, inland mountains, ice caps, a drifting cloud shell and an atmospheric rim. Only open water takes a specular glint. |
| Gas giants | Zonal bands warped by turbulence so they meander and curl, storm ovals confined to the mid latitudes, and a fixed Great Red Spot on Jupiter. |
| Ice giants | Fewer, softer bands; Neptune carries a dark oval. |

Icy moons (Europa, Enceladus, Triton…) shift to a brighter, bluer palette cut
through by linear fracture systems.

**Moons** — 18 major moons orbit their planets on faint traces, in the planet's
own tilted equatorial plane (so Uranus's swing nearly vertical). Names fade in
as you approach. Only the major moons are drawn to keep the view clean; each
planet's card states the full known count.

**Total solar eclipse** — A button in System View slides the Moon into
alignment and puts the camera *behind* it, looking back at the Sun: the classic
totality shot, with the Moon as a dark silhouette and the corona blazing out
around its edge. It needs no new shader work. The camera sits at the distance
where the two discs subtend the same angle — solving R_moon / x = R_sun / (x + L)
for x, a hair closer so the Moon just overfills the disc — and from there the
Moon is an ordinary opaque mesh that occludes the photosphere by itself, while
the corona (a large back-side sphere that discards inside the disc) has its
inner edge exactly where the ring wants to be. The corona is boosted during
totality so the ring clears the bloom threshold, which is otherwise tuned for
the photosphere sitting next to it. The eclipsed state is persistent: only the
slide-in and slide-out are animated, so nothing times out while you read the
card. END ECLIPSE slides the Moon back out and returns to the wide shot.

**Ceres** — The largest body in the asteroid belt, on its own inclined orbit
between Mars and Jupiter, with a cratered icy surface and a dust trail. Clickable
for a card covering what it is, its 4.6-year orbit and its composition. The trail
is stylised: Ceres does outgas water vapour, but not as a persistent visible tail.

**Audio** — On by default. Browsers won't let an AudioContext start without a
gesture, so it arms on the first interaction *anywhere* rather than making you
hunt for the toggle. Arming only stands down once the context is confirmed
`running`; a gesture Safari declines leaves the listener in place to try again.
Every gesture gets its own attempt, including ones arriving while an earlier
attempt is still resolving — WebKit accepts some gestures and refuses others
(a drag is not a tap), and the events it does accept land while the pointerdown
attempt is still in flight,
and the panel reports the real state rather than the intended one. The session
is declared `playback` via `navigator.audioSession`, without which iOS silences
Web Audio whenever the ringer switch is set to silent — the reason sound could
work on a Mac and an iPad but not on an iPhone. The context is also resumed on
`visibilitychange`, since iOS suspends it on an app switch and never restores
it by itself. A synthesised bed: sub-bass sines with slow beating, a
stacked saw drone through a breathing low-pass, and brown noise through a
sweeping band-pass. Flares add a swept whoosh, a low swell and a scatter of
crackle transients, front-loaded onto the impulsive phase. Everything routes
through one bus, so the toggle and master fade govern all of it. **This is an
artistic sonic interpretation, not a recording** — no NASA helioseismology data
is used.

## Camera ownership

One rule: **exactly one system writes the camera per frame, and a scripted move
always writes last.**

This is not stylistic. `OrbitControls.update()` contains no reference to
`this.enabled` — that flag only gates input handlers. Every call re-derives the
camera from its own spherical state, folds in `autoRotate` and any leftover
damping, then unconditionally rewrites `position` and calls `lookAt(target)`.
So the controls cannot be switched off for a scripted move; they can only be
made to lose. The frame loop therefore runs the controls first, then the tween,
then the modules (trackers and the totality lock), and finally issues a single
`camera.lookAt(controls.target)` so orientation has one writer that runs after
every position writer and can never aim from where the camera used to be.
`autoRotate` is suppressed for the duration of any scripted move.

Held shots take exclusive ownership via `app.lockCamera(true)`. Totality also
pins Earth's orbital advance: re-solving the alignment against a moving Earth
keeps the Moon *aligned* but not *still*, so the whole arrangement — camera
vantage included — creeps along the orbit.

## Performance

Device capability is detected once at boot (GPU renderer string, core count,
device memory, pointer type) and picks a `high` / `medium` / `low` tier that
sets pixel ratio, sphere tessellation, star count, flare particle budget, bloom
resolution and shader octave count. Point-sprite sizes are clamped well inside
the driver's limit (511 px on this Mac) — an unclamped sprite drifting near the
near plane can be sized in the thousands of pixels, which is out of spec. If the first four seconds can't hold 26 fps
the tier drops once more and the surface shader is recompiled with fewer
octaves. There is no manual toggle — it scales itself.

## Data

Figures in the readouts and info cards are real, rounded published values (core
15.7 million °C, photosphere 5,505 °C, radius 696,340 km, sunspot umbrae
~3,500 °C against a ~5,500 °C surface, and so on). Moon counts are the
currently confirmed totals (Jupiter 95, Saturn 274, Uranus 28, Neptune 16) —
these creep upward as surveys find more, so treat them as of-this-writing.
Planet distances are given in AU, km and miles, derived from the IAU value for
the astronomical unit and each planet's semi-major axis. Layer
proportions follow the actual structure — core to 0.25 R☉, radiative zone to
0.7 R☉, convective zone to the surface. The three atmospheric layers are given
exaggerated visual thickness so they're visible at all; their true thicknesses
are quoted in the cards.

## Controls

| | |
|---|---|
| Drag | Orbit (or pan, in MOVE mode) |
| Scroll / pinch | Zoom |
| ORBIT / MOVE | Orbit the current target, or fly the camera freely |
| RESET VIEW | Appears once you're tracking something; returns to the full system |
| SOLAR ECLIPSE | System View only; slides the Moon into totality and holds it |
| END ECLIPSE | Same button once active; slides the Moon back out |
| `1` `2` `3` | Surface / Cross-section / System |
| `Esc` | Dismiss info card |

Orbiting is always about the current target, which is awkward once that target
is a planet on an outer ring — MOVE hands the left button to panning and
releases the follow lock so you can go anywhere.

## Layout

```
src/
  app.js              renderer, composer, camera rig, frame loop
  main.js             view-mode controller, picking, label wiring
  quality.js          device tiering + runtime downgrade
  data.js             astrophysical figures, planets, flare presets
  shaders/            noise + cellular chunk, sun/corona/glare, planet GLSL
  format.js           AU / km / mi formatting
  scene/              sun, starfield, solarSystem, flares, cutaway,
                      earthMap, asteroid
  ui/                 HUD chrome, 3D-anchored labels, styles
  audio/              synthesised ambience
```
