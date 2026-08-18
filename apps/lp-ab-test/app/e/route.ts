import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Same reasoning as the popup tool's collector (apps/web/app/e/route.ts):
// fetch keepalive with a JSON content-type triggers a CORS preflight.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface ImpBody {
  type: "imp";
  lpId: number;
  sessionId: string;
  device?: "pc" | "sp" | "tablet";
  creativeAId: number | null;
  creativeBId: number | null;
}
interface CvBody {
  type: "cv";
  lpId: number;
  sessionId: string;
  orderId: string;
  revenue?: number;
}

/**
 * POST /e — the imp/cv collector for the LP creative A/B test tool. Always
 * responds 204: this is a `fetch keepalive` beacon call with nobody to show
 * an error to (same reasoning as the popup tool's collector).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ImpBody | CvBody | null;
  if (!body?.lpId || !body.sessionId) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (body.type === "imp") {
      await recordImpression(body);
    } else if (body.type === "cv") {
      await recordConversion(body);
    }
  } catch (err) {
    console.error("collector: failed to process event", err);
  }

  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function recordImpression(body: ImpBody) {
  await pool().query(
    `INSERT INTO impressions (occurred_at, lp_id, session_id, creative_a_id, creative_b_id, device)
     VALUES (now(), $1, $2, $3, $4, $5)`,
    [body.lpId, body.sessionId, body.creativeAId, body.creativeBId, body.device ?? null]
  );
}

async function recordConversion(body: CvBody) {
  // Snapshot which creatives were showing at this session's most recent
  // impression on this LP (docs/lp-ab-test/01-data-model.md 9) — the
  // thank-you page has no slots/creatives of its own.
  const { rows } = await pool().query(
    `SELECT creative_a_id, creative_b_id FROM impressions
     WHERE lp_id = $1 AND session_id = $2
     ORDER BY occurred_at DESC LIMIT 1`,
    [body.lpId, body.sessionId]
  );
  const creativeAId = rows[0]?.creative_a_id ?? null;
  const creativeBId = rows[0]?.creative_b_id ?? null;

  await pool().query(
    `INSERT INTO conversions (occurred_at, lp_id, session_id, order_id, revenue, creative_a_id, creative_b_id)
     VALUES (now(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (lp_id, order_id) WHERE order_id IS NOT NULL DO NOTHING`,
    [body.lpId, body.sessionId, body.orderId, body.revenue ?? null, creativeAId, creativeBId]
  );
}
