import type { PoolClient } from "pg";

export interface ReportSummary {
  imps: number;
  clicks: number;
  ctr: number;
  cvs: number;
  cvr: number;
  revenue: number;
}

export interface PageRow {
  pattern: string;
  imps: number;
  clicks: number;
  ctr: number;
}

export interface BrandRow {
  brandName: string;
  imps: number;
  clicks: number;
  ctr: number;
  cvs: number;
  cvr: number;
  revenue: number;
}

export interface CreativeRow {
  id: number;
  name: string;
  thumbnail: string | null;
  weight: number;
  imps: number;
  clicks: number;
  ctr: number;
  cvs: number;
  cvr: number;
  revenue: number;
}

export interface DetailRow {
  brandName: string;
  pagePattern: string;
  creativeName: string;
  imps: number;
  clicks: number;
  ctr: number;
  cvs: number;
  cvr: number;
  revenue: number;
}

export interface ReportFilters {
  brandId?: number;
  pagePattern?: string;
  creativeId?: number;
}

export interface ReportData {
  summary: ReportSummary;
  pages: PageRow[];
  brands: BrandRow[];
  creatives: CreativeRow[];
  details: DetailRow[];
  crossDomainCart: boolean;
}

export interface FilterOptions {
  brands: { id: number; name: string }[];
  pages: string[];
  creatives: { id: number; name: string }[];
}

function ctrOf(clicks: number, imps: number): number {
  return imps > 0 ? clicks / imps : 0;
}
function cvrOf(cvs: number, clicks: number): number {
  return clicks > 0 ? cvs / clicks : 0;
}

/**
 * `ev` resolves each event's "page" as a match against its own campaign's
 * "②対象ページ（URLルール）" — the same rules the admin already configures
 * to control delivery, reused here as the reporting label instead of the
 * never-built, separate `page_groups` feature. Picks the lowest-id
 * ("含める") rule that matches, same tie-break as `matchesTargets`.
 *
 * regex rules are deliberately excluded: an admin-entered regex could be
 * invalid, and Postgres's `~` throws on a bad pattern — one broken regex
 * campaign would take down every report query. They fall back to "その他"
 * like everything else that doesn't match.
 *
 * CV events have no page_path at all (they fire on the thank-you page, not
 * the LP the touch happened on — docs/09-cart-integration.md 3), so they
 * always fall back too. Carrying the touch's original page through to CV
 * is a bigger change (packages/sdk's touch storage + collector wire
 * format) left for later.
 *
 * A CTE (not a bare LATERAL after the fact) because the creatives query
 * below needs to filter *which events count* by the resolved pattern from
 * within a LEFT JOIN's ON clause — that only works if the pattern is
 * already a plain column by the time that join happens, not something
 * computed by a LATERAL joined after it.
 */
const EVENTS_CTE = `
  WITH ev AS (
    SELECT e.*, tp.pattern AS page_pattern
    FROM events e
    LEFT JOIN LATERAL (
      SELECT ct.pattern
      FROM campaign_targets ct
      WHERE ct.campaign_id = e.campaign_id AND ct.kind = 'include' AND ct.target_type = 'url'
        AND (
          (ct.match_type = 'exact' AND e.page_path = ct.pattern) OR
          (ct.match_type = 'prefix' AND left(e.page_path, length(ct.pattern)) = ct.pattern) OR
          (ct.match_type = 'contains' AND position(ct.pattern in e.page_path) > 0)
        )
      ORDER BY ct.id
      LIMIT 1
    ) tp ON true
    WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
  )
`;

/** Options for the brand/page/creative filter dropdowns (docs/06-admin.md 5.1). */
export async function getFilterOptions(client: PoolClient, siteId: number): Promise<FilterOptions> {
  const [brands, pages, creatives] = await Promise.all([
    client.query(
      `SELECT b.id, b.name FROM brands b JOIN sites s ON s.account_id = b.account_id
       WHERE s.id = $1 ORDER BY b.name`,
      [siteId]
    ),
    client.query(
      `SELECT DISTINCT ct.pattern FROM campaign_targets ct JOIN campaigns c ON c.id = ct.campaign_id
       WHERE c.site_id = $1 AND ct.kind = 'include' AND ct.target_type = 'url' AND ct.match_type != 'regex'
       ORDER BY ct.pattern`,
      [siteId]
    ),
    client.query(
      `SELECT c.id, c.name FROM creatives c JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE camp.site_id = $1 ORDER BY c.name`,
      [siteId]
    ),
  ]);
  return {
    brands: brands.rows.map((r) => ({ id: Number(r.id), name: r.name })),
    pages: pages.rows.map((r) => r.pattern),
    creatives: creatives.rows.map((r) => ({ id: Number(r.id), name: r.name })),
  };
}

