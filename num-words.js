// Numbers a person reads are written in digits (QV P2-16, 26 Oct): "post at ten fifteen am", "before November eighth",
// "forty-one public reviews with twelve unanswered", "Born in the nineteen-seventies" read like a bug on a card or a draft. On every
// serve: times, dates and decades always in digits; counts of 11 and over in digits too. Small counts ("one version", "two posts a
// week") stay words, as the cards say them.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const ONE_RE = ONES.join('|'), TEN_RE = Object.keys(TENS).join('|');
/* "forty-one", "twelve", "thirty" → a number (null when the words are not one) */
const CARD = new RegExp(`\\b(?:(${TEN_RE})(?:[-\\s](${ONES.slice(1, 10).join('|')}))?|(${ONE_RE}))\\b`, 'i');
export const wordNum = (w) => { const m = new RegExp(`^${CARD.source}$`, 'i').exec(String(w || '').trim()); if (!m) return null; return m[3] ? ONES.indexOf(m[3].toLowerCase()) : TENS[m[1].toLowerCase()] + (m[2] ? ONES.indexOf(m[2].toLowerCase()) : 0); };
const ordNum = (w) => { const s = String(w || '').toLowerCase().trim(); if (ORD[s]) return ORD[s]; const m = /^(twenty|thirty)[-\s](\w+)$/.exec(s); return m && ORD[m[2]] && ORD[m[2]] < 10 ? TENS[m[1]] + ORD[m[2]] : null; };
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const NUM = `(?:(?:${TEN_RE})(?:-(?:${ONES.slice(1, 10).join('|')}))?|${ONE_RE})`;
const ORDS = `(?:(?:twenty|thirty)-(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|${Object.keys(ORD).join('|')})`;
export function numeralsIn(text, { counts = true, locale = 'en-IN' } = {}) {
  if (typeof text !== 'string' || !text) return text;
  let x = text
    /* "ten fifteen am", "nine o'clock pm", "seven thirty in the evening" → 10:15 am */
    .replace(new RegExp(`\\b(${ONES.slice(1, 13).join('|')})(?:[\\s-](o['’]clock|${NUM}))?\\s+(a\\.m\\.|p\\.m\\.|am|pm)(?=[\\s,.;:!?)]|$)`, 'gi'), (m, h, mm, ap) => {
      const H = ONES.indexOf(h.toLowerCase()), M = !mm || /clock/i.test(mm) ? 0 : wordNum(mm); if (M == null || M > 59) return m;
      return `${H}${M ? `:${String(M).padStart(2, '0')}` : ''} ${ap.replace(/\./g, '').toLowerCase()}`; })
    /* "November eighth" → "8 November", "the eighth of November" → "8 November" */
    .replace(new RegExp(`\\b(${MONTHS})\\s+(${ORDS})\\b`, 'gi'), (m, mo, d) => { const n = ordNum(d); return n ? `${n} ${mo}` : m; })
    .replace(new RegExp(`\\b(?:the\\s+)?(${ORDS})\\s+of\\s+(${MONTHS})\\b`, 'gi'), (m, d, mo) => { const n = ordNum(d); return n ? `${n} ${mo}` : m; })
    /* "the nineteen-seventies" → "the 1970s" */
    .replace(/\b(nineteen|twenty)[-\s](twent|thirt|fort|fift|sixt|sevent|eight|ninet)ies\b/gi, (m, c, d) => `${c.toLowerCase() === 'nineteen' ? 19 : 20}${{ twent: 2, thirt: 3, fort: 4, fift: 5, sixt: 6, sevent: 7, eight: 8, ninet: 9 }[d.toLowerCase()]}0s`);
  /* a big count with its separators, as the brand's market writes it ("1015 live ads" → "1,015 live ads", QV P2-5): only before a
     word that counts something, so a year, a code or an id is never touched */
  x = x.replace(/(^|[\s(])(\d{4,9})(?=\s+(?:new\s+|public\s+|live\s+|active\s+|unanswered\s+)?(?:live|ads?|replies|reviews?|ratings?|orders?|people|visitors?|visits|searches|followers|views|comments|posts|products?|customers?|buyers?|sessions|clicks|units|mentions|answers|questions|subscribers|likes|shares|impressions|times)\b)/g, (m, pre, n) => `${pre}${(+n).toLocaleString(locale)}`);
  /* a count of 11 or more said in words ("forty-one public reviews", "twelve unanswered") */
  if (counts) x = x.replace(new RegExp(`\\b(${NUM})\\b(?=\\s+[a-z])`, 'gi'), (m) => { const n = wordNum(m); return n != null && n >= 11 ? String(n) : m; });
  return x;
}
/* every word a card shows, healed on a copy (title, sub, rows, the proof's why/how); a margin note keeps its words for counts */
export function numeralsCard(o, { locale = 'en-IN' } = {}) {
  if (!o || typeof o !== 'object') return o; const out = { ...o }, d = (v) => numeralsIn(v, { locale });
  for (const k of ['title', 'sub']) if (typeof out[k] === 'string') out[k] = d(out[k]);
  if (Array.isArray(out.rows)) out.rows = out.rows.map((r) => (Array.isArray(r) ? r.map(d) : r));
  if (out.detail && typeof out.detail === 'object') out.detail = { ...out.detail, ...(Array.isArray(out.detail.why) ? { why: out.detail.why.map(d) } : {}), ...(Array.isArray(out.detail.how) ? { how: out.detail.how.map(d) } : {}) };
  if (out.note?.h) out.note = { ...out.note, h: numeralsIn(out.note.h, { counts: false, locale }) };
  if (out.draft && typeof out.draft === 'object') out.draft = { ...out.draft, ...['title', 'headline', 'copy'].reduce((a, k) => (typeof out.draft[k] === 'string' ? { ...a, [k]: d(out.draft[k]) } : a), {}) };
  return out;
}
