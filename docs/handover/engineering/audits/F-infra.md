# F. Infrastructure, operations, configuration, testing, code health

Audit date: 2026-10-15 (~16:10 IST). Repo `/Users/param/Documents/ChatGPT/brew` at `ea6cfd7`. Read-only: no deploys, edits or spend.

## 0. Headline findings (most important first)

1. **The runtime identity is far too powerful for an app that crawls arbitrary URLs with headless Chromium.** Both `shopos-feed` and `brew-demo` run as the default compute SA `223432117369-compute@developer.gserviceaccount.com`, which holds project-wide `roles/secretmanager.secretAccessor`, `roles/run.admin`, `roles/iam.serviceAccountTokenCreator`, `roles/artifactregistry.writer`, `roles/cloudbuild.builds.builder`, `roles/cloudsql.client`. The project `squareup-492617` holds ~130 unrelated secrets (Supabase prod DB password, Razorpay/Dodo payment keys, `VAULT_MASTER_KEY`, Meta/Shopify app secrets, Discord bot token, GitHub token...). Any RCE/SSRF in Brew = the whole company's secrets plus the ability to redeploy any Cloud Run service. Give Brew its own SA with access only to its 8 secrets, its 2 buckets and Vertex.
2. **HEAD `ea6cfd7` IS live on both sites, and it is pushed.** The brief's revision `00168` is already gone: `shopos-feed-00169-5r6` and `brew-demo-00031-dtw` were both created 2026-10-15T10:39Z (16:09 IST, 4 minutes after the 16:05 commit). Served `public/app.js`, `brew.css`, `jam-room.js`, `live.js` on brew.* and demo.* are byte-identical to `git show HEAD:public/…` (and differ from `7002bcc`). `git ls-remote origin main` = `ea6cfd7`; working tree clean.
3. **No rollback path.** `deploy.sh` and `tools/deploy-demo.sh` delete every non-live revision after each deploy. Only one revision exists per service. Rollback = check out an older commit and redeploy (a ~5-10 min Cloud Build) or re-point at an older image digest in Artifact Registry by hand. Bucket versioning is **off** on both buckets (7-day soft delete only), so data has no rollback either.
4. **Logs are unstructured; severity filters see nothing.** All `console.error/warn` lands on stderr with no severity, so `severity>=ERROR` over the last 24 h returns **0 entries** while stderr held 5,641 lines. No alerting is possible as-is. In the Brew-era revisions (00158+) stderr is quiet (~31 lines): image-guard product mismatches, a memory-learn 400 (PNG sent as `image/jpeg`), one sign-in "no handshake". The 24 h window is dominated by **5,028 lines of `[moves] N failed: budget reached, not started`** from the old feed revisions 00154/00155 (an ops-fresh-reload loop in `build.js freshReload` that re-ticks every 60 s even when the budget is gone; the code is still in brew, gated by `OPS_FRESH_RELOAD`), plus treg 402 `insufficient_balance` storms (2026-10-14 ~11:10Z) and a `DIWALI is not defined` crash in the creative watcher (old revision; `DIWALI` is now only defined in research.js).
5. **Spend caps are mostly in memory and reset on every restart/deploy.** `DAILY_TEXT_CAP`/`DAILY_IMAGE_CAP`/`DAILY_VIDEO_CAP`/`DAILY_VOICE_CAP` (server.js `used`) and `TREG_DAY_CAP_USD` (treg.js `meter`) are per-process counters. ~14 deploys happened on 2026-10-14/15, each resetting them. Only the build day cap (`DAILY_BUILD_CAP_USD`, `_brew/spend-day.json`) and the per-brand scheduler caps (social/drafts/moves/pulse state files) persist. There is no global $ cap on Anthropic: server.js's direct Claude calls are counted by call, not by dollars, and research.js/live-watch.js hold their own unmetered `anthropic` client.
6. **`node_modules` is a symlink to `../feed/node_modules`** (the archived repo). Local dev and the test suite break the moment `feed/` is deleted or its deps change. The image is unaffected (Dockerfile runs `npm ci`; `.dockerignore`/`.gcloudignore` exclude node_modules). Local Node is v24.11.1; the image is `node:22-bookworm-slim`.
7. **64 MB `.npm-cache/` (402 files) is committed to git** and is not in `.dockerignore`/`.gcloudignore`, so it is uploaded to Cloud Build on every deploy. Also committed: `.urlmap-backup.before-arata.yaml` (a full dump of the company load balancer URL map with ~20 unrelated hostnames).
8. **Tests: 222 tests, 219 pass, 0 fail, 3 skipped, 1.2 s** (`AI_MOCK=1 node --test test/*.test.js`). Good unit coverage of pure logic; zero coverage of server.js routing/auth gating as a whole, the reader stages, PDF render, the client (546 KB `public/app.js`), GCS storage, and anything end-to-end. No lint, no typecheck, no CI (no `.github/`), no pre-commit. `deploy.sh` is the only gate; `tools/deploy-demo.sh` **does not run tests at all** and only `node --check`s a subset.
9. **CLAUDE.md's audit tool path is wrong and the tool targets the old system.** `.claude/skills/brew-external-data/audit.py` does not exist in brew/ (no `brew/.claude/skills`). It lives at `/Users/param/Documents/ChatGPT/.claude/skills/brew-external-data/audit.py`, defaults to bucket `squareup-feed` (old), and its `ADS_V` comment points at `feed/reader/stages/ads.js`. The SKILL.md header says Brew is "deployed to feed.joinsquareup.com", which is wrong (brew.joinsquareup.com; feed.* is no longer in the URL map).
10. **Cut features are still wired in.** `POST /api/jams/:jid/whatsapp` ("Thread moved to WhatsApp. The pod replies…"), `POST /api/jams` route=team canned "The ShopOS team has it. Usually replies in 12 to 24 hours", `GET /api/slack/workspace` + `POST /api/slack/post` (canned Slack) are live routes, none in DUMMY.md, all contradicting SCOPE.md's "Fake team flow: cut". `measure-families.js`/`measure-spec.js`/`measure-stats.js` + `data/measure-families.json` remain (imported by moves-engine and jam-brief, so not dead, but named after a cut feature). 104 ShopOS references across 18 files (some via the `brew-name.js` rewrite shim, many in live copy).
11. **Config drift / landmines:** service-level annotation `run.googleapis.com/maxScale: '100'` vs revision `autoscaling.knative.dev/maxScale: '1'` (the code assumes exactly one instance: in-memory tenants, in-memory caps, in-process builds, per-process locks); `video-read.js` defaults `RESEARCH_BUCKET` to `squareup-feed` (old bucket) while every other module defaults to `brew-prototype`; `HANDOFF_SECRET` is unset so share-link signing falls back to `ANTHROPIC_API_KEY` (rotating the API key kills every shared brief link); `APIFY_TOKEN` is not set on Cloud Run (falls back to a CLI token that the container doesn't have, so Apify sources are silently off in prod); demo `BUILD_BLOCK` lacks `everaw-in`.

---

## 1. Architecture

### 1.1 Process model

- One Node process (`node server.js`, ESM, Node 22 in the image), plain `node:http`. No framework. `serve()` tries handlers in a fixed order: demoRoutes (DEMO only) → `auth.handle` → `connectors.handle` → memoryRoutes → movesRoutes → `brandRoutes` → `brandFiles` → `/api/transcribe` → `feedSvc.handle` → `routes{}` table (x-brand) → `/research/*`, `/gen/*` → static `public/` → page fallback (`/` landing, `/<slug>` brand page; unknown slug falls back to the landing).
- Cloud Run: 2 vCPU, 4 GiB, `--no-cpu-throttling` (CPU always on), `--min=1`, `--max-instances=1`, `--timeout=3600`, `--concurrency=200`, startup CPU boost on, TCP startup probe 240 s, ingress `all` (the `*.run.app` URLs are reachable directly, bypassing the LB).
- Builds (the read, brief, 51 moves, PDFs) run **in the server process** (`build.js`), resumed at boot by `builder.resumeAll()` unless `BUILD_RESUME_OFF`. A deploy or crash mid-build relies on resume.
- **Single-instance assumptions everywhere:** tenants live in an in-memory Map (`feed-service.js tenants`) with write-behind to disk + GCS; the `viewerOf` MEMO cache; spend counters; `busy` sets in schedulers; `retire.js` revision handover. Two instances would double-run schedulers and race on tenant files (last writer wins, no generation preconditions on GCS writes).
- `retire.js` (still active, despite memory notes calling it archived): each instance writes `gs://brew-prototype/control/live.json` on first request; older revisions see a higher `n` and monkey-patch `globalThis.fetch` to throw, then `process.exit(0)` after a grace period. Live marker: `{"rev":"shopos-feed-00169-5r6","n":169,"wipe":[]}`. `tools/reset-brand.sh` uses it to "stop" instances and hide brands while wiping.

### 1.2 Background timers (all in-process)

| Where | Cadence | What |
|---|---|---|
| server.js:387 | every 30 min (+5 min after boot) | `evidenceTick`: market pulse (≤2 brands/tick, once a day each), weekly top-video read, weekly calendar date confirm |
| server.js:413 | every 60 min (+90 s) | `storiesWarm`: attaches research/live watchers for brands opened in the last 3 days |
| server.js:419 | every 3 min | `packs.refreshDrafts()` (re-read drafts from bucket) |
| feed-service.js:682 | every 5 s | feed `tick` (one at a time) |
| feed-service.js:684 | every 20 s | save tenants seen in the last 15 min |
| research.js:351 | per brand, every 30 min (+5 s) | story rings (ads, trends, news, howto) |
| live-watch.js:199 | per brand, every 15 min (+8 s) | catalog + AI-answer watchers |
| build.js:843 | every 60 min | weekly refresh check (`REFRESH_*`) |
| build.js:861-873 | 60 s / 120 s self-rescheduling | `freshReload` ops loop (only with `OPS_FRESH_RELOAD`) — the log-storm source |
| facts-desk.js:298 | every 60 min (+4 min) | daily price/stock check |
| social-feed.js (SOCIAL_DEFAULTS.tickMs) | every 30 min (+2 min) | listening + ideas |
| drafts-bg.js (DRAFTS_DEFAULTS.tickMs) | every 30 min (+4 min) | first drafts |
| moves-cadence.js (MOVES_DEFAULTS.tickMs) | every 60 min (+6 min) | weekly listening/automation moves |
| retire.js:48 | `everyMs` | read `control/live.json` |
| jam-brief.js:194, `attach()` setTimeouts | ad hoc | brief folding, margin notes (+5 s), move grades (+8 s) |

Per brand that's attached: 2 extra intervals (research, live). Watchers are stopped when a brand's config key changes (`attach`), but `INST` is never pruned, so every brand ever opened keeps its watchers running until restart.

### 1.3 Storage

- **Local disk** (ephemeral container FS): `.brands/<slug>/` (pack cache), `.tenants/<id>.json`, `public/gen/`, `public/research/`, `os.tmpdir()` photo caches.
- **GCS** (`RESEARCH_BUCKET`, only when `K_SERVICE` is set): `brands/<slug>/…` (packs: status, seed, moves, pdf, private/, listen/, pulse/, spend/ …), `tenants/<id>.json` (10 objects, 2.4 MiB; each workspace ~250 KB), `gen/` (generated media), `research-media/`, `_cache/` (treg 24 h cache), `control/live.json`. Prod bucket brands: `_brew`, `arata-in`, `gullylabs-com` (state "Reading" on `/api/brands`). Demo bucket: `_brew`, `arata-in`. Each bucket ~318 MB. Versioning **off**, soft delete 7 days, uniform access on.
- Access is raw REST with a metadata-server token (three separate `gToken` implementations: server.js, vertex-media.js, video-read.js; eight modules hand-roll `storage.googleapis.com` calls: brand-pack, gen-store, live-watch, retire, research, video-read, store, treg).
- `store.js`: tenants are debounced 1.5 s, written to disk then fire-and-forget to GCS (failures only logged). `gen-store.js`: uploads retried with backoff; `genFlush()` waits for in-flight copies.
- No locking or `ifGenerationMatch` anywhere: safe only because max instances = 1.

### 1.4 Image, ignores, deps

- `Dockerfile`: `node:22-bookworm-slim` (tag, not digest) + apt `ffmpeg chromium fonts-*` (unpinned). `npm ci --omit=dev`. Copies `*.js` + reader, connectors, dummy, pdf, skills, prompts, data, sources/moves, public. `tools/` and `test/` excluded. `CHROME_PATH=/usr/bin/chromium`, `PUPPETEER_SKIP_DOWNLOAD=1`.
- `.dockerignore` = `.gcloudignore` (identical): `.git node_modules .brands .tenants .research public/gen public/research assets-orig data.orig.js tools test .claude`. **Missing: `.npm-cache/` (64 MB), `docs/`, `.urlmap-backup…yaml`, `*.md`.** The two `assets-orig/` and `data.orig.js` entries are leftovers from feed.
- `package.json`: name `brew-feed`; deps `@anthropic-ai/sdk ^0.133.0` (installed 0.133.0), `date-holidays ^3.37.0`, `puppeteer-core ^23.11.1`; devDeps `acorn`, `acorn-walk`. `package-lock.json` byte-identical to `../feed/package-lock.json`. Three runtime deps is lean; everything else is hand-rolled (HTTP, GCS, OAuth, SSE, compression, routing).
- `node_modules -> /Users/param/Documents/ChatGPT/feed/node_modules` (absolute symlink, gitignored). Fix: `rm node_modules && npm ci` inside brew/.

---

## 2. Route table

Auth legend:
- **public**: no sign-in.
- **gen**: `genOk` — signed-in member, Brew admin/full-access domain (`joinsquareup.com`, `shopos.ai`), or an official-domain email on an unclaimed brand. Always true when sign-in is off (`FEED_SIGNIN=0`/no `GOOGLE_CLIENT_ID`), in `DEMO_MODE=1`, or with `DEV_MEMBER=1` locally.
- **team-if-claimed**: allowed when the brand is unclaimed **or** the viewer is a member (so on an unclaimed brand, anyone, even signed-out, can write).
- **tenant**: needs a workspace id `t_<8 hex>` (32 random bits; the id is the bearer key) in the path or `x-tenant`; non-GET routes also need gen unless listed in `DEMO_OK`.
- **signin**: any signed-in Google user.
- **admin**: `ADMIN_EMAILS` or full-access domain.

### 2.1 server.js own routes

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | /api/research | public (x-brand) | `routes` → `B().research.get()` |
| POST | /api/research/refresh | gen | `routes` → research.refresh |
| GET | /api/config | public | caps + today's in-memory usage (leaks counters) |
| POST | /api/config | admin | flip AI mock/live in memory |
| POST | /api/ai/hearted | gen | Claude (direct client), 3 variants |
| POST | /api/ai/remix-image | gen | Gemini/OpenAI image edit |
| POST | /api/ai/jam | gen | `jamStream` (streamed Claude) |
| GET | /api/slack/workspace | public | **canned Slack (cut feature, not in DUMMY.md)** |
| POST | /api/slack/post | public (the gen gate only covers `/api/ai/*`) | **canned Slack post** |
| POST | /api/transcribe | public, 80/hr per IP, 15 MB | OpenAI `gpt-4o-transcribe` (paid, unauthenticated) |
| POST | /api/brands | public read; `fresh` re-read needs signin; 1 brand/hr/network, 3/day/user | `builder.start` |
| GET | /api/brands | public | `builder.list()` — lists every brand |
| GET | /api/demo-brands | public | fetches demo site `/api/demo/brands` (10 min cache) |
| GET | /api/brands/:slug/told | public | learned.json view |
| GET | /api/brands/:slug/heard | public | listening view + schedule/spend |
| GET | /api/brands/:slug/heard/items | public | listen items |
| GET | /api/brands/:slug/heard/history | public | listen history |
| GET/POST | /api/brands/:slug/heard/asked | GET public; POST team-if-claimed | asked threads |
| GET | /api/brands/:slug/calendar | public | calendar.upcoming |
| GET | /api/admin/treg | admin | new treg tools + month spend |
| GET | /api/brands/:slug/moves/:n | public (private version for members) | move doc |
| GET/POST | /api/brands/:slug/facts | GET public; POST team-if-claimed | facts-desk |
| GET | /api/brands/:slug/status | public | builder.status |
| GET | /api/brands/:slug/summary | public | builder.summary |
| POST | /api/brands/:slug/notify | public | builder.addEmail (stores an email to notify) |
| GET | /api/brands/:slug/findings | public | findings.json |
| POST | /api/brands/:slug/confirm | gen + signin (claims the brand) | builder.confirm → brief + moves (the expensive step) |
| GET | /api/brands/:slug/build | public | builder.buildInfo |
| GET/POST | /api/brands/:slug/updates | GET public; POST gen | check / rewrite / auto |
| POST | /api/brands/:slug/retry | gen | builder.retry |
| POST | /api/brands/:slug/pro | gen | builder.goPro (dummy Pro: lifts the build cap) |
| GET/POST | /api/brands/:slug/check | GET public; POST gen + signin | checkData / applyCheck |
| GET | /api/brands/:slug/moves | public (+private for members) | move list |
| GET | /api/brands/:slug/events | public | SSE build stream |
| GET | /b/:slug/seed.js, /b/:slug/facts.js | public | pack client scripts |
| GET | /b/:slug/a/:file, /b/:slug/statics/:file | public | brand assets |
| GET | /b/:slug/pdf/:name | public (private PDFs for members) | move PDFs/zips |
| GET | /research/:file, /gen/:file | public | bucket-backed media |
| GET | /*, /:slug | public | static files / page |

### 2.2 auth.js

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /auth/google | public | PKCE + nonce, state signed |
| GET | /auth/google/callback | public | sets `fs_s` 30-day signed cookie |
| GET/POST | /auth/logout | public | |
| GET/POST | /auth/approve | public | legacy page ("access is by invite now") |
| GET | /join?t= | public → signin | invite accept |
| GET | /api/me | public | user, claim info |
| POST | /api/brands/:slug/claim | signin | claim |
| POST | /api/brands/:slug/request | signin | access request |
| GET/POST | /api/brands/:slug/team | owner/admin of brand | invite (Resend email), seats, remove, make_owner… |

### 2.3 connectors/index.js (DUMMY)

| Method | Path | Auth |
|---|---|---|
| GET | /connect/:id/start?brand= | signin (redirects to Google otherwise) |
| GET | /api/brands/:slug/live | public (member view if member) |
| POST | /api/brands/:slug/connect/:id | signin + gen; sync/disconnect need member |

### 2.4 memory-routes.js

| Method | Path | Auth |
|---|---|---|
| GET | /api/brands/:slug/memory[?q=] | public |
| POST | /api/brands/:slug/memory | team-if-claimed |
| DELETE | /api/brands/:slug/memory/m_<id> | team-if-claimed |
| POST | /api/brands/:slug/memory/learn | team-if-claimed (runs AI: `learnFromLive`) |
| POST | /api/brands/:slug/memory/consolidate | team-if-claimed (runs AI) |

Note: on an unclaimed brand, an anonymous visitor can add/delete brand memory and trigger paid AI here (no gen check).

### 2.5 moves-cadence.js

| Method | Path | Auth |
|---|---|---|
| GET | /api/brands/:slug/moves/cadence | public |
| POST | /api/brands/:slug/moves/refresh | gen (weekly $ cap) |

### 2.6 feed-service.js + remix.js + jam-brief.js + drafts.js (tenant routes, `on(...)`)

Gate for all: valid tenant; writes need gen unless in `DEMO_OK` (marked ◦). `POST /api/tenants` (create) is ◦, so anyone can create unlimited workspaces (each a GCS file).

| Method | Path | File:line |
|---|---|---|
| GET | /h/:token | feed-service 1438 (public read-only brief, `?full=1`) |
| GET | /api/share/:token | feed-service 1447 (signin; joins the team) |
| POST ◦ | /api/tenants | 1058 |
| GET | /api/tenants/:id/onboarding (SSE) | 1059 |
| POST ◦ | /api/tenants/:id/ready | 1060 |
| GET | /api/tenants/:id/feed-config | 1061 |
| POST | /api/tenants/:id/focus | 1066 |
| PUT ◦ | /api/tenants/:id/state | 1088 |
| GET | /api/tenants/:id/feed | 1101 |
| GET | /api/tenants/:id/deck | 1102 |
| PUT ◦ | /api/tenants/:id/deck-layout | 1107 |
| GET | /api/tenants/:id/stories | 1108 |
| POST ◦ | /api/tenants/:id/stories/:ring/seen | 1109 |
| POST | /api/tenants/:id/research-card | 1111 |
| POST ◦ | /api/tenants/:id/pin | 1121 |
| GET | /api/tenants/:id/pulse | 1126 |
| POST ◦ | /api/tenants/:id/events | 1131 |
| POST ◦ | /api/tenants/:id/cards | 1132 |
| GET | /api/cards/:cid | 1140 |
| POST ◦ | /api/cards/:cid/feedback | 1141 |
| POST | /api/cards/:cid/actions | 1158 |
| POST | /api/cards/:cid/image | 1164 |
| POST | /api/cards/:cid/versions | 1176 |
| POST | /api/jams | 1184 (route=team → canned "ShopOS team" reply: cut feature) |
| POST ◦ | /api/jams/:jid/whatsapp | 1200 (**cut feature**: "Thread moved to WhatsApp") |
| GET | /api/tenants/:id/engine | 1201 |
| POST | /api/tenants/:id/watchers/:wid/run | 1202 |
| POST | /api/tenants/:id/watchers/run-all | 1209 |
| POST ◦ | /api/tenants/:id/clock | 1210 (advances a simulated clock and runs all watchers incl. the AI creative one — ◦ means a demo viewer can trigger AI here) |
| GET | /api/tenants/:id/work | 1235 |
| POST ◦ | /api/work/:wid/discard, /restore | 1237, 1245 |
| POST ◦ | /api/tenants/:id/notes/clear, /notes/read | 1251, 1252 |
| POST ◦ | /api/work | 1253 |
| POST | /api/work/:wid/iterate | 1264 |
| POST ◦ | /api/work/:wid/pick, /edit, /version | 1285, 1292, 1293 |
| POST | /api/work/:wid/send | 1296 (DUMMY teammate reply) |
| POST | /api/work/:wid/message | 1305 |
| POST ◦ | /api/work/:wid/approve, /reopen | 1311, 1312 |
| POST ◦ | /api/work/:wid/decided; /api/cards/:cid/decided | 1367, 1369 |
| GET | /api/tenants/:id/share | 1374 |
| GET | /api/work/:wid/handoff | 1375 |
| GET | /api/cards/:cid/learned, /page, /moves | 1393-1396 |
| POST | /api/work/:wid/reference, /link-change, /canvas | 1033-1045 |
| GET | /api/cards/:cid/remix, /batch | remix 721, 753 |
| POST | /api/cards/:cid/batch/queue, /remix | remix 763, 791 |
| POST ◦ | /api/changes/:chid/pick, /open | remix 757, 817 |
| GET | /api/tenants/:id/remixes | remix 818 |
| GET | /api/changes/:chid, /photos | remix 838, 947 |
| POST | /api/changes/:chid/more, /variants, /plan, /checks, /iterate, /knob, /image, /photo, /jam | remix 841-994 |
| POST ◦ | /api/changes/:chid/notes, /edit, /restore, /discard | remix 893, 969, 978, 988 |
| GET | /api/tenants/:id/versions/:oid, /learning | remix 1008, 1009 |
| PUT ◦ | /api/tenants/:id/learning/lessons/:lid, /learning/rules/:rid | remix 1010, 1020 |
| POST ◦ | /api/tenants/:id/learning/rules | remix 1015 |
| POST | /api/work/:wid/plan/answer, /plan/add, /plan/ask | remix 1029-1053 |
| GET | /api/cards/:cid/brief | jam-brief 202 |
| POST | /api/work/:wid/jb, /doc, /doc/sync, /doc/ask, /doc/add, /jb/import, /doc/ship | jam-brief 203-254 |
| POST ◦ | /api/work/:wid/jb/move | jam-brief 234 |
| POST | /api/work/:wid/draft | drafts 150 |
| POST ◦ | /api/work/:wid/draft/:did/drop | drafts 157 |

(The `DEMO_OK` regex also allows `/changes/:id/undo` and `/work/:id/live`, which have no route.)

### 2.7 demo-routes.js (only when `DEMO_MODE=1`; checked first)

| Method | Path | Auth |
|---|---|---|
| GET | /, /index.html | public (picker) |
| GET | /tour/:slug | public (new session) |
| GET | /api/demo/brands | public (admins see unready brands) |
| GET | /api/demo/:slug/session | public |
| POST | /api/demo/:slug/start, /connect | public (simulated connectors) |
| GET/POST | /api/demo/:slug/prepare | POST admin |
| POST | /api/brands | non-admins get existing brand or an error |
| GET/POST | /api/brands/:slug/status, /confirm, /check, /updates, /retry | simulated for the session; updates/retry admin-only |

Total: ~150 routes across 9 modules, hand-matched with regexes in each module. There is no single route registry, so "which routes exist" can only be answered by reading all of them.

---

## 3. Configuration

### 3.1 Every env var read (88 via `process.env.X`, plus ~25 via the `env` object in scheduler config)

Set-where codes: **P** = deploy.sh env, **D** = deploy-demo.sh env, **S** = Secret Manager (both unless noted), **CR** = Cloud Run injects, — = default only.

| Var | Default | Purpose | Read in | Set |
|---|---|---|---|---|
| PORT | 4200 | listen port | server | CR (8080) |
| K_SERVICE | — | "on Cloud Run": turns on GCS, background jobs | 11 files | CR |
| K_REVISION | — | revision number for retire.js | retire | CR |
| ENV_FILE | `../ugc-factory/.env` | local key file (cross-repo dependency) | server, tools | — |
| AI_MOCK | off | free scripted AI | ai, build, facts-desk, adlib, server, tools | — |
| ANTHROPIC_API_KEY | '' (→ mock) | Claude | ai, handoff, server | S |
| OPENAI_API_KEY | '' | gpt-image edits, transcription | server | S |
| FEED_CLAUDE_MODEL | claude-sonnet-5-5 | jam/card model | server | — |
| GOOGLE_CLOUD_PROJECT | squareup-492617 | Vertex | server, vertex-media, video-read | P, D |
| GEMINI_IMAGE_MODEL | gemini-3-pro-image | images | server | P, D |
| GEMINI_IMAGE_FALLBACK | gemini-2.5-flash-image | image fallback | server | — |
| WATCHER_IMAGE_MODEL | gemini-2.5-flash-image | story/watcher images | feed-service, research | — |
| IMAGE_CHECK | on | product-match vision check | server | — |
| IMAGE_CHECK_MODEL | claude-haiku-5-5 | vision check model | server | — |
| VEO_MODEL / VEO_LOCATION | veo-3.1-fast-generate-001 / us-central1 | video drafts | vertex-media | — |
| TTS_MODEL | gemini-2.5-flash-tts | voice | vertex-media | — |
| VIDEO_MODEL / VERTEX_LOCATION / VIDEO_VERTEX | — / global / on | video reads | video-read | — |
| FFMPEG | ffmpeg | | video-read | — |
| CHROME_PATH | (image: /usr/bin/chromium) | PDFs, checkout walk | pdf/render, reader/site | Dockerfile |
| DAILY_TEXT_CAP | 400 | server.js Claude calls/day (in memory) | server | P/D 1500 |
| DAILY_IMAGE_CAP | 60 | images/day (in memory) | server | P/D 120 |
| DAILY_VIDEO_CAP | 15 | videos/day (in memory) | server | D 15 |
| DAILY_VOICE_CAP | 60 | voice/day (in memory) | server | — |
| RESEARCH_BUCKET | brew-prototype (**squareup-feed in video-read.js**) | the bucket | server, research, live-watch, video-read | P brew-prototype, D brew-prototype-demo |
| TREG_TOKEN | — | treg | treg, research, live-watch | S |
| TREG_ORG | squareup | | treg, research, live-watch | P, D |
| TREG_DAY_CAP_USD | 25 | treg $/day (in memory) | treg | P 40, D 15 |
| TREG_CACHE_HOURS | 24 | | treg | — |
| TREG_OFF | off | | treg, social | — |
| APIFY_TOKEN / APIFY_OFF | CLI token / off | Nykaa/Flipkart/Myntra | apify | **not set** |
| YOUTUBE_API_KEY | — | | listen-watch, socials | S |
| ADLIB_OFF | off | free Ad Library reader | adlib | — |
| BUILD_CAP_USD | 120 | $ per brand build | build | P 60, D 120 |
| BUILD_CAP_PRO_USD | max(150, 2.5×cap) | after dummy Pro | build | — |
| DAILY_BUILD_CAP_USD | 200 | $/day all builds (persisted) | build | P 250, D 200 |
| BUILD_PER_USER_DAY | 3 | | build | — |
| BUILD_NO_IP_LIMIT | off | | build | — |
| BUILD_CONFIRM_WAIT_MS | 15 min | | build | — |
| BUILD_BLOCK | '' | slugs refused | build | P `wearcomet-in,everaw-in`, D `wearcomet-in` |
| BUILD_RESUME_OFF | off | | build, server | — |
| BUILD_SIGNIN | on | sign-in before building | server | P, D =1 |
| MOVES_CONCURRENCY | 6 | | build | P, D |
| MOVES_EFFORT / MOVES_SEARCH | high / 2 | | build | — |
| REFRESH_AUTO / _MAX / _CAP_USD | on / 6 / 14 | auto rewrites | build | D REFRESH_AUTO=0 |
| REFRESH_CAP_USD / REFRESH_EVERY_DAYS / REFRESH_RETRY_MS | 60 / 7 / 24 h | | build | — |
| HEAL_OFF | off | saved-read healing | build | — |
| OPS_FRESH_RELOAD | '' | one-off ops loop per slug | build | — (source of the log storm) |
| TRUSTED_PROXY_HOPS | 0 | client IP from XFF | build | P, D =1 |
| PUBLIC_URL | https://brew.joinsquareup.com | links in emails/briefs | auth, build, demo-routes, handoff | P, D |
| NOTIFY_FROM | `Brew <hello@send.joinsquareup.com>` | Resend sender | auth, build | — |
| RESEND_API_KEY | — | invites, "your brand is ready" emails | auth, build | S (prod only; demo has none) |
| FEED_SESSION_SECRET | 'local-dev-session-secret' off Cloud Run, '' on it | cookie signing | auth | S |
| GOOGLE_CLIENT_ID / _SECRET | — | sign-in (off when unset) | auth, server | S |
| FEED_SIGNIN | on | 0 = no sign-in, everything open | auth, server | P, D =1 |
| ADMIN_EMAILS | '' | admins | auth | P, D |
| FULL_ACCESS_DOMAINS | `joinsquareup.com,shopos.ai` | staff domains | auth | — |
| HANDOFF_SECRET | **ANTHROPIC_API_KEY**, else 'local' | brief share-link HMAC | handoff | **not set** |
| DEMO_MODE | off | demo site | auth, demo-mode, feed-service, server | D =1 |
| DEMO_URL | https://demo.joinsquareup.com | landing's demo brands | server | — |
| DEV_MEMBER / DEV_SEATS | off | local: member of everything | server | — |
| BRAND_MEMORY / BRAND_MEMORY_AUTOLEARN | on / on | | server, brand-memory | — |
| EVIDENCE_OFF | off | pulse/video/calendar tick | server | — |
| SOCIAL_BG | — | force background on/off locally | server, social | — |
| STORIES_BG | on | | server | — |
| NOTES_BG / NOTES_OFF | — | margin notes | server, notes | — |
| MOVE_VALUE_OFF | off | move grades | value | — |
| FACTS_BG / FACTS_DAILY_OFF | — | daily facts check | facts-desk | — |
| RESEARCH_OFF / LIVE_OFF | — | local switches | research, live-watch, server, schedulers | — |
| RETIRE_OFF | off | | retire | — |
| SOCIAL_CARDS | on | | brand-pack | — |
| STORY_CUT | 0.45 | | feed-service | — |
| PULSE_CAP_USD | 3 | per brand per run | market-pulse | — |
| LISTEN_RUN_CAP_USD | 0.6 | | listen-watch, social | — |
| SOCIAL_DAY_CAP_USD | 3 (comment in server.js says $2) | per brand/day | social-feed | D 2 |
| IDEAS_N, LISTEN_EVERY_H, IDEAS_EVERY_H, LISTEN_LITE_CAP_USD, LISTEN_FULL_EVERY_H, LISTEN_OFF, IDEAS_OFF, LISTEN_PAID | see SOCIAL_DEFAULTS | | social-feed | — |
| DRAFTS_DAY_CAP_USD | 4 | per brand/day | drafts-bg | D 4 |
| DRAFTS_TOP_N, DRAFTS_PER_RUN, DRAFTS_IMAGE_USD, … DRAFTS_BG, DRAFTS_BG_OFF | see DRAFTS_DEFAULTS | | drafts-bg | — |
| MOVES_WEEK_CAP_USD | 3 | per brand/week | moves-cadence | — |
| MOVES_EVERY_DAYS, MOVES_REFRESH_OFF, MOVES_BG | 7 / off / — | | moves-cadence | D MOVES_REFRESH_OFF=1 |
| LEARN_MAX_CHARS, LEARN_CHUNK_CHARS, LEARN_REWRITE_MAX, LEARN_DAY_MAX | 120000 / 14000 / 4 / 12 | | brand-learnings | — |

Secrets mounted (prod): ANTHROPIC_API_KEY, OPENAI_API_KEY, TREG_TOKEN, YOUTUBE_API_KEY, RESEND_API_KEY, FEED_SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (all `:latest`). Demo: same minus RESEND. Both services share the same session secret and OAuth client, so a `fs_s` cookie is valid on both hosts (separate cookie domains, but the token itself is portable). Unused leftovers in Secret Manager from the cut features: `FEED_SHOPIFY_CLIENT_ID/SECRET`, `FEED_VAULT_KEY`, `PAGESPEED_API_KEY`.

### 3.2 Live vs deploy script (drift)

- `shopos-feed` live env matches `deploy.sh` exactly (with its defaults for `DAILY_BUILD_CAP_USD=250`, `ADMIN_EMAILS`, `BUILD_SIGNIN`, `TRUSTED_PROXY_HOPS`, `FEED_SIGNIN`). `brew-demo` matches `deploy-demo.sh`.
- Drift: service metadata `run.googleapis.com/maxScale: '100'` and `minScale: '1'` vs template `autoscaling.knative.dev/maxScale: '1'`. The revision setting wins today, but the service-level ceiling of 100 is a trap if anyone deploys without `--max-instances=1` (e.g. a console edit). Pin both.
- Prod vs demo caps differ in ways that look accidental: prod `BUILD_CAP_USD=60` vs demo 120; prod `TREG_DAY_CAP_USD=40` vs demo 15; prod `DAILY_VIDEO_CAP` unset (15 default).
- Labels `cache-reset: '1791973343'` on both: a manual cache-bust marker, undocumented.

---

## 4. Deploy and operations

- **deploy.sh**: refuses a dirty tree; `node --check` on root, reader, stages, connectors, dummy, pdf, public JS; checks folders exist; runs the test suite (output discarded); `gcloud run deploy --source .` (Cloud Build, ~5-10 min); greps output for ERROR; **deletes every other revision**; curls `/`, `/arata-in`, `/api/config` for status codes. It does not push to git, tag a release, or record the deployed SHA anywhere (no `GIT_SHA` env, no image label). The only way to know what is live is to diff served files, as done here.
- **tools/deploy-demo.sh**: same deploy shape for `brew-demo`; **no tests**, checks only `*.js connectors dummy public` (not reader/, pdf/). Also deletes old revisions.
- **tools/demo-sync.sh**: `gcloud storage rsync` prod → demo bucket per slug, excluding private/memory/spend/demo/notify.json/connected-ledger.json; belt-and-braces deletes and a check; clears private/live stale flags in `updates.json`. Sound. Packs are cached per instance, so a demo redeploy or reopen is needed afterwards.
- **tools/reset-brand.sh**: writes a "stop" to `control/live.json` (retire.js kills every instance within ~15 s), wipes `brands/<slug>` and matching `tenants/*.json` (archived to `_deleted/<time>/` unless `NO_ARCHIVE=1`), sweeps 3× for resurrected files, stops once more. Hard-coded to prod (`shopos-feed`, `gs://brew-prototype`). Destructive, causes downtime (instance restarts), no confirmation prompt.
- **tools/prepare-pack.mjs**: local-only transform of a pack from the old feed to prototype scope (retires audit moves, makes automation moves plan-only, deletes private/, spend/, notify.json, pagespeed.json). Idempotent.
- `tools/read_brand.mjs`, `tools/write_moves.mjs`: older CLI drivers (read `ENV_FILE`); not referenced by docs.
- **DNS / LB**: `squareup-urlmap` (global external HTTPS LB, shared with the rest of the company) routes `brew.joinsquareup.com` → `shopos-feed-backend` → `shopos-feed-neg` (serverless NEG, asia-south1) and `demo.joinsquareup.com` → `brew-demo-backend` → `brew-demo-neg`. No Cloud CDN, no Cloud Armor policy, no IAP, no backend logging. feed.*, arata.*, arata-v1.*, feed-demo.* are no longer in the URL map. DNS itself is presumably Cloudflare (Cloudflare tokens exist in Secret Manager; no notes in the repo). Ingress is `all`, so `shopos-feed-223432117369.asia-south1.run.app` serves the app directly, bypassing the LB.
- **Rollback**: none built in (revisions deleted, bucket unversioned). Practical path: `git checkout <sha> && ./deploy.sh` from a clean worktree, or `gcloud run deploy shopos-feed --image=asia-south1-docker.pkg.dev/squareup-492617/cloud-run-source-deploy/shopos-feed@<older digest>` (older images remain in Artifact Registry; untested). Data: 7-day soft delete only.
- **Logs (last 24 h, shopos-feed)**: see headline 4. Classes: (a) moves budget loop 5,028 lines (old revisions 00154-00156, 2026-10-14 18:00-22:30Z); (b) treg failures incl. 402 `insufficient_balance` (~300 lines; research ads/trends/rising, listen sources); (c) image-guard product mismatches (~40; working as designed, falls back to the real photo); (d) retire.js "instance is retired" GCS refusals during handovers (~80; expected); (e) real bugs: `[creative watcher] DIWALI is not defined` (old rev), `[research] howto image EISDIR` (old rev), `[ideas] write chunk 400 … not valid JSON: unexpected end of hex escape` (fixed since by `wellFormed` in ai.js), `[memory] learn 400 … image/jpeg but … image/png` (rev 00167, **current code**: brand-memory.js:371 picks media type by file extension, not bytes), `[verify] fix failed: bad JSON … max_tokens`.
- **Cost caps (effective in prod)**: builds $60/brand, $250/day all builds (persisted); treg $40/day (in memory); server.js text 1500 calls/day, images 120/day, video 15/day, voice 60/day (in memory, per process); per brand: social $3/day, drafts $4/day, pulse $3/run, moves $3/week, listening $0.60/run. Uncapped: Claude calls from research.js/live-watch.js direct clients (count-capped only where they pass through `spend()`), OpenAI transcription (80/hr/IP only), memory learn/consolidate.

---

## 5. Tests

`AI_MOCK=1 node --test test/*.test.js` → **tests 222, pass 219, fail 0, cancelled 0, skipped 3, duration 1.22 s.** Skips:
- "on the server, every card's action opens its jam on the plan…" — `# no .brands/ here` (needs a local pack)
- "Chromium renders the mocks at 1080 x 1350" — `# Chrome could not start here`
- "live: every declared treg endpoint exists in the catalog" — live network, skipped

Files and what they cover (34 test files):

| File | Tests | Covers |
|---|---|---|
| adlib-fallback | 3 | reader/adlib.js free fallback |
| audit-fixes | 9 | brand-pack, brief, build regressions |
| audit-server-fixes | 6 | cards-gen, demo-data, feed-service, studio, text-fit |
| brand-learnings | 15 | learnings → brief/memory/moves |
| brand-memory | 8 | memory + learn hooks |
| cadence-refresh | 6 | ai, feed-service, live-watch, research refresh |
| card-action-map | 5 | remix, seed-template, studio action mapping |
| card-plan | 8 | card-plan, jam-brief, remix, studio |
| claim-rules | 4 | auth claim rules |
| demo-mode | 4 | brand-pack + connectors/sim |
| facts-desk | 5 | facts sheet |
| first-drafts | 8 | drafts, drafts-bg, draft-mocks |
| image-fallback | 6 | image guard fallback, gen-store |
| image-guard | 5 | image-guard |
| jam-coverage | 2 | measure-families coverage |
| learned-rank | 2 | ea6cfd7 ranking marker |
| listen-ideas-wiring | 19 | apify, listen-watch, social-feed, remix, studio |
| listen-signals | 11 | listen-watch, social-feed |
| measure-families / measure-stats | 6 / 7 | modules of the cut measurement feature |
| moves-cadence | 13 | weekly moves scheduler |
| moves-evidence | 6 | moves-engine evidence |
| notes / product-match / value / stories-life | 4 / 4 / 4 / 5 | small modules |
| pulse-calendar-video | 10 | market-pulse, calendar, video-read, treg |
| reader-retry | 2 | reader/index retry |
| retire | 3 | retire.js |
| security-fixes | 7 | auth, connectors, member-ctx |
| team-seats | 11 | auth seats/invites |
| treg-cache / treg-map | 4 / 6 | treg client cache, capability map |
| ui-audit-r3 | 4 | text-fit |

Paid probes (never run by the suite): `test/cadence-probe.mjs`, `test/ideas-probe.mjs`, `test/listen-probe.mjs`, `test/memory-probe.mjs`. Plus `/Users/param/Documents/ChatGPT/.claude/skills/brew-external-data/heal-test.mjs` outside the repo.

Notably untested: server.js routing order and auth gating end-to-end (no test boots the server or asserts which routes are public); reader stages (`reader/stages/*.js`, 9 files, ~150 KB) except retry and adlib fallback; build.js pipeline beyond regressions; PDF rendering (pdf/); GCS paths (store.js, gen-store.js remote mode, brand-pack remote); handoff.js and `/h/` pages; the 546 KB client `public/app.js` plus jam-room/canvas/composer/live (zero tests); demo-routes.js; Dockerfile build; anything against the live site. No smoke test beyond deploy.sh's three curls.

`audit.py`: does **not** exist at the path CLAUDE.md gives (`brew/.claude/skills/...`). It exists at `/Users/param/Documents/ChatGPT/.claude/skills/brew-external-data/audit.py` and must be run as `python3 audit.py brew-prototype` (default bucket `squareup-feed` is the archived one).

---

## 6. Code health

- **Size**: ~17,100 lines of server JS (excl. tests/public), 5,200 lines of client JS, 3,600 lines of tests; 3.46 MB of JS/CSS/HTML. Biggest: `public/app.js` 546 KB / 4,099 lines; `public/brew.css` 214 KB; `feed-service.js` 171 KB / 1,483 lines; `remix.js` 127 KB; `listen-watch.js` 100 KB; `build.js` 96 KB; `server.js` 70 KB; `studio.js`, `moves-engine.js`, `moves-cadence.js`, `brand-memory.js`, `ideas.js` 50-63 KB each.
- **Density is the real problem**: average line ~118 chars in feed-service.js and ~136 in app.js; max lines 1,227 (app.js), 1,425 (feed-service.js), 1,367 (remix.js); 321 lines over 300 chars in app.js, 83 in feed-service.js. Many functions are one-line chains of ternaries and side effects. This is hard to review, diff and debug.
- **No tooling**: no ESLint, no Prettier, no TypeScript/JSDoc types, no `jsconfig`, no CI (`.github/` absent), no pre-commit hook. `node --check` (syntax only) in deploy.sh is the only static check.
- **TODO/FIXME/HACK**: 0 (the codebase uses prose comments instead). `DUMMY:` markers: 16.
- **Cut-feature residue** (grep counts across server + client JS): WhatsApp 131 lines in 23 files; Klaviyo 45/19; "measure" 185/28; Slack 74/13; ShopOS 104/18; undo/action tray/agent runner 34/9; routines 15/5; programs 4/2; retire 62/11 (live mechanism, not dead); `Do it now` 0; `feed.joinsquareup` 0; `arata` hard-codes 1. Live cut-feature routes: `/api/jams/:jid/whatsapp`, `/api/jams` team reply, `/api/slack/*`. `brew-name.js` rewrites "ShopOS" to "Brew" on every pack/tenant read (a permanent runtime shim instead of a one-off data migration). The `store.js` comment references a `history.js` that doesn't exist.
- **Duplicated logic**: two `strictSchema` implementations (ai.js adds `required`, server.js does not); three metadata-token fetchers; eight hand-rolled GCS REST clients; three treg auth paths (treg.js plus fallbacks in research.js and live-watch.js that bypass the shared client and cache when `tregClient` is null, contrary to CLAUDE.md); two Anthropic client stacks (metered `ai.js` vs raw SDK in server/research/live-watch); eight copies of a browser User-Agent string.
- **Committed junk**: `.npm-cache/` (64 MB, 402 files), `.urlmap-backup.before-arata.yaml`, empty `public/.claude/.cc-writes/`.
- **Small security/ops notes for the security auditor**: tenant ids are 32-bit and act as bearer keys; `POST /api/tenants` is open to anyone (unbounded GCS files); `/api/transcribe` is unauthenticated and paid; `/api/config` and `/api/brands` are public and disclose usage counters and every brand being read; team-if-claimed writes (memory incl. paid learn/consolidate, facts, asked threads) are open to anonymous visitors on unclaimed brands.

## 7. Recommendations (in order)

1. Dedicated runtime SA for each service (Secret Manager access on 8 named secrets, objectAdmin on its bucket, aiplatform.user). Remove run.admin/tokenCreator/secretAccessor from the default compute SA's reach for Brew.
2. Stop deleting old revisions (instead set `--no-traffic` on old ones and rely on retire.js), or at least tag the deployed image with the git SHA and record it (`--set-env-vars=GIT_SHA=$(git rev-parse HEAD)`, `--labels`). Turn on bucket versioning with a lifecycle rule.
3. Structured JSON logging with `severity`, then a log-based alert on ERROR and on treg 402 / cap-reached.
4. Persist the daily caps (text/image/video/voice/treg) like the build cap does, and add a $ meter around every Anthropic/OpenAI call.
5. `rm node_modules && npm ci` in brew/; add `.npm-cache/`, `docs/`, `*.md`, `.urlmap-backup*` to `.dockerignore`/`.gcloudignore`; remove `.npm-cache` and the URL map backup from git.
6. Add CI (GitHub Actions: `npm ci`, `node --check`, tests), ESLint + Prettier with a max line length, and a smoke test that boots the server with `AI_MOCK=1` and asserts the auth gate on every route in a single route table.
7. Make deploy-demo.sh run the same checks as deploy.sh. Pin `--max-instances=1` at the service level too. Set `HANDOFF_SECRET`. Decide on `APIFY_TOKEN`. Fix `video-read.js` bucket default.
8. Delete the WhatsApp/Slack/"ShopOS team" canned routes or list them in DUMMY.md; move the audit skill into `brew/.claude/skills/` and update its defaults and the SKILL.md domain.
