#!/usr/bin/env bash
# Start brands over from nothing on brew.joinsquareup.com, to test the flow from the first read.
#   tools/reset-brand.sh everaw-in [arata-in ...]
# 1. stop: control/live.json gets a "stop" that hides these brands (retire.js). Every running instance exits within ~15s;
#    Cloud Run starts a fresh one that never reads, writes or builds them.
# 2. wipe: the brand folder (brands/<slug>/) and every workspace on it (tenants/*.json with that brandId) are deleted.
#    A copy goes to _deleted/<time>/ unless NO_ARCHIVE=1.
# 3. check for a minute that nothing came back, then stop once more with nothing hidden (fresh disk) and sweep. Paste the address on the landing to read it again.
# Instances running code from before retire.js ignore the stop; they only end when Cloud Run reaps them.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <slug> [<slug> ...]"; exit 1; }
SVC=shopos-feed; REGION=asia-south1; B=gs://brew-prototype; URL=https://brew.joinsquareup.com
ARCH=$B/_deleted/$(date -u +%Y%m%dT%H%M%SZ); TMP=$(mktemp -d)
LIVE=$(gcloud run services describe $SVC --region=$REGION --format='value(status.latestReadyRevisionName)')
N=$(echo "$LIVE" | sed -E 's/.*-0*([0-9]+)-[a-z0-9]+$/\1/')
# never the hidden fallback pack (brand-pack.js ARATA = brew-sample): hiding it leaves the server with no default brand
WIPE=$(python3 -c 'import json,sys; print(json.dumps([s for s in sys.argv[1:] if s != "brew-sample"]))' "$@")
put_marker() { echo "$1" > "$TMP/live.json"; gcloud storage cp "$TMP/live.json" $B/control/live.json -q --cache-control=no-store; }
now() { python3 -c 'import time; print(int(time.time()*1000))'; }

echo "1/3 stop every instance of $LIVE and hide: $*"
put_marker "{\"rev\":\"stop\",\"n\":$N,\"at\":$(now),\"wipe\":$WIPE}"
sleep 25; curl -s -o /dev/null "$URL/api/config" || true   # wakes a fresh instance, which claims and keeps the hide
sleep 5

sweep() { # prints how many files it removed
  local c=0
  for s in "$@"; do
    if gcloud storage ls "$B/brands/$s/" >/dev/null 2>&1; then
      c=$((c + $(gcloud storage ls -r "$B/brands/$s/" | grep -c '[^:/]$' || true)))
      [ "${NO_ARCHIVE:-}" = 1 ] || gcloud storage cp -r "$B/brands/$s" "$ARCH/brands/" -q
      gcloud storage rm -r "$B/brands/$s" -q
    fi
  done
  rm -rf "$TMP/t" && mkdir -p "$TMP/t"; gcloud storage cp "$B/tenants/*.json" "$TMP/t/" -q 2>/dev/null || true
  for id in $(python3 - "$TMP/t" "$@" <<'PY'
import json, os, sys
d, slugs = sys.argv[1], set(sys.argv[2:])
for f in sorted(os.listdir(d)):
    try:
        if json.load(open(os.path.join(d, f))).get('brandId') in slugs: print(f)
    except Exception: pass
PY
  ); do
    [ "${NO_ARCHIVE:-}" = 1 ] || gcloud storage cp "$B/tenants/$id" "$ARCH/tenants/$id" -q
    gcloud storage rm "$B/tenants/$id" -q; c=$((c + 1))
  done
  echo $c
}
echo "2/3 wipe"; echo "   removed $(sweep "$@") files and workspaces"
for i in 1 2 3; do
  sleep 20; k=$(sweep "$@")
  [ "$k" = 0 ] && { echo "   nothing came back ($i)"; continue; }
  echo "   $k came back and were removed (an instance from before retire.js is still running)"
done

echo "3/3 restart clean and lift the hide"
# one more stop with nothing hidden: the live instance may have cached files an old instance rewrote mid-wipe on its own disk;
# a fresh instance starts with an empty disk and an empty bucket for these brands
LIVE=$(gcloud run services describe $SVC --region=$REGION --format='value(status.latestReadyRevisionName)')
N=$(echo "$LIVE" | sed -E 's/.*-0*([0-9]+)-[a-z0-9]+$/\1/')
put_marker "{\"rev\":\"stop\",\"n\":$N,\"at\":$(now),\"wipe\":[]}"
sleep 25; k=$(sweep "$@"); [ "$k" = 0 ] || echo "   $k more removed"
curl -s -o /dev/null "$URL/api/config" || true
[ "${NO_ARCHIVE:-}" = 1 ] && echo "done. deleted for good." || echo "done. a copy is in $ARCH/"
echo "open $URL, paste the address and the read starts from the beginning (clear the site's storage in that browser, or use a private window)."
