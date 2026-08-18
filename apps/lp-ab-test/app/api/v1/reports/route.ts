import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/require-member";
import { getReport } from "@/lib/reports";
import { resolveDateRange } from "@/lib/report-date-range";

export async function GET(request: NextRequest) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const { searchParams } = new URL(request.url);
  const { from, to } = resolveDateRange(searchParams.get("from"), searchParams.get("to"));
  const itemName = searchParams.get("itemName") ?? undefined;
  const lpName = searchParams.get("lpName") ?? undefined;
  const lpIdsParam = searchParams.get("lpIds");
  const lpIds = lpIdsParam ? lpIdsParam.split(",").map(Number).filter(Number.isFinite) : undefined;

  const report = await getReport({ from, to, itemName, lpName, lpIds });
  return NextResponse.json({ from, to, report });
}
