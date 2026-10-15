# 09 · Security and access

## Update, 2026-10-15 evening

For real clients: N-1, N-3 and N-5 are fixed, and so are S-1 (as jam-only guests), S-2 and S-4. N-4 (`/notify`) stays open by decision. N-2 is partly fixed: the mic, memory and heal need sign-in, but an anonymous read still runs at 1 per IP per hour. See `11-known-issues-and-debt.md`.

## Context: what matters now and what matters later

Brew is a **showcase prototype**. No brand has connected a real account, and every connector is simulated. The data on the sites is what Brew read from public websites, plus notes the SquareUp team added. Public links and open read routes are therefore **acceptable today** (product decision, 2026-10-15).

So the findings come in two groups:
- **Fix now**, because they hurt even a showcase: money, and the company's other systems.
- **Before real brands onboard**, which can wait until real data arrives.

Severity, scenarios and file:line details are in `audits/E-accounts-demo-security.md` and `audits/D-jam.md` §4.

## Fix now (these affect a showcase too)

| # | Finding | Why it matters now | Fix |
|---|---|---|---|
| N-1 | **The runtime service account is the default compute SA.** It can read about 130 company secrets (Supabase prod DB password, Razorpay and Dodo payment keys, `VAULT_MASTER_KEY`, Meta and Shopify app secrets…), holds `run.admin` (can redeploy any service) and `iam.serviceAccountTokenCreator`. | Brew fetches URLs from strangers with headless Chromium. One exploit would reach the whole company, not just Brew. | Give each service its own SA with access to its 8 secrets, its bucket, and Vertex (`aiplatform.user`). Nothing else. |
| N-2 | **Spend by people who aren't signed in:** a new read (about $6, limit 1 per IP per hour, kept in memory); heal by `GET /check`; `POST /api/transcribe` (OpenAI); memory learn and consolidate on unclaimed brands; `POST /api/tenants` (unlimited workspaces); and every demo visitor gets real AI. | Each one bills the company. The daily caps are shared, so one script can use up the day and break the showcase for real prospects. | Sign-in or a captcha before paid reads. Rate limits kept across restarts, per IP and per account. Separate caps per demo session. |
| N-3 | **Caps reset on every deploy** (text, image, video and voice calls, the treg dollars), and some Claude calls are not counted at all. | Cost can't be predicted. | Persist the counters the way the build day cap is persisted, and add a dollar meter around every Anthropic and OpenAI call. |
| N-4 | **`POST /api/brands/:slug/notify` is open.** Anyone can add 20 addresses per brand, and Brew emails them from hello@send.joinsquareup.com. | Spam sent from SquareUp's sending domain hurts its reputation. Team email is in scope, so this path stays. | Require sign-in, or a confirm link (double opt-in), and rate-limit it. |
| N-5 | **`HANDOFF_SECRET` is unset.** Share links are signed with a key derived from the Anthropic API key. | Rotating the Anthropic key breaks every shared brief link. | Set a dedicated secret. |

## Before real brands onboard

| # | Finding | Today | Fix |
|---|---|---|---|
| S-1 | Opening a shared jam or brief link while signed in adds that person to the brand team with every view. The links never expire. | Fine for a showcase | Read-only links. Joining only by invite. Links that expire and can be revoked. |
| S-2 | `GET /told` and `GET /memory` are public, including the team's pasted notes. | Confirmed on live; fine for now | Members only, filtered by seat. |
| S-3 | Seats filter cards, but not server data. A member with no views can still do everything else. | | Enforce seats on every route. |
| S-4 | On an unclaimed brand, anyone can edit facts and brand memory. Memory goes into every jam prompt, so this is a lasting prompt injection. Arata is unclaimed on live. | | Sign-in plus `genOk` on every write. |
| S-7 | PDF names are URL-decoded and not reduced to a bare file name, a possible path traversal (from reading the code; not verified live). | | Use `path.basename` plus an allow-list, and add a test. |
| S-8 | The URL reader and photo fetch follow redirects to internal addresses. Chromium runs with `--no-sandbox`. | | Resolve DNS and block private ranges on every hop. Cap response sizes. |
| S-9 | Workspace ids are 32 bits and work as the only key to a workspace. | | 128-bit ids, tied to their owner. |
| S-10 | `GET /api/brands` lists every brand being read, including prospects mid-read. `/api/config` shows usage. | | Admin only. |
| S-11 | The admin list includes a personal Gmail and two whole company domains, all with access to every brand. | | Admins by named work account, with 2FA. |
| – | Claiming a brand by email domain is weak proof of ownership. Sessions can't be revoked. | | DNS or store-admin proof. A sessions table. |

## How access works today

- **Sign-in:** Google OAuth with PKCE and a nonce. A signed 30-day cookie `fs_s` (HMAC with `FEED_SESSION_SECRET`). Tokens are typed: session, gstate, invite, approve.
- **Claim:** the first person with an email at the brand's own domain claims it: by tapping Claim, by connecting a (dummy) account, or by confirming the read. Free-mail and shared-platform domains are refused.
- **Team:** after a claim, people at the same domain join automatically with no views, and the owners get an email. Owners invite others by email with a set of views. Invite links last 14 days and are tied to the invited Google account.
- **`genOk`** (may this viewer generate?): true for a signed-in member, a SquareUp admin or staff domain, or an official-domain email on an unclaimed brand. **Also true for everyone when `FEED_SIGNIN=0`, in demo mode, or with `DEV_MEMBER` locally.**
- **Demo site:** each visitor gets a throwaway sandbox under `demo/<sid>/`. `fetch` is wrapped so it can't call any sending host (Resend, SendGrid, Twilio, Slack hooks) and can only GET account hosts. This is tested.

## Checked and OK

- `TRUSTED_PROXY_HOPS=1` takes the right client IP (tested).
- Open-redirect guard.
- `SameSite=Lax` cookies against CSRF.
- Static files are served only from `public/`.
- `BUILD_BLOCK` is enforced.
- Share-link holders don't inherit membership through `member-ctx`.
- Keys come from Secret Manager and never reach the page.
- The demo has no `RESEND_API_KEY`.
- `DEV_MEMBER` is off on Cloud Run.
