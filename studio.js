import { B, BN, BH, CTRY } from './brand-ctx.js';
import { matchProduct, sceneOf } from './product-match.js';
// Remix studio: what each kind of change is, as a commission-ready package.
// Every action belongs to a family. A family says which fields the channel needs (FIELDS), which knobs you can turn
// on it (KNOBS), how it renders as a card-sized "after" (afterFromPkg), and what counts as complete (missing).
// Remix and iterate ask Claude for a whole package through one forced tool, so the reply is always valid JSON.

export const FAMILY_OF = {
  add_variants: 'meta_ad', swap_creative: 'meta_ad', swap_copy: 'meta_ad', new_test: 'meta_ad', whatsapp_ad: 'meta_ad', carousel_ad: 'meta_ad', collection_ad: 'meta_ad', catalog_ad: 'meta_ad',
  ig_post: 'social', ig_carousel: 'social', ig_story: 'social',
  x_post: 'post', linkedin_post: 'post', reddit_post: 'post', quora_answer: 'post', fb_group_post: 'post', pinterest_pin: 'post', short_video: 'post',
  pause_losers: 'meta_ops', stop_rule: 'meta_ops', scale_budget: 'meta_ops', shift_budget: 'meta_ops', pause_pointing: 'meta_ops', restart_paused: 'meta_ops', price_in_ads: 'meta_ops', comment_reply: 'post', fix_links: 'setup',
  page_copy: 'store', pdp_block: 'store', new_section: 'store', price_change: 'store', bundle_offer: 'store',
  faq_entry: 'vis', llms_txt: 'vis', schema_fix: 'vis', new_claim: 'vis',
  flow_copy: 'crm', flow_timing: 'crm', review_ask: 'crm', new_segment: 'crm', paid_broadcast: 'crm', discount_offer: 'crm',
  film_brief: 'brief', creative_brief: 'brief', resolution: 'decision', plan: 'decision',
  listing_titles: 'listing', listing_content: 'listing', takedown: 'listing',
  search_ad: 'search', tracking_fix: 'setup', store_setting: 'setup', print_insert: 'print', blog_post: 'store', buyer_deck: 'brief', outreach_email: 'outreach'
};
export const familyOf = (action) => FAMILY_OF[String(action).split('.').pop()] || 'store';
export const FAMILY_NAME = { search: 'Google Search ad', setup: 'Setup change', print: 'Printed insert', listing: 'Marketplace listing', meta_ad: 'Meta ad', social: 'Instagram post', post: 'Social post', meta_ops: 'Ad account change', store: 'Store change', vis: 'AI answer', crm: 'Customer message', brief: 'Production brief', decision: 'Decision', outreach: 'Outreach email' };

// field types: text · long · list (strings) · rows (objects with `cols`) · select (`opts`) · number
// pub: shown to customers, so it passes the claims gate. req: needed before it can be commissioned.
export const FIELDS = {
  search: [
    { k: 'adGroup', label: 'Ad group', type: 'text', req: true },
    { k: 'keywords', label: 'Keywords', type: 'list', req: true, hint: 'One per line, with match type, e.g. "minoxidil alternative" (phrase)' },
    { k: 'negatives', label: 'Negative keywords', type: 'list' },
    { k: 'headlines', label: 'Headlines', type: 'list', pub: true, req: true, hint: '3-8 headlines, each under 30 characters' },
    { k: 'descriptions', label: 'Descriptions', type: 'list', pub: true, req: true, hint: '2-4 descriptions, each under 90 characters' },
    { k: 'finalUrl', label: 'Landing page', type: 'text', req: true },
    { k: 'dailyBudget', label: 'Daily budget', type: 'number', req: true },
    { k: 'bidding', label: 'Bidding', type: 'text' }
  ],
  setup: [
    { k: 'tool', label: 'Where', type: 'text', req: true },
    { k: 'what', label: 'What changes', type: 'long', req: true },
    { k: 'steps', label: 'Steps', type: 'list', req: true },
    { k: 'verify', label: 'How we know it worked', type: 'text', req: true },
    { k: 'customerSees', label: 'What customers see', type: 'text', pub: true }
  ],
  print: [
    { k: 'front', label: 'Front', type: 'long', pub: true, req: true },
    { k: 'back', label: 'Back', type: 'long', pub: true },
    { k: 'qr', label: 'QR code goes to', type: 'text' },
    { k: 'size', label: 'Size and paper', type: 'text', req: true },
    { k: 'quantity', label: 'Quantity', type: 'number', req: true },
    { k: 'goesIn', label: 'Goes into', type: 'text', req: true }
  ],
  listing: [
    { k: 'product', label: 'Product', type: 'text', req: true },
    { k: 'name', label: 'The one name to use everywhere', type: 'text', pub: true, req: true, only: ['listing_titles', 'listing_content'] },
    { k: 'items', label: 'Listings', type: 'rows', cols: ['marketplace', 'now', 'new'], pub: true, req: true, hint: 'One row per marketplace listing: the marketplace, its title now, the new title. For "now" write "As listed today" unless the card gives the exact current title; never invent a current title' },
    { k: 'bullets', label: 'Bullet points', type: 'list', pub: true, only: ['listing_content'] },
    { k: 'images', label: 'Image set', type: 'text', hint: 'Which images go on every listing, in order' },
    { k: 'searchTerms', label: 'Backend search terms', type: 'text', only: ['listing_titles', 'listing_content'] },
    { k: 'reason', label: 'What the request says', type: 'long', only: ['takedown'], req: true }
  ],
  meta_ad: [
    { k: 'primaryText', label: 'Primary text', type: 'long', pub: true, req: true, hint: 'The post copy above the creative, 1-3 short lines' },
    { k: 'headline', label: 'Headline', type: 'text', pub: true, req: true, hint: 'Under 40 characters, under the creative' },
    { k: 'description', label: 'Description', type: 'text', pub: true },
    { k: 'overlay', label: 'Text on the image', type: 'text', pub: true, hint: 'Up to 7 words, the number first' },
    { k: 'cta', label: 'Button', type: 'select', req: true, opts: ['Shop now', 'Learn more', 'Order now', 'Send WhatsApp message', 'Get offer'] },
    { k: 'chat', label: 'Chat that opens', type: 'rows', pub: true, cols: ['from', 'text'], only: ['whatsapp_ad'], hint: 'from is "in" (customer) or "out" (the brand)' },
    { k: 'cards', label: 'Carousel cards', type: 'rows', cols: ['headline', 'text', 'imageBrief', 'link'], pub: true, req: true, only: ['carousel_ad'], hint: '3-10 cards in the order they swipe: the card headline (under 40 characters), one short line under it, the photo behind it (no text in the photo), and the page it opens' },
    { k: 'products', label: 'Products in the grid', type: 'list', req: true, only: ['collection_ad'], hint: '4-8 real product names from the catalog, in the order they show under the cover' },
    { k: 'instantPage', label: 'Opens to', type: 'text', only: ['collection_ad'], hint: 'The full-screen page a tap opens: what it leads with' },
    { k: 'productSet', label: 'Product set', type: 'text', req: true, only: ['catalog_ad'], hint: 'Which catalog products it shows, e.g. every in-stock best seller' },
    { k: 'frame', label: 'Frame on every product photo', type: 'text', pub: true, only: ['catalog_ad'], hint: 'The line or badge laid over each product photo, the same for all of them' },
    { k: 'imageBrief', label: 'Image brief', type: 'long', req: true, hint: 'One or two sentences: the scene for the product photo (the cover, for a carousel or collection), no text in it' },
    { k: 'format', label: 'Format', type: 'select', req: true, opts: ['4:5', '1:1', '9:16'] },
    { k: 'audience', label: 'Audience', type: 'text', req: true },
    { k: 'placements', label: 'Placements', type: 'text' },
    { k: 'adSet', label: 'Ad set', type: 'text', req: true },
    { k: 'dailyBudget', label: 'Daily budget', type: 'number', only: ['new_test'], req: true },
    { k: 'schedule', label: 'Schedule', type: 'text' },
    { k: 'utm', label: 'Link and UTM', type: 'text' }
  ],
  social: [
    { k: 'account', label: 'Account', type: 'text', req: true, hint: 'The Instagram handle it goes up on' },
    { k: 'slides', label: 'Slides', type: 'rows', cols: ['onSlide', 'imageBrief'], pub: true, req: true, only: ['ig_carousel', 'ig_story'], hint: 'In order: the words on the slide (under 12 words; slide 1 is the hook, the last one says what to do), and the photo behind it (no text in the photo). 3-10 slides' },
    { k: 'overlay', label: 'Text on the image', type: 'text', pub: true, only: ['ig_post'], hint: 'Up to 8 words' },
    { k: 'imageBrief', label: 'Image brief', type: 'long', req: true, only: ['ig_post'], hint: 'The photograph: setting, light, who is in it. No text in it' },
    { k: 'caption', label: 'Caption', type: 'long', pub: true, req: true, hint: 'The first line is the hook; plain words; the call to action at the end' },
    { k: 'hashtags', label: 'Hashtags', type: 'list', pub: true, hint: '3-8, specific to the category' },
    { k: 'stickers', label: 'Stickers', type: 'text', only: ['ig_story'], hint: 'A poll, question or link sticker, and on which slide' },
    { k: 'format', label: 'Shape', type: 'select', req: true, opts: ['4:5', '1:1', '9:16'] },
    { k: 'postAt', label: 'Goes up', type: 'text', hint: 'Day and time' },
    { k: 'pillar', label: 'Content pillar', type: 'text' }
  ],
  // a post on any other platform (X, LinkedIn, Reddit, Quora, Facebook groups, Pinterest, Shorts): the words as they go up, and where
  post: [
    { k: 'platform', label: 'Platform', type: 'text', req: true, hint: 'Where it goes up and as what, e.g. "Reddit reply" or "X thread"' },
    { k: 'author', label: 'Posted by', type: 'text', only: ['linkedin_post', 'x_post'], hint: 'The founder on record whose voice this is; empty posts from the brand' },
    { k: 'authorRole', label: 'Their role', type: 'text', only: ['linkedin_post', 'x_post'] },
    { k: 'title', label: 'Title', type: 'text', pub: true, only: ['reddit_post', 'pinterest_pin', 'short_video', 'quora_answer'], hint: 'The post title, pin title, video title or the question being answered' },
    { k: 'copy', label: 'Post', type: 'long', pub: true, req: true, max: 4000, hint: 'The whole post, ready to paste, in the platform\'s own style. On Reddit, Quora and Facebook groups: useful first, no links, and say you work at the brand' },
    { k: 'hashtags', label: 'Hashtags', type: 'list', pub: true, only: ['x_post', 'linkedin_post', 'pinterest_pin', 'short_video'] },
    { k: 'script', label: 'Script', type: 'rows', cols: ['beat', 'shot', 'line'], only: ['short_video'], hint: '5 beats: the shot and the line said or shown' },
    { k: 'directions', label: 'How to film it', type: 'list', only: ['short_video'], hint: 'Filming directions, one line each: where to stand, framing and angle, energy, when the first word lands' },
    { k: 'media', label: 'Picture or video', type: 'long', hint: 'What to shoot or make. Real photos only in communities' },
    { k: 'where', label: 'Where to post', type: 'rows', cols: ['name', 'url', 'rule'], hint: 'Real communities, threads or the brand\'s own account only, with the rule that applies' },
    { k: 'postAt', label: 'Goes up', type: 'text', hint: 'Day and time' },
    { k: 'measure', label: 'How we know', type: 'text' }
  ],
  meta_ops: [
    { k: 'summary', label: 'What changes', type: 'text', req: true },
    { k: 'items', label: 'Campaigns or ad sets', type: 'rows', cols: ['name', 'now', 'next'], req: true, hint: '1-5 rows: only campaign or ad set names the card gives (never invent one), its state or budget now, and after' },
    { k: 'rule', label: 'Rule', type: 'text', hint: 'The condition, e.g. cost per first order over the stop line for 48 hours' },
    { k: 'checkAt', label: 'Checks', type: 'text' },
    { k: 'spendChangeWeek', label: 'Spend change a week', type: 'number', hint: 'Positive adds spend, negative saves, 0 if none' }
  ],
  store: [
    { k: 'pages', label: 'Where', type: 'text', req: true, hint: 'Which pages' },
    { k: 'section', label: 'Section', type: 'text', req: true, hint: 'Where on the page (a description change: top or end of the product description)' },
    { k: 'heading', label: 'Heading', type: 'text', pub: true, req: true },
    { k: 'body', label: 'Body', type: 'long', pub: true, req: true },
    { k: 'bullets', label: 'Points', type: 'list', pub: true },
    { k: 'button', label: 'Button', type: 'text', pub: true, only: ['pdp_block', 'new_section', 'price_change', 'bundle_offer'] },
    { k: 'priceBefore', label: 'Price now', type: 'text', only: ['price_change', 'bundle_offer'] },
    { k: 'priceAfter', label: 'Price after', type: 'text', only: ['price_change', 'bundle_offer'], req: true }
  ],
  vis: [
    { k: 'file', label: 'Page or file', type: 'text', req: true },
    { k: 'entries', label: 'Entries', type: 'rows', cols: ['q', 'a', 'source'], pub: true, req: true, hint: '1-5 entries: the buyer question, the answer, the claims-list source' },
    { k: 'asOf', label: 'As of', type: 'text' }
  ],
  crm: [
    { k: 'channel', label: 'Channel', type: 'select', req: true, opts: ['WhatsApp', 'Email', 'SMS'] },
    { k: 'flow', label: 'Flow and step', type: 'text' },
    { k: 'trigger', label: 'When it sends', type: 'text', req: true },
    { k: 'segment', label: 'Who gets it', type: 'text', req: true },
    { k: 'exclusions', label: 'Left out', type: 'text' },
    { k: 'subject', label: 'Subject line', type: 'text', pub: true },
    { k: 'message', label: 'Message', type: 'long', pub: true, req: true, hint: 'The message as sent, with {first_name} style variables' },
    { k: 'buttons', label: 'Buttons', type: 'list', pub: true },
    { k: 'code', label: 'Code', type: 'text', only: ['discount_offer'] },
    { k: 'expiry', label: 'Expires', type: 'text', only: ['discount_offer'] }
  ],
  /* a one-off email to a person at a business (a pitch, a partner, wholesale, corporate gifting, press): who it goes to and the
     words; no segment, no flow, no Klaviyo (QA J-09: a cold pitch opened as a Klaviyo flow message to opted-in buyers) */
  outreach: [
    { k: 'to', label: 'To', type: 'text', req: true, hint: 'The role or person it goes to, e.g. "Head of HR" or "Buyer, beauty"' },
    { k: 'company', label: 'Company', type: 'text', req: true, hint: 'The business or kind of business, as the card names it' },
    { k: 'subject', label: 'Subject line', type: 'text', pub: true, req: true },
    { k: 'body', label: 'Email', type: 'long', pub: true, req: true, hint: 'The email as sent: short, one ask, signed by a person at the brand' }
  ],
  brief: [
    { k: 'title', label: 'Working title', type: 'text', req: true },
    { k: 'deliverables', label: 'Deliverables', type: 'list', req: true },
    { k: 'scenes', label: 'Scenes', type: 'rows', cols: ['shot', 'line'], req: true, pub: true, hint: '3-6 shots, each with the on-screen or spoken line' },
    { k: 'talent', label: 'Talent', type: 'text' },
    { k: 'location', label: 'Location', type: 'text' },
    { k: 'deadline', label: 'Deadline', type: 'text' }
  ],
  decision: [
    { k: 'decision', label: 'Decision', type: 'text', req: true },
    { k: 'why', label: 'Why', type: 'long', req: true },
    { k: 'owner', label: 'Who decides', type: 'text', req: true },
    { k: 'changes', label: 'What changes', type: 'list' }
  ]
};
export const fieldsFor = (family, action) => (FIELDS[family] || []).filter((f) => !f.only || f.only.includes(String(action).split('.').pop()));

