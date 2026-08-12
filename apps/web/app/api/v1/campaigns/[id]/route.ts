import { NextRequest, NextResponse } from "next/server";
import { getCampaignDetail } from "@/lib/campaigns";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";

interface TargetInput {
  kind: "include" | "exclude";
  matchType: "exact" | "prefix" | "contains" | "regex";
  pattern: string;
}

interface CreativeInput {
  id?: number; // present = update existing row; absent = insert new
  name: string;
  status: "active" | "paused";
  linkUrl: string;
  linkTarget: "_self" | "_blank";
  altText: string;
  weight: number;
  assetPcId: number | null;
  assetSpId: number | null;
}

interface CampaignPayload {
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
  targets: TargetInput[];
  creatives: CreativeInput[];
}

/** GET /api/v1/campaigns/[id] — full detail for the edit form + preview. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const detail = await getCampaignDetail(client, campaignId);
    // RLS means a campaign belonging to another tenant simply doesn't come
    // back here — this 404 covers both "doesn't exist" and "not yours"
    // without distinguishing them to the caller, which is the point.
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  });
}

/**
 * PATCH /api/v1/campaigns/[id] — saves the whole edit form in one request.
 * Targets are simple delete-all-then-reinsert (nothing else references a
 * target row's identity). Creatives are reconciled by id instead — update
 * in place when an id is present, insert when absent, delete rows that
 * were removed from the submitted list — because `events.creative_id` and
 * `order_items` can reference a creative, and a delete+reinsert would
 * silently orphan that history every time someone edits a campaign.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body: CampaignPayload = await req.json().catch(() => null);
  if (!body?.name) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE campaigns SET
         name = $2, status = $3, priority = $4, holdout_rate = $5, devices = $6,
         triggers = $7, frequency = $8, position_pc = $9, position_sp = $10,
         overlay = $11, close_button = $12, updated_at = now()
       WHERE id = $1`,
      [
        campaignId,
        body.name,
        body.status,
        body.priority,
        body.holdoutRate,
        body.devices,
        JSON.stringify(body.triggers),
        JSON.stringify(body.frequency),
        body.positionPc,
        body.positionSp,
        body.overlay,
        body.closeButton,
      ]
    );
    if (rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    await client.query(`DELETE FROM campaign_targets WHERE campaign_id = $1 AND target_type = 'url'`, [campaignId]);
    for (const t of body.targets ?? []) {
      if (!t.pattern) continue;
      await client.query(
        `INSERT INTO campaign_targets (campaign_id, kind, target_type, match_type, pattern)
         VALUES ($1, $2, 'url', $3, $4)`,
        [campaignId, t.kind, t.matchType, t.pattern]
      );
    }

    const { rows: existingCreatives } = await client.query(
      `SELECT id FROM creatives WHERE campaign_id = $1`,
      [campaignId]
    );
    const existingIds = new Set(existingCreatives.map((r: { id: number | string }) => Number(r.id)));
    const submittedIds = new Set<number>();

    for (const cr of body.creatives ?? []) {
      if (!cr.linkUrl) continue;
      if (cr.id && existingIds.has(cr.id)) {
        submittedIds.add(cr.id);
        await client.query(
          `UPDATE creatives SET name=$2, status=$3, link_url=$4, link_target=$5, alt_text=$6, weight=$7,
             asset_pc_id=$8, asset_sp_id=$9
           WHERE id = $1 AND campaign_id = $10`,
          [cr.id, cr.name, cr.status, cr.linkUrl, cr.linkTarget, cr.altText, cr.weight, cr.assetPcId, cr.assetSpId, campaignId]
        );
      } else {
        await client.query(
          `INSERT INTO creatives (campaign_id, name, status, link_url, link_target, alt_text, weight, asset_pc_id, asset_sp_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [campaignId, cr.name, cr.status, cr.linkUrl, cr.linkTarget, cr.altText, cr.weight, cr.assetPcId, cr.assetSpId]
        );
      }
    }
    const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));
    if (toDelete.length > 0) {
      await client.query(`DELETE FROM creatives WHERE campaign_id = $1 AND id = ANY($2::bigint[])`, [campaignId, toDelete]);
    }

    return NextResponse.json({ ok: true });
  });
}
