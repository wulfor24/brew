# Jam v2: what works and how to test it

Live at https://brew.joinsquareup.com behind `?v=2`. v1 is unchanged for everyone else.

## 0. Turn it on and off
| What should happen | How to test |
|---|---|
| `?v=2` turns v2 on for this browser tab only | Open `https://brew.joinsquareup.com/<brand>?v=2`, press a card's button: the new jam opens (chat left, canvas right). |
| It stays on while the tab is open | Navigate around the feed in the same tab, press another card's button: still v2. |
| `?v=1` turns it off | Open `/<brand>?v=1`, press a button: the old jam opens. |
| Other people are untouched | Open the brand in a private window without `?v=2`: old jam. |
| Navigation-only buttons stay as they were | "Open the moves", "Open the scoreboard", "Open report" still open their pages, not a jam. |
| Not on the demo site | demo.joinsquareup.com never opens v2. |

## 1. Every card button opens the right pieces
Press each button you can find; the chat's first line says "From “<button>” I’m making …" and the tabs match.

| Button (examples) | Tabs you should see |
|---|---|
| Reply as the brand · Answer on Quora · Post in the group · Draft the replies | Reddit / Quora / group post |
| Make our version (rival ad) | Our ad (picture) |
| Make our version (viral video) · Make the reel · Make the video | Reel + How to film it |
| Make the ad · Rotate creative · Turn into an idea · Queue the 12 · Plan the launch | Image ad |
| Make the carousel ad · Build the collection ad / Draft the carousel post | Carousel ad / Instagram carousel |
| Draft the post · Post it · Use their words in a post | Instagram post + Story |
| Draft the stories | Stories set |
| Pause what points there · Pause those ads | Pause list + Ad for what’s in stock |
| Restart what was paused · Update the prices · Shift budget · Fix the links | Restart list / Price updates / Budget shift / Broken links |
| Add photos · Push the titles · Draft the listing · Request takedown | Listing photos + Titles / Titles + Listing photos / Takedown request |
| Draft the page · Fix the markup · Answer it on the product page | FAQ + schema for AI answers |
| Update landing page · Start the tests · Approve 6 popups | Page section |
| Turn on guest checkout · Fix tracking · Set the watch | Checklist |
| Send the review ask | Email · day 10 + WhatsApp · day 12 + Timing |
| Approve the flows · Turn on the journey · Send on WhatsApp · Plan the flows | Email + WhatsApp + Timing |
| Approve the offers / ladder | The offers + Store banner |
| Brief the shoot · Plan the shoot | Photo / video shoot brief |
| Shortlist creators | Creator shortlist + Creator brief |
| Draft the pitch | Creator outreach DM |
| Draft the buyer deck | Buyer deck |
| Approve the box insert | Insert / thank-you card |
| Launch the ad group | Search ads (Google Ads sheet) |
| Agree with the call · Apply the plan · Plan the restock · Read the reviews | Team plan |

Only the first tab is made on open. Other tabs say "isn’t made yet" with a **Make it** button (nothing is spent unseen).

## 2. Tap any part to change just that
A small toolbar appears over the canvas; free changes land at once as a new version (the version number goes up, a line appears in the chat). Anything that makes a picture or video shows its price first ("Not now" / "Make it").

| Piece | Tap | Try | Expect |
|---|---|---|---|
| Picture ad / post / banner / insert | Headline | Type over it · Shorter · Warmer · Another way · ⋯ In Hindi · Bigger · Smaller · Hide it | Only the headline changes; "· free" in the chat |
| | Product | Swap product (catalog + References) · Bigger · Smaller · ⋯ Move · Blend into the light (priced) | Product stays your real photo; Blend asks for the price |
| | Scene button (or empty area) | New scene (priced) · Change an area | Price first |
| | Select an area (pill) → drag a box | type what goes there → Make it (priced) | Only that box changes |
| | Frame label ("Image ad · …") | Redo it (priced) · New words · Make the final (priced) · ⋯ Do it for every product · Save as a recipe · Make it a reel / carousel · Brief a team | Make the final shows its price and only runs on your yes |
| | ⋯ Do it for every product | — | New "Every product" tab: up to 12 slides, each catalog product cut out into the same scene, free (about 75 s). A line with the first product's price or name becomes each product's own name and catalog price; free shipping lines stay. The site stays fast while it runs |
| | ⋯ Save as a recipe | name it | It shows with a ★ in the + menu of every jam; picking it starts that piece |
| | Size pill 4:5 · 1:1 · 9:16 … | — | Same take re-laid out, free |
| Carousel | Slide thumbnails, slide words, product | Type over / Shorter / Bigger | Only that slide changes; whole-carousel: New words (re-renders every slide), Redo the carousel (priced) |
| Reel / video | A shot card | What we see · Voiceover · On-screen words · Voiceover shorter · ⋯ Longer / Shorter / Remove | Storyboard edits are free |
| | Voice / Music / Captions tracks | pick a narrator / mood / on-off | Free to change. On render: captions are burnt in (brand type) and also come as an SRT; music is made for the video (Lyria, instrumental) and mixed under the voice |
| | Render the video | — | Shows the price (about $2.50 for 15 s); only renders on your yes; editing after a render shows "Render again with the changes" |
| | A shot of a rendered video | Change this shot | Price first (about $0.64); only that shot's background changes, your real product is placed on it again and animated; every other shot, the voice and the music are kept |
| Reddit / Quora reply, email, WhatsApp, page, FAQ | Any sentence (or the email subject) | Type over · Shorter · Warmer · Another way · ⋯ In Hindi · Remove | Only that sentence changes; line breaks stay |
| | Copy and open the thread (replies) | — | Text copied; the thread opens if the card had a link |
| Change lists (pause, prices, budget, titles, offers, team plan, timing, checklist) | A row | Change it · Change the action · Remove · ⋯ Add a row | Only that row changes |
| Briefs (shoot, creator, script, buyer deck, how to film) | Any section | Type over it · Shorter · Another way | Only that section changes |

