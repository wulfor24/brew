#!/usr/bin/env bash
# Phase 6: copy design partners from staging to production with the Cloud Run Job brew-partner-copy (inside the VPC, as the
# brew-partner-copy service account: reads staging's database, vault key and bucket; writes production's). Staging's live image.
#   tools/partner-copy.sh scrubroom-in [nutrova-com …] [global]     a dry run (nothing written)
#   tools/partner-copy.sh scrubroom-in apply                         the copy
# (plain words, no flags: gcloud mangles repeated flags in a job's args)
# Prints the job's [partner] lines. db/partner-copy.js says what is copied and what stays on staging.
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/prod-env.sh
STAGE_REV=$(gcloud run services describe shopos-feed --region=$REGION --project=$P --format='value(status.latestReadyRevisionName)')
IMG=$(gcloud run revisions describe "$STAGE_REV" --region=$REGION --project=$P --format='value(spec.containers[0].image)')
ARGS="db/migrate-to-prod.mjs"; for a in "$@"; do case "$a" in -*) echo "STOP: plain words only ($a)"; exit 1;; esac; ARGS="$ARGS:$a"; done
gcloud run jobs deploy brew-partner-copy --image="$IMG" --project=$P --region=$REGION --service-account=brew-partner-copy@$P.iam.gserviceaccount.com $NET \
  --command=node "--args=^:^$ARGS" --set-env-vars="^|^STORAGE=pg|SRC_BUCKET=brew-prototype|RESEARCH_BUCKET=brew-prod" \
  --set-secrets="SRC_DATABASE_URL=BREW_STAGING_DATABASE_URL:latest,DATABASE_URL=BREW_PROD_DATABASE_URL:latest,SRC_VAULT_KEY=FEED_VAULT_KEY:latest,FEED_VAULT_KEY=FEED_VAULT_KEY_PROD:latest" \
  --max-retries=0 --task-timeout=3600 --memory=2Gi --quiet >/dev/null
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); OK=1
gcloud run jobs execute brew-partner-copy --project=$P --region=$REGION --wait >/dev/null 2>&1 || OK=0
sleep 5
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"brew-partner-copy\" AND timestamp>=\"$START\"" --project=$P --limit=200 --format='value(textPayload)' 2>/dev/null | grep -v '^$' | tac
[ $OK = 1 ] || { echo "STOP: the copy job failed"; exit 1; }
