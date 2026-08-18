#!/usr/bin/env node
// Bootstraps the very first admin invite (docs/lp-ab-test/00-requirements.md
// 8 — invite-only, no self-registration, so *someone* has to be seeded
// before anyone can log in at all). Safe to re-run: upserts on email.
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
const email = process.env.SEED_ADMIN_EMAIL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!email) {
  console.error("SEED_ADMIN_EMAIL is not set (e.g. SEED_ADMIN_EMAIL=you@primedirect.jp)");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query(
    `INSERT INTO members (email, role, invited_at)
     VALUES ($1, 'admin', now())
     ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
    [email]
  );
  console.log(`Seeded admin invite for ${email}. Log in with that Google account to activate it.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
