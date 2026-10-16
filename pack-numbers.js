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
  return fresher(read, tracker) || { n: null, at: 0, page: o.page || null, error: o.error || r?.error || null };
}

/** the rivals' live ads: n over the rivals read, of = rivals named, failed = rivals whose ads could not be read */
export function rivalAds({ profile } = {}) {
  const rs = Array.isArray(profile?.ads?.rivals) ? profile.ads.rivals : [];
  const read = rs.filter((r) => !r.error && r.live != null);
  return { n: read.reduce((a, r) => a + (+r.live || 0), 0), of: (profile?.rivals || rs).length, read: read.length, failed: rs.filter((r) => r.error).length };
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
  return { ownAds: ownAds(x), rivalAds: rivalAds(x), products: products(x), moves: moves(x), ai: ai(x) };
}

/* the files the numbers come from, read through any packs store (brand-pack.js, demo-routes.js, build.js) */
export async function numbersFor(getJSON, slug, have = {}) {
  const g = (f, d = null) => (have[f] !== undefined ? have[f] : getJSON(slug, f, d).catch(() => d));
  const [profile, status, mv, research, liveWatch, daily] = await Promise.all([g('profile.json'), g('status.json', {}), g('moves.json', {}), g('research.json'), g('live-watch.json'), g('facts-daily.json')]);
  return numbersOf({ profile, status, moves: mv, research, liveWatch, daily });
}

const big = (n) => Number(n || 0).toLocaleString('en-IN');

/** the read's ad step, in words: the brand's own ads and the rivals' are never added together */
export function adsStepLine(N, name = 'You') {
  const o = N.ownAds, r = N.rivalAds, parts = [];
  parts.push(o.n != null ? `${name}: ${big(o.n)} live ads` : o.error ? `${name}: couldn’t check` : `${name}: no ad page found`);
  if (!r.of) parts.push('rivals not identified');
  else if (r.read) parts.push(`${r.of} rival${r.of === 1 ? '' : 's'}: ${big(r.n)} live ads${r.failed ? ` (${r.failed} couldn’t be read)` : ''}`);
  else parts.push(`${r.of} rival${r.of === 1 ? '' : 's'}: ${r.failed ? 'ads couldn’t be read' : 'no live ads'}`);
  return parts.join(' · ');
}

/** a saved seed made before these rules: its read steps and the ads finding quote the numbers again from here */
export function healSeedNumbers(seed, N, name) {
  if (!seed || !N) return false;
  let changed = false;
  for (const s of seed.steps || []) {
    if (s.k === 'ads') { const line = adsStepLine(N, name); if (s.done !== line) { s.done = line; changed = true; } }
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
