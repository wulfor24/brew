# What is simulated (DUMMY)

Brew is a **realistic prototype**. Everything below looks and behaves like the real thing, but nothing real happens behind it.
Each one is marked in three places:

- **In the UI:** a small dashed **Dummy** tag (`public/dummy.css`, `.dummy-tag` / `.card.is-dummy`).
- **In the code:** a `DUMMY:` comment at the seam.
- **Here:** what it fakes, and what the real build needs.

Everything **not** listed here is real: the read, the moves, the feed, the jam, drafts, brand memory and learnings, listening, ideas, stories, sign-in and teams, and Share the brief.

| # | What | Where in the code | What it fakes | What the real build needs |
|---|------|-------------------|---------------|---------------------------|
| 1 | **Connected accounts** (Shopify, Meta Ads, Google Ads + GA4, Klaviyo, Judge.me, Slack, Marketplaces) | `connectors/index.js` (connect, sync, disconnect, routes), `connectors/sim.js` (the simulated read), `demo-data.js` (numbers from the brand's real read), `connectors/common.js` (card and ledger shapes) | One tap connects a simulated account. Its stats, "what changed" lines, feed cards (`live-*`) and ledger entries for the moves are built from the brand's public read, the same for every viewer of that brand. Nothing signs in to a platform; nothing is read from or written to a real account. | Per platform: OAuth or API key, a token vault, proof the account is the brand's, a daily sync, and the platform approvals (Meta Marketing API, Shopify app review, Google verification). Keep the shapes `sync()` returns (`stats`, `changed`, `cards`, `ledger`); everything downstream already reads them. Who may connect is real and stays (`auth.claimInfo` / `auth.claim`). |
| 2 | **Connector cards and numbers** in the feed, composer and connect sheet | `public/live.js` (connect sheet, status), `public/composer.js` (connectors popover), `public/app.js` (cards with `p.dummy`, `p.demo`, `p.onlyWhen` or a `live-` id get `.is-dummy`) | The account numbers shown on cards and in the sheet. | Comes for free once item 1 is real. Remove the tags. |
| 3 | **Health rings** (Creative, Storefront, AI answers) and `seed.geo` | `dummy/health.js` (`healthFrom`), called by `build.js` (publishBase) and `brand-pack.js` (re-scored at load); the card is `public/app.js` `healthCard` (`.is-dummy`) | Steady per-brand scores seeded by the host, nudged by a few real facts (live ads, photos, reviews, AI answers). No PageSpeed, no checkout walk scoring. | A scorer per ring with named sources and tests. The old one had stale saved scores, payments 0/10 for every brand, and SEO 100 when nothing was read. |
| 4 | **Pro plan** | `public/app.js` `openPlan` (the plan sheet, the deck upsell) | "Start the trial" switches Pro on in the browser. There is no billing and no limit: every card is shown. | Billing and plan enforcement, if wanted. |
| 5 | **Teammate replies in the jam** (@name) | `feed-service.js` `POST /api/work/:wid/send` → `colleagueReply`; tagged in `public/jam-room.js` | A teammate (from the brand's roles) answers in the jam after a few seconds, written by AI from their role. The reply is tagged and **changes nothing**: no stage, no approval, and it never goes into the brief, the shared text, lessons or memory. "Take it to Slack" only copies the text. | Post to the brand's Slack (or email) and bring real replies back into the jam (mark them `real: true` so the brief may use them). |
| 6 | **The demo site** (demo.joinsquareup.com, `DEMO_MODE=1`) | `demo-mode.js`, `demo-routes.js`, `public/demo-picker.html`, `tools/deploy-demo.sh`, `tools/demo-sync.sh` | A showcase. Every visitor gets a throwaway session of a prepared brand, with simulated accounts (item 1). The tour runs read → feed → jam → Share the brief. | Nothing; it is a showcase by design. |

## Rules that keep a dummy from passing as real (2026-10-15)

- Simulated account rows keep `demo: true` (`connectors/sim.js`). `connectors/common.js` `simulated()` / `realRows()` keep them out of move rewrites, the fact sheet, the jam brief, learnings conflicts and stale flags. Real connectors write method `account:<id>`.
- There are no canned answers. "Ask" on a teammate's readiness question copies it for them; an AI-owned question gets a suggestion marked "Suggested:". Answers saved from the old simulated flow reopen.
- Old copy in saved packs and workspaces heals on read (`brew-name.js`): kickers lose the drifting "OF N", "What Brew will watch" becomes "What to watch", BREW SHIPS becomes BREW DRAFTS, and the welcome card says "share the brief". Saved PDFs are drawn again at boot (`build.js` `healPdfs`, `PDF_V`).
- `test/honesty.test.js` guards all of this.

## What the prototype deliberately does not do

These are cut, not simulated. The full list is in `SCOPE.md`.

- **No Do it now:** nothing acts on a brand's accounts.
- **No measurement:** no launch records, readings or grades.
- **No sending to customers:** no marketing email or WhatsApp from Brew. Brew's own emails to the brand's team (invites, joins, "your moves are ready") are real; see `SCOPE.md`.

The jam ends with **Share the brief**. *Share with the ShopOS team* and *Share with my team* both copy the brief and a link to the full read-only brief. The engineering team adds these flows if and when they are wanted.
