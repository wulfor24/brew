# 01 · Feature catalogue

Every feature a user can see, in plain words, with an honest status.

| Badge | Meaning |
|---|---|
| ✅ **Works** | Real, and it does what it says |
| 🟡 **Works, with gaps** | Real, but it has gaps a user could notice |
| 🔴 **Broken** | Doesn't do what it says |
| 🧪 **Simulated** | Fake on purpose, and tagged "Dummy" on screen |
| ⚠️ **Simulated, not labelled** | Fake, but the screen doesn't say so. **Fix first.** |
| ✂️ **Cut** | Removed from scope on purpose, though traces may remain |

## 1. Read: "paste your URL"

| Feature | What the user gets | Status |
|---|---|---|
| Paste a URL, see Brew read it live | A "Reading {Brand}" screen that ticks through: open the store, read the brand, the catalog, reviews, ads, the site, and AI answers. About 3–4 minutes. | 🟡 If the store won't open, the screen hangs. Steps that found nothing still get a green tick. |
| Brand kit | Logo, colours, fonts and tagline | ✅ The colours can come out as the site's button colours |
| Catalog | Every product, price, pack and best seller (Shopify works best) | ✅ |
| Reviews | Review count, rating, real quotes (Judge.me, Amazon) | 🟡 The headline number adds site reviews, store reviews and Amazon ratings together |
| Rivals | Five competitors with prices and claims | 🟡 Always finds five; quality varies |
| Ads | The brand's and the rivals' live Meta ads, with posters and hooks | ✅ "Live ads" counts ad versions, so the number can jump |
| Checkout walk | Steps and timing from the home page to checkout | ✅ |
| AI answers | Whether ChatGPT, Gemini, Perplexity and Claude name the brand (Arata: 12 of 32) | ✅ |
| Socials / films | Top YouTube and Instagram posts | 🟡 Often times out; when it does, the card is simply missing |
| Company facts | Founders, founding year, funding, press, each with a source link | ✅ |
| **Check what we read** | The brand fixes the name, products, rivals and sources, then taps "Looks right, write my moves" | 🟡 Shows "Not found" when a check actually failed. Says "we will read your reviews from that page", but nothing does. |

## 2. Moves: the strategy documents

| Feature | What the user gets | Status |
|---|---|---|
| The brand brief | A long brief of what Brew knows, with every number sourced and the rest marked "to confirm" | ✅ |
| Strategy moves (01–50, plus listening-era and festival moves) | 7–10k-word documents (why, what we found, the plan, examples, how to measure), each with a PDF and two zips | 🟡 Deep and specific. **But:** none of the long moves passed Brew's own claim check (some inferences read as fact), and the counts disagree ("51", "64", "MOVE 65 OF 64"). |
| PDFs and zips | Download each move, or all of them | 🟡 3 PDFs are missing for Arata (02, 03, 25) |
| Weekly listening moves | New moves every week from what people say online | ✅ |
| Weekly automation moves | Routines written as plans the team runs. Brew never runs them. | ✅ |
| Moves update when the brand changes | A price change flags the moves that quote it; they can be rewritten | 🟡 Stuck on Arata: 38 moves flagged and not rewritten |
| "What Brew will watch" / check timings inside moves | Every move promises monitoring and early stops | ✂️ **Promises a cut feature.** Nothing monitors. |

## 3. Feed

| Feature | What the user gets | Status |
|---|---|---|
| Ranked feed of cards | About 160 cards for Arata, roughly 2 picture cards for every text card | 🟡 The order doesn't follow the value grade well, and the strongest picture assets sit low |
| Views (seats) | Founder, ads, storefront, retention and others each see their own cards | ✅ |
| Ad and post seats near the top | Two ads or posts the brand can make, in the first screen | 🟡 Sometimes filled by two ads from the same rival |
| Heard (listening) | What people say: themes with counts and mood, open questions with "reply as the brand" | 🟡 Review videos sometimes show as "questions" |
| Ideas | Ready-to-post ideas per platform (Reddit, Quora, Instagram, YouTube Shorts, X, LinkedIn) with where to post | 🟡 A run can make zero ideas without saying so |
| Stories (24 h rings) | Brand today, Trends, Popular ads, Industry news, How to | ✅ Some near-duplicates |
| Watcher cards | Price and stock changes, new products, AI-answer gaps, own-ads changes, a Creative idea | 🟡 Some buttons promise Brew will "pause / restart / tell you". The best AI-gap card can be dropped. |
| Static ads | Finished ad images made with the real product photo | ✅ Rank low in the feed |
| Margin notes | A short note on about half the cards | ✅ |
| Card page | Options, a recommendation, what happens next | ✅ |
| Heart / Not for me / Snooze | Shapes the feed; a heart makes three more in that direction | ✅ |
| Festival ideas | Diwali / Black Friday ideas | 🟡 **Dates are fixed to Nov 2026. They go stale after 27 Nov.** |
| Health rings (Creative, Storefront, AI answers) | A score out of 100 | 🧪 Simulated, tagged |
| Account cards (Shopify checkouts, Meta frequency, GA4 funnel, RTO…) | Numbers from "connected" accounts | 🧪 Simulated, tagged |
| Pro / the deck | Plan sheet, "Start the trial" | 🧪 Simulated, tagged. **The Pro button on the moves page does raise our real spend limit for that brand.** |

