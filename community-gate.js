// Community gate: which public threads and questions Brew may point a brand at, for ANY brand (every brand onboarded later too).
// One rule set for every place that suggests replying or posting in a community: ideas.js (the ideas stream), social-feed.js
// (the "asked in r/x, reply as the brand" cards, and saved ideas healed at load). Nothing here is per brand.
//   fresh    a reply goes to a thread active in the last REPLY_DAYS (a reply weeks later is read by nobody); Quora questions
//            are evergreen (answers rank on Google for years), so they need no date
//   market   the community is not named for a country outside the brand's markets ("r/Nepal_Skincare" for an Indian brand),
//            and in English-speaking markets a thread outside a home-market community is in English
//   counted  reply counts are the platform's own (redditStats): a count Brew could not read is unknown (null), never 0
//   bar      a Reddit thread (a creator's video or a rival's own post is not a community), close enough to the brand, that asks
//            something (a question, a comparison, a complaint) or names the brand
//   matches  a reply idea is about what the thread asked: its title and copy share real words with the thread
export const REPLY_DAYS = 14;
const DAY = 864e5;

/* places a community can be named for. Country and big-city names only: demonyms that are also breeds, foods or styles
   (French bulldog, German shepherd, Korean skincare, Dutch oven, Irish setter) are left out on purpose */
