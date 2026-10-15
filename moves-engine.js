// Moves engine: writes the Brew "moves" for any brand at the depth of the hand-made Arata corpus: the 51 core moves,
// the listening-era moves (51+, written once their evidence exists) and dynamic ones per brand (a festival at its plan
// point, a research question, replies that reached their threshold).
// writeMove(n) = house template + evidence contract + the discipline's SKILL.md + brand brief + ledger slice (+ listening,
// market pulse, video and calendar lines in the same ledger shape) + dependency digests + one Arata move as a depth exemplar
// → Opus 5.5 (effort high, streamed, structured output).
// verify(move) = deterministic number scan against the ledger + a Sonnet claims check + one targeted Opus fix.
// runAll() = dependency-ordered scheduler with resume. Mock mode writes structurally valid placeholders.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFamilies, timingLine } from './measure-families.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
export const SPECS = JSON.parse(read('data/move-specs.json'));
const HOUSE = read('prompts/move-house.md');
const FAMS = createFamilies({});
// the treg-map capability ids a spec's `evidence` may name next to its ledger areas ('ads' is both)
export const CAPS = ['listening', 'social-posts', 'research', 'rival-weakness', 'seo', 'ai-seo', 'creative', 'creators', 'price-offer', 'seasonal', 'weather', 'cro', 'automation', 'ads', 'email'];
const CAPSET = new Set(CAPS);
export const capsOf = (sp) => (sp?.evidence || []).filter((x) => CAPSET.has(x));
const areasOf = (sp) => (sp?.evidence || []).filter((x) => !CAPSET.has(x) || x === 'ads');
let probeFor = null; // treg-map.js probeFor(family): where a family's number is read, when that file exists
import('./treg-map.js').then((m) => { if (typeof m.probeFor === 'function') probeFor = m.probeFor; }).catch(() => {});
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export const numWord = (n) => (n < 20 ? NUMW[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? '-' + NUMW[n % 10] : '') : String(n));
const cap1 = (x) => x.charAt(0).toUpperCase() + x.slice(1);
// the evidence contract: what every move must cite, quote and measure (sits after the house template, and wins over it)
const CONTRACT = `

## Evidence contract (this overrides anything above that conflicts)

- The kicker is given in the task, with the real number of moves in this brand's playbook. Do not write "of 50" or "fifty moves".
- Every claim about the brand, its buyers, its rivals or its market cites one evidence line: a ledger key, a listening line (listen.*), a market pulse line (pulse.*), a video read (video.*) or a calendar line (cal.*). Say where it comes from in plain words in the text ("113 posts heard on Reddit and YouTube since September", "the forecast for Delhi read 12 Oct") and list every key you used in factsUsed. Numbers come only from those lines or from derived arithmetic on them.
- Never name the data vendors or tools behind a line (no API, scraper or provider names). Say what was read and where: "Reddit threads", "Amazon reviews", "Google Shopping results", "the weekly AI answers check".
- Quote real people only from listen quote lines (keys ending .q1, .q2 … or listen.asked.*), word for word, with the link from that line and the platform and date. Never invent, merge or tidy a quote. Anything else in quotation marks is labelled as our draft copy or a dramatised example.
- Counts from listening are given with their window and split (e.g. "113 mentions: 42 positive, 8 negative, 63 neutral; 2 this week vs 3 the week before"). Do not turn a count of mentions into a share of customers.
- "How we measure" keeps its table and adds, after it: a paragraph that starts "Check timings:" and names the metric, where the team reads it and the check schedule of this move's measuring family exactly as the task gives it (check days, decide day, early stops). The brand's team runs these checks: Brew does not watch, re-read, grade, pause or stop anything, so never say it does. Then one line that starts "What to watch:" naming the listening, pulse and calendar lines the team should look at each check. Nothing is judged before the decide day.
- When an evidence family the move needs is missing (no listening yet, no pulse line), say so in the method note and mark the dependent cells "To be pulled", never a guess.`;
const SYSTEM = HOUSE + CONTRACT;
const pad = (n) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const GROUPS = [
  ['know', 'KNOW THE BRAND', 'FOUNDATION'], ['found', 'BE FOUND', 'ORGANIC'], ['reach', 'REACH PEOPLE', 'PAID, SOCIAL, CREATORS'],
  ['convert', 'CONVERT THE VISIT', 'SITE AND LISTINGS'], ['keep', 'KEEP THE CUSTOMER', 'RETENTION'], ['expand', 'EXPAND AND OPERATE', 'B2B AND OPS']];

// ---------- Move JSON schema (strictSchema in ai.js makes every field required, so unused fields are ""/[]) ----------
const S = { type: 'string' };
const BLOCK = { type: 'object', properties: {
  t: { type: 'string', enum: ['p', 'h3', 'list', 'table', 'diagram', 'example', 'callout'] },
  text: S, items: { type: 'array', items: S }, ordered: { type: 'boolean' },
  head: { type: 'array', items: S }, rows: { type: 'array', items: { type: 'array', items: S } }, caption: S,
  title: S, label: S, body: S } };
export const MOVE_SCHEMA = { type: 'object', properties: {
  title: S, stat: S, statLabel: S, gives: S, live: S,
  sections: { type: 'array', items: { type: 'object', properties: {
    h: S, kind: { type: 'string', enum: ['why', 'found', 'plan', 'examples', 'measure', 'appendix', 'sources', 'other'] },
    blocks: { type: 'array', items: BLOCK } } } },
  sources: { type: 'array', items: { type: 'object', properties: { label: S, url: S, at: S } } },
  factsUsed: { type: 'array', items: S },
  derived: { type: 'array', items: { type: 'object', properties: { v: S, expr: S } } },
  newFacts: { type: 'array', items: { type: 'object', properties: { v: S, label: S, url: S, quote: S } } },
  toConfirm: { type: 'array', items: S } } };

// ---------- numbers ----------
const NUMRE = [
  // currency, optional scale word
  [/(?:₹|Rs\.?\s?|INR\s?|\$|€|£)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(lakh|L|Cr|crore|K|k|M|mn|bn|B)\b)?/g, 'cur'],
  [/(\d+(?:\.\d+)?)\s?%/g, 'pct'],
  [/\b(\d+(?:\.\d+)?)\s?(?:X|x|×)(?![a-z0-9])/g, 'mul'],
  [/(\d(?:\.\d)?)\s?★/g, 'star'],
  [/\b(\d[\d,]*(?:\.\d+)?)\s?(K|M|lakh|crore|million|billion|mn|bn)\b\+?/g, 'scaled'],
  [/\b(\d[\d,]*(?:\.\d+)?)\+?\s+(?:[A-Za-z-]+\s){0,2}?(reviews?|ratings?|customers?|visits?|visitors|orders?|followers?|subscribers?|users?|SKUs?|products|stores|views|downloads|studies|participants|employees|installs|buyers)\b/gi, 'count']];
