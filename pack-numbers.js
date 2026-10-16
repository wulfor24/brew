// One number, one source. The headline numbers a brand's screens show (the demo picker, the read, the check page,
// the moves page, the feed's watcher cards, the health rings, the brief) are worked out here, the same way for every
// brand, and nowhere else. brand-pack.js computes them once at load (pack.numbers, window.BREW_NUMBERS on the client)
// and heals a saved seed whose steps or rings quote an older value; the reader and the build call the same helpers.
//
//   ownAds      the brand's OWN live Meta ads, from the freshest real read of them: the read (profile.ads.own, healed
//               daily) or the daily own-ads tracker (research.json own). Never added to the rivals' ads.
//   rivalAds    the rivals' live ads, summed over the rivals whose ads were read; rivals whose read failed are counted
//               apart (failed), never as 0.
//   products    the catalog count from the freshest products.json read: the read (catalog.count, kept in step by the
//               daily check) or the catalog watcher (live-watch.json catalog).
//   moves       the playbook: status.total (moves-engine), never moves.json's length (that has the index 00 and the
//               weekly moves 1001+, which count apart as weekly).
//   ai          AI visibility: answers to shopper questions that do NOT name the brand (unbranded), with the all-answers
//               count kept beside it, labelled, for the screens that show both.
//   rivals      the one rival list (profile.rivals, as the check page edits it), each with its live ads from the freshest
//               read of its page: the read (profile.ads.rivals) or the daily story tracker (research.json ads.brands).
//   reviews     reviews and ratings on every platform the read found (site apps and marketplaces), with the site's own
//               apart; ratings: the marketplace listings (Amazon) with their weighted average.
//
// Every number carries `at`, the day it was read. Text that quotes one says the day ("664 live ads on 14 Oct",
// dateCounts), so an older number reads as dated, not wrong, beside a newer one on another screen.

/* the playbook, one count everywhere: every move the build writes (1-999), never the index (00) or cadence moves (1001+) */
export const isPlay = (n, mv) => Number.isInteger(+n) && +n >= 1 && +n < 1000 && !mv?.meta?.cadence;
export const playDone = (moves) => Object.entries(moves || {}).filter(([k, mv]) => isPlay(k, mv)).length;
/* its size: the applicable specs, saved as status.total by the moves engine; 50 until the engine has counted */
export const totalOf = (s) => +s?.total || 50;

const ts = (x) => (typeof x === 'number' ? x : Date.parse(x || '') || 0);
const squash = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const fresher = (...xs) => xs.filter(Boolean).sort((a, b) => b.at - a.at)[0] || null;

/** the brand's own live ads: { n, at, page, src: 'read' | 'tracker' } or { n: null, error } */
export function ownAds({ profile, research } = {}) {
  const o = profile?.ads?.own || {}, r = research?.own;
  const read = o.live != null && !o.error ? { n: +o.live, at: ts(profile.ads.at), page: o.page || null, src: 'read' } : null;
  /* the tracker reads the same page; one that found a different page is another brand's count, not a newer one */
  const tracker = r && r.live != null && !r.error && (!o.page || !r.page || squash(r.page) === squash(o.page)) ? { n: +r.live, at: ts(r.fetchedAt), page: r.page || null, src: 'tracker' } : null;
  return fresher(read, tracker) || { n: null, at: 0, page: o.page || null, error: o.error || r?.error || profile?.meta?.errors?.ads || null }; /* a whole ads stage that failed (meta.errors.ads) is an error too */
}

/** the one rival list: [{ name, host, page, live, at, src, error }]. Names come from profile.rivals (what the check page
    edits), live ads from the freshest read of that rival's page: the read or the story tracker (research.json ads.brands) */
