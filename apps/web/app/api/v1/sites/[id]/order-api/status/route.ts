import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { getConnection } from "@/lib/order-api";
import { appBaseUrl } from "@/lib/app-base-url";

/** GET /api/v1/sites/{id}/order-api/status — docs/04-api.md 1.5.1, docs/06-admin.md 6.5. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const siteId = Number((await params).id);
  if (!Number.isInteger(siteId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    const conn = await getConnection(client, siteId);
    return NextResponse.json({
      redirectUri: `${appBaseUrl()}/api/v1/sites/${siteId}/order-api/callback`,
      status: conn?.status ?? "not_connected",
      hasCredentials: !!conn?.clientId,
      tokenExpiresAt: conn?.tokenExpiresAt ?? null,
      lastSyncedAt: conn?.lastSyncedAt ?? null,
      lastError: conn?.lastError ?? null,
    });
  });
}
