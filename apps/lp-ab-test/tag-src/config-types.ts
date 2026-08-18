// Contract between GET /c/[lpId] (server) and tag.ts (client). Kept as a
// standalone file (not imported from the Next.js app) so the esbuild bundle
// for tag.ts stays self-contained — see scripts/build-lp-ab-tag.mjs.
export interface SlotConfig {
  slotKey: "a" | "b";
  originalImageUrl: string;
  creatives: Array<{ id: number; weight: number; imageUrl: string; isOriginal: boolean }>;
}

export interface LpConfig {
  lpId: number;
  active: boolean;
  slots: SlotConfig[];
  collectEndpoint: string;
}
