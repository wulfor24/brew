// Shared helpers for the Brand Reader: slugs, a cached fetcher, HTML parsing, the evidence ledger.
// Nothing here guesses: helpers return null when a value is not on the page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PLATFORM } from '../auth.js';

/* ---------- outbound fetches only reach the public internet ----------
   Every URL a store, a rival or a person gives Brew is fetched through this: http(s) only, and each hop (redirects are
   followed by hand) must resolve to a public address. Private, loopback, link-local (the cloud metadata server) and other
   reserved ranges are refused, so a pasted link can't make the server read its own network. */
import dnsP from 'node:dns/promises';
import net from 'node:net';
const v4 = (ip) => ip.split('.').map(Number);
export const privateIp = (ip) => {
  if (net.isIPv4(ip)) { const [a, b] = v4(ip); return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224; }
  if (net.isIPv6(ip)) { const x = ip.toLowerCase(); if (x.startsWith('::ffff:')) return privateIp(x.slice(7)); return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff'); }
  return true;
};
export async function publicUrl(u) {
  let url; try { url = new URL(u); } catch { throw new Error('not a valid address'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('only http and https addresses');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|metadata(\.google\.internal)?)$/i.test(host) || /\.(internal|local|localhost)$/i.test(host)) throw new Error('not a public address');
  const ips = net.isIP(host) ? [host] : (await dnsP.lookup(host, { all: true, verbatim: true })).map((x) => x.address);
  if (!ips.length || ips.some(privateIp)) throw new Error('not a public address');
  return url;
}
export async function safeFetch(u, o = {}, hops = 5) {
  let url = await publicUrl(u);
  for (let i = 0; i <= hops; i++) {
    /* a browser's user agent unless the caller set one: store image CDNs (images.puma.com) answer 404 to Node's own */
    const h = new Headers(o.headers || {}); if (!h.has('user-agent')) h.set('user-agent', UA);
    const r = await fetch(url, { ...o, headers: h, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await publicUrl(new URL(r.headers.get('location'), url).href); continue; }
    if (i) Object.defineProperty(r, 'url', { value: url.href });
    return r;
  }
  throw new Error('too many redirects');
}


export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
export const today = () => new Date().toISOString().slice(0, 10);
export const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// two-level public suffixes we meet in D2C (enough for a registrable-domain slug without a PSL dependency)
const SUFFIX2 = new Set(['co.uk', 'org.uk', 'ac.uk', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'com.mx', 'co.jp', 'co.kr', 'com.sg', 'com.my', 'co.za', 'com.tr', 'com.cn', 'com.hk', 'com.tw', 'co.id', 'com.ph', 'com.ar', 'com.co', 'com.pe', 'com.sa', 'com.eg', 'co.il', 'com.pk', 'com.bd', 'com.ng', 'co.ke', 'com.vn', 'co.th', 'ae.org']);
export const normalizeUrl = (input) => {
  let s = String(input || '').trim(); if (!s) throw new Error('no URL');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s); u.hash = ''; return u;
};
export const registrable = (host) => {
  const p = String(host).toLowerCase().replace(/^www\./, '').split('.');
  if (p.length <= 2) return p.join('.');
  const last2 = p.slice(-2).join('.');
  return SUFFIX2.has(last2) ? p.slice(-3).join('.') : last2;
};
/* a shared platform domain (brand.myshopify.com, brand.wixsite.com: auth.js PLATFORM) is never the brand: the whole host is */
export const slugOf = (url) => { const h = normalizeUrl(url).hostname.toLowerCase().replace(/^www\./, ''), r = registrable(h); return (PLATFORM.test(r) ? h : r).replace(/\./g, '-'); };

/* ---------- brand names ---------- */
/* every country's English name ("India", "United States"), built once: a store titled "PUMA India" is the brand PUMA */
const COUNTRIES = (() => { const out = new Set(['uk', 'usa', 'us', 'uae', 'ksa', 'eu', 'europe', 'asia', 'global', 'international', 'intl', 'worldwide']);
  try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const c = String.fromCharCode(a, b); try { const n = dn.of(c); if (n && n !== c) { out.add(n.toLowerCase()); out.add(c.toLowerCase()); } } catch {} } } catch {}
  return out; })();
const TAIL = /\s*[-–—|:,]?\s*(official\s+(online\s+)?(store|site|website|shop)|online\s+(store|shop)|store|shop|official)\s*$/i;
/** the brand without its market or store suffix: "PUMA India" → "PUMA", "Nike UK Official Store" → "Nike"; never empty.
 *  With the store's host, the shorter name must be the domain's own name (airindia.com keeps "Air India") */
