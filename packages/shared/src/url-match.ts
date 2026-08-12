import type { UrlRule, UrlTargets } from "./types.js";

/**
 * Matches a URL path (no origin, e.g. "/products/pm100/") against a single
 * rule. `regex` patterns are compiled fresh each call by design — this runs
 * a handful of times per page view, not in a hot loop, and compiling ahead
 * of time would mean either a cache with its own invalidation story or
 * re-parsing the config JSON's rules into RegExp objects at load time
 * (which then can't be JSON-serialized back for the admin's "test URL"
 * tool, which needs the raw pattern string).
 */
export function matchUrl(rule: UrlRule, path: string): boolean {
  switch (rule.match) {
    case "exact":
      return path === rule.pattern;
    case "prefix":
      return path.startsWith(rule.pattern);
    case "contains":
      return path.includes(rule.pattern);
    case "regex":
      try {
        return new RegExp(rule.pattern).test(path);
      } catch {
        // An invalid regex (e.g. saved before stricter admin-side
        // validation existed) must never take down delivery for every
        // visitor on the site — treat it as a non-match.
        return false;
      }
  }
}

/**
 * Evaluates include/exclude URL targeting for a campaign.
 * exclude wins if any rule matches. An empty include list means "all pages"
 * (matches docs/03-data-model.md campaign_targets judgement order).
 */
export function matchesTargets(targets: UrlTargets, path: string): boolean {
  if (targets.exclude.some((rule) => matchUrl(rule, path))) return false;
  if (targets.include.length === 0) return true;
  return targets.include.some((rule) => matchUrl(rule, path));
}

/**
 * Resolves which page_group (if any) a path belongs to, honoring priority
 * (lower wins) the way docs/03-data-model.md page_groups describes.
 */
export function resolvePageGroup<T extends UrlRule & { id: number; priority: number }>(
  groups: T[],
  path: string
): T | null {
  const matches = groups.filter((g) => matchUrl(g, path));
  if (matches.length === 0) return null;
  return matches.reduce((best, g) => (g.priority < best.priority ? g : best));
}
