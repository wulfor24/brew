# E. Accounts, access, demo site, dummies and security: handover audit

Repo: `/Users/param/Documents/ChatGPT/brew`. Audited 2026-10-15 by reading the code, running the auth and demo tests locally (`AI_MOCK=1`), and sending unauthenticated GET requests to the live sites. I sent no POSTs, made no paid calls and edited no repo files.

Tests run: `AI_MOCK=1 node --test test/security-fixes.test.js test/team-seats.test.js test/demo-mode.test.js`: 22 of 22 pass. These tests call the auth, member and connector modules directly. **No test checks HTTP route gating.** Nothing tests who may call `/memory`, `/told`, `/facts`, `/notify`, `/api/ai/*`, the share link or the PDF route.

---

## 1. Accounts

| Feature | What it does | Status | Evidence | Risks / what production needs |
|---|---|---|---|---|
| Google sign-in | OAuth code flow with PKCE. A nonce and verifier sit in a 10-minute cookie (`fs_g`). The id_token's aud, iss, exp, nonce and email_verified are checked. | **Working** | `auth.js:192-215`. Live `/api/me` returns `signin:true`. | The id_token signature is not verified. That is acceptable only because the token comes straight from Google's token endpoint over TLS. Production should use a JWKS-verifying library. `redirect_uri` comes from `PUBLIC_URL`, falling back to the Host header. |
| Sessions | An HMAC-signed cookie `fs_s` (`FEED_SESSION_SECRET`) that lasts 30 days. HttpOnly, SameSite=Lax, Secure on Cloud Run. Tokens are typed (session, gstate, invite, approve). | **Working** | `auth.js:43,52-64`. Tests: `security-fixes.test.js` "tokens say what they are". | There is no user table, no revocation and no logout everywhere: a stolen cookie works for 30 days. Rotating the secret logs out everyone. Locally the secret falls back to `'local-dev-session-secret'` (only when not on Cloud Run). |
| Claim a brand with a work email | The first person whose email is at the brand's own domain claims it, by tapping Claim, connecting an account or confirming the read. Free mail and shared platform domains are refused. | **Working** | `auth.js:120-145`, `ownDomain` at `:29`. Tests: `security-fixes` "domains…". | An email-domain match is weak proof (any mailbox at the domain, ex-staff, catch-all). Production needs DNS or store-admin proof. **On live, `arata-in` (the only carried-over brand) is unclaimed** (`/api/brands/arata-in/live` → `claimed:false`), so every "unclaimed brand" weakness below applies to it today. |
| Same-domain auto-join | Once a brand is claimed, anyone at the owner's domain joins as a member with no views, and the owners are emailed. | **Working** | `auth.js:90`, `joinedMail` at `:105`. | With no views, auto-joined members still count as **members**, so `gen` is true. They can spend AI money and read private data that is not filtered by seat (see S-3). |
| Team, invites, views (seats) | An owner invites by email with a set of views. The signed invite link lasts 14 days and works only for that Google account. Admin (owner) changes never leave a brand with zero owners. | **Working** | `auth.js:156-187, 247-258`. Tests: `team-seats.test.js` (11 tests). | Invites are capped at 50 per brand. The resend action re-mails the invite with no rate limit. |
| Read-only view for others | Non-members see the brand "in demo mode": routes that generate are refused (`genOk`). | **Partial** | `server.js:431-441`, `feed-service.js:1428-1429`. | Many reads and some writes skip `genOk`. See S-2, S-4 and S-5. |
| Admins (`ADMIN_EMAILS`, `FULL_ACCESS_DOMAINS`) | SquareUp people see everything on every brand but never claim one. | **Working** | `auth.js:31-34, 79`. `deploy.sh:14`. | The default `ADMIN_EMAILS` in both deploy scripts includes a **personal Gmail** (`darshanaritesh11@gmail.com`), so that one consumer account has full access to every brand. Anyone at `joinsquareup.com` or `shopos.ai` also gets full access to every brand. |
| `BUILD_SIGNIN` / `FEED_SIGNIN` | `FEED_SIGNIN=0` hides sign-in. `BUILD_SIGNIN=0` lets anonymous visitors confirm reads. | **Working** | `auth.js:46`, `server.js:354,467,525,533`. | When sign-in is off, `genOk` returns true for **everyone** (`server.js:439`). One wrong env var opens all paid paths. Live has both set to 1. |
| `DEV_MEMBER` | Locally, every viewer becomes a member of every brand. | **Working** | `server.js:431,439`. | Off when `K_SERVICE` is set, so it is safe on Cloud Run. |
| Old access requests and approve links | Removed: they now show "by invite". | **Cut-but-code-remains** | `auth.js:147-154, 218-222`. Test 11. | The dead `request()` and `/auth/approve` can be deleted. |
| Email via Resend | **Emails are really sent:** invites, "X joined your brand", admin changes, and "your moves are ready" notifications. | **Working (real sending)** | `auth.js:148-152`, `build.js:561-591`. `RESEND_API_KEY` is a secret in `deploy.sh:15` (not on the demo). | SCOPE.md says "Brew sending" was cut. That covers marketing email and WhatsApp only. **Transactional email is live and should be stated in SCOPE/DUMMY.** Abuse vector: see S-6. |

