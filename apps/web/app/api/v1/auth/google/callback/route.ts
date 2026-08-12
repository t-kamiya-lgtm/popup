import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { servicePool } from "@/lib/db";
import { exchangeGoogleCode } from "@/lib/google-auth";
import { appBaseUrl } from "@/lib/app-base-url";
import { getSession } from "@/lib/session";

const STATE_COOKIE = "pz_google_oauth_state";

/**
 * GET /api/v1/auth/google/callback — public (reached via redirect from
 * Google, not an authenticated call), same pattern as the order-API OAuth
 * callback: resolve everything from the request itself, no session yet.
 *
 * Invite-only: a Google account only gets in if its email already has a
 * `users` row with a `memberships` row (created by an existing owner via
 * POST /api/v1/accounts/{id}/members — see app/(admin)/members). There is
 * no self-service signup path. `memberships` is RLS-scoped by account_id,
 * which we don't know yet at this point, so this reads it via
 * `servicePool` — exactly the same chicken-and-egg fix already applied to
 * the password login route.
 */
export async function GET(req: NextRequest) {
  const loginUrl = new URL("/login", appBaseUrl());
  const fail = (reason: string) => {
    loginUrl.searchParams.set("error", reason);
    return NextResponse.redirect(loginUrl);
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("invalid_state");
  }

  let identity;
  try {
    identity = await exchangeGoogleCode(code, `${appBaseUrl()}/api/v1/auth/google/callback`);
  } catch {
    return fail("google_exchange_failed");
  }
  if (!identity.emailVerified) {
    return fail("email_not_verified");
  }

  const pool = servicePool();
  const { rows: userRows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [identity.email]);
  const user = userRows[0];
  if (!user) {
    return fail("not_invited");
  }

  const { rows: membershipRows } = await pool.query(
    `SELECT account_id, accepted_at FROM memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [user.id]
  );
  const membership = membershipRows[0];
  if (!membership) {
    return fail("not_invited");
  }
  if (!membership.accepted_at) {
    await pool.query(`UPDATE memberships SET accepted_at = now() WHERE account_id = $1 AND user_id = $2`, [
      membership.account_id,
      user.id,
    ]);
  }

  const session = await getSession();
  session.userId = Number(user.id);
  session.accountId = Number(membership.account_id);
  await session.save();

  return NextResponse.redirect(new URL("/campaigns", appBaseUrl()));
}
