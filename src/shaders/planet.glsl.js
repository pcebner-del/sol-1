import { NOISE_GLSL } from './noise.glsl.js';

/**
 * One shader, five surfaces. Each planet material compiles with exactly one
 * TYPE_* define, so a gas giant never pays for crater code and a rocky world
 * never pays for cloud bands.
 *
 * All surfaces are procedural — nothing is fetched, so there are no texture
 * downloads and the detail holds up at any zoom level.
 */

export const PLANET_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vTan1;
varying vec3 vTan2;

void main(){
  vec3 pObj = normalize(position);
  vObj = pObj;
  vNormalW = normalize(mat3(modelMatrix) * normal);

  // World-space tangent frame, built here because modelMatrix is only
  // available to the vertex stage — the fragment shader needs this frame to
  // turn a height gradient into a perturbed normal.
  vec3 upo = abs(pObj.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1o = normalize(cross(upo, pObj));
  vec3 t2o = cross(pObj, t1o);
  vTan1 = mat3(modelMatrix) * t1o;
  vTan2 = mat3(modelMatrix) * t2o;

  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PLANET_FRAG = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uSeed;
uniform float uOpacity;
uniform float uTime;
uniform vec3  uCameraPos;
uniform float uBump;
uniform float uCraters;
uniform float uRough;
uniform float uCaps;
uniform float uBandFreq;
uniform float uBandWarp;
uniform float uStorm;
uniform float uIcy;

#if defined(TYPE_EARTH)
uniform sampler2D uLandMap;
#endif

varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vTan1;
varying vec3 vTan2;

/* ----------------------------------------------------------- height field */

#if defined(TYPE_ROCKY)
/**
 * Crater field. Worley gives us the distance to the nearest feature point and
 * a per-cell random id — the id decides whether a given cell is a crater at
 * all (otherwise every cell becomes one and it reads as a golf ball), and the
 * distance shapes the bowl and its raised rim.
 */
float craterField(vec3 p, float scale, float thresh){
  vec3 w = worley(p * scale, 0.0);
  if (w.z < thresh) return 0.0;
  float d = w.x;
  float bowl = -(1.0 - smoothstep(0.0, 0.30, d));
  float rim = exp(-pow((d - 0.31) * 10.0, 2.0)) * 0.62;
  return (bowl * 0.9 + rim) * smoothstep(0.95, 0.70, w.z);
}

float heightAt(vec3 p){
  float h = fbm(p * 3.2 + uSeed, 4, 2.05, 0.5) * 0.55;
  h += fbm(p * 13.0, 3, 2.0, 0.5) * 0.22 * uRough;
  h += craterField(p + uSeed, 7.0, 0.42) * 0.85 * uCraters;
  h += craterField(p + uSeed * 2.3, 19.0, 0.52) * 0.42 * uCraters;
  #if PLANET_DETAIL > 1
    h += craterField(p + uSeed * 3.7, 44.0, 0.62) * 0.20 * uCraters;
  #endif
  return h;
}
#endif

#if defined(TYPE_EARTH)
/** Equirectangular lookup from a direction on the unit sphere. */
vec2 equirect(vec3 p){
  return vec2(
    atan(p.z, p.x) / 6.28318531 + 0.5,
    asin(clamp(p.y, -1.0, 1.0)) / 3.14159265 + 0.5
  );
}

/**
 * Real coastlines from the rasterised outline map, with a little noise warp so
 * the shoreline isn't visibly polygonal when you get close.
 */
vec2 landSample(vec3 p){
  vec3 warp = vec3(
    fbm(p * 7.0 + uSeed, 3, 2.0, 0.5),
    fbm(p * 7.0 + uSeed + 3.3, 3, 2.0, 0.5),
    fbm(p * 7.0 + uSeed + 8.1, 3, 2.0, 0.5)
  );
  vec3 wp = normalize(p + warp * 0.012);
  return texture2D(uLandMap, equirect(wp)).rg;
}

float heightAt(vec3 p){
  vec2 m = landSample(p);
  float land = m.r;
  float coast = m.g;                  // ~1 near the coastline, 0 deep inland
  float ranges = turbulence(p * 9.0 + uSeed, 3, 2.0, 0.55) - 0.70;
  // Mountains build inland; coasts stay low so the bump doesn't cliff there.
  return land * (0.25 + 0.85 * (1.0 - coast)) * (0.55 + 1.1 * ranges);
}
#endif

/* ------------------------------------------------------------ bump normal */

vec3 surfaceNormal(vec3 p, vec3 fallback){
#if (defined(TYPE_ROCKY) || defined(TYPE_EARTH)) && PLANET_DETAIL > 0
  float e = 0.0045;

  // Sample the height field along an object-space tangent frame...
  vec3 up = abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, p));
  vec3 t2 = cross(p, t1);

  float h0 = heightAt(p);
  float d1 = (heightAt(normalize(p + t1 * e)) - h0) / e;
  float d2 = (heightAt(normalize(p + t2 * e)) - h0) / e;

  // Coastlines and crater rims are near-discontinuous in the height field, so
  // the raw finite-difference gradient can spike to hundreds and scramble the
  // normal into noise. Cap it before it perturbs anything.
  float g = length(vec2(d1, d2));
  if (g > 9.0) {
    d1 *= 9.0 / g;
    d2 *= 9.0 / g;
  }

  // ...then apply it in the matching world-space frame from the vertex stage.
  vec3 Nw = normalize(vNormalW);
  vec3 bend = normalize(vTan1) * d1 + normalize(vTan2) * d2;
  return normalize(Nw - bend * uBump * 0.055);
#else
  return fallback;
#endif
}

