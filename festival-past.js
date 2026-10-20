// A festival move after its festival: a plan for Durga Puja the day after it ends is advice for an event that is over, and its
// cover countdown ("1 day until Durga Puja") was frozen the day it was written (QA 20 Oct). Pure helpers for every brand:
//   eventOf(move)          the event a seasonal move plans for ({ id, name, start, end } as YYYY-MM-DD), from move.dynamic
//                          "season:<event id>-<year>" and data/commerce-events.json
//   pastOf(move, today)    { name, end } once the event's last day is behind today, else null
//   liveStat(move, today)  the cover stat counted from today ("8 days"), for a stat that counts down to the event
// brand-pack fitMoves marks move.past, its cards leave the feed (brand-pack seed, feed-service followMoveCards) and the Moves page
// folds it under past festivals.
import { EVENTS, dateOf } from './calendar.js';

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

export function eventOf(move) {
  const m = /^season:(.+?)-(\d{4})$/.exec(String(move?.dynamic || ''));
  if (!m) return null;
  const [, id, y] = m, ev = (EVENTS.events || []).find((e) => e.id === id);
  if (!ev) return null;
  const d = dateOf(ev, +y); if (!d) return null;
  const start = ymd(d), end = addDays(start, Math.max(0, (+ev.span || 1) - 1));
  return { id, name: ev.name, start, end };
}

export function pastOf(move, today = new Date()) {
  const e = eventOf(move); if (!e) return null;
  const td = typeof today === 'string' ? today.slice(0, 10) : ymd(new Date(today));
  return e.end < td ? { name: e.name, end: e.end } : null;
}

/* "12 days" / "1 day" with a label that counts down to the event ("UNTIL KARVA CHAUTH", "AWAY FROM DURGA PUJA", "COUNTDOWN") */
export function liveStat(move, today = new Date()) {
  const e = eventOf(move); if (!e) return null;
  if (!/^\s*\d+\s*days?\s*$/i.test(String(move.stat || '')) || !/\b(until|away|countdown|to go|left)\b/i.test(String(move.statLabel || ''))) return null;
  const td = typeof today === 'string' ? today.slice(0, 10) : ymd(new Date(today));
  const n = Math.round((Date.parse(`${e.start}T00:00:00Z`) - Date.parse(`${td}T00:00:00Z`)) / 864e5);
  return n > 1 ? `${n} days` : n === 1 ? '1 day' : n === 0 ? 'Today' : null;
}
