// The Recap ring: what happened since this person was last here, from what Brew already holds (no AI call).
// A visit starts after VISIT_GAP of quiet; the one before it ended at visit.prev. Recap shows:
//   briefs the ShopOS team moved (w.jamBrief.history), jams that changed (notes, new versions, waiting on you),
//   new cards (count + the top ones by rank), moves rewritten (meta.rewrittenAt), and connected numbers that moved
//   (the real ledger only: simulated rows never reach t.liveLedger, so the demo never shows them as real).
// Nothing since the last visit, or no last visit yet: no slides, and the ring does not show.
import { LABEL } from './brief-status.js';

export const VISIT_GAP = 30 * 60e3;

/* one request from this person: a new visit when the last one went quiet for VISIT_GAP. Times are kept twice: on the
   workspace clock (now(t), which Demo Mode moves forward) for cards, notes and versions, and real time for briefs, moves and
   accounts. base keeps the connected numbers as they stood at the end of the last visit, to say which moved */
export function visitTick(t, at, real = Date.now()) {
  const v = t.visit;
  /* a workspace from before visits were kept: the last time a ring was opened stands in for the last visit */
  if (!v) { const seen = Math.max(0, ...Object.values(t.storySeen || {}).map(Number).filter(Number.isFinite)), back = seen && real - seen > VISIT_GAP ? real - seen : 0;
    t.visit = { at, atReal: real, last: at, lastReal: real, prev: back ? at - back : null, prevReal: back ? seen : null, base: null }; return t.visit; }
  if (at - v.last > VISIT_GAP) { v.prev = v.last; v.prevReal = v.lastReal || real; v.at = at; v.atReal = real; v.base = ledgerNums(t.liveLedger); }
  v.last = at; v.lastReal = real; return v;
}
const ledgerNums = (L) => Object.fromEntries(Object.entries(L || {}).filter(([, e]) => Number.isFinite(+e?.n)).map(([k, e]) => [k, { n: +e.n, v: e.v }]));

/* a slide about several things leads with how many (no hero for one, never a zero) */
const big = (n, label) => (n > 1 ? { big: n, bigLabel: label } : {});
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const STATUS_LINE = { received: 'They have it', in_progress: 'They are on it', needs_info: 'They need something from you', delivered: 'Delivered' };

/* the Recap's first line: when the last visit was, in plain words */
export function sinceLabel(prev, now, tzMs = 5.5 * 3600e3) {
  const h = (now - prev) / 3600e3; if (h < 20) return h < 1.5 ? 'In the last hour' : `In the last ${Math.round(h)} hours`;
  const day = (ms) => Math.floor((ms + tzMs) / 864e5), d = day(now) - day(prev);
  if (d <= 1) return 'Since yesterday'; if (d < 7) return `Since ${new Date(prev + tzMs).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}`; return `In the last ${d} days`;
}

/**
 * @param o.since  last visit's end on the workspace clock; o.sinceReal the same in real time
 * @param o.work   t.work; o.notes t.notes; o.cards the ranked, visible cards (best first)
 * @param o.moveDocs the brand's moves; o.moveCard(n) → a visible card id for move n, or null
 * @param o.ledger t.liveLedger (real rows only); o.base the numbers at the end of the last visit
 */
