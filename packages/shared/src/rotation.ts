/**
 * FNV-1a 32-bit hash. Deterministic, fast, and good enough uniformity for
 * traffic-splitting (not a cryptographic requirement — see
 * docs/02-architecture.md 3 for why this replaced a server-side Redis
 * counter: no round trip, no server state, and the same session always
 * lands on the same bucket).
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface WeightedCreative {
  id: number;
  weight: number;
}

/**
 * Deterministically picks one creative for this session+campaign, weighted
 * by `weight` (equal weights ⇒ equal split). Only `active`-status creatives
 * should be passed in; this function doesn't filter status itself so
 * callers can keep the "what's eligible" decision in one place.
 */
export function pickCreative<T extends WeightedCreative>(
  sessionId: string,
  campaignId: number,
  creatives: T[]
): T | null {
  if (creatives.length === 0) return null;
  const totalWeight = creatives.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return null;

  const hash = fnv1a(`${sessionId}:${campaignId}`);
  let remainder = hash % totalWeight;
  for (const creative of creatives) {
    if (remainder < creative.weight) return creative;
    remainder -= creative.weight;
  }
  // Unreachable if weights sum correctly, but keeps the return type total
  // rather than `T | null` bleeding an "impossible" undefined into callers.
  return creatives[creatives.length - 1];
}

/**
 * Deterministically assigns this session+campaign to the holdout (control)
 * group, at the given rate (0..1). A different hash salt than pickCreative
 * so the two decisions are independent — a session isn't more likely to be
 * held out just because of which creative it would have gotten.
 */
export function isHoldout(sessionId: string, campaignId: number, holdoutRate: number): boolean {
  if (holdoutRate <= 0) return false;
  if (holdoutRate >= 1) return true;
  const hash = fnv1a(`${sessionId}:holdout:${campaignId}`);
  return hash % 1000 < Math.round(holdoutRate * 1000);
}
