# 04 · Content and accuracy rules

These rules are Brew's promise to a brand. They are written into the prompts and checks (see `SPEC.md`). Any new feature or copy must follow them.

## Accuracy above everything

1. **No invented numbers, quotes, founders, reviews or backstory.** Every number traces to a source. Otherwise it is written **"to confirm"**.
2. **Observed, Inferred and Implication stay separate.** Anything inferred carries a confidence note. "Not observed" never means "absent".
3. **Never state a rival's motive.**
4. **Missing data is said plainly** ("No review widget found"). It is never filled with a sample.
5. **An error is never shown as "none".** If a check didn't go through, say so.
6. **Benchmarks are labelled** "industry benchmark".
7. **No disclaimers on ad creative.** No "illustrative" or "AI-generated" labels, and no fine print that weakens the ad.
8. **They/them** for any person whose pronouns we don't know.

## Voice and UI

- **Plain, simple, one-glance language.** Short sentences, everyday words.
- **Quiet pages:**
  - no zero tiles;
  - history folded away;
  - one signal per state;
  - nothing on screen that doesn't help the next decision.
- **Sell the relief, not the discount.** Badges and nudges are short emotional payoffs, never "% off" maths.
- **Brand-agnostic.** Every rule, card type and fix must work for every brand, never just one.

## Where Brew breaks its own rules today

Product should know these. Engineering has them ranked in `../engineering/11-known-issues-and-debt.md`.

| Rule | Break |
|---|---|
| No invented facts | "Ask everyone" answers invent sign-offs on legal, rights and tracking. Simulated account numbers are quoted in briefs and moves as real. |
| Observed vs inferred | Brew's own claim check flags 1–13 issues per long move (inferences read as fact, a stance given to a rival), and they remain in the text and PDFs |
| Never state a rival's motive | Some of those leftover issues are exactly this |
| Errors aren't "none" | "Check what we read" shows "Not found" when a lookup failed. Onboarding ticks steps that failed. Heard lists sources we skip on purpose as failures. |
| Don't promise what we don't do | Moves promise "What Brew will watch". Cards say "we pause / restart / tell you". The landing hero shows "Approve" to move budget. Toasts say "Posted to #growth". |
| Plain, honest numbers | "Reviews" adds site reviews, store reviews and Amazon ratings into one number. "Live ads" counts ad versions. Move counts disagree (51 / 64 / 71). |
