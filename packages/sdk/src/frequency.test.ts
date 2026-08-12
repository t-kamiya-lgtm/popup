import { describe, expect, it } from "vitest";
import type { Frequency } from "@popup/shared";
import {
  INITIAL_FREQUENCY_STATE,
  isEligibleByFrequency,
  localDayKey,
  recordClick,
  recordClose,
  recordShow,
} from "./frequency.js";

const freq: Frequency = {
  perSession: 1,
  perDay: 2,
  suppressDaysAfterClose: 3,
  suppressAfterClick: true,
  minIntervalSeconds: 300,
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe("isEligibleByFrequency", () => {
  it("is eligible with no prior state", () => {
    expect(isEligibleByFrequency(INITIAL_FREQUENCY_STATE, freq, Date.now(), "s1", "2026-08-12")).toBe(true);
  });

  it("blocks a second show within the same session (perSession=1)", () => {
    const afterOneShow = recordShow(INITIAL_FREQUENCY_STATE, 1000, "s1", "2026-08-12");
    expect(isEligibleByFrequency(afterOneShow, freq, 2000, "s1", "2026-08-12")).toBe(false);
  });

  it("allows a show in a new session even if perSession was hit in the last one", () => {
    const afterOneShow = recordShow(INITIAL_FREQUENCY_STATE, 1000, "s1", "2026-08-12");
    // new session id -> session counter resets, but minIntervalSeconds still applies
    expect(isEligibleByFrequency(afterOneShow, freq, 1000 + 301_000, "s2", "2026-08-12")).toBe(true);
  });

  it("enforces perDay across sessions on the same day", () => {
    let state = recordShow(INITIAL_FREQUENCY_STATE, 0, "s1", "2026-08-12");
    state = recordShow(state, 301_000, "s2", "2026-08-12");
    // 2 shows today already == perDay; a 3rd session should still be blocked
    expect(isEligibleByFrequency(state, freq, 602_000, "s3", "2026-08-12")).toBe(false);
  });

  it("resets the day counter on a new day", () => {
    let state = recordShow(INITIAL_FREQUENCY_STATE, 0, "s1", "2026-08-12");
    state = recordShow(state, 301_000, "s2", "2026-08-12");
    expect(isEligibleByFrequency(state, freq, 602_000, "s3", "2026-08-13")).toBe(true);
  });

  it("enforces minIntervalSeconds regardless of session/day counters", () => {
    const state = recordShow(INITIAL_FREQUENCY_STATE, 1000, "s1", "2026-08-12");
    expect(isEligibleByFrequency(state, freq, 1000 + 299_000, "s2", "2026-08-12")).toBe(false);
    expect(isEligibleByFrequency(state, freq, 1000 + 300_000, "s2", "2026-08-12")).toBe(true);
  });

  it("suppresses for suppressDaysAfterClose days after a close", () => {
    const closedAt = 1_000_000;
    const state = recordClose(INITIAL_FREQUENCY_STATE, closedAt);
    expect(isEligibleByFrequency(state, freq, closedAt + 2 * DAY_MS, "s2", "2026-08-14")).toBe(false);
    expect(isEligibleByFrequency(state, freq, closedAt + 3 * DAY_MS + 1, "s2", "2026-08-15")).toBe(true);
  });

  it("suppresses indefinitely after a click when suppressAfterClick is true", () => {
    const state = recordClick(INITIAL_FREQUENCY_STATE, 1000);
    expect(isEligibleByFrequency(state, freq, 1000 + 365 * DAY_MS, "s2", "2027-08-12")).toBe(false);
  });

  it("does not suppress after a click when suppressAfterClick is false", () => {
    const relaxed: Frequency = { ...freq, suppressAfterClick: false };
    const state = recordClick(INITIAL_FREQUENCY_STATE, 1000);
    expect(isEligibleByFrequency(state, relaxed, 1000 + 301_000, "s2", "2026-08-12")).toBe(true);
  });
});

describe("localDayKey", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(localDayKey(new Date(2026, 7, 12))).toBe("2026-08-12"); // month is 0-indexed
  });

  it("zero-pads single-digit month and day", () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