// knobs: the levers you can turn on each kind of asset. kind 'copy' → AI rewrites the package,
// 'image' → a new creative from the product photo, 'look' → instant (a colour grade on the creative).
export const KNOBS = {
  search: [
    { k: 'intent', label: 'Search intent', kind: 'copy', opts: ['Problem', 'Ingredient or alternative', 'Brand'] },
    { k: 'tone', label: 'Tone', kind: 'copy', opts: ['Proof first', 'Price first', 'Plain'] }
  ],
  setup: [{ k: 'pace', label: 'Roll-out', kind: 'copy', opts: ['All at once', 'Test first', 'One market first'] }],
  print: [
    { k: 'tone', label: 'Tone', kind: 'copy', opts: ['Warm', 'How-to', 'Proof first'] },
    { k: 'lang', label: 'Language', kind: 'copy', opts: ['English', 'Hindi', 'Hinglish'] }
  ],
  listing: [
    { k: 'style', label: 'Title style', kind: 'copy', opts: ['Claim first', 'Name first', 'Benefit first'] },
    { k: 'length', label: 'Length', kind: 'copy', opts: ['Short', 'Full, with size and pack'] },
    { k: 'which', label: 'Which listings', kind: 'copy', opts: ['Top 5', 'Quick commerce', 'All marketplaces'] }
  ],
  meta_ad: [
    { k: 'hook', label: 'Hook', kind: 'copy', opts: ['Number first', 'Real review', 'Founder story', 'Problem first'] },
    { k: 'lang', label: 'Language', kind: 'copy', opts: ['English', 'Hindi', 'Hinglish'] },
    { k: 'audience', label: 'Aim at', kind: 'copy', opts: ['Men 25-34', 'Women 30+', 'Gym-goers', 'Post-pregnancy'] },
    { k: 'scene', label: 'Scene', kind: 'image', opts: ['Bathroom shelf', 'In the hand', 'Lab blue', 'Space for a headline'] },
    { k: 'format', label: 'Aspect ratio', kind: 'image', opts: ['4:5', '1:1', '9:16'] },
    { k: 'grade', label: 'Colour grade', kind: 'look', opts: ['Original', 'Warm', 'Quiet', 'Vivid', 'Golden hour'] }
  ],
  post: [
    { k: 'tone', label: 'Tone', kind: 'copy', opts: ['Plainer', 'Warmer', 'More direct', 'Funnier'] },
    { k: 'length', label: 'Length', kind: 'copy', opts: ['Shorter', 'Same', 'More detail'] },
    { k: 'lang', label: 'Language', kind: 'copy', opts: ['English', 'Hinglish', 'Hindi'] }
  ],
  social: [
    { k: 'hook', label: 'Slide 1', kind: 'copy', opts: ['Number first', 'A question', 'Real review', 'Myth vs fact'] },
    { k: 'frame', label: 'Story shape', kind: 'copy', opts: ['Value stack', 'Problem, then proof', 'List of tips', 'Walkthrough'] },
    { k: 'count', label: 'Slides', kind: 'copy', opts: ['5 slides', '7 slides', '10 slides'] },
    { k: 'lang', label: 'Language', kind: 'copy', opts: ['English', 'Hindi', 'Hinglish'] },
    { k: 'scene', label: 'Scene', kind: 'image', opts: ['Bathroom shelf', 'In the hand', 'Flat lay', 'Space for a headline'] }
  ],
  meta_ops: [
    { k: 'bold', label: 'How bold', kind: 'copy', opts: ['Careful', 'Standard', 'Bold'] },
    { k: 'which', label: 'Which ad sets', kind: 'copy', opts: ['Worst 3', 'All over target', 'This campaign'] },
    { k: 'when', label: 'When', kind: 'copy', opts: ['Now', 'Tonight', 'Every Monday'] }
  ],
  store: [
    { k: 'where', label: 'Where on the page', kind: 'copy', opts: ['End of the description', 'Top of the description'] },
    { k: 'proof', label: 'Proof', kind: 'copy', opts: ['Study number', 'Customer review', 'Expert line'] },
    { k: 'tone', label: 'Tone', kind: 'copy', opts: ['Clinical', 'Warm', 'Punchy'] },
    { k: 'layout', label: 'Layout', kind: 'copy', opts: ['Short paragraph', 'Heading and points'] }
  ],
  vis: [
    { k: 'qs', label: 'Questions', kind: 'copy', opts: ['Just this one', 'Top 5', 'All 20'] },
    { k: 'style', label: 'Answer style', kind: 'copy', opts: ['Short', 'Detailed', 'Comparison table'] },
    { k: 'lang', label: 'Language', kind: 'copy', opts: ['English', 'Hindi'] }
  ],
  crm: [
    { k: 'channel', label: 'Channel', kind: 'copy', opts: ['WhatsApp', 'Email', 'SMS'] },
    { k: 'when', label: 'When', kind: 'copy', opts: ['Day 21', 'Day 30', 'Day 45'] },
    { k: 'tone', label: 'Tone', kind: 'copy', opts: ['Friendly', 'Expert', 'Urgent'] },
    { k: 'lang', label: 'Language', kind: 'copy', opts: ['English', 'Hindi', 'Hinglish'] },
    { k: 'offer', label: 'Offer', kind: 'copy', opts: ['None', 'Free shipping', 'Free sample'] }
  ],
  outreach: [
    { k: 'tone', label: 'Tone', kind: 'copy', opts: ['Warm', 'Direct', 'Formal'] },
    { k: 'length', label: 'Length', kind: 'copy', opts: ['Short', 'Detailed'] }
  ],
  brief: [
    { k: 'length', label: 'Length', kind: 'copy', opts: ['15s', '30s', '75s'] },
    { k: 'format', label: 'Format', kind: 'copy', opts: ['9:16', '4:5', '16:9'] },
    { k: 'talent', label: 'Talent', kind: 'copy', opts: ['Founder', 'Creator', 'Customer', 'Dermatologist'] },
    { k: 'hook', label: 'Hook', kind: 'copy', opts: ['Number first', 'Story', 'Question'] }
  ],
  decision: [
    { k: 'lean', label: 'Lean', kind: 'copy', opts: ['Our pick', 'Middle ground', 'Smallest step'] },
    { k: 'owner', label: 'Who decides', kind: 'copy', opts: ['Founder', 'Growth lead', 'Brand manager'] }
  ]
};
export const GRADES = { Original: 'none', Warm: 'sepia(.25) saturate(1.25) hue-rotate(-8deg)', Quiet: 'saturate(.6) brightness(1.05) contrast(.92)', Vivid: 'saturate(1.6) contrast(1.08)', 'Golden hour': 'sepia(.45) saturate(1.4) brightness(1.05)' };
export const SUGGEST = {
  search: ['More headlines with the number', 'Add negative keywords', 'Point it at the best page'],
  setup: ['Add a check that it works', 'Roll out to one market first'],
  print: ['Make it Hindi', 'Add a QR to the routine', 'Shorter front'],
  listing: ['Same name on every marketplace', 'Put the claim first', 'Add the pack size', 'Shorter for quick commerce'],
  meta_ad: ['Make it Hindi', 'Shorter primary text', 'A real review as the hook', 'For women 30+', 'Warmer photo, morning light'],
  post: ['Answer the question in the first line', 'Shorter', 'Less like an ad', 'Add an honest downside', 'End with a question'],
  social: ['Make it a carousel', 'Sharper first slide', 'Make it Hinglish', 'End with a question', 'Fewer hashtags'],
  meta_ops: ['Smaller first step', 'Only the worst 3', 'Add a stop rule', 'Run it every Monday'],
  store: ['Number first', 'Add a customer review', 'Heading and points', 'Shorter'],
  vis: ['Answer the top 5 questions', 'Add the source to every line', 'Make it a comparison'],
  crm: ['Make it Hindi', 'Softer, less salesy', 'Send on day 30 instead', 'Add a reorder button'],
  brief: ['Cut it to 15 seconds', 'Founder on camera', 'Open on the number'],
  outreach: ['Shorter', 'Lead with what they get', 'One clear ask', 'Warmer opening'],
  decision: ['Find a middle ground', 'What would we lose?', 'Smallest step first']
};

