#!/usr/bin/env bash
# One-time local dev bootstrap for the LP creative A/B test tool's DB.
# Separate from db/setup-local.sh (the popup tool's) — this app uses its own
# database (docs/lp-ab-test/00-requirements.md 9). No RLS role split needed
# here (single internal org — see docs/lp-ab-test/01-data-model.md), so this
# is simpler than the popup tool's script: one owner role, one database.
set -euo pipefail

PSQL_SUPERUSER=${PSQL_SUPERUSER:-"sudo -u postgres psql"}
DB_NAME=${DB_NAME:-lp_ab_test_dev}

$PSQL_SUPERUSER -c "CREATE USER lp_ab_test WITH PASSWORD 'lp_ab_test' CREATEDB;" || true
$PSQL_SUPERUSER -c "CREATE DATABASE ${DB_NAME} OWNER lp_ab_test;" || true

echo "Run migrations with:"
echo "  DATABASE_URL=postgresql://lp_ab_test:lp_ab_test@localhost:5432/${DB_NAME} node db/lp-ab-test/migrate.mjs"
echo "Then seed the first admin invite with:"
echo "  DATABASE_URL=postgresql://lp_ab_test:lp_ab_test@localhost:5432/${DB_NAME} SEED_ADMIN_EMAIL=you@primedirect.jp node db/lp-ab-test/seed.mjs"
