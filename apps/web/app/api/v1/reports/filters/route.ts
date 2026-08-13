import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { getCurrentSite } from "@/lib/current-site";
import { getFilterOptions } from "@/lib/reports";

/** GET /api/v1/reports/filters — option lists for the item/page/creative filter dropdowns. */
export async function GET(_req: NextRequest) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  return withAccount(accountId, async (client) => {
    const site = await getCurrentSite(client);
    if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });

    const options = await getFilterOptions(client, site.id);
    return NextResponse.json(options);
  });
}
