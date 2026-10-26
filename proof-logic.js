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
   the check reads the sentence only up to the first word that says what the action will do, or that it is a guess ("buyers may
   worry …" is the idea said as an idea, which is how the writers are told to say what Brew didn't see) */
const EXPECT = /\b(may|might|likely|probably|need to|needs to|should|must|before they|helps?|helping|will|would|could|can|to help|encourages?|builds?|keeps?|stops?|drives?|gets?|lowers?|raises?|makes?|lets?|gives?|captures?|answers?|addresses|addressing|improves?|so (?:the|that|you|we|they))\b/i;
const observedOf = (claim) => { const s = String(claim || '').replace(/^\s*(?:brew|we) suggest(?:s)? this (?:because|after)\s*/i, ''); const m = s.match(EXPECT); return m ? s.slice(0, m.index) : s; };
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

/* What kinds of evidence Brew holds for a brand, for the writers (cards-gen.js, plain.js): a card may say Brew SAW something only
   of a kind it holds, so fewer cards need a note on the proof sheet. voice is reviews ({kind:'review', rating}) and threads
   ({kind:'thread'}); ledger and facts give the connected accounts (method "account:<id>", never demo or stale) and search data */
const ACCOUNT_OF = { ga4: 'ga4', shopify: 'shopify', meta: 'meta', gads: 'google', google: 'google', klaviyo: 'klaviyo' };
const LISTEN_HOST = /reddit\.com|quora\.com|youtube\.com|youtu\.be|twitter\.com|\bx\.com|instagram\.com\/(?:p|reel)\/|forum|community|threads\.net|tiktok\.com/i;
export function evidenceKinds({ voice = [], ledger = [], facts = {}, sources = [] } = {}) {
  const rv = voice.filter((v) => v?.kind === 'review'), rated = rv.filter((v) => +v.rating);
  const unhappy = rated.filter((v) => +v.rating <= 3), happy = rated.filter((v) => +v.rating >= 4);
  const signals = (ledger || []).filter((e) => e?.signal && e.v && !e.demo);
  const listened = (sources || []).filter((s) => LISTEN_HOST.test(String(s?.url || '')));
  const threads = voice.filter((v) => v?.kind === 'thread').length + signals.length + listened.length;
  const where = [...new Set([...voice.filter((v) => v?.kind === 'thread').map((v) => v.where || v.platform), ...listened.map((s) => String(s.url).replace(/^https?:\/\/(www\.)?/, '').split('/')[0])].filter(Boolean))].slice(0, 3);
  const accounts = new Set((ledger || []).filter((e) => e && !e.demo && !e.stale && /^account:/.test(e.method || '')).map((e) => ACCOUNT_OF[String(e.method).slice(8)] || ACCOUNT_OF[String(e.key || '').split('.')[0]]).filter(Boolean));
  const lines = [...(ledger || []), ...Object.values(facts || {})].filter((e) => e && !e.demo).map((e) => String(e.label || ''));
  const search = { ranks: lines.filter((l) => /google rank|rank for|position for/i.test(l)).length, ai: lines.filter((l) => /\bAI answers?\b/i.test(l)).length,
    volumes: lines.filter((l) => /search volume|monthly searches|searches (?:a|per|every) month|google trends|keyword volume|searches for/i.test(l)).length };
  return { reviews: rv.length, happy: happy.length, unhappy: unhappy.length, unhappyText: unhappy.slice(0, 2).map((v) => cut(v.text, 90)), threads, where, accounts: [...accounts], search };
}
/* what a card's "we saw …" sentence claims that the brand's evidence (evidenceKinds) can't show: the same reading refine() does on the
   proof sheet, so a writer can fix the words before the card ships. Only the observation counts, never what the action will do */
export function claimGaps(text, k = {}) {
  const seen = observedOf(text), out = [], acc = new Set(k.accounts || []);
  const metric = METRICS.find((m) => m.re.test(seen));
  if (metric && !metric.needs.some((id) => acc.has(id))) out.push({ kind: 'account', what: metric.what, needs: metric.needs });
  const searchClaim = SEARCH_RE.test(seen);
  if (searchClaim && !k.search?.volumes) out.push({ kind: 'search' });
  if (!searchClaim && VOICE_RE.test(seen)) {
    if (!k.reviews && !k.threads) out.push({ kind: 'voice' });
    else if (DOUBT_RE.test(seen) && !k.unhappy && !k.threads) out.push({ kind: 'praise' });
  }
  return out;
}
/* the gap said to a writer, in one line */
export const gapLine = (g) => g.kind === 'account' ? `it says what the brand's ${g.what} are, but no ${g.needs.map((id) => CONNECTOR_NAMES[id] || id).join(' or ')} account is connected`
  : g.kind === 'search' ? 'it says how people search, but Brew holds no search counts' : g.kind === 'praise' ? 'it says people doubt or complain, but every review Brew holds is happy'
  : 'it says customers say this, but Brew holds no reviews or posts';
/* the block every card writer gets: what Brew holds, and how to say what it doesn't */
export function writerEvidence(k = {}, brand = 'the brand') {
  const acc = (k.accounts || []).map((id) => CONNECTOR_NAMES[id] || id);
  const rev = !k.reviews ? 'none. Brew has read no customer reviews for this brand'
    : `${k.reviews} read (${k.happy} at 4★ or 5★, ${k.unhappy} at 3★ or below)${k.unhappy ? `. Unhappy ones say: ${k.unhappyText.map((t) => `"${t}"`).join('; ')}` : '. None complains, so they are proof that it works, never a sign of doubt'}`;
  const th = k.threads ? `${k.threads}${k.where?.length ? ` (${k.where.join(', ')})` : ''}` : 'none';
  const se = [k.search?.ranks ? `Google rank checks (${k.search.ranks})` : '', k.search?.ai ? 'AI answer checks' : '', k.search?.volumes ? `search counts (${k.search.volumes})` : ''].filter(Boolean).join(', ') || 'none';
  return `WHAT BREW HOLDS FOR ${brand} (a card may say Brew saw something only of these kinds):
- Customer reviews: ${rev}.
- Posts and threads people wrote online: ${th}.
- ${brand}'s own accounts: ${acc.length ? `${acc.join(', ')} connected` : 'none connected'}. ${acc.length ? 'Anything else (' : '('}visits, bounce, conversion, carts, orders, sales, repeat buying, ad results, email results) Brew cannot see${acc.length ? ' beyond those accounts' : ''}.
- Search data: ${se}${k.search?.volumes ? '' : '. No counts of how many people search'}.
How to word it:
- "We saw", "customers say", "people are asking", "visitors are leaving", "people search for" only when the kind above holds it, naming where ("a 5★ Judge.me review says...", "a Reddit thread asks...").
- What the move reasons but Brew did not see is an idea, said as one: "buyers may worry the gel ruins curls", "a price this high can make new visitors hesitate". Never "we saw" for it.
- Never say visitors bounce, leave, drop off or abandon carts, or that sales, orders, repeat buying, ad returns or email results are up, down, high or low, unless one of the accounts above shows it.
- Happy reviews are proof that it works. Never call them doubt, worry or a problem.`;
}

/* the brand's own product words that sit on many of its cards ("mitoactive", "serum" on Arata, "snugglet" on Cozy), and words on a
   third of all its cards, say nothing about one card: a page sharing only those is not about it. Topic words ("ads", "reviews")
   are not product names, so they still count. Worked out once per card list */
const COMMON = new WeakMap();
const commonOf = (corpus, names = []) => { if (!Array.isArray(corpus) || corpus.length < 10) return new Set(); if (COMMON.has(corpus)) return COMMON.get(corpus);
  const df = new Map(); for (const p of corpus) for (const w of new Set(words(`${p?.title || ''} ${p?.sub || ''}`))) df.set(w, (df.get(w) || 0) + 1);
  const nw = new Set(words((names || []).join(' ')));
  const out = new Set([...df].filter(([w, n]) => n / corpus.length > 0.35 || (nw.has(w) && n / corpus.length > 0.15)).map(([w]) => w)); COMMON.set(corpus, out); return out; };
export function refine(c, e, { voice = [], connected = () => false, has = () => true, corpus = null, names = null } = {}) {
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
  const brandW = new Set(words(c.brand || e.brand || '')), common = commonOf(corpus, names), aboutW = new Set(words([c.title, claim, c.make?.pieces].filter(Boolean).join(' ')).filter((w) => !brandW.has(w) && !common.has(w) && !/^\d/.test(w)));
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
    note = needs.length ? `We can’t see your ${metric.what} yet, so this part is a guess. Connect ${needs.map((id) => CONNECTOR_NAMES[id] || id).join(' or ')} to check it.`
      : `We haven’t matched this to your ${metric.what} yet, so treat that part as a guess.`;
  } else if (searchClaim && !backing.some((x) => x.kind === 'trend' || x.kind === 'read' || /search|keyword|volume|google|people also ask|ai answer|quer(?:y|ies)/i.test(`${x.label} ${x.src}`))) note = 'The card says people search for this, but we haven’t kept the search numbers that show it. Treat it as a guess until you see them.';
  else if (voiceClaim && !voiceIn.length) note = 'The card says customers are saying this, but we haven’t found the reviews or posts that show it. Treat it as a guess until you see them.';
  else if (voiceClaim && DOUBT_RE.test(seen) && voiceIn.length && voiceIn.every((x) => x.kind === 'voice' && starsOf(x) >= 4)) {
    const n = voiceIn.length; note = `The card says people doubt this, but what we found is praise: ${['', 'a', 'two', 'three', 'four', 'five'][n] || n} ${voiceIn.every((x) => starsOf(x) === 5) ? '5★' : 'happy'} review${n > 1 ? 's' : ''}. Use ${n > 1 ? 'them' : 'it'} as proof that it works, not as the problem.`; }
  const sourced = backing.filter((x) => x.url || x.kind === 'account' || x.kind === 'team').length;
  return { ...e, items: backing, context, claim: { voice: voiceClaim, metric: metric && !accountIn ? metric.what : null, metricNeeds, note, needs }, count: backing.length, sourced,
    strength: note ? 'thin' : sourced >= 2 ? 'strong' : backing.length ? 'some' : 'thin' };
}

