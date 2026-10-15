# Audit A: The Read (paste a URL → profile / ledger / findings → "Reading {Brand}" → "Check what we read")

Repo: `/Users/param/Documents/ChatGPT/brew` · audited 2026-10-15 · read-only. No paid calls: no live reads, builds or heals were started.
Live checks were GET-only: `/api/brands/arata-in/status` and `/findings` on brew.joinsquareup.com and demo.joinsquareup.com, plus `/api/demo/brands`.
`GET /api/brands/:slug/check` was **deliberately not called**, because it fires `heal()`, which can make paid calls (see R3).
Local tests were run with `AI_MOCK=1`: 9 read-related files, 44 passed, 0 failed, 1 skipped (the live treg catalog probe).

---

## 0. Headline verdict

The read is real and fairly careful. It crawls the store, uses Shopify, WooCommerce or JSON-LD for the catalog, reads review-app public feeds, gets Ad Library ads through treg with a free headless fallback, walks the checkout headless, asks ChatGPT, Gemini, Perplexity and Claude through treg and Anthropic, and runs Claude web search for rivals and company facts. It writes a ledger where each row has a source and a method. For a prototype the engineering is solid.

Treat these as caveats:

- **It has been proven on one brand that is still in the data.** Only `arata-in` exists locally and on both live sites. The "works for any brand" claim rests on history from the archived `feed/` repo, not on anything you can rerun here.
- **No reader stage has a unit test.** The stages are open, brand, catalog, reviews, ads, findRivals, site, answers, socials and company. Tests cover only the orchestration around them: retry and heal, the Ad Library fallback, the treg cache, the build pipeline and the onboarding replay.
- Several places break the repo's own rule that an error is never shown as "none" (§6).
- Provenance in the ledger is sometimes wrong (§6), and some summed numbers mix different metrics.
- It is scraping, not integration. Judge.me, Yotpo, Okendo and Stamped are read through unofficial public widget endpoints, Facebook Ad Library HTML is parsed out of the page, and Amazon review text is regex-parsed from rendered text. Expect breakage.
- Anyone on the internet can start a paid read without signing in, one new brand per IP per hour. The confirm step and the moves need sign-in.

---

## 1. Data flow (text diagram)

```
Browser landing (public/app.js start())
  └─ POST /api/brands {url}            server.js:464  (anon allowed; fresh re-read needs sign-in)
       └─ builder.start(url)            build.js:110   blocked()? per-user 3/day | per-IP 1/hr | DAILY_BUILD_CAP_USD
            ├─ writes skeleton seed/facts/config + status.json {state:'Reading the site'}
            └─ resume(slug) → run(slug)  build.js:180  (AsyncLocalStorage charges every ai/treg $ to the slug)
                 1. read  ── reader.read(url,{fresh,onEvent→emit(slug,{type:'reader',ev})})   reader/index.js:78
                 │     open ──► state.home (fails = whole read stops, storeOpened() false → status.unreadable)
                 │       ├─ brand    (logo, colours, fonts, tagline)                      [free]
                 │       ├─ catalog  (products.json / WC Store API / JSON-LD)             [free; treg render fallback]
                 │       │     ├─ reviews (review app feed, JSON-LD, Amazon via treg)
                 │       │     ├─ site    (tech sniff + puppeteer walk to checkout entry)  [free, local Chromium]
                 │       │     └─ category (Sonnet classify → category, 3 SERP queries, one-liner)
                 │       │           ├─ rivals (treg SERP ×3 + Claude web search + fallbacks + rival crawl)
                 │       │           │     └─ ads (Ad Library own + ≤5 rivals; treg → free headless fallback)
                 │       │           ├─ answers (Sonnet 8 questions → 4 tools × 8 = 32 answers)
                 │       │           └─ company (Claude web search, URL must be in returned results)
                 │       └─ socials (links; YouTube API or treg; IG treg) → "Films" card
                 │     → {profile, ledger[], findings{steps,cards}, opened}
                 │     normalizeProfile → packs.put profile.json / ledger.json / findings.json
                 ├─ publishBase(): seed.json (seedFromProfile + DUMMY health), facts.json (observed ledger rows), config.json
                 ├─ instantCards() (cards-gen fromRead)
                 2. confirm ── waits for POST /api/brands/:slug/confirm (15 min timeout, or forever for anon reads)
                 3. brief → 4. 51 moves … (out of scope)

Onboarding screen (app.js setup(), line 383)
  └─ EventSource /api/tenants/:id/onboarding → feed-service.js onboardingStream
        generated brand → liveOnboarding → followRead(builder.subscribe) maps reader events to v1 shape
        demo site tour  → liveReadOnboarding → builder.readLive() (a fresh live read, paid parts cached)
        no reader events in memory (restart / cached read) → replays seed.steps + seed.scrape
"Check what we read" (app.js checkRead, line 439)
  GET  /api/brands/:slug/check   → builder.checkData()  (also fires heal() in background!)
  POST /api/brands/:slug/check   → builder.applyCheck() (add product/rival links: live fetch, ad page lookup)
  POST /api/brands/:slug/confirm {v2} → applyCheck + markConfirmed → wakes the build
Later: heal() on feed open (server.js:452) and on GET /check; weekly checkUpdates() → full fresh re-read + mergeProfile/mergeLedger
```

Storage: local `.brands/<slug>/` is written through to `gs://brew-prototype/brands/<slug>/` (brand-pack.js:104). Raw fetches and paid answers go to `raw/<YYYY-MM-DD>/`. Assets are served at `/b/<slug>/a/<file>`.

---

## 2. Feature-by-feature

Status key: **Working**, **Partial**, **Broken**, **Dummy**, **Cut-but-code-remains**, **Untested**. "Untested" means no automated test; a feature can be both Working (seen in live data) and Untested.

### 2.1 Orchestrator: `createReader().read()` (reader/index.js:78–153)

