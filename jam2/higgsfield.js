// Higgsfield's whole API, behind one door. The catalog (data/higgsfield-catalog.json, built by tools/hf-catalog.mjs from the
// public docs) holds every workflow's endpoint and input schema; data/higgsfield-routes.json says which offering does each job
// best, so a brand never picks a model. Every request is cleaned against its schema (unknown fields dropped, enums and ranges
// kept) and priced before it runs: Higgsfield's own /estimate where it gives a dollar figure, the published per-token or
// per-second formula where it gives a description. Nothing here decides to spend: the caller shows the price and asks first.
import fs from 'node:fs'; import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', f), 'utf8')); } catch { return null; } };
export const CATALOG = read('higgsfield-catalog.json') || { workflows: [] };
export const ROUTES = read('higgsfield-routes.json') || { jobs: {} };
const BY_ID = new Map(CATALOG.workflows.map((w) => [w.id, w]));
export const workflow = (id) => BY_ID.get(id) || null;

/* an input made to fit the workflow's schema: only its fields, enums respected, numbers clamped, strings cut; required checked */
export function fitInput(id, input = {}) {
  const w = workflow(id); if (!w?.schema?.properties) return { input, problems: w ? [] : [`unknown workflow ${id}`] };
  const P = w.schema.properties, out = {}, problems = [];
  for (const [k, v] of Object.entries(input)) {
    const s = P[k]; if (!s || v == null) continue;
    if (s.enum && !s.enum.includes(v)) { problems.push(`${k}=${v} not one of ${s.enum.join('/')}`); continue; }
    if ((s.type === 'integer' || s.type === 'number') && typeof v === 'number') { let x = v; if (s.minimum != null) x = Math.max(s.minimum, x); if (s.maximum != null) x = Math.min(s.maximum, x); out[k] = s.type === 'integer' ? Math.round(x) : x; continue; }
    if (s.type === 'string' && typeof v === 'string') { out[k] = s.maxLength ? v.slice(0, s.maxLength) : v; continue; }
    if (s.type === 'array' && Array.isArray(v)) { out[k] = s.maxItems ? v.slice(0, s.maxItems) : v; if (s.minItems && out[k].length < s.minItems) problems.push(`${k} needs at least ${s.minItems}`); continue; }
    out[k] = v;
  }
  for (const r of w.schema.required || []) if (out[r] == null) problems.push(`${r} is required`);
  return { input: out, problems };
}

/* the nearest frame a workflow takes (Marketing Studio has no 4:5: 3:4 is asked for and the layout's cover fit trims it) */
export function nearestRatio(id, want) {
  const opts = workflow(id)?.schema?.properties?.aspect_ratio?.enum; if (!opts || opts.includes(want)) return want;
  const num = (r) => { if (r === 'A5') return 148 / 210; const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r); return m ? +m[1] / +m[2] : null; }, t = num(want); /* A5 is portrait print, 148:210 */
  return t == null ? opts[0] : opts.filter((o) => num(o)).sort((a, b) => Math.abs(Math.log(num(a) / t)) - Math.abs(Math.log(num(b) / t)))[0] || opts[0];
}

