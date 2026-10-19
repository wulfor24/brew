// Where a card's work happens, and how it fits what the viewer told Brew in setup. Pure: no I/O, no brand names.
// toolOf: the tool a card's action runs on (the pure half of feed-service's deployTarget). channelsOf: the channels a card's
// work goes out on (instagram, facebook, google, email, whatsapp, marketplace); an empty set fits any channel. channelFit and
// paceFit are the ranker's two setup terms (feed-service score(): chan, pace); both are 0 when the viewer answered nothing,
// so the ranking is the same as before for anyone who skipped the questions.

/* the label a card's button carries → the tool it runs on */
export const NEEDS = { 'Queue the 12': 'meta', 'Publish Campaign': 'meta', 'Publish the campaign': 'meta', 'Shift budget': 'meta', 'Rotate creative': 'meta', 'Apply the plan': 'meta', 'Run Monday decisions': 'meta', 'Lock the Diwali set': 'meta',
  'Update landing page': 'shopify', 'Apply Update': 'shopify', 'Turn on guest checkout': 'shopify', 'Approve 6 popups': 'shopify', 'Publish the page': 'shopify', 'Approve the 3 offers': 'shopify', 'Approve the ladder': 'shopify',
  'Push 5 titles': 'marketplaces', 'Draft the listing': 'marketplaces', 'Send on WhatsApp': 'whatsapp', 'Turn on the journey': 'whatsapp', 'Send the review ask': 'loox',
  'Launch the ad group': 'google', 'Fix tracking': 'google', 'Approve the flows': 'klaviyo', 'Swap the images': 'meta', 'Pause those ads': 'meta',
  'Queue the ads': 'meta', 'Approve the offers': 'shopify', 'Push the titles': 'shopify', 'Add the photos': 'marketplaces', 'Draft the replies': 'loox' };
/* labels a generated brand's cards use that the map does not know: the card's own words name the tool before its section does */
export const toolInWords = (c) => { const s = `${c?.title || ''} ${c?.sub || ''}`; return /\b(meta|facebook|instagram|reels?)\b/i.test(s) ? 'meta' : /\bgoogle (ads|search|shopping)\b|\bsearch ads?\b/i.test(s) ? 'google' : /\b(klaviyo|email flow|newsletter)\b/i.test(s) ? 'klaviyo' : null; };
/* labels that are a decision, a review, research or people work: nothing to run on an account */
export const NO_TOOL = new Set(['Agree with the call', 'Open the moves', 'Open the scoreboard', 'Review draft', 'Brief the shoot', 'Shortlist creators', 'Draft the buyer deck', 'Fix tracking', 'Add the search info']);
/* a label that only fits some cards: it names its tool when the card's words agree, else nothing runs */
export const IF_WORDS = { 'Draft the listing': [/\b(amazon|myntra|nykaa|flipkart|ajio|tata cliq|marketplace|listing)\b/i, 'marketplaces'], 'Approve the flows': [/\b(email|flow|klaviyo|newsletter|win-?back|welcome|post-purchase|abandon)\b/i, 'klaviyo'], 'Turn on the journey': [/\b(whatsapp|message|journey|reminder|alert|nudge)\b/i, 'whatsapp'] };

/* the tool key a card's action runs on, or null: the measure family's AI pick first, then the label, then the card's words, then
   (sectorFallback) its section. 'loox' is the reviews app; whether the brand has it connected is the caller's question */
export const toolOf = (label, card, { sectorFallback = true } = {}) => {
  const mf = card?.mf || null, ai = mf?.by === 'ai' && mf.tool ? mf.tool : null, iw = IF_WORDS[label];
  if (ai) return ai === 'none' ? null : ai === 'reviews' ? 'loox' : ai;
  if (NO_TOOL.has(label)) return null;
  if (iw) return iw[0].test(`${card?.title || ''} ${card?.sub || ''}`) ? iw[1] : null;
  return NEEDS[label] || toolInWords(card) || (!sectorFallback ? null : card?.sector === 'creatives' || card?.sector === 'ads' ? 'meta' : card?.sector === 'storefront' ? 'shopify' : null);
};

export const CHANNELS = ['instagram', 'facebook', 'google', 'email', 'whatsapp', 'marketplace'];
const TOOL_CH = { meta: ['instagram', 'facebook'], google: ['google'], klaviyo: ['email'], whatsapp: ['whatsapp'], marketplaces: ['marketplace'] };
const fmtOf = (c) => String(c?.make?.format || '').trim().toLowerCase();
const isAdFormat = (f) => /\bads?$/.test(f); /* single image / carousel / collection / catalog / video ad, and any catalog name ending in "ad" */
/* reports, rival cards, research and live readings are news to read, not work on a channel: they fit everyone */
const exempt = (c) => !!(c && (c.type === 'report' || c.type === 'competitor' || c.research || c.liveOnly || c.liveSrc || c.origin === 'live'));

