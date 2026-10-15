# D. The Jam + Share the brief: audit for the engineering and product KT

Repo: `/Users/param/Documents/ChatGPT/brew`. Live: https://brew.joinsquareup.com/arata-in. Audited 2026-10-15.

## How this was checked

- I read SCOPE.md, DUMMY.md, SPEC.md, README.md, CLAUDE.md and docs/brand-memory.md, then the jam code: remix.js, studio.js, jam-brief.js, handoff.js, drafts.js, drafts-bg.js, draft-mocks.js, brand-memory.js, brand-learnings.js, memory-routes.js, learn.js, ai.js, vertex-media.js, image-guard.js, model-ctx.js, the work/jam routes in feed-service.js and server.js, and public/jam-room.js, canvas.js, composer.js, share.js and mic.js.
- **Tests:** `AI_MOCK=1 node --test test/*.test.js` gives 222 tests: 219 pass, 0 fail, 3 skipped (Chrome is missing, and one live treg check). The whole run takes 1.3 s.
- **Local end-to-end run:** I copied the repo to the scratchpad, so no repo file was touched. I ran it with `AI_MOCK=1`, an empty env file, no gcloud credentials and `TREG_OFF`, so it could not spend anything. I drove the full jam over HTTP with `$TMPDIR/flow.py`: create a workspace, open a jam on a card, ask the brief, make a draft, @teammate, "Ask everyone", Share the brief, edit after sharing, open `/h/…?full=1`, then `GET /handoff`. Output is in `scratchpad/audit/flow-state.json` and `server.log`.
- **Live checks (GETs only, nothing spent):**
  - `GET /api/config`
  - `GET /h/<bad token>?full=1` returns 404 "This handoff link is not valid."
  - `GET /api/brands/arata-in/memory`
  - `GET /api/brands/arata-in/told`
  - `GET /arata-in` returns 200
- **Not verified:**
  - **No live `/h/` brief for arata-in exists to look at.** A `/h/` link needs a tenant id plus an HMAC built from the production secret. No link is stored in `.brands/arata-in` or `.tenants`, and the local tenant has `work: []`.
  - **I sent no POSTs to live**, so live generation quality (images, video, voice) was not exercised.
  - **I did not drive the UI in a browser.**

---

## 0. Executive summary (the honest version)

The jam is the richest part of the prototype and mostly works. The brief is edited by AI, drafts are made, versions and photos work, and Share the brief copies a brief with a BR number.

It still carries a lot of machinery from the cut "Do it now" and "fake team" flows. Several dummies leak into real data.

**Most serious:**

1. **Simulated teammates and the "Ask everyone" plan answers invent sign-offs, and those reach the shared brief.**
   - Canned answers include "Cleared. Every claim on it is one our site already makes.", "Yes. The photos are ours, and review quotes are used with consent." and "Verified this morning. Meta purchases match Shopify orders." (`remix.js:274-296`). In live mode the same questions are answered by Claude "in character" (`remix.js:1039-1052`, `liveAnswer`).
   - They are written into the plan, folded into the brief by AI (`jam-brief.js:190` `onSay`), and copied into the shared brief text under "Jam so far" with no Dummy label.
   - **Reproduced locally:** the AI flagged "Numbers not in the fact sheet: 3%, 5%", and the simulated Brand manager then answered "Checked. Every number matches a claim we can prove."
2. **A simulated approval moves real work state.** `colleagueReply` (`feed-service.js:932-967`) moves the jam to **Ready** with "X approved v3. Ready to ship." or to **Needs you**.
3. **Dummy output is written into the brand's shared, persistent memory.**
   - A simulated teammate's pushback becomes a lesson (`feed-service.js` `stepLearn`: "only a teammate's pushback teaches"), and lessons go to brand memory.
   - **Reproduced:** `LOG.md` got `ADD brand/rules.md … "Brand manager checks this before a yes: … Legal will ask." by lesson`.
   - On Cloud Run this writes to `gs://brew-prototype`.
4. **Simulated connector numbers are fed to the brief AI as truth.**
   - `jam-brief.js:127` `accountLine` reads "Numbers from the brand's connected accounts, read today (quote these exactly)" from `t.liveLedger`, which `connectors/sim.js` fills.
   - `connectors/sim.js:29` also strips the `demo` flag, so `facts-desk.js connectedFacts` treats dummy numbers as "connected". Brand learnings that disagree with them are then rejected ("the fact sheet wins").
5. **"Frozen" BR-n briefs are not frozen.**
   - `/h/<token>?full=1` is rebuilt from the live jam on every request (`handoff.js` `build`, "always the latest state").
   - **Reproduced:** after Share, `POST /doc` with new text was accepted, the stage stayed "shared", and the read-only page showed the new text.
   - `w.jamBrief` holds the snapshot, but nothing reads it for the page.
6. **The shared text hands out a join-the-team link.**
   - Every share text includes `…#remix=…&s=<workspace share token>` (`handoff.js:46`). Anyone who opens it signed in is added to the brand's team with every view (`server.js:448-451` `shareJoin`: "the link is the invite").
   - `GET /api/tenants/:id/share` returns that token to anyone who knows the tenant id, and the tenant id is in plain text inside every `/h/` link.
   - "Share with my team" text does not include the read-only page link at all; only the ShopOS version does (`handoff.js:47`). SCOPE says both do.
7. **Brand memory routes are open on unclaimed brands, including arata-in.**
   - `memory-routes.js:17` sets `canWrite = !v.claimed || v.member`, with no sign-in and no `genOk`.
   - Live `GET /api/brands/arata-in/memory` returns `canWrite: true` to an anonymous caller, plus all 71 facts and the 80-line log.
   - So anyone can `POST` notes (paid Sonnet and embedding calls), `DELETE` lines, or run `learn` / `consolidate` (paid), with no rate limit.
