import type { PoolClient } from "pg";

export interface CampaignDetail {
  id: number;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  priority: number;
  holdoutRate: number;
  devices: string[];
  triggers: { mode: "any" | "all"; rules: { type: string; seconds?: number }[] };
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
    altText: string;
    weight: number;
  }[];
}

/** Shared by the admin API route and the edit page's server component, so the two never drift. */
export async function getCampaignDetail(client: PoolClient, campaignId: number): Promise<CampaignDetail | null> {
  const { rows: campaignRows } = await client.query(
    `SELECT id, name, status, priority, holdout_rate, devices, triggers, frequency,
            position_pc, position_sp, overlay, close_button
     FROM campaigns WHERE id = $1`,
    [campaignId]
  );
  const c = campaignRows[0];
  if (!c) return null;

  const { rows: targetRows } = await client.query(
    `SELECT kind, match_type, pattern FROM campaign_targets WHERE campaign_id = $1 AND target_type = 'url' ORDER BY id`,
    [campaignId]
  );
  const { rows: creativeRows } = await client.query(
    `SELECT id, name, status, link_url, link_target, alt_text, weight FROM creatives WHERE campaign_id = $1 ORDER BY id`,
    [campaignId]
  );

  return {
    id: Number(c.id),
    name: c.name,
    status: c.status,
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
    creatives: creativeRows.map((cr) => ({
      id: Number(cr.id),
      name: cr.name,
      status: cr.status,
      linkUrl: cr.link_url,
      linkTarget: cr.link_target,
      altText: cr.alt_text,
      weight: cr.weight,
    })),
  };
}
