import { Pool, type PoolClient } from "pg";

/**
 * Two separate pools, matching docs/10-multitenancy.md 2-3:
 *
 * - `appPool` connects as the RLS-restricted role. Use `withAccount` for
 *   any admin-API code path that acts on behalf of a logged-in user — it
 *   sets `app.account_id` for the transaction, so a bug that forgets a
 *   `WHERE account_id = ...` clause fails closed instead of leaking another
 *   tenant's rows.
 *
 * - `servicePool` connects as a BYPASSRLS role, for the two public,
 *   unauthenticated endpoints (GET /c/[siteId], POST /e) that resolve
 *   tenancy themselves from `sitePublicId` before touching anything, and
 *   for the cron jobs (stats rollup, order-API sync) that legitimately
 *   operate across tenants. Never use this pool to serve a request that
 *   carries a user-supplied account/site id without validating it first.
 */
// Lazily constructed: Next.js evaluates route modules during `next build`'s
// page-data collection step, before any env vars are guaranteed to be
// present. Instantiating the Pool eagerly at module scope would make every
// build fail without a live DATABASE_URL. Getters defer that to first
// actual use (i.e. a real request).
let _appPool: Pool | undefined;
let _servicePool: Pool | undefined;

export function appPool(): Pool {
  return (_appPool ??= new Pool({ connectionString: requireEnv("DATABASE_URL") }));
}

export function servicePool(): Pool {
  return (_servicePool ??= new Pool({ connectionString: requireEnv("DATABASE_SERVICE_URL") }));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Runs `fn` inside a transaction with `app.account_id` set for the
 * duration, so every RLS policy in the schema scopes automatically to this
 * account. This is the *only* sanctioned way admin-API route handlers
 * should query tenant data.
 */
export async function withAccount<T>(
  accountId: number,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query("BEGIN");
    // set_config's third arg (is_local=true) scopes this to the current
    // transaction only, so it can't leak onto the next query a pooled
    // connection happens to serve.
    await client.query("SELECT set_config('app.account_id', $1, true)", [String(accountId)]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
