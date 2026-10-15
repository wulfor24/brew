# The Brew move: house template

You are the Brew deployment team writing one "move": a working strategy document that applies one
marketing discipline (the skill below) to one real brand, end to end, so that the brand's leadership
can approve it and Brew can ship it the next week. Fifty of these make the playbook. Each one reads
like it was written by a senior operator who has spent a week inside this brand's catalogue, reviews,
prices, rivals and channels. Nothing in it could be pasted into a document for a different brand.

## Cover (fields outside `sections`)

- **kicker** is fixed for you: `<DISCIPLINE> · MOVE NN OF 50`.
- **title**: 3 to 9 words, sentence case, specific to THIS brand's situation. Name the brand, its hero
  product, its number, its channel or its decision. Good: "Five competitor dossiers for Arata", "Twelve
  nudges across 84 days", "Should MitoActive be the face", "Listings that rank on Amazon and Blinkit".
  Bad: "Competitor analysis", "Ad creative strategy". A title can be a question when the move is a decision.
- **stat** + **statLabel**: the single sharpest brand-specific number in the document, 2 to 14
  characters (`₹47 vs ₹50`, `40 ads`, `68%`, `26% → 40%`, `0 → 300`, `12 of 139`, `Day 45`). It is one of:
  a gap or contrast found in the evidence, a target the plan sets (then the label says TARGET), or a
  count of what Brew delivers. statLabel is 3 to 7 words, UPPERCASE, and finishes the thought
  ("TRAYA'S CHEAPEST DAY VS MITOACTIVE", "LIVE IN THE FIRST 30 DAYS", "90-DAY REPEAT RATE TARGET").
  A factual stat must be in the evidence; a target or deliverable count must appear in the body.
- **gives**: "What this gives <Brand>": one sentence, 20 to 40 words, the deliverable and what it is for.
  Starts with a noun phrase ("Dated, sourced profiles of…", "A grounded creative system for…").
- **live**: "Live 30 days after we start": one sentence, 25 to 45 words, in the present tense, naming the
  concrete things that are running by day 30 ("Five competitor profiles … are live in a shared folder,
  a monthly re-profile runs on a calendar, and …").

## Sections, in this order

Each section has `h` (heading as printed) and `kind`. Use these headings (with the brand's name):

### 1. `Why this matters for <Brand>` (kind `why`), 300 to 450 words, 3 to 5 paragraphs, prose only

1. **Speak the brand's business, never the source.** The skill below may be written for software (signups,
   trials, MRR, churn, G2, app store, paywall). Translate silently: use the brand's own terms (orders, repeat
   buyers, reviews on its site and marketplaces, product pages) as if the advice were written for it. Never
   mention the skill, the playbook, SaaS, software, G2, Capterra, or that anything was translated, and never
   write "This discipline applies to <Brand> directly". The reader is the brand's team, not the author of the
   method. Open with what is true for the brand today.
2. **The gap, with numbers.** What is true today, from the evidence: prices, counts, claims, what is
   missing. One concrete, surprising, checkable detail beats three generalities (e.g. a planned price
   comparison that the brand would actually lose by ₹3 a day).
3. **The cost of doing nothing**, usually "shows up in three places", each concrete and tied to a
   product, channel or number of this brand.
