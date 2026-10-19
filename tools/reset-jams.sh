#!/bin/zsh
# Reset every jam for one brand on brew.joinsquareup.com (Param, 19 Oct: "start fresh on all the jams for Arata"), keeping cards, moves, drafts, learnings and connections.
#   tools/reset-jams.sh arata-in      (the brand is offline for about a minute; a copy goes to _deleted/jams-<slug>-<time>/)
# 1 archive, 2 stop + hide the brand (retire.js), 3 empty the shared jams + strip jam state from its workspaces, 4 stop with nothing hidden, 5 verify
set -euo pipefail
SLUG=${1:?slug}; SVC=shopos-feed; REGION=asia-south1; B=gs://brew-prototype; URL=https://brew.joinsquareup.com
T=$(mktemp -d); ARCH=$B/_deleted/jams-$SLUG-$(date -u +%Y%m%dT%H%M%SZ)
LIVE=$(gcloud run services describe $SVC --region=$REGION --format='value(status.latestReadyRevisionName)'); N=$(echo "$LIVE" | sed -E 's/.*-0*([0-9]+)-[a-z0-9]+$/\1/')
now() { python3 -c 'import time; print(int(time.time()*1000))'; }
marker() { echo "$1" > $T/live.json; gcloud storage cp $T/live.json $B/control/live.json -q --cache-control=no-store; }
echo "1/5 archive to $ARCH"
gcloud storage cp $B/brands/$SLUG/private/jams.json $ARCH/jams.json -q
mkdir -p $T/t && gcloud storage cp "$B/tenants/*.json" $T/t/ -q
IDS=$(python3 -I - $T/t $SLUG <<'PY'
import json, os, sys
d, slug = sys.argv[1], sys.argv[2]
print(' '.join(f[:-5] for f in sorted(os.listdir(d)) if json.load(open(os.path.join(d, f))).get('brandId') == slug))
PY
)
for id in ${=IDS}; do gcloud storage cp $T/t/$id.json $ARCH/tenants/$id.json -q; done
echo "   $(echo ${=IDS} | wc -w | tr -d ' ') workspaces archived"
echo "2/5 stop $LIVE and hide $SLUG"
marker "{\"rev\":\"stop\",\"n\":$N,\"at\":$(now),\"wipe\":[\"$SLUG\"]}"; sleep 25; curl -s -o /dev/null $URL/api/config || true; sleep 5
echo "3/5 empty the jams"
echo "{\"at\":$(now),\"work\":[],\"changes\":{},\"vg\":{}}" > $T/jams.json; gcloud storage cp $T/jams.json $B/brands/$SLUG/private/jams.json -q --cache-control=no-store
rm -rf $T/t2 && mkdir -p $T/t2 && for id in ${=IDS}; do gcloud storage cp $B/tenants/$id.json $T/t2/ -q; done
python3 -I - $T/t2 <<'PY'
import json, os, sys
d = sys.argv[1]
for f in os.listdir(d):
    p = os.path.join(d, f); t = json.load(open(p))
    for k, v in (('vg', {}), ('versions', []), ('router', []), ('ownWork', []), ('ownChanges', {}), ('work', []), ('changes', {}), ('actedAt', {})):
        if k in t: t[k] = v
    if 'acted' in t: t['acted'] = {'__s': []}  # a Set, in store.js's tagged form (a bare {} broke every feed: "t.acted is not iterable")
    cs = t.get('cards'); n = 0
    def strip(c):
        global n
        if isinstance(c, dict) and 'take' in c: c.pop('take', None); n += 1
    if isinstance(cs, dict):
        for v in cs.values():
            for e in (v if isinstance(v, list) else []):
                strip(e[1] if isinstance(e, list) and len(e) > 1 else e)
    elif isinstance(cs, list):
        for e in cs: strip(e[1] if isinstance(e, list) and len(e) > 1 else e)
    json.dump(t, open(p, 'w'))
    print('  ', f, 'takes removed', n)
PY
for id in ${=IDS}; do gcloud storage cp $T/t2/$id.json $B/tenants/$id.json -q --cache-control=no-store; done
echo "4/5 stop once more, nothing hidden"
marker "{\"rev\":\"stop\",\"n\":$N,\"at\":$(now),\"wipe\":[]}"; sleep 25; curl -s -o /dev/null $URL/api/config || true; curl -s -o /dev/null $URL/$SLUG || true; sleep 30
echo "5/5 verify"
gcloud storage cat $B/brands/$SLUG/private/jams.json | python3 -I -c 'import json,sys; j=json.load(sys.stdin); print("   shared jams:", len(j.get("work",[])), "work,", len(j.get("changes",{})), "changes")'
curl -s -o /dev/null -w "   $URL/$SLUG -> %{http_code}\n" $URL/$SLUG
