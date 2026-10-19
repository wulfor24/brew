// Where the brand and its rivals stand in AI answers: for each rival the read found, how many of the real ChatGPT, Gemini,
// Perplexity and Claude answers name it, and for which shopper questions. Two sources, both already read:
//   the read (profile.ai.answers, every brand), and the weekly AI answers check (live-watch.js visibility runs) where a brand has it.
// Nothing is asked here and nothing is guessed: an answer set that couldn't be read is { error }, never zeros, and a rival
// list that failed says so (rivalsError) instead of "no rivals". Beside the known rivals: the brands the answers actually name
// most (named, from reader/stages/named.js), so a rival list the AI tools never mention still shows who they do mention.
import { nameKey } from './reader/stages/named.js';

const reName = (n) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'iu');
const STAND_V = 2;

/* the brands the answers name most, the brand and its known rivals aside: null when the pass hasn't run, { error } when it failed */
function namedOf(rows, skip, pass) {
  if (!pass) return null;
  if (pass.error) return { error: 'The other brands in these answers couldn’t be read this time; the next refresh tries again.' };
  /* a product line folds into its brand: "Tugain 5% Solution" counts as Tugain when Tugain is named too */
  const all = [...new Set(rows.flatMap((a) => (a.brands || []).map((x) => String(x).trim())).filter(Boolean))];
  const head = (b) => all.filter((x) => x.length < b.length && b.toLowerCase().startsWith(x.toLowerCase() + ' ')).sort((x, y) => x.length - y.length)[0] || b;
  const by = new Map();
  for (const a of rows) for (const b of new Set((a.brands || []).map((x) => head(String(x).trim())).filter(Boolean))) {
    const k = nameKey(b); if (!k || skip.has(k)) continue;
    const e = by.get(k) || { spell: {}, n: 0, un: 0, ans: new Set() }; if (e.ans.has(a)) continue;
    e.ans.add(a); e.n++; if (!a.branded) e.un++; e.spell[b] = (e.spell[b] || 0) + 1; by.set(k, e);
  }
  const list = [...by.values()].map((e) => ({ name: Object.entries(e.spell).sort((x, y) => y[1] - x[1])[0][0], n: e.n, un: e.un }))
    .sort((a, b) => b.un - a.un || b.n - a.n || a.name.localeCompare(b.name));
  return { list: list.slice(0, 8), brands: list.length, of: rows.length, unOf: rows.filter((a) => !a.branded).length };
}

