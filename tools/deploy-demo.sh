#!/usr/bin/env bash
# Deploy the Brew demo site (DEMO_MODE=1) as Cloud Run brew-demo → https://demo.joinsquareup.com
# Same code as brew.joinsquareup.com; every visitor owns a throwaway session of a prepared brand, every connector is a
# demo account built from the brand's real read, and nothing can write to a real account or send a message.
# Its own bucket (gs://brew-prototype-demo); brands come in with tools/demo-sync.sh. Deploy from a clean, committed tree.
# The tour ends where the prototype does: the jam and Share the brief. Connectors are simulated (DUMMY).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes: deploy from a clean worktree"; exit 1; }
for f in *.js connectors/*.js public/*.js; do node --check "$f"; done
# paid work in flight and the release rhythm (tools/deploy-guard.sh; FORCE=1 skips)
. tools/deploy-guard.sh
deploy_guard brew-demo https://demo.joinsquareup.com || exit 1
OUT=$(gcloud run deploy brew-demo --source . --project=squareup-492617 --region=asia-south1 \
  --allow-unauthenticated --service-account=brew-runtime@squareup-492617.iam.gserviceaccount.com --memory=4Gi --cpu=2 --no-cpu-throttling --min=1 --max=1 --max-instances=1 --timeout=3600 --concurrency=200 \
  --set-env-vars=DEMO_MODE=1,GOOGLE_CLOUD_PROJECT=squareup-492617,GEMINI_IMAGE_MODEL=gemini-3-pro-image,DAILY_TEXT_CAP=1500,DAILY_IMAGE_CAP=120,DAILY_VIDEO_CAP=15,RESEARCH_BUCKET=brew-prototype-demo,TREG_ORG=squareup,TREG_DAY_CAP_USD=15,SOCIAL_DAY_CAP_USD=2,DRAFTS_DAY_CAP_USD=4,BUILD_CAP_USD=120,DAILY_BUILD_CAP_USD=200,PUBLIC_URL=https://demo.joinsquareup.com,MOVES_CONCURRENCY=6,BUILD_BLOCK=wearcomet-in,ADMIN_EMAILS=${ADMIN_EMAILS:-param@joinsquareup.com;hello@joinsquareup.com;darshanaritesh11@gmail.com},BUILD_SIGNIN=1,FEED_SIGNIN=1,TRUSTED_PROXY_HOPS=1,REFRESH_AUTO=0,MOVES_REFRESH_OFF=1,AI_PROVIDER=${AI_PROVIDER:-gemini},GEMINI_DEEP_MODEL=${GEMINI_DEEP_MODEL:-gemini-3.5-flash},GEMINI_FAST_MODEL=${GEMINI_FAST_MODEL:-gemini-3.5-flash} \
  --set-secrets=ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,TREG_TOKEN=TREG_TOKEN:latest,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest,FEED_SESSION_SECRET=FEED_SESSION_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,HANDOFF_SECRET=HANDOFF_SECRET:latest \
  --labels=git-sha=$(git rev-parse --short HEAD) --quiet 2>&1) || true
echo "$OUT" | grep -E "Service URL|ERROR|error|revision" || true
if echo "$OUT" | grep -q "ERROR"; then echo "DEPLOY FAILED"; exit 1; fi
# never keep old revisions warm (they would run their own background work)
LIVE=$(gcloud run services describe brew-demo --region=asia-south1 --format="value(status.latestReadyRevisionName)")
# keep the newest 3 revisions (rollback: gcloud run services update-traffic brew-demo --to-revisions=<rev>=100); older ones go.
# A revision with no traffic scales to zero and retire.js stops an old one that wakes, so no old build keeps running.
for r in $(gcloud run revisions list --service=brew-demo --region=asia-south1 --sort-by="~metadata.creationTimestamp" --format="value(name)" | tail -n +4); do if [ "$r" != "$LIVE" ]; then gcloud run revisions delete "$r" --region=asia-south1 --quiet >/dev/null 2>&1 && echo "removed old revision $r"; fi; done
echo "live: $LIVE"