/* KNOBS and SUGGEST above are the base sets (first written for a haircare brand in India). Every brand gets them from its own
   pack: languages from its market, "Aim at" from its personas, neutral scenes, talent and proof. Nothing brand-specific
   is hard-coded for any other brand. b = the brand pack ({ slug, config: { country, lang }, personas }). */
const LANG_NAME = { hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', id: 'Indonesian', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi' };
export const marketLangs = (b) => { const c = b?.config || {}; if (String(c.country || '').toUpperCase() === 'IN') return ['English', 'Hindi', 'Hinglish'];
  const l = String(c.lang || 'en').slice(0, 2).toLowerCase(); return l !== 'en' && LANG_NAME[l] ? [LANG_NAME[l], 'English'] : ['English']; };
const personaLabel = (n) => { const x = String(n || '').replace(/^the\s+/i, '').trim(); return x ? x[0].toUpperCase() + x.slice(1) : ''; };
export const audienceOf = (b) => (b?.personas || []).map((p) => personaLabel(p?.name)).filter((x) => x && x.length <= 40).slice(0, 4);
const generic = (b) => !!b; // every brand pack is read the same way
const NEUTRAL = {
  audience: ['New customers', 'Past buyers', 'People like your best buyers'],
  scene: { meta_ad: ['In the hand', 'In-use shot', 'Plain backdrop', 'Space for a headline'], social: ['In the hand', 'In-use shot', 'Flat lay', 'Space for a headline'] },
  talent: ['Founder', 'Creator', 'Customer', 'Someone from the team'],
  store: { proof: ['Customer review', 'Star rating', 'A number from the page'], tone: ['Plain', 'Warm', 'Punchy'] }
};
// the knobs for one change, in this brand's terms (a knob left with fewer than 2 options is dropped)
export const knobsFor = (family, b) => {
  const base = KNOBS[family] || []; if (!generic(b)) return base;
  const langs = marketLangs(b), aud = audienceOf(b);
  return base.map((k) => {
    if (k.k === 'lang') return { ...k, opts: family === 'vis' ? langs.filter((x) => x !== 'Hinglish') : langs };
    if (k.k === 'audience') return { ...k, opts: aud.length >= 2 ? aud : NEUTRAL.audience };
    if (k.k === 'scene') return { ...k, opts: NEUTRAL.scene[family] || NEUTRAL.scene.meta_ad };
    if (k.k === 'talent') return { ...k, opts: NEUTRAL.talent };
    if (family === 'store' && NEUTRAL.store[k.k]) return { ...k, opts: NEUTRAL.store[k.k] };
    return k;
  }).filter((k) => (k.opts || []).length > 1);
};
// a chip or intent from the base sets that doesn't fit this brand's market or category: rewritten for it, or dropped (null)
export const fitChip = (x, b) => {
  if (!generic(b)) return x;
  const langs = marketLangs(b), aud = audienceOf(b), other = langs.find((l) => l !== 'English');
  const m = /^(Make it |)(Hindi|Hinglish)( version)?$/.exec(x);
  if (m) return langs.includes(m[2]) ? x : other ? `${m[1]}${other}${m[3] || ''}` : null;
  if (/^For women 30\+$/i.test(x)) return aud[0] ? `Aim it at the ${aud[0].toLowerCase()}` : 'Aim it at past buyers';
  if (/^Add a QR to the routine$/i.test(x)) return 'Add a QR code to the product page';
  if (/^(Study first|With the study)$/i.test(x)) return x.replace(/the study|Study/i, (w) => (w[0] === 'S' ? 'Proof' : 'the proof'));
  if (/^Lead with the routine$/i.test(x)) return 'Lead with the best seller';
  return x;
};
/* the chips above the jam's composer follow the card's own action, never the widget family: a "pause the ads on
   sold-out products" jam offers ways to cut THAT pause. {n} is how many things the card names, {product} the first */
export const ACTION_CHIPS = {
  pause_pointing: ['Only the sold-out products', 'Swap in an in-stock product instead', 'Restart when back in stock', 'List every ad first'],
  restart_paused: ['Only what was paused for stock', 'Restart at a lower budget', 'Restart {product} first', 'Check stock again first'],
  price_in_ads: ['Update all {n} prices', 'New price in the first line', 'Live ads only', 'Messages too'],
  fix_links: ['Redirect to the closest product', 'Redirect to the collection', 'Pause the ads that point there', 'List every link first'],
  pause_losers: ['Only the worst 3', 'Pause for 48 hours first', 'Keep the winners running', 'Show the numbers per ad set'],
  stop_rule: ['Stricter stop line', 'Looser stop line', 'Check every morning', 'Ask me before it scales'],
  scale_budget: ['+20% a day', 'One ad set first', 'Stop if cost per order rises', 'Smaller first step'],
  shift_budget: ['Smaller shift', 'Winners only', 'Keep total spend the same', 'Move it back after 7 days'],
  new_test: ['Smaller budget', 'New audience', 'Read it after 7 days', 'One hook only'],
  swap_copy: ['Shorter', 'Number first', 'Keep the photo', 'A real review as the hook'],
  add_variants: ['A sharper hook', 'A real review as the hook', 'Shorter primary text', 'Number first'],
  swap_creative: ['New hook', 'New look, same offer', 'Replace the most tired ad', 'Shorter primary text'],
  whatsapp_ad: ['Warmer first message', 'Answer price in the chat', 'Shorter chat', 'Shorter primary text'],
  carousel_ad: ['Five cards', 'One product per card', 'Proof on the last card', 'Shorter card lines'],
  collection_ad: ['Best sellers only', 'New arrivals first', 'Stronger cover line', 'Fewer products'],
  catalog_ad: ['Price on the frame', 'Rating on the frame', 'In-stock best sellers only', 'Shorter frame line'],
  ig_post: ['Number first', 'A real review on the photo', 'Shorter caption', 'End with a question'],
  ig_carousel: ['Sharper first slide', 'Seven slides', 'Myth vs fact', 'Save-worthy last slide'],
  ig_story: ['Add a poll', 'Three stories', 'Question sticker at the end', 'Shorter lines'],
  film_brief: ['Cut it to 15 seconds', 'Open on the product', 'Founder on camera', 'Fewer shots'],
  creative_brief: ['Five angles', 'Real reviews as hooks', 'Add references', 'Tighter deadline'],
  short_video: ['Hook in the first second', 'Shorter', 'Show the product sooner', 'End with a question'],
  x_post: ['Shorter', 'As a thread', 'Plainer, less like an ad', 'End with a question'],
  linkedin_post: ['Shorter', 'More personal', 'One lesson only', 'End with a question'],
  reddit_post: ['Answer first', 'Add an honest downside', 'Shorter', 'Say who we are up front'],
  quora_answer: ['Direct answer first', 'Add a fair comparison', 'Shorter', 'Say who we are up front'],
  fb_group_post: ['Warmer', 'Ask the group', 'Shorter', 'Say who we are up front'],
  pinterest_pin: ['More search words', 'Shorter title', 'Vertical photo', 'Point it at the best page'],
  comment_reply: ['Answer in one line', 'Friendlier', 'Say who we are up front', 'Add the size or price they asked'],
  page_copy: ['Use the customers’ own words', 'Shorter section', 'Points, not a paragraph', 'Only on {product}'],
  pdp_block: ['Reviews first', 'Proof first', 'Shorter block', 'Under the add-to-cart button'],
  new_section: ['One moment to start', 'Mobile first', 'Simpler layout', 'Fewer blocks'],
  price_change: ['Smaller step', 'Explain the why', 'One product first', 'Show the old price'],
  bundle_offer: ['Two tiles, not three', 'Lead with the best seller', 'Smaller saving', 'Simpler names'],
  store_setting: ['Test on one product', 'Roll out to one market first', 'Add a check that it works', 'Show what customers see'],
  blog_post: ['Shorter', 'More sources', 'Answer the question first', 'Add a summary up top'],
  buyer_deck: ['Shorter deck', 'Lead with the numbers', 'One page leave-behind', 'Add the margin'],
  outreach_email: ['Shorter', 'Lead with what they get', 'One clear ask', 'Warmer opening'],
  listing_titles: ['Same name on every marketplace', 'Claim first, short', 'Add the pack size', 'Start with one listing'],
  listing_content: ['Same images everywhere', 'Bullets only', 'Add more photos', 'Start with one listing'],
  takedown: ['Firm but polite', 'With evidence', 'Shorter request', 'Name the listing exactly'],
  faq_entry: ['Tighter answer', 'Add the source', 'Answer the top 5 questions', 'Date it'],
  llms_txt: ['Fewer lines', 'Add dates', 'Add the source to every line', 'Products first'],
  schema_fix: ['Price and rating only', 'Every product', 'Add the reviews count', 'Check it validates'],
  new_claim: ['Softer claim', 'With the proof', 'Add the source', 'Date it'],
  tracking_fix: ['Meta first', 'Google first', 'Test one order first', 'Server events too'],
  search_ad: ['Exact match only', 'Add negatives', 'More headlines with the number', 'Point it at the best page'],
  print_insert: ['Fewer words', 'Bigger QR', 'Shorter front', 'Thank them first'],
  flow_copy: ['Softer, less salesy', 'Shorter', 'Add a button', 'Send a day later'],
  flow_timing: ['Later send', 'Fewer messages', 'One message in 7 days', 'Send in the evening'],
  review_ask: ['Ask for a photo', 'Shorter ask', 'Ask which size they kept', 'Send a week later'],
  new_segment: ['Tighter segment', 'Leave out new buyers', 'Show the size', 'Exclude returns'],
  paid_broadcast: ['Smaller list first', 'Shorter', 'Add a button', 'Send in the evening'],
  discount_offer: ['Smaller offer', 'Shorter expiry', 'Only past buyers', 'One use per customer'],
  plan: ['Owners and dates', 'First step only', 'What would we lose?', 'Smallest step first'],
  resolution: ['Find a middle ground', 'Go with our pick', 'What would we lose?', 'Smallest step first']
};
// the case on the card fills the chips ({n}, {product}); a chip whose blank can't be filled is dropped
export const chipsFor = (action, c = {}, b) => { const act = String(action).split('.').pop(), rows = (c.rows || []).filter((r) => r?.[0]);
  const n = rows.length > 1 ? String(rows.length) : (String(c.title || '').match(/^(\d+)\s/) || [])[1] || '', product = rows[0] ? String(rows[0][0]).replace(/\s*[|(].*$/, '').slice(0, 28) : '';
  return [...new Set((ACTION_CHIPS[act] || []).map((x) => (/\{n\}/.test(x) && !n) || (/\{product\}/.test(x) && !product) ? null : x.replace('{n}', n).replace('{product}', product)).map((x) => x && fitChip(x, b)).filter(Boolean))]; };
/* the AI's "next" chips are kept only when they talk about this change: a word they share with the action, its spec
   or the card (Param, 2026-10-14: chips must follow the card's recommended action) */
const STOP = new Set(['this', 'that', 'with', 'from', 'your', 'make', 'more', 'less', 'into', 'than', 'them', 'they', 'what', 'just', 'only', 'have', 'every', 'each', 'about']);
const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{4,}/g)?.map((w) => w.replace(/(ing|ed|es|s)$/, '')).filter((w) => w.length >= 4 && !STOP.has(w)) || []);
export const chipRelates = (chip, ctx) => { const w = words(chip); for (const x of w) if (ctx.has(x)) return true; return false; };
export const chipCtx = (action, label, c = {}) => words([label, ACTION_SPEC[String(action).split('.').pop()], c.title, c.sub, c.cta?.label, ...(ACTION_CHIPS[String(action).split('.').pop()] || [])].join(' '));
export const suggestFor = (family, b) => [...new Set((SUGGEST[family] || []).map((x) => fitChip(x, b)).filter(Boolean))];

