#!/usr/bin/env bash
#
# Build this ESM and deploy it into a local OpenMRS Standalone's bundled frontend,
# so the running standalone SPA serves your local code (e.g. to test the citation
# grounding badges) without a dev server.
#
# Usage:
#   OPENMRS_STANDALONE=/path/to/referenceapplication-standalone-X.Y.Z tools/deploy-to-standalone.sh
#   tools/deploy-to-standalone.sh /path/to/referenceapplication-standalone-X.Y.Z
#   yarn deploy:standalone /path/to/...                       # via the package.json alias
#
# The standalone serves static assets directly from appdata/frontend, so no restart
# is needed — but your browser caches the old bundle, so HARD-REFRESH (Cmd/Ctrl-Shift-R)
# or use an incognito window after running this.
set -euo pipefail

APP="openmrs-esm-chartsearchai-app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SA="${1:-${OPENMRS_STANDALONE:-}}"
if [ -z "$SA" ]; then
  echo "ERROR: standalone path not given." >&2
  echo "  Pass it as an argument or set OPENMRS_STANDALONE, e.g.:" >&2
  echo "    OPENMRS_STANDALONE=/path/to/referenceapplication-standalone-3.7.0-SNAPSHOT yarn deploy:standalone" >&2
  exit 1
fi

TARGET="$SA/appdata/frontend/$APP"
if [ ! -d "$TARGET" ]; then
  echo "ERROR: $TARGET does not exist." >&2
  echo "  Is OPENMRS_STANDALONE correct, and is the chartsearchai frontend bundled in this standalone?" >&2
  exit 1
fi

echo "==> Building ESM (rspack production)…"
( cd "$REPO_ROOT" && yarn build )

if [ ! -f "$REPO_ROOT/dist/$APP.js" ]; then
  echo "ERROR: build did not produce dist/$APP.js" >&2
  exit 1
fi

echo "==> Swapping bundle into $TARGET"
# The importmap entry filename is stable ($APP.js), so replacing the whole dir
# (entry + numbered chunks) is enough — no importmap edit required.
rm -rf "${TARGET:?}"/*
cp -R "$REPO_ROOT/dist/"* "$TARGET/"

echo "==> Deployed $(wc -c < "$TARGET/$APP.js" | tr -d ' ') bytes to $APP.js"

# Optional: if the standalone is up, confirm the served bundle matches what we just wrote.
SPA_URL="${OPENMRS_SPA_URL:-http://localhost:8081/openmrs/spa}"
SERVED="$(curl -s -m 10 -o /dev/null -w '%{size_download}' "$SPA_URL/$APP/$APP.js" 2>/dev/null || echo "")"
LOCAL="$(wc -c < "$TARGET/$APP.js" | tr -d ' ')"
if [ -n "$SERVED" ] && [ "$SERVED" != "0" ]; then
  if [ "$SERVED" = "$LOCAL" ]; then
    echo "==> Verified: $SPA_URL is serving the new bundle ($SERVED bytes)."
  else
    echo "==> NOTE: served bundle is $SERVED bytes, local is $LOCAL — hard-refresh the browser to pick it up."
  fi
fi

echo ""
echo "Done. Open $SPA_URL and HARD-REFRESH (Cmd/Ctrl-Shift-R) or use an incognito window."
