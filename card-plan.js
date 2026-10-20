// A card's plan: the ground-work steps toward the action it recommends, before anything ships.
// Every card carries one (feed-service pub). Clicking a card's action never runs it: it opens the card's jam with the
// plan as the jam's input (the case, the brief, the chat). In the jam the action button runs the plan's make step
// (remix.js runPlan: versions on the stage), people iterate each asset, then Share the brief.
// The plan is derived from what the card already carries (rows, how-steps, make, post, first draft) and the action the
// card's button resolves to (remix.js recipeOfCard). A plan the cards writer wrote with AI (cards-gen.js `plan`) is used
// for its wording, but the make step and the last step are always the action's own, so it can always run.
// Nothing here calls AI or treg: every saved card gets a correct plan at pack load without new spend.
// Rule: no step is ever shown as done before it happened ("Decided" is never a plan step).
import { recipeOfCard, labelFor } from './remix.js';
import { familyOf, FAMILY_NAME } from './studio.js';
import { one, oneOf } from './text-fit.js'; // the asset said as one; saved option counts said as one
import { dejargon } from './plain.js'; // a plan's steps in the same plain words as the card (no GMC, webhook, products.json, JSON-LD)
export { one, oneOf };

export const PLAN_V = 4; /* 4: "page section" reads "page", search-info swaps said once, "Review it on the stage" never "each one" (final QA pass 19 Oct); 2: one, always (19 Oct): saved plans on jams and work items with v 1 are rebuilt from the card; 3: plain words in every step (QA FEED-ARV-07) */
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const lc = (s) => String(s || '').replace(/^./, (x) => x.toLowerCase());
const andList = (xs) => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
/* a batch card already holds the finished ads (remix.js isBatch) */
export const isBatchCard = (c) => (c?.images || []).length >= 3 && c.images.every((x) => /^(assets\/statics\/|\/?b\/[a-z0-9-]+\/statics\/)/.test(x));

