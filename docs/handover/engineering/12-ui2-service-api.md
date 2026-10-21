# Brief, Your feed and Drop service API (2026-10-16)

Built with the UI2 makeover and kept when UI2 was removed (2026-10-21; Brew has one version): Send brief with tracked status, Your feed (tuning), Drop anything, and one guest fix.
Every route sits behind the feed service (`feed-service.js`): it needs the workspace (`/api/tenants/:t/...` or the `x-tenant`
header), runs as the signed-in viewer, and answers JSON. Errors come back as `{ error }` (HTTP 200 unless `status` is set).
Tests: `test/brief-tune-drop.test.js`.

## 1. Send brief and its status (`brief-status.js`, `jam-brief.js`, `jam-mail.js`)

**Send**: the existing `POST /api/work/:wid/doc/ship` with `{ to: 'shopos', force?, decided? }`.
- Freezes the brief as before, then emails the WHOLE brief to `SHOPOS_EMAIL` (body, deliverables, assets with images, rules,
  done-when, where, sender). Every send emails; a retry of the same send does not. Demo site: never emails.
- Returns `{ work, share, status: 'sent' }`. `work.jamBrief` now has `status`, `statusAt`, `sender {email,name}`, `history[]`
  (newest first: `{ s, at, by, name?, note }`). Sending again starts a new `sent` line and keeps the old history.
- `{ to: 'team' }` is unchanged: copied, nothing sent, `status: null`.
- If the email did not go, the jam says "ready for the ShopOS team … Paste it" (never "sent").

**Status** (staff only: shopos.ai / joinsquareup.com, `auth.isAdmin`): `POST /api/work/:wid/brief/status` `{ status, note? }`.
- `status`: `received | in_progress | needs_info | delivered` (`needs_info` needs a `note`). Allowed moves:
  sent → received / in_progress / needs_info / delivered; received → in_progress / needs_info / delivered;
  in_progress ↔ needs_info → delivered; delivered → in_progress (re-open).
- Writes a jam line (`from: 'brew'`, `status` set; with a note it is a real reply and folds into the brief), a notification
  (`kind: 'needs_you'` for needs_info), and emails the sender. Non-staff: `{ status: 403 }`.
- Returns `{ work, status, history }`.

**The pill**: `GET /api/tenants/:t/work` and `GET /api/tenants/:t/feed` both carry
`withTeam: { n, needsInfo, items: [{ wid, title, ticket, status, label, at }] }`: briefs sent and not yet delivered
(discarded/archived excluded, a guest sees only their jam's). Labels: Sent, Received, In progress, Needs info from you, Delivered.

Guests can't call `doc/ship` or `brief/status` (not in `GUEST_DO`).

## 2. Your feed (`member-tuning.js`)

- `GET /api/tenants/:t/tuning` → `{ tuning: { weights, topics, notes, ignored, at }, agents: [{ id, name, weight }], weights: ['less','normal','more'], signals, mine }`.
- `PUT /api/tenants/:t/tuning` `{ weights?: { creative|performance|storefront|visibility|crm: 'less'|'normal'|'more' }, topics?: [string] }` (≤12 topics) → same shape.
- `signals` ("Picked up from your choices"): `[{ id, kind: like|skip|fewer, text, why, n }]`, read live from hearts, Not for me and Fewer.
  `DELETE /api/tenants/:t/tuning/signals/:sid` (URL-encode the id; it has colons) stops it counting;
  `POST /api/tenants/:t/tuning/signals/:sid/restore` undoes that.
- `DELETE /api/tenants/:t/tuning/notes/:nid` removes a "My preferences" note.
- Ranking: less −4, more +4 per agent; +2 per matching topic (two at most). Each card's score has `tune` (see `/deck`, `/engine`).

## 3. Drop anything (`drop.js`)

`POST /api/brands/:slug/drop` (send `x-tenant`; `slug` must be the workspace's brand) with `{ dest, text? | data?, name?, wid? }`.
- Content: `text` (up to 4,000 characters; longer is cut, `cut: true`) or `data` = a `data:image/(png|jpeg|webp);base64,…` URL up to 8 MB
  (an image may carry a `text` caption). Same limits as the memory note and the jam photo.
- `dest: 'memory'`: brand memory (team only; 401/403 otherwise; `{ off: true }` when memory is off). → `{ ok, added, updated, confirmed, file }`.
- `dest: 'prefs'`: a note in this person's tuning (and their personal memory, for members). → `{ ok, note }`.
- `dest: 'once'`: with `wid`, a photo becomes that jam's reference photo (drafts use it), text is said in the jam (→ `{ ok, work }`);
  without `wid`, it waits on the next ask (→ `{ ok, pending }`) and rides on it (a photo also lands on the jam of the ask's card).
- Photos are saved like jam photos (`gen/ref-<hash>.<ext>`, returned as `file`).

## 4. Guest hole closed

`guestAllows` (exported from `feed-service.js`): a jam guest can no longer call `/api/changes/:id/discard` or `/restore`
(discarding the change discarded the jam with it, `remix.js`). Everything else a guest could do is unchanged.
