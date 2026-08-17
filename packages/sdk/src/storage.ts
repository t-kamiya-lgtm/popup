import type { FrequencyState } from "./frequency.js";

// All 1st-party only — no cross-site tracking. See docs/05-tag-sdk.md 6.
const VISITOR_KEY = "pz.vid";
const SESSION_KEY = "pz.ses";
const FREQ_KEY_PREFIX = "pz.fq.";
const TOUCH_KEY = "pz.touch";
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function uuid(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for older browsers without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Every localStorage/sessionStorage access is wrapped: Safari private mode
 *  and disabled-storage configurations throw on access, and a popup tool
 *  must never break the host page over that. A no-op fallback (fresh id
 *  every call) is an acceptable degradation — see docs/02-architecture.md 8. */
function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    const s = kind === "local" ? localStorage : sessionStorage;
    const testKey = "__pz_test__";
    s.setItem(testKey, "1");
    s.removeItem(testKey);
    return s;
  } catch {
    return null;
  }
}

export function getOrCreateVisitorId(): string {
  const store = safeStorage("local");
  if (!store) return uuid();
  const existing = store.getItem(VISITOR_KEY);
  if (existing) return existing;
  const id = "v_" + uuid();
  store.setItem(VISITOR_KEY, id);
  return id;
}

interface SessionRecord {
  id: string;
  startedAt: number;
  lastActivityAt: number;
}

/**
 * Returns the current session id and how many ms have elapsed in it,
 * *excluding* time the tab spent hidden (docs/05-tag-sdk.md 3.2: dwell is
 * measured against actual foreground time, not wall-clock time since
 * pageload). Call `touchSession()` periodically while the tab is visible
 * to keep `lastActivityAt` current; a gap longer than 30 minutes starts a
 * new session.
 */
export function getOrCreateSession(now: number): { id: string; startedAt: number } {
  const store = safeStorage("session");
  if (!store) {
    const id = "s_" + uuid();
    return { id, startedAt: now };
  }
  const raw = store.getItem(SESSION_KEY);
  if (raw) {
    try {
      const rec: SessionRecord = JSON.parse(raw);
      if (now - rec.lastActivityAt < SESSION_IDLE_TIMEOUT_MS) {
        store.setItem(SESSION_KEY, JSON.stringify({ ...rec, lastActivityAt: now }));
        return { id: rec.id, startedAt: rec.startedAt };
      }
    } catch {
      // fall through to create a new session
    }
  }
  const rec: SessionRecord = { id: "s_" + uuid(), startedAt: now, lastActivityAt: now };
  store.setItem(SESSION_KEY, JSON.stringify(rec));
  return { id: rec.id, startedAt: rec.startedAt };
}

export function getFrequencyState(campaignId: number): FrequencyState | null {
  const store = safeStorage("local");
  if (!store) return null;
  const raw = store.getItem(FREQ_KEY_PREFIX + campaignId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setFrequencyState(campaignId: number, state: FrequencyState): void {
  const store = safeStorage("local");
  if (!store) return;
  store.setItem(FREQ_KEY_PREFIX + campaignId, JSON.stringify(state));
}

export interface TouchEntry {
  cid: number;
  crid: number;
  type: "click" | "view";
  ts: number;
  /** location.pathname the touch happened on — carried through to the eventual CV row's page_path (apps/web/app/e/route.ts), since a CV fires on the thank-you page and has no page of its own. */
  path?: string;
}

const TOUCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // matches the 7-day CV click window default
const MAX_TOUCHES = 10;

export function addTouch(entry: TouchEntry): void {
  const store = safeStorage("local");
  if (!store) return;
  const touches = getTouches().filter((t) => entry.ts - t.ts < TOUCH_RETENTION_MS);
  touches.unshift(entry);
  store.setItem(TOUCH_KEY, JSON.stringify(touches.slice(0, MAX_TOUCHES)));
}

export function getTouches(): TouchEntry[] {
  const store = safeStorage("local");
  if (!store) return [];
  const raw = store.getItem(TOUCH_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
