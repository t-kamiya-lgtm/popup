import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireEditor } from "@/lib/require-member";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const slotId = Number(params.id);
  const { rows } = await pool().query(
    `SELECT s.optimization_mode, coalesce(o.min_impressions, 1000) AS min_impressions,
            coalesce(o.min_conversions, 5) AS min_conversions,
            coalesce(o.floor_mode, 'equal_share') AS floor_mode, o.floor_percent, o.last_run_at
     FROM lp_slots s LEFT JOIN slot_optimization_settings o ON o.slot_id = s.id
     WHERE s.id = $1`,
    [slotId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = rows[0];
  return NextResponse.json({
    optimizationMode: r.optimization_mode as "equal" | "auto",
    minImpressions: Number(r.min_impressions),
    minConversions: Number(r.min_conversions),
    floorMode: r.floor_mode as "equal_share" | "fixed_percent",
    floorPercent: r.floor_percent !== null ? Number(r.floor_percent) : null,
    lastRunAt: r.last_run_at ? (r.last_run_at as Date).toISOString() : null,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const slotId = Number(params.id);
  const body = await request.json().catch(() => null);

  if (body?.optimizationMode === "equal" || body?.optimizationMode === "auto") {
    await pool().query(`UPDATE lp_slots SET optimization_mode = $1 WHERE id = $2`, [body.optimizationMode, slotId]);
  }

  const hasSettingsUpdate =
    typeof body?.minImpressions === "number" ||
    typeof body?.minConversions === "number" ||
    body?.floorMode === "equal_share" ||
    body?.floorMode === "fixed_percent" ||
    typeof body?.floorPercent === "number";

  if (hasSettingsUpdate) {
    await pool().query(
      `INSERT INTO slot_optimization_settings (slot_id, min_impressions, min_conversions, floor_mode, floor_percent)
       VALUES ($1, coalesce($2, 1000), coalesce($3, 5), coalesce($4, 'equal_share'), $5)
       ON CONFLICT (slot_id) DO UPDATE SET
         min_impressions = coalesce($2, slot_optimization_settings.min_impressions),
         min_conversions = coalesce($3, slot_optimization_settings.min_conversions),
         floor_mode = coalesce($4, slot_optimization_settings.floor_mode),
         floor_percent = coalesce($5, slot_optimization_settings.floor_percent)`,
      [
        slotId,
        typeof body?.minImpressions === "number" ? body.minImpressions : null,
        typeof body?.minConversions === "number" ? body.minConversions : null,
        body?.floorMode ?? null,
        typeof body?.floorPercent === "number" ? body.floorPercent : null,
      ]
    );
  }

  return NextResponse.json({ ok: true });
}
