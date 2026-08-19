# LP Creative A/B Test Tool

Separate app from `apps/web` (the popup tool) — its own Supabase project/DB,
its own Vercel deployment (Project Settings: Root Directory `apps/lp-ab-test`,
Storage bucket `lp-ab-test-assets` set to public).
Design docs: [`docs/lp-ab-test/`](../../docs/lp-ab-test). Stable preview URL:
`https://lp-ab-test-git-claude-lp-creativ-68c892-t-kamiya-lgtms-projects.vercel.app`.
(When redeploying manually in the Vercel dashboard, use the row whose
Source is this branch/Preview — not any row still showing Production /
`claude/ec-exit-popup-tool-ssh4xs`, which predates this app and always
fails with a missing Root Directory.)

## Implementation status

All three phases discussed with the user are implemented (per
[docs/lp-ab-test/00-requirements.md](../../docs/lp-ab-test/00-requirements.md)):

**Phase 1**
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

**Phase 2**
- Daily CVR-based auto-optimization batch (`lib/optimize.ts`, `GET
  /api/cron/optimize`, wired to Vercel Cron via `vercel.json`) — locked/
  paused creatives excluded, a floor guaranteed to everyone else, the rest
  split by CVR among patterns clearing configurable min-imp/min-CV
  thresholds. Toggle + thresholds are editable per slot on the LP detail page.
- Calendar drill-down report (`lib/calendar.ts` + the reports screen's
  collapsible calendar section): reconstructs day-by-day active-creative
  composition per LP purely from `creative_status_events`, merges
  consecutive identical days into clickable bands, and clicking one filters
  the report to that exact period and creative set.
- Tag install checker (`lib/tag-checker.ts`): on-demand check on the LP
  detail page — fetches the LP's own URL looking for the delivery tag, and
  reports whether any impressions arrived in the last 24h.

**Phase 3**
- `GET /api/v1/lookup` added to the popup tool (`apps/web`), guarded by a
  shared secret (`INTERNAL_LOOKUP_TOKEN`) — matches an LP's URL against that
  app's `campaign_targets` the same way its own delivery logic does.
- `lib/popup-link.ts` calls it (cached in `popup_link_cache`, 1h TTL) and the
  LP list / report screens show a 🅿️ icon linking into the popup tool's
  campaign edit / report screens when a match exists — no icon when it
  doesn't, or when the integration env vars aren't configured.
- The popup tool's report screen gained an (additive, backward-compatible)
  `?campaignId=` filter to make that report link actually scoped to one
  campaign (`apps/web/lib/reports.ts`, `apps/web/app/(admin)/reports/reports-panel.tsx`).

## Notable implementation choices

- **CV attribution window**: the daily optimization batch and the calendar
  reconstruction both look back a fixed 30 days / read the full
  `creative_status_events` history respectively — see the comments in
  `lib/optimize.ts` and `lib/calendar.ts` for the reasoning and trade-offs;
  these are reasonable v1 defaults, not something the user dictated exactly,
  and are easy to retune later.
- **`@popup/shared` reuse**: the delivery tag reuses its `pickCreative`
  (bundled directly via esbuild, `scripts/build-tag.mjs`); the popup tool's
  new lookup endpoint intentionally does *not* import `@popup/shared` at
  runtime — see `apps/web/lib/lookup-url-match.ts`'s comment for why
  (webpack can't resolve that package's ESM `.js`-suffixed relative imports
  outside of `import type`, and `transpilePackages` alone doesn't fix it).

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
