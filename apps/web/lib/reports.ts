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

export interface ProductRow {
  productCode: string | null;
  productName: string;
  cvClick: number;
  cvView: number;
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

export interface ReportData {
  summary: ReportSummary;
  pageGroups: PageGroupRow[];
  products: ProductRow[];
  creatives: CreativeRow[];
  crossDomainCart: boolean;
}

function ctrOf(clicks: number, imps: number): number {
  return imps > 0 ? clicks / imps : 0;
}
function cvrOf(cvs: number, clicks: number): number {
  return clicks > 0 ? cvs / clicks : 0;
}

/**
 * All of this queries `events`/`order_items` directly for the requested
 * date range rather than reading pre-aggregated `stats_daily` rows.
 * docs/03-data-model.md's `stats_daily` table exists for when volume grows
 * enough to need it, but Phase 1 has no cron runner to populate it (same
 * gap as the order-API sync — see docs/04-api.md 1.5.3) and at ~10k PV/month
 * a live GROUP BY over `events` is trivially fast, so this is a reasonable
 * simplification for now rather than standing up a batch job for a table
 * nothing else reads yet.
 */
export async function getReportData(
  client: PoolClient,
  siteId: number,
  from: Date,
  to: Date
): Promise<ReportData> {
  const { rows: siteRows } = await client.query(`SELECT cross_domain_cart FROM sites WHERE id = $1`, [siteId]);
  const crossDomainCart = siteRows[0]?.cross_domain_cart ?? false;

  const { rows: summaryRows } = await client.query(
    `SELECT
       count(*) FILTER (WHERE event_type = 'imp') AS imps,
       count(*) FILTER (WHERE event_type = 'click') AS clicks,
       count(*) FILTER (WHERE event_type = 'cv') AS cvs,
       coalesce(sum(revenue) FILTER (WHERE event_type = 'cv'), 0) AS revenue
     FROM events
     WHERE site_id = $1 AND occurred_at >= $2 AND occurred_at < $3`,
    [siteId, from, to]
  );
  const s = summaryRows[0];
  const summary: ReportSummary = {
    imps: Number(s.imps),
    clicks: Number(s.clicks),
    ctr: ctrOf(Number(s.clicks), Number(s.imps)),
    cvs: Number(s.cvs),
    cvr: cvrOf(Number(s.cvs), Number(s.clicks)),
    revenue: Number(s.revenue),
  };

  const { rows: pgRows } = await client.query(
    `SELECT coalesce(pg.name, 'その他') AS name,
            count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
            count(*) FILTER (WHERE e.event_type = 'click') AS clicks
     FROM events e
     LEFT JOIN page_groups pg ON pg.id = e.page_group_id
     WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
       AND e.event_type IN ('imp', 'click')
     GROUP BY coalesce(pg.name, 'その他')
     ORDER BY imps DESC`,
    [siteId, from, to]
  );
  const pageGroups: PageGroupRow[] = pgRows.map((r) => ({
    name: r.name,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
  }));

  const { rows: productRows } = await client.query(
    `SELECT oi.product_code, coalesce(p.name, '') AS product_name,
            count(*) FILTER (WHERE e.attribution = 'click') AS cv_click,
            count(*) FILTER (WHERE e.attribution = 'view') AS cv_view,
            coalesce(sum(oi.revenue), 0) AS revenue
     FROM order_items oi
     JOIN events e ON e.site_id = oi.site_id AND e.order_id = oi.order_id AND e.event_type = 'cv'
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
     GROUP BY oi.product_code, p.name
     ORDER BY revenue DESC`,
    [siteId, from, to]
  );
  const products: ProductRow[] = productRows.map((r) => ({
    productCode: r.product_code,
    productName: r.product_name,
    cvClick: Number(r.cv_click),
    cvView: Number(r.cv_view),
    revenue: Number(r.revenue),
  }));

  // CV events whose order_id never got any order_items rows — usually a
  // {商品毎出力} tag installation gap (docs/06-admin.md 5.3).
  const { rows: emptyRows } = await client.query(
    `SELECT count(*) FILTER (WHERE attribution = 'click') AS cv_click,
            count(*) FILTER (WHERE attribution = 'view') AS cv_view,
            coalesce(sum(revenue), 0) AS revenue
     FROM events e
     WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3 AND e.event_type = 'cv'
       AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.site_id = e.site_id AND oi.order_id = e.order_id)`,
    [siteId, from, to]
  );
  const empty = emptyRows[0];
  if (Number(empty.cv_click) + Number(empty.cv_view) > 0) {
    products.push({
      productCode: null,
      productName: "（商品明細が空だったCV）",
      cvClick: Number(empty.cv_click),
      cvView: Number(empty.cv_view),
      revenue: Number(empty.revenue),
    });
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
     LEFT JOIN events e ON e.creative_id = c.id AND e.occurred_at >= $2 AND e.occurred_at < $3
     WHERE camp.site_id = $1
     GROUP BY c.id, c.name, c.weight
     ORDER BY imps DESC`,
    [siteId, from, to]
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

  return { summary, pageGroups, products, creatives, crossDomainCart };
}