// JSON schema for a package (one or more families: remix options may mix them)
const fieldSchema = (f) => {
  const d = [f.label, f.hint].filter(Boolean).join('. ');
  if (f.type === 'list') return { type: 'array', items: { type: 'string' }, description: d };
  if (f.type === 'rows') return { type: 'array', items: { type: 'object', properties: Object.fromEntries(f.cols.map((c) => [c, { type: 'string' }])), required: f.cols }, description: d };
  if (f.type === 'number') return { type: 'number', description: d };
  if (f.type === 'select') return { type: 'string', enum: f.opts, description: d };
  return { type: 'string', description: d };
};
export const pkgSchema = (families) => {
  const props = {};
  families.forEach((fam) => (FIELDS[fam] || []).forEach((f) => { props[f.k] ||= fieldSchema(f); }));
  return { type: 'object', properties: props, description: 'The full package, exactly as it ships. Fill every field that applies to the action.' };
};
// compact wire format for Claude: a list of {k, v} string pairs (structured outputs reject big schemas)
export const kvSchema = (keys) => ({ type: 'array', description: 'The package: one entry per field, using the field keys listed', items: { type: 'object', required: ['k', 'v'], properties: { k: { type: 'string', enum: [...new Set(keys)] }, v: { type: 'string' } } } });
export const allKeys = (families) => families.flatMap((f) => (FIELDS[f] || []).map((x) => x.k));
// a list item's marker ("- ", "• ", "1. ", "2) "), never the number the item starts with ("12,709 ratings" used to lose its "12")
export const LIST_MARK = /^\s*(?:[-•*]+|\d{1,2}[.)](?!\d))\s*/;
export const fromKV = (family, action, kv = []) => {
  const fs = fieldsFor(family, action); const out = {};
  (Array.isArray(kv) ? kv : []).forEach(({ k, v }) => {
    const f = fs.find((x) => x.k === k); if (!f || v == null) return; const val = String(v).trim(); if (!val) return;
    if (f.type === 'list') out[k] = val.split(/\n|\s*;\s*/).map((x) => x.replace(LIST_MARK, '').trim()).filter(Boolean);
    else if (f.type === 'rows') out[k] = val.split('\n').map((line) => { const parts = line.split('|').map((x) => x.trim()); return Object.fromEntries(f.cols.map((c, i) => [c, i === f.cols.length - 1 ? parts.slice(i).join(' | ') : parts[i] || ''])); }).filter((r) => Object.values(r).some(Boolean));
    else if (f.type === 'number') { const n = +val.replace(/[^\d.-]/g, ''); if (!Number.isNaN(n)) out[k] = n; }
    else out[k] = val;
  });
  return out;
};
export const toKV = (family, action, pkg = {}) => fieldsFor(family, action).filter((f) => pkg[f.k] != null && pkg[f.k] !== '').map((f) => {
  const v = pkg[f.k];
  return { k: f.k, v: f.type === 'list' ? v.join('\n') : f.type === 'rows' ? v.map((r) => f.cols.map((c) => r[c]).join(' | ')).join('\n') : String(v) };
});
// every long text is written already formatted for where it appears, never one block of text (Param: formatting is built in, always)
export const LONG_FORMAT = 'Format it for where it appears, from the first draft: short paragraphs of 1–3 sentences with a blank line between them; when it has several parts, a short label line (2–4 words) on its own line above each part; "- " lines for any list; quotes on their own line. Never one block of text';
export const fieldsBrief = (family, action) => fieldsFor(family, action).map((f) => `  - ${f.k}: ${f.label}${f.req ? ' (required)' : ''}${f.hint ? '. ' + f.hint : ''}${f.opts ? `. One of: ${f.opts.join(' / ')}` : ''}${f.type === 'long' ? `. ${LONG_FORMAT}` : ''}${f.type === 'list' ? '. One item per line' : ''}${f.type === 'rows' ? `. One row per line: ${f.cols.join(' | ')}` : ''}${f.type === 'number' ? '. A number' : ''}`).join('\n');

const str = (v) => (v == null ? '' : String(v));
export const cleanPkg = (family, action, pkg = {}, clean = (s) => s) => {
  const out = {};
  fieldsFor(family, action).forEach((f) => {
    const v = pkg[f.k]; if (v == null || v === '') return;
    if (f.type === 'list') out[f.k] = (Array.isArray(v) ? v : String(v).split('\n')).map((x) => clean(str(x)).trim()).filter(Boolean).slice(0, 8);
    else if (f.type === 'rows') out[f.k] = (Array.isArray(v) ? v : []).slice(0, 10).map((r) => Object.fromEntries(f.cols.map((c) => [c, clean(str(r?.[c])).slice(0, 400)])));
    else if (f.type === 'number') { const n = +String(v).replace(/[^\d.-]/g, ''); if (!Number.isNaN(n)) out[f.k] = Math.round(n); }
    else if (f.type === 'select') out[f.k] = f.opts.includes(v) ? v : f.opts[0];
    else out[f.k] = clean(str(v)).slice(0, f.max || (f.type === 'long' ? 900 : 240));
  });
  ['image', 'knobs', 'grade', 'cardImages', 'wordsIn', 'photoSet', 'film'].forEach((k) => { if (pkg[k] != null) out[k] = pkg[k]; });
  /* Amazon A+ modules (Brew Studio): the picture is kept, the words are cleaned to Amazon's lengths */
  if (Array.isArray(pkg.aplus)) out.aplus = pkg.aplus.slice(0, 7).filter((m) => m && m.image).map((m) => ({ kind: ['header', 'tile', 'wide'].includes(m.kind) ? m.kind : 'tile', image: str(m.image), style: m.style ? str(m.style) : null, headline: clean(str(m.headline)).slice(0, 160), body: clean(str(m.body)).slice(0, 1000) }));
  /* ready to publish: the link (with its UTM) and the alt text the team set; anything else in it is dropped */
  if (pkg.publish && typeof pkg.publish === 'object') { const pb = {}; const link = str(pkg.publish.link).trim(); if (/^https?:\/\/\S+$/.test(link)) pb.link = link.slice(0, 600); const alt = clean(str(pkg.publish.alt)).trim(); if (alt) pb.alt = alt.slice(0, 220); if (Object.keys(pb).length) out.publish = pb; }
  return out;
};
export const publicText = (family, action, pkg = {}) => fieldsFor(family, action).filter((f) => f.pub).flatMap((f) => {
  const v = pkg[f.k]; if (!v) return [];
  if (f.type === 'rows') return v.flatMap((r) => f.cols.filter((c) => !['source', 'from', 'imageBrief', 'link'].includes(c)).map((c) => r[c]));
  return Array.isArray(v) ? v : [v];
}).filter(Boolean).map(String);
export const missing = (family, action, pkg = {}) => fieldsFor(family, action).filter((f) => f.req && (pkg[f.k] == null || pkg[f.k] === '' || (Array.isArray(pkg[f.k]) && !pkg[f.k].length))).map((f) => f.label);

