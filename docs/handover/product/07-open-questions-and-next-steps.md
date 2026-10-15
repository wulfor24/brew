# 07 · Open questions and next steps

## Decisions product owns

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | **What do "Ask everyone" and @teammate do until Slack is real?** | (a) remove them; (b) keep them, clearly labelled, and never feed them into the brief or memory; (c) turn them into "send this question to the person" (copy only) | **(c).** It keeps the team feel without inventing answers. |
| 2 | **Should moves keep "What Brew will watch"?** | (a) rewrite it as "How your team measures it"; (b) bring measurement back | **(a)** for the showcase |
| 3 | **Which real connector first?** | Shopify (read-only), Meta Ads (read-only), GA4, Klaviyo, Slack | **Shopify read-only.** It backs the most cards and has the simplest approval. Then Meta Ads. Then a Slack app for the teammate loop. |
| 4 | **Pro / billing:** do we show a plan at all in the showcase? | keep it Dummy; hide it; build billing | Keep it Dummy, but make the moves-page Pro button purely visual (today it raises our spend limit) |
| 5 | **How many prepared brands for the demo?** | Arata only; 3–5 across categories and markets | **3–5.** It proves "any brand" and finds brand-specific bugs. Cost is about $100–150 per brand, plus background spend. |
| 6 | **Who may start a read on brew.joinsquareup.com?** | anyone (today: 1 per IP per hour); signed-in only; invite only | **Signed-in only.** Each read costs about $6. |
| 7 | **What counts as "verified" for a move?** | numbers only; numbers plus no claim issues; show "N claims to review" | **Show "Numbers checked · N claims to review".** That is honest and useful. |
| 8 | **Should shared briefs be frozen?** | frozen with versions; live | **Frozen, with a version history.** That is what "BR-n" implies. |
| 9 | **Port the unshipped work from the old repo?** | weekly history; a review step for learnings; health-ring fixes | Weekly history and the learnings review are product wins. The ring fixes matter only once the rings are real. |
| 10 | **Festival calendar:** which markets and festivals matter? | — | Needed to replace the hard-coded Diwali and Black Friday dates |

## Suggested next steps, in order

1. **Make the showcase honest** (engineering P0):
   - remove invented sign-offs;
   - keep simulated numbers out of briefs and moves;
   - fix copy that promises cut features;
   - line up the counts;
   - restore the missing PDFs;
   - fix the festival dates.
2. **Prepare 3–5 more demo brands** across categories, and re-check every screen on each.
3. **Protect spend:** sign-in before paid reads; limits that survive deploys; a separate service account.
4. **Decide the connector order** (question 3) and start the first real, read-only connector.
5. **After brands onboard:** shape the real product (Do it now, measurement, sending) from what design partners actually use.

## What we don't know yet

- How Brew performs on non-Shopify, non-Indian brands with this codebase. It was done in the old repo and not re-proven here.
- Whether prospects value the depth of the moves (7–10k words) or mostly use the feed and jam. No usage tracking exists.
- **Usage analytics:** none. We can't see which cards, jams or shares prospects use. Consider adding privacy-friendly event tracking before the next round of demos.
