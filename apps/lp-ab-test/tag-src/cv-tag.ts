// CV tag — installed on the thank-you page, independent of the popup tool's
// own CV tag (docs/lp-ab-test/00-requirements.md 7: tags stay independent so
// this tool works even where the popup tool isn't installed).
//
// <script async src="https://{host}/cv-tag.js"
//         data-lp-id="123" data-order-id="{注文番号}" data-revenue="{注文金額合計(税別)}">
// </script>
//
// Requires the thank-you page to be same-origin as the LP so the session id
// written to localStorage by tag.js is readable here (docs/lp-ab-test/
// 02-architecture.md 3).
const STORAGE_KEY = "lpab_sid";

async function main() {
  const script = document.currentScript as HTMLScriptElement | null;
  const lpId = Number(script?.dataset.lpId);
  const orderId = script?.dataset.orderId;
  const revenue = script?.dataset.revenue ? Number(script.dataset.revenue) : undefined;
  // Cart templates substitute `{注文番号}` etc. server-side; if that
  // substitution didn't happen (e.g. tag pasted on a non-order page during
  // testing) the literal placeholder is still in the string — bail out
  // rather than recording a bogus conversion.
  if (!lpId || !orderId || orderId.includes("{")) return;

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
    body: JSON.stringify({ type: "cv", lpId, sessionId, orderId, revenue }),
  }).catch(() => {});
}

void main();
