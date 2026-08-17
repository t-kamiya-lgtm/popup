import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { getCurrentSite } from "@/lib/current-site";
import { getReportData, type ReportFilters } from "@/lib/reports";

/**
 * GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD[&brandId=..&pagePattern=..&creativeId=..]
 * docs/06-admin.md 5. `to` is exclusive.
 */
export async function GET(req: NextRequest) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  const params = req.nextUrl.searchParams;
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid from/to" }, { status: 400 });
  }

  const filters: ReportFilters = {};
  const brandId = params.get("brandId");
  if (brandId) filters.brandId = Number(brandId);
  const pagePattern = params.get("pagePattern");
  if (pagePattern) filters.pagePattern = pagePattern;
  const creativeId = params.get("creativeId");
  if (creativeId) filters.creativeId = Number(creativeId);

  return withAccount(accountId, async (client) => {
    const site = await getCurrentSite(client);
    if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });

    const data = await getReportData(client, site.id, from, to, filters);
    return NextResponse.json(data);
  });
}
