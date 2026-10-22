// The proof behind a card: why Brew suggested it, and the hard evidence it rests on. No AI and no paid call: every line
// here comes from data Brew already holds for the brand. Used by GET /api/cards/:cid/evidence (the proof sheet on every
// card) and by the feed's card summary (how many sources a card shows on its proof icon).
//
// Where the proof comes from, for any card, any brand:
//   1. every number on the card, matched to the fact-sheet line that holds it, else the market pulse's line (a rival's search
//      rankings and gaps, clicks, ad counts) (label, value, the page or account it was
//      read from, the day), the brand's connected accounts first for a team member
//   2. what the card itself was built on: a rival's ad in the Ad Library, a customer thread or quote, an idea's evidence,
//      a Google Trends series, the rows Brew counted
//   3. real customer voice that speaks to the card: reviews (with rating, product and link) and threads Brew's listening found
//   4. the pages and records Brew read for it (the sources its move cites, as themselves)
// A move is never proof (Param, 19 Oct: "moves themselves are derived from the real evidence"): it is Brew's reasoning, so
// the sheet shows what the move rests on, and links to the move only as Brew's write-up
// An item with a link is "sourced"; a card with none says so plainly instead of pretending.
import { numbersIn } from './fact-gate.js';

const STOP = new Set('the a an and or of to in on for with is are be we our your you it this that by at as from per one two three each not no new more than into out up its their them they have has was were will can all any but how what when who why which while so do does did get got just only also very much many most less over under about after before then there here'.split(' '));
const words = (s) => (String(s || '').toLowerCase().match(/[a-z0-9₹$€£%]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const okUrl = (u) => /^https?:\/\//i.test(String(u || '')) ? String(u) : null;
/* a fact label reads as a plain line: "(Shopify /meta.json)" and other source notes in brackets go to the source column */
const plainLabel = (l) => String(l || '').replace(/\s*\((?:[^()]*(?:\/|\.json|\.com|\.in|api|crawl|read \d)[^()]*)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
const CONN = { shopify: 'Shopify', meta: 'Meta Ads', ga4: 'Google Analytics', google: 'Google Ads', gads: 'Google Ads', klaviyo: 'Klaviyo', judgeme: 'Judge.me', reviews: 'Judge.me' };
const connName = (key) => CONN[String(key || '').split('.')[0]] || 'your account';
/* lines in a card's "why" that are evidence rows ("Label (source): value"), not reasons */
/* plain counts too ("474 reviews", "12 of 32"): the gate (fact-gate.js) leaves them alone, but they are evidence all the same */
const plainNums = (s) => (String(s || '').match(/(?<![\d.,₹$€£]|rs\.?\s?|rs\s)\d{2,}(?:[.,]\d+)*(?![\d%])/gi) || []).map((x) => x.replace(/,/g, '')).filter((x) => !(/^\d{4}$/.test(x) && +x >= 1900 && +x <= 2100));
const allNums = (s) => [...new Set([...numbersIn(String(s || ''), { strict: true }), ...numbersIn(String(s || '')), ...plainNums(s)])];
/* a creator's paid post is not a customer speaking */
const PAID = /#\s?ad\b|#sponsored|#collab|paid partnership|\bcomment\s*[“"']?\s*link|link in (?:my )?bio|use (?:my )?code\b/i;
const voiceKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
const isEvRow = (x) => /^[^:]{2,60}:\s*[₹$€£]?[\d.,]+\s*$/.test(x) || /^[^:“"]{2,90}\([^)]*\):/.test(x);

/* the learnings a card rests on: by the card's own record (a team card's rows, the reason it was lifted or stepped back, the
   "Learned:" lines its rewritten move carries), each matched to the saved learning so the sheet shows its words and source.
   Never by shared words alone: a rival's ad that happens to use the same words is not what the team told Brew */
const pubId = (id) => String(id || '').replace(/-p$/, '');
export function teamOf(c, T, ns = [], M = {}) {
  const out = { items: [], contra: null }; if (!c || !T?.items?.length) return out;
  const L = T.items, seen = new Set(), id = pubId(c.id);
  const best = (text, pool = L, min = 3) => { const tw = new Set(words(text)); if (!tw.size) return null;
    return pool.map((x) => { let hit = 0; for (const w of new Set(words(x.text))) if (tw.has(w)) hit++; return { x, hit }; }).filter((y) => y.hit >= min).sort((a, b) => b.hit - a.hit)[0]?.x || null; };
  const KL = { goal: 'Your plan', belief: 'Your team’s rule', fact: 'Your team said', tried: 'What you tried', essence: 'Who you are' };
  const lab = (x) => KL[x?.kind] || 'Your team said';
  const push = (x, label) => { if (!x || !label || seen.has(x.text) || out.items.length >= 3) return; seen.add(x.text); out.items.push({ ...x, label }); };
  /* a card the learnings made: the learning in its "The team said" row */
  if (c.origin === 'told' || /^told-/.test(id)) { const said = (c.rows || []).find((r) => Array.isArray(r) && /team said/i.test(r[0]))?.[1] || c.sub; const x = best(said, L, 2); push(x, lab(x)); }
  /* lifted: the learning behind the reason (same upload first) */
  const up = T.up?.[id]; if (up) { const pool = L.filter((x) => !up.hash || x.hash === up.hash); const x = best(`${up.why} ${c.title} ${c.sub}`, pool.length ? pool : L, 2); push(x, lab(x)); }
  /* stepped back: it repeats what the team ruled out, said plainly on the sheet */
  const hd = T.hide?.[id]; if (hd) { const pool = L.filter((x) => !hd.hash || x.hash === hd.hash); const x = best(`${hd.why}`, pool.length ? pool : L, 2); out.contra = String(hd.why || '').trim() || null; push(x, 'Your team said this doesn’t work'); }
  /* its move was rewritten on the learnings: the lines the rewrite says it used */
  for (const n of ns) { const m = M[n]?.meta; if (!/^What the team told us\b/.test(m?.because || '')) continue;
    for (const ch of m.changes || []) { const t = String(ch).replace(/^Learned:\s*/, ''); const x = L.find((y) => y.text.startsWith(t.replace(/…$/, '').slice(0, 60))) || best(t, L, 3); push(x, lab(x)); } }
  return out;
}

export function createEvidence({ factsOf, movesOf, numsOf, adOf = () => null, country = () => '', brandHost = () => '', learnedOf = () => null, pulseOf = () => null }) {
  /* a fact read from the brand's own site or accounts, or from somewhere else (a rival's page, a marketplace, the web) */
  const ownOf = (f) => { const h = String(brandHost() || '').replace(/^www\./, ''), u = hostOf(f.url) || String(f.src || '').split('/')[0].replace(/^www\./, ''); return !h || !u || u === h || u.endsWith('.' + h) || /shopify|meta\.json/i.test(f.src || ''); };
  /* the brand's facts by number: canonical number → the facts whose value holds it (demo facts never count) */
  const IDX = new WeakMap();
  const indexOf = (facts) => { if (!facts || typeof facts !== 'object') return new Map(); if (IDX.has(facts)) return IDX.get(facts);
    const m = new Map(); for (const [id, f] of Object.entries(facts)) { if (!f || f.kind === 'demo' || f.v == null) continue;
      const ns = new Set(allNums(f.v)); for (const n of ns) { if (!m.has(n)) m.set(n, []); m.get(n).push({ id, ...f }); } }
    IDX.set(facts, m); return m; };
  /* the market pulse's lines by number (rival search rankings and gaps, clicks, ad counts): keyed as the moves cite them
     (pulse.<key>), so a number a move took from the pulse matches the line it came from */
  const PIDX = new WeakMap();
  const pulseIndex = (lines) => { if (!Array.isArray(lines)) return new Map(); if (PIDX.has(lines)) return PIDX.get(lines);
    const m = new Map(); for (const x of lines) { if (!x?.key) continue; const f = { ...x, key: `pulse.${x.key}`, label: x.label || x.key, pulse: true };
      for (const n of new Set(allNums(f.v))) { if (!m.has(n)) m.set(n, []); m.get(n).push(f); } }
    PIDX.set(lines, m); return m; };
  const cardText = (c) => [c.title, c.sub, ...(c.rows || []).map((r) => (Array.isArray(r) ? r.join(' ') : '')), ...(c.detail?.why || []), c.make?.pieces, c.make?.backedBy].filter(Boolean).join(' \n ');
  const numsOfCard = (c) => allNums(cardText(c));
  const gatedOfCard = (c) => { const s = cardText(c); return [...new Set([...numbersIn(s, { strict: true }), ...numbersIn(s)])]; }; /* money, shares, multiples, big counts: what must have a source */
  /* the best fact for one number: one the card's move used, then the most words in common with the card, then observed */
  /* a plain count ("30 days", "12 of 32") is in many facts by chance: it backs the card only when the move used that fact or the
     fact shares a word with the card. Money, shares and big counts are specific enough on their own */
  const pick = (cands, cw, used, loose) => cands.map((f) => { let hit = 0; for (const w of new Set(words(f.label).filter((x) => !/^\d/.test(x)))) if (cw.has(w)) hit++; return { f, hit, s: hit + (used.has(f.key) ? 3 : 0) + (f.kind === 'current' ? 1 : 0) }; })
    .filter((x) => !loose || x.hit >= 2 || used.has(x.f.key)).sort((a, b) => b.s - a.s)[0]?.f;

  /* a pulse line is a market number, not the brand's own: a plain count ("100", "30") backs the card only when its move used
     that line; a specific one also needs two words in common with the card (the rival's name, what was counted) */
  const pickPulse = (cands, cw, used, loose) => pick(cands.filter((f) => used.has(f.key) || (!loose && words(`${f.label} ${f.subject || ''}`).filter((w) => !/^\d/.test(w) && cw.has(w)).length >= 2)), cw, used, false);
  function evidenceOf(c, { liveLedger = null, facts: truth = null, plain = null, voice = [], team: teamOk = true } = {}) { /* teamOk: what the team told Brew is for its team only, like the told list */ /* truth: a member's sheet (facts-desk.js truthOf), so a site number a connected one replaced backs nothing; liveLedger only names the account */
    if (!c) return null;
    const facts = truth || factsOf() || {}, idx = indexOf(facts), pidx = pulseIndex(pulseOf?.()), cw = new Set(words(cardText(c)));
    const ns = (numsOf?.(c.src) || []), M = movesOf() || {};
    const used = new Set(ns.flatMap((n) => M[n]?.factsUsed || []));
    const items = [], seen = new Set();
    const add = (x) => { const k = `${x.kind}|${x.label}|${x.value}|${x.url || ''}`; if (seen.has(k) || !(x.label || x.value)) return; seen.add(k); items.push(x); };
    const nums = numsOfCard(c), gated = new Set(gatedOfCard(c));
    /* 0. what the team told Brew (brand-learnings.js), when the card rests on it: a card the learnings made, lifted or stepped back,
       or one whose move was rewritten on them. Their own words and where they came from (the upload, who, the day), first */
    const T = teamOk ? learnedOf?.() || null : null, team = teamOf(c, T, ns, M);
    for (const x of team.items) add({ kind: 'team', label: x.label, value: cut(x.text, 220), quote: x.quote ? cut(x.quote, 220) : '', src: cut(String(x.source || '').replace(/,\s*\d{4}-\d{2}-\d{2}$/, ''), 110), at: x.at ? new Date(x.at).toISOString().slice(0, 10) : null, url: null });
    /* 1. the team's own accounts (members only): a number on the card that a connected account reports */
    const live = liveLedger && typeof liveLedger === 'object' ? Object.entries(liveLedger) : [];
    const backed = new Set();
    for (const n of nums) {
      const acct = live.find(([, e]) => e && allNums(e.v).includes(n));
      if (acct) { const [key, e] = acct; add({ kind: 'account', label: plainLabel(e.label) || key, value: String(e.v), src: `Your ${connName(key)} account`, at: e.at ? new Date(e.at).toISOString().slice(0, 10) : null, url: null, num: n }); backed.add(n); continue; }
      const loose = !gated.has(n) || String(n).replace(/\D/g, '').length <= 2, f = pick(idx.get(n) || [], cw, used, loose) || pickPulse(pidx.get(n) || [], cw, used, loose); /* "10%", "₹0", "2x" are common too */
      if (!f) { const d = ns.flatMap((k) => M[k]?.derived || []).find((x) => x?.v != null && allNums(x.v).includes(n)); /* the move's own sum, shown with its working */
        if (d) { add({ kind: 'math', label: `Worked out: ${cut(d.expr, 160)}`, value: String(d.v), src: 'Brew’s maths from the prices and counts above', url: null, num: n }); backed.add(n); } continue; }
      backed.add(n);
      add({ kind: f.pulse ? (f.own ? 'fact' : 'web') : f.kind === 'current' ? 'count' : ownOf(f) ? 'fact' : 'web', label: plainLabel(f.label) || f.key, value: String(f.v), src: f.pulse ? [f.src, f.subject].filter(Boolean).join(' · ') : f.src || hostOf(f.url) || 'Brew’s read of your store', url: okUrl(f.url), at: f.at ? String(f.at).slice(0, 10) : null, num: n, ...(f.kind === 'proposed' ? { note: 'Proposed, not measured yet' } : {}) });
    }
    /* 2. what the card was built on */
    const ad = c.research?.kind === 'ad' ? adOf(c.research.id) : null;
    if (ad) add({ kind: 'ad', label: `${ad.brand || 'A rival'}’s live ad`, value: cut(ad.hook || ad.headline || '', 160), src: `Meta Ad Library${country() ? ` · ${country()}` : ''}`, url: okUrl(ad.url), at: null, extra: [ad.days != null ? `running ${ad.days} days` : '', ad.versions > 1 ? `${ad.versions} versions` : '', ad.since ? `since ${ad.since}` : ''].filter(Boolean).join(', ') });
    else if (c.link?.url && okUrl(c.link.url)) add({ kind: 'link', label: c.link.label || 'The source', value: '', src: hostOf(c.link.url), url: c.link.url });
    const h = c.heard;
    if (h?.kind === 'thread') add({ kind: 'quote', label: h.where ? `People talking on ${h.where}` : 'What people are saying', value: cut(h.quote, 220), src: hostOf(h.url) || h.where || '', url: okUrl(h.url), extra: h.replies != null ? `${h.replies} replies` : '' });
    for (const q of h?.quotes || []) add({ kind: 'quote', label: h.name ? `What people say about “${cut(h.name, 50)}”` : 'What people say', value: cut(q.text, 220), src: q.where || hostOf(q.url), url: okUrl(q.url) });
    if (h?.kind === 'theme' && h.n) add({ kind: 'count', label: 'Mentions Brew found', value: `${h.n}${h.neg != null ? ` (${h.neg} unhappy, ${h.pos || 0} happy)` : ''}`, src: 'Listening across the web', url: null });
    for (const e of c.post?.evidence || []) add({ kind: 'idea', label: plainLabel(e.label), value: cut(e.value, 200), src: e.src || hostOf(e.url) || '', url: okUrl(e.url) });
    if (c.research?.kind === 'trend') for (const r of c.rows || []) if (Array.isArray(r) && r[0]) add({ kind: 'trend', label: `Google searches for “${cut(r[0], 50)}”`, value: String(r[1] || ''), src: c.src || 'Google Trends', url: `https://trends.google.com/trends/explore?${country() ? `geo=${encodeURIComponent(country())}&` : ''}q=${encodeURIComponent(r[0])}` });
    /* a finding from Brew's read of the site: what was read, where, and when */
    if ((c.origin === 'read' || /^read from /i.test(c.src || '')) && !items.length) { const h = String(brandHost() || '').replace(/^www\./, '');
      add({ kind: 'read', label: 'What Brew read on your site', value: cut(String(c.sub || '').split(/(?<=[.!?])\s+/)[0], 200), src: cut(c.src || h, 80), url: h ? `https://${h}/` : null }); }
    /* real customer voice on what the card is about: a review or a thread that shares its words (or names its product) */
    const brandW = new Set(words(c.brand || ''));
    const voiceHits = (voice || []).map((v) => { let hit = 0; for (const w of new Set(words(`${v.text} ${v.product || ''}`))) if (cw.has(w) && !brandW.has(w)) hit++; const prod = v.product && cardText(c).toLowerCase().includes(String(v.product).toLowerCase().split(/\s+[-–|]\s+/)[0]); return { v, s: hit + (prod ? 3 : 0) }; })
      .filter((x) => x.s >= 3 && !PAID.test(x.v.text)).sort((a, b) => b.s - a.s)
      .filter((x, i, a) => a.findIndex((y) => voiceKey(y.v.text) === voiceKey(x.v.text)) === i).slice(0, 3); /* the same review listed under two products shows once */
    for (const { v } of voiceHits) add(v.kind === 'review' ? { kind: 'voice', label: `${v.rating ? `${v.rating}★ review` : 'A customer review'}${v.product ? ` of ${cut(v.product, 60)}` : ''}`, value: cut(v.text, 220), src: v.src || 'Your reviews', url: okUrl(v.url), at: v.at ? String(v.at).slice(0, 10) : null }
      : { kind: 'quote', label: v.where ? `Said on ${v.where}` : 'Said online', value: cut(v.text, 220), src: v.platform || hostOf(v.url), url: okUrl(v.url), extra: v.replies ? `${v.replies} replies` : '' });
    /* the pages and records Brew read for this card (its move's sources, as themselves), those the card names first */
    const srcs = ns.flatMap((n) => M[n]?.sources || []).filter((x) => x?.label && okUrl(x.url))
      .map((x) => { let hit = 0; for (const w of new Set(words(x.label))) if (cw.has(w)) hit++; return { x, hit }; }).sort((a, b) => b.hit - a.hit).map((y) => y.x);
    const srcSeen = new Set(items.map((x) => x.url).filter(Boolean));
    for (const x of srcs) { if (srcSeen.has(x.url)) continue; srcSeen.add(x.url); if (items.filter((y) => y.kind === 'source').length >= 5) break;
      add({ kind: 'source', label: cut(x.label, 110), value: '', src: hostOf(x.url), url: x.url, at: x.at ? String(x.at).slice(0, 10) : null }); }
    const moves = ns.filter((n) => M[n]).map((n) => ({ n, title: M[n].title || '' })); /* Brew's write-up, linked from the sheet; never counted as proof */
    /* the rows Brew counted, when no fact above already says them */
    for (const r of c.rows || []) if (Array.isArray(r) && r[0] && r[1] && c.research?.kind !== 'trend' && !items.some((x) => x.value && (String(r[1]).includes(x.value) || allNums(String(r[1])).some((n) => allNums(x.value).includes(n))))) { /* "368,000" is "368000": the same number in two formats is one row (QA UI) */
      if (/^(step \d+|where|post at|measure|backed by|move|latest|written)$/i.test(r[0])) continue;
      /* a row is proof only when it is something counted: a number, not a target, a plan setting or an assumption */
      if (!/\d/.test(String(r[1])) || /\b(target|goal|lift|decision|decides|control|guardrail|window|budget|deadline|launch|test|plan|cap|limit|max|min|specification|voltage|power)\b/i.test(r[0]) || /\b(assumption|proposed|target|estimate|goal|to confirm)\b/i.test(r[1])) continue;
      add({ kind: 'row', label: String(r[0]), value: cut(r[1], 120), src: c.src && !/^moves?\s/i.test(c.src) ? cut(c.src, 80) : 'What Brew counted', url: null });
    }
    const rawOf = (n) => (cardText(c).match(/(?:₹|\$|€|£|rs\.?\s?)?\d[\d,.]*\s?(?:%|x|×|k|lakh|crore|cr)?/gi) || []).find((x) => numbersIn(x, { strict: true }).concat(numbersIn(x)).includes(n))?.trim() || n; /* as the card wrote it: ₹5,555, not ₹5555 */
    const bare = (n) => String(n).replace(/[^\d.]/g, '').replace(/\.0+$/, ''), shown = new Set(items.flatMap((x) => [...allNums(x.value || ''), ...allNums(x.label || '')].map(bare)));
    const unbacked = gatedOfCard(c).filter((n) => !backed.has(n) && !items.some((x) => x.value && allNums(x.value).includes(n)) && !shown.has(bare(n)) /* ₹4,490 on a sourced row backs 4,490 */).map(rawOf);
    const sourced = items.filter((x) => x.url || x.kind === 'account' || x.kind === 'team').length; /* the team's own words, with the file they came from, count as sourced */
    /* why Brew suggested it: the plain-words pass's own line when it has one, else the card's own reasons */
    const reasons = (plain?.why?.length ? plain.why : (c.detail?.why || []).filter((x) => x && !isEvRow(x))).slice(0, 3);
    const because = plain?.because || [String(c.sub || '').split(/(?<=[.!?])\s+/)[0]].filter(Boolean).join(' ');
    return { why: { because, reasons }, items: items.slice(0, 14), moves, unbacked, count: Math.min(items.length, 14), sourced, strength: sourced >= 2 ? 'strong' : items.length ? 'some' : 'thin', ...(team.contra ? { contra: team.contra } : {}), told: team.items.length > 0 };
  }
  /* the feed card's proof icon: how many things back it, without building the whole sheet's text */
  const countOf = (c, o) => { const e = evidenceOf(c, o); return e ? { n: e.count, strength: e.strength } : null; };
  return { evidenceOf, countOf };
}

/* "what's the evidence behind this?" in a jam (testing notes 18 Oct: it answered "I don't know that yet" and lost the card):
   the answer is the card's own proof, said the way a person would, no AI and no spend, so it can never lose the card */
export const EVIDENCE_ASK = /\b(evidence|proof|sources?|sourced|based on|backs? (?:this|it|that)( up)?|back (?:this|it|that) up|how do (?:you|we) know|where (?:did|does|do|is) .{1,40}? (?:come|coming) from|data behind|why (?:this|that) (?:card|move|idea|suggestion|number|price)|why (?:did|do|would) (?:you|brew) (?:suggest|say|think|recommend)|what(?:'s| is) (?:this|that|it) based)\b/i;
export const proofAnswer = (e) => {
  if (!e) return null;
  const saw = (e.items || []).filter((x) => x.value && x.kind !== 'source').slice(0, 4).map((x) => ({ v: x.value, l: x.label, src: [x.src, x.at ? String(x.at).slice(0, 10) : ''].filter(Boolean).join(' · '), url: x.url || null, kind: x.kind }));
  const data = (e.items || []).filter((x) => x.kind === 'source' && x.url).slice(0, 3).map((x) => ({ l: x.label, url: x.url }));
  const so = e.why?.because || (e.why?.reasons || [])[0] || '';
  const text = ['Here’s what this card is based on.', ...saw.map((x) => `Saw: ${x.v}, ${x.l}${x.src ? ` (${x.src})` : ''}.`), data.length ? `Read: ${data.map((x) => x.l).join('; ')}.` : '', so ? `So: ${so}` : '',
    !saw.length && !data.length ? 'Brew has no source line for this card yet, so treat it as an idea to check, not a fact.' : '', (e.unbacked || []).length ? `Not matched to a source yet: ${e.unbacked.slice(0, 3).join(', ')}.` : ''].filter(Boolean).join('\n');
  return { text, proof: { saw, data, so, unbacked: (e.unbacked || []).slice(0, 3) } };
};