const SCALE = { lakh: 1e5, l: 1e5, cr: 1e7, crore: 1e7, k: 1e3, m: 1e6, mn: 1e6, million: 1e6, bn: 1e9, b: 1e9, billion: 1e9 };
const num = (s) => +String(s).replace(/,/g, '');
export function numbersIn(text) {
  const out = []; const s = String(text || ''); const seen = new Set();
  for (const [re, kind] of NUMRE) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(s))) {
      const key = m.index + ':' + m[1]; if (seen.has(key)) continue; seen.add(key);
      // a "%"/"x" already matched as currency etc. is fine to double-check; skip years and dates in counts
      const v = num(m[1]); if (kind === 'count' && v >= 1900 && v <= 2100 && !m[1].includes(',')) continue;
      const sc = m[2] && SCALE[String(m[2]).toLowerCase()];
      out.push({ raw: m[0].trim(), v, scaled: sc ? v * sc : null, kind, at: m.index });
    }
  }
  return out;
}
const rawNums = (s) => (String(s ?? '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(num);
const close = (a, b) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 1e-6);
export function allowedFromLedger(ledger = [], extra = []) {
  const set = [];
  for (const e of ledger) {
    if (e.n != null && isFinite(e.n)) set.push(+e.n);
    for (const s of [e.v, e.label]) for (const x of numbersIn(s)) { set.push(x.v); if (x.scaled) set.push(x.scaled); }
    for (const x of rawNums(e.v)) set.push(x);
  }
  for (const s of extra) for (const x of rawNums(s)) set.push(x);
  return { has: (x) => set.some((y) => close(x.v, y) || (x.scaled != null && close(x.scaled, y))), add: (v) => set.push(v), size: () => set.length };
}
// "₹1,400 ÷ 30" → 46.67 when every operand is allowed
function evalExpr(expr, allowed) {
  expr = String(expr).split('=')[0].replace(/\([^()]*[A-Za-z][^()]*\)/g, ' '); // "₹4,317 ÷ 90 days (3 bottles × 30 days)" → "₹4,317 ÷ 90 days"
  let e = expr.replace(/(?:₹|Rs\.?|\$|€|£)/g, '').replace(/(\d),(\d)/g, '$1$2').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/−|–/g, '-')
    .replace(/(\d+(?:\.\d+)?)\s?(lakh|Cr|crore|K|M)\b/gi, (_, a, b) => `(${a}*${SCALE[b.toLowerCase()]})`).replace(/%/g, '').replace(/[A-Za-z]+/g, ' ');
  if (!/^[\d.+\-*/()\s]+$/.test(e)) return null;
  const operands = (expr.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(num);
  // small constants (days, months, pack sizes) are fine; every larger operand must be an allowed number
  if (!operands.every((o) => o <= 100 || allowed.has({ v: o, scaled: null }))) return null;
  try { const r = Function(`return (${e})`)(); return isFinite(r) ? r : null; } catch { return null; }
}
const LABELLED = /\b(to confirm|assum|target|propos|benchmark|estimat|project|forecast|hypothe|scenario|illustrat|budget|plan(?:ned)? (?:price|at)|we (?:set|recommend|suggest)|cap|ceiling|floor|if\b|would|could|e\.g\.|for example|sample|placeholder|dramati)/i;

// every string in a move with a stable address, its section kind and its label context
function* walk(move) {
  for (const [i, s] of (move.sections || []).entries()) for (const [j, b] of (s.blocks || []).entries()) {
    const at = `s${i}.b${j}`, kind = s.kind;
    if (b.t === 'table') {
      for (const [r, row] of (b.rows || []).entries()) for (const [c, cell] of row.entries())
        yield { at, field: `rows.${r}.${c}`, kind, text: cell, ctx: `${b.head?.[c] || ''} ${row[0] || ''} ${b.caption || ''}` };
    } else {
      for (const f of ['text', 'title', 'label', 'body', 'caption']) if (b[f]) yield { at, field: f, kind, text: b[f], ctx: f === 'body' ? b.label || '' : '' };
      for (const [k, it] of (b.items || []).entries()) yield { at, field: `items.${k}`, kind, text: it, ctx: '' };
    }
  }
}
const sentenceAt = (s, i) => { const a = s.lastIndexOf('. ', i), b = s.indexOf('. ', i); return s.slice(a < 0 ? 0 : a + 2, b < 0 ? s.length : b + 1); };
const getField = (b, f) => f.split('.').reduce((o, k) => o?.[k], b);
const setField = (b, f, v) => { const ks = f.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], b)[last] = v; };

// deterministic scan → [{at, field, raw, sentence, why}]
export function scanNumbers(move, allowed) {
  const issues = [];
  const strictKinds = new Set(['why', 'found', 'examples']);
  for (const x of walk(move)) {
    if (x.kind === 'sources') continue;
    for (const n of numbersIn(x.text)) {
      if (!strictKinds.has(x.kind) && !['cur', 'count', 'star', 'scaled'].includes(n.kind)) continue;
      if (allowed.has(n)) continue;
      const sent = sentenceAt(x.text, n.at);
      if (LABELLED.test(sent) || LABELLED.test(x.ctx)) continue;
      issues.push({ at: x.at, field: x.field, raw: n.raw, sentence: sent.slice(0, 300), why: 'number not in ledger, derived or cited sources' });
    }
  }
  for (const [k, v] of [['stat', move.stat]]) for (const n of numbersIn(v)) if (!allowed.has(n) && !/target/i.test(move.statLabel || '')) issues.push({ at: k, field: k, raw: n.raw, sentence: `${move.stat} / ${move.statLabel}`, why: 'cover stat not backed' });
  return issues;
}

// ---------- prompt material ----------
const AREA = { catalog: ['catalog.', 'product.'], price: ['price.', 'mrp.'], claim: ['claim.'], reviews: ['reviews.', 'review.'], company: ['company.'],
  rival: ['rival.'], ads: ['ads.'], site: ['site.', 'policy.'], tech: ['site.tech', 'tech.'], checkout: ['site.checkout', 'checkout.'], policies: ['policy.'],
  socials: ['social.', 'socials.'], ai: ['ai.'], search: ['search.'] };
const ledgerLine = (e) => `${e.key} | ${e.v} | ${e.label}${e.layer === 'inferred' ? ' (inferred)' : ''} | ${e.src || ''} | ${e.at || ''}${e.signal && e.url ? ` | ${e.url}` : ''}`;
export function ledgerSlice(ledger = [], areas = [], cap = 260) {
  if (ledger.length <= 160) return ledger;
  const pre = areas.flatMap((a) => AREA[a] || [a + '.']);
  return ledger.filter((e) => pre.some((p) => e.key.startsWith(p))).slice(0, cap);
}

