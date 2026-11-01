#!/usr/bin/env bash
# Build the prototype, inline it into one page, and run the browser check over every DEMO state. Publish only on a clean run.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && npx vite build >/dev/null 2>&1
OUT="${PROTOTYPE_OUT:-$PWD/overload-1.2.1-prototype.html}"
node inline.mjs dist "$OUT" >/dev/null
{ printf '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'; cat "$OUT"; echo '</body></html>'; } > check/page.html
rm -rf check/shots
timeout 400 node check/clipping.mjs "$PWD/check/page.html" check/shots