8. **`GET /api/brands/:slug/told` is fully public, even for claimed brands** (`server.js:473-476`). Live it returns Arata's meeting notes with names ("Subham", "Rhea", "Kushal"), goals and plans.
9. **`POST /api/transcribe` (OpenAI gpt-4o-transcribe) has no auth.** Its only limit is 80 per IP per hour, and it does not count against `DAILY_VOICE_CAP` (`server.js:620-634`).
10. **False UI claims:**
    - "Posted to #growth" toasts after "Take it to Slack" or an @teammate (`jam-room.js:244, 281, 454`). Nothing is posted; it is a clipboard copy plus a simulated reply.
    - Composer says "Hailuo 2.3 video · about $0.49 a clip" (`composer.js:39`), but video is Veo 3.1 Fast on Vertex.
    - "A link: Brew reads the page" only pre-fills a URL in the text box (`composer.js:76`). No route fetches pages, and the model has no web search, so the AI cannot read it.
11. **Cost controls are coarse.**
    - The daily caps count calls, not dollars. They are global across all brands and users, kept in memory, reset on every deploy or restart, and shared by one instance.
    - Opus "Deep" counts the same as Sonnet.
    - Image-guard retries and regenerations are not counted.
    - `ai.js` work (memory, learnings, background drafts) is not under the caps at all.
    - Jam Claude calls through `server.js claudeTool` are not dollar-metered anywhere.
12. **Large amounts of cut-feature code are still live and reachable:**
    - stages `deploying` / `out` / `measuring` / `result`
    - `/api/jams` with "The ShopOS team has it. Usually replies in 12 to 24 hours."
    - `/api/jams/:jid/whatsapp`
    - dummy `/api/slack/*`
    - `/api/ai/jam`, `/api/ai/hearted`, `/api/ai/remix-image`
    - remix action targets with rollback, money and "irreversible"
    - "Deploy lead on the ShopOS team" answers
    - DEMO_OK whitelisting `work/:wid/live` and `changes/:chid/undo`
    - canvas "Live since…" and holdout split
    - onboarding copy "Send any card to a colleague on Slack. They approve in the thread"

**Test coverage is thin for this area:**
- No tests for handoff.js (token signing, the `/h/` page), the jam-brief routes (edit, ship, jb/move, import), the one-tap drafts route, colleagueReply, plan/ask, memory-routes auth, `/told`, `/api/transcribe`, share.js, composer.js or canvas.js.
- Covered: first drafts (drafts-bg), image-guard and fallback, brand-memory core, brand-learnings, card→canvas coverage, version labels.

---

## 1. Models and providers (what generates what)

| Job | Model / provider | Where | Notes |
|---|---|---|---|
| Jam brief edits, answers, plan extraction, teammate replies, plan answers, remix packages, variants, canvas pick, card pages, step lessons | Claude **Sonnet 5.5** (`claude-sonnet-5-5`), effort low, thinking off; falls back to `claude-sonnet-5` | `server.js:66,85-118` (`claudeTool`, `claudeJSON`) | "Deep" in the composer switches the same calls to **Opus 5.5** through the `x-model` header (`model-ctx.js`). Not dollar-metered. |
| Image (drafts, studio photos, carousel slides) | Vertex **gemini-3-pro-image** (prod env), fallback **gemini-2.5-flash-image** | `server.js:136-160` | Global endpoint, project `squareup-492617`, ADC or metadata token. Not treg. |
| Image, "GPT Image" chip | OpenAI **gpt-image-1** `/images/edits` (needs a source photo) | `server.js:165-178` | Falls back to Gemini on failure. |
| Right-product check on every image | Claude **Haiku 5.5** vision (`IMAGE_CHECK_MODEL`) | `server.js:151-158`, `image-guard.js` | A mismatch regenerates once, then falls back to the real product photo. |
| Video | Vertex **Veo 3.1 Fast** (`veo-3.1-fast-generate-001`), 6 s, 1080p, no audio, `us-central1` | `vertex-media.js:30-48`, `drafts.js` `createMakers.video` | UI text and the drafts-bg header still say Hailuo 2.3 through treg (stale). |
| Voice / voiceover | Vertex **gemini-2.5-flash-tts** (voices Kore, Aoede, Leda, Charon, Puck, Orus) | `vertex-media.js:21-27` | Muxed into video with ffmpeg (in the Dockerfile). **Not OpenAI.** |
| Mic, talk instead of type | OpenAI **gpt-4o-transcribe** | `server.js:620-634` | No auth. |
| Brand memory (extract, decide, consolidate, learn from live) | Sonnet 5.5 through `ai.js` (metered), Vertex `gemini-embedding-001` (256-d) | `brand-memory.js`, `server.js:360` | |
| Brand learnings | Sonnet 5.5 (`brand-learnings.js:294,302`), plus move rewrites through `build.js` (Opus) | | |
| Background first drafts | Sonnet (`ai.js`, metered) plus the same media makers | `drafts-bg.js` | $4 per brand per day cap. |

---

## 2. Daily caps

`server.js:71-73`:

```
const CAPS = { text: +process.env.DAILY_TEXT_CAP || 400, image: +process.env.DAILY_IMAGE_CAP || 60, video: +process.env.DAILY_VIDEO_CAP || 15, voice: +process.env.DAILY_VOICE_CAP || 60 };
const spend = (k) => { ... if (used[k] >= CAPS[k]) return false; used[k]++; return true; };
```

- **Production values** (`deploy.sh`): `DAILY_TEXT_CAP=1500`, `DAILY_IMAGE_CAP=120`. Video and voice use the defaults, 15 and 60.
- **Live** `GET /api/config` returned `caps {text:1500,image:120,video:15,voice:60}` and `used` all 0 on 2026-10-15. The endpoint is public, so it also exposes usage.

