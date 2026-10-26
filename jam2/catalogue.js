// Jam v2: every deliverable Brew can make, one recipe each. The Make gallery shows them all, sketched with the brand's own
// product at no cost; a card opens the jam on the one that fits it best, with "+ Add" offering the others the idea suits.
// A recipe says what the deliverable is, its sizes, how it can be made (AI makes it / AI + people / brief people), which
// capabilities it needs (engines.js routes each to a partner), what it needs from the brand, and its cost tier.
// Tiers are rough until the partner bench: free = words and layout; $ ≈ $0.05–0.30 a picture; $$ ≈ $0.5–3 a video shot;
// $$$ ≈ $3–15 a 30 s AI UGC or avatar clip.

/* platform sizes, named the way marketers say them */
export const SIZES = {
  'ig-square': { label: 'Instagram post 1:1', w: 1080, h: 1080, ratio: '1:1' },
  'ig-portrait': { label: 'Instagram post 4:5', w: 1080, h: 1350, ratio: '4:5' },
  story: { label: 'Story / Reel 9:16', w: 1080, h: 1920, ratio: '9:16' },
  youtube: { label: 'YouTube 16:9', w: 1920, h: 1080, ratio: '16:9' },
  pinterest: { label: 'Pinterest 2:3', w: 1000, h: 1500, ratio: '2:3' },
  fbx: { label: 'Facebook / X 1.91:1', w: 1200, h: 628, ratio: '1.91:1' },
  pdp: { label: 'Product page 1:1', w: 2000, h: 2000, ratio: '1:1' },
  banner: { label: 'Banner 3:1', w: 2400, h: 800, ratio: '3:1' },
  email: { label: 'Email hero 3:2', w: 1200, h: 800, ratio: '3:2' },
  a5: { label: 'Print A5', w: 1748, h: 2480, ratio: 'A5' },
  /* Amazon A+ (Standard modules): the header image, the four-image tiles and the wide single image, at Amazon's own pixels */
  'aplus-header': { label: 'A+ header 970×600', w: 970, h: 600, ratio: '97:60' },
  'aplus-tile': { label: 'A+ tile 300×300', w: 300, h: 300, ratio: '1:1' },
  'aplus-wide': { label: 'A+ wide image 970×300', w: 970, h: 300, ratio: '97:30' }
};
export const HOW = ['ai', 'ai+people', 'brief'];
export const HOW_LABEL = { ai: 'AI makes it', 'ai+people': 'AI + people', brief: 'Brief people' };

/* board kinds the canvas knows how to edit */
export const KINDS = ['static', 'carousel', 'video', 'post', 'message', 'page', 'script', 'creator', 'shoot', 'act', 'table'];