- **What it does.** Runs the stages with a dependency graph and a deadline per stage (`LIMIT`, line 31: ads 240 s, answers 170 s, company 150 s, socials 120 s and so on). Each stage gets one retry, except `open`. It streams step and finding events, collects errors and timings, and records the $ spent on treg and AI.
- **Status.** Working. Covered only indirectly by `test/reader-retry.test.js` (heal and answersFailed) and the build tests, which use a stub reader.
- **Evidence.** Live arata findings show all 7 steps done. The local profile meta reads `ms 210396`, `usd {treg 0.14, ai 6.20}`, `errors {socials: 'socials timed out after 120s'}`.
- **Bugs and risks:**
  - **A timed-out stage keeps running ("zombie").** `guard` blocks only tick, finding and done (index.js:109–111). `ledger.add` and the profile writes from the timed-out attempt keep going, and the retry runs at the same time. Two attempts can then write the same profile fields, and late writes can land after `finish()` has returned and the profile was saved. They then show up in memory but not on disk, or not at all. The `site` stage's zombie keeps its Chromium alive until it finishes.
  - **The read cannot be cancelled.** `run()` in build.js:193 never passes an AbortSignal, and cancel.json is checked only before stages. A read that has started always finishes and spends its money.
  - When `open` fails, every other step is marked "skipped: the store did not open". That is correct.
- **Cost and latency.** About 3.5 minutes and about $6.3 for Arata, almost all of it Claude: 8 web-search answers, company research, rivals and classification. The treg part was $0.14, partly served from cache.
- **For production.** A job queue with real cancellation (an AbortSignal passed into every fetch and treg call). A per-read budget check during the read. Stage isolation, so a timed-out attempt is really killed. Structured tracing.

### 2.2 Caches: per-brand raw cache + treg 24 h cache

- **What they do.**
  - `services()` (index.js:38–76) caches treg and Claude answers in `raw/<today>/treg|ai/*.json`, keyed by the request hash, for the same calendar day.
  - The fetcher (util.js:82–109) caches 2xx and 404 HTML and JSON per day.
  - `treg.js` adds a GCS cache shared across brands and instances for 24 h (`TREG_CACHE_HOURS`). Generation and polling are excluded (`NO_CACHE`).
