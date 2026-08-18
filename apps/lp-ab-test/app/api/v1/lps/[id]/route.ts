import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireEditor, requireMember } from "@/lib/require-member";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const lpId = Number(params.id);
  const { rows: lpRows } = await pool().query(
    `SELECT id, product_code, item_name, lp_name, url, top_image_url, delivery_status FROM lps WHERE id = $1`,
    [lpId]
  );
  if (lpRows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const lp = lpRows[0];

  const { rows: slotRows } = await pool().query(
    `SELECT id, slot_key, label, original_image_url, optimization_mode FROM lp_slots WHERE lp_id = $1 ORDER BY slot_key ASC`,
    [lpId]
  );
  const { rows: creativeRows } = await pool().query(
    `SELECT c.id, c.slot_id, c.name, c.status, c.weight_percent, c.is_original, c.is_locked,
            a.url AS asset_url, a.width, a.height
     FROM creatives c
     LEFT JOIN assets a ON a.id = c.asset_id
     WHERE c.slot_id = ANY($1::bigint[])
     ORDER BY c.is_original DESC, c.id ASC`,
    [slotRows.map((s) => s.id)]
  );

  const slots = slotRows.map((s) => ({
    id: Number(s.id),
    slotKey: s.slot_key as "a" | "b",
    label: s.label as string,
    originalImageUrl: s.original_image_url as string,
    optimizationMode: s.optimization_mode as "equal" | "auto",
    creatives: creativeRows
      .filter((c) => Number(c.slot_id) === Number(s.id))
      .map((c) => ({
        id: Number(c.id),
        name: c.name as string,
        status: c.status as "active" | "paused",
        weightPercent: Number(c.weight_percent),
        isOriginal: c.is_original as boolean,
        isLocked: c.is_locked as boolean,
        imageUrl: c.is_original ? (s.original_image_url as string) : (c.asset_url as string | null),
        width: c.width as number | null,
        height: c.height as number | null,
      })),
  }));

  return NextResponse.json({
    lp: {
      id: Number(lp.id),
      productCode: lp.product_code as string,
      itemName: lp.item_name as string,
      lpName: lp.lp_name as string,
      url: lp.url as string,
      topImageUrl: lp.top_image_url as string | null,
      deliveryStatus: lp.delivery_status as "active" | "paused",
    },
    slots,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const lpId = Number(params.id);
  const body = await request.json().catch(() => null);
  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof body?.productCode === "string") {
    values.push(body.productCode.trim());
    fields.push(`product_code = $${values.length}`);
  }
  if (typeof body?.itemName === "string") {
    values.push(body.itemName.trim());
    fields.push(`item_name = $${values.length}`);
  }
  if (typeof body?.lpName === "string") {
    values.push(body.lpName.trim());
    fields.push(`lp_name = $${values.length}`);
  }
  if (typeof body?.url === "string") {
    values.push(body.url.trim());
    fields.push(`url = $${values.length}`);
  }
  if (typeof body?.topImageUrl === "string") {
    values.push(body.topImageUrl);
    fields.push(`top_image_url = $${values.length}`);
  }
  if (body?.deliveryStatus === "active" || body?.deliveryStatus === "paused") {
    values.push(body.deliveryStatus);
    fields.push(`delivery_status = $${values.length}`);
  }
  if (fields.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  values.push(lpId);
  await pool().query(`UPDATE lps SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
  return NextResponse.json({ ok: true });
}
