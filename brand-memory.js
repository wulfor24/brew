// Brand memory: everything Brew knows about a brand, shared by everyone who works on it, and getting better with use.
// A hybrid of two designs (docs/brand-memory.md):
//  - Cognition's agent memory repo: a human-readable, versioned "repo" per brand (MEMORY.md index + one markdown file
//    per topic), every line carrying [source; added; id], a git-like log of every change, and a periodic "dreaming"
//    pass (consolidate) that merges duplicates and drops stale or contradicted lines so the repo stays small and true.
//  - mem0: atomic facts. New text is extracted into facts, each fact is compared with the most similar existing facts,
//    and an LLM decides ADD / UPDATE / DELETE / NONE. Facts are searchable (embeddings + lexical) and scoped:
//    brand (user_id: shared by the whole brand), member (a person's own preferences, keyed by an email hash, for roles
//    and team members later) and run (one jam/session).
// Self-hosted, no extra services: mem0's own OSS package needs better-sqlite3 (a native module) even for its in-memory
// store and keeps state in local SQLite files, which Cloud Run loses. So this re-implements the mem0 algorithm on the
// app's own pieces: ai.js structured output for extraction and decisions, Vertex Gemini embeddings, and the brand pack
// files (local disk + GCS) for persistence. Without AI (AI_MOCK=1) it still works: deterministic facts and lexical search.
// Rule: never invent brand facts. Every memory line has a source; add() refuses text without one.
import { sk } from './demo-mode.js'; // Demo Mode: each demo session keeps its own memory
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TOPICS = {
  voice: { file: 'brand/voice.md', title: 'Voice and tone' },
  'creative-style': { file: 'brand/creative-style.md', title: 'How they make creatives' },
  products: { file: 'brand/products.md', title: 'Products and range' },
  offers: { file: 'brand/offers.md', title: 'Offers and pricing' },
  audience: { file: 'brand/audience.md', title: 'Audience' },
  channels: { file: 'brand/channels.md', title: 'Channels and stack' },
  rules: { file: 'brand/rules.md', title: 'Rules (never break these)' },
  'what-works': { file: 'brand/what-works.md', title: 'What works (results, decisions, sign-offs)' },
  /* what the team told Brew (brand-learnings.js): a call transcript, notes, emails or research pasted into a jam */
  essence: { file: 'brand/essence.md', title: 'Essence (who they are at heart)' },
  goals: { file: 'brand/goals.md', title: 'Goals, priorities and plans' },
  beliefs: { file: 'brand/beliefs.md', title: 'Beliefs (customers, product, claims, tone)' }
};
const TOPIC_KEYS = Object.keys(TOPICS);
export const SCOPES = ['brand', 'member', 'run'];
/* the voice the team picked in setup (feed-service POST /api/brands/:slug/voice): one keyed brand fact, so a new pick replaces
   the old, and every prompt block prints it first, with or without a query */
export const VOICE_KEY = 'voice.pick';
export const VOICE_LINE = {
  site: 'Voice: like the site, as Brew read it',
  warmer: 'Voice: warmer than the site. Write like a friend who knows the product: close, kind, a little personal.',
  sharper: 'Voice: sharper than the site. Short sentences, a clear point of view, nothing softened.',
  plainer: 'Voice: plainer than the site. Everyday words, one idea per sentence, no flourishes.'
};
export const VOICES = Object.keys(VOICE_LINE);
/* the voice route's work (feed-service POST /api/brands/:slug/voice): the team only, a known voice, memory on; the pick is saved
   as the keyed fact, so it updates in place. who = the request's viewer ({ member, email }); demo = the demo site */
export async function saveVoicePick(memory, slug, voice, { who = null, demo = false } = {}) {
  if (!(who?.member || demo)) return { status: who?.email ? 403 : 401, error: 'Only this brand’s team can set its voice.', team: true };
  if (!VOICES.includes(voice)) return { status: 400, error: `Voice is one of ${VOICES.join(', ')}.` };
  if (!memory) return { error: 'Brand memory is off here.', off: true };
  const mk = who?.member && who.email ? memberKey(who.email) : null, by = mk ? `team member ${mk}` : 'a teammate';
  const x = await memory.add(slug, VOICE_LINE[voice], { scope: 'brand', topic: 'voice', key: VOICE_KEY, infer: false, source: { kind: 'team', label: `voice picked in setup by ${by}` }, by });
  return { ok: true, voice, line: VOICE_LINE[voice], added: x.added?.length || 0, updated: x.updated?.length || 0 };
}
// which topics each agent reads first in a prompt
// the brand's own word (essence, goals, beliefs) comes right after the rules for every agent: it is how they want to be read
const OWN = ['essence', 'goals', 'beliefs'];
const FOCUS = {
  creative: ['rules', ...OWN, 'creative-style', 'voice', 'what-works', 'products', 'audience'],
  performance: ['rules', ...OWN, 'what-works', 'channels', 'audience', 'offers', 'creative-style'],
  storefront: ['rules', ...OWN, 'products', 'offers', 'voice', 'what-works', 'audience'],
  crm: ['rules', ...OWN, 'voice', 'audience', 'offers', 'what-works', 'channels'],
  visibility: ['rules', ...OWN, 'voice', 'products', 'channels', 'what-works', 'audience']
};
const DIR = 'memory';
const MAX_PER_TOPIC = 30, MAX_LOG = 600, CONSOLIDATE_EVERY = 25, RUN_TTL = 21 * 864e5;

const uid = (p = 'm') => `${p}_${crypto.randomBytes(5).toString('hex')}`;
export const memberKey = (email) => (email ? 'mb_' + crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 12) : null);
const hashOf = (s) => crypto.createHash('md5').update(norm(s)).digest('hex');
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}%₹$€£ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const tidy = (s, n = 300) => { s = String(s || '').replace(/\s+/g, ' ').replace(/—/g, ',').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const STOP = new Set('a an the and or of to in on for with at by from is are was were be been it its this that these those as their they them our we you your has have had not no but if so than then into over under per vs via'.split(' '));
const stem = (w) => w.replace(/(ing|ers|er|ies|es|s|ed|ly)$/, '');
const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);
const jaccard = (a, b) => { const A = new Set(tokens(a)), Bs = new Set(tokens(b)); if (!A.size || !Bs.size) return 0; let i = 0; A.forEach((x) => Bs.has(x) && i++); return i / (A.size + Bs.size - i); };
const cos = (a, b) => { if (!a || !b || a.length !== b.length) return null; let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };
// vectors are kept as int8 in base64: 256 dims = 344 characters, so a brand's whole memory stays a small file
const packVec = (v) => { const m = Math.max(...v.map(Math.abs)) || 1; return Buffer.from(Int8Array.from(v.map((x) => Math.round((x / m) * 127))).buffer).toString('base64'); };
const unpackVec = (s) => { if (!s) return null; const b = Buffer.from(s, 'base64'); return Array.from(new Int8Array(b.buffer, b.byteOffset, b.length)); };
// a topic from the words alone (used when the AI is off)
export const topicOf = (s) => {
  const x = norm(s);
  if (/\b(never|don t|do not|must|always|legal|banned|can t|cannot|avoid|no claims?)\b/.test(x)) return 'rules';
  if (/\b(roas|cpa|ctr|cvr|conversion|lifted|moved|result|won|winner|worked|did not move|beat|outperform)/.test(x)) return 'what-works';
  if (/\b(hook|creative|ad|ads|reel|carousel|ugc|studio|photo|shot|colour|color|font|format|visual|static|video|caption)\b/.test(x)) return 'creative-style';
  if (/\b(tone|voice|words?|says?|phrase|emoji|exclamation|copy)\b/.test(x)) return 'voice';
  if (/\b(price|discount|offer|sale|off|bundle|free shipping|mrp|compare at|coupon)\b/.test(x)) return 'offers';
  if (/\b(customer|audience|persona|buyers?|shoppers?|women|men|students?|parents?|reviewers?)\b/.test(x)) return 'audience';
  if (/\b(instagram|meta|google|email|whatsapp|klaviyo|tiktok|youtube|amazon|store|shopify|checkout|sms|seo)\b/.test(x)) return 'channels';
  return 'products';
};
const srcOf = (s, at) => { if (!s) return null; const o = typeof s === 'string' ? { label: s } : { ...s }; o.label = tidy(o.label || o.ref || o.kind || '', 160); if (!o.label) return null; o.kind ||= 'note'; o.at ||= at; return o; };
const srcLine = (f) => f.source?.label || 'unknown';

