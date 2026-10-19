/* Claims Brew can't back. A draft (an ad, a script, an email, a page) may only promise what the brand itself says: its
   site, its fact sheet, its catalog, its reviews. The writer sometimes invents a discount code ("Use code PURE25"), a
   guarantee, a timed result ("takes exactly 7 days to build a dewy glow") or an absolute ("clinically proven"). Any of
   those can mislead a shopper or break ad rules, so each one is flagged before a person ships it, for every brand and
   category. A claim is backed when the brand's own words already carry it (`source`: the facts, catalog and evidence
   text the caller passes). Used by the studio checks (remix.js evaluate), the drafts made with nobody watching (drafts-bg.js,
   drafts.js: cleanDraftClaims), the finals gate and the writers' prompts (CLAIMS_RULE). */

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
/* the sentence a phrase sits in, for the flag's quote */
const around = (text, i, len) => { const s = String(text); const a = Math.max(0, s.lastIndexOf('.', i) + 1, s.lastIndexOf('\n', i) + 1), b0 = s.slice(i + len).search(/[.!?\n]/), b = b0 < 0 ? s.length : i + len + b0 + 1; return s.slice(a, b).trim().slice(0, 140); };

/* product codes that look like coupon codes but are not (SPF50, PA4, B12, Q10, ISO22716, UV400, 4K, H2O…) */
const NOT_CODE = /^(?:SPF\d+|PA\d*|UV[AB]?\d*|B\d{1,2}|Q10|ISO\d+|H2O|CO2|OMEGA\d|D3|K2|C\d{1,2}|E\d{1,3}|AHA\d*|BHA\d*|HA\d*|MSRP|USB\d?|4K|5G|4G|HD\d*|MP\d|COVID\d+|AQI\d*)$/;
const CODE_CTX = /\b(?:(?:promo|coupon|discount|offer|voucher|redeem)\s*code|(?:use|apply|enter)\s+(?:the\s+)?code|code)\s*[:\-–]?\s*["“'‘]?([A-Z][A-Z0-9]{2,14})\b/gi;
const GUARANTEE = /\b(?:guarantee[sd]?|money[- ]back|risk[- ]free|no[- ]questions[- ]asked refund|full refund if)\b/gi;
/* a timed result: "in 7 days", "within 2 weeks", "takes exactly 7 days to", "visible results in 14 days", "overnight results" */
const TIMED = /\b(?:(?:takes?|needs?|in|within|after|just|only|exactly)\s+(?:just\s+|only\s+|exactly\s+)?\d+\s*(?:hours?|days?|nights?|weeks?|months?|washes|uses|applications)\b|overnight results?|instant(?:ly)? (?:results?|glow|fix|relief))/gi;
const RESULT = /\b(?:result|warm|relie|pain|sore|ache|firm|lift|tone|younger|glow|grow|growth|regrow|thick|strong|stop|reduc|clear|fade|lighten|bright|repair|heal|less|fewer|more|visible|see|notice|transform|soft|smooth|moistur|hydrat|fall|loss|acne|spot|wrinkle|weight|slim|sleep|energy|relief|shine|frizz|damage|dandruff|tan|pigment)/i;
const ABSOLUTE = /\b(?:clinically (?:proven|tested|backed)|dermatologist[- ](?:approved|recommended|tested)|doctor[- ]recommended|scientifically proven|permanent(?:ly)?|forever|never again|100% (?:safe|natural|effective|organic|results?)|no side[- ]effects|works for everyone|cures?)\b/gi;

/* the brand's own words, for "is this claim theirs?": every string in the facts, the catalog rows, evidence, about */
export const sourceText = (...parts) => { const out = []; const walk = (o, d = 0) => { if (d > 6 || o == null) return; if (typeof o === 'string' || typeof o === 'number') out.push(String(o)); else if (Array.isArray(o)) o.slice(0, 2000).forEach((x) => walk(x, d + 1)); else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!/^(img|image|images|src|url|logo|id|handle)$/i.test(k)) walk(v, d + 1); }; parts.forEach((p) => walk(p)); return norm(out.join(' \n ')); };

