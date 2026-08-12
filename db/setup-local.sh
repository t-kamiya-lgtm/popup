#!/usr/bin/env bash
# One-time local dev bootstrap. Requires a running Postgres reachable as a
# superuser (either `docker compose up -d postgres`, using its default
# superuser `popup`, or a native install reachable via `sudo -u postgres`).
#
# Creates: the app role (RLS-restricted, used by the Next.js app) and the
# service role (BYPASSRLS, used only by db/seed.mjs and the stats/order-sync
# crons — never by request-serving code). See docs/10-multitenancy.md 2.
set -euo pipefail

PSQL_SUPERUSER=${PSQL_SUPERUSER:-"sudo -u postgres psql"}
DB_NAME=${DB_NAME:-popup_dev}

$PSQL_SUPERUSER -c "CREATE USER popup WITH PASSWORD 'popup' CREATEDB;" || true
$PSQL_SUPERUSER -c "CREATE DATABASE ${DB_NAME} OWNER popup;" || true
$PSQL_SUPERUSER -d "${DB_NAME}" -c "CREATE ROLE popup_service BYPASSRLS LOGIN PASSWORD 'popup_service_dev';" || true

echo "Run migrations with:"
echo "  DATABASE_URL=postgresql://popup:popup@localhost:5432/${DB_NAME} node db/migrate.mjs"
echo "Then grant the service role access and seed with:"
echo "  ${PSQL_SUPERUSER} -d ${DB_NAME} -c \"GRANT ALL ON ALL TABLES IN SCHEMA public TO popup_service;\""
echo "  ${PSQL_SUPERUSER} -d ${DB_NAME} -c \"GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO popup_service;\""
echo "  DATABASE_URL=postgresql://popup_service:popup_service_dev@localhost:5432/${DB_NAME} node db/seed.mjs"
