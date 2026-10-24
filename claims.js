/* Claims Brew can't back. A draft (an ad, a script, an email, a page) may only promise what the brand itself says: its
   site, its fact sheet, its catalog, its reviews. The writer sometimes invents a discount code ("Use code PURE25"), a
   guarantee, a timed result ("takes exactly 7 days to build a dewy glow") or an absolute ("clinically proven"). Any of
   those can mislead a shopper or break ad rules, so each one is flagged before a person ships it, for every brand and
   category. A claim is backed when the brand's own words already carry it (`source`: the facts, catalog and evidence
   text the caller passes). Used by the studio checks (remix.js evaluate), the drafts made with nobody watching (drafts-bg.js,
   drafts.js: cleanDraftClaims), the finals gate and the writers' prompts (CLAIMS_RULE). */

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
/* a brand's own words are long (every product): normalised once per text, not once per sentence checked (a feed of 120 cards and
   a pack of 60 moves checked against the same words took 12–50 s to load when each check lower-cased them again) */
const NORMED = new Map();
const srcNorm = (source) => { if (typeof source !== 'string') return sourceText(source); const hit = NORMED.get(source); if (hit !== undefined) return hit;
  const n = norm(source); if (NORMED.size >= 12) NORMED.delete(NORMED.keys().next().value); NORMED.set(source, n); NORMED.set(n, n); return n; };
/* the sentence a phrase sits in, for the flag's quote */
const around = (text, i, len) => { const s = String(text); const a = Math.max(0, s.lastIndexOf('.', i) + 1, s.lastIndexOf('\n', i) + 1), b0 = s.slice(i + len).search(/[.!?\n]/), b = b0 < 0 ? s.length : i + len + b0 + 1; return s.slice(a, b).trim().slice(0, 140); };

