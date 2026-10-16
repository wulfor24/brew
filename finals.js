// Finals: the go-live image or video a brand's team asks Sloosh for, behind one button, never from chat. The flow is
// quote → the team's yes on that quote → generate (or run a Space) → poll → the asset's link → bytes in gen/ → a version.
// Every run has a key written to brands/<slug>/private/finals/<key>.json BEFORE the paid call, so a crash or a deploy
// never pays twice: on boot reconcileAll() finishes or fails each run still open. Credits are counted twice over:
// Sloosh's own daily limit on Brew's workspace is the hard stop; budget.js 'credits' (a site cap and a per-brand share)
// keeps one brand from using the whole workspace. On the demo site (and with SLOOSH_DUMMY=1) nothing is paid:
// DUMMY: the draft's own picture comes back as the final, tagged Dummy (DUMMY.md row 8).
import crypto from 'node:crypto';
import { buildFinal } from './sloosh-prompt.js';
import { formOf, prefill } from './sloosh-spaces.js';

const DIR = 'private/finals/', ASSETS = 'private/sloosh-assets.json', MAX_BYTES = 64 * 1024 * 1024, QUOTE_FRESH_MS = 4 * 60e3;
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
/* the first value under any of these keys, dotted paths allowed: Sloosh's field names are read at run time */
export const pick = (o, ...keys) => { for (const k of keys) { let x = o; for (const p of k.split('.')) x = x?.[p]; if (x !== undefined && x !== null && x !== '') return x; } return undefined; };
const idOf = (o) => pick(o, 'id', 'asset_id', 'assetId', 'generation_id', 'generationId', 'operation_id', 'operationId', 'run_id', 'runId', 'quote_id', 'quoteId', 'asset.id', 'generation.id', 'run.id', 'quote.id');
const outputsOf = (o) => { const xs = pick(o, 'outputs', 'assets', 'results', 'generation.outputs', 'run.outputs', 'result.outputs'); return Array.isArray(xs) ? xs : xs ? [xs] : []; };
const linkOf = (o) => pick(o, 'url', 'link', 'download_url', 'downloadUrl', 'asset.url', 'asset.link', 'file.url', 'urls.original', 'src');
const creditsOf = (o) => +pick(o, 'credits', 'cost', 'price', 'estimated_credits', 'estimatedCredits', 'quote.credits', 'expected_credits', 'total_credits', 'charge', 'charged_credits') || 0;
const holdOf = (o) => +pick(o, 'max_credits', 'maxCredits', 'hold', 'maximum', 'max_hold', 'quote.max_credits', 'hold_credits') || 0;
const expiresOf = (o) => { const e = pick(o, 'expires_at', 'expiresAt', 'quote.expires_at', 'valid_until'); const t = typeof e === 'number' ? (e < 1e12 ? e * 1e3 : e) : Date.parse(e || ''); return Number.isFinite(t) ? t : Date.now() + 5 * 60e3; };
const CHECK = /^(waiting|awaiting[_ ]?approval|checkpoint|paused|needs[_ ]?approval|pending[_ ]?approval)$/;

