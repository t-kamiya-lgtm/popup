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

function waitForDomReady(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}

// Anti-flicker: hide the slots' original images via a CSS attribute
// selector the instant this script runs, well before the DOM-ready wait or
// the config fetch resolve — a <style> rule applies to matching elements
// as soon as they're parsed into the DOM, so this works even if the <img>
// doesn't exist yet, unlike a JS-driven hide. Swapping an image's `src`
// (in applySlot) naturally drops it out of the selector's match and reveals
// it immediately; anything left showing the original gets revealed by the
// explicit removal in main()'s `finally`, and the timeout below is a pure
// safety net (ad blocker, network failure, thrown error) so an image is
// never left permanently invisible.
function hideOriginals(urls: string[]): HTMLStyleElement | null {
  if (urls.length === 0) return null;
  const style = document.createElement("style");
  style.textContent = `${urls.map((u) => `img[src="${cssEscape(u)}"]`).join(",")}{visibility:hidden}`;
  (document.head ?? document.documentElement).appendChild(style);
  return style;
}

async function main(script: HTMLScriptElement | null) {
  const lpId = Number(script?.dataset.lpId);
  if (!lpId) return;

  const hideUrls = [script?.dataset.originalA, script?.dataset.originalB].filter((u): u is string => Boolean(u));
  const hideStyle = hideOriginals(hideUrls);
  const revealTimer = hideStyle ? window.setTimeout(() => hideStyle.remove(), 1500) : undefined;

  try {
    const origin = script?.src ? new URL(script.src).origin : "";
    // Start the config fetch immediately instead of waiting for the page to
    // finish parsing first — the DOM-ready wait below (needed before the
    // target <img> is guaranteed to exist) then overlaps with this network
    // round-trip instead of stacking after it, which is what caused a
    // visible delay before the image swap on slower-parsing LPs.
    const configPromise = fetch(`${origin}/c/${lpId}`).then((res) => (res.ok ? (res.json() as Promise<LpConfig>) : null));
    const [config] = await Promise.all([configPromise, waitForDomReady()]);
    if (!config || !config.active) return; // LP delivery paused — do nothing, no imp beacon either

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
  } finally {
    if (revealTimer !== undefined) window.clearTimeout(revealTimer);
    hideStyle?.remove();
  }
}

// Must capture currentScript synchronously, right here at top-level load
// time — it reverts to null as soon as this script finishes executing, so
// reading it later (e.g. inside a deferred DOMContentLoaded callback) would
// always see null and silently no-op.
const currentScript = document.currentScript as HTMLScriptElement | null;
void main(currentScript);
