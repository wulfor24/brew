# Brew handover audit, area C: the Feed

Auditor: Claude (read-only audit, 2026-10-15, ~16:10 IST). Repo `/Users/param/Documents/ChatGPT/brew` at HEAD `ea6cfd7`.
Live: https://brew.joinsquareup.com/arata-in (Cloud Run `shopos-feed`, 1 instance, 2 CPU / 4 GiB, CPU always on, `--max-instances=1`, `deploy.sh:13`).

Method: read SCOPE/DUMMY/SPEC/README/CLAUDE/docs/brew-loop.md and every feed file; ran the free suite
(`AI_MOCK=1 node --test test/*.test.js`: 222 tests, 219 pass, 3 skipped, 0 fail); booted the feed service **in-process**
(no port: the sandbox blocks listening) on a copy of the local `arata-in` pack with AI, treg and research mocked, and drove
its real routes (create workspace, `/feed`, `/watchers/run-all`, `/engine`, `/stories`, `/state`, `/pulse`, `/cards/:id/page`);
made GET-only calls to live. Nothing was spent, no POST was sent to live, no repo file was edited. The harness is at
`scratchpad/h/run.mjs` (it reads a copy of the pack under `scratchpad/h/root`).

---

## 0. Is the last commit live? **Yes (corrected after the audit).**

This audit checked at about 16:05 IST, before the 16:09 IST deploy, and at that moment live still served `7002bcc`. A re-check at 16:30 IST showed revision `shopos-feed-00169-5r6` serving `ea6cfd7` on both sites: the served `app.js` and `jam-room.js` are byte-identical to HEAD, and `/api/brands/arata-in/told` returns JSON. **The `told` ranking bugs B3 and B4 below are therefore live.**

---

## 1. How the feed works (one paragraph for a new engineer)

A brand pack (`.brands/<slug>/` ↔ `gs://brew-prototype/brands/<slug>/`) is loaded by `brand-pack.js loadGenerated`
(`brand-pack.js:186-226`). `seed.posts` is assembled at load from the move cards written by `cards-gen.js`, plus every
finished static (`visualize`), plus Heard and Ideas cards (`social-feed.js socialize`), photo fixes (`fitPhotos`), demo
connector cards (`withDemo`, Dummy), sentence-casing and the "make" back-fill (`fitCards`). A **workspace** ("tenant", one per
browser/person, `t_<8 hex>`) clones those posts into `t.cards` (`feed-service.js:209-233`) and is kept **in memory** in one
Map, saved to disk + GCS by `store.js`. On `GET /api/tenants/:id/feed` (`feed-service.js:1101`) the service syncs the
social rotation, scores every visible card (`score`, `:280-299`), groups and dedupes (`rank`, `:336-362`), then lays out
the first screen (`feed`, `:364-399`: 2 picture cards per text card, social seats at 3 and 7, ad/post seats at 2 and 6,
no two of a sort in a row, one card per group in the first 12). Each card is published with its plan, first draft and
margin note (`pub`, `:403`). Watchers (`:82-95`, `:640-684`) add cards from live research (`research.js`), live checks
(`live-watch.js`) and a Creative agent, through a QA gate (`:406-469`). Stories (`:784-839`) are a separate 24 h ring view
over the research snapshot. Card pages (`:1340-1362`) are AI-written once per card on first open.

### Map of `feed-service.js` (1,483 lines, 175 KB; many lines are 300-600 chars)

| Lines | Section | Area | Note |
|---|---|---|---|
| 1-41 | imports, constants, `AGENT`, `FAMILY` | feed | header comment still says "daily free budget, action runs behind a weekly spend limit, deployment workbench" (all cut) |
| 43-58 | `genericMeasure` / `MEASURE` | **cut (measurement)** | metric/baseline/holdout text per sector; still fed to card pages and `pub().measure` |
| 60-80 | `followMoveCards` (pure, tested) | feed | move cards follow move rewrites/retirements |
| 82-95 | `watchersFor` (7 watchers) | feed | `ads`(sample) and `batches`(sample) variants only for non-generated brands (dead) |
| 97-105 | `ROUTE_RULES` | legacy jam router | |
| 107-140 | `followRead` (pure, tested) | onboarding SSE | |
| 142-206 | service setup, helpers, `fill({diwali})` | feed | |
| 209-253 | tenants, `streamSync`, housekeeping | feed | |
| 255-300 | ranking `score` | feed | |
| 301-321 | `seatOk`, `noChange`, `visible`, `applyLive` | feed + Dummy connectors | |
| 322-399 | `groupOf`, `dupOf`, `rank`, `feed` (layout/seats) | feed | **no unit tests** |
| 400-404 | `measureOf`, `pub`, `allCards` | feed | `pub` adds note, draft, plan, measure |
| 406-469 | QA agent (`qaCheck`, `mechanicalFix`, `pipeline`) | feed | Arata-shaped rules inside (section 6) |
| 471-524 | pools, `realBatches`, `fromOwnAds`, `tickBatches` | feed | `tickBatches` simulated progress = dead for generated brands |
| 525-550 | `creativeIdea` (Creative watcher) | feed | hard-coded lanes `core|mito|dandruff` |
| 551-590 | research → cards (`adCard`, `trendCard`, `howtoCard`) | feed | |
| 592-638 | live → cards (`liveCard`: catalog, AI answers) | feed | CTAs promise actions Brew no longer takes |
| 640-684 | `runWatcher`, `tick` (5 s), saver (20 s) | background | |
| 686-707 | heart → "three more" child card | feed | |
| 709-744 | legacy jam router, `makeVersions` | jam/legacy | |
| 746-783 | `metrics`, `engine` (debug view) | debug | metrics count cut things (approvals, Free to Pro) |
| 784-839 | stories (rings) | feed | |
| 841-885 | onboarding stream | read | `FINDS` has a hard-coded "Found 4,683 reviews" (non-generated path only) |
| 887-1048 | work board, colleague replies (Dummy), learning | jam (area D) | `NEEDS`/`deployTarget` = Do-it-now remnants |
| 1050-1213 | HTTP routes: tenants, feed, deck, stories, pulse, events, cards, feedback, actions, image, versions, jams, watchers, clock | feed | |
| 1214-1339 | work routes, studio wiring | jam (area D) | |
| 1340-1394 | card pages, `learnedFor`, `/learned`, `/page`, `/moves` | feed | pages cached in memory only |
| 1399-1413 | `getTenant` (restore from store) | feed | |
| 1414-1471 | `DEMO_OK`, `handle`, `handleIn` | feed/auth | errors returned as HTTP 200 `{error, fallback:true}` (`:1466`) |
| 1472-1483 | `addCards`, `refreshLive`, `syncSocial`, `dropCards` | feed | push new cards into open workspaces |

