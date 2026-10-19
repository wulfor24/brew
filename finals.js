// Finals: the go-live image or video a brand's team asks Sloosh for, behind one button, never from chat. The flow is
// quote → the team's yes on that quote → generate (or run a Space) → poll → the asset's link → bytes in gen/ → a version.
// Every run has a key written to brands/<slug>/private/finals/<key>.json BEFORE the paid call, so a crash or a deploy
// never pays twice: on boot reconcileAll() finishes or fails each run still open. Credits are counted twice over:
// Sloosh's own daily limit on Brew's workspace is the hard stop; budget.js 'credits' (a site cap and a per-brand share)
// keeps one brand from using the whole workspace. On the demo site (and with SLOOSH_DUMMY=1) nothing is paid:
// DUMMY: the draft's own picture comes back as the final, tagged Dummy (DUMMY.md row 8).
// Sloosh is the maker of finals; Gemini on Vertex is the fallback. When Sloosh cannot quote an image (not connected, no limit set,
// the wallet or the day's allowance short, an asset refused, any quote error) the same button makes it with Gemini (the same maker
// as the drafts, with the same brief): the quote and the version say Gemini and why, no Sloosh credit moves. A video final falls back
// to Veo on a Gemini still (the drafts' own chain); Space runs have no fallback. A Gemini final is never the raw product photo: when
// the image guard hands back the real photo as a stand-in, the run fails and says so. Every quote and record carries provider:
// 'sloosh' | 'gemini'. The brand's credit share is spent only once Sloosh has taken a quote (an operation id), never on a refusal.
import crypto from 'node:crypto';
import { buildFinal, buildDraft, optsOf, lowerRes } from './sloosh-prompt.js';
import { formOf, prefill } from './sloosh-spaces.js';

const DIR = 'private/finals/', ASSETS = 'private/sloosh-assets.json', MAX_BYTES = 64 * 1024 * 1024, QUOTE_FRESH_MS = 4 * 60e3;
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
/* the first value under any of these keys, dotted paths allowed. The names are the ones Sloosh's outputSchemas give
   (data/sloosh-tools.json, 2026-10-16): a quote { quoteId, credits | expectedCredits, maximumReservedCredits, expiresAt, warning };
   an operation { operationId, state, owner: { phase | terminalStatus, outputs: [{ generationId, status, url }], chargedCredits,
   actualCredits, quotedCredits, errorCode, checkpoints } }; an asset { asset: { reference: { kind, id }, access: { url } } }. */
export const pick = (o, ...keys) => { for (const k of keys) { let x = o; for (const p of k.split('.')) x = x?.[p]; if (x !== undefined && x !== null && x !== '') return x; } return undefined; };
export const idOf = (o) => pick(o, 'quoteId', 'operationId', 'asset.reference.id', 'reference.id', 'generationId', 'spaceId', 'id');
export const refOf = (o) => { const id = pick(o, 'asset.reference.id', 'reference.id', 'generationId', 'id'); return id ? { kind: pick(o, 'asset.reference.kind', 'reference.kind', 'kind') || (pick(o, 'generationId') ? 'generated' : 'workspace'), id } : null; };
export const outputsOf = (o) => { const xs = pick(o, 'outputs', 'owner.outputs'); return (Array.isArray(xs) ? xs : xs ? [xs] : []).filter((x) => x && (x.url || x.generationId || x.id) && !/^(cancell?ed|canceled|failed)$/i.test(String(x.status || ''))); };
export const linkOf = (o) => pick(o, 'url', 'access.url', 'asset.access.url', 'output.url', 'link');
export const creditsOf = (o) => +pick(o, 'credits', 'expectedCredits', 'owner.chargedCredits', 'owner.actualCredits', 'owner.quotedCredits', 'chargedCredits') || 0;
export const holdOf = (o) => +pick(o, 'maximumReservedCredits', 'owner.maximumReservedCredits') || 0;
export const expiresOf = (o) => { const e = pick(o, 'expiresAt', 'expires_at'); const t = typeof e === 'number' ? (e < 1e12 ? e * 1e3 : e) : Date.parse(e || ''); return Number.isFinite(t) ? t : Date.now() + 5 * 60e3; };
/* get_connection's budget is in millicredits (budget.unit); credits in plain numbers for the sheet */
export const budgetOf = (c) => { const b = c?.budget || {}; const k = String(b.unit || 'millicredits') === 'credits' ? 1 : 1000; const n = (v) => (v == null ? null : Math.round((+v / k) * 100) / 100); return { configured: !!b.configured && c?.spendingEnabled !== false, left: n(b.remainingUnits), limit: n(b.dailyLimitUnits), spent: n(b.settledTodayUnits), held: n(b.outstandingUnits), askAbove: n(b.confirmationThresholdUnits), resetsAt: b.resetsAt || null, settingsUrl: c?.settingsUrl || null }; };

