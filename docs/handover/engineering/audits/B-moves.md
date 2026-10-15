# B. Moves: audit for the engineering and product handover

Scope: the 51 strategy moves, PDFs and zips, weekly listening and automation moves (plan-only), rewrites when the brand changes, fact gating, and leftovers of the cut measurement feature.
Repo: `/Users/param/Documents/ChatGPT/brew`. Live: https://brew.joinsquareup.com (brand `arata-in`). Audited 2026-10-15.

How this audit was done (all of it free):
- Read the code: `brief.js`, `moves-engine.js`, `moves.js`, `moves-cadence.js`, `refresh.js`, `fact-gate.js`, `facts-desk.js`, `retire.js`, the moves parts of `build.js` and `server.js` (the brand routes live in `server.js`, not `feed-service.js`), `pdf/`, `tools/write_moves.mjs`, `tools/prepare-pack.mjs`, `data/move-specs.json`, `prompts/move-house.md`, the `measure-*` files and the tests.
- Looked at the local pack `.brands/arata-in` (moves.json, status.json, updates.json, moves/cadence.json, cost.json, pdf/).
- Sent GET requests to the live site: `/api/brands/arata-in/moves`, `/updates`, `/moves/cadence`, `/build`, plus a few PDFs and a zip.
- Ran `AI_MOCK=1 TREG_OFF=1 node --test` on the 8 related test files: 50 of 50 pass.
- I could not render a PDF locally because the sandbox blocks Chrome. `moveHtml()` builds the HTML for moves 2, 3 and 25 without errors.

---

## 0. Headline findings (most serious first)

1. **None of the 64 Opus-written moves is "verified".** On the live site and in the pack, `meta.verified` is false for every build move (01–65, 765, 966). Every one still has open claim issues (`verify.claimsLeft` runs from 1 to 13). Only the 6 weekly Sonnet moves (1006–1011) are verified, and their check covers numbers only, not claims. The UI badge "Every number checked" (`public/app.js:3654`) therefore appears only on the cheap weekly moves. The claim problems the checker found (for example "attributes a position to a rival that is not supported", or "interpretation presented as fact") **stay in the published text and PDFs**. They are recorded in `meta.issues`, and no UI shows them.
2. **Simulated connector numbers flow into move rewrites as real evidence.** `connectors/sim.js:30-31` strips the `(demo account)` label and the `demo` flag and sets `method: 'connected account'`. `build.js:liveConnected` (793+) writes these numbers to `private/connected-ledger.json`, or to the public `connected-ledger.json` for Marketplaces, and flags moves as stale. `rewriteNow` (`build.js:688-692`) merges both files into the ledger that `verify()` treats as backed. A rewrite after a dummy connect can therefore quote invented revenue, ROAS or "3 of 5 flows" and pass the number check. SCOPE.md lists "member-only move rewrites from account data" as **cut**, but the code path is still live. The live `arata-in` updates endpoint already reports `connected: true, accounts: ['Shopify']`.
3. **When any private connected ledger exists, every rewrite goes private.** `build.js:691` sets `priv = privL.length > 0`. From then on, all rewrites of that brand (including the automatic ones triggered by a real site change) save to `private/moves.json` and `private/cards.json`. The public moves, PDFs and zips stay stale for everyone else.
4. **A rewrite loop spent money and wrote nothing.** `updates.json` on the pack and on the live site holds 30 rewrite runs on 2026-10-14 between 20:52 and 21:41 UTC, about 100 s apart. Each wrote **0 moves** and cost $0.24–0.25, about **$7.40 in total**. 38 moves are still flagged stale with the reason "Fresh reload with what the team told us". My reading of the cause, from the code (not confirmed in logs):
   - `freshReload` (`build.js:852-878`, run by `OPS_FRESH_RELOAD`) calls `rewriteNow` every 60 s until no old moves remain.
   - When the day cap or the rewrite cap is hit, `canSpend()` stops every move before it starts.
   - `runAll` still calls `writeIndex`, an Opus call (`moves-engine.js:629-631`), which does not check `canSpend`. So every pass pays for a new Move 00 and nothing else.

   Nothing stops this loop except the old moves running out.
