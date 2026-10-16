# Brew

A realistic prototype of Brew: paste a brand's URL and Brew reads it, writes its strategy moves, and turns them into a feed of cards. On any card you jam with AI (and your team) until the work is ready, then you share the brief.

**Read → Moves → Feed → Jam → Share the brief.**

- `SCOPE.md`: what is in, and what was deliberately cut.
- `DUMMY.md`: everything that is simulated (tagged "Dummy" in the UI) and what the real build needs.
- `SPEC.md`: the brand pack, profile, ledger and move shapes.

## Run it locally

```
npm ci
AI_MOCK=1 BUILD_RESUME_OFF=1 RESEARCH_OFF=1 LIVE_OFF=1 TREG_OFF=1 FEED_SIGNIN=0 node server.js   # http://localhost:4200
```

- **AI** runs on Gemini on Vertex by default (`AI_PROVIDER=gemini`; the live site writes moves on `GEMINI_DEEP_MODEL=gemini-3.1-pro-preview`, everything else on `gemini-3.5-flash`). `AI_PROVIDER=anthropic` switches back to Claude. Keys are read from `../ugc-factory/.env` (override with `ENV_FILE`); Vertex needs `GOOGLE_CLOUD_PROJECT` and a gcloud login. `AI_MOCK=1` runs every AI path as free scripted output.
- **Locally, brand packs live in `.brands/<slug>/`.** The bucket is only used on Cloud Run (`K_SERVICE`). Copy a pack down to test with real data, then run `node tools/prepare-pack.mjs .brands/<slug>`.
- `DEV_MEMBER=1` makes you a member of every brand locally, so team-only paths can be tested.

## Test

```
AI_MOCK=1 node --test test/*.test.js
```

The suite is free: no AI, no network. `test/*-probe.mjs` are real, paid probes; run them only on purpose.

## Deploy

- `./deploy.sh` deploys to Cloud Run `shopos-feed` → https://brew.joinsquareup.com, with data in `gs://brew-prototype`. It refuses to deploy uncommitted code or failing tests.
- `tools/deploy-demo.sh` deploys the demo site, Cloud Run `brew-demo` → https://demo.joinsquareup.com, with data in `gs://brew-prototype-demo`. `tools/demo-sync.sh <slug…>` copies prepared brands to it.
- Keys come from Secret Manager. One instance, CPU always on: the build runs in the server process. The newest three revisions are kept for rollback; older ones are deleted.

## Where things live

| Area | Files |
|------|-------|
| Read | `reader/` (stages, Ad Library fallback), `treg.js` (shared client, 24 h cache), `apify.js`, `build.js` (the pipeline) |
| Moves | `brief.js`, `moves-engine.js` (with `sources/moves` as the depth exemplars), `moves-cadence.js` (weekly listening and automation moves), `refresh.js` (rewrites when the brand changes), `fact-gate.js`, `facts-desk.js`, `pdf/` |
| Feed | `feed-service.js` (cards, ranking, work board, routes), `cards-gen.js`, `card-plan.js`, `card-page.js`, `value.js`, `brand-pack.js`, `research.js` (stories), `live-watch.js` (catalog and AI-answer watchers), `listen-watch.js`, `ideas.js`, `social-feed.js`, `notes.js`, `statics.js` |
| Jam | `remix.js` and `studio.js` (the studio), `jam-brief.js` (the brief, and Share the brief), `handoff.js` (the brief text and the read-only `/h/` page), `drafts.js`, `drafts-bg.js`, `brand-memory.js`, `brand-learnings.js`, `learn.js` |
| Accounts | `auth.js`, `member-ctx.js`, `demo-mode.js`, `demo-routes.js` |
| Connectors | `connectors/` (real read-only accounts on the live site; `sim.js` simulates them on the demo site), `vault.js`, `on-connect.js`, `slack-routes.js` |
| Creatives | `drafts.js` and `drafts-bg.js` (first drafts on Gemini), `rival-ad.js` (Make our version of a rival's ad), `finals.js`, `finals-routes.js`, `sloosh-*.js` (finals on Sloosh, Gemini fallback) |
| Demo only | `demo-mode.js`, `demo-routes.js`, `demo-data.js`, `connectors/sim.js` |
| Client | `public/app.js`, `public/jam-room.js`, `public/share.js`, `public/canvas.js`, `public/composer.js`, `public/live.js`, `public/brew.css` |
