/**
 * 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) plus fbm helpers.
 * Shared by the sun surface, corona, interior layers and planet shaders.
 */
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p, int octaves, float lacunarity, float gain){
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    sum += amp * snoise(p);
    norm += amp;
    p *= lacunarity;
    amp *= gain;
  }
  return sum / max(norm, 1e-4);
}

// Ridged / turbulent variant — gives the stringy filament look of plasma.
//
// The max() is not cosmetic. Simplex noise can overshoot |1| slightly, so
// 1 - |snoise| goes negative, and callers that multiply the result into a
// colour then emit negative RGB. Under additive blending that *subtracts*,
// and a single negative texel drags a whole bloom mip block negative, which
// upsamples into a flickering black square. Clamped here, at the source.
float turbulence(vec3 p, int octaves, float lacunarity, float gain){
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= octaves) break;
    sum += amp * max(0.0, 1.0 - abs(snoise(p)));
    norm += amp;
    p *= lacunarity;
    amp *= gain;
  }
  return sum / max(norm, 1e-4);
}

// ---------------------------------------------------------------- cellular

vec3 hash33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

/**
 * Worley / cellular noise.
 * Returns (F1, F2, cellId): distance to the nearest feature point, distance to
 * the second nearest, and a per-cell random value. F2 - F1 goes to zero
 * exactly on a cell boundary, which is what gives us dark intergranular lanes
 * and crater rims for free.
 *
 * The drift argument wanders the feature points over time so cells split and
 * reform instead of just sliding around.
 */
vec3 worley(vec3 p, float drift){
  vec3 ip = floor(p);
  vec3 fp = fract(p);

  float f1 = 8.0, f2 = 8.0, id = 0.0;

  for (int x = -1; x <= 1; x++){
    for (int y = -1; y <= 1; y++){
      for (int z = -1; z <= 1; z++){
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 h = hash33(ip + g);
        vec3 o = h;
        if (drift > 0.0) {
          // Three incommensurate rates so the cells wander quasi-randomly
          // instead of oscillating back and forth on one shared period.
          o = h + 0.42 * vec3(
            sin(drift * 1.00 + 6.2831853 * h.x),
            sin(drift * 1.37 + 6.2831853 * h.y),
            sin(drift * 0.83 + 6.2831853 * h.z)
          );
        }
        vec3 d = g + o - fp;
        float dist = dot(d, d);
        if (dist < f1){
          f2 = f1;
          f1 = dist;
          id = h.x;
        } else if (dist < f2){
          f2 = dist;
        }
      }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

`;
