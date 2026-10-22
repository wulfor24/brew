#!/usr/bin/env bash
# Copy built brands from the prototype (gs://brew-prototype) to the demo site's bucket (gs://brew-prototype-demo).
# Only the public pack travels: never private/ (a real team's accounts, members, vault), memory/ (team memory),
# spend/, notify.json (emails) or demo/ (sessions). The shared files that can still carry the team's work are filtered by
# tools/demo-strip.mjs (updates.json run state and reasons, pages and plain words of the team's cards), and a canary of the
# team's real numbers and campaign names must not appear anywhere in the demo copy, or the sync stops.
# Usage: tools/demo-sync.sh arata-in …   (then redeploy or open the brand: packs are cached per instance)
set -euo pipefail
SRC=gs://brew-prototype/brands DST=gs://brew-prototype-demo/brands
HERE="$(cd "$(dirname "$0")" && pwd)"
for slug in "$@"; do
  echo "== $slug"
  gcloud storage rsync -r "$SRC/$slug" "$DST/$slug" --delete-unmatched-destination-objects \
    --exclude='.*/(private|memory|spend|demo)/.*|.*/notify\.json$|.*/connected-ledger\.json$' --quiet
  # belt and braces: whatever the exclude missed is deleted before anything serves it
  for d in private memory spend demo; do gcloud storage rm -r "$DST/$slug/$d/**" --quiet 2>/dev/null || true; done
  for f in notify.json connected-ledger.json; do gcloud storage rm "$DST/$slug/$f" --quiet 2>/dev/null || true; done
  [ "$(gcloud storage ls "$DST/$slug/**" 2>/dev/null | grep -cE "/(private|memory)/")" = 0 ] || { echo "private files still in $DST/$slug"; exit 1; }
  # the shared files that can carry the team's work: filtered from the source's own copy, then written over the demo's
  W="$(mktemp -d "${TMPDIR:-/tmp}/demo-strip.XXXXXX")"; mkdir -p "$W/private-live"
  for f in updates.json pages.json plain.json seed.json; do gcloud storage cp "$SRC/$slug/$f" "$W/$f" --quiet 2>/dev/null || true; done
  gcloud storage cp "$SRC/$slug/private/cards.json" "$W/private-cards.json" --quiet 2>/dev/null || true
  gcloud storage cp "$SRC/$slug/private/connected-ledger.json" "$W/private-ledger.json" --quiet 2>/dev/null || true
  gcloud storage cp "$SRC/$slug/private/live/*.json" "$W/private-live/" --quiet 2>/dev/null || true
  node "$HERE/demo-strip.mjs" "$W"
  for f in updates.json pages.json plain.json; do [ -f "$W/$f" ] && gcloud storage cp "$W/$f" "$DST/$slug/$f" --quiet; done
  # generated images the public pack points at (drafts, statics, studio) live in the bucket's shared gen/ folder: copy the
  # missing ones. Only public JSON is scanned: an image made in a team-only jam never reaches the demo bucket
  SRCB="${SRC%/brands}"; DSTB="${DST%/brands}"
  gcloud storage rsync -r "$SRC/$slug" "$W/src" --exclude='.*/?(private|memory|spend|demo)/.*|.*\.(png|jpg|jpeg|webp|gif|svg|mp4|wav|pdf|zip)$' --quiet 2>/dev/null || true
  find "$W/src" -name '*.json' -exec cat {} + 2>/dev/null \
    | grep -oE 'gen/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|mp4|wav|zip)' | sort -u > "$W/gen.txt" || true
  while read -r g; do [ -n "$g" ] && { gcloud storage cp -n "$SRCB/$g" "$DSTB/$g" --quiet 2>/dev/null || true; }; done < "$W/gen.txt"
  # the canary: none of the team's real numbers or campaign names may be in the demo copy
  if [ -s "$W/canary.txt" ]; then
    # scraped pages (raw/) are other sites' own words (a rival's ₹780 price is not ours): every other JSON is checked
    gcloud storage rsync -r "$DST/$slug" "$W/demo" --exclude='^raw/.*|.*\.(png|jpg|jpeg|webp|gif|svg|mp4|wav|pdf|zip)$' --quiet 2>/dev/null || true
    find "$W/demo" -name '*.json' -exec cat {} + > "$W/demo-all.json" 2>/dev/null || true
    if grep -F -f "$W/canary.txt" "$W/demo-all.json" > "$W/hits.txt"; then
      echo "the team's numbers are in the demo copy of $slug:"; grep -o -F -f "$W/canary.txt" "$W/demo-all.json" | sort | uniq -c | head -20; exit 1; fi
    echo "canary clean ($(wc -l < "$W/canary.txt" | tr -d ' ') values checked)"
  fi
  rm -rf "$W"
done
