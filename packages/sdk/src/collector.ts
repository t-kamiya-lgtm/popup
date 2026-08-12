/**
 * Sends measurement events to the collector (docs/04-api.md 1.3). Uses
 * `sendBeacon` so the request survives page unload (critical for the
 * click event, which fires right before navigation) with a `fetch
 * keepalive` fallback for browsers/contexts where `sendBeacon` is
 * unavailable or rejects the payload (some browsers cap beacon size).
 */
export function sendEvents(collectEndpoint: string, sid: string, v: number, events: unknown[]): void {
  if (events.length === 0) return;
  const body = JSON.stringify({ sid, v, events });

  try {
    if ("sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(collectEndpoint, blob);
      if (ok) return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    fetch(collectEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Best-effort; a lost event isn't worth retrying mid-session. Queued
      // retry-on-next-visit (docs/05-tag-sdk.md 6, `pz.q`) is a later
      // enhancement, not required for Phase 1's happy path.
    });
  } catch {
    // swallow — see docs/02-architecture.md 8
  }
}