/* product codes that look like coupon codes but are not (SPF50, PA4, B12, Q10, ISO22716, UV400, 4K, H2O…) */
const NOT_CODE = /^(?:SPF\d+|PA\d*|UV[AB]?\d*|B\d{1,2}|Q10|ISO\d+|H2O|CO2|OMEGA\d|D3|K2|C\d{1,2}|E\d{1,3}|AHA\d*|BHA\d*|HA\d*|MSRP|USB\d?|4K|5G|4G|HD\d*|MP\d|COVID\d+|AQI\d*)$/;
const CODE_CTX = /\b(?:(?:promo|coupon|discount|offer|voucher|redeem)\s*code|(?:use|apply|enter)\s+(?:the\s+)?code|code)\s*[:\-–]?\s*["“'‘]?([A-Z][A-Z0-9]{2,14})\b/gi;
const GUARANTEE = /\b(?:guarantee[sd]?|money[- ]back|risk[- ]free|no[- ]questions[- ]asked refund|full refund if)\b/gi;
/* a timed result: "in 7 days", "within 2 weeks", "takes exactly 7 days to", "visible results in 14 days", "overnight results" */
const TIMED = /\b(?:(?:takes?|needs?|in|within|after|just|only|exactly)\s+(?:just\s+|only\s+|exactly\s+)?\d+\s*(?:hours?|days?|nights?|weeks?|months?|washes|uses|applications)\b|overnight results?|instant(?:ly)? (?:results?|glow|fix|relief))/gi;
const RESULT = /\b(?:result|warm|relie|pain|sore|ache|firm|lift|tone|younger|glow|grow|growth|regrow|thick|strong|stop|reduc|clear|fade|lighten|bright|repair|heal|less|fewer|more|visible|see|notice|transform|soft|smooth|moistur|hydrat|fall|loss|acne|spot|wrinkle|weight|slim|sleep|energy|relief|shine|frizz|damage|dandruff|tan|pigment)/i;
/* every way a writer shortens the same health claim counts (Arata 23 Oct: "Dermat-approved" passed): dermat, derma, derm,
   dermatologically; doctor- or trichologist-approved; clinically shown or studied; lab-tested */
const ABSOLUTE = /\b(?:clinically (?:proven|tested|backed|shown|studied|validated)|derm(?:at(?:ologist(?:ally)?|ologically)?|a)?[- ]?(?:approved|recommended|tested|certified)|(?:doctor|trichologist|dentist|paediatrician|pediatrician|vet)[- ](?:approved|recommended|tested|formulated)|scientifically (?:proven|backed)|lab[- ]tested|proven to|permanent(?:ly)?|forever|never again|100% (?:safe|natural|effective|organic|results?|chemical[- ]free)|no side[- ]effects|works for everyone|cures?|cured|treats?|heals?|reverses?)\b/gi;
/* a measured result: "95% hair growth", "up to 60% less hair fall", "3x thicker", "reduces acne by 40%". Being on the store's
   page is not enough: the store must say it was measured (a study, a trial, a test, users surveyed) in the same place, or the team
   approved it in the Brand Book's claims we may make */
const EFFICACY = /\b(?:up to |by |over |nearly |almost )?\d+(?:\.\d+)?\s?(?:%|x|×|times)\s(?:\w+\s){0,3}?(?:more|less|fewer|growth|regrowth|reduction|thicker|stronger|softer|brighter|faster|denser|improvement|better|hair|results?|visible|reduc\w*|increase\w*|boost\w*)\b|\b(?:reduces?|increases?|boosts?|improves?|cuts?|lifts?)\s(?:\w+\s){0,4}?by\s\d+(?:\.\d+)?\s?%/gi;
const MEASURED = /\b(?:clinical|study|studies|trial|tested on|test(?:ed)? with|participants|subjects|volunteers|users? (?:saw|reported|said|surveyed)|survey(?:ed)?|in-vivo|in vivo|in-vitro|lab results?|certified by|dermatological(?:ly)? test)/i;
/* the store says this number was measured: the same number within a sentence or two of a study word in its own words */
const measuredIn = (src, phrase) => { const n = (phrase.match(/\d+(?:\.\d+)?\s?(?:%|x|×|times)/) || [])[0]; if (!n) return false; const k = n.replace(/\s/g, '').toLowerCase();
  let i = -1; const flat = src.replace(/\s(?=%|x\b|×)/g, ''); while ((i = flat.indexOf(k, i + 1)) >= 0) { if (MEASURED.test(flat.slice(Math.max(0, i - 220), i + 220))) return true; } return false; };

/* the Brand Book's "claims we may make" (the team approved them, or the read found them on the brand's own pages): each one is
   backed as written, measured results included, marked so claimFlags knows the team signed it off */
const APPROVED = /\[approved claims\]/;
export const approvedText = (claims = []) => { const xs = (claims || []).map((c) => (typeof c === 'string' ? c : c?.text)).filter(Boolean); return xs.length ? `[approved claims] ${xs.join(' \n ')}` : ''; };
/* the brand's own words, for "is this claim theirs?": every string in the facts, the catalog rows, evidence, about */
export const sourceText = (...parts) => { const out = []; const walk = (o, d = 0) => { if (d > 6 || o == null) return; if (typeof o === 'string' || typeof o === 'number') out.push(String(o)); else if (Array.isArray(o)) o.slice(0, 2000).forEach((x) => walk(x, d + 1)); else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!/^(img|image|images|src|url|logo|id|handle)$/i.test(k)) walk(v, d + 1); }; parts.forEach((p) => walk(p)); const n = norm(out.join(' \n ')); if (n.length > 2000) { if (NORMED.size >= 12) NORMED.delete(NORMED.keys().next().value); NORMED.set(n, n); } return n; };

