# Brand memory

What Brew knows about a brand: how they talk, how they make creatives, what they sell and how they price it, who buys, which channels do what, the lines they never cross, and what has worked. One memory per brand, shared by everyone who works on it, and it improves as the team uses Brew.

Code: `brand-memory.js` (memory), `memory-routes.js` (HTTP), hooks in `learn.js`, wiring in `server.js`, first drafts in `drafts.js`.
Tests: `test/brand-memory.test.js` (free). Real probe: `node test/memory-probe.mjs [slug ...]`.

## Two designs, one memory

### 1. Cognition's agent memory repo: the readable layer

Cognition stores memory as a plain folder, usually a git repo, of markdown files. `MEMORY.md` is the short entry point and index. Each fact is a one-line bullet with metadata (`[source: …; added: …]`). Files link with `[[path]]`. Agents load the repo, read only what the task needs, edit lines as they learn, and push. Git history records every change. A separate "dreaming" pass merges duplicates, removes stale lines and resolves contradictions using sources. Scopes are separate repos: personal, swarm and team. A session can load several repos and writes each memory to the right one.

What we keep from it, per brand:

```
memory/repo/MEMORY.md                  index: one line per topic, its count and its strongest line
memory/repo/brand/voice.md             Voice and tone
memory/repo/brand/creative-style.md    How they make creatives
memory/repo/brand/products.md          Products and range
memory/repo/brand/offers.md            Offers and pricing
memory/repo/brand/audience.md          Audience
memory/repo/brand/channels.md          Channels and stack
memory/repo/brand/rules.md             Rules (never break these)
memory/repo/brand/what-works.md        What works (results, decisions, sign-offs)
memory/repo/members/<mb_hash>.md       one person's own preferences (only they see it)
memory/repo/runs/<run>.md              one jam/session (expires after 21 days)
memory/repo/LOG.md                     change log, newest first, with - before / + after
```

Every line looks like this:
`- Price is in the hook of 7 of 8 live ads (price first), e.g. "₹5,899 | The Hukum Collection." [source: Meta Ad Library, read 2026-10-13; added: 2026-10-14; seen: 3; id: m_454a159ce0]`

The repo is rendered from the facts, so it never drifts from them. A file is written to storage only when its content changes.

### 2. mem0: the fact layer

mem0 (open source, `mem0ai/oss` `Memory` class) stores atomic memories in a vector store. `add()` sends messages through an LLM to extract facts. For each fact it retrieves the most similar existing memories. A second LLM call then decides ADD, UPDATE, DELETE or NONE against them (mem0 v3 moved to additive extraction with linking and hash dedup). `search()` embeds the query and ranks memories. Memories are scoped by `user_id`, `agent_id` and `run_id`. A history table records every change.

What we keep from it:

- `add(slug, text, { scope, memberId, runId, source })`: an LLM extracts facts, each fact is embedded, and its top 5 similar facts in the same scope are retrieved. One LLM call then decides ADD / UPDATE / DELETE / NONE for all new facts.
  - **UPDATE** rewrites the existing line and logs the diff.
  - **DELETE** removes the line the new fact contradicts and adds the new fact.
  - **NONE** confirms the line: `seen` goes up and the new source is kept.
- Scopes:

  | mem0 | Brew | Who sees it |
  |---|---|---|
  | `user_id` | `brand` | everyone at the brand |
  | `user_id` per person | `member` (`mb_` + sha256 of the email, 12 hex) | that person only, ready for roles and team members |
  | `run_id` | `run` (a jam/session) | that session |

  A personal preference said at brand level ("I like…") goes to that person's member scope when we know who they are.
- `search(slug, query)`: hybrid score of 0.7 × cosine (Gemini embedding) + 0.3 × word overlap, plus a small weight for strength. Strength comes from measured results, team notes, confirmations and recency.

## Self-hosted: why a re-implementation, not the `mem0ai` package

`mem0ai@3.3.1` OSS was installed and read. Its module statically imports `better-sqlite3`, a native addon, even for the `memory` vector store. It keeps vectors and history in local SQLite files under `~/.mem0`. Its Anthropic peer is `^0.40` (this app uses `^0.133`), and its default LLM and embedder are OpenAI. On Cloud Run the local disk is lost on every restart, and a native module is one more thing to build into the image.

So the same algorithm runs on what the app already has:

- `ai.js` structured output (Sonnet) for extraction and decisions.
- Vertex `gemini-embedding-001` at 256 dimensions, through the app's own Google token.
- Brand-pack storage (`packs.put` / `packs.getJSON`: local disk, plus GCS `brands/<slug>/memory/…` on Cloud Run).

