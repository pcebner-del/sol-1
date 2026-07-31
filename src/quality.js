/**
 * Automatic device-capability detection.
 * No user-facing toggle: we pick a tier once at boot and adapt again at
 * runtime if the frame budget is consistently blown.
 */

function detectGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { renderer: '', maxTex: 2048 };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    return { renderer: renderer.toLowerCase(), maxTex };
  } catch {
    return { renderer: '', maxTex: 2048 };
  }
}

const TIERS = {
  high: {
    tier: 'high',
    pixelRatio: 2,
    sunSegments: 192,
    coronaSegments: 128,
    layerSegments: 128,
    starCount: 5200,
    starLayers: 3,
    flareParticles: 900,
    flareTubeSegments: 96,
    bloom: { strength: 1.25, radius: 0.85, threshold: 1.02 },
    bloomResolution: 1.0,
    noiseOctaves: 6,
    granulation: true,
    worleyOctaves: 2,
    planetDetail: 2,
    coronaShells: 3,
    grain: true,
  },
  medium: {
    tier: 'medium',
    pixelRatio: 2,
    sunSegments: 128,
    coronaSegments: 96,
    layerSegments: 96,
    starCount: 2800,
    starLayers: 2,
    flareParticles: 460,
    flareTubeSegments: 64,
    bloom: { strength: 1.15, radius: 0.82, threshold: 1.02 },
    bloomResolution: 0.75,
    noiseOctaves: 5,
    granulation: true,
    worleyOctaves: 1,
    planetDetail: 1,
    coronaShells: 2,
    grain: true,
  },
  low: {
    tier: 'low',
    pixelRatio: 1.25,
    sunSegments: 80,
    coronaSegments: 64,
    layerSegments: 64,
    starCount: 1300,
    starLayers: 2,
    flareParticles: 220,
    flareTubeSegments: 40,
    bloom: { strength: 1.0, radius: 0.75, threshold: 1.05 },
    bloomResolution: 0.5,
    noiseOctaves: 3,
    granulation: true,
    worleyOctaves: 1,
    planetDetail: 0,
    coronaShells: 2,
    grain: false,
  },
};

function pickTier() {
  const ua = navigator.userAgent || '';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || (coarse && navigator.maxTouchPoints > 1);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || (isMobile ? 4 : 8);
  const { renderer } = detectGPU();

  const weakGPU = /(adreno [1-5]\d\d|mali-[tg]?\s?[1-6]\d?\d|powervr|videocore|swiftshader|llvmpipe|software)/i.test(
    renderer,
  );
  const strongGPU = /(apple m[1-9]|apple a1[5-9]|rtx|radeon rx|geforce gtx 1[06-9]|arc a)/i.test(renderer);

  // Safari tells us almost nothing about an iPhone or iPad: WebGL reports a
  // bare "Apple GPU" for every device ever made, deviceMemory doesn't exist,
  // and hardwareConcurrency is commonly capped at 4. Run through the generic
  // heuristics below and every modern iPhone lands on the lowest tier — which
  // is what was capping the pixel ratio at 1.25 on a 3x display and cutting
  // the sphere tessellation, so zooming in looked pixelated and faceted.
  // Start these optimistically instead; the fps-based downgrade already exists
  // to catch the devices that genuinely can't hold it.
  const appleMobile = /iphone|ipad|ipod/i.test(ua) || (/\bMac/.test(ua) && navigator.maxTouchPoints > 1);
  if (appleMobile) return /apple gpu|apple m[1-9]|apple a1[4-9]/i.test(renderer) ? 'medium' : 'low';

  if (weakGPU || cores <= 4 || mem <= 3) return 'low';
  if (isMobile) return strongGPU && cores >= 6 ? 'medium' : 'low';
  if (cores <= 6 && !strongGPU) return 'medium';
  return 'high';
}

const key = pickTier();

export const QUALITY = {
  ...TIERS[key],
  isMobile: window.matchMedia('(pointer: coarse)').matches,
  isTouch: navigator.maxTouchPoints > 0,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  devicePixelRatio: Math.min(window.devicePixelRatio || 1, TIERS[key].pixelRatio),
};

/** Runtime downgrade: called by the render loop if we can't hold frame rate. */
export function degrade() {
  if (QUALITY.tier === 'low') return false;
  const next = QUALITY.tier === 'high' ? 'medium' : 'low';
  Object.assign(QUALITY, TIERS[next]);
  QUALITY.devicePixelRatio = Math.min(window.devicePixelRatio || 1, TIERS[next].pixelRatio);
  return true;
}
