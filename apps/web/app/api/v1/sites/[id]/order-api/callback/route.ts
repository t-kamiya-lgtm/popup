import { NextRequest, NextResponse } from "next/server";
import { servicePool } from "@/lib/db";
import { exchangeCodeForToken, OrderApiError } from "@/lib/order-api";
import { appBaseUrl } from "@/lib/app-base-url";

/**
 * GET /api/v1/sites/{id}/order-api/callback — docs/04-api.md 1.5.2.
 * Public: reached via a browser redirect from the cart's OAuth server, not
 * an authenticated call from our own admin UI, so this resolves the site
 * directly by id via `servicePool` (RLS bypass) instead of a logged-in
 * account — same pattern as GET /c/[siteId] and POST /e.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const siteId = Number((await params).id);
  const redirectTo = (status: "connected" | "error", message?: string) => {
    const url = new URL(`${appBaseUrl()}/order-api`, req.url);
    url.searchParams.set("result", status);
    if (message) url.searchParams.set("message", message);
    return NextResponse.redirect(url);
  };

  if (!Number.isInteger(siteId)) return redirectTo("error", "invalid site");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return redirectTo("error", "missing code or state");

  const pool = servicePool();
  const { rows } = await pool.query(`SELECT oauth_state FROM site_order_api_connections WHERE site_id = $1`, [siteId]);
  const stored = rows[0]?.oauth_state;
  if (!stored || stored !== state) {
    return redirectTo("error", "invalid state");
  }

  try {
    await exchangeCodeForToken(pool, siteId, code);
    return redirectTo("connected");
  } catch (err) {
    if (err instanceof OrderApiError) return redirectTo("error", err.message);
    throw err;
  }
}
