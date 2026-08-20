/**
 * Sends measurement events to the collector (docs/04-api.md 1.3). Uses
 * `sendBeacon` so the request survives page unload (critical for the
 * click event, which fires right before navigation) with a `fetch
 * keepalive` fallback for browsers/contexts where `sendBeacon` is
 * unavailable or rejects the payload (some browsers cap beacon size).
 *
 * Both paths deliberately send as `text/plain`, not `application/json`:
 * a real cross-origin test (a live CV send from primedirect.jp) showed
 * Chrome CORS-checking the beacon itself when the Blob's declared type is
 * a non-"simple" content type like application/json — despite the
 * preflight OPTIONS succeeding, the actual send failed with a CORS error
 * and the event was silently lost (sendBeacon's return value doesn't
 * surface it). `text/plain` is one of the fetch spec's "simple" content
 * types, so it's exempt from that check entirely on both paths. The
 * server doesn't care either way — `req.json()` parses the body by
 * content, not by the declared Content-Type header.
 */
export function sendEvents(collectEndpoint: string, sid: string, v: number, events: unknown[]): void {
  if (events.length === 0) return;
  const body = JSON.stringify({ sid, v, events });

  try {
    if ("sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "text/plain" });
      const ok = navigator.sendBeacon(collectEndpoint, blob);
      if (ok) return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    fetch(collectEndpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
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
