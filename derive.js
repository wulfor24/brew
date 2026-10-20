// Turn what the reader found (profile + ledger) into the pack files the runtime reads: facts.json, config.json.
// Only observed values become facts the cards may quote; anything inferred stays out of the fact sheet.
import { nextFestival } from './calendar.js';
import { sellable } from './product-match.js';
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
  /* pets: "treats" is the product (dog treats), never a banned word; health claims about the animal are (QA 20 Oct) */
  pets: '\\b(cure[sd]?|heal[sd]? (?:your|their|the)|treats? (?:arthritis|anxiety|allerg\\w*|disease\\w*|infections?|cancer)|miracle\\w*|prevents? (disease|cancer)|vet[- ]prescribed|clinically proven)\\b',
  default: '\\b(miracle\\w*|guaranteed results|cure[sd]?)\\b'
};
export const catKind = (c) => /\bpets?\b|\bdogs?\b|\bcats?\b|pupp|kitten|petcare/i.test(c) ? 'pets' : /hair|skin|beauty|cosmetic|serum|derma|makeup|fragrance|personal care/i.test(c) ? 'beauty' : /food|snack|beverage|coffee|tea|drink/i.test(c) ? 'food' : /supplement|vitamin|health|wellness|nutrition|pharma|medical|protein/i.test(c) ? 'health' : 'default';

/* "what the brand is", for prompts (research.js's news scout, the listening prompts): the brand's own words when the read has
   them (about, the one-liner, the tagline), else the category with a fitting article and the hero products, never the first
   three catalog rows ("a Apparel brand selling Green Laces for Women, Blue Laces…"). Also heals saved configs at load (brand-pack.js) */
const heroTitles = (p) => {
  const prods = (p.catalog?.products || []).filter((x) => x?.title && !/gift ?card|gift ?wrap|e-?gift/i.test(x.title));
  const hero = (p.catalog?.hero || []).map((h) => prods.find((x) => x.handle === h)).filter(Boolean);
  const best = hero.length ? hero : [...prods].sort((a, b) => (+b.reviews?.count || 0) - (+a.reviews?.count || 0) || (+b.price || 0) - (+a.price || 0));
  return best.slice(0, 3).map((x) => String(x.title).split(/\s+[–—|:]\s+/)[0].trim()).filter(Boolean);
};
export const article = (w) => (/^[aeiou]/i.test(String(w || '').trim()) ? 'an' : 'a');
export function aboutOf(p = {}) {
  const own = [p.about, p.descriptor, p.tagline].map((s) => String(s || '').replace(/\s+/g, ' ').trim()).find((s) => s.length >= 12);
  if (own) return own.slice(0, 220).replace(/[.\s]+$/, '');
  const cat = String(p.category || '').trim(), names = heroTitles(p);
  const kind = cat ? `${article(cat)} ${cat} brand` : 'a consumer brand';
  return names.length ? `${kind} selling ${names.join(', ')}` : `${kind}${p.host ? ` at ${p.host}` : ''}`;
}
/* a config.about written by the old rule (the first three catalog rows behind "a <Category> brand selling") */
export const OLD_ABOUT = /^an? \S+ brand selling /;
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

/* the config fields that follow the selling market (market.js): a market that moves patches only these */
/* a market still "to confirm" (market.js toConfirm) stays unknown: no country, name, markets or sale day, never a quiet US
   (QA 19 Oct). Readers say "your market" or skip the market-only lines; locale, time zone and search location keep a neutral default */
export function marketConfig(p = {}) {
  const cc = String(p.country || '').toUpperCase();
  return { country: cc, countryName: cc ? CNAME[cc] || cc : '', markets: (p.markets || [cc]).filter(Boolean), registeredCountry: p.registeredCountry || null, locale: LOCALE[cc] || 'en-US',
    tzOffsetH: (TZ[cc] || [0])[0], timezone: (TZ[cc] || [0, 'UTC'])[1], locationCode: LOC[cc] || 2840, festival: cc ? nextFestival(cc) : null };
}
export function configFromProfile(p, extra = {}) {
  const cc = String(p.country || '').toUpperCase(), cur = String(p.currency || (cc === 'IN' ? 'INR' : cc === 'GB' ? 'GBP' : cc === 'US' ? 'USD' : '')).toUpperCase(); /* no market, no guessed currency (marketConfig) */
  const cat = [p.category, p.subcategory].filter(Boolean).join(', ') || 'consumer products';
  const products = p.catalog?.products || [];
  const rivals = (p.rivals || []).map((r) => r.name).filter(Boolean).slice(0, 8);
  const q = (p.ai?.questions || []).map((x, i) => (typeof x === 'string' ? { id: 'q' + (i + 1), q: x } : { id: x.id || 'q' + (i + 1), q: x.q })).filter((x) => x.q);
  const terms = (p.search?.terms || []).filter(Boolean);
  const kind = catKind(cat);
  return {
    ...marketConfig(p), currency: cur, symbol: SYM[cur] || '', lang: 'en',
    category: cat, about: aboutOf(p),
    product: { noun: extra.noun || 'product', style: `Premium ${p.category || 'D2C'} product ad photography`, avoid: kind === 'beauty' || kind === 'health' ? 'No text, no before/after, no body parts shown as results.' : 'No text, no invented claims.', look: `Clean, premium ${p.category || 'D2C'} look, no before/after.` },
    festival: cc ? nextFestival(cc) : null, // rolls forward every year (calendar.js); brand-pack.js re-picks it at every load
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
  const prods = (profile.catalog?.products || []).filter(sellable), out = {}, photo = {}; /* never a test or duplicate listing */
  for (const [k, l] of Object.entries(seed.lanes || {})) {
    const p = prods.find((x) => l.line.startsWith(x.title)) || prods[0]; if (!p) continue;
    const claim = (p.claims || [])[0] || '';
    out[k] = { name: p.title, short: p.title, price: p.priceLabel || '', claim, hook: claim ? claim.slice(0, 60) : p.title, page: p.url || profile.host, photo: `The ${p.title} on a clean surface, soft daylight, calm space at the top.`, pack: '' };
    if (p.img) photo[k] = String(p.img).replace(/^\//, '');
  }
  return { laneProducts: out, lanePhoto: photo };
}

/* the banned claim list a brand's category gets (a saved config heals to it at load: brand-pack) */
export const bannedFor = (p = {}) => { const k = catKind([p.category, p.subcategory].filter(Boolean).join(', ') || 'consumer products'); return BANNED[k] || BANNED.default; };
export const BANNED_LISTS = new Set(Object.values(BANNED));
