// The brand's calendar: public holidays (npm date-holidays) for every market it sells in, plus the curated commerce and
// cultural events in data/commerce-events.json (lunar festivals date-holidays lacks, sales, seasons), kept to the ones
// that matter for its category (one cached AI call per brand, calendar/relevance.json; word match without AI).
// Each event carries its plan points (plan, creative, launch, peak, after) as dates, so seasonal moves start on time.
// Pack files: calendar/<year>.json (filtered), calendar/relevance.json, calendar/planned.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Holidays from 'date-holidays';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVENTS = JSON.parse(fs.readFileSync(path.join(HERE, 'data/commerce-events.json'), 'utf8'));
const TYPES = new Set(['public', 'bank', 'observance', 'optional']);
const POINTS = ['plan', 'creative', 'launch', 'peak', 'after'];
const DAY = 864e5;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const add = (d, n) => new Date(+d + n * DAY);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['day', 'the', 'of', 'sale', 'sales', 'holiday', 'substitute', 'festival', 'national']);
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
// category words a brand's category text maps to (the curated events speak these)
const CAT = { beauty: /beauty|cosmetic|makeup|make-up|lip|nail|fragrance|perfume/, skincare: /skin|serum|sunscreen|face|derma/, haircare: /hair|shampoo|scalp/, fashion: /fashion|apparel|cloth|wear|dress|saree|kurta|ethnic|denim|t-?shirt|sneaker|shoe/,
  footwear: /footwear|shoe|sneaker|sandal|slipper|boot/, jewelry: /jewel|gold|silver|diamond|ring|necklace|earring/, home: /home|decor|kitchen|furniture|bedding|candle|cookware/, food: /food|snack|beverage|tea|coffee|chocolate|sweet|grocery|spice/,
  electronics: /electronic|gadget|phone|audio|headphone|laptop|appliance|tech/, gifting: /gift|hamper/, kids: /kid|baby|toy|child/, pets: /pet|dog|cat/, wellness: /wellness|supplement|vitamin|health|ayurved|fitness|protein|nutrition/,
  grooming: /groom|beard|shav|men'?s care/, sustainable: /sustain|eco|organic|natural|recycl|vegan/, stationery: /station|book|pen|notebook/ };
export const categoriesOf = (text) => { const c = Object.keys(CAT).filter((k) => CAT[k].test(String(text || '').toLowerCase())); if (c.some((k) => ['skincare', 'haircare', 'grooming'].includes(k)) && !c.includes('beauty')) c.push('beauty'); if (c.includes('footwear') && !c.includes('fashion')) c.push('fashion'); return c; };

function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return utc(y, mo, da); }
// the date of a curated event in a year (null when the year is not covered)
export function dateOf(ev, y, all = EVENTS.events, depth = 0) {
  if (ev.dates) return ev.dates[y] ? new Date(ev.dates[y] + 'T00:00:00Z') : null;
  if (ev.date) { const [m, d] = ev.date.split('-').map(Number); return utc(y, m, d); }
  if (ev.easter != null) return add(easter(y), ev.easter);
  const r = ev.rule; if (!r) return null;
  if (r.rel) { const base = all.find((x) => x.id === r.rel); const d = base && depth < 4 ? dateOf(base, y, all, depth + 1) : null; return d ? add(d, r.days || 0) : null; }
  if (r.month) { if (r.nth > 0) { const first = utc(y, r.month, 1), off = (r.weekday - first.getUTCDay() + 7) % 7; return utc(y, r.month, 1 + off + (r.nth - 1) * 7); }
    const last = utc(y, r.month + 1, 0), off = (last.getUTCDay() - r.weekday + 7) % 7; return add(last, -off); }
  return null;
}
// The brand's next big shopping day (config.festival): Diwali in India, Black Friday elsewhere, always the next one
// from today, so seasonal cards and prompts roll forward each year instead of going stale. Dates come from
// data/commerce-events.json (Diwali by year, Black Friday by rule).
const HEADLINE = { IN: 'diwali' }, HEADLINE_DEFAULT = 'black-friday', HEAD_TZ = { IN: '+05:30' };
export function nextFestival(country, now = new Date()) {
  const cc = String(country || 'US').toUpperCase(), ev = EVENTS.events.find((e) => e.id === (HEADLINE[cc] || HEADLINE_DEFAULT));
  if (!ev) return null;
  const y0 = now.getUTCFullYear(), dayStart = Date.UTC(y0, now.getUTCMonth(), now.getUTCDate());
  for (const y of [y0, y0 + 1, y0 + 2]) {
    const d = dateOf(ev, y); if (!d || d.getTime() < dayStart) continue;
    const iso = d.toISOString().slice(0, 10), label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) + (y === y0 ? '' : ` ${y}`);
    return { name: ev.name, date: `${iso}T00:00:00${HEAD_TZ[cc] || '-05:00'}`, label };
  }
  return null;
}
const planOf = (kind, peak, span = 1) => { const p = EVENTS.plans[kind] || EVENTS.plans.holiday; return Object.fromEntries(POINTS.map((k) => [k, iso(add(peak, k === 'after' ? (span - 1) + p.after : p[k]))])); };