const PLACES = {
  IN: ['india', 'bharat', 'desi', 'bangalore', 'bengaluru', 'mumbai', 'bombay', 'delhi', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad', 'gurgaon', 'gurugram', 'noida', 'kerala', 'karnataka', 'maharashtra', 'gujarat', 'tamilnadu', 'telangana', 'punjab', 'jaipur', 'kochi', 'indore', 'lucknow', 'chandigarh'],
  PK: ['pakistan', 'karachi', 'lahore', 'islamabad'], BD: ['bangladesh', 'dhaka'], NP: ['nepal', 'kathmandu'], LK: ['srilanka', 'colombo'],
  US: ['unitedstates', 'usa', 'nyc', 'newyork', 'losangeles', 'chicago', 'texas', 'california', 'florida', 'seattle', 'boston', 'atlanta'],
  GB: ['unitedkingdom', 'britain', 'england', 'scotland', 'wales', 'london', 'manchester', 'glasgow', 'birmingham', 'edinburgh'],
  IE: ['ireland', 'dublin'], AU: ['australia', 'aussie', 'sydney', 'melbourne', 'brisbane', 'perth'], NZ: ['newzealand', 'auckland'],
  CA: ['canada', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa'], SG: ['singapore'], MY: ['malaysia', 'kualalumpur'],
  PH: ['philippines', 'pinoy', 'manila'], ID: ['indonesia', 'jakarta'], TH: ['thailand', 'bangkok'], VN: ['vietnam'],
  AE: ['dubai', 'abudhabi', 'emirates', 'uae'], SA: ['saudi', 'riyadh'], QA: ['qatar', 'doha'],
  DE: ['germany', 'deutschland', 'berlin', 'munich', 'hamburg'], FR: ['france', 'paris'], IT: ['italy', 'italia', 'milano', 'rome'],
  ES: ['spain', 'espana', 'madrid', 'barcelona'], PT: ['portugal', 'lisbon', 'lisboa'], NL: ['netherlands', 'nederland', 'amsterdam'],
  BE: ['belgium', 'belgie', 'brussels'], CH: ['switzerland', 'schweiz', 'zurich'], AT: ['austria', 'osterreich', 'vienna', 'wien'],
  SE: ['sweden', 'sverige', 'stockholm'], NO: ['norway', 'norge', 'oslo'], DK: ['denmark', 'danmark', 'copenhagen'], FI: ['finland', 'suomi', 'helsinki'],
  PL: ['poland', 'polska', 'warsaw', 'warszawa'], CZ: ['czech', 'cesko', 'prague', 'praha'], SK: ['slovakia', 'slovensko', 'bratislava'],
  HU: ['hungary', 'magyar', 'budapest'], RO: ['romania', 'bucharest', 'bucuresti'], BG: ['bulgaria', 'sofia'], GR: ['greece', 'athens'],
  HR: ['croatia', 'hrvatska', 'zagreb'], RS: ['serbia', 'srbija', 'belgrade'], UA: ['ukraine', 'kyiv'], TR: ['turkey', 'turkiye', 'istanbul'],
  IL: ['israel', 'telaviv'], EG: ['egypt', 'cairo'], ZA: ['southafrica', 'johannesburg', 'capetown'], NG: ['nigeria', 'lagos'], KE: ['kenya', 'nairobi'],
  BR: ['brasil', 'brazil', 'saopaulo'], MX: ['mexico'], AR: ['argentina', 'buenosaires'], CL: ['chile', 'santiago'], CO: ['colombia', 'bogota'],
  JP: ['japan', 'nihon', 'tokyo', 'osaka'], CN: ['china', 'beijing', 'shanghai'], HK: ['hongkong'], TW: ['taiwan', 'taipei']
};
/* two-letter codes a subreddit name carries as its own word: "WomenRO", "AskUK", "beauty_au", "CasualUK" */
const CODES = { UK: 'GB', GB: 'GB', RO: 'RO', AU: 'AU', NZ: 'NZ', CA: 'CA', IE: 'IE', SG: 'SG', PH: 'PH', MY: 'MY', PK: 'PK', NP: 'NP', BD: 'BD', LK: 'LK',
  DE: 'DE', FR: 'FR', ES: 'ES', NL: 'NL', PL: 'PL', CZ: 'CZ', HU: 'HU', SE: 'SE', DK: 'DK', FI: 'FI', NO: 'NO', PT: 'PT', GR: 'GR', HR: 'HR', BG: 'BG', SK: 'SK', ZA: 'ZA', NG: 'NG', KE: 'KE', BR: 'BR', MX: 'MX', AE: 'AE', IN: 'IN', US: 'US' };
const PLACE_RE = Object.entries(PLACES).map(([cc, xs]) => [cc, new RegExp(xs.join('|'))]);
/* markets that read and write in English (a thread in another language there is somebody else's conversation) */
const ENGLISH = new Set(['IN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE', 'SG', 'AE', 'PH', 'MY', 'ZA', 'NG', 'KE', 'PK', 'BD', 'LK', 'NP', 'GG', 'JE', 'IM', 'GH', 'HK']);
const STOP = new Set('the and is to a of for in it i my you this that with on have what how any can be are was do does should which or but not me so if they them their there your an at by from as just about would anyone help need want best good use using get got has had been really one more some like'.split(' '));

/* the communities a thread lives in: "r/Nepal_Skincare" → ['NP'] (empty when it names no place) */
export function placesOf(sub) {
  const raw = String(sub || '').replace(/^\/?r\//i, '').trim(); if (!raw) return [];
  const low = raw.toLowerCase().replace(/[^a-z]/g, ''), out = new Set();
  for (const [cc, re] of PLACE_RE) if (re.test(low)) out.add(cc);
  // its own words: camelCase humps, underscores and digits split it ("WomenRO" → Women, RO; "beauty_au" → beauty, au)
  const parts = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_\-\d]+/).filter(Boolean);
  if (parts.length > 1) for (const p of parts) { const cc = CODES[p.toUpperCase()]; if (p.length === 2 && cc) out.add(cc); }
  if (/^uk[a-z]{4,}/.test(raw)) out.add('GB'); /* "ukpersonalfinance", "ukbeauty" */
  return [...out];
}
/* the brand's markets: the selling market first, then the others the read found. Empty when unknown (then no market check) */
export const marketsOf = (profile) => { const p = profile || {}; return [...new Set([p.country || p.market?.primary, ...(Array.isArray(p.markets) ? p.markets : []), ...(Array.isArray(p.market?.others) ? p.market.others : [])].filter(Boolean).map((x) => String(x).toUpperCase()))]; };
/* English or not, from its words: under 4% of the words in the commonest English words, with at least 8 words, is another language */
export function looksEnglish(text) {
  const s = String(text || ''); if (!s.trim()) return true;
  const letters = s.match(/\p{L}/gu) || []; if (letters.length >= 12 && letters.filter((c) => /[a-z]/i.test(c)).length / letters.length < 0.7) return false;
  const w = s.toLowerCase().match(/[a-z']+/g) || []; if (w.length < 8) return true;
  return w.filter((x) => STOP.has(x)).length / w.length >= 0.04;
}
/* is this community in the brand's market? { ok, why } — unknown markets pass */
export function inMarket(t, profile) {
  const mk = marketsOf(profile); if (!mk.length) return { ok: true };
  const sub = t?.sub || (String(t?.where || '').match(/^r\/[^\s:]+/) || [])[0] || (String(t?.url || '').match(/\/r\/([^/]+)/) || [])[1] || '';
  const pl = placesOf(sub);
  if (pl.length && !pl.some((cc) => mk.includes(cc))) return { ok: false, why: `a community for ${pl.join('/')}, outside ${mk.join('/')}` };
  if (!pl.length && mk.every((cc) => ENGLISH.has(cc)) && (t?.lang ? !/^en\b/i.test(t.lang) : !looksEnglish(`${t?.title || ''} ${t?.text || t?.quote || ''}`))) return { ok: false, why: 'not in English' }; /* Reddit's own language code when read, else the words */
  return { ok: true };
}

/* when a thread was last active, in ms (listening keeps lastActive; a search result has its post date) */
export function lastActiveOf(t) {
  const xs = [t?.lastActive, t?.postedAt, t?.createdAt, t?.at, t?.created_utc && t.created_utc * 1e3].map((v) => typeof v === 'number' ? (v < 1e12 ? v * 1e3 : v) : Date.parse(v || '')).filter((v) => v > 0);
  return xs.length ? Math.max(...xs) : 0;
}
export const freshThread = (t, now = Date.now(), days = REPLY_DAYS) => { const at = lastActiveOf(t); return !!at && now - at <= days * DAY; };
/* a Quora question page (not a profile, a space or a topic) */
export const isQuoraQuestion = (url) => /^https?:\/\/(www\.)?quora\.com\/(?!profile\/|topic\/|search|q\/|unanswered\/|answer\/|spaces?\/)[A-Za-z0-9][^/?#]{10,}\/?$/.test(String(url || '')) && !/\/answers?\//.test(String(url));

/* a reply target any brand may be pointed at: { ok, why[] }. Pass rel (the caller's relevance score) to hold the bar */
export function usableThread(t, { now = Date.now(), profile = {}, minRel = 3, rel = null, quora = false, brand = '' } = {}) {
  const why = [];
  if (!t?.url) return { ok: false, why: ['no link'] };
  if (!quora && !/reddit\.com\/r\//i.test(t.url)) return { ok: false, why: ['not a community thread (a post on a profile, a channel or a rival\'s own page)'] };
  if (!quora && !asks(t) && !names(t, brand)) why.push('asks nothing and does not name the brand');
  if (!quora && !freshThread(t, now)) why.push(`last active ${lastActiveOf(t) ? Math.round((now - lastActiveOf(t)) / DAY) + ' days ago' : 'on an unknown date'} (replies go to threads active in the last ${REPLY_DAYS} days)`);
  const m = inMarket(t, profile); if (!m.ok) why.push(m.why);
  if (t.locked || t.archived || t.removed) why.push('closed to replies');
  if (/\b(buy|sell|wts|wtb)\b/i.test(t.title || '') || dealsBoard(t.sub || t.where)) why.push('a buy/sell, deals or replica board');
  if (rel != null && rel < minRel) why.push(`not close enough to the brand (score ${rel} < ${minRel})`);
  return { ok: !why.length, why };
}

/* the thread asks something a brand can answer: a question mark, or listening read it as a question, comparison or complaint */
export const asks = (t) => /\?/.test(`${t?.title || ''} ${t?.text || t?.quote || ''}`) || ['question', 'compare', 'complaint'].includes(t?.intent);
/* it names the brand: listening tagged it so, or the name is in its words */
const names = (t, brand) => t?.about === 'brand' || (!!brand && new RegExp(`(^|[^a-z0-9])${String(brand).toLowerCase().replace(/[^a-z0-9]+/g, '[^a-z0-9]?')}([^a-z0-9]|$)`).test(`${t?.title || ''} ${t?.text || t?.quote || ''}`.toLowerCase()));
/* a reply idea is about its thread: the idea's title and copy share at least two real words with the thread's title and post */
const content = (s) => new Set((String(s || '').toLowerCase().match(/[a-z][a-z']{2,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, '')));
export function matchesThread(idea, thread) {
  const tw = content(`${thread?.title || ''} ${thread?.text || thread?.quote || ''}`); if (!tw.size) return true; /* nothing to compare with */
  const iw = content(`${idea?.title || ''} ${idea?.hook || ''} ${idea?.copy || ''}`);
  let n = 0; for (const w of iw) if (tw.has(w)) n++;
  const titleHit = [...content(idea?.title)].some((w) => tw.has(w));
  return n >= 2 && titleHit;
}

/* Reddit's own numbers for threads: replies, post date, closed or removed. Free first (PullPush: the count when it was
   archived, a floor), then the live count through treg (one call per thread, 24-hour cache) for the few that will be
   shown. A thread neither could read keeps comments null and statsError: never 0 */
export async function redditStats(threads, { treg = null, fetchImpl = fetch, paid = 6, log = console } = {}) {
  const ids = [...new Set((threads || []).map((t) => t && idOf(t.url)).filter(Boolean))]; const out = new Map();
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const r = await fetchImpl(`https://api.pullpush.io/reddit/search/submission/?ids=${ids.slice(i, i + 50).join(',')}&size=50`, { signal: AbortSignal.timeout(20e3) });
      if (!r.ok) throw new Error(`pullpush ${r.status}`);
      for (const x of (await r.json())?.data || []) out.set(x.id, { comments: x.num_comments ?? null, floor: true, createdAt: (x.created_utc || 0) * 1e3 || null, locked: !!x.locked, archived: !!x.archived, removed: !!(x.removed_by_category || x.selftext === '[removed]'), over18: !!x.over_18 });
    }
  } catch (e) { log.warn?.('[community] pullpush', e.message); }
  if (treg && treg.live !== false) for (const id of ids.slice(0, paid)) {
    try { const j = await treg.call('tikhub.x.reddit-app-fetch-post-details', { query: { post_id: `t3_${id}`, include_comment_id: false, need_format: false }, tag: 'community:reddit-stats' });
      const p = findPost(j); if (!p) continue;
      const n = num(p, /^(num_?comments|comment_?count|commentCount|comments_count|numComments)$/i);
      const was = out.get(id) || {};
      const lang = typeof p.languageCode === 'string' ? p.languageCode : typeof p.lang === 'string' ? p.lang : null;
      out.set(id, { ...was, comments: n ?? was.comments ?? null, floor: n == null ? was.floor : false, locked: bool(p, /^(locked|isLocked|is_locked)$/i) ?? was.locked, archived: bool(p, /^(archived|isArchived|is_archived)$/i) ?? was.archived,
        removed: (bool(p, /^(isRemoved|is_removed|removed)$/i) ?? false) || !!p.removedByCategory || !!p.removed_by_category || !!was.removed, createdAt: Date.parse(p.createdAt || '') || was.createdAt || null, ...(lang ? { lang } : {}) });
    } catch (e) { log.warn?.('[community] reddit stats', id, e.message); }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { comments: null, statsError: 'Reddit did not answer; the count is unknown' });
  return out;
}
export const idOf = (url) => (String(url || '').match(/\/comments\/([a-z0-9]+)/i) || [])[1] || null;
/* the post object somewhere in a provider's answer, and a field in it by name (providers nest and name them differently) */
function findPost(j, d = 0) { if (!j || typeof j !== 'object' || d > 6) return null; if (Object.keys(j).some((k) => /^(num_?comments|comment_?count|commentCount|numComments)$/i.test(k))) return j; for (const v of Object.values(j)) { const r = findPost(v, d + 1); if (r) return r; } return null; }
function num(o, re) { for (const [k, v] of Object.entries(o)) if (re.test(k) && Number.isFinite(+v) && v !== null && v !== '') return +v; return null; }
function bool(o, re) { for (const [k, v] of Object.entries(o)) if (re.test(k) && typeof v === 'boolean') return v; return null; }
/* stats onto a thread: the real count (or null), closed flags, and the post date when the thread had none */
export function withStats(t, s) {
  if (!s) return t;
  return { ...t, comments: s.comments ?? null, ...(s.floor ? { commentsFloor: true } : {}), ...(s.statsError ? { statsError: s.statsError } : {}), ...(s.locked ? { locked: true } : {}), ...(s.archived ? { archived: true } : {}), ...(s.removed ? { removed: true } : {}), ...(s.lang ? { lang: s.lang } : {}), ...(s.createdAt && !t.at ? { at: new Date(s.createdAt).toISOString().slice(0, 10) } : {}) };
}
/* how a reply count reads on a card: the real number, "at least N" for an archive floor, nothing when unknown */
export const repliesText = (n, floor = false) => n == null || (floor && !n) ? '' : floor ? `${n}+ repl${n === 1 ? 'y' : 'ies'}` : `${n} repl${n === 1 ? 'y' : 'ies'}`;

/* ---------- communities: where a brand may post, for ANY brand ----------
   A community a brand posts in is a Reddit community about its category (or that talks about the brand or its rivals), in its
   market, not a deals, swap or replica board, not a general-chat community (r/AskReddit, r/AmItheAsshole, a city's own sub). */
/* deals, swaps, trades and replicas: a sub's name runs its words together ("SneakersOfferIndia", "RepsneakersDogs") */
export const dealsBoard = (sub) => { const s = String(sub || '').replace(/^\/?r\//i, '').toLowerCase().replace(/[^a-z]/g, ''); return !!s && (/buysell|marketplace|deal|offer|coupon|loot|giveaway|freebie|exchange|swap|forsale|trade|bst$|replica|fashionrep|repladies|reps$/.test(s) || /^reps?(?=[a-z]{4})/.test(s)); };
/* general chat: big communities about everything, where a brand's post is off-topic by the rules */
const GENERIC = new Set(['askreddit', 'amitheasshole', 'aitah', 'aita', 'nostupidquestions', 'tooafraidtoask', 'explainlikeimfive', 'todayilearned', 'pics', 'funny', 'memes', 'dankmemes', 'news', 'worldnews', 'casualconversation',
  'relationship_advice', 'relationships', 'offmychest', 'trueoffmychest', 'unpopularopinion', 'mildlyinfuriating', 'rant', 'confession', 'teenagers', 'showerthoughts', 'lifeprotips', 'outoftheloop', 'changemyview', 'tifu',
  'jokes', 'videos', 'gaming', 'movies', 'music', 'technology', 'interestingasfuck', 'damnthatsinteresting', 'nextfuckinglevel', 'facepalm', 'wholesomememes', 'me_irl', 'meirl', 'indiaspeaks', 'indiasocial',
  'indiancasualconversation', 'askindia', 'twentiesindia', 'teenindia', 'desimemes', 'indiandankmemes', 'askuk', 'casualuk', 'unitedkingdom', 'askanamerican', 'askeurope', 'europe', 'australia', 'canada', 'india',
  'popular', 'all', 'bestof', 'iama', 'askmen', 'askwomen', 'twoxchromosomes', 'mademesmile', 'aww', 'oddlysatisfying', 'whatisthisthing', 'antiwork', 'collegerant', 'genz', 'millennials', 'teenagersbuthot']);
const STEM_STOP = new Set(['best', 'good', 'buy', 'online', 'review', 'reviews', 'brand', 'brands', 'product', 'products', 'cheap', 'price', 'store', 'shop', 'near', 'with', 'from', 'that', 'this', 'what', 'which', 'your', 'free', 'natural', 'organic', 'premium', 'new', 'india', 'indian']);
/* the words a community about this category would carry in its name: "curly hair products India" → curl, hair */
export function topicStems({ noun = '', terms = [], products = [] } = {}) {
  const out = new Set();
  for (const s of [noun, ...terms, ...products].flat()) for (let w of String(s || '').toLowerCase().replace(/["']/g, '').match(/[a-z]{4,}/g) || []) {
    if (STEM_STOP.has(w) || Object.values(PLACES).some((xs) => xs.includes(w))) continue;
    w = w.replace(/(ies)$/, 'y').replace(/(ing|es|s)$/, '').replace(/y$/, ''); if (w.length >= 4) out.add(w); }
  return [...out];
}
/* a community a brand may post in: { ok, why[] }. m: { name|sub, url, weekly, brand, rival, category, threads, desc } */
export function usableCommunity(m, { profile = {}, stems = null, minWeekly = 1000 } = {}) { /* stems null: the topic is not checked (a saved idea at load) */
  const sub = String(m?.sub || m?.name || '').replace(/^\/?r\//i, ''), low = sub.toLowerCase(), why = [];
  if (!sub || !/reddit\.com\/r\//i.test(m?.url || `https://www.reddit.com/r/${sub}/`)) return { ok: false, why: ['not a Reddit community'] };
  if (/^u_/.test(low)) return { ok: false, why: ['a person’s profile'] };
  if (dealsBoard(sub)) why.push('a deals, swap or replica board');
  if (GENERIC.has(low)) why.push('a general-chat community');
  const pl = placesOf(sub), rest = PLACE_RE.reduce((x, [, re]) => x.replace(new RegExp(re.source, 'g'), ''), low.replace(/[^a-z]/g, ''));
  if (pl.length && rest.length < 4) why.push('a place’s own community, not about the category');
  const mk = marketsOf(profile); if (mk.length && pl.length && !pl.some((cc) => mk.includes(cc))) why.push(`a community for ${pl.join('/')}, outside ${mk.join('/')}`);
  if (m?.nsfw || m?.over18) why.push('marked adult');
  if (m?.weekly != null && m.weekly < minWeekly) why.push(`small (${m.weekly} weekly visitors)`);
  const named = !stems || stems.some((w) => low.includes(w) || String(m?.desc || '').toLowerCase().includes(w));
  const talk = (m?.brand || 0) * 2 + (m?.rival || 0) + (m?.category || 0);
  if (!named && !(talk >= 4 && (m?.threads || 0) >= 2)) why.push('not about the category (its name does not say so and little of its talk is)');
  return { ok: !why.length, why };
}
/* communities from Reddit's search box (treg tikhub typeahead): [{ name, url, weekly, nsfw }] */
export function typeaheadCommunities(j) {
  const out = [], walk = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 14) return; if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1));
    if (o.__typename === 'TypeaheadSuggestion') { const b = o.behaviors?.default || {}, name = b.name || String(o.presentation?.name || '').replace(/^r\//, ''), sr = b.telemetry?.trackingContext?.subreddit || {};
      if (name && b.__typename === 'SearchCommunityNavigationBehavior') out.push({ name: `r/${name}`, sub: name, url: `https://www.reddit.com/r/${name}/`, weekly: visitors(o.presentation?.description), nsfw: !!(sr.isNsfw || sr.isQuarantined) }); return; }
    for (const v of Object.values(o)) walk(v, d + 1); };
  walk(j); return out;
}
/* "121K weekly visitors" → 121000 */
export const visitors = (s) => { const m = /([\d.,]+)\s*([KkMm]?)\s*weekly/.exec(String(s || '')); if (!m) return null; const n = parseFloat(m[1].replace(/,/g, '')); return Math.round(n * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1)); };
