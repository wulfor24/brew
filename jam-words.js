// The words a jam's piece shows, right for every brand and every deliverable (QV 26 Oct, jam page): prices as the store shows
// them (₹2,182, never ₹2,182.15 or "‑‑2,182.15"), no "None" where a model meant nothing, a listing bullet never split at its own
// semicolon, a flow message that never tells every customer one invented order value, step dates that are ahead of today and
// read "Tue 28 Oct", and a checklist titled by its heading, not its whole text. Pure functions: the writer's output passes them
// (studio.js cleanPkg, server.js clean) and saved jams heal on read (remix.js pubChange). Free, no model call.

/* a currency sign a writer's output lost on the way: "‹2,182" (seen 20 Oct) and "‑‑2,182.15" (two U+2011 hyphens, 26 Oct
   LinkedIn post) stand where the sign was. Only before a number, after a space or the start, so "COVID‑19" stays */
export const fixSign = (s, sym = '₹') => (typeof s !== 'string' || !s ? s : s.replace(/(^|[\s(“"'])(?:‹|[‐‑]{2})(?=\s?\d)/g, `$1${sym}`));

/* rupees are whole on every Indian store: "₹2,182.15" → "₹2,182", "Rs. 99.50" → "Rs. 100" (the store rounds the same way) */
export const wholeRupees = (s) => (typeof s !== 'string' || !s ? s : s.replace(/(₹|\bRs\.?|\bINR)(\s?)(\d[\d,]*)\.(\d{1,2})\b(?!\.\d|\s?(?:lakh|lac|crore|cr|k|l|m|mn|bn|thousand|million|billion)\b)/gi, (m, sym, sp, a, b) => `${sym}${sp}${Math.round(+`${a.replace(/,/g, '')}.${b}`).toLocaleString('en-IN')}`));

/* both, for any text a writer hands back */
export const moneyWords = (s, sym = '₹') => wholeRupees(fixSign(s, sym));

/* a model's "nothing here" ("None", "null", "N/A", "-") is an empty cell, never a word on the stage (QV P1-7: "0-3 S None") */
export const NONE = /^\s*(?:none|null|nil|n\/?a|undefined|-+|—|–)\s*\.?\s*$/i;
export const noneCell = (v) => (typeof v === 'string' && NONE.test(v) ? '' : v);

/* a list the writer gave as one line split at its semicolons only where a new item starts: "90-DAY HABIT TRAIL: Designed for
   regular use; use consistently for 90 days" is one bullet (QV P1-5). Saved lists heal: an item that starts in lower case
   continues the one before it */
export const splitList = (val) => String(val || '').split(/\n|\s*;\s*(?=(?:[-•*]\s*)?(?:[A-Z0-9“"(₹]))/);
export const joinList = (xs) => { if (!Array.isArray(xs)) return xs; const out = [], up = xs.filter((x) => /^\s*[A-Z0-9“"(₹]/.test(String(x || ''))).length; if (up * 2 < xs.length) return xs; /* a list written all in lower case is the writer's style, never one item */
  for (const x of xs) { if (typeof x === 'string' && out.length && typeof out[out.length - 1] === 'string' && /^[a-z]/.test(x.trim()) && !/[.!?]$/.test(out[out.length - 1].trim())) out[out.length - 1] = `${out[out.length - 1].trim()}; ${x.trim()}`; else out.push(x); }
  return out.length === xs.length ? xs : out; };

/* a flow message goes to everyone the trigger catches: "Your order of ₹6,500 qualifies…" told every abandoner one invented
   cart (QV P1-12). The amount comes off the customer's order or cart; the store's own threshold ("above ₹650") stays */
const PER_ONE = /\b(your\s+(?:order|cart|basket|bag)(?:\s+(?:total|value))?)\s+(?:of|worth|at|for|is)\s+(?:₹|Rs\.?\s?|INR\s?|[$€£])\s?\d[\d,]*(?:\.\d+)?\b/gi;
const PER_ONE2 = /\b(your)\s+(?:₹|Rs\.?\s?|INR\s?|[$€£])\s?\d[\d,]*(?:\.\d+)?\s+(order|cart|basket|bag)\b/gi;
export const noInventedTotal = (s) => { if (typeof s !== 'string' || !s) return s;
  const x = s.replace(PER_ONE, '$1').replace(PER_ONE2, '$1 $2'); if (x === s) return s;
  return x.replace(/\b(your\s+(?:order|cart|basket|bag))\s+qualifies for ([^.!?\n]{1,60}?),?\s+(?:since|as|because)\s+it(?:'s|’s| is)\s+(above|over)\s+/gi, (m, a, b, c) => `${a} qualifies for ${b} when it is ${c} `); };

/* dates in steps: "by 2026-10-24" written at draft time reads as past two days later (QV P1-9). A date that has gone by moves
   ahead by as many days as it first stood from the draft (at least one), and every date reads "Tue 28 Oct" */
const DAY = 864e5, WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
export const dayLabel = (ms) => { const d = new Date(ms); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
export const datesAhead = (s, { now = Date.now(), from = null } = {}) => { if (typeof s !== 'string' || !/\b20\d\d-\d\d-\d\d\b/.test(s)) return s; const today = ymd(now), made = from ? ymd(from) : null;
  return s.replace(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, (m, y, mo, d) => { let at = Date.UTC(+y, +mo - 1, +d); if (Number.isNaN(at)) return m;
    if (at < today) at = today + Math.max(1, made != null && at > made ? Math.round((at - made) / DAY) : 1) * DAY; return dayLabel(at); }); };

/* a checklist's text as markdown: its heading is the title, the rest the lede (QV P1-8: the whole doc stood as the H1, then again
   under it). No heading: the first sentence up to its colon, at a whole word */
const md = (x) => String(x || '').replace(/^#{1,6}\s*/, '').replace(/\*\*|__/g, '').trim();
const clip = (x, n) => { x = String(x || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.–—-]+$/, '')}…` : x; };
export const docTitle = (what) => { const lines = String(what || '').split('\n').map(md).filter(Boolean); if (!lines.length) return '';
  if (lines.length > 1 && lines[0].length <= 80 && !/[.!?]$/.test(lines[0])) return lines[0].replace(/:$/, '');
  const s = lines[0].split(/(?<=[.!?])\s+/)[0], c = /^(.{3,70}?):\s/.exec(s); return clip(c ? c[1] : s.replace(/[.]$/, ''), 80); };
export const docLede = (what) => { const t = docTitle(what), lines = String(what || '').split('\n').map(md).filter(Boolean); if (!lines.length) return '';
  const rest = lines[0].replace(/:$/, '') === t ? lines.slice(1) : [lines[0].startsWith(t) ? lines[0].slice(t.length).replace(/^[:.\s]+/, '') : lines[0], ...lines.slice(1)];
  const body = rest.find((l) => l.length > 30 && !/^[-•*]|^\d+[.)]\s/.test(l)) || rest.find(Boolean) || ''; return clip(body, 240); };

/* a script's length from its beats ("12-15 s" → 15): the video line says the length the beats run to (QV P1-7) */
export const beatsEnd = (script) => { let end = 0; for (const b of Array.isArray(script) ? script : []) { const m = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\s*$/i.exec(String(b?.beat || '').replace(/[–—]/g, '-').trim()); if (m && /\d\s*-\s*\d|^\d/.test(String(b?.beat || '').replace(/[–—]/g, '-'))) end = Math.max(end, +m[1]); } return end || null; };
/* "0-3 S" → "0–3 s": the beat as a time, never capitalised by the chip */
export const beatTime = (x) => String(x || '').replace(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\.?$/i, '$1–$2 s');

/* every text field of a package, walked: money, "None", lists. Keys that hold addresses, pictures or ids are left as they are */
const SKIP = /^(?:id|url|link|href|src|img|image|images|cardImages|photos|photoSet|poster|video|draft|knobs|grade|wordsIn|wordsInAll|film|aplus|utm)$/i;
const walk = (v, f, k = '', d = 0) => { if (d > 4 || SKIP.test(k)) return v; if (typeof v === 'string') return f(v, k);
  if (Array.isArray(v)) { let ch = false; const out = v.map((x) => { const y = walk(x, f, k, d + 1); if (y !== x) ch = true; return y; }); return ch ? out : v; }
  if (v && typeof v === 'object') { let ch = false; const out = {}; for (const [kk, x] of Object.entries(v)) { const y = walk(x, f, kk, d + 1); if (y !== x) ch = true; out[kk] = y; } return ch ? out : v; }
  return v; };

/* the package's words, healed. Same object back when nothing changed (callers save only then). sym: the brand's currency sign */
export const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', JPY: '¥', AED: 'AED ' };
export const symOf = (cur) => SYM[String(cur || '').toUpperCase()] || '₹';
export const healWords = (family, action, pkg, { sym = '₹' } = {}) => { if (!pkg || typeof pkg !== 'object') return pkg;
  let p = walk(pkg, (s, k) => { let x = moneyWords(s, sym); if (k === 'line' || k === 'shot' || k === 'onSlide' || k === 'text') x = noneCell(x); return x; });
  if (Array.isArray(p.bullets)) { const b = joinList(p.bullets); if (b !== p.bullets) p = { ...p, bullets: b }; }
  if (family === 'crm' && (p.flow || p.trigger || p.segment || /flow|abandon|cart|winback|welcome|post_purchase/.test(String(action || '')))) for (const k of ['message', 'body', 'subject', 'preheader']) { const x = noInventedTotal(p[k]); if (x !== p[k]) p = { ...p, [k]: x }; }
  return p; };
