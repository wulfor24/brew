// Shared treg client (https://treg.to): one auth, retries on 5xx, metered spend with a daily cap.
// call(id, { query, body }) → parsed JSON. dfs(id, body) unwraps DataForSEO's tasks[0].result[0].
// Tag convention: tag = `<what>-<slug>` (listen-<slug>, pulse-<slug>, market-<slug>, video-<slug>, jam-<slug> …);
// <what> is one word (no dash), the rest is the brand slug. Untagged calls are metered under the endpoint id.
// spendLedger(treg, packs) books every charge into the brand pack at spend/<YYYY-MM>.json as [{day, tag, usd, calls}].
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Data calls are cached by signal (TTL_RULES: reviews, search, AI answers and profiles a week, company data a month, ads, news
// and prices a day, else TREG_CACHE_HOURS): the same endpoint with the same parameters is paid for once per window at most,
// by any caller, on any instance; identical calls in flight at once share one answer. Never cached: generation (images, video, voice) and job polling, whose
// answers change or carry one-time URLs. Failed calls are never cached. A caller can opt out with { cache: false }.
const NO_CACHE = /(image|video|voice|audio|music)-gen|tts|\.task\.|status|result\.retrieve|video_download|video-streams|post\.detail|upload/i;
const TTL_H = +process.env.TREG_CACHE_HOURS || 24;
/* how long one paid answer stays good, by what it is (first match wins; else TTL_H). Slow signals are paid for once a week
   or month by every caller (the read, a refresh check, listening, pulse, moves), fast ones once a day */
export const TTL_RULES = [
  [/builtwith|wappalyzer|tech-?stack|whois|company\.(?:enrich|profile)|crunchbase|linkedin\.company/i, 720],
  [/review|trustpilot|maps\.reviews|product\.reviews/i, 168],
  [/serp|organic|spyfu|backlink|keyword|trends|autocomplete|search-volume|ranked/i, 168],
  [/ai-optimization|llm|chat-?gpt|gemini|perplexity|ai-search|ai_mode/i, 168],
  [/instagram\.user|instagram\.profile|youtube\.channel|tiktok\.user|profile/i, 168],
  [/adlibrary|ad-library|ads-transparency|ad_library/i, 24],
  [/news|web\.search|shopping|price|best-?sellers|product\.detail|amazon\.search/i, 24]];
export const ttlHours = (id) => (TTL_RULES.find(([re]) => re.test(id)) || [null, TTL_H])[1];
/** cache: { get(key) → { at, data } | null, put(key, { at, data }) } */
export function gcsCache({ bucket, gToken, prefix = '_cache/treg/', log = console }) {
  const mem = new Map();
  const url = (k) => `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(prefix + k + '.json')}?alt=media`;
  return {
    async get(k) { if (mem.has(k)) return mem.get(k); try { const r = await fetch(url(k), { headers: { authorization: `Bearer ${await gToken()}` }, signal: AbortSignal.timeout(15e3) }); if (!r.ok) return null; const v = await r.json(); mem.set(k, v); return v; } catch { return null; } },
    async put(k, v) { mem.set(k, v); if (mem.size > 5000) mem.delete(mem.keys().next().value);
      try { await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(prefix + k + '.json')}`, { method: 'POST', headers: { authorization: `Bearer ${await gToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(v), signal: AbortSignal.timeout(30e3) }); } catch (e) { log.warn?.('[treg] cache put', e.message); } },
  };
}

