// CV tag — installed ONCE, site-wide, on every thank-you page (not per LP —
// independent of the popup tool's own CV tag per docs/lp-ab-test/
// 00-requirements.md 7, so this tool works even where the popup tool isn't
// installed).
//
// <script>
//   window.__lpabCv = { orderId: "{注文番号}", revenue: {注文金額合計(税込)} };
// </script>
// <script async src="https://{host}/cv-tag.js"></script>
//
// No lpId here on purpose: the collector (app/e/route.ts) attributes the
// conversion to whichever LP this session's most recent impression came
// from, resolved server-side from session_id alone — the same session_id
// is already shared across every LP a visitor saw on this domain (it's
// written to that domain's own localStorage by tag.js), so this needs no
// per-LP configuration.
//
// The order id/revenue must come from a global set by an inline <script>,
// not from this script tag's own attributes: cart platforms (e.g. スマレジ
// EC・リピート — see apps/web's equivalent tag) only substitute their
// `{...}` template placeholders inside a page's own inline script text, not
// inside arbitrary HTML attribute values.
//
// Requires the thank-you page to be same-origin as the LP so the session id
// written to localStorage by tag.js is readable here (docs/lp-ab-test/
// 02-architecture.md 3).
const STORAGE_KEY = "lpab_sid";

interface CvGlobal {
  orderId: string;
  revenue?: number;
}

async function main(script: HTMLScriptElement | null) {
  const cv = (window as unknown as { __lpabCv?: CvGlobal }).__lpabCv;
  const orderId = cv?.orderId;
  const revenue = cv?.revenue;
  // The cart template substitutes `{注文番号}` etc. server-side; if that
  // substitution didn't happen (e.g. tag pasted on a non-order page during
  // testing) the literal placeholder is still in the string — bail out
  // rather than recording a bogus conversion.
  if (!orderId || orderId.includes("{")) return;

  let sessionId: string | null = null;
  try {
    sessionId = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to attribute this conversion to.
  }
  if (!sessionId) return;

  const origin = script?.src ? new URL(script.src).origin : "";
  fetch(`${origin}/e`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ type: "cv", sessionId, orderId, revenue }),
  }).catch(() => {});
}

void main(document.currentScript as HTMLScriptElement | null);
