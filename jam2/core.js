// Jam v2: the jam model. A jam is one Concept (one idea from one spark) shown on one board: the idea strip on top (spark →
// angle → goal → audience → proof → offer), artboards under it (each a deliverable with its takes), and the pack. The first
// board is the card's own format; "+ Add" puts more on the same idea. One take at a time (Redo for the next), never options.
//   jam   { id, v: 2, cardId, owner, title, concept, boards: [board], post, brief, by, createdAt, updatedAt, from }
//   board { id, recipe, kind, how, size, conceptRev, status: 'draft'|'approved'|'stale', takes: [take], head, approved }
//   take  { id, n, parent, by, at, op, scene, timeline, doc, text, assets, gate, made: [{ cap, provider, model, usd, credits }], cost }
import crypto from 'node:crypto';
import { recipe, recipeFor, SIZES } from './catalogue.js';
import { isPrivateCard } from '../connectors/common.js';

export const uid = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
export const GOALS = ['awareness', 'launch', 'conversion', 'community'];
const tidy = (s, n = 240) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

/* the spark a card carries: what inspired it, in words (a rival ad is read into words elsewhere; its pixels never travel) */
export function sparkOf(c = {}) {
  const k = c.research?.kind || (c.heard || c.post ? 'thread' : null);
  const kind = k === 'ad' ? 'rival ad' : k === 'viral' ? 'viral video' : k === 'thread' || /heard|listen/.test(String(c.agent || c.from || '')) ? 'community thread' : c.agent ? 'move' : 'idea';
  return { kind, title: tidy(c.title, 140), says: tidy(c.sub, 300), why: (c.detail?.why || []).slice(0, 3).map((x) => tidy(x, 200)), link: c.research?.url || c.post?.url || c.url || null, cardId: c.id || null };
}
/* the idea strip before the writer has run: honest, from the card alone */
export function seedConcept(c = {}, bb = {}) {
  const goal = /launch|new|drop/i.test(`${c.title} ${c.sub}`) ? 'launch' : /reply|thread|community|reddit|quora/i.test(`${c.title} ${c.agent}`) ? 'community' : /aware|reach|trend/i.test(`${c.title}`) ? 'awareness' : 'conversion';
  return { rev: 1, spark: sparkOf(c), angle: tidy(c.title, 120), goal, audience: tidy(bb.personas?.[0] ? `${bb.personas[0].name}: ${bb.personas[0].who}` : '', 160), proof: (bb.reviews || []).slice(0, 2).map((r) => ({ kind: 'review', text: r.text })), offer: '', by: 'card' };
}
export function newBoard(recipeId, { how = null, size = null, conceptRev = 1, label = null, ask = '' } = {}) {
  const r = recipe(recipeId) || recipe('image-ad');
  return { id: uid('bd'), recipe: r.id, kind: r.kind, label: tidy(label || r.label, 40), ask: tidy(ask, 300), how: how && r.how.includes(how) ? how : r.how[0], size: size || r.sizes[0] || null, conceptRev, status: 'draft', takes: [], head: null, approved: null, brief: null, createdAt: Date.now() };
}
/* plan: the boards the card's button makes (catalogue.js planFor), first one first; without a plan, the one recipe that fits */
export function newJam({ card = null, owner, by = null, recipeId = null, bb = {}, how = null, plan = null, cta = null }) {
  const rid = recipeId || (card ? recipeFor(card) : 'image-ad'), concept = card ? seedConcept(card, bb) : { rev: 1, spark: { kind: 'idea', title: '', says: '' }, angle: '', goal: 'conversion', audience: '', proof: [], offer: '', by: 'blank' };
  const pref = bb.comfort?.how, list = plan?.length && !recipeId ? plan : [{ recipe: rid }];
  const boards = list.slice(0, 4).map((p) => { const r = recipe(p.recipe); return newBoard(p.recipe, { how: how || (pref && r?.how.includes(pref) ? pref : null), label: p.label, ask: p.ask }); });
  /* priv: made from a team-only card (a connected account's numbers): its public links never show the card's words (publicView) */
  return { id: uid('j2'), v: 2, cardId: card?.id || null, ...(card && isPrivateCard(card) ? { priv: true } : {}), cta: tidy(cta, 60) || null, owner, title: tidy(card?.title || recipe(list[0].recipe)?.label || 'New jam', 90), concept, boards, post: null, brief: null, chat: [], by, createdAt: Date.now(), updatedAt: Date.now(), log: [] };
}
export const boardOf = (j, bid) => (j.boards || []).find((b) => b.id === bid) || null;
export const headOf = (b) => (b?.takes || []).find((t) => t.id === b.head) || (b?.takes || [])[b.takes.length - 1] || null;
export function addTake(j, b, take) { const n = (b.takes.length ? Math.max(...b.takes.map((t) => t.n || 0)) : 0) + 1; const t = { id: uid('tk'), n, at: Date.now(), ...take }; b.takes.push(t);
  if (b.approved) note(j, `${b.label}: a new version landed, so it needs a new OK`); b.head = t.id; b.status = 'draft'; b.approved = null; j.updatedAt = Date.now();
  /* history keeps the newest 40 versions (and any approved one): every drag is a version, and the jam is saved whole every few seconds */
  if (b.takes.length > 40) { const keep = new Set([b.head, b.approved?.takeId].filter(Boolean)); const drop = b.takes.length - 40; let k = 0; b.takes = b.takes.filter((x) => keep.has(x.id) || ++k > drop); }
  return t; }
