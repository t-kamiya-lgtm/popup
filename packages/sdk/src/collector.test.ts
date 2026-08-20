// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { sendEvents } from "./collector.js";

describe("sendEvents", () => {
  it("sends via sendBeacon with a text/plain Blob, not application/json", () => {
    // A real cross-origin send once failed silently here: Chrome
    // CORS-checks sendBeacon itself when the Blob's declared type isn't a
    // "simple" content type, dropping the event despite sendBeacon
    // reporting success. text/plain is exempt from that check.
    const sendBeacon = vi.fn((_url: string, _data: Blob) => true);
    vi.stubGlobal("navigator", { sendBeacon });

    sendEvents("https://collect.example.com/e", "SITE_X", 1, [{ t: "imp" }]);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe("https://collect.example.com/e");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/plain");

    vi.unstubAllGlobals();
  });

  it("does nothing for an empty events array", () => {
    const sendBeacon = vi.fn((_url: string, _data: Blob) => true);
    vi.stubGlobal("navigator", { sendBeacon });

    sendEvents("https://collect.example.com/e", "SITE_X", 1, []);

    expect(sendBeacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falls back to fetch (also text/plain) when sendBeacon reports failure", () => {
    const sendBeacon = vi.fn((_url: string, _data: Blob) => false);
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("fetch", fetchMock);

    sendEvents("https://collect.example.com/e", "SITE_X", 1, [{ t: "click" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ "Content-Type": "text/plain" });

    vi.unstubAllGlobals();
  });

  it("falls back to fetch when sendBeacon is unavailable", () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    sendEvents("https://collect.example.com/e", "SITE_X", 1, [{ t: "close" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