export function brandBase(name, host = '') {
  let n = String(name || '').trim(); if (!n) return n;
  for (let i = 0; i < 3; i++) {
    const t = n.replace(TAIL, '').trim();
    const words = t.split(/\s+/); let cut = t;
    for (const k of [3, 2, 1]) { if (words.length > k && COUNTRIES.has(words.slice(-k).join(' ').toLowerCase().replace(/[^a-z ]/g, ''))) { cut = words.slice(0, -k).join(' ').replace(/[\s\-–—|:,]+$/, ''); break; } }
    if (cut === n || !cut) break;
    const sq = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ''), stem = host ? sq(registrable(host).split('.')[0]) : '';
    /* airindia.com: the country is part of the domain's name, so it is part of the brand's */
    if (stem && (stem.includes(sq(n.slice(cut.length))) || !(stem.startsWith(sq(cut)) || sq(cut).startsWith(stem)))) break;
    n = cut;
  }
  return n || String(name).trim();
}
/** a regex that finds the brand in text by any of its names ("PUMA India" or "PUMA"), whole words, spaces flexible */
export function brandRe(name, extra = [], host = '') {
  const names = [...new Set([name, brandBase(name, host), ...extra].map((x) => String(x || '').trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length);
  if (!names.length) return /(?!)/;
  return new RegExp(`\\b(${names.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')).join('|')})\\b`, 'i');
}

/* ---------- HTML ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', trade: '™', reg: '®', copy: '©', rupee: '₹' };
export const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
export const stripTags = (h) => decode(String(h || '').replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\f\r]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
// some themes double-encode (&amp;#39;): decode until stable, at most 3 passes
export const clean = (s) => { let x = String(s ?? ''); for (let i = 0; i < 3; i++) { const y = decode(x); if (y === x) break; x = y; } return x.replace(/\s+/g, ' ').trim(); };
export const attr = (tag, name) => { const m = String(tag).match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[1] ?? m[2] ?? m[3]) : null; };
export const tags = (html, name) => String(html || '').match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
export const meta = (html, key) => {
  for (const t of tags(html, 'meta')) { const k = attr(t, 'property') || attr(t, 'name') || attr(t, 'itemprop'); if (k && k.toLowerCase() === key.toLowerCase()) { const c = attr(t, 'content'); if (c) return clean(c); } }
  return null;
};
export const titleOf = (html) => { const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? clean(m[1]) : null; };
export const abs = (href, base) => { try { return new URL(decode(href), base).href; } catch { return null; } };
export const links = (html, base) => {
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) { const href = attr(m[1], 'href'); if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue; const u = abs(href, base); if (u) out.push({ url: u, text: clean(stripTags(m[2])).slice(0, 80), aria: attr(m[1], 'aria-label') }); }
  return out;
};
export const jsonLd = (html) => {
  const out = [];
  const walk = (x) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); if (x['@graph']) walk(x['@graph']); if (x['@type']) out.push(x); };
  for (const m of String(html || '').matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim(); try { walk(JSON.parse(raw)); } catch { try { walk(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '))); } catch { /* broken JSON-LD: skip */ } }
  }
  return out;
};
export const typeIs = (x, t) => [].concat(x?.['@type'] || []).some((y) => String(y).toLowerCase() === t.toLowerCase());
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const pathOf = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname.replace(/\/$/, '')); } catch { return String(u); } };