**Semantics and risks:**
- **Counts calls, not dollars.** An Opus "Deep" edit counts the same as a Sonnet one. A carousel uses 1 to 8 image counts, and slide 0 is free in `canSpend` (`drafts.js:84`).
- **Global per process.** All brands, all users and all tenants share one counter. One heavy user can exhaust the day for everyone.
- **In memory.** It resets on every deploy or restart (`deploy.sh` deletes old revisions) and at server-local midnight (UTC on Cloud Run, which is 05:30 IST).
- **Not counted:**
  - image-guard retries (up to 3 tries per model across 2 models) and the wrong-product regeneration
  - the Haiku vision check
  - `ai.js` calls (memory, learnings, notes, value, drafts-bg Sonnet)
  - `/api/transcribe`
- **When a cap is hit,** the user gets a soft fallback: "The image budget for today is used up…", or mock text. The jam silently degrades to "AI is offline, so I didn't rewrite anything" (`jam-brief.js:184-186`). That message is wrong when the real cause is the cap.
- **Bug:** `remix.js:802,805` call `spend('text')` on the `fast` path without `!isMock()`. Under mock they burn the counter and try `claudeTool`, which throws because `anthropic` is null (the error is caught).
- **drafts-bg** has its own dollar cap: `DRAFTS_DAY_CAP_USD`, $4 per brand per day, booked at estimated or real cost. Arata's pack shows 2026-10-14 spend of $3.98 and "daily cap" errors (`.brands/arata-in/drafts/state.json`).

**What production needs:**
- per-brand and per-user budgets in dollars
- a persistent ledger
- metering of `claudeTool` calls
- counting guard retries
- a rate limit on unauthenticated paid endpoints

---

## 3. Feature-by-feature

Status key: **Working** | **Partial** | **Broken** | **Dummy** | **Cut-but-code-remains** | **Untested**

### 3.1 Opening a jam (work item)
- **What it does:** tapping a card makes a work item (`w`) with a brief, a plan, versions and a thread. With `link: true` it also makes the studio "change package".
- **Status:** **Working.**
- **Evidence:**
  - `feed-service.js:1253-1263` (`POST /api/work`) and `:1036-1043` (`linkChange` → `POST /api/cards/:cid/remix` with `fast`)
  - Local run: `wk_… drafting change ch_…`, with the brief seeded from the card and "missing: Who owns it, When, Who it's for, Budget".
- **Tests:** card-plan and jam-coverage check that every card resolves to a canvas and a measure kind. No route test.
- **Risks:**
  - One work item per card per workspace (tenant), not per brand. Two teammates in two workspaces get two separate jams on the same card.
  - The tenant is chosen by the `x-tenant` header, and the ids are short (`t_` plus 8 hex).
  - Errors return HTTP 200 `{error, fallback:true}` (`feed-service.js:1475`), which hides failures from monitoring.
- **Cost / latency:** free. The fast package copy is written in the background by one Sonnet call (`remix.js` `fillLater`).

### 3.2 The jam brief (living Markdown doc)
- **What it does:** one Markdown brief per jam (`w.doc`).
  - Ask AI to change it: `/doc/ask`.
  - Edit it yourself: `/doc`, with a rev check.
  - Add a selection from the card or moves: `/doc/add`.
  - A quiet "missing" checklist per kind of work (`NEEDS`).
  - A plan and measure are extracted from the text (`syncPlan`, `applyPlan`).
- **Status:** **Working**, but with a data-integrity problem.
- **Evidence:**
  - `jam-brief.js:168-187` (`edit`), `:200-233` (routes), `:12-23` (NEEDS)
  - Local mock: `/doc/ask` returns "Noted in the brief under Notes. (AI is offline…)"
- **Risks:**
  - `accountLine` (`jam-brief.js:127`) puts **simulated** connected-account numbers into the prompt as truth.
  - `onSay` (`:190-194`) folds **simulated teammate and "ShopOS team" replies** into the brief through AI.
  - The prompt still says the ShopOS team writes the brief together with the team.
  - The offline and cap fallback message blames "AI is offline" even when the real cause is the cap.
  - `edit` writes the whole doc back. Concurrent edits are handled for manual edits (stale rev) but not for AI edits.
- **Cost / latency:** one Sonnet call (~$0.02-0.04; Opus about 2-3×), 5-20 s. A manual edit triggers another Sonnet call (`syncPlan`, `brief_plan`).
- **Production needs:** source-tag every line that comes from a dummy, or remove those inputs; real concurrency (OT/CRDT or locking).

### 3.3 Chat in the jam (jam room)
- **What it does:** the right-pane chat. Messages go to `/doc/ask`, so the "chat" is really brief-editing plus a reply.
- **Status:** **Working.**
- **Evidence:** `public/jam-room.js:236-250`.
- **Notes:**
  - The streaming chat route `/api/ai/jam` (`server.js:598-615`) has **no client caller**: dead code. Its fallback text still offers "a person on the ShopOS team".
  - `POST /api/work/:wid/iterate` (`feed-service.js:1264-1284`) is used by app.js. It routes through `routeJam` and says "This needs {label}. Finish the jam, then share the brief…". `makeVersions` makes three tile variants.

### 3.4 Studio (canvas + change package)
- **What it does:** the left side shows the thing being made "as it will really look".
  - The canvas is a stack of blocks from `public/data/canvas-blocks.json`, picked by family or by AI (`/api/work/:wid/canvas`).
  - The studio holds a "change package" per action family (`studio.js` `FIELDS`, `KNOBS`): knobs (`/changes/:chid/knob`), variants, more, plan, checks, notes, iterate, edit, restore and discard.
