// Deliberately duplicates packages/shared/src/url-match.ts's matchUrl/
// matchesTargets rather than importing them: every existing consumer of
// @popup/shared in this app (packages/sdk/src/render.ts et al.) only ever
// does `import type`, which TypeScript erases entirely, so webpack never
// had to resolve the package's actual files. A real runtime import (needed
// here, for GET /api/v1/lookup) hits `@popup/shared`'s ESM ".js"-suffixed
// relative imports (e.g. `export * from "./types.js"`) that its own tsc
// "bundler" moduleResolution understands but Next's webpack build does not
// — `transpilePackages` doesn't fix it either. This ~15-line pure function
// is cheaper and lower-risk to keep in sync than fighting that resolution
// mismatch in a shared production app's build config.
type MatchType = "exact" | "prefix" | "contains" | "regex";
interface UrlRule {
  match: MatchType;
  pattern: string;
}
interface UrlTargets {
  include: UrlRule[];
  exclude: UrlRule[];
}

function matchUrl(rule: UrlRule, path: string): boolean {
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
        return false;
      }
  }
}

export function matchesTargets(targets: UrlTargets, path: string): boolean {
  if (targets.exclude.some((rule) => matchUrl(rule, path))) return false;
  if (targets.include.length === 0) return true;
  return targets.include.some((rule) => matchUrl(rule, path));
}
