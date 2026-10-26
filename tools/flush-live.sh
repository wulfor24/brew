#!/usr/bin/env bash
# Start brew.joinsquareup.com over with no brands, to run the whole flow again from the first read (a model switch, a
# fresh client). It keeps the server's own state and leaves the demo site alone.
#   tools/flush-live.sh            # lists what would go, then asks
#   YES=1 tools/flush-live.sh      # no question
# What goes (a copy lands in gs://brew-prototype/_deleted/<time>/ unless NO_ARCHIVE=1):
#   brands/<slug>/ for every brand (reads, moves, PDFs, private/: members, jams, vault tokens, connected ledgers)
#   tenants/*.json (every workspace, so every browser starts at the landing again)
#   gen/ (pictures and videos made in jams), research-media/ (saved research photos and clips)
# What stays:
#   brands/_brew/ (the day's budget counters, alerts, the holiday calendar), _cache/ (treg and Apify results, paid once;
#   24-hour TTL, so a fresh read reuses only today's), control/live.json (which revision is live), backups/.
# How: every brand goes through tools/reset-brand.sh in one call (the live instance hides them, stops, and a fresh one
# never reads them), then gen/ and research-media/ are swept. Sign-in needs nothing stored: the first owner claims a
# brand again when its read is done. Connected accounts are gone with the vault: the team connects them again.
set -euo pipefail
# BUCKET ERA: this edits gs://brew-prototype files. Since 25 Oct 2026 staging and production keep their data in Postgres
# (STORAGE=pg), so these edits no longer reach what the site reads. It runs only with STORAGE=gcs (a revision back on the bucket).
if [ "${STORAGE:-pg}" = pg ]; then
  echo "$(basename "$0") is bucket-era: the sites keep their data in Postgres (STORAGE=pg) since 25 Oct 2026." >&2
  echo "Use the brew-ops job instead: db/reset-brand.mjs (one brand at a time) or db/delete-brand.mjs, e.g." >&2
  echo "  gcloud run jobs execute brew-ops --region=asia-south1 --args=db/reset-brand.mjs,--slug,<slug> --wait          (dry run)" >&2
  echo "  gcloud run jobs execute brew-ops --region=asia-south1 --args=db/reset-brand.mjs,--slug,<slug>,--rev-n,<n>,--yes --wait" >&2
  echo "See docs/production.md, 'Resetting and deleting a brand'. (STORAGE=gcs runs this script against the bucket.)" >&2
  exit 3
fi
cd "$(dirname "$0")/.."
B=gs://brew-prototype
SLUGS=$(gcloud storage ls "$B/brands/" | sed -E 's#.*/brands/([^/]+)/$#\1#' | grep -v '^_' | grep -v '^brew-sample$' || true)
[ -n "$SLUGS" ] || { echo "no brands in $B/brands/"; }
echo "brands to remove:"; for s in $SLUGS; do echo "  $s"; done
echo "workspaces: $(gcloud storage ls "$B/tenants/" 2>/dev/null | wc -l | tr -d ' ')   gen: $(gcloud storage du -s "$B/gen" 2>/dev/null | awk '{printf "%.0f MB", $1/1e6}')   research-media: $(gcloud storage du -s "$B/research-media" 2>/dev/null | awk '{printf "%.0f MB", $1/1e6}')"
[ "${NO_ARCHIVE:-}" = 1 ] && echo "NO_ARCHIVE=1: deleted for good" || echo "a copy goes to $B/_deleted/<time>/"
if [ "${YES:-}" != 1 ]; then read -r -p "flush the live site? type flush: " a; [ "$a" = flush ] || { echo "nothing done"; exit 1; }; fi

ARCH=$B/_deleted/$(date -u +%Y%m%dT%H%M%SZ)
# 1. brands and their workspaces, with the stop-and-hide dance that keeps the running instance from writing them back
[ -z "$SLUGS" ] || tools/reset-brand.sh $SLUGS
# 2. workspaces with no brand (the Brew default context): gone too, so every browser lands on the start page
for t in $(gcloud storage ls "$B/tenants/" 2>/dev/null || true); do
  [ "${NO_ARCHIVE:-}" = 1 ] || gcloud storage cp "$t" "$ARCH/tenants/" -q
  gcloud storage rm "$t" -q
done
# 3. made media and research media
for d in gen research-media; do
  if gcloud storage ls "$B/$d/" >/dev/null 2>&1; then
    [ "${NO_ARCHIVE:-}" = 1 ] || gcloud storage cp -r "$B/$d" "$ARCH/" -q
    gcloud storage rm -r "$B/$d" -q
    echo "removed $d/"
  fi
done
echo "left in the bucket:"; gcloud storage ls "$B/"
echo "done. Open https://brew.joinsquareup.com in a private window, sign in and paste the first address."
echo "To write the moves on Pro from this read on, deploy first with: GEMINI_DEEP_MODEL=gemini-3.1-pro-preview ./deploy.sh"
