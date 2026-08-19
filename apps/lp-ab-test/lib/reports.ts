import { pool } from "./db";
import type { CreativeStat } from "./significance";

export type { CreativeStat } from "./significance";

export interface ReportFilters {
  from: string; // ISO date (inclusive)
  to: string; // ISO date (exclusive upper bound handled by caller as end-of-day)
  lpIds?: number[];
  itemName?: string;
  lpName?: string;
  /** Restrict displayed creatives to this set (calendar band drill-down — docs/lp-ab-test/00-requirements.md 6). */
  creativeIds?: number[];
}

export interface SlotStat {
  slotKey: "a" | "b";
  label: string;
  creatives: CreativeStat[];
}

export interface LpReport {
  lpId: number;
  productCode: string;
  itemName: string;
  lpName: string;
  url: string;
  slots: SlotStat[];
}

/**
 * docs/lp-ab-test/00-requirements.md 6: default view is "this month's LPs
 * with delivery activity"; explicit LP selection overrides that (an
 * explicitly picked LP is shown even with zero activity in the period).
 * Queries impressions/conversions directly rather than a stats_daily
 * rollup — same Phase 1 judgment the popup tool made (see its README):
 * no cron infra yet, and this data volume is cheap to aggregate live.
 */
export async function getReport(filters: ReportFilters): Promise<LpReport[]> {
  const lpIds = await resolveLpIds(filters);
  if (lpIds.length === 0) return [];

  const [slotRows, impA, impB, cvA, cvB] = await Promise.all([
    pool().query(
      `SELECT s.id AS slot_id, s.lp_id, s.slot_key, s.label,
              c.id AS creative_id, c.name, c.is_original, a.url AS asset_url
       FROM lp_slots s
       JOIN creatives c ON c.slot_id = s.id
       LEFT JOIN assets a ON a.id = c.asset_id
       WHERE s.lp_id = ANY($1::bigint[])
       ORDER BY s.slot_key ASC, c.is_original DESC, c.id ASC`,
      [lpIds]
    ),
    pool().query(
      `SELECT creative_a_id AS creative_id, count(*)::int AS imps
       FROM impressions WHERE lp_id = ANY($1::bigint[]) AND occurred_at >= $2 AND occurred_at < $3
         AND creative_a_id IS NOT NULL GROUP BY creative_a_id`,
      [lpIds, filters.from, filters.to]
    ),
    pool().query(
      `SELECT creative_b_id AS creative_id, count(*)::int AS imps
       FROM impressions WHERE lp_id = ANY($1::bigint[]) AND occurred_at >= $2 AND occurred_at < $3
         AND creative_b_id IS NOT NULL GROUP BY creative_b_id`,
      [lpIds, filters.from, filters.to]
    ),
    pool().query(
      `SELECT creative_a_id AS creative_id, count(*)::int AS cv, coalesce(sum(revenue), 0) AS revenue
       FROM conversions WHERE lp_id = ANY($1::bigint[]) AND occurred_at >= $2 AND occurred_at < $3
         AND creative_a_id IS NOT NULL GROUP BY creative_a_id`,
      [lpIds, filters.from, filters.to]
    ),
    pool().query(
      `SELECT creative_b_id AS creative_id, count(*)::int AS cv, coalesce(sum(revenue), 0) AS revenue
       FROM conversions WHERE lp_id = ANY($1::bigint[]) AND occurred_at >= $2 AND occurred_at < $3
         AND creative_b_id IS NOT NULL GROUP BY creative_b_id`,
      [lpIds, filters.from, filters.to]
    ),
  ]);

  const imps = mergeCounts(impA.rows, impB.rows, "imps");
  const cvCounts = mergeCounts(cvA.rows, cvB.rows, "cv");
  const revenue = mergeCounts(cvA.rows, cvB.rows, "revenue");

  const { rows: lpRows } = await pool().query(
    `SELECT id, product_code, item_name, lp_name, url FROM lps WHERE id = ANY($1::bigint[])`,
    [lpIds]
  );

  return lpRows.map((lp) => {
    const lpId = Number(lp.id);
    const slotsForLp = slotRows.rows.filter((r) => Number(r.lp_id) === lpId);
    const slotKeys = [...new Set(slotsForLp.map((r) => r.slot_key as string))] as Array<"a" | "b">;
    const slots: SlotStat[] = slotKeys.map((slotKey) => {
      const rowsForSlot = slotsForLp.filter((r) => r.slot_key === slotKey);
      const visibleRows = filters.creativeIds
        ? rowsForSlot.filter((r) => filters.creativeIds!.includes(Number(r.creative_id)))
        : rowsForSlot;
      return {
        slotKey,
        label: rowsForSlot[0]?.label ?? "",
        creatives: visibleRows.map((r) => {
          const creativeId = Number(r.creative_id);
          const impCount = imps.get(creativeId) ?? 0;
          const cvCount = cvCounts.get(creativeId) ?? 0;
          return {
            creativeId,
            creativeName: r.name as string,
            isOriginal: r.is_original as boolean,
            imageUrl: r.asset_url as string | null,
            imps: impCount,
            cv: cvCount,
            revenue: revenue.get(creativeId) ?? 0,
            cvr: impCount > 0 ? Math.round((cvCount / impCount) * 10000) / 100 : null,
          };
        }),
      };
    });
    return {
      lpId,
      productCode: lp.product_code as string,
      itemName: lp.item_name as string,
      lpName: lp.lp_name as string,
      url: lp.url as string,
      slots,
    };
  });
}

function mergeCounts(rowsA: any[], rowsB: any[], field: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of [...rowsA, ...rowsB]) {
    const id = Number(row.creative_id);
    map.set(id, (map.get(id) ?? 0) + Number(row[field]));
  }
  return map;
}

async function resolveLpIds(filters: ReportFilters): Promise<number[]> {
  if (filters.lpIds && filters.lpIds.length > 0) return filters.lpIds;

  const conditions = [`EXISTS (SELECT 1 FROM impressions i WHERE i.lp_id = l.id AND i.occurred_at >= $1 AND i.occurred_at < $2)`];
  const params: unknown[] = [filters.from, filters.to];
  if (filters.itemName) {
    params.push(`%${filters.itemName}%`);
    conditions.push(`l.item_name ILIKE $${params.length}`);
  }
  if (filters.lpName) {
    params.push(`%${filters.lpName}%`);
    conditions.push(`l.lp_name ILIKE $${params.length}`);
  }
  const { rows } = await pool().query(`SELECT l.id FROM lps l WHERE ${conditions.join(" AND ")}`, params);
  return rows.map((r) => Number(r.id));
}
