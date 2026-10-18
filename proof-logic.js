// Does the proof actually prove the claim? evidence.js gathers what Brew holds for a card (numbers it matched, reviews, threads,
// pages read); this checks it against what the card SAYS, for every card and brand, with no AI and no spend:
//   1. the card's own pointer to its evidence is followed: make.backedBy ("The Judge.me review titled Long Curls from 2026-06-29")
//      and quote rows (["Review", "Keeps the curls long"]) become the real review, with its link, when Brew holds it
//   2. what only describes the card is not proof of its claim: the price of the product being promoted, the product, the format,
//      the target. Those leave the proof (Param, 19 Oct: "people are questioning if products ruin curls … why is it based on price?")
//   3. the claim is read for what it needs: "customers are asking …" needs what customers said; "high bounce", "sales", "ROAS" need
//      the brand's own account. Missing it, the sheet says so plainly, and names the connector that would check it
//   4. a claim the evidence contradicts is named: "people doubt it" backed only by happy reviews is praise, not doubt
const STOP = new Set('the a an and or of to in on for with is are be we our your you it this that by at as from per one not no new more than into out up its their them they have has was were will can all any but how what when who why which while so do does did get got just only also very much many most less over under about after before then there here product products'.split(' '));
const words = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const okUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

export const CONNECTOR_NAMES = { shopify: 'Shopify', ga4: 'Google Analytics', meta: 'Meta Ads', google: 'Google Ads', klaviyo: 'Klaviyo', reviews: 'your reviews app' };

/* only what the card says it SAW needs proof of that kind: "We saw customers questioning …", "visitors are leaving the page". What
   it expects to happen ("helps convert", "encourages repeat orders", "will build trust") is the idea, not a claim about data, so
   the check reads the sentence only up to the first word that says what the action will do */
