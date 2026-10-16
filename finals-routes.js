// The jam's "Make the final" routes: what the sheet needs (the connection, the credits left, the photos and references to
// pick, the Spaces that fit), a quote on the chosen brief or Space, the run on that quote, and a Space checkpoint's yes or
// no. Mounted by feed-service.js with one line. A final lands as a draft card at the top of the jam's drafts, marked final,
// and posts to the thread like every other asset. Chat never reaches these routes: only the button does.
import { sceneOf, cardProduct } from './product-match.js';
import { familyOf, matchSpaces } from './sloosh-spaces.js';

const firstLine = (md = '') => String(md).split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim()).find((l) => l && !/^(headline|primary text|button|cta)[:\s]/i.test(l)) || '';
const SPACES_TTL = 24 * 3600e3;

export function createFinalsRoutes({ on, W, say, meOf, slugOfT, brandOfT, cardOfW = () => null, references = null, finals, sloosh, creditsLeft = () => null, onReady = () => {}, save = () => {}, now = () => Date.now(), uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`, log = console }) {
  let spacesMemo = null;
  const spacesList = async () => { if (spacesMemo && now() - spacesMemo.at < SPACES_TTL) return spacesMemo.list; const list = await sloosh.listSpaces().catch((e) => { log.warn('[finals] list_spaces', e.message); return []; }); spacesMemo = { at: now(), list }; return list; };
  const nameOf = (t) => meOf(t)?.name || meOf(t)?.email || 'Someone';
  const draftOf = (w, id) => (w.drafts || []).find((d) => d.id === id && d.state !== 'making');
  const brandFacts = (t) => { const b = brandOfT(t) || {}; const pr = b.config?.product || {}; return { name: b.seed?.brand?.name || b.name || '', noun: pr.noun, style: pr.style, avoid: pr.avoid, editorial: pr.editorial, colors: b.seed?.brand?.colors || b.profile?.identity?.colors || [] }; };
  /* the real photos a final can stand on: the card's own, the product it names, the catalog lead */
  const photosOf = (t, w) => { const c = cardOfW(t, w) || {}, b = brandOfT(t) || {}, cat = b.catalog || []; const named = c ? cardProduct(c, cat, { brand: b.seed?.brand?.name || '' }) : null;
    const rels = [...new Set([named?.img, ...(c.images || []), c.img, ...cat.slice(0, 12).map((x) => x.img)].filter((x) => x && typeof x === 'string' && !/^\/?gen\//.test(x)))];
    return rels.slice(0, 16).map((rel) => { const p = cat.find((x) => x.img === rel); return { url: rel, label: p?.t || p?.title || named?.t || c.title || 'Product photo', job: 'product', named: rel === named?.img }; }); };
  const specOf = (t, w, d, b = {}) => { const c = cardOfW(t, w); const kind = d.as === 'video' ? 'video' : 'image';
    const refs = (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && (r.url || r.file || r.id)).slice(0, 30).map((r) => ({ id: r.id, url: r.url || r.file, job: r.job || 'other', label: String(r.label || '').slice(0, 80), keep: String(r.keep || '').slice(0, 160), kind: r.kind }));
    const text = kind === 'image' ? (Array.isArray(b.text) ? b.text : b.text != null ? [b.text] : d.copy ? [firstLine(d.copy)] : []).map((x) => (typeof x === 'string' ? x : x?.words || '')).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [];
    return { kind, title: d.title, visual: String(b.visual ?? d.visual ?? '').slice(0, 900), scene: sceneOf(c), text, refs, ratio: d.ratio || (kind === 'video' ? '9:16' : '4:5'), seconds: +b.seconds || 6, sound: !!b.sound, motion: d.motion, beats: d.script ? [{ shot: d.motion || d.visual, line: d.script }] : [],
      brand: brandFacts(t), brandName: brandFacts(t).name, product: d.product ? { name: d.product } : undefined, fromFile: d.video || d.image || null, model: b.model || undefined, space: b.space?.id ? { id: String(b.space.id), name: b.space.name || null, inputs: b.space.inputs || {}, ctx: { productPhoto: refs.find((r) => r.job === 'product') || null, refs, copy: { headline: text[0] || '', script: d.script || '', primaryText: d.copy || '' }, brief: [d.visual, sceneOf(c)].filter(Boolean).join(' '), productName: d.product || '', ratio: d.ratio, seconds: +b.seconds || 6, sound: !!b.sound, brand: brandFacts(t), language: brandOfT(t)?.config?.language || 'English', country: brandOfT(t)?.config?.countryName || '' } } : null,
      revise: b.revise?.change ? { change: String(b.revise.change).slice(0, 300) } : null, revision: d.final ? (d.revision || 0) + 1 : 0, format: c?.make?.format || '' }; };

  on('GET', '/api/work/:wid/final/status', async (b, t, p, q) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const slug = slugOfT(t); const d = draftOf(w, q?.get?.('draftId') || b.draftId) || null; const c = cardOfW(t, w);
    const st = await finals.status(); const kind = d?.as === 'video' ? 'video' : 'image'; const fam = familyOf(c?.make?.format || '', kind);
    const spaces = st.ok && !st.dummy ? matchSpaces(await spacesList(), fam).map((s) => ({ id: s.id || s.space_id, name: s.name || s.title, about: s.description || s.summary || '', output: s.output || s.output_type || null, credits: s.credits ?? s.cost ?? null })) : [];
    let refs = []; try { refs = references ? (await references.list(slug)) || [] : []; } catch (e) { log.warn('[finals] references', e.message); }
    return { status: st, credits: creditsLeft(slug), photos: photosOf(t, w), references: refs.map((r) => ({ id: r.id, url: r.url || (r.file ? `/b/${slug}/${r.file}` : null), label: r.label, job: r.job, keep: r.keep || '', kind: r.kind })), spaces, family: fam,
      draft: d ? { id: d.id, as: d.as, title: d.title, visual: d.visual || '', motion: d.motion || '', text: kind === 'image' ? firstLine(d.copy || '') : '', ratio: d.ratio, final: !!d.final, image: d.image, video: d.video } : null, pending: w.finalQuote?.draftId ? { draftId: w.finalQuote.draftId, at: w.finalQuote.at } : null }; });

  on('POST', '/api/work/:wid/final/quote', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const d = draftOf(w, b.draftId); if (!d) return { error: 'That draft is not here any more.' };
    const spec = specOf(t, w, d, b); const q = await finals.quote(slugOfT(t), spec).catch((e) => ({ error: e.message }));
    if (q.error) { w.finalQuote = null; return { error: q.error, missing: q.missing || null, fields: q.fields || null, inputs: q.inputs || null, filled: q.filled || null, credits: q.credits ?? null }; }
    w.finalQuote = { draftId: d.id, spec, quote: q, at: now(), by: nameOf(t) }; save(t);
    const { raw, ...show } = q; return { quote: { ...show, refs: (q.refs || []).map((r) => ({ id: r.id, url: r.url, job: r.job, label: r.label, keep: r.keep })) } }; });

  on('POST', '/api/work/:wid/final/run', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const fq = w.finalQuote; if (!fq || fq.draftId !== b.draftId) return { error: 'Get the quote first.' };
    const d = draftOf(w, b.draftId); if (!d) return { error: 'That draft is not here any more.' }; const slug = slugOfT(t), by = nameOf(t), q = fq.quote, spec = fq.spec; w.finalQuote = null;
    const fd = { id: uid('fn'), as: d.as, state: 'making', step: q.dummy ? 'Making the final' : `Sloosh is making the final (${q.space ? q.space.name || 'a Space' : q.model})`, final: true, from: d.id, revision: spec.revision, title: `Final: ${String(d.title || '').replace(/^(first draft|final):\s*/i, '')}`.slice(0, 70), copy: d.copy, ratio: spec.ratio, credits: q.credits, model: q.model || null, space: q.space || null, refs: (q.refs || []).map((r) => ({ id: r.id, job: r.job, label: r.label })), by, at: now(t), dummy: !!q.dummy, product: d.product || null, visual: spec.visual, motion: d.motion || null, script: d.script || null };
    w.drafts.unshift(fd); w.drafts.splice(12); w.updatedAt = now(t); save(t);
    say(t, w, { from: 'system', body: `${by} asked for the final${q.credits ? ` (${q.credits} credits, ${q.space ? q.space.name || 'a Sloosh Space' : q.model})` : ''}.`, noMirror: true });
    (async () => { try { const rec = await finals.run(slug, spec, { quote: q, by, target: { wid: w.id, draftId: d.id, revision: spec.revision } });
        if (rec.state === 'checkpoint') { Object.assign(fd, { state: 'checkpoint', step: 'The Space is waiting for a yes', runKey: rec.runKey, checkpoint: rec.checkpoint || null }); say(t, w, { from: 'ai', who: 'Brew', body: 'The Sloosh Space paused for a check. Open the final to approve or stop it.', noMirror: true }); }
        else { Object.assign(fd, { state: 'ready', step: null, runKey: rec.runKey, [spec.kind === 'video' ? 'video' : 'image']: rec.file, link: rec.link || null, assetId: rec.assetId || null, credits: rec.charged ?? rec.credits, dummy: !!rec.dummy, outputs: rec.outputs || null });
          if (spec.kind === 'video' && d.image) fd.image = d.image; /* the draft's still as the poster */
          say(t, w, { from: 'ai', who: 'Brew', body: rec.dummy ? 'The final is here (simulated on this site).' : `The final is here: ${rec.charged ?? rec.credits} credits on ${q.space ? q.space.name || 'the Space' : q.model}.`, noMirror: true }); onReady(t, w, fd); }
      } catch (e) { Object.assign(fd, { state: 'ready', err: e.message, step: null, failed: true }); log.warn('[finals] run', slug, e.message); say(t, w, { from: 'ai', who: 'Brew', body: `The final didn’t come through: ${e.message}`, noMirror: true }); }
      w.updatedAt = now(t); save(t); })();
    return { work: true, draftId: fd.id }; });

  on('POST', '/api/work/:wid/final/checkpoint', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const fd = (w.drafts || []).find((d) => d.id === b.draftId && d.state === 'checkpoint'); if (!fd?.runKey) return { error: 'Nothing is waiting here.' };
    const slug = slugOfT(t), by = nameOf(t); fd.state = 'making'; fd.step = b.ok ? 'Sloosh is carrying on' : 'Stopping'; save(t);
    (async () => { try { const rec = await finals.checkpoint(slug, fd.runKey, !!b.ok, String(b.note || '').slice(0, 300)); if (rec.error) throw new Error(rec.error);
        if (rec.state === 'done') { Object.assign(fd, { state: 'ready', step: null, [fd.as === 'video' ? 'video' : 'image']: rec.file, link: rec.link || null, assetId: rec.assetId || null, credits: rec.charged ?? rec.credits }); say(t, w, { from: 'ai', who: 'Brew', body: `The final is here: ${rec.charged ?? rec.credits} credits.`, noMirror: true }); onReady(t, w, fd); }
        else if (rec.state === 'checkpoint') { Object.assign(fd, { state: 'checkpoint', step: 'The Space is waiting for a yes', checkpoint: rec.checkpoint || null }); }
        else { Object.assign(fd, { state: 'ready', err: rec.error || 'stopped', failed: true, step: null }); say(t, w, { from: 'system', body: `${by} stopped the final at the Space’s check.`, noMirror: true }); }
      } catch (e) { Object.assign(fd, { state: 'ready', err: e.message, failed: true, step: null }); } w.updatedAt = now(t); save(t); })();
    return { ok: true }; });

  return { specOf, photosOf };
}
