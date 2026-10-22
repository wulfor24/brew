// The store health rings (Creative, Storefront, AI answers) and the score on the feed's health card, from public data only,
// with the source of every part:
//   Creative:   the brand's own live ads in the Meta Ad Library (volume against its rivals, hook variety, formats; at most 85)
//   Storefront: Google PageSpeed (mobile), the checkout walk, photos per product, reviews on the site
//   AI answers: the real answers of the AI tools that answered in the read (the weekly check replaces it when newer)
// A part that could not be read is left out, never scored as zero, and a ring with nothing read is shown as not read and
// kept out of the score. Conversion, spend and cost per order need the brand's own accounts; the score never guesses them.
// The counts come from pack-numbers.js, so the rings quote the same numbers as every other screen.
import { numbersOf } from './pack-numbers.js';
import { standFromRead, standFromRun } from './ai-standing.js';
import { CLOSED_WHY } from './reader/closed.js';

export const HEALTH_V = 'real-4'; /* 4: each part says when it was checked, and what changed since the last score (QA FEED-QA-18) */ // bump when a ring is scored differently: every brand's score is worked out again at load (brand-pack.js)
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const fmt = (n) => Number(n).toLocaleString('en-US');
/* the walk reached the checkout page (siteFailed in reader/index.js reads it the same way) */
const reachedOf = (co = {}) => !co.error && (co.walk || []).some((s) => s.step === 'Checkout entry' && s.ok);
const MKT = /amazon|flipkart|nykaa|myntra|walmart|target|etsy|ebay|blinkit|zepto|meesho|purplle|tira|google/i;
/* the reviews stage failed or timed out and read nothing: its part is left out (never 0 of 15), and the ring says so */
const reviewsErr = (p = {}) => !(p.reviews?.platforms || []).length && p.reviews?.total == null && (p.reviews?.error || p.meta?.errors?.reviews) || null;

/* the inputs a ring reads: a saved score whose key differs is worked out again at load, so it never quotes an old read */
export function healthKey(N, p = {}) {
  const co = p.site?.checkout || {}, ps = p.site?.pagespeed || {};
  return [N.ownAds.n ?? (N.ownAds.error ? 'err' : '-'), `${N.rivalAds.n}/${N.rivalAds.read}`, `${N.ai.named ?? '-'}/${N.ai.of ?? '-'}`, N.products.n ?? '-',
    co.v ? `${reachedOf(co) ? 1 : 0}${co.clicks ?? ''}${co.guest ?? ''}${(co.payments || []).length}` : '-', ps.score ?? (ps.error ? 'err' : '-'), p.reviews?.total ?? (reviewsErr(p) ? 'err' : '-'), p.ads?.at || '-', p.ai?.named?.at || '-'].join('|'); /* named: the brands-named pass landed (ai-standing.js) */
}

