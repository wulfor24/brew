// SEO tools price search in US dollars (cost per click, a site's estimated Google Ads budget). An Indian or British playbook
// quoted those as "0.3 USD" or "$380,600" beside ₹ prices (moves audit 20 Oct). They read in the brand's currency, as an
// estimate that keeps the dollar figure it came from. Rough rates: these are tool estimates, so "about" is the honest word.
const PER_USD = { INR: 88, GBP: 0.75, EUR: 0.86, AUD: 1.52, CAD: 1.38, AED: 3.67, SGD: 1.29, JPY: 150 };
const SYM = { INR: '₹', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$', JPY: '¥' };
const money = (v, cur) => { const s = SYM[cur] || `${cur} `; if (cur === 'INR') return v >= 1e7 ? `${s}${+(v / 1e7).toFixed(1)} crore` : v >= 1e5 ? `${s}${+(v / 1e5).toFixed(1)} lakh` : `${s}${v >= 100 ? Math.round(v).toLocaleString('en-IN') : +v.toFixed(v < 10 ? 1 : 0)}`;
  return `${s}${v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(1)}K` : v >= 100 ? Math.round(v).toLocaleString('en-GB') : +v.toFixed(2)}`; };
const usd = (n) => `US$${n >= 100 ? Math.round(n).toLocaleString('en-US') : +(+n).toFixed(2)}`;
/* one value in dollars, said in the brand's currency: "about ₹26 (est. from US$0.30)"; unknown or USD currency: as it was */
export const usdAs = (n, cur, per = '') => { const c = String(cur || '').toUpperCase(), r = PER_USD[c], x = +n; if (!r || !Number.isFinite(x)) return null; if (!x) return `${SYM[c]?.trim() || c}0${per}`; return `about ${money(x * r, c)}${per} (est. from ${usd(x)}${per})`; };
/* a line of text: "0.3 USD", "0 USD/mo", "$380,600", "$58,600/mo" said in the brand's currency. "$100M Offers" (a book) stays */
export function usdText(text, cur) {
  const c = String(cur || '').toUpperCase(); if (!PER_USD[c] || typeof text !== 'string' || !/USD|\$\d/.test(text)) return text;
  return text.replace(/(?<![\w$A-Z])(?:(?:US)?\$(\d[\d,]*(?:\.\d+)?)(?![\d.,]*[A-Za-z])|(\d[\d,]*(?:\.\d+)?)\s*USD\b)(\/mo)?/g, (m, a, b, per) => usdAs(+String(a ?? b).replace(/,/g, ''), c, per || '') || m)
    .replace(/\bUSD\/mo\b/g, `in ${SYM[c]?.trim() || c} a month (est.)`); }
/* every string of a saved move (or any JSON), healed at load; links and ids stay as they are */
export const usdDeep = (o, cur, d = 0) => { if (!cur || !PER_USD[String(cur).toUpperCase()] || d > 8 || o == null) return o; if (typeof o === 'string') return usdText(o, cur);
  if (Array.isArray(o)) return o.map((x) => usdDeep(x, cur, d + 1)); if (typeof o !== 'object') return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /^(?:url|src|href|id|key|n|t|kind|group|skill|family)$/i.test(k) ? v : usdDeep(v, cur, d + 1)])); };
