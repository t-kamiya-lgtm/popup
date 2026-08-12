import type { PoolClient } from "pg";

/**
 * Phase 1 has no account/site switcher UI yet (docs/06-admin.md defers
 * multi-site nav) — every admin page just operates on the account's first
 * site. Centralizing that assumption here means the eventual switcher only
 * has to change this one function, not every page that needs "the current
 * site".
 */
export async function getCurrentSite(client: PoolClient): Promise<{ id: number; name: string; publicId: string } | null> {
  const { rows } = await client.query(
    `SELECT id, name, public_id FROM sites ORDER BY id ASC LIMIT 1`
  );
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), name: row.name, publicId: row.public_id };
}