const EXPECT = /\b(need to|needs to|should|must|before they|helps?|helping|will|would|could|can|to help|encourages?|builds?|keeps?|stops?|drives?|gets?|lowers?|raises?|makes?|lets?|gives?|captures?|answers?|addresses|addressing|improves?|so (?:the|that|you|we|they))\b/i;
const observedOf = (claim) => { const s = String(claim || '').replace(/^\s*brew suggests this (?:because|after)\s*/i, ''); const m = s.match(EXPECT); return m ? s.slice(0, m.index) : s; };
/* what people said, asked or worried about */
const VOICE_RE = /\b(questioning|question(?:s|ed)? (?:if|whether|about)|asking (?:if|whether|about|for)|complain\w*|worr(?:y|ied|ies)|fears?|feared|doubts?|doubting|skeptic\w*|talk(?:s|ing)? about|debat\w*|say(?:s|ing)?|said|mention\w*|reviews? (?:show|say|mention)|praise\w*|verbatims?|threads?)\b/i;
/* what people search for: shown by search data (Google, AI answers), not by reviews */
const SEARCH_RE = /\b(searchers|(?:people|shoppers|buyers|customers|users) (?:are |often |keep )?search(?:ing|es)?|(?:monthly|weekly) searches|searches (?:for|a month|every month)|search volume|searching for)\b/i;
/* the claim says people doubt or dislike something */
const DOUBT_RE = /\b(question\w*|complain\w*|worr\w*|fears?|feared|doubt\w*|unhappy|negative|angry|scam|ruin\w*|problem|issues?|struggl\w*|frustrat\w*|balk\w*|ask(?:ing|ed)? (?:if|whether))\b/i;
/* claims about the brand's own results: only the brand's own accounts can show them */
const METRICS = [
  { re: /\b(bounce\w*|traffic|visits|sessions?|conversion rates?|abandon\w*|drop(?:s|ping)?[- ]?offs?|drop off|(?:are|is) leaving|losing (?:customers|buyers|shoppers|visitors)|scroll depth)\b/i, needs: ['ga4', 'shopify'], what: 'visits, bounce and conversion' },
  /* a number the store's own orders would show: "sales are down", "repeat rate", "subscribers are cancelling"; not "bulk-order tiers" or "sales collateral" */
  { re: /\b(revenue|(?:sales|orders?) (?:are|is|have|has|fell|fall\w*|drop\w*|dipp?\w*|grew|grow\w*|rose|ris\w*|down|up|slow\w*|stall\w*)|repeat (?:purchase )?(?:rates?|buyers|customers|orders)|average order|refunds?|sell[- ]?through|subscri(?:bers?|ptions?) (?:are|is|keep|cancel\w*)|cancel(?:ling|lations?))\b/i, needs: ['shopify'], what: 'orders and sales' },
  { re: /\b(roas|ad spend|cpc|cpm|ctr|click[- ]?through|cost per (?:sale|click|order|purchase)|ads? (?:are|is) (?:tired|fatigued|losing|wasting))\b/i, needs: ['meta', 'google'], what: 'ad results' },
  { re: /\b(open rates?|email (?:list|flows?|revenue|subscribers?)|flows? (?:are|is) (?:off|live)|unsubscrib\w*)\b/i, needs: ['klaviyo'], what: 'email results' }
];
/* a card row that only describes the card (its product, price, format, target), never proof of why */
const SPEC_ROW = /^(price|product|core product|target(?: group| product| audience)?|segment|format|offer(?:ed value)?|trigger(?: type)?|season start|objection|cta|channel|audience|budget|placement|length|duration|hook|angle|launch|when|post at)$/i;
/* Brew's own plan in a row ("Proposed price", "New threshold", "Target") is what it suggests, never what it saw */
const PLAN_ROW = /\b(proposed|suggested|recommended|planned|new|target|goal|future|test(?:ed)?|expected|estimated?|projected)\b/i;
const QUOTE_ROW = /^(review|reviews|quote|verbatim|customer(?: says| quote)?|what (?:they|customers|people) say|comment|said)$/i;
/* the claim is about money when it names a price, a cost or an offer */
const PRICE_CLAIM = /[₹$€£]\s?\d|\b(price[ds]?|pricing|cost(?:s|ly)?|cheaper|expensive|discount\w*|offer|bundle|combo (?:at|for)|margin|value for money|ladder)\b/i;
const PRICE_ITEM = /\b(price|list price|compare-at|mrp|cost)\b/i;

/* the review a card points at: by title, date, a phrase it quotes, and the product the card names */
const findReview = (hint, voice, cardText) => {
  const h = String(hint || ''), hw = new Set(words(h)), date = h.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1], low = cardText.toLowerCase();
  const titled = h.match(/titled\s+[“"']?([^“”"']+?)[”"']?(?:\s+from\b|$)/i)?.[1]?.trim().toLowerCase();
  let best = null;
  for (const v of voice) { if (v.kind !== 'review') continue;
    let s = 0; const vw = words(`${v.title || ''} ${v.text}`);
    for (const w of new Set(vw)) if (hw.has(w)) s++;
    if (titled && String(v.title || '').toLowerCase() === titled) s += 6;
    if (date && String(v.at || '').slice(0, 10) === date) s += 2;
    if (v.product && low.includes(String(v.product).toLowerCase().split(/\s+[-–|]\s+/)[0])) s += 2;
    if (!best || s > best.s) best = { v, s }; }
  return best && best.s >= 4 ? best.v : null;
};
const voiceItem = (v) => ({ mine: true, kind: 'voice', label: `${v.rating ? `${v.rating}★ review` : 'A customer review'}${v.product ? ` of ${cut(v.product, 60)}` : ''}`, value: cut(v.text, 220), src: v.src || 'Your reviews', url: okUrl(v.url), at: v.at ? String(v.at).slice(0, 10) : null, rating: v.rating || null });

/* a review's stars: its rating, or the "5★ review" its label says */
const starsOf = (x) => +(x.rating || String(x.label || '').match(/(\d(?:\.\d)?)\s*★/)?.[1] || 0);

