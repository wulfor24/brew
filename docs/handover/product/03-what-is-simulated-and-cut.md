# 03 · What is simulated, and what was cut

## The principle

Brew shows what we can do with a brand's **public** presence for real, and **simulates** what would need the brand's **private accounts**. Simulated things carry a dashed **Dummy** tag on screen. Nothing touches a brand's accounts.

## Simulated (tagged Dummy)

| What | What the user sees | What's really behind it | To make it real |
|---|---|---|---|
| **Connected accounts**: Shopify, Meta Ads, Google Analytics, Google Ads, Klaviyo, Judge.me, Slack, marketplaces | One tap connects. Numbers, "what changed", and account cards (checkouts left, RTO, ad frequency, funnel) | Numbers built from the brand's public read, the same for everyone who views that brand | Sign-in with each platform, secure token storage, daily syncs, and each platform's approval (Meta, Shopify, Google). Weeks per platform. |
| **Health rings**: Creative, Storefront, AI answers | A score out of 100 | Steady per-brand scores, nudged by a few real facts | A real scorer per ring, with sources |
| **Pro plan** | Plan sheet, "Start the trial" | Switches Pro on in the browser. No billing. Every card is shown anyway. **The Pro button on the moves page also raises our real spend limit for that brand.** | Billing, if we want plans |
| **Teammate replies** (@name) | A teammate answers in the jam | AI writes the reply in character from their role | A Slack app or email that brings real replies back |
| **The demo site** | A full brand to explore | A sandbox per visitor | Nothing; it's a showcase |

## Simulated but **not** tagged: fix first

| What | Problem |
|---|---|
| **"Ask everyone" answers** | Invented sign-offs ("Cleared. Every claim on it is one our site already makes.", "review quotes are used with consent", "Verified this morning. Meta purchases match Shopify orders.") go into the **brief that gets shared** |
| **Simulated approvals** | A fake teammate's "approve" moves the work to "Ready" |
| **"Posted to #growth"** | Nothing is posted to Slack |
| **Simulated account numbers inside briefs and moves** | They are quoted as real numbers |

Engineering has all four as top priority (`../engineering/11-known-issues-and-debt.md` P0).

## Cut on purpose (2026-10-15)

| Cut | What it was | Why it was cut | Traces still visible |
|---|---|---|---|
| **Do it now** | Brew acting on the brand's accounts: launching ads, changing the site, running routines, undo, a weekly spend limit | We're building a showcase, not the product. Acting on accounts needs real connectors, safety and trust. | Copy like "do it", "Shift budget", "Approve", and "we pause / restart" on some cards and the landing hero |
| **Real connectors** | OAuth, token vault, syncs | Same reason; simulated instead | |
| **Brew sending to customers** | Marketing email and WhatsApp from Brew, contacts, unsubscribe pages, lifecycle flows | Same reason | |
| **Measurement** | Launch records, readings, A–D grades, results | Needs real accounts | Every move still has "What Brew will watch" and "Check timings"; cards have "Measure" lines |
| **Scripted ShopOS team** | Fake ShopOS team replies, ticket delivery, Slack posting | Felt fake | Some old routes and copy |
| **Real health scoring** | PageSpeed and checkout scoring | Scores were unreliable (payments 0/10 for every brand; SEO 100 when nothing was read) | Now simulated |
| **Audit moves** | Weekly "weak area" moves | Overlapped other moves | Their scorecard is kept as evidence for automation moves |
| **10-cards-a-day free cap** | It hid most cards behind Pro | Hurt the showcase | |
| **Old surfaces** | arata.joinsquareup.com, arata-v1, feed-demo, feed.joinsquareup.com | Replaced by brew. and demo. | |

## Kept in scope

**Brew's own emails to the brand's team** stay real: invites, "someone joined", view changes, "your moves are ready" and "moves updated". (Decided 2026-10-15.)
