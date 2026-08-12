-- Row Level Security: enforce tenant isolation at the DB layer.
-- See docs/10-multitenancy.md 2. Every request sets `app.account_id` via
-- `SET LOCAL` in a transaction (see apps/web/lib/db.ts::withAccount).

-- accounts itself: a session may only see the account row matching app.account_id.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounts
  USING (id = current_setting('app.account_id', true)::bigint);

ALTER TABLE accounts_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounts_plan
  USING (account_id = current_setting('app.account_id', true)::bigint);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (account_id = current_setting('app.account_id', true)::bigint);

ALTER TABLE usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_monthly FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_monthly
  USING (account_id = current_setting('app.account_id', true)::bigint);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (account_id = current_setting('app.account_id', true)::bigint);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sites
  USING (account_id = current_setting('app.account_id', true)::bigint);

ALTER TABLE site_order_api_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_order_api_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_order_api_connections
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE page_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON page_groups
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON campaigns
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE campaign_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON campaign_targets
  USING (campaign_id IN (
    SELECT c.id FROM campaigns c JOIN sites s ON s.id = c.site_id
    WHERE s.account_id = current_setting('app.account_id', true)::bigint
  ));

ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE creatives FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON creatives
  USING (campaign_id IN (
    SELECT c.id FROM campaigns c JOIN sites s ON s.id = c.site_id
    WHERE s.account_id = current_setting('app.account_id', true)::bigint
  ));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assets
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE asset_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset_variants
  USING (asset_id IN (
    SELECT a.id FROM assets a JOIN sites s ON s.id = a.site_id
    WHERE s.account_id = current_setting('app.account_id', true)::bigint
  ));

ALTER TABLE config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON config_versions
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events
  USING (account_id = current_setting('app.account_id', true)::bigint);

ALTER TABLE cv_order_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_order_dedup FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cv_order_dedup
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_items
  USING (site_id IN (SELECT id FROM sites WHERE account_id = current_setting('app.account_id', true)::bigint));

ALTER TABLE stats_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stats_daily
  USING (account_id = current_setting('app.account_id', true)::bigint);

-- Public collector/config-generation paths (the /c and /e routes, and the stats
-- aggregation cron) run with a dedicated Postgres role that bypasses RLS,
-- since they resolve tenancy themselves from sitePublicId before touching data.
-- See docs/10-multitenancy.md 3 and 6.
-- CREATE ROLE popup_service BYPASSRLS LOGIN PASSWORD '...'; -- provisioned by ops, not in migrations
