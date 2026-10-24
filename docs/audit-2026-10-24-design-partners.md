# Design-partner audit, 24 Oct 2026

Arata, Nutrova, Mana Projects, PUMA India and Scrubroom: read, feed, numbers, play PDFs, connectors (Arata only has any),
jams and the phone layout. Every fix is in the product for every brand, with a guard; nothing was patched for one brand
except Scrubroom's logo file, which the reader fix would also have picked.

| Found | Fix (commit) | Guard |
|---|---|---|
| Reading page showed 6 of 9 cards after a deploy cut its stream | `ready` and the poll path fill in what was missed (29f7481) | step lines from saved read |
| Logo taken from a drawer template's `<header>` (Scrubroom showed Scrub Story) | header holding a logo wins (29f7481) | checked on 7 saved homes |
| No Instagram/YouTube on the site → Films said none | accounts found by search, labelled so (a48bd27, b645858) | test/socials-search.test.js |
| PUMA India and Scrubroom shown "No live ads" (tracker searched the store name, page is "PUMA" / "Scrub Room") | tracker reads the read's page id; a pageless tracker is never 0; stale cards dropped (2b3dc8d) | pack-numbers ownAds |
| Play covers: Scrubroom "₹2,625 entry set price" (sets start ₹1,899); 7 covers the build had flagged unbacked still printed as fact | stat-check.js: entry/lowest/highest vs catalog, "cited in reviews" vs reviews, unbacked → "(to confirm)" with the reason, at load (09578c5) | test/stat-check.test.js |
| Team-only PDFs never redrawn after a rule change; a PDF drawn right after a deploy missed load-time fixes | private PDF versions; PDFs drawn from the loaded brand; PDF_V 11 (09578c5, e4de167) | test/stat-check.test.js, honesty.test.js |
| Shopify COD card: title "40% unpaid", row 38% (title included cancelled) | title says "cancelled or still unpaid", with its own row (09578c5) | test/shopify-sync.test.js: a title's % appears below it |
| tools/meta-audit.mjs said frequency 1.7 where Brew rightly said 4.1 | the audit reads campaign frequency like the connector (09578c5) | — |
| brew-external-data audit.py flagged every brand "v5 (current v2)" | reads ADS_V from origin/main | — |

Checked and fine: Brand Book, card-fit and card audits clean for all five; Meta spend, ROAS, cost per purchase and live ads
match Graph exactly; Shopify counts match within sampling; 15 sampled PDFs download for all five; existing jams open with
their drafts and claim checks; no sideways scroll on a phone for any of the five. Mana's "60 days refund delay" cover is
backed by a review ("more than 60 working days").

Still open:
- 4 cards with an empty asset line (Arata m28-2; Mana m1001-1, m282-1, m132-1). Two look mis-typed: a printed tracker card
  filed as an image ad, a Reddit question as an Instagram post (cards-gen.js inferMake).
- A PUMA statics-batch picture from 22 Oct has "PUMA India Product / Scuderia Ferrari Fanwear Baseball Cap" drawn in it;
  the maker is not yet traced.
- ~~Scrubroom is read as "Apparel" though 68 of its 140 products are resold Littmann stethoscopes.~~ Fixed 25 Oct (e419432, 58b8179): assortment.js reads own label vs other brands for every store; Scrubroom is a curated retailer (74% other brands; own labels ScrubStory, Scrubroom), its line says so, and its plays were rewritten on the weekly pot to speak as where to buy those brands. Guard: test/assortment.test.js.
