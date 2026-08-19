// Delivery tag: <script async src="https://{host}/tag.js" data-lp-id="123"></script>
//
// Runs entirely client-side (docs/lp-ab-test/02-architecture.md 2): fetches
// this LP's slot/creative config, deterministically picks one creative per
// slot for this session (same hash-based rotation as the popup tool —
// @popup/shared's pickCreative — so the same session always sees the same
// combination), rewrites the matching <img> src, and beacons an impression.
import { pickCreative } from "@popup/shared";
import type { LpConfig, SlotConfig } from "./config-types";

const STORAGE_KEY = "lpab_sid";

function getSessionId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh =
      window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode, etc.) — fall back to a per-pageview id.
    // Sessions won't persist across pages, but the tag still functions.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function getDevice(): "pc" | "sp" {
  return window.innerWidth <= 768 ? "sp" : "pc";
}

function pickForSlot(sessionId: string, lpId: number, slot: SlotConfig) {
  const active = slot.creatives.filter((c) => c.weight > 0);
  if (active.length === 0) {
    // All patterns paused → serve the original untouched (docs/lp-ab-test/
    // 00-requirements.md 4: automatic fallback to the original image).
    return slot.creatives.find((c) => c.isOriginal) ?? null;
  }
  return pickCreative(sessionId, lpId * 10 + (slot.slotKey === "a" ? 1 : 2), active);
}

function applySlot(slot: SlotConfig, picked: { id: number; imageUrl: string; isOriginal: boolean } | null) {
  if (!picked || picked.isOriginal) return; // nothing to rewrite
  const images = document.querySelectorAll<HTMLImageElement>(`img[src="${cssEscape(slot.originalImageUrl)}"]`);
  images.forEach((img) => {
    img.src = picked.imageUrl;
  });
}

// Minimal CSS.escape fallback (older Safari/SP browsers on carts still in
// the wild may lack it) — only needs to be safe inside a double-quoted
// attribute selector, not a general-purpose escaper.
function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

async function main(script: HTMLScriptElement | null) {
  const lpId = Number(script?.dataset.lpId);
  if (!lpId) return;

  const origin = script?.src ? new URL(script.src).origin : "";
  const res = await fetch(`${origin}/c/${lpId}`);
  if (!res.ok) return;
  const config: LpConfig = await res.json();
  if (!config.active) return; // LP delivery paused — do nothing, no imp beacon either

  const sessionId = getSessionId();
  const device = getDevice();
  const picks: Record<"a" | "b", number | null> = { a: null, b: null };

  for (const slot of config.slots) {
    const picked = pickForSlot(sessionId, lpId, slot);
    applySlot(slot, picked);
    picks[slot.slotKey] = picked?.id ?? null;
  }

  fetch(config.collectEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      type: "imp",
      lpId,
      sessionId,
      device,
      creativeAId: picks.a,
      creativeBId: picks.b,
    }),
  }).catch(() => {});
}

// Must capture currentScript synchronously, right here at top-level load
// time — it reverts to null as soon as this script finishes executing, so
// reading it later (e.g. inside a deferred DOMContentLoaded callback) would
// always see null and silently no-op.
const currentScript = document.currentScript as HTMLScriptElement | null;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void main(currentScript));
} else {
  void main(currentScript);
}