export function createTreg({ client = 'shopos-feed', dayCapUsd = +process.env.TREG_DAY_CAP_USD || 25, cache = null, log = console } = {}) {
  const meter = { usd: 0, calls: 0, day: new Date().toDateString(), dayUsd: 0, byTag: {} };
  const listeners = [];
  const auth = () => {
    if (process.env.TREG_TOKEN) return { token: process.env.TREG_TOKEN, org: process.env.TREG_ORG || 'squareup' };
    try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.treg', 'config.json'), 'utf8')); return { token: c.token, org: c.active_org || 'squareup' }; } catch { return null; }
  };
  const off = process.env.TREG_OFF === '1';
  const keyOf = (id, query, body) => crypto.createHash('sha256').update(JSON.stringify([id, query || null, body || null])).digest('hex').slice(0, 40);
  /* the same call already on its way (moves written six at a time, two stages asking at once): every asker waits for that
     one answer instead of paying again. Holds for uncached calls too, but never for generation or polling */
  const inflight = new Map();
  async function call(id, o = {}) {
    if (off) throw Object.assign(new Error('treg is off'), { off: true });
    if (NO_CACHE.test(id) || o.cache === false) return live(id, o);
    const k = keyOf(id, o.query, o.body);
    if (inflight.has(k)) { meter.shared = (meter.shared || 0) + 1; return inflight.get(k); }
    const p = (async () => {
      /* o.maxAgeH: a caller that needs it fresher than the signal's window (a refresh check on ads) says so */
      const ttl = Math.min(ttlHours(id), o.maxAgeH ?? Infinity);
      const hit = cache ? await cache.get(k).catch(() => null) : null;
      if (hit && Date.now() - Date.parse(hit.at) < ttl * 36e5) { meter.hits = (meter.hits || 0) + 1; return hit.data; }
      const data = await live(id, o);
      if (cache) cache.put(k, { at: new Date().toISOString(), id, data }).catch(() => {});
      return data;
    })();
    inflight.set(k, p); p.finally(() => inflight.delete(k)).catch(() => {});
    return p;
  }
  async function live(id, { query, body, timeout = 150e3, tag } = {}) {
    const a = auth(); if (!a?.token) throw new Error('no TREG_TOKEN');
    const d = new Date().toDateString(); if (meter.day !== d) Object.assign(meter, { day: d, dayUsd: 0 });
    if (meter.dayUsd >= dayCapUsd) throw new Error(`treg day cap $${dayCapUsd} reached`);
    const u = new URL(`https://treg.to/call/${id}`);
    Object.entries(query || {}).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(u, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(timeout),
        headers: { 'X-Treg-Token': a.token, 'X-Treg-Org': a.org, 'X-Treg-Client': client, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
      const usd = +(r.headers.get('x-treg-cost-micro') || 0) / 1e6;
      meter.usd += usd; meter.dayUsd += usd; meter.calls++; meter.byTag[tag || id] = (meter.byTag[tag || id] || 0) + usd;
      listeners.forEach((f) => f(tag || id, usd, meter));
      if (r.ok) return r.json();
      const t = (await r.text()).slice(0, 240);
      if (attempt === 2 || r.status < 500) throw new Error(`treg ${id} ${r.status}: ${t}`);
    }
  }
  // DataForSEO endpoints wrap results: { tasks: [{ status_code, result: [...] }] }
  async function dfs(id, body, o = {}) {
    const j = await call(id, { body, ...o }); const task = j?.tasks?.[0];
    if (task && task.status_code !== 20000) throw new Error(`treg ${id}: ${task.status_message}`);
    return task?.result?.[0] ?? null;
  }
  return { call, dfs, meter, onCharge: (f) => listeners.push(f), live: !off && !!auth()?.token };
}

// what a tag is for, and whose brand it was: `pulse-wearcomet-com` → { what: 'pulse', slug: 'wearcomet-com' }
export const tagParts = (tag) => { const m = String(tag || '').match(/^([a-z0-9]+)-([a-z0-9][a-z0-9.-]*)$/i); return m && !m[2].includes('.') ? { what: m[1], slug: m[2] } : { what: String(tag || 'untagged'), slug: '_brew' }; };
// books spend per brand and month (debounced: one write per brand-month every few seconds, merged with what is stored)
export function spendLedger(treg, packs, { debounceMs = 5000, log = console } = {}) {
  const pend = new Map(); let timer = null;
  const flush = async () => {
    timer = null; const jobs = [...pend.entries()]; pend.clear();
    await Promise.all(jobs.map(async ([key, rows]) => { const [slug, month] = key.split('|'), name = `spend/${month}.json`;
      try { const cur = await packs.getJSON(slug, name, null) || { month, rows: [] }; const idx = new Map(cur.rows.map((r, i) => [`${r.day}|${r.tag}`, i]));
        for (const r of rows.values()) { const i = idx.get(`${r.day}|${r.tag}`); if (i == null) { idx.set(`${r.day}|${r.tag}`, cur.rows.length); cur.rows.push({ ...r }); } else { cur.rows[i].usd = +(cur.rows[i].usd + r.usd).toFixed(6); cur.rows[i].calls = (cur.rows[i].calls || 0) + r.calls; } }
        cur.usd = +cur.rows.reduce((a, r) => a + r.usd, 0).toFixed(6); cur.at = new Date().toISOString();
        await packs.put(slug, name, cur);
      } catch (e) { log.warn?.('[treg] spend ledger', slug, e.message); } }));
  };
  treg.onCharge((tag, usd) => {
    const { what, slug } = tagParts(tag), day = new Date().toISOString().slice(0, 10), key = `${slug}|${day.slice(0, 7)}`;
    if (!pend.has(key)) pend.set(key, new Map()); const m = pend.get(key), k = `${day}|${what}`;
    const r = m.get(k) || { day, tag: what, usd: 0, calls: 0 }; r.usd = +(r.usd + usd).toFixed(6); r.calls++; m.set(k, r);
    if (!timer) { timer = setTimeout(() => flush(), debounceMs); timer.unref?.(); }
  });
  return { flush: () => { if (timer) clearTimeout(timer); return flush(); }, pending: () => pend.size };
}
