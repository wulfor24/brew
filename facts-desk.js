// The fact sheet, any time: every fact Brew may quote for a brand, grouped, each with its value, source and date read.
// The team corrects it with choices or a pasted link Brew reads (never a typed number), a free daily check keeps prices
// and stock in line with the store's public products.json, and connected accounts become the source of truth for what
// they measure (members only). Every change rebuilds facts.json, is recorded in facts-edits.json ({ at, by, what }),
// flags the moves that quote the old value as out of date, and reloads the pack so cards and the fact gate use it at once.
import { keyOf } from './derive.js';
import { numbersIn, canon } from './fact-gate.js';
import { moneyFmt } from './brand-pack.js';
import { simulated } from './connectors/common.js';
import { dejargon } from './plain.js';
import { productFromPage, offeringFromPage } from './reader/products.js';

const D = 864e5, today = () => new Date().toISOString().slice(0, 10);
const NOT_PRODUCT = /gift ?wrap|gift ?card|e-?gift|shipping protection|route protection|insurance|sample|tester|donation/i;
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Brew-facts-check/1; +https://brew.joinsquareup.com)' };
const hostOf = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const same = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const numOf = (f) => (Number.isFinite(f?.n) ? f.n : (() => { const m = String(f?.v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; })());

/* ---------- groups ---------- */
export const GROUPS = [['who', 'Who you are'], ['products', 'Products and prices'], ['rivals', 'Rivals'], ['reviews', 'Reviews and ratings'], ['socials', 'Socials and ads'], ['market', 'Market'], ['accounts', 'From your connected accounts']];
const PREFIX = [['products', /^(price|mrp|catalog|product|shopify)\./], ['rivals', /^rival\./], ['reviews', /^reviews?\./], ['socials', /^(social|socials|ads|meta)\./], ['market', /^(market|search|ai|ga4|gads|klaviyo)\./], ['who', /^(brand|company|shop|site|checkout|policy|claim)\./]];
export const groupOf = (k, f, rivalsRe = null) => f.connected && !f.was ? 'accounts' : f.key ? (PREFIX.find(([, re]) => re.test(f.key)) || ['who'])[0] : 'who';
const SHOWN = (f) => f && f.label && !['demo', 'assumption', 'proposed'].includes(f.kind) && !f.demo;

/* ---------- connected accounts: the source of truth for what they measure ---------- */
export const TOOL = { shopify: 'Shopify', meta: 'Meta Ads', ga4: 'Google Analytics', gads: 'Google Ads', klaviyo: 'Klaviyo', reviews: 'Judge.me', market: 'Marketplaces' };
export const toolOf = (key) => { const p = String(key).split('.')[0]; return p === 'reviews' && /^reviews\.judgeme\./.test(key) ? 'reviews' : TOOL[p] ? p : null; };
/* a connected number beats the site read of the same thing; the site's fact is kept as `was` */
export const PRECEDENCE = { 'meta.ads.live': ['ads.own.live'], 'reviews.judgeme.total': ['reviews.judgeme.count', 'reviews.total'], 'reviews.judgeme.rating.recent': ['reviews.judgeme.rating', 'reviews.rating'],
  'shopify.products.active': ['catalog.count'], 'shopify.products.out_of_stock': ['catalog.out_of_stock'], 'market.amazon.listings': ['reviews.amazon.listings'] };
/* connected ledger entries → facts (same shape as factsFromLedger). Demo accounts never count as true. */
export function connectedFacts(entries = [], publicFacts = {}) {
  const F = {}, byKey = new Map(Object.entries(publicFacts).map(([k, f]) => [f.key || k, [k, f]]));
  for (const e of entries || []) {
    if (!e || simulated(e) || e.v == null || e.v === '') continue; // DUMMY: simulated accounts are never the source of truth
    const tool = toolOf(e.key); if (!tool) continue;
    /* a stale account (it kept failing, or its last read is too old) no longer beats the site's number: shown apart, marked */
    const over = e.stale ? null : (PRECEDENCE[e.key] || []).map((k) => byKey.get(k)).find(Boolean);
    const k = over ? over[0] : keyOf(e.key);
    F[k] = { v: String(e.v), ...(Number.isFinite(e.n) ? { n: e.n } : {}), label: over ? over[1].label : e.label || e.key, src: `${TOOL[tool]} (connected)`, account: e.src || null, at: e.at, kind: 'connected', connected: tool, key: e.key,
      ...(over ? { was: { key: over[1].key || over[0], v: over[1].v, src: over[1].src, at: over[1].at } } : {}), ...(e.stale ? { stale: true, staleWhy: e.staleWhy || null } : {}) };
  }
  return F;
}
/* the sheet a member sees: public facts with the connected ones laid over them */
export const mergeSheet = (pub = {}, priv = {}) => ({ ...pub, ...priv });
/* connected facts that moved materially away from the site's number (10% or more, or a different word) */
export const overrides = (priv = {}) => Object.values(priv).filter((f) => f.was && (() => { const a = numOf(f.was), b = numOf(f); return a != null && b != null ? Math.abs(b - a) / Math.max(Math.abs(a), 1) >= 0.1 : !same(f.was.v, f.v); })());

/* ---------- the free daily price and stock check ---------- */
// products.json items → { handle, title, price, mrp, inStock, url, img, published }
export const storeItems = (products = [], host) => products.filter((p) => p && p.handle && !NOT_PRODUCT.test(p.title || '')).map((p) => { const vs = p.variants || [], v = vs[0] || {}, price = +v.price || 0;
  return { handle: p.handle, title: String(p.title || '').replace(/\s+/g, ' ').trim(), price, mrp: Math.max(+v.compare_at_price || 0, price), inStock: vs.some((x) => x.available), url: `https://${host}/products/${p.handle}`, img: p.images?.[0]?.src || null, published: p.published_at || null }; });
const handleOf = (key) => String(key).replace(/^(price|mrp)\./, '');
/* the fact's source: the product's own page (host + path), whatever the platform's URL shape */
const srcOf = (x, host) => { try { const u = new URL(x.url); return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch { return `${hostOf(host)}/products/${x.handle}`; } };
// a generated brand: ledger price entries vs the store → the new ledger and what changed
/* partial: a page-by-page check (any platform but Shopify): only the products read are compared, and a product is gone
   only when its page answered 404/410 (gone: the handles), never because one fetch failed */
export function diffCatalog(ledger = [], items = [], { host, currency = 'USD', locale = 'en-US', at = today(), removedByBrand = [], tombs = [], partial = false, gone404 = [] } = {}) {
  const by = new Map(items.map((x) => [x.handle, x])), money = moneyFmt(currency, locale), gone = new Set(removedByBrand || []), changes = [], out = [];
  const ours = (e) => /^(price|mrp)\./.test(e.key) && (!e.url || hostOf(e.url) === hostOf(host));
  const tomb = (k, v) => (tombs || []).some((t) => t.key === k && same(t.v, v));
  for (const e of ledger) {
    if (!ours(e)) { out.push(e); continue; }
    const x = by.get(handleOf(e.key));
    if (!x && partial && !gone404.includes(handleOf(e.key))) { out.push(e); continue; }
    if (!x) { changes.push({ kind: 'removed', key: e.key, handle: handleOf(e.key), label: e.label || e.key, was: String(e.v), wasN: e.n, src: e.url || e.src }); continue; }
    const n = e.key.startsWith('mrp.') ? x.mrp : x.price;
    /* a price 50 times higher or lower in one day is a unit slip in the read (cents for dollars), never a real change: skipped (QA 20 Oct) */
    if (Number.isFinite(e.n) && e.n > 0 && n > 0 && (n / e.n >= 50 || e.n / n >= 50)) { out.push(e); continue; }
    if (Number.isFinite(e.n) && n > 0 && Math.abs(n - e.n) >= 0.01) { const v = money(n); changes.push({ kind: 'changed', key: e.key, handle: x.handle, label: e.label || e.key, was: String(e.v), wasN: e.n, now: v, nowN: n, src: x.url });
      out.push({ ...e, v, n, at, src: srcOf(x, host), url: x.url, method: e.method && /added by the brand/.test(e.method) ? e.method : 'product list (daily check)' }); }
    else out.push(e);
  }
  const have = new Set(ledger.filter(ours).map((e) => handleOf(e.key)));
  for (const x of items) { if (partial || have.has(x.handle) || gone.has(x.handle) || !(x.price > 0)) continue; const v = money(x.price); if (tomb(`price.${x.handle}`, v)) continue;
    const e = { key: `price.${x.handle}`, label: `${x.title} price`, v, n: x.price, unit: currency, layer: 'observed', src: `${hostOf(host)}/products/${x.handle}`, url: x.url, at, method: 'product list (daily check)' };
    out.push(e); changes.push({ kind: 'new', key: e.key, handle: x.handle, label: e.label, now: v, nowN: x.price, src: x.url, item: x }); }
  return { ledger: out, changes, gone: [...new Set(changes.filter((c) => c.kind === 'removed').map((c) => c.handle))] };
}

/* ---------- which moves quote a changed fact (no paid call: the old value or the product's name in the move) ---------- */
const textOf = (m) => JSON.stringify([m?.title, m?.stat, m?.gives, m?.sections || []]).toLowerCase();
export function quotedBy(changes = [], moves = {}) {
  const hits = {};
  for (const [n, m] of Object.entries(moves || {})) {
    if (!m || +n === 0) continue; const t = textOf(m), nums = new Set(numbersIn(t, { strict: true })), used = new Set(m.factsUsed || []);
    for (const c of changes) {
      const thing = String(c.label || '').replace(/,?\s*(list price|discount off list|price|mrp)\s*$/i, '').split(':').pop().trim().toLowerCase();
      const wasNums = c.was != null ? numbersIn(String(c.was), { strict: true }) : [];
      const quotesWas = wasNums.length ? wasNums.some((x) => nums.has(x)) : c.was != null && String(c.was).trim().length >= 3 && t.includes(String(c.was).toLowerCase().trim());
      const names = thing.length >= 4 && t.includes(thing), distinct = c.was != null && !/^\d{1,2}(\.\d)?%?$/.test(String(c.was).trim());
      const productPrice = /^(price|mrp)[._]|_mrp$/.test(c.ledgerKey || c.key) || /\/products\//.test(String(c.src || '')); /* a price ten products share only counts where the move names this one */
      /* a small number ("18") counts only right next to a word of its label ("18 live ads") */
      const near = !distinct && c.was != null && String(c.label || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3).some((w) => t.includes(`${String(c.was).toLowerCase().trim()} ${w}`));
      const hit = used.has(c.ledgerKey || c.key) || (c.kind === 'removed' ? names || ((quotesWas && distinct || near) && !productPrice) : (quotesWas && distinct || near) && (names || !productPrice));
      if (hit) (hits[n] ||= []).push(c);
    }
  }
  return hits;
}
export const changeText = (c) => c.kind === 'new' ? `New: ${c.label}: ${c.now}` : c.kind === 'removed' ? `Gone: ${c.label} (was ${c.was})` : `${c.label}: ${c.was} → ${c.now}`;
const REASON = { team: (c) => c.kind === 'removed' ? `The team removed ${c.label} (was ${c.was}).` : `The team corrected ${c.label}: ${c.was} is now ${c.now}.`,
  daily: (c) => c.kind === 'removed' ? `${c.label.replace(/ price$/i, '')} is no longer on the store.` : c.kind === 'new' ? `${c.label.replace(/ price$/i, '')} launched at ${c.now}.` : `The store changed ${c.label}: ${c.was} is now ${c.now}.`,
  connected: (c) => `${c.label} is now read from your connected ${c.tool}: ${c.now}${c.was ? ` (the site said ${c.was})` : ''}.` };

/* ---------- the desk ---------- */
export function createFactsDesk({ packs, builder, ai = null, onPack = async () => {}, fetchImpl = (...a) => fetch(...a), log = console }) {
  let lock = Promise.resolve(); /* one change at a time: ledger, profile, patch and edits are read-modify-written */
  const serial = (f) => (lock = lock.then(f, f));
  const editsOf = async (slug) => ({ edits: [], removed: [], retired: [], ...((await packs.getJSON(slug, 'facts-edits.json', null)) || {}) });
  async function record(slug, list, { by, retire = [], tombs = [] } = {}) {
    if (!list.length && !retire.length && !tombs.length) return;
    const E = await editsOf(slug), at = Date.now();
    E.edits = [...list.map((what) => ({ at, by: by || 'the team', what })), ...E.edits].slice(0, 500);
    E.removed = [...tombs.map((t) => ({ ...t, at, by: by || 'the team' })), ...E.removed].slice(0, 500);
    E.retired = [...new Set([...retire.flatMap((v) => numbersIn(String(v), { strict: true })), ...(E.retired || [])])].slice(0, 400);
    await packs.put(slug, 'facts-edits.json', E);
  }
  /* moves that quote what changed: flagged out of date with the reason; private flags (connected accounts) for the team only */
  async function flag(slug, changes, how, { priv = false } = {}) {
    if (!changes.length) return [];
    const pack = await packs.load(slug).catch(() => null);
    const moves = { ...(pack?.moveDocs || (await packs.getJSON(slug, 'moves.json', {}))), ...(priv ? await packs.getJSON(slug, 'private/moves.json', {}) : {}) };
    const hits = quotedBy(changes, moves), ns = Object.keys(hits).map(Number);
    if (ns.length && builder?.flagStale) await builder.flagStale(slug, ns.map((n) => ({ n, priority: 'high', why: hits[n].map(REASON[how]).slice(0, 2).join(' '), changes: hits[n].slice(0, 6).map(changeText), via: how === 'connected' ? 'facts-connected' : 'facts', ...(priv ? { private: true } : {}) })));
    return ns;
  }
  const reload = async (slug) => { packs.drop(slug); await onPack(slug); };
  /* the brand's current sheet from facts.json; members get connected facts laid over */
  async function sheet(slug, { member = false } = {}) {
    const p = await packs.load(slug, { fresh: true }); if (!p) return null;
    const pub = p.facts || {}, pf = member ? await packs.getJSON(slug, 'private/facts.json', null) : null;
    return { p, pub, priv: pf?.facts || {}, merged: mergeSheet(pub, pf?.facts || {}), syncedAt: pf?.tools || {} };
  }
  async function view(slug, { member = false, canEdit = false } = {}) {
    const s = await sheet(slug, { member }); if (!s) return { error: 'unknown brand' };
    const E = await editsOf(slug), daily = await packs.getJSON(slug, 'facts-daily.json', null);
    const ledger = await packs.getJSON(slug, 'ledger.json', []), lk = new Map(ledger.map((e) => [keyOf(e.key), e]));
    const row = ([k, f]) => { const e = lk.get(k) || {}, url = f.url || e.url || (f.src && /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(f.src) ? 'https://' + f.src : /^https?:/.test(f.src || '') ? f.src : null);
      const kind = f.connected ? 'connected' : /^price\.|^mrp\./.test(f.key || '') ? 'price' : /^rival\./.test(f.key || '') || f.kind === 'competitor' ? 'rival' : /^(social|socials)\.instagram/.test(f.key || '') ? 'instagram' : /^ads\.own/.test(f.key || '') ? 'adpage' : /^reviews?\./.test(f.key || '') ? 'reviews' : 'doc';
      return { k, key: f.key || k, label: dejargon(f.label), v: f.v, src: dejargon(f.src) || null, url, /* plain words on every fact row (QA FEED-ARV-06): no products.json, custom pixel sandbox */ at: String(f.at || '').slice(0, 16), group: groupOf(k, f, s.p.rivalsRe), kind, by: /brand|added by the brand/.test(e.method || '') ? 'team' : f.connected ? 'connected' : /daily check/.test(e.method || '') ? 'daily' : 'read',
        ...(f.connected ? { tool: TOOL[f.connected], syncedAt: f.at, was: f.was || null, ...(f.stale ? { stale: true, staleWhy: f.staleWhy || null } : {}) } : {}), canRemove: canEdit && !f.connected && f.kind !== 'derived', canLink: canEdit && !f.connected && f.kind !== 'derived' }; };
    const rows = Object.entries(s.merged).filter(([, f]) => SHOWN(f)).map(row);
    const groups = GROUPS.map(([k, name]) => ({ k, name, rows: rows.filter((r) => r.group === k) })).filter((g) => g.rows.length);
    const anon = (e) => (member || !/@/.test(e.by || '') ? e : { ...e, by: 'The team' }); /* a visitor never sees who on the team made a change */
    let choices = null;
    if (canEdit) { const d = await builder.checkData(slug).catch(() => null); if (d && !d.error) choices = { products: d.products, rivals: d.rivals, market: d.who.filter((x) => ['country', 'currency', 'category'].includes(x.key)) }; }
    return { name: s.p.name, host: s.p.host, canEdit, member, total: rows.length, groups, choices, edits: E.edits.slice(0, 30).map(anon), removed: E.removed.slice(0, 30).map(anon), daily: daily ? { at: daily.at, summary: daily.summary } : null };
  }

  /* ---------- edits ---------- */
  // a product page link → title, price, photo (Shopify .js first; the builder's reader does JSON-LD and the photo)
  async function readProductLink(slug, url, cur) {
    if (builder?.readProduct) return builder.readProduct(slug, url);
    const u = String(url).split('?')[0].replace(/\/$/, ''); const r = await fetchImpl(u + '.js', { headers: UA, signal: AbortSignal.timeout(20e3) });
    if (!r.ok) throw new Error('That page did not show a product.'); const j = await r.json(); if (!j?.title) throw new Error('That page did not show a product.');
    return { handle: u.split('/').pop(), title: j.title, price: (j.price || 0) / 100, mrp: Math.max((j.compare_at_price || 0) / 100, (j.price || 0) / 100), currency: cur, url: u };
  }
  // any other fact: read the page and take the value only if the page itself shows it
  async function readFactLink(url, f) {
    const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(25e3) }); if (!r.ok) throw new Error(`That page did not open (${r.status}).`);
    const text = String(await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    let v = null;
    if (ai) try { const j = (await ai.call({ model: 'sonnet', max: 300, tag: 'facts-link', schema: { type: 'object', properties: { value: { type: 'string', description: 'the value exactly as the page writes it, or empty when the page does not say' } } },
      prompt: `What does this page say for "${f.label}"? Copy the value exactly as written on the page. Empty if it does not say.\n\nPAGE (${url}):\n${text.slice(0, 30000)}` })).json; v = String(j?.value || '').trim(); } catch (e) { if (!e.mock) log.warn('[facts] link read', e.message); }
    if (v && !text.toLowerCase().includes(v.toLowerCase())) v = null; /* the page must show it, word for word */
    if (!v && text.toLowerCase().includes(String(f.v).toLowerCase())) v = String(f.v);
    if (!v) throw new Error('We could not find it on that page. If it is wrong, use Not true any more.');
    const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return { v, ...(m ? { n: +m[0] } : {}) };
  }
  async function edit(slug, b = {}, { by = 'the team' } = {}) {
    return serial(async () => editGenerated(slug, b, by));
  }
  async function editGenerated(slug, b, by) {
    const at = today(), L = await packs.getJSON(slug, 'ledger.json', null), P = await packs.getJSON(slug, 'profile.json', null);
    if (!L || !P) return { error: 'This brand is not read yet.' };
    const facts = await packs.getJSON(slug, 'facts.json', {}), f = b.key ? facts[b.key] : null;
    const notes = [], changes = [], what = [], retire = [], tombs = [];
    if (b.action === 'remove' || b.action === 'link') {
      if (!f) return { error: 'That fact is not on the sheet any more.' };
      const mine = (e) => keyOf(e.key) === b.key, old = L.filter(mine);
      if (b.action === 'remove') {
        await packs.put(slug, 'ledger.json', L.filter((e) => !mine(e)));
        changes.push({ kind: 'removed', key: b.key, ledgerKey: f.key, label: f.label, was: f.v }); what.push(`Removed ${f.label} (was ${f.v})`); retire.push(f.v); tombs.push(...old.map((e) => ({ key: e.key, v: e.v, label: e.label, src: e.url || e.src })));
      } else {
        const url = String(b.url || '').trim(); if (!/^https?:\/\/\S+\.\S+/.test(url)) return { error: 'Paste a full link, starting with https://' };
        const k0 = f.key || b.key, fresh = [];
        try {
          if (/^(price|mrp)\./.test(k0)) { const x = await readProductLink(slug, url, P.currency); if (!x.price) throw new Error('That page did not show a price.');
            const money = moneyFmt(x.currency || P.currency, P.locale), v = money(x.price);
            fresh.push({ key: `price.${x.handle}`, label: `${x.title} price`, v, n: x.price, unit: x.currency || P.currency, layer: 'observed', src: hostOf(url) + new URL(x.url || url).pathname, url: x.url || url, at, method: 'product page (added by the brand)' });
            P.catalog ||= {}; const was = handleOf(k0); P.catalog.products = [{ ...((P.catalog.products || []).find((y) => y.handle === was) || {}), ...x, priceLabel: v }, ...(P.catalog.products || []).filter((y) => y.handle !== was && y.handle !== x.handle)];
            if (was !== x.handle) P.catalog.hero = (P.catalog.hero || []).map((h) => (h === was ? x.handle : h)); }
          else if (/^rival\./.test(k0) && builder?.readRival) { const hk = k0.split('.')[1], r = await builder.readRival(url, P);
            P.rivals = [...(P.rivals || []).filter((x) => String(x.host).replace(/\./g, '-') !== hk && x.host !== r.host), r];
            fresh.push({ key: `rival.${r.host.replace(/\./g, '-')}.found`, label: `Rival: ${r.name}`, v: r.host, layer: 'observed', src: r.host, url: r.url, at, method: 'brand-confirmed' },
              ...r.prices.map((x, i) => ({ key: `rival.${r.host.replace(/\./g, '-')}.price.${i + 1}`, label: `${r.name}: ${x.title}`, v: moneyFmt(P.currency, P.locale)(x.price), n: x.price, unit: P.currency, layer: 'observed', src: r.host, url: x.url, at, method: 'products.json' })));
            L.splice(0, L.length, ...L.filter((e) => !String(e.key).startsWith(`rival.${hk}.`))); }
          else if (/^(social|socials)\.instagram|^ads\.own|^reviews?\./.test(k0) && builder?.applyCheck) {
            const kind = /instagram/.test(k0) ? 'instagram' : /^ads/.test(k0) ? 'adpage' : 'reviews';
            const r = await builder.applyCheck(slug, { sources: { [kind]: url } }); if (r?.error) throw new Error(r.error); (r?.notes || []).forEach((x) => notes.push(x));
            const L2 = await packs.getJSON(slug, 'ledger.json', []), P2 = await packs.getJSON(slug, 'profile.json', {}); L.splice(0, L.length, ...L2); Object.assign(P, P2); }
          else { const x = await readFactLink(url, f); fresh.push({ ...(old[0] || { key: k0, label: f.label }), v: x.v, ...(x.n != null ? { n: x.n } : {}), layer: 'observed', src: hostOf(url) + (new URL(url).pathname === '/' ? '' : new URL(url).pathname), url, at, method: 'brand-confirmed' }); }
        } catch (e) { return { error: e.message || 'We could not read that link.' }; }
        const keep = L.filter((e) => !mine(e) && !fresh.some((x) => x.key === e.key));
        await packs.put(slug, 'ledger.json', [...keep, ...fresh]); await packs.put(slug, 'profile.json', P);
        const now = fresh.find((x) => keyOf(x.key) === b.key) || fresh[0];
        if (now && !same(now.v, f.v)) { changes.push({ kind: 'changed', key: b.key, ledgerKey: f.key, label: f.label, was: f.v, now: now.v }); retire.push(f.v); }
        what.push(`Read ${f.label} from ${url}${now ? `: ${now.v}` : ''}`);
      }
    } else if (b.action === 'choices') {
      const body = {}; if (Array.isArray(b.hero)) body.hero = b.hero.map(String).slice(0, 12); if (Array.isArray(b.removed)) body.removed = b.removed.map(String).slice(0, 50);
      if (Array.isArray(b.removeRivals)) body.removeRivals = b.removeRivals.map(String).slice(0, 20); if (Array.isArray(b.addRivals)) body.addRivals = b.addRivals.map(String).slice(0, 6); if (Array.isArray(b.addProducts)) body.addProducts = b.addProducts.map(String).slice(0, 6);
      if (b.who && typeof b.who === 'object') body.who = Object.fromEntries(Object.entries(b.who).filter(([k]) => ['country', 'currency', 'category'].includes(k)).map(([k, v]) => [k, String(v || '').slice(0, 80)]));
      const before = facts, r = await builder.applyCheck(slug, body); if (r?.error) return { error: r.error }; (r?.notes || []).forEach((x) => notes.push(x));
      for (const h of body.removed || []) { const gone = Object.entries(before).filter(([, x]) => /^(price|mrp)\./.test(x.key || '') && handleOf(x.key) === h);
        gone.forEach(([k, x]) => { changes.push({ kind: 'removed', key: k, ledgerKey: x.key, label: x.label, was: x.v }); retire.push(x.v); }); what.push(`Removed the product ${h}`); }
      if (body.hero) what.push(`Hero products: ${body.hero.join(', ') || 'none'}`); (body.removeRivals || []).forEach((h) => what.push(`Removed the rival ${h}`)); (body.addRivals || []).forEach((u) => what.push(`Added the rival ${u}`));
      (body.addProducts || []).forEach((u) => what.push(`Added the product ${u}`)); Object.entries(body.who || {}).forEach(([k, v]) => what.push(`${k[0].toUpperCase() + k.slice(1)}: ${v}`));
      for (const h of body.removeRivals || []) { const hk = h.replace(/\./g, '-'); Object.entries(before).filter(([, x]) => String(x.key || '').startsWith(`rival.${hk}.`)).forEach(([k, x]) => changes.push({ kind: 'removed', key: k, ledgerKey: x.key, label: x.label, was: x.v })); }
    } else return { error: 'Unknown change.' };
    await builder.republish(slug);
    await record(slug, what, { by, retire, tombs });
    const flagged = await flag(slug, changes, 'team');
    await reload(slug);
    log.log?.(`[facts] ${slug}: ${what.join('; ').slice(0, 200)} · ${flagged.length} moves flagged`);
    return { ok: true, notes, flagged, data: await view(slug, { member: true, canEdit: true }) };
  }

  /* ---------- the daily price and stock check ---------- */
  async function readStore(host, catalogUrl) {
    const url = catalogUrl || `https://${host}/products.json`, products = [];
    for (let page = 1; page <= 8; page++) {
      const r = await fetchImpl(`${url}?limit=250&page=${page}`, { headers: UA, signal: AbortSignal.timeout(30e3) });
      if (r.status === 404 || r.status === 403) return null; if (!r.ok) throw new Error(`products.json ${r.status}`);
      const j = await r.json().catch(() => null); if (!j || !Array.isArray(j.products)) return null; /* not a Shopify store */
      products.push(...j.products); if (j.products.length < 250) break;
    }
    return products;
  }
  /* any other platform: the product pages the read saved, opened again (30 at most); a page that 404s is gone, a failed fetch is
     left as it was. Returns { items, gone404, failed } */
  async function readStoreGeneric(P) {
    const list = (P.catalog?.products || []).filter((x) => x.url && !x.addedByBrand).slice(0, 30), items = [], gone404 = []; let failed = 0;
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async (x) => {
      try { const r = await fetchImpl(x.url, { headers: UA, signal: AbortSignal.timeout(25e3) }); if (r.status === 404 || r.status === 410) { gone404.push(x.handle); return; } if (!r.ok) { failed++; return; }
        const html = await r.text(); const it = (x.kind === 'offering' ? offeringFromPage(html, x.url) : productFromPage(html, x.url)); if (!it) { failed++; return; }
        items.push({ handle: x.handle, title: it.title || x.title, price: it.price || 0, mrp: Math.max(it.mrp || 0, it.price || 0), inStock: it.inStock ?? x.inStock ?? null, url: x.url, img: it.images?.[0] || null, published: null }); }
      catch { failed++; } }));
    return { items, gone404, failed, of: list.length };
  }
  async function daily(slug, { force = false } = {}) {
    const st = await packs.getJSON(slug, 'facts-daily.json', null);
    if (!force && st?.day === today()) return { skipped: 'done today' };
    if (builder?.busy?.(slug)) return { skipped: 'busy' };
    return serial(async () => dailyGenerated(slug, st));
  }
  async function dailyGenerated(slug, st) {
    const P = await packs.getJSON(slug, 'profile.json', null), L = await packs.getJSON(slug, 'ledger.json', null), cfg = await packs.getJSON(slug, 'config.json', {});
    if (!P || !L) return { skipped: 'not read' };
    /* Shopify: its product list; every other platform: the product pages the read saved, page by page (partial) */
    const shop = (!P.platform || P.platform === 'shopify') && !/^(jsonld|offerings)/.test(P.catalog?.source || '');
    let items, partial = false, gen = null;
    const raw = shop ? await readStore(P.host, cfg.catalogUrl) : null;
    if (raw) { if (!raw.length) throw new Error('the store returned no products'); items = storeItems(raw, P.host); }
    else { gen = await readStoreGeneric(P); partial = true; items = gen.items;
      if (!gen.of) { await packs.put(slug, 'facts-daily.json', { day: today(), at: Date.now(), summary: 'No product pages saved from the read yet: nothing to check.' }); return { skipped: 'no product pages' }; }
      if (!items.length && !gen.gone404.length) throw new Error(`none of the ${gen.of} product pages opened this time`);
      /* every page answering 404 is the site (moved, down, a new URL scheme), not every product gone: nothing is removed */
      if (!items.length && gen.gone404.length >= gen.of) { await packs.put(slug, 'facts-daily.json', { day: today(), at: Date.now(), summary: `All ${gen.of} product pages answered 404: the site may have moved its pages. Nothing changed; a re-read finds them again.` }); return { skipped: 'pages unreachable' }; } }
    const E = await editsOf(slug);
    const d = diffCatalog(L, items, { host: P.host, currency: P.currency || cfg.currency, locale: P.locale || cfg.locale, removedByBrand: P.catalog?.removed, tombs: E.removed, partial, gone404: gen?.gone404 || [] });
    /* stock: each product's flag, and the catalog counts the cards quote */
    const by = new Map(items.map((x) => [x.handle, x])), gone = new Set(d.gone); let stock = 0;
    P.catalog ||= {}; P.catalog.products = (P.catalog.products || []).filter((x) => !gone.has(x.handle) || x.addedByBrand && hostOf(x.url || '') !== hostOf(P.host)).map((x) => { const y = by.get(x.handle); if (!y) return x; if (!!x.inStock !== y.inStock) stock++; return { ...x, inStock: y.inStock, price: y.price || x.price, priceLabel: y.price ? moneyFmt(P.currency, P.locale)(y.price) : x.priceLabel }; });
    P.catalog.hero = (P.catalog.hero || []).filter((h) => !gone.has(h));
    if (!partial) P.catalog.count = items.length; /* the count every screen shows (pack-numbers.js products) moves with the check, as the ledger's does */
    for (const c of d.changes.filter((c) => c.kind === 'new' && !P.catalog.products.some((x) => x.handle === c.item.handle))) P.catalog.products.push({ handle: c.item.handle, title: c.item.title, price: c.item.price, currency: P.currency, inStock: c.item.inStock, url: c.item.url, img: c.item.img, images: c.item.img ? [c.item.img] : [], published: c.item.published, claims: [] });
    /* a page-by-page check saw a sample: the catalog's counts stay as the read left them */
    const counts = partial ? {} : { 'catalog.count': items.length, 'catalog.out_of_stock': items.filter((x) => !x.inStock).length }, ledger = d.ledger.map((e) => (counts[e.key] != null && +String(e.v).replace(/,/g, '') !== counts[e.key] ? { ...e, v: counts[e.key].toLocaleString('en-US'), n: counts[e.key], at: today(), method: 'product list (daily check)' } : e));
    const n = { changed: d.changes.filter((c) => c.kind === 'changed').length, removed: d.gone.length, added: d.changes.filter((c) => c.kind === 'new').length };
    const summary = `${items.length}${partial ? ` of ${gen.of} product pages` : ' products'} read · ${n.changed} price${n.changed === 1 ? '' : 's'} changed · ${n.removed} gone · ${n.added} new · ${stock} stock change${stock === 1 ? '' : 's'}`;
    if (d.changes.length || stock || ledger.some((e, i) => e !== d.ledger[i])) {
      await packs.put(slug, 'ledger.json', ledger); await packs.put(slug, 'profile.json', P);
      await builder.republish(slug);
      const priced = d.changes.filter((c) => c.kind !== 'new' || n.added <= 12); /* a big drop of launches is one line, not fifty */
      await record(slug, [...priced.slice(0, 40).map(changeText), ...(n.added > 12 ? [`${n.added} new products`] : [])], { by: 'Brew daily check', retire: d.changes.filter((c) => c.kind !== 'new').map((c) => c.was) });
      await flag(slug, d.changes.filter((c) => c.kind !== 'new').map((c) => ({ ...c, key: keyOf(c.key), ledgerKey: c.key })), 'daily');
      await reload(slug);
      if (d.changes.length) await builder.signal?.(slug, [...(n.changed ? [{ kind: 'price' }] : []), ...(n.removed ? [{ kind: 'removed' }] : []), ...(n.added ? [{ kind: 'new' }] : [])]).catch?.(() => {});
    }
    await packs.put(slug, 'facts-daily.json', { day: today(), at: Date.now(), summary, ...n, stock });
    log.log?.(`[facts] daily ${slug}: ${summary}`);
    return { ok: true, summary, ...n, stock, changes: d.changes.map(({ item, ...c }) => c) };
  }

  /* ---------- connected accounts → private/facts.json ---------- */
  // called after every real connect, sync and disconnect (builder.liveConnected): the whole private sheet is derived again
  async function connected(slug, tool) {
    const pub = (await packs.load(slug).catch(() => null))?.facts || await packs.getJSON(slug, 'facts.json', {});
    const L = await packs.getJSON(slug, 'private/connected-ledger.json', []), before = (await packs.getJSON(slug, 'private/facts.json', null))?.facts || {};
    const facts = connectedFacts(L, pub), tools = {};
    for (const f of Object.values(facts)) tools[f.connected] = Math.max(tools[f.connected] || 0, Date.parse(f.at) || 0);
    await packs.put(slug, 'private/facts.json', { at: Date.now(), tools, facts });
    /* moves quoting the site's number, now that the account says otherwise (only what moved since the last sync) */
    const fresh = overrides(facts).filter((f) => { const prev = Object.values(before).find((x) => x.key === f.key); return !prev || !same(prev.v, f.v); });
    const ch = fresh.map((f) => ({ kind: 'changed', key: keyOf(f.was.key), ledgerKey: f.was.key, label: f.label, was: f.was.v, now: f.v, tool: TOOL[f.connected] }));
    const flagged = await flag(slug, ch, 'connected', { priv: true });
    log.log?.(`[facts] connected ${slug} ${tool || ''}: ${Object.keys(facts).length} private facts, ${flagged.length} moves flagged`);
    return { facts, flagged };
  }
  // the numbers a member's cards may use: the public sheet plus the connected facts (never demo accounts)
  async function memberFacts(slug) { const pf = await packs.getJSON(slug, 'private/facts.json', null); return Object.fromEntries(Object.entries(pf?.facts || {}).filter(([, f]) => !f.stale)); } /* a stale account's numbers are not for cards */

  /* ---------- schedule: once a day per brand opened in the last 7 days ---------- */
  const T = { busy: false, timers: [] };
  const off = () => process.env.FACTS_DAILY_OFF === '1' || process.env.AI_MOCK === '1' || (!process.env.K_SERVICE && process.env.FACTS_BG !== '1');
  async function tick() {
    if (T.busy || off()) return; T.busy = true;
    try { const all = await packs.list().catch(() => []);
      /* built brands: done, or paused at their spend cap with the moves written so far (their cards quote prices too; this check is free) */
      const due = all.filter((b) => ((b.status?.done || (b.status?.capped && b.status?.ready)) && !b.status?.cancelled && Date.now() - (b.status.seenAt || 0) < 7 * D)).map((b) => b.slug);
      for (const slug of due) { try { await daily(slug); } catch (e) { log.warn('[facts] daily', slug, e.message); } } }
    finally { T.busy = false; } }
  const start = () => { if (off()) return; T.timers.push(setTimeout(() => tick().catch(() => {}), 4 * 60e3), setInterval(() => tick().catch(() => {}), 60 * 60e3)); T.timers.forEach((t) => t.unref?.()); };
  const stop = () => T.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  return { view, edit, daily, connected, memberFacts, sheet, start, stop, tick };
}
