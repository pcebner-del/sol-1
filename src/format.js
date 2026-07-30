/** One astronomical unit, the IAU definition. */
export const AU_KM = 149597870.7;
const MI_PER_KM = 0.621371192;

function compact(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `${Math.round(n).toLocaleString('en-US')}`;
  return n.toFixed(0);
}

function compactShort(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Orbital distance in all three units people actually reach for.
 * `long` suits an info card; `short` suits a 3D label.
 */
export function distanceFromSun(au) {
  const km = au * AU_KM;
  const mi = km * MI_PER_KM;
  return {
    au: `${au} AU`,
    km: `${compact(km)} km`,
    mi: `${compact(mi)} mi`,
    long: `${au} AU · ${compact(km)} km · ${compact(mi)} mi`,
    short: `${au} AU · ${compactShort(km)} km · ${compactShort(mi)} mi`,
  };
}

/** Same treatment for a distance already expressed in km. */
export function fromKm(km) {
  const mi = km * MI_PER_KM;
  return `${compact(km)} km · ${compact(mi)} mi`;
}
