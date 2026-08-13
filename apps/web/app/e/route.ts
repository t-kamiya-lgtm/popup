import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { servicePool } from "@/lib/db";

export const dynamic = "force-dynamic";

type EventType = "imp" | "click" | "cv" | "close" | "holdout";

interface TouchInfo {
  cid?: number;
  crid?: number;
  type?: "click" | "view";
  ts?: number;
  pg?: number; // page_group id the touch happened on — carried onto the CV row for 実績レポート's item×page×creative breakdown
}

interface IncomingEvent {
  id?: string;
  t: EventType;
  ts: number;
  cid?: number;
  crid?: number;
  url?: string;
  pg?: number; // page_group id, already resolved client-side against the config
  dev?: "pc" | "sp" | "tablet";
  pos?: string;
  trg?: string;
  vid?: string;
  sesid?: string;
  // cv-only, see docs/09-cart-integration.md 3.2-3.3
  orderId?: string;
  customerId?: string;
  revenueExTax?: number;
  items?: { code: string; qty: number; revenueExTax: number }[];
  touch?: TouchInfo;
}

interface CollectBody {
  sid: string;
  v?: number;
  events: IncomingEvent[];
}

const MAX_EVENTS_PER_REQUEST = 20;
const MAX_TS_SKEW_MS = 10 * 60 * 1000; // ±10 minutes, per docs/04-api.md 1.3

/**
 * POST /e — the measurement collector (docs/04-api.md 1.3). Always
 * responds 204 with no body, even on most error paths: a beacon call from
 * a visitor's browser has nobody to show an error to, and failing loudly
 * would just make the SDK retry into a queue for no benefit. The one
 * exception is an unresolvable `sid`, which gets a 404 so a
 * misconfigured tag is at least visible in the network tab during setup.
 *
 * Runs against `servicePool` (bypasses RLS) for the same reason as
 * GET /c/[siteId]: there's no logged-in account here, and every query is
 * explicitly scoped to the resolved `site.id`.
 */
