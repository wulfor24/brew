# Brew: the build contract

A person pastes any brand's URL, and Brew:

1. Reads the brand for real (crawl + treg + Claude web search). Nothing is canned.
2. Shows those real findings on the onboarding screens.
3. Writes all 51 "moves" (Brew strategy documents) at the depth of the hand-made Arata corpus, as Brew PDFs.
4. Builds the whole feed (cards, card pages, facts, statics) from those moves.
5. Lets the team jam on any card, then share the brief (see SCOPE.md; DUMMY.md lists what is simulated).

## Hard rules (accuracy above everything)

- **No invented numbers, quotes, founders, reviews or backstory.** Every number traces to a ledger entry or a cited source; otherwise it is written "to confirm".
- **Observed, Inferred and Implication stay separate.** Inferred items carry a confidence note. "Not observed" never means "absent".
- **Never state a rival's motive.**
- **Missing data is said plainly** ("No review widget found"). It is never filled with a sample.
- **Benchmarks are labelled** "industry benchmark".
- **No disclaimers on ad creative** (no "illustrative" or AI labels).
- **Plain, simple, one-glance language** in the UI.
- **Use they/them** for any person whose pronouns are unknown.

## Shared modules (already written; use them, don't fork them)

- `ai.js` → `createAI()` returns `.call({ model: 'opus'|'sonnet', system, prompt|messages, max, effort, schema, search, location, tag })`, which resolves to `{ text, json, cites, usd }`. It throws `{mock:true}` when AI is off (`AI_MOCK=1` or no key). Opus writes long documents; Sonnet does short work. Pass a JSON schema for structured output; `strictSchema` makes every property required.
- `treg.js` → `createTreg()` returns `.call(id, {query, body})` and `.dfs(id, body)` (unwraps DataForSEO). It is metered and day-capped; `TREG_OFF=1` turns it off.
- Keys load from `../ugc-factory/.env`, the same way `server.js` does it (see its env block). Local treg auth falls back to `~/.treg/config.json`.
- Known treg endpoint ids already in use (also see `research.js` and `live-watch.js`):
  - `scrapecreators.x.v1-facebook-adlibrary-company-ads` (query: `companyName`, `country`, `status=ACTIVE`)
  - `dataforseo.x.keywords-data-google-trends-explore-live`
  - `serpapi.x.google-trends`
  - `dataforseo.x.ai-optimization-chat-gpt-llm-scraper-live-advanced`
  - `dataforseo.x.ai-optimization-gemini-llm-scraper-live-advanced`
  - `dataforseo.x.ai-optimization-perplexity-llm-responses-live`
  - `treg.instagram.user.posts`, `anyapi.instagram.post.comments`, `crawl4ai.amazon.product.reviews`

  Discover others with the treg MCP tools `catalog_search` and `catalog_get`.

## Brand pack layout

Local dir `.brands/<slug>/`, mirrored to `gs://squareup-feed/brands/<slug>/`.

```
profile.json     reader output (schema below)
ledger.json      evidence ledger [Entry]
findings.json    { steps:[Step], cards:[Finding] }      what onboarding showed
brief.md / brief.json
moves/NN.json    one Move per file (schema below); moves.json = all of them
pdf/NN <Title>.pdf, pdf/<Brand>-moves-00-28.zip, pdf/<Brand>-moves-29-50.zip
seed.json facts.json config.json pages.json labels.json pools.json
assets/…         downloaded logo, product photos, ad posters, statics
status.json      build stages { stage: {state, at, err} }
cost.json        { usd, byTag }
```

`slug` is the lowercased registrable domain with dots changed to dashes: `arata.in` becomes `arata-in`, `www.glossier.com` becomes `glossier-com`. Assets are served at `/b/<slug>/a/<file>`.

## Ledger entry

```
{ key: "price.mitoactive-30ml", label: "MitoActive 30 ml price", v: "₹1,499", n: 1499, unit: "INR",
  layer: "observed" | "inferred", src: "arata.in/products/mitoactive", url: "https://…", at: "2026-10-13",
  method: "products.json" | "jsonld" | "crawl" | "treg:<id>" | "claude:web_search" | "brand-confirmed", conf?: "high|medium|low" }
```

- Keys are dotted, stable and readable: `price.<handle>`, `reviews.total`, `reviews.judgeme.count`, `ads.own.live`, `rival.<slug>.price.<x>`, `company.founded`, `ai.named.of`.
- Every number in a profile also gets a ledger entry.

## Profile (`profile.json`)

Fields may be null when not found. Never guess a value.

