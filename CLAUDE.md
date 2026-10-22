# Brew prototype

Brew is a realistic prototype: read → moves → feed → jam → share the brief. Read `SCOPE.md` before adding anything: Do it now,
measurement and Brew sending were cut on purpose (connectors are real and read-only on the live site since 2026-10-16). Anything simulated is marked Dummy in the UI, with a
`DUMMY:` comment in the code and a row in `DUMMY.md`. Keep all three in step when you add or remove a dummy.

Before changing anything that reads outside data, load the `brew-external-data` skill and follow it. That covers
treg, the Meta Ad Library, rivals, SERP, Instagram, Amazon, web search, a reader stage, a connector, a watcher, a
findings card, a check-page field or the brand profile.
The short version:

- An error is never shown as "none" / "not found": keep `error` on the item and say the check didn't go through.
- Paid sources fall back to free ones (Ad Library: `adCall` in reader/adlib.js), and every treg call goes through the
  shared client in treg.js (24-hour cache). Never call treg directly.
- Saved reads heal themselves (`heal()`); bump the stage version when a stage starts reading differently.
- Brand-agnostic: never fix one brand; audit every brand with `.claude/skills/brew-external-data/audit.py`.
- Run `AI_MOCK=1 node --test test/*.test.js`, boot the server locally, then deploy with `./deploy.sh` (it refuses uncommitted
  code and failing tests).

## Every brand, every platform (permanent rule, Param 23 Oct)

A fix is done only when it works for ANY brand Brew could onboard, never the one in the screenshot. Fix the shared cause,
heal saved data (`heal()`, a stage version, a pack-load repair), and check it on several kinds of brand. The kinds that broke
before, and must keep working:

- Platform: Shopify (and headless Shopify), WooCommerce, Magento, BigCommerce, Salesforce Commerce, custom/Next.js. Never
  assume `/products/<handle>`, `products.json`, `/cart.js`, Shopify sitemap names or a Shopify connector: use
  `reader/products.js` (learned product URLs, any page's product data) and `store-facts.js`.
- How it sells: an online store, or by enquiry (real estate, services, B2B: `profile.storeKind === 'enquiry'`, offerings
  and a lead form, no cart). Copy, scorecard, health rings, questions and connectors branch on it.
- Market: one, many in one sitemap, or still "to confirm". Ask and read from `askMarket()` (market.js), never a silent
  US or India default; the site's language where the tools speak it.
- Name: "PUMA India" is also "PUMA" (`profile.brandName`, `brandRe`), in AI answers, marketplaces and the weekly checks.
- Reading the site: bot walls (render, capped), script-drawn pages, sitemaps that list sitemaps, size pickers before Add to
  cart, tags loaded through GTM (count what fires), reviews switched off (`reviews.onSite`), CDNs that refuse bare fetches.
- Background work survives deploys: a run a restart cuts off is seen as unfinished and runs again (listening, builds,
  finals), never counted as done.
- An error or a check that didn't run is never shown as "none" or "0".

Test the brand matrix offline in `test/non-shopify.test.js`; add a case there for every new kind of brand that breaks.

## Release rhythm

Deploy whenever a change is tested; continuous deployment is part of how we work, and a deploy never waits for background work.
What makes that safe (keep it so):

- The instance that goes gets SIGTERM: `builder.stop()` lets no new move start there, jams and workspaces flush, and every
  run leaves its brand unfinished (not done, not capped) with "Brew is restarting; the rest of the moves carry on in a moment".
- The new instance's `resumeAll()` (server.js boot) resumes every unfinished build, rewrite and connected run from the moves
  already saved; each saved move is a file, so only the moves in flight at that second are written again.
- `/api/ops/busy` still says what paid work an instance is doing (finals in flight included); nothing waits on it. A Sloosh final
  left open by a deploy is finished or failed by `finals.reconcileAll()` on the next boot, never paid twice.
- Several sessions share this repo: `git pull --rebase` right before deploying, and deploy from a clean, committed tree (a
  detached worktree at HEAD when others have uncommitted edits here).