- **Status:** **Working**, with **Cut-but-code-remains** throughout.
- **Evidence:** `remix.js:721-1008` (routes), `studio.js`, `public/canvas.js`, `feed-service.js:1018-1024` (`canvasCompose`).
- **Leftovers from Do it now / measurement:**
  - `remix.js:35-80`: every action has `target: { conn: 'meta' | 'klaviyo' | 'whatsapp' … }`, `money`, `rollback`, `irreversible` ("A broadcast can't be unsent once it goes out").
  - `remix.js:398`: verdict `deploy` / `live`.
  - `:839, 982, 987-993`: "It is live. Undo it first", "It's with the ShopOS team. Withdraw it first" (states `running` / `live` / `deploy_team` / `result` can no longer be reached).
  - `canvas.js:89` shows an audience/holdout split; `:110, 122, 126` show "Live since…" and "Out with team".
  - The package's "Rollback: Pause the ad" and "Can't be undone" strings still flow into the handoff (`remix.js:681,690`).
- **Tests:** card-action-map, card-plan, listen-ideas-wiring and audit-server-fixes cover the mapping and knob helpers. No route test.
- **Cost:** knobs, variants and iterate are one Sonnet call each (`liveOptions`), ~$0.02-0.05.

### 3.5 Versions
- **What it does:** two parallel version systems.
  - Jam versions: `w.versions`, `addVersion`, `/work/:wid/version`, `/pick`, `/edit`.
  - Change-package versions: `versionsOf`, `/changes/:chid/restore`, `GET /tenants/:id/versions/:oid`.
  - They are kept in step by `RMX.pickFromJam` and `iterateFromJam`.
- **Status:** **Working.** UI version labels are tested (`ui-audit-r3.test.js`).
- **Risk:** the dual bookkeeping is complex, and drift between `w.current` and the change head is possible. There is no test of the sync.

### 3.6 Photos
- **What it does:**
  - Pick from up to 60 catalog photos (`GET /changes/:chid/photos`).
  - Upload one (data URL, at most 8 MB, saved to `gen/`).
  - Use https URLs.
  - Ask AI for a new photo (`/changes/:chid/photo`, `ai`).
  - Add a reference photo for drafts (`/work/:wid/reference`, at most 4 kept).
- **Status:** **Working.**
- **Evidence:** `remix.js:947-968`, `feed-service.js:1033-1037`, `server.js:259-276` (`urlPhoto`).
- **Risks:**
  - `b.urls` accepts any `https://` URL, which the server later fetches (`urlPhoto`, 15 MB, 2 tries). This is a mild SSRF/egress vector, limited to people allowed to generate.
  - Uploads are public at `/gen/<sha>.ext` with an immutable cache.
  - `realOnly` families (communities) block AI photos (good).

### 3.7 First drafts in the jam (one tap): image, carousel, video, voice, text
- **What it does:** `/api/work/:wid/draft {as}` runs in the background, and the client polls.
  1. Sonnet plans the asset (schema `drafts.js:21-38`).
  2. Then it makes it:
     - image: Gemini, real product as the reference
     - carousel: 3-8 slides, Gemini photo per slide, words set by Chromium, plus a zip
     - video: first frame, Veo 6 s, optional TTS voiceover muxed in
     - voice: TTS WAV
     - text: words only
  3. At most 12 drafts are kept per jam. A "making" draft that a restart cut off is marked failed (`heal`).
- **Status:** **Working** in code and mock. **Untested** for real media in this audit (no spending allowed).
- **Evidence:**
  - `drafts.js:90-150`
  - Local mock produced a text-only draft: "AI is offline, so this is the brief's own words."
- **Tests:** `first-drafts.test.js` (8) covers the background path and mocks. `image-fallback` and `image-guard` cover the image wrapper. There is no test of the one-tap route.
- **Risks:**
  - Each step calls `spend()`, but guard retries and regenerations don't.
  - If ffmpeg fails, the audio stays as a separate track.
  - The background makers are referenced as treg (Hailuo) in the comments, but the code uses Veo.
  - Of Arata's background drafts (pack copy, 2026-10-14):
    - 42 drafts, 24 of them page mocks
    - the 2 "video" drafts came out as stills, with no clip
    - 1 carousel fell back to text
    - $4.43 booked
- **Cost / latency (estimates):**

  | Draft | Cost | Time |
  |---|---|---|
  | Text | ~$0.03 | |
  | Image | ~$0.03 + ~$0.13-0.24 per Gemini 3 Pro image (drafts-bg books $0.17) + ~$0.005 Haiku check, about 2× when regenerated | 20-60 s |
  | Carousel | ~$0.5-1.5 | 1-3 min |
  | Video | image + ~$0.90 Veo (drafts-bg estimate) + ~$0.01 voice | 2-4 min ("about two minutes") |
  | Voice | ~$0.01 | |

### 3.8 Background first drafts (drafts-bg.js)
- **What it does:** every 30 min, for brands opened in the last 3 days, it drafts the cards that name a format, up to $4 per brand per day. The jam opens with the draft.
- **Status:** **Working** (evidence: Arata `drafts/cards.json` with 42 drafts and `state.json`).
- **Risks:**
  - Spend happens just because someone opened the brand, including visitors on the public page (`onOpen` fires on `GET /feed` only when `gen`, so it is gated to people allowed to generate).
  - The header comment is stale (Hailuo / treg).
  - The cap is enforced per instance, and state is in the pack.

### 3.9 Download
- **What it does:** the studio's "Download this version" gets the photos (CDN-sized) and the text, then zips them client-side (`app.js:3173-3200`, a hand-written STORE zip). Carousel drafts also have a server zip. The `/h/` page lists assets as download links.
- **Status:** **Working** (code read only, not clicked).
- **Risk:** client-side `fetch` of store CDN URLs depends on CORS; a failure shows a toast "Couldn't download it."

