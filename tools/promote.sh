#!/usr/bin/env bash
# Promote what runs on staging to production (feed.joinsquareup.com). Nothing is built here: the exact image staging runs
# goes to production, after it was tested there. Every step fails closed: anything that doesn't go through stops the
# promotion, and once anything on production changed, it is put back as it was.
#   tools/promote.sh            (or tools/promote.sh <image@sha256:...>)
# 1 the image is staging's live one, built from origin/main   2 a database backup, finished   3 migrations (a Cloud Run Job)
# 4 the web service behind a no-traffic tag   5 smoke test + clean gate from inside the VPC (the services take no outside
# traffic but the load balancer's)   6 the worker   7 traffic to that exact revision (never "latest")   8 checks through the
# load balancer, rolled back if they fail
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/prod-env.sh
STAGING=shopos-feed
die() { echo "STOP: $*"; exit 1; }

STAGE_REV=$(gcloud run services describe $STAGING --region=$REGION --project=$P --format='value(status.latestReadyRevisionName)')
IMG=${1:-$(gcloud run revisions describe "$STAGE_REV" --region=$REGION --project=$P --format='value(spec.containers[0].image)')}
SHA=$(gcloud run revisions describe "$STAGE_REV" --region=$REGION --project=$P --format='value(metadata.labels.git-sha)')
[ -n "$IMG" ] && [ -n "$SHA" ] || die "could not read staging's live revision"
git fetch -q origin
if [ -z "${1:-}" ] && ! git merge-base --is-ancestor "$SHA" origin/main; then die "staging runs $SHA, which is not on origin/main: deploy staging from main first"; fi
case "$IMG" in *@sha256:*) ;; *) die "image $IMG is not pinned to a digest";; esac
echo "image $IMG (staging $STAGE_REV, git-sha $SHA)"

# what production runs now, to put back if anything after this point fails
PREV_WEB=$(gcloud run services describe brew-web --region=$REGION --project=$P --format=json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); t=[x for x in d['status'].get('traffic',[]) if x.get('percent')]; print(t[0]['revisionName'] if t else '')" || true)
PREV_WORKER=$(gcloud run services describe brew-worker --region=$REGION --project=$P --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)
CHANGED_WORKER=0
rollback() { echo "rolling back"; [ -n "$PREV_WEB" ] && gcloud run services update-traffic brew-web --to-revisions="$PREV_WEB=100" --region=$REGION --project=$P --quiet >/dev/null && echo "   web back on $PREV_WEB"
  [ "$CHANGED_WORKER" = 1 ] && [ -n "$PREV_WORKER" ] && gcloud run services update-traffic brew-worker --to-revisions="$PREV_WORKER=100" --region=$REGION --project=$P --quiet >/dev/null && echo "   worker back on $PREV_WORKER"; }

echo "1/8 backup"
OP=""; for i in $(seq 1 20); do
  if OUT=$(gcloud sql backups create --instance=brew-prod --project=$P --description="before promote $SHA" --async 2>&1); then
    OP=$(gcloud sql operations list --instance=brew-prod --project=$P --filter="operationType=BACKUP_VOLUME" --limit=1 --sort-by=~startTime --format='value(name)'); break; fi
  echo "$OUT" | grep -q "another operation" || die "backup refused: $OUT"; sleep 30; done
[ -n "$OP" ] || die "the database stayed busy: no backup"
gcloud sql operations wait "$OP" --project=$P --timeout=1800 >/dev/null || die "the backup did not finish"
echo "   backup done"

echo "2/8 migrations"
gcloud run jobs deploy brew-prod-migrate --image="$IMG" --project=$P --region=$REGION --service-account=$PSA $NET --command=node --args=db/migrate.js \
  --set-env-vars="STORAGE=pg" --set-secrets="DATABASE_URL=BREW_PROD_DATABASE_URL:latest" --max-retries=0 --task-timeout=900 --quiet >/dev/null
gcloud run jobs execute brew-prod-migrate --project=$P --region=$REGION --wait >/dev/null || die "migrations failed (production unchanged; migrations are additive)"
echo "   up to date"