5. **Numbering and counts don't agree with each other.** Kickers say "MOVE 01 OF 52", "MOVE 13 OF 63", "MOVE 24 OF 64", "MOVE 65 OF 64" and "MOVE 765 OF 64". The index says "Sixty-four moves". The progress card and emails say "51". An old "00 Fifty-two moves for Arata.pdf" is still served (HTTP 200). The cause is that `total()` is the count of applicable specs at the moment each move was written, and runs never write it back to earlier moves.
6. **PDFs are missing for moves 02, 03 and 25.** `status.pdfs` lacks them on the live site, so `Arata-moves-00-28.zip` holds 26 files, not 29. The PDF for 02 exists in `pdf/` but is missing from `status.pdfs`. That points to a lost update: `renderPdf` read-modify-writes `status.pdfs` (`build.js:398`) while the weekly scheduler renders PDFs at the same time through `pdfFor`. The files for 03 and 25 don't exist at all. Render errors are only logged as warnings (`build.js:259`), so nothing retries them and nothing shows the gap.
7. **Move passages for cards and the jam are dead code.** `moves.js:25` loops over `s.paras`. No generated move has `paras`: moves have `blocks` (MOVE_SCHEMA). So `passages()` always returns `[]` for every brand, and card pages (`card-page.js:68`), the studio (`remix.js:344`) and `/api/cards/:cid/moves` never get "what the moves say". `summary()` also reads `m.why` and `m.measure`, which no move has.
8. **The cut measurement feature still drives the move prompt.** `moves-engine.js` imports `measure-families.js`. Every move must include a "Check timings" paragraph (check days, decide day, early stops with actions like pause, revert or write_moves) and a "What Brew will watch" line. The CONTRACT at `moves-engine.js:40` requires both. 64 of 71 live moves contain them. No code runs those checks: `measure-engine.js` is gone. So every move promises monitoring that does not exist.
9. **The weekly-moves "30-minute lock" is not a real lock.** It is a read-then-write of `moves/cadence.json` (`moves-cadence.js:407-408`) with no GCS generation precondition (`brand-pack.js:104` `put`), so two instances can both take it. A run longer than 30 minutes can also overlap the next one. The manual route says `started: true` even when the other instance holds the lock (`moves-cadence.js:468`, the result is discarded). The lock has no test.
10. **`tools/write_moves.mjs` breaks the current pack format.** It writes `moves.json` as an **array** of `NN.json` files, matching only two digits (`write_moves.mjs:69-70`). The server expects an object keyed by move number, and three- and four-digit moves (100+, 1001+) are dropped. Running it on a real pack would corrupt the move list. It also passes no `packs` or `slug`, so it writes no signals and no dynamic specs.

---

## 1. Feature inventory

Status key: Working | Partial | Broken | Dummy | Cut-but-code-remains | Untested.

### 1.1 Brand brief (`brief.js`)
- **What it does:** Opus (effort high, max 24k tokens, `tag: brief`) turns the profile and ledger into structured JSON. `render()` writes `brief.md`, where every number carries `[k:ledgerKey]`. `guard()` drops quotes not found in the real reviews (`quoteIsReal`) and marks numbers the ledger does not back as "(to confirm)".
- **Status:** Working.
- **Evidence:**
  - `brief.js:84-103` (write) and `brief.js:64-82` (guard).
  - Arata's brief: 3,051 words, 0 quotes dropped, 0 unbacked numbers, 12 items to confirm, `learned` merged in (`build.js:228-230`).
  - Tests: `quoteIsReal` only (`test/audit-fixes.test.js:148-156`). There is no test of `write()` or `guard()`.
- **Risks:**
  - Profile JSON is cut at 60,000 characters (`brief.js:91`), so a big catalog loses its tail silently.
  - The mock brief writes `[MOCK]` text that would reach the moves if AI_MOCK were left on in prod (the moves are mocks too, so the output is obviously fake rather than subtly wrong).
- **Cost:** one Opus call per build, roughly $1–3 (not split out in cost.json).
- **Production needs:** tests for guard and render; a token-aware cut instead of a character cut.

### 1.2 Move specs and the prompt (`data/move-specs.json`, `prompts/move-house.md`, `skills/`, `sources/moves/`)
- **What it does:**
  - `move-specs.json` holds 66 specs: 0 is the index, 1–50 are the core moves, 51–65 are listening-era moves. Each spec has a skill, deps, evidence areas, an exemplar, a timing family and lookups.
  - The prompt is built from: the house template (11.5 KB) plus the evidence CONTRACT; that skill's `SKILL.md` (52 skills, none missing); the brief; a ledger slice; a profile extract; digests of the moves it depends on; live lookups; and one hand-made Arata move as a depth exemplar (51 files in `sources/moves`).
- **Status:** Working.
- **Evidence:**
  - `moves-engine.js:352-368` (buildPrompt), `moves-engine.js:300-313` (skillText, exemplarText).
  - 19 lookups in total: 5 treg (SERP for 11, 14 and 16; Ad Library for 20 and 21), the rest are web searches.
  - Tests: `test/moves-evidence.test.js` ("the prompt sends the signal lines… the real count").
- **Risks:**
  - **The only depth exemplars are Arata (an Indian haircare brand), for every brand.** Prices in ₹, Indian context and Arata titles go into every prompt ("the Arata title for this move was …", `moves-engine.js:364`). The prompt tells the model not to copy facts, but nothing measures whether the style bleeds through.
  - **Brand-specific hack:** `moves-engine.js:354` switches to `exemplarAlt` when the host contains `arata.in`, so Arata doesn't get its own move as the exemplar. It is defensible, but it is a hard-coded brand.
  - The house template's 30-day table header is `WEEK | BREW SHIPS | <BRAND> PROVIDES` (`prompts/move-house.md:94`). Brew "ships" work, which conflicts with the scope: the team runs it from the shared brief.
  - A `SKILL.md` is included with no length cap (only `references/` are capped at 14,000 characters).
  - `CAPS` and the evidence areas live in two lists (`moves-engine.js:20`, `refresh.js:8`, `moves-engine.js:153`), so they can drift.
