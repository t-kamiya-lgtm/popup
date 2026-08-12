import { randomBytes } from "node:crypto";

// Hand-rolled OAuth2/OIDC against Google, matching the style already used
// for the cart's order-API integration (lib/order-api.ts) rather than
// pulling in Auth.js — one less framework's session/adapter model to learn
// on top of the iron-session cookie we already have.
//
// The three endpoints below are overridable via env vars *only* so this
// flow can be exercised end-to-end against a local mock server in
// environments that can't reach accounts.google.com (see the order-API
// OAuth tests for the same pattern) — unset, they're the real Google URLs.
const AUTHORIZE_URL = process.env.GOOGLE_AUTHORIZE_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const USERINFO_URL = process.env.GOOGLE_USERINFO_URL ?? "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPE = "openid email profile";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function buildGoogleAuthorizeUrl(redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  // Re-shows the account picker instead of silently reusing whichever
  // Google account happens to already be signed in on this device — this
  // is a shared work admin tool, not a personal app.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function generateOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleIdentity> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Google userinfo failed: ${userRes.status}`);
  }
  const info = (await userRes.json()) as { email: string; email_verified: boolean; name?: string };
  return { email: info.email, emailVerified: info.email_verified, name: info.name ?? null };
}