export function rivals({ profile, research } = {}) {
  const ads = Array.isArray(profile?.ads?.rivals) ? profile.ads.rivals : [];
  const named = Array.isArray(profile?.rivals) && profile.rivals.length ? profile.rivals : ads;
  const tracked = Array.isArray(research?.ads?.brands) ? research.ads.brands : [];
  const readAt = ts(profile?.ads?.at);
  return named.filter((r) => r?.name).map((r) => {
    const a = ads.find((x) => (r.host && x.host === r.host) || squash(x.name) === squash(r.name)) || null;
    const read = a && !a.error && a.live != null ? { n: +a.live, at: readAt, page: a.page || null, src: 'read' } : null;
    /* the tracker's count for the same page (or the same name when the read found no page); one without a day is older than any read */
    const b = tracked.find((x) => (a?.page && x.page ? squash(x.page) === squash(a.page) : squash(x.name) === squash(r.name)));
    const tracker = b && b.live != null && !b.error ? { n: +b.live, at: ts(b.at), page: b.page || null, src: 'tracker' } : null;
    const best = fresher(read, tracker);
    return { name: r.name, host: r.host || a?.host || null, page: best?.page || a?.page || null, live: best ? best.n : null, at: best?.at || 0, src: best?.src || null,
      ...(best ? {} : a?.error ? { error: a.error } : {}) };
  });
}

/** the rivals' live ads: n over the rivals read, of = rivals named, failed = rivals whose ads could not be read */
export function rivalAds(x = {}) {
  const rs = rivals(x), read = rs.filter((r) => r.live != null);
  return { n: read.reduce((a, r) => a + (+r.live || 0), 0), of: rs.length, read: read.length, failed: rs.filter((r) => r.error).length,
    at: read.length ? Math.max(...read.map((r) => r.at || 0)) : 0, names: rs.map((r) => r.name) };
}

const MARKET = /amazon|flipkart|nykaa|myntra|walmart|ebay|etsy|tata ?cliq|meesho/i;
const readDay = (profile, status) => ts(profile?.reviews?.at) || ts(status?.stages?.read?.at) || ts(profile?.ads?.at) || 0;

/** reviews and ratings on every platform read: n = all of them (the read's total), site = the brand's own store apart */
export function reviews({ profile, status } = {}) {
  const rv = profile?.reviews || {}, ps = (rv.platforms || []).filter((x) => +x.count > 0);
  const site = ps.filter((x) => !MARKET.test(`${x.name} ${x.label || ''}`));
  const siteN = site.reduce((a, x) => a + +x.count, 0), siteW = site.reduce((a, x) => a + +x.count * (+x.rating || 0), 0), siteR = site.filter((x) => +x.rating).reduce((a, x) => a + +x.count, 0);
  const n = rv.total != null ? +rv.total || null : ps.length ? ps.reduce((a, x) => a + +x.count, 0) : null;
  return { n, at: n != null ? readDay(profile, status) : 0, platforms: ps.map((x) => ({ name: x.name, label: x.label || x.name, n: +x.count, rating: +x.rating || null })),
    site: siteN ? { n: siteN, rating: siteR ? siteW / siteR : null } : null, error: n == null ? rv.error || profile?.meta?.errors?.reviews || null : null }; /* a reviews stage that failed or timed out (meta.errors.reviews) is never "no reviews" */
}

/** marketplace ratings (Amazon and the like): [{ name, n, rating, listings }], from the same read as reviews */
export function ratings({ profile, status } = {}) {
  const at = readDay(profile, status);
  return (profile?.reviews?.platforms || []).filter((x) => +x.count > 0 && MARKET.test(`${x.name} ${x.label || ''}`)).map((x) => ({
    name: x.name, n: +x.count, rating: +x.rating || null, at,
    listings: +x.listings || +(String(x.label || '').match(/on (\d+) listings?/) || [])[1] || (profile?.marketplaces || []).find((m) => m.name === x.name)?.listings?.length || null }));
}

