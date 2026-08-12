import type { Frequency } from "@popup/shared";

/**
 * Persisted (localStorage, per campaign) frequency-capping state. Kept as
 * plain, JSON-serializable data with all the decision logic in pure
 * functions below, so the actual localStorage read/write (storage.ts) and
 * "was this eligible to show" decision (here) can be tested and reasoned
 * about separately. See docs/03-data-model.md campaigns.frequency and
 * docs/05-tag-sdk.md.
 */
export interface FrequencyState {
  sessionId?: string;
  sessionShowCount: number;
  dayKey?: string; // e.g. "2026-08-12", in the visitor's local time
  dayShowCount: number;
  lastShownAt?: number; // epoch ms
  closedAt?: number; // epoch ms — set when the visitor dismissed it
  clickedAt?: number; // epoch ms — set when the visitor clicked through
}

export const INITIAL_FREQUENCY_STATE: FrequencyState = {
  sessionShowCount: 0,
  dayShowCount: 0,
};

export function isEligibleByFrequency(
  state: FrequencyState,
  freq: Frequency,
  now: number,
  sessionId: string,
  dayKey: string
): boolean {
  if (freq.suppressAfterClick && state.clickedAt !== undefined) return false;

  if (state.closedAt !== undefined) {
    const suppressUntil = state.closedAt + freq.suppressDaysAfterClose * 24 * 60 * 60 * 1000;
    if (now < suppressUntil) return false;
  }

  if (state.lastShownAt !== undefined) {
    const nextAllowedAt = state.lastShownAt + freq.minIntervalSeconds * 1000;
    if (now < nextAllowedAt) return false;
  }

  const sessionCount = state.sessionId === sessionId ? state.sessionShowCount : 0;
  if (sessionCount >= freq.perSession) return false;

  const dayCount = state.dayKey === dayKey ? state.dayShowCount : 0;
  if (dayCount >= freq.perDay) return false;

  return true;
}

export function recordShow(state: FrequencyState, now: number, sessionId: string, dayKey: string): FrequencyState {
  const sessionCount = state.sessionId === sessionId ? state.sessionShowCount + 1 : 1;
  const dayCount = state.dayKey === dayKey ? state.dayShowCount + 1 : 1;
  return {
    ...state,
    sessionId,
    sessionShowCount: sessionCount,
    dayKey,
    dayShowCount: dayCount,
    lastShownAt: now,
  };
}

export function recordClose(state: FrequencyState, now: number): FrequencyState {
  return { ...state, closedAt: now };
}

export function recordClick(state: FrequencyState, now: number): FrequencyState {
  return { ...state, clickedAt: now };
}

/** Local-time YYYY-MM-DD, used as the "per day" bucket key. */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
