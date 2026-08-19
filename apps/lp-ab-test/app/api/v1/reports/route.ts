import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/require-member";
import { getReport } from "@/lib/reports";
import { resolveDateRange } from "@/lib/report-date-range";
import { getPopupLink } from "@/lib/popup-link";

export async function GET(request: NextRequest) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const { searchParams } = new URL(request.url);
  const { from, to } = resolveDateRange(searchParams.get("from"), searchParams.get("to"));
  const itemName = searchParams.get("itemName") ?? undefined;
  const lpName = searchParams.get("lpName") ?? undefined;
  const lpIdsParam = searchParams.get("lpIds");
  const lpIds = lpIdsParam ? lpIdsParam.split(",").map(Number).filter(Number.isFinite) : undefined;
  const creativeIdsParam = searchParams.get("creativeIds");
  const creativeIds = creativeIdsParam ? creativeIdsParam.split(",").map(Number).filter(Number.isFinite) : undefined;

  const report = await getReport({ from, to, itemName, lpName, lpIds, creativeIds });
  const reportWithLinks = await Promise.all(
    report.map(async (lp) => ({ ...lp, popupLink: await getPopupLink(lp.lpId, lp.url) }))
  );
  return NextResponse.json({ from, to, report: reportWithLinks });
}
