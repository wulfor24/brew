# 05 · Known limitations: what to watch for and what not to claim

## Don't claim these in a demo

| Don't say | Because |
|---|---|
| "Brew will launch, pause or move budget for you" | Do it now was cut. Every action ends in a brief. |
| "Brew watches the results and grades the move" | Measurement was cut, even though the moves describe it |
| "Your teammates approved it in Slack" | The replies and approvals are simulated |
| "These are your Shopify / Meta / GA4 numbers" | The connected accounts are simulated from the public read |
| "Brew emails or WhatsApps your customers" | Cut. Brew only emails *your team* (invites, "moves ready"). |
| "Every claim is verified" | Numbers are checked. Claims are checked, but leftover issues aren't removed, so no long move reaches "verified". |
| "Works for any store" | The read has been proven on Shopify stores, and only Arata is prepared today. WooCommerce and custom stores are untested here. |
| "The shared brief is final" | It updates if the jam is edited after sharing |

## Things a prospect may notice

1. **Numbers that don't line up across screens.**
   - "Live ads": 4.3k on the demo picker, 1,143 on the health card, 664 on cards.
   - Moves: "51", "64", "MOVE 65 OF 64".
2. **Copy from cut features.**
   - The welcome card ends "Heart it, jam on it, **do it**".
   - The landing hero shows "Approve" to move budget.
   - Some card buttons say "Shift budget" or "Publish Campaign".
3. **Copy that says different things in different places.** The landing says "You sign in with Google to start", but the read starts without sign-in; sign-in comes after the read.
4. **Festival ideas** count down to Diwali (8 Nov) and Black Friday (27 Nov 2026). The dates are fixed in code, so after 27 Nov they go stale for every brand.
5. **Missing PDFs.** Arata's moves 02, 03 and 25.
6. **The first screen** can show two ads from the same rival in the "ads you can make" seats.
7. **Heard** sometimes shows a YouTube review video as a "question to answer".
8. **A read that can't open a store** can leave the "Reading" screen spinning.
9. **Socials** often time out, and the Films card silently doesn't appear.
10. **Every brief's number** starts at BR-1042 in each workspace.

## Limits of the prototype

- **One brand prepared** (Arata). A new brand needs a fresh read (about $6) and a full build (about $100–150, several hours).
- **The demo's daily limits are shared** by all visitors: 1,500 text, 120 image and 15 video generations a day. A heavy visitor can use them up. The limits reset whenever we deploy.
- **Speed:** a read takes about 3–4 minutes. The full set of moves takes hours, but the first ten land first. An image draft takes 20–60 s; a video takes 2–4 min.
- **Background spend continues** for every built brand: listening (about $0.4–1.6 a day), stories, drafts (up to $4 a day), and weekly moves (up to $3 a week).
- **Sources:** Instagram and YouTube reads are flaky. Nykaa, Flipkart and Myntra are off in prod (no Apify key). Review apps other than Judge.me are untested.

## Fine for now (showcase), but needed before real brands onboard

- Brand pages, moves, brand memory and "What your team told Brew" can be read by anyone with the link.
- Opening a shared brief link while signed in adds that person to the brand team.
- Claiming a brand only needs an email at its domain.

These are acceptable while no real account data is connected. They must be closed before brands connect real data.
