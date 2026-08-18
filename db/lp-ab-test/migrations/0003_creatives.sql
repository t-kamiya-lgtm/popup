-- Replacement slots (max 2 per LP: 'a' / 'b'), the uploaded assets, and the
-- creative patterns themselves (docs/lp-ab-test/01-data-model.md 4-6).
CREATE TABLE lp_slots (
  id                  BIGSERIAL PRIMARY KEY,
  lp_id               BIGINT NOT NULL REFERENCES lps(id) ON DELETE CASCADE,
  slot_key            TEXT NOT NULL CHECK (slot_key IN ('a','b')),
  label               TEXT NOT NULL DEFAULT '',
  original_image_url  TEXT NOT NULL,
  optimization_mode   TEXT NOT NULL DEFAULT 'equal' CHECK (optimization_mode IN ('equal','auto')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lp_id, slot_key)
);

CREATE TABLE assets (
  id           BIGSERIAL PRIMARY KEY,
  original_key TEXT NOT NULL,     -- Supabase Storage object key
  url          TEXT NOT NULL,     -- public URL (bucket is public, same reasoning as apps/web/lib/assets.ts)
  width        INT NOT NULL,
  height       INT NOT NULL,
  bytes        BIGINT NOT NULL,
  mime         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE creatives (
  id             BIGSERIAL PRIMARY KEY,
  slot_id        BIGINT NOT NULL REFERENCES lp_slots(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  asset_id       BIGINT REFERENCES assets(id),   -- NULL when is_original: the original image is served as-is, not re-uploaded
  is_original    BOOLEAN NOT NULL DEFAULT false,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  weight_percent NUMERIC(5,2) NOT NULL,
  is_locked      BOOLEAN NOT NULL DEFAULT false, -- excluded from the daily auto-optimization batch once manually overridden
  created_by     BIGINT NOT NULL REFERENCES members(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON creatives (slot_id, status);

-- Audit trail for status/weight changes, and the source data the calendar
-- drill-down report reconstructs "what was live on day X" from (no separate
-- snapshot table — see docs/lp-ab-test/01-data-model.md 7).
CREATE TABLE creative_status_events (
  id            BIGSERIAL PRIMARY KEY,
  creative_id   BIGINT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN (
                  'created','activated','paused','weight_changed','locked','unlocked','optimized'
                )),
  weight_before NUMERIC(5,2),
  weight_after  NUMERIC(5,2),
  actor_id      BIGINT REFERENCES members(id),  -- NULL for the automated optimization batch
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON creative_status_events (creative_id, occurred_at);

-- Phase 2 feature (daily CVR-based auto weight optimization); the table
-- exists from the start so lp_slots.optimization_mode='auto' has somewhere
-- to read its thresholds from once the batch is implemented.
CREATE TABLE slot_optimization_settings (
  slot_id        BIGINT PRIMARY KEY REFERENCES lp_slots(id) ON DELETE CASCADE,
  min_impressions INT NOT NULL DEFAULT 1000,
  min_conversions INT NOT NULL DEFAULT 5,
  floor_mode      TEXT NOT NULL DEFAULT 'equal_share' CHECK (floor_mode IN ('equal_share','fixed_percent')),
  floor_percent   NUMERIC(5,2),
  last_run_at     TIMESTAMPTZ
);
