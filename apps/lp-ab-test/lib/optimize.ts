import type { PoolClient } from "pg";
import { pool, withClient } from "./db";

// How far back the batch looks when accumulating imp/CV totals per
// creative. Not specified exactly by docs/lp-ab-test/00-requirements.md 5
// ("最低imp件数・最低CV件数の閾値を満たしたパターンのみ再配分") — a rolling
// window is used rather than all-time totals so weights keep responding to
// recent performance instead of being swamped by months of accumulated
// history once a pattern matures. Tunable later; not exposed as a per-slot
// setting in Phase 2.
const LOOKBACK_DAYS = 30;

interface CreativeAgg {
  id: number;
  isLocked: boolean;
  weightPercent: number;
  imps: number;
  cv: number;
}

/**
 * Daily CVR-based auto-optimization (docs/lp-ab-test/00-requirements.md 5,
 * docs/lp-ab-test/02-architecture.md 4). Runs once per `optimization_mode
 * = 'auto'` slot, independently of every other slot (A and B never affect
 * each other). Algorithm, in order:
 *
 * 1. `is_locked` creatives are frozen — their current weight is excluded
 *    from this run entirely (docs 00-requirements.md: "自動反映後も...手動で
 *    固定することは可能"). The other, non-locked active creatives split
 *    whatever percentage remains.
 * 2. Every remaining active creative is guaranteed a floor
 *    (`slot_optimization_settings.floor_mode`): docs 01-data-model.md 8's
 *    "均等割りした場合の割合" is read literally here as 100 / n — this over-
 *    allocates on paper (n floors already sum to 100), so step 3 only ever
 *    grants *additional* weight on top of the floor to patterns whose
 *    sample size actually clears the min imp/CV thresholds; everyone below
 *    threshold is capped at exactly the floor. That's the deliberate
 *    trade-off this makes: thresholds gate "extra" allocation, not
 *    "reduced-below-equal" allocation, so a brand-new/still-thin-data
 *    pattern never gets starved by this batch.
 * 3. Creatives clearing both thresholds ("eligible") split the remaining
 *    budget (100 − Σfloors) proportional to CVR — more conversions per
 *    impression, more of the discretionary share. With fewer than 2
 *    eligible creatives there's nothing to compare, so the slot is left
 *    untouched this run (still records `last_run_at`).
 *
 * Pause always wins over all of this (docs 00-requirements.md 5): paused
 * creatives are simply excluded (their weight is pinned to 0 elsewhere,
 * e.g. lib/weights.ts, whenever their status changes).
 */
export async function runDailyOptimization(): Promise<{ slotsProcessed: number }> {
  const { rows: slots } = await pool().query(
    `SELECT s.id, s.lp_id,
            coalesce(o.min_impressions, 1000) AS min_impressions,
            coalesce(o.min_conversions, 5) AS min_conversions,
            coalesce(o.floor_mode, 'equal_share') AS floor_mode,
            o.floor_percent
     FROM lp_slots s
     LEFT JOIN slot_optimization_settings o ON o.slot_id = s.id
     WHERE s.optimization_mode = 'auto'`
  );

  let processed = 0;
  await withClient(async (client) => {
    for (const slot of slots) {
      await optimizeSlot(client, {
        slotId: Number(slot.id),
        minImpressions: Number(slot.min_impressions),
        minConversions: Number(slot.min_conversions),
        floorMode: slot.floor_mode as "equal_share" | "fixed_percent",
        floorPercent: slot.floor_percent !== null ? Number(slot.floor_percent) : null,
      });
      processed++;
    }
  });
  return { slotsProcessed: processed };
}

