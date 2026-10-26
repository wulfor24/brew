# Brew production: what runs, how to release, how to restore

Production is **feed.joinsquareup.com**. Staging is **brew.joinsquareup.com** (service `shopos-feed`), where every change runs first.

## What runs

| Piece | Production | Staging |
|---|---|---|
| Web | Cloud Run `brew-web` (ROLE=web, 2–10 instances, session affinity, ingress via the load balancer only) | `shopos-feed`, one instance doing both roles |
| Worker | Cloud Run `brew-worker` (ROLE=worker, exactly 1, internal). It holds the background lease: builds, rewrites, finals recovery, connector reads, scheduled jobs | the same instance |
| Database | Cloud SQL `brew-prod` (Postgres 17, regional HA, private IP 172.30.0.4, deletion protection) | Cloud SQL `brew-staging` (172.30.0.3) |
| Files | `gs://brew-prod` (versioning on, 7-day soft delete) | `gs://brew-prototype` |
| Runs as | `brew-prod-runtime@` | `brew-runtime@` |
| Settings | `tools/prod-env.sh` (`ENV=production`, the `*_PROD` secrets) | `deploy.sh` |
| Entry | Google HTTPS load balancer `squareup-urlmap` → `brew-web-backend`, Cloud Armor `brew-prod-armor`, Cloudflare A record `feed` → 34.54.65.239 | Cloud Run domain mapping |

Which site holds which brand:
- Staging's `MOVED_TO_PROD` sends a moved brand's own people to production.
- Production's `STAGING_HOME` does the reverse.
- Staff (shopos.ai, joinsquareup.com, admins) can open either site.
- A brand at home on one site gets no background work, outgoing email or Slack, or sign-in renewal from the other site. Connector reads keep running on both, so Arata stays connected on both.

## Releasing

Only `tools/promote.sh` releases to production. Run it from a clean checkout of origin/main. It does the following:
1. Takes the lock `gs://brew-prod-backups/locks/promote.lock`, so only one release runs at a time. A lock older than 2 hours is taken over.
2. Makes an on-demand database backup and waits for that exact backup to finish.
3. Runs migrations as the job `brew-prod-migrate`. Migrations only add; they never break the version still running.
4. Deploys staging's exact image to `brew-web` with no traffic, then smoke-tests it from inside the VPC with the clean gate (`db/prod-clean.mjs`). The gate checks settings, secrets, sign-in, test data, simulated connector data, and every built brand's page.
5. Deploys the worker, gives that revision the traffic by name, and checks that the new worker took the background lease.
6. Moves web traffic to the candidate by name, then checks pages through the load balancer, retrying each check. If any step fails it rolls back and says so. A failed rollback is printed as `ROLLBACK FAILED` with what to restore by hand.

Never edit `promote.sh` while it runs: bash reads the script as it goes.

## Backups

- **Point-in-time recovery:** 7 days of transaction logs. You can restore to any second in that window, into a new instance.
- **Automated backups:** daily, 14 kept.
- **Before every promote:** an on-demand backup.
- **Nightly logical export:** Cloud Scheduler `brew-prod-nightly-export` (21:30 UTC) writes `gs://brew-prod-backups/nightly/brew.sql.gz`. It is a separate bucket and survives deleting the instance.
- **Files:** `gs://brew-prod` has versioning on, so an overwritten or deleted object can be brought back, plus 7 days of soft delete.

Restore test, 25 Oct 2026: the export was imported into a scratch database on `brew-staging`. Every brand's row and part counts matched live production. Repeat this monthly; the steps are under "Restore test" below.

## Restoring

**The whole database to a moment** (a bad migration, mass damage):
1. `gcloud sql instances clone brew-prod brew-prod-restore --point-in-time=<RFC3339>` (this takes about 20–40 minutes).
2. Check it. Then either point `BREW_PROD_DATABASE_URL` at the clone and promote, or copy the damaged rows back. Prefer copying rows back.
3. Restoring the whole database also brings back old sign-ins. Arata's tokens don't rotate today, so that is safe for Arata, but check `db/connector-ping.mjs` afterwards. Never reconnect Arata.

**One brand deleted or damaged by mistake:**
1. Clone to a moment before the damage (step 1 above).
2. Copy that brand's `objects` and `doc_parts` rows from the clone. Keep the current `private/vault/*` rows unless told otherwise. Use a small one-off SQL job; `db/partner-copy.js` is the model, minus its "production's own rows are kept" rule.
3. The brand's files in `gs://brew-prod/brands/<slug>/` come back from object versions.

**Files only:** list versions with `gcloud storage ls -a gs://brew-prod/brands/<slug>/…` and copy the wanted generation back.

**Restore test (monthly):**
1. `gcloud scheduler jobs run brew-prod-nightly-export`, then wait for the EXPORT operation.
2. Give the brew-staging Cloud SQL service account read access on `gs://brew-prod-backups` for the duration.
3. `gcloud sql databases create restore_drill --instance=brew-staging`.
4. `gcloud sql import sql brew-staging gs://brew-prod-backups/nightly/brew.sql.gz --database=restore_drill`.
5. Count rows per brand in both databases (a one-off job inside the VPC), compare, then drop `restore_drill` and remove the temporary read access.

## Resetting and deleting a brand