- **Production needs:** exemplars per category or market; a review of the house template's wording against the scope; one shared area list.

### 1.3 Writing one move (`moves-engine.js writeMove`)
- **What it does:**
  - One Opus 5.5 call per move: effort `high` (`MOVES_EFFORT`), max 120,000 tokens, structured output (MOVE_SCHEMA), prompt caching on the brand and discipline blocks.
  - Web search is allowed when the spec has web lookups: up to `MOVES_SEARCH` searches, default 2 in the build.
  - Fallbacks: on `max_tokens`, one retry at medium effort with a 7,000-word limit. On a schema rejection, one retry as plain JSON.
  - Strips stray `[12]` reference markers.
- **Status:** Working.
- **Evidence:**
  - `moves-engine.js:378-409`.
  - Pack: 64 Opus moves. Median $1.51 (min $1.00, max $3.22). Median 560 s (403–997 s). Body about 7,700–10,500 words. Stop reason `end_turn`. 13 lookups, 0 errors.
  - Tests: only the mock path (`test/moves-evidence.test.js:64`).
- **Risks:**
  - `meta.model` is hard-coded to `'claude-opus-5-5'` (`:403`) whatever the call used.
  - Mock moves are complete documents marked `[MOCK]`. `runAll` treats mock moves as not done and rewrites them (good).
  - `meta.usd` covers the write call only. Verify, fix and cards are charged to cost.json but not to the move.
- **Cost/latency:** about $1.5 and 9–10 minutes per move. Six run at once (`MOVES_CONCURRENCY`, default 6; the second pass runs 4).

### 1.4 Verifying a move (`verify`, `scanNumbers`, `claimCheck`, `fixCall`)
- **What it does:**
  1. A fixed number scan against the ledger, the signal lines, the dependency digests, search citations, accepted `newFacts` (URL and quote must match) and `derived` arithmetic (`evalExpr`).
  2. A Sonnet claim check (low effort, up to 15 issues: fact, quote, motive, absent, disclaimer).
  3. One Opus fix call (medium effort) that edits only the flagged blocks.
  4. A second scan and claim check.
  5. Any number still unbacked gets "(to confirm)" and an entry in `toConfirm`.

  `verified` = the claim check ran, no claim issues are left, and the cover stat is backed.
- **Status:** Partial. The code works as written, but in practice it never reaches "verified" on Opus moves.
- **Evidence:**
  - `moves-engine.js:434-520`.
  - Pack: median 1 number issue before the fix and median 10 edits applied. `claimRan` is true for all 64. `claimsLeft` > 0 for all 64, so `verified` is false for all 64. 5 numbers were left unresolved across all moves. 52 `newFacts` were rejected (URL or quote not matched).
  - **No test covers `verify`, `scanNumbers`, `claimCheck`, `fixCall`, `applyEdits` or `evalExpr`.**
- **Risks:**
  - **Leftover claim problems are shipped**, not removed or labelled. In practice "verified" can't be reached: a second Sonnet pass always finds something new.
  - `LABELLED` (`:115`) exempts any sentence containing "if", "would", "could", "cap", "plan… price", "target" and so on. That is a wide escape hatch for invented numbers in the why, found and examples sections.
  - The scan matches numbers by value with no context: "30" passes if any ledger value contains 30. Across Arata's 204 ledger entries, 25 of the whole numbers 1–100 and 89 of the values 100–5,000 count as backed.
  - In plan and measure sections only money, counts, stars and scaled numbers are checked; percentages there are never checked.
  - `ok` (`:519`) uses the issue count from before the fix (harmless, only the build log reads it).
  - The fix call can fail silently (`log.warn`). There is still no claim check of the final text after the last edit, unless edits > 0.
  - Two `numbersIn` exist with different regexes (`moves-engine.js:78` and `fact-gate.js:32`), so they can drift apart.
- **Cost:** a Sonnet check about $0.05–0.15 ×2 and an Opus fix about $0.3–0.8 per move (my estimate; not split out in cost.json).
- **Production needs:**
  - Decide what "verified" means, and say it in the UI (for example "numbers checked, N claims to review").
  - Either remove or label leftover flagged sentences, or show `meta.issues` to the team.
  - Unit tests for the scanner, `evalExpr` and the `newFacts` acceptance.

### 1.5 Scheduler, waves, dynamic and listening-era specs (`runAll`, `prepare`, `dynamicSpecs`, `signalLedger`)
- **What it does:**
  - Moves are written in dependency order. Wave A is `[1,2,3,9,10,4,5,6,7,8]`, then the rest. Concurrency is 6.
  - Resume: moves already written and not mock are skipped.
  - Listening-era specs (51–65) wait for their evidence (`needs`).
  - Dynamic specs (numbered 100–999 by a hash) cover a festival at its plan point, a research gap (a theme with 3 or more questions) and community replies that met their threshold.
  - Signal lines (`listen.*`, `pulse.*`, `video.*`, `cal.*`) are added in ledger shape so they back numbers.
  - The index (Move 00) is written after wave A and again at the end.