/* Google PageSpeed for the home page, as a phone. Free, but it needs an API key (keyless calls get 429). A failure is kept as { error }, never a score */
export async function pageSpeed(url, { key = process.env.PAGESPEED_API_KEY, fetchImpl = fetch, log = console } = {}) {
  const at = new Date().toISOString().slice(0, 10);
  try {
    const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${key ? `&key=${key}` : ''}`;
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(90e3) }); if (!r.ok) throw new Error('pagespeed ' + r.status);
    const j = await r.json(), L = j.lighthouseResult || {}, a = L.audits || {}, s = L.categories?.performance?.score;
    if (s == null) throw new Error('pagespeed: no performance score');
    return { score: Math.round(s * 100), lcp: a['largest-contentful-paint']?.displayValue || null, tbt: a['total-blocking-time']?.displayValue || null, cls: a['cumulative-layout-shift']?.displayValue || null, at, url };
  } catch (e) { log.warn?.('[health] pagespeed', url, e.message); return { error: e.message, at, url }; }
}

/* a new PageSpeed reading over the last one (QA FEED-QA-18: Storefront jumped 100 ↔ 80 when a check failed, then came back):
   a failed check keeps the last good score with its own date and carries the failure beside it (error, triedAt), so the ring
   never drops a part it read before; a new score says what it was before (was) */
export function keepSpeed(prev, next) {
  if (!next) return prev || null;
  if (next.error) return prev?.score != null ? { ...prev, error: next.error, triedAt: next.at || null } : next;
  return prev?.score != null && prev.score !== next.score ? { ...next, was: { score: prev.score, at: prev.at || null } } : next;
}
const dayOf = (at) => { const d = at ? new Date(at) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null; };

function creative(p, N, fix) {
  const own = N.ownAds, items = p.ads?.own?.items || [], live = own.n, adsAt = p.ads?.at || p.meta?.readAt || null;
  if (live == null) return { k: 'Creative', v: 0, read: false, what: own.error || p.meta?.errors?.ads ? 'Your ads couldn’t be read this time; the next refresh tries again' : 'Not read yet', parts: [], src: 'Meta Ad Library' }; /* a whole ads stage that failed is not "not read yet" */
  if (!live) { fix.push(['Creative', `No live ads were found in the Meta Ad Library for ${own.page || p.name || 'this brand'}.`]);
    return { k: 'Creative', v: 0, read: true, what: `No live ads in the Meta Ad Library${own.page ? ` for ${own.page}` : ''}`, parts: [{ k: 'Live ads', v: 0, of: 100, note: '0 live' }], src: 'Meta Ad Library' }; }
  /* public ads show activity, not results: volume against the brand's own rivals, how many different hooks it tests and
     the format mix. At most 85 from public data; the rest needs results from a connected ad account */
  const rl = (p.ads?.rivals || []).filter((r) => !r.error && r.live != null).map((r) => +r.live).sort((a, b) => a - b), med = rl.length ? rl[Math.floor(rl.length / 2)] : null;
  const hooks = new Set(items.map((x) => String(x.hook || x.body || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)).filter((h) => h.length > 3)), variety = items.length >= 4 ? hooks.size / items.length : null;
  const isVid = (x) => x.format === 'video' || !!x.video, vid = items.some(isVid), img = items.some((x) => !isVid(x));
  const parts = [['Volume', Math.min(live / Math.max(med ?? 20, 10), 1) * 30, 30, med != null ? `${fmt(live)} live against a rival median of ${fmt(med)}` : `${fmt(live)} live, full marks at 20`]];
  if (variety != null) parts.push(['Hook variety', variety * 30, 30, `${hooks.size} different hooks in the ${items.length} newest ads`]);
  if (items.length) parts.push(['Formats', vid && img ? 25 : 12, 25, vid && img ? 'video and image' : vid ? 'video only' : 'image only']);
  const got = parts.reduce((a, x) => a + x[1], 0), max = parts.reduce((a, x) => a + x[2], 0);
  if (variety != null && variety < 0.5) fix.push(['Creative', `The ${items.length} newest ads use only ${hooks.size} different hooks. Test more angles, not more copies.`]);
  if (med != null && live < med / 2) fix.push(['Creative', `${fmt(live)} live ads against a rival median of ${fmt(med)}. Rivals are testing far more.`]);
  else if (live < 10) fix.push(['Creative', `${live} live ad${live === 1 ? '' : 's'} is too few to learn from. Test more angles each week.`]);
  return { k: 'Creative', v: clamp((got / max) * 85), read: true, what: `From your ${fmt(live)} live ads: volume, hooks, formats (up to 85 from public data)`,
    parts: parts.map(([k, v, of, note]) => ({ k, v: Math.round(v), of, note, at: adsAt })), src: 'Meta Ad Library', at: adsAt }; /* when the ads were read: every ring row says when it was checked, not only Storefront's (final QA pass 19 Oct, FEED-QA-18) */
}

function storefront(p, fix) {
  const prods = p.catalog?.products || [], co = p.site?.checkout || {}, ps = p.site?.pagespeed, sp = [];
  const readAt = p.meta?.readAt || null;
  if (ps && ps.score != null) { sp.push(['Mobile speed', ps.score * 0.35, 35, `PageSpeed ${ps.score} of 100${ps.lcp ? `, main image at ${ps.lcp}` : ''}${ps.was?.score != null ? ` (was ${ps.was.score}${dayOf(ps.was.at) ? ` on ${dayOf(ps.was.at)}` : ''})` : ''}${ps.error ? '; the newest check didn’t go through, so this is the last good one' : ''}`, ps.at || null]);
    if (ps.score < 50) fix.push(['Storefront', `Mobile PageSpeed is ${ps.score} of 100${ps.lcp ? `; the main image shows at ${ps.lcp}` : ''}. Speed up the first screen.`]); }
  /* the walk: only what it actually saw counts. A walk that stopped early, or a checkout app that loads after the walk
     (GoKwik, opened by /checkout), is left out, never scored as a no */
  /* a brand that sells by enquiry: the walk to its enquiry form, and its Google reviews, stand in for a checkout and site reviews */
  const enquiry = p.storeKind === 'enquiry';
  if (enquiry && co.kind === 'enquiry' && co.reached) { sp.push(['Reaching the enquiry form', (co.clicks ?? 9) <= 1 ? 15 : 10, 15, `${co.clicks ? `${co.clicks} click${co.clicks === 1 ? '' : 's'}` : 'on the home page'}; asks for ${(co.fields || []).join(', ') || 'a few details'}`, co.at || readAt]);
    if ((co.fields || []).length > 5) fix.push(['Storefront', `The enquiry form asks for ${co.fields.length} things. Ask for a name and a phone number first; the rest can wait for the call.`]); }
  const reached = !enquiry && reachedOf(co), seen = reached && !co.direct;
  if (reached) sp.push(['Reaching checkout', 10 + ((co.clicks ?? 9) <= 2 ? 5 : 0), 15, `reached in ${co.clicks ?? '?'} click${co.clicks === 1 ? '' : 's'} from the product page`, co.at || readAt]);
  if (seen && co.guest != null) { sp.push(['Guest checkout', co.guest ? 10 : 0, 10, co.guest ? 'offered' : 'login first', co.at || readAt]); if (!co.guest) fix.push(['Storefront', 'The walk was asked to log in before checkout. Let people buy as a guest.']); }
  const pay = co.payments || []; if (seen && pay.length) sp.push(['Payment options', pay.length >= 3 ? 10 : 5, 10, `${pay.length} seen: ${pay.slice(0, 4).join(', ')}`, co.at || readAt]);
  if (prods.length && !enquiry) { const photos = prods.reduce((a, x) => a + (x.images?.length || 0), 0) / prods.length, thin = prods.filter((x) => (x.images?.length || 0) <= 1).length;
    sp.push(['Photos per product', Math.min(photos / 4, 1) * 15, 15, `${photos.toFixed(1)} on average over ${prods.length} product${prods.length === 1 ? '' : 's'}`, readAt]);
    if (thin) fix.push(['Storefront', `${thin} product${thin === 1 ? ' has' : 's have'} one photo or none. Add angles so shoppers and catalog ads can trust them.`]); }
  /* reviews on the brand's own site only: marketplace reviews are not on the store */
  const pl = p.reviews?.platforms || [], onSite = pl.filter((x) => !MKT.test(x.name || '')), rv = pl.length ? onSite.reduce((a, x) => a + (+x.count || 0), 0) : +p.reviews?.total || 0;
  const rvErr = reviewsErr(p);
  /* a closed store (Shopify's password page): the speed, the walk and the site's reviews can't be read yet, so they are left out
     and the ring says why (reader/stages/admin.js), never "no reviews on the site" */
  const closed = !!p.closed;
  /* reviews the store switched off are its choice, not a gap: left out of the score, with the marketplace ratings named */
  const off = p.reviews?.onSite === 'off', unread = p.reviews?.onSite === 'unread' && !closed;
  const gm = enquiry ? pl.find((x) => /google/i.test(x.name || '')) : null;
  if (gm) sp.push(['Google reviews', (gm.count || 0) >= 100 && (gm.rating || 0) >= 4.2 ? 15 : (gm.count || 0) > 0 ? 8 : 0, 15, `${fmt(gm.count || 0)}${gm.rating ? ` at ${gm.rating.toFixed(1)}★` : ''}`, readAt]);
  else if (p.reviews && !rvErr && !off && !unread && !enquiry && !(closed && p.reviews.closed && !rv)) { sp.push(['Reviews on the site', rv >= 100 ? 15 : rv > 0 ? 8 : 0, 15, rv ? `${fmt(rv)} on the site${pl.some((x) => MKT.test(x.name || '')) ? ' (marketplaces not counted)' : ''}` : 'no reviews on the site', readAt]);
    if (!rv) fix.push(['Storefront', 'No reviews were found on the site. Ask for one after delivery.']); }
  const closedWhat = closed ? `the checkout walk, page speed and site reviews wait: ${CLOSED_WHY}` : off ? `reviews are switched off on the site${pl.length ? ` (read on ${pl.map((x) => x.name).join(', ')})` : ''}` : unread ? `${p.reviews.app || 'the review app'} couldn’t be read this time, the next refresh tries again` : null;
  if (!sp.length) return { k: 'Storefront', v: 0, read: false, what: closed ? `Not checked: ${CLOSED_WHY}. Brew checks once the store opens` : rvErr || p.meta?.errors?.site ? 'The store couldn’t be read this time; the next refresh tries again' : 'Not read yet', parts: [], src: 'the site read' };
  const got = sp.reduce((a, x) => a + x[1], 0), max = sp.reduce((a, x) => a + x[2], 0);
  return { k: 'Storefront', v: clamp((100 * got) / max), read: true, what: `From ${p.host || 'your store'}: ${sp.map((x) => x[0].toLowerCase()).join(', ')}${rvErr ? '; reviews couldn’t be read this time, the next refresh tries again' : ''}${closedWhat ? `; ${closedWhat}` : ''}`,
    parts: sp.map(([k, v, of, note, at]) => ({ k, v: Math.round(v), of, note, ...(at ? { at: String(at).slice(0, 10) } : {}) })), src: [ps?.score != null && `Google PageSpeed (${ps.at})`, reached && 'the checkout walk', 'the site read'].filter(Boolean).join(', ') };
}

/* the AI tools that really answered in a check, by name: a tool that failed or wasn't asked is never listed */
const TOOL = { chatgpt: 'ChatGPT', 'chat-gpt': 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };
const ORDER = ['ChatGPT', 'Gemini', 'Perplexity', 'Claude'], rank = (n) => (ORDER.indexOf(n) + 1 || 99);
const toolsLine = (ts = []) => [...new Set(ts.filter(Boolean).map((t) => TOOL[String(t).toLowerCase()] || String(t)))].sort((a, b) => rank(a) - rank(b)).join(', ');

/* the AI answers ring from ONE check (the read's answers or a weekly run): the score, the rows under it, the finding and the
   rival standing all count the same answers, so they can never disagree (Param, 19 Oct: 21/100 over rows adding to 15, a
   0 of 10 row over a 1 of 15 panel). fixT is this check's own finding, carried on the ring for the card's headline */
function aiRingOf({ name, s = {}, tools = [], at = null, from = 'read', stand = null, error = null, closed = false }) {
  const named = s.named ?? null, of = +s.of || 0, uN = s.unbrandedNamed ?? null, uOf = +s.unbrandedOf || 0, src = toolsLine(tools);
  if (!of) return { k: 'AI answers', v: 0, read: false, what: closed ? `Not asked: ${CLOSED_WHY}, so AI tools can’t see the store yet` : error ? 'The AI answers couldn’t be read this time; the next refresh tries again' : 'Not read yet', parts: [], src, at, from, stand, fixT: null };
  /* what counts is being named when the shopper did not ask for the brand: unbranded questions carry 85 of the 100,
     questions with the brand's name in them mostly name it anyway, so they carry 15 */
  const bN = uOf ? named - uN : null, bOf = uOf ? of - uOf : null, parts = [];
  if (uOf) { parts.push({ k: 'Not asked by name', v: Math.round((85 * uN) / uOf), of: 85, note: `${uN} of ${uOf} answers` });
    parts.push(bOf ? { k: 'Asked by name', v: Math.round((15 * bN) / bOf), of: 15, note: `${bN} of ${bOf} answers` } : { k: 'Asked by name', v: Math.round((15 * uN) / uOf), of: 15, note: 'no branded questions asked; scored like the rest' }); }
  const v = uOf ? clamp(parts.reduce((a, x) => a + x.v, 0)) : clamp((100 * named) / of);
  const fixT = uOf && uN / uOf < 0.5 ? `AI tools named ${name || 'you'} in ${uN} of ${uOf} answers where the shopper didn’t ask for it by name. Publish pages that answer what shoppers ask.`
    : !uOf && v < 50 ? `AI tools named ${name || 'you'} in ${named} of ${of} answers. Publish pages that answer what shoppers ask.` : null;
  return { k: 'AI answers', v, read: true, what: uOf ? `Named in ${uN} of ${uOf} answers when not asked by name${bOf ? `, ${bN} of ${bOf} when asked` : ''}` : `Named in ${named} of ${of} real AI answers`,
    parts, src, at, from, stand /* who else the same answers name, and for which questions (ai-standing.js) */, fixT };
}

function aiAnswers(p, fix) {
  const ok = (p.ai?.answers || []).filter((a) => a && !a.error);
  const at = ok.map((a) => a.at).filter(Boolean).sort().pop() || p.meta?.readAt || null;
  const r = aiRingOf({ name: p.name, s: p.ai?.score || {}, tools: ok.map((a) => a.tool), at, from: 'read', stand: standFromRead(p), error: p.meta?.errors?.answers, closed: !!p.ai?.closed });
  if (r.fixT) fix.push(['AI answers', r.fixT]);
  return r;
}

/* the AI answers ring from the newest weekly run (live-watch.js): its score is counted from the standing itself, so the ring,
   its rows and the rival panel are the same answers. null when the run can't be matched to the brand's questions yet */
export function aiRingFromRun(run, { questions = [], rivals = [], brand = '' } = {}) {
  const stand = standFromRun(run, { questions, rivals, brand });
  if (!stand) return null;
  return aiRingOf({ name: brand, s: { named: stand.brand.n, of: stand.of, unbrandedNamed: stand.unOf ? stand.brand.un : null, unbrandedOf: stand.unOf },
    tools: run.answers.map((a) => a.engine), at: new Date(run.at).toISOString(), from: 'weekly', stand });
}

/* what changed since the last score, on the ring and on each part that moved: "was 80" (QA FEED-QA-18) */
function since(rings, prev) {
  for (const r of rings) { const o = prev?.rings?.find((x) => x.k === r.k); if (!o || o.read === false || r.read === false) continue;
    const moved = [];
    for (const x of r.parts || []) { const y = (o.parts || []).find((z) => z.k === x.k); if (y && y.of === x.of && y.v !== x.v) { x.was = y.v; moved.push(`${x.k.toLowerCase()} ${y.v} → ${x.v}`); } }
    const gone = (o.parts || []).filter((y) => !(r.parts || []).some((x) => x.k === y.k)).map((y) => `${y.k.toLowerCase()} not read this time`);
    if (o.v !== r.v) { r.was = o.v; r.changed = [...moved, ...gone].join('; ') || null; } }
  return rings;
}

export function healthFrom(p = {}, N = numbersOf({ profile: p }), prev = null) {
  const fix = [], rings = since([creative(p, N, fix), storefront(p, fix), aiAnswers(p, fix)], prev);
  const read = rings.filter((r) => r.read); // a ring we could not read is shown as such, never averaged in as zero
  return { v: HEALTH_V, key: healthKey(N, p), score: read.length ? clamp(read.reduce((a, r) => a + r.v, 0) / read.length) : 0, delta: 0, public: true, rings,
    moves: fix.slice(0, 3).map(([k, t]) => ({ k, t })), at: new Date().toISOString().slice(0, 10) };
}

/* the AI ring as the seed's geo band, only when it was read (seed-template.js has the not-read default) */
export const geoOf = (h) => { const ai = h?.rings?.find((r) => r.k === 'AI answers'); return ai?.read ? { score: ai.v, band: ai.v >= 60 ? 'Good' : ai.v >= 35 ? 'Fair' : 'Low' } : null; };
