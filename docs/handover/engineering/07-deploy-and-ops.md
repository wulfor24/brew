# 07 · Deploy and ops runbook

*As of 2026-10-15. Live revisions: `shopos-feed-00169-5r6` and `brew-demo-00031-dtw`, both built from `ea6cfd7` (checked by comparing the served `public/*.js` byte for byte with HEAD). GitHub: `wulfor24/brew`, private, `main`; `origin/main` = `ea6cfd7`.*

## Where things run

| What | Where |
|---|---|
| GCP project / region | `squareup-492617` / `asia-south1` |
| Prototype | Cloud Run `shopos-feed`, at https://brew.joinsquareup.com, bucket `gs://brew-prototype` |
| Demo | Cloud Run `brew-demo`, at https://demo.joinsquareup.com, bucket `gs://brew-prototype-demo` |
| Load balancer | `squareup-urlmap`, the company-wide global HTTPS LB. Host rules: brew → `shopos-feed-backend`/NEG, demo → `brew-demo-backend`/NEG. No CDN, Cloud Armor or IAP. |
| DNS | Cloudflare. A records point to the LB IP 34.54.65.239. |
| OAuth | Google client "SquareUp Cockpit Web". It has the brew callback, plus the old feed callback, which does no harm. |
| Images | Artifact Registry `cloud-run-source-deploy/shopos-feed` |
| Ingress | `all`, so the `*.run.app` URLs bypass the LB |

Retired on 2026-10-15: `feed.joinsquareup.com`, `arata.*`, `arata-v1.*` and `feed-demo.*` (services, NEGs, host rules and DNS). The old buckets `gs://squareup-feed` and `gs://squareup-feed-demo` are kept but unused. **Never deploy from the archived `feed/` repo.**

## Deploy the prototype

```bash
./deploy.sh
```

What it does:
1. Refuses a dirty tree.
2. Runs `node --check` on the JS.
3. Checks the folders exist.
4. Runs the test suite.
5. Runs `gcloud run deploy --source .`, which takes 5–10 minutes on Cloud Build.
6. **Deletes every older revision.**
7. Curls `/`, `/arata-in` and `/api/config`.

It doesn't tag a release or record the SHA.

## Deploy the demo

```bash
tools/deploy-demo.sh
```

It has the same shape, but **it runs no tests** and checks only a subset of files. Run the tests yourself first.

To copy prepared brands from prod to the demo bucket (private, memory, spend, notify and connected files are excluded):

```bash
tools/demo-sync.sh arata-in
```

## Prepare a brand pack from the old feed

```bash
node tools/prepare-pack.mjs .brands/<slug>
```

It retires the audit moves and makes automation moves plan-only. It removes `private/`, `spend/`, `raw/` and `pagespeed.json`, and keeps `notify.json`. It does **not** clean these, so do it by hand:
- the retired audit moves' entries in `status.pdfs`, which return 404;
- `updates.json` stale flags;
- `moves/cadence.json` runs.

## Rollback (none is built in)

- Old revisions are deleted on every deploy, and bucket versioning is **off** (7-day soft delete only).
- Code rollback, option 1: check out the commit in a clean worktree and run `./deploy.sh`.
- Code rollback, option 2 (untested): `gcloud run deploy shopos-feed --image=asia-south1-docker.pkg.dev/squareup-492617/cloud-run-source-deploy/shopos-feed@<older digest>`, then delete the newer revision.
- **Recommended:** stop deleting revisions (use `--no-traffic` instead), set `GIT_SHA` as an env var or label, and turn on bucket versioning with a lifecycle rule.

## Destructive tools: read before running

- **`tools/reset-brand.sh <slug>`** wipes a brand and its workspaces in **prod**. It archives to `_deleted/<time>/` unless `NO_ARCHIVE=1`, and stops every instance through `control/live.json`, which causes downtime. It asks for no confirmation.
- **`tools/write_moves.mjs`** is **broken** for current packs: it writes `moves.json` as an array and drops moves numbered 100 and up. Don't run it.

## Logs and monitoring

- Everything goes to stderr with **no severity**, so `severity>=ERROR` finds nothing. There are no alerts and no dashboards.
- Read logs with:

  ```bash
  gcloud logging read 'resource.labels.service_name="shopos-feed"' --project=squareup-492617 --freshness=1d
  ```

- Last 24 h, by class:
  - 5,028 lines of `[moves] N failed: budget reached, not started` from old revisions. This was the `OPS_FRESH_RELOAD` loop.
  - treg 402 `insufficient_balance` storms (when the treg balance runs out, every treg source fails).
  - image-guard mismatches. These are expected: it falls back to the real photo.
  - retire handover refusals, also expected.
  - One current bug: `[memory] learn 400 … image/png`. `brand-memory.js:371` chooses the media type by file extension.
- Check the treg balance before you blame the code (treg MCP `balance`).

## Incident lessons (keep these)

1. **An ops job driven by env vars outlives the session that set it.** On 2026-10-14 an `OPS_FRESH_RELOAD` loop ran about 4 h and spent about $7–31 rewriting only the Move 00 index, because the index call skips the budget check. After any one-off ops job, remove its env vars, and check the live env after anyone else deploys.
2. **Each deploy resets the in-memory caps** (text, image, video, voice, treg). Fourteen deploys in two days means 14 fresh daily allowances.
3. **A deploy in the middle of a build** resumes it, but a read in progress is re-done and its Claude calls are paid again.

## Before every deploy (checklist)

- [ ] `AI_MOCK=1 node --test test/*.test.js` is green.
- [ ] Boot locally with mocks (see `00-START-HERE.md`) and open the brand page.
- [ ] No `OPS_*` or raised cap env vars are left from earlier work.
- [ ] If you touched anything that reads outside data, follow the `brew-external-data` skill. It currently lives in the parent folder's `.claude/skills/`; see `11-known-issues-and-debt.md`.
- [ ] After the deploy: the curls return 200, and `gcloud run services describe shopos-feed` shows the env you expect.
