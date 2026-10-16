// The brand calendar with the shared confirmed-dates file (_brew/calendar/confirmed.json): an entry the confirm run only
// tried ({ tried }) is not a date. It used to be read as one, and "Invalid time value" emptied every brand's calendar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendar } from '../calendar.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const mk = (conf) => {
  const files = { 'profile.json': { country: 'IN', category: 'Hair care', name: 'Arata' }, 'config.json': { country: 'IN' }, 'calendar/confirmed.json': conf };
  return createCalendar({ packs: { getJSON: async (s, f, d) => files[f] ?? d, put: async () => {} }, ai: null, log: quiet, today: () => new Date('2026-10-16T00:00:00Z') });
};

test('a tried-only confirmed entry keeps the estimate; a confirmed date replaces it; a bad date never throws', async () => {
  const conf = { 'amazon-gif-2026': { tried: 1 }, 'diwali-2026': { date: '2026-11-09', end: '2026-11-09', url: 'https://x' }, 'navratri-2026': { date: 'soon', end: 'later' } };
  const evs = await mk(conf).upcoming('x', { days: 120 });
  assert.ok(evs.length > 5, 'the calendar has events');
  assert.ok(evs.some((e) => e.id === 'amazon-gif-2026'), 'a tried-only entry keeps the estimated event');
  const dw = evs.find((e) => e.id === 'diwali-2026'); assert.ok(dw && dw.confirmed && dw.date === '2026-11-09', 'the announced date wins');
  const nv = evs.find((e) => e.id === 'navratri-2026'); assert.ok(nv && !nv.confirmed, 'an unreadable date falls back to the estimate');
  assert.ok(evs.every((e) => /^\d{4}-\d\d-\d\d$/.test(e.date) && /^\d{4}-\d\d-\d\d$/.test(e.end)), 'every date is a real day');
});
