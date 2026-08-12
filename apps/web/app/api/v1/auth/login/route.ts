import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { appPool, servicePool } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * POST /api/v1/auth/login (docs/04-api.md 2). `users` carries no RLS
 * policy (docs/10-multitenancy.md 2 — it spans accounts via `memberships`,
 * so there's no single `account_id` to scope by), which is exactly right
 * here: this is the one query that legitimately has to run *before* any
 * account context exists.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const { rows } = await appPool().query(
    `SELECT id, password_hash FROM users WHERE email = $1`,
    [email]
  );
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    // Same message either way — don't reveal whether the email exists.
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  // `memberships` is RLS-scoped by account_id (docs/10-multitenancy.md 2),
  // but at this point in login we don't know the account_id yet — that's
  // exactly what this query is for. Same category as the config/collector
  // endpoints: resolve tenancy first via the BYPASSRLS service role, then
  // every later request uses the RLS-restricted pool once accountId is set.
  const { rows: memberships } = await servicePool().query(
    `SELECT account_id FROM memberships
     WHERE user_id = $1 AND accepted_at IS NOT NULL
     ORDER BY created_at ASC LIMIT 1`,
    [user.id]
  );
  const membership = memberships[0];
  if (!membership) {
    return NextResponse.json({ error: "no account membership found" }, { status: 403 });
  }

  const session = await getSession();
  session.userId = Number(user.id);
  session.accountId = Number(membership.account_id);
  await session.save();

  return NextResponse.json({ ok: true });
}
