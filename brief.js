// Brand brief: the condensed, sourced view of one brand that every move writes from (the "brand brief"
// the hand-made moves cite). Opus turns profile + ledger into structured JSON; the markdown is rendered here,
// so every number carries its ledger key as [k:key] and every unknown says "to confirm".
import { numbersIn, allowedFromLedger } from './moves-engine.js';

const S = { type: 'string' }, A = (items) => ({ type: 'array', items });
const O = (properties) => ({ type: 'object', properties });
const KS = S; // ledger keys backing a line, comma-separated (strings keep the compiled grammar small)
// Tables are arrays of string rows (positional columns below): a flat schema keeps the compiled grammar small.
export const COLS = {
  catalogue: ['name', 'price', 'mrp', 'note', 'k'], claims: ['product', 'claim', 'basis', 'k'], platforms: ['name', 'count', 'rating', 'k'],
  quotes: ['text', 'src', 'theme'], channels: ['channel', 'evidence', 'k'], company: ['fact', 'value', 'src', 'k'],
  personas: ['name', 'who', 'job', 'triggers', 'objections', 'basedOn'], objections: ['objection', 'basedOn', 'answerFromEvidence'],
  rivals: ['name', 'host', 'oneLiner', 'prices', 'k'], gaps: ['gap', 'evidence'] };
const T = A(A(S));
export const BRIEF_SCHEMA = O({ name: S, descriptor: S, oneLine: S, businessModel: S, reviewSummary: S, goal: S, goalKeys: S,
  language: A(S), praise: A(S), complaints: A(S), toConfirm: A(S), ...Object.fromEntries(Object.keys(COLS).map((k) => [k, T])) });
const objRows = (b) => { const o = { ...b }; for (const [k, cols] of Object.entries(COLS)) o[k] = (b[k] || []).map((r) => Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ''])) : r); return o; };

const SYSTEM = () => `You write the Brew brand brief: the one-page evidence file every strategy document for this brand is written from.
Rules (absolute):
- Use only the profile and ledger. Every number you print is copied exactly from a ledger value, and its ledger key goes in that row's k column (comma-separated if several).\n- Table fields are arrays of rows; each row is an array of strings in this column order: ${Object.entries(COLS).map(([k, c]) => `${k}: [${c.join(', ')}]`).join('; ')}.
- Customer quotes are copied exactly from profile.reviews.quotes (spelling and all). If there are none, the quotes array is empty and reviews.summary says "No review text found".
- Founders, funding, revenue, customer counts and the business goal appear only if the ledger or profile has them with a source. Otherwise put the question in toConfirm. The goal is "to confirm" unless it is public or brand-confirmed.
- Personas and objections are inferred: name them by concern (e.g. "The hair-fall switcher"), say what each is based on (reviews, FAQ, product claims, rival set). Use personas the profile already lists if present. Never invent ages, cities or life stories that are not in the evidence.
- Rival one-liners describe what the rival's own site or listing shows, never why. "Not observed" never becomes "absent".
- Keep claims verbatim with "up to", time window and study type.
- Plain, short sentences. No em dashes.`;

