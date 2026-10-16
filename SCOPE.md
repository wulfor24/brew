# Brew prototype: scope

Brew is a **realistic prototype** that the engineering team picks up and continues. It is not the product.

## The one flow

**Read → Moves → Feed → Jam → Share the brief.**

| Step | What happens | Real or dummy |
|------|--------------|---------------|
| **Read** | Paste a URL. Brew reads the store, catalog, reviews, ads (Meta Ad Library), SEO, AI answers, socials and rivals, live on screen, then "Check what we read". | Real: crawl, treg, Claude |
| **Moves** | 51 strategy moves with PDFs and zips, rewritten when the brand changes. Weekly **listening moves**, from real online talk. Weekly **automation moves**, as plans the team runs from the brief; Brew never runs them. | Real |
| **Feed** | Ranked cards from the moves, plus ideas, Heard, stories, watcher cards and margin notes. Ad and social-post cards hold two seats in the first screen. | Real |
| **Connectors** | Real, read-only accounts on the live site (since 2026-10-16): Shopify, Meta Ads, Google Analytics, Google Ads, Klaviyo, Judge.me. Slack is real too: it posts the cards and jams the team sends to the channel picked on sign-in, and brings thread replies and Approve back into the jam (`connectors/slack.js`, `slack-routes.js`); it is never evidence. A jam on Slack runs both ways: chatter only folds into the brief, a change or a paid image/video is proposed and runs only on a yes, and every new asset or version posts to the thread for review. Marketplaces are Coming soon cards (DUMMY.md row 7). Connect by the platform's sign-in where it is switched on, or a pasted read-only key (GA4 by property ID, with Brew's service account added as Viewer; refused when another brand has that property or its web stream isn't the brand's site, unless Brew staff override; 6 tries per person per 15 minutes). Tokens are encrypted in the brand's vault (`vault.js`, `FEED_VAULT_KEY`), read once a day, and shown only to the brand's team; the numbers beat the site read on the fact sheet. A failing account backs off (Retry-After on a rate limit, else doubling with jitter); after 3 failed reads in a row or 72 hours without a good one its numbers are marked stale on the fact sheet and stop being evidence. A Meta sign-in's end (about 60 days) is tracked, renewed where Meta allows, and the brand's owners and admins are warned in the app and by email a week ahead. | Real. **Dummy** on the demo site and for Slack: see `DUMMY.md` |
| **Health rings** | Store health score: Creative (own live ads vs rivals), Storefront (PageSpeed, checkout walk, photos, reviews), AI answers (real answers). Parts that couldn't be read are left out. | Real (`health.js`) |
| **Pro plan** | Plan sheet; no daily card cap. | **Dummy** |
| **Jam** | Studio: canvas, chat, first drafts (image, text, video, voice, carousel), versions, photos, download, composer, brand memory and learnings. **Team jams** (`jams.js`): a brand's jams belong to its team, not to one browser. One jam per card: a second person joins it. The board has My jams and Team jams. @someone tags a real teammate. You can give a jam to someone or ask for their OK. The jam shows who's here and who's typing. Every message and version records who made it. | Real (the simulated teammate lives on the demo site only) |
| **Share the brief** | *Send brief* to the ShopOS team, or *Share with my team*. Both freeze the brief (BR-n). To my team it is copied with a link to the full read-only brief, nothing sent. To the ShopOS team it is **sent**: the whole brief (body, deliverables, assets, rules, done-when, where) goes to `SHOPOS_EMAIL` every time (`jam-mail.js` `briefSent`), and it gets a tracked status the ShopOS team moves on: sent → received → in progress → delivered, or needs info (`brief-status.js`, `POST /api/work/:wid/brief/status`, staff only). Each step writes a line in the jam and emails the person who sent it. The top bar shows "N with the team". Guests can't send or move a brief; the demo site sends no email. | Real |
| **Ask Brew** | One thread per person (`ask-brew.js`, `/api/tenants/:t/ask`) that answers across the feed, the moves and the facts, with links to the cards and moves it used. Opened from anywhere with a seed (a card, a move, saved cards, a signal); something to make becomes a jam, something a person must do becomes a brief to send. With AI off it says so and lists what mentions the question. | Real |
| **Your feed** | Per person: less / normal / more for each agent, topics to lift, and what Brew picked up from your hearts, Not for me and Fewer (each deletable). The ranker reads them (`member-tuning.js`). | Real |
| **Drop anything** | One upload (`drop.js`, `POST /api/brands/:slug/drop`): brand memory (team only), my preferences, or just this once (a jam's photo, or the next ask). Text up to 4,000 characters, PNG/JPG/WebP photos up to 8 MB. | Real |
| **Accounts** | Google sign-in, claim with a work email, team and invites, a read-only view for everyone else. Name and picture come from Google and are never typed in. Onboarding ends with Invite your team. A shared jam link needs sign-in: a teammate opens it in their own workspace, anyone else becomes a guest of that one jam. A guest can chat, edit the brief and make drafts, but can't share or send the brief, approve, assign or discard (the jam, or its studio change). shopos.ai and joinsquareup.com accounts are staff on every brand ("ShopOS team · name"). | Real |
| **Brew's emails to the team** | Sent through Resend from hello@send.joinsquareup.com: invites, "someone joined", view and owner changes (`auth.js` `mail`), and "your moves are ready" / "moves updated" to the people waiting on a read (`build.js` `notify`, list in `notify.json`). The demo site blocks them.  **Jam emails** (`jam-mail.js`): sent right away when you're tagged, asked a question, given a jam or asked for your OK. New messages in your jams are batched: at most one email per jam every 15 minutes, never for lines you've read or a jam you have open. Every email has mute and only-tags links. Every email Brew sends uses one layout (`mail-layout.js`): logo, brand line, headline, button, small print. Tagging the ShopOS team (in chat, or Ask) emails `SHOPOS_EMAIL` (hello@joinsquareup.com), once per jam an hour; *Send brief* emails it the whole brief every time, and status changes email the sender. | Real |

Two sites, one codebase:

- **brew.joinsquareup.com:** the prototype.
- **demo.joinsquareup.com:** the same code with `DEMO_MODE=1`, a read-only showcase.

## Cut (deliberately not built)

| Cut | What went |
|-----|-----------|
| Do it now | Real actions on accounts, the action tray, the agent runner, the safety policy, programs and routines that run themselves, scheduled starts, the stop rule and auto-undo, the weekly spend limit, "Changes Brew made", undo, task trackers |
| Writing to accounts | Real API writes to a brand's accounts (connectors are read-only scopes only) |
| Brew sending | Marketing email and WhatsApp from Brew to the brand's customers, contacts, unsubscribe pages, lifecycle flows, holdouts |
| Measurement | The measuring engine, launch records, report back, A–D grades, results, the Out/Live/Result board columns, the week-by-week record, result follow-up cards |
| Fake team flow | Scripted "ShopOS team" replies (a sent brief's status is real: the ShopOS team sets it), simulated Slack posting (real since 2026-10-16, see Connectors), the studio's simulated "go live" workflow |
| Real health scoring | PageSpeed checks and the scorer (now simulated, see `DUMMY.md`) |
| Audit moves | The weekly weak-area moves. The counted scorecard stays, only as evidence for automation moves. |
| The 10-a-day free cap | It hid most cards behind the Pro card |
| Arata as code | The hand-made Arata fallback pack, its sample cards, pools, statics and work board. Arata is now an ordinary brand pack (`arata-in`). |
| The old surfaces | arata.joinsquareup.com, arata-v1, feed-demo.joinsquareup.com |

## Fixed while cutting

- **Ad and post cards reach every seat.** A card that makes an ad or a post also goes to the founder (`cards-gen.js` `fitRoles`, healed at load). Two of them hold seats near the top of the feed (`feed-service.js` feed). Every finished static is its own card, and a re-read keeps them.
- **Listening never shows a failed source as "ok".** A source that failed is an error with its reason, and one carried from an earlier read is "carried". The Heard panel names what couldn't be read.
- **Weekly moves:** one run per brand across instances (a 30-minute lock), always numbered from 1001, and "verified" only when every number is backed.
- **Fixed a pre-existing bug** where a `//` comment swallowed the demo-mode sheet's variables.

## Data

Brand data lives in `gs://brew-prototype` (demo: `gs://brew-prototype-demo`). The only brand carried over is **Arata** (`arata-in`). It was prepared with `tools/prepare-pack.mjs`, which retires the audit moves, makes automation moves plan-only, and removes `private/` and spend files. It keeps `notify.json`.
