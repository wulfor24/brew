# Sourced by deploy.sh and tools/deploy-demo.sh before they deploy: a deploy stops the running instance, and with it every
# build, rewrite, statics run, background draft and weekly move it was paying for. So:
#   1. release rhythm: at most one deploy every DEPLOY_GAP_MIN minutes (default 20); batch your changes.
#   2. paid work: ask the live site (/api/ops/busy) and wait up to DEPLOY_WAIT_MIN minutes (default 15) for it to finish;
#      still busy then, refuse.
# FORCE=1 skips both (a hotfix that can't wait; say why in the commit).
deploy_guard() {
  local svc="$1" url="$2"
  if [ "${FORCE:-0}" = "1" ]; then echo "FORCE=1: deploying without the rhythm and paid-work checks"; return 0; fi
  local gap="${DEPLOY_GAP_MIN:-20}" last age
  last=$(gcloud run revisions list --service="$svc" --region=asia-south1 --project=squareup-492617 --sort-by="~metadata.creationTimestamp" --limit=1 --format="value(metadata.creationTimestamp)" 2>/dev/null || true)
  if [ -n "$last" ]; then
    age=$(python3 -c 'import sys,datetime as d; t=d.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")); print(int((d.datetime.now(d.timezone.utc)-t).total_seconds()//60))' "$last" 2>/dev/null || echo 999)
    if [ "$age" -lt "$gap" ]; then
      echo "the last deploy of $svc was $age minutes ago: deploy at most every $gap minutes (batch your changes, see CLAUDE.md). FORCE=1 to override."
      return 1
    fi
  fi
  local wait="${DEPLOY_WAIT_MIN:-15}" until_s=$(( $(date +%s) + ${DEPLOY_WAIT_MIN:-15} * 60 )) j n
  while :; do
    j=$(curl -s --max-time 15 "$url/api/ops/busy" || true)
    n=$(printf '%s' "$j" | python3 -c 'import sys,json; print(int(json.load(sys.stdin).get("busy",-1)))' 2>/dev/null || echo -1)
    if [ "$n" = "-1" ]; then echo "warning: $url/api/ops/busy did not answer (an older revision?): deploying without the paid-work check"; return 0; fi
    if [ "$n" = "0" ]; then echo "no paid work running on $svc"; return 0; fi
    if [ "$(date +%s)" -ge "$until_s" ]; then
      echo "$svc is still doing paid work after $wait minutes: $j"
      echo "a deploy now would stop it mid-way. Try again later, or FORCE=1 if it can't wait."
      return 1
    fi
    echo "$svc is doing paid work ($j): waiting 30s (up to $wait minutes)"
    sleep 30
  done
}