- **Status:** Working, with count bugs.
- **Evidence:**
  - `moves-engine.js:583-633`, `:263-298`, `:178-241`.
  - Pack: 51–54, 57–59 and 61–65 are written. 55 (seasonal), 56 (weather) and 60 (creative) were never written because their needs weren't met. Dynamic moves 765 and 966 are written (both `research:` specs).
  - Tests: `test/moves-evidence.test.js` (needs, dynamic specs, signal lines), `test/audit-fixes.test.js:92` (cadence slots).
- **Risks:**
  - **Count drift:** `total(ctx)` is applied when each move is written (`finish`, `:375`), so kickers read 52, 63 or 64 and "65 OF 64" (see headline 5).
  - The index runs an **Opus call with no `canSpend` check** (`:544`), so it is paid even when the budget has stopped every move (see headline 4).
  - Dynamic numbers come from a hash: `nOf` (`:266`) wraps around and can collide with numbers already given out in other runs. The `used` set only knows about this run.
  - When the deps of the moves still pending have no slot to run in, the wave releases the lowest-numbered move. An error raised there is pushed but never logged (`:621`).
  - `DYN` is engine-instance state set by `prepare` (`:577`). That is fine because each build creates a new engine, but it is fragile.
- **Cost:** a full build has a $120 default cap (`BUILD_CAP_USD`). The live `/build` reports cap $150 with Pro. The comment says "51 moves cost about $70–90". Arata: status.usd $123.16 at done, cost.json $149.35 now. Moves alone (meta.usd sum) come to $99.88 for 66 Opus docs.
- **Latency:** Arata's build took 6.8 h from creation to done. That includes the "check what we read" wait (`BUILD_CONFIRM_WAIT_MS`, 15 min) and the Pro pause.

### 1.6 The build's moves stage, cards, statics, progress and notify (`build.js run`, `saveOne`, `cardsFor`, `progressCard`, `notify`)
- **What it does:**
  - Each finished move is saved to `moves/NN.json` and merged into `moves.json` (the build owns 00–50; cadence moves are kept).
  - Each move becomes 1–2 cards (`cards-gen.fromMove`). Move 21 starts the static ads. A progress card is updated. A PDF is queued. "ready" is set once wave A is done.
  - A failed move gets one second pass. The run pauses at the brand's cap or the day's cap.
- **Status:** Working, with the caveats below.
- **Evidence:** `build.js:233-283`, `:359-389`. Tests: `test/audit-fixes.test.js` (store not opened, confirm honoured, fresh restart, cap by day).
- **Risks:**
  - **Hard-coded move numbers:** `n === 21` starts the statics (`build.js:254`, `:713`). `CONNECTED_MOVES` (`refresh.js:15`) and `WANTS` (`build.js:763`) map account areas to move numbers. Renumbering the specs breaks all three silently.
  - "51" is hard-coded in the UI and email strings (`progressCard`, `budgetPause`, `notify`), while the index says 64.
  - **`notify` still sends email through Resend** (`build.js:568-588`): "first ten moves ready", "all 51 ready", and "moves were updated". `POST /api/brands/:slug/notify` is open to anyone, even not signed in; the guard excludes `notify` (`server.js:526-527`), so anyone can enroll up to 20 addresses per brand. `prepare-pack.mjs:49` deletes `notify.json` as a "cut feature" file, but the sending code is live whenever `RESEND_API_KEY` is set. This is cut-but-code-remains, and a small spam vector.
  - The second-pass condition only checks 1–50. Missing listening-era moves get no second pass.
  - `buildInfo().usd` shows $0 after a restart until the next run (`restoreSpend` runs only inside run and check). The live `/build` reports `usd: 0` for Arata.

### 1.7 PDFs and zips (`pdf/render.js`, `pdf/template.js`, `build.js renderPdf`, `makeZips`)
- **What it does:**
  - Each move is rendered to HTML (`moveHtml`), then to PDF with puppeteer-core and a local Chrome. The file is named `NN <title>.pdf` and saved to `pdf/` (or `private/pdf`).
  - Two zips (00–28 and 29–50) are rebuilt after the build and after every rewrite.
  - Served at `/b/<slug>/pdf/<name>` (`server.js:566`). Members get the private PDF first.
- **Status:** Partial.
- **Evidence:**
  - Live: `01 … context file.pdf` returns 200 (1.77 MB). `Arata-moves-00-28.zip` returns 200 (30.8 MB, **26 PDFs**, not 29). The stale `00 Fifty-two moves for Arata.pdf` still returns 200.
  - `status.pdfs` lists 1001–1005, the retired audit moves, and those return 404.
  - **No test** covers `renderMove`, `zipBuffer` or `makeZips`.
- **Risks:**
  - A new Chrome is launched **for every PDF**: `renderPdf` passes no shared browser (`build.js:396`).
  - PDF failures are only warnings. Nothing retries them or shows them in the UI, which is how 02, 03 and 25 went missing.
  - When a title changes, the old PDF is never deleted, because names are keyed by title.
  - `status.pdfs` is read-modify-written by the build queue and the weekly `pdfFor` at the same time, so updates get lost.
  - Retired cadence moves keep stale `pdfs` entries.
  - The zips contain only 00–50. Listening-era, dynamic and weekly moves are in no zip.
