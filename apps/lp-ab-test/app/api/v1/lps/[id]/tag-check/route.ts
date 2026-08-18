import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireMember } from "@/lib/require-member";
import { checkTagInstallation } from "@/lib/tag-checker";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const lpId = Number(params.id);
  const { rows } = await pool().query(`SELECT url FROM lps WHERE id = $1`, [lpId]);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_BASE_URL ?? "").replace(/\/$/, "");
  const result = await checkTagInstallation(lpId, rows[0].url as string, appBaseUrl);
  return NextResponse.json(result);
}
