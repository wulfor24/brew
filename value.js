// What a card is worth doing: the feed ranks on expected value, not on the biggest money number in the text.
// Each move is graded once (and again when it is rewritten) by one Sonnet call per 20 moves:
//   impact     1-5  share of the brand's monthly revenue at stake (5 over 5%, 4 2-5%, 3 0.5-2%, 2 under 0.5%, 1 hygiene)
//   confidence 0-1  how much of the move rests on facts Brew read versus assumptions
//   effort     1-4  hours, days, weeks, a month or more
//   urgency    0-1  a date or event that makes it worth doing now (sale day, stock-out, rival launch); `by` holds the date
//   now        bool Brew can do it on the brand's own stack today
// Kept in the pack as move-value.json { n: {...grade, v} }; feed-service reads it through cardValue(). MOVE_VALUE_OFF=1 stops grading.

const P = 'move-value.json', D = 864e5;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['moves'], properties: { moves: { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['n', 'impact', 'confidence', 'effort', 'urgency', 'by', 'now', 'why'], properties: { n: { type: 'integer' }, impact: { type: 'integer' }, confidence: { type: 'number' }, effort: { type: 'integer' },
    urgency: { type: 'number' }, by: { type: 'string' }, now: { type: 'boolean' }, why: { type: 'string' } } } } } };
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(+x) ? +x : a));
const verOf = (m) => String(m?.v || m?.version || m?.meta?.at || '');
export const moveNo = (id) => { const m = /^m(\d+)-/.exec(String(id || '')); return m ? +m[1] : null; };

/* a move's text for grading: title, what it gives, its headline number and the start of its plan */
const brief = (n, m) => { const secs = (m.sections || []).flatMap((s) => [s.title || s.h || '', ...(s.blocks || []).map((b) => b.text || b.md || (b.rows || []).map((r) => r.join(': ')).join('; ') || (b.items || []).join('; '))]).join('\n');
  return { n, title: m.title, gives: m.gives || '', stat: [m.stat, m.statLabel].filter(Boolean).join(' '), plan: String(secs).replace(/\s+/g, ' ').slice(0, 900) }; };

/* grade → 0..10. Expected value: impact x confidence, lifted by urgency (up to 1.6x, gone once the date has passed), divided by
   the square root of effort, plus a little for moves Brew can do now. A hygiene move done in an hour lands near 2; a 5% move
   with good evidence, due this week, near 10 */
export function valueOf(g, now = Date.now()) {
  if (!g) return null;
  const by = Date.parse(g.by), past = Number.isFinite(by) && by < now - D, soon = Number.isFinite(by) && !past ? clamp(1 - (by - now) / (30 * D), 0, 1) : 0;
  const urg = past ? 0 : Math.max(clamp(g.urgency, 0, 1), soon);
  const raw = (clamp(g.impact, 1, 5) * clamp(g.confidence, 0.2, 1) * (1 + 0.6 * urg)) / Math.sqrt(clamp(g.effort, 1, 4)) + (g.now ? 0.4 : 0);
  return +clamp(raw * 1.6, 0, 10).toFixed(2);
}

/* any card's value. Move cards use their move's grade (the second card of a move is worth a little less than the first). Other
   cards by what they are: an exception from a live check (out of stock, price changed) is urgent; research, listening and ideas
   sit in the middle and rise with real numbers; build and progress cards are low. Unknown cards fall back to 3 */
export function cardValue(c, grades = {}, now = Date.now()) {
  const n = moveNo(c?.id);
  if (n != null) { const v = valueOf(grades[n], now); if (v != null) return +(v - (/-[2-9]$/.test(c.id) ? 0.4 : 0)).toFixed(2); }
  if (c?.family === 'exception' || (c?.badge?.[1] === 'warn' && c?.type === 'decision')) return 7.5;
  if (c?.liveOnly || c?.live) return 6;
  if (/^build-/.test(c?.id || '') || c?.origin === 'build' && c?.kind === 'rows' && /^build/.test(c?.id || '')) return 2.5;
  if (c?.research) return c.research.kind === 'ad' ? 4.5 : 4;
  if (/^(Ideas|Heard) ·/.test(c?.src || '')) return 4;
  if (c?.origin === 'read') return 5;
  return 3;
}

export function createValue({ ai, packs, log = console, allow = () => true } = {}) {
  const busy = new Set();
  // grade the moves of a loaded pack that have no grade, or whose move was rewritten since; sets pack.moveValue in place
  async function fill(pack) {
    const slug = pack?.slug; if (!slug || pack.kind !== 'generated' || busy.has(slug) || process.env.MOVE_VALUE_OFF === '1' || !allow()) return null;
    busy.add(slug);
    try {
      const st = (await packs.getJSON(slug, P, null).catch(() => null)) || {}; pack.moveValue = st;
      const docs = pack.moveDocs || {}, todo = Object.entries(docs).filter(([n, m]) => /^\d+$/.test(n) && +n > 0 && m?.title && (!st[n] || st[n].v !== verOf(m))).map(([n, m]) => brief(+n, m));
      if (!todo.length) return st;
      const brand = pack.seed?.brand?.name || slug, cfg = pack.config || {}, today = new Date().toISOString().slice(0, 10); let usd = 0;
      for (let i = 0; i < todo.length; i += 20) {
        const batch = todo.slice(i, i + 20);
        try { const r = await ai.call({ model: 'sonnet', schema: SCHEMA, max: 4000, tag: 'move-value', prompt: `Today is ${today}. Grade each move for ${brand} (${cfg.category || 'a D2C brand'}, ${cfg.countryName || cfg.country || 'its market'}) so the team's feed shows the most valuable work first.

For each move return:
- impact 1-5: the share of monthly revenue it can move if it works. 5 over 5%, 4 2-5%, 3 0.5-2%, 2 under 0.5%, 1 hygiene or setup with no direct revenue.
- confidence 0.2-1: how much rests on things Brew observed (live prices, reviews, rival ads, search data) versus assumptions.
- effort 1-4: 1 hours, 2 a few days, 3 weeks, 4 a month or more.
- urgency 0-1: is there a reason to do it now (a sale date, a stock-out, a rival launch, a season)? 0 if not.
- by: the date it should be done by as YYYY-MM-DD if a date drives it, else "".
- now: true if it can be done on the brand's existing tools today (ads, store, email, reviews), false if it needs new setup or people.
- why: one short plain sentence.
Be strict and spread the grades; most moves are not 5.

MOVES (JSON):
${JSON.stringify(batch)}` });
          usd += r.usd || 0;
          for (const g of r.json?.moves || []) { const m = docs[g.n]; if (!m) continue; st[g.n] = { impact: clamp(Math.round(g.impact), 1, 5), confidence: +clamp(g.confidence, 0.2, 1).toFixed(2), effort: clamp(Math.round(g.effort), 1, 4), urgency: +clamp(g.urgency, 0, 1).toFixed(2), by: /^\d{4}-\d\d-\d\d$/.test(g.by) ? g.by : '', now: !!g.now, why: String(g.why || '').slice(0, 200), v: verOf(m), at: Date.now() }; }
        } catch (e) { log.warn?.('[move-value]', slug, e.message); if (e.mock) return st; }
      }
      await packs.put(slug, P, st); pack.moveValue = st;
      log.log?.('[move-value]', slug, `${todo.length} graded`, `$${usd.toFixed(3)}`);
      return st;
    } finally { busy.delete(slug); }
  }
  return { fill };
}
