// The proof behind a card: why Brew suggested it, and the hard evidence it rests on. No AI and no paid call: every line
// here comes from data Brew already holds for the brand. Used by GET /api/cards/:cid/evidence (the proof sheet on every
// card) and by the feed's card summary (how many sources a card shows on its proof icon).
//
// Where the proof comes from, for any card, any brand:
//   1. every number on the card, matched to the fact-sheet line that holds it (label, value, the page or account it was
//      read from, the day), the brand's connected accounts first for a team member
//   2. the move it came from: its title, its headline number and the sources the move cites
//   3. what the card itself was built on: a rival's ad in the Ad Library, a customer thread or quote, an idea's evidence,
//      a Google Trends series, the rows Brew counted
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
const isEvRow = (x) => /^[^:]{2,60}:\s*[₹$€£]?[\d.,]+\s*$/.test(x) || /^[^:“"]{2,90}\([^)]*\):/.test(x);

export function createEvidence({ factsOf, movesOf, numsOf, adOf = () => null, country = () => '', brandHost = () => '' }) {
  /* a fact read from the brand's own site or accounts, or from somewhere else (a rival's page, a marketplace, the web) */
  const ownOf = (f) => { const h = String(brandHost() || '').replace(/^www\./, ''), u = hostOf(f.url) || String(f.src || '').split('/')[0].replace(/^www\./, ''); return !h || !u || u === h || u.endsWith('.' + h) || /shopify|meta\.json/i.test(f.src || ''); };
  /* the brand's facts by number: canonical number → the facts whose value holds it (demo facts never count) */
  const IDX = new WeakMap();
  const indexOf = (facts) => { if (!facts || typeof facts !== 'object') return new Map(); if (IDX.has(facts)) return IDX.get(facts);
    const m = new Map(); for (const [id, f] of Object.entries(facts)) { if (!f || f.kind === 'demo' || f.v == null) continue;
      const ns = new Set(allNums(f.v)); for (const n of ns) { if (!m.has(n)) m.set(n, []); m.get(n).push({ id, ...f }); } }
    IDX.set(facts, m); return m; };
  const cardText = (c) => [c.title, c.sub, ...(c.rows || []).map((r) => (Array.isArray(r) ? r.join(' ') : '')), ...(c.detail?.why || []), c.make?.pieces, c.make?.backedBy].filter(Boolean).join(' \n ');
  const numsOfCard = (c) => allNums(cardText(c));
  const gatedOfCard = (c) => { const s = cardText(c); return [...new Set([...numbersIn(s, { strict: true }), ...numbersIn(s)])]; }; /* money, shares, multiples, big counts: what must have a source */
  /* the best fact for one number: one the card's move used, then the most words in common with the card, then observed */
  /* a plain count ("30 days", "12 of 32") is in many facts by chance: it backs the card only when the move used that fact or the
     fact shares a word with the card. Money, shares and big counts are specific enough on their own */
  const pick = (cands, cw, used, loose) => cands.map((f) => { let hit = 0; for (const w of new Set(words(f.label).filter((x) => !/^\d/.test(x)))) if (cw.has(w)) hit++; return { f, hit, s: hit + (used.has(f.key) ? 3 : 0) + (f.kind === 'current' ? 1 : 0) }; })
    .filter((x) => !loose || x.hit >= 2 || used.has(x.f.key)).sort((a, b) => b.s - a.s)[0]?.f;

  function evidenceOf(c, { liveLedger = null, plain = null } = {}) {
    if (!c) return null;
    const facts = factsOf() || {}, idx = indexOf(facts), cw = new Set(words(cardText(c)));
    const ns = (numsOf?.(c.src) || []), M = movesOf() || {};
    const used = new Set(ns.flatMap((n) => M[n]?.factsUsed || []));
    const items = [], seen = new Set();
    const add = (x) => { const k = `${x.kind}|${x.label}|${x.value}|${x.url || ''}`; if (seen.has(k) || !(x.label || x.value)) return; seen.add(k); items.push(x); };
    const nums = numsOfCard(c), gated = new Set(gatedOfCard(c));
    /* 1. the team's own accounts (members only): a number on the card that a connected account reports */
    const live = liveLedger && typeof liveLedger === 'object' ? Object.entries(liveLedger) : [];
    const backed = new Set();
    for (const n of nums) {
      const acct = live.find(([, e]) => e && allNums(e.v).includes(n));
      if (acct) { const [key, e] = acct; add({ kind: 'account', label: plainLabel(e.label) || key, value: String(e.v), src: `Your ${connName(key)} account`, at: e.at ? new Date(e.at).toISOString().slice(0, 10) : null, url: null, num: n }); backed.add(n); continue; }
      const f = pick(idx.get(n) || [], cw, used, !gated.has(n) || String(n).replace(/\D/g, '').length <= 2); /* "10%", "₹0", "2x" are common too */
      if (!f) { const d = ns.flatMap((k) => M[k]?.derived || []).find((x) => x?.v != null && allNums(x.v).includes(n)); /* the move's own sum, shown with its working */
        if (d) { add({ kind: 'math', label: `Worked out: ${cut(d.expr, 160)}`, value: String(d.v), src: 'Brew’s maths from the prices and counts above', url: null, num: n }); backed.add(n); } continue; }
      backed.add(n);
      add({ kind: f.kind === 'current' ? 'count' : ownOf(f) ? 'fact' : 'web', label: plainLabel(f.label) || f.key, value: String(f.v), src: f.src || hostOf(f.url) || 'Brew’s read of your store', url: okUrl(f.url), at: f.at ? String(f.at).slice(0, 10) : null, num: n, ...(f.kind === 'proposed' ? { note: 'Proposed, not measured yet' } : {}) });
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
    /* 3. the move it came from: its headline number, and the sources it cites, those the card names first */
    const moves = ns.filter((n) => M[n]).map((n) => { const m = M[n];
      const srcs = (m.sources || []).filter((s) => s?.label).map((s) => { let hit = 0; for (const w of new Set(words(s.label))) if (cw.has(w)) hit++; return { s, hit }; }).sort((a, b) => b.hit - a.hit).map((x) => x.s);
      return { n, title: m.title || '', stat: m.stat ? `${m.stat}${m.statLabel ? ` · ${String(m.statLabel).toLowerCase()}` : ''}` : '', sources: srcs.slice(0, 6).map((s) => ({ label: cut(s.label, 110), url: okUrl(s.url), at: s.at ? String(s.at).slice(0, 10) : null })), more: Math.max(0, srcs.length - 6) }; });
    /* the rows Brew counted, when no fact above already says them */
    for (const r of c.rows || []) if (Array.isArray(r) && r[0] && r[1] && c.research?.kind !== 'trend' && !items.some((x) => x.value && String(r[1]).includes(x.value))) {
      if (/^(step \d+|where|post at|measure|backed by|move|latest|written)$/i.test(r[0])) continue;
      /* a row is proof only when it is something counted: a number, not a target, a plan setting or an assumption */
      if (!/\d/.test(String(r[1])) || /\b(target|goal|lift|decision|decides|control|guardrail|window|budget|deadline|launch|test|plan|cap|limit|max|min|specification|voltage|power)\b/i.test(r[0]) || /\b(assumption|proposed|target|estimate|goal|to confirm)\b/i.test(r[1])) continue;
      add({ kind: 'row', label: String(r[0]), value: cut(r[1], 120), src: c.src && !/^moves?\s/i.test(c.src) ? cut(c.src, 80) : 'What Brew counted', url: null });
    }
    const rawOf = (n) => (cardText(c).match(/(?:₹|\$|€|£|rs\.?\s?)?\d[\d,.]*\s?(?:%|x|×|k|lakh|crore|cr)?/gi) || []).find((x) => numbersIn(x, { strict: true }).concat(numbersIn(x)).includes(n))?.trim() || n; /* as the card wrote it: ₹5,555, not ₹5555 */
    const unbacked = gatedOfCard(c).filter((n) => !backed.has(n) && !items.some((x) => x.value && allNums(x.value).includes(n))).map(rawOf);
    const sourced = items.filter((x) => x.url || x.kind === 'account').length + moves.reduce((a, m) => a + m.sources.filter((s) => s.url).length, 0);
    /* why Brew suggested it: the plain-words pass's own line when it has one, else the card's own reasons */
    const reasons = (plain?.why?.length ? plain.why : (c.detail?.why || []).filter((x) => x && !isEvRow(x))).slice(0, 3);
    const because = plain?.because || [String(c.sub || '').split(/(?<=[.!?])\s+/)[0]].filter(Boolean).join(' ');
    const from = moves.length ? `It comes from Brew’s plan “${cut(moves[0].title, 90)}”${moves.length > 1 ? ` and ${moves.length - 1} more` : ''}.` : c.src ? `It comes from: ${cut(c.src, 90)}.` : '';
    return { why: { because, reasons, from }, items: items.slice(0, 10), moves, unbacked, count: items.length + moves.reduce((a, m) => a + m.sources.length, 0), sourced, strength: sourced >= 2 ? 'strong' : items.length || moves.length ? 'some' : 'thin' };
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
  const saw = (e.items || []).filter((x) => x.value).slice(0, 4).map((x) => ({ v: x.value, l: x.label, src: [x.src, x.at ? String(x.at).slice(0, 10) : ''].filter(Boolean).join(' · '), url: x.url || null, kind: x.kind }));
  const m = (e.moves || [])[0], plan = m ? `Move ${String(m.n).padStart(2, '0')} · ${m.title}` : null;
  const data = m ? m.sources.filter((x) => x.url).slice(0, 3).map((x) => ({ l: x.label, url: x.url })) : [];
  const so = e.why?.because || (e.why?.reasons || [])[0] || '';
  const text = ['Here’s what this card is based on.', ...saw.map((x) => `Saw: ${x.v}, ${x.l}${x.src ? ` (${x.src})` : ''}.`), plan ? `Plan: ${plan}.` : '', data.length ? `Sources: ${data.map((x) => x.l).join('; ')}.` : '', so ? `So: ${so}` : '',
    !saw.length && !plan ? 'Brew has no source line for this card yet, so treat it as an idea to check, not a fact.' : '', (e.unbacked || []).length ? `Not matched to a source yet: ${e.unbacked.slice(0, 3).join(', ')}.` : ''].filter(Boolean).join('\n');
  return { text, proof: { saw, plan, data, so, unbacked: (e.unbacked || []).slice(0, 3) } };
};

