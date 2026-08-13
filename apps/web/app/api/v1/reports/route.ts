import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { getCurrentSite } from "@/lib/current-site";
import { getReportData } from "@/lib/reports";

/** GET /api/v1/reports?from=YYYY-MM-DD&to=YYYY-MM-DD — docs/06-admin.md 5. `to` is exclusive. */
export async function GET(req: NextRequest) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid from/to" }, { status: 400 });
  }

  return withAccount(accountId, async (client) => {
    const site = await getCurrentSite(client);
    if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });

    const data = await getReportData(client, site.id, from, to);
    return NextResponse.json(data);
  });
}
