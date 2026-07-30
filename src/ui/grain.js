/**
 * Film grain, rasterised once into a bitmap.
 *
 * This used to be an inline SVG `feTurbulence` filter set as a repeating CSS
 * background. That makes the browser evaluate a live filter and re-rasterise
 * tiles over the WebGL canvas every frame — and when the GPU is already busy
 * (an X-class flare is the heaviest frame in the app) tile rasterisation can
 * fail and paint solid black, which shows up as large squares flickering on and
 * off. Baking the noise into a static bitmap removes the filter entirely; the
 * transform animation then runs on the compositor with nothing to re-raster.
 */
const TILE = 128;

export function installGrain(el) {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;

  for (let i = 0; i < TILE * TILE; i++) {
    // Slightly clumped rather than pure white noise, so it reads as film grain
    // instead of television static.
    const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 90;
    const g = Math.max(0, Math.min(255, v));
    d[i * 4] = g;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = g;
    d[i * 4 + 3] = 140;
  }
  ctx.putImageData(img, 0, 0);

  el.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
  el.style.backgroundRepeat = 'repeat';
}
