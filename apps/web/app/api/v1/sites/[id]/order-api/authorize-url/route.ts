import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { buildAuthorizeUrl, OrderApiError } from "@/lib/order-api";
import { appBaseUrl } from "@/lib/app-base-url";

/** GET /api/v1/sites/{id}/order-api/authorize-url — docs/04-api.md 1.5.1. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const siteId = Number((await params).id);
  if (!Number.isInteger(siteId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    const redirectUri = `${appBaseUrl()}/api/v1/sites/${siteId}/order-api/callback`;
    try {
      const url = await buildAuthorizeUrl(client, siteId, redirectUri);
      return NextResponse.json({ url, redirectUri });
    } catch (err) {
      if (err instanceof OrderApiError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  });
}
