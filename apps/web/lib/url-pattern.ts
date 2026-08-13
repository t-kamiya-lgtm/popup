export type MatchType = "exact" | "prefix" | "contains" | "regex";

/**
 * URL rules match against `location.pathname` alone — never the origin,
 * query string, or hash (packages/shared's matchUrl / packages/sdk's
 * `const path = location.pathname`). Two mistakes both silently produce a
 * rule that matches nothing, which is exactly what shipped once already on
 * a real production campaign:
 *
 * 1. Pasting a full URL copied from the browser's address bar (a very
 *    natural thing to do) — no page's pathname ever contains "https://...".
 * 2. Keeping a query string like "?force-page=sp" on the pattern — real
 *    product URLs often carry one, but pathname never includes it either.
 *
 * Normalizing to pathname-only here means both mistakes just work instead
 * of quietly dropping all delivery for the campaign. Regex patterns are
 * left untouched: they're not URLs, and "starts with http" or "contains ?"
 * could be a deliberate part of someone's pattern.
 *
 * Applied both client-side (campaign-form.tsx, for immediate feedback) and
 * server-side (PATCH /api/v1/campaigns/[id], as the actual guarantee —
 * anything hitting the API directly still gets normalized).
 */
export function normalizeUrlPattern(pattern: string, matchType: MatchType | string): string {
  if (matchType === "regex") return pattern;
  try {
    return new URL(pattern).pathname;
  } catch {
    // Not a parseable absolute URL — already a relative path. Still strip
    // off any query string/hash a relative paste might carry (e.g. copied
    // from an address bar that showed a relative-looking URL).
    return pattern.split(/[?#]/)[0];
  }
}
