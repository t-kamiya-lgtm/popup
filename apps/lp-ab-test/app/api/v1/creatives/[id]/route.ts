import { NextResponse, type NextRequest } from "next/server";
import { withClient } from "@/lib/db";
import { requireEditor } from "@/lib/require-member";
import { recalcEqualWeights } from "@/lib/weights";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const creativeId = Number(params.id);
  const body = await request.json().catch(() => null);

  try {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const current = await client.query(
          `SELECT slot_id, status, weight_percent, is_original FROM creatives WHERE id = $1 FOR UPDATE`,
          [creativeId]
        );
        if (current.rows.length === 0) throw new Error("見つかりません");
        const row = current.rows[0];
        if (row.is_original && body?.status === "paused") {
          throw new Error("元画像は停止できません");
        }

        if (body?.status === "active" || body?.status === "paused") {
          if (body.status !== row.status) {
            await client.query(`UPDATE creatives SET status = $1, updated_at = now() WHERE id = $2`, [body.status, creativeId]);
            await client.query(
              `INSERT INTO creative_status_events (creative_id, event_type, actor_id) VALUES ($1, $2, $3)`,
              [creativeId, body.status === "active" ? "activated" : "paused", member.id]
            );
            await recalcEqualWeights(client, Number(row.slot_id), member.id);
          }
        }

        if (typeof body?.weightPercent === "number") {
          const weight = Math.max(0, Math.min(100, body.weightPercent));
          const before = Number(row.weight_percent);
          await client.query(
            `UPDATE creatives SET weight_percent = $1, is_locked = true, updated_at = now() WHERE id = $2`,
            [weight, creativeId]
          );
          await client.query(
            `INSERT INTO creative_status_events (creative_id, event_type, weight_before, weight_after, actor_id)
             VALUES ($1, 'weight_changed', $2, $3, $4)`,
            [creativeId, before, weight, member.id]
          );
        }

        if (body?.isLocked === false) {
          await client.query(`UPDATE creatives SET is_locked = false, updated_at = now() WHERE id = $1`, [creativeId]);
          await client.query(
            `INSERT INTO creative_status_events (creative_id, event_type, actor_id) VALUES ($1, 'unlocked', $2)`,
            [creativeId, member.id]
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
