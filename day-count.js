// Days until a date, counted on the brand's own calendar, and the countdowns baked into saved words healed on read (26 Oct).
// QV 26 Oct: Diwali read 12, 14 or 15 days on one evening and Karva Chauth "in 1 day" when it was 2. Two causes: a UTC midnight
// compared with the current time and rounded (1.4 → 1), and "14 days" written into a story or card the day it was made and never
// counted again. Every page now counts calendar days in the brand's zone, and a saved "Diwali is 14 days away" reads today's count.
import { EVENTS, dateOf } from './calendar.js';

const DAY = 864e5;
/* the brand's date as YYYY-MM-DD: its IANA zone (config.timezone; 'UTC' is derive.js's "unknown"), else its offset, else UTC */
export function brandDay(ms, { timezone, tzOffsetH } = {}) {
  const tz = timezone && timezone !== 'UTC' ? timezone : null;
  if (tz) try { const P = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${P.year}-${P.month}-${P.day}`; } catch { /* an unknown zone: the offset below */ }
  const off = tzOffsetH != null && tzOffsetH !== '' && Number.isFinite(+tzOffsetH) ? +tzOffsetH : 0;
  return new Date(ms + off * 36e5).toISOString().slice(0, 10);
}
/* the calendar date a value names: "2026-11-08", "2026-11-08T00:00:00+05:30" (its own wall date, never shifted to UTC), or a time in ms */
const dateKey = (d, zone) => { if (typeof d === 'number') return brandDay(d, zone); const m = /^(\d{4}-\d\d-\d\d)/.exec(String(d || '')); return m ? m[1] : null; };
/* whole days from the brand's today to the date: 0 today, 1 tomorrow, negative once it has passed; null for no date */
export function daysUntil(date, nowMs, zone = {}) {
  const a = dateKey(date, zone), b = brandDay(nowMs, zone); if (!a) return null;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
}
export const daysWords = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the names a text may call an event: "Wedding season (winter)" is "Wedding season", "Pongal / Makar Sankranti" either one */
const namesOf = (e) => [e.name, ...(e.aka || [])].flatMap((n) => String(n).replace(/\s*\([^)]*\)/g, '').split(/\s*\/\s*/)).map((n) => n.trim()).filter((n) => n.length >= 4);
/* the brand's upcoming events by name, one date per name: the brand's own calendar (calendar.js upcoming: the Learned page's
   "Coming up", announced dates included) first, so every page counts from the same date; then its sale day (config.festival); then
   the curated events for its market while the calendar has not loaded */
export function eventsFor(cfg = {}, nowMs = Date.now(), calendar = []) {
  const out = [], cc = String(cfg.country || '').toUpperCase(), today = brandDay(nowMs, cfg), y = +today.slice(0, 4);
  for (const e of calendar || []) { const k = dateKey(e?.date); if (k && (dateKey(e.end) || k) >= today) out.push({ names: namesOf(e), date: k }); }
  if (cfg.festival?.name && cfg.festival?.date) out.push({ names: namesOf(cfg.festival), date: dateKey(cfg.festival.date) });
  for (const ev of EVENTS.events) { if (!ev.markets?.includes('*') && !(cc && ev.markets?.includes(cc))) continue;
    for (const yy of [y, y + 1]) { const d = dateOf(ev, yy); const k = d && d.toISOString().slice(0, 10); if (k && k >= today) { out.push({ names: namesOf(ev), date: k }); break; } } }
  const seen = new Set(); /* a name the calendar dated is never dated again from the curated list */
  return out.filter((e) => e.date && e.names.length).reduce((a, e) => { const names = e.names.filter((n) => !seen.has(n.toLowerCase())); names.forEach((n) => seen.add(n.toLowerCase())); if (names.length) a.push({ ...e, names }); return a; }, []);
}
/* a countdown in saved words, counted again: only when the text names exactly one event, only the countdown phrases ("is 14 days
   away", "in 14 days", "14 days from today", "within 15 days"), never a lead time ("7 days before Diwali") or a run length, and only
   when the saved number is near today's (a drift of a few days), so an unrelated "30 days" is never touched */
const DRIFT = 10;
export function healDays(text, events, nowMs, zone = {}) {
  if (typeof text !== 'string' || !/\d+\s*days?\b/i.test(text) || !events?.length) return text;
  const named = events.filter((e) => e.names.some((n) => new RegExp(`\\b${esc(n)}\\b`, 'i').test(text)));
  const one = [...new Map(named.map((e) => [e.date, e])).values()]; if (one.length !== 1) return text;
  const ev = one[0], d = daysUntil(ev.date, nowMs, zone); if (d == null || d < 0) return text;
  const near = (n) => Math.abs(+n - d) <= DRIFT, nm = ev.names.map(esc).join('|');
  return text
    .replace(new RegExp(`\\b(${nm})(\\s+(?:is|falls|lands|arrives|starts|begins)?\\s*)(?:is\\s+)?(\\d+)\\s+days?\\s+away\\b`, 'gi'), (m, e, sp, n) => (near(n) ? (d === 0 ? `${e} is today` : `${e}${sp.trim() ? sp : ' is '}${daysWords(d)} away`) : m))
    .replace(new RegExp(`\\b(${nm})(\\s+(?:is\\s+|starts\\s+|begins\\s+|arrives\\s+|lands\\s+)?)in\\s+(\\d+)\\s+days?\\b`, 'gi'), (m, e, sp, n) => (near(n) ? (d === 0 ? `${e} is today` : `${e}${sp}in ${daysWords(d)}`) : m))
    .replace(/\b(\d+)\s+days?\s+(from today|from now|away|to go|left|out)\b/gi, (m, n, w) => (near(n) ? (d === 0 ? 'today' : `${daysWords(d)} ${w}`) : m))
    .replace(/\b(\d+)\s+days?\s+(until|till|to)\s+/gi, (m, n, w) => (near(n) ? `${daysWords(d)} ${w} ` : m))
    .replace(/\b(within|in the next|in)\s+(\d+)\s+days?\b/gi, (m, w, n) => (near(n) && d > 0 ? `${w} ${daysWords(d)}` : m));
}
/* every word a card or slide shows, healed in place on a copy (title, sub, rows, the proof's why/how; a slide's h, p and card) */
export function healDaysIn(o, events, nowMs, zone = {}) {
  if (!o || typeof o !== 'object' || !events?.length) return o;
  const h = (x) => healDays(x, events, nowMs, zone), out = { ...o };
  for (const k of ['title', 'sub', 'h', 'p', 'card', 'forUs']) if (typeof out[k] === 'string') out[k] = h(out[k]);
  if (Array.isArray(out.rows)) out.rows = out.rows.map((r) => (Array.isArray(r) ? r.map((x) => h(x)) : r));
  if (out.detail && typeof out.detail === 'object') out.detail = { ...out.detail, ...(Array.isArray(out.detail.why) ? { why: out.detail.why.map(h) } : {}), ...(Array.isArray(out.detail.how) ? { how: out.detail.how.map(h) } : {}) };
  return out;
}
