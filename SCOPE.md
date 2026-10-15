# Brew prototype: scope

Brew is a **realistic prototype** that the engineering team picks up and continues. It is not the product.

## The one flow

**Read → Moves → Feed → Jam → Share the brief.**

| Step | What happens | Real or dummy |
|------|--------------|---------------|
| **Read** | Paste a URL. Brew reads the store, catalog, reviews, ads (Meta Ad Library), SEO, AI answers, socials and rivals, live on screen, then "Check what we read". | Real: crawl, treg, Claude |
| **Moves** | 51 strategy moves with PDFs and zips, rewritten when the brand changes. Weekly **listening moves**, from real online talk. Weekly **automation moves**, as plans the team runs from the brief; Brew never runs them. | Real |
| **Feed** | Ranked cards from the moves, plus ideas, Heard, stories, watcher cards and margin notes. Ad and social-post cards hold two seats in the first screen. | Real |
| **Connectors** | Connect sheet and connector cards. | **Dummy**: see `DUMMY.md` |
| **Health rings** | Store health score. | **Dummy** |
| **Pro plan** | Plan sheet; no daily card cap. | **Dummy** |
| **Jam** | Studio: canvas, chat, first drafts (image, text, video, voice, carousel), versions, photos, download, composer, brand memory and learnings. | Real (teammate replies are Dummy) |
| **Share the brief** | *Share with the ShopOS team* or *Share with my team*. Both freeze the brief (BR-n) and copy it with a link to the full read-only brief. The work board ends at "Brief shared". | Real (copy only, nothing sent) |
| **Accounts** | Google sign-in, claim with a work email, team and invites, a read-only view for everyone else. | Real |
| **Brew's emails to the team** | Sent through Resend from hello@send.joinsquareup.com: invites, "someone joined", view and owner changes (`auth.js` `mail`), and "your moves are ready" / "moves updated" to the people waiting on a read (`build.js` `notify`, list in `notify.json`). The demo site blocks them. | Real |

Two sites, one codebase:

- **brew.joinsquareup.com:** the prototype.
- **demo.joinsquareup.com:** the same code with `DEMO_MODE=1`, a read-only showcase.

## Cut (deliberately not built)

| Cut | What went |
|-----|-----------|
| Do it now | Real actions on accounts, the action tray, the agent runner, the safety policy, programs and routines that run themselves, scheduled starts, the stop rule and auto-undo, the weekly spend limit, "Changes Brew made", undo, task trackers |
| Real connector code | OAuth, the token vault, account syncs, real API writes, member-only live cards from real accounts, member-only move rewrites from account data |
| Brew sending | Marketing email and WhatsApp from Brew to the brand's customers, contacts, unsubscribe pages, lifecycle flows, holdouts |
| Measurement | The measuring engine, launch records, report back, A–D grades, results, the Out/Live/Result board columns, the week-by-week record, result follow-up cards |
| Fake team flow | Scripted "ShopOS team" replies, ticket delivery, posting to Slack, the studio's simulated "go live" workflow |
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
