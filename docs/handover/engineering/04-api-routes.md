# 04 · API routes

*About 150 routes across 9 modules, as of `ea6cfd7`. There is no single route registry: each module matches its own paths with regexes. Read `serve()` in `server.js` for the order in which handlers are tried.*

**Recommended:** build one route table with the auth level declared for each route, and a test that checks it. Today "which routes exist, and who may call them" can only be answered by reading all nine modules.

Auth legend:
- **public**: no sign-in.
- **gen**: `genOk` — signed-in member, Brew admin/full-access domain (`joinsquareup.com`, `shopos.ai`), or an official-domain email on an unclaimed brand. Always true when sign-in is off (`FEED_SIGNIN=0`/no `GOOGLE_CLIENT_ID`), in `DEMO_MODE=1`, or with `DEV_MEMBER=1` locally.
- **team-if-claimed**: allowed when the brand is unclaimed **or** the viewer is a member (so on an unclaimed brand, anyone, even signed-out, can write).
- **tenant**: needs a workspace id `t_<8 hex>` (32 random bits; the id is the bearer key) in the path or `x-tenant`; non-GET routes also need gen unless listed in `DEMO_OK`.
- **signin**: any signed-in Google user.
- **admin**: `ADMIN_EMAILS` or full-access domain.

### 1 server.js own routes

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | /api/research | public (x-brand) | `routes` → `B().research.get()` |
| POST | /api/research/refresh | gen | `routes` → research.refresh |
| GET | /api/config | public | caps + today's in-memory usage (leaks counters) |
| POST | /api/config | admin | flip AI mock/live in memory |
| POST | /api/ai/hearted | gen | Claude (direct client), 3 variants |
| POST | /api/ai/remix-image | gen | Gemini/OpenAI image edit |
| POST | /api/ai/jam | gen | `jamStream` (streamed Claude) |
| GET | /api/slack/workspace | public | **canned Slack (cut feature, not in DUMMY.md)** |
| POST | /api/slack/post | public (the gen gate only covers `/api/ai/*`) | **canned Slack post** |
| POST | /api/transcribe | public, 80/hr per IP, 15 MB | OpenAI `gpt-4o-transcribe` (paid, unauthenticated) |
| POST | /api/brands | public read; `fresh` re-read needs signin; 1 brand/hr/network, 3/day/user | `builder.start` |
| GET | /api/brands | public | `builder.list()` — lists every brand |
| GET | /api/demo-brands | public | fetches demo site `/api/demo/brands` (10 min cache) |
| GET | /api/brands/:slug/told | public | learned.json view |
| GET | /api/brands/:slug/heard | public | listening view + schedule/spend |
| GET | /api/brands/:slug/heard/items | public | listen items |
| GET | /api/brands/:slug/heard/history | public | listen history |
| GET/POST | /api/brands/:slug/heard/asked | GET public; POST team-if-claimed | asked threads |
| GET | /api/brands/:slug/calendar | public | calendar.upcoming |
| GET | /api/admin/treg | admin | new treg tools + month spend |
| GET | /api/brands/:slug/moves/:n | public (private version for members) | move doc |
| GET/POST | /api/brands/:slug/facts | GET public; POST team-if-claimed | facts-desk |
| GET | /api/brands/:slug/status | public | builder.status |
| GET | /api/brands/:slug/summary | public | builder.summary |
| POST | /api/brands/:slug/notify | public | builder.addEmail (stores an email to notify) |
| GET | /api/brands/:slug/findings | public | findings.json |
| POST | /api/brands/:slug/confirm | gen + signin (claims the brand) | builder.confirm → brief + moves (the expensive step) |
| GET | /api/brands/:slug/build | public | builder.buildInfo |
| GET/POST | /api/brands/:slug/updates | GET public; POST gen | check / rewrite / auto |
| POST | /api/brands/:slug/retry | gen | builder.retry |
| POST | /api/brands/:slug/pro | gen | builder.goPro (dummy Pro: lifts the build cap) |
| GET/POST | /api/brands/:slug/check | GET public; POST gen + signin | checkData / applyCheck |
| GET | /api/brands/:slug/moves | public (+private for members) | move list |
| GET | /api/brands/:slug/events | public | SSE build stream |
| GET | /b/:slug/seed.js, /b/:slug/facts.js | public | pack client scripts |
| GET | /b/:slug/a/:file, /b/:slug/statics/:file | public | brand assets |
| GET | /b/:slug/team/statics/:file | members only (401 signed out, 403 not on the team) | the team's static ads from their private Move 21 (private/statics/) |
| GET | /b/:slug/pdf/:name | public (private PDFs for members) | move PDFs/zips |
| GET | /research/:file, /gen/:file | public | bucket-backed media |
| GET | /*, /:slug | public | static files / page |

### 2 auth.js

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /auth/google | public | PKCE + nonce, state signed |
| GET | /auth/google/callback | public | sets `fs_s` 30-day signed cookie |
| GET/POST | /auth/logout | public | |
| GET/POST | /auth/approve | public | legacy page ("access is by invite now") |
| GET | /join?t= | public → signin | invite accept |
| GET | /api/me | public | user, claim info |
| POST | /api/brands/:slug/claim | signin | claim |
| POST | /api/brands/:slug/request | signin | access request |
| GET/POST | /api/brands/:slug/team | owner/admin of brand | invite (Resend email), seats, remove, make_owner… |

### 3 connectors/index.js (DUMMY)

| Method | Path | Auth |
|---|---|---|
| GET | /connect/:id/start?brand= | signin (redirects to Google otherwise) |
| GET | /api/brands/:slug/live | public (member view if member) |
| POST | /api/brands/:slug/connect/:id | signin + gen; sync/disconnect need member |

### 4 memory-routes.js

| Method | Path | Auth |
|---|---|---|
| GET | /api/brands/:slug/memory[?q=] | public |
| POST | /api/brands/:slug/memory | team-if-claimed |
| DELETE | /api/brands/:slug/memory/m_<id> | team-if-claimed |
| POST | /api/brands/:slug/memory/learn | team-if-claimed (runs AI: `learnFromLive`) |
| POST | /api/brands/:slug/memory/consolidate | team-if-claimed (runs AI) |

Note: on an unclaimed brand, an anonymous visitor can add/delete brand memory and trigger paid AI here (no gen check).

### 5 moves-cadence.js

| Method | Path | Auth |
|---|---|---|
| GET | /api/brands/:slug/moves/cadence | team read (members get the private scorecard) |
| POST | /api/brands/:slug/moves/refresh | gen (weekly $ cap) |

### 6 feed-service.js + remix.js + jam-brief.js + drafts.js (tenant routes, `on(...)`)

Gate for all: valid tenant; writes need gen unless in `DEMO_OK` (marked ◦). `POST /api/tenants` (create) is ◦, so anyone can create unlimited workspaces (each a GCS file).

| Method | Path | File:line |
|---|---|---|
| GET | /h/:token | feed-service 1438 (public read-only brief, `?full=1`) |
| GET | /api/share/:token | feed-service 1447 (signin; joins the team) |
| POST ◦ | /api/tenants | 1058 |
| GET | /api/tenants/:id/onboarding (SSE) | 1059 |
| POST ◦ | /api/tenants/:id/ready | 1060 |
| GET | /api/tenants/:id/feed-config | 1061 |
| POST | /api/tenants/:id/focus | 1066 |
| PUT ◦ | /api/tenants/:id/state | 1088 |
| GET | /api/tenants/:id/feed | 1101 |
| GET | /api/tenants/:id/deck | 1102 |
| PUT ◦ | /api/tenants/:id/deck-layout | 1107 |
| GET | /api/tenants/:id/stories | 1108 |
| POST ◦ | /api/tenants/:id/stories/:ring/seen | 1109 |
| POST | /api/tenants/:id/research-card | 1111 |
| POST ◦ | /api/tenants/:id/pin | 1121 |
| GET | /api/tenants/:id/pulse | 1126 |
| POST ◦ | /api/tenants/:id/events | 1131 |
| POST ◦ | /api/tenants/:id/cards | 1132 |
| GET | /api/cards/:cid | 1140 |
| POST ◦ | /api/cards/:cid/feedback | 1141 |
| POST | /api/cards/:cid/actions | 1158 |
| POST | /api/cards/:cid/image | 1164 |
| POST | /api/cards/:cid/versions | 1176 |
| POST | /api/jams | 1184 (route=team → canned "ShopOS team" reply: cut feature) |
| POST ◦ | /api/jams/:jid/whatsapp | 1200 (**cut feature**: "Thread moved to WhatsApp") |
| GET | /api/tenants/:id/engine | 1201 |
| POST | /api/tenants/:id/watchers/:wid/run | 1202 |
| POST | /api/tenants/:id/watchers/run-all | 1209 |
| POST ◦ | /api/tenants/:id/clock | 1210 (advances a simulated clock and runs all watchers incl. the AI creative one — ◦ means a demo viewer can trigger AI here) |
| GET | /api/tenants/:id/work | 1235 |
| POST ◦ | /api/work/:wid/discard, /restore | 1237, 1245 |
| POST ◦ | /api/tenants/:id/notes/clear, /notes/read | 1251, 1252 |
| POST ◦ | /api/work | 1253 |
| POST | /api/work/:wid/iterate | 1264 |
| POST ◦ | /api/work/:wid/pick, /edit, /version | 1285, 1292, 1293 |
| POST | /api/work/:wid/send | 1296 (DUMMY teammate reply) |
| POST | /api/work/:wid/message | 1305 |
| POST ◦ | /api/work/:wid/approve, /reopen | 1311, 1312 |
| POST ◦ | /api/work/:wid/decided; /api/cards/:cid/decided | 1367, 1369 |
| GET | /api/tenants/:id/share | 1374 |
| GET | /api/work/:wid/handoff | 1375 |
| GET | /api/cards/:cid/learned, /page, /moves | 1393-1396 |
| POST | /api/work/:wid/reference, /link-change, /canvas | 1033-1045 |
| GET | /api/cards/:cid/remix, /batch | remix 721, 753 |
| POST | /api/cards/:cid/batch/queue, /remix | remix 763, 791 |
| POST ◦ | /api/changes/:chid/pick, /open | remix 757, 817 |
| GET | /api/tenants/:id/remixes | remix 818 |
| GET | /api/changes/:chid, /photos | remix 838, 947 |
| POST | /api/changes/:chid/more, /variants, /plan, /checks, /iterate, /knob, /image, /photo, /jam | remix 841-994 |
| POST ◦ | /api/changes/:chid/notes, /edit, /restore, /discard | remix 893, 969, 978, 988 |
| GET | /api/changes/:chid/pack, /impact | remix (jam chips, read-only; see 13-jam-chip-api.md) |
| POST | /api/changes/:chid/remake | remix (new version as video, carousel or image; see 13-jam-chip-api.md) |
| GET | /api/tenants/:id/versions/:oid, /learning | remix 1008, 1009 |
| PUT ◦ | /api/tenants/:id/learning/lessons/:lid, /learning/rules/:rid | remix 1010, 1020 |
| POST ◦ | /api/tenants/:id/learning/rules | remix 1015 |
| POST | /api/work/:wid/plan/answer, /plan/add, /plan/ask | remix 1029-1053 |
| GET | /api/cards/:cid/brief | jam-brief 202 |
| POST | /api/work/:wid/jb, /doc, /doc/sync, /doc/ask, /doc/add, /jb/import, /doc/ship | jam-brief 203-254 |
| POST ◦ | /api/work/:wid/jb/move | jam-brief 234 |
| POST | /api/work/:wid/draft | drafts 150 |
| POST ◦ | /api/work/:wid/draft/:did/drop | drafts 157 |

(The `DEMO_OK` regex also allows `/changes/:id/undo` and `/work/:id/live`, which have no route.)

### 7 demo-routes.js (only when `DEMO_MODE=1`; checked first)

| Method | Path | Auth |
|---|---|---|
| GET | /, /index.html | public (picker) |
| GET | /tour/:slug | public (new session) |
| GET | /api/demo/brands | public (admins see unready brands) |
| GET | /api/demo/:slug/session | public |
| POST | /api/demo/:slug/start, /connect | public (simulated connectors) |
| GET/POST | /api/demo/:slug/prepare | POST admin |
| POST | /api/brands | non-admins get existing brand or an error |
| GET/POST | /api/brands/:slug/status, /confirm, /check, /updates, /retry | simulated for the session; updates/retry admin-only |

Total: ~150 routes across 9 modules, hand-matched with regexes in each module. There is no single route registry, so "which routes exist" can only be answered by reading all of them.

---
