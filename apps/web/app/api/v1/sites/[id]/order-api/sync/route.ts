import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { OrderApiError, syncPendingOrderTypes } from "@/lib/order-api";

/**
 * POST /api/v1/sites/{id}/order-api/sync — docs/04-api.md 1.5.3.
 * The spec describes this as an internal cron job; Phase 1 has no cron
 * runner yet, so it's exposed as an authenticated admin action ("今すぐ同期"
 * in docs/06-admin.md 6.5) that a real cron can call later without change.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const siteId = Number((await params).id);
  if (!Number.isInteger(siteId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    try {
      const result = await syncPendingOrderTypes(client, siteId);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof OrderApiError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  });
}
