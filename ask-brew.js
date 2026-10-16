// Ask Brew (UI2): one persistent thread per member, per brand, that answers across the feed, the moves and the facts, with links
// to the cards and moves it used. It replaces the old global / multi-card jam: the old entry points (JamRoom.openFromCtx) open
// it with a context seed { cardId, move, bulk: [card ids], signal, moves: true, batch: true }, and when the ask is something to
// make (routeJam intent "versions") or needs a person (route "team"), the answer carries an action the UI turns into a jam
// (action.ctx is what JamRoom.openFromCtx takes) or a brief to send.
// With AI off (mock, no credit, demo visitor) it never makes an answer up: it says so and links the cards and moves that mention
// the question's words (a plain search), or says nothing matched.
// Threads live in the brand pack at private/ask/<key>.json (key: memberKey of the member's email, else the workspace).
const MAX = 200;
const str = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const STOP = new Set('what which when where does that this with from have about would should could there their them they your ours into than then just only also some more most less much very been were will make made want need show tell give does doing done best good next week today brand cards card feed moves move brew'.split(' '));
export const termsOf = (text) => [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) || []).filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 12);

/* a seed from the UI, cleaned: what the ask is about */
export function cleanSeed(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (s.cardId) out.cardId = str(s.cardId, 120);
  if (s.move != null && Number.isFinite(+s.move)) out.move = +s.move;
  if (Array.isArray(s.bulk)) { const b = [...new Set(s.bulk.map((x) => str(typeof x === 'object' ? x?.id : x, 120)).filter(Boolean))].slice(0, 12); if (b.length) out.bulk = b; }
  if (s.signal) out.signal = str(s.signal, 300);
  if (s.moves === true) out.moves = true;
  if (s.batch === true) out.batch = true;
  return Object.keys(out).length ? out : null;
}
/* the jam the UI opens for a seed (JamRoom.openFromCtx's ctx) */
export const ctxOf = (seed, text) => seed?.cardId ? { post: seed.cardId } : seed?.bulk ? { bulk: seed.bulk.map((id) => ({ id })) } : seed?.moves ? { moves: true } : seed?.batch ? { batch: true } : { signal: str(seed?.signal || text, 120) };

/* the plain search: cards and moves that mention the question's words, best first */
export function search(text, { cards = [], moves = [] } = {}, k = { cards: 4, moves: 3 }) {
  const terms = termsOf(text); if (!terms.length) return { cards: [], moves: [] };
  const hits = (s) => { s = String(s || '').toLowerCase(); return terms.filter((w) => s.includes(w)).length; };
  const cs = cards.map((c, i) => ({ c, n: hits(`${c.title} ${c.sub} ${c.campaign || ''}`), i })).filter((x) => x.n).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, k.cards).map((x) => x.c);
  const ms = moves.map((m) => ({ m, n: hits(`${m.title} ${m.gives || ''}`) })).filter((x) => x.n).sort((a, b) => b.n - a.n || a.m.n - b.m.n).slice(0, k.moves).map((x) => x.m);
  return { cards: cs, moves: ms };
}
const linkOfCard = (c) => ({ kind: 'card', id: c.id, title: str(c.title, 120), agent: c.agent || null });
const linkOfMove = (m) => ({ kind: 'move', n: m.n, title: str(m.title, 120) });

