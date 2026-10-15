# 03 · Data model and storage

*`SPEC.md` holds the field-level schemas for profile, ledger entry, findings and move. They are still right, with the corrections at the bottom of this page. This page covers where everything lives.*

## Two kinds of state

| State | Key | Shared by | Where |
|---|---|---|---|
| **Brand pack**: what Brew knows about a brand | `slug`: the registrable domain with dots turned to dashes (`arata.in` → `arata-in`) | everyone who views that brand | `gs://brew-prototype/brands/<slug>/`, cached locally in `.brands/<slug>/` |
| **Workspace ("tenant")**: one viewer's feed, hearts, jams and versions | `t_<8 hex>` | one browser or person; share links let others in | `gs://brew-prototype/tenants/<id>.json`, cached locally in `.tenants/` and in memory |

On Cloud Run (`K_SERVICE` set) GCS is the source of truth and the local folders are caches. Locally only the folders are used. Copy a pack down to test with real data.

## Brand pack layout (as found in `arata-in`)

```
profile.json      the read: catalog, reviews, ads, rivals, site, AI answers, socials, company   (SPEC: Profile)
ledger.json       every fact with source, method, layer (observed|inferred), conf               (SPEC: Ledger entry)
findings.json     the onboarding steps and cards that were shown                                (SPEC: Findings)
facts.json        observed ledger rows the cards may quote (fact gate); facts-daily.json = daily price check
brief.md/.json    the Opus brand brief
moves.json        { "<n>": Move } for every move; moves/NN.json one per move; moves/history/ old versions
                  moves/cadence.json = weekly listening/automation runs, lock, next numbers
pdf/              "NN <Title>.pdf", <Brand>-moves-00-28.zip, -29-50.zip
seed.json         the feed's base cards (posts), lanes, roles, health (Dummy), geo
config.json       brand config: lanes, banned claim words, festival (hard-coded!), catalogUrl
labels.json, notes.json, move-value.json   card labels, margin notes, move grades
statics.json, statics/     Move-21 static ads (Gemini scene + Chromium text)
listen/           items, themes, threads, communities, status, history/   (listening)
ideas/, social/   ideas stream and the social scheduler state
research.json, research/   stories snapshot and media
live-watch.json   catalog + AI-answer watcher state
pulse/, calendar/, video/  market pulse, calendar, video breakdowns
drafts/           cards.json (first drafts per card) + state.json (spend, errors)
memory/           state.json, vectors.json, repo/*.md  (brand memory, mem0-style)
learned.json      "What your team told Brew" (from pasted notes)
audit/            scorecard.json (kept only as evidence for automation moves)
updates.json      stale flags + rewrite history
status.json       build stages, pdfs, zips, movesDone, pro, capped…
cost.json         { usd, byTag }
demo.json         numbers for the simulated accounts (Dummy)
notify.json       who gets "your moves are ready" email (kept; team email is in scope)
private/          member-only: connected-ledger.json, private moves/cards/pdf   (removed from carried packs)
raw/<date>/       raw fetches and paid answers (never cleaned up)
assets/           logo, product photos, ad posters
```

Bucket-wide: `tenants/`, `gen/` (generated media), `research-media/`, `_cache/` (the treg cache, 24 h), `_brew/` (the daily build spend), `control/live.json` (which revision is live).

## Workspace (tenant) shape: the main keys

- `cards`: the cloned and ranked cards.
- `work`: jams. Each has a stage, doc, plan, versions, thread, drafts and `jamBrief` (the shared snapshot).
- `versions`, `feedback`, `fewer`, `snoozed`, `shown`, `decided`, `acted`: what the viewer did.
- `viewer` (seat, lane) and `seats`.
- `L`: lessons, rules and checks ("What Brew learned").
- `liveConn` and `liveLedger`: Dummy connector data.
- `notes`, `storySeen`, `deck`, `watchers`, `qa`, `clock`.
- **Leftovers from cut features:** `plan`, `proAt`, `runs`, `batches`, `jams`, `router`.

Each workspace is about 250 KB. 10 exist in prod.

## The move numbering (three schemes in one list)

| Range | What | Written by |
|---|---|---|
| 00 | index ("N moves for Brand") | Opus, after wave A and at the end |
| 01–50 | core moves | Opus, the build |
| 51–65 | listening-era moves (written when their evidence exists) | Opus |
| 100–999 | dynamic moves (festival, research gap, community replies), numbered from a hash | Opus |
| 1001+ | weekly listening and automation moves (never reused) | Sonnet, `moves-cadence.js` |

Arata has **71** move documents. Docs and UI copy that say "51" are out of date. Code that assumes 2-digit numbers (`moveOfId`) or fixed numbers (statics on Move 21, `CONNECTED_MOVES`, `WANTS`) will break silently if the specs are renumbered.

## Concurrency

- There are no `ifGenerationMatch` preconditions anywhere. Every pack file is read-modify-written: `moves.json`, `seed.json`, `status.json`, `updates.json`, `cadence.json`, `pdfs`.
- This is safe only because there is **one instance**, and even then the build and the weekly scheduler can lose updates to each other's writes. That is how PDF 02 dropped out of `status.pdfs`.

## Corrections to SPEC.md

- The bucket is `gs://brew-prototype`, not `gs://squareup-feed`.
- The Instagram endpoint is `crawl4ai.instagram.user.posts`, not `treg.instagram.user.posts`.
- Moves go beyond `00–50` (see above), and `moves.json` is an object keyed by number, not an array.
- `reviews.total` sums different metrics (site reviews, store reviews, marketplace ratings). Treat it as "reviews and ratings".
