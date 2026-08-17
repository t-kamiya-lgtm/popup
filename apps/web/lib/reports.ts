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

export interface DetailRow {
  productCode: string | null;
  productName: string;
  pageGroupName: string;
  creativeName: string;
  imps: number;
  clicks: number;
  cvClick: number;
  cvView: number;
  revenue: number;
}

export interface ReportFilters {
  productCode?: string;
  pageGroupId?: number;
  creativeId?: number;
}

export interface ReportData {
  summary: ReportSummary;
  pageGroups: PageGroupRow[];
  products: ProductRow[];
  creatives: CreativeRow[];
  details: DetailRow[];
  crossDomainCart: boolean;
}

export interface FilterOptions {
  products: { code: string; name: string }[];
  pageGroups: { id: number; name: string }[];
  creatives: { id: number; name: string }[];
}

function ctrOf(clicks: number, imps: number): number {
  return imps > 0 ? clicks / imps : 0;
}
function cvrOf(cvs: number, clicks: number): number {
  return clicks > 0 ? cvs / clicks : 0;
}

/** Options for the item/page/creative filter dropdowns (docs/06-admin.md 5.1). */
export async function getFilterOptions(client: PoolClient, siteId: number): Promise<FilterOptions> {
  const [products, pageGroups, creatives] = await Promise.all([
    client.query(`SELECT product_code, name FROM products WHERE site_id = $1 AND NOT archived ORDER BY product_code`, [
      siteId,
    ]),
    client.query(`SELECT id, name FROM page_groups WHERE site_id = $1 ORDER BY priority`, [siteId]),
    client.query(
      `SELECT c.id, c.name FROM creatives c JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE camp.site_id = $1 ORDER BY c.name`,
      [siteId]
    ),
  ]);
  return {
    products: products.rows.map((r) => ({ code: r.product_code, name: r.name })),
    pageGroups: pageGroups.rows.map((r) => ({ id: Number(r.id), name: r.name })),
    creatives: creatives.rows.map((r) => ({ id: Number(r.id), name: r.name })),
  };
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
 *
 * `filters.productCode` only has meaning for CV rows (imp/click events
 * carry no product — product identity comes solely from the thank-you
 * page's loop tag, docs/09-cart-integration.md 4). When it's set, imp/click
 * counts are reported as 0 rather than silently ignoring the filter.
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

  // Shared page/creative conditions, appended to each query below.
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

  const summaryRows = (
    await client.query(
      `SELECT
         count(*) FILTER (WHERE event_type = 'imp') AS imps,
         count(*) FILTER (WHERE event_type = 'click') AS clicks,
         count(*) FILTER (WHERE event_type = 'cv'${filters.productCode ? " AND FALSE" : ""}) AS cvs,
         coalesce(sum(revenue) FILTER (WHERE event_type = 'cv'${filters.productCode ? " AND FALSE" : ""}), 0) AS revenue
       FROM events e
       WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3${extraSql}`,
      [siteId, from, to, ...extraParams]
    )
  ).rows[0];

  // CV/revenue restricted to a specific product needs the order_items join,
  // which the plain events query above can't express — computed separately
  // and merged in below when a product filter is active.
  let cvs = Number(summaryRows.cvs);
  let revenue = Number(summaryRows.revenue);
  let imps = Number(summaryRows.imps);
  let clicks = Number(summaryRows.clicks);
  if (filters.productCode) {
    imps = 0;
    clicks = 0;
    const params = [siteId, from, to, filters.productCode, ...extraParams];
    const productCvRows = (
      await client.query(
        `SELECT count(*) AS cvs, coalesce(sum(oi.revenue), 0) AS revenue
         FROM order_items oi
         JOIN events e ON e.site_id = oi.site_id AND e.order_id = oi.order_id AND e.event_type = 'cv'
         WHERE oi.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3 AND oi.product_code = $4${extraSql}`,
        params
      )
    ).rows[0];
    cvs = Number(productCvRows.cvs);
    revenue = Number(productCvRows.revenue);
  }

  const summary: ReportSummary = {
    imps,
    clicks,
    ctr: ctrOf(clicks, imps),
    cvs,
    cvr: cvrOf(cvs, clicks),
    revenue,
  };

  const pgRows = filters.productCode
    ? []
    : (
        await client.query(
          `SELECT coalesce(pg.name, 'その他') AS name,
                  count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
                  count(*) FILTER (WHERE e.event_type = 'click') AS clicks
           FROM events e
           LEFT JOIN page_groups pg ON pg.id = e.page_group_id
           WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
             AND e.event_type IN ('imp', 'click')${extraSql}
           GROUP BY coalesce(pg.name, 'その他')
           ORDER BY imps DESC`,
          [siteId, from, to, ...extraParams]
        )
      ).rows;
  const pageGroups: PageGroupRow[] = pgRows.map((r) => ({
    name: r.name,
    imps: Number(r.imps),
    clicks: Number(r.clicks),
    ctr: ctrOf(Number(r.clicks), Number(r.imps)),
  }));

  const productParams: unknown[] = [siteId, from, to];
  let productExtraSql = "";
  if (filters.pageGroupId != null) {
    productParams.push(filters.pageGroupId);
    productExtraSql += ` AND e.page_group_id = $${productParams.length}`;
  }
  if (filters.creativeId != null) {
    productParams.push(filters.creativeId);
    productExtraSql += ` AND e.creative_id = $${productParams.length}`;
  }
  if (filters.productCode) {
    productParams.push(filters.productCode);
    productExtraSql += ` AND oi.product_code = $${productParams.length}`;
  }

  const { rows: productRows } = await client.query(
    `SELECT oi.product_code, coalesce(p.name, '') AS product_name,
            count(*) FILTER (WHERE e.attribution = 'click') AS cv_click,
            count(*) FILTER (WHERE e.attribution = 'view') AS cv_view,
            coalesce(sum(oi.revenue), 0) AS revenue
     FROM order_items oi
     JOIN events e ON e.site_id = oi.site_id AND e.order_id = oi.order_id AND e.event_type = 'cv'
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3${productExtraSql}
     GROUP BY oi.product_code, p.name
     ORDER BY revenue DESC`,
    productParams
  );
  const products: ProductRow[] = productRows.map((r) => ({
    productCode: r.product_code,
    productName: r.product_name,
    cvClick: Number(r.cv_click),
    cvView: Number(r.cv_view),
    revenue: Number(r.revenue),
  }));

  // CV events whose order_id never got any order_items rows — usually a
  // {商品毎出力} tag installation gap (docs/06-admin.md 5.3). Not shown when
  // a specific product is selected, since by definition it has no product.
  if (!filters.productCode) {
    const { rows: emptyRows } = await client.query(
      `SELECT count(*) FILTER (WHERE attribution = 'click') AS cv_click,
              count(*) FILTER (WHERE attribution = 'view') AS cv_view,
              coalesce(sum(revenue), 0) AS revenue
       FROM events e
       WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3 AND e.event_type = 'cv'
         AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.site_id = e.site_id AND oi.order_id = e.order_id)${extraSql}`,
      [siteId, from, to, ...extraParams]
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
  }

  // pageGroupId restricts which *events* count (stays in the LEFT JOIN's ON
  // clause, so every creative still gets a row, just with fewer/zero
  // matching events); creativeId restricts which *creative rows* appear at
  // all, so it has to be a WHERE condition — putting it in the ON clause
  // instead would leave every other creative listed with zeroed-out counts
  // rather than actually filtering the list.
  const creativeParams: unknown[] = [siteId, from, to];
  let creativeJoinSql = "";
  let creativeWhereSql = "";
  if (filters.pageGroupId != null) {
    creativeParams.push(filters.pageGroupId);
    creativeJoinSql += ` AND e.page_group_id = $${creativeParams.length}`;
  }
  if (filters.creativeId != null) {
    creativeParams.push(filters.creativeId);
    creativeWhereSql += ` AND c.id = $${creativeParams.length}`;
  }
  const creativeRows = filters.productCode
    ? []
    : (
        await client.query(
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
        )
      ).rows;
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

  // Item x page x creative detail (requested addition): item breakdown is
  // only possible for CV rows, since only CV events carry both a product
  // (via order_items) and — as of the events.page_group_id backfill on CV
  // rows added alongside this feature — the page the attributed touch
  // happened on. CVs recorded before that change have page_group_id = NULL
  // and show up grouped under "（ページ不明）" rather than being silently
  // dropped. imp/click rows (no CV) are added separately below, at the
  // page x creative grain only — see the imp/click query further down.
  const detailParams: unknown[] = [siteId, from, to];
  let detailExtraSql = "";
  if (filters.pageGroupId != null) {
    detailParams.push(filters.pageGroupId);
    detailExtraSql += ` AND e.page_group_id = $${detailParams.length}`;
  }
  if (filters.creativeId != null) {
    detailParams.push(filters.creativeId);
    detailExtraSql += ` AND e.creative_id = $${detailParams.length}`;
  }
  if (filters.productCode) {
    detailParams.push(filters.productCode);
    detailExtraSql += ` AND oi.product_code = $${detailParams.length}`;
  }
  const { rows: detailRows } = await client.query(
    `SELECT oi.product_code, coalesce(p.name, '') AS product_name,
            coalesce(pg.name, '（ページ不明）') AS page_group_name,
            coalesce(c.name, '（削除済みクリエイティブ）') AS creative_name,
            count(*) FILTER (WHERE e.attribution = 'click') AS cv_click,
            count(*) FILTER (WHERE e.attribution = 'view') AS cv_view,
            coalesce(sum(oi.revenue), 0) AS revenue
     FROM order_items oi
     JOIN events e ON e.site_id = oi.site_id AND e.order_id = oi.order_id AND e.event_type = 'cv'
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN page_groups pg ON pg.id = e.page_group_id
     LEFT JOIN creatives c ON c.id = e.creative_id
     WHERE oi.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3${detailExtraSql}
     GROUP BY oi.product_code, p.name, pg.name, c.name
     ORDER BY revenue DESC`,
    detailParams
  );

  // imp/click rows for the same page x creative grain, shown alongside the
  // CV/item rows above (requested addition — imp/click carry no product,
  // so these always report productCode=null rather than being merged into
  // an item row). Skipped entirely under a product filter, same as the
  // summary/pageGroups/creatives sections above: a product filter has no
  // meaning for events that aren't tied to a product.
  const impClickDetailParams: unknown[] = [siteId, from, to];
  let impClickDetailExtraSql = "";
  if (filters.pageGroupId != null) {
    impClickDetailParams.push(filters.pageGroupId);
    impClickDetailExtraSql += ` AND e.page_group_id = $${impClickDetailParams.length}`;
  }
  if (filters.creativeId != null) {
    impClickDetailParams.push(filters.creativeId);
    impClickDetailExtraSql += ` AND e.creative_id = $${impClickDetailParams.length}`;
  }
  const impClickDetailRows = filters.productCode
    ? []
    : (
        await client.query(
          `SELECT coalesce(pg.name, '（ページ不明）') AS page_group_name,
                  coalesce(c.name, '（削除済みクリエイティブ）') AS creative_name,
                  count(*) FILTER (WHERE e.event_type = 'imp') AS imps,
                  count(*) FILTER (WHERE e.event_type = 'click') AS clicks
           FROM events e
           LEFT JOIN page_groups pg ON pg.id = e.page_group_id
           LEFT JOIN creatives c ON c.id = e.creative_id
           WHERE e.site_id = $1 AND e.occurred_at >= $2 AND e.occurred_at < $3
             AND e.event_type IN ('imp', 'click')${impClickDetailExtraSql}
           GROUP BY pg.name, c.name
           ORDER BY imps DESC`,
          impClickDetailParams
        )
      ).rows;

  const details: DetailRow[] = [
    ...impClickDetailRows.map((r) => ({
      productCode: null,
      productName: "－（imp/クリックのみ、商品と紐付きません）",
      pageGroupName: r.page_group_name,
      creativeName: r.creative_name,
      imps: Number(r.imps),
      clicks: Number(r.clicks),
      cvClick: 0,
      cvView: 0,
      revenue: 0,
    })),
    ...detailRows.map((r) => ({
      productCode: r.product_code,
      productName: r.product_name,
      pageGroupName: r.page_group_name,
      creativeName: r.creative_name,
      imps: 0,
      clicks: 0,
      cvClick: Number(r.cv_click),
      cvView: Number(r.cv_view),
      revenue: Number(r.revenue),
    })),
  ];

  return { summary, pageGroups, products, creatives, details, crossDomainCart };
}
