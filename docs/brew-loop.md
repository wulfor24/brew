# The Brew loop: from data to a better feed

Param's brief from 14 Oct 2026, cut to the prototype's scope on 15 Oct (`SCOPE.md`).

1. **Gather.** Brew reads the store, reviews and rivals, and runs a full audit (site, SEO, AI answers, social, ads, email). It also listens across the internet (Reddit, TikTok, Instagram, YouTube, X, Facebook, forums, news, review sites and marketplaces) in the background, on a cadence.
2. **Moves.** Brew writes move documents for each brand from that evidence (quant and qual) on a cadence:
   - listening moves;
   - automation moves (routines, as plans the team runs).
3. **Rank → feed.** Moves become cards, and the feed ranks them. It's a feed you look at:
   - two visual cards for every text card;
   - every card carries a ready first draft (image, video, text, or a mix), made from what Brew has learnt.
4. **Endless inspiration.** A steady stream of ready-to-post ideas for each relevant platform (Reddit, X, LinkedIn, Instagram, TikTok, YouTube Shorts, Pinterest, Quora, Facebook groups). Each comes with the communities and live threads where it fits, and a reply that follows that community's rules.
5. **Jam.** Whatever interests the brand goes to the studio. There it makes the assets and plans the strategy, flow and program, with or without the team.
6. **Share the brief.** The jam ends here: *Share with the ShopOS team* or *Share with my team* copies the brief and a link
   to the full read-only brief. Nothing is run, sent or measured from Brew in this prototype (see `SCOPE.md`).

## Listening and the ideas stream (wired)

- **Code:** `listen-watch.js` (listening), `ideas.js` (ideas), `social-feed.js` (cards, rotation, the Heard view and the background scheduler). Tests: `test/listen-ideas-wiring.test.js` (free). Real probes: `test/listen-probe.mjs`, `test/ideas-probe.mjs`.
- **Cards:** these are added when a pack loads, next to `visualize` in `brand-pack.js`, so every brand gets them with no rebuild. A brand with no listen or ideas files gets nothing.
  - Ideas: deduped by id and title, newest first, at most 12 in the feed. The 6 newest always show, and the rest rotate daily. Cards with media are visual (product photos).
  - Heard: the top 2 open questions ("Asked in r/x: … Reply as the brand", with the thread link). Also 2 theme cards with counts, sentiment and two linked quotes.
  - Cards that rotate out step back, unless someone liked, acted on or jammed them.
- **Jam:** an idea opens as its own post.
  - Families: `post` (X, LinkedIn, Reddit, Quora, Facebook groups, Pinterest, short video) or `social` (Instagram). Each has its copy and where to post.
  - The post goes out with the shared brief: its copy and where to post it. Brew never posts into communities.
- **What Brew learned:** shows *What Brew heard* (themes with counts and quotes, the questions people asked, where they talk) and *What Brew knows* (brand memory highlights).
  - Each listen run also writes the top themes and the top community into brand memory as counted, sourced lines.
- **Cadence:**
  - Listening runs every ~24 h for each built brand, on every source by default: Reddit, TikTok, Instagram, YouTube, X, Threads, LinkedIn, Pinterest, Facebook comments, Telegram (known channels), Amazon, Walmart (US), Trustpilot, Google reviews (brands with stores), Nykaa, Flipkart and Myntra (brands sold in India), site reviews, news and web forums. It reads the brand, its rivals, the category and the brand's own accounts. `LISTEN_PAID=0` keeps it to free sources.
  - Two modes: *heard* (said without being asked) and *asked* (replies to questions the brand posted for a research move). `POST /api/brands/:slug/heard/asked` registers a thread; its replies are re-read 1, 3, 7 and 14 days after posting, alongside listening.
  - Each run writes a small daily summary to `listen/history/<date>.json` (counts by source and mode, top themes), read by `GET /api/brands/:slug/heard/history`. Every quote, filterable by source, mode and theme: `GET /api/brands/:slug/heard/items`.
  - Ideas (`next({ n: 6 })`) run at most once a day, and only for brands someone opened in the last 3 days.
  - The scheduler checks every 30 minutes and runs at most 3 brands per tick.
- **Caps and switches:**
  - Spending caps: `LISTEN_RUN_CAP_USD` (default $0.60 per listen run) and `SOCIAL_DAY_CAP_USD` (default $2 per brand per day).
  - Indian marketplaces use Apify when `APIFY_TOKEN` is set, and a page read otherwise.
  - Switches: `LISTEN_OFF=1`, `IDEAS_OFF=1`, and `SOCIAL_CARDS=0` (hides the cards).
  - Nothing runs under `AI_MOCK`, or on local servers (`RESEARCH_OFF`/`LIVE_OFF`) unless `SOCIAL_BG=1`.
  - State is kept per brand in `social/state.json`.

## Moves on a cadence and first drafts (wired)

- **Code:** `moves-cadence.js` (the counted scorecard, listening and automation moves, the weekly scheduler and routes), `drafts-bg.js` (first drafts on the top cards). Tests: `test/moves-cadence.test.js` (free). Real probe: `test/cadence-probe.mjs`.
- **Scorecard:** a counted scorecard (no AI) of what the read found per area, every part with its source (`audit/scorecard.json`). It is evidence for automation moves; there are no audit moves.
- **Listening:** 2 to 4 moves from `listen/*.json`, using counts, sentiment and trend plus real quotes with links. A brand that has heard nothing gets no listening moves.
- **Automation:** 2 to 4 routines (reply sweep, creative refresh, review ask, win-back, back-in-stock and more), each as a plan (steps, owner, repeat) the team runs from the brief, with how it would be measured. Brew never runs them.
- **Shape:** the same shape as the build moves, so the Moves tab, the move page, the PDF and cards-gen read them as they are. Each move carries `family`.
  - Numbers start at 1001 and are never reused.
  - Every finding cites evidence ids, and a finding with no valid citation is dropped. Numbers are checked against the cited evidence and the ledger, and any number that is not backed is marked "to confirm".
  - A family's new run retires its last run: the documents move to `moves/history/` and the cards leave the feed.
- **Cards:** made by cards-gen and tagged with the family: `src` "Move 1001 · Listening · …", a badge such as "Listening move", and `moveFamily`. They join `seed.posts` and are ranked with the rest.
- **Cadence:** weekly for each built brand, one run per brand at a time (a 30-minute lock across instances). The scheduler checks hourly and runs at most 2 brands per tick.
  - Cap: `MOVES_WEEK_CAP_USD` (default $3 per brand per week). Kill switch: `MOVES_REFRESH_OFF=1`.
  - Nothing runs under `AI_MOCK`. On local servers it is off unless `MOVES_BG=1`.
  - `POST /api/brands/:slug/moves/refresh { families? }` runs it by hand. On a claimed brand only the team can call it. `GET …/moves/cadence` returns the state and the scorecard.
  - A probe cost about $0.30 to $0.40 per brand (Sonnet, cards included).
- **First drafts:** for brands opened in the last 3 days, Brew makes drafts for the top ~6 cards that have none. It uses the jam's own draft prompt and brand memory.
  - Format: an image (the product photo in a new scene) or text. Never video or carousels.
  - Drafts are cached in `drafts/cards.json`, keyed by card id and title. The jam opens with the draft already in its drafts.
  - Cap: `DRAFTS_DAY_CAP_USD` (default $1.50 per brand per day). Kill switch: `DRAFTS_BG_OFF=1`. Off under `AI_MOCK`/local unless `DRAFTS_BG=1`.