## 2. Demo site (demo.joinsquareup.com, `DEMO_MODE=1`)

| Feature | What it does | Status | Evidence | Risks / needs |
|---|---|---|---|---|
| Per-visitor sandbox | A `brew_demo` cookie, or `?d=<sid>`, gives each visitor a session. `private/`, `memory/`, `live/`, `updates.json` and `connected-ledger.json` are written under `demo/<sid>/`. The visitor owns their virtual copy of the brand. | **Working** | `demo-mode.js:9-37`, `brand-pack.js:103-117`. Tests: `demo-mode.test.js`. | The sid sits in share links (`?d=`), so anyone with the link takes over that session. That is by design, but there is no expiry. Session folders are never cleaned up, so the bucket grows. |
| Write and send guard | `globalThis.fetch` is wrapped: sending hosts (Resend, SendGrid, Twilio, Slack hooks) are always refused, and account hosts (graph.facebook, Shopify, etc.) are refused unless the request is a GET. | **Working** | `demo-mode.js:41-53`. Test "nothing on the demo site can write…". | Only `fetch` is guarded, not Puppeteer or other clients. This is fine today because nothing real is wired up. |
| Brand picker, tour | `/` serves `demo-picker.html`. `/tour/<slug>` starts an onboarding replay (a simulated build of about 100 s). | **Working** | `demo-routes.js:69-78, 21-29`. Live `/api/demo/brands` lists `arata-in` only. | Only one brand is demo-ready. |
| Prepare for demo | Admin only. Runs drafts, listening, ideas and stories ahead of time. | **Working (admin-gated)** | `demo-routes.js:54-67, 97`. | GET `/api/demo/<slug>/prepare` returns readiness to anyone, which is harmless. |
| New brand on demo | Refused unless the visitor is an admin. | **Working** | `demo-routes.js:101-103`. | |
| Generation on demo | `genOk` is **true for every visitor** (`server.js:439`). Real Claude, Gemini and video run for anonymous visitors. | **Working, by design** | Caps: `deploy-demo.sh:13` (1,500 text, 120 image and 15 video a day; treg $15 a day). | **Cost and DoS:** one script can use up the day's caps, after which the showcase is broken for real prospects. Needs per-session and per-IP caps. |
| `/api/me` on demo | Returns `user:null` for demo visitors, because `auth.handle` uses its own internal `user()` and not the demo override. | **Partial** | `auth.js:236-238` against `server.js:426`. Live `demo/api/me` → `user:null`. | A minor inconsistency. The client relies on `BREW_DEMO`. |
| `deploy-demo.sh`, `demo-sync.sh` | Deploy `brew-demo`. Copy prepared brands to `gs://brew-prototype-demo`. | **Untested here** | `tools/`. | Not run (would deploy and spend). |

## 3. Dummies: is each one tagged in three places?

| DUMMY.md row | UI tag | `DUMMY:` code comment | Verdict |
|---|---|---|---|
| 1 Connected accounts | `public/live.js` (3 tags), `composer.js` | `connectors/index.js:1,35`, `sim.js:1`, `common.js:3`, `server.js:443`, `live.js:2` | OK |
| 2 Connector cards and numbers | `app.js` `.is-dummy` on `p.dummy`, `p.demo`, `onlyWhen` and `live-` cards | `app.js:4`, `composer.js:20` | OK |
| 3 Health rings | `app.js` `healthCard` `.is-dummy` | `dummy/health.js:1`, `build.js:17,319`, `brand-pack.js:5` | OK |
| 4 Pro plan | `app.js:2699` dummy-tag plus fine print | `app.js:747` | **Honesty gap:** the UI says "no billing, nothing changes", but the move-page Pro button (`app.js:3882`) calls the **real** `POST /api/brands/:slug/pro` → `builder.goPro`, which raises the brand's real build spend cap from `BUILD_CAP` ($60) to `PRO_CAP` (≥$150) and resumes a paused build (`build.js:63,102,607-614`). The "dummy" Pro spends real money. This is not in DUMMY.md. |
| 5 Teammate replies | `jam-room.js` tag | `feed-service.js:1294` | OK |
| 6 Demo site | demo controls | `demo-mode.js` header (no `DUMMY:` keyword) | Minor: no literal `DUMMY:` comment |