const keys = (k) => (Array.isArray(k) ? k : String(k || '').split(/[,\s]+/)).filter(Boolean).map((x) => `[k:${x}]`).join('');
function render(b, at) {
  b = { ...b, reviews: { summary: b.reviewSummary, platforms: b.platforms, quotes: b.quotes, language: b.language || [], praise: b.praise || [], complaints: b.complaints || [] }, goal: { text: b.goal, k: b.goalKeys } };
  const L = [];
  const row = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`;
  L.push(`# ${b.name} brand brief`, '', `${b.descriptor ? `**${b.descriptor.replace(/\.$/, '')}.** ` : ''}${b.oneLine}`, '', `Snapshot: ${at}. Business model: ${b.businessModel}`, '');
  L.push('## Catalogue and prices', '', row(['Product', 'Price', 'MRP', 'Note', 'Source']), row(['---', '---', '---', '---', '---']));
  for (const p of b.catalogue) L.push(row([p.name, p.price, p.mrp, p.note, keys(p.k)]));
  L.push('', '## Claims ledger (exact claims printed by the brand)', '', row(['Product', 'Claim', 'Basis', 'Source']), row(['---', '---', '---', '---']));
  for (const c of b.claims) L.push(row([c.product, c.claim, c.basis, keys(c.k)]));
  L.push('', '## Reviews and customer language', '', b.reviews.summary, '');
  for (const p of b.reviews.platforms) L.push(`- ${p.name}: ${p.count || 'count to confirm'}${p.rating ? `, ${p.rating}` : ''} ${keys(p.k)}`);
  if (b.reviews.quotes.length) { L.push('', 'Verbatims (real, unedited):'); for (const q of b.reviews.quotes) L.push(`- "${q.text}" (${q.src}${q.theme ? `; ${q.theme}` : ''})`); }
  if (b.reviews.language.length) L.push('', `Words customers use: ${b.reviews.language.join(', ')}`);
  if (b.reviews.praise.length) L.push(`Praise clusters: ${b.reviews.praise.join('; ')}`);
  if (b.reviews.complaints.length) L.push(`Complaint clusters: ${b.reviews.complaints.join('; ')}`);
  L.push('', '## Channels seen', ''); for (const c of b.channels) L.push(`- **${c.channel}**: ${c.evidence} ${keys(c.k)}`);
  L.push('', '## Company facts', ''); for (const c of b.company) L.push(`- ${c.fact}: ${c.value} (${c.src}) ${keys(c.k)}`);
  L.push('', '## Goal', '', `${b.goal.text} ${keys(b.goal.k)}`);
  L.push('', '## Personas (inferred, not researched)', '');
  for (const p of b.personas) L.push(`- **${p.name}**: ${p.who}. Job: ${p.job}. Triggers: ${p.triggers}. Objections: ${p.objections}. Based on: ${p.basedOn}.`);
  L.push('', '## Objections (inferred from reviews, FAQ and rivals)', '', row(['Objection', 'Based on', 'Answer from the evidence']), row(['---', '---', '---']));
  for (const o of b.objections) L.push(row([o.objection, o.basedOn, o.answerFromEvidence]));
  L.push('', '## Rivals', '', row(['Rival', 'Site', 'What their own pages show', 'Prices', 'Source']), row(['---', '---', '---', '---', '---']));
  for (const r of b.rivals) L.push(row([r.name, r.host, r.oneLiner, r.prices, keys(r.k)]));
  L.push('', '## Known gaps', ''); for (const g of b.gaps) L.push(`- ${g.gap} (${g.evidence})`);
  L.push('', '## To confirm', ''); for (const t of b.toConfirm) L.push(`- ${t}`);
  return L.join('\n') + '\n';
}

// keep only quotes that really exist; mark numbers the ledger does not back
/* a quote is real when it is an excerpt of a real review (at least 12 letters or digits), or the whole review with a few
   words of trim; a short review never vouches for a longer invented one, and an empty review matches nothing */
const qnorm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function quoteIsReal(text, reviews = []) {
  const q = qnorm(text); if (!q) return false; if (reviews.some((r) => qnorm(r) === q)) return true; /* a short review quoted whole */
  if (q.replace(/\s/g, '').length < 12) return false;
  return reviews.map(qnorm).filter((r) => r.replace(/\s/g, '').length >= 4).some((r) => r.includes(q) || (q.includes(r) && r.length >= 0.85 * q.length));
}
function guard(b, profile, ledger) {
  const real = (profile.reviews?.quotes || []).map((q) => q.text);
  const dropped = (b.quotes || []).filter((q) => !quoteIsReal(q.text, real));
  b.quotes = (b.quotes || []).filter((q) => !dropped.includes(q));
  const allowed = allowedFromLedger(ledger);
  const bad = [];
  const fix = (o) => {
    if (typeof o === 'string') { let s = o; for (const n of numbersIn(o)) if (!allowed.has(n)) { bad.push(n.raw); s = s.replace(n.raw, `${n.raw} (to confirm)`); } return s; }
    if (Array.isArray(o)) return o.map(fix);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ['k', 'goalKeys', 'quotes'].includes(k) ? v : fix(v)]));
    return o;
  };
  return { brief: fix(b), dropped: dropped.map((q) => q.text), bad };
}

export function createBrief({ ai, log = console } = {}) {
  async function write(profile, ledger = []) {
    const at = new Date().toISOString().slice(0, 10);
    let b;
    try {
      const { catalog, identity, ...rest } = profile;
      const r = await ai.call({ model: 'opus', effort: 'high', max: 24000, tag: 'brief', system: SYSTEM(), schema: BRIEF_SCHEMA,
        prompt: `Profile (what the reader found):\n${JSON.stringify({ ...rest, catalog: { count: catalog?.count, hero: catalog?.hero, products: (catalog?.products || []).slice(0, 60).map((p) => ({ title: p.title, price: p.price, mrp: p.mrp, url: p.url, claims: p.claims, reviews: p.reviews })) } }).slice(0, 60000)}\n\nLedger (key | value | label | source | date):\n${ledger.map((e) => `${e.key} | ${e.v} | ${e.label} | ${e.src || ''} | ${e.at || ''}`).join('\n')}\n\nWrite the brief for ${profile.name}. Catalogue: hero products first, then the rest of what the ledger prices (bundles included), up to 25 rows. Rivals: every rival in the profile. Personas: 3 to 6. Objections: 4 to 8.` });
      b = objRows(r.json);
    } catch (e) {
      if (!e.mock) throw e;
      b = mockBrief(profile, ledger);
    }
    const g = guard(b, profile, ledger);
    if (g.dropped.length || g.bad.length) log.warn?.(`[brief] dropped ${g.dropped.length} unsourced quotes, ${g.bad.length} unbacked numbers`);
    const json = { ...g.brief, at, meta: { dropped: g.dropped, unbacked: g.bad, mock: !!b._mock } };
    return { md: render(g.brief, at), json };
  }
  return { write };
}