Keyboard: Tab reaches every part of a picture; Enter selects it; Escape closes the toolbar, then the jam (it asks first if you have typed something).

## 3. The chat
| Try | Expect |
|---|---|
| Select a part, type "make it punchier" | That part changes (free for words) |
| Nothing selected, type a change | The whole piece is rewritten (new version) |
| "show me 9:16" on a picture | Resized, free |
| "brief a team instead" / "make it myself instead" | The tab switches mode |
| "send brief" | The brief link is made and copied |
| "render it" on a reel | Price first |
| Ends with or starts with "?" | Brew answers from the card's evidence and your store facts (checked; it says when it doesn't know) |
| Starts with "@name" or "@email" | That person gets an email with a link straight into this jam (someone not on the team is invited first) |
| Header: who's here | Teammates with the jam open show as faces; "typing…" while they type |
| Header: Memory: on / off | Off: this jam is written without what Brew learned about the brand; On: it uses it |
| + Drop anything | A file or notes. "Use in this jam only": every piece made here follows it. "Teach Brew": goes to the brand's learnings |
| Swap product → Upload a photo | Your photo lands in References and can be used as the product |
| Type, wait while something is being made | Your typing is not wiped |
| Why this? (top card) | Proof with where it came from, "View the original (theirs, for reference only)" for rival/viral, the idea, Goal / For / Offer you can change. Changing them marks older pieces with "Remake it on the new idea" |

## 4. Make it ready vs Brief a team
| Try | Expect |
|---|---|
| Switch a tab to **Brief a team** | The canvas becomes a brief: What to make, Why, The words (final), Specs, References (Brew’s draft attached), Must-haves, Who and when, Done when. Tap any section to change it; "Who makes it" and "Due date" under Who and when |
| **Send brief** (tab header or Finish) | A link is made and copied; the tab shows "sent" |
| Open that link in a private window | Only that brief shows; "Mark received" → "Mark in progress" → "Mark delivered" (only forward). Each step shows on the jam's tab |
| Briefs for shoots, creators, scripts | Are briefs already (no switch) |

## 5. Finish
| Try | Expect |
|---|---|
| Press **Ready to post** / **Finish · post + brief** | A side sheet lists every piece with what its check found |
| **Looks good** on a piece (or **Use it anyway** when a check failed) | Marked approved |
| **Get the ready-to-post link** | Copied; opens a page with every approved piece in every size, captions/text to copy, change lists as a table, **Download all** (zip with sheet.csv for lists, captions.srt for videos, email.html for emails) |
| **Share with my team (read-only link)** | Copied; shows the briefs |
| **Turn off the ready and team links** | Those links now say "not valid" |
| Posted it? paste a link | Saved with the jam (reading results isn’t built yet, and it says so) |
| History (pill) | Every version; pick one to use it |
| + (next to tabs) | Add Reel, Carousel, Story, WhatsApp, Email, Creator brief, Video script, Ad test · 4 hooks on the same idea |
| Brand Book (header) | Colours, type, voice, how much AI, claims, never-say from your store read |

## 6. Safety and money (should be invisible unless you look)
- Nothing paid runs without a price shown and your yes; a partner fallback never costs more than the price shown.
- Daily budgets cover words, pictures, videos and Sloosh credits; when one runs out you see "budget is used up".
- Product picks are only your catalog photos or References.
- Back closes the jam; reloading the page reopens it.

## 7. Team, Slack and timing (in Finish, per piece)
| Try | Expect |
|---|---|
| **Ask for an OK** | Pick a teammate: they get an email; when they approve, you get one back. With no teammates it says to invite them from Account → Team |
| **Slack** | Posts the piece with an **Approve** button to the channel the brand connected. A reply in that thread shows in the jam chat (within 15 s on an open jam); lines typed in the jam go to the thread; Approve in Slack marks the piece approved |
| **Pick a day → Show my best times** | From the brand's own dated Instagram posts, in the brand's time zone. Posts read with dates only give best days, not hours. Fewer than 8 dated posts: it says so and lets you pick |
| A date + **Set a reminder** | A calendar file (.ics) downloads; Brew never posts |
| A piece made with a product whose catalog price changed since | Says so, with a free "Update the words" |
| A sent brief | Its status (received → in progress → delivered) shows on the open jam within 15 s |

## If Brew restarts mid-job (deploys happen often)
| Try | Expect |
|---|---|
| Start a render or Do it for every product, then a deploy lands | Open (or keep open) the jam: it carries on by itself at the price you already approved, reusing the shots already made |
| A first draft or an edit cut off by a restart | The board says "Brew restarted while this was being made. Press it again." |
| Not enough video budget left today | Render refuses before spending anything: "Today's video budget doesn't cover the 4 shots…" (each brand gets 5 video shots a day; a 15 s reel uses 4) |

## Costs seen on live (22 Oct, Cozy)
Words and changes: free to you (they count toward the daily writing budget). Image ad first take: about $0.04 (scene) + free cut-out.
Do it for every product: free (about 75 s for 12 products). Video storyboard: free; render: quoted $2.62, charged $2.41–2.47 for 15 s with voice, captions and music (10–20 min when Veo is busy). Change this shot: $0.64.
