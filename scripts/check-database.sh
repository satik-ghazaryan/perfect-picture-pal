#!/usr/bin/env bash
# Applies every migration to an empty Postgres database, then runs the database tests.
# Uses the usual PGHOST / PGPORT / PGUSER / PGPASSWORD settings.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${CHECK_DB:-ari_gnank_check}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -q -X -d "$DB" -f "$1" >/dev/null; }
run supabase/tests/00_supabase_stub.sql
for file in supabase/migrations/*.sql; do
  echo "migration: $(basename "$file")"
  run "$file"
done
# The latest migrations must also be safe to run a second time.
for file in $(ls supabase/migrations/*.sql | tail -3); do
  run "$file"
done
for file in supabase/tests/[1-9]*.sql; do
  echo "test: $(basename "$file")"
  run "$file"
done
echo "database checks passed"