export function buildRecap(o) {
  const { since, sinceReal } = o; if (!since) return [];
  const live = (w) => !w.archived && !w.discarded, slides = [], tally = [];
  /* briefs with the ShopOS team: a move the team made since (the brand sending it is not news to them) */
  const briefs = (o.work || []).filter(live).map((w) => { const moves = (w.jamBrief?.history || []).filter((h) => h.at > sinceReal && h.s !== 'sent');
    return moves.length ? { w, moves, at: moves[0].at } : null; }).filter(Boolean).sort((a, b) => b.at - a.at);
  if (briefs.length) { tally.push(plural(briefs.length, 'brief') + ' moved with the ShopOS team');
    slides.push({ type: 'recap', kind: 'briefs', chip: 'With the ShopOS team', h: briefs.length === 1 ? `${briefs[0].w.title}` : 'Where each one is now', ...big(briefs.length, 'Briefs moved'), at: briefs[0].at,
      p: briefs.length === 1 ? `${STATUS_LINE[briefs[0].w.jamBrief.status] || LABEL[briefs[0].w.jamBrief.status] || 'It moved'}.${briefs[0].moves[0].note ? ` “${String(briefs[0].moves[0].note).slice(0, 160)}”` : ''}` : null,
      rows: briefs.slice(0, 4).map(({ w, moves }) => ({ t: w.title, s: [...moves].reverse().map((h) => LABEL[h.s] || h.s).join(' → '), workId: w.id, warn: w.jamBrief.status === 'needs_info' })) }); }
  /* jams: new messages, new versions, or waiting on your OK since */
  const jams = (o.work || []).filter(live).map((w) => {
    const msgs = (o.notes || []).filter((n, i, a) => n.itemId === w.id && n.at > since && !a.slice(0, i).some((m) => m.itemId === w.id && m.text === n.text)), /* the same update twice says it once */ vers = (w.versions || []).filter((v) => v.n > 1 && v.at > since), ok = w.stage === 'needs_you' && (w.updatedAt || 0) > since;
    if (!msgs.length && !vers.length && !ok) return null;
    const bits = [msgs.length && plural(msgs.length, 'update'), vers.length && (vers.length === 1 ? `New version (v${vers[0].n})` : `${vers.length} new versions`), ok && 'Needs your OK'].filter(Boolean);
    return { w, s: bits.join(' · '), last: msgs[0]?.text || null, ok, at: Math.max(0, ...msgs.map((n) => n.at), ...vers.map((v) => v.at), ok ? w.updatedAt : 0) };
  }).filter(Boolean).sort((a, b) => b.ok - a.ok || b.at - a.at);
  if (jams.length) { tally.push(plural(jams.length, 'jam') + ' changed');
    slides.push({ type: 'recap', kind: 'jams', chip: 'Your jams', h: jams.length === 1 ? jams[0].w.title : jams.some((x) => x.ok) ? (jams.filter((x) => x.ok).length === 1 ? 'One needs your OK' : `${jams.filter((x) => x.ok).length} need your OK`) : 'New updates and versions', ...big(jams.length, 'Jams changed'), at: jams[0].at,
      p: jams.length === 1 ? (jams[0].last ? `${jams[0].s}. Latest: ${String(jams[0].last).slice(0, 140)}` : `${jams[0].s}.`) : null,
      rows: jams.slice(0, 4).map((x) => ({ t: x.w.title, s: x.s, workId: x.w.id, warn: x.ok })) }); }
  /* new cards since, best first */
  const fresh = (o.cards || []).filter((c) => (c.createdAt || 0) > since);
  if (fresh.length) { tally.push(plural(fresh.length, 'new card'));
    slides.push({ type: 'recap', kind: 'cards', chip: 'New in your feed', h: fresh.length === 1 ? fresh[0].title : 'The strongest ones first', ...big(fresh.length, 'New cards'), at: Math.max(...fresh.map((c) => c.createdAt)),
      p: fresh.length === 1 ? fresh[0].sub || '' : null, img: fresh.length === 1 ? fresh[0].images?.[0] || null : null,
      rows: fresh.slice(0, 3).map((c) => ({ t: c.title, s: c.badge?.[0] === 'Updated' ? 'Updated' : null, cardId: c.id, img: c.images?.[0] && !String(c.images[0]).startsWith('data:') ? c.images[0] : null })) }); }
  /* moves rewritten since (new evidence, a retired fact) */
  const moved = Object.entries(o.moveDocs || {}).map(([n, m]) => ({ n: +n, m, at: Date.parse(m?.meta?.rewrittenAt || 0) || 0 })).filter((x) => x.at > sinceReal && x.n >= 1 && x.n < 1000).sort((a, b) => b.at - a.at);
  if (moved.length) { tally.push(plural(moved.length, 'move') + ' rewritten');
    slides.push({ type: 'recap', kind: 'moves', chip: 'Moves rewritten', h: moved.length === 1 ? moved[0].m.title : 'Each one with the latest evidence', ...big(moved.length, 'Moves rewritten'), at: moved[0].at,
      p: moved.length === 1 ? (moved[0].m.meta?.because ? `${moved[0].m.meta.because}.`.replace(/\.\.$/, '.') : 'Rewritten with the latest evidence.') : null,
      rows: moved.slice(0, 4).map((x) => ({ t: x.m.title, s: x.m.meta?.because || null, move: x.n, cardId: o.moveCard?.(x.n) || null })) }); }
  /* connected accounts: a real number that moved since the last visit */
  const base = o.base || {}, nums = Object.entries(o.ledger || {}).filter(([k, e]) => base[k] && Number.isFinite(+e?.n) && +e.n !== base[k].n && (e.at || 0) > sinceReal)
    .map(([k, e]) => ({ k, label: e.label || k, was: base[k].v ?? String(base[k].n), now: e.v ?? String(e.n), up: +e.n > base[k].n, d: Math.abs(+e.n - base[k].n) / Math.max(1e-9, Math.abs(base[k].n)) }))
    .sort((a, b) => b.d - a.d);
  if (nums.length) { tally.push(plural(nums.length, 'number') + ' moved in your accounts');
    slides.push({ type: 'recap', kind: 'accounts', chip: 'Your connected accounts', h: nums.length === 1 ? `${nums[0].label}: ${nums[0].now}` : 'Since you were last here', ...big(nums.length, 'Numbers moved'), at: Math.max(...Object.values(o.ledger).map((e) => e.at || 0)),
      p: nums.length === 1 ? `It was ${nums[0].was} when you were last here.` : null, conn: true,
      rows: nums.slice(0, 4).map((x) => ({ t: x.label, s: `${x.was} → ${x.now}`, up: x.up })) }); }
  if (!slides.length) return [];
  /* more than one thing happened: a first slide that says it all in one breath */
  if (slides.length > 1) slides.unshift({ type: 'recap', kind: 'summary', chip: 'Since you were last here', h: o.when || 'While you were away', at: Math.max(...slides.map((s) => s.at || 0)), tally });
  return slides;
}
