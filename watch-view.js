// "What Brew watches for you": everything Brew reads from outside for one brand, folded into four blocks a brand can take in at a
// glance (What people say · Where you sell · What rivals do · How you show up) plus one header count. Pure: the route reads the
// pack files and passes them in, so tests build a view from fixtures. Quiet rules: a block with nothing in it is left out, every
// number keeps its date and link, and a source that could not be read is one "couldn't read" line, never a zero.
import { standFromRead } from './ai-standing.js';
import { SOURCES } from './listen-watch.js';
import { PLATFORMS } from './shelf.js';

const DAY = 864e5;
const day = (at) => (at ? String(new Date(at).toISOString()).slice(0, 10) : null);
const clip = (s, n = 180) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const hostLogo = (h) => (h ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64` : null);
const PLACE = { reddit: 'reddit.com', youtube: 'youtube.com', instagram: 'instagram.com', igtag: 'instagram.com', tiktok: 'tiktok.com', x: 'x.com', threads: 'threads.com', linkedin: 'linkedin.com', pinterest: 'pinterest.com', facebook: 'facebook.com',
  telegram: 'telegram.org', amazon: 'amazon.com', walmart: 'walmart.com', trustpilot: 'trustpilot.com', google: 'google.com', nykaa: 'nykaa.com', flipkart: 'flipkart.com', myntra: 'myntra.com', news: 'news.google.com', web: 'quora.com',
  blinkit: 'blinkit.com', zepto: 'zepto.com', instamart: 'swiggy.com', similarweb: 'similarweb.com', chatgpt: 'chatgpt.com', gemini: 'gemini.google.com', perplexity: 'perplexity.ai' };
/* a topic that names a kind of post ("product review", "recommendation") is no topic people talk about */
const TALK = /\b(reviews?|feedback|general|discussion|opinions?|experiences?|comparisons?|recommendations?|praise|usage|skepticism|content|post|video)\b/i;
const pname = (k) => PLATFORMS[k]?.label || SOURCES[k]?.name?.replace(/ (comments|reviews|posts)$/i, '') || k;

/* What people say: the count split into about you and about your category, the topics as stamps, quotes as notes */
function peopleOf({ items = [], themes = [], status = {}, name, now }) {
  const recent = items.filter((x) => !x.postedAt || now - x.postedAt < 120 * DAY);
  const you = recent.filter((x) => x.about === 'brand' || x.reach === 'direct'), cat = recent.filter((x) => !you.includes(x));
  const bySrc = Object.entries(recent.reduce((m, x) => ((m[x.platform] = (m[x.platform] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const note = (x) => ({ text: clip([x.title, x.text].filter(Boolean).join('. '), 160), who: x.author || null, where: x.sub || pname(x.platform), platform: x.platform, url: x.link || null, at: day(x.postedAt), rating: x.rating || null, mood: x.sentiment || null, image: x.image || null });
  const good = (x) => String(x.text || '').length >= 30 && x.link;
  const pickNotes = (xs) => [...xs].filter(good).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 6).map(note);
  const wk = (t) => { const d = t.weekDelta ?? t.delta ?? null; return d == null ? null : d; };
  return { total: recent.length, you: you.length, category: cat.length, at: status?.at ? day(status.at) : null,
    places: bySrc.map(([k, n]) => ({ id: k, name: pname(k), n, logo: hostLogo(PLACE[k]) })),
    topics: themes.filter((t) => !TALK.test(t.name || '')).slice(0, 8).map((t) => ({ name: t.name, n: t.n, neg: t.neg || 0, pos: t.pos || 0, week: wk(t) })),
    notes: { you: pickNotes(you), category: pickNotes(cat) },
    tagged: recent.filter((x) => x.tagged).slice(0, 6).map(note), name };
}

/* Where you sell: one shelf per platform, the brand's own listings first, each rival as a summary; changes this week stamped */
function shelfOf(files = {}, now) {
  const out = [];
  for (const [key, f] of Object.entries(files)) { if (!f) continue; const P = PLATFORMS[key]; if (!P) continue;
    const byName = f.byName || f.last?.byName || {}, names = Object.keys(byName);
    const own = names.length ? (Object.entries(byName).find(([, xs]) => xs.some((x) => x.own)) || [])[1] || [] : [];
    const ownName = names.find((n) => (byName[n] || []).some((x) => x.own)) || null;
    const rivals = names.filter((n) => n !== ownName && byName[n]?.length).map((n) => { const xs = byName[n];
      return { name: n, n: xs.length, minPrice: Math.min(...xs.map((x) => x.price).filter(Boolean)) || null, rating: avg(xs.map((x) => x.rating)), out: xs.filter((x) => x.inStock === false).length, top: xs[0] ? { name: xs[0].name, price: xs[0].price, image: xs[0].image, url: xs[0].url } : null }; });
    const fresh = f.at && now - Date.parse(f.at) < 9 * DAY;
    out.push({ id: key, label: P.label, kind: P.kind, city: f.city || null, logo: hostLogo(PLACE[key]), home: P.home, at: day(f.at), error: f.error || null, errorAt: day(f.errorAt),
      listed: f.at ? own.length : null, /* null: never read, so neither "listed" nor "not listed" */
      own: own.slice(0, 6).map((x) => ({ name: x.name, price: x.price, mrp: x.mrp, inStock: x.inStock, rating: x.rating, ratings: x.ratings || null, eta: x.eta ?? null, image: x.image, url: x.url, unit: x.unit || null })),
      rivals, changes: fresh ? (f.changes || []).slice(0, 6) : [], reviews: (f.reviews || []).slice(0, 4).map((r) => ({ text: clip(r.text, 160), rating: r.rating, who: r.author, product: r.product, url: r.url, verified: !!r.verified })) });
  }
  return out.sort((a, b) => (b.listed || 0) - (a.listed || 0) || (a.error ? 1 : 0) - (b.error ? 1 : 0));
}
const avg = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null; };

/* What rivals do: one trading card per rival, from the read (ads, store) and the pulse (launches, prices, traffic, followers) */
function rivalsOf({ profile = {}, pulse = null, traffic = null }) {
  const lines = pulse?.lines || [], by = (re) => lines.filter((l) => re.test(l.key));
  const ads = profile.ads?.rivals || [];
  return (profile.rivals || []).slice(0, 6).map((r) => {
    const a = ads.find((x) => x.name === r.name || (r.host && x.host === r.host)) || {}, items = a.items || [];
    const longest = [...items].filter((x) => x.days).sort((p, q) => q.days - p.days)[0] || null;
    const k = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const launch = lines.find((l) => l.key === `catalog.new.${k(r.host)}`), moved = lines.find((l) => l.key === `catalog.price.${k(r.host)}`);
    const visits = (traffic?.rows || []).find((x) => x.host === r.host) || null, ig = by(/^social\.ig\.followers\./).find((l) => String(l.label).startsWith(`${r.name}:`));
    return { name: r.name, host: r.host || null, logo: hostLogo(r.host), why: r.why || null,
      liveAds: a.error ? null : a.live ?? null, adsError: a.error || null, adsAt: day(profile.ads?.at),
      longest: longest ? { days: longest.days, since: longest.since, hook: clip(longest.hook || longest.body, 90), format: longest.format, url: longest.url } : null,
      visits: visits?.visits ?? null, visitsAt: visits?.months?.slice(-1)[0]?.m || null, sources: visits?.sources || null,
      followers: ig?.value ?? null,
      week: [launch && +launch.value > 0 ? { kind: 'launch', text: `${launch.value} new product${+launch.value === 1 ? '' : 's'}`, items: (launch.items || []).slice(0, 3) } : null,
        moved && +moved.value > 0 ? { kind: 'price', text: `${moved.value} price change${+moved.value === 1 ? '' : 's'}`, items: (moved.items || []).slice(0, 3) } : null].filter(Boolean) };
  });
}

/* How you show up: who the AI answers name when the shopper named no brand, with two answers as chat bubbles */
function showOf(profile = {}) {
  const s = standFromRead(profile); if (!s) return null; if (s.error) return { error: s.error };
  const ans = (profile.ai?.answers || []).filter((a) => !a.error && !a.branded && a.text);
  const TOOL = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude', copilot: 'Copilot', google: 'Google AI' }, oneEach = new Set();
  const bubbles = ans.sort((a, b) => (b.named ? 1 : 0) - (a.named ? 1 : 0)).filter((a) => !oneEach.has(a.q) && oneEach.add(a.q)).slice(0, 2).map((a) => ({ q: a.q, tool: TOOL[String(a.tool || '').toLowerCase()] || a.tool, text: clip(a.text, 260), names: [...new Set([...(a.brandsNamed || []), ...(a.rivalsNamed || [])])].slice(0, 6), named: !!a.named }));
  return { at: s.at, of: s.unOf, brand: s.brand, rivals: (s.rivals || []).slice(0, 4).map((r) => ({ name: r.name, un: r.un })), bubbles, tools: s.tools };
}

export function watchView({ name, host, profile = {}, listen = {}, shelf = {}, channels = null, pulse = null, traffic = null, now = Date.now() }) {
  const people = peopleOf({ items: listen.items || [], themes: listen.themes || [], status: listen.status || {}, name, now });
  const onSite = new Map((channels?.found || []).map((c) => [c.platform, c.url]));
  const sell = shelfOf(shelf, now).map((x) => ({ ...x, onSite: onSite.get(x.id) || null })), rivals = rivalsOf({ profile, pulse, traffic }), show = showOf(profile);
  /* the read's marketplace listings (reader/stages/reviews.js), for platforms the weekly shelf doesn't already cover; one per platform */
  const MK = { amazon: 'Amazon', myntra: 'Myntra', flipkart: 'Flipkart', nykaa: 'Nykaa', walmart: 'Walmart', meesho: 'Meesho' }, seen = new Set(sell.filter((x) => x.at).map((x) => x.id));
  const pnum = (v) => { const m = String(v ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? +m[0] : null; }, same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const mk = (profile.marketplaces || []).map((m) => { const id = String(m.name || '').split('.')[0].toLowerCase(); return { id, label: MK[id] || m.name, logo: hostLogo(m.name), error: m.error || null,
    listings: [...new Map((m.listings || []).map((l) => [l.url || l.asin || l.title, { name: same(l.title, name) ? null : l.title, price: pnum(l.price), rating: l.rating || null, ratings: l.reviews || null, url: l.url || null }])).values()].slice(0, 4) }; })
    .filter((m) => { if (!(m.listings.length || m.error) || seen.has(m.id)) return false; seen.add(m.id); return true; });
  /* stores the brand's own site links to that Brew doesn't read on a shelf yet (Purplle, Tira, Walmart…): named, linked */
  const readIds = new Set([...sell.filter((x) => x.at).map((x) => x.id), ...mk.map((m) => m.id)]), STORE = { purplle: 'Purplle', tira: 'Tira', ajio: 'Ajio', meesho: 'Meesho', walmart: 'Walmart', target: 'Target', ulta: 'Ulta', sephora: 'Sephora', amazon: 'Amazon', flipkart: 'Flipkart', nykaa: 'Nykaa', myntra: 'Myntra', blinkit: 'Blinkit', zepto: 'Zepto', instamart: 'Instamart' };
  const alsoOn = (channels?.found || []).filter((c) => !readIds.has(c.platform)).map((c) => ({ id: c.platform, label: STORE[c.platform] || c.platform, url: c.url, logo: hostLogo(new URL(c.url).hostname) }));
  /* couldn't read: listening sources and shelves that failed this time (skipped and "not this kind of brand" are not failures) */
  const st = listen.status?.sources || {}, cant = [
    ...Object.entries(st).filter(([, v]) => v?.state === 'error').map(([k, v]) => ({ id: k, name: pname(k), at: day(v.at || listen.status?.at), why: clip(v.error || (v.notes || [])[0], 120) })),
    ...sell.filter((x) => x.error).map((x) => ({ id: x.id, name: x.label, at: x.errorAt, why: clip(x.error, 120), kept: x.at }))];
  const places = new Set([...people.places.map((p) => p.id), ...sell.filter((x) => x.at).map((x) => x.id), ...mk.map((m) => m.id), ...(show ? ['ai'] : []), ...(rivals.some((r) => r.liveAds != null) ? ['meta-ads'] : [])]);
  const cities = [...new Set(sell.map((x) => x.city).filter(Boolean))];
  return { name, host, at: new Date(now).toISOString(),
    header: { heard: people.total, places: places.size, rivals: rivals.length, cities: cities.length, cityNames: cities, logos: [...new Map([...people.places.slice(0, 6).map((p) => ({ name: p.name, logo: p.logo })), ...sell.filter((x) => x.listed).map((x) => ({ name: x.label, logo: x.logo }))].filter((l) => l.logo).map((l) => [l.logo, l])).values()].slice(0, 9) },
    people: people.total ? people : null, sell: sell.length || mk.length || alsoOn.length ? { shelves: sell, marketplaces: mk, alsoOn } : null, rivals: rivals.length ? rivals : null, show, cant };
}