// ---------- signals: listening, market pulse, video reads and the calendar, as ledger lines ----------
// Same shape as ledger entries ({key, v, label, src, at, n}) plus {url, family, signal: true}, so verify() backs their numbers
// and the claims check sees the quotes. Missing files simply give no lines.
const slugOf = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const isoOf = (t) => { if (!t) return ''; const ms = typeof t === 'number' ? (t < 1e12 ? t * 1e3 : t) : Date.parse(t); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(t).slice(0, 10); };
const numOf = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
const VENDOR = /\b(treg|dataforseo|serper|serpapi|spyfu|serpstat|tikhub|anyapi|scrapecreators|crawl4ai|apify|brightdata|seranking|tinyfish|adyntel|harvestapi|litescrape|influencersclub|tomba|aviato|reapi|openrouter|pullpush)\b/i;
const srcName = (s, fb) => (!s || VENDOR.test(String(s)) ? fb : String(s));
const PLAT = { reddit: 'Reddit', youtube: 'YouTube', site: 'site reviews', x: 'X', amazon: 'Amazon reviews', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', trustpilot: 'Trustpilot', google: 'Google reviews' };
// an event fits the brand when it names the brand's country (or is global, or names no market at all)
export const marketOk = (e, country) => { const m = e?.countries || e?.markets || e?.country || e?.market || e?.region; if (!m || !country) return true;
  const xs = [].concat(m).map((x) => String(x).toUpperCase()); return xs.includes(String(country).toUpperCase()) || xs.some((x) => ['GLOBAL', 'ALL', '*', 'WW', 'WORLD'].includes(x)); };
const evName = (e) => e?.name || e?.title || e?.event || e?.id || 'Event';
const evDate = (e) => isoOf(e?.date || e?.start || e?.startAt || e?.on);
const quoteOfItem = (x) => { const t = String(x.title || '').replace(/[.!?…\s]+$/, ''); return String(t && !String(x.text || '').toLowerCase().startsWith(t.toLowerCase()) ? `${t}. ${x.text || ''}` : x.text || t).replace(/\s+/g, ' ').trim().slice(0, 280); };
export function signalLedger({ themes, items, history, asked, pulse, videos, calendar, profile, today: td = today() } = {}) {
  const out = [], add = (e) => out.push({ layer: 'observed', signal: true, ...e });
  const T = Array.isArray(themes) ? themes : themes?.themes || [], at = isoOf(themes?.at) || td;
  const IT = Array.isArray(items) ? items : items?.items || [], byId = new Map(IT.map((x) => [x.id, x]));
  const heard = 'Brew listening (public posts, comments and reviews)';
  const who = (x) => `${x.author || 'someone'} on ${PLAT[x.platform] || x.platform || 'the web'}${x.sub ? ` ${x.sub}` : ''}`;
  for (const t of T.slice(0, 12)) {
    if (!t?.name) continue; const k = `listen.theme.${slugOf(t.name)}`;
    const w = t.wow || {}, wow = w.week != null ? `; ${w.week} this week vs ${w.lastWeek ?? 0} the week before${w.change != null ? ` (${w.change >= 0 ? '+' : ''}${Math.round(w.change * 100)}% week on week)` : ''}` : '';
    add({ key: k, n: t.n, v: `${t.n} mentions: ${t.pos ?? 0} positive, ${t.neg ?? 0} negative, ${t.neutral ?? 0} neutral${t.brand != null ? `; ${t.brand} about the brand` : ''}${wow}`, label: `Listening theme "${t.name}" (mentions, sentiment split, week on week)`, src: heard, url: t.quoteLink || '', at, family: 'listening' });
    // two linked quotes per theme: the items behind it, else the theme's own top quote
    const qs = (t.quoteIds || []).map((id) => byId.get(id)).filter((x) => x?.link && String(x.text || x.title || '').trim()).slice(0, 2);
    if (qs.length) qs.forEach((x, i) => add({ key: `${k}.q${i + 1}`, v: quoteOfItem(x), label: `Quote, ${who(x)}, ${isoOf(x.postedAt)} (theme "${t.name}")`, src: heard, url: x.link, at: isoOf(x.postedAt) || at, family: 'listening', quote: true }));
    else if (t.quote && t.quoteLink) add({ key: `${k}.q1`, v: String(t.quote).slice(0, 280), label: `Quote (theme "${t.name}")`, src: heard, url: t.quoteLink, at, family: 'listening', quote: true });
    // the questions inside the theme: the research gap and the FAQ count
    const nq = IT.filter((x) => x.intent === 'question' && (x.themes || []).includes(t.name)).length;
    if (nq) add({ key: `${k}.questions`, n: nq, v: `${nq} of the ${t.n} mentions are questions`, label: `Questions people asked about "${t.name}"`, src: heard, url: t.quoteLink || '', at, family: 'listening' });
  }
  // rival weakness: complaints about rivals, by theme, each with one linked quote
  const rv = {}; for (const x of IT) if (x.about === 'rival' && (x.sentiment === 'neg' || x.intent === 'complaint' || (x.rating && x.rating <= 3))) for (const th of (x.themes?.length ? x.themes : ['general'])) (rv[th] ||= []).push(x);
  for (const [th, xs] of Object.entries(rv).sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
    const k = `listen.rival.${slugOf(th)}`, q = xs.find((x) => x.link);
    add({ key: k, n: xs.length, v: `${xs.length} complaints about rivals on "${th}"`, label: `Rival complaints heard, theme "${th}"`, src: heard, url: q?.link || '', at, family: 'rival-weakness' });
    if (q) add({ key: `${k}.q1`, v: quoteOfItem(q), label: `Quote, ${who(q)}, ${isoOf(q.postedAt)} (rival complaint "${th}")`, src: heard, url: q.link, at: isoOf(q.postedAt) || at, family: 'rival-weakness', quote: true });
  }
  // trend: the theme counts across the saved listening runs
  const H = (Array.isArray(history) ? history : []).filter((h) => h && (h.themes || h.data?.themes)).sort((a, b) => String(a.date || a.at).localeCompare(String(b.date || b.at))).slice(-6);
  if (H.length >= 2) for (const t of T.slice(0, 6)) {
    const pts = H.map((h) => ({ d: isoOf(h.date || h.at), n: ((h.themes || h.data?.themes || []).find((x) => x.name === t.name) || {}).n })).filter((p) => p.n != null);
    if (pts.length >= 2) add({ key: `listen.trend.${slugOf(t.name)}`, n: pts[pts.length - 1].n, v: pts.map((p) => `${p.d}: ${p.n}`).join(' · '), label: `Trend of mentions for "${t.name}" across listening runs`, src: heard, url: '', at: pts[pts.length - 1].d, family: 'listening' });
  }
  // the brand's own questions in communities (mode 'asked'): replies against the threshold, and two linked replies each
  const AQ = Array.isArray(asked) ? asked : asked?.questions || asked?.asked || asked?.items || [];
  for (const q of AQ.slice(0, 8)) {
    const id = q.id || slugOf(q.question || q.text), reps = IT.filter((x) => x.mode === 'asked' && [x.askId, x.questionId, x.asked].includes(id));
    const n = q.replies ?? reps.length, need = q.threshold || 5;
    add({ key: `listen.asked.${slugOf(id)}`, n, v: `${n} replies, threshold ${need}${n >= need ? ' (met)' : ''}`, label: `Replies to the question "${String(q.question || q.text || '').slice(0, 120)}"${q.where ? ` asked in ${q.where}` : ''}`, src: 'Brew community question', url: q.url || q.link || '', at: isoOf(q.askedAt || q.at) || at, family: 'research' });
    reps.filter((x) => x.link).slice(0, 2).forEach((x, i) => add({ key: `listen.asked.${slugOf(id)}.q${i + 1}`, v: quoteOfItem(x), label: `Reply, ${who(x)}, ${isoOf(x.postedAt)}`, src: 'Brew community question', url: x.link, at: isoOf(x.postedAt) || at, family: 'research', quote: true }));
  }
  // market pulse lines, as they are
  for (const l of (Array.isArray(pulse) ? pulse : pulse?.lines || []).slice(0, 80)) if (l?.key && l.value != null && l.value !== '')
    add({ key: `pulse.${String(l.key).replace(/^pulse\./, '')}`, n: numOf(l.value), v: `${l.value}${l.unit ? ` ${l.unit}` : ''}`, label: l.label || l.key, src: srcName(l.source, 'Brew market pulse'), url: l.url || '', at: isoOf(l.at) || isoOf(pulse?.at) || td, family: l.family || 'market' });
  // video reads: the hook and structure of videos relevant to the brand
  for (const x of (videos || []).filter(Boolean).slice(0, 20)) {
    const id = x.id || slugOf(x.url), hook = x.hook?.text || x.hook?.line || x.hook, scenes = Array.isArray(x.scenes) ? x.scenes.length : null, secs = numOf(x.duration ?? x.length ?? x.secs);
    if (!hook || typeof hook !== 'string') continue;
    add({ key: `video.${slugOf(id)}`, n: numOf(x.views), v: [`Hook: "${String(hook).slice(0, 160)}"`, scenes ? `${scenes} scenes` : '', secs ? `${secs}s` : '', x.format ? String(x.format) : '', x.views != null ? `${x.views} views` : '', x.whyItWorks ? `why it works: ${String(x.whyItWorks).slice(0, 200)}` : ''].filter(Boolean).join(' · '),
      label: `Video read: ${String(x.title || x.platform || 'video').slice(0, 80)}${x.owner || x.author || x.brand ? ` by ${x.owner || x.author || x.brand}` : ''}${x.about ? ` (${x.about})` : ''}`, src: `${PLAT[x.platform] || x.platform || 'Video'} video, read by Brew`, url: x.url || '', at: isoOf(x.at || x.readAt || x.postedAt) || td, family: 'creative' });
  }
  // calendar: upcoming events in the brand's markets, with days away and the plan points
  const country = profile?.country;
  for (const e of (Array.isArray(calendar) ? calendar : calendar?.events || []).filter((e) => marketOk(e, country)).slice(0, 12)) {
    const d = evDate(e); if (!d) continue; const away = Math.round((Date.parse(d) - Date.parse(td)) / 864e5);
    const pl = e.plan || e.planPoints || e.points || [], pts = (Array.isArray(pl) ? pl.map((p) => (typeof p === 'string' ? p : `${p.what || p.point || p.kind} by ${isoOf(p.at || p.date || p.due)}`)) : Object.entries(pl).map(([k, v]) => `${k} by ${isoOf(v)}`)).slice(0, 6);
    add({ key: `cal.${slugOf(evName(e))}.${d.slice(0, 4)}`, n: away, v: `${evName(e)} on ${d}${e.end ? ` to ${isoOf(e.end)}` : ''}, ${away >= 0 ? `${away} days away` : `started ${-away} days ago`}${pts.length ? `; plan points: ${pts.join('; ')}` : ''}`, label: `Calendar event${e.kind ? ` (${e.kind})` : ''}${[].concat(e.countries || e.markets || e.country || []).length ? ` in ${[].concat(e.countries || e.markets || e.country).join(', ')}` : ''}`, src: 'Brew commerce calendar', url: e.url || '', at: td, family: 'seasonal' });
  }
  return out;
}
// the signal lines a spec gets: its capability families first; with none named, the listening and calendar lines
export function signalSlice(lines = [], caps = [], cap = 140) {
  const want = new Set(caps.length ? caps : ['listening', 'seasonal']);
  if (want.has('social-posts') || want.has('cro') || want.has('email')) want.add('listening');
  return lines.filter((l) => want.has(l.family) || (l.family === 'market' && caps.length)).slice(0, cap);
}
// read the files the signals come from: a brand pack (packs + slug) or a folder (dir); calendar.js when it exists
export async function loadSignals({ packs, slug, dir, profile, calendar } = {}) {
  const getJ = async (f) => { try { if (packs?.getJSON && slug) return await packs.getJSON(slug, f, null); if (dir) return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {} return null; };
  let base = dir || null; if (!base && packs?.dirOf && slug) { try { base = packs.dirOf(slug); } catch {} }
  const ls = (sub) => { try { return base ? fs.readdirSync(path.join(base, sub)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort() : []; } catch { return []; } };
  const [themes, items, asked, pulse, vIndex] = await Promise.all(['listen/themes.json', 'listen/items.json', 'listen/asked.json', 'pulse/latest.json', 'video/index.json'].map(getJ));
  const history = await Promise.all(ls('listen/history').slice(-6).map(async (f) => ({ date: f.replace(/\.json$/, ''), ...((await getJ(`listen/history/${f}`)) || {}) })));
  const vids = ls('video').length ? ls('video').slice(-30) : (vIndex?.ids || vIndex?.items?.map((x) => x.id || x) || []).slice(-30).map((id) => `${id}.json`);
  // video-read.js writes video/top-<date>.json ({at, reads:[{id, url, hook, format, whyItWorks}]}); one read per file works too
  const videos = (await Promise.all(vids.map((f) => getJ(`video/${f}`)))).flatMap((v) => (v?.reads ? v.reads.map((r) => ({ ...r, at: r.at || v.at })) : [v])).filter((v) => v && !v.error && (!v.slug || !slug || v.slug === slug));
  profile ||= await getJ('profile.json');
  // calendar.js: createCalendar({packs}) → { upcoming(slug, {days}), duePlanPoints(slug, day), markPlanned }; a ready object works too (tests)
  let cal = calendar; if (!cal && packs && slug) { const m = await import('./calendar.js').catch(() => null); try { cal = m?.createCalendar ? m.createCalendar({ packs, log: { warn() {} } }) : null; } catch {} }
  let events = [], due = [];
  try { events = (await cal?.upcoming?.(slug, { days: 90 })) || []; } catch {}
  try { due = (await cal?.duePlanPoints?.(slug, new Date())) || []; } catch {}
  return { themes, items, asked, pulse, history, videos, calendar: events, due, profile, calendarApi: cal || null };
}
// ---------- dynamic specs: written per brand at runtime ----------
// a festival at its plan point, a research question where the listening shows a gap, and replies that reached their threshold
const hashN = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 900; };
export async function dynamicSpecs({ slug, packs, dir, profile, calendar, signals, today: td = today() } = {}) {
  const sg = signals || await loadSignals({ packs, slug, dir, profile, calendar });
  const pr = profile || sg.profile || {}, country = pr.country, out = [], used = new Set(SPECS.map((s) => s.n));
  const nOf = (id) => { let n = 100 + hashN(id); while (used.has(n)) n = n >= 999 ? 100 : n + 1; used.add(n); return n; };
  const base = (id, o) => ({ n: nOf(id), id, dynamic: true, lookups: [], refs: [], statHint: { stat: '', statLabel: '' }, cadence: 'once', needs: [], ...o });
  // seasonal: one move per relevant event whose plan point is due
  let due = sg.due;
  if (!due?.length && calendar?.duePlanPoints) { try { due = await calendar.duePlanPoints(slug, new Date(td)); } catch { due = []; } }
  const byEv = new Map();
  // only events still ahead (a plan for one already at its peak is too late), the nearest three
  for (const p of due || []) { const e = p.event || p; if (!marketOk(e, country) || !marketOk(p, country)) continue; const d = evDate(e); if (!d || d < td) continue;
    if (byEv.size >= 3 && ![...byEv.values()].some((x) => x.e === e || evName(x.e) === evName(e))) continue; const id = `season:${e.id || `${slugOf(evName(e))}-${d.slice(0, 4)}`}`; if (!byEv.has(id)) byEv.set(id, { e, d, points: [] }); byEv.get(id).points.push(p.point || p.what || p.kind || 'plan'); }
  for (const [id, { e, d, points }] of byEv) {
    const name = evName(e), end = isoOf(e.end) || d;
    out.push(base(id, { group: 'reach', skill: 'seasonal-planning', kicker: `${String(name).toUpperCase()} PLAN`, discipline: `${name} Plan`, titleHint: `${name}: the plan, backwards from ${d}`, statHint: { stat: d.slice(5), statLabel: `${String(name).toUpperCase()} STARTS` },
      deps: [55, 7, 8, 20].filter((n) => SPECS[n]), evidence: ['catalog', 'price', 'claim', 'reviews', 'ads', 'site', 'seasonal', 'price-offer', 'weather'], exemplar: 28, exemplarAlt: 8, timing: 'seasonal', eventEnd: end, eventId: e.id || null, event: { name, date: d, end, points: [...new Set(points)] },
      adapt: `Plan ${name} (${d}${end !== d ? ` to ${end}` : ''}) for the brand, from the cal.* line for it. The plan point due now: ${[...new Set(points)].join(', ')}. Work backwards from the event date: creative ready, offer decided, stock checked against the event window, ads and messages scheduled, the day after. Use last year's same window from the ledger when it is there, else mark it "to be pulled". Measure against the same window last year.` }));
  }
  // research: question-heavy themes with no question asked yet (at most two)
  const T = Array.isArray(sg.themes) ? sg.themes : sg.themes?.themes || [], IT = Array.isArray(sg.items) ? sg.items : sg.items?.items || [];
  const AQ = Array.isArray(sg.asked) ? sg.asked : sg.asked?.questions || sg.asked?.asked || sg.asked?.items || [];
  const askedOn = new Set(AQ.map((q) => String(q.theme || '').toLowerCase()).filter(Boolean));
  const gaps = T.map((t) => ({ t, q: IT.filter((x) => x.intent === 'question' && (x.themes || []).includes(t.name)).length })).filter((g) => g.q >= 3 && !askedOn.has(String(g.t.name).toLowerCase())).sort((a, b) => b.q - a.q).slice(0, 2);
  for (const { t, q } of gaps) out.push(base(`research:${slugOf(t.name)}`, { group: 'know', skill: 'community-research', kicker: 'ASK THE COMMUNITY', discipline: `Research: ${t.name}`, titleHint: `What buyers still ask about ${t.name}`, statHint: { stat: String(q), statLabel: 'QUESTIONS HEARD ON THIS THEME' },
    deps: [2, 54].filter((n) => SPECS[n]), evidence: ['catalog', 'claim', 'reviews', 'socials', 'research', 'listening'], exemplar: 2, exemplarAlt: 44, timing: 'community', theme: t.name,
    adapt: `People asked ${q} questions about "${t.name}" (listen.theme.${slugOf(t.name)}.questions). Find what Brew still does not know about it that changes a decision, and write the one question to ask, the 2 to 4 real communities to ask it in (from the listening lines), each community's rules to check, the draft post, and the reply threshold. Say which moves the replies will become.` }));
  // replies that met their threshold become a move of their own
  for (const qq of AQ) {
    const id = qq.id || slugOf(qq.question || qq.text), n = qq.replies ?? IT.filter((x) => x.mode === 'asked' && [x.askId, x.questionId, x.asked].includes(id)).length, need = qq.threshold || 5;
    if (n < need || qq.moved) continue;
    out.push(base(`answers:${slugOf(id)}`, { group: 'know', skill: 'customer-research', kicker: 'WHAT THE COMMUNITY SAID', discipline: 'Community Answers', titleHint: `What ${n} people told us about ${String(qq.theme || qq.question || 'the question').slice(0, 40)}`, statHint: { stat: String(n), statLabel: 'REPLIES, THRESHOLD MET' },
      deps: [2, 54].filter((x) => SPECS[x]), evidence: ['catalog', 'claim', 'reviews', 'research', 'listening'], exemplar: 2, exemplarAlt: 1, timing: 'research', question: qq.question || qq.text,
      adapt: `The brand asked "${qq.question || qq.text}"${qq.where ? ` in ${qq.where}` : ''} and ${n} replies came back (listen.asked.${slugOf(id)}). Read every reply line, group them, quote the strongest with their links, and turn them into decisions: which existing moves change (name them) and the two or three new actions they lead to, each with its own metric.` }));
  }
  return out;
}

function skillText(spec) {
  const dir = path.join(ROOT, 'skills', spec.skill);
  let s = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
  for (const r of spec.refs || []) { try { s += `\n\n## Reference: ${r}\n\n` + fs.readFileSync(path.join(dir, 'references', r), 'utf8').slice(0, 14000); } catch {} }
  return s;
}
export function exemplarText(n, cap = 38000) {
  const f = fs.readdirSync(path.join(ROOT, 'sources/moves')).find((x) => x.startsWith(pad(n) + ' '));
  if (!f) return '';
  const lines = fs.readFileSync(path.join(ROOT, 'sources/moves', f), 'utf8').split('\n').map((l) => l.trim().replace(/ {3,}/g, '  '))
    .filter((l) => l && !/^BREW DEPLOYMENT TEAM ×|^Brew\s|^DEPLOYMENT TEAM$|^BREW × |^WORKING DOCUMENT|^BREW\.AI$/.test(l));
  const t = lines.join('\n');
  return t.length > cap ? t.slice(0, cap) + '\n[… trimmed]' : t;
}
const compact = (o, cap) => { const s = JSON.stringify(o); return s.length > cap ? s.slice(0, cap) + '…' : s; };
function profileSlice(p = {}) {
  const { catalog, identity, ...rest } = p;
  return compact({ ...rest, catalog: catalog && { count: catalog.count, hero: catalog.hero, collections: catalog.collections,
    products: (catalog.products || []).slice(0, 40).map((x) => ({ title: x.title, price: x.price, mrp: x.mrp, url: x.url, claims: x.claims, reviews: x.reviews })) } }, 14000);
}
const fill = (o, vars) => JSON.parse(JSON.stringify(o).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')));

// ---------- engine ----------
export function createMovesEngine({ ai, treg, log = console } = {}) {
  let DYN = []; // the brand's dynamic specs, set by runAll (or ctx.dynamicSpecs)
  const spec = (n, ctx) => SPECS.find((s) => s.n === +n) || (ctx?.dynamicSpecs || DYN).find((s) => s.n === +n);
  // the real size of this brand's playbook: the specs whose evidence exists (runAll sets it), else the core moves plus the dynamic ones
  const total = (ctx) => ctx?.total || SPECS.filter((s) => s.n && !s.needs?.length).length + (ctx?.dynamicSpecs || DYN).length;
  // where a family's number is read: treg-map's probe when it has one, else the family's own sources and method
  const probeText = (rec, sp) => { let watch = [];
    try { watch = [...new Set(capsOf(sp).flatMap((c) => probeFor?.(c) || []).filter((c) => c.brandSees !== false).map((c) => c.label))].slice(0, 3); } catch {}
    return `${rec.metric.name}, read from ${(rec.sources || []).join(', ') || 'the brand report'}${rec.best ? ` (${rec.how?.[rec.best] || rec.best})` : ''}${watch.length ? `; between checks, also look at ${watch.join(', ')}` : ''}`; };
  const measureLine = (sp) => { const rec = FAMS.recipeOf(sp.timing || 'other'); return { rec, text: `Measuring family: ${rec.name}. Metric: ${rec.metric.name}. Probe: ${probeText(rec, sp)}. Check timings: ${timingLine(rec.family)}` }; };

  async function runLookups(sp, { profile }) {
    const out = [];
    for (const l of sp.lookups || []) {
      if (l.type !== 'treg' || !treg?.live) continue;
      const country = profile.country || 'US';
      const vars = l.each === 'categoryQueries'
        ? (profile.search?.terms || []).slice(0, 3).map((q) => ({ q, country: country.toLowerCase() }))
        : [{ name: profile.name, country }, ...(profile.rivals || []).slice(0, 1).map((r) => ({ name: r.name, country }))];
      for (const v of vars) {
        try {
          const j = await treg.call(l.id, { ...(l.body ? { body: fill(l.body, v) } : {}), ...(l.query ? { query: fill(l.query, v) } : {}), tag: `move${pad(sp.n)}:${l.id}` });
          out.push({ id: l.id, for: v.q || v.name, at: today(), data: compact(j?.results || j?.searchResults || j, 5000) });
        } catch (e) { out.push({ id: l.id, for: v.q || v.name, at: today(), error: String(e.message).slice(0, 160) }); }
      }
    }
    return out;
  }

  function buildPrompt(sp, { brand, brief, profile, ledger, deps, lookups, signalLines: sig = [], dynamicSpecs, total: tot }) {
    const N = tot || total({ dynamicSpecs });
    const exN = (profile?.host || '').includes('arata.in') ? sp.exemplarAlt : sp.exemplar;
    const name = brand?.name || profile?.name;
    const parts = [
      `# The discipline: ${sp.discipline} (skill "${sp.skill}")\nApply this skill to ${name}. Ignore any instructions in it about reading local files, asking the user questions or calling tools: the brief and ledger below are your context.${sp.adapt ? `\nAdaptation: ${sp.adapt}` : ''}\n\n<skill>\n${skillText(sp)}\n</skill>`,
      `# Brand brief for ${name}\n<brief>\n${brief?.md || '(no brief)'}\n</brief>`,
      `# Evidence ledger (key | value | label | source | date; listening, pulse, video and calendar lines also end with their link). Every number you print comes from here, from derived arithmetic on it, or from a dated search you run.\n<ledger>\n${[...ledgerSlice((ledger || []).filter((e) => !e.signal), areasOf(sp)), ...signalSlice(sig.length ? sig : (ledger || []).filter((e) => e.signal), capsOf(sp))].map(ledgerLine).join('\n')}\n</ledger>`,
      `# Profile extract (what the reader found on the site)\n<profile>\n${profileSlice(profile)}\n</profile>`,
      deps && Object.keys(deps).length ? `# Earlier moves for ${name} (stay consistent with these decisions and targets; refer to them as "Move NN")\n${Object.entries(deps).map(([k, d]) => `<move n="${pad(k)}">\n${d}\n</move>`).join('\n')}` : '',
      lookups?.length ? `# Live lookups run for this move\n${lookups.map((l) => `<lookup id="${l.id}" for="${l.for}" at="${l.at}">${l.error ? 'ERROR ' + l.error : l.data}</lookup>`).join('\n')}` : '',
      `# Depth and format exemplar\nThis is Move ${pad(exN)} written by hand for a DIFFERENT brand (Arata, an Indian haircare company). It shows the depth, density, table use, voice and finish we expect. Do not copy its facts, numbers, names, rivals or products into ${name}'s document unless the same fact is in ${name}'s ledger.\n<exemplar>\n${exemplarText(exN)}\n</exemplar>`,
      `# Your task\nWrite Move ${pad(sp.n)} of ${N} for ${name}${profile?.host ? ` (${profile.host})` : ''}: discipline "${sp.discipline}", group "${sp.group}".\nKicker (fixed): ${sp.kicker} · MOVE ${pad(sp.n)} OF ${N}\n${measureLine(sp).text}\nTitle: write one specific to ${name}'s situation. For scale, the Arata title for this move was "${sp.titleHint}" with the stat "${sp.statHint?.stat}" / "${sp.statHint?.statLabel}". Do not reuse those.\nDate of this snapshot: ${today()}. Country: ${profile?.country || 'unknown'}. Currency: ${profile?.currency || 'unknown'}.\n${(sp.lookups || []).filter((l) => l.type === 'web').map((l) => `Search the web for: ${l.q}. Date each fact you use and list it in newFacts with the exact quote.`).join('\n')}\nFollow the house template section by section. Return the JSON object only.`];
    // three cacheable blocks: brand context (shared by all moves of a brand), discipline material, the task
    const [skill, briefP, ledgerP, profileP, depsP, lookupsP, exP, task] = parts;
    return [[briefP, ledgerP, profileP], [skill, exP, depsP, lookupsP], [task]].map((g) => g.filter(Boolean).join('\n\n'));
  }

  // strip stray reference markers ("… 84 days [35]") the model sometimes leaves inside finished assets
  const clean = (o) => typeof o === 'string' ? o.replace(/[ \t]?\[\d{1,3}(?:,\s?\d{1,3})*\](?!\()/g, '')
    : Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : o;
  function finish(sp, raw, extra, ctx) {
    if (raw?.sections) raw = { ...raw, sections: clean(raw.sections) };
    return { n: sp.n, group: sp.group, skill: sp.skill, kicker: `${sp.kicker} · MOVE ${pad(sp.n)} OF ${total(ctx)}`, timing: sp.timing || null, ...(sp.dynamic ? { dynamic: sp.id } : {}), ...raw, ...extra };
  }

  async function writeMove(n, ctx) {
    const sp = spec(n, ctx); if (!sp || !sp.n) throw new Error(`no spec for move ${n}`);
    const t0 = Date.now();
    try {
      const lookups = await runLookups(sp, ctx);
      const blocks = buildPrompt(sp, { ...ctx, lookups });
      const prompt = blocks.join('\n\n');
      const webs = (sp.lookups || []).filter((l) => l.type === 'web').length;
      // search re-bills the whole context on every server-tool turn, so it is capped (ctx.search: number | 0)
      const searchN = webs ? Math.min(ctx.search ?? 3, 3 + webs) : 0;
      const cache = { type: 'ephemeral' };
      const messages = [{ role: 'user', content: blocks.map((text, i) => ({ type: 'text', text, ...(i < 2 ? { cache_control: cache } : {}) })) }];
      const o = { model: 'opus', effort: ctx.effort || 'high', system: [{ type: 'text', text: SYSTEM, cache_control: cache }], messages, schema: MOVE_SCHEMA, max: 120000, tag: `move${pad(n)}`, // thinking counts toward this; 64k cut some moves off
        ...(searchN ? { search: searchN, location: ctx.profile?.country } : {}) };
      let r;
      try { r = await ai.call(o); }
      catch (e) {
        // ran out of room (max_tokens): once more, a little tighter, rather than losing the move
        if (/max_tokens/.test(String(e.message))) { log.warn?.(`[moves] ${n}: hit max_tokens, retrying at medium effort`); r = await ai.call({ ...o, effort: 'medium', tag: `move${pad(n)}-retry`, messages: [...o.messages.slice(0, -1), { ...o.messages[o.messages.length - 1], content: [].concat(o.messages[o.messages.length - 1].content, [{ type: 'text', text: 'Keep the body within 7,000 words so the whole document fits in one reply.' }]) }] }); }
        else {
        if (e.mock || !/schema|format|400/i.test(String(e.message))) throw e;
        log.warn?.(`[moves] ${n}: structured output rejected (${String(e.message).slice(0, 120)}), retrying as plain JSON`);
        r = await ai.call({ ...o, schema: null, json: true, messages: undefined, prompt: prompt + `\n\nReturn one JSON object with this shape:\n${JSON.stringify(MOVE_SCHEMA)}` });
        }
      }
      const move = finish(sp, r.json, { meta: { model: 'claude-opus-5-5', at: new Date().toISOString(), usd: r.usd, usage: r.msg?.usage, secs: Math.round((Date.now() - t0) / 1e3), stop: r.stop, verified: false, issues: [], cites: r.cites || [], lookups: lookups.map(({ id, for: f, at, error }) => ({ id, for: f, at, error })) } }, ctx);
      return move;
    } catch (e) {
      if (!e.mock) throw e;
      return mockMove(sp, ctx);
    }
  }

  function mockMove(sp, ctx) {
    const name = ctx.brand?.name || ctx.profile?.name || 'the brand', B = name.toUpperCase(), ml = measureLine(sp);
    const p = (text) => ({ t: 'p', text, items: [], ordered: false, head: [], rows: [], caption: '', title: '', label: '', body: '' });
    const tbl = (head, rows) => ({ ...p(''), t: 'table', head, rows });
    return finish(sp, {
      title: `[MOCK] ${sp.discipline} for ${name}`, stat: `${sp.n} of ${total(ctx)}`, statLabel: 'MOCK MOVE, NOT WRITTEN', gives: `[MOCK] Placeholder for the ${sp.discipline.toLowerCase()} move. AI was off, so nothing here is real.`,
      live: '[MOCK] Nothing is live. Run again with AI on.',
      sections: [
        { h: `Why this matters for ${name}`, kind: 'why', blocks: [p(`[MOCK] This placeholder stands in for the ${sp.skill} move. What follows: placeholder sections only.`)] },
        { h: 'What we found', kind: 'found', blocks: [p('[MOCK] No findings: AI was off.'), { ...p(''), t: 'diagram', text: '[MOCK]\n┌──────┐\n│ mock │\n└──────┘' }] },
        { h: 'The plan', kind: 'plan', blocks: [p('[MOCK] No plan.')] },
        { h: 'Worked examples', kind: 'examples', blocks: [{ ...p(''), t: 'example', title: 'EXAMPLE 1: [MOCK]', label: 'mock', body: '[MOCK] No asset.' }] },
        { h: '30-day deployment', kind: 'plan', blocks: [tbl(['WEEK', 'BREW DRAFTS', `${B} PROVIDES`, 'LIVE BY END OF WEEK'], [1, 2, 3, 4].map((w) => [String(w), '[MOCK]', '[MOCK]', '[MOCK]']))] },
        { h: 'How we measure', kind: 'measure', blocks: [tbl(['METRIC', 'BASELINE', '90-DAY TARGET', 'DECISION RULE'], [[ml.rec.metric.name, 'To be instrumented', '[MOCK]', '[MOCK]']]),
          p(`${ml.text.replace(/^.*?Check timings: /, `Check timings: probe ${probeText(ml.rec, sp)}. `)}`),
          p(`What to watch: ${(ctx.signalLines || []).filter((l) => !l.quote && capsOf(sp).includes(l.family)).slice(0, 4).map((l) => l.key).join(', ') || '[MOCK] the listening and pulse lines for this move, once they exist'}.`)] },
        { h: 'Appendix', kind: 'appendix', blocks: [p('[MOCK]')] },
        { h: 'Sources', kind: 'sources', blocks: [{ ...p(''), t: 'list', items: ['[MOCK] none'] }] }],
      sources: [], factsUsed: [], derived: [], newFacts: [], toConfirm: ['Everything: this is a mock move.'] },
    { meta: { model: 'mock', mock: true, at: new Date().toISOString(), usd: 0, verified: false, issues: [] } }, ctx);
  }

  // ---------- verify ----------
  function allowedFor(move, ledger, depDigests = {}) {
    const allowed = allowedFromLedger(ledger, Object.values(depDigests));
    const citeUrls = (move.meta?.cites || []).map((c) => c.url);
    const citeQuotes = (move.meta?.cites || []).map((c) => `${c.title || ''} ${c.quote || ''}`).join(' ');
    const rejected = [];
    for (const f of move.newFacts || []) {
      const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
      const urlOk = f.url && citeUrls.some((u) => u === f.url || host(u) === host(f.url));
      const ns = numbersIn(f.v).length ? numbersIn(f.v) : rawNums(f.v).map((v) => ({ v, scaled: null }));
      const quoteOk = f.quote && ns.every((x) => rawNums(f.quote).some((y) => close(x.v, y)));
      if (urlOk && quoteOk) ns.forEach((x) => { allowed.add(x.v); if (x.scaled) allowed.add(x.scaled); }); else rejected.push(f);
    }
    for (const x of rawNums(citeQuotes)) allowed.add(x); // numbers the search results really contained
    for (let pass = 0; pass < 2; pass++) for (const d of move.derived || []) {
      const r = evalExpr(d.expr, allowed); const vs = numbersIn(d.v).length ? numbersIn(d.v) : rawNums(d.v).map((v) => ({ v }));
      if (r != null && vs.length && vs.every((x) => Math.abs(x.v - r) <= Math.max(1, Math.abs(r) * 0.02) || Math.abs((x.scaled ?? x.v) - r) <= Math.abs(r) * 0.02)) vs.forEach((x) => allowed.add(x.v));
    }
    return { allowed, rejected };
  }

  const flatText = (move) => [...walk(move)].map((x) => `[${x.at}.${x.field}] ${x.text}`).join('\n');

  async function claimCheck(move, brief, ledger) {
    const r = await ai.call({ model: 'sonnet', effort: 'low', max: 6000, tag: `verify${pad(move.n)}`,
      system: 'You are the Brew fact checker. You compare a strategy document against the evidence and list only real problems. Be precise and brief.',
      prompt: `Evidence: the brand brief and ledger.\n<brief>\n${brief?.md || ''}\n</brief>\n<ledger>\n${ledger.map(ledgerLine).join('\n')}\n</ledger>\n\nDocument (each line is [address] text):\n<doc>\n${flatText(move).slice(0, 120000)}\n</doc>\n\nList problems of these kinds only:\n- fact: a non-numeric factual claim about the brand or a rival (names, founders, products, features, policies, channels, events) that the evidence does not support and that is not labelled inferred, assumption, hypothesis, proposed or to confirm\n- quote: text presented as a real customer quote or review that is not in the evidence (dramatised scripts that say so are fine)\n- motive: states why a rival does something\n- absent: says a rival lacks something instead of "not observed"\n- disclaimer: an ad asset carrying "illustrative", "AI-generated" or similar labels\nIgnore numbers (checked elsewhere), plans, targets, recommendations and the brand's own proposed copy. Return at most 15 problems, most serious first.`,
      schema: { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { at: S, kind: S, quote: S, problem: S } } } } } });
    return r.json.issues || [];
  }

  async function fixCall(move, issues) {
    const blocks = [...new Set(issues.map((i) => i.at))].map((at) => {
      if (at === 'stat') return `[stat] ${move.stat} / ${move.statLabel}`;
      const [, i, j] = at.match(/s(\d+)\.b(\d+)/) || []; return `[${at}] ${JSON.stringify(move.sections?.[i]?.blocks?.[j])}`;
    });
    const r = await ai.call({ model: 'opus', effort: 'medium', max: 12000, tag: `fix${pad(move.n)}`,
      system: 'You fix flagged sentences in a Brew strategy document. Change only what is flagged. Keep the voice. A number that is not backed becomes a labelled target or assumption only if it is a plan number; a fact you cannot back is written "to confirm" (keep the sentence readable). Never add new numbers.',
      prompt: `Flagged problems:\n${issues.map((i) => `- [${i.at}] ${i.raw ? `number "${i.raw}" in: "${i.sentence}"` : `"${i.quote}"`}: ${i.problem || i.why}`).join('\n')}\n\nThe blocks they sit in:\n${blocks.join('\n')}\n\nReturn edits: for each, the block address, the exact text to find (verbatim from the block, short but unique) and its replacement.`,
      schema: { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { at: S, find: S, replace: S } } } } } });
    return r.json.edits || [];
  }

  function applyEdits(move, edits) {
    let applied = 0;
    for (const e of edits) {
      if (!e.find) continue;
      if (e.at === 'stat') { if (move.stat.includes(e.find)) { move.stat = move.stat.replace(e.find, e.replace); applied++; } continue; }
      const [, i, j] = e.at.match(/s(\d+)\.b(\d+)/) || []; const b = move.sections?.[i]?.blocks?.[j]; if (!b) continue;
      for (const x of walk({ sections: [{ kind: '', blocks: [b] }] })) {
        if (typeof x.text === 'string' && x.text.includes(e.find)) { setField(b, x.field, x.text.replace(e.find, e.replace)); applied++; break; }
      }
    }
    return applied;
  }

  // → { ok, issues, move }
  async function verify(move, ledger, { brief, deps = {}, fix = true } = {}) {
    if (move.meta?.mock) return { ok: true, issues: [], move };
    const { allowed, rejected } = allowedFor(move, ledger, deps);
    let numIssues = scanNumbers(move, allowed);
    let claimIssues = [], claimRan = false;
    try { claimIssues = await claimCheck(move, brief, ledger); claimRan = true; } catch (e) { if (!e.mock) log.warn?.(`[verify] claim check failed: ${e.message}`); }
    const found = { numbers: numIssues.length, claims: claimIssues.length, rejectedNewFacts: rejected.length };
    let edits = 0;
    if (fix && numIssues.length + claimIssues.length) {
      try { edits = applyEdits(move, await fixCall(move, [...numIssues, ...claimIssues.map((c) => ({ ...c, problem: `${c.kind}: ${c.problem}` }))])); }
      catch (e) { if (!e.mock) log.warn?.(`[verify] fix failed: ${e.message}`); }
      numIssues = scanNumbers(move, allowed);
      /* the fixed text is checked again: a claim problem only counts as solved when the checker no longer finds it */
      if (claimRan && claimIssues.length && edits) { try { claimIssues = await claimCheck(move, brief, ledger); } catch (e) { claimRan = false; if (!e.mock) log.warn?.(`[verify] claim re-check failed: ${e.message}`); } }
    }
    // anything still unbacked becomes "to confirm"
    for (const i of numIssues) {
      if (i.at === 'stat') continue;
      const [, si, bj] = i.at.match(/s(\d+)\.b(\d+)/) || []; const b = move.sections?.[si]?.blocks?.[bj]; if (!b) continue;
      const t = getField(b, i.field); if (typeof t === 'string' && t.includes(i.raw)) setField(b, i.field, t.replace(i.raw, `${i.raw} (to confirm)`));
      (move.toConfirm ||= []).push(`${i.raw}: ${i.sentence.slice(0, 140)}`);
    }
    const remaining = numIssues.length;
    const statUnbacked = numIssues.some((i) => i.at === 'stat');
    /* verified means checked and clean: the claim check ran and found nothing left, and the cover stat is backed
       (numbers the ledger does not back are labelled "to confirm" in the text, which is allowed) */
    const verified = claimRan && claimIssues.length === 0 && !statUnbacked;
    move.meta = { ...move.meta, verified, verify: { ...found, claimRan, claimsLeft: claimIssues.length, edits, unresolvedNumbers: remaining, statUnbacked, at: new Date().toISOString() },
      issues: [...numIssues.map((i) => `${i.at} ${i.raw}: ${i.why}`), ...claimIssues.map((c) => `${c.at} ${c.kind}: ${c.problem}`)] };
    return { ok: verified && found.numbers === 0, issues: move.meta.issues, move };
  }

  // ---------- digest ----------
  function digest(move) {
    if (!move) return '';
    const sec = (k) => (move.sections || []).filter((s) => s.kind === k);
    const take = [];
    for (const s of sec('found')) for (const b of s.blocks) if (b.t === 'list' && b.ordered) take.push(...b.items.slice(0, 6));
    const plan = [];
    for (const s of sec('plan')) for (const [i, b] of s.blocks.entries()) if (b.t === 'h3') { const nx = s.blocks[i + 1]; if (nx?.t === 'p') plan.push(`${b.text}: ${nx.text.split(/(?<=\.)\s/).slice(0, 2).join(' ')}`); }
    const targets = [];
    for (const s of sec('measure')) for (const b of s.blocks) if (b.t === 'table') for (const r of b.rows) targets.push(`${r[0]}: baseline ${r[1]}, target ${r[2]}`);
    return [`Move ${pad(move.n)} · ${move.kicker} · ${move.title}`, `Stat: ${move.stat} (${move.statLabel})`, `Gives: ${move.gives}`, `Live at day 30: ${move.live}`,
      take.length ? `Key takeaways:\n- ${take.join('\n- ')}` : '', plan.length ? `Plan:\n- ${plan.slice(0, 6).join('\n- ')}` : '', targets.length ? `Targets:\n- ${targets.slice(0, 8).join('\n- ')}` : '']
      .filter(Boolean).join('\n').slice(0, 4000);
  }

  // ---------- Move 00 ----------
  async function writeIndex(moves, ctx) {
    const name = ctx.brand?.name || ctx.profile?.name || 'the brand', B = name.toUpperCase();
    const list = [...SPECS.filter((s) => s.n), ...(ctx.dynamicSpecs || DYN)].map((s) => ({ s, m: moves[s.n] })).filter((x) => x.m || (ctx.applicable ? ctx.applicable.includes(x.s.n) : !x.s.needs?.length));
    const N = list.length, Nw = numWord(N);
    let ov = null;
    try {
      const r = await ai.call({ model: 'opus', effort: 'medium', max: 8000, tag: 'move00', system: SYSTEM,
        prompt: `Write the overview for Move 00, the index of ${Nw} moves for ${name}.\n<brief>\n${ctx.brief?.md || ''}\n</brief>\nThe moves written so far:\n${list.filter((x) => x.m).map((x) => `${pad(x.s.n)} ${x.m.title} | ${x.m.stat} ${x.m.statLabel} | ${x.m.gives}`).join('\n')}\n\nReturn: thread (one or two sentences naming the one idea or number that runs through all the moves for ${name}, from the evidence), today (3 to 4 sentences: "${name} today:" then the sharpest facts from the brief with numbers, ending in what the ${Nw} moves are), live (one sentence: what is live at day 30), boxes (six short 3-4 line labels, one per group, for the end-to-end diagram, each line under 15 characters, specific to ${name}). Only numbers from the brief.`,
        schema: { type: 'object', properties: { thread: S, today: S, live: S, boxes: { type: 'array', items: { type: 'array', items: S } } } } });
      ov = r.json;
    } catch (e) { if (!e.mock) log.warn?.(`[index] overview failed: ${e.message}`); }
    const p = (text) => ({ t: 'p', text, items: [], ordered: false, head: [], rows: [], caption: '', title: '', label: '', body: '' });
    const counts = GROUPS.map(([g]) => list.filter((x) => x.s.group === g).length);
    const boxes = ov?.boxes?.length === 6 ? ov.boxes : GROUPS.map(([g]) => list.filter((x) => x.s.group === g).slice(0, 4).map((x) => x.s.skill.slice(0, 14)));
    const W = 11, box = (i, r) => (boxes[i][r] || '').slice(0, W).padEnd(W);
    const diagram = [GROUPS.map((g) => g[1].slice(0, W + 2).padEnd(W + 4)).join(' '), GROUPS.map(() => '┌' + '─'.repeat(W + 2) + '┐').join('  '),
      ...[0, 1, 2, 3].map((r) => GROUPS.map((_, i) => `│ ${box(i, r)} │`).join(r === 1 ? '─>' : '  ')), GROUPS.map(() => '└' + '─'.repeat(W + 2) + '┘').join('  '),
      GROUPS.map((_, i) => `${counts[i]} moves`.padEnd(W + 4)).join(' ')].join('\n');
    const sections = [
      { h: 'What this is', kind: 'other', blocks: [p(`${cap1(Nw)} working documents from the Brew deployment team, one per marketing discipline or signal, every one built on ${name}'s real catalogue, prices, claims, customers, competitors and what people say about it. New moves are added as Brew hears new things. Read this index, then open the move you want to see.`)] },
      { h: 'How to read it', kind: 'other', blocks: [p(`The six groups follow a customer from first search to repeat order. Each document ends with a 30-day deployment table and the metric we are held to.`)] },
      { h: 'The end to end', kind: 'other', blocks: [{ ...p(''), t: 'diagram', text: diagram }, ...(ov ? [p(ov.thread), p(ov.today)] : [])] },
      ...GROUPS.map(([g, h, sub], gi) => ({ h, kind: 'other', blocks: [p(`**${sub} · ${counts[gi]} MOVES**`), { ...p(''), t: 'table', head: ['#', 'MOVE', 'WHAT IT GIVES', 'STAT'],
        rows: list.filter((x) => x.s.group === g).map((x) => x.m ? [pad(x.s.n), x.m.title, x.m.gives, `${x.m.stat} · ${x.m.statLabel}`] : [pad(x.s.n), `${x.s.discipline} (in progress)`, 'Being written.', '']) }] })),
      { h: 'What is live', kind: 'other', blocks: [{ ...p(''), t: 'callout', title: 'DAY 30', text: ov?.live || `The first ten moves are live for ${name}.` }] }];
    const done = list.filter((x) => x.m).length;
    return { n: 0, group: 'index', skill: null, kicker: 'THE PLAYBOOK · INDEX', title: `${cap1(Nw)} moves for ${name}`, stat: String(N), statLabel: 'MOVES, ONE BRAND',
      gives: `Every marketing discipline, run for ${name}, end to end, by one team.`, live: ov?.live || '', sections, sources: [], factsUsed: [], toConfirm: [],
      meta: { model: ov ? 'claude-opus-5-5' : 'deterministic', at: new Date().toISOString(), provisional: done < N, written: done, total: N, verified: false, issues: [] } };
  }

  // ---------- scheduler ----------
  // ctx: { brand, brief, profile, ledger, save(n, move), load(n) → move|null, effort? }
  // ctx.signals / ctx.signalLines / ctx.dynamicSpecs may be given; else they are read from ctx.packs + ctx.slug (or ctx.dir)
  async function prepare(ctx, { dynamic = true } = {}) {
    let signals = ctx.signals || null;
    if (!signals && !ctx.signalLines && (ctx.packs || ctx.dir)) signals = await loadSignals({ packs: ctx.packs, slug: ctx.slug, dir: ctx.dir, profile: ctx.profile, calendar: ctx.calendar }).catch((e) => { log.warn?.(`[moves] signals: ${e.message}`); return null; });
    const signalLines = ctx.signalLines || (signals ? signalLedger({ ...signals, profile: ctx.profile || signals.profile }) : []);
    const dynamicSpecsL = ctx.dynamicSpecs || (dynamic && signals ? await dynamicSpecs({ slug: ctx.slug, profile: ctx.profile, calendar: ctx.calendar, signals }).catch((e) => { log.warn?.(`[moves] dynamic specs: ${e.message}`); return []; }) : []);
    DYN = dynamicSpecsL;
    return { ...ctx, calendarApi: ctx.calendarApi || signals?.calendarApi || ctx.calendar || null, signalLines, dynamicSpecs: dynamicSpecsL, ledgerAll: [...(ctx.ledger || []).filter((e) => !e.signal), ...signalLines] };
  }
  // a listening-era spec waits for its evidence: needs ['listening'] is met by listen lines, ['any'] by any signal line
  const NEED_AREA = { 'ai-seo': ['ai.'], seo: ['search.'], 'price-offer': ['price.', 'rival.'] };
  const needsMet = (s, c) => !s.needs?.length || s.needs.some((k) => (k === 'any' ? c.signalLines.length > 0 : c.signalLines.some((l) => l.family === k) || (k === 'ai-seo' || k === 'seo' ? (c.ledger || []).some((e) => (NEED_AREA[k] || []).some((p) => e.key?.startsWith(p))) : false)));
  async function runAll(ctx0, { onMove, concurrency = 6, only, waveA = [1, 2, 3, 9, 10, 4, 5, 6, 7, 8], verify: doVerify = true, dynamic = true } = {}) {
    if (!ctx0.brief?.md) throw new Error('runAll needs ctx.brief (write the brief first)');
    const ctx = await prepare(ctx0, { dynamic });
    const specs = [...SPECS.filter((s) => s.n), ...ctx.dynamicSpecs];
    const done = {};
    /* a cadence move (moves-cadence.js) written under a spec's number before cadence moved to 1001+ is not that spec's
       move: it does not count as done and is never overwritten (its slot frees when its family's next run retires it) */
    const occupied = new Set();
    for (const s of specs) { const m = ctx.load?.(s.n); if (m?.meta?.cadence) { occupied.add(s.n); continue; } if (m && !m.meta?.mock) done[s.n] = m; }
    const all = specs.filter((s) => needsMet(s, ctx) || done[s.n] || only?.includes(s.n)).map((s) => s.n);
    ctx.applicable = all; ctx.total = all.length;
    const want = (only?.length ? only.filter((n) => n !== 0) : all).filter((n) => !occupied.has(n) && (!done[n] || only?.includes(n)));
    const A = want.filter((n) => waveA.includes(n)).sort((a, b) => waveA.indexOf(a) - waveA.indexOf(b));
    const Bw = want.filter((n) => !waveA.includes(n));
    const results = {};
    const one = async (n) => {
      if (ctx.canSpend && !ctx.canSpend()) throw new Error('budget reached, not started');
      const sp = spec(n, ctx); const deps = {};
      for (const d of sp.deps || []) if (done[d]) deps[d] = digest(done[d]);
      const t0 = Date.now(); ctx.onStart?.(n);
      let move; try { move = await writeMove(n, { ...ctx, deps }); } catch (e) { ctx.onFail?.(n, e); throw e; }
      if (doVerify) ({ move } = await verify(move, ctx.ledgerAll, { brief: ctx.brief, deps }));
      move.meta.secs = Math.round((Date.now() - t0) / 1e3); if (sp.eventId) move.meta.eventId = sp.eventId; if (sp.timing) move.meta.timing = sp.timing;
      done[n] = move; results[n] = move; await ctx.save?.(n, move); onMove?.(n, move);
      // a festival move written at its plan point: the calendar stops offering that point again
      if (sp.eventId && !move.meta?.mock && ctx.calendarApi?.markPlanned) for (const pt of sp.event?.points || []) await ctx.calendarApi.markPlanned(ctx.slug, sp.eventId, pt).catch(() => {});
    };
    const wave = async (ns) => {
      const pending = new Set(ns), running = new Map(); const errors = [];
      const ready = (n) => (spec(n, ctx).deps || []).every((d) => !pending.has(d) && !running.has(d));
      while (pending.size || running.size) {
        for (const n of [...pending]) {
          if (running.size >= concurrency) break;
          if (!ready(n)) continue;
          pending.delete(n);
          running.set(n, one(n).catch((e) => { errors.push({ n, error: e.message }); log.error?.(`[moves] ${n} failed: ${e.message}`); }).finally(() => running.delete(n)));
        }
        if (!running.size && pending.size) { // deps outside this run: release the lowest
          const n = Math.min(...pending); pending.delete(n); running.set(n, one(n).catch((e) => errors.push({ n, error: e.message })).finally(() => running.delete(n)));
        }
        if (running.size) await Promise.race(running.values());
      }
      return errors;
    };
    const errors = [...await wave(A)];
    const indexWanted = !only?.length || only.includes(0);
    if (indexWanted && A.length) { const idx = await writeIndex(done, ctx); await ctx.save?.(0, idx); onMove?.(0, idx); }
    errors.push(...await wave(Bw));
    if (indexWanted) { const idx = await writeIndex(done, ctx); await ctx.save?.(0, idx); onMove?.(0, idx); results[0] = idx; }
    return { moves: results, errors };
  }

  return { writeMove, verify, digest, writeIndex, runAll, prepare, needsMet, total, checkNumbers: (move, ledger, deps = {}) => scanNumbers(move, allowedFor(move, ledger, deps).allowed), buildPrompt: (n, ctx) => buildPrompt(spec(n, ctx), ctx).join('\n\n'), spec };
}
