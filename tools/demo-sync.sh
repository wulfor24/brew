#!/usr/bin/env bash
# Copy built brands from the prototype (gs://brew-prototype) to the demo site's bucket (gs://brew-prototype-demo).
# Only the public pack travels: never private/ (a real team's accounts, members, vault), memory/ (team memory),
# spend/, notify.json (emails) or demo/ (sessions). Moves flagged by a real team's connected accounts are cleared.
# Usage: tools/demo-sync.sh arata-in …   (then redeploy or open the brand: packs are cached per instance)
set -euo pipefail
SRC=gs://brew-prototype/brands DST=gs://brew-prototype-demo/brands
for slug in "$@"; do
  echo "== $slug"
  gcloud storage rsync -r "$SRC/$slug" "$DST/$slug" --delete-unmatched-destination-objects \
    --exclude='.*/(private|memory|spend|demo)/.*|.*/notify\.json$|.*/connected-ledger\.json$' --quiet
  # belt and braces: whatever the exclude missed is deleted before anything serves it
  for d in private memory spend demo; do gcloud storage rm -r "$DST/$slug/$d/**" --quiet 2>/dev/null || true; done
  for f in notify.json connected-ledger.json; do gcloud storage rm "$DST/$slug/$f" --quiet 2>/dev/null || true; done
  [ "$(gcloud storage ls "$DST/$slug/**" 2>/dev/null | grep -cE "/(private|memory)/")" = 0 ] || { echo "private files still in $DST/$slug"; exit 1; }
  # a real team's connected accounts flag moves privately; the demo starts without those flags
  if gcloud storage cat "$DST/$slug/updates.json" >${TMPDIR:-/tmp}/demo-upd.$$ 2>/dev/null; then
    python3 - ${TMPDIR:-/tmp}/demo-upd.$$ <<'EOF'
import json, sys
p = sys.argv[1]; u = json.load(open(p))
u['stale'] = {k: v for k, v in (u.get('stale') or {}).items() if not v.get('private') and not v.get('live')}
u['connected'] = {}; u['auto'] = False
json.dump(u, open(p, 'w'))
EOF
    gcloud storage cp ${TMPDIR:-/tmp}/demo-upd.$$ "$DST/$slug/updates.json" --quiet; rm -f ${TMPDIR:-/tmp}/demo-upd.$$
  fi
  # generated images the pack points at (drafts, statics, studio) live in the bucket's shared gen/ folder: copy the missing ones
  SRCB="${SRC%/brands}"; DSTB="${DST%/brands}"
  for g in $(gcloud storage cat "$SRC/$slug/**.json" 2>/dev/null | grep -oE 'gen/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|mp4|wav|zip)' | sort -u); do
    gcloud storage cp -n "$SRCB/$g" "$DSTB/$g" --quiet 2>/dev/null || true
  done
done