```
{ url, host, slug, name, tagline, descriptor /* e.g. "HAIR & SCALP SCIENCE CO." from the site */, about, aboutUrl,
  category, subcategory, country /* ISO2 */, currency /* ISO */, locale, platform /* shopify|woocommerce|bigcommerce|magento|custom|unknown */,
  identity: { logo, mark, colors:[hex…3], fonts:{ heading, body, mono }, typeName },
  catalog: { count, collections:[{handle,title,count}],
             products:[{handle,title,type,price,mrp,currency,inStock,variants,images:[url],img /* asset */,url,published,tags,claims:[], reviews:{count,rating}}],
             hero:[handle…] },
  reviews: { platforms:[{name,count,rating,url}], total, quotes:[{text,rating,src,url,product,at}] },
  socials: { instagram:{url,handle,followers,posts:[…]}, youtube:{url,subs,videos:[{title,url,views,thumb}]}, facebook:{url}, x:{url}, linkedin:{url}, tiktok:{url} },
  ads: { own:{page,live,items:[Ad]}, rivals:[{name,live,items:[Ad]}] },   // Ad = {hook,body,poster,video,days,versions,url,brand}
  rivals: [{name,host,why,prices:[{title,price,currency,url}],claims:[],offers:[],guarantee}],
  site: { pages, sitemaps, keyPages:[url], checkout:{steps,msToCart,msToCheckout,payments:[],cod,guest,notes:[]},
          tech:{shopify,klaviyo,metaPixel,ga4,gtm,tiktokPixel,reviewApp,subscriptionApp,chat}, policies:{shipping,returns} },
  ai: { questions:[q], answers:[{tool,q,text,named,rivalsNamed:[],sources:[]}], score:{named,of} },
  search: { terms:[], serp:[{q,results:[{pos,domain,title,url}]}], trends:null|{…}, domain:{rank,traffic,refdomains} },
  company: { founders:[], founded, hq, funding:[{round,amount,date,url}], revenue:[{v,period,url}], press:[{title,url,date,outlet}] } }
```

## Onboarding stream (the screen named "Reading {Brand}")

The steps keep v1's keys, in this order: `open`, `brand`, `catalog`, `reviews`, `ads`, `site`, `answers`.

```
Step    = { k, t /* "Open the store" */, done /* real count line, e.g. "41 pages, 2 sitemaps" */, tick:[path…], agent? }
Finding = { kind: 'text'|'kit'|'rows'|'quotes'|'grid'|'ad'|'answer'|'film', t, src, … }   (v1 shapes:
  text {p} · kit {logo,colors,face,typeName} · rows {rows:[[k,v]],cap} · quotes {quotes:[…],cap} · grid {imgs:[…],cap}
  ad {img,copy,foot} · answer {q,a,cap} · film {img,cap,url})
events: {type:'step',k,state:'reading',tick} · {type:'finding',k,finding,say} · {type:'step',k,state:'done'|'empty',done}
```

## Move (`moves/NN.json`): written by moves-engine, drawn by pdf/

```
{ n: 3, group: "know"|"found"|"reach"|"convert"|"keep"|"expand", skill: "competitor-profiling",
  kicker: "COMPETITIVE INTELLIGENCE", title: "Five competitor dossiers for Arata",
  stat: "₹47 vs ₹50", statLabel: "Traya's cheapest day vs MitoActive",
  gives: "one sentence", live: "one sentence: what is live 30 days after we start",
  sections: [ { h: "Why this matters for Arata", kind: "why"|"found"|"plan"|"examples"|"measure"|"appendix"|"sources"|"other",
               blocks: [ {t:'p',text} | {t:'h3',text} | {t:'list',items:[…],ordered} | {t:'table',head:[…],rows:[[…]],caption}
                         | {t:'diagram',text /* monospace */} | {t:'example',title,label,body} | {t:'callout',title,text} ] } ],
  sources: [{label,url,at}], factsUsed: [ledgerKey…], toConfirm: ["…"],
  meta: { model, at, usd, verified, issues:[] } }
```

- Inline text may use `**bold**` only.
- Tables have short header cells. The 30-day table header is `WEEK | BREW DRAFTS | <BRAND> PROVIDES | LIVE BY END OF WEEK`.
- The measure table header is `METRIC | BASELINE | 90-DAY TARGET | DECISION RULE`.

Brand info for the PDF: `{ name, descriptor, host, hero /* product cutout file path or null */, dateLabel: "OCTOBER 2026", version: "V1 · FOR DISCUSSION" }`.
