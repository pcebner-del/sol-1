import { NOISE_GLSL } from './noise.glsl.js';

export const SUN_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>

varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main(){
  vObjPos = normalize(position);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  vec4 mvPosition = viewMatrix * worldPos;
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const SUN_FRAG = /* glsl */ `
precision highp float;

#include <clipping_planes_pars_fragment>

${NOISE_GLSL}

uniform float uTime;
uniform float uActivity;      // 0..1, spikes when flares fire
uniform float uBrightness;
uniform float uSpots;         // sunspot strength
uniform vec3  uCameraPos;

// Surface disturbance driven by an erupting flare: a ring travelling outward
// from the footpoint plus a local flash across the granulation near it.
uniform vec3  uFlareDir;      // footpoint direction, in this mesh's local space
uniform float uFlareAge;      // seconds since ignition
uniform float uFlarePower;    // 0 = none

varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

vec3 rotY(vec3 p, float a){
  float s = sin(a), c = cos(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Blackbody-ish plasma ramp: ember red -> orange -> gold -> white hot.
vec3 plasmaRamp(float x){
  x = clamp(x, 0.0, 1.0);
  vec3 c = vec3(0.220, 0.020, 0.002);
  c = mix(c, vec3(0.700, 0.095, 0.008), smoothstep(0.00, 0.22, x));
  c = mix(c, vec3(1.000, 0.280, 0.025), smoothstep(0.18, 0.44, x));
  c = mix(c, vec3(1.000, 0.520, 0.080), smoothstep(0.38, 0.62, x));
  c = mix(c, vec3(1.000, 0.760, 0.240), smoothstep(0.56, 0.80, x));
  c = mix(c, vec3(1.000, 0.930, 0.620), smoothstep(0.76, 0.93, x));
  c = mix(c, vec3(1.000, 0.995, 0.940), smoothstep(0.90, 1.00, x));
  return c;
}

void main(){
  #include <clipping_planes_fragment>

  vec3 dir  = normalize(vObjPos);
  vec3 N    = normalize(vWorldNormal);
  vec3 V    = normalize(uCameraPos - vWorldPos);
  float mu  = clamp(dot(N, V), 0.0, 1.0);

  float t = uTime;

  // Differential rotation — the equator laps the poles.
  float lat = dir.y;
  float shear = t * (0.030 + 0.024 * (1.0 - lat * lat));
  vec3 p = rotY(dir, shear);

  // Domain warp drives the big convective churn.
  vec3 q = vec3(
    fbm(p * 2.1 + vec3(0.0, 0.0, t * 0.050), OCTAVES, 2.0, 0.5),
    fbm(p * 2.1 + vec3(5.2, 1.3, t * 0.045), OCTAVES, 2.0, 0.5),
    fbm(p * 2.1 + vec3(1.7, 9.2, t * 0.055), OCTAVES, 2.0, 0.5)
  );

  // Slow, large-scale brightness swell underneath everything. Barely moves —
  // translating noise is what makes a surface read as "flowing", and the
  // photosphere should read as boiling in place.
  float cells = fbm(p * 4.6 + q * 1.2 + vec3(0.0, t * 0.012, 0.0), OCTAVES, 2.05, 0.55);
  // Ridged noise for the stringy magnetic network (mean ~0.7, recentre on zero).
  float filament = turbulence(p * 13.0 + q * 1.8 - vec3(0.0, t * 0.020, 0.0), 4, 2.0, 0.55) - 0.70;

  // --- Granulation ---------------------------------------------------------
  // The photosphere is a pot on the boil: irregular convection cells with hot
  // bright centres and cool dark lanes where neighbouring cells collide. That
  // is a Worley cell structure, not an FBM wave — F2-F1 vanishes exactly on a
  // cell boundary, giving us the intergranular lanes for free. The feature
  // points wander fast, so cells split, merge and reform in place.
  float gran = 0.0;

  #ifdef GRANULATION
    // Warp the sampling position so the cells aren't on a regular lattice.
    vec3 gp = p + q * 0.05;

    vec3 w1 = worley(gp * 44.0, t * 2.6);
    float lane1 = smoothstep(0.0, 0.13, w1.y - w1.x);   // 0 exactly in the lanes
    float dome1 = 1.0 - smoothstep(0.0, 0.62, w1.x);    // hot cell centre
    gran += (lane1 * 0.66 + dome1 * 0.34 - 0.5) * 1.30;

    #if WORLEY_OCTAVES > 1
      // A second, finer and faster generation on top: real granulation has no
      // single characteristic size.
      vec3 w2 = worley(gp * 104.0 + vec3(11.3), t * 4.4);
      float lane2 = smoothstep(0.0, 0.17, w2.y - w2.x);
      float dome2 = 1.0 - smoothstep(0.0, 0.60, w2.x);
      gran += (lane2 * 0.66 + dome2 * 0.34 - 0.5) * 0.62;
    #endif

    // A little ridged noise keeps the cell interiors from looking plastic.
    gran += (turbulence(p * 150.0 + vec3(t * 0.30, 0.0, t * 0.18), 2, 2.15, 0.5) - 0.70) * 0.34;
  #endif

  // Granulation carries most of the texture; the smooth layers only tint it.
  float raw = 0.52 + cells * 0.20 + filament * 0.30 + gran * 1.05;
  float heat = pow(clamp(raw, 0.0, 1.0), 1.15);

  // Sunspot groups: rare, small, and confined to the active latitude bands
  // either side of the equator (the butterfly diagram).
  vec3 sp = rotY(dir, t * 0.028);
  float latBand = exp(-pow((abs(dir.y) - 0.26) / 0.19, 2.0));
  float spotField = fbm(sp * 5.0 + vec3(3.1, t * 0.012, 0.0), 4, 2.0, 0.5) + 0.20 * latBand;
  float penTex = turbulence(sp * 58.0 + vec3(0.0, t * 0.03, 0.0), 3, 2.0, 0.5) - 0.70;

  float spotOn  = uSpots * latBand;
  // Near-black umbral core...
  float umbra = smoothstep(0.520, 0.590, spotField + penTex * 0.08);
  // ...ringed by a lighter, radially filamented penumbra.
  float penumbra = smoothstep(0.440, 0.525, spotField) * (0.60 + 1.30 * penTex);

  // Bright faculae crowd the edges of active regions.
  float plage = smoothstep(0.36, 0.44, spotField) * (1.0 - smoothstep(0.42, 0.50, spotField));
  heat += plage * spotOn * 0.34 * (0.4 + 0.6 * (filament + 0.70));

  // Flares heat the whole disc slightly.
  heat += uActivity * 0.045 * (0.5 + 0.5 * filament);

  // --- Surface disturbance -------------------------------------------------
  if (uFlarePower > 0.001) {
    float ang = acos(clamp(dot(dir, normalize(uFlareDir)), -1.0, 1.0));

    // An expanding annulus, like a Moreton wave running across the disc: a
    // bright compressed crest with a darker rarefied trough behind it.
    float front = uFlareAge * 0.85;
    float crest = exp(-pow((ang - front) / 0.095, 2.0));
    float trough = exp(-pow((ang - front + 0.17) / 0.12, 2.0)) * 0.55;
    float wave = (crest - trough) * exp(-uFlareAge * 0.5) * smoothstep(0.0, 0.10, front);

    // A hard local flash over the granulation right at ignition.
    float flash = exp(-pow(ang / 0.32, 2.0)) * exp(-uFlareAge * 4.5);

    heat += (wave * 1.15 + flash * 1.10) * uFlarePower;
  }

  // Limb darkening (Eddington-style quadratic law), normalised to 1 at disc centre.
  float limb = 0.30 + 0.94 * mu - 0.24 * mu * mu;

  // Granulation only ever modulates the top of the range; spots cut *below*
  // that floor, which is what makes them read as genuinely dark.
  float base = mix(0.52, 0.97, clamp(heat, 0.0, 1.2));
  base *= mix(1.0, 0.42, clamp(penumbra * spotOn, 0.0, 1.0));
  base *= mix(1.0, 0.11, clamp(umbra * spotOn, 0.0, 1.0));

  float intensity = clamp(base * limb, 0.0, 1.05);

  vec3 col = plasmaRamp(intensity);
  col *= 0.45 + 0.85 * intensity;

  // Chromospheric rim: a thin hot lip right at the silhouette.
  float rim = pow(1.0 - mu, 6.0);
  col += vec3(1.0, 0.30, 0.13) * rim * (0.55 + 0.45 * filament);

  col *= uBrightness * (1.0 + 0.10 * uActivity);

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Thin additive shell — used for the chromosphere lip. */
export const SHELL_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>

varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main(){
  vObjPos = normalize(position);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const SHELL_FRAG = /* glsl */ `
precision highp float;

#include <clipping_planes_pars_fragment>

${NOISE_GLSL}

uniform float uTime;
uniform float uActivity;
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uPower;
uniform float uIntensity;
uniform float uFade;
uniform vec3  uCameraPos;

varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main(){
  #include <clipping_planes_fragment>

  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);
  float mu = abs(dot(N, V));
  float rim = pow(clamp(1.0 - mu, 0.0, 1.0), uPower);

  vec3 p = normalize(vObjPos);
  float t = uTime;

  // Spicules: fine jets rooted in the chromosphere.
  float spic = turbulence(vec3(p.x * 26.0, p.y * 9.0, p.z * 26.0) + vec3(0.0, t * 0.5, 0.0), 3, 2.1, 0.5);
  float flicker = fbm(p * 5.0 + vec3(t * 0.3, t * 0.2, 0.0), 3, 2.0, 0.5);

  float a = rim * (0.55 + 0.75 * spic) * (0.85 + 0.25 * flicker);
  a *= uIntensity * (1.0 + 0.35 * uActivity) * uFade;

  vec3 col = mix(uColorA, uColorB, clamp(rim * 0.8 + 0.3 * spic, 0.0, 1.0));
  gl_FragColor = vec4(col * a, clamp(a, 0.0, 1.0));
}
`;

/**
 * Volumetric corona.
 *
 * Rendered on the inside of a large sphere. For every pixel we solve for the
 * ray's closest approach to the sun and evaluate an analytic exponential
 * density profile there — so the glow falls off smoothly to nothing instead of
 * ending on a visible shell edge, and the streamer structure is real 3D noise
 * sampled in world space (it stays put as you orbit).
 */
export const CORONA_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main(){
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const CORONA_FRAG = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform vec3  uCameraPos;
uniform float uTime;
uniform float uActivity;
uniform float uIntensity;
uniform float uExtent;     // multiplies all scale heights
uniform vec3  uColorHot;
uniform vec3  uColorMid;
uniform vec3  uColorCool;
uniform float uFade;

varying vec3 vWorldPos;

void main(){
  vec3 ro = uCameraPos;
  vec3 rd = normalize(vWorldPos - ro);

  // Sun sits at the origin of this object's parent space.
  vec3 oc = -ro;
  float tc = dot(oc, rd);
  vec3 closest = ro + rd * max(tc, 0.0);
  float b = length(closest);

  // Inside the disc the photosphere wins; skip it entirely.
  if (b < 1.0) discard;

  float x = (b - 1.0) / max(uExtent, 0.05);

  // Three exponential scale heights: bright inner corona, structured mid
  // corona, and a faint extended halo bleeding into the solar wind.
  float inner = exp(-x / 0.075) * 0.80;
  float mid   = exp(-x / 0.30) * 0.42;
  float far   = exp(-x / 1.30) * 0.13;

  vec3 sp = normalize(closest);
  float t = uTime;

  // Streamers: purely directional noise -> radial ray structure.
  float streamer = turbulence(vec3(sp.x * 3.1, sp.y * 1.35, sp.z * 3.1) + vec3(0.0, t * 0.025, 0.0), 4, 2.1, 0.55);
  float fine = turbulence(vec3(sp.x, sp.y, sp.z) * 7.5 + vec3(0.0, t * 0.05, 0.0), 3, 2.2, 0.5);

  // The streamer belt hugs the equator; the poles run thin open field.
  float belt = mix(0.42, 1.0, 1.0 - abs(sp.y) * 0.85);
  float shape = belt * (0.55 + 0.85 * streamer) * (0.80 + 0.35 * fine);

  float dens = inner * (0.55 + 0.55 * shape) + mid * shape + far * shape * 0.9;
  dens *= sqrt(clamp(b, 1.0, 8.0));           // longer chords further out
  dens *= uIntensity * (1.0 + 0.30 * uActivity) * uFade;

  vec3 col = uColorHot;
  col = mix(col, uColorMid, smoothstep(0.0, 0.55, x));
  col = mix(col, uColorCool, smoothstep(0.5, 2.2, x));

  float a = clamp(dens, 0.0, 1.0);
  if (dens < 0.0015) discard;
  gl_FragColor = vec4(col * dens, a);
}
`;