---

## 2. Feature inventory

Status legend: **Working** (does what it says, verified), **Partial** (works with real gaps), **Broken**, **Dummy**
(simulated by design), **Cut-but-code-remains**, **Untested** (plausible, not verified and no test).

### 2.1 Move cards (`cards-gen.js fromMove`) — **Working**
- What: 1-2 cards per move (Sonnet, JSON schema), id `mNN-i` / `m1001-i`; type, title, two-sentence sub, why/how, rows,
  CTA, `make` (format + pieces), `plan`. Fact gate drops any card with a number not in the fact sheet, the move's backed
  numbers or the ledger (`cards-gen.js:130-133`).
- Evidence: live seed has 158 posts, 131 from moves (`/b/arata-in/seed.js`); `test/audit-fixes.test.js` (fact gate in
  cards-gen), `test/first-drafts.test.js` (make back-fill), `test/card-plan.test.js`.
- Risks:
  - Arata's pack holds **71 move docs**, not 51: 00-50, then 51-54, 57-59, 61-65, **765**, **966**, 1006-1011
    (`moves.json`). 51-65/765/966 are "listening-era" and dynamic moves (`moves-engine.js:2`, `dynamicSpecs` numbers them
    `100 + hash % 900`, `moves-engine.js:262-266`). The feed ranks their cards like any other (the harness put `m966-1`
    at #2 for a CRM seat). SCOPE/README still say "51 moves"; the work card says "Your 51 moves" (`feed-service.js:484`)
    and only counts PDFs `<= 50`. Numbering is a three-scheme mix (00-50, 51-999 dynamic, 1001+ cadence).
  - `moveOfId` uses `/^m(\d\d)-/` (`feed-service.js:302`): 3- and 4-digit moves never match, so a member's private
    rewrite (`privMoves`) can't hide shared cards of moves ≥ 100. `moveNoOf`/`moveNo` use `\d+` correctly.
  - Cost: one Sonnet call per move (~$0.3-0.4 per weekly cadence run per brand incl. cards, per docs).

### 2.2 Read cards (`cards-gen.js fromRead`) — **Working**
- 4 cards `read-1..4` "Read from arata.in today" in live seed. Value fixed at 5 (`value.js:43`). No dedicated test.

### 2.3 Statics as cards (`brand-pack.js visualize`, `statics.js`) — **Partial**
- What: every finished static (Gemini scene around the real product photo + exact headline set by Chromium) becomes its
  own card `static-<id>`, "Move 21 · static ad".
- Evidence: live seed has 8 statics (e.g. "474 reviews. 4.57★.", "MitoActive™ + shampoo, ₹1,803").
- Gaps: in the harness they ranked **#73-#98 of 146**. Statics get the fallback value 3 (`value.js:46`, no rule for
  `static-`), so the feed's strongest picture assets sit below 70 move cards. The "two make seats" (2.9) do include
  `static-` ids but are filled by higher-scoring make cards first. Statics are hard-wired to "Move 21" (`statics.js`
  prompt, `visualize` src): if the ad-creative move is ever renumbered, statics break silently.
- Cost: 8 Gemini image calls + 1 Sonnet per build; no regeneration on the feed path.

### 2.4 Ranking (`score`, `feed-service.js:280-299`) — **Partial**
- What: `total = value (0-10, value.js) + seat + affinity + freshness + fatigue + "fewer" + extra (told, boost, connector)`.
- Evidence: harness output (section 4). `test/value.test.js` covers `valueOf/cardValue` only; **`score`, `rank` and
  `feed` have no tests at all.**
