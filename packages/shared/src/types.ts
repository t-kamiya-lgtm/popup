// Shared types for the config JSON contract between the server (apps/web,
// GET /c/[siteId]) and the client (packages/sdk). Keeping these in one
// package means a schema change can't silently drift between the two sides.
// See docs/04-api.md 1.1.

export type MatchType = "exact" | "prefix" | "contains" | "regex";

export interface UrlRule {
  match: MatchType;
  pattern: string;
}

export interface UrlTargets {
  include: UrlRule[];
  exclude: UrlRule[];
}

// Targeting by product code is intentionally not modelled here — the
// primedirect.jp page URLs don't reliably expose a product code (see
// docs/09-cart-integration.md 1.3), so Phase 1 targets pages by URL rule
// only. `target_type: 'product_code'` exists in the DB schema for a future
// site that *can* embed one, but the config JSON only carries `urls`.
export type Device = "pc" | "sp" | "tablet";

export type TriggerType =
  | "exit_back"
  | "exit_intent"
  | "dwell"
  | "scroll"
  | "idle"
  | "exit_tab";

export interface TriggerRule {
  type: TriggerType;
  seconds?: number;
  percent?: number;
  sensitivity?: number;
}

export interface Triggers {
  mode: "any" | "all";
  rules: TriggerRule[];
}

export interface Frequency {
  perSession: number;
  perDay: number;
  suppressDaysAfterClose: number;
  suppressAfterClick: boolean;
  minIntervalSeconds: number;
}

export type PositionPc = "bottom_right" | "bottom_center" | "bottom_left" | "center";
export type PositionSp = "center" | "bottom";

export interface ImageVariant {
  w: number;
  h: number;
  avif?: string;
  webp?: string;
  fallback: string;
}

export interface CreativeConfig {
  id: number;
  weight: number;
  linkUrl: string;
  linkTarget: "_self" | "_blank";
  alt: string;
  images: {
    pc: ImageVariant;
    sp: ImageVariant;
  };
}

export interface CampaignConfig {
  id: number;
  priority: number;
  period: { from: string | null; to: string | null };
  targets: { urls: UrlTargets };
  devices: Device[];
  triggers: Triggers;
  frequency: Frequency;
  holdoutRate: number;
  render: {
    positionPc: PositionPc;
    positionSp: PositionSp;
    overlay: boolean;
    closeButton: boolean;
  };
  creatives: CreativeConfig[];
}

export interface PageGroupConfig {
  id: number;
  match: MatchType;
  pattern: string;
  priority: number;
}

export interface SiteConfig {
  v: number;
  site: {
    id: string;
    tz: string;
    cartHosts: string[];
    crossDomainCart: boolean;
  };
  sdkUrl: string;
  endpoints: { collect: string };
  pageGroups: PageGroupConfig[];
  campaigns: CampaignConfig[];
}