/* answers: [{ q, branded, tool, named, rivals: [names already matched], brands: [every brand it names], text }] → the standing */
function standOf({ answers, brand, rivals, at, src, rivalsError = null, namedPass = null }) {
  const ok = answers.filter((a) => a && a.q && !a.error); /* a tool that failed is no answer: never counted as "not named" */
  if (!ok.length) return null;
  const known = [...new Set(rivals.map((r) => String(r || '').trim()).filter((r) => r && r.toLowerCase() !== String(brand || '').toLowerCase()))].slice(0, 8);
  /* who the brand is up against in AI answers is who the answers name (Param, 19 Oct: Arata was compared with the curl brands its
     read picked while the answers named Minimalist, WishCare and others): the brands named most where the shopper named no brand,
     when the brands pass read them; the read's rivals stand in only without that pass. A known rival the answers never name is
     listed by name (knownUnnamed), never dropped silently */
  const all = namedOf(ok, new Set([nameKey(brand)]), namedPass), un0 = !!all?.unOf && all.list.some((r) => r.un), cnt0 = (r) => (un0 ? r.un : r.n);
  const isKnown = (r) => (known.some((k) => nameKey(k) === nameKey(r.name)) ? 1 : 0); /* on a tie, a rival the read already knows keeps its row */
  const top = all && !all.error ? all.list.filter(cnt0).sort((a, b) => cnt0(b) - cnt0(a) || isKnown(b) - isKnown(a)).slice(0, 6).map((r) => r.name) : [];
  const byNamed = top.length >= 2, names = byNamed ? top : known;
  const knownUnnamed = byNamed ? known.filter((k) => !all.list.some((r) => nameKey(r.name) === nameKey(k) && r.n)) : [];
  const res = names.map((n) => [n, reName(n)]);
  const hits = (a) => res.filter(([n, re]) => (a.rivals || []).some((x) => String(x).toLowerCase() === n.toLowerCase()) || (a.brands || []).some((x) => nameKey(x) === nameKey(n)) || (a.text && re.test(a.text))).map(([n]) => n);
  const rows = ok.map((a) => ({ ...a, hit: hits(a) }));
  const unb = rows.filter((a) => !a.branded);
  const qs = [...new Set(rows.map((a) => a.q))].map((q) => { const as = rows.filter((a) => a.q === q);
    return { q, branded: !!as[0].branded, of: as.length, brand: as.filter((a) => a.named).length, named: names.map((n) => [n, as.filter((a) => a.hit.includes(n)).length]).filter(([, k]) => k) }; });
  const rival = (n) => { const mine = rows.filter((a) => a.hit.includes(n)), mineU = mine.filter((a) => !a.branded);
    /* the questions it was named for: the ones where the shopper named no brand first, then by how many tools named it */
    const forQ = [...new Set(mine.map((a) => a.q))].map((q) => [q, mine.filter((a) => a.q === q).length, rows.find((a) => a.q === q)?.branded]).sort((x, y) => (x[2] ? 1 : 0) - (y[2] ? 1 : 0) || y[1] - x[1]);
    return { name: n, n: mine.length, un: mineU.length, qs: forQ.slice(0, 3).map(([q, k, b]) => ({ q, k, of: rows.filter((a) => a.q === q).length, branded: !!b })) }; };
  return { v: STAND_V, src, at, of: rows.length, tools: [...new Set(rows.map((a) => a.tool))].length, questions: qs.length,
    brand: { name: brand, n: rows.filter((a) => a.named).length, un: unb.filter((a) => a.named).length }, unOf: unb.length,
    rivals: names.map(rival).sort((a, b) => b.un - a.un || b.n - a.n), rivalsError: names.length ? null : rivalsError, qs, rivalsBy: byNamed ? 'named' : 'read', knownUnnamed,
    named: byNamed ? null : namedOf(rows, new Set([brand, ...names].map(nameKey).filter(Boolean)), namedPass) }; /* the rows are already who they name */
}

/* from the read: profile.ai.answers and profile.rivals */
export function standFromRead(p = {}) {
  const ai = p.ai || {};
  if (!(ai.answers || []).length) return p.meta?.errors?.answers ? { error: 'The AI answers couldn’t be read this time; the next refresh tries again.' } : null;
  const rivals = (p.rivals || []).map((r) => r?.name).filter(Boolean);
  const rivalsError = !rivals.length ? (p.meta?.errors?.rivals ? 'The rivals couldn’t be read this time; the next refresh tries again.' : null) : null;
  const at = ai.answers.filter((a) => !a.error).map((a) => a.at).filter(Boolean).sort().pop() || p.meta?.readAt || null;
  return standOf({ src: 'read', at, brand: p.name, rivals, rivalsError, namedPass: ai.named || null,
    answers: ai.answers.map((a) => ({ q: a.q, branded: !!a.branded, tool: a.tool, error: a.error || null, named: !!a.named, rivals: a.rivalsNamed || [], brands: a.brandsNamed || [], text: a.text || '' })) });
}

/* from the weekly check: the newest visibility run (live-watch.js), its questions from the brand config */
export function standFromRun(run, { questions = [], rivals = [], brand = '' } = {}) {
  if (!run?.answers?.length) return null;
  /* a run made before its brand's questions were sourced again has no record of what it asked: its answers can't be matched to
     the new questions by id, so it stands down until the new run lands (the read's standing shows meanwhile) */
  if (!run.qs && questions.some((q) => q?.why)) return null;
  const qs = [...(run.qs || []), ...questions.filter((q) => !(run.qs || []).some((x) => x.id === q.id))], qText = new Map(qs.map((q) => [q.id, q.q])), qBr = new Map(qs.filter((q) => q.branded != null).map((q) => [q.id, q.branded])), own = brand ? reName(brand) : null; /* a run keeps the set it asked (run.qs) */
  return standOf({ src: 'weekly', at: new Date(run.at).toISOString().slice(0, 10), brand, rivals,
    answers: run.answers.map((a) => { const q = qText.get(a.q) || a.q; return { q, branded: qBr.has(a.q) ? qBr.get(a.q) : !!(own && own.test(q)), tool: a.engine, named: !!a.named, rivals: a.rivals || [], brands: a.brandsNamed || [], text: a.text || `${a.said || ''} ${a.excerpt || ''}` }; }), namedPass: run.brandsPass || null });
}