- **Production needs:** a render queue with retries and a status per move; one shared browser; delete superseded files; zips built from the current move list; tests.

### 1.8 Keeping moves current: check, triage, flag and rewrite (`refresh.js`, `build.js checkUpdates`, `doCheck`, `rewriteNow`, `autoRefresh`, `signal`)
- **What it does:**
  1. A fresh paid read of the site.
  2. `mergeLedger`: what the brand confirmed wins, keys missing from the new read are kept, and a priced product that is gone is removed.
  3. `diffLedgers` keeps only material changes: price, catalog, claim, rival, policy, checkout, ads or company changes always count; other numbers count from a 10% move.
  4. `candidates`: a move counts as touched if it quotes the old value or its evidence areas include the change.
  5. A Sonnet triage marks moves high or medium. A move that quotes the changed value is always kept.
  6. Flags go to `updates.json.stale`.

  The automatic path rewrites only "high" moves numbered 1–50, at most 6 (`REFRESH_AUTO_MAX`) and at most $14 (`REFRESH_AUTO_CAP_USD`). A manual rewrite is capped at max($60, n×$2.5). Rewrites keep the old version in `moves/history/`, bump `meta.version`, replace the move's cards (`mNN-*`) and re-render the PDF and zips.

  Triggers: a weekly check (`REFRESH_EVERY_DAYS` = 7, for brands seen in the last 30 days); a catalog signal (at most one a day, with a 24 h back-off after a failure); manual `POST /updates {action:'check'|'rewrite'}`. A rewrite cut off by a restart carries on (`resumeRewrite`).
- **Status:** Partial. The logic works, but on Arata it is stuck: 38 moves are flagged stale, no `lastCheck` exists, and a $7.40 loop wrote nothing.
- **Evidence:**
  - `refresh.js` (all), `build.js:617-748`, `:829-842`.
  - Live `/updates`: `stale: 38`, `lastCheck: null`, 10 history entries, every one with 0 moves written.
  - Tests: `candidates` skipping cadence moves (`test/audit-fixes.test.js:92-105`), `mergeProfile` (`:36`), card follow (`test/cadence-refresh.test.js:52`).
  - **No test covers** `diffLedgers`, `mergeLedger`, `triage`, `doCheck`, `rewriteNow`, `freshReload` or `resumeRewrite`.
- **Risks:**
  - Headline 2: simulated connector numbers become rewrite evidence.
  - Headline 3: one private ledger sends every later rewrite private.
  - Headline 4: the `freshReload` loop and the index paid with no `canSpend` check.
  - A rewrite can only target moves 1–50 (`build.js:676`, `:682`). Stale flags on 51+ and on dynamic moves can't be cleared from the Moves tab.
  - The "Move 00 only on 3+ rewrites" rule (`:723`) means 1–2 rewrites leave the index out of date.
  - `editUpd`'s lock (`ulock`) and the facts-desk `serial` lock are per process.
- **Cost:** a check is a fresh read (treg plus Claude web search, est. $1 per `estCheck`) plus one Sonnet triage call. A rewrite is about $1.7 per move (`MOVE_USD`).

### 1.9 Fact desk, the daily price check and stale flags (`facts-desk.js`)
- **What it does:**
  - **Fact sheet:** the team can remove a fact, or paste a link that Brew reads. Typed numbers are never accepted.
  - **Free daily check:** reads `products.json` (Shopify only, up to 8×250 products) for brands seen in the last 7 days. It updates prices and stock, records edits, adds changed old values to `retired`, republishes, flags the moves that quote the old value (`quotedBy`, no paid call), and sends a catalog signal to the refresh.
  - **Connected facts:** a private sheet built from `private/connected-ledger.json`.
- **Status:**
  - Fact sheet and daily check: Working.
  - Connected facts: **Dummy**. They are built from simulated accounts, and DUMMY.md row 1 covers them.
- **Evidence:** `facts-desk.js:73-91` (`quotedBy`), `:164-221` (edit), `:234-268` (daily). Tests: `test/facts-desk.test.js`: 5 tests covering the daily diff, `quotedBy`, daily end to end, team edits, and connected facts with demo never counting.
- **Risks:**
  - The test for "demo never counts" passes, but `sim.js` strips the demo flag before the data reaches facts-desk, so simulated numbers do count. Real demo-session data takes a different path; this is the simulated "live" path.
  - The header points to files that don't exist: `public/data/facts.js`, `data/facts.manual.json` and `tools/check_facts.mjs` (`fact-gate.js:1-4`).
  - Non-Shopify brands get no daily check ("Not a Shopify store").
  - Every flag the desk raises is "high" priority.

### 1.10 Fact gate (`fact-gate.js`)
- **What it does:**
  - Every money amount and percentage on a card (strict mode adds multipliers and counts of 1,000 or more) must be in the fact sheet, or be a number the move backs: one not inside a "to confirm", "target" or "example" sentence (`backedNumbers`).
  - `scrubRetired` drops sentences that quote a retired number before cards are made.
  - `canon` normalises different spellings of the same amount.
