import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireEditor, requireMember } from "@/lib/require-member";
import { getPopupLink } from "@/lib/popup-link";

export async function GET(request: NextRequest) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const showPaused = searchParams.get("showPaused") === "1";

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!showPaused) {
    conditions.push(`delivery_status = 'active'`);
  }
  if (query) {
    params.push(`%${query}%`);
    conditions.push(`(product_code ILIKE $${params.length} OR item_name ILIKE $${params.length} OR lp_name ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await pool().query(
    `SELECT l.id, l.product_code, l.item_name, l.lp_name, l.url, l.top_image_url, l.delivery_status,
            (SELECT count(*) FROM lp_slots s WHERE s.lp_id = l.id) AS slot_count,
            (SELECT count(*) FROM lp_slots s JOIN creatives c ON c.slot_id = s.id
              WHERE s.lp_id = l.id AND c.status = 'active') AS active_creative_count,
            (SELECT count(*) FROM lp_slots s JOIN creatives c ON c.slot_id = s.id
              WHERE s.lp_id = l.id AND c.status != 'active') > 0 AS has_paused_creative
     FROM lps l
     ${where}
     ORDER BY l.updated_at DESC`,
    params
  );

  const lps = await Promise.all(
    rows.map(async (r) => ({
      id: Number(r.id),
      productCode: r.product_code as string,
      itemName: r.item_name as string,
      lpName: r.lp_name as string,
      url: r.url as string,
      topImageUrl: r.top_image_url as string | null,
      deliveryStatus: r.delivery_status as "active" | "paused",
      slotCount: Number(r.slot_count),
      activeCreativeCount: Number(r.active_creative_count),
      hasPausedCreative: Boolean(r.has_paused_creative),
      popupLink: await getPopupLink(Number(r.id), r.url as string),
    }))
  );

  return NextResponse.json({ lps });
}

export async function POST(request: NextRequest) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const body = await request.json().catch(() => null);
  const productCode = typeof body?.productCode === "string" ? body.productCode.trim() : "";
  const itemName = typeof body?.itemName === "string" ? body.itemName.trim() : "";
  const lpName = typeof body?.lpName === "string" ? body.lpName.trim() : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!productCode || !itemName || !lpName || !url) {
    return NextResponse.json({ error: "品番・アイテム名・LP名・URLは必須です" }, { status: 400 });
  }
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "URLの形式が正しくありません" }, { status: 400 });
  }

  const { rows } = await pool().query(
    `INSERT INTO lps (product_code, item_name, lp_name, url, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [productCode, itemName, lpName, url, member.id]
  );
  return NextResponse.json({ id: Number(rows[0].id) }, { status: 201 });
}