## 4. Jam: the studio

| Feature | What the user gets | Status |
|---|---|---|
| Open a jam on any card | A studio with the thing being made on the left and the conversation on the right | ✅ |
| Living brief | Ask AI to change it, edit it yourself, add from the card or the moves | ✅ |
| First drafts | Image, carousel, video (6 s, with voiceover), voice, text, made with the brand's real product photo | ✅ (real media wasn't re-generated for this audit; some of Arata's earlier video drafts came out as stills) |
| Versions, photos, download | Every version kept; pick from catalog photos or upload; download the version | ✅ |
| Composer | Attach a file, product photo or chat; choose Deep (Opus) or Fast; choose the image model | 🟡 "A link: Brew reads the page" doesn't read the page. The video label names the wrong model. |
| Brand memory | One shared memory per brand (71 facts for Arata), used in every jam | ✅ |
| "What your team told Brew" | Paste call notes or emails; Brew learns goals and facts, then updates the brief and moves | ✅ |
| "What Brew learned" | Lessons and rules from how the team works, editable | ✅ |
| @teammate replies | A teammate replies in the jam | 🧪 Simulated, tagged. **But the reply can mark the work "Ready", and it ends up in the brief and in memory.** |
| **"Ask everyone"** (plan questions) | Teammates answer readiness questions: legal, rights, tracking, stock, budget | ⚠️ **Simulated, not labelled.** Canned sign-offs like "Cleared…" and "Verified this morning…" appear in the shared brief. |
| Take it to WhatsApp | Opens your own WhatsApp with the brief text | ✅ |
| Take it to Slack | Copies the text, then says "Posted to #growth" | ⚠️ **Nothing is posted.** |
| Work board | Every jam, from drafting to "Brief shared" | ✅ |

## 5. Share the brief

| Feature | What the user gets | Status |
|---|---|---|
| Share with the ShopOS team / Share with my team | Copies the brief (with a BR number) and a link to a read-only page. Nothing is sent. | 🟡 The brief isn't truly frozen: later edits show on the shared page. Every workspace's first brief is "BR-1042". "My team" leaves out the read-only link. |
| Read-only brief page | The full brief, versions, assets and chat, without sign-in | ✅ |

## 6. Accounts and team

| Feature | What the user gets | Status |
|---|---|---|
| Sign in with Google | | ✅ |
| Claim your brand | The first person with a work email at the brand's domain owns it | ✅ |
| Team and invites | Invite by email with views; colleagues at the same domain join automatically | ✅ |
| **Emails from Brew to the team** | Invites, "someone joined", view changes, "your moves are ready", "moves updated" | ✅ **Real, and in scope** |
| Read-only view for everyone else | Others can look at a brand but can't generate | 🟡 |

## 7. Demo site

| Feature | What the user gets | Status |
|---|---|---|
| Brand picker | Pick a prepared brand (Arata only today) | ✅ |
| Guided tour | Read → check → feed → jam → share, in about 4 minutes | ✅ |
| Your own sandbox | Each visitor's changes stay theirs | ✅ |
| Connect accounts | One tap "connects" Shopify, Meta and others with simulated numbers | 🧪 |
| Real AI for every visitor | Drafts and jams really generate | ✅ Shared daily limits: a heavy visitor can use up the day |

## Cut, on purpose (not in the product)

**Do it now** (acting on accounts) · **real connectors** · **marketing email and WhatsApp to customers** · **measurement and grades** · **scripted ShopOS team replies** · **real health scoring** · **audit moves** · **the 10-cards-a-day free cap**. See `03-what-is-simulated-and-cut.md`.
