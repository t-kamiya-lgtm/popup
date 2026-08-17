/**
 * Cleans up the most common copy-paste mistake in a creative's link URL:
 * grabbing an `href` value straight out of an inspected page's HTML source
 * instead of typing/pasting a clean URL. That naturally drags in everything
 * up to the next attribute — e.g. copying out of
 * `href="#order-form" class="cta-button"` pastes as
 * `#order-form" class="cta-button`. Browsers don't error on this; they
 * percent-encode the stray `"`/space/`=` characters straight into the URL,
 * so the link just silently points somewhere wrong instead of failing
 * obviously (the same failure shape url-pattern.ts's normalizeUrlPattern
 * exists to prevent for target-page rules).
 *
 * Anchor-only links (`#order-form`) are a real, supported use case — the
 * SDK's click handler resolves them against the current page
 * (packages/sdk/src/render.ts's forwardQueryParams does
 * `new URL(linkUrl, currentPageUrl)`), which is exactly a same-page jump
 * link when linkUrl is just a hash.
 *
 * Applied both client-side (campaign-form.tsx, for immediate feedback) and
 * server-side (PATCH /api/v1/campaigns/[id], as the actual guarantee —
 * anything hitting the API directly still gets normalized).
 */
export function normalizeLinkUrl(url: string): string {
  const trimmed = url.trim();
  // The whole copied value, closing quote included — e.g. `"#order-form"`.
  const unquoted =
    trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  // Anything from here on is the next HTML attribute leaking in
  // (`" class="cta-button`), not part of the URL.
  const quoteIndex = unquoted.indexOf('"');
  return quoteIndex === -1 ? unquoted : unquoted.slice(0, quoteIndex);
}