// the card-sized "after" every list, check and learning signal reads
export const afterFromPkg = (family, pkg = {}, base = {}) => {
  const p = pkg; const a = { title: '', sub: '', rows: null, bullets: null, chat: null, images: p.image ? [p.image] : base.images || null, q: null, a: null };
  if (family === 'meta_ad') { a.title = p.headline || p.overlay || ''; a.sub = p.primaryText || ''; a.chat = p.chat?.length ? p.chat.map((r) => [r.from === 'in' ? 'in' : 'out', r.text]) : null; a.rows = [['Ad set', p.adSet], ['Audience', p.audience], ['Button', p.cta], ['Format', p.cards?.length ? `Carousel, ${p.cards.length} cards` : p.products?.length ? `Collection, ${p.products.length} products` : p.productSet ? 'Catalog ad' : p.format]].filter((r) => r[1]);
    if (p.cards?.length) a.bullets = p.cards.map((c) => [c.headline, c.text].filter(Boolean).join(': '));
    if (p.products?.length) a.bullets = p.products;
    if (p.cardImages?.filter(Boolean).length) a.images = [p.image, ...p.cardImages].filter(Boolean); }
  if (family === 'social') { const sl = p.slides || []; a.title = sl[0]?.onSlide || p.overlay || String(p.caption || '').split('\n')[0].slice(0, 90); a.sub = p.caption || ''; a.bullets = sl.length > 1 ? sl.map((x) => x.onSlide) : null;
    a.rows = [['Shape', sl.length ? `${sl.length} ${p.format === '9:16' ? 'stories' : 'slides'}` : 'Single post'], ['Account', p.account], ['Goes up', p.postAt]].filter((r) => r[1]);
    if (p.cardImages?.filter(Boolean).length) a.images = [p.image, ...p.cardImages].filter(Boolean); }
  if (family === 'post') { a.title = p.title || String(p.copy || '').split('\n').find((x) => x.trim()) || ''; a.title = a.title.replace(/^title:\s*/i, '').slice(0, 120); a.sub = p.copy || ''; a.bullets = (p.script || []).length ? p.script.map((x) => `${x.shot}: ${x.line}`) : null;
    a.rows = [['Platform', p.platform], ['Where', (p.where || []).map((w) => w.name).filter(Boolean).slice(0, 2).join(' · ')], ['Goes up', p.postAt]].filter((r) => r[1]); }
  if (family === 'meta_ops') { a.title = p.summary || ''; a.sub = p.rule || ''; a.rows = (p.items || []).map((r) => [r.name, `${r.now} → ${r.next}`]); }
  if (family === 'store') { a.title = p.heading || ''; a.sub = p.body || ''; a.bullets = p.bullets?.length ? p.bullets : null; a.rows = [['Where', [p.pages, p.section].filter(Boolean).join(' · ')], ['Price', p.priceAfter ? `${p.priceBefore || 'now'} → ${p.priceAfter}` : ''], ['Test', p.split]].filter((r) => r[1]); }
  if (family === 'vis') { const e = p.entries || []; a.title = e[0]?.q || p.file || ''; a.sub = e[0]?.a || ''; a.q = e[0]?.q || null; a.a = e[0]?.a || null; a.bullets = e.slice(1).map((x) => `${x.q} ${x.a}`); a.rows = [['File', p.file], ['As of', p.asOf]].filter((r) => r[1]); }
  if (family === 'crm') { a.title = p.subject || str(p.message).split(/(?<=[.!?])\s/)[0].slice(0, 80); a.sub = p.message || ''; a.chat = p.message ? [['out', p.message], ...(p.buttons || []).map((b) => ['btn', b])] : null; a.rows = [['Channel', p.channel], ['Sends', p.trigger], ['To', p.segment]].filter((r) => r[1]); }
  if (family === 'brief') { a.title = p.title || p.deliverables?.[0] || ''; a.sub = [p.talent, p.location].filter(Boolean).join(' · '); a.bullets = (p.scenes || []).map((s) => `${s.shot}: ${s.line}`); a.rows = [['Deliverables', (p.deliverables || []).join(', ')], ['Deadline', p.deadline]].filter((r) => r[1]); }
  if (family === 'search') { a.title = p.headlines?.[0] || p.adGroup || ''; a.sub = p.descriptions?.[0] || ''; a.rows = [['Ad group', p.adGroup], ['Keywords', (p.keywords || []).slice(0, 3).join(', ')], ['Lands on', p.finalUrl]].filter((r) => r[1]); }
  if (family === 'setup') { a.title = p.what ? String(p.what).split(/(?<=[.!?])\s/)[0] : p.tool || ''; a.sub = p.verify || ''; a.bullets = p.steps?.length ? p.steps : null; a.rows = [['Where', p.tool]].filter((r) => r[1]); }
  if (family === 'print') { a.title = String(p.front || '').split('\n')[0].slice(0, 80); a.sub = p.back || ''; a.rows = [['Size', p.size], ['Quantity', p.quantity], ['Goes into', p.goesIn]].filter((r) => r[1]); }
  if (family === 'listing') { a.title = p.name || p.items?.[0]?.new || p.product || ''; a.sub = (p.items || []).length ? `${p.items.length} listings: ${p.items.map((r) => r.marketplace).join(', ')}` : p.reason || ''; a.rows = (p.items || []).map((r) => [r.marketplace, r.new]); a.bullets = p.bullets?.length ? p.bullets : null; }
  if (family === 'outreach') { const who = outreachTo(c), named = P.name && P.name !== 'the product', line = named ? ` ${P.name}${P.claim ? `: ${P.claim.replace(/[.!]+$/, '')}` : ''}.` : '';
    return { to: who.to, company: who.company, subject: wcut(`${N} for ${who.company.toLowerCase()}`, 60), body: `Hi,\n\nI work at ${N}${BH() ? ` (${BH()})` : ''}.${line}\n\nWould you be open to a 15-minute call next week to see if it fits your team?\n\nThanks,\n{your_name}, ${N}` }; }
  if (family === 'decision') { a.title = p.decision || ''; a.sub = p.why || ''; a.bullets = p.changes?.length ? p.changes : null; a.rows = [['Who decides', p.owner]].filter((r) => r[1]); }
  a.publicText = null;
  return a;
};

// Cards are internal notes for the team (revenue, goals, moves, plans). Packages are what customers and channels see.
// Anything that reads like the team talking to itself must never reach a public field.
export const INTERNAL = /\b(FY ?\d{2}|revenue|forecast|run[- ]?rate|revenue goal|scoreboard|crore|\d+(?:\.\d+)?\s?Cr\b|lakh a (?:week|month)|ROAS|CPA|cost per (?:first )?order|repeat (?:rate|track|buyers)|Brew|moves? \d+|our pick|the team|funnel|conversion rate|cohort|LTV|CAC|North Star|KPI|design partner|ad set|stop line|visitors leave|92% of visitors)\b/i;
export const leaks = (family, action, pkg = {}) => {
  const hits = new Set();
  publicText(family, action, pkg).forEach((t) => { const m = String(t).match(INTERNAL); if (m) hits.add(m[0]); });
  if (family === 'meta_ops') (pkg.items || []).forEach((r) => { const m = String(r.name || '').match(/\b(revenue|forecast|goals?|FY ?\d{2}|crore|\d+(?:\.\d+)?\s?Cr\b)\b/i); if (m) hits.add(m[0]); });
  return [...hits];
};

