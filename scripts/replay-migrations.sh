#!/usr/bin/env bash
# replay-migrations.sh
#
# Replays every file in supabase/migrations, in order, on an empty Supabase
# Postgres (the supabase/postgres image at production's version), and fails on
# the first error. This is the `migration-replay` check
# (.github/workflows/migration-replay.yml); it also runs locally wherever
# Docker runs (Linux / macOS / WSL — not Windows cmd).
#
# Usage:  bash scripts/replay-migrations.sh [--snapshot FILE] [--keep]
#   --snapshot FILE  after a clean replay, write scripts/schema-snapshot.sql's
#                    JSON to FILE (for scripts/compare-schema.mjs)
#   --keep           leave the container running (for inspection)
# Env:    SUPABASE_PG_IMAGE  image to use (default below = production's version)
#
# Exit:   0 = every migration applied
#         1 = a migration failed (the file and the error are printed)
#         2 = couldn't run (no Docker, image pull failed, database never came up)
#
# Each file runs as role postgres (not a superuser on Supabase, as in
# production) with ON_ERROR_STOP and --single-transaction, the way Supabase
# applies a migration file: inside one transaction.

set -uo pipefail

# Production's image version: from `supabase link`'s supabase/.temp/postgres-version
# (Adam's machine). Update it when Supabase upgrades the project.
IMAGE="${SUPABASE_PG_IMAGE:-supabase/postgres:17.6.1.155}"
MIGRATIONS_DIR="supabase/migrations"
SNAPSHOT_SQL="scripts/schema-snapshot.sql"

snapshot=""
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) snapshot="${2:-}"; shift 2 ;;
    --keep) keep=1; shift ;;
    *) echo "replay-migrations: unknown argument $1" >&2; exit 2 ;;
  esac
done
if [ -n "$snapshot" ] && [ ! -f "$SNAPSHOT_SQL" ]; then
  echo "replay-migrations: $SNAPSHOT_SQL not found." >&2; exit 2
fi

# A missing folder or an empty one would look like a clean replay. Refuse instead.
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "replay-migrations: no $MIGRATIONS_DIR folder here (run from the repo root)." >&2; exit 2
fi
mapfile -t files < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort)
if [ "${#files[@]}" -eq 0 ]; then
  echo "replay-migrations: no .sql files in $MIGRATIONS_DIR." >&2; exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "replay-migrations: Docker isn't running." >&2; exit 2
fi

name="migration-replay-$$"
cleanup() { if [ "$keep" -eq 0 ]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

echo "replay-migrations: image $IMAGE"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker pull --quiet "$IMAGE" >/dev/null || { echo "replay-migrations: couldn't pull $IMAGE." >&2; exit 2; }
fi
docker run -d --name "$name" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null \
  || { echo "replay-migrations: couldn't start the container." >&2; exit 2; }

# psql inside the container, over TCP as postgres (password auth, like the platform).
psql_c() { docker exec -i -e PGPASSWORD=postgres "$name" psql -h 127.0.0.1 -U postgres -d postgres -X "$@"; }

# The image restarts Postgres once after its init scripts; wait until auth.uid()
# exists and the server answers three times in a row, two seconds apart.
ready=0
for _ in $(seq 1 90); do
  if psql_c -tAc "select to_regprocedure('auth.uid()') is not null" 2>/dev/null | grep -qx t; then
    ready=$((ready + 1)); [ "$ready" -ge 3 ] && break
  else
    ready=0
  fi
  sleep 2
done
if [ "$ready" -lt 3 ]; then
  echo "replay-migrations: the database never came up." >&2
  docker logs --tail 30 "$name" >&2 || true
  exit 2
fi
echo "replay-migrations: $(psql_c -tAc 'select version()')"

applied=0
for f in "${files[@]}"; do
  if out=$(psql_c -q -v ON_ERROR_STOP=1 --single-transaction -f - < "$MIGRATIONS_DIR/$f" 2>&1); then
    applied=$((applied + 1))
    echo "  ok    $f"
  else
    echo "  FAIL  $f"
    echo "$out" | sed 's/^/        /'
    echo "replay-migrations: FAILED at $f ($applied of ${#files[@]} applied before it)." >&2
    exit 1
  fi
done

tables=$(psql_c -tAc "select count(*) from pg_tables where schemaname = 'public'")
echo "replay-migrations: OK — ${#files[@]} of ${#files[@]} migrations applied; public now has $tables tables."

if [ -n "$snapshot" ]; then
  if ! psql_c -tA -v ON_ERROR_STOP=1 -f - < "$SNAPSHOT_SQL" > "$snapshot"; then
    echo "replay-migrations: snapshot query failed." >&2; exit 2
  fi
  echo "replay-migrations: snapshot written to $snapshot"
fi
if [ "$keep" -eq 1 ]; then echo "replay-migrations: container $name left running (--keep)."; fi
exit 0
