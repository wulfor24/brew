// Facebook and Instagram CDN pictures (fbcdn.net, cdninstagram.com, scontent-*) are signed links that die at their oe= time.
// 26 Oct QV round 2: rival logos and "People who tag you" pictures were still hot-linked with oe = 29 Oct. The rival-logo heal of
// the same day hung on the research tick, which never runs for a brand on staging's MOVED_TO_PROD list (all five partners) nor
// on an instance without the background lease, so the saved links were never copied.
// Fix for every brand and every page: whatever the app serves passes through keep(). A CDN link already copied is served from
// our storage (research/<name>, named from the link's path so any instance finds it without a saved map); one not copied yet
// is queued for a background copy while it still loads (free: a plain image fetch, no paid call) and served as it is for now;
// one past its expiry is dropped (null, or left out of a list), so the page shows the name or initials, never a broken picture.
import crypto from 'node:crypto';

export const isCdn = (u) => typeof u === 'string' && /^https?:\/\/(?:[\w-]+\.)*(?:fbcdn\.net|cdninstagram\.com|fbsbx\.com)(?=[/?#:]|$)|^https?:\/\/scontent[\w.-]*\//i.test(u);
/* oe= is the expiry in hex seconds */
export const cdnExpiry = (u) => { if (!isCdn(u)) return null; const m = /[?&]oe=([0-9a-f]{6,10})(?=[&#]|$)/i.exec(u); return m ? parseInt(m[1], 16) * 1000 : null; };
export const cdnDead = (u, now = Date.now()) => { const e = cdnExpiry(u); return e != null && e <= now; };
/* the same picture under another scontent host or a fresh signature keeps its path: one name per picture */
export const keepName = (u) => { let p = String(u); try { p = new URL(u).pathname; } catch {} const ext = /\.png$/i.test(p) ? '.png' : /\.mp4$/i.test(p) ? '.mp4' : '.jpg';
  return crypto.createHash('sha1').update('cdn:' + p).digest('hex').slice(0, 20) + ext; };
/* a CDN error page is no picture */
const isMedia = (b) => !!b && b.length > 64 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || b.slice(0, 4).toString() === 'RIFF' || b.slice(0, 3).toString() === 'GIF' || b.slice(4, 8).toString() === 'ftyp');
const MARK = /fbcdn|cdninstagram|fbsbx|scontent/i;

export function createCdnKeep({ has = async () => false, save = async () => {}, fetchBuf = null, log = console, now = Date.now, concurrency = 2, retryMs = 3600e3 } = {}) {
  const known = new Set(), dead = new Set(), failedAt = new Map(), queue = new Map(); let active = 0, idleWait = [];
  const get = fetchBuf || (async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(30e3), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' } });
    if (!r.ok) throw new Error(`fetch ${r.status}`); const b = Buffer.from(await r.arrayBuffer()); if (b.length > 25e6) throw new Error('too big'); return b; });
  const run = async (n, u) => {
    try { if (await has(n)) { known.add(n); return; } } catch {}
    if (cdnDead(u, now())) { dead.add(n); return; }
    try { const b = await get(u); if (!isMedia(b)) throw new Error('not a picture'); await save(n, b); known.add(n); failedAt.delete(n); }
    catch (e) { if (/\b(403|404|410)\b/.test(e.message)) dead.add(n); else failedAt.set(n, now()); log.warn?.('[cdn-keep]', n, e.message); }
  };
  const pump = () => {
    while (active < concurrency && queue.size) { const [n, u] = queue.entries().next().value; queue.delete(n); active++;
      run(n, u).finally(() => { active--; pump(); }); }
    if (!active && !queue.size) { const w = idleWait; idleWait = []; w.forEach((f) => f()); }
  };
  const want = (u) => { const n = keepName(u); if (known.has(n) || dead.has(n) || queue.has(n) || now() - (failedAt.get(n) || 0) < retryMs) return n; queue.set(n, u); setImmediate(pump); return n; };
  /* one link: our copy, the link while it loads, or null once it can't */
  const keep = (u) => { if (!isCdn(u)) return u; const n = want(u); if (known.has(n)) return 'research/' + n; return dead.has(n) || cdnDead(u, now()) ? null : u; };
  /* any served value: strings swapped, dead pictures left out of lists, links inside text swapped or cut */
  const inText = (s) => s.replace(/https?:\/\/[^\s"'<>()]+/g, (m) => (isCdn(m) ? keep(m) || '' : m));
  const deep = (x) => {
    if (typeof x === 'string') return isCdn(x) ? keep(x) : MARK.test(x) ? inText(x) : x;
    if (Array.isArray(x)) { const out = []; for (const v of x) { const k = deep(v); if (k === null && isCdn(v)) continue; out.push(k); } return out; }
    if (x && typeof x === 'object' && !Buffer.isBuffer(x)) { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = deep(v); return o; }
    return x;
  };
  /* a whole answer body as sent (JSON or text); the untouched body when it names no CDN link */
  const body = (s) => { if (typeof s !== 'string' || !MARK.test(s)) return s; const t = s.trimStart();
    if (t[0] === '{' || t[0] === '[') { try { return JSON.stringify(deep(JSON.parse(s))); } catch {} } return inText(s); };
  /* queue every CDN link in a saved snapshot (boot, brand load): copied while they still load, before anyone opens the page */
  const scan = (x) => { let n = 0; const walk = (v) => { if (typeof v === 'string') { if (isCdn(v) && !cdnDead(v, now())) { want(v); n++; } } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; walk(x); return n; };
  const idle = () => (!active && !queue.size ? Promise.resolve() : new Promise((r) => idleWait.push(r)));
  return { keep, deep, body, scan, idle, stats: () => ({ known: known.size, dead: dead.size, queued: queue.size, active }) };
}

/* the server's answers: a JSON or text body that names a CDN link goes out with our copies (wraps res.end/res.write once) */
export function keepRes(res, K) {
  if (!K || res.__cdnKeep) return; res.__cdnKeep = true;
  const en = res.end, wr = res.write;
  res.end = function (b, ...rest) { if (typeof b === 'string' && MARK.test(b)) b = K.body(b); return en.call(res, b, ...rest); };
  res.write = function (b, ...rest) { if (typeof b === 'string' && MARK.test(b)) b = b.replace(/^data: (.*)$/gm, (m, j) => `data: ${K.body(j)}`); return wr.call(res, b, ...rest); };
}