Both sites keep their data in Postgres, so these run as Cloud Run jobs inside the VPC (the database has a private IP only).
`tools/reset-brand.sh` and `tools/flush-live.sh` are bucket-era: with `STORAGE=pg` (the default) they print where to go and exit 3.
Every tool below is a **dry run unless `--yes`** is given: it prints exactly what it would remove and removes nothing. Read the
dry run first. Never run them from a laptop, and never on a design partner who did not ask.

| Job | What it does | Keeps |
|---|---|---|
| `db/reset-jams.mjs` | Empties jams and remix state | everything else |
| `db/reset-brand.mjs` | One brand back to a fresh first run: its rows under `brands/<slug>/`, workspaces, build progress, its jobs and bus messages, the brand folder's bucket files. A copy goes to `_deleted/brand-<slug>-<time>/` on staging. | connections, sign-in tokens, connected numbers (`private/connections.json`, `private/vault/`, `live/`, `private/live/`, `private/live-base.json`, `private/connected-ledger.json`), checked byte for byte afterwards |
| `db/delete-brand.mjs` | A data request: all the brand's data, our stored tokens included, its `_deleted/` copies, counters, access log rows, every bucket version of its files, and made or research media no other row points at | one `data_deletions` row: counts by folder, when, who, the grants, what backups still hold |

Both refuse the five design partners (`arata-in`, `nutrova-com`, `manaprojects-com`, `in-puma-com`, `scrubroom-in`) unless
`--partner-override --confirm-slug <slug>` is given. A brand in `PROTECTED_CONNECTIONS` is never deleted: take it out of that setting first.
Neither tool calls Shopify, Meta, Google, Slack or Klaviyo. A deletion prints the grants the brand must revoke itself; put them in the reply.

**Staging** (`brew-ops`). `n` is the live revision number, from `shopos-feed-<n>-xxx`. The stop marker hides the brand while it goes, as for jams:

```bash
gcloud run jobs execute brew-ops --region=asia-south1 --args=db/reset-jams.mjs,--slug,<slug>,--rev-n,<n> --wait
gcloud run jobs execute brew-ops --region=asia-south1 --args=db/reset-brand.mjs,--slug,<slug> --wait                     # dry run
gcloud run jobs execute brew-ops --region=asia-south1 --args=db/reset-brand.mjs,--slug,<slug>,--rev-n,<n>,--yes --wait
gcloud run jobs execute brew-ops --region=asia-south1 --args=db/delete-brand.mjs,--slug,<slug> --wait                    # dry run
gcloud run jobs execute brew-ops --region=asia-south1 --args=db/delete-brand.mjs,--slug,<slug>,--rev-n,<n>,--yes,--request,<ref>,--operator,<name> --wait
```

Then check with `db/status.mjs` through `brew-ops` that Arata's connections still read.

**Production** (`brew-prod-ops`; production sets `RETIRE_OFF=1`, so there is no stop marker: the job removes, waits and sweeps
three times for anything an instance wrote back, then verifies). The `data_deletions` table arrives with the next promote
(migration 010). Make the job once from the promoted image, then run it:

```bash
gcloud run jobs deploy brew-prod-ops --image=<the image brew-web runs> --region=asia-south1 --service-account=brew-prod-runtime@<project>.iam.gserviceaccount.com \
  --network=default --subnet=default --vpc-egress=all-traffic --command=node \
  --set-env-vars="^|^STORAGE=pg|ENV=production|RETIRE_OFF=1|RESEARCH_BUCKET=brew-prod|PROTECTED_CONNECTIONS=arata-in" \
  --set-secrets="DATABASE_URL=BREW_PROD_DATABASE_URL:latest" --max-retries=0 --task-timeout=1800
gcloud run jobs execute brew-prod-ops --region=asia-south1 --args=db/delete-brand.mjs,--slug,<slug> --wait               # dry run
gcloud run jobs execute brew-prod-ops --region=asia-south1 --args=db/delete-brand.mjs,--slug,<slug>,--yes,--request,<ref>,--operator,<name> --wait
```

What still holds a deleted brand for a while, to say in the reply: point-in-time logs (7 days), daily backups (14 kept), the
nightly export (overwritten nightly) and the bucket's 7-day soft delete. A `data_deletions` row with `done_at` empty did not
finish: run the deletion again.

## Alerts

- **Cloud Monitoring** emails param@ and hello@. Uptime: `/`, `/healthz/ready`, `/api/config`. Policies: server errors, many slow requests, worker lost its lease, worker not running, a release job failed, database disk above 85%, connections above 160, CPU above 80%, export failed, unhandled errors, site down.
- **The app** (`alerts.js`): Vertex billing and quota, the AI pause, treg balance, the 5xx rate, Sloosh, worker down (no lease for 4 minutes), and the job queue stuck (a job waiting more than 10 minutes). Each is sent once a day, and the subject names the site.

## Sign-ins and outside settings

Both sites' callback URLs are registered with Google sign-in, Google Ads/GA4, Meta and Slack:
- `/auth/google/callback`
- `/connect/<id>/callback`

The Slack app sends events and buttons to production (`/slack/events`, `/slack/actions`). Production relays a workspace it doesn't serve to staging, unchanged.

Not done yet:
- Sloosh needs a staff sign-in on each site: `/api/ops/sloosh/connect`.
- The public Shopify app moves to production after its review.