/* a brand pack's own words (brand-pack.js: facts, catalog, the review quotes, about), plus the card's real evidence */
const PACK_SRC = new WeakMap();
export const packSource = (p, card = null) => { let base = p && typeof p === 'object' ? PACK_SRC.get(p) : '';
  if (base == null || base === undefined) { base = sourceText(Object.values(p?.facts || {}).map((f) => [f?.label, f?.v, ...(f?.aliases || [])]), p?.catalog, p?.reviewQuotes, p?.seed?.brand?.about || '', p?.seed?.brand?.tagline || '', p?.factBrief || '', approvedText(p?.book?.claims)); if (p && typeof p === 'object') PACK_SRC.set(p, base); }
  if (!card || typeof card !== 'object') return base || ''; const ev = sourceText(card.post?.evidence || [], card.evidence || []); if (!ev.trim()) return base || '';
  const k = CARD_SRC.get(card); if (k?.base === base && k.ev === ev) return k.s; const out = `${base || ''}\n${ev}`; CARD_SRC.set(card, { base, ev, s: out }); NORMED.set(out, out); if (NORMED.size > 12) NORMED.delete(NORMED.keys().next().value); return out; }; /* the same string per card, so it is normalised once */
const CARD_SRC = new WeakMap();

/* → [{ kind, phrase, quote, why }] for every claim in `text` that `source` (sourceText) doesn't carry */
export function claimFlags(text, source = '', { allowNewCode = false } = {}) {
  const s = String(text || ''); if (!s.trim()) return [];
  const src = srcNorm(source), flags = [], seen = new Set();
  const add = (kind, phrase, i, why) => { const k = `${kind}:${phrase.toLowerCase()}`; if (seen.has(k)) return; seen.add(k); flags.push({ kind, phrase, quote: around(s, i, phrase.length), why }); };
  for (const m of s.matchAll(CODE_CTX)) { const code = m[1]; if (code !== code.toUpperCase() || (!/\d/.test(code) && code.length < 5)) continue; if (NOT_CODE.test(code) || allowNewCode) continue;
    if (!src.includes(code.toLowerCase())) add('code', code, m.index, `the code ${code} isn’t on your store`); }
  for (const m of s.matchAll(GUARANTEE)) if (!src.includes(m[0].toLowerCase())) add('guarantee', m[0], m.index, `“${m[0]}” isn’t something your store offers`);
  for (const m of s.matchAll(TIMED)) { const q = around(s, m.index, m[0].length); if (!RESULT.test(q)) continue; const n = (m[0].match(/\d+\s*\w+/) || [m[0]])[0].toLowerCase();
    if (!src.includes(n) && !src.includes(m[0].toLowerCase())) add('timed', m[0].trim(), m.index, `a result promised “${m[0].trim()}” that your store doesn’t claim`); }
  for (const m of s.matchAll(ABSOLUTE)) { const ph = m[0].toLowerCase(); if (src.includes(ph) || (/^(?:treats?|heals?|cures?|cured|reverses?)$/.test(ph) && !RESULT.test(around(s, m.index, m[0].length)))) continue; /* "treats" a pet store sells is not a health claim */ add('absolute', m[0], m.index, `“${m[0]}” isn’t backed by your store`); }
  for (const m of s.matchAll(EFFICACY)) { const q = around(s, m.index, m[0].length); if (!RESULT.test(q) && !/hair|skin|acne|weight|sleep|pain/i.test(q)) continue;
    if (measuredIn(src, m[0])) continue; /* the same number where the store says it was measured */ if (APPROVED.test(src) && src.includes(norm(m[0]).trim())) continue;
    add('efficacy', m[0].trim(), m.index, `“${m[0].trim()}” is a measured result; your store doesn’t say where it was measured`); }
  return flags;
}

/* one line for a studio check or a card QA row */
export const claimCheck = (flags) => flags.length ? `Claims to check before shipping: ${flags.slice(0, 3).map((f) => f.why).join('; ')}${flags.length > 3 ? ` (+${flags.length - 3} more)` : ''}` : 'No invented codes, guarantees, health claims or timed results';

/* the rule every writer prompt carries */
export const CLAIMS_RULE = 'Never invent a discount code, coupon, guarantee, refund promise, or a result tied to a time ("in 7 days", "overnight"), and never write "clinically proven", "dermatologist approved" (or "dermat-approved", "derma tested"), "doctor recommended", "cures", "treats", "heals", "permanent" or "100%" unless those exact words are in the facts or the product page given here. A measured result ("95% saw growth", "60% less hair fall", "3x thicker") only when the facts say where it was measured (a study, a trial, a test) or it is in the Brand Book’s claims we may make. Offers and codes come only from the facts.';

