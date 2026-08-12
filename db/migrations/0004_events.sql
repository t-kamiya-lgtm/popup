-- Events (partitioned), order_items, stats_daily. See docs/03-data-model.md.

CREATE TABLE events (
  id             BIGSERIAL,
  event_id       UUID NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id     BIGINT NOT NULL,
  site_id        BIGINT NOT NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN ('imp','click','cv','close','holdout')),
  campaign_id    BIGINT,
  creative_id    BIGINT,
  config_version BIGINT,
  page_group_id  BIGINT,
  page_path      TEXT,
  device         TEXT CHECK (device IN ('pc','sp','tablet')),
  visitor_id     TEXT,
  session_id     TEXT,
  trigger_type   TEXT,
  position       TEXT,
  -- CV fields. See docs/09-cart-integration.md 3.
  order_id       TEXT,
  order_type     TEXT CHECK (order_type IN ('first','recurring','unknown')) DEFAULT 'unknown',
  revenue        NUMERIC(12,2),
  attribution    TEXT CHECK (attribution IN ('none','click','view')),
  latency_sec    INT,
  order_type_status TEXT CHECK (order_type_status IN ('pending','confirmed')) DEFAULT 'pending',
  order_type_synced_at TIMESTAMPTZ,
  is_bot         BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Default partition catches everything until monthly partitions are created ahead of time
-- by the ops script (db/create-partition.mjs). Fine for local/dev bootstrap.
CREATE TABLE events_default PARTITION OF events DEFAULT;

-- Unique constraints on a partitioned table must include the partition key
-- (occurred_at), so they can only enforce uniqueness *within* a partition.
-- event_id dedup is fine with that (a retried event carries the same
-- occurred_at each time). CV order_id dedup needs *global* uniqueness
-- regardless of partition, which a partitioned index can't express — so
-- that's enforced via the separate cv_order_dedup table below instead.
CREATE UNIQUE INDEX events_event_id_idx ON events (event_id, occurred_at);
CREATE INDEX events_site_time_idx ON events (site_id, occurred_at DESC);
CREATE INDEX events_order_id_idx ON events (site_id, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX events_order_type_pending_idx ON events (site_id, order_id) WHERE order_type_status = 'pending';

-- Global dedup key for CV events: the collector inserts here first (in the
-- same transaction as the events row); a unique_violation means this order
-- was already recorded, so the events insert is skipped. See
-- apps/web/app/e/route.ts.
CREATE TABLE cv_order_dedup (
  site_id  BIGINT NOT NULL,
  order_id TEXT NOT NULL,
  PRIMARY KEY (site_id, order_id)
);

CREATE TABLE order_items (
  id           BIGSERIAL PRIMARY KEY,
  site_id      BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  order_id     TEXT NOT NULL,
  line_no      INT NOT NULL,
  product_id   BIGINT NOT NULL REFERENCES products(id),
  product_code TEXT NOT NULL,
  quantity     INT NOT NULL,
  revenue      NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, order_id, line_no)
);
CREATE INDEX ON order_items (site_id, product_id);

CREATE TABLE stats_daily (
  date           DATE NOT NULL,
  account_id     BIGINT NOT NULL,
  site_id        BIGINT NOT NULL,
  campaign_id    BIGINT NOT NULL DEFAULT 0,
  creative_id    BIGINT NOT NULL DEFAULT 0,
  product_id     BIGINT NOT NULL DEFAULT 0,
  page_group_id  BIGINT NOT NULL DEFAULT 0,
  device         TEXT NOT NULL DEFAULT 'all',
  imps           BIGINT NOT NULL DEFAULT 0,
  clicks         BIGINT NOT NULL DEFAULT 0,
  closes         BIGINT NOT NULL DEFAULT 0,
  cv_click       BIGINT NOT NULL DEFAULT 0,
  cv_view        BIGINT NOT NULL DEFAULT 0,
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  holdout_sessions BIGINT NOT NULL DEFAULT 0,
  holdout_cv     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date, campaign_id, creative_id, product_id, page_group_id, device)
);
CREATE INDEX ON stats_daily (site_id, date);