const R = (id, o) => ({ id, how: ['ai', 'ai+people', 'brief'], est: '$', caps: [], needs: ['product photo'], sizes: ['ig-portrait'], ...o });
export const RECIPES = [
  // A. paid social ads
  R('image-ad', { family: 'Ads', kind: 'static', label: 'Image ad', looks: 'Your real product in a scene, the headline in your type, a proof badge.', caps: ['still.scene', 'still.harmonize'], sizes: ['ig-portrait', 'ig-square', 'story'] }),
  R('native-ad', { family: 'Ads', kind: 'static', label: 'Native-style ad', looks: 'A chat, a note or a review card with your product inset: reads like a post, not an ad.', est: 'free', caps: [], how: ['ai', 'brief'], sizes: ['ig-portrait', 'story'], template: 'native' }),
  R('carousel-ad', { family: 'Ads', kind: 'carousel', label: 'Carousel ad', looks: '3 to 6 cards, one product, proof or step each, ending on a buy card.', caps: ['still.scene'], sizes: ['ig-square', 'ig-portrait'] }),
  R('gif', { family: 'Ads', kind: 'video', label: 'GIF (looping)', looks: 'The product in one gentle loop, as a GIF under 2 MB and an MP4.', est: '$', caps: ['video.shot'], sizes: ['ig-square', 'story'], seconds: 5 }),
  R('motion-static', { family: 'Ads', kind: 'video', label: 'Motion ad (6 s)', looks: 'Your still, gently moving, the words animated in.', est: '$$', caps: ['video.shot'], sizes: ['story', 'ig-portrait'], seconds: 6 }),
  R('demo-video', { family: 'Ads', kind: 'video', label: 'Product demo video', looks: 'Problem → product → proof → offer in 15–30 s, from your real product.', est: '$$', caps: ['video.shot', 'voice.tts'], sizes: ['story', 'ig-portrait', 'ig-square'], seconds: 15 }),
  R('ugc-ad', { family: 'Ads', kind: 'video', label: 'UGC ad', looks: 'A creator on camera: selfie testimonial, unboxing, in-hand demo or "3 reasons".', est: '$$$', caps: ['video.ugc', 'voice.tts'], needs: ['product photo', 'cast'], sizes: ['story'], seconds: 15 }),
  R('founder-ad', { family: 'Ads', kind: 'video', label: 'Founder video', looks: 'Your founder (consented likeness) or an expert speaking to camera, with b-roll.', est: '$$$', caps: ['video.avatar', 'voice.tts'], needs: ['product photo', 'cast'], sizes: ['story'], seconds: 20 }),
  R('asmr-video', { family: 'Ads', kind: 'video', label: 'Texture / ASMR video', looks: 'Macro shots of the product: pour, twist, texture.', est: '$$', caps: ['video.shot'], sizes: ['story'], seconds: 10 }),
  R('remake', { family: 'Ads', kind: 'static', label: 'Remake what works', looks: 'A rival ad or viral video, rebuilt with your product on the same structure (never their pixels).', caps: ['still.scene'], sizes: ['ig-portrait', 'story'] }),
  R('hook-variant', { family: 'Ads', kind: 'video', label: 'New hook for a winning ad', looks: 'A fresh first 2 seconds on an ad that already works.', est: '$', caps: ['video.shot'], sizes: ['story'], seconds: 4 }),
  // B. organic social
  R('ig-post', { family: 'Social', kind: 'static', label: 'Instagram post', looks: 'One feed picture in your own photo style, caption written natively.', caps: ['still.scene', 'still.harmonize'], sizes: ['ig-portrait', 'ig-square'] }),
  R('ig-carousel', { family: 'Social', kind: 'carousel', label: 'Instagram carousel', looks: 'A how-to, myth/fact, listicle or lookbook in 4–8 slides.', caps: ['still.scene'], sizes: ['ig-portrait'] }),
  R('reel', { family: 'Social', kind: 'video', label: 'Reel / TikTok / Short', looks: '15–60 s, on a beat grid, captions and sound.', est: '$$', caps: ['video.shot', 'voice.tts'], sizes: ['story'], seconds: 15 }),
  R('stories', { family: 'Social', kind: 'carousel', label: 'Stories set', looks: '3–5 frames with poll, quiz or link sticker spots.', caps: ['still.scene'], sizes: ['story'] }),
  R('moment-post', { family: 'Social', kind: 'static', label: 'Festival / moment post', looks: 'A date from your calendar, your product in it.', caps: ['still.scene'], sizes: ['ig-portrait', 'story'] }),
  R('pin', { family: 'Social', kind: 'static', label: 'Pinterest pin', looks: 'A tall pin with a clear benefit line.', caps: ['still.scene'], sizes: ['pinterest'] }),
  R('linkedin-post', { family: 'Social', kind: 'post', label: 'LinkedIn / X post', looks: 'A founder post or thread in your voice.', est: 'free', caps: [], needs: [], sizes: [] }),
  R('meme', { family: 'Social', kind: 'static', label: 'Meme / trend format', looks: 'A trending template with your product.', est: 'free', caps: [], how: ['ai', 'brief'], sizes: ['ig-square'], template: 'meme' }),
  // C. community
  R('community-post', { family: 'Community', kind: 'post', label: 'Reddit / Quora / group post', looks: 'Helpful, native, never salesy; real photos only.', est: 'free', caps: [], needs: [], sizes: [], how: ['ai', 'brief'] }),
  R('reply', { family: 'Community', kind: 'post', label: 'Reply to a comment or review', looks: 'The answer in your voice, with Copy and open.', est: 'free', caps: [], needs: [], sizes: [], how: ['ai', 'brief'] }),
  // D. creators and partners
  R('creator-brief', { family: 'Creators', kind: 'creator', label: 'Influencer / creator brief', looks: 'One page a creator can film from: hook, talking points, must-say, never-say, specs, usage.', est: 'free', caps: [], how: ['brief'], sizes: [] }),
  R('creator-dm', { family: 'Creators', kind: 'message', label: 'Creator outreach DM', looks: 'A personal pitch to a creator.', est: 'free', caps: [], needs: [], sizes: [], how: ['ai', 'brief'] }),
  R('seeding-kit', { family: 'Creators', kind: 'shoot', label: 'Seeding / PR box kit', looks: 'Insert letter, unboxing shot ideas, a caption they can use.', est: 'free', caps: [], how: ['brief'], sizes: ['a5'] }),
  // E. production briefs
  R('video-script', { family: 'Briefs', kind: 'script', label: 'Video script (agency / team)', looks: 'Hook, beats with timing, VO, on-screen text, shot list, b-roll; optional animatic.', est: 'free', caps: [], how: ['brief', 'ai+people'], sizes: [] }),
  R('shoot-brief', { family: 'Briefs', kind: 'shoot', label: 'Photo / video shoot brief', looks: 'Shot list, hero shots, props, places, cast, mood from your style refs.', est: 'free', caps: [], how: ['brief'], sizes: [] }),
  // F. store and marketplaces
  R('pdp-set', { family: 'Store', kind: 'carousel', label: 'Product page image set', looks: 'Hero on white, lifestyle, benefits infographic, size, how-to, ingredients.', caps: ['still.scene', 'cutout'], sizes: ['pdp'] }),
  R('photoshoot', { family: 'Store', kind: 'carousel', label: 'AI photoshoot', looks: '6–12 lifestyle shots per product, same place and cast, saved to your Library.', caps: ['still.scene', 'still.harmonize'], sizes: ['ig-portrait', 'pdp'] }),
  R('banner', { family: 'Store', kind: 'static', label: 'Homepage / collection banner', looks: 'A wide banner with 1–4 products and one line.', caps: ['still.scene'], sizes: ['banner'] }),
  R('page-section', { family: 'Store', kind: 'page', label: 'Landing / product page section', looks: 'Review strip, comparison, FAQ or hero copy for your theme.', est: 'free', caps: [], needs: [], sizes: [] }),
  R('listing', { family: 'Store', kind: 'carousel', label: 'Amazon / marketplace listing', looks: 'Titles, bullets and the 7-image gallery in marketplace spec.', caps: ['still.scene', 'cutout'], sizes: ['pdp'] }),
  R('tryon', { family: 'Store', kind: 'static', label: 'Virtual try-on / on-model', looks: 'Your garment on a model from a flat-lay.', caps: ['still.tryon'], needs: ['garment photo'], sizes: ['ig-portrait'] }),
  R('orbit', { family: 'Store', kind: 'video', label: '360° product orbit', looks: 'A turntable loop for the product page.', est: '$$', caps: ['video.shot'], sizes: ['ig-square'], seconds: 6 }),
  // G. CRM
  R('email', { family: 'CRM', kind: 'message', label: 'Email', looks: 'Subject, hero, 60–120 words, one button.', est: '$', caps: ['still.scene'], sizes: ['email'] }),
  R('whatsapp', { family: 'CRM', kind: 'message', label: 'WhatsApp / SMS', looks: 'A short message with a product picture header.', est: 'free', caps: [], sizes: ['ig-square'] }),
  // H. search
  R('pmax', { family: 'Search', kind: 'page', label: 'Google Ads assets', looks: 'Headlines, descriptions and images in every Performance Max size.', est: '$', caps: ['still.scene'], sizes: ['ig-square', 'fbx', 'ig-portrait'] }),
  // I. print
  R('insert', { family: 'Print', kind: 'static', label: 'Insert / thank-you card', looks: 'A print-ready card with bleed.', est: 'free', caps: [], sizes: ['a5'], how: ['ai', 'brief'] }),
  // J. act-on
  R('act', { family: 'Act on', kind: 'act', label: 'Plan to act on', looks: 'A price or offer change, an ad-account checklist or a launch plan: owner, steps, done-when.', est: 'free', caps: [], needs: [], sizes: [], how: ['brief'] }),
  R('changes', { family: 'Act on', kind: 'table', label: 'Change list', looks: 'One row per change, in the tool it happens in (Ads Manager, Shopify, Klaviyo, Amazon): what, where, the change.', est: 'free', caps: [], needs: [], sizes: [], how: ['ai', 'brief'] }),
  R('ai-faq', { family: 'Store', kind: 'page', label: 'FAQ + schema for AI answers', looks: 'The questions people ask AI apps, answered on your product page, with FAQ and product schema and an llms.txt line.', est: 'free', caps: [], needs: [], sizes: [], how: ['ai', 'brief'] })
];
export const recipe = (id) => RECIPES.find((r) => r.id === id) || null;
export const FAMILIES = [...new Set(RECIPES.map((r) => r.family))];

