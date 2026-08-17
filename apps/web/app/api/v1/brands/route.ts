import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";

/** GET /api/v1/brands — list brands for the current account. */
export async function GET() {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, name FROM brands WHERE account_id = $1 ORDER BY name`,
      [accountId]
    );
    return NextResponse.json({ brands: rows.map((r) => ({ id: Number(r.id), name: r.name })) });
  });
}

/** POST /api/v1/brands — create a brand ({ name }). */
export async function POST(req: NextRequest) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "ブランド名を入力してください" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO brands (account_id, name) VALUES ($1, $2)
       ON CONFLICT (account_id, name) DO NOTHING
       RETURNING id`,
      [accountId, name]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "同名のブランドが既に存在します" }, { status: 409 });
    }
    return NextResponse.json({ id: Number(rows[0].id) }, { status: 201 });
  });
}