/* ---------- embeddings: Vertex Gemini (the app's own Google project), batched, cheap ---------- */
export function vertexEmbedder({ gToken, project, location = 'us-central1', model = 'gemini-embedding-001', dim = 256, log = console } = {}) {
  let off = 0; // after a failure, rest a minute (search falls back to words)
  return async (texts, kind = 'doc') => {
    if (!texts.length || Date.now() < off) return null;
    try {
      const tk = await gToken(); const out = [];
      for (let i = 0; i < texts.length; i += 50) {
        const r = await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`, {
          method: 'POST', headers: { authorization: `Bearer ${tk}`, 'x-goog-user-project': project, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20e3),
          body: JSON.stringify({ instances: texts.slice(i, i + 50).map((t) => ({ content: String(t).slice(0, 2000), task_type: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' })), parameters: { outputDimensionality: dim } }) });
        if (!r.ok) throw new Error(`embed ${r.status}`);
        const j = await r.json(); out.push(...(j.predictions || []).map((p) => p.embeddings?.values || null));
      }
      return out.length === texts.length ? out : null;
    } catch (e) { off = Date.now() + 60e3; log.warn?.('[memory] embed', e.message); return null; }
  };
}

/* ---------- the store ---------- */
export function createBrandMemory({ ai = null, packs, embed = null, allow = () => true, log = console, now = () => Date.now(), autoLearn = process.env.BRAND_MEMORY_AUTOLEARN !== '0' } = {}) {
  const cache = new Map(); // slug → { state, vecs, repoHash }
  const locks = new Map(); // slug → promise (one change at a time per brand)
  const learning = new Set(), tried = new Set();
  const live = () => !!(ai && ai.live && allow());
  const fresh = (slug) => ({ v: 1, slug, facts: [], log: [], meta: { created: now(), adds: 0 } });

  const load = async (slug) => {
    if (cache.has(sk(slug))) return cache.get(sk(slug));
    const state = (await packs.getJSON(slug, `${DIR}/state.json`, null)) || fresh(slug);
    const vecs = (await packs.getJSON(slug, `${DIR}/vectors.json`, null))?.vec || {};
    const c = { state, vecs, repoHash: {} }; cache.set(sk(slug), c); return c;
  };
  const withLock = (slug, fn) => { const p = (locks.get(sk(slug)) || Promise.resolve()).then(fn, fn); locks.set(sk(slug), p.catch(() => {})); return p; };
  const save = async (slug, c) => {
    c.state.meta.savedAt = now();
    if (c.state.log.length > MAX_LOG) c.state.log = c.state.log.slice(-MAX_LOG);
    await packs.put(slug, `${DIR}/state.json`, c.state);
    const ids = new Set(c.state.facts.map((f) => f.id)); for (const k of Object.keys(c.vecs)) if (!ids.has(k)) delete c.vecs[k];
    await packs.put(slug, `${DIR}/vectors.json`, { model: 'gemini-embedding-001', dim: 256, vec: c.vecs });
    // the human-readable repo, written file by file only when a file changed
    const files = render(c.state, { all: true });
    for (const [p, body] of Object.entries(files)) { const h = hashOf(body) + body.length; if (c.repoHash[p] === h) continue; c.repoHash[p] = h; await packs.put(slug, `${DIR}/repo/${p}`, body, 'text/markdown; charset=utf-8').catch((e) => log.warn?.('[memory] repo put', p, e.message)); }
  };
  const record = (c, op, f, { before = null, source = null, by = 'brew', why = '' } = {}) => {
    c.state.log.push({ id: uid('lg'), at: now(), op, factId: f.id, topic: f.topic, scope: f.scope, memberId: f.memberId || null, file: fileOf(f), before, after: op === 'DELETE' ? null : f.text, source: source || f.source, by, why: why || undefined });
  };
  const fileOf = (f) => (f.scope === 'member' ? `members/${f.memberId}.md` : f.scope === 'run' ? `runs/${f.runId}.md` : TOPICS[f.topic]?.file || 'brand/products.md');
  const inScope = (f, { memberId = null, runId = null, scopes } = {}) =>
    (!scopes || scopes.includes(f.scope)) && (f.scope === 'brand' || (f.scope === 'member' && memberId && f.memberId === memberId) || (f.scope === 'run' && runId && f.runId === runId));
  const weight = (f) => (f.measured ? 50 : 0) + (f.source?.kind === 'team' || f.source?.kind === 'note' ? 20 : 0) + Math.min(f.n || 1, 10) * 3 + (f.key ? 5 : 0) + Math.max(0, 10 - (now() - (f.updatedAt || 0)) / (7 * 864e5));

  // the most similar facts to a text inside one scope: embeddings when both sides have one, words otherwise
  const similar = (c, text, vec, flt, k = 5) => c.state.facts.filter((f) => f.scope === flt.scope && (f.scope !== 'member' || f.memberId === flt.memberId) && (f.scope !== 'run' || f.runId === flt.runId))
    .map((f) => { const cv = vec && cos(vec, unpackVec(c.vecs[f.id])); const lx = jaccard(text, f.text); return { f, s: cv != null ? 0.75 * cv + 0.25 * lx : lx, cv, lx }; })
    .sort((a, b) => b.s - a.s).slice(0, k);

  /* ---------- mem0: extract → compare → ADD / UPDATE / DELETE / NONE ---------- */
  const extract = async (slug, text, { scope }) => {
    const j = await ai.call({ model: 'sonnet', tag: 'memory-extract', max: 2500, effort: 'low', schema: { type: 'object', properties: { facts: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, topic: { type: 'string', enum: TOPIC_KEYS }, personal: { type: 'boolean' } } } } } },
      prompt: `You keep the shared memory for the brand "${slug}". Pull durable facts out of the input below: things that will still be true next month and would change how we write, design, target or ship for this brand.\nRules: one fact per item, one plain sentence under 25 words. Only what the input states: never infer beyond it, never invent numbers, names or claims. Skip greetings, one-off chatter and anything temporary. topic is one of: ${TOPIC_KEYS.join(', ')}. personal is true when the fact is about how this one person likes to work (their own preference), false when it is about the brand.${scope === 'member' ? ' The input comes from one team member about themselves.' : ''}\nReturn an empty list if nothing durable is in it.\n\nInput:\n"""\n${String(text).slice(0, 6000)}\n"""` });
    return (j.json?.facts || []).filter((x) => x?.text).map((x) => ({ text: tidy(x.text, 240), topic: TOPICS[x.topic] ? x.topic : topicOf(x.text), personal: !!x.personal }));
  };
  const decide = async (olds, news) => {
    const map = olds.map((f, i) => ({ id: String(i), text: f.text, topic: f.topic }));
    const j = await ai.call({ model: 'sonnet', tag: 'memory-decide', max: 3000, effort: 'low', schema: { type: 'object', properties: { memory: { type: 'array', items: { type: 'object', properties: { event: { type: 'string', enum: ['ADD', 'UPDATE', 'DELETE', 'NONE'] }, id: { type: 'string' }, new: { type: 'string' }, text: { type: 'string' }, topic: { type: 'string', enum: TOPIC_KEYS } } } } } },
      prompt: `You manage a brand's memory. Compare the new facts with the existing memories and decide, for each, one operation:\n- ADD: the new fact is new information. id = "", new = the index of the new fact, text = the fact.\n- UPDATE: the new fact is about the same thing as an existing memory and is newer, more specific or corrects it. id = that memory's id, new = the new fact's index, text = the merged memory (keep what is still true from both, never add anything neither says).\n- DELETE: the new fact shows an existing memory is no longer true and there is nothing to keep. id = that memory's id, new = the new fact's index.\n- NONE: the new fact is already in memory (same meaning). id = the matching memory's id, new = the new fact's index.\nEvery new fact gets exactly one decision. Never invent facts or numbers.\n\nExisting memories:\n${JSON.stringify(map)}\n\nNew facts:\n${JSON.stringify(news.map((n, i) => ({ new: String(i), text: n.text, topic: n.topic })))}` });
    return (j.json?.memory || []).map((m) => ({ ...m, old: olds[+m.id] || null, n: news[+m.new] || null }));
  };
  // offline decision: the same meaning is a confirmation, a keyed fact with new words is an update, everything else is new
  const decideLocal = (olds, n) => {
    if (n.key) { const k = olds.find((f) => f.key === n.key); if (k) return norm(k.text) === norm(n.text) ? { event: 'NONE', old: k } : { event: 'UPDATE', old: k, text: n.text }; }
    const best = olds.map((f) => ({ f, s: Math.max(jaccard(f.text, n.text), n._vec ? cos(n._vec, n._ovec?.(f)) || 0 : 0) })).sort((a, b) => b.s - a.s)[0];
    if (best && (norm(best.f.text) === norm(n.text) || best.s >= 0.8)) return { event: 'NONE', old: best.f };
    return { event: 'ADD' };
  };

  // the core write: facts in, decisions out, every change logged with its source
  async function ingest(slug, items, { scope = 'brand', memberId = null, runId = null, source, by = 'brew', infer = true } = {}) {
    return withLock(slug, async () => {
      const c = await load(slug), t0 = now(), report = { added: [], updated: [], deleted: [], same: [] };
      const vecsOf = async (xs) => (embed && xs.length ? await embed(xs.map((x) => x.text), 'doc').catch(() => null) : null);
      const list = items.map((x) => ({ ...x, text: tidy(x.text, 300), topic: TOPICS[x.topic] ? x.topic : topicOf(x.text), source: srcOf(x.source || source, t0) })).filter((x) => x.text.length >= 8 && x.source);
      if (!list.length) return report;
      const vs = await vecsOf(list); list.forEach((x, i) => { x._vec = vs?.[i] || null; });
      // group: each new fact with its closest existing facts in the same scope (mem0 retrieves top 5 per fact)
      const flt = { scope, memberId, runId };
      const keyed = list.filter((x) => x.key), loose = list.filter((x) => !x.key);
      const decisions = [];
      for (const n of keyed) decisions.push({ ...decideLocal(c.state.facts.filter((f) => f.scope === scope && (scope !== 'member' || f.memberId === memberId)), n), n });
      if (loose.length) {
        const near = new Map(); loose.forEach((n) => similar(c, n.text, n._vec, flt, 5).filter((x) => !x.f.key && x.s >= (x.cv != null ? 0.55 : 0.2)).forEach((x) => near.set(x.f.id, x.f))); // counted (keyed) facts are kept true by their key
        const olds = [...near.values()];
        if (olds.length && live() && infer !== 'local') {
          try { const ds = await decide(olds, loose); const seen = new Set(); ds.forEach((d) => { if (d.n && !seen.has(d.n)) { seen.add(d.n); decisions.push(d); } }); loose.filter((n) => !seen.has(n)).forEach((n) => decisions.push({ event: 'ADD', n })); }
          catch (e) { log.warn?.('[memory] decide', e.message); loose.forEach((n) => decisions.push({ ...decideLocal(olds, { ...n, _ovec: (f) => unpackVec(c.vecs[f.id]) }), n })); }
        } else loose.forEach((n) => decisions.push({ ...decideLocal(olds, { ...n, _ovec: (f) => unpackVec(c.vecs[f.id]) }), n }));
      }
      for (const d of decisions) {
        const n = d.n; if (!n) continue;
        if (d.event === 'ADD' || ((d.event === 'UPDATE' || d.event === 'DELETE' || d.event === 'NONE') && !d.old)) {
          const f = { id: uid('m'), text: tidy(d.text || n.text, 300), topic: n.topic, scope, memberId: scope === 'member' ? memberId : null, runId: scope === 'run' ? runId : null, key: n.key || null, source: n.source, sources: [n.source], n: 1, measured: n.measured || null, hash: hashOf(n.text), createdAt: t0, updatedAt: t0 };
          c.state.facts.push(f); if (n._vec) c.vecs[f.id] = packVec(n._vec); record(c, 'ADD', f, { by }); report.added.push(f); c.state.meta.adds = (c.state.meta.adds || 0) + 1;
        } else if (d.event === 'UPDATE') {
          const f = d.old, before = f.text; const text = tidy(d.text || n.text, 300);
          f.n = (f.n || 1) + 1; f.updatedAt = t0; f.sources = [n.source, ...(f.sources || [])].slice(0, 5); f.source = n.source; if (n.measured) f.measured = n.measured;
          if (norm(text) === norm(before)) { report.same.push(f); continue; }
          f.text = text; f.hash = hashOf(text); if (n.topic && f.topic !== n.topic && !f.key) f.topic = n.topic;
          const v = (await vecsOf([f]))?.[0]; if (v) c.vecs[f.id] = packVec(v);
          record(c, 'UPDATE', f, { before, by }); report.updated.push(f);
        } else if (d.event === 'DELETE') {
          const f = d.old; c.state.facts = c.state.facts.filter((x) => x.id !== f.id); record(c, 'DELETE', f, { before: f.text, source: n.source, by, why: `contradicted by: ${n.text}` }); report.deleted.push(f);
          if (!c.state.facts.some((x) => x.hash === hashOf(n.text) && x.scope === scope)) { const g = { id: uid('m'), text: n.text, topic: n.topic, scope, memberId: scope === 'member' ? memberId : null, runId: scope === 'run' ? runId : null, key: n.key || null, source: n.source, sources: [n.source], n: 1, measured: n.measured || null, hash: hashOf(n.text), createdAt: t0, updatedAt: t0 };
            c.state.facts.push(g); if (n._vec) c.vecs[g.id] = packVec(n._vec); record(c, 'ADD', g, { by }); report.added.push(g); }
        } else { // NONE: a confirmation; the memory gets stronger and keeps the new source
          const f = d.old; f.n = (f.n || 1) + 1; f.updatedAt = t0; if (!(f.sources || []).some((s) => s.label === n.source.label)) f.sources = [n.source, ...(f.sources || [])].slice(0, 5); if (n.measured) f.measured = n.measured; report.same.push(f);
        }
      }
      if (report.added.length || report.updated.length || report.deleted.length || report.same.length) await save(slug, c);
      if ((c.state.meta.adds || 0) >= CONSOLIDATE_EVERY) { c.state.meta.adds = 0; setTimeout(() => consolidate(slug).catch((e) => log.warn?.('[memory] consolidate', e.message)), 50); }
      return report;
    });
  }

  // add(slug, text): free text (a note, a jam answer, a lesson) → facts. infer=false stores the text as one fact.
  async function add(slug, text, { scope = 'brand', memberId = null, runId = null, source, topic, key, measured, by = 'brew', infer = true } = {}) {
    if (!SCOPES.includes(scope)) throw new Error(`scope must be one of ${SCOPES.join(', ')}`);
    if (scope === 'member' && !memberId) throw new Error('memberId is needed for a member memory');
    if (scope === 'run' && !runId) throw new Error('runId is needed for a run memory');
    if (!srcOf(source)) throw new Error('every memory needs a source');
    let items = [{ text, topic, key, measured, source }];
    if (infer === true && live()) {
      try { const xs = await extract(slug, text, { scope }); items = xs.map((x) => ({ text: x.text, topic: topic || x.topic, measured, source, personal: x.personal })); }
      catch (e) { log.warn?.('[memory] extract', e.message); }
    }
    // a personal preference said at brand level goes to the person, when we know who they are
    if (scope === 'brand' && memberId) { const mine = items.filter((x) => x.personal); if (mine.length) { const r1 = await ingest(slug, mine, { scope: 'member', memberId, source, by, infer }); const r2 = await ingest(slug, items.filter((x) => !x.personal), { scope, source, by, infer }); return merge(r1, r2); } }
    return ingest(slug, items, { scope, memberId, runId, source, by, infer });
  }
  const merge = (a, b) => ({ added: [...a.added, ...b.added], updated: [...a.updated, ...b.updated], deleted: [...a.deleted, ...b.deleted], same: [...a.same, ...b.same] });

  async function forget(slug, id, { by = 'you', why = 'forgotten by hand', memberId = null } = {}) {
    return withLock(slug, async () => {
      const c = await load(slug); const f = c.state.facts.find((x) => x.id === id); if (!f) return { ok: false, error: 'no such memory' };
      if (f.scope === 'member' && f.memberId !== memberId) return { ok: false, error: 'that is someone else’s memory' };
      c.state.facts = c.state.facts.filter((x) => x.id !== id); record(c, 'DELETE', f, { before: f.text, by, why, source: { kind: 'team', label: by } }); await save(slug, c); return { ok: true, id };
    });
  }

  /* ---------- search ---------- */
  async function search(slug, query, { memberId = null, runId = null, k = 8, topics = null } = {}) {
    const c = await load(slug); const pool = c.state.facts.filter((f) => inScope(f, { memberId, runId }) && (!topics || topics.includes(f.topic)));
    if (!pool.length) return [];
    const qv = query && embed ? (await embed([query], 'query').catch(() => null))?.[0] : null;
    return pool.map((f) => { const cv = qv && cos(qv, unpackVec(c.vecs[f.id])); const lx = query ? jaccard(query, f.text) : 0; const s = (cv != null ? 0.7 * cv + 0.3 * lx : lx) + weight(f) / 1000; return { id: f.id, text: f.text, topic: f.topic, scope: f.scope, source: srcLine(f), n: f.n, score: +s.toFixed(4) }; })
      .sort((a, b) => b.score - a.score).slice(0, k);
  }

  /* ---------- the repo (Cognition style): MEMORY.md + a file per topic, every line with its source ---------- */
  const line = (f) => `- ${f.text} [source: ${srcLine(f)}${(f.sources || []).length > 1 ? ` (+${f.sources.length - 1} more)` : ''}; added: ${day(f.createdAt)}${f.updatedAt - f.createdAt > 6e4 ? `; updated: ${day(f.updatedAt)}` : ''}${f.n > 1 ? `; seen: ${f.n}` : ''}; id: ${f.id}]`;
  function render(state, { memberId = null, all = false } = {}) {
    const files = {}, facts = state.facts, byW = (a, b) => weight(b) - weight(a);
    const brand = facts.filter((f) => f.scope === 'brand');
    for (const [k, t] of Object.entries(TOPICS)) { const xs = brand.filter((f) => f.topic === k).sort(byW); files[t.file] = `# ${t.title}\n\n${xs.length ? xs.map(line).join('\n') : '_Nothing yet._'}\n`; }
    const members = [...new Set(facts.filter((f) => f.scope === 'member').map((f) => f.memberId))].filter((m) => all || m === memberId);
    for (const m of members) files[`members/${m}.md`] = `# Personal preferences (${m})\n\nOnly this person sees these. They shape what Brew writes for them, never the brand.\n\n${facts.filter((f) => f.scope === 'member' && f.memberId === m).sort(byW).map(line).join('\n')}\n`;
    const runs = [...new Set(facts.filter((f) => f.scope === 'run').map((f) => f.runId))];
    for (const r of runs) files[`runs/${r}.md`] = `# Session ${r}\n\n${facts.filter((f) => f.scope === 'run' && f.runId === r).map(line).join('\n')}\n`;
    const top = (k) => brand.filter((f) => f.topic === k).sort(byW)[0];
    files['MEMORY.md'] = `# Brand memory: ${state.meta.name || state.slug}\n\nShared by everyone at the brand. Every line names its source. Read this first, then open a topic.\n${state.meta.learnedAt ? `Last read from what is live: ${day(state.meta.learnedAt)}. ` : ''}${state.meta.consolidatedAt ? `Last tidied: ${day(state.meta.consolidatedAt)}.` : ''}\n\n${Object.entries(TOPICS).map(([k, t]) => { const n = brand.filter((f) => f.topic === k).length, x = top(k); return `- [[${t.file}]] ${t.title} (${n})${x ? `: ${x.text}` : ''}`; }).join('\n')}\n${members.length ? `\nPersonal: ${members.map((m) => `[[members/${m}.md]]`).join(', ')}\n` : ''}${runs.length ? `\nSessions: ${runs.map((r) => `[[runs/${r}.md]]`).join(', ')}\n` : ''}\nHistory: [[LOG.md]]\n`;
    const visible = (x) => all || x.scope !== 'member' || x.memberId === memberId;
    files['LOG.md'] = `# Change log (newest first)\n\n${state.log.filter(visible).slice(-150).reverse().map((x) => `${new Date(x.at).toISOString().slice(0, 16).replace('T', ' ')}  ${x.op.padEnd(6)} ${x.file}  ${x.factId}  by ${x.by}\n${x.before && x.op !== 'ADD' ? `  - ${x.before}\n` : ''}${x.after ? `  + ${x.after}\n` : ''}  source: ${x.source?.label || ''}${x.why ? `; why: ${x.why}` : ''}`).join('\n')}\n`;
    return files;
  }
  async function repo(slug, { memberId = null } = {}) {
    const c = await load(slug); const st = c.state;
    return {
      slug, files: render(st, { memberId }),
      facts: st.facts.filter((f) => inScope(f, { memberId })).map(({ hash, ...f }) => f),
      log: st.log.filter((x) => x.scope !== 'member' || x.memberId === memberId).slice(-200).reverse(),
      meta: { ...st.meta, facts: st.facts.filter((f) => f.scope === 'brand').length, topics: Object.fromEntries(TOPIC_KEYS.map((k) => [k, st.facts.filter((f) => f.scope === 'brand' && f.topic === k).length])) }
    };
  }

  /* ---------- prompts ---------- */
  const voicePick = (state) => state.facts.find((f) => f.scope === 'brand' && f.key === VOICE_KEY) || null;
  const format = (name, groups, mine, vp = null) => {
    const parts = groups.filter(([, xs]) => xs.length).map(([k, xs]) => `${TOPICS[k].title}:\n${xs.map((f) => `- ${f.text}`).join('\n')}`);
    if (vp) parts.unshift(`The voice the team picked (follow it in every line you write):\n- ${vp.text}`);
    if (mine?.length) parts.push(`This person’s own preferences:\n${mine.map((f) => `- ${f.text}`).join('\n')}`);
    return parts.length ? `Brand memory for ${name} (shared by the team, read from their live site, ads, posts and results, and what the team told Brew; follow the rules and the brand's own essence, goals and beliefs, lean on what works, match the voice and creative style):\n${parts.join('\n')}` : '';
  };
  const pick = (state, { agent, memberId, max = 1600, per = 4 }) => {
    const order = FOCUS[agent] || ['rules', ...OWN, 'creative-style', 'voice', 'what-works', 'products', 'offers', 'audience', 'channels'];
    const byW = (a, b) => weight(b) - weight(a); let used = 0; const groups = [];
    for (const k of order) { const xs = state.facts.filter((f) => f.scope === 'brand' && f.topic === k && f.key !== VOICE_KEY).sort(byW).slice(0, k === 'rules' ? 6 : OWN.includes(k) ? 3 : per).filter((f) => (used += f.text.length + 4) < max); groups.push([k, xs]); }
    const mine = memberId ? state.facts.filter((f) => f.scope === 'member' && f.memberId === memberId).sort(byW).slice(0, 4) : [];
    return { groups, mine };
  };
  // async: the facts that matter for this query (semantic search) plus every rule
  async function promptBlock(slug, { query = '', memberId = null, runId = null, agent = null, k = 10, name } = {}) {
    const c = await load(slug); if (!c.state.facts.length) return '';
    const vp = voicePick(c.state);
    if (!query) { const { groups, mine } = pick(c.state, { agent, memberId }); return format(name || c.state.meta.name || slug, groups, mine, vp); }
    const hits = await search(slug, query, { memberId, runId, k: k + 6 }); const byId = new Map(c.state.facts.map((f) => [f.id, f]));
    const rules = c.state.facts.filter((f) => f.scope === 'brand' && f.topic === 'rules').sort((a, b) => weight(b) - weight(a)).slice(0, 6);
    /* the brand's own word rides along with every query, like the rules: the top two lines of essence, goals and beliefs */
    const own = OWN.flatMap((t) => c.state.facts.filter((f) => f.scope === 'brand' && f.topic === t).sort((a, b) => weight(b) - weight(a)).slice(0, 2));
    const chosen = [...new Set([...rules, ...own, ...hits.map((h) => byId.get(h.id)).filter((f) => f && f.topic !== 'rules' && f.scope === 'brand')])].filter((f) => f !== vp).slice(0, k + 12);
    const groups = TOPIC_KEYS.map((t) => [t, chosen.filter((f) => f.topic === t)]);
    return format(name || c.state.meta.name || slug, groups, hits.map((h) => byId.get(h.id)).filter((f) => f?.scope === 'member').slice(0, 4), vp);
  }
  // sync, from the cache (prompts that cannot wait); the first call for a brand warms the cache and returns ''
  function blockSync(slug, { agent = null, memberId = null, name } = {}) {
    const c = cache.get(sk(slug)); if (!c) { warm(slug); return ''; }
    maybeLearn(slug, c);
    if (!c.state.facts.length) return '';
    const { groups, mine } = pick(c.state, { agent, memberId }); return format(name || c.state.meta.name || slug, groups, mine, voicePick(c.state));
  }
  const warm = (slug) => { if (!slug || cache.has(sk(slug))) return; load(slug).then((c) => maybeLearn(slug, c)).catch((e) => log.warn?.('[memory] warm', e.message)); };
  // a brand read that memory has not learned from yet: learn once, in the background
  const maybeLearn = (slug, c) => {
    if (!autoLearn || tried.has(slug) || learning.has(slug) || !live()) return; tried.add(slug);
    packs.getJSON(slug, 'profile.json', null).then((p) => { const readAt = p?.meta?.readAt || null; if (p && readAt && c.state.meta.learnedFrom !== readAt) return learnFromLive(slug); }).catch((e) => log.warn?.('[memory] auto-learn', e.message));
  };

  /* ---------- learn from what is live ---------- */
  // everything the brand pack already read: site, catalog, reviews, own ads, Instagram, the brief.
  // Part 1 is counted, not guessed (direct facts with exact sources). Part 2 is an AI read of the ad and post words and
  // pictures, where every observation must cite the evidence ids it rests on, or it is dropped.
  async function gather(slug) {
    const P = (n, d) => packs.getJSON(slug, n, d);
    const [profile, brief, config, findings] = await Promise.all([P('profile.json', null), P('brief.json', null), P('config.json', {}), P('findings.json', null)]);
    const at = profile?.meta?.readAt ? day(Date.parse(profile.meta.readAt)) : profile?.ads?.at || day(now());
    const name = profile?.name || brief?.name || slug, host = profile?.host || slug;
    const direct = [], ev = [], imgs = [];
    const D = (key, topic, text, label, kind = 'live') => text && direct.push({ key, topic, text: tidy(text, 280), source: { kind, label: `${label}, read ${at}` } });
    if (profile) {
      if (profile.tagline || profile.descriptor) D('live.site.tagline', 'voice', `How the site describes the brand: "${tidy(profile.descriptor || profile.tagline, 120)}"${profile.tagline && profile.descriptor && profile.tagline !== profile.descriptor ? `; page title: "${tidy(profile.tagline, 120)}"` : ''}.`, `${host} homepage`);
      if (profile.category) D('live.site.category', 'products', `Category: ${profile.category}${profile.subcategory ? `, ${profile.subcategory}` : ''}.`, `${host} (brand read)`);
      const id = profile.identity || {};
      if (id.colors?.length) D('live.site.colors', 'creative-style', `Brand colours on the site: ${id.colors.slice(0, 5).join(', ')}.`, `${host} styles`);
      if (id.fonts?.heading || id.fonts?.body) D('live.site.fonts', 'creative-style', `Site type: headings in ${id.fonts.heading || 'the default'}, body in ${id.fonts.body || 'the default'}.`, `${host} styles`);
      const prods = (profile.catalog?.products || []).filter((x) => Number.isFinite(+x.price) && +x.price > 0);
      if (prods.length) {
        const ps = prods.map((x) => +x.price).sort((a, b) => a - b), cur = prods[0].currency || profile.currency || '', med = ps[Math.floor(ps.length / 2)];
        D('live.catalog.range', 'products', `${profile.catalog.count || prods.length} products on the store; prices ${ps[0]} to ${ps[ps.length - 1]} ${cur}, median ${med} ${cur}.`, `${host} product feed`);
        const sale = prods.filter((x) => +x.mrp > +x.price); D('live.catalog.sale', 'offers', sale.length ? `${sale.length} of ${prods.length} products show a compare-at (struck-through) price.` : `None of the ${prods.length} products show a compare-at (struck-through) price.`, `${host} product feed`);
        const types = Object.entries(prods.reduce((m, x) => ((m[x.type || 'other'] = (m[x.type || 'other'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (types.length > 1) D('live.catalog.types', 'products', `Range by type: ${types.map(([k, n]) => `${k} (${n})`).join(', ')}.`, `${host} product feed`);
      }
      if (profile.catalog?.order) D('live.catalog.hero', 'products', `The store leads with ${profile.catalog.order}${profile.catalog.hero?.length ? `: ${profile.catalog.hero.slice(0, 4).join(', ')}` : ''}.`, `${host} homepage`);
      const rv = profile.reviews || {};
      if (rv.total) D('live.reviews.total', 'audience', `${rv.total} reviews found${rv.app ? ` (${rv.app})` : ''}${rv.platforms?.length ? ` across ${rv.platforms.length} platforms` : ''}.`, `${host} reviews`);
      const own = profile.ads?.own || {}, items = own.items || [];
      if (items.length) {
        const fm = items.reduce((m, x) => ((m[x.format || 'other'] = (m[x.format || 'other'] || 0) + 1), m), {});
        D('live.ads.formats', 'creative-style', `${own.live || items.length} live Meta ads at read time; of the ${items.length} read: ${Object.entries(fm).map(([k, n]) => `${n} ${k}`).join(', ')}.`, 'Meta Ad Library');
        const money = /[₹$€£]\s?\d|\b\d[\d,]*\s?(rs|inr|usd)\b|\bfrom \d/i, priced = items.filter((x) => money.test(x.hook || ''));
        D('live.ads.price', 'creative-style', priced.length ? `Price is in the hook of ${priced.length} of ${items.length} live ads (price first), e.g. "${tidy(priced[0].hook, 70)}".` : `None of the ${items.length} live ads put a price in the hook.`, 'Meta Ad Library');
        const ctas = Object.entries(items.reduce((m, x) => (x.cta ? ((m[x.cta] = (m[x.cta] || 0) + 1), m) : m), {})).sort((a, b) => b[1] - a[1]);
        if (ctas.length) D('live.ads.cta', 'creative-style', `Ad buttons used: ${ctas.map(([k, n]) => `${k} (${n})`).join(', ')}.`, 'Meta Ad Library');
        const longest = [...items].sort((a, b) => (b.days || 0) - (a.days || 0))[0];
        if (longest?.days) D('live.ads.longest', 'what-works', `Longest-running live ad (a hint it pays, not proof): "${tidy(longest.hook || longest.body, 80)}", ${longest.format || 'ad'}, ${longest.days} days.`, 'Meta Ad Library');
        items.slice(0, 12).forEach((x, i) => { ev.push({ id: `ad${i + 1}`, label: `own Meta ad ${x.id || i + 1}`, text: `Own Meta ad (${x.format || '?'}, running ${x.days ?? '?'} days, ${x.versions || 1} versions, button "${x.cta || ''}"): hook "${tidy(x.hook, 160)}" | body "${tidy(x.body, 300)}"` }); if (x.poster) imgs.push({ id: `ad${i + 1}`, ref: x.poster, label: `own Meta ad ${x.id || i + 1} (${x.format || '?'})` }); });
      } else if (profile.ads) D('live.ads.none', 'channels', 'No live Meta ads found for the brand’s own page at read time.', 'Meta Ad Library');
      const ig = profile.socials?.instagram;
      if (ig?.posts?.length) {
        const ks = ig.posts.reduce((m, x) => ((m[x.kind || 'post'] = (m[x.kind || 'post'] || 0) + 1), m), {});
        D('live.ig.mix', 'channels', `Instagram @${ig.handle || ''}: of ${ig.posts.length} recent posts, ${Object.entries(ks).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}.`, 'Instagram');
        const top = [...ig.posts].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
        if (top?.likes) D('live.ig.top', 'what-works', `Most-liked recent Instagram post: a ${top.kind || 'post'} with ${top.likes} likes (${top.at || ''}): "${tidy(top.caption, 90)}".`, 'Instagram');
        ig.posts.slice(0, 12).forEach((x, i) => { ev.push({ id: `ig${i + 1}`, label: `Instagram post ${x.at || ''}`.trim(), text: `Instagram ${x.kind || 'post'} (${x.likes ?? '?'} likes, ${x.comments ?? '?'} comments, ${x.at || ''}): "${tidy(x.caption, 300)}"` }); if (x.img) imgs.push({ id: `ig${i + 1}`, ref: x.img, label: `Instagram ${x.kind || 'post'} ${x.at || ''}` }); });
      }
      const tech = profile.site?.tech || {}; const on = Object.entries(tech).filter(([, v]) => v === true).map(([k]) => k).filter((k) => k !== 'shopify');
      if (Object.keys(tech).length) D('live.site.stack', 'channels', `Store on ${profile.platform || 'its own site'}${tech.checkoutApp ? `, checkout ${tech.checkoutApp}` : ''}${tech.chat ? `, chat on ${tech.chat}` : ''}; tools seen on the site: ${on.join(', ') || 'none'}.`, `${host} site scan`);
      if (profile.about) ev.push({ id: 'site', label: `${host} about page`, text: `About: ${tidy(profile.about, 600)}` });
      (profile.reviews?.quotes || []).slice(0, 4).forEach((q, i) => ev.push({ id: `rev${i + 1}`, label: `${q.src || 'review'} review`, text: `Review (${q.rating || '?'}★, ${q.product || ''}): "${tidy(q.text, 200)}"` }));
    }
    if (brief) {
      if (brief.language?.length) D('live.brief.language', 'voice', `Words customers and the brand use: ${brief.language.slice(0, 8).map((x) => `"${tidy(x, 50)}"`).join(', ')}.`, 'reviews and site copy (brand read)');
      (brief.praise || []).filter((x) => !/^no (praise|complaints?)\b/i.test(x)).slice(0, 3).forEach((x, i) => D(`live.brief.praise.${i}`, 'audience', `What customers praise: ${tidy(x, 160)}`, 'reviews (brand read)'));
      (brief.complaints || []).filter((x) => !/^no (praise|complaints?)\b/i.test(x)).slice(0, 2).forEach((x, i) => D(`live.brief.complaint.${i}`, 'audience', `What customers complain about: ${tidy(x, 160)}`, 'reviews (brand read)'));
      (brief.personas || []).slice(0, 4).forEach((x, i) => D(`live.brief.persona.${i}`, 'audience', `${x.name}: ${tidy(x.who, 90)} Wants: ${tidy(x.job, 80)}${x.objections ? ` Holds back on: ${tidy(x.objections, 60)}` : ''}`, `brand read, based on ${x.basedOn || 'evidence'}`));
      (brief.claims || []).slice(0, 4).forEach((x, i) => D(`live.brief.claim.${i}`, 'voice', `Claim the brand makes${x.product && x.product !== 'Brand' ? ` for ${x.product}` : ''}: "${tidy(x.claim, 110)}" (${tidy(x.basis, 40)}).`, 'brand read'));
      (brief.channels || []).slice(0, 6).forEach((x, i) => D(`live.brief.channel.${i}`, 'channels', `${x.channel}: ${tidy(x.evidence, 120)}`, 'brand read'));
      if (brief.businessModel) ev.push({ id: 'model', label: 'brand read: business model', text: `Business model: ${tidy(brief.businessModel, 500)}` });
    }
    const banned = String(config?.banned || '').replace(/\[[^\]]*\]\??/g, '').replace(/\\b|\\w\*|[()?]/g, '').split('|').map((x) => x.trim()).filter(Boolean);
    if (banned.length) D('live.rules.banned', 'rules', `Never use these claim words in copy: ${banned.join(', ')}.`, 'category guard for this brand', 'config');
    if (findings?.cards?.length) findings.cards.filter((x) => x.p).slice(0, 4).forEach((x, i) => ev.push({ id: `find${i + 1}`, label: `brand read: ${x.t}`, text: `${x.t}: ${tidy(x.p, 300)}` }));
    return { name, host, at, direct, ev, imgs, readAt: profile?.meta?.readAt || null };
  }
  const imagePart = async (slug, ref) => {
    try { const m = /\/a\/([\w.-]+)$/.exec(String(ref)); if (!m || !packs.assetFile) return null; const f = await packs.assetFile(slug, m[1]); if (!f || !fs.existsSync(f)) return null;
      const buf = fs.readFileSync(f); if (buf.length > 1.5e6 || buf.length < 2000) return null; const ext = path.extname(f).toLowerCase();
      return { type: 'image', source: { type: 'base64', media_type: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', data: buf.toString('base64') } }; } catch { return null; }
  };
  async function readCreatives(slug, g, { maxImages = 10 } = {}) {
    if (!g.ev.length) return [];
    const content = [], seen = [];
    // pictures: alternate own ads and posts so both are seen
    const ads = g.imgs.filter((x) => x.id.startsWith('ad')), igs = g.imgs.filter((x) => x.id.startsWith('ig')), order = [];
    for (let i = 0; order.length < maxImages && (i < ads.length || i < igs.length); i++) { if (ads[i]) order.push(ads[i]); if (igs[i] && order.length < maxImages) order.push(igs[i]); }
    for (const x of order) { const p = await imagePart(slug, x.ref); if (!p) continue; content.push({ type: 'text', text: `Image ${x.id}: ${x.label}` }, p); seen.push(x.id); }
    const allowed = new Set([...g.ev.map((e) => e.id), ...seen]);
    content.push({ type: 'text', text: `You are building the shared brand memory for ${g.name} (${g.host}). Study what is live: their own ads, Instagram posts${seen.length ? ' (with the pictures above)' : ''}, site and reviews. Write what a new designer or copywriter must know to make work that looks and sounds like ${g.name}.\n\nEvidence (id: text):\n${g.ev.map((e) => `${e.id}: ${e.text}`).join('\n')}\n\nWrite 8 to 18 observations. Cover, where the evidence shows it:\n- voice: tone, person (we/you), sentence length, caps, emoji, recurring words or phrases\n- creative-style: formats, how hooks are built, price first or price last, faces or product only, UGC/creator or studio, backgrounds and colours, text on the image, how the product is framed, drops/collections naming\n- offers: how offers and prices are presented\n- audience: who the work speaks to\n- channels: what each channel is used for\n- what-works: only from engagement or ad longevity in the evidence, said as a signal (\"the most-liked posts are...\"), never as proof\n- rules: only lines the brand clearly keeps (e.g. never shows a discount), with the evidence\nEach observation: one plain sentence under 30 words, specific to ${g.name} (no generic marketing advice), and evidence lists the ids it rests on (at least one; a pattern needs at least two). Only say what the evidence shows: never invent numbers, products or claims. Plain words, no em dashes.` });
    const j = await ai.call({ model: 'sonnet', tag: 'memory-learn', max: 5000, effort: 'medium', messages: [{ role: 'user', content }], schema: { type: 'object', properties: { observations: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string', enum: TOPIC_KEYS }, text: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } } } } } });
    const lab = new Map([...g.ev.map((e) => [e.id, e.label]), ...g.imgs.map((x) => [x.id, x.label])]);
    return (j.json?.observations || []).map((o) => ({ ...o, evidence: (o.evidence || []).filter((id) => allowed.has(id)) })).filter((o) => o.text && o.evidence.length)
      .map((o) => ({ topic: TOPICS[o.topic] ? o.topic : topicOf(o.text), text: tidy(o.text, 260), source: { kind: 'live-read', label: `${[...new Set(o.evidence.map((id) => lab.get(id) || id))].slice(0, 3).join(', ')}${o.evidence.length > 3 ? ` +${o.evidence.length - 3}` : ''}, read ${g.at}`, ref: o.evidence.join(',') } }));
  }
  async function learnFromLive(slug, { images = true } = {}) {
    if (learning.has(slug)) return { busy: true };
    learning.add(slug);
    try {
      const g = await gather(slug), usd0 = ai?.meter?.usd || 0;
      if (!g.direct.length && !g.ev.length) return { slug, added: 0, note: 'Nothing has been read for this brand yet.' };
      const r1 = await ingest(slug, g.direct, { scope: 'brand', by: 'learn-from-live', infer: 'local' });
      let obs = [], err = null;
      if (live()) { try { obs = await readCreatives(slug, g, { maxImages: images ? 10 : 0 }); } catch (e) { err = e.message; log.warn?.('[memory] learn', e.message); } }
      const r2 = obs.length ? await ingest(slug, obs, { scope: 'brand', by: 'learn-from-live' }) : { added: [], updated: [], deleted: [], same: [] };
      const c = await load(slug); c.state.meta.learnedAt = now(); c.state.meta.learnedFrom = g.readAt; c.state.meta.name = g.name; await withLock(slug, () => save(slug, c));
      const con = await consolidate(slug).catch((e) => ({ error: e.message }));
      const all = merge(r1, r2);
      return { slug, direct: g.direct.length, observations: obs.length, added: all.added.length, updated: all.updated.length, deleted: all.deleted.length, confirmed: all.same.length, consolidated: con, usd: +((ai?.meter?.usd || 0) - usd0).toFixed(4), aiError: err, ai: live() };
    } finally { learning.delete(slug); }
  }

  /* ---------- dreaming: merge duplicates, drop stale or contradicted lines, keep each topic small ---------- */
  async function consolidate(slug) {
    return withLock(slug, async () => {
      const c = await load(slug), st = c.state, t0 = now(), out = { merged: 0, deleted: 0 };
      const drop = (f, why) => { st.facts = st.facts.filter((x) => x.id !== f.id); record(c, 'DELETE', f, { before: f.text, by: 'dreaming', why, source: { kind: 'consolidate', label: 'memory tidy-up' } }); out.deleted++; };
      // exact duplicates (same words, same scope): keep the stronger, carry its sources over
      const seen = new Map();
      for (const f of [...st.facts].sort((a, b) => weight(b) - weight(a))) { const k = `${f.scope}|${f.memberId || ''}|${f.runId || ''}|${f.hash}`; const keep = seen.get(k);
        if (keep) { keep.n = (keep.n || 1) + (f.n || 1); keep.sources = [...(keep.sources || []), ...(f.sources || [])].slice(0, 5); drop(f, `duplicate of ${keep.id}`); out.merged++; } else seen.set(k, f); }
      st.facts.filter((f) => f.scope === 'run' && t0 - f.updatedAt > RUN_TTL).forEach((f) => drop(f, 'session ended'));
      // the AI pass: per brand topic, only when a topic has grown
      if (live()) {
        const big = TOPIC_KEYS.map((k) => [k, st.facts.filter((f) => f.scope === 'brand' && f.topic === k && !f.key)]).filter(([, xs]) => xs.length >= 6); // counted facts are kept true by their key, not here
        if (big.length) {
          try {
            const idx = [], lines = big.map(([k, xs]) => `## ${k}\n${xs.map((f) => { idx.push(f); return `${idx.length - 1}: ${f.text} [source: ${srcLine(f)}; ${day(f.updatedAt)}${f.measured ? '; measured' : ''}]`; }).join('\n')}`).join('\n\n');
            const j = await ai.call({ model: 'sonnet', tag: 'memory-dream', max: 4000, effort: 'low', schema: { type: 'object', properties: { merge: { type: 'array', items: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, text: { type: 'string' } } } }, drop: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } } } } } },
              prompt: `Tidy this brand memory so it stays small and true. Per topic:\n- merge: lines that say the same thing (or one is a subset of another). text = one line that keeps every fact from them, nothing added.\n- drop: a line that a newer or stronger line contradicts (measured results beat team notes beat live reads beat older reads), or that is too vague to change any work. why = short reason.\nLeave everything else alone (most lines should stay). Never merge lines from different topics. Never invent.\n\n${lines}` });
            const used = new Set();
            for (const m of j.json?.merge || []) { const fs2 = (m.ids || []).map((i) => idx[+i]).filter((f) => f && !used.has(f.id) && st.facts.includes(f)); if (fs2.length < 2 || !m.text) continue;
              const [keep, ...rest] = fs2.sort((a, b) => weight(b) - weight(a)); const before = keep.text; fs2.forEach((f) => used.add(f.id));
              keep.text = tidy(m.text, 300); keep.hash = hashOf(keep.text); keep.n = fs2.reduce((s, f) => s + (f.n || 1), 0); keep.sources = fs2.flatMap((f) => f.sources || [f.source]).slice(0, 5); keep.updatedAt = t0;
              if (embed) { const v = (await embed([keep.text], 'doc').catch(() => null))?.[0]; if (v) c.vecs[keep.id] = packVec(v); }
              record(c, 'MERGE', keep, { before, by: 'dreaming', why: `merged ${rest.map((f) => f.id).join(', ')}`, source: { kind: 'consolidate', label: 'memory tidy-up' } });
              rest.forEach((f) => { st.facts = st.facts.filter((x) => x.id !== f.id); }); out.merged += rest.length; }
            for (const d of j.json?.drop || []) { const f = idx[+d.id]; if (f && !used.has(f.id) && st.facts.includes(f) && !f.measured) { used.add(f.id); drop(f, tidy(d.why || 'stale', 120)); } }
          } catch (e) { log.warn?.('[memory] dream', e.message); out.error = e.message; }
        }
      }
      // hard cap per topic: the weakest lines go first
      for (const k of TOPIC_KEYS) { const xs = st.facts.filter((f) => f.scope === 'brand' && f.topic === k && f.key !== VOICE_KEY).sort((a, b) => weight(b) - weight(a)); xs.slice(MAX_PER_TOPIC).forEach((f) => drop(f, 'topic full, weakest line')); }
      st.meta.consolidatedAt = t0; await save(slug, c); return out;
    });
  }

  /* ---------- outcomes: lessons, results and rules learned in jams feed the shared memory ---------- */
  async function ingestOutcome(slug, { text, kind = 'lesson', memberId = null, personal = false, measured = null, label = '', ref = null, topic = null } = {}) {
    if (!slug || !text) return null;
    const m = measured ? ` (${measured.metric}: ${measured.before} → ${measured.after}, ${measured.change}${measured.win ? '' : ', missed target'})` : '';
    const source = { kind: measured ? 'result' : kind === 'rule' ? 'team' : kind, label: tidy(`${measured ? 'measured result' : kind}${label ? `: ${label}` : ''}`, 150), ref };
    if (personal) return memberId ? ingest(slug, [{ text, topic: topic || topicOf(text), source }], { scope: 'member', memberId, by: kind, infer: true }) : null;
    return ingest(slug, [{ text: `${text}${m}`, topic: topic || (measured ? 'what-works' : kind === 'rule' ? 'rules' : topicOf(text)), measured, source }], { scope: 'brand', by: kind, infer: true });
  }

  // several facts at once, each with its own topic and source (brand-learnings.js): one compare-and-decide pass, one save
  async function addFacts(slug, items, { by = 'brew', infer = true } = {}) {
    const list = (items || []).filter((x) => x?.text && srcOf(x.source));
    if (!list.length) return { added: [], updated: [], deleted: [], same: [] };
    return ingest(slug, list, { scope: 'brand', by, infer: infer === true ? true : 'local' });
  }

  return { add, addFacts, search, repo, promptBlock, blockSync, warm, learnFromLive, consolidate, forget, ingestOutcome, gather, load, _cache: cache };
}

/* ---------- hooks for learn.js (set from server.js when BRAND_MEMORY is on) ---------- */
// learn.js stays synchronous: prompts read the cached block; lessons, rules and checks go to memory in the background
export function memoryHooks(memory, { slugOf = (t) => t?.brandId || null, nameOf = () => null, canWrite = async () => true, log = console } = {}) {
  const bg = (p) => Promise.resolve(p).catch((e) => log.warn?.('[memory] hook', e.message));
  /* a claimed brand's shared memory is written only from a team member's workspace (canWrite checks membership now) */
  const gate = (s, t, fn) => bg(Promise.resolve(canWrite(s, t)).then((ok) => ok ? fn() : null));
  const who = (t) => memberKey(t?.memberEmail);
  return {
    block: (t, agent) => { const s = slugOf(t); return s ? memory.blockSync(s, { agent, memberId: who(t), name: nameOf(s) }) : ''; },
    blockAsync: async (t, agent, query) => { const s = slugOf(t); if (!s) return ''; let tm; // never hold a prompt more than 4s: fall back to the cached block
      try { return await Promise.race([memory.promptBlock(s, { agent, query, memberId: who(t), name: nameOf(s) }), new Promise((r) => { tm = setTimeout(() => r(memory.blockSync(s, { agent, memberId: who(t), name: nameOf(s) })), 4000); })]); } finally { clearTimeout(tm); } },
    onLesson: (t, y, x) => { const s = slugOf(t); if (!s || !y) return; if (y.n > 1 && !x?.measured) return; // a plain confirmation is already in memory
      gate(s, t, () => memory.ingestOutcome(s, { text: y.text, kind: 'lesson', personal: y.kind === 'you', memberId: who(t), measured: x?.measured || null, label: [x?.step, x?.title && `“${String(x.title).slice(0, 60)}”`].filter(Boolean).join(' on '), ref: y.id })); },
    onRule: (t, r) => { const s = slugOf(t); if (s && r?.text) gate(s, t, () => memory.ingestOutcome(s, { text: r.text, kind: 'rule', label: `learned from ${r.n || 'several'} ${r.source || 'edits'}`, ref: r.id, topic: 'rules' })); },
    onCheck: (t, ac) => { const s = slugOf(t); if (s && ac?.q) gate(s, t, () => memory.ingestOutcome(s, { text: `${ac.q} The team's answer: ${ac.answer}`, kind: 'rule', label: `answered the same way in ${ac.n} jams`, ref: ac.id, topic: 'rules' })); }
  };
}