/* which recipe a feed card opens on: the card's own words and format first, then its agent; one answer, never options */
export function recipeFor(c = {}) {
  const t = [c.make?.pieces, c.make?.format, c.cta?.label, c.title, c.format].filter(Boolean).join(' ').toLowerCase();
  const kind = c.research?.kind;
  if (kind === 'ad' || kind === 'viral') return /video|reel|clip|tiktok/.test(t) || kind === 'viral' ? 'reel' : 'remake';
  const rules = [
    [/\bugc|creator video|selfie|testimonial video|unboxing/, 'ugc-ad'], [/influencer|creator brief|seeding/, 'creator-brief'], [/script/, 'video-script'], [/shoot|photographer/, 'shoot-brief'],
    [/reddit|quora|facebook group|\bgroup post|forum|community/, 'community-post'], [/reply|respond|comment/, 'reply'], [/linkedin|\bx post|thread|tweet/, 'linkedin-post'],
    [/\bgif\b|animated loop/, 'gif'], [/carousel ad/, 'carousel-ad'], [/carousel|slides|swipe/, 'ig-carousel'], [/stor(y|ies)/, 'stories'], [/reel|short|tiktok/, 'reel'], [/video|clip/, 'demo-video'],
    [/email|newsletter|klaviyo|flow/, 'email'], [/whatsapp|sms|message/, 'whatsapp'], [/landing|page section|pdp copy|faq|section/, 'page-section'],
    [/listing|amazon|flipkart|nykaa|myntra|marketplace/, 'listing'], [/product photos|photo set|image set|pdp/, 'pdp-set'], [/banner|hero/, 'banner'],
    [/google|rsa|search ad|performance max|pmax/, 'pmax'], [/insert|print|card in the box|thank-you/, 'insert'], [/pin(terest)?\b/, 'pin'],
    [/price|pricing|offer|bundle|discount|budget|pause|scale|stop rule|checklist|tracking|setup/, 'act'], [/post|instagram/, 'ig-post'], [/\bad\b|static|creative|image/, 'image-ad']
  ];
  for (const [re, id] of rules) if (re.test(t)) return id;
  const ag = String(c.agent || '').toLowerCase();
  return ag === 'crm' ? 'email' : ag === 'storefront' || ag === 'visibility' ? 'page-section' : ag === 'performance' ? 'act' : 'image-ad';
}
/* what a feed card's own button makes: the boards the jam opens with, in order (the first is the button's own deliverable).
   Every button a card can show today (remix.js CTA_ACTION, seed-template.js, the connectors) lands on one of these; a label
   this list doesn't know falls back to recipeFor. Each board may carry its own label and a line for the writer. */