function mockBrief(p, ledger) {
  const price = ledger.filter((e) => e.key.startsWith('price.'));
  return { _mock: true, name: p.name || p.host, descriptor: p.descriptor || '', oneLine: `[MOCK] ${p.tagline || ''}`, businessModel: '[MOCK] to confirm',
    catalogue: price.slice(0, 20).map((e) => ({ name: e.label.replace(/ price$/, ''), price: e.v, mrp: '', note: '', k: e.key })),
    claims: ledger.filter((e) => e.key.startsWith('claim.')).map((e) => ({ product: '', claim: e.label, basis: e.src, k: e.key })),
    reviewSummary: '[MOCK]', platforms: [], quotes: (p.reviews?.quotes || []).slice(0, 8).map((q) => ({ text: q.text, src: q.src, theme: '' })), language: [], praise: [], complaints: [],
    channels: [], company: [], goal: 'To confirm', goalKeys: '', personas: [], objections: [],
    rivals: (p.rivals || []).map((r) => ({ name: r.name, host: r.host, oneLiner: r.why || '', prices: '', k: "" })), gaps: [], toConfirm: ['[MOCK] everything'] };
}

/* ---------- the team's private brief: the same brief with the connected accounts' numbers in it ----------
   No AI call: company facts and channels are filled from the real connected rows (never demo), and the questions those rows
   answer leave "To confirm". The goal stays the team's to say: numbers don't tell Brew what the brand wants. */
const CONN = /^(shopify|ga4|gads|meta|klaviyo|reviews\.judgeme)\./;
const COMPANY = [['shopify.revenue.30d', 'Revenue, last 30 days'], ['shopify.orders.30d', 'Orders, last 30 days'], ['shopify.aov', 'Average order'], ['shopify.repeat.90d', 'Customers with 2+ orders, 90 days'], ['shopify.cod.share', 'Cash on delivery share'], ['ga4.sessions.30d', 'Sessions, last 30 days'], ['ga4.conversion', 'Conversion']];
const CHANNELS = [['ga4.channels', 'Traffic by channel'], ['meta.spend.30d', 'Meta ads'], ['gads.spend.30d', 'Google search ads'], ['klaviyo.flows.live', 'Email flows'], ['reviews.judgeme.total', 'Reviews (Judge.me)']];
const ANSWERS = [[/revenue|sales|turnover|orders|order value|aov|basket/i, /^shopify\.(revenue|orders|aov)/], [/repeat|retention|second order|lifetime/i, /^shopify\.repeat/], [/channel|traffic|where.*(buyers|customers|visitors) come/i, /^ga4\.channels/],
  [/ad spend|paid|meta ads|facebook ads|budget/i, /^(meta|gads)\.spend/], [/email|klaviyo|flows|newsletter/i, /^klaviyo\./], [/cash on delivery|cod/i, /^shopify\.cod/]];
export function briefWithConnected(brief, rows = []) {
  const by = Object.fromEntries((rows || []).filter((e) => e?.key && e.v != null && !e.demo).map((e) => [e.key, e]));
  if (!brief || !Object.keys(by).length) return null;
  const src = (e) => e.src || 'Connected account';
  const keep = (xs) => (xs || []).filter((r) => !String(r?.k || '').split(/[,\s]+/).some((k) => CONN.test(k)));
  const company = [...keep(brief.company), ...COMPANY.filter(([k]) => by[k]).map(([k, fact]) => ({ fact, value: String(by[k].v), src: src(by[k]), k }))];
  const extra = { 'meta.spend.30d': ['meta.roas', 'meta.cpa'], 'gads.spend.30d': ['gads.roas', 'gads.branded.share'], 'klaviyo.flows.live': ['klaviyo.flows.off', 'klaviyo.list'], 'reviews.judgeme.total': ['reviews.judgeme.rating'] };
  const channels = [...keep(brief.channels), ...CHANNELS.filter(([k]) => by[k]).map(([k, channel]) => { const ks = [k, ...(extra[k] || []).filter((x) => by[x])];
    return { channel, evidence: ks.map((x) => `${by[x].label}: ${by[x].v}`).join('; '), k: ks.join(',') }; })];
  const answered = (q) => ANSWERS.some(([re, kre]) => re.test(q) && Object.keys(by).some((k) => kre.test(k)));
  const toConfirm = (brief.toConfirm || []).filter((q) => !answered(q));
  const at = new Date().toISOString().slice(0, 10), json = { ...brief, company, channels, toConfirm, connectedAt: at };
  return { json, md: render(json, brief.at || at) };
}