export function createFinals({ sloosh, slooshAuth, packs, budget, saveGen, genFlush = async () => {}, publicUrl = process.env.PUBLIC_URL || '', fetchImpl = fetch, slugs = async () => [], log = console, now = Date.now,
  dummy = () => process.env.DEMO_MODE === '1' || process.env.SLOOSH_DUMMY === '1', readFile = null, geminiImage = null, makeVideo = null, photo = async () => null,
  onDone = async () => {} /* (slug, rec) after reconcileAll settles a run the UI closures lost at the restart: rec.target says what it was made from (a jam draft or a studio change), rec.land where it shows (the workspace and the final's card) */ } = {}) {
  const inflight = new Map(); /* runKey → promise, this instance */
  let statusMemo = null;

  /* ---------- the connection, in plain words ---------- */
  async function status({ fresh = false } = {}) {
    if (dummy()) return { ok: true, dummy: true, why: null };
    if (!fresh && statusMemo && now() - statusMemo.at < 60e3) return statusMemo.v;
    const st = await slooshAuth.status(); let v;
    if (!st.connected) v = { ok: false, why: 'Brew is not connected to Sloosh yet. Brew staff connect it from the ops page.' };
    else if (sloosh.getConnection === undefined) v = { ok: false, why: 'Sloosh is not wired here.' };
    else { try { const c = await sloosh.getConnection(); const b = budgetOf(c); const set = b.configured && (b.limit == null || b.limit > 0);
        let ws = st.workspace?.name || null; if (!ws) { try { const a = await sloosh.getAccount(); ws = pick(a, 'workspace.name') || null; if (ws) await slooshAuth.setWorkspace?.({ id: pick(a, 'workspace.id') || pick(c, 'connection.workspaceId') || null, name: ws }); } catch {} }
        v = { ok: set, workspace: ws || pick(c, 'connection.workspaceId') || null, left: b.left, limit: b.limit, spent: b.spent, held: b.held, askAbove: b.askAbove, resetsAt: b.resetsAt, settingsUrl: b.settingsUrl, scope: pick(c, 'connection.scopes') || st.scope, why: set ? null : 'Sloosh has no daily limit set for agents on Brew’s workspace yet, so nothing paid can run. Brew staff set it on sloosh.ai/settings/mcp.' }; }
      catch (e) { v = { ok: false, why: e.expired ? 'Sloosh needs Brew staff to reconnect.' : `Sloosh did not answer: ${e.message}`, error: e.message }; } }
    if (!v.ok && geminiImage) v = { ...v, fallback: true, fallbackWhy: v.why, why: null }; /* an image final can still be made, on Gemini, until Sloosh can pay */
    statusMemo = { at: now(), v }; return v;
  }
  /* the Gemini fallback quote: no credits, the same brief (the Nano Banana rendering is right for Gemini image; a video is Veo on a Gemini still); a Space has none */
  /* product photos first, then the rest (a look, a scene, a person): Gemini gets them in that order, so "image 1" is always the product */
  const productFirst = (refs = []) => [...refs.filter((r) => r?.job === 'product'), ...refs.filter((r) => r?.job !== 'product')];
  const geminiQuote = (spec, why) => { if (spec.space) return { error: `${why} A Space runs on Sloosh only.`.trim() }; const vid = spec.kind === 'video'; if (vid && !makeVideo) return { error: `${why} A video final runs on Sloosh only here.`.trim() };
    if (!(spec.refs || []).some((r) => r?.job === 'product')) return { error: 'Pick a product photo first: Brew makes the final around the real product.' };
    spec = { ...spec, refs: productFirst((spec.refs || []).filter((r) => r?.job !== 'frame')), ratio: vid ? (spec.ratio === '16:9' ? '16:9' : '9:16') : spec.ratio };
    const b = buildFinal({ ...spec, kind: 'image' }); const settings = vid ? { aspect_ratio: spec.ratio, resolution: '1080p', duration: Math.max(4, Math.min(8, Math.round(spec.seconds || 6))), sound: !!spec.sound } : b.settings;
    return { quoteId: `gemini-${sha(JSON.stringify([spec.kind, spec.visual, spec.text, spec.refs, spec.motion]))}`, provider: 'gemini', fallback: true, why: `on Gemini for now: ${why}`, fallbackWhy: why, credits: 0, hold: 0, model: vid ? 'veo-3.1-fast' : 'gemini-3-pro-image', label: vid ? 'Veo 3.1 Fast (Vertex)' : 'Gemini 3 Pro Image (Vertex)', prompt: b.prompt, motion: vid ? buildDraft({ ...spec, kind: 'video' }).prompt : null, settings, space: null, refs: spec.refs || [], expiresAt: now() + 3600e3, at: now() }; };

  /* ---------- Brew's files as Sloosh assets, imported once per workspace ---------- */
  /* an asset id belongs to the workspace that imported it: a reconnect to another workspace (or a new one) imports again. The cache
     entry keeps `ws`; an entry from another workspace, or an old one with no `ws`, is imported again (importing costs no credits). */
  const assetCache = async (slug) => (await packs.getJSON(slug, ASSETS, null)) || {};
  let wsMemo = null;
  const wsId = async () => { if (wsMemo && now() - wsMemo.at < 60e3) return wsMemo.id;
    let id = (await slooshAuth.status().catch(() => null))?.workspace?.id || null;
    if (!id && sloosh.getConnection) id = await sloosh.getConnection().then((c) => pick(c, 'connection.workspaceId') || null).catch(() => null);
    wsMemo = { at: now(), id }; return id; };
  async function assetFor(slug, ref) {
    const rel = String(ref?.url || ref?.file || ref?.rel || ref || '').trim(); if (!rel) throw new Error('a reference with no file');
    if (ref?.asset?.id) return ref.asset;
    const url = /^https?:\/\//.test(rel) ? rel : `${publicUrl.replace(/\/$/, '')}/${rel.replace(/^\//, '')}`;
    const cache = await assetCache(slug), key = sha(url), ws = await wsId(), hit = cache[key];
    /* a kept asset id is reused, but never its old link: Sloosh's asset URLs have no fixed lifetime, and a quote that passes a stale one
       is refused ("An uploaded asset does not match its owned asset. Call get_asset and pass its returned url", owner_invalid_request:
       every final on a photo used before, 19 Oct). get_asset is free; an asset it can't find is imported again */
    if (hit?.assetId && ws && hit.ws === ws) { const ref0 = { kind: hit.kind || 'workspace', id: hit.assetId };
      const link = await sloosh.getAsset(ref0).then(linkOf).catch((e) => { log.warn?.('[finals] get_asset', ref0.id, e.message.slice(0, 160)); return null; });
      if (link) { if (link !== hit.link) { cache[key] = { ...hit, link, at: now() }; await packs.put(slug, ASSETS, cache).catch(() => {}); } return { ...ref0, url: link, type: hit.type || 'image' }; } }
    const r = await sloosh.importAsset(url, ref?.label || rel.split('/').pop()); const asset = refOf(r);
    if (!asset) throw Object.assign(new Error(`Sloosh import_asset gave no asset id (keys: ${Object.keys(r || {}).join(', ')})`), { schema: true });
    const type = /video/.test(String(pick(r, 'asset.assetType', 'asset.contentType') || '')) || ref?.kind === 'video' ? 'video' : 'image';
    const a = { ...asset, url: linkOf(r) || url, type }; if (ws) { cache[key] = { assetId: a.id, kind: a.kind, link: a.url, type, url, ws, at: now() }; await packs.put(slug, ASSETS, cache); } return a;
  }
  /* each reference with its Sloosh asset: { kind, id, url, type } — the shape quote_generation's uploadedAssets takes (maxItems 20) */
  const MAX_REFS = 20;
  const withAssets = async (slug, refs = []) => Promise.all(refs.slice(0, MAX_REFS).map(async (r) => { const a = await assetFor(slug, r); return { ...r, asset: a, assetId: a.id }; }));
  const uploaded = (refs) => refs.slice(0, MAX_REFS).map((r) => ({ kind: r.asset.kind, id: r.asset.id, url: r.asset.url, type: r.asset.type || 'image', role: r.role === 'start' ? 'start_frame' : r.role === 'end' ? 'end_frame' : 'reference' }));

  /* every Sloosh refusal is logged with what Brew asked for (model, mode, settings, how many references and their roles, the prompt's
     length; never a URL or the prompt itself) and Sloosh's whole reason, and the last few are kept for the ops page. A quote that fell
     back to Gemini/Veo used to leave no trace at all (19 Oct: a reel's quote_generation refused with owner_invalid_request) */
  const refusals = [], tries = []; /* tries: every Sloosh quote this instance asked for (the settings, the price, the hold, the warning), newest first, for the ops page */
  const noteTry = (slug, ask, q) => { tries.unshift({ at: new Date(now()).toISOString(), slug, ask: shapeOf(ask), credits: creditsOf(q), hold: holdOf(q) || null, warning: pick(q, 'warning') || null }); tries.length = Math.min(tries.length, 20); };
  const shapeOf = (a = {}) => a.prompt == null ? a : { mode: a.mode, model: a.model, ratio: a.ratio, resolution: a.resolution, seconds: a.seconds, sound: a.sound, count: a.count, promptChars: String(a.prompt || '').length, refs: (a.references || []).map((r) => `${r.type}/${r.role}/${r.kind}`) };
  function noteRefusal(slug, tool, ask, e) { const row = { at: new Date(now()).toISOString(), slug, tool, ask: shapeOf(ask), code: e?.code || null, error: String(e?.message || e).slice(0, 900) };
    refusals.unshift(row); refusals.length = Math.min(refusals.length, 12); log.warn('[finals] Sloosh refused', JSON.stringify(row)); return row; }

  /* the references a model takes: images up to its limit (product photos first), videos only where it takes them, and the opening
     frame (job 'frame') only on a video model that takes one. Seedance takes a start frame or references, not both
     (framesExcludesReferenceImages), so a reel with the approved draft's first frame opens on it alone; a model that requires a
     start frame (Kling) gets the product photo as one */
  function refsFor(refs = [], o, vid) {
    const frame = refs.find((r) => r.job === 'frame'), rest = productFirst(refs.filter((r) => r.job !== 'frame'));
    const takesFrame = vid && o?.frames && o.frames.start !== 'none';
    if (takesFrame && frame && (o.framesAlone || o.refs === 0)) return [{ ...frame, role: 'start' }];
    const imgs = rest.filter((r) => r.asset?.type !== 'video').slice(0, o?.refs ?? MAX_REFS), vids = rest.filter((r) => r.asset?.type === 'video').slice(0, o?.videos ?? (vid ? MAX_REFS : 0));
    let out = [...imgs, ...vids].map((r) => ({ ...r, role: r.role === 'start' ? undefined : r.role }));
    if (takesFrame && frame) out = [{ ...frame, role: 'start' }, ...out];
    else if (vid && o?.frames?.start === 'required') { const prod = rest.find((r) => r.job === 'product' && r.asset?.type !== 'video'); if (prod) out = [{ ...prod, job: 'frame', role: 'start' }]; }
    return out.slice(0, MAX_REFS);
  }

  /* ---------- quote: free, good for five minutes, shown before any yes ---------- */
  async function quote(slug, spec = {}) {
    const st = await status(); if (!st.ok) return st.fallback ? geminiQuote(spec, st.fallbackWhy) : { error: st.why };
    const share = budget.refusal('credits', slug, 1); if (share) return { error: budget.why('credits', slug, spec.brandName) };
    if (dummy()) return { quoteId: 'dummy', credits: 0, dummy: true, model: spec.space ? null : buildFinal(spec).model, space: spec.space || null, prompt: spec.space ? null : buildFinal(spec).prompt, settings: spec.space ? null : buildFinal(spec).settings, refs: spec.refs || [], expiresAt: now() + 3600e3, at: now() };
    /* an image final always has a Gemini answer: any Sloosh quote failure ends as a Gemini quote with the reason (a Space or a video keeps Sloosh's error) */
    const canFallBack = !!geminiImage && !spec.space && (spec.kind !== 'video' || !!makeVideo); /* a video final falls back to Veo on a Gemini still (19 Oct: a raw "owner_invalid_request" reached the person) */
    const PAY = /credit|wallet|allocation|limit|fund|plan|entitle|balance|payment|402|allowance|insufficient|owned|asset|not found|unauthori/i;
    let refs; try { refs = await withAssets(slug, spec.refs || []); } catch (e) { noteRefusal(slug, 'import_asset', { refs: (spec.refs || []).length }, e); if (canFallBack) return geminiQuote(spec, `Sloosh could not take the reference photos (${e.message.slice(0, 160)}).`); throw e; }
    let q, out;
    if (spec.space) { const schema = await sloosh.getSpaceInputSchema(spec.space.id); const fields = formOf(pick(schema, 'form', 'schema', 'inputSchema') || schema); const pre = prefill(fields, spec.space.ctx || {});
      const inputs = { ...pre.values, ...(spec.space.inputs || {}) }; const missing = pre.missing.filter((m) => inputs[m.key] == null);
      if (missing.length) return { error: `The Space still needs ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`, missing, fields, inputs, filled: pre.filled };
      q = await sloosh.quoteSpace({ id: spec.space.id, inputs }).catch((e) => { noteRefusal(slug, 'quote_space', { space: spec.space.id, inputs: Object.keys(inputs) }, e); throw e; }); out = { space: { id: spec.space.id, name: spec.space.name || null }, inputs, fields, filled: pre.filled, prompt: null, settings: null, model: null }; }
    else { const vid = spec.kind === 'video', mode = vid ? 'video_gen' : 'image_gen';
      /* the model as it is today (list_models): a model Sloosh dropped is swapped for its default, and the settings, references,
         start frame and sound are fitted to what it takes, so Brew never sends a quote the model refuses for its shape */
      const specs = sloosh.modelSpecs ? await sloosh.modelSpecs(mode).catch((e) => { log.warn?.('[finals] list_models', e.message); return null; }) : null;
      let model = buildFinal({ ...spec, refs }).model, live = specs?.models?.[model] || null, swapped = null;
      if (!live && specs && Object.keys(specs.models).length && specs.models[specs.default]) { swapped = model; model = specs.default; live = specs.models[model]; log.warn?.(`[finals] Sloosh has no ${swapped} now; using its default ${model}`); }
      const use = refsFor(refs, optsOf(model, live), vid);
      const make = (res, secs) => buildFinal({ ...spec, refs: use, forceModel: model, resolution: res, ...(secs ? { seconds: secs } : {}) }, live);
      const askOf = (b) => ({ mode, prompt: b.prompt, model: b.model, references: uploaded(use), ratio: b.settings.aspect_ratio, resolution: b.settings.resolution, seconds: vid ? b.settings.duration : undefined, sound: vid ? b.settings.sound : undefined, count: spec.count || 1 });
      let b = make(), ask = askOf(b);
      try { q = await sloosh.quoteGeneration(ask); noteTry(slug, ask, q);
        /* a reel over what is left of the day's limit is asked again one resolution down (never under 720p) before it goes to Veo:
           a 9 s Seedance 2.5 reel is 76.77 credits at 1080p and about a third of that at 720p (19 Oct, the daily limit is 50) */
        for (let res = b.settings.resolution; vid && st.left != null && (holdOf(q) || creditsOf(q)) > st.left;) {
          res = lowerRes(model, res, live); if (!res || !['720p', '768p', '1080p', '1K', '2K', '2k'].includes(res)) break;
          const b2 = make(res), a2 = askOf(b2); const q2 = await sloosh.quoteGeneration(a2).catch((e) => { noteRefusal(slug, 'quote_generation', a2, e); return null; }); if (!q2) break; noteTry(slug, a2, q2);
          b = b2; ask = a2; q = q2; }
        /* still over at 720p: the reel is made shorter to fit what is left today (every beat kept, timed to the new length; never under
           6 s), priced from what Sloosh just quoted per second (a 15 s reel is 52 credits at 720p, 19 Oct) */
        if (vid && st.left != null && (holdOf(q) || creditsOf(q)) > st.left && b.settings.duration) {
          const per = (holdOf(q) || creditsOf(q)) / b.settings.duration, fit = Math.floor((st.left * 0.95) / per);
          if (fit >= 6 && fit < b.settings.duration) { const b2 = make(b.settings.resolution, fit), a2 = askOf(b2); const q2 = await sloosh.quoteGeneration(a2).catch((e) => { noteRefusal(slug, 'quote_generation', a2, e); return null; });
            if (q2) { noteTry(slug, a2, q2); b = b2; ask = a2; q = q2; } } }
      } catch (e) { noteRefusal(slug, 'quote_generation', ask, e); if (canFallBack) return geminiQuote(spec, PAY.test(e.message) ? `Sloosh cannot pay for this yet (${e.message.slice(0, 160)}).` : `Sloosh could not quote this (${e.message.slice(0, 160)}).`); return { error: 'Sloosh couldn’t price this final just now. Try again in a minute.', detail: e.message.slice(0, 200) }; }
      refs = use; out = { model: b.model, label: b.label || b.model, why: swapped ? `${b.why}; Sloosh no longer offers ${swapped}` : b.why, prompt: b.prompt, settings: b.settings, space: null }; }
    const credits = creditsOf(q), hold = holdOf(q) || credits, quoteId = idOf(q), warning = pick(q, 'warning') || null;
    if (warning && canFallBack && /wallet|allocation|credit|limit|short|balance|payment|402|allowance|insufficient|owned|asset|not found|unauthori/i.test(warning)) return geminiQuote(spec, `Sloosh says: ${warning}`);
    if (!quoteId) { const why = `Sloosh quoted without a quote id (keys: ${Object.keys(q || {}).join(', ')})`; return canFallBack ? geminiQuote(spec, `${why}.`) : { error: why }; }
    if (st.left != null && hold > st.left) { const why = `This would hold ${hold} credits and Brew’s Sloosh workspace has ${st.left} left today. It resets at midnight UTC.`; return canFallBack ? geminiQuote(spec, why) : { error: why, credits, hold }; }
    out.provider = 'sloosh';
    const over = budget.refusal('credits', slug, Math.ceil(credits)); if (over) return { error: budget.why('credits', slug, spec.brandName, Math.ceil(credits)), credits };
    return { quoteId, credits, hold, warning, expiresAt: expiresOf(q), at: now(), refs: refs.map((r) => ({ ...r, asset: r.asset })), ...out, raw: q };
  }

  /* ---------- the ops page's free check: real quotes on a real product photo, one setting changed at a time ---------- */
  /* quotes reserve and spend nothing (quote_generation: "Does not start work or debit credits"); each variant changes one thing
     from what Brew sends, so the one Sloosh refuses shows by elimination. The photo is imported once (import is free too). */
  async function probe(slug, photoUrl, { label = 'Product photo' } = {}) {
    if (!photoUrl) return { error: 'no product photo to test with' };
    let ref; try { const [r] = await withAssets(slug, [{ url: photoUrl, job: 'product', label }]); ref = r; } catch (e) { return { error: `import_asset: ${e.message}` }; }
    const spec = { title: 'a reel', subject: label, visual: 'A hand picks the product up from a kitchen counter and uses it.', ratio: '9:16', seconds: 9, sound: true, refs: [ref], beats: [{ shot: 'A hand reaches for the product on the counter.', line: 'This one changed my mornings.' }, { shot: 'Close on the product in use.', line: '' }, { shot: 'The product back on the counter, morning light.', line: 'Try it.' }], brand: { name: 'Brew check' } };
    const one = async (name, kind, tweak = (a) => a, specTweak = {}) => { const b = buildFinal({ ...spec, kind, ...specTweak }); const vid = kind === 'video';
      const ask = tweak({ mode: vid ? 'video_gen' : 'image_gen', prompt: b.prompt, model: b.model, references: uploaded([ref]), ratio: b.settings.aspect_ratio, resolution: b.settings.resolution, seconds: vid ? b.settings.duration : undefined, sound: vid ? b.settings.sound : undefined, count: 1 });
      try { const q = await sloosh.quoteGeneration(ask); return { name, ok: !!idOf(q), credits: creditsOf(q), warning: pick(q, 'warning') || null, ask: shapeOf(ask) }; }
      catch (e) { return { name, ok: false, code: e.code || null, error: String(e.message).slice(0, 900), ask: shapeOf(ask) }; } };
    const variants = [
      one('image as Brew sends it', 'image', (a) => a, { ratio: '4:5' }),
      one('reel as Brew sends it', 'video'),
      one('reel, sound left out', 'video', (a) => ({ ...a, sound: undefined })),
      one('reel, photo as start frame', 'video', (a) => ({ ...a, references: a.references.map((r) => ({ ...r, role: 'start_frame' })) })),
      one('reel, no photo', 'video', (a) => ({ ...a, references: [] })),
      one('reel, 720p 5 s', 'video', (a) => ({ ...a, resolution: '720p', seconds: 5 })),
      one('reel on Seedance 2.0', 'video', (a) => ({ ...a, model: 'seedance-2.0', seconds: 8 })),
      one('reel on Gemini Omni', 'video', (a) => ({ ...a, model: 'gemini-omni-1.1-flash', seconds: 8 }))
    ];
    return { photo: { kind: ref.asset.kind, id: ref.asset.id, type: ref.asset.type }, results: await Promise.all(variants) };
  }

  /* ---------- run: the yes on a quote; written before the paid call; idempotent on the key ---------- */
  const recName = (key) => `${DIR}${key}.json`;
  const readRec = (slug, key) => packs.getJSON(slug, recName(key), null);
  const writeRec = async (slug, rec) => { await packs.put(slug, recName(rec.runKey), rec); return rec; };
  const runKeyOf = (slug, target, spec) => sha(`${slug}|${JSON.stringify(target || {})}|${JSON.stringify({ k: spec.kind, p: spec.prompt || spec.visual, s: spec.space?.id, i: spec.space?.inputs, r: (spec.refs || []).map((r) => r.url || r.file || r.id), t: spec.text, v: spec.revise?.change, n: spec.revision || 0 })}`);

  async function run(slug, spec = {}, { quote: q, by = null, target = null, land = null } = {}) { /* land: where the result is shown ({ tid, fid }), kept on the record but never in the run key, so a retry after a restart finds the same run */
    if (!q?.quoteId) throw new Error('a final needs its quote first');
    const runKey = runKeyOf(slug, target, spec); const prior = await readRec(slug, runKey);
    if (prior?.state === 'done') return prior; if (inflight.has(runKey)) return inflight.get(runKey);
    const p = (async () => {
      let rec = prior && prior.state !== 'failed' ? { ...prior, land: land || prior.land || null } : { id: 'fn_' + runKey.slice(0, 8), runKey, state: 'starting', provider: q.provider || (q.dummy ? 'dummy' : 'sloosh'), kind: spec.kind || 'image', quote: { id: q.quoteId, credits: q.credits, hold: q.hold, model: q.model, space: q.space, expiresAt: q.expiresAt }, credits: q.credits, model: q.model, space: q.space, prompt: q.prompt, settings: q.settings, inputs: q.inputs || null, refs: (q.refs || []).map((r) => ({ id: r.id, job: r.job, label: r.label, keep: r.keep, assetId: r.assetId || null })), target, land, by, at: now(), dummy: !!q.dummy, revision: spec.revision || 0, words: spec.kind !== 'video' && (spec.text || []).length > 0 /* the words are set in the picture: nothing lays them over it again */ };
      if (rec.state === 'starting') {
        if (q.dummy) { /* DUMMY: the draft's own picture is the "final" (demo site); nothing is paid */
          const from = spec.fromFile || (spec.refs || []).find((r) => r.job === 'product' && r.url)?.url || (spec.refs || [])[0]?.url; if (!from) throw new Error('nothing to show as the final here: pick a photo first');
          rec = { ...rec, state: 'done', file: from, link: null, assetId: null, charged: 0, doneAt: now() }; return writeRec(slug, rec); }
        if (q.provider === 'gemini' || q.fallback) { /* Gemini for now: the same brief and the product photo, counted in the image/video budget (the makers check it), no Sloosh credit, no quote staleness */
          if (!geminiImage) throw new Error('Gemini is not wired here');
          const refs = productFirst(q.refs?.length ? q.refs : spec.refs || []), prod = refs.find((r) => r.job === 'product' && (r.url || r.file));
          if (!prod) throw new Error('Pick a product photo first: Brew makes the final around the real product.');
          const srcFile = await photo(prod.url || prod.file).catch(() => null), vid = spec.kind === 'video';
          /* the other picked photos ride along as image 2, 3… in the order the brief names them (a rival's ad as the look, a scene, a person) */
          const refFiles = (await Promise.all(refs.filter((r) => r !== prod && (r.url || r.file)).map((r) => photo(r.url || r.file).catch(() => null)))).filter(Boolean);
          rec = { ...rec, provider: 'gemini', fallback: true, model: q.model || 'gemini', credits: 0 }; await writeRec(slug, rec);
          try { const still = await geminiImage({ srcFile, refFiles, prompt: q.prompt, ratio: vid ? (q.settings?.aspect_ratio === '16:9' ? '16:9' : '9:16') : q.settings?.aspect_ratio || '4:5', slug, productName: spec.product?.name || null, text: (spec.text || []).map((t) => (typeof t === 'string' ? t : t?.words || '')).filter(Boolean).join(' · ') });
            /* the image guard hands back the real product photo when the model's picture showed another product or could not be checked
               (guard.fallback / guard.genFailed, image-guard.js): a stand-in is never a final, and no Veo clip is made on it */
            if (still?.guard?.fallback || still?.guard?.genFailed) throw Object.assign(new Error('Gemini could not keep the product as photographed. Try again, or wait for Sloosh.'), { guard: still.guard, soft: true });
            const buf = vid ? await makeVideo(still, q.motion || q.prompt, { ratio: q.settings?.aspect_ratio || '9:16', seconds: q.settings?.duration || 6, slug }) : still;
            const name = `fin-${sha(buf)}.${vid ? 'mp4' : 'png'}`; saveGen(name, buf); await genFlush(); rec = { ...rec, state: 'done', file: 'gen/' + name, link: null, assetId: null, charged: 0, doneAt: now() }; return writeRec(slug, rec); }
          catch (e) { rec = { ...rec, state: 'failed', error: e.guard ? e.message : `${vid ? 'Veo' : 'Gemini'} could not make it: ${e.message}`, guard: e.guard || null, charged: 0, failedAt: now() }; await writeRec(slug, rec); throw Object.assign(e, { rec }); } }
        if (now() - (q.at || 0) > QUOTE_FRESH_MS) throw Object.assign(new Error('That quote is more than four minutes old. Ask for a fresh one.'), { stale: true });
        /* the brand's share is checked before the paid call and spent only once Sloosh has taken the quote (an operation id):
           a refused or failed generate charges nothing here, and the record says failed so the next try gets a fresh quote */
        const units = Math.ceil(q.credits || 0) || 1;
        if (budget.refusal('credits', slug, units)) throw Object.assign(new Error(budget.why('credits', slug, null, units)), { budget: true });
        await writeRec(slug, rec);
        let r; try { r = q.space ? await sloosh.runSpace({ quote: q.quoteId, runKey, confirmed: true }) : await sloosh.generate({ quote: q.quoteId, runKey, confirmed: true }); }
        catch (e) { noteRefusal(slug, q.space ? 'run_space' : 'generate', { quote: q.quoteId, model: q.model }, e); rec = { ...rec, state: 'failed', error: `Sloosh did not start this one (${String(e.message).slice(0, 200)}). Nothing was charged; ask for a fresh quote.`, charged: 0, failedAt: now() }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec, cause: e, soft: true }); }
        const gid = idOf(r);
        if (!gid) { rec = { ...rec, state: 'failed', error: `Sloosh gave no operation id (keys: ${Object.keys(r || {}).join(', ')}); check Sloosh’s Assets before paying again`, charged: null, failedAt: now() }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
        budget.spend('credits', slug, units); /* the share moves only now, once per operation */
        rec = { ...rec, state: 'running', genId: gid, startedAt: now() }; await writeRec(slug, rec);
      }
      return finish(slug, rec);
    })().finally(() => inflight.delete(runKey));
    inflight.set(runKey, p); return p;
  }
  /* poll to the end, pull the bytes, keep the record honest; a Space waiting on a checkpoint stops here with state 'checkpoint' */
  async function finish(slug, rec) {
    const getter = rec.space ? () => sloosh.getSpaceRun(rec.genId) : () => sloosh.getGeneration(rec.genId);
    let last;
    try { last = await sloosh.wait(async () => { let x = await getter();
        if (x?.reconciliationRequired || String(x?.state || '').toLowerCase() === 'ambiguous') x = (await (rec.space ? sloosh.reconcileSpaceRun(rec.genId) : sloosh.reconcileGeneration(rec.genId)).catch(() => null)) || x; /* Sloosh lost track of the answer: ask it to settle before reading further */
        const ck = rec.space ? sloosh.pendingCheckpoint?.(x) : null; if (ck) throw Object.assign(new Error('checkpoint'), { checkpoint: ck, final: x }); return x; }, { every: rec.kind === 'video' || rec.space ? 10e3 : 5e3, maxMs: 20 * 60e3, onStep: (s) => { rec.step = s; } }); }
    catch (e) { if (e.checkpoint) { rec = { ...rec, state: 'checkpoint', checkpoint: { nodeId: e.checkpoint.nodeId, runKey: e.checkpoint.runKey, expectedRerunCount: e.checkpoint.expectedRerunCount ?? 0, output: e.checkpoint.output ?? null }, checkpointAt: now() }; return writeRec(slug, rec); }
      /* only Sloosh's own terminal state fails a run. A poll that kept failing, a sign-in that ran out, or the wait limit leaves the run open:
         Sloosh may still be making (and charging) it, so the record stays running with the reason and reconcileAll collects it on the next boot */
      if (!e.terminal && (e.pollError || e.timeout || e.expired || e.status >= 500)) {
        const note = e.timeout ? 'still going on Sloosh; Brew will collect it' : 'Sloosh could not be read; Brew will collect it after the next restart';
        rec = { ...rec, state: 'running', lastError: String(e.message).slice(0, 300), lastErrorAt: now(), note }; await writeRec(slug, rec);
        throw Object.assign(new Error(`The final is ${note} (${String(e.message).slice(0, 160)}).`), { rec, open: true, cause: e }); }
      rec = { ...rec, state: 'failed', error: e.message, failedAt: now(), charged: pick(e.final, 'owner.chargedCredits') ?? (creditsOf(e.final) || null) }; await writeRec(slug, rec); throw Object.assign(e, { rec }); }
    const outs = rec.space ? outputsOf(await sloosh.getSpaceRunOutputs(rec.genId).catch(() => last)).filter((o) => !o.type || /image|video/.test(o.type)).concat(outputsOf(last)) : outputsOf(last);
    const first = outs[0]; if (!first) { const why = pick(last, 'owner.errorCode', 'owner.error'); rec = { ...rec, state: 'failed', error: why ? `Sloosh delivered nothing (${why})` : `Sloosh finished with no output (keys: ${Object.keys(last || {}).join(', ')})`, charged: creditsOf(last) || null }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    let link = linkOf(first); const ref = refOf(first); const assetId = ref?.id || (typeof first === 'string' ? first : null);
    if (!link && ref) link = linkOf(await sloosh.getAsset(ref));
    if (!link) { rec = { ...rec, state: 'failed', error: `Sloosh gave no link for the output (keys: ${Object.keys(first || {}).join(', ')})` }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    const r = await fetchImpl(link, { signal: AbortSignal.timeout(180e3) }); if (!r.ok) { rec = { ...rec, state: 'failed', error: `the output could not be fetched (${r.status})`, link, assetId }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    const len = +r.headers.get('content-length') || 0; if (len > MAX_BYTES) { rec = { ...rec, state: 'failed', error: 'the output is over 64 MiB', link, assetId }; await writeRec(slug, rec); throw Object.assign(new Error(rec.error), { rec }); }
    const buf = Buffer.from(await r.arrayBuffer()); const type = r.headers.get('content-type') || ''; const ext = /mp4|video/.test(type) || /\.mp4(\?|$)/.test(link) ? 'mp4' : /jpe?g/.test(type) || /\.jpe?g(\?|$)/.test(link) ? 'jpg' : 'png';
    const name = `fin-${sha(buf)}.${ext}`; saveGen(name, buf); await genFlush();
    rec = { ...rec, state: 'done', file: 'gen/' + name, link, assetId, assetKind: ref?.kind || null, outputs: outs.slice(0, 12).map((o) => ({ assetId: refOf(o)?.id || null, kind: refOf(o)?.kind || null, link: linkOf(o) || null, type: o.type || null })), charged: pick(last, 'owner.chargedCredits') ?? rec.credits, model: rec.model, lastError: undefined, note: undefined, doneAt: now() };
    return writeRec(slug, rec);
  }
  /* a Space checkpoint: the team's yes or no, then the run goes on */
  async function checkpoint(slug, runKey, ok, note = '') {
    const rec = await readRec(slug, runKey); if (!rec || rec.state !== 'checkpoint') return { error: 'nothing is waiting here' };
    const ck = rec.checkpoint || {}; const args = { id: rec.genId, nodeId: ck.nodeId, checkpointKey: ck.runKey, expectedRerunCount: ck.expectedRerunCount ?? 0 }; void note; /* Sloosh takes no note with a decision */
    await (ok ? sloosh.approveCheckpoint(args) : sloosh.rejectCheckpoint(args));
    if (!ok) { const r2 = { ...rec, state: 'failed', error: 'stopped at the checkpoint', failedAt: now() }; return writeRec(slug, r2); }
    const p = finish(slug, { ...rec, state: 'running' }).finally(() => inflight.delete(runKey)); inflight.set(runKey, p); return p;
  }

  /* ---------- after a restart: every run still open is finished or failed, never paid again ---------- */
  /* a run settled here (done, failed or at a checkpoint) reaches the jam or the studio through onDone: the record carries target */
  /* a settled run lands where it was asked; a done run that found no card (the brand's jams not loaded yet, the instance gone) keeps
     landed: false and the next boot tries again, three times at most (19 Oct: a paid reel was done but never reached its card) */
  const settled = async (slug, rec) => { if (!rec || rec.state === 'running' || rec.state === 'starting') return; let ok = false;
    try { ok = !!(await onDone(slug, rec)); } catch (e) { log.warn('[finals] onDone', slug, rec.runKey, e.message); }
    if (rec.state === 'done' && rec.landed !== ok) await writeRec(slug, { ...rec, landed: ok, landTries: (rec.landTries || 0) + (ok ? 0 : 1) }).catch(() => {}); };
  async function reconcileAll() {
    if (dummy()) return 0; let n = 0;
    for (const slug of await slugs().catch(() => [])) {
      const files = await packs.listFiles(slug, DIR.replace(/\/$/, '')).catch(() => []);
      for (const f of files) { const rec = await packs.getJSON(slug, DIR + f, null); if (!rec) continue;
        if (rec.state === 'done' && rec.landed === false && (rec.landTries || 0) < 3 && (rec.land?.tid || rec.target)) { n++; await settled(slug, rec); continue; } /* done on Sloosh, never reached its card */
        if (!['starting', 'running'].includes(rec.state)) continue; n++;
        if (rec.fallback) { await settled(slug, await writeRec(slug, { ...rec, state: 'failed', error: 'Brew restarted while Gemini was making this; nothing was charged. Make it again.', charged: 0, failedAt: now() })); continue; }
        (async () => { try {
          if (!rec.genId) { /* the paid call may or may not have gone out: the same quote + idempotency key gives back the same operation or a refusal, never a second charge */
            const qid = rec.quote?.id; const r = qid ? await (rec.space ? sloosh.runSpace({ quote: qid, runKey: rec.runKey, confirmed: true }) : sloosh.generate({ quote: qid, runKey: rec.runKey, confirmed: true })).catch((e) => ({ refused: e.message })) : null; const gid = idOf(r);
            if (!gid) { const f = await writeRec(slug, { ...rec, state: 'failed', error: r?.refused ? `Brew restarted before Sloosh confirmed this one and Sloosh refused the retry (${r.refused}); check Sloosh’s Assets before paying again` : 'Brew restarted before Sloosh started this one; nothing was charged', charged: r?.refused ? null : 0, failedAt: now() }); await settled(slug, f); return; } rec.genId = gid; }
          const p = finish(slug, { ...rec, state: 'running' }).finally(() => inflight.delete(rec.runKey)); inflight.set(rec.runKey, p); const done = await p; log.info?.(`[finals] ${slug} ${rec.runKey} ${done.state} after the restart`); await settled(slug, done); }
        catch (e) { log.warn('[finals] reconcile', slug, rec.runKey, e.message); if (e.rec && !e.open) await settled(slug, e.rec); } })(); }
    }
    return n;
  }
  const busy = () => inflight.size;
  const get = (slug, runKey) => readRec(slug, runKey);
  async function list(slug) { const files = await packs.listFiles(slug, DIR.replace(/\/$/, '')).catch(() => []); const out = []; for (const f of files) { const r = await packs.getJSON(slug, DIR + f, null); if (r) out.push(r); } return out.sort((a, b) => b.at - a.at); }
  return { tries: () => tries.slice(), refusals: () => refusals.slice(), noteRefusal, probe, status, quote, run, checkpoint, reconcileAll, busy, get, list, assetFor, runKeyOf, forget: () => { statusMemo = null; wsMemo = null; } /* after a connect or disconnect (server.js): the connection and the workspace are read again */ };
}