/* a price from a published formula (video tokens = seconds × width × height × 24 / 1024) for the workflows whose /estimate only describes it */
const PX = { '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] };
function formulaUsd(id, input) {
  const f = ROUTES.formulas?.[id]; if (!f) return null;
  if (f.perImage != null) return f.perImage[input.resolution || '2k'] ?? f.perImage.default ?? null;
  if (f.per1kTokens) { const [w, h] = PX[input.resolution || '720p'] || PX['720p'], sec = +input.duration || 5;
    return +((Math.ceil(sec * w * h * 24 / 1024) / 1000) * (f.per1kTokens[input.resolution || '720p'] ?? f.per1kTokens.default)).toFixed(3); }
  return null;
}

export function createHiggsfield({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  const auth = () => (env.HF_API_KEY_ID && env.HF_API_KEY_SECRET ? `Key ${env.HF_API_KEY_ID}:${env.HF_API_KEY_SECRET}` : null);
  const base = () => (env.HF_API_BASE || 'https://api.higgsfield.ai').replace(/\/$/, '');
  const live = () => !!auth();
  const cache = new Map(); /* estimates by workflow + input, for a minute: a page asking prices twice pays nothing twice anyway, but waits less */
  /* the price of one request, in dollars (after Higgsfield's discount), or null when it can't be known */
  async function estimate(id, input) {
    const { input: inp, problems } = fitInput(id, input); if (problems.length) return { usd: null, error: problems.join('; ') };
    const k = id + JSON.stringify(inp), hit = cache.get(k); if (hit && Date.now() - hit.at < 60e3) return hit.v;
    let v = { usd: formulaUsd(id, inp), how: 'formula' };
    if (live()) { try { const r = await fetchImpl(`${base()}/estimate/${id}`, { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/json' }, body: JSON.stringify(inp), signal: AbortSignal.timeout(15e3) });
        const j = await r.json().catch(() => ({}));
        if (j.type === 'estimate' && j.usd != null) v = { usd: +(+j.usd - +(j.discount?.usd || 0)).toFixed(3), list: +j.usd, how: 'estimate' };
        else if (j.detail) v = { usd: null, error: String(j.detail).slice(0, 200) };
      } catch (e) { log.warn?.('[higgsfield] estimate', id, e.message); } }
    cache.set(k, { at: Date.now(), v }); return v;
  }
  /* run one request to completion: submit, poll, fetch the file. Failed and moderated requests are refunded by Higgsfield.
     onSubmit(job) is told the request the moment Higgsfield takes it (and charges), so a restart can pick the same request up
     again with resume = that job (poll only, never a second purchase). A poll that hiccups is retried; a request still running at
     maxMs throws { open: job } so nobody presses again and pays twice; a result link that doesn't give the file is an error */
  async function run(id, input, { maxMs = 15 * 60e3, idem = null, onSubmit = null, resume = null } = {}) {
    if (!live()) throw Object.assign(new Error('Higgsfield is not connected yet'), { skip: true });
    /* a request written down more than a day ago is never picked up: its result may be gone (Higgsfield keeps files 7 days) and a
       board must not loop on it forever (26 Oct review). Saying so lets the caller drop it; a new press buys a new one */
    if (resume?.status_url && resume.at && Date.now() - resume.at > 24 * 3600e3) throw new Error(`Higgsfield ${id}: that earlier request is too old to pick up. Make it again.`);
    let j = resume && resume.status_url ? resume : null;
    if (!j) { const { input: inp, problems } = fitInput(id, input); if (problems.length) throw new Error(`Higgsfield ${id}: ${problems.join('; ')}`);
      /* the key is the caller's (press + step) pinned to this exact request: the same press replayed with new words is a new request,
         never a collision with the old one (Higgsfield: reuse a key only to retry the same request) */
      const body = JSON.stringify(inp); let hh = 5381; for (let q = 0; q < body.length; q++) hh = ((hh << 5) + hh + body.charCodeAt(q)) | 0;
      const key = idem ? `${String(idem).slice(0, 180)}:${(hh >>> 0).toString(36)}` : null;
      const r = await fetchImpl(`${base()}/${id}`, { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body });
      const x = await r.json().catch(() => ({})); if (!r.ok || !x.status_url) throw new Error(`Higgsfield ${id} ${r.status}: ${String(x.detail || x.error || JSON.stringify(x)).slice(0, 200)}`);
      j = { id, request_id: x.request_id || null, status_url: x.status_url, at: Date.now() }; await Promise.resolve(onSubmit?.(j)).catch((e) => log.warn?.('[higgsfield] onSubmit', e.message)); }
    const t0 = Date.now(); let misses = 0;
    for (let wait = 3000; Date.now() - t0 < maxMs; wait = Math.min(wait * 1.4, 10e3)) {
      await new Promise((ok) => setTimeout(ok, wait));
      let s; try { const pr = await fetchImpl(j.status_url, { headers: { authorization: auth() } }); if (pr.status === 404 || pr.status === 410) throw Object.assign(new Error(`Higgsfield ${id}: that request is gone. Make it again.`), { gone: true }); s = await pr.json(); misses = 0; } catch (e) { if (e.gone) throw e; if (++misses >= 8) throw Object.assign(new Error(`Higgsfield ${id}: can't reach it to check the result (${e.message}); it is still being made`), { open: j }); continue; }
      if (s.status === 'completed') { const url = s.video?.url || s.images?.[0]?.url || s.audio?.url || s.output?.url; if (!url) throw new Error(`Higgsfield ${id}: completed with no file`);
        const fr = await fetchImpl(url), type = fr.headers.get('content-type') || ''; if (fr.status === 404 || fr.status === 410) throw new Error(`Higgsfield ${id}: the finished file has expired. Make it again.`); /* final: never "still being made" forever */
        if (!fr.ok || /text\/html|application\/json|xml/.test(type)) throw Object.assign(new Error(`Higgsfield ${id}: the finished file couldn't be fetched (${fr.status})`), { open: j });
        const buf = Buffer.from(await fr.arrayBuffer()); if (buf.length < 512) throw Object.assign(new Error(`Higgsfield ${id}: the finished file came back empty`), { open: j });
        return { buf, type, url, requestId: j.request_id }; }
      if (['failed', 'nsfw', 'canceled', 'cancelled', 'error'].includes(s.status)) throw Object.assign(new Error(`Higgsfield ${id} ${s.status}${s.error ? `: ${String(s.error).slice(0, 160)}` : ''}`), { refunded: true, moderated: s.status === 'nsfw' });
    }
    throw Object.assign(new Error(`Higgsfield ${id}: still being made after ${Math.round(maxMs / 60e3)} min; it will be picked up, not paid for again`), { open: j });
  }
  /* the offering for a job (data/higgsfield-routes.json): { id, input defaults, why } */
  const pick = (job, tier = 'default') => { const j = ROUTES.jobs?.[job]; if (!j) return null; const o = j[tier] || j.default; return o && workflow(o.id) ? { ...o, job, label: j.label } : null; };
  return { live, estimate, run, pick, fitInput, nearestRatio, workflow, catalog: CATALOG, routes: ROUTES };
}
