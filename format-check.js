// Every piece is formatted for where it runs before anyone sees it (27 Oct, Param: "always have formatting check for every type of
// deliverable before showing it"). A writer's Markdown never reaches a channel that shows it raw, a button is never a bare URL,
// WhatsApp gets its own *bold*, and lists and spacing read the way the channel draws them. Deterministic and idempotent: run on
// every save (remix.js sync), the same package twice comes back the same. → { pkg, fixes: [what was tidied, in plain words] }
//   whatsapp   **x** → *x*, __x__ → _x_, "- " / "* " bullets → "• ", no "# " headings, buttons ≤ 25 characters, at most 3, no URLs
//   sms        no *, _ or ~ markup (shown raw), no headings, bullets → "• "
//   email      no Markdown emphasis or headings in the subject or body (shown as plain text), bullets → "• "
//   post / ad  LinkedIn, Instagram, Meta and pages show no Markdown: emphasis and headings come out, bullets → "• "
//   every      three or more blank lines → one, no trailing spaces, buttons never a bare link ("Visit website", the link kept)

const SKIP = /^(?:image|images|video|poster|url|link|links|href|utm|knobs|grade|cardImages|wordsIn|wordsInAll|photoSet|film|aplus|landing|format|size|channel|trigger|audience|schedule|platform)$/i;
const URLISH = /^\s*(?:https?:\/\/|www\.)\S+\s*$/i;
const tidySpace = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
const noHeads = (s) => s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
const bullets = (s) => s.replace(/^(\s*)[-*•]\s+/gm, '$1• ');
const plainEm = (s) => s.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1').replace(/(^|[\s(])\*(\S[^*\n]*?\S|\S)\*(?=[\s.,!?;:)]|$)/g, '$1$2').replace(/(^|[\s(])_(\S[^_\n]*?\S|\S)_(?=[\s.,!?;:)]|$)/g, '$1$2').replace(/(^|[\s(])~(\S[^~\n]*?\S)~(?=[\s.,!?;:)]|$)/g, '$1$2');
const waEm = (s) => s.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/__([^_\n]+)__/g, '_$1_');
/* where a piece runs, from its family and layout: whatsapp, sms, email, or text (posts, ads, pages, everything else) */
export const channelOf = (ch = {}) => { const p = ch.pkg || {}, L = ch.layout || '';
  if (L === 'msg' || ch.family === 'crm' && /whatsapp|sms|chat/i.test(`${p.channel || ''} ${ch.action || ''}`)) return /sms|text message/i.test(String(p.channel || '')) ? 'sms' : 'whatsapp';
  if (L === 'mail' || ch.family === 'outreach' || ch.family === 'crm') return 'email';
  return 'text'; };
const label = (b, n) => { const s = String(b || '').replace(/\s+/g, ' ').trim(); if (URLISH.test(s)) return { s: 'Visit website', url: s.trim() };
  return { s: s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '').replace(/[\s,;:–-]+$/, '') : s }; };

export function formatFix(ch = {}) {
  const pkg = ch.pkg; if (!pkg || typeof pkg !== 'object') return { pkg, fixes: [] };
  const chan = channelOf(ch), fixes = new Set(), out = { ...pkg };
  const fmt = (s) => { let x = tidySpace(String(s)); const y0 = x;
    x = noHeads(x); if (x !== y0) fixes.add('headings taken out');
    const y1 = x; x = chan === 'whatsapp' ? waEm(x) : plainEm(x); if (x !== y1) fixes.add(chan === 'whatsapp' ? 'bold set the WhatsApp way' : 'Markdown taken out');
    const y2 = x; x = bullets(x); if (x !== y2) fixes.add('lists as • bullets');
    return x; };
  for (const [k, v] of Object.entries(pkg)) {
    if (SKIP.test(k) || v == null) continue;
    if (k === 'buttons' && Array.isArray(v)) { const n = chan === 'whatsapp' ? 25 : 40, seen = new Set(), bs = [];
      for (const b of v) { const l = label(plainEm(String(b || '')), n); if (l.url) { fixes.add('a link button labelled'); out.link ||= l.url; } if (!l.s || seen.has(l.s.toLowerCase())) continue; seen.add(l.s.toLowerCase()); bs.push(l.s); }
      out.buttons = chan === 'whatsapp' ? bs.slice(0, 3) : bs; if (bs.length !== v.length || bs.some((b, i) => b !== v[i])) fixes.add('buttons tidied'); continue; }
    if ((k === 'button' || k === 'cta') && typeof v === 'string') { const l = label(plainEm(v), chan === 'whatsapp' ? 25 : 40); if (l.url) { fixes.add('a link button labelled'); out.link ||= l.url; } out[k] = l.s; continue; }
    if (typeof v === 'string') { const s = fmt(v); if (s !== v) out[k] = s; continue; }
    if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' ? fmt(x) : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).map(([c, y]) => [c, typeof y === 'string' && !SKIP.test(c) && c !== 'visual' && c !== 'shot' ? fmt(y) : y])) : x));
  }
  return { pkg: out, fixes: [...fixes] };
}

/* the stage's WhatsApp bubble: the message as WhatsApp draws it (escaped text in, *bold* _italic_ ~strike~ out). Browser and server */
export const waHtml = (escaped) => String(escaped || '').replace(/(^|[\s(])\*(\S[^*\n]*?\S|\S)\*(?=[\s.,!?;:)]|$)/g, '$1<b>$2</b>').replace(/(^|[\s(])_(\S[^_\n]*?\S|\S)_(?=[\s.,!?;:)]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])~(\S[^~\n]*?\S)~(?=[\s.,!?;:)]|$)/g, '$1<s>$2</s>');
