# Brew: Engineering handover (start here)

*State as of **2026-10-15**. Commit `ea6cfd7` is live on https://brew.joinsquareup.com and https://demo.joinsquareup.com. GitHub: `wulfor24/brew` (private, `main`).*

## What Brew is

A **realistic prototype** that engineering picks up and continues. It is not the product. A person pastes a brand's URL, and Brew:

1. **Reads** the store, reviews, Meta ads, rivals, AI answers and socials, live on screen.
2. Writes about **51–70 strategy "moves"**, each a long document with a PDF.
3. Turns them into a ranked **feed** of cards. Listening, ideas, stories and watchers keep adding to it.
4. Lets the team **jam** on any card in a studio: brief, drafts (image, carousel, video, voice, text), versions.
5. Ends with **Share the brief**. That copies a frozen brief and a read-only link. Nothing is sent or run.

**Cut on purpose:**
- **Do it now:** nothing acts on a brand's accounts.
- **Real connectors.**
- **Measurement.**
- **Marketing email and WhatsApp to customers.**
- **The fake team flow.**

**Simulated and tagged "Dummy":** connected accounts, health rings, the Pro plan, teammate replies, and the demo site.

**Real and in scope:**
- Google sign-in and teams.
- **Brew's own emails to the brand's team:** invites, joins, "your moves are ready".

Read `SCOPE.md` and `DUMMY.md` (repo root) before changing anything.

## The honest summary

- **What works:** the whole loop works end to end, with real AI and real data, for **one brand, Arata (`arata-in`)**. The read is careful and sourced, the moves are deep, the feed is rich, and the jam is the strongest part. The free test suite passes (219 of 222; 3 skipped, 0 failing).
- **What to fix first (P0 in `11`):** places where **simulated content passes as real**:
  - invented teammate sign-offs that reach the shared brief;
  - simulated account numbers used as evidence;
  - copy that promises cut features.

  Also: numbers that disagree across screens, and festival dates hard-coded to November 2026.
- **Cost and safety:**
  - Caps reset on every deploy.
  - Anonymous visitors can trigger paid AI.
  - The runtime service account can read every company secret.
- **Debt:**
  - Huge, dense files.
  - Everything assumes one Cloud Run instance.
  - No CI, and no route or client tests.

## Reading order

| # | Doc | Read it to… |
|---|---|---|
| 01 | `01-architecture.md` | understand the process, the flow and the storage |
| 02 | `02-feature-audit.md` | **know the status of every feature (96 rows)** |
| 03 | `03-data-model.md` | find your way around a brand pack and a workspace |
| 04 | `04-api-routes.md` | see every route and who may call it |
| 05 | `05-ai-and-external-data.md` | see the models, treg endpoints, costs, and the data rules |
| 06 | `06-config-and-secrets.md` | see env vars, secrets, caps and drift |
| 07 | `07-deploy-and-ops.md` | deploy, roll back, read logs, and learn from past incidents |
| 08 | `08-testing-and-qa.md` | run tests, see the coverage gaps, and do QA before a demo |
| 09 | `09-security-and-access.md` | fix now vs before real brands onboard |
| 10 | `10-dummy-to-real.md` | see every dummy, its leaks, and the path to real |
| 11 | `11-known-issues-and-debt.md` | **see the ranked fix list** |
| — | `audits/A–F` | get file:line evidence for everything above. The references are as of `ea6cfd7` and can be a line or two out. |

## First day: get it running

```bash
cd brew
rm node_modules && npm ci                        # node_modules is a symlink into the archived feed/ repo
AI_MOCK=1 node --test test/*.test.js             # 219 pass, 3 skip, 0 fail
```

Copy a pack locally (read-only):

```bash
gcloud storage cp -r gs://brew-prototype/brands/arata-in .brands/
```

Run with every AI path mocked:

```bash
AI_MOCK=1 BUILD_RESUME_OFF=1 RESEARCH_OFF=1 LIVE_OFF=1 FEED_SIGNIN=0 DEV_MEMBER=1 node server.js
```

Then open http://localhost:4200/arata-in.

- **Keys:** read from `../ugc-factory/.env` by default. Make your own `.env` and set `ENV_FILE`. Vertex (Gemini, Veo) needs a `gcloud` login on project `squareup-492617`.
- **Paid calls:** anything without `AI_MOCK=1` can spend money. Ask before running the `test/*-probe.mjs` files.
- **Deploying:** `./deploy.sh` for prod, `tools/deploy-demo.sh` for demo (run the tests yourself first). See `07`.

## House rules (from CLAUDE.md, still binding)

1. **Never re-add a cut feature without a product decision.** Keep the three Dummy markers in step: the UI tag, a `DUMMY:` comment in the code, and a row in `DUMMY.md`.
2. **External data:** errors are never shown as "none". Paid sources fall back to free ones. Every treg call goes through `treg.js`. Bump stage versions so `heal()` fixes saved reads.
3. **Every fix must work for every brand.** Never special-case one.
4. **Accuracy above all:** no invented numbers, quotes, founders, reviews or backstory. Unbacked means "to confirm".
5. **Never deploy from the archived `feed/` repo.**

## Who decided what

The decisions log is in `../product/06-decisions-log.md`.