async function optimizeSlot(
  client: PoolClient,
  slot: { slotId: number; minImpressions: number; minConversions: number; floorMode: "equal_share" | "fixed_percent"; floorPercent: number | null }
) {
  await client.query("BEGIN");
  try {
    const { rows: creativeRows } = await client.query(
      `SELECT id, is_locked, weight_percent FROM creatives WHERE slot_id = $1 AND status = 'active'`,
      [slot.slotId]
    );
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const creativeIds: number[] = creativeRows.map((r) => Number(r.id));
    const [impRows, cvRows] = await Promise.all([
      client.query(
        `SELECT creative_id, count(*)::int AS n FROM (
           SELECT creative_a_id AS creative_id FROM impressions WHERE occurred_at >= $1 AND creative_a_id = ANY($2::bigint[])
           UNION ALL
           SELECT creative_b_id AS creative_id FROM impressions WHERE occurred_at >= $1 AND creative_b_id = ANY($2::bigint[])
         ) t GROUP BY creative_id`,
        [since, creativeIds]
      ),
      client.query(
        `SELECT creative_id, count(*)::int AS n FROM (
           SELECT creative_a_id AS creative_id FROM conversions WHERE occurred_at >= $1 AND creative_a_id = ANY($2::bigint[])
           UNION ALL
           SELECT creative_b_id AS creative_id FROM conversions WHERE occurred_at >= $1 AND creative_b_id = ANY($2::bigint[])
         ) t GROUP BY creative_id`,
        [since, creativeIds]
      ),
    ]);
    const impById = new Map<number, number>(impRows.rows.map((r) => [Number(r.creative_id), Number(r.n)]));
    const cvById = new Map<number, number>(cvRows.rows.map((r) => [Number(r.creative_id), Number(r.n)]));

    const creatives: CreativeAgg[] = creativeRows.map((r) => ({
      id: Number(r.id),
      isLocked: r.is_locked as boolean,
      weightPercent: Number(r.weight_percent),
      imps: impById.get(Number(r.id)) ?? 0,
      cv: cvById.get(Number(r.id)) ?? 0,
    }));

    const locked = creatives.filter((c) => c.isLocked);
    const free = creatives.filter((c) => !c.isLocked);
    const lockedTotal = locked.reduce((sum, c) => sum + c.weightPercent, 0);
    const budget = Math.max(0, 100 - lockedTotal);

    if (free.length === 0) {
      await client.query(
        `UPDATE slot_optimization_settings SET last_run_at = now() WHERE slot_id = $1`,
        [slot.slotId]
      );
      await client.query("COMMIT");
      return;
    }

    const floor = slot.floorMode === "fixed_percent" && slot.floorPercent !== null ? slot.floorPercent : budget / free.length;
    const eligible = free.filter((c) => c.imps >= slot.minImpressions && c.cv >= slot.minConversions);

    const weights = new Map<number, number>();

    if (eligible.length >= 2) {
      const floorSum = floor * free.length;
      const discretionary = Math.max(0, budget - floorSum);
      const scores = eligible.map((c) => (c.imps > 0 ? c.cv / c.imps : 0));
      const scoreSum = scores.reduce((a, b) => a + b, 0);
      eligible.forEach((c, i) => {
        const share = scoreSum > 0 ? scores[i] / scoreSum : 1 / eligible.length;
        weights.set(c.id, Math.round((floor + discretionary * share) * 100) / 100);
      });
      // Non-eligible free creatives (thin data) stay pinned at the floor.
      for (const c of free) if (!eligible.includes(c)) weights.set(c.id, Math.round(floor * 100) / 100);
    } else {
      // Not enough comparable data yet — leave everyone at their current
      // weight rather than forcing a meaningless floor reset.
      for (const c of free) weights.set(c.id, c.weightPercent);
    }

    for (const c of free) {
      const after = weights.get(c.id)!;
      if (after === c.weightPercent) continue;
      await client.query(`UPDATE creatives SET weight_percent = $1, updated_at = now() WHERE id = $2`, [after, c.id]);
      await client.query(
        `INSERT INTO creative_status_events (creative_id, event_type, weight_before, weight_after, actor_id)
         VALUES ($1, 'optimized', $2, $3, NULL)`,
        [c.id, c.weightPercent, after]
      );
    }

    await client.query(
      `INSERT INTO slot_optimization_settings (slot_id, last_run_at) VALUES ($1, now())
       ON CONFLICT (slot_id) DO UPDATE SET last_run_at = now()`,
      [slot.slotId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
