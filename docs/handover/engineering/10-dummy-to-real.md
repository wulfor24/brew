# 10 · From Dummy to real

*Every simulated piece, what it fakes, where it leaks, and what the real build needs. `DUMMY.md` is the short list. This page adds what the audit found.*

## The tagged dummies

| # | Dummy | Fakes | **Leak found in the audit** | Real build needs |
|---|---|---|---|---|
| 1 | **Connected accounts**: Shopify, Meta Ads, Google Analytics, Google Ads, Klaviyo, Judge.me, Slack, Marketplaces (`connectors/`, `demo-data.js`) | One tap "connects". Stats, "what changed", `live-*` cards and ledger rows are built from the brand's public read. | **`connectors/sim.js:29-31` strips the `demo` flag** and sets `method: 'connected account'`. The simulated numbers then: (a) become **move-rewrite evidence** that passes the number check, (b) count as "connected" facts that **override real team input** in brand learnings, (c) are fed to the jam brief as "quote these exactly". One simulated private ledger also makes **every later rewrite private** (`build.js:691`). | Per platform: OAuth or API key, a token vault, proof of ownership, a daily sync, and platform approvals (Meta Marketing API, Shopify app review, Google verification). Keep the `sync()` return shape (`stats`, `changed`, `cards`, `ledger`). **First, today:** keep the `demo` flag through `sim.js` and exclude demo rows from `rewriteNow`, facts-desk, `accountLine` and `conflictsOf`. |
| 2 | Connector cards and numbers in the feed, composer and connect sheet | The account numbers | | Comes free with #1. Then remove the tags. |
| 3 | **Health rings**: Creative, Storefront, AI answers (`dummy/health.js`) | Steady scores per brand, nudged by real facts | `seed.geo` is derived from them | One scorer per ring with named sources and tests. Unported fixes from the old feed repo exist (`feed-unported-work`): creative volume against rivals, AI-answer weights, storefront skipping what it couldn't see. |
| 4 | **Pro plan** (`public/app.js openPlan`) | "Start the trial" switches Pro on in the browser | **Not fully dummy.** The Pro button on the moves page calls the real `POST /api/brands/:slug/pro`. That **raises the brand's build cap from $60 to at least $150 and resumes a paused build.** DUMMY.md doesn't say this. | Billing and plan enforcement, if wanted. Until then, either make the button purely client-side or document that it lifts the cap. |
| 5 | **Teammate replies** (@name) | An AI teammate replies in character after 5–7 s | **The verdict changes real state.** "Approve" moves the jam to Ready ("approved v3. Ready to ship."). The reply is folded into the brief and the shared text. Pushback becomes a lesson, then a **rule in brand memory** (persisted). Onboarding copy sells it as real ("They approve in the thread"). | Post to Slack or email and bring the real replies back. Human approvals only. Never write simulated text into briefs, lessons or memory. |
| 6 | **Demo site** (`DEMO_MODE=1`) | A showcase sandbox per visitor | Real AI runs for every anonymous visitor under shared daily caps | Nothing, by design. Add caps per session. |

## Simulations that are not tagged or listed (add them to DUMMY.md, or remove them)

| What | Where | Problem |
|---|---|---|
| **"Ask everyone" plan answers** | `remix.js:274-296` (`ANSWERS`), `remix.js:1039-1058` (`liveAnswer`) | Canned or AI "in character" sign-offs: legal "Cleared", rights "used with consent", tracking "Verified this morning", stock, compliance, budget. They mark questions answered, become checks and rules, and **appear in the shared brief**. SCOPE lists scripted team replies as cut. **This breaks the SPEC rule against invented facts. It is the most serious honesty gap.** |
| "Posted to #growth" toasts | `public/jam-room.js:244, 281, 454` | Nothing is posted. It is a clipboard copy. |
| `/api/slack/workspace`, `/api/slack/post` | `server.js:304-306` | Canned Slack routes with no caller. Delete them. |
| Slack connector stats ("Approvals from Slack: On", "New moves post to #growth with an Approve button") | `connectors/sim.js:40` | Describes a cut flow |
| `/api/jams` "The ShopOS team has it. Usually replies in 12 to 24 hours." and `/api/jams/:jid/whatsapp` "Thread moved to WhatsApp" | `feed-service.js:1184-1200` | Cut fake-team flow, still reachable. Delete. |
| Moves' "What Brew will watch" and "Check timings" | `moves-engine.js` CONTRACT | Promise monitoring that doesn't exist |
| Card buttons and copy promising actions ("we pause / restart / tell you", "Shift budget", "do it") | `feed-service.js:603-616`, welcome card | Brew doesn't act on accounts |

## Cut features: what's left in the code

| Cut feature | Leftovers to delete or rename |
|---|---|
| **Do it now** | `NEEDS`, `toolInWords`, `deployTarget`, `decideFromAction`; the "Live / shipped by Brew" pill; value grade `now`; remix `target`, `money`, `rollback`, `irreversible`; DEMO_OK `work/:wid/live` and `changes/:chid/undo` |
| **Measurement** | `measure-families.js`, `measure-stats.js`, `measure-spec.js`, `data/measure-families.json` (still imported by moves-engine and jam-brief); `genericMeasure` and `pub().measure` on every card; the card page's "when we stop or roll back"; stages deploying, out, measuring, result |
| **Fake team flow** | the routes above; `tickBatches`; `leadsAllTenants` |
| **Free cap / Pro** | the `limit` object, `t.plan`, `proAt`, the "Free to Pro" metric |
| **Audit moves** | `auditScorecard` (kept on purpose as evidence for automation moves); `FAMILY_SCHEMA.area` lists audit areas; retired PDFs 1001–1005 are still in `status.pdfs` (they return 404) |
| **ShopOS name** | 104 references; `brew-name.js` rewrites "ShopOS" to "Brew" on every read, a runtime shim instead of a one-time data migration |
| **Old feed** | the `OPS_FRESH_RELOAD` loop in `build.js`; `video-read.js` defaulting to the `squareup-feed` bucket |

## Now in scope (decided 2026-10-15)

- **Brew's own emails to the brand's team are real and stay:** invites, "someone joined", view and owner changes (`auth.js mail`), and "your moves are ready" / "moves updated" (`build.js notify`, `notify.json`).
- "Brew sending" stays cut. It means only marketing email and WhatsApp to the brand's customers.
- To do: lock down `POST /notify` (see `09-security-and-access.md` N-4).

## A suggested order for making things real

1. **Stop the leaks now.** It's cheap. Keep `demo` flags; keep simulated replies out of briefs, memory and shared text; tag or remove the plan auto-answers and the Slack toasts. Ranked list: `11-known-issues-and-debt.md`.
2. **The first real connector:** Shopify, read-only (orders, products, checkouts). It backs the most cards and has the simplest approval path.
3. **Meta Ads read-only** (spend, ROAS, creative fatigue). It needs Marketing API access and app review.
4. **A Slack app** for the teammate loop. This replaces dummy #5.
5. **Measurement** (if product brings it back): launch records, readings, grades. The move contract already describes it.
