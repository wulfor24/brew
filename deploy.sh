#!/usr/bin/env bash
# Deploy the Brew prototype to Cloud Run (service shopos-feed) → https://brew.joinsquareup.com
# Brand data lives in gs://brew-prototype (RESEARCH_BUCKET). Keys come from Secret Manager. Builds run in this process
# (CPU always on), one instance. Deploy from a clean, committed tree.
set -euo pipefail
cd "$(dirname "$0")"
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes: commit first, then deploy"; exit 1; }
for f in *.js db/*.js reader/*.js reader/stages/*.js connectors/*.js pdf/*.js public/*.js public/data/brew.js; do node --check "$f"; done
# every module server.js imports must be in the image (the Dockerfile copies *.js and these folders)
for d in reader connectors pdf db skills prompts data sources/moves public; do [ -d "$d" ] || { echo "missing $d/"; exit 1; }; done
# the suite opens local ports and temp files, so two sessions deploying at once can trip each other: a failed run is run once
# more on its own before it stops the deploy, and the failing tests are named
if ! AI_MOCK=1 node --test test/*.test.js >/dev/null 2>&1; then
  echo "tests failed once (another suite may be running next to this one): trying once more"; sleep 20
  AI_MOCK=1 node --test test/*.test.js > "${TMPDIR:-/tmp}/brew-deploy-tests.txt" 2>&1 || { echo "tests fail: fix them first"; grep -E "^✖" "${TMPDIR:-/tmp}/brew-deploy-tests.txt" | sort -u | head -20; exit 1; }
fi
# MOVED_TO_PROD (Phase 6, 25 Oct): partners whose home is production now (moved.js): their own people are sent to
# feed.joinsquareup.com, staff stay, and no background work here spends on them or emails them. Arata keeps its connectors reading here too.
# DAILY_IMAGE_CAP 1500: draft pictures run on Google credits (about $0.039 each on flash, about $58 a day at worst); server.js
# BG_RESERVE still keeps each brand's last pictures of the day for its team.
# 20 Oct (Param): only the moves run on a higher model (GEMINI_MOVES_MODEL, Pro); the brief, ideas, cards, jam and the rest
# are Gemini Flash (GEMINI_DEEP_MODEL and GEMINI_FAST_MODEL).
# 20 Oct 07:50 IST: the Anthropic key ran out of credit, so live runs on Gemini (Pro for moves, Flash for the rest) until
# Param tops it up; then set the default below back to anthropic.
# Production (Param, 20 Oct, team testing): every text model is Claude on the Anthropic key in Secret Manager
# (ANTHROPIC_API_KEY), AI_PROVIDER=anthropic; Gemini stays the fallback with Pro for deep jobs. For cheap development runs:
# AI_PROVIDER=gemini GEMINI_DEEP_MODEL=gemini-3.5-flash ./deploy.sh
# Storage (25 Oct): STORAGE=pg — structured data in Cloud SQL brew-staging (private IP, Direct VPC egress), binaries in the
# bucket. While the bucket is still the way back, reads fall through to it (OBJECTS_READTHROUGH) and every row is copied to it
# (OBJECTS_MIRROR); run the brew-import job (db/import-bucket.mjs) after any deploy that ran on the bucket. STORAGE=gcs ./deploy.sh goes back.
# Deploy any time: the instance that goes gets SIGTERM, stops starting moves and saves what it has; the new one resumes every
# unfinished build and rewrite on boot (build.js resumeAll). Only the moves in flight at that second are written again.
# Apify (YouTube clips for viral remakes, video-read.js): its key goes in once the secret exists, so a deploy never fails on it
# Higgsfield API (jam2/engines.js: still.shot second, video.ugc first): its keys go in once both secrets exist
HF_SECRETS=$(gcloud secrets describe HF_API_KEY_SECRET --project=squareup-492617 --format='value(name)' >/dev/null 2>&1 && echo ',HF_API_KEY_ID=HF_API_KEY_ID:latest,HF_API_KEY_SECRET=HF_API_KEY_SECRET:latest' || true)
APIFY_SECRET=$(gcloud secrets describe APIFY_TOKEN --project=squareup-492617 --format='value(name)' >/dev/null 2>&1 && echo ',APIFY_TOKEN=APIFY_TOKEN:latest' || true)
OUT=$(gcloud run deploy shopos-feed --source . --project=squareup-492617 --region=asia-south1 \
  --allow-unauthenticated --service-account=brew-runtime@squareup-492617.iam.gserviceaccount.com --memory=4Gi --cpu=2 --no-cpu-throttling --min=1 --max=1 --max-instances=1 --timeout=3600 --concurrency=200 --network=default --subnet=default --vpc-egress=private-ranges-only --startup-probe=httpGet.path=/healthz/ready,periodSeconds=3,failureThreshold=40,timeoutSeconds=3 \
  --set-env-vars="^|^GOOGLE_CLOUD_PROJECT=squareup-492617|MOVED_TO_PROD=${MOVED_TO_PROD-scrubroom-in,manaprojects-com,nutrova-com,in-puma-com,arata-in}|PROD_URL=https://feed.joinsquareup.com|META_GRAPH_VERSION=${META_GRAPH_VERSION:-v26.0}|GEMINI_IMAGE_MODEL=${GEMINI_IMAGE_MODEL:-gemini-2.5-flash-image}|DAILY_TEXT_CAP=1500|DAILY_IMAGE_CAP=${DAILY_IMAGE_CAP:-1500}|DAILY_VIDEO_CAP=${DAILY_VIDEO_CAP:-60}|BRAND_VIDEO_CAP=${BRAND_VIDEO_CAP:-20}|RESEARCH_BUCKET=brew-prototype|TREG_ORG=squareup|TREG_DAY_CAP_USD=40|APIFY_BRAND_MONTH_CAP_USD=${APIFY_BRAND_MONTH_CAP_USD:-10}|BUILD_CAP_USD=45|DAILY_BUILD_CAP_USD=${DAILY_BUILD_CAP_USD:-250}|PUBLIC_URL=https://brew.joinsquareup.com|MOVES_CONCURRENCY=8|BUILD_BLOCK=wearcomet-in,everaw-in|ADMIN_EMAILS=${ADMIN_EMAILS:-param@joinsquareup.com;hello@joinsquareup.com;darshanaritesh11@gmail.com}|BUILD_SIGNIN=${BUILD_SIGNIN:-1}|TRUSTED_PROXY_HOPS=${TRUSTED_PROXY_HOPS:-1}|FEED_SIGNIN=${FEED_SIGNIN:-1}|GA4_SA_EMAIL=brew-runtime@squareup-492617.iam.gserviceaccount.com|SHOPIFY_OAUTH=${SHOPIFY_OAUTH:-0}|GOOGLE_OAUTH=${GOOGLE_OAUTH:-1}|META_ADS_CONFIG_ID=2157080375167128|AI_PROVIDER=${AI_PROVIDER:-gemini}|GEMINI_DEEP_MODEL=${GEMINI_DEEP_MODEL:-gemini-3.5-flash}|GEMINI_FAST_MODEL=${GEMINI_FAST_MODEL:-gemini-3.5-flash}|GEMINI_MOVES_MODEL=${GEMINI_MOVES_MODEL:-gemini-3.1-pro-preview}|BUILD_CONFIRM_WAIT_MS=${BUILD_CONFIRM_WAIT_MS:-900000}|STORAGE=${STORAGE:-pg}|OBJECTS_READTHROUGH=${OBJECTS_READTHROUGH:-1}|OBJECTS_MIRROR=${OBJECTS_MIRROR:-1}|PG_POOL_MAX=${PG_POOL_MAX:-10}|UV_THREADPOOL_SIZE=${UV_THREADPOOL_SIZE:-16}" \
  --set-secrets=DATABASE_URL=BREW_STAGING_DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,TREG_TOKEN=TREG_TOKEN:latest,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest,RESEND_API_KEY=RESEND_API_KEY:latest,FEED_SESSION_SECRET=FEED_SESSION_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,HANDOFF_SECRET=HANDOFF_SECRET:latest,FEED_VAULT_KEY=FEED_VAULT_KEY:latest,FEED_SHOPIFY_CLIENT_ID=FEED_SHOPIFY_CLIENT_ID:latest,FEED_SHOPIFY_CLIENT_SECRET=FEED_SHOPIFY_CLIENT_SECRET:latest,META_ADS_OAUTH_CLIENT_ID=META_ADS_OAUTH_CLIENT_ID:latest,META_ADS_OAUTH_CLIENT_SECRET=META_ADS_OAUTH_CLIENT_SECRET:latest,GOOGLE_ADS_OAUTH_CLIENT_ID=GOOGLE_ADS_OAUTH_CLIENT_ID:latest,GOOGLE_ADS_OAUTH_CLIENT_SECRET=GOOGLE_ADS_OAUTH_CLIENT_SECRET:latest,GOOGLE_ADS_DEVELOPER_TOKEN=GOOGLE_ADS_DEVELOPER_TOKEN:latest,SLACK_CLIENT_ID=SLACK_CLIENT_ID:latest,SLACK_CLIENT_SECRET=SLACK_CLIENT_SECRET:latest,SLACK_SIGNING_SECRET=SLACK_SIGNING_SECRET:latest,PAGESPEED_API_KEY=PAGESPEED_API_KEY:latest${APIFY_SECRET}${HF_SECRETS} \
  --labels=git-sha=$(git rev-parse --short HEAD) --quiet 2>&1) || true
echo "$OUT" | grep -E "Service URL|ERROR|error|revision" || true
if echo "$OUT" | grep -q "ERROR"; then echo "DEPLOY FAILED"; exit 1; fi
# never keep min instances on a revision (--min-instances): old revisions stay warm with their in-process builds. Service-level --min=1 only warms the serving one. Old revisions are removed anyway.
LIVE=$(gcloud run services describe shopos-feed --region=asia-south1 --format="value(status.latestReadyRevisionName)")
# keep the newest 3 revisions (rollback: gcloud run services update-traffic shopos-feed --to-revisions=<rev>=100); older ones go.
# A revision with no traffic scales to zero and retire.js stops an old one that wakes, so no old build keeps running.
for r in $(gcloud run revisions list --service=shopos-feed --region=asia-south1 --sort-by="~metadata.creationTimestamp" --format="value(name)" | tail -n +4); do if [ "$r" != "$LIVE" ]; then gcloud run revisions delete "$r" --region=asia-south1 --quiet >/dev/null 2>&1 && echo "removed old revision $r"; fi; done
for u in "https://brew.joinsquareup.com/" "https://brew.joinsquareup.com/cozysnugglet-shop" "https://brew.joinsquareup.com/arata-in" "https://brew.joinsquareup.com/api/config"; do   # arata-in: 302 to production (MOVED_TO_PROD)
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' "$u")"
done
