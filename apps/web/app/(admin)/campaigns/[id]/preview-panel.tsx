"use client";

import { renderPopup } from "@popup/sdk/render";
import type { CreativeConfig, Device, PositionPc, PositionSp } from "@popup/shared";
import { useEffect, useRef } from "react";

interface Props {
  creative: CreativeConfig;
  device: Device;
  positionPc: PositionPc;
  positionSp: PositionSp;
  overlay: boolean;
  closeButton: boolean;
}

// True-to-life viewport sizes, not the smaller box this panel used to use.
// PC creatives are capped at a fixed 380px (see POSITION_STYLES/maxWidth in
// packages/sdk/src/render.ts) regardless of screen size, so shrinking the
// *frame* below a real desktop width — as the previous 600px version did —
// made the banner look proportionally huge compared to production (a real
// user caught this by comparing against a competitor's popup). SP already
// matches a real phone width, so it didn't have this problem.
const FRAME_SIZE: Record<Device, { width: number; height: number }> = {
  sp: { width: 375, height: 667 },
  pc: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
};

// The frame above is rendered at true size (so container-query `cqw` units
// inside packages/sdk/src/render.ts compute the same percentages a real
// browser would) and then visually shrunk with a CSS transform so it still
// fits inline next to the edit form — transforms don't affect layout size,
// so this doesn't change what the container query sees.
const DISPLAY_SCALE: Record<Device, number> = { sp: 1, pc: 0.375, tablet: 0.45 };

/**
 * Renders through the exact same `renderPopup` the live SDK uses
 * (packages/sdk/src/render.ts), imported via the `@popup/sdk/render`
 * subpath — not the package's default entry, which would auto-bootstrap a
 * real SDK session on import. See docs/06-admin.md 4 / 08-roadmap.md
 * ("renderer を SDK と管理画面で共有").
 */
export function PreviewPanel(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    const host = document.createElement("div");
    container.appendChild(host);

    const popup = renderPopup(host, {
      creative: props.creative,
      device: props.device,
      positionPc: props.positionPc,
      positionSp: props.positionSp,
      overlay: props.overlay,
      closeButton: props.closeButton,
      disableNavigation: true,
      containerRelative: true,
      onVisible: () => {},
      onClick: () => {},
      onClose: () => {},
    });

    return () => popup.destroy();
  }, [props.creative, props.device, props.positionPc, props.positionSp, props.overlay, props.closeButton]);

  const frame = FRAME_SIZE[props.device];
  const scale = DISPLAY_SCALE[props.device];

  return (
    <div
      style={{
        width: frame.width * scale,
        height: frame.height * scale,
        overflow: "hidden",
        border: "1px solid #ccc",
        borderRadius: 8,
      }}
    >
      <div
        ref={containerRef}
        style={
          {
            width: frame.width,
            height: frame.height,
            position: "relative",
            containerType: "inline-size",
            background: "#f2f2f2",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          } as React.CSSProperties
        }
      />
    </div>
  );
}
