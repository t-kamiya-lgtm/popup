import type { PoolClient } from "pg";

export interface ReportSummary {
  imps: number;
  clicks: number;
  ctr: number;
  cvs: number;
  cvr: number;
  revenue: number;
}

export interface PageGroupRow {
  name: string;
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
  pageGroupName: string;
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
  pageGroupId?: number;
  creativeId?: number;
}

export interface ReportData {
  summary: ReportSummary;
  pageGroups: PageGroupRow[];
  brands: BrandRow[];
  creatives: CreativeRow[];
  details: DetailRow[];
  crossDomainCart: boolean;
}

export interface FilterOptions {
  brands: { id: number; name: string }[];
  pageGroups: { id: number; name: string }[];
  creatives: { id: number; name: string }[];
}

function ctrOf(clicks: number, imps: number): number {
  return imps > 0 ? clicks / imps : 0;
}
function cvrOf(cvs: number, clicks: number): number {
  return clicks > 0 ? cvs / clicks : 0;
}

/** Options for the brand/page/creative filter dropdowns (docs/06-admin.md 5.1). */
export async function getFilterOptions(client: PoolClient, siteId: number): Promise<FilterOptions> {
  const [brands, pageGroups, creatives] = await Promise.all([
    client.query(
      `SELECT b.id, b.name FROM brands b JOIN sites s ON s.account_id = b.account_id
       WHERE s.id = $1 ORDER BY b.name`,
      [siteId]
    ),
    client.query(`SELECT id, name FROM page_groups WHERE site_id = $1 ORDER BY priority`, [siteId]),
    client.query(
      `SELECT c.id, c.name FROM creatives c JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE camp.site_id = $1 ORDER BY c.name`,
      [siteId]
    ),
  ]);
  return {
    brands: brands.rows.map((r) => ({ id: Number(r.id), name: r.name })),
    pageGroups: pageGroups.rows.map((r) => ({ id: Number(r.id), name: r.name })),
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
 * everywhere below, no special-casing needed.
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
  // $1=siteId, $2=from, $3=to are always first; extra filter params start at $4.
  let extraSql = "";
  const extraParams: unknown[] = [];
  if (filters.pageGroupId != null) {
    extraParams.push(filters.pageGroupId);
    extraSql += ` AND e.page_group_id = $${3 + extraParams.length}`;
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
      `SELECT
         count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
         count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
         count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
         coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
       FROM events e
       LEFT JOIN campaigns camp ON camp.id = e.campaign_id
       WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3${extraSql}`,
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

  const { rows: pgRows } = await client.query(
    `SELECT coalesce(pg.name, 'その他') AS name,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks
     FROM events e
     LEFT JOIN page_groups pg ON pg.id = e.page_group_id
     LEFT JOIN campaigns camp ON camp.id = e.campaign_id
     WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
       AND e.event_type IN ('imp', 'click')${extraSql}
     GROUP BY coalesce(pg.name, 'その他')
     ORDER BY imps DESC`,
    [siteId, from, to, ...extraParams]
  );
  const pageGroups: PageGroupRow[] = pgRows.map((r) => ({
    name: r.name,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
  }));

  const { rows: brandRows } = await client.query(
    `SELECT coalesce(b.name, '（ブランド未設定）') AS brand_name,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
            count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
            coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
     FROM events e
     LEFT JOIN campaigns camp ON camp.id = e.campaign_id
     LEFT JOIN brands b ON b.id = camp.brand_id
     WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3${extraSql}
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

  // pageGroupId/brandId restrict which *events* count (stay in the LEFT
  // JOIN's ON clause, so every creative still gets a row, just with
  // fewer/zero matching events); creativeId restricts which *creative
  // rows* appear at all, so it has to be a WHERE condition — putting it in
  // the ON clause instead would leave every other creative listed with
  // zeroed-out counts rather than actually filtering the list.
  const creativeParams: unknown[] = [siteId, from, to];
  let creativeJoinSql = "";
  let creativeWhereSql = "";
  if (filters.pageGroupId != null) {
    creativeParams.push(filters.pageGroupId);
    creativeJoinSql += ` AND e.page_group_id = $${creativeParams.length}`;
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
    `SELECT c.id, c.name, c.weight,
            (SELECT url FROM asset_variants WHERE asset_id = c.asset_pc_id AND purpose = 'pc' AND format != 'webp' LIMIT 1) AS thumbnail,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
            count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
            coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
     FROM creatives c
     JOIN campaigns camp ON camp.id = c.campaign_id
     LEFT JOIN events e ON e.creative_id = c.id AND e.occurred_at >= $2 AND e.occurred_at < $3${creativeJoinSql}
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
    `SELECT coalesce(b.name, '（ブランド未設定）') AS brand_name,
            coalesce(pg.name, '（ページ不明）') AS page_group_name,
            coalesce(c.name, '（削除済みクリエイティブ）') AS creative_name,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks,
            count(*) FILTER (WHERE e.event_type = 'cv') AS cvs,
            coalesce(sum(e.revenue) FILTER (WHERE e.event_type = 'cv'), 0) AS revenue
     FROM events e
     LEFT JOIN campaigns camp ON camp.id = e.campaign_id
     LEFT JOIN brands b ON b.id = camp.brand_id
     LEFT JOIN page_groups pg ON pg.id = e.page_group_id
     LEFT JOIN creatives c ON c.id = e.creative_id
     WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
       AND e.event_type IN ('imp', 'click', 'cv')${extraSql}
     GROUP BY b.name, pg.name, c.name
     ORDER BY revenue DESC, imps DESC`,
    [siteId, from, to, ...extraParams]
  );
  const details: DetailRow[] = detailRows.map((r) => ({
    brandName: r.brand_name,
    pageGroupName: r.page_group_name,
    creativeName: r.creative_name,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
    cvs: Number(r.cvs),
    cvr: cvrOf(Number(r.cvs), Number(r.clicks)),
    revenue: Number(r.revenue),
  }));

  return { summary, pageGroups, brands, creatives, details, crossDomainCart };
}
