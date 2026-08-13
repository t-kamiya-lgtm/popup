import { NextRequest, NextResponse } from "next/server";
import type { CampaignConfig, CreativeConfig, ImageVariant, PageGroupConfig, SiteConfig } from "@popup/shared";
import { servicePool } from "@/lib/db";
import { loadCreativeImages } from "@/lib/assets";

const EMPTY_IMAGE: ImageVariant = { w: 380, h: 300, fallback: "" };
const EMPTY_IMAGE_SP: ImageVariant = { w: 320, h: 400, fallback: "" };

export const dynamic = "force-dynamic"; // computed per-request; CDN caches via headers below

// This config is fetched via `fetch()` (not a <script> tag) by sdk.js running
// on whatever third-party page the tag is installed on, so the browser
// enforces CORS on the response. It's deliberately un-authenticated (see the
// GET handler doc comment) and keyed only by the public sitePublicId in the
// path, so allowing any origin doesn't widen what a caller can get at.
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /c/{sitePublicId}.json — the config JSON described in docs/04-api.md
 * 1.1. Deliberately un-authenticated and served with an `s-maxage` so a CDN
 * in front of this route can cache it for every visitor; see
 * docs/02-architecture.md 6 for why this stays a flat file fetch instead of
 * a per-visitor server decision.
 *
 * Runs against `servicePool` (bypasses RLS) because this route resolves
 * its own tenant boundary from `sitePublicId` before issuing any query —
 * there is no logged-in account to scope by. Every query below is
 * explicitly filtered by `site.id`, which is what keeps this safe.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawSiteId } = await params;
  const sitePublicId = rawSiteId.replace(/\.json$/, "");

  const { rows: siteRows } = await servicePool().query(
    `SELECT id, public_id, timezone, cart_hosts, cross_domain_cart
     FROM sites WHERE public_id = $1`,
    [sitePublicId]
  );
  const site = siteRows[0];
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const { rows: pageGroupRows } = await servicePool().query(
    `SELECT id, match_type, pattern, priority FROM page_groups WHERE site_id = $1`,
    [site.id]
  );
  const pageGroups: PageGroupConfig[] = pageGroupRows.map((r) => ({
    // pg returns BIGINT/BIGSERIAL as strings (a JS `number` can't safely
    // hold the full int8 range) — cast explicitly rather than relying on
    // the `any[]` row type to silently paper over the mismatch.
    id: Number(r.id),
    match: r.match_type,
    pattern: r.pattern,
    priority: r.priority,
  }));

  const { rows: campaignRows } = await servicePool().query(
    `SELECT id, priority, starts_at, ends_at, devices, triggers, frequency,
            holdout_rate, position_pc, position_sp, overlay, close_button
     FROM campaigns
     WHERE site_id = $1 AND status = 'active'
       AND (starts_at IS NULL OR starts_at <= now())
       AND (ends_at IS NULL OR ends_at >= now())
     ORDER BY priority ASC`,
    [site.id]
  );

  const campaigns: CampaignConfig[] = [];
  for (const c of campaignRows) {
    const { rows: targetRows } = await servicePool().query(
      `SELECT kind, match_type, pattern FROM campaign_targets
       WHERE campaign_id = $1 AND target_type = 'url'`,
      [c.id]
    );
    const include = targetRows.filter((t) => t.kind === "include").map((t) => ({ match: t.match_type, pattern: t.pattern }));
    const exclude = targetRows.filter((t) => t.kind === "exclude").map((t) => ({ match: t.match_type, pattern: t.pattern }));

    const { rows: creativeRows } = await servicePool().query(
      `SELECT id, weight, link_url, link_target, alt_text, asset_pc_id, asset_sp_id FROM creatives
       WHERE campaign_id = $1 AND status = 'active'`,
      [c.id]
    );
    // SP falls back to the PC asset (docs/06-admin.md 2 — "SP: 未設定なら
    // PC 画像を自動最適化して流用"; both purposes are generated from the
    // same upload, so asset_sp_id is null only when a creative predates
    // the upload feature). A creative without any asset yet still needs a
    // config-shaped placeholder so the SDK has something to render.
    const creatives: CreativeConfig[] = await Promise.all(
      creativeRows.map(async (cr) => {
        const assetPcId = cr.asset_pc_id !== null ? Number(cr.asset_pc_id) : null;
        const assetSpId = cr.asset_sp_id !== null ? Number(cr.asset_sp_id) : assetPcId;
        const { pc, sp } = await loadCreativeImages(servicePool(), assetPcId, assetSpId);
        return {
          id: Number(cr.id),
          weight: cr.weight,
          linkUrl: cr.link_url,
          linkTarget: cr.link_target,
          alt: cr.alt_text,
          images: {
            pc: pc ?? EMPTY_IMAGE,
            sp: sp ?? EMPTY_IMAGE_SP,
          },
        };
      })
    );
    if (creatives.length === 0) continue; // nothing to show; skip the campaign entirely

    campaigns.push({
      id: Number(c.id),
      priority: c.priority,
      period: {
        from: c.starts_at ? new Date(c.starts_at).toISOString() : null,
        to: c.ends_at ? new Date(c.ends_at).toISOString() : null,
      },
      targets: { urls: { include, exclude } },
      devices: c.devices,
      triggers: c.triggers,
      frequency: c.frequency,
      holdoutRate: Number(c.holdout_rate),
      render: {
        positionPc: c.position_pc,
        positionSp: c.position_sp,
        overlay: c.overlay,
        closeButton: c.close_button,
      },
      creatives,
    });
  }

  const cdnBase = process.env.NEXT_PUBLIC_CDN_BASE_URL ?? "";
  const config: SiteConfig = {
    v: Date.now(), // TODO: replace with config_versions.version once publish flow exists
    site: {
      id: site.public_id,
      tz: site.timezone,
      cartHosts: site.cart_hosts,
      crossDomainCart: site.cross_domain_cart,
    },
    sdkUrl: `${cdnBase}/sdk.js`,
    endpoints: { collect: `${cdnBase}/e` },
    pageGroups,
    campaigns,
  };

  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
      ...CORS_HEADERS,
    },
  });
}
