#!/usr/bin/env node
// Minimal migration runner: applies db/lp-ab-test/migrations/*.sql in
// filename order, tracked in a `schema_migrations` table. No down-migrations
// by design — this project is pre-launch, so fixes are new forward
// migrations. Mirrors db/migrate.mjs (the popup tool's own runner) — kept as
// a separate script because this app uses a separate Supabase project/DB.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await client.query("SELECT filename FROM schema_migrations")).rows.map(
      (r) => r.filename
    )
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`Failed applying ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log("Migrations up to date.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
