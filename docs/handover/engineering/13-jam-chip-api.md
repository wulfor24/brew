# 13 · Jam chip API (UI2)

Three routes in `remix.js` back the chips on the new one-page-per-card jam. All three take a change id (`ch.id`, the
`change.id` the jam already has) and the usual tenant header (`x-tenant`). Errors come back as `{ error }` (HTTP 200,
like every other tenant route) unless a status is noted. Tests: `test/jam-chips.test.js`.

Guests of a shared jam can call all three on that jam's change (`guestOk`). A demo-mode visitor without make rights can
read the pack and the impact, but `remake` is not in `DEMO_OK`, so it returns the usual demo 403.

## GET /api/changes/:chid/pack?v=<n or version id>

This is the read-only "publish pack" for the "Post to Instagram"-style chips. Brew writes to no account. It builds a zip
of one version (the head version when `v` is left out), saves it once to `gen/pack-<hash>.zip`, and returns its URL. The
zip is then served by `/gen/` like any other file Brew makes.

```json
{ "pack": { "url": "gen/pack-3f…zip", "name": "arata-change-page-copy-v2.zip", "version": 2, "versionId": "v_…",
  "family": "store", "familyName": "Store change", "files": ["README.txt", "section.html", "section.txt", "links.txt"],
  "todo": ["…what the team still has to do…"], "readme": "…README.txt text…", "readOnly": true } }
```

The UI downloads it with `<a href="/{url}" download="{name}">`. An unknown `v` returns status 404 and
`{ error: 'That version isn’t on this change.' }`. Show `todo` next to the chip when it isn't empty.

| Family | In the zip (always `README.txt` first; `links.txt` when there are links) |
|---|---|
| meta_ad, social | `media/creative-1x1`, `-4x5` and `-9x16`. The made shape is the original file; the other shapes are centre crops made with ffmpeg. Carousel and slide photos go in `media/card-NN` or `media/slide-NN`, with `copy.txt` (primary text, headline, CTA, caption, hashtags, slides, settings). |
| post | `copy.txt`, `where.txt` (each place, URL and rule) and the media. |
| crm | `whatsapp-template.txt`, `email.html` (`draft-mocks.js` emailHtml), `email.txt` and `sms.txt` (cut to 160 characters). |
| store | `section.html` and `section.txt`. |
| listing | `listings.csv` (marketplace, product, current/new title, bullets, search terms, images) and `takedown-request.txt` for a takedown. |
| vis | `faq.html` and `faq-jsonld.html` (FAQPage). An llms.txt change adds `llms.txt`; a schema fix adds `product-schema.json`. |
| search | `google-ads-editor.csv` (an Account › Import › From file sheet: campaign row, RSA row, one row per keyword with its match type, and the negatives). |
| setup | `checklist.md` |
| brief | `shot-list.md` |
| meta_ops | `ads-manager-changes.csv` and `do-this-in-ads-manager.txt` |
| print | `print.pdf`, made by puppeteer like pdf/render.js. Set `PACK_PDF=0` to skip it. When it can't be made, the zip holds `print.html` and a todo. `print-spec.txt` comes in both cases. |
| decision | `decision.md` |
| any family, remade or first-drafted version | `media/<as>-NN.*`, `media/<as>-video.mp4` and `<as>.txt` (slides, script and overlay). |

The README says Brew changes nothing in the team's accounts. Bump `PACK_V` in remix.js whenever a family's files change.

## GET /api/changes/:chid/impact[?fresh=1]

This is the "Projected impact" chip. The result is an estimate for the head version, never a measured result. It is
cached on the change per head version (`ch.impact[<versionId>:ai|rules]`), and a new version gets a new projection.

```json
{ "impact": { "metric": "Cost per first order", "low": 4.3, "high": 17.3, "unit": "% better", "direction": "down",
  "window": 14, "windowLabel": "the first 14 days after it goes live", "confidence": "low|medium|high",
  "basis": ["Brew graded this move 3 of 5 …", "Meta spend, 30 days: ₹1,20,000 (Meta)", "How it’s judged: …"],
  "assumptions": ["…", "Assumed, not from your facts: …"], "by": "ai|rules", "estimate": true,
  "label": "A projection, not a promise", "note": "…(rules only)", "aiError": "…(when the AI failed)",
  "gaps": ["…couldn’t be read … the next refresh tries again"], "cached": true }, "version": 2 }
```

- Always print `label`. `low`/`high` are in `unit`. `direction` says which way the metric moves when the change works.
- The inputs are:
  - the move's grade (`B().moveValue`, from value.js);
  - the measure family the change is judged as (`MEASURED_AS` in remix.js, then measure-families.js for the metric and window);
  - the card's measure plan, for the tool and the baseline;
  - the member's real connector rows (`realRows(t.liveLedger)`; demo rows never count).
- The AI is `claudeTool` (the configured provider, Vertex Gemini today). When it is off (mock or demo) the result is the rule-based range plus `note`. When the AI fails, the rules range comes back with `aiError` set; that result isn't cached, so the next call tries the AI again.
- A basis line whose number isn't backed by the fact sheet or the account rows is moved to `assumptions`.

## POST /api/changes/:chid/remake  `{ "as": "video" | "carousel" | "image" }`

This is the "Make it a reel / carousel" chip, and it works for any family. It makes a new version of the same change. The
version's `pkg.draft` holds the new format, the same shape the card's first draft uses (seedV0), so the stage can render
it the way it renders v0:

```json
{ "change": { …pubChange, "pkg": { "draft": { "as": "carousel", "remade": true, "pending": true, "images": [],
  "video": null, "poster": null, "ratio": "4:5", "slides": [{ "text": "…", "visual": "…" }], "script": [{ "beat", "shot", "line" }],
  "overlay": "…", "imageBrief": "…", "title": "…" } }, "remakePending": { "as", "step" }, "remakeError": null },
  "version": { "id": "v_…", "n": 3 }, "as": "carousel", "words": "ai|package", "making": true, "why": null }
```

- The words come from the AI when it may run (fact-gated; it falls back to the package's own words) or from the package
  itself. A short package is filled out with the product's own facts.
- `making: true` means media is being made in the background:
  - carousel: Gemini photos with the words set by Chromium (drafts.js makers);
  - image: one Gemini photo;
  - video: a 9:16 frame, Veo, and a voiceover.

  Poll `GET /api/changes/:chid` until `remakePending` is null. The media lands on that version's snapshot, and on
  `pkg.draft` if that version is still the head. On failure, `remakeError` is set and the words stay on the version.
- `making: false` comes with a `why`: AI is offline or this is demo mode (words only), or today's image budget is used up.
- Other errors:
  - `{ error }` when the change is live (`editable`), or when a remake is already running;
  - status 400 for a bad `as`.
- Locally, `MEDIA_FAKE=1` makes the media for free (ffmpeg and Chromium stand-ins).