/* a card that can't be rewritten by a person (the feed's own cards): drop just the sentences that carry an unbacked code or
   guarantee, keep the rest; titles keep their words (a flagged title fails QA and is rewritten instead). kinds: which flags
   drop a sentence (a draft made with nobody watching drops every kind) */
export function scrubClaims(text, source = '', { kinds = ['code', 'guarantee'] } = {}) {
  const s = String(text || ''); source = srcNorm(source); const fl = claimFlags(s, source).filter((f) => kinds.includes(f.kind)); if (!fl.length) return s;
  return s.split(/(?<=[.!?])\s+|\n/).filter((sent) => !fl.some((f) => sent.includes(f.phrase))).join(s.includes('\n') ? '\n' : ' ').trim() || s;
}

/* a move is the team's plan, so a claim the store never made stays readable but is marked as the team's call, the way the
   moves contract writes it (moves-engine.js): "Proposed (team decides): Use code COZY15 …". Saved moves written before the
   rule heal on read (brand-pack fitMoves, the team's private moves) */
const PROPOSED = 'Proposed (team decides): ';
export function markClaims(text, source = '') {
  const s = String(text ?? ''); if (!s.trim()) return text; const src = srcNorm(source);
  const fl = claimFlags(s, src); if (!fl.length) return text;
  return s.split(/(?<=[.!?])(\s+)|(\n)/).map((x) => (x && !/^\s*$/.test(x) && fl.some((f) => x.includes(f.phrase)) && !/proposed \(team decides\)/i.test(x) ? `${x.match(/^\s*/)[0]}${PROPOSED}${x.trimStart()}` : x ?? '')).join('');
}
/* a banned word the brand would say: never inside quotes (a shopper's question, a rival's ad), never denied ("not a miracle",
   "no overnight cure"), never in an "avoid" list, never a word the brand's own words carry (a pet store's "treats"), and never
   "+100%" maths. → the words found (QA J-04, moves audit 20 Oct) */
