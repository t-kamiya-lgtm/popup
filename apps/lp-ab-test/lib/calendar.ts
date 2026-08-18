import { pool } from "./db";

export interface CompositionBand {
  from: string; // yyyy-mm-dd, inclusive
  to: string; // yyyy-mm-dd, inclusive
  slotA: number[]; // creative ids active in slot A throughout this band (empty if no slot A)
  slotB: number[];
}

interface Interval {
  creativeId: number;
  slotKey: "a" | "b";
  start: string; // yyyy-mm-dd
  end: string | null; // yyyy-mm-dd, exclusive — null means "still active"
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayString(d);
}

/**
 * Reconstructs, for each day in [from, to], which creatives were active in
 * each slot — purely from creative_status_events, no separate snapshot
 * table (docs/lp-ab-test/01-data-model.md 7) — then merges consecutive
 * identical-composition days into bands (docs/lp-ab-test/00-requirements.md
 * 6: "同一構成が連続する期間は自動でグルーピング").
 *
 * A creative counts as active on a day if it had a 'created'/'activated'
 * event on or before that day and no later 'paused' event on or before that
 * day — the pause's own day is treated as already paused (conservative:
 * avoids over-counting a day where delivery may have stopped partway
 * through).
 */
export async function getCompositionBands(lpId: number, from: string, to: string): Promise<CompositionBand[]> {
  const { rows: creativeRows } = await pool().query(
    `SELECT c.id, s.slot_key FROM creatives c JOIN lp_slots s ON s.id = c.slot_id WHERE s.lp_id = $1`,
    [lpId]
  );
  const slotByCreative = new Map<number, "a" | "b">(creativeRows.map((r) => [Number(r.id), r.slot_key]));

  const { rows: eventRows } = await pool().query(
    `SELECT e.creative_id, e.event_type, e.occurred_at
     FROM creative_status_events e JOIN creatives c ON c.id = e.creative_id JOIN lp_slots s ON s.id = c.slot_id
     WHERE s.lp_id = $1 AND e.event_type IN ('created', 'activated', 'paused') AND e.occurred_at < $2::date + interval '1 day'
     ORDER BY e.occurred_at ASC`,
    [lpId, to]
  );

  // Build active intervals per creative from the event stream.
  const intervals: Interval[] = [];
  const openStart = new Map<number, string>();
  for (const row of eventRows) {
    const creativeId = Number(row.creative_id);
    const slotKey = slotByCreative.get(creativeId);
    if (!slotKey) continue;
    const day = dayString(new Date(row.occurred_at));
    if (row.event_type === "created" || row.event_type === "activated") {
      if (!openStart.has(creativeId)) openStart.set(creativeId, day);
    } else if (row.event_type === "paused") {
      const start = openStart.get(creativeId);
      if (start) {
        intervals.push({ creativeId, slotKey, start, end: day });
        openStart.delete(creativeId);
      }
    }
  }
  for (const [creativeId, start] of openStart) {
    intervals.push({ creativeId, slotKey: slotByCreative.get(creativeId)!, start, end: null });
  }

  function activeOn(day: string): { slotA: number[]; slotB: number[] } {
    const slotA: number[] = [];
    const slotB: number[] = [];
    for (const iv of intervals) {
      if (iv.start <= day && (iv.end === null || day < iv.end)) {
        (iv.slotKey === "a" ? slotA : slotB).push(iv.creativeId);
      }
    }
    slotA.sort((a, b) => a - b);
    slotB.sort((a, b) => a - b);
    return { slotA, slotB };
  }

  const bands: CompositionBand[] = [];
  let day = from;
  let current: { slotA: number[]; slotB: number[] } | null = null;
  let bandStart = from;
  while (day <= to) {
    const composition = activeOn(day);
    const signature = JSON.stringify(composition);
    if (current === null) {
      current = composition;
      bandStart = day;
    } else if (JSON.stringify(current) !== signature) {
      bands.push({ from: bandStart, to: addDays(day, -1), slotA: current.slotA, slotB: current.slotB });
      current = composition;
      bandStart = day;
    }
    day = addDays(day, 1);
  }
  if (current !== null) bands.push({ from: bandStart, to, slotA: current.slotA, slotB: current.slotB });

  return bands;
}
