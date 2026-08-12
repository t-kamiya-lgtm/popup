import type { TouchEntry } from "./storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Picks which touch (if any) a conversion should be attributed to:
 * click-through wins over view-through within their respective windows,
 * and within a type, the most recent touch wins (last-touch attribution).
 * See docs/07-measurement.md 2.1.
 */
export function findAttributionTouch(
  touches: TouchEntry[],
  now: number,
  clickWindowDays: number,
  viewWindowDays: number
): TouchEntry | null {
  const clicks = touches
    .filter((t) => t.type === "click" && now - t.ts <= clickWindowDays * DAY_MS)
    .sort((a, b) => b.ts - a.ts);
  if (clicks.length > 0) return clicks[0];

  const views = touches
    .filter((t) => t.type === "view" && now - t.ts <= viewWindowDays * DAY_MS)
    .sort((a, b) => b.ts - a.ts);
  if (views.length > 0) return views[0];

  return null;
}
