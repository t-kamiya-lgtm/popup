import { describe, expect, it } from "vitest";
import { detectDevice } from "./device.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0";

describe("detectDevice", () => {
  it("classifies phones as sp", () => {
    expect(detectDevice(IPHONE)).toBe("sp");
    expect(detectDevice(ANDROID_PHONE)).toBe("sp");
  });

  it("classifies tablets as tablet", () => {
    expect(detectDevice(IPAD)).toBe("tablet");
    expect(detectDevice(ANDROID_TABLET)).toBe("tablet");
  });

  it("classifies desktop browsers as pc", () => {
    expect(detectDevice(MAC_CHROME)).toBe("pc");
    expect(detectDevice(WINDOWS_EDGE)).toBe("pc");
  });
});
