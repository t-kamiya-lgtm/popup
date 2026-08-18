import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireMember } from "@/lib/require-member";
import { getCompositionBands } from "@/lib/calendar";

// Backing data for the report screen's calendar drill-down
// (docs/lp-ab-test/00-requirements.md 6). Default range: last 60 days.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const lpId = Number(params.id);
  const { searchParams } = new URL(request.url);
  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const from = searchParams.get("from") ?? new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const bands = await getCompositionBands(lpId, from, to);

  const allCreativeIds = [...new Set(bands.flatMap((b) => [...b.slotA, ...b.slotB]))];
  const { rows } = allCreativeIds.length
    ? await pool().query(
        `SELECT c.id, c.name, c.is_original, s.slot_key, s.original_image_url, a.url AS asset_url
         FROM creatives c JOIN lp_slots s ON s.id = c.slot_id LEFT JOIN assets a ON a.id = c.asset_id
         WHERE c.id = ANY($1::bigint[])`,
        [allCreativeIds]
      )
    : { rows: [] };
  const meta = new Map(
    rows.map((r) => [
      Number(r.id),
      { name: r.name as string, imageUrl: r.is_original ? (r.original_image_url as string) : (r.asset_url as string | null) },
    ])
  );

  return NextResponse.json({
    from,
    to,
    bands: bands.map((b) => ({
      from: b.from,
      to: b.to,
      slotA: b.slotA.map((id) => ({ id, ...meta.get(id) })),
      slotB: b.slotB.map((id) => ({ id, ...meta.get(id) })),
    })),
  });
}
