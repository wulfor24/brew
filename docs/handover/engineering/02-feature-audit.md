# 02 · Feature audit: the honest status of every feature

*Checked 2026-10-15 against commit `ea6cfd7`, which is live on brew.joinsquareup.com and demo.joinsquareup.com. Method:*
- *six read-only audits (code, tests, local mock runs, GET-only checks on live);*
- *a walkthrough of the demo site;*
- *no money spent.*

*Evidence with file:line references is in `audits/A–F`. When something could not be verified it is marked **Untested**, never Working.*

## Status key

| Status | Meaning |
|---|---|
| **Working** | Does what it says. Seen in live data or a local run. |
| **Partial** | Works, with real gaps a user could hit. |
| **Broken** | Doesn't do what it says. |
| **Dummy** | Simulated by design and tagged (see `DUMMY.md`). |
| **Dummy, untagged** | Simulated, but neither the UI nor `DUMMY.md` says so. **This is an honesty gap.** |
| **Cut, code remains** | Cut in `SCOPE.md`, but code or copy for it is still reachable. |
| **Untested** | Plausible, but no automated test and not verified here. |

## Scoreboard

| Area | Working | Partial | Broken | Dummy | Dummy, untagged | Cut, code remains |
|---|---|---|---|---|---|---|
| Read | 10 | 6 | 0 | 0 | 0 | 1 |
| Moves | 6 | 3 | 2 | 1 | 0 | 1 |
| Feed | 14 | 12 | 0 | 2 | 0 | 1 |
| Jam and Share | 15 | 2 | 0 | 1 | 2 | 1 |
| Accounts and demo | 8 | 1 | 0 | 5 | 1 | 1 |
| **Total (96 rows)** | **53** | **24** | **2** | **9** | **3** | **5** |

*Counted from the rows below. "Working" often still means "no automated test" (see `08-testing-and-qa.md`).*

**One line:** the core loop (read → moves → feed → jam → share) is real and works end to end for the one brand on the sites, Arata. The weak spots fall into five groups:

1. **Honesty leaks.** Simulated teammates and simulated account numbers end up in briefs, memory and move rewrites.
2. **Counting and consistency.** "51" vs 71 moves, and ad counts that disagree with each other.
3. **"Verified" is never reached** on the Opus moves.
4. **Cost controls** reset on every deploy.
5. **Leftover code and copy** from cut features.

---

## 1. Read

| Feature | Status | What's true today | Main issues | Ref |
|---|---|---|---|---|
| Start a read from a URL | Working | Anyone can start one, 1 per IP per hour. About 3.5 min and about $6 for Arata. | Re-asking for a stuck slug re-reads it with no limit. The read can't be cancelled. | A §2.1, §2.16 |
| Orchestrator (stages, deadlines, retry) | Working | ~10 stages, a deadline per stage, one retry each | A timed-out stage keeps writing ("zombie"). No stage has a unit test. | A §2.1 |
| Open the store (platform, market, pages) | Working on Shopify | Arata: 179 pages, 25 sitemaps | Non-Shopify platforms are untested | A §2.3 |
| Brand kit (logo, colours, fonts) | Working | | Colours ranked by CSS frequency often pick UI colours | A §2.4 |
| Catalog | Working on Shopify | 78 products, 52 collections for Arata | WooCommerce and JSON-LD paths are untested | A §2.5 |
| Reviews | Partial | Judge.me and Amazon.in work | `reviews.total` adds site reviews, store reviews and Amazon *ratings* into one number (79,353). Other review apps are untested. Flipkart and Nykaa are not read. | A §2.6 |
| Rivals | Partial | Always finds 5 | The ledger stamps every rival as "found by Google SERP", even ones that came from the Ad Library or from Claude's memory | A §2.8 |
| Meta ads (treg, with a free headless fallback) | Working | 664 own ads and 4,499 rival ads for Arata | "Live" counts ad *versions*, so the number jumped 664 → 1,296. Parsing Ad Library HTML is fragile. | A §2.9, C §2.13 |
| Checkout walk (headless) | Working | Arata: Shopify checkout reached, UPI / Apple Pay / pay later seen. Gullylabs: Razorpay Magic over the cart. Woo store: /checkout/ reached | Adds to cart on the real store. GoKwik's own SDK won't start headless, so GoKwik stores are read at Shopify's checkout and noted | A §2.10 |
| AI answers (ChatGPT, Gemini, Perplexity, Claude) | Working (questions fall back to a template when the AI fails; heal rewrites them) | Named in 12 of 32 answers, 0 of 20 unbranded | Detecting the brand name with a regex gives false hits on common-word brand names | A §2.11 |
| Socials / Films card | Partial | | Timed out on Arata, and the Films card is missing with no explanation | A §2.12 |
| Company facts | Working | | "Cited" means "the URL was in the search results", not that the value was checked on the page | A §2.13 |
| Ledger and facts | Working | 204 rows | When the brand corrects a value under the same key, the correction loses to the first row | A §2.14 |
| Healing saved reads | Partial | Heals ads, the one-liner and AI answers only | Anyone signed out can trigger a paid heal by opening `GET /check` | A §2.15 |
| "Reading {Brand}" onboarding stream | Partial | Works on the normal path | **A store that won't open hangs the screen**: the client ignores the `error` event. Failed steps get a green check. | A §2.17 |
| Check what we read | Partial | The edits work, and confirming starts the moves | Shows "Not found" when a lookup errored. "We will read your reviews from that page" is never done. | A §2.18 |
| Old onboarding path with hard-coded "4,683 reviews" and "India" | Cut, code remains | Runs only for non-generated packs | | A §2.17 |

