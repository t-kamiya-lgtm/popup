import type { TriggerRule, TriggerType, Triggers } from "@popup/shared";

export type Cleanup = () => void;

/**
 * Wires up the trigger rules from a campaign's config and calls `onFire`
 * exactly once, with whichever rule satisfied `mode` ("any" = OR, "all" =
 * AND). Phase 1 only implements exit_back and dwell (docs/08-roadmap.md
 * Phase 1 scope) — exit_intent/scroll/idle/exit_tab rule types are parsed
 * but currently no-ops, so a campaign config that includes them degrades
 * gracefully instead of breaking.
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
    default:
      return null;
  }
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
