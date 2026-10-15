# 11 · Known issues and tech debt (ranked)

*Ranked for a **showcase prototype**: first what could embarrass a demo or cost money, then what blocks real brands, then debt. Each item points to its audit section, where the file:line evidence is.*

## P0: fix before the next showcase

| # | Issue | Effect | Ref |
|---|---|---|---|
| 1 | **Invented sign-offs** from "Ask everyone" (legal cleared, consent, tracking verified) and simulated approvals reach the shared brief and move the jam to Ready | A prospect reads made-up compliance claims in "their" brief | D §3.14–3.15 |
| 2 | **Simulated account numbers are treated as real**: rewrite evidence, "connected" facts, brief prompt | Invented revenue and ROAS in moves and briefs; real team input rejected | B §0.2, D §5 |
| 3 | **Festival dates are hard-coded** (Diwali 8 Nov 2026, Black Friday 27 Nov 2026) | Seasonal cards and prompts go stale for every brand after 27 Nov, with "-N days away" text | C §6, B1 |
| 4 | **Counts that don't line up**: "live ads" shows as 4.3k, 1,143, 664 and 1,296 on different screens, and none says what it counts (own vs rivals, ads vs versions). Moves show as 51, 52, 64 and 71 ("MOVE 65 OF 64"). | Looks careless in front of a prospect | B §0.5, C §2.13 |
| 5 | **Missing PDFs** 02, 03 and 25; the zip has 26 of 29 | Broken downloads | B §0.6 |
| 6 | **A store that won't open hangs onboarding**, and failed steps show green checks | A live read in a demo can stall | A §2.17 |
| 7 | **The two "make" seats can hold two ads from the same rival**, and statics rank about #75 | The first screen shows a competitor's ads instead of the brand's own | C §2.7, §2.9 |
| 8 | **Copy promises cut features**: "do it", "we pause / restart / tell you", "Posted to #growth", "What Brew will watch", "They approve in the thread", "Hailuo 2.3" | Overclaims | C §8, D §3.10, B §1.14 |
| 9 | **AI-answer gap cards are dropped** when the shopper's question contains a banned word | The most useful gap card never shows | C §2.16 |
| 10 | **The `told` ranking boost (live)** fires with no learnings and is cached forever | Ranking noise | C §2.5 |

## P1: cost and safety (now)

| # | Issue | Ref |
|---|---|---|
| 11 | The runtime SA can read every company secret and redeploy any service | F §0.1, `09` N-1 |
| 12 | Spend without sign-in: reads, heal, transcribe, memory learn, workspaces, demo AI | E S-5, `09` N-2 |
| 13 | Caps live in memory and reset on every deploy; some Claude calls aren't metered; the Move 00 index skips `canSpend`; the `freshReload` loop (about $7.40 wasted on 2026-10-14) | F §0.5, B §0.4 |
| 14 | `POST /notify` lets anyone get Brew to email 20 addresses per brand | E S-6 |
| 15 | No rollback: revisions deleted, buckets unversioned, no SHA recorded | F §0.3 |
| 16 | `HANDOFF_SECRET` unset, so share links die if the Anthropic key is rotated | F §0.11 |
| 17 | Service-level `maxScale` 100 vs the 1 the app needs | F §0.11 |
| 18 | Logs have no severity, so there are no alerts | F §0.4 |

## P2: before real brands onboard

| # | Issue | Ref |
|---|---|---|
| 19 | Shared links make anyone a team member; `/told` and `/memory` are public; seats aren't enforced on the server; anonymous writes to unclaimed brands | E S-1–S-4 |
| 20 | **"Verified" is never reached on Opus moves.** Leftover claim issues ship in the text and PDFs. | B §1.4 |
| 21 | Shared briefs aren't frozen; BR numbers are per workspace (every first share is BR-1042); "My team" leaves out the read-only link | D §3.18 |
| 22 | Brand corrections lose to read values with the same key; "we will read your reviews from that page" isn't built | A §2.14, §2.18 |
| 23 | Ledger provenance is wrong for rivals and free-fallback ads; `reviews.total` mixes metrics | A §2.8–2.9, §2.6 |
| 24 | Proven on one brand only (Arata). No reader stage tests, and Arata-specific hacks remain. | A §0, C §6 |
| 25 | Moves rewrite path is stuck on Arata (38 stale moves); one private ledger sends every rewrite private | B §1.8 |
| 26 | PDF names aren't reduced to a bare file name; the URL reader can reach internal addresses | E S-7, S-8 |

## P3: tech debt

| # | Debt | Ref |
|---|---|---|
| 27 | **Giant, dense files:** `public/app.js` 546 KB / 4,099 lines, `feed-service.js` 171 KB, `remix.js` 127 KB. Lines up to 1,425 characters, many one-line ternary chains. | F §6 |
| 28 | **Single-instance design:** workspaces, caps, locks and schedulers all in-process; about 14 timers; workspaces and watcher instances never evicted | `01-architecture.md`, C §3 |
| 29 | No CI, lint or types; no route or client tests | `08-testing-and-qa.md` |
| 30 | Eight hand-written GCS clients, three metadata-token fetchers, two `strictSchema` versions, two Claude stacks, treg calls that bypass `treg.js` | F §6 |
| 31 | `node_modules` is a symlink to the archived `feed/`; 64 MB `.npm-cache/` committed and uploaded on each build; a company URL map dump committed | F §0.6–0.7 |
| 32 | Cut-feature code throughout (see `10-dummy-to-real.md`) | |
| 33 | `moves.js passages()` broken (reads `paras`); `tools/write_moves.mjs` corrupts packs | B §1.13, §1.16 |
| 34 | Card pages cached in memory only, so they are paid for again after each reload | C §2.24 |
| 35 | The `brew-external-data` skill and `audit.py` live outside the repo and point at the old bucket and domain | F §0.9 |
| 36 | Listening runs 3 times a day for every built brand (docs say once); the lite run overspent its cap 4×; ideas runs that make 0 ideas aren't flagged | C §2.11–2.12 |
| 37 | `brand-memory.js:371` sends PNGs labelled as JPEG (a live 400 in the logs) | F §4 |

## Work that exists but was never shipped

These are in the archived `feed/` repo on main and were not deployed. Port them only if wanted:
- weekly history (`history.js`: a week-by-week record of moves and cards);
- health-ring fixes;
- a review step for brand learnings (save / drop / change / add / cancel), reopening the same paste, and a first-time warning before every move is refreshed.