export function bannedHits(text, re, source = '') {
  if (!re || !(re instanceof RegExp) || re.source === '(?!)') return []; const x = String(text || '').replace(/“[^”]*(”|$)/g, ' ').replace(/"[^"\n]*"/g, ' ');
  if (!re.test(x)) return []; let g; try { g = new RegExp(re.source, [...new Set(`${re.flags}gi`)].join('')); } catch { return []; }
  const src = srcNorm(source), out = new Set();
  for (const m of x.matchAll(g)) { const w = m[0].trim(); if (!w) continue; const before = x.slice(Math.max(0, m.index - 40), m.index).toLowerCase(), last = before.split(/\s+/).filter(Boolean).slice(-4).join(' ');
    if (/\b(?:not|no|never|isn['’]t|aren['’]t|without|nor|zero|neither|avoid(?:ing)?|banned|don['’]t (?:say|use|write)|instead of)\b/.test(last) || /[+±]\s*$/.test(before) || /\bavoid\b|\bnever (?:say|use)\b|\bbanned\b/i.test(x.slice(Math.max(0, m.index - 120), m.index))) continue;
    if (/%$/.test(w) && /^\s*(?:more|increase|lift|growth|uplift|of|in)\b/i.test(x.slice(m.index + m[0].length))) continue;
    if (src && src.includes(w.toLowerCase())) continue; out.add(w.toLowerCase()); }
  return [...out].slice(0, 5); }

/* a move's claims: sentences, list items, table cells, captions, its gives and live lines are marked as the team's call; a
   claim in the title, the cover stat or its label can't be prefixed, so it (and any banned word) goes to "To confirm"
   (moves audit 20 Oct: "Guaranteed stash offers…" as a title, "Use code MIYA15" in a draft ad row) */
const markCell = (x, source) => (typeof x === 'string' ? markClaims(x, source) : x);
export const markMoveClaims = (m, source = '', { banned = null } = {}) => {
  if (!m || typeof m !== 'object' || !Array.isArray(m.sections)) return m;
  const out = { ...m, sections: m.sections.map((sec) => ({ ...sec, blocks: (sec.blocks || []).map((b) => (!b || typeof b !== 'object' ? b : {
    ...b, ...(typeof b.body === 'string' ? { body: markClaims(b.body, source) } : {}), ...(typeof b.text === 'string' && b.t !== 'diagram' ? { text: markClaims(b.text, source) } : {}),
    ...(Array.isArray(b.items) ? { items: b.items.map((x) => markCell(x, source)) } : {}), ...(typeof b.caption === 'string' ? { caption: markClaims(b.caption, source) } : {}),
    ...(Array.isArray(b.rows) ? { rows: b.rows.map((r) => (Array.isArray(r) ? r.map((x) => markCell(x, source)) : r)) } : {}) })) })) };
  for (const k of ['gives', 'live']) if (typeof m[k] === 'string') out[k] = markClaims(m[k], source);
  const tc = [...(Array.isArray(m.toConfirm) ? m.toConfirm : [])], has = (x) => tc.some((y) => String(y).toLowerCase() === x.toLowerCase());
  for (const [k, name] of [['title', 'title'], ['stat', 'cover number'], ['statLabel', 'cover line']]) for (const f of claimFlags(m[k], source)) { const line = `The ${name} says “${f.phrase}”: ${f.why}, so the team decides before it is used`; if (!has(line)) tc.push(line); }
  if (banned) { const words = new Set(); const walk = (o, d = 0) => { if (d > 6 || o == null) return; if (typeof o === 'string') bannedHits(o, banned, source).forEach((w) => words.add(w)); else if (Array.isArray(o)) o.forEach((x) => walk(x, d + 1)); else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!/^(?:url|src|id|kind|t|n|meta|sources|factsUsed|toConfirm|derived|newFacts)$/.test(k)) walk(v, d + 1); };
    walk({ title: m.title, stat: m.stat, statLabel: m.statLabel, gives: m.gives, live: m.live, sections: m.sections });
    for (const w of [...words].slice(0, 5)) { const line = `“${w}” is a word ads in this category can’t use: say what it does instead before any of this ships`; if (!has(line)) tc.push(line); } }
  if (tc.length !== (m.toConfirm || []).length) out.toConfirm = tc;
  return out; };

/* a draft the AI wrote with nobody watching (a feed card's first draft, a jam draft: QA-25, "drafts made outside the studio
   are never checked"): every sentence with a code, guarantee, timed result or absolute the brand's own words don't carry is
   dropped from what a shopper reads (copy, script, slides), and a flagged headline is never set on the picture.
   Mutates `j` (the draft plan) and returns the flags it removed */
export function cleanDraftClaims(j, source = '') {
  if (!j || typeof j !== 'object') return [];
  const src = srcNorm(source), hit = [];
  /* every flagged sentence goes, even when that leaves nothing (scrubClaims keeps the text rather than return nothing) */
  const strip = (x, f) => x.split(/(?<=[.!?])\s+|\n/).filter((sent) => !f.some((g) => sent.includes(g.phrase))).join(x.includes('\n') ? '\n' : ' ').trim();
  const fix = (x) => { if (typeof x !== 'string' || !x.trim()) return x; const f = claimFlags(x, src); if (!f.length) return x; hit.push(...f); return strip(x, f); };
  for (const k of ['copy', 'body', 'script']) if (typeof j[k] === 'string') j[k] = fix(j[k]);
  if (typeof j.headline === 'string' && claimFlags(j.headline, src).length) { hit.push(...claimFlags(j.headline, src)); delete j.headline; }
  if (Array.isArray(j.slides)) j.slides.forEach((x) => { if (!x || typeof x !== 'object') return; for (const k of ['onSlide', 'small', 'text']) if (typeof x[k] === 'string') x[k] = fix(x[k]); });
  return hit;
}

/* Copy that reads wrong (QA 19 Oct: "Is heavy hair fall NOT giving?", "up to 7 days a week", a product word written twice,
   line breaks written as the two characters \n). Cheap checks on what a shopper reads; each flag is fixable in the studio.
   The brand's own words are never flagged: `names` are the brand's name and its product titles as the store writes them
   ("ARATA", "USB", "Heated Hand Pillow, Heated Mouse Pad", "Onion Hair Oil with Onion Oil") and `source` its other words
   (a banner in capitals, "FREE SHIPPING ON ALL ORDERS ABOVE ₹299"). A common word is never "theirs" just because the store
   uses it somewhere: "NOT" shouted is still flagged. */
const ACRO = /^(?:SPF|PA|UV|UVA|UVB|AHA|BHA|USA|UK|EU|UAE|COD|FAQ|DIY|OTP|SMS|GST|MRP|SKU|ML|KG|CEO|AI|HD|NEW|FREE|SALE|OFF|BOGO|DM|IG|FB|USP|PDP|ASAP|OK|ISO|GMP|FDA|BPA|PETA|RSVP|VIP|USB|LED|XL|XXL|PM|AM|TV|PC|DIY|INR|USD|GBP|EUR|AUD|CAD|SGD|AED|JPY|CHF|NZD|CZK|PLN|SEK|DKK|NOK|HUF|RON|BGN)$/;
const REPEAT_OK = /^(that|this|with|your|more|very|from|have|what|when|each|week|step|days?|again|over|after|by|and)$/;
const WORDS = new Map(), wordsOf = (x) => { const h = WORDS.get(x); if (h !== undefined) return h; const w = words(x); if (WORDS.size >= 8) WORDS.delete(WORDS.keys().next().value); WORDS.set(x, w); return w; };
const words = (x) => norm(x).replace(/[^a-z0-9₹%&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function copyFlags(text, opts = {}) {
  const o = typeof opts === 'string' ? { source: opts } : opts || {};
  /* a quoted span is someone else's words (a shopper's question, a thread title): never flagged as ours (QA J-05) */
  const s = String(text || '').replace(/“[^”]{0,240}”|"[^"\n]{0,240}"/g, ' '), out = [], src = wordsOf(srcNorm(o.source || ''));
  const rawSrc = String(o.source || ''), theirs = (w) => /^[A-Z0-9]+$/.test(w) && new RegExp(`(^|[^A-Za-z])${w}([^A-Za-z]|$)`).test(rawSrc); /* an acronym the store itself writes in capitals ("DHT"), never a common word it writes in lower case ("not") */
  const names = (o.names || []).filter((x) => typeof x === 'string' && x.trim()).map(words), nameWords = new Set(names.flatMap((n) => n.split(' ')));
  const shortName = new Set(names.filter((n) => n.split(' ').length <= 2).flatMap((n) => n.split(' ')));
  const nameStarts = new Set(names.map((n) => n.split(' ').slice(0, 2).join(' ')).filter((x) => x.includes(' ')));
  const inName = (phrase) => { const p = words(phrase); return p.length > 3 && names.some((n) => n.includes(p)); };
  const banner = (run) => { const p = words(run); return p.split(' ').length >= 2 && !!src && src.includes(p); }; /* a run of two words or more the store writes */
  if (/\\n|\\t/.test(s)) out.push('line breaks show as “\\n” in the text');
  const runs = s.match(/\b[A-Z][A-Z0-9₹%&' -]*[A-Z0-9]\b/g) || [];
  const caps = runs.filter((r) => !banner(r) && !inName(r)).flatMap((r) => r.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !ACRO.test(w) && !(w.length <= 5 && theirs(w)) && !nameWords.has(w.toLowerCase()) && /[a-z]/.test(s.replace(/\b[A-Z]{3,}\b/g, '')));
  if (caps.length) out.push(`shouting caps (“${caps[0]}”)`);
  if (/\bnot giving\s*[?!.]|\b(?:is|are)\s+(?:not\s+)?giving\s*[?!.]/i.test(s)) out.push('slang that doesn’t read right (“… giving?”)');
  if (/\bup to \d+ days a week\b|\b(?:[8-9]|\d{2,}) days a week\b/i.test(s)) out.push('a time phrase that doesn’t make sense (“days a week”)');
  /* a word written twice in a row ("Oil Oil"), or a capitalised name word twice within a few words ("Onion Oil Onion Hair Oil"),
     unless that stretch is a real product name, or each one starts a product's name (a list of the store's products). Plain
     repeats for rhythm ("stronger hair, healthier hair") read fine */
  const dbl = s.match(/\b([A-Za-z]{2,})\s+\1\b/i); if (dbl && !inName(dbl[0])) out.push(`a repeated word (“${dbl[1].toLowerCase()}”) in one phrase`);
  const startsName = (line, at) => nameStarts.has(words(line.slice(at)).split(' ').slice(0, 2).join(' '));
  for (const line of s.split(/\n|(?<=[.!?])\s+/)) { const ws = [...line.matchAll(/[A-Z][a-z]{3,}/g)];
    const lw = line.match(/\b[A-Za-z]{3,}\b/g) || []; if (lw.length >= 4 && ws.length / lw.length >= 0.6) continue; /* a Title Case headline repeats its words by style */
    outer: for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < Math.min(ws.length, i + 4); j++) { const w = ws[i][0].toLowerCase(); if (w !== ws[j][0].toLowerCase() || REPEAT_OK.test(w) || shortName.has(w) || names.some((n) => n.includes(w) && ` ${words(line)} `.includes(` ${n} `))) continue; /* the brand's name said twice, or a product named in full beside the same word, reads fine */
      if (inName(line.slice(ws[i].index, ws[j].index + ws[j][0].length)) || (startsName(line, ws[i].index) && startsName(line, ws[j].index))) continue;
      out.push(`a repeated word (“${w}”) in one phrase`); break outer; } }
  return [...new Set(out)];
}
export const COPY_RULE = 'Write natural, idiomatic English a good copywriter would sign off: no forced slang, no shouting caps, never the same product word twice in one name, line breaks as real line breaks.';

/* One entry point for every surface that writes words a shopper, the team or a partner may copy (static ads, plain-words card
   rewrites, team briefs, the weekly digest, Slack replies, Ask Brew and jam answers, ideas, feed cards, the download pack's
   message templates): → { flags, text } where text drops each sentence that carries a claim the brand's own words, its measured
   results or its Brand Book's approved claims don't back. A text with nothing flagged comes back as it was. Never throws. */
export function checkCopy(text, source = '', { allowNewCode = false } = {}) {
  try { const s = String(text ?? ''); if (!s.trim()) return { flags: [], text: text ?? '' };
    const f = claimFlags(s, source, { allowNewCode }); if (!f.length) return { flags: [], text: s };
    const kept = s.split(/(?<=[.!?])\s+|\n/).filter((sent) => !f.some((g) => sent.includes(g.phrase))).join(s.includes('\n') ? '\n' : ' ').trim();
    return { flags: f, text: kept }; } catch { return { flags: [], text: text ?? '' }; }
}
/* every string field of an object (a brief, a template, a card) checked in place; → the flags removed */
export function checkCopyIn(o, source = '', { skip = /^(id|url|src|img|image|images|key|handle|at|by|from|kind|state|status)$/i, depth = 0 } = {}) {
  const hit = []; if (!o || typeof o !== 'object' || depth > 5) return hit;
  for (const [k, v] of Object.entries(o)) { if (skip.test(k)) continue;
    if (typeof v === 'string') { const r = checkCopy(v, source); if (r.flags.length) { hit.push(...r.flags); o[k] = r.text; } }
    else if (v && typeof v === 'object') hit.push(...checkCopyIn(v, source, { skip, depth: depth + 1 })); }
  return hit;
}
