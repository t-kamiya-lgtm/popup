-- `users` is intentionally NOT tenant-scoped (see 0005_rls.sql's
-- tenant_isolation policies, which deliberately omit this table): a login
-- identity has no account_id column and can belong to memberships across
-- multiple accounts, so there is nothing to scope by. RLS on it appears to
-- have been enabled outside these migrations (e.g. a hosting dashboard's
-- "enable RLS" prompt) with no policy permitting inserts, which blocked
-- the invite flow's `INSERT INTO users ... ON CONFLICT`
-- (POST /api/v1/accounts/[id]/members) with "new row violates row-level
-- security policy for table users" (Postgres error 42501).
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
