-- Brands: account-level tags applied to campaigns so reporting can group by
-- brand instead of by purchased product. Unlike the old product axis
-- (identified only from the thank-you page's {商品毎出力} loop tag, so
-- imp/click never had one), a brand lives on the campaign itself — the
-- same thing every event already carries a campaign_id for — so imp/click
-- get a brand breakdown too, not just CV.
CREATE TABLE brands (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);
CREATE INDEX ON brands (account_id);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brands
  USING (account_id = current_setting('app.account_id', true)::bigint);

-- ON DELETE SET NULL rather than RESTRICT: the API layer (see
-- DELETE /api/v1/brands/[id]) blocks deleting a brand that has delivery
-- history, but a brand assigned to a campaign with zero events yet is
-- fine to delete — the campaign just reverts to "no brand" rather than
-- the delete failing on a foreign key the admin has no visibility into.
ALTER TABLE campaigns ADD COLUMN brand_id BIGINT REFERENCES brands(id) ON DELETE SET NULL;
