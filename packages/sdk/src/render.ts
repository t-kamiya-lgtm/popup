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

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .pz-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 2147483000;
    }
    .pz-banner {
      position: fixed; z-index: 2147483001;
      max-width: ${isCentered ? "560px" : "380px"};
      width: min(86vw, ${isCentered ? "560px" : "380px"});
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
      border-radius: 8px; overflow: hidden; background: #fff;
      ${POSITION_STYLES[position]}
    }
    .pz-banner a { display: block; }
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

  const banner = document.createElement("div");
  banner.className = "pz-banner";
  banner.setAttribute("role", "dialog");
  if (isCentered) banner.setAttribute("aria-modal", "true");
  banner.setAttribute("aria-label", opts.creative.alt || "広告");

  const link = document.createElement("a");
  link.href = opts.creative.linkUrl;
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

  shadow.appendChild(banner);

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    opts.onClick();
    // sendBeacon (used by onClick's collector call) doesn't block
    // navigation, so it's safe to navigate on the same tick.
    if (opts.creative.linkTarget === "_blank") {
      window.open(opts.creative.linkUrl, "_blank", "noopener");
    } else {
      location.href = opts.creative.linkUrl;
    }
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