Files per brand:

- `memory/state.json`: facts and log.
- `memory/vectors.json`: int8 vectors in base64, 344 characters per fact.
- `memory/repo/…`: the readable repo.

A brand's whole memory is under about 100 KB.

## Never invent

`add()` refuses text without a source. Learning from what is live has two parts.

1. **Counted facts.** Exact numbers from the brand pack, written without AI: ad formats, price-in-hook count, CTAs, longest-running ad, catalog size and price range, compare-at prices, Instagram mix and top post, colours, fonts, stack, review totals, customer words, personas, claims, channels and banned claim words. Each one has a stable key (`live.ads.price`, …), so a new read updates the same line in place. The log shows the before and after.
2. **AI read of the creatives.** Sonnet sees the brand's own ad and post words and up to 10 pictures, each with an evidence id (`ad3`, `ig5`, `site`, `rev2`). It covers voice, creative style (formats, hooks, price first or last, faces or product only, UGC or studio, backgrounds, text on image, product framing, drop naming), offers, audience, channels, what works (engagement and longevity, said as a signal) and rules. An observation that cites no valid evidence id is dropped. The source line names the evidence.

## Getting better

- **Outcomes** flow in from `learn.js` hooks, additively. Nothing in the existing learning changes.
  - `addLesson`: a new lesson, or any lesson with a measured result. A brand lesson goes to brand memory. A measured one goes to `what-works` with `metric: before → after, change` and source kind `result`. A "you" lesson goes to that member's scope.
  - Rules promoted from edits go to `rules`.
  - Jam checks answered the same way 3 times go to `rules`.
- **Reads**: when a brand's profile has a newer `readAt` than memory last learned from, the first prompt for that brand learns again in the background (once per process, AI on only). It can also be run with `POST …/memory/learn`.
- **Dreaming** (`consolidate`) runs after each learn and after every 25 additions:
  - merges exact duplicates (sources carried over);
  - expires run memories after 21 days;
  - asks Sonnet, for any topic with 6 or more non-counted lines, which lines to merge (keeping every fact) and which to drop (contradicted by newer or stronger evidence: measured > team > live read > older read; measured lines are never dropped);
  - caps each topic at 30 lines (weakest first).

  Counted lines are kept true by their key, not by dreaming.

## Prompts

- `learn.promptBlock(t, agent)`, already in remix iterate, jam answers, the jam brief and card variants, now starts with the brand memory block. It reads from an in-memory cache, synchronously. The first call for a brand warms the cache and returns `''`. The block lists rules first, then the topics that agent needs (creative: creative style, voice, what works; performance: what works, channels, audience…), plus the viewer's own preferences. It is about 1,600 characters.
- `drafts.js` first drafts await `memoryBlockAsync` with the jam brief as the query, so semantic search picks the relevant lines. If it takes more than 4 s, the cached block is used instead.
- Every memory call is wrapped. If memory fails or is off, the prompt is exactly what it was before.
- The flag `BRAND_MEMORY=0` turns it all off (hooks and routes), and the routes then answer `{ off: true }`. `BRAND_MEMORY_AUTOLEARN=0` keeps memory on but stops the background re-learn. The jam's own memory switch (`prefs().memory`) also hides it, as before.

## Routes

| | |
|---|---|
| `GET /api/brands/:slug/memory` | repo files, facts, log, meta (you see your own member lines only) |
| `GET /api/brands/:slug/memory?q=…&k=8` | search |
| `POST /api/brands/:slug/memory` | `{ text, scope?: 'brand'\|'member', topic?, source? }` add a note (extracted into facts) |
| `DELETE /api/brands/:slug/memory/:id` | forget a line (logged) |
| `POST /api/brands/:slug/memory/learn` | learn from what is live now |
| `POST /api/brands/:slug/memory/consolidate` | tidy now |

Same rule as the other brand routes: on a claimed brand, only its team can write.

## Cost

- Learning one brand from what is live: about $0.04 to $0.07 (one Sonnet call with up to 10 images, one decision call, one tidy call). Embeddings cost fractions of a cent.
- A note or a lesson: one or two short Sonnet calls.
- Prompts: free (cached block) or one embedding (drafts).

## Known limits

- Two Cloud Run instances writing the same brand at the same moment: the last write wins, as with other pack files. Within one instance, writes to a brand are serialised.
- There is no UI yet. The routes return everything a memory page needs.
- Member scope needs a signed-in email. Anonymous workspaces keep their "you" lessons only in their own tenant learning, as before.
