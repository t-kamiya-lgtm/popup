import type { CreativeConfig, Device, PositionPc, PositionSp } from "@popup/shared";

export interface RenderOptions {
  creative: CreativeConfig;
  device: Device;
  positionPc: PositionPc;
  positionSp: PositionSp;
  overlay: boolean;
  closeButton: boolean;
  onVisible: () => void;
  onClick: () => void;
  onClose: () => void;
  /**
   * Skips the actual navigation on click, while still invoking onClick.
   * Used only by the admin preview (docs/06-admin.md 4) — real delivery
   * always navigates. Keeping this as an option on the *same* render
   * function, rather than a separate preview-only renderer, is the whole
   * point: the admin preview and the live SDK render through identical
   * code, so a preview that "looks right" can't diverge from production.
   */
  disableNavigation?: boolean;
  /**
   * Also preview-only. Production always uses `position: fixed` (relative
   * to the visitor's actual viewport — see docs/05-tag-sdk.md 5.2). An
   * *embedded* preview panel needs the popup positioned within its own
   * device-frame box instead, so this swaps `fixed`→`absolute` (the frame
   * must be `position: relative; container-type: inline-size`) and swaps
   * the `vw`-based width cap to the equivalent container-query unit. Every
   * other rule — structure, classes, offsets, the position lookup table
   * itself — stays byte-for-byte the same as delivery.
   */
  containerRelative?: boolean;
}

export interface RenderedPopup {
  destroy: () => void;
}

const POSITION_STYLES: Record<PositionPc | PositionSp, string> = {
  bottom_right: "right:24px; bottom:24px;",
  bottom_center: "left:50%; bottom:24px; transform:translateX(-50%);",
  bottom_left: "left:24px; bottom:24px;",
  center: "inset:0; display:grid; place-items:center;",
  bottom: "left:0; right:0; bottom:0; padding-bottom: env(safe-area-inset-bottom);",
};

/**
 * Renders one creative into an isolated Shadow DOM (closed mode) so the
 * host page's CSS can neither leak in nor be polluted by ours. See
 * docs/05-tag-sdk.md 5.1.
 */
