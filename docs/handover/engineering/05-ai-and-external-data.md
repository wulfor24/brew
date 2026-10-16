# 05 · AI models and external data

## Models: what makes what

| Job | Model | Where | Rough cost |
|---|---|---|---|
| Brand brief | Claude **Opus 5.5**, effort high | `brief.js` | $1–3 per brand |
| Each move (01–65, dynamic) | **Opus 5.5**, effort high, structured output, up to 2 web searches | `moves-engine.js` | median $1.51, about 9 min |
| Move claim check / fix | Sonnet 5.5 check, Opus fix | `moves-engine.js verify` | about $0.4–1 per move (estimate) |
| Weekly listening and automation moves | **Sonnet 5.5** | `moves-cadence.js` | about $0.02 per move |
| Read: category, one-liner, questions, rivals, company, About summary | Sonnet 5.5, with web search ($0.01 per search) | `reader/stages/*` | most of the about $6 per read |
| Cards from moves, margin notes, value grades, card pages | Sonnet 5.5 | `cards-gen.js`, `notes.js`, `value.js`, `card-page.js` | cents |
| Jam (brief edits, chat, plan, knobs, variants) | Sonnet 5.5 (`FEED_CLAUDE_MODEL`); "Deep" in the composer switches to Opus 5.5 | `server.js claudeTool`, `remix.js`, `jam-brief.js` | $0.02–0.05 per edit |
| Images | Vertex **gemini-3-pro-image**, falling back to gemini-2.5-flash-image. Optional OpenAI **gpt-image-1** edit. | `server.js` | about $0.13–0.24 per image |
| Right-product check on every image | Claude **Haiku 5.5** vision | `image-guard.js` | about $0.005 |
| **Finals (go-live images and videos)** | **Sloosh** (sloosh.ai, ShopOS) over its MCP server, from Brew's own workspace: Nano Banana Pro, GPT Image 2.5, Ideogram 4.5, Flux 2 Pro, Seedance 2.5, Kling V3 Omni, Veo 3.1, and published Spaces. Quote first, behind Make the final only; never in a draft chain. | `sloosh-auth.js`, `sloosh-mcp.js`, `sloosh-prompt.js`, `sloosh-spaces.js`, `finals.js`, `finals-routes.js` | Sloosh credits per the quote (about 1–3 an image, 10–50 a video); `DAILY_CREDITS_CAP` 300, `BRAND_CREDITS_CAP` 100 |
| One brief for every picture (drafts and finals) | pure code, no model | `sloosh-prompt.js` | free |
| Video | Vertex **Veo 3.1 Fast**, 6 s, 1080p, `us-central1` | `vertex-media.js` | about $0.90 per clip |
| Voice | Vertex **gemini-2.5-flash-tts** | `vertex-media.js` | about $0.01 |
| Mic (talk instead of type) | OpenAI **gpt-4o-transcribe** | `server.js /api/transcribe` | about $0.006 per minute |
| Brand memory | Sonnet 5.5 plus Vertex `gemini-embedding-001` | `brand-memory.js` | cents |
| Story and watcher images | gemini-2.5-flash-image | `research.js`, `feed-service.js` | |
| Video breakdowns | Gemini on Vertex, or transcript plus keyframes to Claude | `video-read.js` | |

**Stale labels in the UI and comments:** the composer says video is "Hailuo 2.3 · about $0.49 a clip", and the drafts-bg header says treg/Hailuo. It is Veo.

**Two Claude stacks:**
- `ai.js` is metered and charges spend to the brand through AsyncLocalStorage.
- The raw SDK clients in `server.js`, `research.js` and `live-watch.js` count calls but not dollars.

Prefer `ai.js`.

## treg endpoints in use

All calls should go through `treg.js`, which handles caching (24 h on GCS), metering and a day cap. `research.js` and `live-watch.js` have fallbacks that bypass it. Fix those.

| Endpoint | Used for |
|---|---|
| `litescrape.web.fetch.post` | blocked pages, rival home pages, Amazon (outside the US) |
| `crawl4ai.google.serp.organic` | category SERPs, own rank, rival overlap |
| `scrapecreators.x.v1-facebook-adlibrary-company-ads` / `-search-ads` / `-search-companies` | own and rival Meta ads. **Falls back to the free headless Ad Library reader** (`reader/adlib.js`). |
| `crawl4ai.amazon.search.products`, `crawl4ai.amazon.product.reviews` | marketplace ratings and Amazon review text |
| `crawl4ai.youtube.channel.videos`, `crawl4ai.instagram.user.posts` | the Films card |
| `dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced`, `…gemini-llm-scraper-live-advanced`, `…perplexity-llm-responses-live` | AI answers |
| `dataforseo.x.keywords-data-google-trends-explore-live`, `serpapi.x.google-trends` | trends stories, market pulse |

Plus listening sources: Reddit, TikTok, IG, YouTube, X, Threads, LinkedIn, Pinterest, Trustpilot, Google reviews and others. The map is in `docs/treg-listening-map.html` and `listen-watch.js`.

`treg-map.js` is meant to register every capability, but it **is missing 6 endpoints the read uses**.

## Other external sources

| Source | Notes |
|---|---|
| Shopify `products.json`, `collections.json`, `meta.json`; WooCommerce Store API; JSON-LD | free catalog |
| Judge.me, Yotpo, Okendo, Stamped, Reviews.io public widget endpoints | free reviews. **Undocumented; they will break without warning.** |
| Facebook Ad Library HTML (headless Chromium) | free fallback for ads; depends on Facebook's page HTML |
| YouTube Data API (`YOUTUBE_API_KEY`) | hitting its quota (429) in listening |
| Apify (`apify.js`) | Nykaa, Flipkart, Myntra listening. **`APIFY_TOKEN` isn't set in prod, so these are off.** It isn't used by the read, though README says it is. |
| Resend | team email (in scope) |
| `date-holidays` | the calendar module. **Not wired into `config.festival`, which is hard-coded.** |

## Rules that bind every change touching outside data

Load the `brew-external-data` skill (it currently lives in the parent folder: `../.claude/skills/brew-external-data/`). The short version, from `CLAUDE.md`:

1. **An error is never shown as "none" or "not found".** Keep `error` on the item and say the check didn't go through. *Breaches still in the code: the check page, the onboarding check marks, and Heard listing skipped sources as failures (`02-feature-audit.md`).*
2. Paid sources fall back to free ones. Every treg call goes through `treg.js`.
3. Saved reads heal themselves. Bump the stage version when a stage starts reading differently. *Only the ads stage has a version.*
4. Brand-agnostic: never fix one brand. *Arata-specific code remains: lanes `core|mito|dandruff`, "N new hairs", "other serums", "4,683 reviews", the hard-coded Diwali date.*

## Content rules the prompts enforce (from SPEC.md)

- No invented numbers, quotes, founders, reviews or backstory. Anything unbacked is written "to confirm".
- Observed, Inferred and Implication stay separate.
- Never state a rival's motive.
- Missing data is said plainly.
- Benchmarks are labelled.
- No disclaimers on ad creative.
- Plain language.
- They/them for any person whose pronouns are unknown.

**Where code breaks these today:** the leftover claim issues in moves, the canned plan answers in the jam ("Cleared…", "used with consent"), and the simulated account numbers quoted as real.
