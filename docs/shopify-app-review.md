# Shopify app review: Brew

Status 2026-10-20. The code side is done and live (commit de3dcdc). The submission needs Param in Shopify's dashboards, and it
has one product gap to close before it goes in (step 0).

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

How a store becomes a brand: the store's primary domain is the brand.
- **Domain already read by Brew:** the store links to that brand. The installer joins the team, as owner if nobody has claimed the brand; on a claimed brand the store's owner joins as admin and other staff as members. Shopify connects itself.
- **Domain not read yet:** the home page offers "Read my store" (a paid read, so it only starts on the merchant's tap).
- **Storefront behind Shopify's password page:** Brew says so plainly.

Google, Meta and Slack refuse to sign in inside a frame, so inside the admin those open in a new tab through a signed
two-minute hop (`/shopify/hop`).

## Step 0: close the gap reviewers will hit (before submitting)

Shopify reviewers install on a **development store**, and development stores always sit behind the storefront password.
Today Brew can't read a store behind the password, so a reviewer would see "Brew can't read your store yet" and reject the app
under 2.1 ("core functionality must work").

Fix: when the storefront is closed, read the store from the Admin API instead (the products, prices, images and descriptions
Brew already has scope for), so the read and the moves still work. This is a reader change and needs the
`brew-external-data` skill. It is proposed as its own session.

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

> Install Brew on your development store from the install link; there is no separate sign-up. Brew opens inside the admin and
> reads the store (products, stock and the last 60 days of orders). The first read takes a few minutes; the feed then shows
> moves built from the store. Brew is read-only: it never writes to the store. Optional: Meta Ads, Google Analytics and Klaviyo
> connect from Connectors and open in a new tab, because those services don't allow sign-in inside a frame.
> Contact: hello@joinsquareup.com.

No test credentials are needed: Shopify signs the reviewer in. If they ask for a Brew web login, give them a Google account on
joinsquareup.com.

## After approval

- Deploy with `SHOPIFY_OAUTH=1 SHOPIFY_INSTALL_URL=<the listing link>`. Brew web's Connect Shopify then says "Install Brew on
  Shopify" and sends people to the listing (no store address to type).
- Brands connected with their own Dev Dashboard app keep working; the next time they open Brew from Shopify, the app's token
  replaces theirs.