/* ----------------------------------------------------------------- albedo */

vec3 albedo(vec3 p, out float gloss){
  gloss = 0.0;

#if defined(TYPE_ROCKY)
  float h = heightAt(p);
  float mottle = fbm(p * 6.0 + uSeed * 1.7, 4, 2.0, 0.5);
  vec3 col = mix(uColorB, uColorA, clamp(0.5 + h * 0.9 + mottle * 0.8, 0.0, 1.0));

  // Fresh impacts expose brighter material; crater floors pool darker dust.
  col *= 1.0 + clamp(h, 0.0, 1.0) * 0.35;
  col = mix(col, col * 0.62, clamp(-h * 1.4, 0.0, 1.0));

  // Icy bodies: brighter, bluer, and cut through by linear fracture systems.
  if (uIcy > 0.001){
    float cracks = 1.0 - smoothstep(0.0, 0.05, abs(turbulence(p * 7.0 + uSeed, 3, 2.1, 0.5) - 0.78));
    vec3 ice = mix(vec3(0.86, 0.89, 0.93), vec3(0.62, 0.70, 0.78), mottle * 0.5 + 0.25);
    ice = mix(ice, vec3(0.55, 0.42, 0.34), cracks * 0.55);
    col = mix(col, ice, uIcy);
  }

  // Polar caps (Mars).
  if (uCaps > 0.001){
    float cap = smoothstep(0.74, 0.90, abs(p.y) + fbm(p * 8.0, 3, 2.0, 0.5) * 0.14);
    col = mix(col, vec3(0.92, 0.93, 0.95), cap * uCaps);
  }
  return col;
#endif

#if defined(TYPE_VENUS)
  // Thick, featureless-from-orbit sulphuric cloud deck: heavy latitude shear
  // plus domain warping, animated slowly. Venus's clouds superrotate.
  float t = uTime * 0.05;
  vec3 q = vec3(
    fbm(p * 2.2 + vec3(t, 0.0, 0.0) + uSeed, 4, 2.0, 0.55),
    fbm(p * 2.2 + vec3(0.0, t, 0.0) + uSeed + 3.1, 4, 2.0, 0.55),
    fbm(p * 2.2 + vec3(0.0, 0.0, t) + uSeed + 7.7, 4, 2.0, 0.55)
  );
  vec3 sp = vec3(p.x * 1.6, p.y * 5.5, p.z * 1.6) + q * 2.2;
  float swirl = fbm(sp, 5, 2.05, 0.55);
  float fine = turbulence(sp * 3.4, 3, 2.0, 0.5) - 0.7;

  vec3 col = mix(uColorB, uColorA, clamp(0.5 + swirl * 1.5 + fine * 0.7, 0.0, 1.0));
  // The poles carry Venus's bright hood.
  col = mix(col, vec3(0.94, 0.88, 0.72), smoothstep(0.72, 0.98, abs(p.y)) * 0.5);
  return col;
#endif

#if defined(TYPE_EARTH)
  vec2 m = landSample(p);
  float land = m.r;
  float coast = m.g;
  float h = heightAt(p);

  // --- ocean: continental shelf shallows near the coast, deep blue offshore
  float shelf = smoothstep(0.05, 0.45, coast);
  vec3 sea = mix(vec3(0.045, 0.150, 0.390), vec3(0.090, 0.330, 0.530), shelf);

  // --- land: latitude-banded biomes plus elevation
  float lat = abs(p.y);
  float arid = smoothstep(0.12, 0.32, lat) * (1.0 - smoothstep(0.34, 0.52, lat));
  float veg = fbm(p * 9.0 + uSeed * 2.2, 4, 2.0, 0.5) * 0.5 + 0.5;

  vec3 forest = vec3(0.115, 0.265, 0.105);
  vec3 plain = vec3(0.310, 0.350, 0.165);
  vec3 desert = vec3(0.660, 0.520, 0.285);
  vec3 rock = vec3(0.400, 0.365, 0.330);

  vec3 ground = mix(forest, plain, veg);
  ground = mix(ground, desert, arid * (0.45 + 0.55 * veg));
  ground = mix(ground, rock, smoothstep(0.45, 1.00, h));
  // Boreal belt reads darker and greener than the temperate zone.
  ground = mix(ground, vec3(0.095, 0.190, 0.115), smoothstep(0.60, 0.78, lat) * 0.7);

  vec3 col = mix(sea, ground, land);

  // --- ice: the poles, plus Greenland and Antarctica from the map itself
  float capNoise = fbm(p * 11.0, 3, 2.0, 0.5) * 0.05;
  float cap = smoothstep(0.86, 0.955, lat + capNoise);
  cap = max(cap, land * smoothstep(0.80, 0.90, lat + capNoise));
  cap = max(cap, land * step(0.75, -p.y));          // Antarctica
  col = mix(col, vec3(0.90, 0.93, 0.96), clamp(cap, 0.0, 1.0));

  // Only open water is glossy.
  gloss = (1.0 - land) * (1.0 - clamp(cap, 0.0, 1.0));
  return col;
#endif

#if defined(TYPE_GAS) || defined(TYPE_ICE)
  float t = uTime * 0.02;

  // Zonal flow: bands are warped by turbulence so they meander and curl into
  // each other at the shear boundaries instead of sitting in flat stripes.
  vec3 wp = vec3(p.x * 2.2, p.y * 1.2, p.z * 2.2);
  float warp = fbm(wp + vec3(t, 0.0, t * 0.7) + uSeed, 5, 2.05, 0.55);
  float warp2 = fbm(wp * 3.1 + vec3(t * 1.7, 0.0, 0.0) + uSeed, 4, 2.0, 0.5);

  float y = p.y + warp * uBandWarp + warp2 * uBandWarp * 0.45;
  float band = sin(y * uBandFreq) * 0.5 + 0.5;
  // Sharpen alternate bands so the belts and zones differ in character.
  band = mix(band, smoothstep(0.25, 0.75, band), 0.7);

  float detail = turbulence(vec3(p.x * 5.0, p.y * 26.0, p.z * 5.0) + vec3(t * 2.0, 0.0, 0.0), 4, 2.0, 0.5) - 0.7;

  vec3 col = mix(uColorB, uColorA, clamp(band + detail * 0.75, 0.0, 1.0));
  col *= 0.80 + 0.42 * band;

  // Storm ovals: cells stretched along longitude, only in the mid latitudes.
  if (uStorm > 0.01){
    vec3 sp = vec3(p.x * 3.0, p.y * 14.0, p.z * 3.0) + vec3(t * 3.0, 0.0, 0.0);
    vec3 sw = worley(sp, 0.0);
    float ovals = (1.0 - smoothstep(0.0, 0.42, sw.x)) * step(0.72, sw.z);
    ovals *= smoothstep(0.05, 0.25, abs(p.y)) * (1.0 - smoothstep(0.5, 0.75, abs(p.y)));
    col = mix(col, col * vec3(1.25, 1.05, 0.85), ovals * uStorm * 0.7);
  }

  // Darkened poles, as on every giant.
  col *= 1.0 - smoothstep(0.62, 1.0, abs(p.y)) * 0.30;

  #ifdef GREAT_SPOT
    // The Great Red Spot: a fixed anticyclone in the southern hemisphere,
    // elliptical (much wider than tall) with a swirling interior.
    float lon = atan(p.z, p.x);
    float dLon = lon - 2.1;
    dLon = atan(sin(dLon), cos(dLon));
    float dLat = p.y + 0.32;
    float rr = length(vec2(dLon * 0.55, dLat * 2.4));
    float swirl = fbm(vec3(dLon * 6.0, dLat * 14.0, uTime * 0.05), 4, 2.0, 0.5);
    float spot = (1.0 - smoothstep(0.16, 0.46, rr + swirl * 0.07));
    col = mix(col, vec3(0.72, 0.26, 0.14) * (0.75 + 0.6 * swirl), spot * 0.92);
    col = mix(col, vec3(0.92, 0.72, 0.55), smoothstep(0.40, 0.50, rr) * spot * 0.5);
  #endif

  #ifdef DARK_SPOT
    // Neptune's transient dark oval.
    float lon = atan(p.z, p.x);
    float dLon = lon + 1.1;
    dLon = atan(sin(dLon), cos(dLon));
    float dLat = p.y - 0.30;
    float rr = length(vec2(dLon * 0.7, dLat * 2.8));
    float spot = 1.0 - smoothstep(0.12, 0.38, rr);
    col = mix(col, vec3(0.06, 0.12, 0.32), spot * 0.85);
  #endif

  return col;
#endif

  return uColorA;
}