/** products in the catalog: { n, at, src: 'read' | 'watch' } */
export function products({ profile, liveWatch, daily, status } = {}) {
  const c = profile?.catalog || {};
  const n0 = c.count != null ? +c.count : Array.isArray(c.products) ? c.products.length : null;
  const read = n0 != null ? { n: n0, at: Math.max(ts(daily?.at), ts(status?.stages?.read?.at)), src: 'read' } : null;
  const w = liveWatch?.catalog;
  const watch = w && w.count != null && +w.count > 0 ? { n: +w.count, at: ts(w.fetchedAt), src: 'watch' } : null;
  return fresher(read, watch) || { n: null, at: 0 };
}

/** the moves: total = the playbook (status.total), written = playbook moves on file, weekly = cadence moves apart */
export function moves({ status, moves: mv } = {}) {
  const written = mv ? playDone(mv) : +status?.movesDone || 0;
  const weekly = mv ? Object.entries(mv).filter(([k, m]) => +k >= 1000 || m?.meta?.cadence).length : 0;
  /* a brand finished before the playbook had one count: its total is the moves it has */
  const total = +status?.total || (status?.done && written ? written : 50);
  return { total, written, weekly };
}

/** the time left on the moves, in minutes, from the pace the build really kept (status.paceAt: when each of the last moves
    of this run was saved), or null: no estimate before four moves of this run, while paused or stopped, or when the last
    move landed more than 20 minutes ago (a stall is not a countdown) */
export function movesEta(s, now = Date.now()) {
  if (!s || s.done || s.cancelled || s.capped || s.pausedDay) return null;
  const N = +s.total, n = +s.movesDone || 0, run = +s.stages?.moves?.at || 0;
  if (!N || n >= N || s.stages?.moves?.state !== 'running') return null;
  const ts = (Array.isArray(s.paceAt) ? s.paceAt : []).filter((t) => Number.isFinite(t) && t >= run).sort((a, b) => a - b);
  if (ts.length < 4) return null;
  const last = ts[ts.length - 1]; if (now - last > 20 * 60e3) return null;
  const per = (last - ts[0]) / (ts.length - 1); if (!(per > 0)) return null;
  return Math.max(1, Math.round(((N - n) * per - (now - last)) / 60e3));
}

/** AI visibility: the unbranded answers (questions that don't name the brand); all answers kept beside it */
export function ai({ profile } = {}) {
  const s = profile?.ai?.score || {};
  const hasU = s.unbrandedOf != null && +s.unbrandedOf > 0;
  return { named: hasU ? +s.unbrandedNamed || 0 : s.of ? +s.named || 0 : null, of: hasU ? +s.unbrandedOf : s.of ? +s.of : null, unbranded: hasU,
    all: s.of ? { named: +s.named || 0, of: +s.of } : null };
}

export function numbersOf(x = {}) {
  return { ownAds: ownAds(x), rivalAds: rivalAds(x), rivals: rivals(x), products: products(x), moves: moves(x), ai: ai(x), reviews: reviews(x), ratings: ratings(x) };
}

/* the files the numbers come from, read through any packs store (brand-pack.js, demo-routes.js, build.js) */
export async function numbersFor(getJSON, slug, have = {}) {
  const g = (f, d = null) => (have[f] !== undefined ? have[f] : getJSON(slug, f, d).catch(() => d));
  const [profile, status, mv, research, liveWatch, daily] = await Promise.all([g('profile.json'), g('status.json', {}), g('moves.json', {}), g('research.json'), g('live-watch.json'), g('facts-daily.json')]);
  return numbersOf({ profile, status, moves: mv, research, liveWatch, daily });
}