echo "3/8 web (no traffic yet)"
if gcloud run services describe brew-web --region=$REGION --project=$P --format='value(metadata.name)' >/dev/null 2>$TMPDIR/describe.err; then NOTRAFFIC=--no-traffic
elif grep -qi "could not be found\|NOT_FOUND" $TMPDIR/describe.err; then NOTRAFFIC=""; echo "   first deploy: creating brew-web"
else die "could not read brew-web: $(cat $TMPDIR/describe.err)"; fi
gcloud run deploy brew-web --image="$IMG" --project=$P --region=$REGION --service-account=$PSA $NET --ingress=internal-and-cloud-load-balancing --allow-unauthenticated \
  --memory=2Gi --cpu=2 --no-cpu-throttling --min-instances=2 --max-instances=10 --timeout=3600 --concurrency=80 --session-affinity \
  --startup-probe=httpGet.path=/healthz/ready,periodSeconds=3,failureThreshold=40,timeoutSeconds=3 \
  --set-env-vars="$PROD_ENV|ROLE=web|PG_POOL_MAX=5" --set-secrets="$PROD_SECRETS" --labels=git-sha=$SHA $NOTRAFFIC --tag=candidate --quiet >/dev/null || die "web deploy failed (traffic unchanged)"
REV=$(gcloud run services describe brew-web --region=$REGION --project=$P --format='value(status.latestCreatedRevisionName)')
READY=$(gcloud run revisions describe "$REV" --region=$REGION --project=$P --format='value(status.conditions[0].status)')
[ "$READY" = True ] || die "candidate $REV is not ready"
TAG=$(gcloud run services describe brew-web --region=$REGION --project=$P --format=json | python3 -c "import json,sys; d=json.load(sys.stdin); print([t['url'] for t in d['status'].get('traffic',[]) if t.get('tag')=='candidate'][0])")
echo "   candidate $REV at $TAG"

echo "4/8 smoke test and clean gate (from inside the VPC)"
gcloud run jobs deploy brew-prod-clean --image="$IMG" --project=$P --region=$REGION --service-account=$PSA --network=default --subnet=default --vpc-egress=all-traffic --command=node --args=db/prod-clean.mjs \
  --set-env-vars="^|^STORAGE=pg|PROD_SERVICES=brew-web|GOOGLE_CLOUD_PROJECT=$P|REGION=$REGION|SMOKE_URL=$TAG|EXPECT_IMAGE=$IMG|EXPECT_WEB_REV=$REV" --set-secrets="DATABASE_URL=BREW_PROD_DATABASE_URL:latest" --max-retries=0 --task-timeout=600 --quiet >/dev/null
if ! gcloud run jobs execute brew-prod-clean --project=$P --region=$REGION --wait >/dev/null 2>&1; then
  gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="brew-prod-clean" AND textPayload:"[clean]"' --project=$P --limit=40 --freshness=10m --format='value(textPayload)' | tac
  die "the smoke test or the clean gate refused: production traffic is unchanged"; fi
echo "   clean"

echo "5/8 worker"
CHANGED_WORKER=1
gcloud run deploy brew-worker --image="$IMG" --project=$P --region=$REGION --service-account=$PSA $NET --ingress=internal --no-allow-unauthenticated \
  --memory=4Gi --cpu=2 --no-cpu-throttling --min-instances=1 --max-instances=1 --timeout=3600 --concurrency=80 \
  --set-env-vars="$PROD_ENV|ROLE=worker|PG_POOL_MAX=10" --set-secrets="$PROD_SECRETS" --labels=git-sha=$SHA --quiet >/dev/null || { rollback; die "worker deploy failed"; }
echo "   worker on $SHA"
# the worker's own settings, now that the new one runs (before any user traffic moves)
gcloud run jobs execute brew-prod-clean --project=$P --region=$REGION "--update-env-vars=^|^PROD_SERVICES=brew-worker|SMOKE_URL=" --wait >/dev/null 2>&1 || {
  gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="brew-prod-clean" AND textPayload:"[clean]"' --project=$P --limit=20 --freshness=5m --format='value(textPayload)' | tac; rollback; die "the new worker's settings failed the gate"; }
echo "   worker settings clean"

echo "6/8 traffic to $REV"
gcloud run services update-traffic brew-web --to-revisions="$REV=100" --region=$REGION --project=$P --quiet >/dev/null || { rollback; die "traffic switch failed"; }

echo "7/8 checks through the load balancer"
ok=1; for u in / /healthz/ready /api/config /privacy ${SMOKE_BRANDS:-}; do case "$u" in /*) ;; *) u="/$u";; esac
  c=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$PROD_URL$u" || echo 000); echo "   $u -> $c"; [ "$c" = 200 ] || ok=0; done
[ $ok = 1 ] || { rollback; die "production checks failed after the switch: rolled back"; }
echo "8/8 production runs $SHA ($REV)"
