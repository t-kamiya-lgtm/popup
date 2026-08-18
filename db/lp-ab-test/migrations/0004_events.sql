-- Only imp/cv are measured (no clicks — see docs/lp-ab-test/00-requirements.md
-- 6). One impression row covers both slots shown together in the same
-- pageview so slot-level and A×B cross-tab reports both come off the same
-- table (docs/lp-ab-test/01-data-model.md 9).
CREATE TABLE impressions (
  id            BIGSERIAL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  lp_id         BIGINT NOT NULL REFERENCES lps(id),
  session_id    TEXT NOT NULL,
  creative_a_id BIGINT REFERENCES creatives(id),
  creative_b_id BIGINT REFERENCES creatives(id),
  device        TEXT CHECK (device IN ('pc','sp','tablet')),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE conversions (
  id            BIGSERIAL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  lp_id         BIGINT NOT NULL REFERENCES lps(id),
  session_id    TEXT NOT NULL,
  order_id      TEXT,
  revenue       NUMERIC(12,2),
  creative_a_id BIGINT REFERENCES creatives(id),  -- snapshot of the combo shown at the session's last impression
  creative_b_id BIGINT REFERENCES creatives(id),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX ON impressions (lp_id, occurred_at DESC);
CREATE INDEX ON impressions (session_id, occurred_at DESC);
CREATE INDEX ON conversions (lp_id, occurred_at DESC);
CREATE UNIQUE INDEX conversions_lp_order ON conversions (lp_id, order_id) WHERE order_id IS NOT NULL;

-- Default partitions so inserts work out of the box in dev/CI; production
-- ops should pre-create the next month's partition ahead of the rollover
-- (same operational note as the popup tool's events table).
CREATE TABLE impressions_default PARTITION OF impressions DEFAULT;
CREATE TABLE conversions_default PARTITION OF conversions DEFAULT;

-- Daily rollup the report screen reads from (never queries impressions/
-- conversions directly for anything beyond "today", same reasoning as the
-- popup tool's stats_daily).
CREATE TABLE stats_daily (
  date        DATE NOT NULL,
  lp_id       BIGINT NOT NULL,
  slot_key    TEXT NOT NULL,               -- 'a' | 'b'
  creative_id BIGINT NOT NULL DEFAULT 0,   -- 0 = that slot's total row
  imps        BIGINT NOT NULL DEFAULT 0,
  cv          BIGINT NOT NULL DEFAULT 0,
  revenue     NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (lp_id, date, slot_key, creative_id)
);
