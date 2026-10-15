# 06 · Config and secrets

*As of 2026-10-15. The complete table of 88 `process.env` reads, plus about 25 scheduler `env` keys, is in `audits/F-infra.md` §3. This page has the ones you need on day one.*

## Where config comes from

| Source | What |
|---|---|
| `deploy.sh` `--set-env-vars` | prod env (`shopos-feed`) |
| `tools/deploy-demo.sh` | demo env (`brew-demo`, `DEMO_MODE=1`) |
| Secret Manager (project `squareup-492617`) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TREG_TOKEN`, `YOUTUBE_API_KEY`, `RESEND_API_KEY` (prod only), `FEED_SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: all `:latest` |
| Local | `ENV_FILE`, default `../ugc-factory/.env`. **This depends on another repo.** Copy the keys into your own `.env` and set `ENV_FILE`. treg auth falls back to `~/.treg/config.json`. |

Live env matches the deploy scripts exactly, with one exception, covered in Drift below.

## The switches you will use

| Var | Default | What it does |
|---|---|---|
| `AI_MOCK=1` | off | Every AI path returns free scripted output. Also turns off `heal()` and the free Ad Library reader. **Always on for tests.** |
| `TREG_OFF=1`, `RESEARCH_OFF`, `LIVE_OFF`, `BUILD_RESUME_OFF`, `HEAL_OFF`, `EVIDENCE_OFF`, `MOVES_REFRESH_OFF` | off | Turn off paid or background subsystems locally |
| `FEED_SIGNIN` | 1 | **0 turns sign-in off, which makes every paid path open to everyone** (`genOk` returns true). Never set it to 0 on a public URL. |
| `BUILD_SIGNIN` | 1 | Sign-in before re-reads and confirm |
| `DEV_MEMBER=1` | off | Locally, you are a member of every brand. Ignored on Cloud Run. |
| `DEMO_MODE=1` | off | Demo site behaviour (per-visitor sandbox, simulated accounts, send guard) |
| `K_SERVICE` | (Cloud Run sets it) | Turns on the GCS mirror and background jobs |
| `PUBLIC_URL` | https://brew.joinsquareup.com | Links in emails and briefs |
| `RESEARCH_BUCKET` | `brew-prototype`. **`video-read.js` defaults to the old `squareup-feed`.** | Bucket |

## Spend caps (effective in prod)

| Cap | Prod value | Persisted? |
|---|---|---|
| `BUILD_CAP_USD` (per brand) | **$60** (code default $120; a full build costs about $100–150) | yes |
| `BUILD_CAP_PRO_USD` | max(150, 2.5×cap). The **Dummy Pro button raises the cap to this real value.** | yes |
| `DAILY_BUILD_CAP_USD` (all builds) | $250 | yes (`_brew/spend-day.json`) |
| `TREG_DAY_CAP_USD` | $40 (demo $15) | **no: in memory, reset on every deploy** |
| `DAILY_TEXT_CAP` / `DAILY_IMAGE_CAP` / `DAILY_VIDEO_CAP` / `DAILY_VOICE_CAP` | 1500 / 120 / 15 / 60 calls | **no: in memory** |
| Per brand: social $3/day, drafts $4/day, pulse $3/run, weekly moves $3/week, listening $0.60/run | | yes (state files) |
| `REFRESH_AUTO_CAP_USD` / `REFRESH_CAP_USD` | $14 / $60 | per run |

**Not capped in dollars:**
- Claude calls from `research.js` and `live-watch.js`, which use their own clients;
- OpenAI transcription, limited only to 80 per hour per IP;
- memory learn and consolidate;
- the Move 00 index call, which skips `canSpend`.

## Abuse limits

- 1 new brand read per IP per hour when not signed in. The counter is in memory.
- 3 brands per signed-in user per day (`BUILD_PER_USER_DAY`).
- `BUILD_BLOCK=wearcomet-in,everaw-in` (demo: `wearcomet-in` only).
- `ADMIN_EMAILS` (default in `deploy.sh`): param@joinsquareup.com, hello@joinsquareup.com, darshanaritesh11@gmail.com. `FULL_ACCESS_DOMAINS`: `joinsquareup.com`, `shopos.ai`. Every account on these lists sees every brand.

## Drift and landmines

1. **Max instances.** The service-level annotation `run.googleapis.com/maxScale: '100'` doesn't match the revision's `maxScale: '1'`. A console edit or a deploy without `--max-instances=1` would scale out and corrupt state.
2. **`HANDOFF_SECRET` is unset.** Share-link signing falls back to `ANTHROPIC_API_KEY`, so **rotating the Anthropic key breaks every shared brief link.** Set it.
3. **`APIFY_TOKEN` is not set on Cloud Run.** The Nykaa, Flipkart and Myntra listening sources are therefore silently off in prod.
4. **The caps don't match between sites.** Prod `BUILD_CAP_USD=60` vs demo 120, and treg prod $40 vs demo $15. It looks accidental.
5. **Prod and demo share `FEED_SESSION_SECRET` and the OAuth client.** A session token is valid on both.
6. **Unused secrets left over from cut features:** `FEED_SHOPIFY_CLIENT_ID/SECRET`, `FEED_VAULT_KEY`, `PAGESPEED_API_KEY`.
7. **The runtime service account is the default compute SA.** It can read about 130 unrelated company secrets. See `09-security-and-access.md`.
8. Cloud Run labels `cache-reset: '1791973343'` are an undocumented manual cache-bust marker.
