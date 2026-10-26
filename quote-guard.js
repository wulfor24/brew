// Only real customers are quoted (QV round 2, 26 Oct): Mana Projects' first draft set "Mana Projects offers a range of r…" as its
// headline quote. That sentence is an AI tool's answer from the AI-answers check, not a buyer's words. Any brand: a headline or a copy
// line whose words are an AI answer's (5+ words in a row, a cut "…" ending allowed) leaves the draft, at write time and on every serve.
const norm = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, "'").replace(/[^a-z0-9₹%' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* the AI answers a brand's checks read: the read's answers and the weekly runs' */
export function aiTextsOf({ profile = null, runs = [] } = {}) {
  const xs = [...(profile?.ai?.answers || []), ...(runs || []).flatMap((r) => r?.answers || [])].map((a) => a?.text || a?.answer || a?.response || '').filter((t) => typeof t === 'string' && t.length > 40);
  return [...new Set(xs.map(norm))];
}
/* a line that repeats an AI answer: its words (a "…" cut drops its last, partial word) appear in a row in one */
export function fromAi(line, texts = []) {
  if (!texts.length || typeof line !== 'string') return false;
  let s = line.replace(/^[\s•*\-–\d.)]+/, '').replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
  if (/(?:…|\.\.\.)\s*["“”'‘’]?$/.test(s)) s = s.replace(/(?:…|\.\.\.)\s*["“”'‘’]?$/, '').replace(/\s*\S*$/, '');
  const n = norm(s); if (n.split(' ').length < 5) return false;
  return texts.some((t) => t.includes(n));
}
/* a draft (or its view) without the lines an AI answer wrote; the same object when nothing matched */
export function dropAiQuotes(d, texts = []) {
  if (!d || typeof d !== 'object' || !texts.length) return d;
  let out = d;
  if (fromAi(d.headline, texts)) { out = { ...out }; delete out.headline; delete out.headSmall; }
  for (const k of ['copy', 'title']) if (typeof d[k] === 'string') {
    const ls = d[k].split('\n'), kept = ls.filter((l) => !fromAi(l, texts) && !fromAi((/[“"]([^”"]{12,})[”"]/.exec(l) || [])[1], texts));
    if (kept.length !== ls.length) out = { ...out, [k]: kept.join('\n').trim() };
  }
  return out;
}
/* the writer is told the same rule */
export const QUOTE_RULE = 'Quote only real customer reviews from the brief, word for word, and only as a customer. An AI tool\'s answer, a search result or a web page is never a quote from a customer.';
