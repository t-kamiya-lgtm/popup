import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireMember } from "@/lib/require-member";

// Flat audit log for this LP's slots — the source the calendar drill-down
// report (Phase 2) will reconstruct "what was live on day X" from
// (docs/lp-ab-test/01-data-model.md 7).
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const lpId = Number(params.id);
  const { rows } = await pool().query(
    `SELECT e.event_type, e.weight_before, e.weight_after, e.occurred_at,
            c.name AS creative_name, s.slot_key, m.email AS actor_email
     FROM creative_status_events e
     JOIN creatives c ON c.id = e.creative_id
     JOIN lp_slots s ON s.id = c.slot_id
     LEFT JOIN members m ON m.id = e.actor_id
     WHERE s.lp_id = $1
     ORDER BY e.occurred_at DESC
     LIMIT 200`,
    [lpId]
  );

  return NextResponse.json({
    events: rows.map((r) => ({
      eventType: r.event_type as string,
      slotKey: r.slot_key as string,
      creativeName: r.creative_name as string,
      weightBefore: r.weight_before !== null ? Number(r.weight_before) : null,
      weightAfter: r.weight_after !== null ? Number(r.weight_after) : null,
      actorEmail: (r.actor_email as string | null) ?? "自動最適化バッチ",
      occurredAt: (r.occurred_at as Date).toISOString(),
    })),
  });
}
