import { NextResponse, type NextRequest } from "next/server";
import { withClient } from "@/lib/db";
import { requireEditor } from "@/lib/require-member";
import { checkAspectRatio, uploadCreativeAsset } from "@/lib/assets";
import { recalcEqualWeights } from "@/lib/weights";

const MAX_CREATIVES_PER_SLOT = 99; // docs/lp-ab-test/00-requirements.md 2 — includes the original

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireEditor();
  if (member instanceof NextResponse) return member;

  const slotId = Number(params.id);
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("image");
  const name = formData?.get("name");
  if (!(file instanceof File) || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "画像ファイルと名前が必要です" }, { status: 400 });
  }

  try {
    const result = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const countRes = await client.query(`SELECT count(*) FROM creatives WHERE slot_id = $1`, [slotId]);
        if (Number(countRes.rows[0].count) >= MAX_CREATIVES_PER_SLOT) {
          throw new Error(`このスロットには最大${MAX_CREATIVES_PER_SLOT}パターンまで登録できます`);
        }

        const refRes = await client.query(
          `SELECT a.width, a.height, s.original_image_url FROM creatives c
           JOIN lp_slots s ON s.id = c.slot_id
           LEFT JOIN assets a ON a.id = c.asset_id
           WHERE c.slot_id = $1 AND c.is_original = true`,
          [slotId]
        );
        const reference =
          refRes.rows.length > 0 && refRes.rows[0].width ? { width: refRes.rows[0].width, height: refRes.rows[0].height } : null;

        const buffer = Buffer.from(await file.arrayBuffer());
        const asset = await uploadCreativeAsset(client, buffer, file.type || "image/jpeg");
        const warning = checkAspectRatio(asset, reference);

        const { rows } = await client.query(
          `INSERT INTO creatives (slot_id, name, asset_id, status, weight_percent, created_by)
           VALUES ($1, $2, $3, 'active', 0, $4) RETURNING id`,
          [slotId, name.trim(), asset.assetId, member.id]
        );
        const creativeId = Number(rows[0].id);
        await client.query(
          `INSERT INTO creative_status_events (creative_id, event_type, actor_id) VALUES ($1, 'created', $2)`,
          [creativeId, member.id]
        );

        // Equal-split slots recompute live; auto slots get a sane default
        // weight now too (the daily optimization batch supersedes it later).
        await recalcEqualWeights(client, slotId, member.id);

        await client.query("COMMIT");
        return { creativeId, assetUrl: asset.url, warning };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
    return NextResponse.json({ id: result.creativeId, imageUrl: result.assetUrl, warning: result.warning }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "登録に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
