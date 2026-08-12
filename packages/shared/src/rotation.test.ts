import { describe, expect, it } from "vitest";
import { isHoldout, pickCreative } from "./rotation.js";

describe("pickCreative", () => {
  it("returns null for an empty list", () => {
    expect(pickCreative("session-1", 501, [])).toBeNull();
  });

  it("is deterministic for the same session+campaign", () => {
    const creatives = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
    ];
    const first = pickCreative("session-1", 501, creatives);
    const second = pickCreative("session-1", 501, creatives);
    expect(second?.id).toBe(first?.id);
  });

  it("can pick a different creative for a different session (sanity check)", () => {
    const creatives = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
    ];
    const picks = new Set(
      Array.from({ length: 50 }, (_, i) => pickCreative(`session-${i}`, 501, creatives)?.id)
    );
    // Both creative ids should show up across 50 distinct sessions —
    // otherwise the hash isn't actually splitting traffic.
    expect(picks.size).toBe(2);
  });

  it("splits ~equally across 10,000 sessions for equal weights (±3%)", () => {
    const creatives = [
      { id: 1, weight: 1 },
      { id: 2, weight: 1 },
      { id: 3, weight: 1 },
    ];
    const counts = new Map<number, number>();
    for (let i = 0; i < 10_000; i++) {
      const picked = pickCreative(`visitor-${i}`, 501, creatives);
      counts.set(picked!.id, (counts.get(picked!.id) ?? 0) + 1);
    }
    const expected = 10_000 / creatives.length;
    for (const count of counts.values()) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.03);
    }
    expect(counts.size).toBe(3);
  });

  it("honors unequal weights roughly proportionally", () => {
    const creatives = [
      { id: 1, weight: 3 },
      { id: 2, weight: 1 },
    ];
    const counts = new Map<number, number>();
    for (let i = 0; i < 10_000; i++) {
      const picked = pickCreative(`visitor-${i}`, 501, creatives);
      counts.set(picked!.id, (counts.get(picked!.id) ?? 0) + 1);
    }
    const ratio = (counts.get(1) ?? 0) / (counts.get(2) ?? 1);
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });

  it("skips paused (zero/absent) creatives when the caller filters them out first", () => {
    // pickCreative itself doesn't know about status — this documents that
    // contract so a caller doesn't accidentally pass paused creatives in.
    const onlyActive = [{ id: 2, weight: 1 }];
    expect(pickCreative("session-1", 501, onlyActive)?.id).toBe(2);
  });
});

describe("isHoldout", () => {
  it("never holds out at rate 0", () => {
    for (let i = 0; i < 200; i++) {
      expect(isHoldout(`visitor-${i}`, 501, 0)).toBe(false);
    }
  });

  it("always holds out at rate 1", () => {
    for (let i = 0; i < 200; i++) {
      expect(isHoldout(`visitor-${i}`, 501, 1)).toBe(true);
    }
  });

  it("is deterministic for the same session+campaign", () => {
    expect(isHoldout("session-1", 501, 0.1)).toBe(isHoldout("session-1", 501, 0.1));
  });

  it("holds out roughly the configured rate across many sessions (±3pt)", () => {
    let held = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      if (isHoldout(`visitor-${i}`, 501, 0.1)) held++;
    }
    expect(Math.abs(held / n - 0.1)).toBeLessThan(0.03);
  });

  it("is independent of pickCreative's bucketing (not just a copy of the same hash)", () => {
    // With different salts, the set of sessions held out shouldn't line up
    // with, say, "session hashes to creative index 0" in lockstep.
    let alignedWithFirstCreative = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const sid = `visitor-${i}`;
      const heldOut = isHoldout(sid, 501, 0.5);
      const picked = pickCreative(sid, 501, [
        { id: 1, weight: 1 },
        { id: 2, weight: 1 },
      ]);
      if (heldOut === (picked?.id === 1)) alignedWithFirstCreative++;
    }
    // If independent, agreement should hover around 50%, not near 0% or 100%.
    expect(alignedWithFirstCreative / n).toBeGreaterThan(0.4);
    expect(alignedWithFirstCreative / n).toBeLessThan(0.6);
  });
});
