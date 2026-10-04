#!/usr/bin/env bash
# check-embeds-local.sh — the pre-merge half of check-embeds.mjs.
#
# Replays every migration on a real supabase/postgres (scripts/replay-migrations.sh
# --keep), starts PostgREST against it, and resolves every app embed with
# limit=0. Catches a migration that makes an existing embed ambiguous (027's
# second v2_mesocycles → v2_programs FK) before it reaches production.
#
# Usage:  bash scripts/check-embeds-local.sh
# Needs:  Docker (start dockerd first in this container). Pulls postgrest/postgrest.
# Exit:   0 every embed resolves; 1 some don't; 2 couldn't run.
set -uo pipefail

POSTGREST_IMAGE="${POSTGREST_IMAGE:-postgrest/postgrest:v12.2.3}"
out=$(bash scripts/replay-migrations.sh --keep 2>&1) || { echo "$out" | tail -5; echo "check-embeds-local: replay failed." >&2; exit 2; }
db=$(echo "$out" | sed -n 's/.*container \(migration-replay-[0-9]*\) left running.*/\1/p')
[ -n "$db" ] || { echo "check-embeds-local: couldn't find the replay container." >&2; exit 2; }
api="check-embeds-postgrest-$$"
cleanup() { docker rm -f "$api" "$db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$db")
docker run -d --name "$api" \
  -e PGRST_DB_URI="postgres://postgres:postgres@$ip:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  "$POSTGREST_IMAGE" >/dev/null || { echo "check-embeds-local: couldn't start PostgREST." >&2; exit 2; }
apiip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$api")
for _ in $(seq 1 30); do curl -sf "http://$apiip:3000/" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://$apiip:3000/" >/dev/null 2>&1 || { docker logs "$api" 2>&1 | tail -5; echo "check-embeds-local: PostgREST didn't come up." >&2; exit 2; }
node scripts/check-embeds.mjs --local "http://$apiip:3000"
