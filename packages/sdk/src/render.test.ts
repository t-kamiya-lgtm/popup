// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { forwardQueryParams } from "./render.js";

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
