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
for i in 1 2 3; do git fetch -q origin && break; [ $i = 3 ] && die "could not reach GitHub to check staging's commit (3 tries)"; sleep 5; done
if [ -z "${1:-}" ] && ! git merge-base --is-ancestor "$SHA" origin/main; then die "staging runs $SHA, which is not on origin/main: deploy staging from main first"; fi
case "$IMG" in *@sha256:*) ;; *) die "image $IMG is not pinned to a digest";; esac
echo "image $IMG (staging $STAGE_REV, git-sha $SHA)"

# one promotion at a time: a lock object only one run can create (two at once read each other's revisions and could roll back the
# other's release). A lock older than 2 hours is a run that died, and is taken over
LOCK=gs://brew-prod-backups/locks/promote.lock
echo "$(git config user.email 2>/dev/null || whoami) $(date -u +%Y-%m-%dT%H:%M:%SZ) $SHA" > "$TMPDIR/promote.lock"
if ! gcloud storage cp --if-generation-match=0 "$TMPDIR/promote.lock" "$LOCK" --project=$P >/dev/null 2>&1; then
  HELD=$(gcloud storage cat "$LOCK" --project=$P 2>/dev/null || echo "unknown")
  AGE=$(gcloud storage objects describe "$LOCK" --project=$P --format='value(creation_time)' 2>/dev/null | python3 -c "import sys,re,datetime; t=re.sub(r'([+-]\\d\\d):?(\\d\\d)$', r'\\1\\2', sys.stdin.read().strip().replace('Z','+0000')); t=re.sub(r'\\.\\d+', '', t); print(int((datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.strptime(t, '%Y-%m-%dT%H:%M:%S%z')).total_seconds()) if t else 0)" || echo 0)
  [ "${AGE:-0}" -gt 7200 ] || die "another promotion is running ($HELD); wait for it (if none is: gcloud storage rm $LOCK)"
  echo "   taking over a lock left by a run that died ($HELD)"; gcloud storage rm "$LOCK" --project=$P >/dev/null 2>&1 || true
  gcloud storage cp --if-generation-match=0 "$TMPDIR/promote.lock" "$LOCK" --project=$P >/dev/null 2>&1 || die "another promotion took the lock"
fi
trap 'gcloud storage rm "$LOCK" --project=$P >/dev/null 2>&1 || true' EXIT

# what production runs now, to put back if anything after this point fails
PREV_WEB=$(gcloud run services describe brew-web --region=$REGION --project=$P --format=json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); t=[x for x in d['status'].get('traffic',[]) if x.get('percent')]; print(t[0]['revisionName'] if len(t)==1 else ('SPLIT' if t else ''))" || true)
# a service that exists must say what it serves, or there is nothing to roll back to: stop before anything changes
if gcloud run services describe brew-web --region=$REGION --project=$P --format='value(metadata.name)' >/dev/null 2>&1; then
  [ -n "$PREV_WEB" ] || die "could not read which revision brew-web serves now (nothing to roll back to)"
  [ "$PREV_WEB" != SPLIT ] || die "brew-web splits its traffic between revisions; put it on one revision first"
fi
# the worker revision that serves now (its traffic), not the newest one: after a rollback those differ, and the newest is the bad one
PREV_WORKER=$(gcloud run services describe brew-worker --region=$REGION --project=$P --format=json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); t=[x for x in d['status'].get('traffic',[]) if x.get('percent')]; print(t[0]['revisionName'] if t else '')" || true)
CHANGED_WORKER=0
# every step says what happened: a rollback that fails is said out loud, never swallowed by set -e
rollback() { echo "rolling back"
  if [ -n "$PREV_WEB" ]; then if gcloud run services update-traffic brew-web --to-revisions="$PREV_WEB=100" --region=$REGION --project=$P --quiet >/dev/null 2>&1; then echo "   web back on $PREV_WEB"; else echo "   ROLLBACK FAILED: web is NOT back on $PREV_WEB (put it back by hand)"; fi; fi
  if [ "$CHANGED_WORKER" = 1 ] && [ -n "$PREV_WORKER" ]; then if gcloud run services update-traffic brew-worker --to-revisions="$PREV_WORKER=100" --region=$REGION --project=$P --quiet >/dev/null 2>&1; then echo "   worker back on $PREV_WORKER"; else echo "   ROLLBACK FAILED: the worker is NOT back on $PREV_WORKER (put it back by hand)"; fi; fi
  return 0; }

echo "1/8 backup"
OP=""; for i in $(seq 1 20); do
  if OUT=$(gcloud sql backups create --instance=brew-prod --project=$P --description="before promote $SHA" --async --format='value(name)' 2>&1); then
    OP=$(echo "$OUT" | grep -Eo '^[0-9a-f-]{20,}$' | tail -1 || true) # this very backup's operation, not the newest one (an automatic backup may be newer)
    [ -n "$OP" ] || OP=$(gcloud sql operations list --instance=brew-prod --project=$P --filter="operationType=BACKUP_VOLUME" --limit=1 --sort-by=~startTime --format='value(name)'); break; fi
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
# the new revision gets the traffic by name: a rollback pins traffic to an older revision, and a later deploy alone would leave it
# there (25 Oct: the worker ran the morning's code all day after one rollback), so min-instances never started the new one
WREV=$(gcloud run services describe brew-worker --region=$REGION --project=$P --format='value(status.latestCreatedRevisionName)')
gcloud run services update-traffic brew-worker --to-revisions="$WREV=100" --region=$REGION --project=$P --quiet >/dev/null || { rollback; die "worker traffic switch failed"; }
WNOW=$(gcloud run services describe brew-worker --region=$REGION --project=$P --format=json | python3 -c "import json,sys; d=json.load(sys.stdin); t=[x for x in d['status'].get('traffic',[]) if x.get('percent')]; print(t[0]['revisionName'] if len(t)==1 and t[0]['percent']==100 else '')")
[ "$WNOW" = "$WREV" ] || { rollback; die "the worker runs ${WNOW:-a split}, not $WREV"; }
echo "   worker on $SHA ($WREV)"
# the worker's own settings, now that the new one runs (before any user traffic moves)
gcloud run jobs execute brew-prod-clean --project=$P --region=$REGION "--update-env-vars=^|^PROD_SERVICES=brew-worker|SMOKE_URL=|EXPECT_WORKER_REV=$WREV" --wait >/dev/null 2>&1 || {
  gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="brew-prod-clean" AND textPayload:"[clean]"' --project=$P --limit=20 --freshness=5m --format='value(textPayload)' | tac; rollback; die "the new worker's settings failed the gate"; }
echo "   worker settings clean"

echo "6/8 traffic to $REV"
gcloud run services update-traffic brew-web --to-revisions="$REV=100" --region=$REGION --project=$P --quiet >/dev/null || { rollback; die "traffic switch failed"; }

echo "7/8 checks through the load balancer"
# each check gets 5 tries: a network blip on the machine running this (no connection, code 000) is not a failed release
ok=1; for u in / /healthz/ready /api/config /privacy ${SMOKE_BRANDS-scrubroom-in b/scrubroom-in/seed.js}; do # a partner page and its feed through the load balancer too case "$u" in /*) ;; *) u="/$u";; esac
  for t in 1 2 3 4 5; do c=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$PROD_URL$u" || true); [ "$c" = 200 ] && break; sleep 5; done
  echo "   $u -> ${c:-000}"; [ "$c" = 200 ] || ok=0; done
[ $ok = 1 ] || { rollback; die "production checks failed after the switch: rolled back"; }
echo "8/8 production runs $SHA ($REV)"
