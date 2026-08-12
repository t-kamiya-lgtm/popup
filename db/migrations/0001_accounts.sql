-- Accounts, users, memberships (multi-tenant core). See docs/10-multitenancy.md.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  max_sites       INT NOT NULL,
  max_users       INT NOT NULL,
  max_campaigns   INT NOT NULL,
  monthly_imp_quota BIGINT NOT NULL,
  storage_mb      INT NOT NULL,
  features        JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE accounts_plan (
  account_id   BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_code    TEXT NOT NULL REFERENCES plans(code),
  status       TEXT NOT NULL CHECK (status IN ('trial','active','past_due','canceled')),
  trial_ends_at TIMESTAMPTZ
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);

CREATE TABLE usage_monthly (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month      DATE NOT NULL,
  imps       BIGINT NOT NULL DEFAULT 0,
  clicks     BIGINT NOT NULL DEFAULT 0,
  cvs        BIGINT NOT NULL DEFAULT 0,
  storage_mb INT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month)
);

CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL,
  user_id    BIGINT,
  action     TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id  BIGINT,
  diff       JSONB,
  ip         INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (code, name, max_sites, max_users, max_campaigns, monthly_imp_quota, storage_mb, features)
VALUES ('standard', 'Standard', 5, 10, 50, 1000000, 5000,
  '{"holdout": true, "s2sCv": false, "csvExport": true}');
