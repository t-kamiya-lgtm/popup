import type { PoolClient } from "pg";
import type { ImageVariant } from "@popup/shared";
import { loadCreativeImages } from "./assets";

export interface CampaignDetail {
  id: number;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  /** First entry of the site's allowed_hosts, used to build "実際のページでプレビュー" links. Null if the site has none configured. */
  siteHost: string | null;
  brandId: number | null;
  priority: number;
  holdoutRate: number;
  devices: string[];
  triggers: {
    mode: "any" | "all";
    rules: { type: string; seconds?: number; imagePattern?: string; imageMatchType?: string }[];
  };
  frequency: {
    perSession: number;
    perDay: number;
    suppressDaysAfterClose: number;
    suppressAfterClick: boolean;
    minIntervalSeconds: number;
  };
  positionPc: string;
  positionSp: string;
  overlay: boolean;
  closeButton: boolean;
  targets: { kind: string; matchType: string; pattern: string }[];
  creatives: {
    id: number;
    name: string;
    status: string;
    linkUrl: string;
    linkTarget: string;
    linkAction: "url" | "close";
    altText: string;
    weight: number;
    assetPcId: number | null;
    assetSpId: number | null;
    imagePc: ImageVariant | null;
    imageSp: ImageVariant | null;
  }[];
}

/** Shared by the admin API route and the edit page's server component, so the two never drift. */
export async function getCampaignDetail(client: PoolClient, campaignId: number): Promise<CampaignDetail | null> {
  const { rows: campaignRows } = await client.query(
    `SELECT c.id, c.name, c.status, c.priority, c.holdout_rate, c.devices, c.triggers, c.frequency,
            c.position_pc, c.position_sp, c.overlay, c.close_button, c.brand_id, s.allowed_hosts[1] AS site_host
     FROM campaigns c JOIN sites s ON s.id = c.site_id
     WHERE c.id = $1`,
    [campaignId]
  );
  const c = campaignRows[0];
  if (!c) return null;

  const { rows: targetRows } = await client.query(
    `SELECT kind, match_type, pattern FROM campaign_targets WHERE campaign_id = $1 AND target_type = 'url' ORDER BY id`,
    [campaignId]
  );
  const { rows: creativeRows } = await client.query(
    `SELECT id, name, status, link_url, link_target, link_action, alt_text, weight, asset_pc_id, asset_sp_id
     FROM creatives WHERE campaign_id = $1 ORDER BY id`,
    [campaignId]
  );
  const creatives = await Promise.all(
    creativeRows.map(async (cr) => {
      const assetPcId = cr.asset_pc_id !== null ? Number(cr.asset_pc_id) : null;
      const assetSpId = cr.asset_sp_id !== null ? Number(cr.asset_sp_id) : null;
      const { pc, sp } = await loadCreativeImages(client, assetPcId, assetSpId);
      return {
        id: Number(cr.id),
        name: cr.name,
        status: cr.status,
        linkUrl: cr.link_url ?? "",
        linkTarget: cr.link_target,
        linkAction: cr.link_action,
        altText: cr.alt_text,
        weight: cr.weight,
        assetPcId,
        assetSpId,
        imagePc: pc,
        imageSp: sp,
      };
    })
  );

  return {
    id: Number(c.id),
    name: c.name,
    status: c.status,
    siteHost: c.site_host ?? null,
    brandId: c.brand_id !== null ? Number(c.brand_id) : null,
    priority: c.priority,
    holdoutRate: Number(c.holdout_rate),
    devices: c.devices,
    triggers: c.triggers,
    frequency: c.frequency,
    positionPc: c.position_pc,
    positionSp: c.position_sp,
    overlay: c.overlay,
    closeButton: c.close_button,
    targets: targetRows.map((t) => ({ kind: t.kind, matchType: t.match_type, pattern: t.pattern })),
    creatives,
  };
}
