# 06 · Decisions log

*Dated decisions that shape Brew today. Newest first.*

| Date | Decision | Why |
|---|---|---|
| 2026-10-15 | **Sign in before a read.** Reading a store needs a Google sign-in; then each person gets 3 new brands a day. Prospects without an account use the demo site. | Each read costs about $6; anonymous reads (1 per IP per hour) could use up the daily cap and block real clients |
| 2026-10-15 | **Brew's emails to the brand's team stay in scope:** invites, joins, view changes, "your moves are ready" / "updated" | Teams need them to work together. "Sending" now means only marketing email and WhatsApp to customers, which stays cut. |
| 2026-10-15 | **Public links and open read routes are acceptable for now** | Showcase only; no real account data is connected. Revisit before real brands connect accounts. |
| 2026-10-15 | **Scope cut: Brew becomes a realistic prototype** that engineering continues. The flow is read → moves → feed → jam → share the brief. | "We are not building the product, we are building a realistic prototype." The product is shaped after brands onboard. |
| 2026-10-15 | **Cut:** Do it now, real connectors, sending to customers, measurement, the scripted ShopOS team, real health scoring, audit moves, the 10-a-day free cap | See `03-what-is-simulated-and-cut.md` |
| 2026-10-15 | **Simulated pieces must be visibly marked:** a "Dummy" tag on screen, a `DUMMY:` comment in code, and a row in `DUMMY.md` | Honesty with prospects; a clear list for engineering |
| 2026-10-15 | **The jam ends with Share the brief** (with the ShopOS team, or my team). It copies the brief and a read-only link; nothing is sent. | Replaces Do it now |
| 2026-10-15 | **Weekly moves:** listening moves and automation moves (plans the team runs; Brew never runs them) | Keeps the feed fresh without acting on accounts |
| 2026-10-15 | **New repo `brew/`.** The old `feed/` is archived and must never be deployed again. | Clean cut |
| 2026-10-15 | **Domains:** the prototype moves to **brew.joinsquareup.com**, the showcase to **demo.joinsquareup.com**. feed.joinsquareup.com is discontinued; arata.*, arata-v1.* and feed-demo.* are retired. | One clear home per purpose |
| 2026-10-15 | **Arata is an ordinary brand pack** (`arata-in`), not special code | Every fix must work for every brand |
| 2026-10 (earlier) | **The product is called Brew**, never "ShopOS". A global feed that works on the brand's own stack. No payments, shipping, tax or roles management. | Naming and scope |
| 2026-10 (earlier) | **Accuracy above everything:** no invented numbers, quotes or backstory; "to confirm" when unbacked | Trust |
| 2026-10 (earlier) | **No disclaimers on ad creative** | They weaken the ad |
| 2026-10 (earlier) | **Quiet UI:** extremely simple pages | Founders scan; they don't read |
| 2026-10 (earlier) | **Stories live 24 hours** but can still become feed cards later, by rank | Freshness without losing good items |
| 2026-10 (earlier) | **Connected tools are the source of truth** for facts (members only; beat the site read; demo data never counts) | *Today this is broken: simulated data does count (see the engineering docs).* |