/* ---------- money ---------- */
const SYM = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥', AED: 'AED ', SGD: 'S$', NZD: 'NZ$' };
export const money = (n, cur) => {
  if (n == null || isNaN(n)) return null; const s = SYM[cur] ?? (cur ? cur + ' ' : '');
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const loc = cur === 'INR' ? 'en-IN' : 'en-US';
  return s + Number(n).toLocaleString(loc, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
};
export const num = (n, cur) => Number(n).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US');

/* ---------- ledger ---------- */
export function createLedger() {
  const rows = new Map();
  const add = (e) => {
    if (!e || !e.key || e.v == null || e.v === '') return null;
    const row = { key: e.key, label: e.label || e.key, v: String(e.v), ...(e.n != null && !isNaN(e.n) ? { n: +e.n } : {}), ...(e.unit ? { unit: e.unit } : {}),
      layer: e.layer || 'observed', src: e.src || (e.url ? pathOf(e.url) : null), url: e.url || null, at: e.at || today(), method: e.method || 'crawl', ...(e.conf ? { conf: e.conf } : {}), ...(e.note ? { note: e.note } : {}) };
    rows.set(row.key, row); return row;
  };
  return { add, get: (k) => rows.get(k), list: () => [...rows.values()], has: (k) => rows.has(k) };
}

/* ---------- fetcher with a per-day raw cache ---------- */
// get(url, { as: 'text'|'json'|'buf', key, ms, cache, headers }) → { ok, status, url, text|json|buf, type, ms, cached }
export function createFetcher({ slug, saveRaw, loadRaw, fresh = false, signal, log = console }) {
  const stats = { fetched: 0, cached: 0, failed: 0 };
  async function get(url, o = {}) {
    const as = o.as || 'text';
    const key = (o.key ? o.key + '-' : 'http/') + sha(url + (o.body ? JSON.stringify(o.body) : ''));
    if (as !== 'buf' && o.cache !== false && !fresh && loadRaw) {
      const hit = await loadRaw(slug, key + '.json').catch(() => null);
      if (hit && hit.url != null) { stats.cached++; return { ...hit, cached: true }; }
    }
    const t0 = Date.now();
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(o.ms || 20e3)]) : AbortSignal.timeout(o.ms || 20e3);
    let r;
    try {
      r = await safeFetch(url, { method: o.body ? 'POST' : 'GET', signal: sig, body: o.body,
        headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: as === 'json' ? 'application/json,text/plain,*/*' : as === 'buf' ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...(o.headers || {}) } });
    } catch (e) { stats.failed++; if (signal?.aborted) throw e; return { ok: false, status: 0, url, error: e.cause?.code || e.name || e.message, ms: Date.now() - t0 }; }
    const out = { ok: r.ok, status: r.status, url: r.url || url, type: r.headers.get('content-type') || '', ms: Date.now() - t0 };
    try {
      if (as === 'buf') out.buf = Buffer.from(await r.arrayBuffer());
      else { const text = await r.text(); if (as === 'json') { try { out.json = JSON.parse(text); } catch { out.json = null; out.ok = false; out.text = text.slice(0, 2000); } } else out.text = text; }
    } catch (e) { out.ok = false; out.error = e.message; }
    stats.fetched++;
    // cache only good pages and real "not found" answers (so a rerun is the same read), never transient errors
    if (as !== 'buf' && o.cache !== false && saveRaw && (out.ok || out.status === 404)) await saveRaw(slug, key + '.json', { ...out, at: new Date().toISOString(), requested: url }).catch((e) => log.warn?.('[reader] saveRaw', e.message));
    return out;
  }
  return { get, stats };
}

// run a promise with a deadline; rejects with a clear timeout error
// held, then cleared once p settles: an unref'd timer racing a promise that never settles let a job or test exit mid-run
export const withTimeout = (p, ms, what) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(`${what} timed out after ${Math.round(ms / 1e3)}s`)), ms); })]).finally(() => clearTimeout(t)); };
// map with a concurrency limit
export const pool = async (xs, n, fn) => { const q = xs.map((x, i) => [x, i]); const out = new Array(xs.length); await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (q.length) { const [x, i] = q.shift(); try { out[i] = await fn(x, i); } catch (e) { out[i] = { error: e }; } } })); return out; };

// default storage: .brands/<slug>/assets and .brands/<slug>/raw/<YYYY-MM-DD>/
export function defaultStore(root) {
  const base = (slug) => path.join(root, '.brands', slug);
  const safe = (name) => String(name).replace(/[^a-zA-Z0-9._/-]+/g, '-').replace(/\.\.+/g, '.');
  return {
    async saveAsset(slug, name, buf, type) { const f = path.join(base(slug), 'assets', safe(name)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return `/b/${slug}/a/${safe(name)}`; },
    async saveRaw(slug, name, data) { const f = path.join(base(slug), 'raw', today(), safe(name)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); return f; },
    async loadRaw(slug, name) { const f = path.join(base(slug), 'raw', today(), safe(name)); if (!fs.existsSync(f)) return null; const s = fs.readFileSync(f, 'utf8'); try { return JSON.parse(s); } catch { return s; } },
    dir: base
  };
}

export const extOf = (type, url = '') => {
  const t = String(type).toLowerCase();
  if (t.includes('png')) return '.png'; if (t.includes('webp')) return '.webp'; if (t.includes('svg')) return '.svg'; if (t.includes('gif')) return '.gif'; if (t.includes('avif')) return '.avif';
  if (t.includes('icon')) return '.ico'; if (t.includes('jpeg') || t.includes('jpg')) return '.jpg'; if (t.includes('mp4')) return '.mp4';
  const m = String(url).split('?')[0].match(/\.(png|jpe?g|webp|svg|gif|avif|ico|mp4)$/i); return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.bin';
};