/**
 * All of this queries `events` directly for the requested date range
 * rather than reading pre-aggregated `stats_daily` rows.
 * docs/03-data-model.md's `stats_daily` table exists for when volume grows
 * enough to need it, but Phase 1 has no cron runner to populate it (same
 * gap as the order-API sync — see docs/04-api.md 1.5.3) and at ~10k PV/month
 * a live GROUP BY over `events` is trivially fast, so this is a reasonable
 * simplification for now rather than standing up a batch job for a table
 * nothing else reads yet.
 *
 * Brand replaced product as the "what was this for" axis: a brand lives on
 * the *campaign* (campaigns.brand_id), the same thing every event already
 * carries a campaign_id for, so — unlike the old product axis, which only
 * CV rows had (identified from the thank-you page's {商品毎出力} loop tag,
 * docs/09-cart-integration.md 4) — imp/click get a brand breakdown too.
 * `filters.brandId` is a plain `LEFT JOIN campaigns ... AND camp.brand_id = $n`
 * everywhere below, no special-casing needed. Same story for "page" — see
 * EVENTS_CTE above.
 */
export async function getReportData(
  client: PoolClient,
  siteId: number,
  from: Date,
  to: Date,
  filters: ReportFilters = {}
): Promise<ReportData> {
  const { rows: siteRows } = await client.query(`SELECT cross_domain_cart FROM sites WHERE id = $1`, [siteId]);
  const crossDomainCart = siteRows[0]?.cross_domain_cart ?? false;

  // Shared page/creative/brand conditions, appended to each query below.
  // $1=siteId, $2=from, $3=to are consumed by EVENTS_CTE; extra filter
  // params start at $4.
  let extraSql = "";
  const extraParams: unknown[] = [];
  if (filters.pagePattern != null) {
    extraParams.push(filters.pagePattern);
    extraSql += ` AND e.page_pattern = $${3 + extraParams.length}`;
  }
  if (filters.creativeId != null) {
    extraParams.push(filters.creativeId);
    extraSql += ` AND e.creative_id = $${3 + extraParams.length}`;
  }
  if (filters.brandId != null) {
    extraParams.push(filters.brandId);
    extraSql += ` AND camp.brand_id = $${3 + extraParams.length}`;
  }

  const summaryRows = (
    await client.query(
      `${EVENTS_CTE}
       SELECT
         count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
         count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
         count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
         coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
       FROM ev e
       LEFT JOIN campaigns camp ON camp.id = e.campaign_id
       WHERE TRUE${extraSql}`,
      [siteId, from, to, ...extraParams]
    )
  ).rows[0];
  const summary: ReportSummary = {
    imps: Number(summaryRows.imps),
    clicks: Number(summaryRows.clicks),
    ctr: ctrOf(Number(summaryRows.clicks), Number(summaryRows.imps)),
    cvs: Number(summaryRows.cvs),
    cvr: cvrOf(Number(summaryRows.cvs), Number(summaryRows.clicks)),
    revenue: Number(summaryRows.revenue),
  };

  const { rows: pageRows } = await client.query(
    `${EVENTS_CTE}
     SELECT coalesce(e.page_pattern, 'その他') AS pattern,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks
     FROM ev e
     LEFT JOIN campaigns camp ON camp.id = e.campaign_id
     WHERE e.event_type IN ('imp', 'click')${extraSql}
     GROUP BY coalesce(e.page_pattern, 'その他')
     ORDER BY imps DESC`,
    [siteId, from, to, ...extraParams]
  );
  const pages: PageRow[] = pageRows.map((r) => ({
    pattern: r.pattern,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
  }));

  const { rows: brandRows } = await client.query(
    `${EVENTS_CTE}
     SELECT coalesce(b.name, '（ブランド未設定）') AS brand_name,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
            count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
            coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
     FROM ev e
     LEFT JOIN campaigns camp ON camp.id = e.campaign_id
     LEFT JOIN brands b ON b.id = camp.brand_id
     WHERE TRUE${extraSql}
     GROUP BY coalesce(b.name, '（ブランド未設定）')
     ORDER BY revenue DESC, imps DESC`,
    [siteId, from, to, ...extraParams]
  );
  const brands: BrandRow[] = brandRows.map((r) => ({
    brandName: r.brand_name,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
    cvs: Number(r.cvs),
    cvr: cvrOf(Number(r.cvs), Number(r.clicks)),
    revenue: Number(r.revenue),
  }));

  // pagePattern/brandId restrict which *events* count (stay in the LEFT
  // JOIN's ON clause, so every creative still gets a row, just with
  // fewer/zero matching events); creativeId restricts which *creative
  // rows* appear at all, so it has to be a WHERE condition — putting it in
  // the ON clause instead would leave every other creative listed with
  // zeroed-out counts rather than actually filtering the list.
  const creativeParams: unknown[] = [siteId, from, to];
  let creativeJoinSql = "";
  let creativeWhereSql = "";
  if (filters.pagePattern != null) {
    creativeParams.push(filters.pagePattern);
    creativeJoinSql += ` AND e.page_pattern = $${creativeParams.length}`;
  }
  if (filters.brandId != null) {
    creativeParams.push(filters.brandId);
    creativeWhereSql += ` AND camp.brand_id = $${creativeParams.length}`;
  }
  if (filters.creativeId != null) {
    creativeParams.push(filters.creativeId);
    creativeWhereSql += ` AND c.id = $${creativeParams.length}`;
  }
  const { rows: creativeRows } = await client.query(
    `${EVENTS_CTE}
     SELECT c.id, c.name, c.weight,
            (SELECT url FROM asset_variants WHERE asset_id = c.asset_pc_id AND purpose = 'pc' AND format != 'webp' LIMIT 1) AS thumbnail,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
            count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
            coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
     FROM creatives c
     JOIN campaigns camp ON camp.id = c.campaign_id
     LEFT JOIN ev e ON e.creative_id = c.id${creativeJoinSql}
     WHERE camp.site_id = $1${creativeWhereSql}
     GROUP BY c.id, c.name, c.weight
     ORDER BY imps DESC`,
    creativeParams
  );
  const creatives: CreativeRow[] = creativeRows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    thumbnail: r.thumbnail,
    weight: r.weight,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
    cvs: Number(r.cvs),
    cvr: cvrOf(Number(r.cvs), Number(r.clicks)),
    revenue: Number(r.revenue),
  }));

  // Brand x page x creative detail. Restricted to imp/click/cv (excludes
  // close/holdout) since those carry no creative/page reliably (see
  // packages/sdk/src/index.ts's onClose call) and would otherwise show up
  // as useless all-zero rows.
  const { rows: detailRows } = await client.query(
    `${EVENTS_CTE}
     SELECT coalesce(b.name, '（ブランド未設定）') AS brand_name,
            coalesce(e.page_pattern, '（ページ不明）') AS page_pattern,
            coalesce(c.name, '（削除済みクリエイティブ）') AS creative_name,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
            count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
            coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
     FROM ev e
     LEFT JOIN campaigns camp ON camp.id = e.campaign_id
     LEFT JOIN brands b ON b.id = camp.brand_id
     LEFT JOIN creatives c ON c.id = e.creative_id
     WHERE e.event_type IN ('imp', 'click', 'cv')${extraSql}
     GROUP BY b.name, e.page_pattern, c.name
     ORDER BY revenue DESC, imps DESC`,
    [siteId, from, to, ...extraParams]
  );
  const details: DetailRow[] = detailRows.map((r) => ({
    brandName: r.brand_name,
    pagePattern: r.page_pattern,
    creativeName: r.creative_name,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
    cvs: Number(r.cvs),
    cvr: cvrOf(Number(r.cvs), Number(r.clicks)),
    revenue: Number(r.revenue),
  }));

  return { summary, pages, brands, creatives, details, crossDomainCart };
}
