# 01 · Architecture

*State as of 2026-10-15, commit `ea6cfd7` (live on both sites). Sources: the code, plus audits in `audits/`.*

## The shape in one picture

```
                         brew.joinsquareup.com            demo.joinsquareup.com
                                │  (shared company HTTPS LB "squareup-urlmap")  │
                                ▼                                               ▼
                    Cloud Run "shopos-feed"                         Cloud Run "brew-demo"
                    1 instance, 2 vCPU, 4 GiB,                      same image, DEMO_MODE=1
                    CPU always on, timeout 3600 s                   bucket gs://brew-prototype-demo
                                │
          ┌─────────────────────┼─────────────────────────────────────────────┐
          │           ONE Node 22 process: node server.js (plain node:http)    │
          │                                                                     │
          │  HTTP handlers, tried in order:                                     │
          │  demo-routes → auth → connectors(DUMMY) → memory → moves-cadence →  │
          │  brand routes → brand files → /api/transcribe → feed-service →      │
          │  x-brand routes → /research, /gen media → public/ static → pages    │
          │                                                                     │
          │  In-process work:                                                   │
          │  • build.js: read → confirm → brief → 51+ moves → PDFs (resumed at boot)
          │  • ~14 timers: stories, watchers, listening+ideas, first drafts,    │
          │    weekly moves, daily price check, market pulse, refresh checks    │
          │  • in-memory: workspaces ("tenants"), daily caps, locks, caches     │
          └──────────────┬───────────────────────────────┬─────────────────────┘
                         │                               │
             gs://brew-prototype (packs,         External: Anthropic (Opus/Sonnet/Haiku),
             tenants, gen media, treg cache,     Vertex (Gemini image, Veo, TTS),
             control/live.json)                  OpenAI (image edit, transcription),
                                                 treg (SERP, Ad Library, AI answers,
                                                 Amazon, IG, YouTube…), Resend (team email),
                                                 Google OAuth, headless Chromium (local)
```

## The one flow, mapped to code

| Step | What happens | Main files |
|---|---|---|
| **Read** | `POST /api/brands {url}` → `build.start` → `reader.read()` runs ~10 stages with deadlines and one retry each, then writes `profile.json`, `ledger.json` and `findings.json`. The onboarding screen streams it over SSE. | `build.js`, `reader/index.js`, `reader/stages/*`, `reader/adlib.js`, `treg.js`, `feed-service.js` (onboarding stream), `public/app.js` |
| **Check what we read** | The brand fixes the name, products, rivals and sources, then confirms. That claims the brand and wakes the build. | `build.js` `checkData` / `applyCheck` / `confirm` |
| **Brief** | Opus turns the profile and ledger into `brief.md`. Quotes are checked against real reviews, and numbers without a source are marked "to confirm". | `brief.js` |
| **Moves** | 66 specs: 0 is the index, 1–50 are core, 51–65 are listening-era, and 100–999 are dynamic. Each move is one Opus call, then a number scan, a Sonnet claim check and an Opus fix. A PDF and two zips are made. Weekly listening and automation moves (Sonnet, numbered 1001+) follow. | `moves-engine.js`, `data/move-specs.json`, `prompts/move-house.md`, `skills/`, `sources/moves/`, `moves-cadence.js`, `pdf/`, `refresh.js`, `fact-gate.js`, `facts-desk.js` |
| **Feed** | Moves become cards (`cards-gen`). The pack loads, and listening, ideas, Heard, stories, watcher cards, statics and margin notes are added. Cards are ranked per workspace and per seat. | `brand-pack.js`, `cards-gen.js`, `card-plan.js`, `feed-service.js`, `social-feed.js`, `listen-watch.js`, `ideas.js`, `research.js`, `live-watch.js`, `statics.js`, `notes.js`, `value.js` |
| **Jam** | Studio: canvas, chat, first drafts (image, text, video, voice, carousel), versions, photos, composer, brand memory and learnings. | `remix.js`, `studio.js`, `drafts.js`, `drafts-bg.js`, `brand-memory.js`, `brand-learnings.js`, `learn.js`, `public/jam-room.js`, `public/canvas.js`, `public/composer.js` |
| **Share the brief** | Freezes the brief as BR-n and copies its text with a link to the read-only `/h/<token>` page. Nothing is sent. | `jam-brief.js`, `handoff.js`, `public/share.js` |
| **Accounts** | Google sign-in, claim by work email, team, invites and views (seats). Team email goes through Resend. | `auth.js`, `member-ctx.js` |
| **Dummy** | Simulated connectors, Pro, teammate replies, the demo site | `connectors/`, `demo-data.js`, `demo-mode.js`, `demo-routes.js` |

