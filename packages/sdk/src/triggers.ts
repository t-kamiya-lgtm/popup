import { matchUrl, type TriggerRule, type TriggerType, type Triggers } from "@popup/shared";

export type Cleanup = () => void;

/**
 * Wires up the trigger rules from a campaign's config and calls `onFire`
 * exactly once, with whichever rule satisfied `mode` ("any" = OR, "all" =
 * AND). Implements exit_back, dwell, and image_click — exit_intent/scroll/
 * idle/exit_tab rule types are parsed but currently no-ops, so a campaign
 * config that includes them degrades gracefully instead of breaking.
 */
export function registerTriggers(triggers: Triggers, sessionStartedAt: number, onFire: (type: TriggerType) => void): Cleanup {
  const fired = new Set<TriggerType>();
  const cleanups: Cleanup[] = [];
  let done = false;

  function handleFire(type: TriggerType) {
    if (done) return;
    fired.add(type);
    const satisfied =
      triggers.mode === "any" ? fired.size > 0 : triggers.rules.every((r) => fired.has(r.type));
    if (satisfied) {
      done = true;
      cleanupAll();
      onFire(type);
    }
  }

  function cleanupAll() {
    for (const c of cleanups.splice(0)) c();
  }

  for (const rule of triggers.rules) {
    const cleanup = registerRule(rule, sessionStartedAt, () => handleFire(rule.type));
    if (cleanup) cleanups.push(cleanup);
  }

  return cleanupAll;
}

function registerRule(rule: TriggerRule, sessionStartedAt: number, fire: () => void): Cleanup | null {
  switch (rule.type) {
    case "exit_back":
      return registerExitBack(fire);
    case "dwell":
      return registerDwell(rule.seconds ?? 60, sessionStartedAt, fire);
    case "image_click":
      return registerImageClick(rule.imagePattern, rule.imageMatchType ?? "contains", fire);
    default:
      return null;
  }
}

/**
 * Fires when the visitor clicks an <img> whose `src` matches the admin's
 * pattern — an alternative to a CSS-selector-based "click this element"
 * trigger that doesn't require anyone to inspect the page's HTML: the
 * pattern is just the image URL, copyable via "画像アドレスをコピー" in any
 * browser. Matched the same way a target-page URL rule matches a path
 * (packages/shared/src/url-match.ts's matchUrl), so query strings/cache
 * busters on the actual rendered `src` don't break a "部分一致" pattern.
 *
 * A single delegated listener (not one per matching <img>, which can't
 * exist yet for images the page hasn't finished loading) walks up from
 * the click target to find the nearest <img> — either the target itself,
 * or one nested inside a clicked wrapper like `<a><img></a>`.
 */
function registerImageClick(pattern: string | undefined, matchType: TriggerRule["imageMatchType"], fire: () => void): Cleanup | null {
  if (!pattern) return null;
  const imagePattern = pattern;

  function onClick(e: MouseEvent) {
    // Whole handler guarded, not just the match — a malformed pattern (bad
    // regex) or an unexpected event.target shape must never break the
    // host page. See docs/02-architecture.md 8.
    try {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const img = findClickedImage(target);
      if (img?.src && matchUrl({ match: matchType ?? "contains", pattern: imagePattern }, img.src)) fire();
    } catch {
      // never fires; the click just falls through as a normal page click
    }
  }

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

function findClickedImage(target: Element): HTMLImageElement | null {
  if (target instanceof HTMLImageElement) return target;
  return target.querySelector("img");
}

/**
 * Detects a browser-back press by pushing one dummy history entry and
 * listening for the resulting popstate. Deliberately traps the back
 * button *once* — after this fires (or the campaign is closed) it does
 * not re-arm, so a visitor who dismisses the popup can leave normally on
 * their next back press. See docs/05-tag-sdk.md 3.1 for why an
 * indefinitely-repeating trap is a deliberate non-goal (dark-pattern /
 * browser-penalty risk).
 */
function registerExitBack(fire: () => void): Cleanup {
  const marker = { __pz: 1 };
  try {
    history.pushState(marker, "", location.href);
  } catch {
    return () => {};
  }

  function onPopState(e: PopStateEvent) {
    if (e.state && (e.state as any).__pz) {
      fire();
    }
  }

  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}

/**
 * Fires after `seconds` of *foreground* dwell time since session start —
 * time the tab spent hidden doesn't count, so a visitor who opens the tab
 * and tabs away for 10 minutes doesn't come back to an immediate popup.
 * See docs/05-tag-sdk.md 3.2.
 */
function registerDwell(seconds: number, sessionStartedAt: number, fire: () => void): Cleanup {
  let remainingMs = Math.max(0, seconds * 1000 - (Date.now() - sessionStartedAt));
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let runStartedAt = 0;

  function start() {
    runStartedAt = Date.now();
    timeoutId = setTimeout(fire, remainingMs);
  }

  function pause() {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    remainingMs = Math.max(0, remainingMs - (Date.now() - runStartedAt));
    timeoutId = null;
  }

  function resume() {
    if (timeoutId !== null || remainingMs <= 0) return;
    start();
  }

  function onVisibilityChange() {
    if (document.hidden) pause();
    else resume();
  }

  if (document.hidden) {
    // Started hidden (e.g. background tab restore) — wait for visibility.
  } else {
    start();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
