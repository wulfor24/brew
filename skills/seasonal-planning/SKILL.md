---
name: seasonal-planning
description: When the brand needs to plan for a dated event (a festival, a shopping day, a season, a local holiday, a back-to-school or wedding season) in the markets it sells into. Use when the user mentions "Diwali," "Black Friday," "Christmas," "festive season," "holiday plan," "sale calendar," "event calendar," "seasonal campaign," "plan for <event>," or "what's coming up." Covers choosing only market-relevant events, plan windows, the creative, offer, stock and ads timeline, and measuring against the same window last year. For the offer itself, see offers. For paid media, see ads.
metadata:
  version: 1.0.0
---

# Seasonal Planning

You plan a brand's dated events backwards from the event date, so creative, offer, stock, ads and messages are ready in time, and you judge each event against the same window last year.

## 1. Only the events that matter to this brand

- An event belongs in the plan only if the brand sells into that market and buyers in its category change behaviour around it. Diwali matters to an Indian gifting or apparel brand; it does not belong in a US-only brand's plan. Black Friday matters in the US and increasingly in India and the UK; check the evidence.
- Use the calendar lines given to you; never add an event the brand's markets do not observe.
- Rank events by what they did for the brand last year (if the ledger has it), by category fit, and by days away.
- Say plainly which tempting events are left out and why ("Singles' Day: the brand does not sell in China").

## 2. Plan windows

For each event, work backwards from the event date. Typical windows (adjust to the category and the evidence):

| Point | Days before the event | What is done |
|---|---|---|
| Decide | 45 to 60 | Which products, the offer (or no offer), the budget, the target |
| Stock | 30 to 45 | Hero stock checked against the expected window demand; reorder placed |
| Creative | 21 to 30 | Ads, statics, videos, emails and page banners made and approved |
| Warm-up | 7 to 14 | Content and audiences warmed; waitlist or early access opened |
| Live | Event window | Ads at full budget, messages sent, site dressed |
| After | 1 to 7 after | Thank-you and post-purchase messages; stock and returns watched |

A plan point is "due" when today reaches it. Write the move for the plan point that is due now, and list the ones still ahead.

## 3. The timeline

One table per event: DATE | WHAT | OWNER | READY WHEN. Owners are roles, not invented names. Then the budget split by channel and week, the offer with its margin math (from the ledger only), and the guardrails: stock cover, margin floor, spend cap.

## 4. Creative and messages

The hero idea in one line, then the assets: hooks, ad copy, email and WhatsApp subject lines and bodies, the homepage banner. Use what people say in the listening lines; quote only linked lines. No disclaimers or "illustrative" labels on ads.

## 5. Measure against the same window last year

- The metric: revenue (and orders) in the event window against the same window last year, adjusted for the event moving dates (Diwali moves; compare event day to event day).
- If last year's window is not in the ledger, say "to be pulled" and use the four weeks before as a weaker baseline.
- Tag everything with the event's code and campaign name so tagged orders can be counted.

## Brew data

When Brew writes a move with this skill, the evidence arrives as ledger lines (`key | value | label | source | date | link`).

- **Use:** `cal.*` lines (event, dates, days away, plan points, markets), `pulse.*` weather and price-offer lines (forecasts, rivals' event offers), `listen.theme.*` (what people say about gifting, price and timing), the `price.*` and `catalog.*` ledger.
- **Cite:** dates and days away exactly as the calendar line gives them; quote people only from linked `listen.*` quote lines. Never name the vendors or tools behind a line.
- **Measure:** Seasonal: checked every day inside the event window, decided 7 days after the event ends, against the same window last year. Early stop if hero stock runs under 7 days of cover. Early checks only note what moved; nothing is graded before the decide day.

## Related Skills

| When to hand off | Skill |
|---|---|
| Designing the event offer | `offers` |
| Paid media for the event | `ads` |
| Event creative at scale | `ad-creative` |
| Event emails and WhatsApp | `emails` |
