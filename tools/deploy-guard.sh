# Sourced by deploy.sh and tools/deploy-demo.sh before they deploy: a deploy stops the running instance, and with it every
# build, rewrite, statics run, background draft and weekly move it was paying for. So it asks the live site (/api/ops/busy)
# and waits up to DEPLOY_WAIT_MIN minutes (default 15) for that work to finish; still busy then, it refuses.
# FORCE=1 skips the check (a hotfix that can't wait; say why in the commit).
deploy_guard() {
  local svc="$1" url="$2"
  if [ "${FORCE:-0}" = "1" ]; then echo "FORCE=1: deploying without the paid-work check"; return 0; fi
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