export function createCalendar({ packs, ai, log = console, today = () => new Date() }) {
  const aiCall = ai ? (typeof ai === 'function' ? ai : ai.call?.bind(ai)) : null;

  // where the brand sells: profile/config country, shipping countries, GA4 top countries when stored
  async function marketsOf(slug) {
    const [p, c, g] = await Promise.all([packs.getJSON(slug, 'profile.json', {}), packs.getJSON(slug, 'config.json', {}), packs.getJSON(slug, 'ga4/countries.json', null)]);
    const xs = [p?.country, c?.country, ...(c?.markets || []), ...(p?.shipping?.countries || c?.shipping?.countries || []), ...((g?.rows || g || []).slice?.(0, 3) || []).filter((r) => (r.share ?? 1) >= 0.1).map((r) => r.code || r.country)];
    const out = [...new Set(xs.filter(Boolean).map((x) => String(x).toUpperCase().slice(0, 2)))];
    return { markets: out.length ? out : ['US'], category: [p?.category, p?.subcategory, c?.category].filter(Boolean).join(' / ') || c?.product?.noun || '', name: p?.name || c?.name || slug };
  }

  // every candidate event for these markets and years, before the category filter
  function candidates(markets, years, conf = {}) {
    const out = [];
    for (const y of years) {
      const cur = [];
      for (const ev of EVENTS.events) { const ms = ev.markets.includes('*') ? markets : ev.markets.filter((m) => markets.includes(m)); if (!ms.length) continue;
        const ok = conf[`${ev.id}-${y}`]; // dates the organiser announced (confirmDates) replace the estimate
        const d = ok ? new Date(`${ok.date}T00:00:00Z`) : dateOf(ev, y); if (!d) continue; const span = ok?.end ? Math.max(1, Math.round((Date.parse(ok.end) - Date.parse(ok.date)) / 864e5) + 1) : ev.span || 1;
        cur.push({ id: `${ev.id}-${y}`, ref: ev.id, name: ev.name, markets: ms, date: iso(d), end: iso(add(d, span - 1)), kind: ev.kind, categories: ev.categories || ['all'], estimated: ok ? false : !!ev.estimated, confirmed: ok ? { url: ok.url, at: ok.at } : null, source: ok ? 'announced' : ev.source || 'curated', plan: planOf(ev.kind, d, span), aka: ev.aka || [] }); }
      for (const m of markets) { let hs = []; try { hs = new Holidays(m, { languages: ['en'] }).getHolidays(y) || []; } catch (e) { log.warn?.('[calendar] holidays', m, e.message); }
        for (const h of hs) { if (!TYPES.has(h.type)) continue; const d = new Date(h.date.slice(0, 10) + 'T00:00:00Z'), w = words(h.name);
          // a curated event on (about) the same day with a shared name word wins (Diwali over Deepavali, Black Friday sales over nothing)
          const dup = cur.find((e) => e.markets.includes(m) && Math.abs(Date.parse(e.date) - d) <= 1.5 * DAY && [e.name, ...(e.aka || [])].some((n) => [...words(n)].some((x) => w.has(x)))); if (dup) continue;
          const id = `h-${m.toLowerCase()}-${norm(h.name).replace(/ /g, '-')}-${y}`, same = cur.find((e) => e.id === id); if (same) { if (!same.markets.includes(m)) same.markets.push(m); continue; }
          cur.push({ id, ref: `h-${m.toLowerCase()}-${norm(h.name).replace(/ /g, '-')}`, name: h.name, markets: [m], date: iso(d), end: iso(d), kind: 'holiday', type: h.type, categories: ['all'], estimated: false, source: 'date-holidays', plan: planOf('holiday', d) }); } }
      out.push(...cur);
    }
    return out.map(({ aka, ...e }) => e);
  }

  // which events matter for this brand's category: one AI call per brand, cached; new events ask again for themselves only
  async function relevance(slug, info, evs) {
    const refs = [...new Map(evs.map((e) => [e.ref, e])).values()], cache = await packs.getJSON(slug, 'calendar/relevance.json', null) || { category: info.category, keep: {} };
    if (cache.category !== info.category) Object.assign(cache, { category: info.category, keep: {} });
    const missing = refs.filter((e) => !(e.ref in cache.keep)), cats = categoriesOf(`${info.category} ${info.name}`);
    const byWords = (e) => e.categories.includes('all') ? (e.source !== 'date-holidays' || e.type === 'public' || e.type === 'bank') : e.categories.some((c) => cats.includes(c));
    if (missing.length && aiCall) {
      try { const r = await aiCall({ tag: `calendar-${slug}`, model: 'sonnet', max: 3000, schema: { type: 'object', properties: { keep: { type: 'array', items: { type: 'string' } } } },
          prompt: `${info.name} sells ${info.category || 'consumer products'} in ${info.markets.join(', ')}. Which of these dates should its marketing team plan a campaign or post for? Keep shopping events, gifting moments, festivals its buyers celebrate and seasons that change what they buy; drop bank closures and observances with no buying behind them.\nReturn the ids to keep.\n${missing.map((e) => `${e.ref}: ${e.name} (${e.kind}, ${e.markets.join('/')}${e.categories.includes('all') ? '' : `, for ${e.categories.join(', ')}`})`).join('\n')}` });
        const keep = new Set(r.json?.keep || []); missing.forEach((e) => { cache.keep[e.ref] = keep.has(e.ref); }); cache.by = 'ai'; }
      catch (e) { log.warn?.('[calendar] relevance', e.message); missing.forEach((x) => { cache.keep[x.ref] = byWords(x); }); cache.by = 'words'; } }
    else missing.forEach((e) => { cache.keep[e.ref] = byWords(e); });
    if (missing.length) { cache.at = new Date().toISOString(); await packs.put(slug, 'calendar/relevance.json', cache); }
    return (e) => cache.keep[e.ref] !== false;
  }

  async function eventsFor(slug, { from = today(), to = add(today(), 365) } = {}) {
    const f = new Date(from), t = new Date(to), info = await marketsOf(slug), years = [];
    for (let y = f.getUTCFullYear(); y <= t.getUTCFullYear(); y++) years.push(y);
    const conf = (await packs.getJSON('_brew', 'calendar/confirmed.json', null).catch(() => null)) || {};
    const all = candidates(info.markets, years, conf), keep = await relevance(slug, { ...info }, all);
    const kept = all.filter(keep).sort((a, b) => a.date.localeCompare(b.date));
    for (const y of years) { const ys = kept.filter((e) => e.date.startsWith(String(y))); await packs.put(slug, `calendar/${y}.json`, { year: y, markets: info.markets, category: info.category, at: new Date().toISOString(), events: ys }).catch((e) => log.warn?.('[calendar] save', e.message)); }
    const lo = iso(f), hi = iso(t);
    return kept.filter((e) => e.end >= lo && e.date <= hi);
  }
  const upcoming = (slug, { days = 90 } = {}) => eventsFor(slug, { from: today(), to: add(today(), days) });

  // the plan points that are due (today or past) for events not yet planned at that point: what seasonal moves start from
  async function duePlanPoints(slug, day = today()) {
    const d = iso(day), evs = await eventsFor(slug, { from: add(new Date(d), -30), to: add(new Date(d), 60) }), done = await packs.getJSON(slug, 'calendar/planned.json', null) || {};
    const out = [];
    for (const e of evs) { if (e.plan.after < d) continue; // over
      const due = POINTS.filter((k) => k !== 'after' && e.plan[k] <= d); if (!due.length) continue; const point = due[due.length - 1];
      if (done[e.id]?.[point]) continue; out.push({ event: e, point, date: e.plan[point], daysToPeak: Math.round((Date.parse(e.date) - Date.parse(d)) / DAY) }); }
    return out.sort((a, b) => a.daysToPeak - b.daysToPeak);
  }
  async function markPlanned(slug, eventId, point, by = 'move') { const done = await packs.getJSON(slug, 'calendar/planned.json', null) || {}; done[eventId] = { ...(done[eventId] || {}), [point]: { at: new Date().toISOString(), by } }; await packs.put(slug, 'calendar/planned.json', done); return done[eventId]; }

  /* estimated dates (sale days the organiser hasn't announced, computed lunar dates) are checked again once a week while they
     are within ~5 months: a news and web search, then one AI read that keeps a date only when a result states it, with its link.
     Shared across brands in _brew/calendar/confirmed.json; candidates() uses it instead of the estimate. */
  async function confirmDates({ treg, days = 150, max = 12 } = {}) {
    if (!treg?.live || !aiCall) return { skipped: !treg?.live ? 'no treg' : 'no AI' };
    const now = today(), conf = (await packs.getJSON('_brew', 'calendar/confirmed.json', null).catch(() => null)) || {}, years = [now.getUTCFullYear(), now.getUTCFullYear() + 1, now.getUTCFullYear() + 2];
    const lo = iso(add(now, -10)), hi = iso(add(now, days)), all = candidates(['*', ...new Set(EVENTS.events.flatMap((e) => e.markets))].filter((m) => m !== '*'), years, conf);
    const todo = [...new Map(all.filter((e) => e.estimated && e.date >= lo && e.date <= hi && !(conf[e.id]?.tried && Date.now() - conf[e.id].tried < 6 * 864e5)).map((e) => [e.id, e])).values()].slice(0, max);
    const out = { checked: 0, confirmed: [] };
    for (const e of todo) { const y = e.date.slice(0, 4), q = `${e.name} ${y} dates`; let hits = [];
      for (const [id, o] of [['tinyfish.web.search.news', { query: { domain_type: 'news', query: q } }], ['treg.web.search', { body: { q, limit: 10 } }]]) { try { const j = await treg.call(id, { ...o, tag: 'calendar-_brew' }); const rows = j?.results || j?.output?.results || [];
        hits.push(...(Array.isArray(rows) ? rows : []).map((r) => ({ title: r.title || r.name || '', text: String(r.snippet || r.description || r.text || r.content || '').slice(0, 400), url: r.url || r.link || '', at: r.date || r.published || r.publishedAt || '' })).filter((r) => r.url)); } catch (er) { log.warn?.('[calendar] confirm search', e.id, er.message); } }
      out.checked++; conf[e.id] = { ...(conf[e.id] || {}), tried: Date.now() }; if (!hits.length) continue;
      try { const r = await aiCall({ tag: 'calendar-confirm', model: 'sonnet', max: 800, schema: { type: 'object', properties: { found: { type: 'boolean' }, start: { type: 'string' }, end: { type: 'string' }, source: { type: 'integer' } } },
          system: 'You read search results and report an event date only when a result states it plainly for that year. Never guess or infer from past years.',
          prompt: `Event: ${e.name} in ${y} (markets ${e.markets.join(', ')}). Our estimate: ${e.date}${e.end !== e.date ? ` to ${e.end}` : ''}.\nResults:\n${hits.slice(0, 12).map((h, i) => `${i}: ${h.title} | ${h.text} | ${h.at} | ${h.url}`).join('\n')}\n\nIf one result states the ${y} dates, return found=true, start and end as YYYY-MM-DD (end = start for one day) and the index of that result as source. Otherwise found=false.` });
        const j = r?.json || r; if (j?.found && /^\d{4}-\d{2}-\d{2}$/.test(j.start || '') && j.start.startsWith(y) && hits[j.source]) {
          conf[e.id] = { date: j.start, end: /^\d{4}-\d{2}-\d{2}$/.test(j.end || '') && j.end >= j.start ? j.end : j.start, url: hits[j.source].url, at: Date.now(), tried: Date.now(), was: e.date }; out.confirmed.push({ id: e.id, from: e.date, to: j.start }); } }
      catch (er) { log.warn?.('[calendar] confirm read', e.id, er.message); } }
    await packs.put('_brew', 'calendar/confirmed.json', conf).catch(() => {}); return out; }

  return { eventsFor, upcoming, duePlanPoints, markPlanned, marketsOf, confirmDates };
}