## Key concepts

- **Brand pack:** everything Brew knows about one brand, under `brands/<slug>/`. The slug is the registrable domain with dots turned to dashes, for example `arata-in`. The pack is shared by everyone who views that brand. Its layout is in `03-data-model.md`.
- **Workspace ("tenant"):** one viewer's feed state, in `tenants/t_<8 hex>.json`. It holds the cards, hearts, work items (jams), notes and versions. It is kept in an in-memory Map and written back to disk and GCS.
- **Ledger:** every fact Brew uses, as a row with a source, method and layer (observed or inferred). The fact gate blocks any money or percent number on a card that the ledger or the move doesn't back.
- **Move:** a long strategy document (7–10k words) with a fixed section shape. It is drawn to PDF.
- **Card:** one idea in the feed, made from a move, a listen theme, an idea, a story or a watcher. Each card has a plan and an action that opens a jam.
- **Seat or view:** a role filter (founder, ads, storefront, retention, etc.) that decides which cards a member sees.

## Process model and its consequences

- **It must run as exactly one instance.** Workspaces, daily caps, locks, scheduler "busy" sets and the 30-minute weekly-move lock are all per-process or non-atomic GCS read-then-write. Two instances would double-run schedulers and overwrite each other's files. The revision has `maxScale=1`, but **the service-level annotation says 100**: pin both.
- **Builds run inside the web server.** A deploy or crash in the middle of a build relies on `resumeAll()` at boot. A read interrupted that way starts over and pays Claude again, because the raw cache is read from local disk only.
- **`retire.js` controls handover between revisions.** Each instance writes `control/live.json`. Older revisions then make `fetch` throw and exit. `tools/reset-brand.sh` also uses it.
- **Storage:** the local `.brands/` and `.tenants/` folders are caches. GCS is the source of truth on Cloud Run (`K_SERVICE` set). There are eight hand-written GCS REST clients and no `ifGenerationMatch` anywhere.

## Background timers (all in-process)

| Where | Every | What |
|---|---|---|
| `server.js` evidenceTick | 30 min | market pulse, weekly top-video read, calendar confirm |
| `server.js` storiesWarm | 60 min | attach story and watcher loops for brands opened in the last 3 days |
| `server.js` | 3 min | re-read drafts from the bucket |
| `feed-service.js` | 5 s / 20 s | feed tick / save recently seen workspaces |
| `research.js` | 30 min per brand | stories: ads, trends, news, how-to |
| `live-watch.js` | 15 min per brand | catalog and AI-answer watchers |
| `build.js` | 60 min | weekly refresh check. `freshReload` runs only with `OPS_FRESH_RELOAD`; it caused the 2026-10-14 cost loop |
| `facts-desk.js` | 60 min | daily price and stock check (Shopify only) |
| `social-feed.js` | 30 min | listening and ideas |
| `drafts-bg.js` | 30 min | first drafts for top cards |
| `moves-cadence.js` | 60 min | weekly listening and automation moves |
| `retire.js` | ~15 s | live-revision check |

Every brand that has been opened keeps its two watcher intervals until a restart: the `INST` map is never pruned.

## Client

There is no framework. The client is plain JS served from `public/`:
- `app.js`: 546 KB, 4,099 lines. Landing, onboarding, feed, card pages, moves tab, plan sheet.
- `jam-room.js`, `canvas.js`, `composer.js`: studio.
- `live.js`: connect sheet (Dummy).
- `share.js`: Share the brief.
- `brew.css`: 214 KB.
- `dummy.css`: the dashed Dummy tag.

A small service worker (`sw.js`) and `manifest.webmanifest` make it installable. Nothing on the client has a test.

## Dependencies

Three runtime npm deps: `@anthropic-ai/sdk`, `date-holidays`, `puppeteer-core`. Everything else is written by hand: HTTP routing, GCS, OAuth, SSE and compression. The image is `node:22-bookworm-slim` with apt `ffmpeg`, `chromium` and fonts.

**Local trap:** `brew/node_modules` is a symlink to `../feed/node_modules`, which is in the archived repo. Run `rm node_modules && npm ci` inside `brew/` before anything else.
