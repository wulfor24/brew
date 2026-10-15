# 08 · Testing and QA

## Run the suite

```bash
AI_MOCK=1 node --test test/*.test.js
```

**Result on 2026-10-15 at `ea6cfd7`:** 222 tests, **219 pass, 0 fail**, 3 skipped, in 1.2 s. It is free, with no AI and no network.

Skipped tests:
- "every card's action opens its jam…": needs a local `.brands/` pack.
- "Chromium renders the mocks at 1080 x 1350": needs Chrome.
- "live: every declared treg endpoint exists": needs the live network.

Don't set `TREG_OFF=1` while testing: the treg cache test then fails. Use `AI_MOCK=1` only.

## What the 34 test files cover

| Area | Files (tests) |
|---|---|
| Read | `reader-retry` (2), `adlib-fallback` (3), `treg-cache` (4), `treg-map` (6), `audit-fixes` (9), `facts-desk` (5), `audit-server-fixes` (6) |
| Moves | `moves-cadence` (13), `moves-evidence` (6), `cadence-refresh` (6), `claim-rules` (4), `retire` (3), `measure-families` (6), `measure-stats` (7) |
| Feed | `value` (4), `notes` (4), `stories-life` (5), `card-plan` (8), `card-action-map` (5), `listen-ideas-wiring` (19), `listen-signals` (11), `pulse-calendar-video` (10), `learned-rank` (2), `ui-audit-r3` (4) |
| Jam | `first-drafts` (8), `image-guard` (5), `image-fallback` (6), `product-match` (4), `brand-memory` (8), `brand-learnings` (15), `jam-coverage` (2) |
| Accounts and demo | `security-fixes` (7), `team-seats` (11), `demo-mode` (4) |

## What has no test (ranked by risk)

1. **HTTP route gating.** No test boots the server and checks who may call each route. That is how the open `/told`, `/memory`, `/notify` and `/transcribe` routes went unnoticed.
2. **Ranking and layout:** `score`, `rank`, `feed` in `feed-service.js`.
3. **Move verification:** `verify`, `scanNumbers`, `claimCheck`, `fixCall`, `evalExpr`. Also the rewrite path: `diffLedgers`, `mergeLedger`, `triage`, `rewriteNow`, `freshReload`.
4. **Every reader stage** (`reader/stages/*`, about 150 KB), plus the Ad Library HTML parser and name matching.
5. **Share the brief:** `handoff.js` tokens, the `/h/` page, ship and freeze, BR numbering.
6. **PDF render and zips**, and the `status.pdfs` bookkeeping.
7. **The simulated replies and plan answers** (`colleagueReply`, `plan/ask`), and every path where a dummy leaks into real data.
8. **The daily caps** and the weekly-moves lock.
9. **The whole client:** `public/app.js` (546 KB), `jam-room.js`, `canvas.js`, `composer.js`, `share.js`, `live.js`.
10. **Storage on GCS** (`store.js`, `gen-store.js` remote mode, `brand-pack.js` remote), and the Dockerfile build.

## Paid probes (only run on purpose)

`test/cadence-probe.mjs`, `test/ideas-probe.mjs`, `test/listen-probe.mjs` and `test/memory-probe.mjs` call real models and treg. Ask before you run one: building capability must not spend money unless someone agrees first.

## Data audit tool

`audit.py` checks every brand's saved external data for errors shown as "none", missing versions and so on.
- **It is not inside `brew/`.** It lives at `../.claude/skills/brew-external-data/audit.py`, together with the `brew-external-data` skill that CLAUDE.md requires.
- Its default bucket is the old `squareup-feed`, so run it as `python3 audit.py brew-prototype`.
- Move the skill into `brew/.claude/skills/` and update its defaults. Its SKILL.md still says Brew runs on feed.joinsquareup.com.

## Manual QA before a demo

The suite can't see these, so check them by hand:
- [ ] Open `/arata-in` on the demo site. The feed loads, and the first screen has picture cards in seats 2 and 6 that the brand can make (not two rival ads).
- [ ] Every connector or health card shows the dashed **Dummy** tag.
- [ ] Open a card, then its jam. Ask the brief for a change. Make one image draft. It shows the brand's real product.
- [ ] Share the brief. The copied text has a BR number and a `/h/` link, and the link opens.
- [ ] `/api/config` shows `ai: live`, and today's `used` counts are below the caps.
- [ ] The treg balance is positive. When it isn't, every treg source fails and the cards thin out.

## Gaps in the tooling

There is no CI, no lint, no type checking and no pre-commit hook. `deploy.sh` is the only gate, and `tools/deploy-demo.sh` runs no tests at all.

Recommended first steps:
1. A GitHub Action that runs `npm ci`, `node --check` and the tests.
2. ESLint and Prettier with a maximum line length. Lines currently run to 1,425 characters.
3. A smoke test that boots the server with `AI_MOCK=1` and checks the auth gate on every route from one route table.