**Simulated behaviour that is not tagged or listed:**
- **Slack hand-off toast.** "Posted to #growth with the full context" (`public/jam-room.js:281`) shows after `POST /api/work/:wid/jb/move` with `to=slack`, which only writes a system line (`jam-brief.js:234-243`). Nothing is posted. It is reachable only once the simulated Slack connector is on, but the toast is untagged and says it posted.
- **`/api/slack/workspace` and `/api/slack/post`** (`server.js:304-306`) are canned "dummy Slack" routes. They return `demo:true`, but DUMMY.md does not list them. Probably dead: remove them.
- **Slack connector stats** claim "Approvals from Slack: On" and "New moves post to #growth with an Approve button" (`connectors/sim.js:40`). They fall under row 1, but they describe a flow that was cut (Fake team flow in SCOPE).
- **Jam fallback copy** still offers "the ShopOS team" (`server.js:601,612`): stale name and a cut flow.
- **`seed.geo`** is derived from the dummy health ring (`brand-pack.js:195`). It is listed under row 3. OK.
- **`demo-data.js`** (the numbers in `demo.json`) is listed under row 1. OK.

## 4. Security findings

Severity is for this prototype on the public internet. "Prod" says what a real build needs.

**S-1 (High). Shared jam and brief links make anyone a full team member.** `shareJoin` (`server.js:448-451`) runs when `/api/share/<token>` is opened (`feed-service.js:1447-1452`). If the brand is claimed, **any signed-in Google account** is added as a member with **every view** ("Joined from a shared link"). The read-only brief link `/h/<token>` redirects into the jam with that share token (`handoff.js:17-22`). The brief text, with this link, is what "Share the brief" copies for pasting into WhatsApp, Slack or email. Scenario: a founder pastes the brief into an agency WhatsApp group, it gets forwarded, and a stranger who signs in with Gmail becomes a member. The stranger can then make paid work, read private moves, connected facts and private PDFs, and edit memory and facts. The link never expires and cannot be revoked (its HMAC covers only the tenant id). Prod: links grant read-only view, joining needs an invite, and links expire and can be revoked.