### 3.10 Composer (+ menu, model chip, image chip, memory switch, connectors)
- **What it does:**
  - **+ menu:** CSV or text file (read client-side, at most 6,000 characters; 120,000 for learnings), a product photo (→ `/reference`), "A link", "Paste a chat", "Brand learnings", "Make a draft as…".
  - **Model chip:** Auto / Deep (Opus) / Fast (Sonnet). Image chip: Gemini / GPT Image. Both are sent as headers (`x-model`, `x-image-model`, `x-memory`).
  - **Connectors popover:** the dummy accounts.
- **Status:** **Partial.**
- **Evidence:** `public/composer.js`.
- **Broken or misleading:**
  - "A link: Brew reads the page" only pre-fills `Read this page and use what matters: https://` (`composer.js:76`). No route fetches the page and the jam Claude calls have no web search, so the model only sees the URL string. Risk of hallucination.
  - "Making video and voice: **Hailuo 2.3** video · about $0.49 a clip" (`composer.js:39`) is wrong. It is Veo 3.1 Fast, booked at about $0.90.
  - The connectors popover is tagged Dummy (`composer.js:46`, good).
  - Memory switch: `x-memory: off` only hides memory from prompts (`learn.js:136`). It does not stop lessons being written to memory.

### 3.11 Brand memory (shared per-brand)
- **What it does:** a mem0-style per-brand fact store (`memory/state.json`, `vectors.json`, a readable `repo/*.md`).
  - Counted facts from the read.
  - Sonnet read of the creatives.
  - ADD / UPDATE / DELETE / NONE decisions.
  - Gemini embeddings for search.
  - "Dreaming" consolidation.
  - Fed into every jam prompt (`learn.promptBlock`) and into drafts (`memoryBlockAsync`, 4 s timeout).
- **Status:** **Working** (live arata-in: 71 facts, 13 files, 80 log lines; sources: live 39, live-read 16, team 14, config 1, lesson 1). The routes are **insecure** (see below).
- **Evidence:** `brand-memory.js`, `memory-routes.js`, `docs/brand-memory.md`. Tests: `brand-memory.test.js` (8), plus the paid probe `memory-probe.mjs`.
- **Risks:**
  - **Open writes on unclaimed brands.** `memory-routes.js:17` has `canWrite = !v.claimed || v.member`, with no `genOk` and no sign-in. Live arata-in reports `canWrite: true` anonymously.
    - Anonymous `POST` costs Sonnet plus an embedding.
    - Anonymous `DELETE` of any line.
    - `POST /learn` (~$0.04-0.07) and `/consolidate`, with no rate limit.
  - **The read is public:** `GET /memory` returns every brand-scope fact and the change log to anyone.
  - **Lessons from dummies are written in.**
    - The simulated teammate's pushback becomes a `rules` line (reproduced: `ADD brand/rules.md … by lesson`).
    - Fake "checks answered the same way 3 times" can become rules (`learn.js:110` `onCheck`).
    - One live lesson already reads "lesson: shipped it on …", with "shipped" wording from the cut flow.
  - Under `AI_MOCK=1` the lesson hook still tried a Vertex embedding (`server.log`: `[memory] embed … gcloud`). With real local gcloud credentials that is a small unintended spend.
  - Two instances writing at once: last write wins (documented).
  - "There is no UI yet" in the docs is out of date: "What Brew learned" reads `/memory` (`app.js:3800`) and has a forget button.
- **Production needs:**
  - sign-in plus team membership for every write
  - rate limits
  - separate untrusted (dummy, simulated) sources from memory
  - a real store (DB or vector store) with concurrency control

### 3.12 Brand learnings ("/update-brand-learnings") and "What your team told Brew"
- **What it does:** paste a call transcript, notes or emails into a jam. Brew:
  1. Chunks it and extracts essence, goals, beliefs and facts with exact quotes (a quote not found in the paste is dropped).
  2. Updates `learned.json`, the brief's "What the team told Brew" section, the system prompt and memory.
  3. Flags moves and rewrites up to 4 (`LEARN_REWRITE_MAX`), and adds new "learn" moves.
  4. A second paste of the same text is recognised by hash. You can review, edit or cancel the draft.
- **Status:** **Working** (live: arata-in has a learned set "Notes, added by SquareUp Team, 2026-10-14").
- **Evidence:** `brand-learnings.js`, `feed-service.js:1319-1335` (`learnOf`: members only, not on the demo site). Tests: `brand-learnings.test.js` (15) and `learned-rank.test.js`.
- **Risks:**
  - **Public read:** `GET /api/brands/:slug/told` (`server.js:473-476`) has no auth and no claimed check. Live, it exposes client meeting notes with staff names and plans. This is a confidentiality issue.
  - **Dummy numbers win.** The conflict rule rejects learnings that disagree with "connected" facts, and simulated connector facts count as connected (`connectors/sim.js:29` drops `demo`). The reply then says "Connected accounts are the source of truth".
- **Cost:** chunked Sonnet extraction (~$0.05-0.3 for a long transcript) plus up to 4 move rewrites (Opus, roughly $1-2 each) plus new moves under `MOVES_WEEK_CAP_USD`. That is about $2-8 per real paste, and it is not under the daily caps.

### 3.13 Tenant learning ("What Brew learned": lessons, rules, checks)
- **What it does:**
  - Per-workspace lessons from steps (`stepLearn` → `learnFrom`: one Sonnet call on decided, feedback, dismissed, needs_you, ready, shared).
  - Rules from edits.
  - Jam checks.
  - All editable (`/tenants/:id/learning/...`).
  - Feeds `promptBlock` and the card's "learned" lines (`/api/cards/:cid/learned`).