/* ------------------------------------------------------------------- main */

void main(){
  vec3 p = normalize(vObj);
  vec3 N = surfaceNormal(p, normalize(vNormalW));
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 L = normalize(-vWorld);          // the sun sits at the origin
  float ndl = dot(N, L);

  float gloss = 0.0;
  vec3 base = albedo(p, gloss);

  // A pure smoothstep saturates to 1 across most of the lit hemisphere, which
  // flattens every bump normal into nothing — detail then only survives near
  // the terminator. Keep a raw cosine term so relief shades everywhere, and
  // use the smoothstep only to soften the terminator itself.
  float diffuse = max(ndl, 0.0);
  float soft = smoothstep(-0.16, 0.14, ndl);
  float lambert = diffuse * 0.80 + soft * 0.32;
  vec3 col = base * (0.055 + 1.05 * lambert);

  // Specular glint, only where the surface is actually smooth (water, ice).
  if (gloss > 0.01){
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 60.0) * gloss * lambert;
    col += vec3(1.0, 0.96, 0.88) * spec * 0.18;
  }

  // Warm sliver along the lit limb.
  float rim = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 3.0);
  col += vec3(1.0, 0.66, 0.34) * rim * smoothstep(-0.35, 0.55, ndl) * 0.24;

  // Hold planets under the bloom threshold. The threshold is tuned so the Sun
  // blooms hard; an ice cap or a sunglint left unclamped sails past it too and
  // buries the whole planet in a white halo.
  col = min(col, vec3(0.95));

  gl_FragColor = vec4(col * uOpacity, uOpacity);
}
`;

/* ------------------------------------------------------------ cloud layer */

export const CLOUD_FRAG = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform float uTime;
uniform float uOpacity;
uniform vec3  uCameraPos;
uniform float uSeed;

varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;

void main(){
  vec3 p = normalize(vObj);
  float t = uTime * 0.012;

  // Weather systems: warped fbm sheared along latitude so bands of cloud
  // stretch east-west the way real circulation cells do.
  vec3 q = vec3(
    fbm(p * 2.4 + vec3(t, 0.0, 0.0) + uSeed, 4, 2.0, 0.5),
    fbm(p * 2.4 + vec3(0.0, t, 0.0) + uSeed + 2.3, 4, 2.0, 0.5),
    fbm(p * 2.4 + vec3(0.0, 0.0, t) + uSeed + 5.9, 4, 2.0, 0.5)
  );
  float c = fbm(vec3(p.x * 3.0, p.y * 5.2, p.z * 3.0) + q * 1.6, 5, 2.05, 0.55);
  float wisps = turbulence(p * 11.0 + q * 2.0, 3, 2.0, 0.5) - 0.70;

  float cover = smoothstep(0.22, 0.58, c + wisps * 0.45);
  // The tropics and the storm belts carry more cloud than the horse latitudes.
  float lat = abs(p.y);
  cover *= 0.50 + 0.38 * (1.0 - smoothstep(0.10, 0.36, lat)) + 0.26 * smoothstep(0.42, 0.70, lat);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(-vWorld);
  float lambert = smoothstep(-0.16, 0.26, dot(N, L));

  float a = clamp(cover, 0.0, 1.0) * uOpacity * 0.55;
  if (a < 0.004) discard;

  vec3 col = min(vec3(1.0, 0.99, 0.97) * (0.06 + 0.88 * lambert), vec3(0.92));
  gl_FragColor = vec4(col * a, a);
}
`;

