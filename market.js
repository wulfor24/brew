// Where a brand SELLS, kept apart from where its store is REGISTERED. A store set up in India that prices in dollars and
// whose visitors are mostly in the US sells to the US: rivals, searches, AI questions, listening, ideas, stories, moves and
// money formatting follow that market, never the shop's address. Pure functions, no AI, no spend.
//
// The selling market comes from where customers are:
//   1. what the brand typed on the check page (a correction, never overwritten);
//   2. Shopify orders by shipping country, then GA4 sessions by country (a connected account beats the public read);
//   3. the public read: the currency prices are in, the countries the store ships to, hreflang and locale paths, the
//      domain, and (weakest) the registered address and phone number.
// A brand can sell in more than one market: `others` are the markets with a real share (10% or more of orders or
// visits), or the regions the site itself serves (hreflang, a short ships-to list).
// profile.country is the primary selling market (every consumer reads it); profile.markets is [primary, ...others];
// profile.registeredCountry is the shop's address; profile.market keeps the verdict and the signals it came from, so a
// saved read heals from them without reading the site again.

export const MARKET_V = 2; /* 2: EU currencies, domains and the site's language; hreflang shares one vote; a tie is "to confirm" */
export const CUR_COUNTRY = { INR: 'IN', USD: 'US', GBP: 'GB', AUD: 'AU', CAD: 'CA', NZD: 'NZ', JPY: 'JP', AED: 'AE', SGD: 'SG', SAR: 'SA', MYR: 'MY', IDR: 'ID', PHP: 'PH', HKD: 'HK', CHF: 'CH', SEK: 'SE', NOK: 'NO', DKK: 'DK', ZAR: 'ZA', BRL: 'BR', MXN: 'MX', KRW: 'KR', THB: 'TH', BDT: 'BD', PKR: 'PK', LKR: 'LK', NPR: 'NP',
  CZK: 'CZ', PLN: 'PL', HUF: 'HU', RON: 'RO', BGN: 'BG', RSD: 'RS', ISK: 'IS', TRY: 'TR', ILS: 'IL', UAH: 'UA', CNY: 'CN', TWD: 'TW', VND: 'VN', EGP: 'EG', NGN: 'NG', KES: 'KE', QAR: 'QA', KWD: 'KW', BHD: 'BH', OMR: 'OM', CLP: 'CL', COP: 'CO', PEN: 'PE', ARS: 'AR' };
/* the euro is spent in many countries: it names none by itself, and never picks among the ones a site serves */
export const TLD_COUNTRY = { in: 'IN', uk: 'GB', au: 'AU', ca: 'CA', nz: 'NZ', jp: 'JP', ae: 'AE', sg: 'SG', de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', ie: 'IE', se: 'SE', my: 'MY', ph: 'PH', id: 'ID', za: 'ZA', br: 'BR', mx: 'MX', sa: 'SA', hk: 'HK', ch: 'CH',
  us: 'US', at: 'AT', be: 'BE', pt: 'PT', fi: 'FI', dk: 'DK', no: 'NO', pl: 'PL', cz: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO', bg: 'BG', si: 'SI', hr: 'HR', gr: 'GR', ee: 'EE', lv: 'LV', lt: 'LT', lu: 'LU',
  tr: 'TR', il: 'IL', kr: 'KR', tw: 'TW', vn: 'VN', th: 'TH', eg: 'EG', ng: 'NG', ke: 'KE', pk: 'PK', bd: 'BD', lk: 'LK', np: 'NP', ar: 'AR', cl: 'CL', pe: 'PE', ua: 'UA', qa: 'QA', kw: 'KW' }; /* .co, .me, .io and .ai are used as generic names: never a country */
/* the site's own language (<html lang>) where it is spoken in one country; de, fr, nl, es and pt only with euro prices */
export const LANG_COUNTRY = { cs: 'CZ', pl: 'PL', hu: 'HU', ro: 'RO', bg: 'BG', sk: 'SK', sl: 'SI', hr: 'HR', el: 'GR', fi: 'FI', da: 'DK', nb: 'NO', nn: 'NO', no: 'NO', sv: 'SE', et: 'EE', lv: 'LV', lt: 'LT',
  ja: 'JP', ko: 'KR', th: 'TH', vi: 'VN', tr: 'TR', he: 'IL', uk: 'UA', it: 'IT' };
