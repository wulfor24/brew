// One AI-answers count per brand, quoted by every card (QV round 2, 26 Oct): Store health said "AI tools named Arata in 0 of 15
// answers" while a card said "Baseline mentions 0 of 10" and "zero of ten unbranded AI answers"; Nutrova read 0 of 14 beside
// "1 of 18" and "3 of 3". Cards keep the count of the check that was newest when they were written. The count is the newest single
// check (the read's answers or the weekly run, as Store health picks it: health.js aiRingOf, app.js healthNow), and a card's saved
// "N of M" about AI answers is recounted on read.
const WORD = { zero: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const NUM = `(\\d+|${Object.keys(WORD).filter((w) => w !== 'no').join('|')})`;

/* the ring Store health shows: the weekly run when it is read and at least as new as the read's (the client's rule, now on the server) */
export function aiRingNow(readRing, weeklyRing) {
  const r = readRing?.k === 'AI answers' ? readRing : null, w = weeklyRing?.read ? weeklyRing : null;
  if (w && (!r || r.read === false || String(w.at || '') >= String(r.at || r.stand?.at || ''))) return w;
  return r?.read ? r : null;
}
/* the count a card quotes: answers where the shopper didn't name the brand when the check asked those, else every answer */
export function aiFact(ring) {
  if (!ring?.read) return null; if (ring.count && Number.isFinite(+ring.count.of) && +ring.count.of > 0) return { n: +ring.count.n || 0, of: +ring.count.of, unbranded: !!ring.count.unbranded, at: ring.at || null };
  const p = ring.parts || []; /* a ring saved before it carried its count */
  const un = p.find((x) => x.k === 'Not asked by name'), m = un && /(\d+) of (\d+)/.exec(un.note || '');
  if (m) return { n: +m[1], of: +m[2], unbranded: true, at: ring.at || null };
  const all = /Named in (\d+) of (\d+)/.exec(ring.what || ''); return all ? { n: +all[1], of: +all[2], unbranded: false, at: ring.at || null } : null;
}
/* a card is about AI answers when its words say so */
export const AI_WORDS = /\bAI (?:answers?|tools?|assistants?|search|visibility|mentions?)\b|\b(?:ChatGPT|Gemini|Perplexity|generative (?:AI|answers?|engines?))\b|\bunbranded (?:AI )?answers?\b/i;
const NOUN = /^\s+(?:(?:the|unbranded|branded|generative|real|shopper|AI|tools?['’]?)\s+){0,3}(?:answers?|responses?|AI\b|generative\b)/i, END = /^\s*(?:$|[.,;:)\]–—-])/;
const NAMED = /\b(?:named|mention\w*|cited|appear\w*|saw|baseline)\b/i;
/* "N of M" in words about AI answers, recounted to the fact; any other "N of M" (products, reviews, days) is left alone */
export function healAiText(s, fact, bare = false) {
  if (typeof s !== 'string' || !fact || !/\bof\b/i.test(s)) return s;
  return s.replace(new RegExp(`\\b${NUM}(\\s+(?:out\\s+)?of\\s+)${NUM}\\b`, 'gi'), (m, a, mid, b, off, all) => {
    const rest = all.slice(off + m.length); if (!NOUN.test(rest) && !(END.test(rest) && (bare || NAMED.test(all.slice(Math.max(0, off - 48), off))))) return m;
    const n0 = /^\d+$/.test(a) ? +a : WORD[a.toLowerCase()], of0 = /^\d+$/.test(b) ? +b : WORD[b.toLowerCase()];
    if (n0 == null || of0 == null || n0 > of0 || (n0 === fact.n && of0 === fact.of)) return m;
    return `${fact.n}${mid}${fact.of}`;
  });
}
/* every word a card shows, on a copy; only for a card whose words are about AI answers */
export function healAiCard(c, fact) {
  if (!c || typeof c !== 'object' || !fact) return c;
  const words = [c.title, c.sub, c.h, c.p, c.card, ...(Array.isArray(c.rows) ? c.rows.flat() : [])].filter((x) => typeof x === 'string').join(' ');
  if (/^lv-vis-/.test(String(c.id || '')) || (!AI_WORDS.test(words) && c.family !== 'ai-seo')) return c; /* a per-question card counts the tools on its one question: another, labelled check */
  const h = (x) => healAiText(x, fact), out = { ...c };
  for (const k of ['title', 'sub', 'h', 'p', 'card']) if (typeof out[k] === 'string') out[k] = h(out[k]);
  /* a row's bare "0 of 10" is the count only when its label says so ("Baseline mentions", "Named in") */
  if (Array.isArray(out.rows)) out.rows = out.rows.map((r) => (Array.isArray(r) ? r.map((x, i) => (i > 0 && typeof r[0] === 'string' && (NAMED.test(r[0]) || /\banswers?\b|\bAI\b/i.test(r[0])) ? healAiText(x, fact, true) : h(x))) : r));
  if (out.detail && typeof out.detail === 'object') out.detail = { ...out.detail, ...(Array.isArray(out.detail.why) ? { why: out.detail.why.map(h) } : {}), ...(Array.isArray(out.detail.how) ? { how: out.detail.how.map(h) } : {}) };
  return out;
}
