// @vitest-environment jsdom
import type { CreativeConfig } from "@popup/shared";
import { describe, expect, it, vi } from "vitest";
import { forwardQueryParams, renderPopup } from "./render.js";

const BASE_CREATIVE: CreativeConfig = {
  id: 1,
  weight: 1,
  linkUrl: "https://shop.example.com/lp",
  linkTarget: "_blank",
  alt: "",
  images: {
    pc: { w: 380, h: 300, fallback: "" },
    sp: { w: 320, h: 400, fallback: "" },
  },
};

describe("forwardQueryParams", () => {
  it("copies params from the current page onto a link with no query string", () => {
    const result = forwardQueryParams(
      "https://shop.example.com/products/pm100",
      "https://shop.example.com/lp?gclid=abc123&utm_source=google"
    );
    expect(result).toBe("https://shop.example.com/products/pm100?gclid=abc123&utm_source=google");
  });

  it("lets the destination's own params win over the current page's", () => {
    const result = forwardQueryParams(
      "https://shop.example.com/products/pm100?utm_source=banner",
      "https://shop.example.com/lp?utm_source=google&utm_medium=cpc"
    );
    const url = new URL(result);
    expect(url.searchParams.get("utm_source")).toBe("banner");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
  });

  it("passes through unknown/future click-id param names, not just a fixed allowlist", () => {
    const result = forwardQueryParams(
      "https://shop.example.com/products/pm100",
      "https://shop.example.com/lp?srsltid=AfmBOord6mYqZqnshwUVITsMBb2p-GSAFC9FKaB2IrVKAVmAfy-IccnZ&someNewAdPlatformId=xyz"
    );
    const url = new URL(result);
    expect(url.searchParams.get("srsltid")).toBe("AfmBOord6mYqZqnshwUVITsMBb2p-GSAFC9FKaB2IrVKAVmAfy-IccnZ");
    expect(url.searchParams.get("someNewAdPlatformId")).toBe("xyz");
  });

  it("returns the link unchanged when the current page has no query string", () => {
    const result = forwardQueryParams("https://shop.example.com/products/pm100", "https://shop.example.com/lp");
    expect(result).toBe("https://shop.example.com/products/pm100");
  });

  it("falls back to the raw linkUrl if the current page URL can't be parsed", () => {
    // Not realistic for a real location.href, but this must never throw and
    // break the click regardless — worst case is losing the passthrough.
    const result = forwardQueryParams("https://shop.example.com/products/pm100", "");
    expect(result).toBe("https://shop.example.com/products/pm100");
  });
});

describe("renderPopup with linkAction: close", () => {
  it("closes on click instead of navigating, without touching linkUrl", () => {
    // jsdom doesn't implement IntersectionObserver; renderPopup only uses it
    // for the "visible" impression timer, unrelated to this test.
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };

    const onClick = vi.fn();
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);

    // renderPopup attaches a *closed* shadow root by design (docs/05-tag-sdk.md
    // 5.1), which makes it unreachable from outside — including from this
    // test. Force it open just for inspection; nothing under test depends on
    // closed-mode behavior itself.
    const captured: { shadow: ShadowRoot | null } = { shadow: null };
    const originalAttachShadow = host.attachShadow.bind(host);
    vi.spyOn(host, "attachShadow").mockImplementation((init) => {
      captured.shadow = originalAttachShadow({ ...(init as ShadowRootInit), mode: "open" });
      return captured.shadow;
    });

    const popup = renderPopup(host, {
      creative: { ...BASE_CREATIVE, linkAction: "close" },
      device: "sp",
      positionPc: "bottom_right",
      positionSp: "center",
      overlay: false,
      closeButton: false,
      onVisible: () => {},
      onClick,
      onClose,
    });

    const link = captured.shadow?.querySelector("a");
    expect(link?.hasAttribute("href")).toBe(false);

    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(false); // destroy() removes the host

    popup.destroy();
  });
});
