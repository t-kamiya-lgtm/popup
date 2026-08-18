# LP Creative A/B Test Tool

Separate app from `apps/web` (the popup tool) — its own Supabase project/DB,
its own Vercel deployment. Design docs: [`docs/lp-ab-test/`](../../docs/lp-ab-test).

## Phase 1 implementation status

Implemented (per [docs/lp-ab-test/00-requirements.md](../../docs/lp-ab-test/00-requirements.md)):

- DB schema (`db/lp-ab-test/migrations/`): members/lps/lp_slots/assets/
  creatives/creative_status_events/slot_optimization_settings/impressions/
  conversions/stats_daily/popup_link_cache
- Invite-only Google login (Supabase Auth, `@primedirect.jp` domain-restricted,
  `admin`/`editor`/`viewer` roles) — `app/login`, `app/auth/callback`,
  `lib/require-member.ts`
- LP CRUD + list (filter by product code/item name/LP name, paused LPs
  hidden by default, per-row accordion of active creatives, status badge)
- Slot (max 2 per LP) + creative registration: image upload with size/aspect
  validation (`lib/assets.ts`), equal-split weighting with the remainder
  pinned to the original image (`lib/weights.ts`), pause/resume, manual
  weight override, per-LP change history
- Delivery tag (`tag-src/tag.ts`, built by `scripts/build-tag.mjs` into
  `public/tag.js`) — client-side hash-based creative selection (reuses
  `@popup/shared`'s `pickCreative`) + img swap + imp beacon; a separate CV
  tag (`tag-src/cv-tag.ts` → `public/cv-tag.js`) for the thank-you page
- Report screen: current-month default (LPs with delivery activity only),
  item/LP name/period filters, per-slot imp/CV/CVR table, a significance
  flag per creative vs. the original, CSV export

Not yet implemented (Phase 2/3 per the roadmap discussed with the user):
CVR-based daily auto-optimization batch, calendar-based drill-down report,
tag-install checker, and the popup-tool lookup integration (the DB tables/
env vars for the latter two already exist, unused, so Phase 1 doesn't need
another migration to add them later).

## Local dev

```bash
pnpm install
bash db/lp-ab-test/setup-local.sh                                  # role/db creation (once)
DATABASE_URL=postgresql://lp_ab_test:lp_ab_test@localhost:5432/lp_ab_test_dev node db/lp-ab-test/migrate.mjs
DATABASE_URL=postgresql://lp_ab_test:lp_ab_test@localhost:5432/lp_ab_test_dev SEED_ADMIN_EMAIL=you@primedirect.jp node db/lp-ab-test/seed.mjs
cp apps/lp-ab-test/.env.example apps/lp-ab-test/.env.local          # fill in Supabase project values
pnpm dev:lp-ab-test                                                 # http://localhost:3100
```

Requires a Supabase project with the Google OAuth provider enabled
(redirect URL: `{NEXT_PUBLIC_APP_BASE_URL}/auth/callback`) and a public
Storage bucket named `lp-ab-test-assets`.
