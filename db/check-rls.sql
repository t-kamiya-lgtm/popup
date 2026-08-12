-- CI check: fails (returns rows) if any application table lacks RLS.
-- Run in CI after migrations: psql -v ON_ERROR_STOP=1 -f db/check-rls.sql
-- See docs/10-multitenancy.md 2.
SELECT tablename FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename NOT IN (
    'plans',              -- global reference data, not tenant-scoped
    'users',              -- spans accounts via memberships; no single account_id column
    'events_default',     -- partition child; RLS is inherited from the `events` parent
    'schema_migrations'   -- migration-runner bookkeeping, not application data
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.relname = t.tablename AND c.relrowsecurity
  );