**S-2 (High). Team-private content is readable by anyone, without signing in.** Confirmed on live with GET:
- `GET /api/brands/arata-in/told` → 200. The goals, beliefs and facts Brew learned from **calls, notes and emails the team pasted** (for example the plans in a client's meeting notes).
- `GET /api/brands/arata-in/memory` → 200, 132 KB. The full brand memory repo, including team notes and session logs (`memory-routes.js:19-23` has no read check).
- `GET /api/brands/arata-in/facts`, `/heard`, `/findings`, `/build`, `/moves`, the PDFs and the zips are public by design. But `told` and `memory` hold team input, not public read data.

`told` (`server.js:473-476`) and memory GET have no member check, even on claimed brands. Prod: team-only, filtered by seat.

**S-3 (Med). Seats do not restrict server-side data.** Seats filter cards in a workspace (`seatOk`). But a member with "no views yet" (a same-domain auto-join) has `member:true`, so `gen:true`, private moves and PDFs (`server.js:509,546,566`), memory writes and facts edits. Prod: enforce seats on every route, or treat a zero-seat member as a visitor.

**S-4 (Med). Anonymous writes to unclaimed brands, some of them paid.** On an unclaimed brand (every brand until someone claims it, including `arata-in` on live, where `/facts` returns `canEdit:true` to an anonymous GET):
- `POST /api/brands/:slug/facts`: anyone can change the fact sheet that gates every number Brew writes (`server.js:512-519`).
- `POST /api/brands/:slug/memory`, `/memory/learn`, `/memory/consolidate`: anyone can write brand memory. Memory is read into **every jam prompt**, so this is persistent prompt injection. `learn` and `consolidate` call the AI (paid).
- `POST /api/brands/:slug/heard/asked`: registers threads that are re-read 1, 3, 7 and 14 days later (paid background reads).

None of these check sign-in or `genOk`. Prod: sign-in plus `genOk` on every write.

**S-5 (Med). Cost abuse by anonymous visitors.**
- `POST /api/brands` (a new read) is allowed signed-out, once per hour per IP (`build.js:121`). The limit is an in-memory map, so it resets on deploy, and IPv6 users can easily change address. The read stage is paid (crawl, treg, Ad Library, Claude). The global `DAILY_BUILD_CAP_USD` (250) caps the damage but also lets one actor block every real user for the day. The brief and moves (the expensive part) wait for a signed-in confirm, which is good.
- A signed-in person with **any** own domain can read their own site and confirm it (about $80 of moves each), 3 a day per Google account. Accounts are free.
- `POST /api/transcribe` (OpenAI) has no `genOk`. It is limited only to 80 per IP per hour, with up to 15 MB each.
- The SSE `/api/brands/:slug/events` and `/onboarding` streams are unbounded open connections (a DoS risk on a single instance).
- The global daily caps (`server.js:71-73`) are per instance and shared by everyone, so exhausting them is a DoS for real users.

**S-6 (Med). Anyone can make Brew email arbitrary addresses.** `POST /api/brands/:slug/notify` is explicitly exempt from the gen and sign-in gate (`server.js:525-529`). It stores up to 20 emails per brand, and if the build is already done it **sends at once** from `hello@send.joinsquareup.com` via Resend (`build.js:561-566`). Scenario: a script adds 20 victim addresses to each of many brands and gets bulk mail sent from SquareUp's sending domain, hurting its reputation. Prod: double opt-in and sign-in.

**S-7 (Med, by code reading, not verified live). PDF file names are not reduced to a basename.** `/b/<slug>/pdf/<name>` URL-decodes the name and joins it into the pack path (`server.js:557-567`). Assets go through `path.basename` (`brand-pack.js:143`), but PDFs do not, and local disk paths are normalised by `path.join`. Prod: apply `path.basename` plus an allow-list (`/^[\w.-]+\.(pdf|zip)$/`), and add a test. Assets (`a/[\w.-]+`) look safe.

**S-8 (Low-Med). The URL reader can reach internal addresses.** `build.start` refuses bare IPs and names with no TLD (`build.js:113`). But a public DNS name that resolves to a private or link-local address, or a redirect to one, is fetched (`reader/util.js:95`, `redirect:'follow'`), and Puppeteer runs with `--no-sandbox` (`reader/stages/site.js:45`). The GCE metadata server needs a header, which limits the impact on Cloud Run. Studio photo fetches (`server.js:261-266`) also fetch any URL a gen-allowed user gives. Prod: resolve DNS and block private ranges on every hop, run the browser in a sandbox, and cap response sizes.

**S-9 (Low). Workspace (tenant) ids are the only key to a workspace.** `t_` plus 4 random bytes (32 bits; `feed-service.js:206,211`). Anyone holding an id can read that workspace and make the harmless writes in `DEMO_OK`. Each guess on a cold id costs a GCS read (`store.js`), and there is no rate limit. The share token puts the tid in clear text. Prod: 128-bit ids, workspaces bound to their owner, a rate limit.

**S-10 (Low). Information exposure.** `GET /api/brands` lists every brand being read, including prospects mid-read (live shows `gullylabs-com` "Reading"). `GET /api/config` shows live AI mode and today's usage counters. `/heard` returns `spentToday`. The handoff HMAC key is derived from `ANTHROPIC_API_KEY` when `HANDOFF_SECRET` is not set (`handoff.js:11`), and to the literal `'local'` if neither is set. Its comparison is not constant-time.

**S-11 (Low). The admin perimeter.** Admin-only routes check correctly: `/api/admin/treg` (live 403), `POST /api/config` (switches the whole server between mock and live AI), demo `prepare`. The admin set is wide (a personal Gmail plus two whole company domains). If any one of those Google accounts is compromised, every brand is exposed.

**Checked and OK:**
- `TRUSTED_PROXY_HOPS=1` is set in both deploy scripts. `clientIp` takes the right-most X-Forwarded-For entry after skipping trusted hops (test in `audit-fixes.test.js:148`).
- `safeNext` blocks open redirects.
- CSRF on POSTs is mitigated by SameSite=Lax.
- Static file serving is confined to `public/`.
- `BUILD_BLOCK` is enforced in `hostOf`, `loadBrand`, `start` and the brand routes.
- `member-ctx` stops share-link holders from inheriting `t.member` (tested).
- Secrets come from Secret Manager. Keys are never sent to the page.
- The demo deploy has no `RESEND_API_KEY`.

## 5. What production needs (short list)
1. Shared links grant read only. Joining needs an invite. Links expire and can be revoked (S-1).
2. A member and seat check on `told`, memory GET, private moves and PDFs. Sign-in plus `genOk` on every write and every paid route: facts, memory, `heard/asked`, notify, transcribe (S-2 to S-6).
3. Rate limits per account and per IP, persisted (Redis or similar). Separate caps per demo session (S-5).
4. Basename and allow-list on PDF names. An SSRF guard in the reader (S-7, S-8).
5. Real ownership proof for claims. Session revocation. 128-bit tenant ids.
6. Fix the docs: Pro spends real money (DUMMY #4), the Slack hand-off and `/api/slack/*` are simulated, and transactional email is really sent.
7. HTTP-level tests for every route's auth gate.
