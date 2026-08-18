import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/require-member";
import { getReport } from "@/lib/reports";
import { resolveDateRange } from "@/lib/report-date-range";

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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

  const header = ["品番", "アイテム名", "LP名", "スロット", "クリエイティブ", "元画像", "imp", "CV", "CVR(%)", "売上"];
  const lines = [header.map(csvEscape).join(",")];
  for (const lp of report) {
    for (const slot of lp.slots) {
      for (const c of slot.creatives) {
        lines.push(
          [
            lp.productCode,
            lp.itemName,
            lp.lpName,
            slot.slotKey.toUpperCase(),
            c.creativeName,
            c.isOriginal ? "○" : "",
            c.imps,
            c.cv,
            c.cvr ?? "",
            c.revenue,
          ]
            .map(csvEscape)
            .join(",")
        );
      }
    }
  }
  const csv = "﻿" + lines.join("\r\n"); // BOM for Excel(Shift_JIS環境でも文字化けしにくいUTF-8 BOM付き)

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lp-ab-test-report_${from.slice(0, 10)}_${to.slice(0, 10)}.csv"`,
    },
  });
}
