import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";

// Public, unauthenticated config JSON for the delivery tag (tag-src/tag.ts).
// No session/cookie involved — this is fetched cross-origin from the LP's
// own domain (docs/lp-ab-test/02-architecture.md 2).
export async function GET(request: NextRequest, { params }: { params: { lpId: string } }) {
  const lpId = Number(params.lpId);
  if (!Number.isFinite(lpId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { rows: lpRows } = await pool().query(`SELECT id, delivery_status FROM lps WHERE id = $1`, [lpId]);
  if (lpRows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { rows: slotRows } = await pool().query(
    `SELECT id, slot_key, original_image_url FROM lp_slots WHERE lp_id = $1 ORDER BY slot_key ASC`,
    [lpId]
  );
  const { rows: creativeRows } = await pool().query(
    `SELECT c.id, c.slot_id, c.status, c.weight_percent, c.is_original, a.url AS asset_url
     FROM creatives c LEFT JOIN assets a ON a.id = c.asset_id
     WHERE c.slot_id = ANY($1::bigint[]) AND c.status = 'active'`,
    [slotRows.map((s) => s.id)]
  );

  const { origin } = new URL(request.url);
  return NextResponse.json(
    {
      lpId,
      active: lpRows[0].delivery_status === "active",
      collectEndpoint: `${origin}/e`,
      slots: slotRows.map((s) => ({
        slotKey: s.slot_key,
        originalImageUrl: s.original_image_url,
        creatives: creativeRows
          .filter((c) => Number(c.slot_id) === Number(s.id))
          .map((c) => ({
            id: Number(c.id),
            weight: Number(c.weight_percent),
            imageUrl: c.is_original ? s.original_image_url : c.asset_url,
            isOriginal: c.is_original as boolean,
          })),
      })),
    },
    { headers: { "Cache-Control": "public, max-age=30" } }
  );
}
