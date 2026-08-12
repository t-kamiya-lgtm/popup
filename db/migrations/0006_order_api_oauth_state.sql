-- Transient CSRF state for the OAuth2 authorize-code flow (docs/09-cart-integration.md 3.5).
-- The callback is a public, unauthenticated endpoint reached via redirect
-- from the cart's OAuth server, so there's no session to check the state
-- against — it has to be persisted server-side between the authorize-url
-- request and the callback. One in-flight authorization per site is all
-- Phase 1 needs, so a single nullable column (cleared once consumed) is
-- enough; no separate state table.
ALTER TABLE site_order_api_connections ADD COLUMN oauth_state TEXT;