/* ------------------------------------------------------------- atmosphere */

export const ATMO_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform float uOpacity;
uniform float uPower;
uniform vec3  uCameraPos;

varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;

void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 L = normalize(-vWorld);

  float rim = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), uPower);
  // Air only scatters where the sun actually hits it.
  float lit = smoothstep(-0.55, 0.35, dot(N, L));

  float a = rim * lit * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/* ------------------------------------------------------------- ring plane */

export const RING_VERT = /* glsl */ `
uniform float uInner;
uniform float uOuter;
varying float vR;
varying vec3  vWorld;
void main(){
  float d = length(position.xy);
  vR = (d - uInner) / max(uOuter - uInner, 1e-4);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const RING_FRAG = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uOpacity;

varying float vR;
varying vec3  vWorld;

void main(){
  float r = clamp(vR, 0.0, 1.0);

  // Thousands of ringlets: fine banded noise at several scales.
  float fine = fbm(vec3(r * 210.0, 0.0, 0.0), 3, 2.0, 0.5);
  float mid = fbm(vec3(r * 46.0, 5.0, 0.0), 4, 2.0, 0.5);
  float coarse = fbm(vec3(r * 11.0, 9.0, 0.0), 3, 2.0, 0.5);

  float density = 0.52 + 0.34 * mid + 0.22 * fine + 0.28 * coarse;

  // The Cassini Division and a couple of lesser gaps.
  density *= 1.0 - 0.92 * exp(-pow((r - 0.62) * 22.0, 2.0));
  density *= 1.0 - 0.55 * exp(-pow((r - 0.30) * 46.0, 2.0));
  density *= 1.0 - 0.40 * exp(-pow((r - 0.86) * 40.0, 2.0));

  // Soft inner and outer edges.
  density *= smoothstep(0.0, 0.05, r) * smoothstep(1.0, 0.90, r);
  density = clamp(density, 0.0, 1.0);

  vec3 col = mix(uColorB, uColorA, clamp(0.35 + mid * 0.8 + fine * 0.4, 0.0, 1.0));

  float a = density * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a * 1.15, a);
}
`;