- **Status:** Working.
- **Evidence:** used by `cards-gen.js:93-96`, `build.js:375-376`, `feed-service.js`, `statics.js` and `brand-pack.js`. Tests: `test/audit-fixes.test.js:53-75`, `test/facts-desk.test.js`.
- **Risks:**
  - `backedNumbers` trusts any number the move states as observed. Moves are never "verified" for claims, so a number the claim checker flagged but that sits in an unlabelled sentence can still back a card.
  - The header text is stale (see 1.9).
- **Production needs:** gate cards on the move's own `issues` list as well.

### 1.11 Weekly listening and automation moves (`moves-cadence.js`)
- **What it does:**
  - **Families:** `listen` (2–4 moves from listening themes, questions, threads and communities) and `auto` (2–4 routines written as plans with day, step, kind, owner and repeat; "The team runs it from the shared brief; Brew does not run it").
  - A third family, `learn`, runs only when the team adds learnings (brand-learnings.js, outside this area).
  - One Sonnet call per family (effort medium, 16k tokens, schema). Every "found" line must cite evidence ids, and lines without a citation are dropped. A move with no citations is dropped.
  - Numbers are checked against the cited evidence plus the ledger. Stricter than the build: bare numbers above 12 in why, found and example must be backed. Unbacked numbers get "(to confirm)", and an unbacked cover stat is blanked.
  - `verified` means every number was backed. Quotes and claims are not checked.
  - Numbering starts at 1001 and is never reused (`nextNumbers`, `st.nextN`). A new run retires the family's last run to `moves/history/` and drops its cards.
  - Scheduler: an hourly tick, at most 2 brands per tick, each family every 7 days, `MOVES_WEEK_CAP_USD` $3 a brand a week, about $0.5 estimated per family. Off locally, on mock, and with `MOVES_REFRESH_OFF`. Manual `POST /api/brands/:slug/moves/refresh` for team members only.
  - Cards come from `cards-gen.fromMove`, tagged with the family badge. PDFs come from `builder.pdfFor`.
- **Status:** Working.
- **Evidence:**
  - `moves-cadence.js:22-475`.
  - Live: 1006–1008 (listen) and 1009–1011 (auto) are all verified. A run cost $0.41 for 3 families, which included the audit family since cut. The moves themselves cost about $0.019 each, and the rest is cards.
  - Next due 2026-10-21 (`due.why: written 1 days ago`).
  - Quality looks good: real quotes with links, honest "to confirm" lists. 1009 cites "51,419 Judge.me reviews" and "0 of 30 newest reviews from the last 30 days".
  - Tests: `test/moves-cadence.test.js`, 13 tests (scorecard, digest, numbering, shape, writeFamily, gating, scheduler, cap, the route, tagCards). Also `test/audit-fixes.test.js:92`.
- **Risks:**
  - **The 30-minute lock** (headline 9): not atomic, no test, and the manual route reports `started` even when the lock was refused.
  - **Automation "evidence" is partly written by Brew.** `automationContext` (`:165-178`) always adds "Review ask after delivery" and "Win-back" routine lines (why: "repeat orders without new ad spend"). The model then cites these as evidence ids, so a Brew suggestion reads as a finding.
  - The automation prompt names the same tools for every brand: "Meta, Shopify, Klaviyo" (`:289`), whatever the stack.
  - Quote dates in sources use the listening run date, not the post date (`evidenceFor :188`). For example "@drfarhatkhan.skin, 2026-10-14".
  - `verified` on weekly moves covers numbers only, but the UI shows the same "Every number checked" badge. The badge is accurate, but users may read it as "checked" in general.
  - The comment at `server.js:389` still says "audit, listening and automation moves". `FAMILY_SCHEMA.area` still lists the audit areas, and `auditScorecard` still computes A–D grades (kept on purpose as evidence for automation moves, stored at `audit/scorecard.json`).
  - Read-modify-writes of `moves.json`, `seed.json` and `labels.json` (`:416-432`) race the build's writes and rewrites. There is no cross-writer lock.
- **Cost:** about $0.02 per move plus cards (about $0.1–0.4 a run). The cap is $3 a brand a week.

### 1.12 Moves API and Moves tab data (`server.js`)
- **Routes:**
  - `GET /api/brands/:slug/moves`: list, PDFs, zips, status and stale flags. Members also get private moves.
  - `GET /api/brands/:slug/moves/:n`
  - `GET /api/brands/:slug/build`
  - `GET|POST /api/brands/:slug/updates`
  - `GET /api/brands/:slug/moves/cadence`, `POST /api/brands/:slug/moves/refresh`
  - `GET /b/:slug/pdf/:name`
- **Status:** Working. All return 200 live for `arata-in`.
- **Risks:**
  - Every GET is open to anyone. The moves are public by design (demo mode).
  - `POST /notify` needs no sign-in (see 1.6).

