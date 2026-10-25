#!/usr/bin/env bash
# Promote what runs on staging to production (feed.joinsquareup.com). Nothing is built here: the exact image staging runs
# goes to production, after it was tested there.
#   tools/promote.sh            (or tools/promote.sh <image@sha256:...>)
# 1 the image is staging's, built from origin/main   2 an on-demand database backup   3 migrations (a Cloud Run Job)
# 4 the worker   5 the web service behind a no-traffic tag   6 smoke test + the clean gate on that tag   7 traffic 100%
# Rollback: gcloud run services update-traffic brew-web --to-revisions=<previous>=100 (migrations are additive).
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/prod-env.sh
STAGING=shopos-feed
IMG=${1:-$(gcloud run services describe $STAGING --region=$REGION --project=$P --format='value(spec.template.spec.containers[0].image)')}
SHA=$(gcloud run services describe $STAGING --region=$REGION --project=$P --format='value(metadata.labels.git-sha)')
git fetch -q origin
MAIN=$(git rev-parse --short origin/main)
echo "image $IMG (staging git-sha $SHA, origin/main $MAIN)"
if [ -z "${1:-}" ] && ! git merge-base --is-ancestor "$SHA" origin/main; then echo "staging runs $SHA, which is not on origin/main: deploy staging from main first"; exit 1; fi
case "$IMG" in *@sha256:*) ;; *) DIG=$(gcloud artifacts docker images describe "$IMG" --format='value(image_summary.digest)' 2>/dev/null || true); [ -n "$DIG" ] && IMG="${IMG%%:*}@$DIG";; esac

echo "1/7 backup"
for i in $(seq 1 20); do if gcloud sql backups create --instance=brew-prod --project=$P --description="before promote $SHA" --async >/dev/null 2>&1; then echo "   on-demand backup started"; break; fi
  [ $i = 20 ] && { echo "   no backup could be started (the database stayed busy): stopping"; exit 1; }; sleep 30; done

echo "2/7 migrations"
gcloud run jobs deploy brew-prod-migrate --image="$IMG" --project=$P --region=$REGION --service-account=$SA $NET --command=node --args=db/migrate.js \
  --set-env-vars="STORAGE=pg" --set-secrets="DATABASE_URL=BREW_PROD_DATABASE_URL:latest" --max-retries=0 --task-timeout=900 --quiet >/dev/null
gcloud run jobs execute brew-prod-migrate --project=$P --region=$REGION --wait >/dev/null && echo "   up to date"

echo "3/7 worker"
gcloud run deploy brew-worker --image="$IMG" --project=$P --region=$REGION --service-account=$SA $NET --ingress=internal --no-allow-unauthenticated \
  --memory=4Gi --cpu=2 --no-cpu-throttling --min-instances=1 --max-instances=1 --timeout=3600 --concurrency=80 \
  --set-env-vars="$PROD_ENV|ROLE=worker|PG_POOL_MAX=10" --set-secrets="$PROD_SECRETS" --labels=git-sha=$SHA --quiet >/dev/null && echo "   worker on $SHA"

echo "4/7 web (no traffic yet)"
# the very first deploy creates the service (Cloud Run allows no "no traffic" then; nobody uses it before DNS points at it)
NOTRAFFIC=$(gcloud run services describe brew-web --region=$REGION --project=$P --format="value(metadata.name)" >/dev/null 2>&1 && echo --no-traffic || true)
gcloud run deploy brew-web --image="$IMG" --project=$P --region=$REGION --service-account=$SA $NET --allow-unauthenticated \
  --memory=2Gi --cpu=2 --no-cpu-throttling --min-instances=2 --max-instances=10 --timeout=3600 --concurrency=80 --session-affinity \
  --startup-probe=httpGet.path=/healthz/ready,periodSeconds=3,failureThreshold=40,timeoutSeconds=3 \
  --set-env-vars="$PROD_ENV|ROLE=web|PG_POOL_MAX=5" --set-secrets="$PROD_SECRETS" --labels=git-sha=$SHA $NOTRAFFIC --tag=candidate --quiet >/dev/null
TAG=$(gcloud run services describe brew-web --region=$REGION --project=$P --format=json | python3 -c "import json,sys; d=json.load(sys.stdin); print([t['url'] for t in d['status'].get('traffic',[]) if t.get('tag')=='candidate'][0])")
echo "   candidate $TAG"

echo "5/7 smoke test"
fail=0
for u in / /healthz/ready /api/config /privacy; do c=$(curl -s -o /dev/null -w '%{http_code}' "$TAG$u"); echo "   $u -> $c"; [ "$c" = 200 ] || fail=1; done
for s in ${SMOKE_BRANDS:-}; do c=$(curl -s -o /dev/null -w '%{http_code}' "$TAG/$s"); echo "   /$s -> $c"; [ "$c" = 200 ] || fail=1; done
[ $fail = 0 ] || { echo "smoke test failed: production traffic is unchanged"; exit 1; }

echo "6/7 clean gate"
gcloud run jobs deploy brew-prod-clean --image="$IMG" --project=$P --region=$REGION --service-account=$SA $NET --command=node --args=db/prod-clean.mjs \
  --set-env-vars="^|^STORAGE=pg|PROD_SERVICES=brew-web,brew-worker|GOOGLE_CLOUD_PROJECT=$P|REGION=$REGION" --set-secrets="DATABASE_URL=BREW_PROD_DATABASE_URL:latest" --max-retries=0 --task-timeout=600 --quiet >/dev/null
if ! gcloud run jobs execute brew-prod-clean --project=$P --region=$REGION --wait >/dev/null 2>&1; then
  gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="brew-prod-clean" AND textPayload:"[clean]"' --project=$P --limit=30 --freshness=10m --format='value(textPayload)' | tac
  echo "the clean gate refused: production traffic is unchanged"; exit 1; fi
echo "   clean"

echo "7/7 traffic"
gcloud run services update-traffic brew-web --to-latest --region=$REGION --project=$P --quiet >/dev/null
echo "   production now runs $SHA"
for u in "$PROD_URL/" "$PROD_URL/api/config"; do echo "   $u -> $(curl -s -o /dev/null -w '%{http_code}' "$u")"; done