const B = (recipe, label = null, ask = '') => ({ recipe, label, ask });
const PLANS = [
  [/^(reply|respond)|repl(y|ies)\b|^answer on|post in (the group|r\/)|post on reddit|copy and open/, () => [B('community-post')]],
  [/\bpitch\b|outreach|dm the creator/, () => [B('creator-dm')]],
  [/review ask/, () => [B('email', 'Email · day 10', 'The review ask, 10 days after delivery.'), B('whatsapp', 'WhatsApp · day 12', 'The review ask on WhatsApp, day 12, only to people who have not reviewed.'), B('changes', 'Timing', 'The Klaviyo flow: one row per step (channel, when, stop if).')]],
  [/approve the flows|turn on the journey|plan the flows|open the club|send on whatsapp/, () => [B('email', 'Email'), B('whatsapp', 'WhatsApp'), B('changes', 'Timing', 'The flow: one row per step (channel, when, stop if).')]],
  [/pause (what|the ads|those ads|these ads)|pause\b.*\bads?\b/, () => [B('changes', 'Pause list', 'Every live ad that points to the product that sold out: ad, where it runs, Pause.'), B('image-ad', 'Ad for what’s in stock', 'An ad for a product that is in stock, to fill in while the other is out.')]],
  [/restart what was paused|restart\b.*paus/, () => [B('changes', 'Restart list', 'The ads paused while it was out of stock: ad, where, Restart; plus the waitlist message.')]],
  [/update the prices?/, () => [B('changes', 'Price updates', 'Every ad, page and banner that shows the old price: where, now, change to.')]],
  [/shift budget/, () => [B('changes', 'Budget shift', 'One row per ad set: now, change to, why.')]],
  [/fix (the )?(dead |broken )?links/, () => [B('changes', 'Broken links', 'Every link to the removed product: where it is, what to point it to.')]],
  [/fix tracking|turn on guest checkout|set the watch|fix the markup/, (l) => [B(/markup/.test(l) ? 'ai-faq' : 'changes', /markup/.test(l) ? null : 'Checklist', 'One row per step: what, where, do.')]],
  [/draft the page|answer it on the product page|claims ledger|review draft/, () => [B('ai-faq')]],
  [/update landing page|publish the page|apply update|start the tests|approve \d* ?popups|build the score/, () => [B('page-section')]],
  [/approve the (offers|ladder|\d+ offers)/, () => [B('changes', 'The offers', 'One row per offer: what is in it, price, the saving. Prices only from the catalog.'), B('banner', 'Store banner')]],
  [/push (the|\d+) titles|apply \d+ edits|draft the listing|generate the sets/, () => [B('changes', 'Titles', 'One row per product: product, new title, characters (marketplace limit).'), B('listing', 'Listing photos')]],
  [/add (the )?photos/, () => [B('listing', 'Listing photos'), B('changes', 'Titles', 'One row per product: product, new title, characters.')]],
  [/request (a )?takedown/, () => [B('changes', 'Takedown request', 'One row per listing: listing, seller, reason.')]],
  [/brief the shoot|plan the shoot/, () => [B('shoot-brief')]],
  [/shortlist creators/, () => [B('changes', 'Creator shortlist', 'One row per creator: handle, followers, why they fit.'), B('creator-brief')]],
  [/buyer deck/, () => [B('act', 'Buyer deck', 'A deck for retail buyers: the brand, proof, best sellers, terms left as [YOUR TERMS].')]],
  [/box insert/, () => [B('insert')]],
  [/launch (a|the) .*ad group/, () => [B('changes', 'Search ads', 'The Google Ads Editor sheet: one row per ad (headline ≤ 30 characters, description ≤ 90, keyword).')]],
  [/agree with the call|apply the plan|ship the five|plan the restock|read the reviews|work out/, () => [B('changes', 'Team plan', 'One row per step: step, who, when. We never run it.')]],
  [/carousel post/, () => [B('ig-carousel')]], [/carousel/, () => [B('carousel-ad')]], [/stories/, () => [B('stories')]],
  [/make (the|our) (reel|video)|make the video/, () => [B('reel'), B('video-script', 'How to film it')]],
  [/draft the post|post it|use their words/, () => [B('ig-post'), B('stories', 'Story')]],
  [/make our version|make the ad|rotate creative|turn into an idea|queue the|generate versions|publish the campaign|lock the|switcher ad|plan the launch|collection ad|catalog ad/, () => [B('image-ad')]]
];
/* labels that only open a page (a report, the moves, the scoreboard) never make anything */
export const NAV_ONLY = /^(open (the )?(report|moves|scoreboard|batch)|see what changed|run monday decisions|see it all)/i;
export function planFor(c = {}, label = '') {
  const l = String(label || c.cta?.label || '').toLowerCase().trim(), kind = c.research?.kind;
  if (NAV_ONLY.test(l) || /^(start this|work on this)$/.test(l)) return [B(recipeFor(c))]; /* generic verbs: the card decides */
  if (kind === 'viral' || (kind === 'ad' && /video|reel/.test(l))) return [B('reel'), B('video-script', 'How to film it')];
  if (kind === 'ad' && /make our version/.test(l)) return [B('remake', 'Our ad')];
  for (const [re, fn] of PLANS) if (re.test(l)) return fn(l);
  return [B(recipeFor(c))];
}
/* what else the idea suits, for "+ Add": the same family's siblings and the cross-channel staples, at most three */
export function alsoFor(id) {
  const r = recipe(id); if (!r) return ['image-ad', 'reel', 'creator-brief'];
  const staple = { static: ['reel', 'ig-carousel', 'creator-brief'], carousel: ['image-ad', 'reel', 'email'], video: ['image-ad', 'creator-brief', 'video-script'], post: ['image-ad', 'reply', 'email'],
    message: ['image-ad', 'whatsapp', 'ig-post'], page: ['image-ad', 'email', 'pdp-set'], table: ['image-ad', 'email', 'creator-brief'], script: ['ugc-ad', 'creator-brief', 'shoot-brief'], creator: ['ugc-ad', 'video-script', 'image-ad'], shoot: ['photoshoot', 'image-ad', 'video-script'], act: ['image-ad', 'email', 'creator-brief'] };
  return (staple[r.kind] || ['image-ad', 'reel', 'creator-brief']).filter((x) => x !== id).slice(0, 3);
}
