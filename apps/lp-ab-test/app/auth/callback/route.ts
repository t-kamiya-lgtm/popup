import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Google OAuth redirect target (app/login). Exchanges the auth code for a
// Supabase session, then enforces this app's invite-only membership on top
// of whatever Supabase/Google already verified (docs/lp-ab-test/00-requirements.md 8):
// the email must both be on the allowed domain and have an existing,
// admin-created `members` row before the session is allowed to stand.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=not_invited`);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=not_invited`);
  }

  const email = data.user.email;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
  if (allowedDomain && !email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=wrong_domain`);
  }

  const { rows } = await pool().query(
    `UPDATE members SET auth_user_id = $1, accepted_at = COALESCE(accepted_at, now())
     WHERE email = $2 RETURNING id`,
    [data.user.id, email]
  );
  if (rows.length === 0) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_invited`);
  }

  return NextResponse.redirect(`${origin}/lps`);
}
