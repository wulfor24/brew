# Brew: Product handover (start here)

*State as of **2026-10-15**. Live: https://brew.joinsquareup.com (the prototype) and https://demo.joinsquareup.com (the showcase).*

## What Brew is

> **Your store's marketing team, in one feed.** *(landing page)*

A brand pastes its website. Brew reads the store, its reviews, its ads, its rivals and what AI assistants say about it. It then writes a full set of strategy **moves** and turns them into a **feed** of ideas, one card each. On any card the team **jams** with AI (and with each other) until the work is ready, then **shares the brief** with the ShopOS team or their own team.

**Read → Moves → Feed → Jam → Share the brief.**

![Landing page](img/1-landing.jpg)

## What it is for right now

Brew is a **realistic prototype, used as a showcase.** Its job today is to show a prospective brand what we do best, and what working with us will look like, using their own real data.

The product itself will be shaped **after brands onboard**. So:

- Everything a brand sees about **its public presence is real**: the read, the moves, the ideas, the drafts.
- Everything that would need **its private accounts is simulated** and tagged **Dummy**: Shopify, Meta Ads, Google, Klaviyo, Slack, the health scores and the Pro plan.
- Nothing is done *to* the brand's accounts. Brew doesn't post, spend, send or change anything. The jam ends with a brief that people act on.

## Who it's for

- **Prospect brands** (online D2C stores, any market; the one prepared brand is Indian): founders and their marketing, ads, storefront and retention people. Each person picks a **view** (seat) and sees the cards for their job.
- **The ShopOS / SquareUp team**: they run demos, read what Brew found, and pick up the briefs brands share.

## The two sites

| Site | What it is | Who uses it |
|---|---|---|
| **brew.joinsquareup.com** | The prototype. Paste any URL and get a real read. Sign in with Google to see the feed and get the moves written. | Design partners, our team |
| **demo.joinsquareup.com** | The same product as a hands-on showcase. Each visitor gets their own sandbox of a prepared brand (today only **Arata**), with simulated accounts and a guided tour. | Prospects in sales conversations |

## Where we are (the honest version)

- **The whole loop works, with real AI and real data, but it has been proven on one brand.** Arata is the only brand prepared on the sites. Earlier versions read other brands, but this repo hasn't been re-proven on them.
- **It is rich.** Arata has 71 strategy documents, about 160 feed cards, 1,207 listened-to mentions, live stories, first drafts (images, carousels, video, voice) and brand memory.
- **It still has things a prospect could take at face value that aren't true.** The most important: simulated teammates "sign off" on legal and tracking inside the brief, and some buttons and copy promise actions Brew doesn't take. See `05-known-limitations.md`. Engineering has these as their top priority.
- **It costs money to run.** About $6 per read, and about $100–150 to write a brand's full set of moves. There is ongoing background spend for listening, stories and drafts.

## Docs in this pack

| # | Doc | Read it for |
|---|---|---|
| 01 | `01-feature-catalogue.md` | every feature, in plain words, with an honest status |
| 02 | `02-user-journeys.md` | how a brand moves through Brew, screen by screen |
| 03 | `03-what-is-simulated-and-cut.md` | what's fake, what was cut and why, and what it takes to make it real |
| 04 | `04-content-and-accuracy-rules.md` | the rules Brew's writing must follow |
| 05 | `05-known-limitations.md` | what to watch for and what not to claim |
| 06 | `06-decisions-log.md` | what was decided, and when |
| 07 | `07-open-questions-and-next-steps.md` | the decisions product owns next |
| 08 | `08-demo-guide.md` | how to run a great demo |
| 09 | `09-glossary.md` | the words we use |

The engineering view, with the full evidence, is in `../engineering/`.