## 2. Moves

| Feature | Status | What's true today | Main issues | Ref |
|---|---|---|---|---|
| Brand brief | Working | Quote check and "to confirm" both work | No tests of `write` or `guard` | B §1.1 |
| Writing a move (Opus) | Working | 7.7–10.5k words, about $1.5 and about 9 min per move | Depth examples come only from Arata, for every brand | B §1.2–1.3 |
| Verifying a move (numbers, claims, fix) | Partial | The number scan works | **0 of 66 Opus moves are "verified".** Claim problems the checker found (rival stances, inference stated as fact) stay in the text and PDFs, and the UI doesn't show them. | B §1.4 |
| Waves, dynamic and listening-era specs | Working | 71 move docs for Arata | **The counts disagree:** "OF 52 / 63 / 64", "65 OF 64", while the UI and emails say 51 | B §1.5 |
| PDFs and zips | Partial | Served | **PDFs 02, 03 and 25 are missing.** The 00–28 zip holds 26 files. Failures are only logged. | B §1.7 |
| Keeping moves current (check, triage, rewrite) | Partial | Logic is in place | **Stuck on Arata:** 38 moves are stale, and a loop spent about $7.40 writing nothing. Simulated connector numbers become rewrite evidence. | B §1.8 |
| Fact desk and daily price check | Working | Shopify only | | B §1.9 |
| Fact gate on cards | Working | | | B §1.10 |
| Weekly listening and automation moves (1001+) | Working | Verified for numbers, about $0.02 per move | The 30-minute lock isn't atomic. Automation "evidence" includes Brew's own suggestions. | B §1.11 |
| Move passages for card pages and the studio | **Broken** | Always empty | `moves.js` reads `paras`, but moves have `blocks` | B §1.13 |
| `tools/write_moves.mjs` | **Broken** | | Would corrupt a current pack | B §1.16 |
| Connected facts | Dummy | Built from simulated accounts | | B §1.9 |
| Measurement inside every move ("Check timings", "What Brew will watch") | Cut, code remains | Still required by the prompt | It promises monitoring that nothing runs | B §1.14 |

## 3. Feed