- **Status:** **Working.**
- **Evidence:** `learn.js`, `feed-service.js:975-1016`, `:1376-1392`. Local: `[learn] needs_you: Brand manager checks this before a yes: …`.
- **Risks:**
  - It learns from simulated teammates (above).
  - The "measured / result" lesson branch is measurement leftover (`stage === 'result'` in the schema).
  - It costs one Sonnet call per stage change (~$0.01).

### 3.14 Teammate replies (@name), DUMMY #5
- **What it does:** "@Brand manager …" in the jam asks you to connect the **dummy** Slack first, then `POST /work/:wid/send`. After 5-7 s an AI teammate (in character from the role) replies "in Slack #growth" with a verdict.
- **Status:** **Dummy** (tagged in the jam room: `jam-room.js:83`, with a `dummy-tag` on colleague messages; `w.with.dummy = true`).
- **Evidence:** `feed-service.js:932-967, 1294-1310`.
- **Problems:**
  - The verdict **changes real state**: `approve` sets `w.signedBy` and moves the work to **Ready** ("approved v3. Ready to ship."); otherwise **Needs you** plus a notification.
  - The toast says "Posted to #growth for X" (`jam-room.js:244, 454`). False.
  - The offline canned replies include "Perfect, that answers it. Approving ✅".
  - The reply is folded into the brief (`onSay`) and the shared text with no Dummy label (reproduced).
  - It feeds lessons and brand memory.
  - The timers are in-process `setTimeout` (`feed-service.js:914` `later`), so a deploy loses pending replies.
  - Onboarding copy still sells it as real: "Send any card to a colleague on Slack. They approve in the thread and the card updates here." (`app.js:611`).
- **Production needs:** a real Slack app (OAuth, chat.postMessage, an Events API webhook back into the jam) or email; human approval only; never write simulated content into briefs or memory.

### 3.15 Plan questions and "Ask everyone" (simulated teammates and ShopOS team)
- **What it does:** each jam gets readiness questions per family (`remix.js:262-273` `QS`), owned by "ai" or by a role (perf, brandm, ops, growth). "Ask" or "Ask everyone" (`/work/:wid/plan/ask`) posts `@Role question` from **you**, then 4-7 s later a simulated answer:
  - written by Claude "as the {role}" (`liveAnswer`), or
  - taken from the canned `ANSWERS`.
- **Status:** **Cut-but-code-remains** (SCOPE cut "Scripted ShopOS team replies"), and also **Dummy** but **not listed in DUMMY.md**.
- **Evidence:** `remix.js:274-296, 1039-1058`; `app.js:1695-1696, 1862-1863` ("Asked everyone. Answers land here."); `jam-room.js:89`.
- **Severity: highest in this area.** The canned answers assert facts nobody checked:

  | Question | Canned answer |
  |---|---|
  | legal | "Cleared. Every claim on it is one our site already makes." |
  | rights | "Yes. The photos are ours, and review quotes are used with consent." |
  | tracking | "Verified this morning. Meta purchases match Shopify orders." |
  | stock | "Enough stock for the extra traffic." |
  | compliance | "The template is approved and opt-out works." |
  | budget_owner | "Yes, from this month's budget." |

  This breaks the SPEC hard rule "No invented numbers, quotes … or backstory".
  - The answers mark questions answered, which drives "ready to share".
  - They are recorded as checks (and can become brand rules).
  - They appear in the shared brief.
  - The owner `brew` path still answers as "Deploy lead on the ShopOS team" (no question currently uses it, but the code is live).
  - Only `from: 'colleague'` messages get the Dummy tag in the jam room; the plan answers in `app.js` don't.
- **Production needs:** delete this, or make it "send the question to the person" (copy or Slack) with no auto-answer.

