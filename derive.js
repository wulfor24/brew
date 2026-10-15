// Turn what the reader found (profile + ledger) into the pack files the runtime reads: facts.json, config.json.
// Only observed values become facts the cards may quote; anything inferred stays out of the fact sheet.
import { nextFestival } from './calendar.js';
const LOC = { IN: 2356, US: 2840, GB: 2826, CA: 2124, AU: 2036, AE: 2784, SG: 2702, DE: 2276, FR: 2250, NL: 2528, IE: 2372, NZ: 2554, SA: 2682, MY: 2458, ID: 2360, PH: 2608, JP: 2392, ES: 2724, IT: 2380, SE: 2752 };
const CNAME = { IN: 'India', US: 'the US', GB: 'the UK', CA: 'Canada', AU: 'Australia', AE: 'the UAE', SG: 'Singapore', DE: 'Germany', FR: 'France', NL: 'the Netherlands', IE: 'Ireland', NZ: 'New Zealand', SA: 'Saudi Arabia', MY: 'Malaysia', ID: 'Indonesia', PH: 'the Philippines', JP: 'Japan', ES: 'Spain', IT: 'Italy', SE: 'Sweden' };
const TZ = { IN: [5.5, 'Asia/Kolkata'], US: [-5, 'America/New_York'], GB: [0, 'Europe/London'], CA: [-5, 'America/Toronto'], AU: [10, 'Australia/Sydney'], AE: [4, 'Asia/Dubai'], SG: [8, 'Asia/Singapore'], DE: [1, 'Europe/Berlin'], FR: [1, 'Europe/Paris'] };
const LOCALE = { IN: 'en-IN', US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', AE: 'en-AE', SG: 'en-SG' };
const SYM = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
// claim words regulators and platforms flag, by category; always on: absolute promises
const BANNED = {
  health: '\\b(cure[sd]?|heal[sd]?|treat(s|ment)?\\b|regrow\\w*|miracle\\w*|guarantee[sd]?|clinical[- ]strength|chemical[- ]free|doctor[- ]recommended)\\b|100%',
  beauty: '\\b(cure[sd]?|regrow\\w*|miracle\\w*|chemical[- ]free|clinical[- ]strength|anti[- ]ageing cure|permanent(ly)?)\\b|100%',
  food: '\\b(cure[sd]?|prevents? (disease|cancer)|miracle\\w*|detox(es)? your)\\b|100%',
  default: '\\b(miracle\\w*|guaranteed results|cure[sd]?)\\b'
};
const catKind = (c) => /hair|skin|beauty|cosmetic|serum|derma|makeup|fragrance|personal care/i.test(c) ? 'beauty' : /supplement|vitamin|health|wellness|nutrition|pharma|medical|protein/i.test(c) ? 'health' : /food|snack|beverage|coffee|tea|drink/i.test(c) ? 'food' : 'default';

export const keyOf = (k) => String(k).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 60);
export function factsFromLedger(ledger = [], { host } = {}) {
  const F = {};
  for (const e of ledger) {
    if (!e || e.layer === 'inferred' || e.removed || e.v == null || e.v === '') continue; // only observed or brand-confirmed facts go on cards
    const k = keyOf(e.key); if (!k || F[k]) continue;
    F[k] = { v: String(e.v), ...(Number.isFinite(e.n) ? { n: e.n } : {}), label: e.label || e.key, src: e.src || e.url || host, at: e.at, kind: /^price\./.test(e.key) ? 'price' : 'doc', key: e.key, ...(e.url ? { url: e.url } : {}) };
  }
  return F;
}

export function configFromProfile(p, extra = {}) {
  const cc = (p.country || 'US').toUpperCase(), cur = (p.currency || (cc === 'IN' ? 'INR' : cc === 'GB' ? 'GBP' : 'USD')).toUpperCase();
  const cat = [p.category, p.subcategory].filter(Boolean).join(', ') || 'consumer products';
  const products = p.catalog?.products || [];
  const rivals = (p.rivals || []).map((r) => r.name).filter(Boolean).slice(0, 8);
  const q = (p.ai?.questions || []).map((x, i) => (typeof x === 'string' ? { id: 'q' + (i + 1), q: x } : { id: x.id || 'q' + (i + 1), q: x.q })).filter((x) => x.q);
  const terms = (p.search?.terms || []).filter(Boolean);
  const kind = catKind(cat);
  return {
    country: cc, countryName: CNAME[cc] || cc, currency: cur, symbol: SYM[cur] || '', locale: LOCALE[cc] || 'en-US',
    tzOffsetH: (TZ[cc] || [0])[0], timezone: (TZ[cc] || [0, 'UTC'])[1], locationCode: LOC[cc] || 2840, lang: 'en',
    category: cat, about: `a ${p.category || 'consumer'} brand selling ${products.slice(0, 3).map((x) => x.title).join(', ') || 'online'}`,
    product: { noun: extra.noun || 'product', style: `Premium ${p.category || 'D2C'} product ad photography`, avoid: kind === 'beauty' || kind === 'health' ? 'No text, no before/after, no body parts shown as results.' : 'No text, no invented claims.', look: `Clean, premium ${p.category || 'D2C'} look, no before/after.` },
    festival: nextFestival(cc), // rolls forward every year (calendar.js); brand-pack.js re-picks it at every load
    rivals, rivalsAI: rivals, rivalsSafe: 'other brands', newsRivals: rivals,
    terms: terms.length ? [terms.slice(0, 5), terms.slice(5, 10)].filter((x) => x.length) : [], rising: terms.slice(0, 2), listingTerm: terms[0] || p.category || '',
    questions: q.slice(0, 8),
    banned: BANNED[kind] || BANNED.default,
    spend: {}, spendLimitWeekly: 0, baseMonthly: 0,
    catalogUrl: p.platform === 'shopify' ? `https://${p.host}/products.json` : null,
    marketplaces: extra.marketplaces || [],
    sampleWork: false,
    ...extra.config
  };
}

// the products each lane leads with (studio's offline packages and image prompts read these)
export function laneProducts(seed, profile) {
  const prods = profile.catalog?.products || [], out = {}, photo = {};
  for (const [k, l] of Object.entries(seed.lanes || {})) {
    const p = prods.find((x) => l.line.startsWith(x.title)) || prods[0]; if (!p) continue;
    const claim = (p.claims || [])[0] || '';
    out[k] = { name: p.title, short: p.title, price: p.priceLabel || '', claim, hook: claim ? claim.slice(0, 60) : p.title, page: p.url || profile.host, photo: `The ${p.title} on a clean surface, soft daylight, calm space at the top.`, pack: '' };
    if (p.img) photo[k] = String(p.img).replace(/^\//, '');
  }
  return { laneProducts: out, lanePhoto: photo };
}
