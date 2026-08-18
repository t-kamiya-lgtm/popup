import { NextResponse, type NextRequest } from "next/server";
import { withClient } from "@/lib/db";
import { requireEditor } from "@/lib/require-member";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const lpId = Number(params.id);
  const body = await request.json().catch(() => null);
  const slotKey = body?.slotKey;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const originalImageUrl = typeof body?.originalImageUrl === "string" ? body.originalImageUrl.trim() : "";
  if (slotKey !== "a" && slotKey !== "b") {
    return NextResponse.json({ error: "slotKey must be 'a' or 'b'" }, { status: 400 });
  }
  if (!originalImageUrl) {
    return NextResponse.json({ error: "差し替え対象の画像URLは必須です" }, { status: 400 });
  }

  try {
    const slotId = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const existing = await client.query(`SELECT count(*) FROM lp_slots WHERE lp_id = $1`, [lpId]);
        if (Number(existing.rows[0].count) >= 2) {
          throw new Error("1つのLPに設定できる差し替え箇所は最大2箇所です");
        }
        const { rows } = await client.query(
          `INSERT INTO lp_slots (lp_id, slot_key, label, original_image_url) VALUES ($1, $2, $3, $4) RETURNING id`,
          [lpId, slotKey, label, originalImageUrl]
        );
        const slotId = Number(rows[0].id);
        const original = await client.query(
          `INSERT INTO creatives (slot_id, name, is_original, status, weight_percent, created_by)
           VALUES ($1, '元画像', true, 'active', 100, $2) RETURNING id`,
          [slotId, member.id]
        );
        await client.query(
          `INSERT INTO creative_status_events (creative_id, event_type, weight_after, actor_id) VALUES ($1, 'created', 100, $2)`,
          [original.rows[0].id, member.id]
        );
        await client.query("COMMIT");
        return slotId;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
    return NextResponse.json({ id: slotId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "作成に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
