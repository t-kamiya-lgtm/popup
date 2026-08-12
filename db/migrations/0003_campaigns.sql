-- Campaigns, targets, creatives, assets, config publishing. See docs/03-data-model.md.

CREATE TABLE campaigns (
  id            BIGSERIAL PRIMARY KEY,
  site_id       BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('draft','active','paused','archived')) DEFAULT 'draft',
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,

  triggers      JSONB NOT NULL DEFAULT '{"mode":"any","rules":[]}',
  devices       TEXT[] NOT NULL DEFAULT '{pc,sp,tablet}',
  audience      JSONB NOT NULL DEFAULT '{}',
  frequency     JSONB NOT NULL DEFAULT '{"perSession":1,"perDay":2,"suppressDaysAfterClose":3,"suppressAfterClick":true,"minIntervalSeconds":300}',
  holdout_rate  NUMERIC(4,3) NOT NULL DEFAULT 0,

  position_pc   TEXT NOT NULL CHECK (position_pc IN ('bottom_right','bottom_center','bottom_left','center')) DEFAULT 'bottom_right',
  position_sp   TEXT NOT NULL DEFAULT 'center' CHECK (position_sp IN ('center','bottom')),
  overlay       BOOLEAN NOT NULL DEFAULT true,
  close_button  BOOLEAN NOT NULL DEFAULT true,

  priority      INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON campaigns (site_id, status);

CREATE TABLE campaign_targets (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('include','exclude')),
  target_type TEXT NOT NULL CHECK (target_type IN ('product_code','url')) DEFAULT 'url',
  match_type  TEXT CHECK (match_type IN ('exact','prefix','contains','regex')),
  pattern     TEXT NOT NULL
);
CREATE INDEX ON campaign_targets (campaign_id);

CREATE TABLE assets (
  id           BIGSERIAL PRIMARY KEY,
  site_id      BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  original_key TEXT NOT NULL,
  width        INT NOT NULL,
  height       INT NOT NULL,
  bytes        BIGINT NOT NULL,
  mime         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('processing','ready','failed')) DEFAULT 'processing',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asset_variants (
  id        BIGSERIAL PRIMARY KEY,
  asset_id  BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  purpose   TEXT NOT NULL CHECK (purpose IN ('sp','pc')),
  dpr       INT NOT NULL,
  format    TEXT NOT NULL CHECK (format IN ('avif','webp','png','jpeg')),
  width     INT NOT NULL,
  height    INT NOT NULL,
  url       TEXT NOT NULL,
  bytes     BIGINT NOT NULL
);
CREATE INDEX ON asset_variants (asset_id);

CREATE TABLE creatives (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active','paused')) DEFAULT 'active',
  asset_pc_id BIGINT REFERENCES assets(id),
  asset_sp_id BIGINT REFERENCES assets(id),
  alt_text    TEXT NOT NULL DEFAULT '',
  link_url    TEXT NOT NULL,
  link_target TEXT NOT NULL DEFAULT '_blank' CHECK (link_target IN ('_self','_blank')),
  weight      INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON creatives (campaign_id, status);

CREATE TABLE config_versions (
  id          BIGSERIAL PRIMARY KEY,
  site_id     BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version     BIGINT NOT NULL,
  payload     JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  UNIQUE (site_id, version)
);