/* the accounts a card needs before Brew can show it for real, not yet connected (QA FEED-ARV-07: a Signals card says so on the card).
   First what its claim rests on (refine: claim.needs, what the proof sheet names); else a Signals card about people to reach (buyers,
   subscribers, checkouts, orders) rests on the store, the same source the deck's Signals guide asks for first. Cards from online talk,
   from the team or from a connected account need nothing. */
const PEOPLE = /\b(buyers?|customers?|subscribers?|shoppers?|checkout starters|abandoned (?:carts?|checkouts?)|carts?|reorders?|repeat (?:buyers|customers|orders)|first[- ]time buyers|lapsed|win[- ]?back|cancel\w*)\b/i;
export function cardNeeds(c = {}, claimNeeds = [], { has = () => true, connected = () => false } = {}) {
  const open = (ids) => [...new Set(ids)].filter((id) => has(id) && !connected(id));
  const fromClaim = open(claimNeeds || []); if (fromClaim.length) return fromClaim;
  if (c.sector !== 'signals' || c.origin === 'listen' || c.origin === 'told' || c.stream === 'heard' || /^(live-|lv-|heard-|told-|build-)/.test(String(c.id || ''))) return [];
  return PEOPLE.test(String(c.title || '')) ? open(['shopify']) : []; /* the title says who: the card is about a group of the brand's own people */
}