- Findings:
  - **Seat outweighs value.** Seat is 4-6.5 for almost every card (default founder, wants `decision`+`idea`), value for
    graded moves is 0.8-5. A move graded 0.78 ("Start the curl circle with 30 founders") scores 12.53 and ranks #9, ahead
    of moves graded 3-5. The value grading (`value.js`, ~$0.10/brand) barely moves the order.
  - **Layout overrides score.** The 2:1 picture/text rhythm, the seat swaps and the "no two of a sort" swaps run after
    sorting, so #1 is often not the best card: harness #1 `m32-2` (11.82, value 1.76) sits above `m48-1` (12.99) at #17.
    The rhythm only refuses a swap when the gap is > 2 points (`:373`).
  - **Default lane `core` does not exist for real brands.** Client and server default the viewer to `lane: 'core'`
    (`public/app.js:158`, `feed-service.js:213`). Arata's lanes are `combo`, `gel`, `shampoo`. Move cards take the first
    real lane, but research, live, own-ads, how-to and Creative-watcher cards are hard-coded `lane: 'core'`
    (`:553`, `:558`, `:601`, `:619`, `:537`), so a viewer who skips the product picker gives all watcher cards a
    +1.44 seat lift over move cards, and a viewer who picks a real lane never matches them.
  - `impactOf` (money-in-text impact) only applies with `config.baseMonthly`, which generated brands don't set. Dead in practice.
  - `fresh`: streamy cards get up to +3 decaying over 24 h, others +1 over 72 h. Fine.
  - Fatigue reads `t.shown`, which grows forever per card (no pruning).
