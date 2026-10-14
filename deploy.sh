#!/usr/bin/env bash
# Deploy the Brew prototype to Cloud Run (service shopos-feed) → https://feed.joinsquareup.com
# Brand data lives in gs://brew-prototype (RESEARCH_BUCKET). Keys come from Secret Manager. Builds run in this process
# (CPU always on), one instance. Deploy from a clean, committed tree.
set -euo pipefail
cd "$(dirname "$0")"
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes: commit first, then deploy"; exit 1; }
for f in *.js reader/*.js reader/stages/*.js connectors/*.js dummy/*.js pdf/*.js public/*.js public/data/brew.js; do node --check "$f"; done
# every module server.js imports must be in the image (the Dockerfile copies *.js and these folders)
for d in reader connectors dummy pdf skills prompts data sources/moves public; do [ -d "$d" ] || { echo "missing $d/"; exit 1; }; done
AI_MOCK=1 node --test test/*.test.js >/dev/null || { echo "tests fail: fix them first"; exit 1; }
OUT=$(gcloud run deploy shopos-feed --source . --project=squareup-492617 --region=asia-south1 \
  --allow-unauthenticated --memory=4Gi --cpu=2 --no-cpu-throttling --min=1 --max-instances=1 --timeout=3600 --concurrency=200 \
  --set-env-vars="^|^GOOGLE_CLOUD_PROJECT=squareup-492617|GEMINI_IMAGE_MODEL=gemini-3-pro-image|DAILY_TEXT_CAP=1500|DAILY_IMAGE_CAP=120|RESEARCH_BUCKET=brew-prototype|TREG_ORG=squareup|TREG_DAY_CAP_USD=40|BUILD_CAP_USD=60|DAILY_BUILD_CAP_USD=${DAILY_BUILD_CAP_USD:-250}|PUBLIC_URL=https://feed.joinsquareup.com|MOVES_CONCURRENCY=6|BUILD_BLOCK=wearcomet-in,everaw-in|ADMIN_EMAILS=${ADMIN_EMAILS:-param@joinsquareup.com;hello@joinsquareup.com;darshanaritesh11@gmail.com}|BUILD_SIGNIN=${BUILD_SIGNIN:-1}|TRUSTED_PROXY_HOPS=${TRUSTED_PROXY_HOPS:-1}|FEED_SIGNIN=${FEED_SIGNIN:-1}" \
  --set-secrets=ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,TREG_TOKEN=TREG_TOKEN:latest,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest,RESEND_API_KEY=RESEND_API_KEY:latest,FEED_SESSION_SECRET=FEED_SESSION_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest \
  --quiet 2>&1) || true
echo "$OUT" | grep -E "Service URL|ERROR|error|revision" || true
if echo "$OUT" | grep -q "ERROR"; then echo "DEPLOY FAILED"; exit 1; fi
# never keep min instances on a revision (--min-instances): old revisions stay warm with their in-process builds. Service-level --min=1 only warms the serving one. Old revisions are removed anyway.
LIVE=$(gcloud run services describe shopos-feed --region=asia-south1 --format="value(status.latestReadyRevisionName)")
for r in $(gcloud run revisions list --service=shopos-feed --region=asia-south1 --format="value(name)"); do if [ "$r" != "$LIVE" ]; then gcloud run revisions delete "$r" --region=asia-south1 --quiet >/dev/null 2>&1 && echo "removed old revision $r"; fi; done
for u in "https://feed.joinsquareup.com/" "https://feed.joinsquareup.com/arata-in" "https://feed.joinsquareup.com/api/config"; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' "$u")"
done