export const ASK_SCHEMA = { type: 'object', required: ['answer', 'cards', 'moves'], properties: {
  answer: { type: 'string', description: 'Under 90 words, plain words, lead with the answer. Only numbers from the facts, cards or moves given.' },
  cards: { type: 'array', items: { type: 'string' }, description: 'Ids of the cards (from the list) the answer rests on, best first, at most 4' },
  moves: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the moves (from the list) the answer rests on, at most 3' } } };

/* one answer. ctx: { brand, cards: [{id,title,sub,agent}], moves: [{n,title,gives}], facts, seedText }. ai(prompt, schema) → json
   (null or a throw when AI is off). route(text) → routeJam's decision. Returns { body, links, action, by } */
export async function answerAsk({ text, seed = null, ctx = {}, history = [], ai = null, route = null }) {
  const cards = ctx.cards || [], moves = ctx.moves || [];
  const byId = new Map(cards.map((c) => [c.id, c])), byN = new Map(moves.map((m) => [m.n, m]));
  const decision = route ? await route(text).catch(() => null) : null;
  let action = null;
  if (decision?.route === 'team') action = { kind: 'brief', label: decision.label || null, ctx: ctxOf(seed, text), say: `This needs ${decision.label && decision.label !== 'none' ? decision.label : 'a person'}: start a jam, then send the brief to the ShopOS team.` };
  else if (decision?.intent === 'versions') action = { kind: 'jam', ctx: ctxOf(seed, text), say: 'Open a jam to make it.' };
  let out = null;
  if (ai) {
    const prompt = [`You are Brew, answering a question from someone on ${ctx.brand || 'the brand'}’s team, across their feed, the moves Brew wrote for them, and the facts Brew read.`,
      ctx.facts ? `Facts (the only numbers you may quote):\n${String(ctx.facts).slice(0, 3000)}` : '',
      `Cards in their feed now (id · agent · title: line):\n${cards.slice(0, 30).map((c) => `${c.id} · ${c.agent || ''} · ${str(c.title, 100)}: ${str(c.sub, 160)}`).join('\n') || '(none)'}`,
      `Moves (number · title: what it gives):\n${moves.slice(0, 64).map((m) => `${m.n} · ${str(m.title, 90)}: ${str(m.gives, 140)}`).join('\n') || '(none)'}`,
      ctx.seedText ? `They asked from here:\n${String(ctx.seedText).slice(0, 2500)}` : '',
      history.length ? `The conversation so far:\n${history.slice(-6).map((m) => `${m.from === 'me' ? 'Them' : 'Brew'}: ${str(m.body, 300)}`).join('\n')}` : '',
      `Question: "${str(text, 1500)}"`,
      'Answer from what is above only. If it is not there, say so plainly. Never invent numbers, cards or moves. Name the cards and moves you used by id and number.'].filter(Boolean).join('\n\n');
    try { const j = await ai(prompt, ASK_SCHEMA);
      if (j?.answer) out = { body: str(j.answer, 1200), links: [...(j.cards || []).filter((id) => byId.has(id)).slice(0, 4).map((id) => linkOfCard(byId.get(id))), ...(j.moves || []).map(Number).filter((n) => byN.has(n)).slice(0, 3).map((n) => linkOfMove(byN.get(n)))], by: 'ai' };
    } catch (e) { out = e?.billing ? { body: 'I can’t answer right now: Brew’s writing is paused for a while. Ask again later.', links: [], by: 'paused' } : null; }
  }
  if (!out) {
    const s = search(`${text} ${seed?.signal || ''}`, { cards, moves }), seedCard = seed?.cardId && byId.get(seed.cardId);
    const links = [...(seedCard ? [linkOfCard(seedCard)] : []), ...s.cards.filter((c) => c !== seedCard).map(linkOfCard), ...s.moves.map(linkOfMove)].slice(0, 6);
    out = { body: s.cards.length || s.moves.length ? 'AI is offline right now, so I can’t write an answer. These cards and moves mention it:' : `AI is offline right now, so I can’t answer that.${cards.length || moves.length ? ' Nothing in your feed or moves mentions it either.' : ''}`, links, by: 'search' };
  }
  return { ...out, action, route: decision ? { route: decision.route, label: decision.label, intent: decision.intent || null } : null };
}

/* the threads */
export function createAskBrew({ packs, now = () => Date.now(), log = console }) {
  const file = (key) => `private/ask/${String(key).replace(/[^\w-]/g, '_')}.json`;
  const locks = new Map();
  const load = async (slug, key) => (await packs.getJSON(slug, file(key), null).catch(() => null)) || { msgs: [], pending: [] };
  const write = (slug, key, fn) => { const k = `${slug}|${key}`; const run = (locks.get(k) || Promise.resolve()).catch(() => {}).then(async () => {
    const th = await load(slug, key); const r = await fn(th); th.msgs = (th.msgs || []).slice(-MAX); th.at = now(); await packs.put(slug, file(key), th); return r ?? th; });
    locks.set(k, run); return run; };
  const id = () => 'am_' + Math.random().toString(16).slice(2, 10);
  const append = (slug, key, ...msgs) => write(slug, key, (th) => { const added = msgs.map((m) => ({ id: id(), at: now(), ...m })); th.msgs.push(...added); return added; });
  /* a file dropped "just this once": it rides on the next ask */
  const pend = (slug, key, f) => write(slug, key, (th) => { th.pending = [...(th.pending || []), f].slice(-4); return th.pending; });
  const takePending = (slug, key) => write(slug, key, (th) => { const p = th.pending || []; th.pending = []; return p; });
  const clear = (slug, key) => write(slug, key, (th) => { th.msgs = []; th.pending = []; return th; });
  return { load, append, pend, takePending, clear };
}
