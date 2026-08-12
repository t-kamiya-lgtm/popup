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

// A scaled-down "desktop" frame, not the full 1440px docs/06-admin.md
// mentions for a dedicated preview screen — this panel sits inline next to
// the edit form, so it trades exact-size accuracy for fitting on screen.
const FRAME_SIZE: Record<Device, { width: number; height: number }> = {
  sp: { width: 375, height: 667 },
  pc: { width: 600, height: 400 },
  tablet: { width: 500, height: 400 },
};

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

  return (
    <div
      ref={containerRef}
      style={
        {
          width: frame.width,
          height: frame.height,
          position: "relative",
          containerType: "inline-size",
          overflow: "hidden",
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#f2f2f2",
        } as React.CSSProperties
      }
    />
  );
}