/* → [{ kind, phrase, quote, why }] for every claim in `text` that `source` (sourceText) doesn't carry */
export function claimFlags(text, source = '', { allowNewCode = false } = {}) {
  const s = String(text || ''); if (!s.trim()) return [];
  const src = typeof source === 'string' ? norm(source) : sourceText(source), flags = [], seen = new Set();
  const add = (kind, phrase, i, why) => { const k = `${kind}:${phrase.toLowerCase()}`; if (seen.has(k)) return; seen.add(k); flags.push({ kind, phrase, quote: around(s, i, phrase.length), why }); };
  for (const m of s.matchAll(CODE_CTX)) { const code = m[1]; if (code !== code.toUpperCase() || (!/\d/.test(code) && code.length < 5)) continue; if (NOT_CODE.test(code) || allowNewCode) continue;
    if (!src.includes(code.toLowerCase())) add('code', code, m.index, `the code ${code} isn’t on your store`); }
  for (const m of s.matchAll(GUARANTEE)) if (!src.includes(m[0].toLowerCase())) add('guarantee', m[0], m.index, `“${m[0]}” isn’t something your store offers`);
  for (const m of s.matchAll(TIMED)) { const q = around(s, m.index, m[0].length); if (!RESULT.test(q)) continue; const n = (m[0].match(/\d+\s*\w+/) || [m[0]])[0].toLowerCase();
    if (!src.includes(n) && !src.includes(m[0].toLowerCase())) add('timed', m[0].trim(), m.index, `a result promised “${m[0].trim()}” that your store doesn’t claim`); }
  for (const m of s.matchAll(ABSOLUTE)) if (!src.includes(m[0].toLowerCase())) add('absolute', m[0], m.index, `“${m[0]}” isn’t backed by your store`);
  return flags;
}

/* one line for a studio check or a card QA row */
export const claimCheck = (flags) => flags.length ? `Claims to check before shipping: ${flags.slice(0, 3).map((f) => f.why).join('; ')}${flags.length > 3 ? ` (+${flags.length - 3} more)` : ''}` : 'No invented codes, guarantees or timed results';

/* the rule every writer prompt carries */
export const CLAIMS_RULE = 'Never invent a discount code, coupon, guarantee, refund promise, or a result tied to a time ("in 7 days", "overnight"), and never write "clinically proven", "dermatologist approved", "permanent" or "100%" unless those exact words are in the facts or the product page given here. Offers and codes come only from the facts.';

/* a card that can't be rewritten by a person (the feed's own cards): drop just the sentences that carry an unbacked code or
   guarantee, keep the rest; titles keep their words (a flagged title fails QA and is rewritten instead). kinds: which flags
   drop a sentence (a draft made with nobody watching drops every kind) */
export function scrubClaims(text, source = '', { kinds = ['code', 'guarantee'] } = {}) {
  const s = String(text || ''); source = typeof source === 'string' ? norm(source) : sourceText(source); const fl = claimFlags(s, source).filter((f) => kinds.includes(f.kind)); if (!fl.length) return s;
  return s.split(/(?<=[.!?])\s+|\n/).filter((sent) => !fl.some((f) => sent.includes(f.phrase))).join(s.includes('\n') ? '\n' : ' ').trim() || s;
}

/* a draft the AI wrote with nobody watching (a feed card's first draft, a jam draft: QA-25, "drafts made outside the studio
   are never checked"): every sentence with a code, guarantee, timed result or absolute the brand's own words don't carry is
   dropped from what a shopper reads (copy, script, slides), and a flagged headline is never set on the picture.
   Mutates `j` (the draft plan) and returns the flags it removed */
