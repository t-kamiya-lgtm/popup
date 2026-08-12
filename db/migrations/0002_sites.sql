-- Sites, products, page_groups. See docs/03-data-model.md, docs/09-cart-integration.md.

CREATE TABLE sites (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_id     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  allowed_hosts TEXT[] NOT NULL DEFAULT '{}',
  cart_hosts    TEXT[] NOT NULL DEFAULT '{}',
  cross_domain_cart BOOLEAN NOT NULL DEFAULT false,
  signing_key   BYTEA NOT NULL DEFAULT gen_random_bytes(32),
  timezone      TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  cv_click_window_days INT NOT NULL DEFAULT 7,
  cv_view_window_days  INT NOT NULL DEFAULT 1,
  cv_count_recurring   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sites (account_id);

-- OAuth2 connection for the cart's order API (used only for order_type first/recurring
-- classification; product/revenue come from the CV tag directly). See
-- docs/09-cart-integration.md 3.5-3.7.
CREATE TABLE site_order_api_connections (
  site_id        BIGINT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  authorize_url  TEXT NOT NULL,
  token_url      TEXT NOT NULL,
  api_base_url   TEXT NOT NULL,
  client_id      TEXT,
  client_secret_encrypted   BYTEA,
  access_token_encrypted    BYTEA,
  refresh_token_encrypted   BYTEA,
  token_expires_at TIMESTAMPTZ,
  order_id_field TEXT CHECK (order_id_field IN ('order_id','ec_order_id')),
  status         TEXT NOT NULL CHECK (status IN ('not_connected','connected','expired','error'))
                 DEFAULT 'not_connected',
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id           BIGSERIAL PRIMARY KEY,
  site_id      BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  archived     BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, product_code)
);

CREATE TABLE page_groups (
  id         BIGSERIAL PRIMARY KEY,
  site_id    BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact','prefix','contains','regex')),
  pattern    TEXT NOT NULL,
  priority   INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON page_groups (site_id, priority);
