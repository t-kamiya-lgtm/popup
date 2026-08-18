import { Pool, type PoolClient } from "pg";

// No RLS/multitenancy here (single internal org — docs/lp-ab-test/
// 01-data-model.md preamble), so unlike the popup tool's lib/db.ts this is
// just one pool with plain role checks done in app code
// (lib/require-member.ts) instead of a Postgres session variable.
let _pool: Pool | undefined;

export function pool(): Pool {
  return (_pool ??= new Pool({ connectionString: requireEnv("DATABASE_URL") }));
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
