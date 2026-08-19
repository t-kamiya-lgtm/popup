import { pool } from "./db";

export interface PopupLink {
  type: "campaign" | "campaign_list" | "none";
  editUrl?: string;
  reportUrl?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * docs/lp-ab-test/03-popup-integration.md — looks up whether this LP's URL
 * matches an existing popup-tool campaign, so the LP/report list screens
 * can show a link into that app. Never throws: the popup tool being
 * unreachable, unconfigured, or simply not having a matching campaign are
 * all treated the same as "no link" rather than breaking this screen.
 */
export async function getPopupLink(lpId: number, lpUrl: string): Promise<PopupLink> {
  const lookupUrl = process.env.POPUP_TOOL_LOOKUP_URL;
  const token = process.env.POPUP_TOOL_LOOKUP_TOKEN;
  const adminBaseUrl = process.env.POPUP_ADMIN_BASE_URL;
  if (!lookupUrl || !token || !adminBaseUrl) return { type: "none" };

  const cached = await getCached(lpId);
  if (cached) return toLink(cached, adminBaseUrl);

  try {
    const res = await fetch(`${lookupUrl}?path=${encodeURIComponent(lpUrl)}`, {
      headers: { "x-internal-token": token },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { type: "none" };
    const body = (await res.json()) as { match: "none" | "campaign" | "multiple"; siteId?: number; campaignId?: number };

    const linkType = body.match === "campaign" ? "campaign" : body.match === "multiple" ? "campaign_list" : "none";
    await pool().query(
      `INSERT INTO popup_link_cache (lp_id, link_type, campaign_id, site_id, checked_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (lp_id) DO UPDATE SET link_type = $2, campaign_id = $3, site_id = $4, checked_at = now()`,
      [lpId, linkType, body.campaignId ?? null, body.siteId ?? null]
    );
    return toLink({ linkType, campaignId: body.campaignId ?? null, siteId: body.siteId ?? null }, adminBaseUrl);
  } catch {
    return { type: "none" };
  }
}

async function getCached(lpId: number): Promise<{ linkType: string; campaignId: number | null; siteId: number | null } | null> {
  const { rows } = await pool().query(
    `SELECT link_type, campaign_id, site_id, checked_at FROM popup_link_cache WHERE lp_id = $1`,
    [lpId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (Date.now() - new Date(row.checked_at).getTime() > CACHE_TTL_MS) return null;
  return { linkType: row.link_type, campaignId: row.campaign_id !== null ? Number(row.campaign_id) : null, siteId: row.site_id !== null ? Number(row.site_id) : null };
}

function toLink(cached: { linkType: string; campaignId: number | null; siteId: number | null }, adminBaseUrl: string): PopupLink {
  const base = adminBaseUrl.replace(/\/$/, "");
  if (cached.linkType === "campaign" && cached.campaignId !== null) {
    return {
      type: "campaign",
      editUrl: `${base}/campaigns/${cached.campaignId}`,
      reportUrl: `${base}/reports?campaignId=${cached.campaignId}`,
    };
  }
  if (cached.linkType === "campaign_list") {
    const listUrl = `${base}/campaigns${cached.siteId !== null ? `?siteId=${cached.siteId}` : ""}`;
    return { type: "campaign_list", editUrl: listUrl, reportUrl: listUrl };
  }
  return { type: "none" };
}
