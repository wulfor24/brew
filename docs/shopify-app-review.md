# Shopify app review: Brew

Status 2026-10-20. The code side is done and live, including the read of a password-protected store (step 0). The submission
needs Param in Shopify's dashboards (steps 1 onwards).

Once approved, Brew is listed in the Shopify App Store and any merchant can install it in one click. Built for Shopify is a
later badge on top of that (50 paid installs + 5 reviews + design/speed rules), not part of this review.

## What is built (shopify-app.js)

| Shopify requirement | How Brew meets it |
|---|---|
| 2.3.1 install only from Shopify, never type a store address | Managed install (scopes in `docs/shopify.app.toml`). Brew web's "Connect Shopify" sends people to the install link once `SHOPIFY_INSTALL_URL` is set |
| 2.3.2–2.3.4 authenticate right after install, then the app UI | Shopify's managed install asks for permission before the app opens. A legacy install is authorized at `/shopify/callback`, then sent back into the admin |
| 1.1.1 session tokens, no third-party cookies | The App Bridge id token is verified on every request and traded for the shop's token (token exchange). No cookie inside the admin |
| 2.2.2 / 2.2.3 embedded, latest App Bridge first in `<head>` | `/shopify` is the app home inside the admin. Every Brew page opened there gets `app-bridge.js` as its first script and `frame-ancestors` set to the admin only |
| 2.2.4 GraphQL Admin API only | `connectors/shopify.js` uses GraphQL only (API 2026-04) |
| 3.2 only the scopes needed | `read_products, read_inventory, read_orders, read_customers`. `read_locations` dropped, no `read_all_orders` (60 days of orders is enough) |
| Mandatory compliance webhooks | `/shopify/webhooks`: HMAC-checked (401 on a bad signature). customers/data_request and customers/redact: Brew stores no per-customer record. shop/redact and app/uninstalled: the store's token and numbers are dropped |
| 1.2 billing | Free during the preview: no charges, so no Billing API yet |

