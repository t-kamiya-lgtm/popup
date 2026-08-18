-- Phase 3 (docs/lp-ab-test/03-popup-integration.md): cached result of calling
-- the popup tool's GET /api/v1/lookup so LP/report list screens don't hit
-- that API on every render. Table exists from the start; populated once the
-- lookup integration ships.
CREATE TABLE popup_link_cache (
  lp_id       BIGINT PRIMARY KEY REFERENCES lps(id) ON DELETE CASCADE,
  link_type   TEXT CHECK (link_type IN ('campaign','campaign_list','none')),
  campaign_id BIGINT,
  site_id     BIGINT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
