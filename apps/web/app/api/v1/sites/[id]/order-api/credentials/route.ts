import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { saveCredentials } from "@/lib/order-api";

/** POST /api/v1/sites/{id}/order-api/credentials — docs/04-api.md 1.5.1. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const siteId = Number((await params).id);
  if (!Number.isInteger(siteId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const { authorizeUrl, tokenUrl, apiBaseUrl, clientId, clientSecret, orderIdField } = body ?? {};
  if (!authorizeUrl || !tokenUrl || !apiBaseUrl || !clientId || !clientSecret) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  if (orderIdField !== "order_id" && orderIdField !== "ec_order_id") {
    return NextResponse.json({ error: "invalid orderIdField" }, { status: 400 });
  }

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    await saveCredentials(client, siteId, { authorizeUrl, tokenUrl, apiBaseUrl, clientId, clientSecret, orderIdField });
    return NextResponse.json({ ok: true });
  });
}