// offline template: built from the product facts, written to the customer, never from the card's internal words
export const PRODUCT = (lane) => {
  const LP = B()?.config?.laneProducts; // lane products read from the live catalog
  return (LP && (LP[lane] || Object.values(LP)[0])) || { name: 'the product', short: 'the product', price: '', claim: '', hook: '', page: BH(), photo: 'The product on a clean surface, soft daylight.' };
};
export const mockPkg = (family, action, c, i = 0, angle = '', F = {}) => {
  const act = String(action).split('.').pop();
  if (family === 'social') return c.post ? ideaPkg(c.post, act) : socialPkg(act, c, i, F);
  if (family === 'post') return ideaPkg(c.post || {}, act, c);
  const base = genericPkg(family, action, c, i, angle, F);
  return family === 'meta_ad' ? { ...base, ...multiPkg(act, c, F) } : base;
};
// offline: the multi-part formats, from the product facts (no claim the site doesn't make)
const lanesOf = (c, F) => { const LP = B()?.config?.laneProducts; return LP ? Object.values(LP) : [productFor(c, F)]; };
const multiPkg = (act, c, F) => {
  const P = tplProduct(c, F), all = lanesOf(c, F);
  if (act === 'carousel_ad') return { cards: [{ headline: wcut(P.hook || P.name, 40), text: P.claim || P.name, imageBrief: P.photo, link: P.page }, ...all.filter((x) => x.name !== P.name).slice(0, 3).map((x) => ({ headline: String(x.short || x.name).replace(/^the /, '').slice(0, 40), text: x.price ? `${x.name}, ${x.price}` : x.name, imageBrief: x.photo, link: x.page }))], format: '1:1' };
  if (act === 'collection_ad') return { products: all.slice(0, 6).map((x) => x.name), instantPage: `The ${BN()} range, best sellers first` };
  if (act === 'catalog_ad') return { productSet: 'Every in-stock best seller', frame: P.hook ? wcut(P.hook, 40) : `${BN()} · free delivery` };
  return {};
};
const socialPkg = (act, c, i, F) => {
  const P = tplProduct(c, F), hook = P.hook, handle = '@' + String(BN()).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const tags = [`#${String(BN()).replace(/\W+/g, '')}`];
  if (act === 'ig_post') return { account: handle, overlay: wcut(hook, 50), imageBrief: P.photo, caption: `${P.lead ? `${P.lead}.\n\n` : ''}${P.name}.${P.claim ? ' ' + P.claim.replace(/[.!]+$/, '') + '.' : ''}\n\nTell us what you want to see next.`, hashtags: tags, format: '4:5', postAt: 'Thursday 7 pm' };
  const steps = (c.detail?.how || []).slice(0, 3);
  const slides = [{ onSlide: wcut(c.title || hook, 70), imageBrief: P.photo }, ...steps.map((x) => ({ onSlide: x, imageBrief: P.photo })), { onSlide: act === 'ig_story' ? 'Which one is you? Vote below' : 'Save this for later', imageBrief: P.photo }];
  return { account: handle, slides, caption: `${hook}.\n\n${(c.detail?.why || []).slice(0, 2).join(' ')}`.trim(), hashtags: tags, ...(act === 'ig_story' ? { stickers: 'A poll on the last story' } : {}), format: act === 'ig_story' ? '9:16' : '4:5', postAt: 'Thursday 7 pm' };
};
// any other brand, offline: the same shapes, written only from the catalog (no claim the site doesn't make)
const genericPkg = (family, action, c, i = 0, angle = '', F = {}) => {
  const P = tplProduct(c, F), act = String(action).split('.').pop(), N = BN(), sym = B().sym || '';
  if (family === 'meta_ops' && opsPkg(act, c)) return opsPkg(act, c);
  if (family === 'meta_ops' && act === 'shift_budget' && c.shift?.from && c.shift?.to) return shiftPkg(c, sym);
  if (act === 'fix_links') return linksPkg(c);
  const claim = P.claim ? ` ${P.claim.replace(/[.!]+$/, '')}.` : '', hook = P.hook;
  const sh = P.short.replace(/^the /, '');
  if (family === 'meta_ad') return { primaryText: `${P.lead ? `${P.lead}. ` : ''}${P.name}${P.price ? `, ${P.price}` : ''}.${claim}`, headline: wcut(hook, 40), description: 'Shop the range', overlay: hook, cta: act === 'whatsapp_ad' ? 'Send WhatsApp message' : 'Shop now', ...(act === 'whatsapp_ad' ? { chat: [{ from: 'in', text: `Hi, I want to know about ${P.short}` }, { from: 'out', text: `Hi! ${P.name}${P.price ? ` is ${P.price}` : ''}.${claim}` }] } : {}), imageBrief: P.photo, format: '4:5', audience: `${CTRY()}, people interested in ${B().config.category || 'the category'}`, placements: 'Instagram and Facebook feeds, Reels', adSet: `${sh} | Broad | ${act === 'new_test' ? 'Test' : 'Feed'}`, schedule: 'Starts tomorrow, read after 7 days', utm: `${P.page}?utm_source=meta&utm_campaign=remix` };
  /* the campaigns or ad sets the card itself names; without any, one row for the team to fill in, never a made-up ad set name */
  if (family === 'meta_ops') { const named = (c.rows || []).filter((r) => /^(campaigns?|ad sets?|from|to|tired ad)/i.test(String(r?.[0] || '')) && r[1]).slice(0, 5).map((r) => String(r[1]).split(' · ')[0].slice(0, 90));
    return { summary: `${angle && !/^do it\b/i.test(angle) ? angle + ': ' : ''}${ACT_LABEL[act] || 'Change'}${sh ? ` for ${sh}` : ''}` /* never the intent chip (QA J-19) */,
      items: (named.length ? named : ['The ad sets your team picks']).map((name) => ({ name, now: 'As set today', next: act === 'pause_losers' ? 'Paused if above target' : act === 'scale_budget' ? 'Budget up 20%' : 'Changed by the rule' })),
      rule: OPS_RULE[act] || 'Pause any ad set whose cost per first order stays above target for 48 hours', checkAt: 'Every morning at 9', spendChangeWeek: 0 }; }
  if (family === 'store') return { pages: P.page, section: i % 2 ? 'Top of the product description' : 'End of the product description', heading: hook, body: `${P.name}.${claim}`.trim(), bullets: [P.claim].filter(Boolean) }; /* the product's own claim: a card's reasons are notes for the team, never page points (QA J-19) */
  if (family === 'vis') return { file: act === 'llms_txt' ? `${BH()}/llms.txt` : act === 'schema_fix' ? `Product markup (JSON-LD) on ${BH()} product pages` : B()?.config?.platform && B().config.platform !== 'shopify' ? `${BH()} FAQ page` : `${BH()}/pages/faq`, entries: [{ q: c.q || `Is ${P.name} good?`, a: `${P.name}${P.price ? ` costs ${P.price} on ${BH()}` : ''}.${claim}`, source: 'Product page' }], asOf: 'As of today' };
  if (family === 'crm') return { channel: act === 'flow_copy' || act === 'review_ask' ? 'WhatsApp' : 'Email', flow: 'Second order flow, step 1', trigger: 'Day 21 after delivery', segment: 'Opted-in buyers', exclusions: 'Returns, anyone who ordered this week', subject: `How is ${P.short} going?`, message: act === 'review_ask' ? `Hi {first_name}, how is ${P.short} going? A quick review helps others decide.` : `Hi {first_name}, how is ${P.short} going? Need more before it runs out?`, buttons: act === 'review_ask' ? ['Write a review', 'Ask a question'] : ['Reorder', 'Ask a question'] };
  if (family === 'search') return { adGroup: `${sh && sh !== 'product' ? sh : N} | Problem | Phrase`, keywords: (B().config.terms?.[0] || []).slice(0, 3).map((k) => `"${k}" (phrase)`), negatives: ['free', 'diy'], headlines: [wcut(hook, 30), `${sh}${P.price ? ', ' + P.price : ''}`.slice(0, 30)], descriptions: [`${P.name}.${claim}`.slice(0, 90)], finalUrl: P.page, bidding: 'Maximise conversions, target cost per order from the plan' };
  if (family === 'listing') { const nm = String(P.name).toLowerCase().startsWith(String(N).toLowerCase()) ? P.name : `${N} ${P.name}`; /* never "Arata Arata …" (QA J-19) */ return { product: P.name, name: nm, items: (B().config.marketplaces || ['Amazon']).map((m) => ({ marketplace: m, now: 'As listed today', new: nm })), bullets: [P.claim].filter(Boolean), images: 'The same images on every listing, product first', searchTerms: (B().config.terms?.[0] || []).slice(0, 3).join(', ') }; }
  if (family === 'brief') return { title: `${hook}: a 30-second film`, deliverables: ['One 30s film, 9:16', 'Two 15s cuts, 9:16 and 4:5'], scenes: [{ shot: 'Close-up: the product in hand', line: hook }, { shot: 'In use', line: P.claim || P.name }, { shot: 'Pack shot with price', line: `${P.name}${P.price ? ', ' + P.price : ''}.` }], talent: 'To confirm', location: 'To confirm', deadline: 'This week' };
  if (family === 'setup') return { tool: 'Store and ad tracking', what: c.title || 'Change a setting', steps: (c.detail?.how || ['Change the setting', 'Test a full order on mobile', 'Watch for 7 days']).slice(0, 4), verify: 'Before and after, the same number', customerSees: 'Nothing changes for customers' };
  if (family === 'outreach') { const who = outreachTo(c); return { to: who.to, company: who.company, subject: wcut(`${N} x ${who.company}`, 60), body: `Hi,\n\nI work at ${N}${BH() ? ` (${BH()})` : ''}. ${P.name}${P.claim ? `: ${P.claim.replace(/[.!]+$/, '')}` : ''}.\n\nWould you be open to a 15-minute call next week to see if it fits ${who.company}?\n\nThanks,\n{your_name}, ${N}` }; }
  if (family === 'print') return { front: `Thanks for choosing ${N}.`, back: 'Scan for how to get the most from it.', qr: `${BH()}`, size: 'A6 card', quantity: 'To confirm', goesIn: 'Every order' };
  const op = c.options?.[i % (c.options?.length || 1)];
  if (act === 'plan') return { decision: String(c.title || 'The plan'), why: [c.sub, ...(c.detail?.why || [])].filter(Boolean).join(' '), owner: 'Founder', changes: (c.detail?.how || []).slice(0, 5) };
  return { decision: op?.name || 'Pick one answer and use it everywhere', why: op?.effect || op?.says || '', owner: 'Founder', changes: (c.affects || []).slice(0, 4) };
};
const linksPkg = (c) => { const names = (c.rows || []).map((r) => r?.[0]).filter(Boolean).slice(0, 6);
  return { tool: `${BH() || "Shopify"} URL redirects`, what: `Send every link to ${names.length > 1 ? 'the removed products' : names[0] || 'the removed product'} to the closest live page`, steps: [...names.map((n) => `${n}: redirect to the closest live product or its collection`), 'Pause any ad that still points there'].slice(0, 6), verify: 'Every old link opens a live page, not an error', customerSees: 'A live page instead of an error' }; };
/* who an outreach email goes to, from the card's own words ("Pitch luxury hotels…", "Sell gift packs to corporate HR teams") */
const OUT_WHO = [[/\bhr (?:teams?|leads?|heads?)\b|\bcorporate\b/i, 'Head of HR', 'Corporate teams'], [/\bhotels?\b/i, 'Guest experience manager', 'Hotels'], [/\bsalons?\b/i, 'Salon owner', 'Salons'],
  [/\b(?:press|op-?ed|journalists?|reporters?|editors?|media)\b/i, 'Editor', 'Press'], [/\bwholesale|distributors?|stockists?|retailers?|stores?\b/i, 'Buyer', 'Retail partners'], [/\bclinics?|doctors?|derm/i, 'Clinic manager', 'Clinics'],
  [/\bgyms?|studios?\b/i, 'Studio manager', 'Gyms and studios'], [/\bexpo|trade show|fair\b/i, 'Buyer you meet at the show', 'Show visitors'], [/\bproduction|agenc(?:y|ies)\b/i, 'Producer', 'Production companies']];
export const outreachTo = (c = {}) => { const t = `${c.title || ''} ${c.sub || ''}`; const hit = OUT_WHO.find(([re]) => re.test(t)); return hit ? { to: hit[1], company: hit[2] } : { to: 'The right person at the business', company: 'The business the card names' }; };
const ACT_LABEL = { pause_losers: 'Pause the weakest ad sets', stop_rule: 'Add a stop rule', scale_budget: 'Scale the winners', shift_budget: 'Shift budget to the winners', pause_pointing: 'Pause the ads on sold-out products', restart_paused: 'Restart the ads paused for stock', price_in_ads: 'Put the new price in the ads' };
/* the rule each ad account change runs by */
const OPS_RULE = { pause_losers: 'Pause any ad set whose cost per first order stays above target for 48 hours', stop_rule: 'Pause any ad set whose cost per first order stays above target for 48 hours', scale_budget: 'Raise a winner by 20% at most every 3 days, while its cost per order holds', shift_budget: 'Read it after 7 days; move it back if cost per purchase rises 15%' };
/* a budget card from the team's Meta account (connectors/meta.js `shift`): the two real campaigns, from what they spend a day now
   to after the move. Total spend stays the same, and Brew changes nothing in Ads Manager: the team makes the move */
const shiftPkg = (c, sym = '') => { const s = c.shift, m = (n) => `${sym}${Math.round(+n || 0).toLocaleString(sym === '₹' ? 'en-IN' : 'en-US')}`;
  return { summary: `Move ${m(s.perDay)} a day from ${s.from} to ${s.to}`,
    items: [{ name: s.from, now: `About ${m(s.fromDay)} a day`, next: `About ${m(Math.max(0, s.fromDay - s.perDay))} a day` }, { name: s.to, now: `About ${m(s.toDay)} a day`, next: `About ${m(s.toDay + s.perDay)} a day` }],
    rule: (c.detail?.how || []).find((x) => /move it back|read it/i.test(x)) ? `${(c.detail.how.find((x) => /read it/i.test(x)) || 'Read it after 7 days').replace(/\.$/, '')}; ${(c.detail.how.find((x) => /move it back/i.test(x)) || 'move it back if cost per purchase rises 15%').replace(/^M/, 'm').replace(/\.$/, '')}` : OPS_RULE.shift_budget,
    checkAt: 'After 7 days', spendChangeWeek: 0 }; };
/* the ops changes that follow a store event (stock, price): one row per product the card names, never invented ad sets */
const OPS_ROWS = { pause_pointing: ['Running', 'Paused until back in stock'], restart_paused: ['Paused for stock', 'Running again'], price_in_ads: ['Quotes the old price', 'Quotes the new price'] };
/* a move card's rows are [label, value] ("Product", "Blue Tee"): the value names the product; a header row names none (QA J-19) */
const HEAD_CELL = /^(?:products?|prices?|campaigns?|status|ads?(?: sets?)?|names?|items?|skus?|stock|what|where|now|next|metric|value)$/i;
const opsPkg = (act, c) => { const st = OPS_ROWS[act]; if (!st) return null; const rows = (c.rows || []).filter((r) => r?.[0]).map((r) => (HEAD_CELL.test(String(r[0]).trim()) ? (r[1] && !HEAD_CELL.test(String(r[1]).trim()) ? [r[1], ...r.slice(2)] : null) : r)).filter(Boolean).slice(0, 5);
  const items = (rows.length ? rows : [[c.title || 'The product']]).map((r) => ({ name: `Ads that send people to ${String(r[0]).slice(0, 60)}`, now: act === 'price_in_ads' && /→/.test(r[1] || '') ? `Says ${String(r[1]).split('→')[0].trim()}` : st[0], next: act === 'price_in_ads' && /→/.test(r[1] || '') ? `Says ${String(r[1]).split('→').pop().trim()}` : st[1] }));
  return { summary: ACT_LABEL[act], items, rule: act === 'pause_pointing' ? 'Restart each ad the day its product is back in stock' : act === 'restart_paused' ? 'Only ads paused because the product was sold out' : 'Only the ads and messages that quote this price', checkAt: 'Checked against the live store every day', spendChangeWeek: 0 }; };

