/**
 * The ~3KB loader (docs/05-tag-sdk.md 1.1). Installed as:
 *   <script async src="https://cdn.popup.example.com/t.js?sid=SITE_XXXX"></script>
 *
 * Its only two jobs: (1) make sure `window.pqz` is a queue that page-side
 * `pqz.push([...])` calls (the conversion tag, etc.) can safely call before
 * the real SDK has loaded, and (2) lazily inject the SDK bundle. Everything
 * else — including reading that queue — is the SDK's job, so this file can
 * stay tiny and essentially never need to change.
 *
 * Every top-level statement is wrapped in try/catch: a bug in here must
 * never surface as an error on the host page. See docs/02-architecture.md 8.
 */
(function () {
  try {
    var w = window as any;
    w.pqz = w.pqz || [];

    var currentScript = (document.currentScript ||
      // Fallback for browsers/contexts where currentScript is unavailable
      // during async execution — find our own tag by src pattern instead.
      Array.from(document.getElementsByTagName("script")).find((s) =>
        /\/t\.js(\?|$)/.test(s.getAttribute("src") || "")
      )) as HTMLScriptElement | undefined;

    if (!currentScript) return;

    var src = currentScript.getAttribute("src") || "";
    var siteId = new URL(src, location.href).searchParams.get("sid");
    if (!siteId) return;

    var base = src.replace(/\/t\.js(\?.*)?$/, "");

    var load = function () {
      try {
        var s = document.createElement("script");
        s.async = true;
        s.src = base + "/sdk.js?sid=" + encodeURIComponent(siteId!);
        document.head.appendChild(s);
      } catch (e) {
        // swallow — see file header
      }
    };

    // Defer past the critical rendering path; this tag must never compete
    // with the host page's own content for the main thread.
    if ("requestIdleCallback" in w) {
      w.requestIdleCallback(load, { timeout: 2000 });
    } else {
      setTimeout(load, 0);
    }
  } catch (e) {
    // swallow — see file header
  }
})();