| Feature | Status | What's true today | Main issues | Ref |
|---|---|---|---|---|
| Move cards | Working | 131 of the 158 seed cards | The fact gate drops numbers it can't back (good) | C §2.1 |
| Read cards | Working | | | C §2.2 |
| Statics as cards | Partial | 8 real static ads | They rank about #75 of 146: they get value 3, and no rule lifts them | C §2.3 |
| Ranking | Partial | | The seat score swamps the value grade, and the layout overrides the score. No tests. | C §2.4 |
| Learned ranking ("told" boost, `ea6cfd7`) | Partial, live with bugs | | +5 fires on "the team says" even when there are no learnings. 32 of 71 moves get +2. The value is cached forever. | C §2.5 |
| Seats and views | Working | 11 tests | | C §2.6 |
| Groups and dedupe | Partial | | Seated cards skip the one-per-group rule | C §2.7 |
| Two "make" seats (2 and 6) | Partial | Fine before watchers run | **Can be filled by two ads from the same rival** | C §2.9 |
| Social seats (3 and 7) | Working | | | C §2.10 |
| Heard (listening) | Partial | 1,207 items from 8 sources | Review videos are shown as "questions". Skipped sources are listed as failures. Listening runs 3 times a day for every brand. | C §2.11 |
| Ideas stream | Partial | 6 ideas on Arata | The last run made 0 ideas for $0.19, and nothing flags it | C §2.12 |
| Stories (24 h rings) | Working | | Fixed 2026-10-16: new stories keep coming without AI (trends, news, how-to from data), near-duplicates merge, no paise, failed rings say so (test/stories-fallback.test.js) | C §2.13 |
| Research cards | Working | | | C §2.14 |
| Catalog watcher | Working on Shopify | | Its buttons promise actions Brew doesn't take ("we pause / restart / tell you") | C §2.15 |
| AI-answers watcher | Partial | | **A gap card is dropped when the shopper's question contains a banned word** | C §2.16 |
| Own-ads watcher | Working | | | C §2.17 |
| Creative watcher | Partial | | Lanes hard-coded to Arata's old ones. Budget is per workspace. | C §2.18 |
| QA gate | Partial | | Arata-specific rules ("N new hairs") | C §2.19 |
| Margin notes | Working | About 1 in 2 cards | | C §2.20 |
| Move value grades | Working, low impact | | | C §2.21 |
| Card plan | Working | | | C §2.23 |
| Card page | Partial | | Cached in memory only, so it is paid for again after each reload | C §2.24 |
| Feedback (heart, not for me, snooze) | Working | | | C §2.25 |
| Pulse / new-cards pill | Working | | | C §2.26 |
| Deck view | Working, untested | | | C §2.27 |
| Connector and health cards | Dummy | 12 tagged cards | | C §2.28 |
| Pro deck upsell | Dummy | | | C §2.29 |
| Festival logic | Partial, **time bomb** | | Hard-coded: Diwali 8 Nov 2026 and Black Friday 27 Nov 2026. **Stale for every brand after 27 Nov 2026.** | C §6, B1 |
| Measurement and Do-it-now remnants on cards | Cut, code remains | | "Measure" lines and "Live / shipped by Brew" pill code | C §8 |

## 4. Jam and Share the brief