// copy knobs can take several values: each value becomes its own version
export const isMulti = () => false; /* one version, always (QA J-11): every knob is single-choice */

// the ratio Gemini should paint for a format
export const RATIO = { '4:5': '4:5', '1:1': '1:1', '9:16': '9:16' };

// what each action IS, in one line the AI must follow, and a guard that catches the obvious miss
export const ACTION_SPEC = {
  search_ad: 'A Google Search ad group: keywords, negatives, headlines and descriptions for the search the card names, landing on the right page.',
  tracking_fix: 'A tracking setup change so orders are counted correctly. Where, the steps, and how we verify it.',
  store_setting: 'A store setting change (checkout, login, shipping). What changes, the steps, and how we verify it.',
  print_insert: 'A printed card that goes into the box: front, back, QR, size, quantity.',
  blog_post: 'A blog post on the brand’s own site: heading, the body, key points. Plain words, sourced facts.',
  buyer_deck: 'A short deck for a marketplace or retail buyer: slides with their lines, deliverables, deadline.',
  outreach_email: 'One email from a named person at the brand to one person at a business (a buyer, a partner, a corporate team, a journalist): who it goes to, the company, a subject line and a short body with one ask. Not a customer flow: no segment, no trigger, no unsubscribe, no discount code.',
  listing_titles: 'New titles for the product on each marketplace, so the same product has ONE name everywhere. Show each listing\'s title now and the new title. Claim first if the card says so.',
  listing_content: 'Bullets, description and image set for the marketplace listings, the same on every marketplace.',
  takedown: 'A takedown request to a marketplace for a listing that misuses the brand.',
  add_variants: 'A new ad added to the live test ad set. Same product as the card. Sells the result, not a discount.',
  swap_creative: 'A fresh creative that replaces a tired live ad. Same product, same offer, new hook and new look.',
  swap_copy: 'New words on an existing live ad: primary text, headline, description. The image and budget stay.',
  new_test: 'A new ad set that tests one idea with a small fixed budget for 7 days.',
  whatsapp_ad: 'A click-to-WhatsApp ad plus the first messages of the chat it opens.',
  carousel_ad: 'A Meta carousel ad: 3-10 cards that swipe in order, each with its own photo, headline and line, telling one story (a range, steps, proof, before you buy). One primary text and one button for the whole ad.',
  collection_ad: 'A Meta collection ad: a cover photo with 4-8 real catalog products under it, opening a full-screen page.',
  catalog_ad: 'A Meta Advantage+ catalog ad: which product set it shows, the one frame or line laid over every product photo, and the copy around it.',
  x_post: 'A post or numbered thread on X from the brand or a founder: each post under 270 characters, plain and punchy.',
  linkedin_post: 'A LinkedIn post in the first person from a founder on record: one story with a lesson, short lines, ends with a question. No link in the body.',
  reddit_post: 'A Reddit reply or post written like a real member of that subreddit: answers the question first, fair about rivals, no links or hashtags, ends by saying the writer works at the brand.',
  quora_answer: 'A Quora answer to a real buyer question: the direct answer first, honest comparisons, the affiliation stated, no links.',
  fb_group_post: 'A post in a Facebook group: warm, gives something useful or asks the group, says who you are, no link.',
  pinterest_pin: 'A Pinterest pin: a search-led title and description, the vertical image, and the product page it sends people to.',
  short_video: 'A short vertical video (Shorts, TikTok or a Reel): five beats, each with the shot and the line, plus the caption or title.',
  ig_post: 'One organic Instagram post: the photo, the words on it, and the caption. Not an ad: no prices unless the brief names one.',
  ig_carousel: 'An organic Instagram carousel: slide 1 hooks, the middle slides deliver, the last slide says what to do. Each slide has its words and the photo behind them, plus the caption.',
  ig_story: 'A sequence of Instagram Stories (9:16), each with its words and photo, plus the sticker that gets a reply.',
  pause_pointing: 'Pause the ads (and paused-ready ad sets) that send people to products that are sold out right now. One row per affected ad: its name, Running now, Paused until back in stock after. Only those ads; nothing else changes and no new ad is made.',
  restart_paused: 'Turn back on the ads that were paused because their product was sold out, now that it is back in stock. One row per ad: Paused now, Running after.',
  price_in_ads: 'Update the price quoted in live ads and messages to the new store price. One row per ad or message: what it says now (the old price) and what it says after (the new one). No new ads, no budget change.',
  fix_links: 'Fix links that now land on a removed product: one URL redirect per removed product to the closest live page, plus pausing ads that still point there. Steps and how we verify every old link opens a live page.',
  comment_reply: 'A reply to a comment or question under a video (YouTube, TikTok): answers what they asked first, in a line or two, says the writer works at the brand, no links or hashtags.',
  pause_losers: 'Pause the ad sets that are over target. List real ad set names, what they spend now and that they get paused.',
  stop_rule: 'An automated rule in Ads Manager that pauses ad sets over target. Name the ad sets it watches.',
  scale_budget: 'Raise the budget on the winning ad sets in +20% steps.',
  shift_budget: 'Move budget from weak ad sets to winning ones. Total spend stays the same.',
  page_copy: 'One short section added to the product description (top or end), in the store’s own voice; the rest of the description stays as it is. Heading, one to three sentences, up to five points. No new offer, no button, no price, no A/B split.',
  pdp_block: 'A PROOF block on the product page: evidence only. The study result with its window, real customer reviews, lab testing, ratings. No discounts, savings, bundles, combos or prices.',
  new_section: 'A new section or layout on the store, described clearly enough to design and build.',
  price_change: 'Change the price of one product, from the facts, with the reason.',
  bundle_offer: 'An offer tile for a bundle, using a bundle price from the facts.',
  faq_entry: 'Answers to the questions buyers ask AI tools, each with a claims-list source.',
  llms_txt: 'Lines for the site’s llms.txt: plain facts about the products, each with a source.',
  schema_fix: 'Product markup (JSON-LD) fields to add: price, rating, study facts.',
  new_claim: 'A new public claim with its source, for legal to check.',
  flow_copy: 'The message sent at one step of an existing Klaviyo/WhatsApp flow.',
  flow_timing: 'When an existing flow sends, and how often at most. The message can stay as it is.',
  review_ask: 'A message asking a recent buyer for a review, ideally with a photo.',
  new_segment: 'A new customer segment: who is in, who is left out, how many.',
  paid_broadcast: 'A one-off WhatsApp broadcast to opted-in customers.',
  discount_offer: 'A retention offer: a discount code, who gets it, when it expires.',
  film_brief: 'A production brief for a short film: deliverables, shots with lines, talent, location.',
  creative_brief: 'A brief for the next creatives: deliverables, angles, references.',
  plan: 'The plan the team saves: the decision in one line, why, who owns it, and what changes next (each step with an owner and a date).',
  resolution: 'The decision that settles the disagreement, why, who decides, and what changes.'
};
const OFFER = /\b(save ₹?\d|% off|\boff\b|discount|combo|bundle|add the [a-z]+\b(?!.*review)|instead of ₹|free shipping|pack of \d|₹\s?\d)/i;
export const ACTION_GUARD = {
  pdp_block: (pkg) => { const t = [pkg.heading, pkg.body, ...(pkg.bullets || []), pkg.button].filter(Boolean).join(' '); const m = t.match(OFFER); return m ? `A proof block shows evidence, not offers or prices (found “${m[0]}”)` : null; },
  page_copy: (pkg) => { const t = [pkg.heading, pkg.body, ...(pkg.bullets || [])].filter(Boolean).join(' '); const m = t.match(/\b(save ₹?\d|% off|discount|combo is|bundle)\b/i); return m ? `Page copy rewrites the section, it doesn't add an offer (found “${m[0]}”)` : null; },
  shift_budget: (pkg) => (pkg.spendChangeWeek > 0 ? 'Shifting budget keeps total spend the same' : null)
};
// which product the package is about: the card's lane, unless the card names another
/* the product a card (or a package made from it) is about: the one its own words name in the catalog, else its lane's
   product. A card's lane is a broad bucket the AI picks (a heated-slipper card can sit in the sleep-mask lane), so the
   words win: "Snugglet Toe Toasters plugged into a laptop" is about the Toe Toasters, whatever the lane says. `extra` is
   text read first (a package's own words, for a remake), then the card's title, body, make pieces, why/how and plan */
export const cardWords = (c = {}) => [c.title, c.sub, c.make?.pieces, ...(c.detail?.why || []), ...(c.detail?.how || []), ...(Array.isArray(c.plan?.steps) ? c.plan.steps.map((x) => (typeof x === 'string' ? x : x?.t)) : [])].filter((x) => typeof x === 'string' && x).join('. ');
/* a video card about paid ads (a Meta video ad, ad costs, the live ads) is a Meta video ad, not an organic Reels post: the jam
   says so, the writer writes it for Reels and Stories placements, and the brief goes to Ads Manager (Param, 19 Oct: "Refresh
   MitoActive serum video hooks weekly", a card about the brand's live Meta video ads, opened as an Instagram Reels and YouTube
   Shorts post). An idea from the stream (c.post) or a card that asks for a reel stays organic */
const AD_TALK = /\b(?:meta|facebook|instagram)\s+(?:video\s+)?ads?\b|\bvideo\s+ads?\b|\bads?\s+(?:manager|account|costs?|spend|library)\b|\blive\s+ads\b|\bpaid\s+(?:social|video)\b|\b(?:CPM|CTR|ROAS|CPA|hook rate|thumb-?stop)\b/i;
/* our version of a rival's video ad is a paid ad too, whatever format the card carries (it opened as an organic Reel: QA J-10) */
export const isAdVideo = (c = {}) => !!c && !c.post && (c.make?.format === 'video ad' || c.research?.kind === 'ad' || c.make?.from === 'rival' || (c.make?.format !== 'reel' && AD_TALK.test(cardWords(c))));
/* "Add to the live test" only when the card is about a test that runs; any other ad idea makes new ads */
export const namesLiveTest = (c = {}) => /\b(?:live|running|current|existing|ongoing)\s+(?:meta\s+)?(?:ad\s+)?tests?\b|\btest\s+(?:ad\s+set|campaign|budget)\b|META_Test|\b(?:in|to|into)\s+the\s+(?:meta\s+)?test\b|\bA\/B\b/i.test(cardWords(c)) || (c.images || []).length >= 3;
/* a store claim as the site prints it can carry footnote marks ("growth in 84 days 1 and", "by up to 95% 2 .."): they go, so
   the words Brew starts from read as copy. "Pack of 2", "Day 1", "Buy 2" keep their numbers */