### 3.16 Take it to WhatsApp / Slack, and paste the chat back
- **What it does:** `/jb/move` builds the full handoff text.
  - WhatsApp opens `wa.me/?text=…` (the user's own WhatsApp; nothing is sent by Brew) and copies the text.
  - Slack copies the text after a dummy-Slack connect.
  - `/jb/import` uses AI to fold a pasted chat back into the brief.
- **Status:** WhatsApp **Working**; Slack **Dummy, mislabeled**; import **Working**.
- **Evidence:** `jam-brief.js:234-253`, `jam-room.js:274-283`.
- **Problem:** the Slack toast says "Posted to #growth with the full context and a link to all of it" (`jam-room.js:281`). Nothing is posted.

### 3.17 Work board and stages
- **What it does:** the stages are drafting → team → needs_you → ready → **shared** ("Brief shared"). Board columns: `app.js:1924`, `2443` (`JAM_DONE = ['shared']`).
- **Status:** **Working** for the scoped stages.
- **Cut-but-code-remains:**
  - `deploying` / `out` / `measuring` / `result` in `feed-service.js:916` (`move` → `decideFromAction` on `deploying`), `:1238` ("It's live. Undo it first"), `:1255`, `:1369`
  - `handoff.js` `STAGE` ("Ready to ship", "Shipping", "Live, measuring", "Result in")
  - `jam-room.js:172` ("Shipped and measured", "Live on {target}")
  - `canvas.js:110-126`
  - `jam-brief.js` imports `measure-spec.js`; `JB.routes` gets `targetOf` via `deployTarget`
  - DEMO_OK still whitelists `work/:wid/live` and `changes/:chid/undo` (`feed-service.js:1413`), routes that no longer exist
- **Notifications** (`notes/clear`, `notes/read`): Working.

### 3.18 Share the brief (Share with the ShopOS team / Share with my team), BR-n
- **What it does:** `POST /work/:wid/doc/ship {to:'shopos'|'team', force}`.
  1. If items are missing, it asks once.
  2. It saves `w.jamBrief = finalDoc` (`md`, `missing`, `contributors`), stamps `sharedAt` and `to`.
  3. It assigns a ticket `BR-n` (first share only), builds the handoff and returns `{url, text}`.
  4. The client copies the text (`share.js`), and the stage becomes **shared**.
  - Nothing is sent from Brew (correct).
- **Status:** **Partial.**
- **Evidence:** `jam-brief.js:254-266`, `public/share.js`, `feed-service.js:194` (`nextTicket`). Local run: `ship1 needs ['When','Who it's for']` → force → `BR-1042`, stage `shared`, url `/h/t_…~wk_…~sig?full=1`.
- **Problems:**
  1. **Not frozen.**
     - The `/h/` page and the copied text are rebuilt from the live `w` (`handoff.js` `build`: "always the latest state").
     - The brief stays editable after sharing: `/doc` accepted an edit, the stage stayed `shared`, and the `/h/` page showed it.
     - `w.jamBrief` is never used to render the page. Re-sharing overwrites `jamBrief`, so there is no history of what was actually sent.
  2. **BR-n is per workspace, not per brand or globally unique.** `t.ticketN` starts at 1041, so the first share in every workspace is BR-1042. Two teammates' workspaces collide. `leadsAllTenants` is an in-memory counter.
  3. **The copied text contains the simulated teammate chat** ("Jam so far") and AI plan answers, unlabeled.
  4. **It contains the workspace share token** (`links.jam`, `&s=…`), which works as a team invite.
  5. **"Share with my team" omits the read-only page link** (`handoff.js:47` adds it only for `to === 'brew'`). This contradicts SCOPE and the share.js header.
  6. **The header says "Needs your yes" while the body says "Where it is now: Brief shared".** The handoff is built before `move(…,'shared')` (`jam-brief.js:262-265`).
  7. The handoff `links.studio` is brandless (`https://brew.joinsquareup.com/#remix=…`, from the local run). It opens the default context, not the brand. Likely broken.
- **Production needs:**
  - immutable snapshots: render the frozen `jamBrief`, show a version history, block edits or fork a new version after sharing
  - a global ticket sequence (DB)
  - a read-only token that does not grant workspace access
  - a "Dummy" or "simulated" label (or exclusion) for simulated content

### 3.19 Read-only `/h/` page
- **What it does:**
  - `/h/<tid>~<wid>~<sig>?full=1` renders an HTML page (card, options, decided, brief, versions, package, assets, jam and studio chats, questions, measure), `noindex`, no login.
  - Without `?full=1` it 302-redirects to the jam itself with a share token.
- **Status:** **Working**; **Untested** by automated tests.
- **Evidence:**
  - `feed-service.js:1438-1446`, `handoff.js:11-27`, `handoff.js` `html`
  - Live: a bad token returns 404 "This handoff link is not valid."
  - Local: the page rendered (~15 KB) with BR-1042.
- **Risks:**
  - **The secret.** HMAC key = sha256(`HANDOFF_SECRET` || `ANTHROPIC_API_KEY` || 'local'). `deploy.sh` does not set `HANDOFF_SECRET`, so production links are keyed off the Anthropic key. Rotating that key breaks every shared link.
  - **Signature length.** The signature is 12 base64url characters (72 bits). That is fine.
  - **The page is live, not frozen** (above).
  - **The tenant id is visible** in the URL. That gives access to `GET /api/tenants/:id/share` (the share token) and every `GET` under the tenant: feed, work and cards are readable by anyone with the id (no `gen` check on GETs).
  - **The redirect form grants more access.** `/h/<token>` (without `full`) redirects to the jam with `&s=` (a team invite).

### 3.20 Dead or leftover routes that are still reachable

| Route | What | Client caller | Status |
|---|---|---|---|
| `POST /api/jams` (`feed-service.js:1184-1199`) | old jam router; "The ShopOS team has it. Usually replies in 12 to 24 hours." | none | Cut-but-code-remains |
| `POST /api/jams/:jid/whatsapp` | "Thread moved to WhatsApp. The pod replies there and here." | none (allowed in demo mode) | Cut-but-code-remains |
| `GET /api/slack/workspace`, `POST /api/slack/post` (`server.js:305-306`) | canned Slack | none | Cut-but-code-remains |
| `POST /api/ai/jam` (`server.js:598`) | streaming jam chat | none | dead (genOk-gated, spends) |
| `POST /api/ai/hearted`, `/api/ai/remix-image` (`server.js:283-303`) | old variants and photo edit | none | dead (genOk-gated, spends) |
| `POST /api/cards/:cid/versions` (`feed-service.js:1176`) | old version tiles | none found | probably dead |
| `ai.js` comment "agent-runner.js" | cut Do it now runner | n/a | stale comment |

---

## 4. Security and privacy (this area)

1. **Memory writes on unclaimed brands (arata-in included).** Anonymous add, forget, learn and consolidate, all paid (`memory-routes.js:17`).
2. **Public `/told`.** Meeting notes and plans for any brand (`server.js:473`).
3. **Public `GET /memory`.** All brand facts and the log, and it advertises `canWrite`.
4. **Unauthenticated `/api/transcribe`.** Our OpenAI key, 80 calls per IP per hour, no global cap.
5. **The share token in every shared brief, and `GET /api/tenants/:id/share` with no auth.** The `/h/` link reveals the tenant id, which yields the token, which signs a person into the brand team (`shareJoin` adds the member with 'all' views when the brand has an owner).
6. **The `HANDOFF_SECRET` fallback** to the Anthropic key, or 'local' in development.
7. **https photo URL fetch** (mild SSRF) for people allowed to generate.
8. **GETs on a tenant need only its id;** POSTs need `genOk` (OK).

## 5. Data integrity (dummies leaking into real data)

| Leak | Path | Effect |
|---|---|---|
| Simulated teammate reply → brief | `jam-brief.js:190` `onSay` → `edit(mode:'hear')` | invented positions inside the brief that is shared |
| Simulated / canned plan answers → plan, checks, brief, shared text | `remix.js:1039-1052`, `ANSWERS` | invented legal, rights, tracking sign-offs |
| Simulated approval → stage Ready | `feed-service.js:962` | the board says a person approved |
| Simulated pushback → lesson → brand memory `rules.md` | `stepLearn`, `learn.js` `onLesson` | reproduced locally; persists to the bucket in production |
| Dummy connector numbers → brief prompt "quote these exactly" | `jam-brief.js:127` | simulated numbers in briefs |
| Dummy connector facts treated as "connected" truth | `connectors/sim.js:29` (drops `demo`) → `facts-desk.js` → `brand-learnings.js` `conflictsOf` | real team input rejected in favour of dummy numbers |

## 6. Tests for this area

| File | Tests | Covers |
|---|---|---|
| first-drafts.test.js | 8 | drafts-bg format mapping, mocks, back-fill; Chrome render skipped |
| image-guard.test.js / image-fallback.test.js | 5 / 6 | right-product check, retries, photo fallback |
| brand-memory.test.js | 8 | mem0 ADD / UPDATE / DELETE / NONE, repo render |
| brand-learnings.test.js / learned-rank.test.js | 15 / n | command parse, extraction, conflicts, who may run it |
| jam-coverage.test.js | 2 | every move or card maps to a canvas and a measure |
| card-plan, card-action-map, listen-ideas-wiring, audit-server-fixes | n | studio and remix helpers, knobs |
| ui-audit-r3.test.js | 4 | version labels |
| **None** | — | handoff.js, `/h/`, share tokens, jam-brief routes (doc, ask, ship, move, import), one-tap `/draft`, `colleagueReply`, plan/ask, memory-routes auth, `/told`, `/api/transcribe`, share.js, composer.js, canvas.js, jam-room.js, the dual version sync, the daily caps |

The whole suite runs in 1.3 s with `AI_MOCK=1`. `deploy.sh` refuses to deploy on failure.

## 7. Cost and latency summary (estimates; nothing was run live)

| Action | Calls | ~Cost | ~Latency |
|---|---|---|---|
| Brief ask / edit | 1 Sonnet (+1 for `syncPlan` on a manual edit) | $0.02-0.05 (Opus 2-3×) | 5-20 s |
| Teammate reply (dummy) | 1 Sonnet | ~$0.01 | 5-7 s artificial delay |
| Ask everyone | 1 Sonnet per question | ~$0.01 each | 4-9 s each |
| Step lesson | 1 Sonnet per stage change | ~$0.01 | background |
| Canvas compose | 1 Sonnet | <$0.01 | 2-5 s |
| Card page (non-prebuilt) | 1 Sonnet (3.5k out) | ~$0.04 | 10-30 s |
| Image draft | Sonnet + Gemini 3 Pro Image + Haiku check (+ regen) | $0.2-0.5 | 20-60 s |
| Carousel | Sonnet + up to 8 images + Chromium | $0.5-1.5 | 1-3 min |
| Video | Sonnet + image + Veo 3.1 Fast 6 s + TTS | ~$1.1-1.3 | 2-4 min |
| Voice | Sonnet + Gemini TTS | ~$0.04 | 10-20 s |
| Brand learnings paste | Sonnet extraction + ≤4 move rewrites + new moves | $2-8 | minutes (background) |
| Memory note / learn | 1-3 Sonnet + embeddings | $0.01-0.07 | 5-20 s |
| Mic | gpt-4o-transcribe | ~$0.006 per minute | 2-5 s |

## 8. What production needs (this area)

1. **Remove or quarantine every simulated voice:** colleague replies, plan auto-answers, the `ANSWERS` table, "Deploy lead". If kept for demos, gate them to `DEMO_MODE` and never feed them into briefs, lessons, memory or shared text.
2. **Real teammate loop:** Slack app (OAuth, post, Events API back into the jam) or email; human approvals only; delete the "Posted to" toasts until that is real.
3. **Immutable shared briefs:**
   - render `/h/` from the frozen `jamBrief` snapshot
   - lock or fork on edit
   - a global BR sequence in a DB
   - a dedicated `HANDOFF_SECRET`
   - read-only tokens separate from workspace and team-invite tokens
4. **Auth on the memory and learnings routes** (team only, signed in), `/told` (team only), and `/api/transcribe` (signed in, under the voice budget).
5. **Real budgets:** per-brand and per-user dollar caps, a persistent ledger, metering for `claudeTool`, counting guard retries and Opus, rate limits.
6. **Connectors:** keep the `demo` flag on simulated ledger entries (`connectors/sim.js:29`), and keep dummy numbers out of `accountLine` and the learnings conflict check.
7. **Delete cut code:**
   - the `deploying` / `out` / `measuring` / `result` branches
   - `/api/jams*`, `/api/slack/*`, `/api/ai/jam|hearted|remix-image`, `/api/cards/:cid/versions`
   - the remix `target`, `rollback`, `money`, `irreversible` fields (or rename them as brief info)
   - the DEMO_OK entries for routes that no longer exist
   - the stale "Hailuo" text and the onboarding Slack copy
8. **"A link: Brew reads the page":** add a server fetch (reader/crawl) or web search to the brief edit, or remove the menu item.
9. **Tests** for handoff and share tokens, ship, freeze, memory-routes auth, the caps and the dummy-leak paths above.
10. **Persistence:**
    - Tenants and jams live in in-process maps plus `store.save` to the bucket.
    - Teammate and plan timers are `setTimeout`, so they are lost on deploy.
    - The single instance (`--max-instances=1`) is what keeps caps and timers consistent; scaling out breaks both.