const LANG_EUR = { de: 'DE', fr: 'FR', nl: 'NL', es: 'ES', pt: 'PT' };
export const COUNTRY_NAME = { IN: 'India', US: 'the US', GB: 'the UK', CA: 'Canada', AU: 'Australia', AE: 'the UAE', SG: 'Singapore', DE: 'Germany', FR: 'France', NL: 'the Netherlands', IE: 'Ireland', NZ: 'New Zealand', SA: 'Saudi Arabia', MY: 'Malaysia', ID: 'Indonesia', PH: 'the Philippines', JP: 'Japan', ES: 'Spain', IT: 'Italy', SE: 'Sweden', HK: 'Hong Kong', CH: 'Switzerland', ZA: 'South Africa', BR: 'Brazil', MX: 'Mexico', BD: 'Bangladesh', PK: 'Pakistan', LK: 'Sri Lanka', NP: 'Nepal',
  CZ: 'Czechia', PL: 'Poland', HU: 'Hungary', RO: 'Romania', BG: 'Bulgaria', SK: 'Slovakia', SI: 'Slovenia', HR: 'Croatia', GR: 'Greece', AT: 'Austria', BE: 'Belgium', PT: 'Portugal', FI: 'Finland', DK: 'Denmark', NO: 'Norway',
  EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', TR: 'Turkey', IL: 'Israel', KR: 'South Korea', TW: 'Taiwan', CN: 'China', VN: 'Vietnam', TH: 'Thailand', EG: 'Egypt', NG: 'Nigeria', KE: 'Kenya', UA: 'Ukraine',
  QA: 'Qatar', KW: 'Kuwait', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru', RS: 'Serbia', IS: 'Iceland', BH: 'Bahrain', OM: 'Oman' };
export const nameOf = (cc) => COUNTRY_NAME[cc] || cc || 'its market';

const CC = (x) => { const s = String(x || '').trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) && s !== 'XX' && s !== 'EU' ? (s === 'UK' ? 'GB' : s) : null; };
/* "en-us" / "en_IN" / "/en-gb" → the region's country code (a bare language has none) */
export const regionOf = (tag) => CC((String(tag || '').replace(/^\//, '').split(/[-_]/)[1]) || '');
/* "US 65%; IN 13%; DE 3%" (the connectors' ledger lines) → [{ code, share }] */
export function sharesOf(v) {
  return String(v || '').split(/;\s*/).map((s) => { const m = /^([A-Z]{2})\s+(\d+(?:\.\d+)?)%$/.exec(s.trim()); return m ? { code: CC(m[1]), share: +m[2] / 100 } : null; }).filter((x) => x?.code);
}

/* the shares a connected account brings, from its ledger rows (real rows only: the caller drops simulated ones):
   Shopify orders by shipping country (with the order count) and GA4 sessions by country (with the session count) */
export function connectedOf(rows = []) {
  const by = Object.fromEntries((rows || []).filter((e) => e?.key && !e.demo).map((e) => [e.key, e]));
  const out = {};
  const o = by['shopify.orders.countries']; if (o) { const s = sharesOf(o.v); if (s.length) out.orders = { shares: s, n: Number.isFinite(+o.n) ? +o.n : null }; }
  const g = by['ga4.countries']; if (g) { const s = sharesOf(g.v); if (s.length) out.ga4 = { shares: s, n: Number.isFinite(+by['ga4.sessions.30d']?.n) ? +by['ga4.sessions.30d'].n : null }; }
  return out;
}

/* enough to trust: twenty orders or a hundred visits. Below that a share is one customer's noise */
const MIN_ORDERS = 20, MIN_SESSIONS = 100, OTHER_SHARE = 0.1;

/* cities and postcode shapes that place a business in one country; the text must name one country clearly (two hits, and
   twice any other) or it says nothing */
const PLACES = [['IN', /\b(bengaluru|bangalore|mumbai|new delhi|delhi ncr|hyderabad|chennai|pune|kolkata|gurugram|gurgaon|noida|ahmedabad|karnataka|maharashtra|telangana|tamil nadu|kerala)\b|\b\d{3}\s?\d{3}\b(?=[^\n]{0,20}india)|\b(lakh|crore)s?\b/gi],
  ['AE', /\b(dubai|abu dhabi|sharjah|u\.?a\.?e\.?)\b/gi], ['GB', /\b(london|manchester|birmingham|edinburgh|glasgow)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/g],
  ['US', /\b(new york|los angeles|san francisco|chicago|austin|seattle|brooklyn)\b|,\s?(CA|NY|TX|FL|WA|IL|MA|CO|GA|NJ)\s\d{5}\b/g], ['AU', /\b(sydney|melbourne|brisbane|perth|nsw|victoria)\b|\b(NSW|VIC|QLD)\s\d{4}\b/g],
  ['SG', /\bsingapore\s\d{6}\b/gi], ['CA', /\b(toronto|vancouver|montreal|ontario)\b|\b[A-Z]\d[A-Z]\s\d[A-Z]\d\b/g]];
export function placeOf(text) {
  const t = String(text || '').slice(0, 200000); const n = PLACES.map(([c, re]) => [c, (t.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  return n[0][1] >= 2 && n[0][1] >= 2 * (n[1]?.[1] || 0) ? n[0][0] : null;
}

/** The verdict from the signals. sig: { brand, registered, currency, shipsTo, hreflang, localePath, tld, lang, phone, orgCountry }
 *  (rivals are never a signal: who a brand competes with says nothing about where its customers are)
 *  and live: connectedOf(rows). Returns { v, primary, others, registered, currency, by, conf, why, signals, scores }. */
export function sellingMarket(sig = {}, live = {}) {
  const registered = CC(sig.registered) || CC(sig.orgCountry) || null;
  const base = { v: MARKET_V, registered, currency: sig.currency || null, signals: sig };
  const fromShares = (src, d, what) => {
    const xs = [...d.shares].sort((a, b) => b.share - a.share), primary = xs[0].code;
    const others = xs.slice(1).filter((x) => x.share >= OTHER_SHARE).map((x) => x.code).slice(0, 4);
    return { ...base, primary, others, by: src, conf: 'high', scores: Object.fromEntries(xs.map((x) => [x.code, x.share])),
      why: `${Math.round(xs[0].share * 100)}% of ${what} are in ${nameOf(primary)}${others.length ? `; also ${others.map((c) => `${nameOf(c)} ${Math.round(xs.find((x) => x.code === c).share * 100)}%`).join(', ')}` : ''}` };
  };
  // 1. the brand's own correction
  const pin = CC(sig.brand);
  if (pin) return { ...base, primary: pin, others: (sig.brandOthers || []).map(CC).filter((c) => c && c !== pin).slice(0, 4), by: 'brand', conf: 'high', scores: { [pin]: 1 }, why: `${nameOf(pin)}, set by the brand` };
  // 2. connected accounts: orders, then visits
  if (live.orders?.shares?.length && (live.orders.n == null || live.orders.n >= MIN_ORDERS)) return fromShares('orders', live.orders, `the last 90 days' orders (Shopify, by shipping country)`);
  if (live.ga4?.shares?.length && (live.ga4.n == null || live.ga4.n >= MIN_SESSIONS)) return fromShares('ga4', live.ga4, 'visits in the last 30 days (Google Analytics)');
  // 3. the public read: each signal scores the country it points to
  const score = {}, why = {}, add = (c, w, because) => { c = CC(c); if (!c || !w) return; score[c] = (score[c] || 0) + w; (why[c] ||= []).push(because); };
  const ships = Array.isArray(sig.shipsTo) ? sig.shipsTo.map(CC).filter(Boolean) : null;
  const cur = String(sig.currency || '').toUpperCase(), curC = CUR_COUNTRY[cur];
  if (curC) add(curC, 4, `prices are in ${cur}`);
  if (ships?.length === 1) add(ships[0], 3, `ships only to ${ships[0]}`);
  const hl = [...new Set((sig.hreflang || []).map(regionOf).filter(Boolean))];
  /* hreflang is one vote shared by the regions it lists: a site serving twelve countries says little about any one of them,
     so the currency and the site's own language outweigh it */
  hl.forEach((c) => add(c, 1 / hl.length, 'hreflang'));
  const lg = String(sig.lang || '').toLowerCase(), lgC = regionOf(lg) || LANG_COUNTRY[lg.split(/[-_]/)[0]] || (cur === 'EUR' ? LANG_EUR[lg.split(/[-_]/)[0]] : null);
  /* en-US is most site builders' default (WordPress, Webflow, Next.js): it says little, so a +91 number outweighs it */
  if (lgC) add(lgC, lg === 'en-us' ? 0.5 : 2, `the site is in ${lg}`);
  const lp = regionOf(sig.localePath); if (lp) add(lp, 1, `locale path /${String(sig.localePath).replace(/^\//, '')}`);
  const tld = TLD_COUNTRY[String(sig.tld || '').toLowerCase()]; if (tld) add(tld, 2, `.${sig.tld} domain`);
  /* the address and the phone say where the business sits, not who buys: weak, and nothing when it doesn't ship there */
  const home = !ships || !registered || ships.includes(registered);
  if (registered && home) add(registered, 2, 'store address');
  if (CC(sig.orgCountry) && CC(sig.orgCountry) !== registered && (!ships || ships.includes(CC(sig.orgCountry)))) add(sig.orgCountry, 1, 'address in JSON-LD');
  if (CC(sig.phone) && (!ships || ships.includes(CC(sig.phone)))) add(sig.phone, 1, 'phone number format');
  if (CC(sig.place) && (!ships || ships.includes(CC(sig.place)))) add(sig.place, 1, 'addresses in the page text');
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1] || (a[0] === curC ? -1 : b[0] === curC ? 1 : 0));
  if (!ranked.length) return { ...base, primary: registered || null, others: [], by: 'site', conf: 'low', scores: {}, why: registered ? `only the store address (${registered}) was found` : 'no market signal on the site' };
  const [primary, top] = ranked[0], gap = top - (ranked[1]?.[1] || 0);
  /* too close to call (a tie at the top, or only weak hints pointing different ways): left for the brand to confirm on the
     check page, never picked by the order the hints came in */
  if (ranked.length > 1 && (gap < 0.01 || top < 1.5)) {
    const cands = ranked.slice(0, 4).map(([c]) => c);
    return { ...base, primary: null, others: cands, by: 'site', conf: 'low', toConfirm: true, scores: score, why: `to confirm: the site points to ${cands.map(nameOf).join(', ')} about equally` };
  }
  const others = [...new Set([...hl, ...(lp ? [lp] : []), ...(ships && ships.length > 1 && ships.length <= 6 ? ships : [])])].filter((c) => c !== primary).slice(0, 4);
  const exportNote = registered && registered !== primary ? `; the store is registered in ${nameOf(registered)}` : '';
  return { ...base, primary, others, by: 'site', conf: gap >= 3 ? 'high' : gap >= 1 ? 'medium' : 'low', scores: score,
    why: `${nameOf(primary)}: ${why[primary].join(', ')}${exportNote}` };
}

/* the signals a saved read already holds (its ledger and profile), for brands read before profile.market existed */
export function signalsFromSaved(profile = {}, ledger = []) {
  const s = { ...(profile.market?.signals || {}) };
  const L = (k) => (ledger || []).find((e) => e?.key === k && !e.removed);
  const note = String(L('market.country')?.note || '') + '; ' + String(L('market.currency')?.note || '');
  s.registered ??= CC(L('shop.country')?.v) || null;
  s.currency ??= String(L('shop.currency')?.v || L('market.currency')?.v || profile.currency || '').toUpperCase().slice(0, 3) || null;
  if (s.hreflang == null) { const m = /hreflang:\s*([^;]+)/.exec(note); s.hreflang = m ? m[1].split(/,\s*/).map((x) => x.trim()).filter(Boolean) : []; }
  if (s.localePath == null) { const m = /locale path \/([a-z]{2}-[a-z]{2})/i.exec(note); s.localePath = m ? m[1] : null; }
  if (s.phone == null) { const m = /([A-Z]{2}) from phone number format/.exec(note); s.phone = m ? m[1] : null; }
  if (s.orgCountry == null) { const m = /([A-Z]{2}) from Organization address/.exec(note); s.orgCountry = m ? m[1] : null; }
  s.tld ??= String(profile.host || '').split('.').pop() || null;
  /* a correction the brand typed on the check page */
  const conf = [...(ledger || [])].reverse().find((e) => e?.key === 'market.country.confirmed' && e.method === 'brand-confirmed');
  if (conf && CC(conf.v)) s.brand = CC(conf.v);
  return s;
}

/* the market laid onto the profile: country is the primary selling market, the locale's region follows it */
export function applyMarket(profile, m) {
  if (!profile || !m?.primary) return profile;
  profile.country = m.primary;
  profile.markets = [m.primary, ...(m.others || [])];
  profile.registeredCountry = m.registered || null;
  const lang = String(profile.locale || 'en').split(/[-_]/)[0] || 'en';
  if (!profile.locale || regionOf(profile.locale) !== m.primary) profile.locale = `${lang}-${m.primary}`;
  profile.market = { ...m, at: new Date().toISOString() };
  return profile;
}

/** Work the market out again from what is saved: the profile's signals (or its ledger, for older reads) and the
 *  connected accounts' rows. Returns { market, changed, moved, was } without writing anything. */
export function marketFor(profile = {}, ledger = [], rows = []) {
  const sig = signalsFromSaved(profile, ledger), m = sellingMarket(sig, connectedOf(rows));
  if (!m.primary && !m.toConfirm) m.primary = profile.country || null; /* "to confirm" clears a market the site only guessed */
  const was = profile.country || null, prev = profile.market;
  const key = (x) => JSON.stringify([x?.v, x?.primary, x?.others, x?.registered, x?.by]);
  return { market: m, was, moved: !!m.primary && !!was && m.primary !== was, changed: !prev || key(prev) !== key(m) || profile.country !== m.primary };
}

/* one line for prompts: where the brand sells, and (for an exporter) that the address is not the market */
export function marketLine(p = {}) {
  const c = p.country || p.market?.primary; if (!c) return 'Selling market: unknown.';
  const others = (p.markets || (p.market ? [p.market.primary, ...(p.market.others || [])] : [])).filter((x) => x && x !== c);
  const reg = p.registeredCountry || p.market?.registered;
  return `Selling market: ${nameOf(c)} (${c})${others.length ? `, also ${others.map((x) => `${nameOf(x)} (${x})`).join(', ')}` : ''}.`
    + (reg && reg !== c ? ` The store is registered in ${nameOf(reg)} (${reg}): that is where the business sits, not where its customers are. Write for shoppers in ${nameOf(c)}: their prices, rivals, platforms, holidays and spelling.` : '');
}
/* the same, short, for a "Brand: X (host), …" line */
export const marketShort = (p = {}) => `selling market ${p.country || 'unknown'}${p.registeredCountry && p.registeredCountry !== p.country ? ` (registered in ${p.registeredCountry}; its shoppers are in ${p.country})` : ''}`;

/* ---------- where the AI tools and searches are asked from: one map, one rule (answers.js, ai-questions.js, live-watch.js) ---------- */
/* DataForSEO location codes for every market Brew names (COUNTRY_NAME) */
export const DFS_LOC = { IN: 2356, US: 2840, GB: 2826, CA: 2124, AU: 2036, AE: 2784, SG: 2702, DE: 2276, FR: 2250, NL: 2528, IE: 2372, NZ: 2554, SA: 2682, MY: 2458, JP: 2392, ZA: 2710,
  IT: 2380, ES: 2724, PT: 2620, BE: 2056, AT: 2040, CH: 2756, SE: 2752, DK: 2208, NO: 2578, FI: 2246, PL: 2616, CZ: 2203, HU: 2348, RO: 2642, GR: 2300, TR: 2792, IL: 2376,
  KR: 2410, TW: 2158, HK: 2344, CN: 2156, VN: 2704, TH: 2764, ID: 2360, PH: 2608, EG: 2818, NG: 2566, KE: 2404, PK: 2586, BD: 2050, LK: 2144, NP: 2524, QA: 2634, KW: 2414,
  BH: 2048, OM: 2512, BR: 2076, MX: 2484, AR: 2032, CL: 2152, CO: 2170, PE: 2604, UA: 2804, SK: 2703, SI: 2705, HR: 2191, BG: 2100, EE: 2233, LV: 2428, LT: 2440, LU: 2442, RS: 2688, IS: 2352 };
const ASK_LANG = new Set(['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ja', 'ko', 'pl', 'sv', 'da', 'no', 'fi', 'tr', 'cs', 'ro', 'hu', 'el', 'he', 'th', 'vi', 'id']);
/** the market to ask from: the brand's own, else the read's best candidate (a market "to confirm"), else the US, said so
 *  (guessed: true, and the answers carry askedFrom). Language: the site's own when the tools support it, else English */
export function askMarket(profile = {}, config = {}) {
  const m = profile.market || {};
  const own = CC(profile.country) || CC(config.country), cand = CC(m.others?.[0]) || CC(m.registered) || CC(m.signals?.phone) || CC(m.signals?.place);
  const cc = own || cand || 'US';
  const lang = String(profile.locale || config.locale || 'en').split(/[-_]/)[0].toLowerCase();
  return { cc, loc: DFS_LOC[cc] || 2840, lang: ASK_LANG.has(lang) ? lang : 'en', guessed: !own, name: nameOf(cc) };
}
