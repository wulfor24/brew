// Where the brand and its rivals stand in AI answers: for each rival the read found, how many of the real ChatGPT, Gemini,
// Perplexity and Claude answers name it, and for which shopper questions. Two sources, both already read:
//   the read (profile.ai.answers, every brand), and the weekly AI answers check (live-watch.js visibility runs) where a brand has it.
// Nothing is asked here and nothing is guessed: an answer set that couldn't be read is { error }, never zeros, and a rival
// list that failed says so (rivalsError) instead of "no rivals".

const reName = (n) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'iu');
const STAND_V = 1;

/* answers: [{ q, branded, tool, named, rivals: [names already matched], text }] → the standing */
function standOf({ answers, brand, rivals, at, src, rivalsError = null }) {
  const ok = answers.filter((a) => a && a.q);
  if (!ok.length) return null;
  const names = [...new Set(rivals.map((r) => String(r || '').trim()).filter((r) => r && r.toLowerCase() !== String(brand || '').toLowerCase()))].slice(0, 8);
  const res = names.map((n) => [n, reName(n)]);
  const hits = (a) => res.filter(([n, re]) => (a.rivals || []).some((x) => String(x).toLowerCase() === n.toLowerCase()) || (a.text && re.test(a.text))).map(([n]) => n);
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
    rivals: names.map(rival).sort((a, b) => b.un - a.un || b.n - a.n), rivalsError: names.length ? null : rivalsError, qs };
}

/* from the read: profile.ai.answers and profile.rivals */
export function standFromRead(p = {}) {
  const ai = p.ai || {};
  if (!(ai.answers || []).length) return p.meta?.errors?.answers ? { error: 'The AI answers couldn’t be read this time; the next refresh tries again.' } : null;
  const rivals = (p.rivals || []).map((r) => r?.name).filter(Boolean);
  const rivalsError = !rivals.length ? (p.meta?.errors?.rivals ? 'The rivals couldn’t be read this time; the next refresh tries again.' : null) : null;
  const at = ai.answers.map((a) => a.at).filter(Boolean).sort().pop() || null;
  return standOf({ src: 'read', at, brand: p.name, rivals, rivalsError,
    answers: ai.answers.map((a) => ({ q: a.q, branded: !!a.branded, tool: a.tool, named: !!a.named, rivals: a.rivalsNamed || [], text: a.text || '' })) });
}

/* from the weekly check: the newest visibility run (live-watch.js), its questions from the brand config */
export function standFromRun(run, { questions = [], rivals = [], brand = '' } = {}) {
  if (!run?.answers?.length) return null;
  const qText = new Map(questions.map((q) => [q.id, q.q])), own = brand ? reName(brand) : null;
  return standOf({ src: 'weekly', at: new Date(run.at).toISOString().slice(0, 10), brand, rivals,
    answers: run.answers.map((a) => { const q = qText.get(a.q) || a.q; return { q, branded: !!(own && own.test(q)), tool: a.engine, named: !!a.named, rivals: a.rivals || [], text: `${a.said || ''} ${a.excerpt || ''}` }; }) });
}
