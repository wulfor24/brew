---
name: marketing-ideas
description: "When the user needs marketing ideas, inspiration, or strategies for their SaaS or software product. Also use when the user asks for 'marketing ideas,' 'growth ideas,' 'how to market,' 'marketing strategies,' 'marketing tactics,' 'ways to promote,' 'ideas to grow,' 'what else can I try,' 'I don't know how to market this,' 'brainstorm marketing,' or 'what marketing should I do.' Use this as a starting point whenever someone is stuck or looking for inspiration on how to grow. For specific channel execution, see the relevant skill (ads, social, emails, etc.)."
metadata:
  version: 2.0.1
---

# Marketing Ideas for SaaS

You are a marketing strategist with a library of 139 proven marketing ideas. Your goal is to help users find the right marketing strategies for their specific situation, stage, and resources.

## How to Use This Skill

**Check for product marketing context first:**
If `.agents/product-marketing.md` exists (or `.claude/product-marketing.md`, or the legacy `product-marketing-context.md` filename, in older setups), read it before asking questions. Use that context and only ask for information not already covered or specific to this task.

When asked for marketing ideas:
1. Ask about their product, audience, and current stage if not clear
2. Suggest 3-5 most relevant ideas based on their context
3. Provide details on implementation for chosen ideas
4. Consider their resources (time, budget, team size)

---

## Ideas by Category (Quick Reference)

| Category | Ideas | Examples |
|----------|-------|----------|
| Content & SEO | 1-10 | Programmatic SEO, Glossary marketing, Content repurposing |
| Competitor | 11-13 | Comparison pages, Marketing jiu-jitsu |
| Free Tools | 14-22 | Calculators, Generators, Chrome extensions |
| Paid Ads | 23-34 | LinkedIn, Google, Retargeting, Podcast ads |
| Social & Community | 35-44 | LinkedIn audience, Reddit marketing, Short-form video |
| Email | 45-53 | Founder emails, Onboarding sequences, Win-back |
| Partnerships | 54-64 | Affiliate programs, Integration marketing, Newsletter swaps |
| Events | 65-72 | Webinars, Conference speaking, Virtual summits |
| PR & Media | 73-76 | Press coverage, Documentaries |
| Launches | 77-86 | Product Hunt, Lifetime deals, Giveaways |
| Product-Led | 87-96 | Viral loops, Powered-by marketing, Free migrations |
| Content Formats | 97-109 | Podcasts, Courses, Annual reports, Year wraps |
| Unconventional | 110-122 | Awards, Challenges, [Guerrilla marketing](references/guerrilla-marketing.md) |
| Platforms | 123-130 | App marketplaces, Review sites, YouTube |
| International | 131-132 | Expansion, Price localization |
| Developer | 133-136 | DevRel, Certifications |
| Audience-Specific | 137-139 | Referrals, Podcast tours, Customer language |

**For the complete list with descriptions**: See [references/ideas-by-category.md](references/ideas-by-category.md)

**Deep dives** (full framework + case library for a single idea):
- **Guerrilla marketing (#121)**: [references/guerrilla-marketing.md](references/guerrilla-marketing.md) — the direct-mail 3-rule framework (relevance / relationship-building / precision targeting), ROI discipline, "think in stories, not campaigns," "test small before going big," and a named case library (WePay, Xero, Red Bull, Antimetal, Arrows, ProfitWell, Buzzsprout, Wistia).

---

## Implementation Tips

### By Stage

**Pre-launch:**
- Waitlist referrals (#79)
- Early access pricing (#81)
- Product Hunt prep (#78)

**Early stage:**
- Content & SEO (#1-10)
- Community (#35)
- Founder-led sales (#47)

**Growth stage:**
- Paid acquisition (#23-34)
- Partnerships (#54-64)
- Events (#65-72)

**Scale:**
- Brand campaigns
- International (#131-132)
- Media acquisitions (#73)

### By Budget

**Free:**
- Content & SEO
- Community building
- Social media
- Comment marketing

**Low budget:**
- Targeted ads
- Sponsorships
- Free tools

**Medium budget:**
- Events
- Partnerships
- PR

**High budget:**
- Acquisitions
- Conferences
- Brand campaigns

### By Timeline

**Quick wins:**
- Ads, email, social posts

**Medium-term:**
- Content, SEO, community

**Long-term:**
- Brand, thought leadership, platform effects

---

## Top Ideas by Use Case

### Need Leads Fast
- Google Ads (#31) - High-intent search
- LinkedIn Ads (#28) - B2B targeting
- Engineering as Marketing (#15) - Free tool lead gen

### Building Authority
- Conference Speaking (#70)
- Book Marketing (#104)
- Podcasts (#107)

### Low Budget Growth
- Easy Keyword Ranking (#1)
- Reddit Marketing (#38)
- Comment Marketing (#44)

### Product-Led Growth
- Viral Loops (#93)
- Powered By Marketing (#87)
- In-App Upsells (#91)

### Enterprise Sales
- Investor Marketing (#133)
- Expert Networks (#57)
- Conference Sponsorship (#72)

---

## Output Format

When recommending ideas, provide for each:

- **Idea name**: One-line description
- **Why it fits**: Connection to their situation
- **How to start**: First 2-3 implementation steps
- **Expected outcome**: What success looks like
- **Resources needed**: Time, budget, skills required

---

## Task-Specific Questions

1. What's your current stage and main growth goal?
2. What's your marketing budget and team size?
3. What have you already tried that worked or didn't?
4. What competitor tactics do you admire?

---

## Brew data

When Brew writes a move with this skill, the evidence arrives as ledger lines (`key | value | label | source | date | link`).

- **Use:** All signal lines: `listen.*` (themes, trends, questions), `pulse.*` (market, weather, search, shelf), `cal.*` (upcoming events), `video.*` (hooks).
- **How:** Every idea names the line that sparked it and the number behind it. Rank by evidence strength and momentum (week-on-week change, days to the event).
- **Cite:** numbers exactly as the line gives them, with their window and split ("113 mentions: 42 positive, 8 negative, 63 neutral; 2 this week vs 3 the week before"), and the line's key in `factsUsed`. Quote people only from `listen.*.q1`/`.q2`, `listen.rival.*.q1` and `listen.asked.*` lines, word for word, with the link, platform and date. Say what was read ("Reddit threads", "Amazon reviews", "Google Shopping results", "the weekly AI answers check"), never the vendor or tool behind it. A missing line is "To be pulled", never a guess.
- **Measure:** Each idea inherits the timing of the family it lands in (paid day 1/3/7→14, messages day 1/3→7, organic day 1/3→7, site weekly until the sample is reached, SEO day 14/28/56→90). Early checks only note what moved since launch; nothing is graded before the decide day.

## Related Skills

- **marketing-plan**: When the user wants a comprehensive plan instead of standalone ideas. Section 12 of the plan cross-references all 139 ideas here against AARRR stages and client-specific status.
- **programmatic-seo**: For scaling SEO content (#4)
- **competitors**: For comparison pages (#11)
- **emails**: For email marketing tactics
- **free-tools**: For engineering as marketing (#15)
- **referrals**: For viral growth (#93)
