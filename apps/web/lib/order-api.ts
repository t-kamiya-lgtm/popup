import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { decryptSecret, encryptSecret } from "./crypto";

/** Both `Pool` and `PoolClient` satisfy this — callers pass whichever they already have. */
type Queryable = Pick<PoolClient, "query">;

export interface OrderApiConnection {
  siteId: number;
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  clientId: string | null;
  status: "not_connected" | "connected" | "expired" | "error";
  tokenExpiresAt: Date | null;
  orderIdField: "order_id" | "ec_order_id";
  lastSyncedAt: Date | null;
  lastError: string | null;
}

// docs/09-cart-integration.md 3.5 assumed a `scope=read_sales` param would
// be needed, following generic OAuth2 convention — verified against the
// live API (2026-08-12) and it rejects that value with
// `invalid_scope: An unsupported scope was requested`. スマレジEC・リピート
// apparently fixes the granted scope at app-registration time instead (via
// 外部アプリ連携 in their own admin screen), so no `scope` param is sent here.

export async function getConnection(client: Queryable, siteId: number): Promise<OrderApiConnection | null> {
  const { rows } = await client.query(
    `SELECT site_id, authorize_url, token_url, api_base_url, client_id, status,
            token_expires_at, order_id_field, last_synced_at, last_error
     FROM site_order_api_connections WHERE site_id = $1`,
    [siteId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    siteId: Number(r.site_id),
    authorizeUrl: r.authorize_url,
    tokenUrl: r.token_url,
    apiBaseUrl: r.api_base_url,
    clientId: r.client_id,
    status: r.status,
    tokenExpiresAt: r.token_expires_at,
    orderIdField: r.order_id_field ?? "order_id",
    lastSyncedAt: r.last_synced_at,
    lastError: r.last_error,
  };
}

export interface CredentialsInput {
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  orderIdField: "order_id" | "ec_order_id";
}

/** Registers/replaces the client_id + client_secret for a site (docs/04-api.md 1.5.1). Resets any in-progress connection. */
export async function saveCredentials(client: Queryable, siteId: number, input: CredentialsInput): Promise<void> {
  await client.query(
    `INSERT INTO site_order_api_connections
       (site_id, authorize_url, token_url, api_base_url, client_id, client_secret_encrypted, order_id_field, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'not_connected')
     ON CONFLICT (site_id) DO UPDATE SET
       authorize_url = EXCLUDED.authorize_url,
       token_url = EXCLUDED.token_url,
       api_base_url = EXCLUDED.api_base_url,
       client_id = EXCLUDED.client_id,
       client_secret_encrypted = EXCLUDED.client_secret_encrypted,
       order_id_field = EXCLUDED.order_id_field,
       status = 'not_connected',
       access_token_encrypted = NULL,
       refresh_token_encrypted = NULL,
       token_expires_at = NULL,
       oauth_state = NULL,
       last_error = NULL`,
    [siteId, input.authorizeUrl, input.tokenUrl, input.apiBaseUrl, input.clientId, encryptSecret(input.clientSecret), input.orderIdField]
  );
}

export class OrderApiError extends Error {}

/** Builds the authorize.php redirect URL and persists a fresh CSRF state (docs/04-api.md 1.5.1). */
export async function buildAuthorizeUrl(client: Queryable, siteId: number, redirectUri: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT authorize_url, client_id FROM site_order_api_connections WHERE site_id = $1`,
    [siteId]
  );
  const row = rows[0];
  if (!row?.client_id) {
    throw new OrderApiError("先にクライアントID・クライアントシークレットを登録してください");
  }

  const state = randomBytes(16).toString("hex");
  await client.query(`UPDATE site_order_api_connections SET oauth_state = $2 WHERE site_id = $1`, [siteId, state]);

  const url = new URL(row.authorize_url);
  url.searchParams.set("client_id", row.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges the authorize-callback `code` for tokens (docs/04-api.md 1.5.2).
 * `state` must be checked by the caller *before* calling this (CSRF).
 *
 * grant_type is `client_credentials` here per the vendor's own API
 * documentation for this step, not the more usual `authorization_code` —
 * confirmed against the pasted スマレジEC API docs (docs/09-cart-integration.md
 * 3.5's "実機で早めに疎通確認" note applies: verify this against the live
 * API before going live, since the vendor doc didn't cover every edge case).
 */
export async function exchangeCodeForToken(client: Queryable, siteId: number, code: string): Promise<void> {
  const { rows } = await client.query(
    `SELECT token_url, client_id, client_secret_encrypted FROM site_order_api_connections WHERE site_id = $1`,
    [siteId]
  );
  const row = rows[0];
  if (!row) throw new OrderApiError("連携情報が見つかりません");

  const clientSecret = decryptSecret(row.client_secret_encrypted);
  const res = await fetch(row.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: row.client_id,
      client_secret: clientSecret,
      code,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await markError(client, siteId, `token exchange failed: ${res.status} ${text}`.slice(0, 500));
    throw new OrderApiError("トークンの取得に失敗しました");
  }

  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await storeTokens(client, siteId, body);
}

async function storeTokens(
  client: Queryable,
  siteId: number,
  tokens: { access_token: string; refresh_token: string; expires_in: number }
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await client.query(
    `UPDATE site_order_api_connections SET
       access_token_encrypted = $2, refresh_token_encrypted = $3, token_expires_at = $4,
       status = 'connected', oauth_state = NULL, last_error = NULL
     WHERE site_id = $1`,
    [siteId, encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token), expiresAt]
  );
}

async function markError(client: Queryable, siteId: number, message: string): Promise<void> {
  await client.query(`UPDATE site_order_api_connections SET status = 'error', last_error = $2 WHERE site_id = $1`, [
    siteId,
    message,
  ]);
}

const REFRESH_MARGIN_MS = 10 * 24 * 60 * 60 * 1000; // docs/09-cart-integration.md 3.5: 期限の10日前を目安に更新

/** Refreshes the access token if it's within 10 days of expiring. Returns the (possibly just-refreshed) decrypted access token. */
export async function ensureFreshToken(client: Queryable, siteId: number): Promise<string> {
  const { rows } = await client.query(
    `SELECT token_url, client_id, client_secret_encrypted, access_token_encrypted, refresh_token_encrypted, token_expires_at
     FROM site_order_api_connections WHERE site_id = $1`,
    [siteId]
  );
  const row = rows[0];
  if (!row?.access_token_encrypted) throw new OrderApiError("未連携です");

  const expiresAt: Date = row.token_expires_at;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (!needsRefresh) {
    return decryptSecret(row.access_token_encrypted);
  }

  const clientSecret = decryptSecret(row.client_secret_encrypted);
  const refreshToken = decryptSecret(row.refresh_token_encrypted);
  const res = await fetch(row.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: row.client_id,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await client.query(`UPDATE site_order_api_connections SET status = 'expired', last_error = $2 WHERE site_id = $1`, [
      siteId,
      `refresh failed: ${res.status} ${text}`.slice(0, 500),
    ]);
    throw new OrderApiError("トークンの更新に失敗しました。再連携が必要です");
  }

  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await storeTokens(client, siteId, body);
  return body.access_token;
}

export async function disconnect(client: Queryable, siteId: number): Promise<void> {
  await client.query(
    `UPDATE site_order_api_connections SET
       status = 'not_connected', access_token_encrypted = NULL, refresh_token_encrypted = NULL,
       token_expires_at = NULL, oauth_state = NULL, last_error = NULL
     WHERE site_id = $1`,
    [siteId]
  );
}

/** order.order_cnt is the customer's lifetime order count (docs/09-cart-integration.md 3.6 #2, pending live confirmation). */
export function classifyOrderType(orderCnt: number): "first" | "recurring" {
  return orderCnt <= 1 ? "first" : "recurring";
}

interface SyncResult {
  succeeded: number;
  failed: number;
  unknown: number;
}

const STALE_PENDING_DAYS = 8; // docs/04-api.md 1.5.3 step 5

/**
 * Resolves order_type for every pending CV event on a site (docs/04-api.md
 * 1.5.3). Intended to be invoked by a cron job; also exposed as a manual
 * "sync now" admin action for Phase 1 since there's no cron runner yet.
 */
export async function syncPendingOrderTypes(client: Queryable, siteId: number, limit = 50): Promise<SyncResult> {
  const conn = await getConnection(client, siteId);
  if (!conn || conn.status !== "connected") {
    throw new OrderApiError("未連携です");
  }

  const accessToken = await ensureFreshToken(client, siteId);

  const { rows: pending } = await client.query(
    `SELECT event_id, order_id, occurred_at FROM events
     WHERE site_id = $1 AND order_type_status = 'pending' AND order_id IS NOT NULL
     ORDER BY occurred_at ASC LIMIT $2`,
    [siteId, limit]
  );

  const result: SyncResult = { succeeded: 0, failed: 0, unknown: 0 };
  const staleBefore = new Date(Date.now() - STALE_PENDING_DAYS * 24 * 60 * 60 * 1000);

  for (const ev of pending) {
    try {
      const order = await findOrder(conn.apiBaseUrl, accessToken, ev.order_id, conn.orderIdField);
      if (!order) {
        if (new Date(ev.occurred_at) < staleBefore) {
          // event_id alone, not event_id+occurred_at: node-pg round-trips
          // TIMESTAMPTZ through a JS Date, which only has millisecond
          // precision, so a `WHERE occurred_at = $N` built from a value we
          // just read back out would silently match zero rows whenever the
          // stored value has microseconds — exactly what happened here
          // during testing (204 success, 0 rows changed). event_id is
          // already unique (events_event_id_idx), so it doesn't need help.
          await client.query(
            `UPDATE events SET order_type = 'unknown', order_type_status = 'confirmed', order_type_synced_at = now()
             WHERE event_id = $1`,
            [ev.event_id]
          );
          result.unknown++;
        }
        continue;
      }
      const orderType = classifyOrderType(order.order_cnt);
      await client.query(
        `UPDATE events SET order_type = $2, order_type_status = 'confirmed', order_type_synced_at = now()
         WHERE event_id = $1`,
        [ev.event_id, orderType]
      );
      result.succeeded++;
    } catch {
      result.failed++;
    }
  }

  await client.query(`UPDATE site_order_api_connections SET last_synced_at = now() WHERE site_id = $1`, [siteId]);
  return result;
}

async function findOrder(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
  orderIdField: "order_id" | "ec_order_id"
): Promise<{ order_cnt: number } | null> {
  // docs/04-api.md 1.5.3
  const res = await fetch(new URL("/api/v2/orders/search", apiBaseUrl).toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      search_options: { [`${orderIdField}_from`]: orderId, [`${orderIdField}_to`]: orderId },
      response_options: { response_type: "json" },
    }),
  });
  if (!res.ok) throw new OrderApiError(`orders/search failed: ${res.status}`);
  const body = (await res.json()) as { orders?: { order_cnt: number }[] };
  return body.orders?.[0] ?? null;
}