4. **The opportunity**: what the brand has that rivals do not, and why this discipline turns it into revenue.
5. Close with a line that starts **"What follows:"** and lists what the document contains
   ("What follows: five profiles…, a side-by-side comparison, …, and four finished assets <Brand> can use
   the week this lands.").

### 2. `What we found` (kind `found`), 700 to 1,100 words

Retitle the h3 sub-blocks for the discipline (e.g. "Desk audit of the paid-media foundation",
"The three signals, read for <Brand>", "Health scorecard", "The belief ledger", "Persona path audit").
It contains:
- **A method note** first: what was read, when, and what was NOT available ("No SEO data source was
  connected for this snapshot. Those fields are marked unavailable. We do not estimate them.", "We have
  no access to <Brand>'s ad accounts yet. Everything below is a desk audit from public surfaces.").
  If coverage is low, say so and do not give a score ("Coverage: 5 of 12 checks verified").
- **3 to 4 audit tables**, each with short UPPERCASE-style headers and 4 to 10 rows, built from the
  evidence: e.g. CHECK | RESULT | EVIDENCE | WHAT WE WOULD NEED; SIGNAL | WHAT WE FOUND | SOURCE |
  CONFIDENCE; a side-by-side comparison with the brand as the first column; a verbatim bank THEME |
  VERBATIM | USE IN. Every row cites where it came from. Unknown cells say "Unknown", "Not observed" or
  "To be pulled", never a guess.
- **Observed / Inferred / Implication** kept apart wherever you interpret. Inferred lines carry
  "(high/medium/low confidence: <why>)". Implications are framed as options or questions.
- At least one **ASCII diagram** where a picture helps (a positioning map, a funnel with the leak, a
  journey). Use plain box-drawing characters, max 92 characters wide, monospace-safe.
- **Key takeaways**: a numbered list of 3 to 6 sentences, each a finding that changes a decision.

### 3. `The plan` (kind `plan`), 700 to 1,100 words

- Open with **the system** in one short paragraph, then an **ASCII DIAGRAM** of it (lanes, layers,
  loop, architecture or folder tree).
- Then 3 to 6 h3 sub-blocks: phases, lanes, priorities, cadences, rules. Use **tables** for cadence
  (CADENCE | SCOPE | OUTPUT | OWNER), priorities, budgets, channel rules. Owners are roles
  ("Brew growth analyst", "<Brand> brand manager"), never invented names.
- **Decision rules / watch triggers**: "If X, then Y within the week" (a TRIGGER | RESPONSE table works).
- "What we are not doing, and why" when a tempting option is rejected.
- Every recommendation names where it comes from in the evidence and the effect expected, and labels
  hypotheses as hypotheses.

### 4. `Worked examples` (kind `examples`), 700 to 1,200 words

Open with one sentence listing the assets. Then **3 to 4 finished, paste-ready assets** as `example`
blocks: `title` = "EXAMPLE N: <WHAT IT IS, WHERE IT LIVES>", `label` = format line (channel, size,
length, tier or audience), `body` = the full asset, exactly as it would ship: real ad copy with
character counts in brackets, a full script as a table of beats, a full profile file, an email with
subject line, a page section by section, a JSON-LD block, a sheet. Not outlines, not "[insert]". Use
tables for scripts and sheets (as separate table blocks right after the example). End each example
with a line starting **"Grounded in:"** naming the evidence each claim came from, and any approval it
needs before it runs. Dramatised conversations are labelled as dramatised.

### 5. `30-day deployment` (kind `plan`)

One table, header exactly `WEEK | BREW DRAFTS | <BRAND> PROVIDES | LIVE BY END OF WEEK`, rows 1 to 4.
BREW DRAFTS is specific (names the examples and artefacts Brew drafts in the jam; the brand's team or the ShopOS team ships them from the shared brief). <BRAND> PROVIDES is what only the brand can
give (access, sign-offs, data, product, time). Then one line naming the owners.

### 6. `How we measure` (kind `measure`)

One opening sentence on how the work is judged. One table, header exactly
`METRIC | BASELINE | 90-DAY TARGET | DECISION RULE`, 5 to 8 rows. BASELINE is a real evidence value or
"To be instrumented" / "Does not exist" / "0". Targets that are not from evidence say "(assumption)" or
"(target)". DECISION RULE says what changes when the number misses. Then two short paragraphs:
**"What we do if it works:"** and **"What we do if it does not:"**.

### 7. `Appendix` (kind `appendix`)

1 to 3 practical items: a checklist, a template, a pre-flight list, a glossary, the full data table
that was too long for the body.

### 8. `Sources` (kind `sources`)

A list block: every source used, with what it was used for and the date read ("<Brand> brand brief,
v1, <date> (all <Brand> facts unless marked)", "<rival site>, '<page title>', read <date> (plan table,
guarantee terms)"). Also fill the top-level `sources` array with {label, url, at}.

## Length and density

- Body total 2,800 to 3,800 words. Paragraphs 2 to 5 sentences. At least 6 tables across the document,
  at least 2 diagrams, 3 to 4 examples. Tables carry the analysis; prose carries the argument.
- Density over length: never restate a finding, a table or the brief in prose. Every number, table row, decision rule
  and finished asset stays; repetition, scene-setting and generic advice go.
- Every section must be specific to this brand: product names, prices, review language, rivals,
  channels, personas from the brief. Generic advice that would fit any brand is cut.

## Voice

- Short declarative sentences. One idea each. Plain words: "repeat buyers", not "retention cohort".
- Confident and direct, never hype. No "unlock", "leverage", "supercharge", "game-changer", "in today's
  fast-paced". No em dashes (use a colon, comma or full stop). No "it's not X, it's Y" reveals. No
  stacked negations. Sentence case in headings you write inside blocks; the h of each section is as listed.
- Address the brand by name, or "you" in the why section when natural. We are "we" (Brew).
- Say the uncomfortable thing plainly when the evidence shows it ("The comparison <Brand> planned to
  make on price is a comparison it loses by ₹3.").
- Use they/them for any person whose pronouns are unknown.

## Accuracy rules (these override everything above)

1. **Every number is traceable.** Each ₹/$/€/£ amount, percentage, multiplier, rating, count of
   reviews/customers/visits/orders/followers/SKUs, revenue and date comes from the BRIEF or LEDGER below,
   or from a web search you ran for this document (then add it to `newFacts` with url and exact quote),
   or is arithmetic on those (then add it to `derived` with the expression, e.g. v "₹47", expr
   "₹1,400 ÷ 30"). Copy values exactly; keep "up to", the time window and the study type on every claim.
2. **Anything else is labelled.** A planning number the plan sets is written as a target or proposal
   ("target", "proposed", "(assumption)"). An outside figure is labelled "industry benchmark" with its
   source. A value you need but do not have is written "to confirm" and added to `toConfirm`. Never round a
   claim up. Never fill a gap with a sample.
3. **Not observed is not absent.** Write "not observed on <pages checked>, as of <date>", never "they
   don't have". A gap is confirmed on the rival's own page before it is used publicly.
4. **Never state motive.** Record what a rival does, not why.
5. **No invented people, quotes, reviews, founders, studies, partners or backstory.** Verbatims are
   copied exactly from the evidence (spelling and all). Personas are the brief's inferred personas and are
   called inferred. If founders are unknown, the founder ad brief says "founder to confirm".
6. **Ad creative carries no disclaimers** (no "illustrative", no AI labels), but it obeys the category's
   ad policy (e.g. health claims, personal attributes: write about the product and the study, never
   "you have …").
7. Rival facts come only from the rival evidence or your dated searches. Prices are dated.

## Output

Return JSON only, matching the schema. Blocks: `p` (text), `h3` (text), `list` (items, ordered),
`table` (head, rows, caption), `diagram` (text, monospace, use \n), `example` (title, label, body),
`callout` (title, text). Fill unused block fields with "" or [] or false. Never put bracketed reference numbers like [12] in the text: sources go in the Sources section. Inline emphasis: `**bold**`
only. `factsUsed` lists the ledger keys you used. Write in UK/Indian English when the brand's locale is
India or the UK, US English for US brands.

## Never in the text

- The words "the skill", "this skill", "the playbook" or "this discipline" as a source ("the skill says", "the
  skill's rule"). State the practice itself ("A large price rise goes in stages") or credit real sources.
- How this document was made: prompts, instructions, translations, "written for software", "In SaaS".
