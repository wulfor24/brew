# Connected accounts: what's live and what needs approvals

The code is live (2026-10-16). Each platform's own approval decides how widely each connector works. Nothing below is
a vendor problem, so Composio, Pipedream and Nango would hit the same approvals.

## Works today, no approval needed

| Account | How a brand connects |
|---|---|
| **GA4** | GA4 → Admin → Property access management → add `brew-runtime@squareup-492617.iam.gserviceaccount.com` as **Viewer**, then paste the property ID in Brew. |
| **Klaviyo** | Settings → API keys → Create private key, **Read-only**, then paste it. |
| **Judge.me** | Settings → Integrations → View API token, then paste it with the store address. |
| **Shopify** | The brand creates an app for its own store in the Shopify Dev Dashboard (read_products, read_inventory, read_orders, read_customers), installs it, and pastes the Client ID + Secret. A legacy `shpat_` token still works if they already have one. |
| **Marketplaces** | Public Amazon read through treg. This needs treg balance. |
| **Slack** | One click: **Continue with Slack**, pick the channel on Slack's screen. The Brew Slack app (`docs/slack-app-manifest.json`, made with the Slack CLI) needs no review: public distribution lets any workspace install it. App Directory listing is optional. Keys: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` in Secret Manager. |

## Needs you, start now (longest first)

1. **Google Ads, 4–10 weeks.**
   - Google Ads API Center: apply to move the developer token (`GOOGLE_ADS_DEVELOPER_TOKEN`) up from Test/Explorer to **Basic**.
   - Google Cloud → OAuth consent screen: add the `adwords` + `analytics.readonly` scopes and submit for verification (privacy policy URL, demo video).
   - Then deploy with `GOOGLE_OAUTH=1`. Until verification, the first 100 users see an "unverified app" screen.
2. **Meta Ads + Instagram insights, 2–6 weeks.**
   - Business Verification for SquareUp in Meta Business Settings.
   - Then App Review for **ads_read** (Advanced) and **instagram_business_manage_insights** on the app behind `META_ADS_OAUTH_CLIENT_ID`. Use the screencast script below.
   - Until then, the brand's Meta admin gets a role on the app (App roles → Testers/Analysts) and connects with one click.
3. **Shopify one-click, 3–8 weeks.**
   - Submit the public app (`FEED_SHOPIFY_CLIENT_ID`) for review, asking for `read_all_orders` and Protected Customer Data (orders, customers).
   - Then deploy with `SHOPIFY_OAUTH=1` (and `SHOPIFY_PCD_APPROVED=1` once approved).
   - Until then: a custom-distribution install link per brand, or the brand's own app (above).

## Screencast script (Meta and Google reviews)

1. Open brew.joinsquareup.com and sign in with Google.
2. Open a brand → Connectors → Connect Meta Ads → Facebook Login for Business → pick the ad account.
3. Show "What Brew read": spend, return on spend and frequency, all read-only.
4. Show the feed card built from it, and that only the brand's team sees it.
5. Show Disconnect, which removes the token.

Purpose line: "Brew reads a brand's own ad results (read-only) to show its team which marketing moves to make next.
It never changes campaigns, budgets or ads."
