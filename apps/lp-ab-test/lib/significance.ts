// Pure functions only (no `pg`/server deps) so this can be imported from
// both API routes and "use client" components (docs/lp-ab-test/00-requirements.md
// "有意差フラグ設置").
export interface CreativeStat {
  creativeId: number;
  creativeName: string;
  isOriginal: boolean;
  imageUrl: string | null;
  imps: number;
  cv: number;
  revenue: number;
  cvr: number | null; // null when imps === 0 (avoid dividing by zero / misleading 0%)
}

/**
 * Two-proportion z-test, simplified to a significance flag rather than a
 * raw p-value. Returns null ("判定不可") when either sample is too small to
 * say anything useful, rather than a potentially misleading true/false.
 */
export function isSignificant(a: CreativeStat, b: CreativeStat): boolean | null {
  const MIN_SAMPLE = 30;
  if (a.imps < MIN_SAMPLE || b.imps < MIN_SAMPLE) return null;
  const p1 = a.cv / a.imps;
  const p2 = b.cv / b.imps;
  const pooled = (a.cv + b.cv) / (a.imps + b.imps);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.imps + 1 / b.imps));
  if (se === 0) return false;
  const z = Math.abs(p1 - p2) / se;
  return z >= 1.96; // ~95% confidence
}
