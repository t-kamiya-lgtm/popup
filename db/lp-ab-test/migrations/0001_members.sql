-- Thin profile/role table alongside Supabase Auth's auth.users. Invite-only:
-- an admin creates the row first by email (invited_at set, auth_user_id and
-- accepted_at null); the row is looked up by email at login time and
-- auth_user_id/accepted_at are filled in on first successful Google sign-in.
-- No self-registration path exists anywhere in the app — an email with no
-- row here (or accepted_at still null on a *different* email) is refused.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE members (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  auth_user_id  UUID UNIQUE,        -- filled in from auth.users.id on first login
  invited_by    BIGINT REFERENCES members(id),
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