How a store becomes a brand: the store's primary domain is the brand, when that is safe.
- **Domain already read by Brew:** the store links to that brand. The installer joins the team, as owner if nobody has claimed the brand; on a claimed brand the store's owner joins as admin and other staff as members. Shopify connects itself.
- **Domain not read yet:** the home page offers "Read my store" (a paid read, so it only starts on the merchant's tap).
- **Storefront behind Shopify's password page:** "Read my store" reads the store from its Admin API instead (step 0).
- **Development or closed store with a custom domain:** the custom domain is used only when that domain serves this very store
  (its page names this shop, or Shopify's `x-shopid` header matches). Otherwise the brand is the store's own
  `<store>.myshopify.com`, which nobody can claim by email domain (auth.js `PLATFORM`). So installing on a dev store never
  reaches, joins or claims another brand's domain. A live, open store keeps using its primary domain (Shopify verified it).

Google, Meta and Slack refuse to sign in inside a frame, so inside the admin those open in a new tab through a signed
two-minute hop (`/shopify/hop`).

## Step 0: a store behind the password page (done, live 2026-10-20)

Shopify reviewers install on a **development store**, and development stores always sit behind the storefront password. Brew
reads such a store from its **Admin API** (`reader/stages/admin.js`), so the read, the moves and the feed still work:

- **What is read (free, on the merchant's tap):** the shop's name, description, currency, country and ships-to countries;
  up to 500 **active** products (never drafts) with prices, compare-at prices, stock, photos and descriptions; collections
  when Shopify allows; the logo and colours from the brand settings, plus the theme's own on the password page. The snapshot
  is kept privately (`private/admin-catalog.json`) and refreshed once a day when the merchant opens the app.
- **What waits until the store opens:** the checkout walk, PageSpeed, the AI answers and the store's own Google rank. Each says
  plainly that it didn't run because the storefront is behind Shopify's password page (read steps, health rings, scorecard),
  never "none". Rivals, their ads and the category searches still run. A heal looks at the store once a day; when the password
  comes off, those stages run on their own.
- **A store with no active products:** the home says to add a product first instead of starting an empty read.
- **From the web:** a read of a password page no longer reads it as the brand: it stops and says to open Brew from the Shopify admin.

Tests: `test/shopify-catalog.test.js`. To try it as a reviewer would: install on a dev store with a few products, open Brew
from Apps, tap **Read my store**.

### Deploying while local main has diverged

The local `main` in `brew/` has diverged from `origin/main`. Never deploy from it: make a temporary worktree at
`origin/main`, cherry-pick only your commits, run `AI_MOCK=1 node --test test/*.test.js`, push to `origin/main`, then deploy
from that worktree (`./deploy.sh`).

## Step 1: Param, in the Dev Dashboard (dev.shopify.com → the Brew public app, `FEED_SHOPIFY_CLIENT_ID`)

1. New version, using the values in `docs/shopify.app.toml`: either run `shopify app config link` then `shopify app deploy`
   from `brew/docs`, or fill the version by hand:
   - App URL `https://brew.joinsquareup.com/shopify`, embedded on
   - Scopes `read_products,read_inventory,read_orders,read_customers`, managed install (legacy install flow off)
   - Redirect URLs `https://brew.joinsquareup.com/shopify/callback` and `https://brew.joinsquareup.com/connect/shopify/callback`
   - Webhooks (API 2026-04) to `https://brew.joinsquareup.com/shopify/webhooks`: `app/uninstalled`, plus the compliance topics `customers/data_request`, `customers/redact` and `shop/redact`
2. Release the version, then install it on a development store (Distribution → test on a dev store) and open it from Apps.
   Check that the Brew home appears and says what it found.
3. **API access → Protected customer data:** request **Level 1 only** (orders and customers, no name, email, phone or
   address fields). Answers are below.
4. **Partner Dashboard → Settings:** add an emergency developer contact (requirement 4.5.6).

## Step 2: protected customer data answers (Level 1)

- **Why Brew needs it:** to compute store-level numbers that set the marketing feed: orders and revenue over 30 days, average
  order, how many recent customers ordered twice or more, and best sellers. Shown only to the brand's own team.
- **Minimum data:** order totals, dates, statuses, line-item titles and quantities, and each customer's order count. No names,
  emails, phones or addresses. Brew keeps totals and shares, never a record of any one customer.
- **Merchant told:** the privacy page (brew.joinsquareup.com/privacy, "Brew in your Shopify admin") and the permission screen.
- **Retention:** each read replaces the last one. Uninstalling or shop/redact drops the token and the store's numbers.
- **Encryption:** TLS in transit. Tokens are encrypted at rest (AES-256-GCM, key in Google Secret Manager). Data is stored in a
  private Google Cloud Storage bucket.
- **Access:** only the brand's team, through Shopify or Google sign-in. No staff browsing; ops access is logged in Cloud Run.

## Step 3: the listing (no statistics, no "best/first/only", no reviews in text or images: requirements 4.3–4.4)

- **App name:** Brew: Daily Marketing Moves. Check the name is free on the App Store. It must lead with "Brew" and match the dashboard name.
- **Subtitle (card):** A daily feed of marketing moves made from your store's data
- **Introduction:** Brew reads your store, reviews and rivals, then tells your team what to do next in marketing, one move at a time.
- **Details:** Brew reads your storefront, your Shopify orders and stock, your reviews and the ads your rivals run, then
  writes a daily feed of marketing moves for your team: what to launch, what to fix, what to post and who to win back. Each card
  shows where its numbers came from. Your team can talk a move through, draft the post or ad, and share the brief to Slack.
  Brew only reads: it never changes your store, your ads or your emails.
- **Features (short):** A daily feed of moves built from your store · Every number shows its source · Drafts for posts, ads and
  emails · Rival ads and reviews in one place · Read-only: Brew never changes your store
- **Pricing:** Free (design-partner preview)
- **Category:** Marketing and conversion. Avoid the Analytics and Ads categories for now: Built for Shopify would then require a web pixel.
- **Privacy policy:** https://brew.joinsquareup.com/privacy · **Support:** hello@joinsquareup.com
- **Screenshots (1600×900, real UI, each a different view):** the home inside the admin, the feed, one move card with its
  proof sheet, the jam with a draft, and the connectors page. No browser frame, no prices, no reviews.

## Step 4: screencast (English, about 3 minutes; requirement 4.5.3)

1. Development store admin → Apps → install Brew from the install link. Show the permission screen and Install.
2. The admin opens Brew at once (no sign-up). Say: "Brew links this store to its brand by the store's domain."
3. The feed: open a move card and show its numbers from Shopify (orders, average order) and the proof sheet with their source.
4. Open a draft (jam) and show that nothing is sent or changed in the store.
5. Connectors: Shopify is already connected; Meta opens in a new tab to sign in (read-only).
6. Uninstall from Settings → Apps. Say: "Brew stops reading and drops its access."

## Step 5: testing instructions for the reviewer

> Install Brew on your development store from the install link; there is no separate sign-up. Brew opens inside the admin.
> Add a few products to the store if it has none, then tap **Read my store**. A development store's storefront is behind
> Shopify's password page, so Brew reads it from the Shopify admin (products, prices, photos, descriptions, stock); the checkout
> walk, page speed and AI answers say they wait until the store opens. The read takes up to half an hour, and the feed fills in
> with moves built from the store as each one is written. Brew is read-only: it never writes to the store. Optional: Meta Ads, Google Analytics and Klaviyo
> connect from Connectors and open in a new tab, because those services don't allow sign-in inside a frame.
> Contact: hello@joinsquareup.com.

No test credentials are needed: Shopify signs the reviewer in. If they ask for a Brew web login, give them a Google account on
joinsquareup.com.

## After approval

- Deploy with `SHOPIFY_OAUTH=1 SHOPIFY_INSTALL_URL=<the listing link>`. Brew web's Connect Shopify then says "Install Brew on
  Shopify" and sends people to the listing (no store address to type).
- Brands connected with their own Dev Dashboard app keep working; the next time they open Brew from Shopify, the app's token
  replaces theirs.
