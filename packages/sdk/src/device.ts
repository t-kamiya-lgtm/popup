import type { Device } from "@popup/shared";

/**
 * Classifies a User-Agent string into pc/sp/tablet. Deliberately UA-based
 * rather than viewport-width-based: viewport width changes on desktop
 * (resized window, devtools open) shouldn't flip a visitor's device
 * classification mid-session and desync it from what was used for
 * targeting when the config was first evaluated.
 */
export function detectDevice(userAgent: string): Device {
  const ua = userAgent.toLowerCase();
  const isTablet = /ipad|android(?!.*mobile)|tablet/.test(ua);
  if (isTablet) return "tablet";
  const isMobile = /iphone|ipod|android.*mobile|windows phone|mobile/.test(ua);
  if (isMobile) return "sp";
  return "pc";
}
