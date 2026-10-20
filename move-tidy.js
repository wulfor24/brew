// What a saved move shows, tidied at load for every brand (moves audit 20 Oct, P2s). Nothing here is written back: the stored
// move stays as the writer made it, the page, the PDF and the cards read the tidy one.
//  - one date stamp per sentence ("1,577 live ads on 19 Oct in India on 19 Oct")
//  - "To confirm" lines without machine echoes ("48%: 48%", a pasted diagram) or repeats
//  - no empty blocks (a blank diagram, an example with a title and no body), table rows as wide as their header, "\n" as a break
//  - a table that is mostly "To be pulled" says what it still needs in one line
//  - the cover: no "27 days DAYS UNTIL…" doubled unit; a zero, or a number other moves of the brand already lead with, gives way
//    to the summary (the page and the Moves card show `gives` when there is no stat)
const DAY = '(?:\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)';
const TWICE = new RegExp(`(\\bon (${DAY})\\b)([^.!?\\n]*?)\\s+on \\2\\b`, 'g');
export const onceDated = (s) => (typeof s === 'string' && TWICE.test(s) ? s.replace(TWICE, '$1$3') : s);
const deep = (o, f, d = 0) => { if (d > 7 || o == null) return o; if (typeof o === 'string') return f(o); if (Array.isArray(o)) return o.map((x) => deep(x, f, d + 1)); if (typeof o !== 'object') return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /^(?:url|src|id|key|t|kind|group|skill|family|meta|factsUsed|derived|newFacts)$/.test(k) ? v : deep(v, f, d + 1)])); };
const PULL = /^\s*to be pulled\.?\s*$/i;
const tidyBlock = (b) => {
  if (!b || typeof b !== 'object') return b;
  if (b.t === 'diagram') { const text = String(b.text || '').replace(/\\n/g, '\n'); return text.trim() ? { ...b, text } : null; }
  if (b.t === 'example' && !String(b.body || '').trim()) return null;
  if (b.t === 'table' && Array.isArray(b.rows)) {
    const w = Array.isArray(b.head) && b.head.length ? b.head.length : Math.max(0, ...b.rows.map((r) => (Array.isArray(r) ? r.length : 0)));
    const rows = b.rows.filter(Array.isArray).map((r) => (r.length === w ? r : r.length > w ? r.slice(0, w) : [...r, ...Array(w - r.length).fill('')]));
    const cells = rows.flatMap((r) => r.slice(1)), pulled = cells.filter((x) => PULL.test(String(x))).length, blank = cells.filter((x) => !String(x ?? '').trim()).length;
    if (!rows.length || (cells.length && blank === cells.length)) return null;
    if (cells.length >= 6 && pulled / cells.length >= 0.6) { const needs = [...new Set(rows.map((r) => r[0]).filter(Boolean))].slice(0, 8);
      return { t: 'p', text: `Still to pull before this table is filled in: ${needs.join(', ')}.`, items: [], ordered: false, head: [], rows: [], caption: '', title: '', label: '', body: '' }; }
    return { ...b, rows };
  }
  if ((b.t === 'p' || b.t === 'callout') && !String(b.text || '').trim() && !String(b.title || '').trim()) return null;
  if (b.t === 'list' && Array.isArray(b.items) && !b.items.some((x) => String(x || '').trim())) return null;
  return b;
};
const MACHINE = /^(\S+):\s*\1(?:\s|$)/;
const tidyConfirm = (xs) => { const seen = new Set(), out = [];
  for (const x0 of Array.isArray(xs) ? xs : []) { const x = String(x0 || '').trim(); if (!x || MACHINE.test(x) || /[┌│└─]{2}/.test(x)) continue; const k = x.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(x); }
  return out; };
/* "27 days" + "DAYS UNTIL HOLIDAY GIFTING LAUNCH" → "UNTIL HOLIDAY GIFTING LAUNCH" */
const statLabelOf = (stat, label) => { const last = String(stat || '').trim().split(/\s+/).pop()?.toLowerCase(), w = String(label || '').trim().split(/\s+/);
  return last && /[a-z]/.test(last) && w.length > 1 && w[0].toLowerCase() === last ? w.slice(1).join(' ') : label; };
export function tidyMove(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.sections)) return m;
  const d = deep(m, onceDated);
  return { ...d, sections: d.sections.map((sec) => ({ ...sec, blocks: (sec.blocks || []).map(tidyBlock).filter(Boolean) })),
    ...(Array.isArray(d.toConfirm) ? { toConfirm: tidyConfirm(d.toConfirm) } : {}), ...(d.statLabel ? { statLabel: statLabelOf(d.stat, d.statLabel) } : {}) };
}
/* across a brand's moves: a cover number that is 0, or that an earlier move already leads with, gives way to the summary */
const statKey = (m) => String(m?.stat || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function tidyStats(docs = {}) {
  const seen = new Set(), out = { ...docs };
  for (const m of Object.values(docs).filter((x) => x && +x.n > 0).sort((a, b) => a.n - b.n)) {
    const k = statKey(m); if (!k) continue;
    const zero = /^[₹$€£]?\s*0(?:\.0+)?\s*%?$/.test(k) || /^0 (?:vs|of)\b/.test(k) && /\b0$/.test(k);
    if (zero || seen.has(k)) out[m.n] = { ...m, stat: '', statLabel: '', statHidden: zero ? 'zero' : 'repeat' }; else seen.add(k);
  }
  return out;
}
