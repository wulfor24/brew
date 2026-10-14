// A brand's move documents (brand-pack.js moveDocs).
// Cards name their moves in `src` ("Moves 28 and 43", "Move 21 · example 5"). This finds the moves and
// the passages in them that speak to a card, so remix packages and the jam can follow what the moves say.
import { live } from './brand-ctx.js';

const STOP = new Set('the a an and or of to in on for with is are be we our your you it this that by at as from per one two three each every not no new more than into out up its their them they have has was were will can all any about after before over under what when who how why which also just only very most'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/\{\{[^}]+\}\}/g, ' ').match(/[a-z0-9₹%]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) || [];

export function createMoves(ROOT) {
  // the active brand's move documents and their short labels (brand-pack.js)
  const M = live((b) => b.moveDocs), L = live((b) => b.labels);
  const fit = (s, n) => { s = String(s || '').replace(/^\[|\]$/g, '').replace(/^(example|step|part)\s*\d+\s*[:.\-–—]\s*/i, '').trim(); s = s.charAt(0).toUpperCase() + s.slice(1); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, ''); };
  const label = (n, h) => L[n]?.heads?.[h] || fit(h, 28);
  const short = (n) => L[n]?.short || fit(M[n]?.title, 28);
  const line = (n) => L[n]?.line || fit(M[n]?.gives, 120);
  const tag = (n, h) => `Move ${String(n).padStart(2, '0')} · ${h ? label(n, h) : short(n)}`;
  // "Moves 01, 04, 08 and 17" or "Move 21 · example 5" → [1, 4, 8, 17] / [21]
  const numsOf = (src) => { const m = String(src || '').match(/^moves?\s+([\d,\sand]+)/i); return m ? [...new Set((m[1].match(/\d+/g) || []).map(Number))].filter((n) => M[n]) : []; };
  const summary = (n) => { const m = M[n]; return m && { n: m.n, title: m.title, stat: m.stat, statLabel: m.statLabel, gives: m.gives, live: m.live, why: m.why, measure: m.measure, sections: m.sections.map((s) => s.h) }; };
  // the passages across a card's moves that best match what the card is about
  const passages = (c, k = 4, extra = '') => {
    const ns = numsOf(c.src); if (!ns.length) return [];
    const q = words([c.title, c.sub, c.cta?.label, ...(c.detail?.how || []), ...(c.detail?.why || []), extra].join(' '));
    const qs = new Set(q); const out = [];
    for (const n of ns) for (const s of M[n]?.sections || []) for (const p of s.paras || []) { // a move written in a shorter shape has no paragraphs
      const w = words(p); if (w.length < 8) continue;
      let hit = 0; for (const x of new Set(w)) if (qs.has(x)) hit++;
      const head = words(s.h).filter((x) => qs.has(x)).length;
      const score = hit / Math.sqrt(w.length) + head * 0.6 + (/^(example|launch|the plan|what we|how we)/i.test(s.h) ? 0.3 : 0);
      if (hit >= 2) out.push({ n, move: M[n].title, h: s.h, text: p.length > 700 ? p.slice(0, 700).replace(/\s+\S*$/, '') + '…' : p, score });
    }
    out.sort((a, b) => b.score - a.score);
    // no more than two passages from one section, so the options get different starting points
    const per = {}; return out.filter((x) => (per[x.n + x.h] = (per[x.n + x.h] || 0) + 1) <= 2).slice(0, k);
  };
  return { numsOf, summary, passages, has: (n) => !!M[n], label, short, line, tag };
}