export function cleanDraftClaims(j, source = '') {
  if (!j || typeof j !== 'object') return [];
  const src = typeof source === 'string' ? norm(source) : sourceText(source), hit = [];
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
const ACRO = /^(?:SPF|PA|UV|UVA|UVB|AHA|BHA|USA|UK|EU|UAE|COD|FAQ|DIY|OTP|SMS|GST|MRP|SKU|ML|KG|CEO|AI|HD|NEW|FREE|SALE|OFF|BOGO|DM|IG|FB|USP|PDP|ASAP|OK|ISO|GMP|FDA|BPA|PETA|RSVP|VIP|USB|LED|XL|XXL|PM|AM|TV|PC|DIY)$/;
const REPEAT_OK = /^(that|this|with|your|more|very|from|have|what|when|each|week|step|days?|again|over|after|by|and)$/;
const words = (x) => norm(x).replace(/[^a-z0-9₹%&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function copyFlags(text, opts = {}) {
  const o = typeof opts === 'string' ? { source: opts } : opts || {};
  const s = String(text || ''), out = [], src = typeof o.source === 'string' ? words(o.source) : words(sourceText(o.source));
  const names = (o.names || []).filter((x) => typeof x === 'string' && x.trim()).map(words), nameWords = new Set(names.flatMap((n) => n.split(' ')));
  const nameStarts = new Set(names.map((n) => n.split(' ').slice(0, 2).join(' ')).filter((x) => x.includes(' ')));
  const inName = (phrase) => { const p = words(phrase); return p.length > 3 && names.some((n) => n.includes(p)); };
  const banner = (run) => { const p = words(run); return p.split(' ').length >= 2 && !!src && src.includes(p); }; /* a run of two words or more the store writes */
  if (/\\n|\\t/.test(s)) out.push('line breaks show as “\\n” in the text');
  const runs = s.match(/\b[A-Z][A-Z0-9₹%&' -]*[A-Z0-9]\b/g) || [];
  const caps = runs.filter((r) => !banner(r) && !inName(r)).flatMap((r) => r.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !ACRO.test(w) && !nameWords.has(w.toLowerCase()) && /[a-z]/.test(s.replace(/\b[A-Z]{3,}\b/g, '')));
  if (caps.length) out.push(`shouting caps (“${caps[0]}”)`);
  if (/\bnot giving\s*[?!.]|\b(?:is|are)\s+(?:not\s+)?giving\s*[?!.]/i.test(s)) out.push('slang that doesn’t read right (“… giving?”)');
  if (/\bup to \d+ days a week\b|\b(?:[8-9]|\d{2,}) days a week\b/i.test(s)) out.push('a time phrase that doesn’t make sense (“days a week”)');
  /* a word written twice in a row ("Oil Oil"), or a capitalised name word twice within a few words ("Onion Oil Onion Hair Oil"),
     unless that stretch is a real product name, or each one starts a product's name (a list of the store's products). Plain
     repeats for rhythm ("stronger hair, healthier hair") read fine */
  const dbl = s.match(/\b([A-Za-z]{2,})\s+\1\b/i); if (dbl && !inName(dbl[0])) out.push(`a repeated word (“${dbl[1].toLowerCase()}”) in one phrase`);
  const startsName = (line, at) => nameStarts.has(words(line.slice(at)).split(' ').slice(0, 2).join(' '));
  for (const line of s.split(/\n|(?<=[.!?])\s+/)) { const ws = [...line.matchAll(/[A-Z][a-z]{3,}/g)];
    outer: for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < Math.min(ws.length, i + 4); j++) { const w = ws[i][0].toLowerCase(); if (w !== ws[j][0].toLowerCase() || REPEAT_OK.test(w)) continue;
      if (inName(line.slice(ws[i].index, ws[j].index + ws[j][0].length)) || (startsName(line, ws[i].index) && startsName(line, ws[j].index))) continue;
      out.push(`a repeated word (“${w}”) in one phrase`); break outer; } }
  return [...new Set(out)];
}
export const COPY_RULE = 'Write natural, idiomatic English a good copywriter would sign off: no forced slang, no shouting caps, never the same product word twice in one name, line breaks as real line breaks.';
