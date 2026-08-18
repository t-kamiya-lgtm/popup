import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { requireAdmin, requireMember } from "@/lib/require-member";

export async function GET() {
  // Any logged-in member can see the roster (matches the popup tool's
  // members screen, which is admin-only to *invite* but fine to view once
  // you're already in — the deny-list itself isn't sensitive here).
  const member = await requireMember();
  if (member instanceof NextResponse) return member;

  const { rows } = await pool().query(
    `SELECT email, role, invited_at, accepted_at FROM members ORDER BY invited_at ASC`
  );
  return NextResponse.json({
    members: rows.map((r) => ({
      email: r.email as string,
      role: r.role as string,
      status: r.accepted_at ? "active" : "invited",
      invitedAt: (r.invited_at as Date).toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const member = await requireAdmin();
  if (member instanceof NextResponse) return member;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;
  if (!email || !["admin", "editor", "viewer"].includes(role)) {
    return NextResponse.json({ error: "email and a valid role are required" }, { status: 400 });
  }

  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
  if (allowedDomain && !email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
    return NextResponse.json({ error: `@${allowedDomain} のメールアドレスのみ招待できます` }, { status: 400 });
  }

  try {
    await pool().query(
      `INSERT INTO members (email, role, invited_by) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role`,
      [email, role, member.id]
    );
  } catch (err) {
    return NextResponse.json({ error: "招待に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const member = await requireAdmin();
  if (member instanceof NextResponse) return member;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (email.toLowerCase() === member.email.toLowerCase()) {
    return NextResponse.json({ error: "自分自身は削除できません" }, { status: 400 });
  }

  await pool().query(`DELETE FROM members WHERE email = $1`, [email]);
  return NextResponse.json({ ok: true });
}