const FOOT = /(?<=[a-z%)])(?<!\b(?:of|for|in|x|buy|get|pack|set|with|to|and|or|step|day|no|vol|size|version|gen|top|under|over|by|at|pick|save|only|just|from))\s+[1-9](?:\s*,\s*[1-9])*(?=\s*(?:\.+|,|;|\band\b|\bor\b|$))/gi;
export const cleanClaim = (x) => String(x || '').replace(/(?<=\S)[¹²³⁴⁵⁶⁷⁸⁹⁰†‡]+/g, '').replace(FOOT, '').replace(/\s*\.(?:\s*\.)+/g, '.').replace(/\s+([.,;])/g, '$1').replace(/\s+/g, ' ').trim();
/* the claim's first sentence, whole words only (it used to be cut at 60 characters, mid-word) */
const firstLine = (x, n = 70) => { const s1 = String(x || '').split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '').trim(); return s1.length <= n ? s1 : ''; };
/* a hook that stops mid-phrase ("…powered by", "…has shown up to") is no hook: the product's name stands in */
const DANGLE = /\b(?:by|with|and|or|of|to|for|the|a|an|in|on|at|up|from|than|as|is|are|was|has|have|had|shown|our|your|its|their)$/i;
const wholeHook = (h, name) => { h = String(h || '').trim().replace(/[,;:–-]+$/, ''); return h && !DANGLE.test(h) ? h : name; };
const asProduct = (m) => { const LP = B()?.config?.laneProducts || {}, lane = Object.values(LP).find((x) => x?.name === m.t);
  if (lane) return { ...lane, claim: cleanClaim(lane.claim), hook: wholeHook(cleanClaim(lane.hook), lane.name), img: m.img || lane.img || null };
  const claim = cleanClaim(m.claim);
  return { name: m.t, short: m.t, price: m.price || '', claim, hook: wholeHook(firstLine(claim), m.t), page: m.url || BH(), photo: `The ${m.t} on a clean surface, soft daylight, calm space at the top.`, pack: '', img: m.img || null }; };
/* the starting package (on the stage while the first draft is written, and kept when it can't be) tells the card's story with
   the product's facts, for every family (Param, 19 Oct: the ad said "As per clinical trials, 87%…" twice, with the site's
   footnote marks, under a card about a light serum against heavy oils):
   - the hook is the card's own line when it reads as something a shopper could see (no internal words, not an instruction to
     the team), else the product's first claim line
   - the claim is never said twice: when it opens with the hook, the body carries the claim once (lead)
   - the picture brief is the scene the card asks for (sceneOf: make.pieces, else its picture how-step), else a plain pack shot */
const OPS_VERB = /^(refresh|rotate|pause|scale|launch|fix|add|swap|test|run|set|move|shift|cut|raise|lower|restart|turn|publish|update|export|track|stop|send|build|queue|make|draft|write|create|review|check|ask|reply|lead|open|start|use|try|put|keep|drop|retire|reuse|repurpose|answer|post|get|win|own|claim|list|push|bring|close|grow|double|split|bundle|price|offer|show|pin|tag|reach|target|retarget)\b/i;
const NOT_PUBLIC = /\b(costs?|times|than|vs|versus|cheaper|pricier|per (?:ml|g|kg|unit|wear)|margins?|share|ads?|ad set|campaigns?|creatives?|hooks?|tests?|audiences?|budgets?|posts?|reels?|pages?|listings?|emails?|flows?|segments?|feed|brief|watcher|rivals?|competitors?|search|SEO|CTR|CPC|CPM|spend|orders?|sales|traffic)\b/i;
const rivalNamed = (t) => Object.keys(B()?.rivalPages || {}).some((r) => r && r.length > 2 && new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
/* a line a shopper may read on a page: not a team step ("Check each pack's price…", "Route cold traffic here first"), not about
   ads, costs or the team (final QA pass 19 Oct: the offline page draft used the card's how-steps as its bullets) */
export const shopperLine = (x) => { const s = String(x || '').replace(/^[-•\d.)\s]+/, '').trim(); return s.length > 3 && !OPS_VERB.test(s) && !/^(?:route|check|send|map|audit|tag|segment|exclude|retarget|bid|split)\b/i.test(s) && !NOT_PUBLIC.test(s) && !INTERNAL.test(s); };
export const cardHook = (c = {}) => { const t = String(c.title || '').replace(/\s+/g, ' ').trim(); return t && t.length <= 70 && !INTERNAL.test(t) && !OPS_VERB.test(t) && !NOT_PUBLIC.test(t) && !/[’']s\s+(?:serum|price|ads?)\b/i.test(t) && !rivalNamed(t) ? t.replace(/[.!]+$/, '') : ''; };
/* a hook cut to a field's limit at a word, never mid-word ("…with our ₹1") */
const wcut = (x, n) => { x = String(x || '').trim(); return x.length <= n ? x : x.slice(0, n + 1).replace(/\s+\S*$/, '').replace(/[\s,;:&+–-]+$/, '').trim() || x.slice(0, n); };
const leadOf = (hook, claim, name) => (!hook || (name && hook.toLowerCase() === String(name).toLowerCase()) || (claim && claim.toLowerCase().startsWith(hook.toLowerCase().replace(/[.!?]+$/, ''))) ? '' : hook); /* the name is said right after it; the claim says it itself */
const tplProduct = (c, F) => { const P = productFor(c, F), hook = cardHook(c) || wholeHook(cleanClaim(P.hook), P.name) || c.title || P.name, sc = sceneOf(c);
  return { ...P, claim: cleanClaim(P.claim), hook, lead: leadOf(hook, cleanClaim(P.claim), P.name), photo: sc ? `The ${P.name}: ${sc}. Natural light, the label readable.` : P.photo }; };
export const productFor = (c = {}, F, extra = '') => {
  const cat = B()?.catalog, brand = BN() || '';
  if (cat?.length) for (const text of [extra, c.product, cardWords(c)]) { const m = text && matchProduct(text, cat, { brand }); if (m) return asProduct(m); } /* c.product: the product a card names outright (a team static's photo) */
  return PRODUCT(c.lane, F);
};

/* ---------- an idea from the ideas stream (ideas.js) → the action and package it opens as in the studio ---------- */
export const IDEA_ACTION = { x: 'x_post', linkedin: 'linkedin_post', reddit: 'reddit_post', quora: 'quora_answer', facebook: 'fb_group_post', pinterest: 'pinterest_pin', youtube: 'short_video', tiktok: 'short_video' };
/* a reply under a video is a comment, not a new video (a YouTube "reply" used to open as "Make the short video") */
export const ideaAction = (i) => (/^(reply|comment)$/i.test(i?.format || '') && /youtube|tiktok|instagram/.test(i?.platform || '') ? 'creative.comment_reply' : i?.platform === 'instagram' ? (i.media?.kind === 'carousel' ? 'creative.ig_carousel' : i.media?.kind === 'video' ? 'creative.short_video' : 'creative.ig_post') : `creative.${IDEA_ACTION[i?.platform] || 'x_post'}`);
/* offline, a video card with no post of its own: five beats and a caption from the product's own words */
const clipCaption = (c) => { const P = tplProduct(c, {}); return [P.hook || P.name, P.claim ? `${P.claim.replace(/[.!]+$/, '')}.` : '', P.name !== 'the product' && P.price ? `${P.name}, ${P.price}.` : ''].filter(Boolean).join(' '); };
const clipScript = (c) => { const P = tplProduct(c, {}); return [['Hook', 'Close-up: the product in hand', P.hook || P.name], ['Problem', 'The moment it matters', c.sub ? String(c.sub).split(/(?<=[.!?])\s/)[0].slice(0, 90) : 'The everyday problem it solves'], ['Show', 'In use', P.claim || P.name], ['Proof', 'Pack shot', P.price ? `${P.name}, ${P.price}` : P.name], ['Ask', 'End card', `Shop ${BN()}`]].map(([beat, shot, line]) => ({ beat, shot, line })); };
export const ideaPkg = (i = {}, act = String(ideaAction(i)).split('.').pop(), c = {}) => {
  const where = (i.where || []).map((w) => ({ name: w.name, url: w.url, rule: w.rule || w.why || '', ...(w.kind ? { kind: w.kind } : {}) })); /* kind: a thread to reply in or a community to post in (Copy and open, post-open.js) */
  const own = (i.where || []).find((w) => w.kind === 'own'), handle = own ? own.name.split(' ')[0] : `@${String(BN() || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  const m = i.media || {}, tags = (i.hashtags || []).filter(Boolean);
  if (act === 'ig_post' || act === 'ig_carousel' || act === 'ig_story') {
    const slides = (m.slides || []).map((x) => ({ onSlide: String(x.text || '').slice(0, 120), imageBrief: x.prompt || m.prompt || '' }));
    return { account: handle, ...(act === 'ig_post' ? { overlay: String(i.hook || i.title || '').slice(0, 60), imageBrief: m.prompt || '' } : { slides: slides.length ? slides : [{ onSlide: i.hook || i.title || '', imageBrief: m.prompt || '' }] }),
      caption: [i.copy, i.cta && !String(i.copy || '').includes(i.cta) ? i.cta : ''].filter(Boolean).join('\n\n'), hashtags: tags, format: act === 'ig_story' ? '9:16' : '4:5', postAt: i.postAt || '' };
  }
  const label = act === 'short_video' && !i.platform && isAdVideo(c) ? 'Meta video ad · Reels and Stories' : `${i.platformLabel || i.platform || 'Social'} ${i.format || 'post'}`.trim();
  const title = String(i.copy || '').match(/^\s*title:\s*(.+)$/im)?.[1] || (act === 'reddit_post' && i.format === 'reply' ? '' : i.title || '');
  const copy = String(i.copy || '').replace(/^\s*title:\s*.+\n+/i, '');
  return { platform: label, ...(i.author?.name ? { author: i.author.name, authorRole: `${i.author.role || 'Co-founder'}, ${BN()}` } : {}), ...(title && ['reddit_post', 'pinterest_pin', 'short_video', 'quora_answer'].includes(act) ? { title } : {}),
    copy: copy || (act === 'short_video' && !c.post ? clipCaption(c) /* a video card with no post: a caption from the product, never "Missing: Ad text" (QA J-19) */ : act === 'reddit_post' || act === 'comment_reply' ? `${c.title ? `On “${String(i.title || c.title).replace(/^asked in [^:]+:\s*/i, '').replace(/[“”]/g, '')}”: ` : ''}I work at ${BN()}, so read this with that in mind.\n\n` : ''),
    ...(tags.length ? { hashtags: tags } : {}), ...((m.script || []).length ? { script: m.script.map((x) => ({ beat: x.beat || '', shot: x.shot || '', line: x.line || '' })) } : act === 'short_video' && !c.post ? { script: clipScript(c) } : {}),
    ...(m.prompt ? { media: (m.real ? 'Shoot for real. ' : '') + String(m.prompt).replace(/^Shoot for real, no AI image \(community rules\):\s*/i, '') } : {}), ...(where.length ? { where } : {}), postAt: i.postAt || '', ...(i.measure?.metric ? { measure: `${i.measure.metric}${i.measure.how ? `: ${i.measure.how}` : ''}` } : {}) };
};
