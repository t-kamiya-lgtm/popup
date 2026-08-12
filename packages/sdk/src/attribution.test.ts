import { describe, expect, it } from "vitest";
import { findAttributionTouch } from "./attribution.js";
import type { TouchEntry } from "./storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = 1_000_000_000;

describe("findAttributionTouch", () => {
  it("returns null with no touches", () => {
    expect(findAttributionTouch([], now, 7, 1)).toBeNull();
  });

  it("prefers a click touch over a more recent view touch", () => {
    const touches: TouchEntry[] = [
      { cid: 1, crid: 1, type: "view", ts: now - 1000 },
      { cid: 2, crid: 2, type: "click", ts: now - 2000 },
    ];
    expect(findAttributionTouch(touches, now, 7, 1)?.cid).toBe(2);
  });

  it("picks the most recent click among multiple clicks", () => {
    const touches: TouchEntry[] = [
      { cid: 1, crid: 1, type: "click", ts: now - 5000 },
      { cid: 2, crid: 2, type: "click", ts: now - 1000 },
    ];
    expect(findAttributionTouch(touches, now, 7, 1)?.cid).toBe(2);
  });

  it("falls back to a view touch when no click is within window", () => {
    const touches: TouchEntry[] = [{ cid: 3, crid: 3, type: "view", ts: now - 1000 }];
    expect(findAttributionTouch(touches, now, 7, 1)?.cid).toBe(3);
  });

  it("excludes a click outside the click window", () => {
    const touches: TouchEntry[] = [{ cid: 1, crid: 1, type: "click", ts: now - 8 * DAY_MS }];
    expect(findAttributionTouch(touches, now, 7, 1)).toBeNull();
  });

  it("excludes a view outside the (shorter) view window even if within the click window", () => {
    const touches: TouchEntry[] = [{ cid: 1, crid: 1, type: "view", ts: now - 2 * DAY_MS }];
    expect(findAttributionTouch(touches, now, 7, 1)).toBeNull();
  });

  it("returns null when only expired touches exist", () => {
    const touches: TouchEntry[] = [
      { cid: 1, crid: 1, type: "click", ts: now - 30 * DAY_MS },
      { cid: 2, crid: 2, type: "view", ts: now - 30 * DAY_MS },
    ];
    expect(findAttributionTouch(touches, now, 7, 1)).toBeNull();
  });
});
