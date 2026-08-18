import type { PoolClient } from "pg";

/**
 * Equal-split weights for `n` active creatives in one slot, remainder always
 * assigned to the original pattern (docs/lp-ab-test/00-requirements.md 4:
 * "33%/33%/34%、34%が元画像"). `base` is floored to 2 decimals so the other
 * (n-1) patterns each get an equal, slightly-rounded-down share; whatever
 * that floor left on the table goes to the original.
 */
export function equalSplitWithRemainderToOriginal(n: number): { otherWeight: number; originalWeight: number } {
  if (n <= 0) return { otherWeight: 0, originalWeight: 0 };
  if (n === 1) return { otherWeight: 0, originalWeight: 100 };
  const base = Math.floor((100 / n) * 100) / 100;
  const otherWeight = base;
  const originalWeight = Math.round((100 - base * (n - 1)) * 100) / 100;
  return { otherWeight, originalWeight };
}

interface CreativeRow {
  id: number;
  is_original: boolean;
  weight_percent: string;
}

/**
 * Recomputes and persists equal-split weights for every `active` creative in
 * a slot (paused creatives are pinned to 0 — docs/lp-ab-test/01-data-model.md
 * 6). Call this after any create/pause/resume/delete of a creative in
 * `optimization_mode = 'equal'` slots. Records a `weight_changed` audit row
 * per creative whose weight actually moved (docs/lp-ab-test/00-requirements.md
 * "履歴要").
 */
export async function recalcEqualWeights(client: PoolClient, slotId: number, actorId: number | null): Promise<void> {
  const { rows } = await client.query<CreativeRow>(
    `SELECT id, is_original, weight_percent FROM creatives WHERE slot_id = $1 AND status = 'active' ORDER BY id ASC`,
    [slotId]
  );
  const { rows: pausedRows } = await client.query<CreativeRow>(
    `SELECT id, is_original, weight_percent FROM creatives WHERE slot_id = $1 AND status = 'paused'`,
    [slotId]
  );

  const { otherWeight, originalWeight } = equalSplitWithRemainderToOriginal(rows.length);

  for (const row of rows) {
    const before = Number(row.weight_percent);
    const after = row.is_original ? originalWeight : otherWeight;
    await applyWeight(client, row.id, before, after, actorId);
  }
  for (const row of pausedRows) {
    const before = Number(row.weight_percent);
    if (before !== 0) await applyWeight(client, row.id, before, 0, actorId);
  }
}

async function applyWeight(client: PoolClient, creativeId: number, before: number, after: number, actorId: number | null) {
  if (before === after) return;
  await client.query(`UPDATE creatives SET weight_percent = $1, updated_at = now() WHERE id = $2`, [after, creativeId]);
  await client.query(
    `INSERT INTO creative_status_events (creative_id, event_type, weight_before, weight_after, actor_id)
     VALUES ($1, 'weight_changed', $2, $3, $4)`,
    [creativeId, before, after, actorId]
  );
}