const big = (n) => Number(n || 0).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** the day a number was read, as text quotes it: "14 Oct" (UTC, so every screen and server says the same day) */
export const dayOf = (at) => { const t = ts(at); if (!t) return ''; const d = new Date(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const isoDay = (at) => { const t = ts(at); return t ? new Date(t).toISOString().slice(0, 10) : ''; };
const host = (h) => String(h || '').replace(/\./g, '-');

/** the current numbers as ledger rows (key | v | label | src | at): the moves, Ask Brew and the cards quote these, so a
    tracker's newer count replaces the read's older row of the same key, with its own day */
export function numberRows(N, name = 'The brand') {
  if (!N) return [];
  const rows = [], add = (key, label, n, at, src, unit) => { if (n == null || !Number.isFinite(+n)) return; rows.push({ key, label, v: big(n), n: +n, unit, layer: 'observed', src, at: isoDay(at), current: true }); };
  add('ads.own.live', `${name}: live Meta ads`, N.ownAds?.n, N.ownAds?.at, N.ownAds?.src === 'tracker' ? 'Meta Ad Library (daily own-ads read)' : 'Meta Ad Library', 'ads');
  for (const r of N.rivals || []) add(`rival.${host(r.host || r.name)}.ads.live`, `${r.name}: live Meta ads`, r.live, r.at, r.src === 'tracker' ? 'Meta Ad Library (daily rivals read)' : 'Meta Ad Library', 'ads');
  add('catalog.count', 'Products in the catalog', N.products?.n, N.products?.at, 'products.json', 'products');
  add('reviews.total', 'Reviews and ratings found (all platforms read)', N.reviews?.n, N.reviews?.at, 'site and marketplaces', 'reviews+ratings');
  for (const m of N.ratings || []) add(/amazon/i.test(m.name) ? 'reviews.amazon.count' : `reviews.${host(m.name)}.count`, `${m.name} ratings${m.listings ? ` across ${m.listings} listings` : ''}`, m.n, m.at, m.name, 'ratings');
  return rows;
}

/** a ledger with the current numbers laid over it: a row of the same key is replaced by the newer count. Only keys the
    ledger has: a fact the team removed (facts-desk) stays removed */
export function withNumbers(ledger = [], N, name) {
  const have = new Set((ledger || []).map((e) => e?.key)), cur = numberRows(N, name).filter((r) => have.has(r.key)), keys = new Set(cur.map((r) => r.key));
  return [...(ledger || []).filter((e) => !keys.has(e?.key)), ...cur.map((r) => { const old = ledger.find((e) => e?.key === r.key) || {}; return { ...old, ...r, label: old.label || r.label, src: /daily/.test(r.src) ? r.src : old.src || r.src }; })];
}

/** the counts that move from day to day, as "on 14 Oct" after each one a text quotes: "664 live ads" → "664 live ads on
    14 Oct". A count already dated, or one that isn't one of the brand's current numbers, is left alone */
export function dateCounts(text, N) {
  if (typeof text !== 'string' || !text || !N) return text;
  const items = [];
  const push = (n, at, units) => { if (n == null || !at || !(+n > 0)) return; items.push({ n: +n, day: dayOf(at), units }); };
  push(N.ownAds?.n, N.ownAds?.at, 'live (?:Meta )?ads|ads running|ads');
  for (const r of N.rivals || []) push(r.live, r.at, 'live (?:Meta )?ads|ads running|ads');
  if (N.rivalAds?.read > 1) push(N.rivalAds.n, N.rivalAds.at, 'live (?:Meta )?ads|ads');
  push(N.products?.n, N.products?.at, 'products|SKUs|items');
  push(N.reviews?.n, N.reviews?.at, 'reviews(?: and ratings)?|ratings');
  for (const m of N.ratings || []) push(m.n, m.at, 'ratings|reviews');
  let out = text;
  for (const { n, day, units } of items) {
    const num = `(?:${big(n).replace(/,/g, ',?')}|${n})`;
    const re = new RegExp(`(?<![\\d.,₹$€£])(${num}\\s+(?:[A-Za-z’']+\\s+){0,2}?(?:${units}))\\b(?!\\s*(?:\\(|on \\d|as of|read|in the last|a day|per|on (?:${MON.join('|')})|\\d{1,2} (?:${MON.join('|')})))`, 'g');
    out = out.replace(re, (m) => `${m} on ${day}`);
  }
  return out;
}

/** the numbers as fact lines with their day, for prompts: "- Acme: live Meta ads: 1,296 (read 15 Oct)" */
export function numberLines(N, name) {
  return numberRows(N, name).map((r) => `- ${r.label}: ${r.v} (read ${dayOf(r.at)})`).join('\n');
}

/** the read's ad step, in words: the brand's own ads and the rivals' are never added together */
export function adsStepLine(N, name = 'You') {
  const o = N.ownAds, r = N.rivalAds, parts = [];
  parts.push(o.n != null ? `${name}: ${big(o.n)} live ads` : o.error ? `${name}: couldn’t check` : `${name}: no ad page found`);
  if (!r.of) parts.push('rivals not identified');
  else if (r.read) parts.push(`${r.of} rival${r.of === 1 ? '' : 's'}: ${big(r.n)} live ads${r.failed ? ` (${r.failed} couldn’t be read)` : ''}`);
  else parts.push(`${r.of} rival${r.of === 1 ? '' : 's'}: ${r.failed ? 'ads couldn’t be read' : 'no live ads'}`);
  return parts.join(' · ');
}

/** the read's reviews step and the reviews finding's caption, in words, from the one count */
export const reviewsStepLine = (N) => (N.reviews?.n != null ? `${big(N.reviews.n)} reviews and ratings` : null);
export const reviewsCap = (N) => (N.reviews?.platforms?.length ? N.reviews.platforms.map((p) => `${big(p.n)} ${p.label}${p.rating ? ` (${p.rating.toFixed(1)}★)` : ''}`).join(' · ') + '.' : null);

/** a saved seed made before these rules: its read steps and the ads finding quote the numbers again from here */
export function healSeedNumbers(seed, N, name) {
  if (!seed || !N) return false;
  let changed = false;
  for (const s of seed.steps || []) {
    if (s.k === 'ads') { const line = adsStepLine(N, name); if (s.done !== line) { s.done = line; changed = true; } }
    if (s.k === 'reviews') { const line = reviewsStepLine(N); if (line && s.done !== line) { s.done = line; changed = true; } }
  }
  /* the reviews finding's caption: the platforms and counts of the same read the check page and the picker show */
  const cap = reviewsCap(N);
  for (const c of seed.scrape || []) {
    if (c.k !== 'reviews' || typeof c.cap !== 'string' || !cap) continue;
    /* the caption is the platforms line, then at most the note the reader adds when no review text could be read */
    const tail = (c.cap.match(/\s(No review text could be read\.)$/) || [])[1];
    const f = /^\d/.test(c.cap) ? `${cap}${tail ? ` ${tail}` : ''}` : c.cap;
    if (f !== c.cap) { c.cap = f; changed = true; }
  }
  const ownLine = N.ownAds.n != null ? `${name}: ${big(N.ownAds.n)} live ads.` : '';
  const re = new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: [\\d,]+ live ads\\.\\s*`);
  for (const c of seed.scrape || []) {
    if (c.kind !== 'ad' || typeof c.foot !== 'string') continue;
    if (re.test(c.foot)) { const f = c.foot.replace(re, ownLine ? ownLine + ' ' : '').trim(); if (f !== c.foot) { c.foot = f; changed = true; } }
    if (typeof c.copy === 'string' && re.test(c.copy)) { const f = c.copy.replace(re, ownLine ? ownLine + ' ' : '').trim(); if (f !== c.copy) { c.copy = f; changed = true; } }
  }
  if (seed.brand && N.products.n != null && String(seed.brand.products) !== String(N.products.n)) { seed.brand.products = String(N.products.n); changed = true; }
  return changed;
}