### 1.13 Move passages for cards and the jam (`moves.js`)
- **What it does:** `numsOf(card.src)` finds the moves a card names. `passages()` scores paragraphs that match the card. `summary()` gives the title, stat and gives.
- **Status:** **Broken.** `passages()` reads `s.paras`, which generated moves never have, so it always returns `[]`. `summary()` returns `why` and `measure` as undefined.
- **Evidence:** `moves.js:19`, `:25`. `paras` is not used anywhere else in the repo, and Arata's moves have no `paras`.
- **Fix:** walk `blocks` (p, list items, example bodies). There is no test.

### 1.14 Measurement leftovers (`measure-families.js`, `measure-stats.js`, `measure-spec.js`, `data/measure-families.json`)
- **Status:** **Cut-but-code-remains, and still wired.**
  - `measure-families.js` is imported by `moves-engine.js:12`. `FAMS.recipeOf` and `timingLine` go into **every move prompt** (`measureLine`, `:332`, `:364`) and into mock moves. The CONTRACT (`:40`) requires a "Check timings" paragraph with checks, decide day and early-stop actions (pause, revert, write_moves), and a "What Brew will watch" line. 64 of 71 Arata moves contain both.
  - `measure-stats.js` is only used for constants (`STEP_UP`, `METHOD_*`) in measure-families, and by its tests.
  - `measure-spec.js` is used by `jam-brief.js` (the "How we measure it" section of the brief; another area).
  - `measure-engine.js` no longer exists. `feed-service.js:171` still has a comment about it and `MEASURE_ENGINE`.
  - `createFamilies` contains a Claude call that proposes new families (`measure-families.js:149`). It can only run with `claudeTool`, and moves-engine passes `{}`, so it doesn't run from here.
- **Risk:** the moves describe a monitoring loop (re-reads, early stops, grades on a decide day) that nothing runs. That overclaims to the reader.
- **Production needs:** either rewrite the CONTRACT and house template to "how the team measures it", or rebuild the engine. Remove `measure-stats.js` and the families' proposal code if they stay cut.

### 1.15 One live instance and brand wipe (`retire.js`)
- **What it does:** `gs://<bucket>/control/live.json` names the live revision. Older revisions block outgoing calls and exit. Slugs on the `wipe` list are hidden and never built (`blocked()` in build.js). It is relevant here because a move build or rewrite left running on an old revision is stopped this way.
- **Status:** Working. Off locally.
- **Evidence:** `retire.js` (all). Tests: `test/retire.test.js`, 3 tests.
- **Risks:**
  - It patches `globalThis.fetch` to throw. Work in flight dies mid-call; resume picks it up.
  - The check runs every 15 s, which is the window in which two instances can overlap.

### 1.16 Tools
- **`tools/prepare-pack.mjs`:** Working, for one-off use. It retires audit moves to `moves/history/*.retired-audit.json`, deletes their PDFs and cards, strips `program` from automation moves and rewrites the routine sentence, and removes `private/`, `spend/`, `raw/`, `notify.json` and `pagespeed.json`. It runs safely twice.
  - It does **not** clean the `status.pdfs` entries of the retired moves, so 1001–1005 remain and return 404.
  - It does not clean `updates.json` stale flags or `moves/cadence.json` `runs`, which still show `families: ['audit', …]`.
- **`tools/write_moves.mjs`:** **Broken** against the current format (headline 10). It writes `moves.json` as an array, ignores moves with three or more digits, and has no signals or dynamic specs. Treat it as obsolete or fix it before anyone runs it on a pack.

---

## 2. Evidence from the arata-in pack

| Measure | Value |
|---|---|
| Move docs | 71: 00, 01–54, 57–59, 61–65, 765, 966, 1006–1011 |
| Opus moves | 64 core and listening-era, plus 2 dynamic. Missing 55, 56, 60 (needs not met) |
| Verified | 0 of 66 Opus moves; 6 of 6 weekly moves |
| Claim issues left (Opus) | 1–13 per move |
| toConfirm per move | 9–19 (Opus), 2–3 (weekly) |
| Kicker totals | "OF 52", "OF 63", "OF 64"; "65 OF 64", "765 OF 64" |
| Index title | "Sixty-four moves for Arata" (a stale "Fifty-two" PDF is also served) |
| PDFs | 73 entries in status.pdfs; 02, 03 and 25 missing; 1001–1005 dead (404) |
| Zip 00–28 | 26 PDFs (should be 29) |
| Move write cost | median $1.51, sum $99.88 (meta.usd, write call only) |
| Brand total | status.usd $123.16 at done; cost.json $149.35 now |
| Stale flags | 38 ("Fresh reload with what the team told us"), not rewritten |
| Rewrite history | 30 runs, all with 0 moves, about $7.40 |
| Weekly moves | listen 1006–1008 and auto 1009–1011; run cost $0.41; next due about 2026-10-21 |
| Live connectors | `connected: true, accounts: ['Shopify']` (simulated) |