/**
 * Star glare — a camera-facing card scaled with distance so the sun keeps a
 * constant, brilliant on-screen presence once it is only a few pixels wide.
 */
export const GLARE_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GLARE_FRAG = /* glsl */ `
precision mediump float;
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;

void main(){
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;

  float core = exp(-pow(r * 11.0, 1.7));
  float halo = exp(-pow(r * 3.2, 1.15)) * 0.34;

  // Diffraction spikes, gently breathing.
  float breathe = 0.9 + 0.1 * sin(uTime * 0.7);
  float sx = pow(max(0.0, 1.0 - abs(c.y) * 150.0), 2.0) * exp(-abs(c.x) * 5.0);
  float sy = pow(max(0.0, 1.0 - abs(c.x) * 150.0), 2.0) * exp(-abs(c.y) * 5.0);
  float d1 = pow(max(0.0, 1.0 - abs(c.x - c.y) * 190.0), 2.0) * exp(-r * 6.0);
  float d2 = pow(max(0.0, 1.0 - abs(c.x + c.y) * 190.0), 2.0) * exp(-r * 6.0);

  float g = core + halo + (sx + sy) * 0.55 * breathe + (d1 + d2) * 0.28;
  g *= smoothstep(1.0, 0.7, r) * uOpacity;
  if (g < 0.003) discard;

  vec3 col = mix(uColorA, uColorB, clamp(r * 1.6, 0.0, 1.0));
  gl_FragColor = vec4(col * g * 1.5, clamp(g, 0.0, 1.0));
}
`;
