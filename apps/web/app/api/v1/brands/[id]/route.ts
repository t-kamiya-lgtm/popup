import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";

/**
 * DELETE /api/v1/brands/[id] — refuses to delete a brand that has delivery
 * history: any event (imp/click/cv/...) recorded against a campaign
 * currently tagged with this brand. A brand with zero events — even if
 * campaigns still reference it — is fine to delete; campaigns.brand_id is
 * ON DELETE SET NULL, so they just revert to "no brand" (see
 * 0009_brands.sql for why that's the right default instead of RESTRICT).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const { id } = await params;
  const brandId = Number(id);
  if (!Number.isInteger(brandId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  return withAccount(accountId, async (client) => {
    const { rows: brandRows } = await client.query(`SELECT id FROM brands WHERE id = $1 AND account_id = $2`, [
      brandId,
      accountId,
    ]);
    if (!brandRows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { rows: usageRows } = await client.query(
      `SELECT 1 FROM events e JOIN campaigns c ON c.id = e.campaign_id WHERE c.brand_id = $1 LIMIT 1`,
      [brandId]
    );
    if (usageRows.length > 0) {
      return NextResponse.json({ error: "配信実績があるブランドは削除できません" }, { status: 409 });
    }

    await client.query(`DELETE FROM brands WHERE id = $1`, [brandId]);
    return NextResponse.json({ ok: true });
  });
}