Quality from spot checks: the documents are deep (7.7k–10.5k words) and specific. They cite ledger keys, and the "to confirm" lists are honest (for example "Study type, sample and results behind the four MitoActive™ claims"). The leftover claim issues are mostly inferences presented as fact, or a stance given to a rival without support (Move 05: "Attributes a specific position to Sharp that is not supported by the evidence"). That is exactly what SPEC.md's hard rules forbid.

---

## 3. Tests: what is covered and what is not

Ran: `moves-cadence`, `moves-evidence`, `cadence-refresh`, `facts-desk`, `retire`, `measure-families`, `measure-stats`, `claim-rules`. **50 of 50 pass** under AI_MOCK.

Covered: cadence numbering, shape, gating, cap, the route; signal ledger; needs and dynamic specs; the mock move shape; the fact gate; facts-desk daily and edits; `quoteIsReal`; `candidates` skipping cadence moves; `mergeProfile`; retire.

**Not covered:**
- `verify` / `scanNumbers` / `claimCheck` / `fixCall` / `evalExpr` / `allowedFor`
- `writeIndex`, and the `total()` count
- `runAll` wave and deps edge cases
- `brief.write` / `guard` / `render`
- `diffLedgers`, `mergeLedger`, `triage`, `doCheck`, `rewriteNow`, `freshReload`, `resumeRewrite`, the private-rewrite switch
- `moves.js` passages
- PDF render, zips and `status.pdfs` bookkeeping
- the 30-minute cadence lock
- `notify`
- `tools/write_moves.mjs`

The `test/*-probe.mjs` files are paid probes and were not run.

---

## 4. Cost and caps

| Knob | Default | Where |
|---|---|---|
| `BUILD_CAP_USD` | $120 a brand (comment says 51 moves cost about $70–90) | `build.js:61` |
| `BUILD_CAP_PRO_USD` | max(150, 2.5 × build cap) = $300 by default; live reports $150 | `build.js:63` |
| `DAILY_BUILD_CAP_USD` | $200 across brands | `build.js:62` |
| `MOVES_CONCURRENCY` | 6 (second pass 4) | `build.js:268-270` |
| `MOVES_EFFORT` / `MOVES_SEARCH` | high / 2 | `build.js:263` |
| `REFRESH_EVERY_DAYS` / `REFRESH_AUTO_MAX` | 7 / 6 | `build.js:619` |
| `REFRESH_CAP_USD` / `REFRESH_AUTO_CAP_USD` | $60 / $14 | `build.js:620` |
| `MOVE_USD` (rewrite estimate) | $1.7 | `build.js:620` |
| `MOVES_WEEK_CAP_USD` | $3 a brand a week (weekly moves and their cards) | `moves-cadence.js:340` |
| `BUILD_PER_USER_DAY` | 3 brands per person per day; 1 an hour per IP when not signed in | `build.js:113-115` |

Real numbers from Arata: about $100 for 66 Opus moves, about $150 for the whole brand so far, and a 6.8 h build.

**Cap holes:**
- `writeIndex` ignores `canSpend`.
- Treg lookups inside `runLookups` run before the `canSpend` check that matters (`canSpend` is checked once per move at start).
- `freshReload` repeats with no budget-aware stop.

---

## 5. What a production build needs (moves area)

1. **An honest "verified" state.** Decide what it means and show it ("numbers checked; 6 claims to review"). Either remove leftover flagged claims or label them inline. Re-check after the last fix. Gate cards on `meta.issues`.
2. **Keep simulated data out of evidence.** Keep the `demo` flag through `sim.js`, exclude demo entries from `rewriteNow` and the fact sheet, and make `priv` depend on real accounts only. Better: remove the connector-to-moves path until real connectors exist (SCOPE says it was cut).
3. **Budget correctness.** `writeIndex` behind `canSpend`; `freshReload` stops after a pass that writes nothing; a single cost ledger per call with the move number.
4. **One set of counts.** The playbook total is computed once per run and written back to every kicker and the index, or the "of N" is dropped. Replace the hard-coded "51" strings.
5. **A reliable PDF pipeline.** Queue with retries, a shared browser, a status per move, superseded files deleted, zips from the current move list (including 51+ if they belong in the set), and status writes under a lock.
6. **Real concurrency control.** GCS `ifGenerationMatch` for `moves.json`, `seed.json`, `status.json`, `updates.json` and `moves/cadence.json`, or a single writer queue per brand. A real lease for the weekly lock, with a test.
7. **Fix `moves.js` passages**, by walking blocks, and add a test.
8. **Bring the prompt into scope.** Remove the "Check timings" and "What Brew will watch" contract and "BREW SHIPS", or rebuild the measurement engine. Remove the dead measurement code.
9. **Exemplars beyond Arata.** At least one per category or market, and a check for exemplar leakage (Arata names and ₹ in other brands' moves).
10. **Retire or fix `tools/write_moves.mjs`**, and extend `prepare-pack.mjs` to clean `status.pdfs`, `updates.json` and `cadence.runs`.
11. **Stable spec ids** instead of move numbers in `CONNECTED_MOVES`, `WANTS` and the `n === 21` statics trigger.
12. **Lock down `POST /notify`**, or remove it if Brew sends no email.
13. **Tests** for every "Not covered" item in section 3.