export async function POST(req: NextRequest) {
  let body: CollectBody;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (!body?.sid || !Array.isArray(body.events) || body.events.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const { rows: siteRows } = await servicePool().query(
    `SELECT id, account_id, allowed_hosts FROM sites WHERE public_id = $1`,
    [body.sid]
  );
  const site = siteRows[0];
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  if (!isAllowedOrigin(req.headers.get("origin"), site.allowed_hosts)) {
    // Silently drop rather than error — see file header. A spoofed Origin
    // just means these events never get inserted.
    return new NextResponse(null, { status: 204 });
  }

  const client = await servicePool().connect();
  try {
    for (const event of body.events.slice(0, MAX_EVENTS_PER_REQUEST)) {
      await processEvent(client, site, event).catch((err) => {
        // One malformed event in a batch must not sink the rest.
        console.error("collector: failed to process event", err);
      });
    }
  } finally {
    client.release();
  }

  return new NextResponse(null, { status: 204 });
}

async function processEvent(
  client: import("pg").PoolClient,
  site: { id: number; account_id: number },
  event: IncomingEvent
) {
  if (!isValidEventType(event.t)) return;
  if (!Number.isFinite(event.ts)) return;
  if (Math.abs(Date.now() - event.ts) > MAX_TS_SKEW_MS) return;

  const occurredAt = new Date(event.ts);
  // Never trust the client-supplied id blindly: a malformed value (this
  // bit an early SDK build — see git history) would otherwise reach the
  // UUID-typed `event_id` column and fail the insert, silently dropping
  // the event since this endpoint always responds 204 either way.
  const eventId = isUuid(event.id) ? event.id! : randomUUID();

  if (event.t === "cv") {
    await insertCvEvent(client, site, eventId, occurredAt, event);
    return;
  }

  await client.query(
    `INSERT INTO events (
       event_id, occurred_at, account_id, site_id, event_type,
       campaign_id, creative_id, page_group_id, page_path, device,
       visitor_id, session_id, trigger_type, position
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (event_id, occurred_at) DO NOTHING`,
    [
      eventId,
      occurredAt,
      site.account_id,
      site.id,
      event.t,
      event.cid ?? null,
      event.crid ?? null,
      event.pg ?? null,
      event.url ? safePath(event.url) : null,
      event.dev ?? null,
      event.vid ?? null,
      event.sesid ?? null,
      event.trg ?? null,
      event.pos ?? null,
    ]
  );
}

/**
 * CV events get two writes in one transaction: a row in `cv_order_dedup`
 * (the *global* uniqueness guard — see the comment in
 * db/migrations/0004_events.sql on why a partitioned table can't enforce
 * this on its own) and the `events` row itself. If the dedup insert hits a
 * conflict, this order was already recorded and the events insert is
 * skipped entirely — including on retry/reload of the thank-you page.
 *
 * Product/quantity/revenue lines land in `order_items` immediately, from
 * the `items` the CV tag sent directly (docs/09-cart-integration.md 3.2) —
 * no dependency on the order-API sync, which only back-fills
 * `order_type` (first vs. recurring) once OAuth is wired up.
 */
async function insertCvEvent(
  client: import("pg").PoolClient,
  site: { id: number; account_id: number },
  eventId: string,
  occurredAt: Date,
  event: IncomingEvent
) {
  if (!event.orderId) return;

  await client.query("BEGIN");
  try {
    const dedup = await client.query(
      `INSERT INTO cv_order_dedup (site_id, order_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING site_id`,
      [site.id, event.orderId]
    );
    if (dedup.rowCount === 0) {
      // Already recorded — e.g. the thank-you page was reloaded.
      await client.query("ROLLBACK");
      return;
    }

    const attribution: "click" | "view" | "none" =
      event.touch?.type === "click" ? "click" : event.touch?.type === "view" ? "view" : "none";
    const latencySec = event.touch?.ts ? Math.max(0, Math.round((event.ts - event.touch.ts) / 1000)) : null;

    await client.query(
      `INSERT INTO events (
         event_id, occurred_at, account_id, site_id, event_type,
         campaign_id, creative_id, page_group_id, order_id, revenue, attribution, latency_sec
       ) VALUES ($1,$2,$3,$4,'cv',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (event_id, occurred_at) DO NOTHING`,
      [
        eventId,
        occurredAt,
        site.account_id,
        site.id,
        event.touch?.cid ?? null,
        event.touch?.crid ?? null,
        event.touch?.pg ?? null,
        event.orderId,
        event.revenueExTax ?? null,
        attribution,
        latencySec,
      ]
    );

    for (const [index, item] of (event.items ?? []).entries()) {
      if (!item.code) continue;
      const { rows: [product] } = await client.query(
        `INSERT INTO products (site_id, product_code, name, last_seen_at)
         VALUES ($1, $2, '', now())
         ON CONFLICT (site_id, product_code)
         DO UPDATE SET last_seen_at = now()
         RETURNING id`,
        [site.id, item.code]
      );
      await client.query(
        `INSERT INTO order_items (site_id, order_id, line_no, product_id, product_code, quantity, revenue)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (site_id, order_id, line_no) DO NOTHING`,
        [site.id, event.orderId, index, product.id, item.code, item.qty, item.revenueExTax]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function isValidEventType(t: unknown): t is EventType {
  return t === "imp" || t === "click" || t === "cv" || t === "close" || t === "holdout";
}

function isAllowedOrigin(origin: string | null, allowedHosts: string[]): boolean {
  // No Origin header at all happens for some non-browser or older-browser
  // beacon paths; we don't hard-fail on it, matching docs/04-api.md's
  // "許可ホストに未登録のドメインからイベントが来ている" being a *detectable*
  // condition the tag checker surfaces, not a hard block that could silently
  // drop legitimate traffic from browsers that omit Origin on POST.
  if (!origin) return true;
  if (allowedHosts.length === 0) return true;
  try {
    const host = new URL(origin).hostname;
    return allowedHosts.includes(host);
  } catch {
    return false;
  }
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