export const note = (j, line, by = null) => { (j.log ||= []).push({ at: Date.now(), by, line: tidy(line, 200) }); if (j.log.length > 200) j.log.splice(0, j.log.length - 200); };
/* the idea changed: every board made on an older idea says so (words refresh free; pictures show a price) */
export function bumpConcept(j, patch = {}, by = null) {
  const c = j.concept, keys = ['angle', 'goal', 'audience', 'offer']; let changed = false;
  for (const k of keys) { if (patch[k] === undefined || (k === 'goal' && !GOALS.includes(patch[k]))) continue; if (tidy(patch[k], 300) !== c[k]) { c[k] = tidy(patch[k], 300); changed = true; } }
  if (Array.isArray(patch.proof)) { c.proof = patch.proof.slice(0, 6).map((p) => ({ kind: p.kind || 'note', text: tidy(p.text, 240) })); changed = true; }
  if (!changed) return false; c.rev = (c.rev || 1) + 1; c.by = by?.email || 'team';
  for (const b of j.boards) if (b.takes.length && b.conceptRev < c.rev) b.status = 'stale';
  j.updatedAt = Date.now(); return true;
}
/* v1 → v2: a card that already has a v1 jam opens in v2 with a copy of what it made (read only; v1 is never written) */
export function fromV1(w = {}, ch = null, versions = []) {
  const assets = [];
  for (const d of w.drafts || []) if (d.image || d.video || d.render) assets.push({ kind: d.video ? 'video' : 'image', file: d.render || d.image || d.video, words: d.headline || d.title || '', copy: d.copy || '', at: d.at || d.createdAt || null, from: 'v1 draft' });
  for (const v of versions || []) { const m = v.media || v.pkg?.media || {}; const f = m.render || m.image || v.image || null; if (f) assets.push({ kind: 'image', file: f, words: v.pkg?.headline || v.title || '', copy: v.pkg?.primary || v.pkg?.copy || '', at: v.at || null, from: `v1 version ${v.n || ''}`.trim() }); }
  return { assets: assets.slice(0, 12), brief: w.doc?.md || w.jamBrief?.md || null, title: w.title || null };
}
export const sizeOf = (b) => SIZES[b?.size] || SIZES['ig-portrait'];
/* the brief a team makes a board from: built from the board's current take, every section editable (board.brief.edits) */
export const OWNERS = ['ShopOS team', 'Your in-house team', 'A creator', 'Your agency'];
export const BRIEF_STATUS = ['sent', 'received', 'in progress', 'delivered'];
export function briefOf(j, b) {
  const r = recipe(b.recipe) || {}, t = headOf(b) || {}, w = t.words || {}, c = j.concept || {}, br = b.brief || {};
  const words = r.kind === 'video' ? (t.timeline?.shots || w.shots || []).map((s, i) => `${i + 1}. ${s.see || ''}${s.vo ? ` · VO: “${s.vo}”` : ''}${s.words ? ` · on screen: ${s.words}` : ''}`).join('\n')
    : r.kind === 'carousel' ? (w.slides || []).map((s, i) => `${i + 1}. ${s.onSlide || ''}`).join('\n')
    : r.kind === 'table' ? (w.rows || []).map((x) => [x.a, x.b, x.c].filter(Boolean).join(' · ')).join('\n')
    : ['creator', 'script', 'shoot', 'act'].includes(r.kind) ? (w.blocks || []).map((x) => `${x.title}: ${x.text}`).join('\n')
    : r.kind === 'static' ? [w.headline && `On the picture: ${w.headline}`, w.sub, w.badge && `Badge: ${w.badge}`, w.caption && `Caption: ${w.caption}`].filter(Boolean).join('\n')
    : [w.subject && `Subject: ${w.subject}`, w.body || w.caption, w.cta && `Button: ${w.cta}`].filter(Boolean).join('\n');
  const sizes = (r.sizes || []).map((k) => SIZES[k]?.label).filter(Boolean);
  const spec = r.kind === 'video' ? `${r.seconds || 15} s · 9:16 MP4 · voiceover · captions from the voiceover (SRT attached; burn them in) · music: the mood in the storyboard, licensed${sizes.length ? ` · also ${sizes.join(', ')}` : ''}`
    : r.kind === 'table' ? 'Apply each row by hand in the tool it names; the sheet is attached.' : sizes.length ? `${sizes.join(' · ')} · JPG at least 1080 px · words clear of the app’s own bars` : 'Plain text, pasted as it is where it runs.';
  const done = r.kind === 'table' ? 'Every row is applied; reply “done” and Brew checks the account.' : r.kind === 'video' ? 'The cut is back in this jam; Brew checks it against this brief.' : sizes.length ? 'Every size is back in this jam and approved.' : 'It’s posted or scheduled; paste the link in the jam.';
  const base = [['What to make', `${b.label}${r.looks ? `: ${r.looks}` : ''}`], ['Why', [c.spark?.title, c.spark?.says].filter(Boolean).join(' · ') || c.angle || ''], ['The words · final', words || 'Brew is still writing them.'],
    ['Specs', spec], ['References', `Brew’s draft${t.n ? ` v${t.n}` : ''} (attached) · the Brand Book${/rival|viral/.test(c.spark?.kind || '') ? ` · the original ${c.spark.kind}, for its pattern only: never copy it` : ''}`],
    ['Must-haves', 'The real product photo, never redrawn · only claims from the store and its reviews'], ['Who and when', `${br.owner || OWNERS[0]}${br.due ? ` · due ${br.due}` : ''}`], ['Done when', done]];
  return base.map(([h, v], i) => ({ h, t: br.edits?.[i] != null ? br.edits[i] : v }));
}
/* what the client sees: the jam with each board's head take first and its brief */
export const jamView = (j) => ({ ...j, boards: j.boards.map((b) => ({ ...b, headTake: headOf(b), briefView: briefOf(j, b) })) });

/* what a public link (/p/, /brief/) may show of a jam: one made from a team-only card (a connected account's numbers: ROAS, spend,
   orders) keeps its title and "Why" to the team; jams saved before priv existed are judged by their card id */
export function publicView(j) {
  if (!j || !(j.priv || isPrivateCard({ id: j.cardId || '' }))) return j;
  const label = recipe(j.boards?.[0]?.recipe)?.label || j.boards?.[0]?.label || 'Brew brief';
  const boards = (j.boards || []).map((b) => (b.brief?.edits?.[1] != null ? { ...b, brief: { ...b.brief, edits: Object.assign([...b.brief.edits], { 1: null }) } } : b)); /* a team edit of the Why row stays with the team too */
  return { ...j, title: label, boards, concept: { ...(j.concept || {}), spark: { kind: j.concept?.spark?.kind || 'idea', title: '', says: '' }, angle: 'From the brand’s own accounts (kept with the team).', proof: [] } };
}
