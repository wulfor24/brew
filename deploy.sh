#!/usr/bin/env bash
# Deploy the Brew prototype to Cloud Run (service shopos-feed) → https://brew.joinsquareup.com
# Brand data lives in gs://brew-prototype (RESEARCH_BUCKET). Keys come from Secret Manager. Builds run in this process
# (CPU always on), one instance. Deploy from a clean, committed tree.
set -euo pipefail
cd "$(dirname "$0")"
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes: commit first, then deploy"; exit 1; }
for f in *.js reader/*.js reader/stages/*.js connectors/*.js pdf/*.js public/*.js public/data/brew.js; do node --check "$f"; done
# every module server.js imports must be in the image (the Dockerfile copies *.js and these folders)
for d in reader connectors pdf skills prompts data sources/moves public; do [ -d "$d" ] || { echo "missing $d/"; exit 1; }; done
AI_MOCK=1 node --test test/*.test.js >/dev/null || { echo "tests fail: fix them first"; exit 1; }
# Deploy any time: the instance that goes gets SIGTERM, stops starting moves and saves what it has; the new one resumes every
# unfinished build and rewrite on boot (build.js resumeAll). Only the moves in flight at that second are written again.
OUT=$(gcloud run deploy shopos-feed --source . --project=squareup-492617 --region=asia-south1 \
  --allow-unauthenticated --service-account=brew-runtime@squareup-492617.iam.gserviceaccount.com --memory=4Gi --cpu=2 --no-cpu-throttling --min=1 --max=1 --max-instances=1 --timeout=3600 --concurrency=200 \
  --set-env-vars="^|^GOOGLE_CLOUD_PROJECT=squareup-492617|GOOGLE_OAUTH=1|GEMINI_IMAGE_MODEL=${GEMINI_IMAGE_MODEL:-gemini-2.5-flash-image}|DAILY_TEXT_CAP=1500|DAILY_IMAGE_CAP=120|RESEARCH_BUCKET=brew-prototype|TREG_ORG=squareup|TREG_DAY_CAP_USD=40|BUILD_CAP_USD=45|DAILY_BUILD_CAP_USD=${DAILY_BUILD_CAP_USD:-250}|PUBLIC_URL=https://brew.joinsquareup.com|MOVES_CONCURRENCY=8|BUILD_BLOCK=wearcomet-in,everaw-in|ADMIN_EMAILS=${ADMIN_EMAILS:-param@joinsquareup.com;hello@joinsquareup.com;darshanaritesh11@gmail.com}|BUILD_SIGNIN=${BUILD_SIGNIN:-1}|TRUSTED_PROXY_HOPS=${TRUSTED_PROXY_HOPS:-1}|FEED_SIGNIN=${FEED_SIGNIN:-1}|GA4_SA_EMAIL=brew-runtime@squareup-492617.iam.gserviceaccount.com|SHOPIFY_OAUTH=${SHOPIFY_OAUTH:-0}|GOOGLE_OAUTH=${GOOGLE_OAUTH:-1}|META_ADS_CONFIG_ID=2157080375167128|AI_PROVIDER=${AI_PROVIDER:-gemini}|GEMINI_DEEP_MODEL=${GEMINI_DEEP_MODEL:-gemini-3.5-flash}|GEMINI_FAST_MODEL=${GEMINI_FAST_MODEL:-gemini-3.5-flash}" \
  --set-secrets=ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,TREG_TOKEN=TREG_TOKEN:latest,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest,RESEND_API_KEY=RESEND_API_KEY:latest,FEED_SESSION_SECRET=FEED_SESSION_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,HANDOFF_SECRET=HANDOFF_SECRET:latest,FEED_VAULT_KEY=FEED_VAULT_KEY:latest,FEED_SHOPIFY_CLIENT_ID=FEED_SHOPIFY_CLIENT_ID:latest,FEED_SHOPIFY_CLIENT_SECRET=FEED_SHOPIFY_CLIENT_SECRET:latest,META_ADS_OAUTH_CLIENT_ID=META_ADS_OAUTH_CLIENT_ID:latest,META_ADS_OAUTH_CLIENT_SECRET=META_ADS_OAUTH_CLIENT_SECRET:latest,GOOGLE_ADS_OAUTH_CLIENT_ID=GOOGLE_ADS_OAUTH_CLIENT_ID:latest,GOOGLE_ADS_OAUTH_CLIENT_SECRET=GOOGLE_ADS_OAUTH_CLIENT_SECRET:latest,GOOGLE_ADS_DEVELOPER_TOKEN=GOOGLE_ADS_DEVELOPER_TOKEN:latest,SLACK_CLIENT_ID=SLACK_CLIENT_ID:latest,SLACK_CLIENT_SECRET=SLACK_CLIENT_SECRET:latest,SLACK_SIGNING_SECRET=SLACK_SIGNING_SECRET:latest,PAGESPEED_API_KEY=PAGESPEED_API_KEY:latest \
  --labels=git-sha=$(git rev-parse --short HEAD) --quiet 2>&1) || true
echo "$OUT" | grep -E "Service URL|ERROR|error|revision" || true
if echo "$OUT" | grep -q "ERROR"; then echo "DEPLOY FAILED"; exit 1; fi
# never keep min instances on a revision (--min-instances): old revisions stay warm with their in-process builds. Service-level --min=1 only warms the serving one. Old revisions are removed anyway.
LIVE=$(gcloud run services describe shopos-feed --region=asia-south1 --format="value(status.latestReadyRevisionName)")
# keep the newest 3 revisions (rollback: gcloud run services update-traffic shopos-feed --to-revisions=<rev>=100); older ones go.
# A revision with no traffic scales to zero and retire.js stops an old one that wakes, so no old build keeps running.
for r in $(gcloud run revisions list --service=shopos-feed --region=asia-south1 --sort-by="~metadata.creationTimestamp" --format="value(name)" | tail -n +4); do if [ "$r" != "$LIVE" ]; then gcloud run revisions delete "$r" --region=asia-south1 --quiet >/dev/null 2>&1 && echo "removed old revision $r"; fi; done
for u in "https://brew.joinsquareup.com/" "https://brew.joinsquareup.com/arata-in" "https://brew.joinsquareup.com/api/config"; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' "$u")"
done
