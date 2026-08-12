import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildGoogleAuthorizeUrl, generateOAuthState } from "@/lib/google-auth";
import { appBaseUrl } from "@/lib/app-base-url";

const STATE_COOKIE = "pz_google_oauth_state";

/** GET /api/v1/auth/google/start — redirects to Google's consent screen. */
export async function GET(_req: NextRequest) {
  const state = generateOAuthState();
  const redirectUri = `${appBaseUrl()}/api/v1/auth/google/callback`;

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300, // 5 min — only needs to survive the round trip to Google and back
    path: "/",
  });

  return NextResponse.redirect(buildGoogleAuthorizeUrl(redirectUri, state));
}