- Production needs: tests for `score/rank/feed`; normalise seat; give statics/ads a value; fix the lane default
  (default to the brand's first lane, or drop lane from watcher cards).

### 2.5 Learned ranking ("told" boost, `ea6cfd7`) — **Partial: live, has bugs**
- What: +5 if a card quotes the team or shares ≥ 3 rare words with a learning; else +2 if its move quotes the team
  (`feed-service.js:295`, `brand-learnings.js:180-199`).
- Evidence: `test/learned-rank.test.js` (2 tests, matcher only). Live since 16:09 IST (section 0).
- Bugs:
  - `TEAM_CITE` alone returns true even when the brand has **no learnings** (`cardUsesLearned`, first line). On Arata, 5
    cards match phrases like "the team says"/"The team wants" from AI-written move text and get +5 regardless.
  - `learnedMoveNs` marks **32 of 71** Arata moves as "resting on what the team told Brew" (+2 each): the signal is too
    broad to mean anything.
  - The result is cached on the card object as `c._told ??= …` and persisted with the workspace (`store.js` serialises
    the whole card). New learnings never re-score existing cards; a card scored before learnings existed stays 0 forever.

### 2.6 Seats / roles / views — **Working**
- What: `roles` on cards; a member limited to some seats (`t.seats`) only sees cards for them (`seatOk`, `:304`);
  `clampSeat` keeps the viewer on an allowed seat; a card outside your seats 404s by id (`:1459`).
- Evidence: `test/team-seats.test.js` (11 tests). Ad/post cards reach the founder (`cards-gen.js fitRoles`); 139/158 live
  seed cards include `founder`.
- Risk: workspace id = only access key for a workspace (`t_` + 8 hex, 32 bits). Anyone holding it (share links carry
  it) reads the full feed; seat limits are applied per request viewer, which is correct.

### 2.7 Groups and dedupe (`groupOf`/`dupOf`, `:324-335`) — **Partial**
- What: one card per group (a move's cards, a live check's readings, one rival's ads, one trend widget, one festival
  idea) in the first 12; repeats wait until after position 12; identical live readings collapse to the newest.
- Bug: **seated cards bypass the group rule** (`:394` `!seated.has(c)`). After watchers ran, both ad seats (#2 and #6)
  went to two Traya ads (`r-ad-1624…`, `r-ad-1783…`), both group `ad:traya`. The seat meant for "an ad or post you can
  make" was filled with two rival ads from one competitor.
- Fixed recently: price cards that show no change (`noChange`, `:308`, commits `dee01c5`, `e273ca7`); one card per trend
  widget and one festival idea (`7002bcc`).

### 2.8 Picture/text rhythm — **Working** (by design; see 2.4 for the cost)
- `isVis` (`:369`); 2 visual : 1 text; harness first screen V V T V V V V V T V V V (the rhythm bends when text cards are scarce).

### 2.9 Ad and post cards hold two seats (2 and 6) — **Partial**
- `:380-382`. Works for move cards before watchers run (harness: #2 `m1007-1` reel, #6 `m1011-2` single image ad).
- After the watchers post, rival ads (`research.kind === 'ad'`) count as "make" cards and outrank: both seats went to
  Traya ads (2.7). A competitor's ad is a reading, not something the brand makes. Statics never reach the seats.

### 2.10 Social seats (3 and 7) — **Working**
- `:376-377`. Harness: #3 Heard theme (text), #7 Instagram idea (visual), in every run, including other seats.

### 2.11 Heard (listening cards) — **Partial**
- What: 2 question cards ("Asked in r/x: …, Reply as the brand") and 2 theme cards (count, mood, two linked quotes)
  from `listen/*.json` (`social-feed.js heardCards`).
- Evidence: live `/api/brands/arata-in/heard`: 1,207 items, 8 sources OK, 4 not read, read 5.6 h before the check;
  `test/listen-ideas-wiring.test.js` (19 tests), `test/listen-signals.test.js`.
- Gaps:
  - Video reviews are classified as questions: live top "question" is a YouTube channel ("Asked in DimpleBunty_Offical:
    ARATA Mito active product review after 14 days…"). The card says "Asked in…" and "Reply as the brand" on a review video.
  - Skipped-by-design sources are listed as failures ("Walmart reviews: skipped: Walmart is read for US brands",
    "Telegram: skipped: no channel known"). Real failures on live: YouTube Data API 429; Myntra "needs APIFY_TOKEN"
    (no Apify token on live, so Indian marketplaces fall back or fail).
  - Docs vs code: `docs/brew-loop.md` says listening runs every ~24 h with a $2/day cap; code runs **every 8 h** (one full
    + two "lite" reads a day) with a **$3/day** default cap (`social-feed.js SOCIAL_DEFAULTS`).
  - Listening is **not** gated on anyone opening the brand (only ideas are, `dueFor`): every built brand listens 3×/day forever.
  - The lite-run cap is not respected: local `social/state.json` shows a lite run (`full:false`) costing **$0.63**
    against a $0.15 lite cap.
- Cost: ~$0.30 full + 2 × ~$0.05 lite per brand per day (estimates in code); observed $1.57 on 2026-10-14 for Arata.

### 2.12 Ideas stream — **Partial**
- What: ready-to-post ideas per platform with where-to-post threads; 6 newest + daily rotation, max 12 (`pickIdeas`).
- Evidence: 6 idea cards in live seed (Quora answer, Instagram reel, Reddit reply, YouTube Short…); tests in
  `listen-ideas-wiring.test.js`.
- Gaps: the last local ideas run made **0 ideas for $0.19** (`social/state.json ideas.made: 0`); nothing flags an empty
  run. Idea cards bypass the QA gate (they are seed cards); e.g. "Hair fall shampoo options with prices: Arata, The Derma
  Co, Mamaearth" names rivals (fine for a Quora answer, but no check distinguishes).
- Cost: est. $1 per run (Opus slate + writes + Sonnet check), at most daily, only for brands opened in 3 days.

### 2.13 Stories (24 h rings) — **Working** (with data-quality issues)
- What: rings Brand today / Trends / Popular ads / Industry news / How to; each item lives 24 h from first sight, scored
  0.4 × freshness + 0.6 × strength, cut-off 0.45 (`STORY_CUT`), ring hidden when empty (`:789-839`); expired items go to
  a 30-day archive that the watchers can still turn into cards (`research.js pool`).
- Evidence: `test/stories-life.test.js` (5 tests); live `/api/research` (arata-in): ads 6, own 13, trends 10, news 15,
  how-to 6, fetched 2-10 h ago, no `lastError`; harness rings brand 3, trends 4, ads 4, news 10.
- Data-quality issues seen live:
  - Near-duplicate trend stories survive the key dedupe (keys differ by kind/terms): "Serum-for-thickness searches are up
    100%" and "Serum thickness searches up 100% and 50%"; two Diwali calendar stories saying 24 and 25 days.
  - Low-signal trend stories: "Anti-dandruff searches rose from 0 to 7 in 30 days" (index 0→7, i.e. noise).
  - How-to duplicates: "Dandruff combo: ₹866, 203 reviews" and "Anti-dandruff combo: ₹866, 203 reviews".
  - Prices with paise in stories (₹1,850.60, ₹642.32) — the paise fix covered catalog cards, not research text.
  - `own.live` jumped 664 → 1,296 between reads (`own-count-2026-10-15` event, which becomes a "Live ads went from 664 to
    1,296" card). `live` is Meta's `searchResultsCount` (individual ad versions), not distinct ads; move 1011 still says "664".
  - "Brand today" ring: the `shipped` and "latest measured result" slides read `storyExtra.news`, which only the simulated
    batch ticker fills (non-generated brands): dead for real brands.
- Observed once: 1 of 19 GETs to `/api/research` returned an **all-null snapshot** (`ads/own/trends/news/howto: null`)
  13 min after the deploy; the other 18 were full. Likely cause (unverified): `server.js attach()` replaces a brand's
  research instance when its config key changes and the new instance answers before its async `load()` finishes. A
  viewer at that moment sees every ring "loading".
- Cost: research per brand every 30 min tick: ads 6 h (≤5 rival treg calls + 1 Claude vision call), own ads 12 h (1
  treg), trends 6 h (DataForSEO + SerpApi + 1 Claude), news 4 h (Claude web search, 8 uses), how-to 12 h (1 Claude + up to
  3 Gemini images). Logged Claude spend for a news refresh: $0.39. **Runs for every brand loaded since the last restart,
  forever** (instances are only stopped when replaced), not only brands someone opens.

### 2.14 Research cards (Popular ads, Trends, How-to) — **Working**
- `fromResearch` (`:579-584`), strongest first, live and archived. QA lets rival ad copy keep its own banned words
  (`:437`). Each card has a link to the Ad Library / source. `/research-card` (`:1111`) makes the card from a story button.

### 2.15 Catalog watcher (`live-watch.js refreshCatalog`) — **Working** (Shopify only)
- What: every 3 h, free, reads `products.json` (≤ 1,250 products); events: drift (a price our cards quote changed),
  gone, out of stock (quoted products marked urgent), back, price, removed, new (14 d), thin (≤ 1 photo).
- Evidence: harness made "2 products our cards sell are out of stock", "4 products are out of stock", "7 new products
  are live" from the local snapshot; paise fix `live-watch.js:96`; no unit test for the event builder.
- Gaps: non-Shopify stores (`!cfg.catalogUrl`) get nothing (silent). Card CTAs/how-steps promise actions Brew no longer
  takes: "Pause what points there", "We tell you the moment stock is back", "We restart anything paused", "We update
  the fact sheet the cards read", "We add them to the listings" (`feed-service.js:603-616`).

### 2.16 AI-answers watcher (`live-watch.js refreshVisibility`) — **Partial**
- What: weekly, 8 questions × 4 engines (ChatGPT/Gemini/Perplexity via treg DataForSEO, Claude with web search);
  events: score, gap (0 of N, rivals named), win, loss. ~$0.50/run (comment `live-watch.js:17`).
- Bug: the QA gate drops gap cards when **the shopper's own question** contains a banned claim word. Arata's q2 "which
  hair serum actually works for hair **regrowth**…" trips `regrow\w*` (`config.banned`); `mechanicalFix` rewrites the
  title but not the quoted question in `q`/`a`, so the card is dropped after 3 attempts (harness QA log: "AI visibility
  dropped … No banned words"). The most commercially useful gap never shows. Brand-agnostic bug.
- The score card can say "12 of 32"; `e.total / 4 | 0` assumes all 4 engines answered each question.

### 2.17 Own ads watcher (`fromOwnAds`, `research.js refreshOwn`) — **Working**
- Long-running (≥ 60 d), new, count change, none. Live: 7 new ads card, count 664→1,296 card (see 2.13 caveat).

### 2.18 Creative watcher (`creativeIdea`, `:525-550`) — **Partial**
- What: Claude writes one ad idea, Gemini makes an image from the lane photo; every 3 min while a gen-capable person has
  the feed open, ≤ 3 per workspace per day; falls back to `pools.creative` (empty for generated packs, so "Nothing new").
- Bugs/risks: lane enum hard-coded `'core'|'mito'|'dandruff'` (Arata's old lanes) in the prompt and validation (`:536-537`);
  the prompt's "only these numbers" lists every fact, so the 7002bcc title-price check is the real guard. Budget is
  **per workspace, not per brand**: 5 teammates = 15 Claude + 15 image calls a day. When the festival date passes,
  the prompt says "Diwali is 8 November (-N days away)" (`:536`, no clamp).

### 2.19 QA gate (`qaCheck`/`pipeline`, `:430-469`) — **Partial**
- Checks: names a number, banned words, "up to … N days" claim window, no rival in idea copy, title ≤ 76, title prices
  match text, no design notes, every ₹/% in the fact sheet. Fail → `qaFix`/`mechanicalFix` rerun ×2 → dropped; only
  "no number" → story slide.
- Arata leftovers: the claim regex is literally `\d+ new hairs` (`:433`, `:447`); `mechanicalFix` replaces rival names
  with "other serums" (`:447`); `repairHeartKids` filters two Arata variant titles (`:691`). Watcher-made cards only;
  seed cards (moves, ideas, heard) never pass this gate (they have their own fact gates upstream).

### 2.20 Margin notes (`notes.js`) — **Working**
- One Sonnet call per ~40 cards, ~1 in 2 cards gets a note; every number must be on the card; written on load
  (`server.js:325`, Cloud Run only). Harness: 83 of 155 cards carry a note; `test/notes.test.js` (4 tests). ~$0.05/brand.

### 2.21 Move value grades (`value.js`) — **Working**, low impact (see 2.4)
- One Sonnet call per 20 moves, once per move version, ~$0.10/brand; `test/value.test.js` (4).
- `now` flag in the grade ("Brew can do it on the brand's own stack today", `value.js:7`, `:69`) is a Do-it-now remnant that still adds +0.4.

### 2.22 First drafts on cards (`drafts-bg.js`, shown by `pub` and `draftSlot`) — **Working** (area D owns the job)
- Harness: 31 cards with a draft. The client shows the draft in place of the lane photo, labelled "First draft".

### 2.23 Card plan (`card-plan.js`) — **Working**
- Every card gets a no-AI plan at publish (154 of 155 in the harness); `test/card-plan.test.js` (8, 1 skipped "no .brands").

### 2.24 Card page (`card-page.js`, `/api/cards/:cid/page`) — **Partial**
- What: options (one pick), recommendation, what follows, move passages; Sonnet `claudeTool` (3,500 tokens, effort low) on
  first open; fallback page offline/demo.
- Gaps:
  - **Cached in memory only** (`PAGES[key] = …` on the in-memory pack, `:1360`). `pages.json` does not exist for arata-in
    and nothing writes it; `tools/build_card_pages.mjs` named in `card-page.js:6` does not exist. Every pack reload
    (social refresh, drafts, learnings, facts desk, deploy) drops all pages, and the next open pays again.
  - The schema still asks for a per-option **measure** including "guard: when we stop or roll back" and a "main measure"
    with baseline/target (`card-page.js` `PAGE_SCHEMA`, `measureLine`), fed by `genericMeasure`. That is measurement
    framing from the cut engine.

### 2.25 Feedback: heart / not for me / fewer / snooze / note — **Working**
- `/api/cards/:cid/feedback` (`:1141`). Heart makes a "Three more in the direction you hearted" child (AI or mock
  variants, numbers gated by `variantOk`). Notes and dismissals feed `learn.js` lessons. No test of the route.

### 2.26 Pulse / new-cards pill / pin — **Working**
- `/pulse?since=` counts watcher cards posted after `since`, not first-load, not shown; client polls (`app.js:2060-2084`),
  pins pulled-in cards on top for 30 min.

### 2.27 Deck view (`/deck`) — **Working**, untested
- Columns by sector. No test.

### 2.28 Connector cards and health card — **Dummy** (by design, DUMMY.md #1-3)
- 12 `demo-*`/`onlyWhen` cards in live seed (e.g. "66,160 checkouts left last month, ₹13.50 Cr in carts"); shown only when
  the simulated account is "connected"; tagged `.is-dummy` (`app.js:722`, `:784`). Health card `.is-dummy` (`:735`).

### 2.29 Pro / daily cap — **Cut-but-code-remains** (cap) / **Dummy** (plan sheet)
- `feed()` returns `limit: { plan, daily: null, locked: 0 }` (`:398`); `t.plan`, `proAt`, `/state {pro}` and the
  `Free to Pro` metric remain; the deck upsell card is `.is-dummy` (`app.js:748`).

### 2.30 Engine view (`/engine`, "run every watcher", "skip a day") — **Working** (debug), partly cut
- Shows watchers, QA log, pipeline, ranking breakdown, metrics. "Approvals this week" counts `t.runs` (action runs, cut:
  always 0); "Team jams… tracked as deployment leads". `/clock` (time travel) is allowed in demo mode (`DEMO_OK`), and
  shifts `t.clock` for everyone sharing that workspace.

### 2.31 Onboarding stream (`/onboarding` SSE) — **Working** (generated brands); legacy path has a hard-coded number
- Generated brands follow/replay the real read (`followRead`, tested). The non-generated path still says
  "Found 4,683 reviews nobody has mined" (`:842`), an Arata number, for the default Brew context.

---

## 3. Background jobs and timers (all in the single Cloud Run instance)

| Job | Where | Cadence | Gate | Spend | Per |
|---|---|---|---|---|---|
| Feed tick (watchers) | `feed-service.js:682` | every 5 s, one at a time | workspace open in last 10 min and `lastGen` < 15 min (a gen-capable viewer); demo sessions rest after 2 h | Creative: ≤ 3 Claude + 3 Gemini per workspace per day | every workspace in memory |
| Workspace saver | `:684` | every 20 s | seen in last 15 min | GCS writes | workspace |
| Idle saver | `:676` | hourly | idle member workspaces | GCS writes | workspace |
| Research (stories) | `research.js:351` | 30 min tick; ads 6 h, own 12 h, trends 6 h, news 4 h, how-to 12 h; failures wait 1 h | `RESEARCH_OFF` | treg + Claude + Gemini (2.13) | every brand **loaded** since restart |
| Live watch | `live-watch.js:199` | 15 min tick; catalog 3 h (retry 1 h), AI answers 7 d (retry 6 h) | `LIVE_OFF` | AI answers ~$0.50/run | every brand loaded |
| Stories warm | `server.js:413` | 90 s, then hourly | opened in 3 days, Cloud Run only | (starts research/live) | brand |
| Social (listen + ideas) | `social-feed.js:249` | 30 min tick, ≤ 3 brands/tick; listen every 8 h (1 full/day), ideas daily | day cap $3; ideas only if opened in 3 d; off under mock/local | listen ~$0.4-1.6/day; ideas ~$1 | every built brand |
| Evidence (market pulse, video read, calendar confirm) | `server.js:387` | 5 min, then 30 min; ≤ 2 brands/tick; daily per brand, video weekly, calendar weekly | `EVIDENCE_OFF`, mock, local | treg + Claude | built brands |
| Moves cadence | `moves-cadence.js:473` | hourly tick, weekly per brand, ≤ 2 brands/tick, 30-min lock | `MOVES_WEEK_CAP_USD` $3 | ~$0.3-0.4/run | built brands |
| First drafts | `drafts-bg.js:316` | tick (see area D) | `DRAFTS_DAY_CAP_USD` | images etc. | opened in 3 d |
| Drafts refresh | `server.js:419` | every 3 min | `packs.remote` | GCS reads | loaded brands |
| Notes / move value | `server.js:325-326` | 5 s / 8 s after each pack attach | Cloud Run only | ~$0.05 / ~$0.10 per brand, only new cards/moves | brand load |
| Work timers (`later`) | `:914` | one-off 1-7 s | | colleague reply (Dummy), learning | work item |

How it behaves in one instance:
- All of it shares one Node event loop with the HTTP server and in-process builds. `tick` walks **every workspace ever
  loaded** every 5 s; workspaces are never evicted from the `tenants` Map (`:187`), so memory and tick time grow with
  the number of visitors until the next restart.
- Global AI caps (`server.js:71-73`, live: text 1,500/image 120/video 15/voice 60 per day) are in-memory counters per
  instance: they reset on every deploy/restart (`/api/config` at 10:39 UTC showed `used.text: 0`).
- Research and live-watch instances are created per brand on first load and only stopped when replaced; a brand that
  was opened once keeps paying for research and AI-answer checks until the next restart.
- `max-instances=1` is load-bearing: tenant state, research snapshots, the creative budget and caps are all
  single-process. A second instance would double background spend and split workspaces.

---

## 4. Harness evidence (local, HEAD code, arata-in pack copy, AI mocked)

First screen as founder (default viewer), before watchers:
```
 1 V m32-2      11.82 v=1.76 seat=4.08 | Move 32  | Ask for the message opt-in on the thank-you page
 2 V m1007-1    10.25 v=5.18           | Move 1007 · Listening (reel)         <- make seat
 3 T heard-t-…  10.23                  | Heard · 122 mentions                 <- social seat
 6 V m1011-2    10.15                  | Move 1011 · Automation (image ad)    <- make seat
 7 V idea-…      9.75                  | Ideas · Instagram reel               <- social seat
 9 T m44-1      12.53 v=0.78 seat=5.76 | "Start the curl circle with 30 founders"
17 T m48-1      12.99 v=1.24           | highest total in the list, at #17
statics: positions 73, 76, 79, 82, 85, 88, 91, 98 of 146
```
After `watchers/run-all`: #1 AI-answer gap (16.98), #2 and #6 both Traya ads (group `ad:traya`), #4 out-of-stock (16.98).
QA log: the q2 AI-answer gap card dropped for "No banned words". Stories: brand 3, trends 4, ads 4, news 10.
As `crm / report / gel`: `m966-1` at #2. Card page for the top card: fallback page (mock), keys `lead, options, reason, follows, moves`.

---

## 5. Live checks (GET only)

| Call | Result |
|---|---|
| `/app.js`, CSS | see section 0 |
| `/api/brands` | `gullylabs-com` (state "Reading"), `arata-in` (Ready) |
| `/api/brands/arata-in/status` | Ready, 51 moves done, read cached |
| `/api/research` (x-brand arata-in) | full snapshot 18 of 19 times; 1 all-null (2.13) |
| `/api/brands/arata-in/heard` | 1,207 items; YouTube 429, Myntra needs Apify (2.11) |
| `/api/brands/arata-in/moves/cadence` | listen 1006-1008, auto 1009-1011 live; week spend $0.41 |
| `/api/config` | ai live, caps text 1,500 / image 120 / video 15 / voice 60 |
| `/b/arata-in/seed.js` | 158 posts: 131 move, 4 read, 6 ideas, 4 heard, 8 statics, 12 demo; 0 unresolved `{{fact}}` keys |
| The ranked feed itself | **not checked live**: `/feed` needs a workspace, and creating one is a POST that writes to GCS |

---

## 6. Brand-specific hacks (violate "every fix for every brand")

| Where | Hack |
|---|---|
| `feed-service.js:537`, `research.js:277` | lane enum `core|mito|dandruff` (Arata's old lanes); real brands' lanes never match |
| `feed-service.js:433`, `:447` | claim check on "N new hairs"; "up to" insertion for hair counts; rivals replaced by "other serums" |
| `feed-service.js:691` | filters two specific Arata variant titles |
| `feed-service.js:842` | "Found 4,683 reviews nobody has mined" |
| `feed-service.js:890-894`, `public/app.js:267` | `NEEDS` labels incl. "Lock the Diwali set", "Queue the 12" |
| `public/app.js:3930` | canned pushback "…before Diwali" |
| `derive.js:9-12` | festival is **hard-coded**: Diwali 2026-11-08 for IN, Black Friday 2026-11-27 for everyone else. `calendar.js` (real, per-market) is not wired into `config.festival`. After 27 Nov 2026 every brand's festival is in the past: `{diwali}` fills render 0, the Creative prompt says "-N days away", and trend/how-to prompts keep pitching it |
| `live-watch.js:21` | comment: "what shoppers in India ask… hair-fall product" (comment only) |

## 7. Bugs and risks, ranked

| # | Severity | Bug | Where |
|---|---|---|---|
| B1 | High | Festival dates hard-coded to Oct-Nov 2026; the feed's seasonal logic goes stale for every brand on 27 Nov 2026 | `derive.js:9-12` |
| B2 | High | AI-answer gap cards whose shopper question contains a banned word are always dropped by QA | `feed-service.js:437` + `live-watch.js` |
| B3 | High (live) | `told` +5 fires on "the team says/wants" text even with no learnings; +2 for 32/71 moves | `brand-learnings.js` `cardUsesLearned`, `learnedMoveNs` |
| B4 | Medium (live) | `c._told` cached and persisted: learnings never re-rank existing cards | `feed-service.js:295` |
| B5 | Medium | Seated make cards bypass the one-per-group rule: both ad seats can be the same rival | `feed-service.js:382`, `:394` |
| B6 | Medium | Rival ads count as "make" cards; statics rank ~#75 (value 3, no rule) | `:380`, `value.js:46` |
| B7 | Medium | Viewer lane defaults to non-existent `core`; watcher cards hard-coded `core` | `app.js:158`, `:213`, `:553-619` |
| B8 | Medium | Card pages cached in memory only, re-paid after every pack reload/deploy | `:1360` |
| B9 | Medium | Workspaces never evicted; 5 s tick over all of them | `:187`, `:666` |
| B10 | Medium | Research/live instances never stopped for brands nobody opens; listening runs 3×/day for every built brand | `server.js attach`, `social-feed.js dueFor` |
| B11 | Medium | Lite listen run overspent its cap 4× ($0.63 vs $0.15) | local `social/state.json` |
| B12 | Low | Creative budget per workspace, not per brand | `:526` |
| B13 | Low | Heard "questions" include review videos | `social-feed.js heardCards` / listen tagging |
| B14 | Low | Story near-duplicates; paise in research text; own-ads "live" counts versions | `research.js` |
| B15 | Low | `moveOfId` 2-digit regex | `:302` |
| B16 | Low | Errors return HTTP 200 `{error, fallback:true}`; many `.catch(() => {})` (applyLive, builder.connected, refreshLive) hide failures | `:1466`, `:314`, `:1096` |
| B17 | Low | Transient empty research snapshot after (likely) instance replacement | `server.js attach` |
| B18 | Info | No unit tests for `score`, `rank`, `feed`, `liveCard`, `adCard`, `stories`, `qaCheck`, feedback routes | `test/` |

## 8. Cut-but-code-remains inventory (feed area)

- **Measurement**: `genericMeasure`/`MEASURE`/`measureOf` (`:43-58`, `:400-402`), `pub().measure` on every card, card
  page per-option measure with "guard: when we stop or roll back", `STAGE_PCT/STAGE_TXT` incl. deploying/measuring/result
  (`:479-480`), `workFor` excluding `out/measuring/result`, "already shipped" check on `/cards/:cid/decided`, `/state`
  marking `w.measure.connected`, `metrics()` "Approvals this week" from `t.runs`.
- **Do it now**: `NEEDS`/`toolInWords`/`deployTarget` (`:890-902`), `decideFromAction` on `deploying`, `p.liveChange`
  "Live … shipped by Brew" pill (`app.js:716`, never set anywhere), value grade `now` ("doable now"), catalog/AI-answer
  CTAs and how-steps that promise Brew pauses, restarts, updates listings or tells you when stock is back.
- **Free cap / Pro**: `limit` object, `t.plan`, `proAt`, `Free to Pro` metric, deck upsell.
- **Simulated team flow**: `tickBatches` (random progress, "The ShopOS team posted it in your jam"), legacy `/api/jams`
  router with "The ShopOS team has it. Usually replies in 12 to 24 hours", `/jams/:jid/whatsapp` ("Thread moved to
  WhatsApp"), `leadsAllTenants`. Reachable by route; not used by the generated-brand UI path as far as the client shows
  (the jam UI uses `/api/work`), but nothing removes them.
- **File header** of `feed-service.js:1-5` still describes the pre-cut product.

## 9. Cost and latency summary (feed area, per brand unless noted)

| Item | Model / source | Cost | Latency |
|---|---|---|---|
| Move cards | Sonnet per move | in the build / cadence (~$0.3-0.4 per weekly run incl. cards) | build-time |
| Notes | Sonnet, 40 cards/call | ~$0.05 once | background |
| Move value | Sonnet, 20 moves/call | ~$0.10 once per version | background |
| Research | treg + Claude + Gemini | news ~$0.39/refresh logged; several refreshes/day | background |
| AI answers | 32 treg/Claude calls | ~$0.50/week | background, minutes |
| Listening | treg/Apify + Claude tags | $0.4-1.6/day observed | background |
| Ideas | Opus + Sonnet + treg | ~$1/run, 0 made last run | background |
| Card page | Sonnet, 3.5k tokens | per open, re-paid after reload | ~10-20 s first open |
| Creative watcher | Claude + Gemini Flash Image | ≤ 3 + 3 per workspace/day | ~15 s, background |
| Heart "three more" | Claude | per heart | a few s, child card shows loading |
| Feed GET | none | free | in-process; ranks every card every call (O(n²) in places: `withChildren` scans all cards per card, `sorted.splice`) — fine at ~160 cards |

## 10. What production needs (feed)

1. **Tests for the ranker and layout** (`score`, `rank`, `feed`), with fixtures from 2-3 brands, asserting seats,
   groups, rhythm and that higher value wins within a seat class.
2. **Ranking redesign**: normalise seat so it can't swamp value; give statics and brand-made ads real value; make the
   make-seats exclude rival readings and obey groups; drop or fix the `core` lane default.
3. **Fix B1** (festival): drive `config.festival` from `calendar.js` per market, roll forward after the date.
4. **Fix B2/B3/B4** before deploying `ea6cfd7` (or right after): gate `TEAM_CITE` on learnings existing; tighten
   `learnedMoveNs`; don't persist `_told` (compute per pack version).
5. **Persistence and scale**: persist card pages (`pages.json`); evict idle workspaces; move background jobs (research,
   live, social, cadence, evidence, drafts) to a scheduler/worker (Cloud Scheduler + jobs) with per-brand budgets in a
   durable store, instead of in-process timers on a single instance; stop research/live for brands nobody opens.
6. **Spend controls**: durable per-brand daily caps (not in-memory per instance); enforce the lite listen cap; alert on
   empty paid runs (ideas made 0).
7. **Clean the cut code** listed in section 8, and rewrite CTAs/how-steps that promise actions Brew doesn't take.
8. **Remove brand-specific hacks** (section 6) and re-audit with several brands (only `arata-in` is Ready on live;
   `gullylabs-com` is still "Reading"), as the repo's own "every fix for every brand" rule requires.
9. **Data quality** in research: semantic dedupe of stories, paise formatting, distinct-ad counting for own ads,
   question vs review classification in listening, not listing skipped sources as failures.
10. **Access**: workspace ids are bearer tokens (32-bit); move to authenticated workspace access for real teams.