export function refine(c, e, { voice = [], connected = () => false, has = () => true } = {}) {
  if (!c || !e) return e;
  const claim = String(e.why?.because || String(c.sub || '').split(/(?<=[.!?])\s+/)[0] || '');
  const cardText = [c.title, c.sub, claim, c.make?.pieces, c.make?.backedBy, ...(c.rows || []).map((r) => (Array.isArray(r) ? r.join(' ') : ''))].filter(Boolean).join(' \n ');
  const items = [...(e.items || [])], keyOf = (x) => `${x.kind}|${String(x.value || '').slice(0, 60)}|${x.url || ''}`, have = new Set(items.map(keyOf));
  const add = (x) => { const k = keyOf(x); if (have.has(k) || items.some((y) => y.url && y.url === x.url && y.value === x.value)) return; have.add(k); items.unshift(x); };
  /* 1. the card's own pointer to its evidence, and quote rows, as the real review */
  const by = String(c.make?.backedBy || ''), hints = [...(/review|verbatim|judge\.?me|loox|okendo|yotpo|quote|said|wrote|customer/i.test(by) ? [by] : []),
    ...(c.rows || []).filter((r) => Array.isArray(r) && QUOTE_ROW.test(String(r[0] || '').trim()) && r[1]).map((r) => String(r[1]))];
  for (const h of hints) { const v = findReview(h, voice, cardText); if (v) add(voiceItem(v)); }
  /* a claim that people doubt or complain is proven by the reviews and threads that do, not by happy ones that share its words */
  const seen0 = observedOf(claim), brandW0 = new Set(words(c.brand || e.brand || ''));
  if (DOUBT_RE.test(seen0) && VOICE_RE.test(seen0)) { const cw = new Set(words(`${seen0} ${c.title || ''}`).filter((w) => !brandW0.has(w)));
    const neg = voice.filter((v) => (v.kind === 'review' ? +v.rating && +v.rating <= 3 : v.kind === 'thread')).map((v) => ({ v, s: new Set(words(`${v.title || ''} ${v.text} ${v.product || ''}`).filter((w) => cw.has(w))).size }))
      .filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 2);
    for (const { v } of neg.reverse()) add(v.kind === 'review' ? voiceItem(v) : { mine: true, kind: 'quote', label: v.where ? `Said on ${v.where}` : 'Said online', value: cut(v.text, 220), src: v.platform || '', url: okUrl(v.url), extra: v.replies ? `${v.replies} replies` : '' }); }
  /* 2. what only describes the card leaves the proof: spec rows, and the promoted product's price when the claim isn't about price */
  /* a page Brew read is proof only when it is about what the card says (shares a word with it beyond the brand's own name) */
  const brandW = new Set(words(c.brand || e.brand || '')), aboutW = new Set(words([c.title, claim, c.make?.pieces].filter(Boolean).join(' ')).filter((w) => !brandW.has(w) && !/^\d/.test(w)));
  const about = (x) => new Set(words(x.label).filter((w) => aboutW.has(w))).size >= 2; /* one shared word ("hair" on a hair brand) is chance */
  const priceClaim = PRICE_CLAIM.test(claim);
  /* customer voice Brew matched by shared words backs a claim about customers, reviews or proof, never one about ads, ranks or prices
     (19 Oct: an "all 8 ads are fresh" card showed a Reddit thread about the serum). The card's own quotes and review pointer always stay */
  const own = new Set(items.filter((x) => x.mine).map(keyOf)), aboutPeople = VOICE_RE.test(claim) || DOUBT_RE.test(claim) && /\b(customers?|buyers?|shoppers?|people|users)\b/i.test(claim);
  const aboutReviews = aboutPeople || /\b(reviews?|reviewers?|testimonials?|social proof|verbatims?|ratings?|stars?|ugc|customer stories|real (?:stories|buyers|customers))\b/i.test(`${claim} ${c.title || ''} ${c.make?.pieces || ''}`);
  const offTopicVoice = (x) => !own.has(keyOf(x)) && ((x.kind === 'voice' && !aboutReviews) || (x.kind === 'quote' && /^Said (?:on|online)/.test(x.label || '') && !aboutPeople));
  const isContext = (x) => (x.kind === 'row' && (SPEC_ROW.test(String(x.label || '').trim()) || QUOTE_ROW.test(String(x.label || '').trim()) || PLAN_ROW.test(String(x.label || '')) || /[₹$€£]\s?\d/.test(String(x.value || '')) /* money Brew wrote on the card with no page behind it is its plan, not data */))
    || (!priceClaim && ['fact', 'web', 'count', 'row', 'math', 'source'].includes(x.kind) && PRICE_ITEM.test(String(x.label || '')))
    || offTopicVoice(x)
    || (x.kind === 'source' && (!about(x) || !priceClaim && /:\s*[₹$€£]\s?\d/.test(String(x.label || ''))));
  const backing = items.filter((x) => !isContext(x)), context = items.filter(isContext);
  /* 3. what the claim needs */
  const seen = seen0, searchClaim = SEARCH_RE.test(seen), voiceClaim = !searchClaim && VOICE_RE.test(seen), metric = METRICS.find((m) => m.re.test(seen));
  const voiceIn = backing.filter((x) => x.kind === 'voice' || x.kind === 'quote' || (x.kind !== 'source' && /\b(mentions?|reviews?|ratings?|comments?|posts?)\b/i.test(x.label || '')));
  const accountIn = backing.some((x) => x.kind === 'account');
  /* the order a person reads it: what the claim is about first */
  const rank = (x) => (voiceClaim && (x.kind === 'voice' || x.kind === 'quote') ? 0 : metric && x.kind === 'account' ? 0 : x.kind === 'source' ? 3 : x.url ? 1 : 2);
  backing.sort((a, b) => rank(a) - rank(b));
  let note = '', needs = [], metricNeeds = [];
  if (metric && !accountIn) {
    needs = metric.needs.filter((id) => has(id) && !connected(id)); metricNeeds = metric.needs.filter((id) => has(id));
    note = needs.length ? `Brew can’t see your ${metric.what} yet, so this part is a guess. Connect ${needs.map((id) => CONNECTOR_NAMES[id] || id).join(' or ')} to check it.`
      : `Brew hasn’t matched this to your ${metric.what} yet, so treat that part as a guess.`;
  } else if (searchClaim && !backing.some((x) => x.kind === 'trend' || x.kind === 'read' || /search|keyword|volume|google|people also ask|ai answer|quer(?:y|ies)/i.test(`${x.label} ${x.src}`))) note = 'The card says people search for this, but Brew hasn’t kept the search numbers that show it. Treat it as a guess until you see them.';
  else if (voiceClaim && !voiceIn.length) note = 'The card says customers are saying this, but Brew hasn’t found the reviews or posts that show it. Treat it as a guess until you see them.';
  else if (voiceClaim && DOUBT_RE.test(seen) && voiceIn.length && voiceIn.every((x) => x.kind === 'voice' && starsOf(x) >= 4)) {
    const n = voiceIn.length; note = `The card says people doubt this, but what Brew found is praise: ${['', 'a', 'two', 'three', 'four', 'five'][n] || n} ${voiceIn.every((x) => starsOf(x) === 5) ? '5★' : 'happy'} review${n > 1 ? 's' : ''}. Use ${n > 1 ? 'them' : 'it'} as proof that it works, not as the problem.`; }
  const sourced = backing.filter((x) => x.url || x.kind === 'account').length;
  return { ...e, items: backing, context, claim: { voice: voiceClaim, metric: metric && !accountIn ? metric.what : null, metricNeeds, note, needs }, count: backing.length, sourced,
    strength: note ? 'thin' : sourced >= 2 ? 'strong' : backing.length ? 'some' : 'thin' };
}