| Feature | Status | What's true today | Main issues | Ref |
|---|---|---|---|---|
| Open a jam | Working | | One jam per card per workspace, not per brand | D §3.1 |
| Living brief (ask AI, edit, add) | Working | | Simulated replies and simulated account numbers get folded into it | D §3.2 |
| Jam chat | Working | | | D §3.3 |
| Studio (canvas, change package, knobs) | Working | | Full of cut-feature fields (rollback, irreversible, live) | D §3.4 |
| Versions | Working | | Two version systems kept in step by hand | D §3.5 |
| Photos | Working | | | D §3.6 |
| One-tap drafts (image, carousel, video, voice, text) | Working (mock), **media untested here** | | Of Arata's background drafts, the 2 videos came out as stills and 1 carousel fell back to text | D §3.7 |
| Background first drafts | Working | $4 a day per brand | | D §3.8 |
| Download | Working (code read) | | | D §3.9 |
| Composer | Partial | | "A link: Brew reads the page" doesn't read it. The video label says Hailuo, but the code uses Veo. | D §3.10 |
| Brand memory | Working | 71 facts on Arata | Simulated pushback becomes a brand rule | D §3.11 |
| Brand learnings ("What your team told Brew") | Working | | Dummy connector numbers win conflicts against real team input | D §3.12 |
| Workspace learning (lessons, rules) | Working | | Learns from simulated teammates | D §3.13 |
| Teammate replies (@name) | Dummy | Tagged | **The simulated approval moves the jam to Ready.** The "Posted to #growth" toast is false. | D §3.14 |
| "Ask everyone" plan answers | **Dummy, untagged** | | **Canned sign-offs: "Cleared…", "used with consent", "Verified this morning…". They land in the shared brief.** | D §3.15 |
| Take it to WhatsApp | Working | Opens the user's own WhatsApp | | D §3.16 |
| Take it to Slack | **Dummy, untagged** | Copies only | Toast says "Posted to #growth" | D §3.16 |
| Work board and stages | Working | Ends at "Brief shared" | Old deploying, measuring and result stages are still in the code | D §3.17 |
| Share the brief (BR-n) | Partial | Copies the text and link | **Not frozen: edits after sharing show on the page.** BR numbers are per workspace (everyone's first share is BR-1042). "My team" leaves out the read-only link. | D §3.18 |
| Read-only `/h/` page | Working, untested | | Rebuilt live from the jam. Its link signature depends on the Anthropic key. | D §3.19 |
| Old routes (`/api/jams`, WhatsApp, `/api/slack/*`, `/api/ai/*`) | Cut, code remains | | | D §3.20 |

## 5. Accounts, demo and dummies

| Feature | Status | What's true today | Main issues | Ref |
|---|---|---|---|---|
| Google sign-in | Working | PKCE, nonce | | E §1 |
| Sessions | Working | 30-day signed cookie | No revocation | E §1 |
| Claim a brand by work email | Working | **Arata is unclaimed on live** | An email domain is weak proof of ownership | E §1 |
| Same-domain auto-join, team, invites, views | Working | 11 tests | | E §1 |
| Read-only view for others | Partial | | Some reads and writes skip the gate | E §1, §4 |
| Admins | Working | | | E §1 |
| **Team emails (invites, joins, moves ready)** | **Working (real)** | Sent through Resend | **In scope as of 2026-10-15.** `POST /notify` is open to anyone. | E §1, S-6 |
| Demo per-visitor sandbox and send guard | Working | Tested | Only Arata is demo-ready | E §2 |
| Demo generation | Working | Real AI for every visitor | One script can use up the day's caps | E §2 |
| Connected accounts | Dummy | Tagged | **The simulated numbers lose their demo flag** and flow into moves, facts and briefs | E §3, B §0.2, D §5 |
| Health rings | Dummy | Tagged | | E §3 |
| Pro plan | **Dummy, but spends real money** | Tagged | The Pro button raises the brand's real build cap ($60 → $150+) | E §3 |
| Teammate replies | Dummy | Tagged | (see Jam) | E §3 |
| Demo site | Dummy (showcase) | | | E §3 |
| Slack connector stats ("Approvals from Slack: On") | Dummy, untagged copy | | Describes a cut flow | E §3 |
| Old access requests and approve links | Cut, code remains | | | E §1 |

## What reads as "real" to a viewer but isn't

These matter most for a showcase. A prospect may take them at face value.

1. Plan answers from "teammates" that sign off on legal, rights and tracking (D §3.15).
2. A simulated approval that moves work to Ready (D §3.14).
3. "Posted to #growth" toasts (D §3.14, §3.16).
4. Simulated account numbers quoted in briefs and move rewrites as if they were real (B §0.2, D §5).
5. Moves that promise "What Brew will watch" and check timings, which nothing runs (B §1.14).
6. Card buttons and copy such as "do it", "Shift budget", "we pause / restart", "Turn on the journey", which sound like Brew acts. It doesn't (C §8; seen on the demo).
7. Counts that don't line up across screens. "Live ads" appears as 4.3k (demo picker, own plus rivals), 1,143 (health card), 664 (cards and moves) and 1,296 (after a re-read, which counted ad versions), and no screen says what it counts. Moves appear as 51, 64 and 71.