/* the channels a card's work goes out on: its make format first, then the tool its button runs on (no section guess) */
export function channelsOf(card) {
  if (!card || exempt(card)) return new Set();
  const f = fmtOf(card);
  if (f) {
    if (/^instagram (post|carousel|stories)$/.test(f) || f === 'reel') return new Set(['instagram']);
    if (isAdFormat(f)) return new Set(['instagram', 'facebook']);
    if (f === 'email') return new Set(['email']);
    if (f === 'whatsapp message') return new Set(['whatsapp']);
    if (f === 'page section') return new Set(); /* the brand's own site: every channel lands there */
  }
  return new Set(TOOL_CH[toolOf(card.cta?.label, card, { sectorFallback: false })] || []);
}
/* -8 when the viewer named their channels and this card's work is only on others; 0 otherwise */
export function channelFit(chs, card) {
  if (!Array.isArray(chs) || !chs.length) return 0;
  const s = channelsOf(card); if (!s.size) return 0;
  return chs.some((x) => s.has(x)) ? 0 : -8;
}

/* labels that put a new ad out (the managing ones, budget shifts and pauses, are not new ads) */
const AD_CTAS = new Set(['Publish Campaign', 'Publish the campaign', 'Queue the 12', 'Queue the ads', 'Rotate creative', 'Swap the images', 'Lock the Diwali set', 'Launch the ad group', 'Make the carousel ad', 'Build the collection ad', 'Build the catalog ad']);
/* labels that fix or build what everything else stands on: the store, listings, tracking, the markup */
const GROUND_CTAS = new Set(['Fix tracking', 'Add the search info', 'Turn on guest checkout', 'Update landing page', 'Apply Update', 'Publish the page', 'Push the titles', 'Add the photos', 'Push 5 titles', 'Draft the listing', 'Publish the claims ledger']);
const GROUND_SECTORS = new Set(['storefront', 'catalog', 'visibility']);
const GROUND_FAMILIES = new Set(['foundations', 'site', 'listings', 'search', 'ai_search']);
export function isNewAd(card) {
  if (!card || exempt(card)) return false;
  const f = fmtOf(card); if (f) return isAdFormat(f);
  return AD_CTAS.has(card.cta?.label);
}
export function isGroundwork(card) {
  if (!card || exempt(card) || isNewAd(card)) return false;
  return GROUND_SECTORS.has(card.sector) || fmtOf(card) === 'page section' || GROUND_CTAS.has(card.cta?.label) || GROUND_FAMILIES.has(card.mf?.family);
}
/* how many ads they ran last month → [new ad, groundwork] lift */
export const PACE = { none: [-3, 4], few: [0, 2], ten: [2, 0], always: [4, 0] };
/* the ad pace the read counted: the brand's own live Meta ads (pack-numbers ownAds) → none / few / ten / always; null when unread */
export const paceOf = (n) => (n == null || n === '' || !Number.isFinite(+n) ? null : +n === 0 ? 'none' : +n < 10 ? 'few' : +n < 50 ? 'ten' : 'always');
export function paceFit(adPace, card) {
  const w = PACE[adPace]; if (!w) return 0;
  return isNewAd(card) ? w[0] : isGroundwork(card) ? w[1] : 0;
}

/* the setup answers a viewer may carry: anything else in these fields is dropped, other viewer fields pass through untouched.
   null clears an answer. tools: the brand's connector keys (pass them in; without a list any short key is kept) */
export const AD_PACES = Object.keys(PACE), PER_DAY = [3, 5, 10], TEAM_SIZES = ['me', 'few', 'team', 'agency'], VOICES = ['site', 'warmer', 'sharper', 'plainer'];
export function cleanViewer(v, { tools = null } = {}) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = { ...v }, has = (k) => Object.prototype.hasOwnProperty.call(v, k), one = (k, ok) => { if (!has(k)) return; if (v[k] === null) out[k] = null; else if (ok(v[k])) out[k] = v[k]; else delete out[k]; };
  if (has('channels')) { if (v.channels === null) out.channels = null; else if (Array.isArray(v.channels)) out.channels = [...new Set(v.channels.filter((x) => CHANNELS.includes(x)))]; else delete out.channels; }
  if (has('tools')) { const okTool = (x) => typeof x === 'string' && (tools ? tools.includes(x) : /^[a-z0-9_-]{1,30}$/.test(x));
    if (v.tools === null) out.tools = null; else if (Array.isArray(v.tools)) out.tools = [...new Set(v.tools.filter(okTool))].slice(0, 20); else delete out.tools; }
  one('adPace', (x) => AD_PACES.includes(x));
  if (has('perDay')) { const n = v.perDay === null ? null : Number(v.perDay); if (n === null) out.perDay = null; else if (PER_DAY.includes(n)) out.perDay = n; else delete out.perDay; }
  one('teamSize', (x) => TEAM_SIZES.includes(x));
  one('voice', (x) => VOICES.includes(x));
  return out;
}
