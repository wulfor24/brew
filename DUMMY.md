# What is simulated (DUMMY)

Brew is a **realistic prototype**. Everything below looks and behaves like the real thing, but nothing real happens behind it.
Each one is marked in three places:

- **In the UI:** a small dashed **Dummy** tag (`public/dummy.css`, `.dummy-tag` / `.card.is-dummy`).
- **In the code:** a `DUMMY:` comment at the seam.
- **Here:** what it fakes, and what the real build needs.

Everything **not** listed here is real: the read, the moves, the feed, the jam, drafts, brand memory and learnings, listening, ideas, stories, sign-in and teams, and Share the brief.

| # | What | Where in the code | What it fakes | What the real build needs |
|---|------|-------------------|---------------|---------------------------|
| 1 | **Connected accounts on the demo site** | `connectors/index.js` (`simOnly`: `DEMO_MODE=1`, or no real connector), `connectors/sim.js` (the simulated read), `demo-data.js` (numbers from the brand's real read), `connectors/common.js` (card and ledger shapes) | On demo.joinsquareup.com one tap connects a simulated account; its stats, "what changed" lines, feed cards (`live-*`) and ledger entries are built from the brand's public read. On the live site Shopify, Meta Ads, Google Analytics, Google Ads, Klaviyo, Judge.me and Slack are real (Marketplaces is Coming soon, row 7) (`connectors/shopify.js` etc.). | Nothing: the demo site is a showcase. |
| 2 | **Simulated connector cards and numbers** in the feed, composer and connect sheet | `public/live.js` (`openSim`, `simId`, the Dummy pill when `x.dummy`), `public/composer.js` (connectors popover), `public/app.js` (cards with `p.dummy`, `p.demo`, `p.onlyWhen` or a `live-` id get `.is-dummy`; the Connectors title tag only when `LIVE.dummy`) | The account numbers shown for a simulated account, and the sample signal in the deck's Signals column (`public/app.js` `SIGS`, made-up counts; demo site only since 2026-10-17: on the live site the column shows only real connector cards or is hidden). | Nothing on the live site: real accounts are tagged Live, not Dummy. |
| 3 | ~~Health rings~~ **Real since 2026-10-16** | `health.js` (`healthFrom`), PageSpeed in `reader/stages/site.js` | Nothing: each ring is scored from what the read found (Creative: own live ads vs rivals, hooks, formats, max 85; Storefront: PageSpeed, the checkout walk, photos, reviews on the site; AI answers: unbranded 85 / branded 15). A part or ring that couldn't be read is shown as not read and left out of the score. | Number kept so other rows keep theirs. |
| 4 | **Pro plan** | `public/app.js` `openPlan` (the plan sheet, the deck upsell) | "Start the trial" switches Pro on in the browser. There is no billing and no limit: every card is shown. Since 2026-10-17 the Pro card is not shown in a real brand's feed on the live site (it stays on the demo site and in the plan sheet). | Billing and plan enforcement, if wanted. |
| 5 | **Teammate replies in the jam, demo site only** (@name) | `feed-service.js` `POST /api/work/:wid/send` → `colleagueReply` (refused unless `DEMO_MODE=1`); tagged in `public/jam-room.js` (`DEMO`) | On demo.joinsquareup.com, a made-up teammate (from the brand's roles) answers in the jam after a few seconds. The reply is written by AI from their role, is tagged and **changes nothing**. On the live site, @ tags real people (`jams.js`, `jam-mail.js`), and a jam taken to a really connected Slack runs live in its thread (`slack-routes.js`, `feed-service.js` `slackIn`/`slackAct`): replies fold into the brief, asks become proposals (Make it / Not now), new assets post back for review; nothing is simulated. | Nothing: the demo site is a showcase. |
| 6 | **The demo site** (demo.joinsquareup.com, `DEMO_MODE=1`) | `demo-mode.js`, `demo-routes.js`, `public/demo-picker.html`, `tools/deploy-demo.sh`, `tools/demo-sync.sh` | A showcase. Every visitor gets a throwaway session of a prepared brand, with simulated accounts (item 1). The tour runs read → feed → jam → Share the brief. | Nothing; it is a showcase by design. |
| 7 | **Marketplaces, Coming soon** (2026-10-16) | `public/app.js` (`soonMarkets`, `soonSec`, the Marketplaces connector dropped from `B.connectors` and the roles), `connectors/index.js` (`OFF`), `demo-routes.js` | The connectors page shows the marketplaces the brand sells on (or the big ones in its country) with their real logos and a **Coming soon** label instead of a Dummy tag: nothing is read or connected. The Marketplaces connector is off: no connect, no daily read, an earlier connection is ignored. | A real marketplace connector per platform (seller APIs), then take `marketplaces` out of `OFF`. |
| 8 | **Finals on the demo site** (2026-10-16) | `finals.js` (`dummy()`: `DEMO_MODE=1` or `SLOOSH_DUMMY=1`), `finals-routes.js`, `public/finals.js` (the Dummy tag on the sheet and the version) | On demo.joinsquareup.com "Make the final" quotes zero credits and hands back the draft's own picture (or the picked product photo) as the final, labelled Final (Dummy). Nothing reaches Sloosh. On the live site the final is made by Sloosh (sloosh.ai, over its MCP server, from Brew's own workspace) after a real quote and the team's yes. | Nothing: the demo site has no vault key, so it cannot hold Sloosh tokens. |

## Rules that keep a dummy from passing as real (2026-10-15)

- Simulated account rows keep `demo: true` (`connectors/sim.js`). `connectors/common.js` `simulated()` / `realRows()` keep them out of move rewrites, the fact sheet, the jam brief, learnings conflicts and stale flags. Real connectors write method `account:<id>`.
- There are no canned answers. "Ask" on a teammate's readiness question copies it for them; an AI-owned question gets a suggestion marked "Suggested:". Answers saved from the old simulated flow reopen.
- Old copy in saved packs and workspaces heals on read (`brew-name.js`): kickers lose the drifting "OF N", "What Brew will watch" becomes "What to watch", BREW SHIPS becomes BREW DRAFTS, and the welcome card says "share the brief". Saved PDFs are drawn again at boot (`build.js` `healPdfs`, `PDF_V`).
- `test/honesty.test.js` guards all of this.
- The v2 onboarding's tutorial cards (`public/onboard2.js` `EXAMPLE_CARDS`) are Brew's own teaching examples, never the brand's data: each carries a dashed **Example** tag on screen and an `EXAMPLE:` comment in the code. Nothing about the brand is simulated there, so they need no row above.

## What the prototype deliberately does not do

These are cut, not simulated. The full list is in `SCOPE.md`.

- **No Do it now:** nothing acts on a brand's accounts.
- **No measurement:** no launch records, readings or grades.
- **No sending to customers:** no marketing email or WhatsApp from Brew. Brew's own emails to the brand's team (invites, joins, "your moves are ready") are real; see `SCOPE.md`.

The jam ends with **Share the brief**. *Share with my team* copies the brief and a link to the full read-only brief. *Send brief* emails the whole brief to the ShopOS team and tracks its status, which the ShopOS team sets by hand (real, not simulated; the demo site sends no email).