export function createFinals({ sloosh, slooshAuth, packs, budget, saveGen, genFlush = async () => {}, publicUrl = process.env.PUBLIC_URL || '', fetchImpl = fetch, slugs = async () => [], log = console, now = Date.now,
  dummy = () => process.env.DEMO_MODE === '1' || process.env.SLOOSH_DUMMY === '1', readFile = null } = {}) {
  const inflight = new Map(); /* runKey → promise, this instance */
  let statusMemo = null;

  /* ---------- the connection, in plain words ---------- */
  async function status({ fresh = false } = {}) {
    if (dummy()) return { ok: true, dummy: true, why: null };
    if (!fresh && statusMemo && now() - statusMemo.at < 60e3) return statusMemo.v;
    const st = await slooshAuth.status(); let v;
    if (!st.connected) v = { ok: false, why: 'Brew is not connected to Sloosh yet. Brew staff connect it from the ops page.' };
    else { try { const c = await sloosh.getConnection(); const left = pick(c, 'limit.remaining', 'daily_limit.remaining', 'remaining', 'remaining_today', 'limit_remaining', 'today.remaining'); const limit = pick(c, 'limit.daily', 'daily_limit.amount', 'daily_limit', 'limit');
        const set = limit !== undefined ? +limit > 0 : left !== undefined; v = { ok: set, workspace: pick(c, 'workspace.name', 'workspace') || st.workspace?.name || null, left: left !== undefined ? +left : null, limit: limit !== undefined ? +limit : null, scope: pick(c, 'scopes', 'permissions', 'scope') || st.scope, why: set ? null : 'Sloosh has no daily limit set for agents on Brew’s workspace yet, so nothing paid can run. Brew staff set it on sloosh.ai.' }; }
      catch (e) { v = { ok: false, why: e.expired ? 'Sloosh needs Brew staff to reconnect.' : `Sloosh did not answer: ${e.message}`, error: e.message }; } }
    statusMemo = { at: now(), v }; return v;
  }

  /* ---------- Brew's files as Sloosh assets, imported once ---------- */
  const assetCache = async (slug) => (await packs.getJSON(slug, ASSETS, null)) || {};
  async function assetFor(slug, ref) {
    const rel = String(ref?.url || ref?.file || ref?.rel || ref || '').trim(); if (!rel) throw new Error('a reference with no file');
    if (ref?.assetId) return ref.assetId;
    const url = /^https?:\/\//.test(rel) ? rel : `${publicUrl.replace(/\/$/, '')}/${rel.replace(/^\//, '')}`;
    const cache = await assetCache(slug), key = sha(url); if (cache[key]?.assetId) return cache[key].assetId;
    const r = await sloosh.importAsset(url, ref?.label || undefined); const assetId = idOf(r);
    if (!assetId) throw Object.assign(new Error(`Sloosh import_asset gave no asset id (keys: ${Object.keys(r || {}).join(', ')})`), { schema: true });
    cache[key] = { assetId, url, at: now() }; await packs.put(slug, ASSETS, cache); return assetId;
  }
  const withAssets = async (slug, refs = []) => Promise.all(refs.map(async (r) => ({ ...r, assetId: await assetFor(slug, r) })));

  /* ---------- quote: free, good for five minutes, shown before any yes ---------- */
  async function quote(slug, spec = {}) {
    const st = await status(); if (!st.ok) return { error: st.why };
    const share = budget.refusal('credits', slug, 1); if (share) return { error: budget.why('credits', slug, spec.brandName) };
    if (dummy()) return { quoteId: 'dummy', credits: 0, dummy: true, model: spec.space ? null : buildFinal(spec).model, space: spec.space || null, prompt: spec.space ? null : buildFinal(spec).prompt, settings: spec.space ? null : buildFinal(spec).settings, refs: spec.refs || [], expiresAt: now() + 3600e3, at: now() };
    const refs = await withAssets(slug, spec.refs || []);
    let q, out;
    if (spec.space) { const schema = await sloosh.getSpaceInputSchema(spec.space.id); const fields = formOf(pick(schema, 'schema', 'input_schema', 'inputSchema') || schema); const pre = prefill(fields, spec.space.ctx || {});
      const inputs = { ...pre.values, ...(spec.space.inputs || {}) }; const missing = pre.missing.filter((m) => inputs[m.key] == null);
      if (missing.length) return { error: `The Space still needs ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`, missing, fields, inputs, filled: pre.filled };
      q = await sloosh.quoteSpace({ id: spec.space.id, inputs }); out = { space: { id: spec.space.id, name: spec.space.name || null }, inputs, fields, filled: pre.filled, prompt: null, settings: null, model: null }; }
    else { const b = buildFinal({ ...spec, refs }); q = await sloosh.quoteGeneration({ prompt: b.prompt, model: b.model, references: refs.map((r) => r.assetId), ratio: b.settings.aspect_ratio, resolution: b.settings.resolution, seconds: b.settings.duration, sound: b.settings.sound, count: spec.count || 1 }); out = { model: b.model, why: b.why, prompt: b.prompt, settings: b.settings, space: null }; }
    const credits = creditsOf(q), hold = holdOf(q) || credits, quoteId = idOf(q);
    if (!quoteId) return { error: `Sloosh quoted without a quote id (keys: ${Object.keys(q || {}).join(', ')})` };
    if (st.left != null && hold > st.left) return { error: `This would hold ${hold} credits and Brew’s Sloosh workspace has ${st.left} left today. It resets at midnight UTC.`, credits, hold };
    const over = budget.refusal('credits', slug, Math.ceil(credits)); if (over) return { error: budget.why('credits', slug, spec.brandName, Math.ceil(credits)), credits };
    return { quoteId, credits, hold, expiresAt: expiresOf(q), at: now(), refs, ...out, raw: q };
  }

  /* ---------- run: the yes on a quote; written before the paid call; idempotent on the key ---------- */
  const recName = (key) => `${DIR}${key}.json`;
  const readRec = (slug, key) => packs.getJSON(slug, recName(key), null);
  const writeRec = async (slug, rec) => { await packs.put(slug, recName(rec.runKey), rec); return rec; };
  const runKeyOf = (slug, target, spec) => sha(`${slug}|${JSON.stringify(target || {})}|${JSON.stringify({ k: spec.kind, p: spec.prompt || spec.visual, s: spec.space?.id, i: spec.space?.inputs, r: (spec.refs || []).map((r) => r.url || r.file || r.id), t: spec.text, v: spec.revise?.change, n: spec.revision || 0 })}`);

  async function run(slug, spec = {}, { quote: q, by = null, target = null } = {}) {
    if (!q?.quoteId) throw new Error('a final needs its quote first');
    const runKey = runKeyOf(slug, target, spec); const prior = await readRec(slug, runKey);
    if (prior?.state === 'done') return prior; if (inflight.has(runKey)) return inflight.get(runKey);
    const p = (async () => {
      let rec = prior && prior.state !== 'failed' ? prior : { id: 'fn_' + runKey.slice(0, 8), runKey, state: 'starting', kind: spec.kind || 'image', quote: { id: q.quoteId, credits: q.credits, hold: q.hold, model: q.model, space: q.space, expiresAt: q.expiresAt }, credits: q.credits, model: q.model, space: q.space, prompt: q.prompt, settings: q.settings, inputs: q.inputs || null, refs: (q.refs || []).map((r) => ({ id: r.id, job: r.job, label: r.label, keep: r.keep, assetId: r.assetId || null })), target, by, at: now(), dummy: !!q.dummy, revision: spec.revision || 0 };
      if (rec.state === 'starting') {
        if (q.dummy) { /* DUMMY: the draft's own picture is the "final" (demo site); nothing is paid */
          const from = spec.fromFile; if (!from) throw new Error('nothing to show as the final here');
          rec = { ...rec, state: 'done', file: from, link: null, assetId: null, charged: 0, doneAt: now() }; return writeRec(slug, rec); }
        if (now() - (q.at || 0) > QUOTE_FRESH_MS) throw Object.assign(new Error('That quote is more than four minutes old. Ask for a fresh one.'), { stale: true });
        if (!budget.spend('credits', slug, Math.ceil(q.credits || 0) || 1)) throw Object.assign(new Error(budget.why('credits', slug, null, Math.ceil(q.credits || 0) || 1)), { budget: true });
        await writeRec(slug, rec);
        const r = q.space ? await sloosh.runSpace({ quote: q.quoteId, runKey, confirmed: true, id: q.space.id }) : await sloosh.generate({ quote: q.quoteId, runKey, confirmed: true });
        rec = { ...rec, state: 'running', genId: idOf(r) || null, startedAt: now() }; await writeRec(slug, rec);
      }
      return finish(slug, rec);
    })().finally(() => inflight.delete(runKey));
    inflight.set(runKey, p); return p;
  }
  /* poll to the end, pull the bytes, keep the record honest; a Space waiting on a checkpoint stops here with state 'checkpoint' */
  async function finish(slug, rec) {
    const getter = rec.space ? () => sloosh.getSpaceRun(rec.genId) : () => sloosh.getGeneration(rec.genId);
    let last;
    try { last = await sloosh.wait(async () => { const x = await getter(); const s = sloosh.stateOf(x); if (rec.space && CHECK.test(s)) throw Object.assign(new Error('checkpoint'), { checkpoint: x }); return x; }, { every: rec.kind === 'video' || rec.space ? 10e3 : 5e3, maxMs: 20 * 60e3, onStep: (s) => { rec.step = s; } }); }
    catch (e) { if (e.checkpoint) { rec = { ...rec, state: 'checkpoint', checkpoint: pick(e.checkpoint, 'checkpoint', 'pending_step', 'step', 'approval') || e.checkpoint, checkpointAt: now() }; return writeRec(slug, rec); }
      rec = { ...rec, state: 'failed', error: e.message, failedAt: now(), charged: creditsOf(e.final) || null }; await writeRec(slug, rec); throw Object.assign(e, { rec }); }
    const outs = rec.space ? outputsOf(await sloosh.getSpaceRunOutputs(rec.genId).catch(() => last)).concat(outputsOf(last)) : outputsOf(last);
    const first = outs[0]; if (!first) { rec = { ...rec, state: 'failed', error: `Sloosh finished with no output (keys: ${Object.keys(last || {}).join(', ')})`, charged: creditsOf(last) || null }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    let link = linkOf(first), assetId = idOf(first) || (typeof first === 'string' ? first : null);
    if (!link && assetId) link = linkOf(await sloosh.getAsset(assetId));
    if (!link) { rec = { ...rec, state: 'failed', error: `Sloosh gave no link for the output (keys: ${Object.keys(first || {}).join(', ')})` }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    const r = await fetchImpl(link, { signal: AbortSignal.timeout(180e3) }); if (!r.ok) { rec = { ...rec, state: 'failed', error: `the output could not be fetched (${r.status})`, link, assetId }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    const len = +r.headers.get('content-length') || 0; if (len > MAX_BYTES) { rec = { ...rec, state: 'failed', error: 'the output is over 64 MiB', link, assetId }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    const buf = Buffer.from(await r.arrayBuffer()); const type = r.headers.get('content-type') || ''; const ext = /mp4|video/.test(type) || /\.mp4(\?|$)/.test(link) ? 'mp4' : /jpe?g/.test(type) || /\.jpe?g(\?|$)/.test(link) ? 'jpg' : 'png';
    const name = `fin-${sha(buf)}.${ext}`; saveGen(name, buf); await genFlush();
    rec = { ...rec, state: 'done', file: 'gen/' + name, link, assetId, outputs: outs.slice(0, 12).map((o) => ({ assetId: idOf(o) || null, link: linkOf(o) || null })), charged: creditsOf(last) || rec.credits, doneAt: now() };
    return writeRec(slug, rec);
  }
  /* a Space checkpoint: the team's yes or no, then the run goes on */
  async function checkpoint(slug, runKey, ok, note = '') {
    const rec = await readRec(slug, runKey); if (!rec || rec.state !== 'checkpoint') return { error: 'nothing is waiting here' };
    const cid = idOf(rec.checkpoint) || null; await (ok ? sloosh.approveCheckpoint({ id: rec.genId, ...(cid ? { checkpoint: cid } : {}), ...(note ? { note } : {}) }) : sloosh.rejectCheckpoint({ id: rec.genId, ...(cid ? { checkpoint: cid } : {}), ...(note ? { note } : {}) }));
    if (!ok) { const r2 = { ...rec, state: 'failed', error: 'stopped at the checkpoint', failedAt: now() }; return writeRec(slug, r2); }
    const p = finish(slug, { ...rec, state: 'running' }).finally(() => inflight.delete(runKey)); inflight.set(runKey, p); return p;
  }

  /* ---------- after a restart: every run still open is finished or failed, never paid again ---------- */
  async function reconcileAll() {
    if (dummy()) return 0; let n = 0;
    for (const slug of await slugs().catch(() => [])) {
      const files = await packs.listFiles(slug, DIR.replace(/\/$/, '')).catch(() => []);
      for (const f of files) { const rec = await packs.getJSON(slug, DIR + f, null); if (!rec || !['starting', 'running'].includes(rec.state)) continue; n++;
        (async () => { try {
          if (!rec.genId) { const r = await (rec.space ? sloosh.reconcileSpaceRun({ runKey: rec.runKey }) : sloosh.reconcileGeneration({ runKey: rec.runKey })).catch(() => null); const gid = idOf(r);
            if (!gid) { await writeRec(slug, { ...rec, state: 'failed', error: 'Brew restarted before Sloosh started this one; nothing was charged', charged: 0, failedAt: now() }); return; } rec.genId = gid; }
          const p = finish(slug, { ...rec, state: 'running' }).finally(() => inflight.delete(rec.runKey)); inflight.set(rec.runKey, p); await p; log.info?.(`[finals] ${slug} ${rec.runKey} finished after the restart`); }
        catch (e) { log.warn('[finals] reconcile', slug, rec.runKey, e.message); } })(); }
    }
    return n;
  }
  const busy = () => inflight.size;
  const get = (slug, runKey) => readRec(slug, runKey);
  async function list(slug) { const files = await packs.listFiles(slug, DIR.replace(/\/$/, '')).catch(() => []); const out = []; for (const f of files) { const r = await packs.getJSON(slug, DIR + f, null); if (r) out.push(r); } return out.sort((a, b) => b.at - a.at); }
  return { status, quote, run, checkpoint, reconcileAll, busy, get, list, assetFor, runKeyOf, forget: () => { statusMemo = null; } };
}