export function renderPopup(host: HTMLElement, opts: RenderOptions): RenderedPopup {
  const shadow = host.attachShadow({ mode: "closed" });

  const position = opts.device === "pc" ? opts.positionPc : opts.positionSp;
  const isCentered = position === "center";
  const showOverlay = opts.overlay && isCentered;
  const image = opts.device === "pc" ? opts.creative.images.pc : opts.creative.images.sp;

  const positionKeyword = opts.containerRelative ? "absolute" : "fixed";
  const widthUnit = opts.containerRelative ? "cqw" : "vw";
  const maxWidth = isCentered ? "560px" : "380px";

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .pz-overlay {
      position: ${positionKeyword}; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 2147483000;
    }
    .pz-center-wrap {
      position: ${positionKeyword}; inset: 0; z-index: 2147483001;
      display: grid; place-items: center; pointer-events: none;
    }
    .pz-center-wrap .pz-banner { pointer-events: auto; }
    .pz-banner {
      position: ${isCentered ? "relative" : positionKeyword};
      ${isCentered ? "" : "z-index: 2147483001;"}
      max-width: ${maxWidth};
      width: min(86${widthUnit}, ${maxWidth});
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
      border-radius: 8px; overflow: hidden; background: #fff;
      ${isCentered ? "" : POSITION_STYLES[position]}
    }
    .pz-banner a { display: block; cursor: pointer; }
    .pz-banner img { width: 100%; height: auto; display: block; }
    .pz-close {
      position: absolute; top: 4px; right: 4px;
      width: 44px; height: 44px; min-width: 44px; min-height: 44px;
      border: none; background: rgba(0,0,0,0.55); color: #fff;
      border-radius: 50%; font-size: 20px; line-height: 1; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
  `;
  shadow.appendChild(style);

  let overlayEl: HTMLDivElement | null = null;
  if (showOverlay) {
    overlayEl = document.createElement("div");
    overlayEl.className = "pz-overlay";
    overlayEl.setAttribute("role", "presentation");
    shadow.appendChild(overlayEl);
  }

  // Centered positioning needs a full-viewport wrapper to place the banner
  // in the middle of the screen, kept separate from `.pz-banner` itself —
  // sizing `.pz-banner` to `inset:0` (as a single "center" rule reused for
  // both would) made its own background span the whole viewport instead of
  // hugging the creative image, and dragged the close button's corner
  // along with it. Non-centered positions never had this problem: they
  // anchor `.pz-banner` directly via `POSITION_STYLES`, sized to content.
  const centerWrap = isCentered ? document.createElement("div") : null;
  if (centerWrap) {
    centerWrap.className = "pz-center-wrap";
    shadow.appendChild(centerWrap);
  }

  const banner = document.createElement("div");
  banner.className = "pz-banner";
  banner.setAttribute("role", "dialog");
  if (isCentered) banner.setAttribute("aria-modal", "true");
  banner.setAttribute("aria-label", opts.creative.alt || "広告");

  const isCloseAction = opts.creative.linkAction === "close";

  const link = document.createElement("a");
  if (!isCloseAction) link.href = opts.creative.linkUrl;
  link.target = opts.creative.linkTarget;
  link.rel = "noopener";

  const img = document.createElement("img");
  img.src = image.fallback;
  img.alt = opts.creative.alt;
  img.width = image.w;
  img.height = image.h;
  link.appendChild(img);
  banner.appendChild(link);

  let closeBtn: HTMLButtonElement | null = null;
  if (opts.closeButton) {
    closeBtn = document.createElement("button");
    closeBtn.className = "pz-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";
    banner.appendChild(closeBtn);
  }

  (centerWrap ?? shadow).appendChild(banner);

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    opts.onClick();
    if (isCloseAction) {
      close();
      return;
    }
    // Preview-only: leave the popup rendered so the admin can click it
    // repeatedly to inspect it, rather than having it disappear with no
    // trigger to bring it back (see disableNavigation's doc comment).
    if (opts.disableNavigation) return;
    const destination = forwardQueryParams(opts.creative.linkUrl, location.href);
    // sendBeacon (used by onClick's collector call) doesn't block
    // navigation, so it's safe to navigate on the same tick.
    if (opts.creative.linkTarget === "_blank") {
      window.open(destination, "_blank", "noopener");
    } else {
      location.href = destination;
    }
    // Always close, not just on the × button: a new tab (_blank) or a
    // same-page anchor jump (e.g. "#order-form", which the browser just
    // scrolls to rather than reloading for) would otherwise leave this
    // popup sitting on screen indefinitely — a full-page navigation closing
    // it too is harmless, since the page is unloading anyway.
    close();
  }
  link.addEventListener("click", handleClick);

  function close() {
    opts.onClose();
    destroy();
  }
  closeBtn?.addEventListener("click", close);
  overlayEl?.addEventListener("click", close);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", handleKeydown);

  // "Visible" per docs/07-measurement.md 1: ≥50% of the banner on-screen
  // for ≥1 continuous second, not merely painted.
  let visibleSince: number | null = null;
  let visibleTimer: ReturnType<typeof setTimeout> | null = null;
  let firedVisible = false;
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        if (visibleSince === null) {
          visibleSince = Date.now();
          visibleTimer = setTimeout(() => {
            if (!firedVisible) {
              firedVisible = true;
              opts.onVisible();
            }
          }, 1000);
        }
      } else {
        visibleSince = null;
        if (visibleTimer) {
          clearTimeout(visibleTimer);
          visibleTimer = null;
        }
      }
    },
    { threshold: [0, 0.5, 1] }
  );
  observer.observe(banner);

  function destroy() {
    observer.disconnect();
    if (visibleTimer) clearTimeout(visibleTimer);
    document.removeEventListener("keydown", handleKeydown);
    host.remove();
  }

  return { destroy };
}

// Never forwarded onto a click-through, even though it's just another
// query param on the current page: pz_preview (see index.ts's
// getPreviewCampaignId) is a QA-only flag that forces this exact popup to
// render regardless of targeting/frequency/holdout. Carrying it forward
// would mean a preview link a visitor stumbled onto (or a tester's own
// browser history landing back on one) keeps forcing popups on every page
// it propagates to instead of the one page it was meant for.
const NEVER_FORWARDED_PARAMS = ["pz_preview"];

/**
 * Carries ad-attribution query params (gclid, srsltid, utm_*, and whatever
 * new ones ad platforms invent next) from the page the visitor is on
 * through to the creative's link, so a click on the popup doesn't break the
 * attribution chain. Whole query string, not a fixed allowlist — the set of
 * click-id param names in the wild keeps growing, and an allowlist would
 * silently miss new ones. Params already present on the destination URL win
 * (the creative's own link is authoritative for anything it explicitly
 * sets); everything else from the current page is added.
 */
export function forwardQueryParams(linkUrl: string, currentPageUrl: string): string {
  try {
    const destination = new URL(linkUrl, currentPageUrl);
    const current = new URL(currentPageUrl).searchParams;
    for (const [key, value] of current) {
      if (!destination.searchParams.has(key) && !NEVER_FORWARDED_PARAMS.includes(key)) {
        destination.searchParams.set(key, value);
      }
    }
    return destination.toString();
  } catch {
    return linkUrl;
  }
}