- **Status.** Working. `test/treg-cache.test.js` has 4 tests and passes.
- **Bugs and risks:**
  - **The raw cache is read from local disk only.** `build.js:152` `loadRaw` uses `fs.existsSync(path.join(packs.dirOf…))`, even though `saveRaw` writes to GCS as well. On Cloud Run, every deploy or restart empties the disk. A read that resumes after a restart therefore **pays Claude again**; treg still hits its own GCS cache.
  - Every raw page and paid answer is uploaded to GCS under `brands/<slug>/raw/<date>/`, and nothing ever cleans it up.
  - The `treg-cache` test fails if `TREG_OFF=1` is set (as in the README's server command). Run the tests with `AI_MOCK=1` only.
- **For production.** One cache layer with a TTL policy per source, and a lifecycle rule on `raw/`.

### 2.3 Stage `open` (reader/stages/open.js)

- **What it does.** Fetches the home page. If the page looks blocked, it falls back to treg `litescrape.web.fetch.post` (a browser render). It then detects the platform (Shopify, WooCommerce, BigCommerce, Magento, SFCC, Wix, Squarespace, otherwise custom), reads Shopify `/meta.json` (currency, country, city, ships_to), and handles a market redirect (`/en-in` → home market). It reads robots.txt, sitemaps (2 levels, at most 25 children), key pages (about, faq, contact, shipping, returns), the free-shipping line and the return window. It votes on country, currency and locale from signals and records confidence. It reads the legal entity and Indian CIN from the footer and summarises the About page with Sonnet (free fallback: the first sentences).
- **Status.** Working on Shopify (Arata live: "179 pages, 25 sitemaps, 5 key pages"). Other platforms are **untested**, and there is no fixture test.
- **Risks:**
  - The name heuristic (og:site_name, otherwise the shortest title segment) can pick a wrong segment.
  - The country vote counts the Shopify meta signals twice on purpose (lines 150–151). That inflates confidence.
  - `looksBlocked` is a heuristic: under 2000 chars, or a captcha word with under 1500 chars of text.
  - The return-days regex can pick up unrelated numbers.
- **Cost.** Free. A render is one treg call (only when blocked) and the About summary is one Sonnet call.

### 2.4 Stage `brand` (stages/brand.js)

- **What it does.** Logo: a header `<img>` with "logo", then JSON-LD Organization.logo, then an inline SVG, then the touch icon, then og:image (labelled "a share image, not a clean logo"). Colours: the top 3 by count in up to 6 same-site stylesheets plus inline CSS, with greys removed and near-duplicates merged. Fonts come from theme CSS variables, h1 and body selectors, @font-face and Google Fonts. The tagline is the h1, otherwise the first sentence of the meta description.
- **Status.** Working on Arata ("1 logo, 3 colours, Geist"). Untested.
- **Risks.**
  - Colours ranked by CSS frequency often pick UI or app colours (the Arata colours `#82b1ff` and `#3b82f6` look like Tailwind blue, not obviously brand colours).
  - The h1 tagline can be a promo headline.
  - The ledger marks colours "inferred" with low or medium confidence. That is honest.
- **Cost.** Free.

### 2.5 Stage `catalog` (stages/catalog.js)

- **What it does.**
  - Shopify: `products.json` (up to 12 pages × 250, with `&country=` for the home market) and `collections.json`.
  - WooCommerce: Store API.
  - Anything else: JSON-LD on up to 30 sitemap product pages, with a treg render fallback.
  - Filters out gift cards and similar. Flags packs by regex, picks claim lines by regex, reads stock, MRP and published date.
  - Hero order comes from a best-seller collection, otherwise `/collections/all?sort_by=best-selling`, otherwise catalog order.
  - Downloads up to 8 packshots. Writes every price and MRP to the ledger (up to 400 products).
- **Status.** Working on Shopify (78 products, 52 collections). WooCommerce and JSON-LD paths are **untested**. On non-Shopify sites the count covers only the pages read, and the code says so ("N product pages, M read").
- **Risks.**
  - `catalog.newest` is labelled with method `products.json` even on the JSON-LD path.
  - Pack and claim detection are English-only regexes.
  - A Shopify store with `products.json` disabled (some headless stores) is treated as "no products found" unless JSON-LD exists. It does fall through to JSON-LD, because `products.length` is 0.
- **Cost.** Free, plus treg renders for JS-only product pages, up to 30 calls.

### 2.6 Stage `reviews` (stages/reviews.js)

- **What it does.**
  - Detects the review app in the page source.
  - Reads its public feed:
    - Judge.me `all_reviews_js_based` (3 pages, counts product and store reviews, flags imported reviews)
    - Yotpo widget API (site and hero products)
    - Okendo aggregate and reviews
    - Stamped widget
    - Loox (counts from `data-raters` on the pages it read: a floor)
    - Reviews.io
  - Reads JSON-LD ratings on the hero pages.
  - Amazon: treg `crawl4ai.amazon.search.products` for the brand name. On amazon.com, review text comes from `crawl4ai.amazon.product.reviews`. On other domains, a litescrape render of `/dp/` is parsed with a big regex.
  - Picks 3 real quotes: a result, praise, and a complaint if there is one.
- **Status:** Partial.
  - **Working:** Judge.me and Amazon.in. Arata live shows "51,419 Judge.me product reviews · 9 store · 27,925 amazon.in ratings on 44 listings".
  - **Untested:** the other review apps.
  - **Not built:** Flipkart and Nykaa. The read adds the note "Flipkart and Nykaa ratings not read yet". Apify is used for these only in listening, not in the read.
- **Bugs and risks:**
  - **`reviews.total` adds different metrics together.** It sums Judge.me product reviews, Judge.me store reviews and Amazon *ratings* (first search page only) into "79,353 reviews and ratings". The step line and the check page both show this sum. The ledger note keeps the breakdown, but the headline number is not one metric.
  - All the review-app endpoints are undocumented public widget APIs, so they will break silently.
  - When an app is detected but its feed fails, the code falls back to a JSON-LD floor and labels it as a floor. That is correct.
  - The Amazon name match (a regex on the first 60 characters of the title) can include resellers, or brands with a similar name.
- **Cost.** Free for review apps. Amazon is about 2–3 treg calls.

### 2.7 Category, one-liner, search terms (`inferCategory`, `writeLine` in stages/answers.js:15–49)

- **What it does.** One Sonnet call returns the category, subcategory, confidence, the one-line "what you are" and 3 shopper queries. The one-liner is ledgered as inferred with method `claude:classify`. The free fallback is the most common product type.
- **Status.** Working. Arata: "Hair care / Hair fall and scalp care shampoos and serums" and "Science-led shampoos and serums for Indian hair and scalp". Untested.
- **Risk.** Everything downstream (rivals, SERP, AI questions) depends on these 3 queries. If this call fails, rivals fall back to Claude only, and SERP is skipped.

### 2.8 Rivals (`findRivals`, stages/ads.js:16–87)

- **What it does.**
  - Runs treg `crawl4ai.google.serp.organic` for 3 category queries. It ledgers the brand's own rank ("not in top 20") and counts how often other domains appear.
  - Asks Claude with web search (`search: 4`) for up to 6 rivals, with one retry. A rival counts as "sourced" when its source URL is among the returned results.
  - Merges the two and keeps the top 5. Crawls each rival (home page plus `products.json`, or JSON-LD on 1–2 pages) for prices, claims, offers and a guarantee line.
  - When fewer than 3 rivals are found, it tries in turn: Claude "alternatives", Ad Library advertisers on the category query, then **Claude with no web search** ("suggested by AI, store read live"). A candidate is kept only if its store could be read.
- **Status:** Partial.
  - It works in the sense that a brand always gets rivals.
  - Quality is uneven. Arata's rivals are Minimalist (mostly skincare), Traya, Mamaearth, The Derma Co and Dr Sheth's.
  - All five are `how: 'web search'`, none "(cited)". The cross-check against citations matched nothing.
  - Untested.
- **Bugs:**
  - **Provenance gets overwritten.** ads.js:86 re-adds every rival's `rival.<host>.found` ledger row with `method: r.how.includes('web search') ? 'claude:web_search' : 'treg:crawl4ai.google.serp.organic'`. So rivals that came from "Ad Library (category search)" or "suggested by AI" are stamped as **found by Google SERP**. That is false provenance.
  - The last fallback is Claude's memory (`search: 0`). The only safeguard is that the store must load, so the brand could still be wrong for the market.
  - `NOT_BRANDS` is a hand-written blocklist of marketplaces and media, heavily India-flavoured.
- **Cost.** 3 SERP calls on treg, plus 1–4 Sonnet calls with web search, plus up to about 13 rival-store fetches.

### 2.9 Ads (`ads`, stages/ads.js:126–212; `reader/adlib.js`)

- **What it does.**
  - For the brand and each rival, gets live Meta ads. It uses treg `scrapecreators.x.v1-facebook-adlibrary-company-ads` through `adCall()`. If treg fails or is off, it falls back to a **free headless Ad Library page reader** that parses `search_results_connection` out of the page HTML.
  - The page match is a squashed-name prefix with a tail of at most 2 characters.
  - Other fallbacks:
    - if the name finds nothing, search ads by the brand's domain, then read that page by id;
    - for the brand's own page only, try alternative names;
    - for the brand's own page only, look in all countries.
  - Downloads posters: 3 for the brand, 2 per rival. Works out the hook, body, CTA, days live and versions.
  - Errors are kept per target (`error`), and the "What rivals run" card says "couldn't be read this time" instead of "none".
  - `ADS_V = 3` drives heal.
- **Status.** Working. Arata live: own page "Arata" 664 live, and 5 rivals with 4,499 live ads (demo site: 4,346, which is an older heal). `test/adlib-fallback.test.js` (3 tests) covers only the fallback routing. The page parser and the matcher are **untested**.
- **Bugs and risks:**
  - **Dead fallback.** ads.js:174 tries `profile.socials?.facebook?.handle`, but socials.js never sets `facebook.handle` (only `instagram.handle`). On top of that, socials runs at the same time as ads, so it may not have finished.
  - **Provenance.** The ledger row `ads.own.live` and the rival rows always say `method: 'treg:scrapecreators…'`, even when the free page reader supplied the data (ads.js:184).
  - **Counts.** "Live" is sometimes the Ad Library's `searchResultsCount` for a query and sometimes only the matched rows. The ledger note says which, but the UI shows one number.
  - **Fragility.** The free reader depends on Facebook's page HTML. It throws on captcha and allows at most 2 concurrent Chromium pages. Facebook can change the page at any time.
  - A name-prefix match can attach a different page with a similar name ("Arata" vs "Aratax…").
- **Cost.** About 6–15 treg calls (cached 24 h). The fallback is free but heavy (Chromium).
- **For production.** The official Meta Ad Library API (it needs identity verification, and it does not return commercial ads outside the EU and political ads), or a contracted data vendor. Store the page id the brand confirms on the check page, and stop re-matching by name.

### 2.10 Stage `site`: tech sniff + headless checkout walk (stages/site.js)

- **What it does.**
  - Uses regexes to detect Klaviyo, Meta pixel, GA4, GTM, TikTok, Hotjar and others, plus subscription apps, chat tools and checkout apps (GoKwik, Shopflo…).
  - With puppeteer-core and the local Chromium (Dockerfile installs `chromium`), it walks home → hero product page → **clicks add to cart on the real store** → cart → checkout entry. Navigational POSTs are blocked except `/cart/add|change|update`.
  - If the checkout button doesn't render headless (one-click apps), it opens `/checkout` directly and says so.
  - Records payments seen, guest checkout (sometimes inferred), OTP and popups. Timings come from one headless run and are labelled `conf: low`.
- **Status (2026-10-16, SITE_V 2).** Working on Shopify, one-click apps and WooCommerce:
  - Waits for the network to settle and keeps looking for late checkout buttons (15 s). App buttons (GoKwik, Shopflo, Razorpay Magic, Fastrr) are in the selector list.
  - A checkout app that opens an iframe or modal over the cart counts as reached, and only the app's own text is read (Gullylabs: Razorpay Magic, "asks for a phone number first").
  - "Checkout entry" is ok only when the page or frame really is a checkout. `/checkout` sent back home or to the cart is a failure with the reason (the old walk marked Arata ok while it sat on the home page).
  - If the desktop walk falls short, it walks again as a phone, in its own cookie jar.
  - WooCommerce add-to-cart posts to the product page; that POST is now allowed.
  - No in-stock product: no crash, "no in-stock product to walk with".
  - Payments not on the entry page say where they show ("after the phone step", "after the address step"), and a walk that never reached checkout says "not checked", never "none".
  - `heal()` re-walks any saved read with an older `SITE_V` or a walk that never reached checkout.
- **Known limit.** GoKwik's SDK fails to initialise in headless Chrome (`[gokwik-sdk] init failed`), so GoKwik stores fall back to Shopify's own checkout, with a note that shoppers may see GoKwik instead.
- Each read, re-read and demo tour still adds an item to the real store's cart and opens its checkout.
- **Tests.** test/site-walk.test.js (local stores: plain, late app iframe, bounce, no product).
- **Cost.** Free (CPU and Chromium, about 26 s).

### 2.11 Stage `answers`: AI answers (stages/answers.js:51–99)

- **What it does.** Sonnet writes 8 shopper questions (5 unbranded, 3 branded). Each is asked to:
  - ChatGPT and Gemini through treg DataForSEO `ai-optimization-*-llm-scraper-live-advanced`, with a location code;
  - Perplexity through `…perplexity-llm-responses-live` (sonar);
  - Claude Sonnet with web search (`search: 3`).

  That is 32 jobs with a concurrency of 16. For each answer it records whether the brand is named, whether it cites the brand's domain, the rivals named, the entities and the sources. The score (`named/of`, unbranded named) goes to the ledger.
- **Status.** Working. Arata: 12 of 32 named, **0 of 20 unbranded**. Heal re-asks when this step failed (`answersFailed`). `test/reader-retry.test.js` covers the heal path only.
- **Risks:**
  - Named-detection is a word-boundary regex on the brand name. Short or common-word brand names will give false positives.
  - The ledger row `ai.named.of` has `url: null`, so there is no per-answer citation URL in the fact sheet.
  - ChatGPT and Gemini are "consumer answer" scrapes through DataForSEO, not the official APIs.
- **Cost.** 24 treg calls plus 8 Claude web-search calls plus 1 Sonnet call. This is likely the largest share of the about $6 per read.

### 2.12 Socials and "Films" (stages/socials.js)

- **What it does.** Pulls social links from the home page. For YouTube, the top videos come from the YouTube Data API (`YOUTUBE_API_KEY`) or from treg `crawl4ai.youtube.channel.videos`. Instagram's last 12 posts come from treg `crawl4ai.instagram.user.posts`. The "Films" card shows the most-watched video or the most-liked post.
- **Status:** Partial. On Arata the step **timed out after 120 s** (`meta.errors.socials`), the Instagram call failed with a treg 502, and the saved findings have **no Films card**. Untested.
- **Risks.**
  - It is not a visible step (`step:false`), so a failure is only visible in `profile.meta.errors`.
  - Socials is not part of `heal()`.
  - SPEC.md lists `treg.instagram.user.posts`, but the code uses `crawl4ai.instagram.user.posts`.
- **Cost.** 1–2 treg calls. The YouTube API is free with a key.

### 2.13 Company facts (stages/company.js)

- **What it does.** One Sonnet call with web search (`search: 6`) for founders, founding year, HQ, funding, revenue, investors and press. A fact is **kept only if its URL is among the URLs the search returned**. Otherwise it is dropped and counted.
- **Status.** Working (Arata: founded 2018, 2 founders, 0 dropped). Untested.
- **Risk.** "URL returned by search" means the page was in the search results, not that Claude read it or that the page states the value. The `quote` field is not checked against the page. A wrong value with a real URL passes. `citedHosts` is computed and never used. Company facts are stored as `layer: 'observed'`, so they reach facts.json and the cards.
- **Cost.** One Sonnet call with up to 6 searches.

### 2.14 Ledger (util.js:69–78) and facts derivation (derive.js:23–31)

- **What it does.** Every value is written as a row: `{key,label,v,n,unit,layer,src,url,at,method,conf,note}`. `factsFromLedger` keeps only rows that are not `inferred`, and **the first row for a key wins**.
- **Status.** Working. Arata has 204 rows; method mix: products.json 131, crawl 42, claude:web_search 11…
- **Bug: brand corrections don't win when the key is the same.** `applyCheck` *appends* brand-confirmed rows (build.js:529). When the key matches a read key, the read row comes first and still wins in `factsFromLedger` and in `checkData`'s `srcOf` (both take the first match). Same-key cases include `ads.own.live` (from the ad page fix) and `price.<handle>` (from an added product that already existed). That contradicts the comment at build.js:420 ("they outrank what was read"). Different keys such as `brand.name.confirmed` are unaffected. In `refresh.js`, `brandOwned()` recognises them on re-read.

### 2.15 Saved-read healing (`heal`, reader/index.js:157–189; build.js:447–469)

- **What it does.** Re-runs the ads stage if `ads.v !== ADS_V`, if any own or rival lookup has an error, if there is no own page, or if there are more rivals than ad rows. Writes the one-liner if Claude never did. Re-asks the AI tools if `answers` failed. It runs at most once a day per brand (hourly while still broken), never during a build, and never with `AI_MOCK=1` or `HEAL_OFF=1`.
- **Status.** Working for ads, line and answers (test: `heal asks the AI tools again and swaps the step and its cards`). **Partial** by design: open, brand, catalog, reviews, site, socials and company are never healed, and only ads has a version number.
- **Risks:**
  - **Paid work can be started by unauthenticated traffic.** `GET /api/brands/:slug/check` (anonymous; build.js:471) calls `heal(slug)`, and so does opening the feed for a team member (server.js:452).
  - A brand with no Facebook page at all (`!ownAds.page`) counts as "broken". It re-runs the ads stage every day, or every hour if an error stays.
  - The local Arata copy has `ads.v = 2`, so it would heal on first open.

### 2.16 Build pipeline: read part, status.json, caps, resume (build.js)

- **status.json.** `{slug, host, url, name, state (human line), stages:{read|confirm|brief|moves:{state,at,…}}, ready, done, error, unreadable, cancelled, capped, pausedDay, confirmedAt, movesDone, pdfs, zips, pro, freshRead, seenAt}`, written on every stage change and emitted as a `status` event.
- **Resume.** `run()` is idempotent and skips anything already in the pack. On boot, `resumeAll()` resumes every brand that is not done, not errored and not capped. A read interrupted by a restart **starts the whole read again**, and pays Claude again (see 2.2).
- **Caps.**
  - `BUILD_CAP_USD` per brand (code default 120; **deploy.sh sets 60**, while the code comment says 51 moves cost about $70–90, so non-Pro builds likely pause at the cap).
  - `BUILD_CAP_PRO_USD` (at least 150).
  - `DAILY_BUILD_CAP_USD` (deploy: 250), persisted in `_brew/spend-day.json`.
  - treg day cap `TREG_DAY_CAP_USD` (deploy: 40). It is **only in memory**, so a restart resets it.
  - The caps are checked before the read starts, not during it. A read always runs to the end.
- **Abuse limits.** Anonymous users get 1 new brand per IP per hour (`clientIp` with `TRUSTED_PROXY_HOPS`). Signed-in users get 3 per day (`BUILD_PER_USER_DAY`). Admins have no limit. `BUILD_BLOCK=wearcomet-in,everaw-in` is hard-coded in deploy.sh.
- **Store did not open.** The run stops before any paid stage after `open`, saves the findings, sets `unreadable` and records the error. Covered by test `a store that does not open stops before the brief and the moves…`.
- **Revisiting a store that would not open re-reads it.** `start()` with an existing, not-done status calls `resume()` *before* the IP limit check (build.js:117), and `run()` sees no profile, so it reads again. Anyone can re-trigger a read of a stuck slug without limit. It is cheap when `open` fails fast, but not free (a treg render).
- **Confirm wait.** For a signed-in starter, the brief and moves start automatically after `BUILD_CONFIRM_WAIT_MS`, 15 minutes by default. For an anonymous read the wait is unlimited, and the run holds `running=true` until then.
- **Weekly refresh.** `autoRefresh` → `checkUpdates` → a full `fresh:true` re-read (about $6) → `mergeProfile` / `mergeLedger` → triage. **findings.json is not updated by a refresh**, so the onboarding and "what we found" grid always show the first read.
- **Tests.** `test/audit-fixes.test.js` covers mergeProfile and hasData, storeOpened and clientIp. `test/facts-desk.test.js` covers the daily cap, the store-not-open stop, early confirm and fresh restart.

### 2.17 Onboarding "Reading {Brand}" stream (public/app.js:383–434; feed-service.js:114–145, 846–895)

- **What it does.** An EventSource on `/api/tenants/:id/onboarding`. `followRead` replays the builder's buffered reader events, then follows live ones. When none are in memory (a restart, or a cached read), it replays `seed.steps` and `seed.scrape` and holds `ready` until they have been sent. On the demo site, `liveReadOnboarding` runs `builder.readLive()`, a real new read whose paid calls come from the day's cache. It is paced for the presenter.
- **Status.** Working for the normal path. `test/audit-server-fixes.test.js` has 2 followRead tests (cached replay before ready; a live read streamed once). The client UI is untested.
- **Bugs:**
  - **The screen hangs on a store that won't open.** followRead sends `{type:'error'}` (feed-service.js:121), but **app.js has no handler for `error`**. No `ready` arrives, so the "Reading" screen spins until the EventSource itself errors, and then `es.onerror` drops the user into the seat picker (`whoFor()`) as if nothing were wrong.
  - **Empty or failed steps get a green check.** followRead maps `state:'empty'` to `state:'done'`, and so does liveReadOnboarding. A step that ended "could not finish (…)" or "no reviews found" gets a check mark. The text does say what happened, but the icon says success. When `ready` arrives, any unfinished row is forced to a check with "Done" (app.js:421).
  - **Fixed claims in the copy:** "Five agents have ideas ready", and the agent roster turns "Has ideas ready" as each step finishes, whatever was found.
  - **Arata-era leftovers, Cut-but-code-remains:**
    - the non-generated branch of `onboardingStream` (feed-service.js:875–891) with `FINDS` containing a hard-coded **"Found 4,683 reviews nobody has mined"**;
    - the non-GEN branch in `setup()`, which overrides the ads card with `/api/research` data and a hard-coded **"Meta Ad Library · India · live"** (app.js:388–390).

    Both run only for `B.generated === false` brands. If any non-generated pack is ever loaded, they show fixed, India-specific text.
  - The demo tour runs a live headless checkout walk on the real store for each tour.

### 2.18 "Check what we read" / "Is this right?" (build.js:470–556 `checkData`, `applyCheck`, `readProduct`, `readRival`; app.js:436–489)

- **What it does.**
  - Shows name, one-liner, category, country and currency with their sources.
  - Shows up to 12 products, hero-first. The brand can pick heroes or remove products.
  - Rivals: remove, or add by URL. A live fetch reads the name, up to 6 Shopify prices, and the count of live ads by domain through `adCall`.
  - Sources: the ad page, Instagram, and a reviews link. Company: founders and founded.
  - "Looks right, write my moves" posts `confirm {v2}`, which applies the edits, marks the brand confirmed and wakes the build. Edits are written to the ledger as `brand-confirmed`, and removed products' price and MRP rows leave the ledger.
- **Status.** Working (the UI and the routes exist; live GET was not exercised, to avoid heal). Tests: `removed products leave the evidence…` and `a confirmation made before the build reaches "Check what we read" is honoured`. applyCheck add-rival and add-product are **untested**.
- **Bugs and risks:**
  - **Errors show as "Not found"** (against CLAUDE.md's rule). The ad page row shows "Not found" whenever `own.page` is null, *including* when `ads.own.error` is set. The reviews row shows "No reviews found" even when the review feed failed. Fields with no ledger source show "Not found on the site" in the UI.
  - **The reviews "link" is never read.** `applyCheck` stores `reviews.brandSource` and replies "We will read your reviews from that page on the next refresh". Nothing in the reader reads `brandSource` (grep: only build.js sets and keeps it). **That promise is not implemented.**
  - **SSRF surface.** `readProduct` and `readRival` `fetch()` any URL a signed-in user pastes, including `http://`, with no blocking of private or link-local addresses. The GCE metadata server needs a header, which limits the damage, but it is still an open server-side fetcher.
  - They also bypass the reader's fetcher and caches, and `readRival` counts ads on the first Ad Library results page only.
  - The legacy `confirm(edits)` path: `r.name.toLowerCase()` throws if a saved rival has a null name.
  - Same-key brand corrections don't outrank the read (2.14).
  - Who may POST: `signGate` requires a Google sign-in, and `v.gen` must be true. An eligible user on an unclaimed brand **claims the brand by confirming** (server.js:533).

### 2.19 CLI `tools/read_brand.mjs`

- **What it does.** Runs the reader locally and writes `.brands/<slug>/{profile,ledger,findings}.json`. Flags: `--only=`, `--free` (no treg or Claude), `--fresh`, `--quiet`. It loads keys from `../ugc-factory/.env`.
- **Status.** Working as code, not run in this audit because it costs money unless `--free`. It is not in the Docker image (the Dockerfile does not copy `tools/`). It uses `createTreg` **without** the GCS cache, and its local raw cache is per day.
- **Note.** It has no `heal` command. Seed, facts and config are not written; the server's `publishBase` does that.

### 2.20 Helpers listed in scope but not part of the read

- **`treg-map.js`** is the registry of external capabilities, plus `watchCatalog` (admin `/api/admin/treg`). Status: Working (4 tests pass; the live check is skipped).
  - **It is incomplete for the read.** It does not declare these endpoints the reader uses: `litescrape.web.fetch.post`, `crawl4ai.google.serp.organic`, `crawl4ai.youtube.channel.videos`, `crawl4ai.instagram.user.posts`, `…adlibrary-search-ads`, `…adlibrary-search-companies`. `watchCatalog` and `probeFor` therefore don't know about them.
- **`apify.js`** runs an actor synchronously and reads its dataset. Cost is *estimated* (Apify does not return a price for a sync run), with `maxTotalChargeUsd`.
  - **It is not used by the read at all.** It is used only by `listen-watch.js` (Nykaa, Flipkart and Myntra listening).
  - README.md lists it under "Read", which is misleading.
- **`video-read.js`** breaks a video down (treg download → Gemini on Vertex, or transcript + ffmpeg keyframes → Claude), cached in `_brew/video/`. It is used by listening and moves, **not the read**.
  - The default `bucket` is **`squareup-feed`**, the old bucket, while everything else defaults to `brew-prototype`. In production `RESEARCH_BUCKET` is set, so it works, but a run without that variable writes to the old bucket.
- **`product-match.js`, `image-guard.js`** pick the catalog product a piece of copy names, and check that generated images show it. They are jam-side and only consume `profile.catalog`. Working, with 4 + 5 + 6 tests passing (product-match, image-guard, image-fallback).
- **`derive.js`:** `factsFromLedger` (2.14) and `configFromProfile`.
  - `FEST` hard-codes Diwali 2026 for India and Black Friday 2026 for everything else.
  - `BANNED` claim regexes are picked by category.
  - Untested directly.
- **`brand-ctx.js`** holds which brand a request is running for, through AsyncLocalStorage, plus live proxies. It is infrastructure, not the read.

---

## 3. External dependencies used by the read

| Provider | Endpoint / actor / model | Used for | Notes |
|---|---|---|---|
| treg | `litescrape.web.fetch.post` (engine browser) | blocked home, key and product pages; rival home pages; Amazon non-US `/dp/` text | not in treg-map |
| treg | `crawl4ai.google.serp.organic` | 3 category SERPs, own rank, rival overlap | not in treg-map |
| treg | `scrapecreators.x.v1-facebook-adlibrary-company-ads` / `-search-ads` / `-search-companies` | own and rival live ads, domain lookup, check-page ad page | falls back to free headless Ad Library (`reader/adlib.js`) |
| treg | `crawl4ai.amazon.search.products`, `crawl4ai.amazon.product.reviews` | marketplace ratings, Amazon review text (US) | |
| treg | `crawl4ai.youtube.channel.videos`, `crawl4ai.instagram.user.posts` | Films card | IG returned 502 on Arata |
| treg | `dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced`, `…gemini-llm-scraper-live-advanced`, `…perplexity-llm-responses-live` | AI answers | DataForSEO location codes in answers.js `LOC` |
| Anthropic | `claude-sonnet-5-5` (ai.js `MODELS.sonnet`), web search tool `web_search_20260209` ($0.01 per search) | about-page summary, category and one-liner, questions, Claude answers, rivals, company | Opus is not used in the read |
| Google | YouTube Data API v3 (`YOUTUBE_API_KEY`, optional) | channel videos | |
| Free public | Shopify `/products.json`, `/collections.json`, `/meta.json`, `/products/<h>.js`; WC Store API; Judge.me, Yotpo, Okendo, Stamped, Reviews.io widget endpoints; Facebook Ad Library HTML | catalog, reviews, ads fallback | undocumented and can break |
| Local | Chromium (`CHROME_PATH`, Dockerfile `/usr/bin/chromium`), puppeteer-core | checkout walk, Ad Library fallback | |
| Apify | none in the read | (listening only) | |

---

## 4. Env vars and flags touching the read

| Variable | Effect |
|---|---|
| `AI_MOCK=1` | Turns off Claude and the free Ad Library reader, and disables `heal()` |
| `TREG_OFF=1` | Turns off treg |
| `ADLIB_OFF=1` | Turns off the free Ad Library reader |
| `TREG_TOKEN` | treg token; falls back to `~/.treg/config.json` |
| `TREG_ORG` | treg org (`squareup`) |
| `TREG_DAY_CAP_USD` | treg day cap: default 25, deploy 40, demo 15; in memory only |
| `TREG_CACHE_HOURS` | treg cache lifetime (24) |
| `ANTHROPIC_API_KEY` | Claude key |
| `ENV_FILE` | Where keys are read from (default `../ugc-factory/.env`) |
| `CHROME_PATH` | Chromium for the checkout walk and Ad Library fallback |
| `YOUTUBE_API_KEY` | Optional; YouTube videos via the official API |
| `BUILD_CAP_USD` | Per-brand cap: default 120, deploy 60 |
| `BUILD_CAP_PRO_USD` | Per-brand cap for Pro brands |
| `DAILY_BUILD_CAP_USD` | Shared daily cap: default 200, deploy 250 |
| `BUILD_CONFIRM_WAIT_MS` | How long the build waits for "Check what we read" (15 min) |
| `BUILD_PER_USER_DAY` | New brands per signed-in user per day (3) |
| `BUILD_NO_IP_LIMIT` | Lifts the per-IP and per-user limits |
| `BUILD_SIGNIN` | Sign-in gate for re-reads and confirm |
| `BUILD_BLOCK` | Slugs that are never read; `;` or `,` separated |
| `BUILD_RESUME_OFF` | No resume on boot, no auto-refresh |
| `HEAL_OFF` | Disables `heal()` |
| `TRUSTED_PROXY_HOPS` | Which `x-forwarded-for` entry counts as the client |
| `REFRESH_AUTO` | Weekly re-read on or off |
| `OPS_FRESH_RELOAD` | One-off fresh reload for listed slugs |
| `RESEARCH_BUCKET` | GCS bucket (`brew-prototype`; demo `brew-prototype-demo`) |
| `K_SERVICE` | Set on Cloud Run; turns on the GCS mirror |
| `DEMO_MODE` | Demo tour runs `readLive` |

---

## 5. Versions, heal, failure handling: summary

- **Stage versions.** Only `ADS_V = 3` (ads.js:14). No other stage has a version, so improvements to open, brand, catalog, reviews, site, socials or company never reach saved reads unless the brand is re-read with `fresh`, or the weekly refresh re-reads it (and that does not update findings.json).
- **Heal triggers.** Covered in 2.15: the ads version or ads errors, a missing one-liner, or answers that failed.
- **Failure handling per stage.** Each stage gets one retry. A failed step says "could not finish (<reason>)" with state `empty`. `open` failing stops the read. A single stage failing never stops the read. Errors are kept in `profile.meta.errors`, on ads items as `error`, on AI answers as `{tool,q,error}`, and on socials as `instagram.error` / `youtube.error`.
- **Where failures are hidden:** the onboarding check mark (2.17), the check page "Not found" (2.18), socials and company being invisible steps, and a missing Films card with no explanation.

---

## 6. Risk register (most serious first)

1. **Store won't open → the onboarding hangs, then silently skips ahead.** The client ignores the `error` event (app.js:409–433; feed-service.js:121).
2. **Unauthenticated paid spend.** Anyone can start a read (about $6, 1 per IP per hour; IP rotation defeats it). A stuck slug can be re-read without limit through `start()` (build.js:117). `GET /check` and a feed open trigger `heal()`. The treg day cap resets on restart. The only hard stop is `DAILY_BUILD_CAP_USD`.
3. **No unit tests for any reader stage**, and only one brand's data exists. Regressions in the parsers (review apps, Ad Library HTML, Amazon regex) will show up only in production.
4. **Rules broken against CLAUDE.md** ("an error is never shown as none"):
   - check page `adpage` "Not found" when the lookup errored;
   - reviews "No reviews found" when the feed failed;
   - empty or failed steps get a green check in onboarding.
5. **Provenance errors in the ledger:**
   - rivals from the Ad Library or from AI memory are stamped `treg:crawl4ai.google.serp.organic` (ads.js:86);
   - ads read by the free reader are stamped `treg:scrapecreators…`;
   - `catalog.newest` says `products.json` on the JSON-LD path.
6. **`reviews.total` mixes metrics** (site reviews, store reviews, Amazon ratings from the first search page) and appears as one headline number on the step, the check page and the demo picker (`reviews: 79353`).
7. **Brand corrections lose to read values when the key is the same** (first row wins in derive.js:27 and build.js:478).
8. **The "We will read your reviews from that page" promise is not implemented** (`brandSource` is never read).
9. **Timed-out zombie stages and an uncancellable read** (index.js:109; build.js:193).
10. **Crash in `site` with no walkable product** (site.js:141).
11. **SSRF surface** in `readProduct` / `readRival` (build.js:504–524).
12. **The raw cache is read from local disk only**, so a resume after a restart or deploy pays Claude again (build.js:152).
13. **Dead code.** The Facebook-handle fallback is never set (ads.js:174). There are Arata-era hard-coded strings ("4,683 reviews", "India") in the non-generated onboarding paths. `citedHosts` in company.js is unused.
14. **Docs drift.**
    - README lists `apify.js` under Read.
    - SPEC names `treg.instagram.user.posts`, and `gs://squareup-feed`, while the code uses `crawl4ai.instagram.user.posts` and `gs://brew-prototype`.
    - The skill that CLAUDE.md requires, `brew-external-data` with `audit.py`, lives in the parent folder `/Users/param/Documents/ChatGPT/.claude/skills/`, **not inside `brew/`**. A team that gets only `brew/` won't have it.
    - deploy.sh `BUILD_CAP_USD=60` contradicts the code comment's estimate of $70–90 for a full build.

---

## 7. What a production build of "the Read" needs

1. **Run the read as a proper job.** A queue (Cloud Tasks or Pub/Sub) with real cancellation through AbortSignal end-to-end, a budget check for each paid call during the read, and per-stage isolation so a timeout kills the work.
2. **Official or contracted data sources where possible:**
   - the Meta Ad Library API, or a vendor contract;
   - Shopify, Judge.me and Yotpo through brand-authorised APIs once connectors are real;
   - a marketplace data provider for Amazon, Flipkart and Nykaa;
   - the official OpenAI and Gemini APIs as well as, or instead of, consumer-answer scrapes.
3. **A fixture-based test per stage.** Saved HTML and JSON from 10–20 varied stores (Shopify, WooCommerce, custom, non-English, non-India), golden profiles, and contract tests for every third-party endpoint, run nightly.
4. **A version on every stage, and heal for every stage.** Also re-derive findings.json from the profile, so saved reads always render with current code.
5. **Provenance.** Record the actual source per row (treg vs free fallback vs AI memory). Keep a ledger history per key, with brand-confirmed rows taking precedence by rule rather than by array order.
6. **Correct metrics.** Separate "site reviews", "store reviews" and "marketplace ratings". Never sum them into one total.
7. **Abuse and spend controls.** Sign-in, or a captcha, before any paid read. A persistent treg day cap. Rate-limit `start()` for existing slugs. Make `heal()` an authenticated or background-only action.
8. **Security.** An allowlisted URL fetcher (no private IPs, https only, size and time limits) for every user-supplied URL.
9. **Honest UI states.** Handle `error` in onboarding, show "couldn't check" vs "none found" vs "found" separately on the step rows and the check page, and show socials and company as their own rows.
10. **Observability.** Per-read traces (stage timings, retries, $ per provider), with alerts when a source's success rate drops (the treg-map `probeFor` and `watchCatalog` are a start).

---

## 8. Test inventory for this area (run: `AI_MOCK=1 node --test …`, 44 pass, 1 skip)

| File | What it covers |
|---|---|
| `test/reader-retry.test.js` | `answersFailed`; heal re-asks the AI tools and swaps the step and its cards |
| `test/adlib-fallback.test.js` | treg success passes through; treg failure without a page reader is an error, never empty; non-Ad-Library ids are not routed |
| `test/treg-cache.test.js` | paid once a day; expiry; generation not cached; failures not cached |
| `test/treg-map.test.js` | registry shape; watchCatalog (mocked); live catalog probe skipped |
| `test/audit-fixes.test.js` | mergeProfile, hasData, storeOpened, clientIp, removedKeys (with a stub reader) |
| `test/facts-desk.test.js` | daily cap persistence; store-not-open stop; early confirm honoured; fresh restart archives and re-reads |
| `test/audit-server-fixes.test.js` | followRead: cached replay before ready; a live read streamed once |
| `test/product-match.test.js`, `test/image-guard.test.js`, `test/image-fallback.test.js` | catalog → picture correctness (jam side) |

**Not covered anywhere:** every stage in `reader/stages/*`; `reader/adlib.js` page parsing and name matching; `util.js` (slug, registrable domain, HTML helpers, ledger, fetcher); `checkData`, `applyCheck`, `readProduct`, `readRival`; the onboarding client; `tools/read_brand.mjs`.
