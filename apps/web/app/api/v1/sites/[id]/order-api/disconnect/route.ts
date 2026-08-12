import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { disconnect } from "@/lib/order-api";

/** POST /api/v1/sites/{id}/order-api/disconnect — docs/04-api.md 1.5.1. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const siteId = Number((await params).id);
  if (!Number.isInteger(siteId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    await disconnect(client, siteId);
    return NextResponse.json({ ok: true });
  });
}