// the things a card names (ads, products, pages, segments): its rows' labels, only when a label names a thing (quoted, two
// capitalised words, or a noun like "ad" or "page" with its name), never a stat label like "Audience" or "Named overall"
const GENERIC_ROW = /^(move|question|metric|number|range|how we know|grade|result|target|baseline|now|status|source|when|why|cost|spend|budget|score|audience|start|ads|latest|written)$/i;
const THING = /\b(ads?|creatives?|reels?|videos?|posts?|pages?|emails?|flows?|campaigns?|ad sets?|listings?|products?|collections?|skus?|segments?)\b/i;
const namesThing = (x) => /["“‘]/.test(x) || (THING.test(x) && x.split(/\s+/).length >= 2) || /^[A-Z0-9][\w'’&-]*(\s+[A-Z0-9][\w'’&-]*)+$/.test(x);
export const namedItems = (c = {}, n = 3) => {
  const xs = (c.rows || []).filter((r) => Array.isArray(r) && r[0]).map((r) => cut(r[0], 40)).filter((x) => x && !GENERIC_ROW.test(x) && namesThing(x));
  return [...new Set(xs)].slice(0, n);
};

/* how many finished assets the make step puts on the stage, per widget family */
/* one, always (Param, 19 Oct: "let's not give 3 options anywhere: lead with only 1 and let them redo it if they don't like it").
   Every family's make step makes ONE finished asset; Redo it (remix /more) makes the next take, the last one stays in History */
const MAKE_N = { meta_ad: 1, social: 1, post: 1, crm: 1, outreach: 1, store: 1, vis: 1, search: 1, listing: 1, print: 1, meta_ops: 1, setup: 1, brief: 1, decision: 1 };
// what the make step makes, in words, per family and per action where the family is too broad
const ASSET = {
  meta_ad: (k, c) => ({ carousel_ad: 'carousel ads', collection_ad: 'collection ads', catalog_ad: 'catalog ads', whatsapp_ad: 'WhatsApp chat ads' }[k] || (c?.make?.format && /video|reel/i.test(c.make.format) ? 'video ads' : 'Meta ads')),
  social: (k) => ({ ig_carousel: 'Instagram carousels', ig_story: 'Instagram Stories' }[k] || 'Instagram posts'),
  post: (k, c, lab) => (k === 'short_video' ? (/video ad/i.test(lab || '') ? 'video ads' : 'short videos') : k === 'comment_reply' || /reply/i.test(lab || '') ? 'replies' : 'posts'),
  crm: (k) => ({ review_ask: 'review asks', new_segment: 'segments', paid_broadcast: 'WhatsApp broadcasts', discount_offer: 'retention offers', flow_timing: 'send schedules' }[k] || 'messages'),
  store: (k) => ({ price_change: 'price changes', bundle_offer: 'offer tiles', pdp_block: 'proof blocks', new_section: 'page sections', blog_post: 'blog posts' }[k] || 'page copy versions'),
  vis: (k) => ({ llms_txt: 'AI-tool pages', schema_fix: 'search-friendly product info fixes', new_claim: 'claims', blog_post: 'blog posts' }[k] || 'FAQ answers'),
  search: () => 'search ads', listing: (k) => (k === 'takedown' ? 'takedown requests' : 'listing versions'), print: () => 'insert designs',
  meta_ops: (k) => ({ pause_losers: 'pause list', pause_pointing: 'pause list', restart_paused: 'restart list', scale_budget: 'budget change', shift_budget: 'budget change', stop_rule: 'stop rule', price_in_ads: 'price update', swap_copy: 'copy swap' }[k] || 'account change'),
  setup: (k) => ({ fix_links: 'redirect list', tracking_fix: 'tracking fix', store_setting: 'setting change' }[k] || 'change list'),
  brief: (k) => ({ film_brief: 'film brief', buyer_deck: 'buyer deck', creative_brief: 'creative brief' }[k] || 'brief'),
  outreach: () => 'outreach email',
  decision: () => 'team plan'
};
const CONN_NAME = { meta: 'Meta Ads', google: 'Google Ads', ga4: 'Google Analytics', shopify: 'Shopify', klaviyo: 'Klaviyo', whatsapp: 'WhatsApp', marketplaces: 'the marketplaces', loox: 'your reviews app', reviews: 'your reviews app' };
const WHERE = (target, fam) => target?.name && target.name !== 'A person' ? target.name : CONN_NAME[target?.conn] || (fam === 'post' ? 'where it goes' : 'your stack');

// the deterministic plan for each family: [gather, write, make, review, ready]
const STEPS = {
  meta_ad: ({ items, k, n, asset, where, c }) => [
    { k: 'gather', t: items.length && (['add_variants', 'swap_creative', 'swap_copy'].includes(k) || items.some((x) => /\b(ads?|creatives?|hooks?|video|reel)\b/i.test(x))) ? `Pick the winning ads${items.length ? `: ${andList(items)}` : ''}` : `Pick the product and the angle${items.length ? `: ${andList(items)}` : ''}`, s: items.length ? 'Named on the card, from its numbers' : cut(c.sub, 110) },
    { k: 'write', t: 'Write the ad, with one strong hook', s: c.make?.pieces ? cut(c.make.pieces, 90) : 'The offer and the product, in the brand’s voice' },
    { k: 'make', t: `Make the ${one(asset)}`, s: `Ready to run on ${where}; redo it if it isn’t right` },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right; nothing is lost' },
    { k: 'ready', t: `Ready: share the brief so the team launches it on ${where}`, s: 'It copies the brief and a link to everything' }],
  social: ({ items, n, asset, c }) => [
    { k: 'gather', t: `Pick the product and the moment${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: 'Write the caption and the words on each slide', s: c.make?.pieces ? cut(c.make.pieces, 90) : 'In the brand’s voice, one idea' },
    { k: 'make', t: `Make the ${one(asset)}`, s: 'With its pictures; redo it if it isn’t right' },
    { k: 'review', t: 'Review it on the stage', s: 'Change the words or the picture until it’s right' },
    { k: 'ready', t: 'Ready: share the brief, then post it yourself', s: 'The brief carries the post and where it goes' }],
  post: ({ k, n, asset, c, where }) => [
    { k: 'gather', t: c.post?.where?.[0]?.name ? `Read the thread on ${c.post.where[0].name}` : 'Read where it goes and what people asked', s: c.post?.where?.[0]?.rule ? cut(c.post.where[0].rule, 110) : cut(c.sub, 110) },
    { k: 'write', t: `Write the ${k === 'short_video' ? 'script' : one(asset)}, in the brand’s own words`, s: 'Only facts we can back' },
    { k: 'make', t: `Make the ${one(asset)}`, s: k === 'short_video' ? 'The hook in the first second; redo it if it isn’t right' : 'Redo it if it isn’t right' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it sounds like you' },
    { k: 'ready', t: where === 'Meta Ads' ? 'Ready: share the brief so the team runs it on Meta Ads' : `Ready: share the brief, then post it ${where === 'where it goes' ? 'yourself' : `on ${where}`}`, s: where === 'Meta Ads' ? 'It copies the brief, the video and the ad text for Ads Manager' : 'The brief carries the post and where it goes' }],
  crm: ({ items, n, asset, c, where }) => [
    { k: 'gather', t: `Pick who gets it${items.length ? `: ${andList(items)}` : ''}`, s: 'And who is left out' },
    { k: 'write', t: `Write the ${one(asset)}`, s: cut((c.detail?.how || [])[0] || 'Subject, words and the button', 110) },
    { k: 'make', t: `Make the ${one(asset)}`, s: 'As people will see it' },
    { k: 'review', t: 'Review it on the stage', s: 'Change the words or the timing until it’s right' },
    { k: 'ready', t: `Ready: share the brief so the team sends it from ${where}`, s: 'It copies the brief and a link to everything' }],
  store: ({ items, n, asset, c, where }) => [
    { k: 'gather', t: `Pick the page${items.length ? `: ${andList(items)}` : 's it changes'}`, s: cut(c.sub, 110) },
    { k: 'write', t: `Write the ${one(asset)}`, s: cut((c.detail?.how || [])[0] || 'What shoppers read, in the brand’s voice', 110) },
    { k: 'make', t: `Make the ${one(asset)}`, s: 'As the page will show it' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right' },
    { k: 'ready', t: `Ready: share the brief so the team publishes it on ${where}`, s: 'It copies the brief and a link to everything' }],
  vis: ({ items, n, asset, c, where }) => [
    { k: 'gather', t: `Pick the question and its sources${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: `Write the ${one(asset)}`, s: 'Every claim with its source and date' },
    { k: 'make', t: `Make the ${one(asset)}`, s: 'One AI tools can cite' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until every line is backed' },
    { k: 'ready', t: `Ready: share the brief so the team publishes it on ${where}`, s: 'It copies the brief and a link to everything' }],
  search: ({ items, n, c, where }) => [
    { k: 'gather', t: `Pick the searches to win${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: 'Write the headlines and descriptions', s: 'Each under the character limits' },
    { k: 'make', t: 'Make the search ad', s: 'The ad group with keywords and budget' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right' },
    { k: 'ready', t: `Ready: share the brief so the team launches it on ${where}`, s: 'The brief says the spend' }],
  listing: ({ items, n, asset, c, where }) => [
    { k: 'gather', t: `Pick the listings${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: `Write the ${one(asset)}`, s: 'One name used everywhere' },
    { k: 'make', t: `Make the ${one(asset)}`, s: 'Listing by listing' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right' },
    { k: 'ready', t: `Ready: share the brief so the team pushes it to ${where}`, s: 'It copies the brief and a link to everything' }],
  print: ({ n, c }) => [
    { k: 'gather', t: 'Pick what goes in the box', s: cut(c.sub, 110) },
    { k: 'write', t: 'Write the front and back', s: 'Short, with one thing to do' },
    { k: 'make', t: 'Make the insert design', s: 'With size and quantity' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right' },
    { k: 'ready', t: 'Ready: share the brief with whoever prints it', s: 'The brief has everything the printer needs' }],
  meta_ops: ({ items, k, asset, c, where }) => [
    { k: 'gather', t: `${k === 'restart_paused' ? 'Find what was paused' : k === 'scale_budget' || k === 'shift_budget' ? 'Find where the budget is' : 'Find the ads it touches'}${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: `Set the change: ${lc(labelOf(k, c))}`, s: cut((c.detail?.how || [])[0] || 'Small steps, so learning doesn’t reset', 110) },
    { k: 'make', t: `Make the ${asset}`, s: 'Every ad set, before and after' },
    { k: 'review', t: 'Review it on the stage', s: 'Change the amounts or the list until it’s right' },
    { k: 'ready', t: `Ready: share the brief so the team applies it on ${where}`, s: 'It copies the brief and a link to everything' }],
  setup: ({ items, asset, c, where }) => [
    { k: 'gather', t: `Find what’s broken${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: 'Write the steps to fix it', s: cut((c.detail?.how || [])[0] || 'And how we know it worked', 110) },
    { k: 'make', t: `Make the ${asset}`, s: 'Each step, in order' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right' },
    { k: 'ready', t: `Ready: share the brief so the team applies it on ${where}`, s: 'It copies the brief and a link to everything' }],
  outreach: ({ c }) => [
    { k: 'gather', t: 'Name who it goes to', s: c.sub ? cut(c.sub, 90) : 'The person and the business the card names' },
    { k: 'write', t: 'Write the email, with one clear ask', s: 'Short, from a person at the brand' },
    { k: 'make', t: 'Make the outreach email', s: 'Redo it if it isn’t right' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right; nothing is lost' },
    { k: 'ready', t: 'Ready: share the brief, then a person on your team sends it', s: 'One email to one person, from your own inbox' }],
  brief: ({ items, asset, c }) => [
    { k: 'gather', t: `Gather what the team needs${items.length ? `: ${andList(items)}` : ''}`, s: cut(c.sub, 110) },
    { k: 'write', t: `Write the ${asset}`, s: cut((c.detail?.how || [])[0] || 'Deliverables, budget and dates', 110) },
    { k: 'make', t: `Make the ${asset}`, s: 'One document, ready to send' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until it’s right' },
    { k: 'ready', t: 'Ready to send to the team', s: 'Share the brief hands it over' }],
  decision: ({ c }) => [
    { k: 'gather', t: 'Lay out the options', s: cut(c.sub, 110) },
    { k: 'write', t: 'Write what changes once it’s settled', s: 'Who owns it and when' },
    { k: 'make', t: 'Make the team plan', s: 'One plan the team can act on' },
    { k: 'review', t: 'Review it on the stage', s: 'Change it until everyone agrees' },
    { k: 'ready', t: 'Ready: share the brief as the team plan', s: 'Share the brief hands it over' }]
};
const labelOf = (k, c) => { for (const a of ['performance', 'creative', 'storefront', 'visibility', 'crm', 'brew']) { const l = labelFor(`${a}.${k}`, c); if (l) return l.label; } return k; };

/* the action a card's button resolves to: its own job, else the first job its area offers */
export function actionOfCard(c = {}) { const r = recipeOfCard(c); const action = r.primary || r.actionKeys[0] || 'brew.plan'; return { action, recipe: r }; }

// steps a writer (AI) gave the card: their words, the action's own make and last steps
const fromAi = (ai, det) => {
  const xs = (Array.isArray(ai) ? ai : []).map((x) => cut(oneOf(typeof x === 'string' ? x : x?.t), 90)).filter((x) => x && !/\bdecided\b/i.test(x));
  if (xs.length < 3 || xs.length > 6) return null;
  const body = xs.slice(0, -1).map((t) => ({ k: 'step', t, s: '' }));
  const mi = body.findIndex((x) => /\b(make|draft|write|generate|design|build|create|shoot|render|produce)\b/i.test(x.t));
  if (mi >= 0) body[mi] = { ...det.find((x) => x.k === 'make'), t: body[mi].t }; else body.push(det.find((x) => x.k === 'make'));
  return [...body, det.find((x) => x.k === 'ready')];
};

// the case in a few sentences: what we saw, why it matters, and the action to press
export const caseSummary = (c = {}, plan) => {
  const sq = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const sub = cut(c.sub, 220);
  // the first reason that says something new: not a bare "Label: ₹123", not the card's own line again
  const why = (c.detail?.why || []).find((x) => x && !/^[^:]{2,60}:\s*[₹$€£]?[\d.,]+\s*$/.test(x) && sq(x) !== sq(c.sub) && sq(x) !== sq(c.title));
  return [cut(c.title, 140).replace(/[.!?]?$/, '.'), sub && sub !== c.title ? sub.replace(/[.!?…]?$/, (m) => m || '.') : '', why ? cut(why, 160).replace(/[.!?]?$/, '.') : '',
    plan.n ? `Brew makes the ${one(plan.make.what)} for you to review; redo it if it isn’t right. Nothing ships until you say so.` : 'Nothing ships until you say so.', `Next: ${plan.cta}.`].filter(Boolean).join(' ');
};

/* the plan for a card. draft: the card's first draft (drafts-bg draftView), which becomes v0 on the jam's stage */
/* buttons that are a place to go, not an action, and cards that only report progress: no plan */
export const NOT_MAKING_LABEL = /^(?:open|see|agree|approve|publish|shift|pause|restart|launch|turn on|queue|start the tests|fix tracking|fix the links|update the prices|review draft|win their|show how|work on this|send|set the watch|ship|apply|run|lock)\b/i;
export const NAV_LABELS = new Set(['Open the moves', 'Open the deck', 'See all with Pro', 'See what moves it', 'Start a new batch']);
export function planFor(c = {}, { draft = null, action: forced = null } = {}) {
  if (!c || !c.title || NAV_LABELS.has(c.cta?.label) || /^build-/.test(c.id || '')) return null;
  const own = actionOfCard(c), action = forced || own.action, recipe = own.recipe, k = action.split('.').pop(), family = familyOf(action);
  const lab = labelFor(action, c) || { label: action, target: {} };
  /* the jam's button says what it does: the card's own label only when that label makes the thing ("Make the ad", "Draft the
     email"); a label that opens, decides, approves, spends or pauses ("Open the scoreboard", "Approve the flows", "Shift budget")
     only makes a draft here, so the button says so (QA J-15) */
  const own0 = String(c.cta?.label || '').trim();
  const cta = own0 && !NOT_MAKING_LABEL.test(own0) ? own0 : 'Make the draft';
  const batch = isBatchCard(c);
  const n = batch ? 0 : MAKE_N[family] || 1;
  const asset = (ASSET[family] || (() => 'versions'))(k, c, lab.label);
  const ctx = { c, k, n, asset, items: namedItems(c), where: WHERE(lab.target, family) };
  let steps = batch ? [
    { k: 'gather', t: `Look at the ${c.images.length} finished ads`, s: 'Already made, on the stage one by one' },
    { k: 'review', t: 'Keep or drop each one', s: 'Remix any of them until it’s right' },
    { k: 'make', t: 'Fix what the checks flag', s: 'Every kept ad passes the checks' },
    { k: 'ready', t: 'Ready: share the brief so the team runs the kept ads as one test', s: 'It copies the brief and a link to everything' }]
    : (STEPS[family] || STEPS.decision)(ctx);
  let by = 'rule';
  const ai = !batch && c.plan?.by === 'ai' ? fromAi(c.plan.steps, steps) : null; if (ai) { steps = ai; by = 'ai'; }
  const plan = { v: PLAN_V, action, family, asset: FAMILY_NAME[family] || 'Version', cta, n, batch, by, target: ctx.where,
    make: { n, what: asset, one: one(asset), kind: family }, steps: steps.map((s, i) => ({ n: i + 1, ...s, t: dejargon(s.t), s: dejargon(s.s) })), draft: draft ? { as: draft.as, images: draft.images || [], video: draft.video || null, poster: draft.poster || null, ratio: draft.ratio || null, title: draft.title || '', copy: draft.copy || '', ...(draft.code ? { code: draft.code } : {}) } : null,
    conflict: !!recipe.conflict };
  plan.summary = dejargon(caseSummary(c, plan));
  return plan;
}

// the plan as Markdown, for the jam brief (jam-brief.js) and every prompt that reads the card (cardBrief)
export const planMd = (plan) => plan ? `${plan.steps.map((s) => `${s.n}. ${s.t}${s.s ? ` (${s.s})` : ''}`).join('\n')}\n\n**Next:** ${plan.cta}.` : '';
export const planPrompt = (plan) => plan ? `\nThe card's plan toward “${plan.cta}” (${plan.asset}${plan.n ? `, the make step makes one ${one(plan.make.what)}: never several options to pick from` : ''}):\n${plan.steps.map((s) => `${s.n}. ${s.t}`).join('\n')}${plan.draft?.copy || plan.draft?.title ? `\nThe first draft the card shows (v0 on the jam's stage, ${plan.draft.as || 'draft'}): ${cut([plan.draft.title, plan.draft.copy].filter(Boolean).join(' · '), 400)}` : ''}` : '';
// the plan after someone changed its steps in the jam's chat: their steps, the action's own make and last steps
export const withSteps = (plan, steps) => { if (!plan) return plan; const s = fromAi(steps, plan.steps); return s ? { ...plan, steps: s.map((x, i) => ({ ...x, n: i + 1, t: dejargon(x.t), s: dejargon(x.s) })), by: 'chat' } : plan; };
