import { NextResponse, type NextRequest } from "next/server";
import { servicePool } from "@/lib/db";
import { matchesTargets } from "@/lib/lookup-url-match";
import { normalizeUrlPattern } from "@/lib/url-pattern";

// Read-only integration endpoint for the LP creative A/B test tool
// (docs/lp-ab-test/03-popup-integration.md in that app's repo — this tool
// and that one share a repo but not a database or a login). Lets that
// tool's LP list/report screens show a link into this app's campaign
// screens when a matching campaign already exists here, without giving it
// any direct DB access. Protected by a shared secret rather than the admin
// session cookie, since the caller is a server, not a logged-in browser.
export async function GET(request: NextRequest) {
  const token = process.env.INTERNAL_LOOKUP_TOKEN;
  if (!token || request.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const path = request.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  const normalizedPath = normalizeUrlPattern(path, "exact");

  // Phase 1 of this integration targets the single primedirect.jp site
  // (docs/lp-ab-test/03-popup-integration.md 2) — if/when this tool serves
  // more than one site, this becomes "for every site" instead.
  const { rows: siteRows } = await servicePool().query(`SELECT id FROM sites ORDER BY id ASC LIMIT 1`);
  const site = siteRows[0];
  if (!site) return NextResponse.json({ match: "none" });
  const siteId = Number(site.id);

  const { rows: campaignRows } = await servicePool().query(
    `SELECT id FROM campaigns WHERE site_id = $1 AND status != 'archived'`,
    [siteId]
  );
  const { rows: targetRows } = await servicePool().query(
    `SELECT campaign_id, kind, match_type, pattern FROM campaign_targets
     WHERE campaign_id = ANY($1::bigint[]) AND target_type = 'url'`,
    [campaignRows.map((c) => c.id)]
  );

  const matchingCampaignIds = campaignRows
    .map((c) => Number(c.id))
    .filter((campaignId) => {
      const targetsForCampaign = targetRows.filter((t) => Number(t.campaign_id) === campaignId);
      const include = targetsForCampaign.filter((t) => t.kind === "include").map((t) => ({ match: t.match_type, pattern: t.pattern }));
      const exclude = targetsForCampaign.filter((t) => t.kind === "exclude").map((t) => ({ match: t.match_type, pattern: t.pattern }));
      return matchesTargets({ include, exclude }, normalizedPath);
    });

  if (matchingCampaignIds.length === 0) return NextResponse.json({ match: "none" });
  if (matchingCampaignIds.length > 1) return NextResponse.json({ match: "multiple", siteId });
  return NextResponse.json({ match: "campaign", siteId, campaignId: matchingCampaignIds[0] });
}
