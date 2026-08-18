import { pool } from "./db";

export interface TagCheckResult {
  fetchOk: boolean;
  fetchError: string | null;
  tagFound: boolean;
  lpIdMatches: boolean;
  impressionsLast24h: number;
}

/**
 * docs/lp-ab-test/02-architecture.md 8 — "HTML取得検査・24時間受信状況表示".
 * Live, on-demand check (no scheduled crawl in Phase 2): fetches the LP's
 * own URL server-side and looks for the delivery tag `<script>` tag, then
 * separately reports whether any impressions actually arrived in the last
 * 24h — the two can disagree (tag present but blocked by a CSP, or tag
 * missing but an old cached page still serving stale imp beacons from a
 * previous install), which is the whole point of checking both.
 */
export async function checkTagInstallation(lpId: number, lpUrl: string, appBaseUrl: string): Promise<TagCheckResult> {
  let html = "";
  let fetchOk = true;
  let fetchError: string | null = null;
  try {
    const res = await fetch(lpUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    fetchOk = res.ok;
    if (!res.ok) fetchError = `HTTP ${res.status}`;
    html = await res.text();
  } catch (err) {
    fetchOk = false;
    fetchError = err instanceof Error ? err.message : "fetch failed";
  }

  // Loose match: don't require exact attribute order/quoting, just that a
  // <script> tag references our tag.js from this app's origin and carries
  // this LP's id somewhere in its attributes.
  const scriptTagPattern = new RegExp(`<script[^>]*src=["']${escapeRegExp(appBaseUrl)}/tag\\.js["'][^>]*>`, "i");
  const scriptMatch = html.match(scriptTagPattern);
  const tagFound = Boolean(scriptMatch);
  const lpIdMatches = tagFound && new RegExp(`data-lp-id=["']${lpId}["']`).test(scriptMatch![0]);

  const { rows } = await pool().query(
    `SELECT count(*)::int AS n FROM impressions WHERE lp_id = $1 AND occurred_at >= now() - interval '24 hours'`,
    [lpId]
  );

  return { fetchOk, fetchError, tagFound, lpIdMatches, impressionsLast24h: Number(rows[0].n) };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
