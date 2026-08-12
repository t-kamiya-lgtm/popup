import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { getCurrentSite } from "@/lib/current-site";
import { requireAccountId } from "@/lib/require-account";

/** GET /api/v1/campaigns — list, for the campaign list screen (docs/06-admin.md 1). */
export async function GET() {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  return withAccount(accountId, async (client) => {
    const site = await getCurrentSite(client);
    if (!site) return NextResponse.json({ campaigns: [] });

    const { rows } = await client.query(
      `SELECT c.id, c.name, c.status, c.priority, c.holdout_rate,
              (SELECT count(*) FROM creatives cr WHERE cr.campaign_id = c.id) AS creative_count
       FROM campaigns c
       WHERE c.site_id = $1
       ORDER BY c.priority ASC, c.id ASC`,
      [site.id]
    );

    return NextResponse.json({
      site: { id: site.id, name: site.name, publicId: site.publicId },
      campaigns: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        status: r.status,
        priority: r.priority,
        holdoutRate: Number(r.holdout_rate),
        creativeCount: Number(r.creative_count),
      })),
    });
  });
}

const DEFAULT_TRIGGERS = { mode: "any", rules: [{ type: "exit_back" }, { type: "dwell", seconds: 60 }] };
const DEFAULT_FREQUENCY = {
  perSession: 1,
  perDay: 2,
  suppressDaysAfterClose: 3,
  suppressAfterClick: true,
  minIntervalSeconds: 300,
};

/** POST /api/v1/campaigns — create a draft campaign, then the caller navigates to its edit page. */
export async function POST(req: NextRequest) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "新規キャンペーン";

  return withAccount(accountId, async (client) => {
    const site = await getCurrentSite(client);
    if (!site) return NextResponse.json({ error: "no site for this account" }, { status: 400 });

    const { rows: [campaign] } = await client.query(
      `INSERT INTO campaigns (site_id, name, status, triggers, devices, frequency, position_pc, position_sp)
       VALUES ($1, $2, 'draft', $3, '{pc,sp}', $4, 'bottom_right', 'center')
       RETURNING id`,
      [site.id, name, JSON.stringify(DEFAULT_TRIGGERS), JSON.stringify(DEFAULT_FREQUENCY)]
    );

    return NextResponse.json({ id: Number(campaign.id) }, { status: 201 });
  });
}
