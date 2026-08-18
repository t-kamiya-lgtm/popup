CREATE TABLE lps (
  id              BIGSERIAL PRIMARY KEY,
  product_code    TEXT NOT NULL,
  item_name       TEXT NOT NULL,
  lp_name         TEXT NOT NULL,
  url             TEXT NOT NULL,             -- LP URL; the delivery tag's page and the popup-tool lookup key
  top_image_url   TEXT,                       -- auto-fetched thumbnail for list screens; nullable until fetched
  delivery_status TEXT NOT NULL DEFAULT 'active' CHECK (delivery_status IN ('active','paused')),
  created_by      BIGINT NOT NULL REFERENCES members(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON lps (delivery_status);
CREATE INDEX ON lps (product_code);
CREATE INDEX ON lps (item_name);
