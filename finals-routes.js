// "Make the final" routes, for the jam's drafts and for the studio's versions: what the sheet needs (the connection, the
// credits left, the photos and references to pick, the Spaces that fit), a quote on the chosen brief or Space, the run on
// that quote, and a Space checkpoint's yes or no. Mounted by feed-service.js (jam) and remix.js (studio) with one line each.
// A final lands as a draft card marked final, or as the next studio version labelled Final, and posts to the thread like
// every other asset. Chat never reaches these routes: only the button does.
import { sceneOf, cardProduct } from './product-match.js';
import { familyOf, matchSpaces } from './sloosh-spaces.js';

const firstLine = (md = '') => String(md).split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim()).find((l) => l && !/^(headline|primary text|button|cta)[:\s]/i.test(l)) || '';
const SPACES_TTL = 24 * 3600e3;

/* ---------- shared by the jam and the studio: the sheet's status and a spec from the body ---------- */
export function createFinalsSheet({ finals, sloosh, references = null, creditsLeft = () => null, brandOfT, log = console, now = () => Date.now() }) {
  let spacesMemo = null; /* list_spaces gives one page: pageSize 50 (the schema's maximum, through the `limit` alias) so every pinned Space is offered */
  const spacesList = async () => { if (spacesMemo && now() - spacesMemo.at < SPACES_TTL) return spacesMemo.list; const list = await sloosh.listSpaces({ limit: 50 }).catch((e) => { log.warn('[finals] list_spaces', e.message); return []; }); spacesMemo = { at: now(), list }; return list; };
  const brandFacts = (t) => { const b = brandOfT(t) || {}; const pr = b.config?.product || {}; return { name: b.seed?.brand?.name || b.name || '', noun: pr.noun, style: pr.style, avoid: pr.avoid, editorial: pr.editorial, colors: b.seed?.brand?.colors || b.profile?.identity?.colors || [] }; };
  /* the real photos a final can stand on: the ones given first, the product the card names, the card's own, the catalog lead */
  const photosOf = (t, c, extra = []) => { const b = brandOfT(t) || {}, cat = b.catalog || []; const named = c ? cardProduct(c, cat, { brand: b.seed?.brand?.name || '' }) : null;
    const rels = [...new Set([...extra, named?.img, ...(c?.images || []), c?.img, ...cat.slice(0, 12).map((x) => x.img)].filter((x) => x && typeof x === 'string' && !/^\/?gen\//.test(x) && !/statics\//.test(x)))];
    /* a rival ad card ("Make our version"): their ad is offered as the look (image 2), never as a product photo */
    return rels.slice(0, 16).map((rel) => { if (/^\/?research\//.test(rel)) return { url: rel, label: `${String(c?.title || 'The rival').split(':')[0]}'s ad (the look)`, job: 'style', keep: 'copy its layout, crop, light, colours and where the words sit; take nothing else from it', look: true };
      const p = cat.find((x) => x.img === rel); return { url: rel, label: p?.t || p?.title || named?.t || c?.title || 'Product photo', job: 'product', named: rel === named?.img }; }); };
  async function status(t, { slug, kind = 'image', format = '', photos = [], draft = null, pending = null }) {
    const st = await finals.status(); const fam = familyOf(format, kind);
    const spaces = st.ok && !st.dummy ? matchSpaces(await spacesList(), fam).map((s) => ({ id: s.spaceId || s.id, name: s.title || s.name, about: s.description || '', output: (s.outputTypes || []).join('/') || null, credits: null })) : [];
    let refs = []; try { refs = references ? (await references(t, slug)) || [] : []; } catch (e) { log.warn('[finals] references', e.message); }
    return { status: st, credits: creditsLeft(slug), photos, references: refs.map((r) => ({ id: r.id, url: r.url || (r.file ? `/b/${slug}/${r.file}` : null), label: r.label, job: r.job, keep: r.keep || '', kind: r.kind })).filter((r) => r.url), spaces, family: fam, draft, pending };
  }
  /* base: what the draft or version already says; b: what the sheet sent */
  function spec(t, base, b = {}) { const kind = base.kind === 'video' ? 'video' : 'image';
    const refs = (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && (r.url || r.file || r.id)).slice(0, 20).map((r) => ({ id: r.id, url: r.url || r.file, job: r.job || 'other', label: String(r.label || '').slice(0, 80), keep: String(r.keep || '').slice(0, 160), kind: r.kind }));
    const text = kind === 'image' ? (Array.isArray(b.text) ? b.text : b.text != null ? [b.text] : base.text ? [base.text] : []).map((x) => (typeof x === 'string' ? x : x?.words || '')).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [];
    const brand = brandFacts(t), visual = String(b.visual ?? base.visual ?? '').slice(0, 900);
    return { kind, title: base.title, visual, scene: base.scene || '', text, refs, ratio: base.ratio || (kind === 'video' ? '9:16' : '4:5'), seconds: +b.seconds || base.seconds || 6, sound: !!b.sound, motion: base.motion, beats: base.beats || [],
      brand, brandName: brand.name, product: base.product ? { name: base.product } : undefined, fromFile: base.fromFile || null, model: b.model || undefined,
      space: b.space?.id ? { id: String(b.space.id), name: b.space.name || null, inputs: b.space.inputs || {}, ctx: { productPhoto: refs.find((r) => r.job === 'product') || null, refs, copy: { headline: text[0] || '', script: base.script || '', primaryText: base.copy || '' }, brief: [visual, base.scene].filter(Boolean).join(' '), productName: base.product || '', ratio: base.ratio, seconds: +b.seconds || 6, sound: !!b.sound, brand, language: brandOfT(t)?.config?.language || 'English', country: brandOfT(t)?.config?.countryName || '' } } : null,
      revise: b.revise?.change ? { change: String(b.revise.change).slice(0, 300) } : null, revision: base.revision || 0, format: base.format || '' };
  }
  return { status, spec, photosOf, brandFacts };
}

/* ---------- the jam: a final is a draft card ---------- */
export function createFinalsRoutes({ on, W, say, meOf, slugOfT, brandOfT, cardOfW = () => null, references = null, finals, sloosh, creditsLeft = () => null, onReady = () => {}, save = () => {}, now = () => Date.now(), uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`, log = console }) {
  const sheet = createFinalsSheet({ finals, sloosh, references, creditsLeft, brandOfT, log, now });
  const nameOf = (t) => meOf(t)?.name || meOf(t)?.email || 'Someone';
  const draftOf = (w, id) => (w.drafts || []).find((d) => d.id === id && d.state !== 'making');
  const baseOf = (t, w, d) => { const c = cardOfW(t, w); return { kind: d.as === 'video' ? 'video' : 'image', title: d.title, visual: d.visual || '', scene: sceneOf(c), text: d.as !== 'video' ? firstLine(d.copy || '') : '', ratio: d.ratio, motion: d.motion, beats: d.script ? [{ shot: d.motion || d.visual, line: d.script }] : [], script: d.script || '', copy: d.copy || '', product: d.product || '', fromFile: d.video || d.image || null, revision: d.final ? (d.revision || 0) + 1 : 0, format: c?.make?.format || '' }; };

  on('GET', '/api/work/:wid/final/status', async (b, t, p, q) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const slug = slugOfT(t); const d = draftOf(w, q?.get?.('draftId') || b.draftId) || null; const c = cardOfW(t, w);
    return sheet.status(t, { slug, kind: d?.as === 'video' ? 'video' : 'image', format: c?.make?.format || '', photos: sheet.photosOf(t, c), pending: w.finalQuote?.draftId ? { draftId: w.finalQuote.draftId, at: w.finalQuote.at } : null,
      draft: d ? { id: d.id, as: d.as, title: d.title, visual: d.visual || '', motion: d.motion || '', text: d.as !== 'video' ? firstLine(d.copy || '') : '', ratio: d.ratio, final: !!d.final, image: d.image, video: d.video } : null }); });

  on('POST', '/api/work/:wid/final/quote', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const d = draftOf(w, b.draftId); if (!d) return { error: 'That draft is not here any more.' };
    const spec = sheet.spec(t, baseOf(t, w, d), b); const q = await finals.quote(slugOfT(t), spec).catch((e) => ({ error: e.message }));
    if (q.error) { w.finalQuote = null; return { error: q.error, missing: q.missing || null, fields: q.fields || null, inputs: q.inputs || null, filled: q.filled || null, credits: q.credits ?? null }; }
    w.finalQuote = { draftId: d.id, spec, quote: q, at: now(), by: nameOf(t) }; save(t);
    const { raw, ...show } = q; return { quote: { ...show, refs: (q.refs || []).map((r) => ({ id: r.id, url: r.url, job: r.job, label: r.label, keep: r.keep })) } }; });

  on('POST', '/api/work/:wid/final/run', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const fq = w.finalQuote; if (!fq || fq.draftId !== b.draftId) return { error: 'Get the quote first.' };
    const d = draftOf(w, b.draftId); if (!d) return { error: 'That draft is not here any more.' }; const slug = slugOfT(t), by = nameOf(t), q = fq.quote, spec = fq.spec; w.finalQuote = null;
    const fd = { id: uid('fn'), as: d.as, state: 'making', step: q.dummy ? 'Making the final' : q.provider === 'gemini' ? `Making the final with Gemini (Sloosh not ready: ${q.fallbackWhy || 'no credits yet'})` : `Sloosh is making the final (${q.space ? q.space.name || 'a Space' : q.label || q.model})`, provider: q.provider || (q.dummy ? 'dummy' : 'sloosh'), final: true, from: d.id, revision: spec.revision, title: `Final: ${String(d.title || '').replace(/^(first draft|final):\s*/i, '')}`.slice(0, 70), copy: d.copy, ratio: spec.ratio, credits: q.credits, model: q.model || null, space: q.space || null, refs: (q.refs || []).map((r) => ({ id: r.id, job: r.job, label: r.label })), by, at: now(t), dummy: !!q.dummy, product: d.product || null, visual: spec.visual, motion: d.motion || null, script: d.script || null };
    w.drafts.unshift(fd); w.drafts.splice(12); w.updatedAt = now(t); save(t);
    say(t, w, { from: 'system', body: `${by} asked for the final${q.credits ? ` (${q.credits} credits, ${q.space ? q.space.name || 'a Sloosh Space' : q.label || q.model})` : q.provider === 'gemini' ? ' (made with Gemini: Sloosh is not ready yet)' : ''}.`, noMirror: true });
    (async () => { try { const rec = await finals.run(slug, spec, { quote: q, by, target: { wid: w.id, draftId: d.id, revision: spec.revision } });
        if (rec.state === 'checkpoint') { Object.assign(fd, { state: 'checkpoint', step: 'The Space is waiting for a yes', runKey: rec.runKey, checkpoint: rec.checkpoint || null }); say(t, w, { from: 'ai', who: 'Brew', body: 'The Sloosh Space paused for a check. Open the final to approve or stop it.', noMirror: true }); }
        else { Object.assign(fd, { state: 'ready', step: null, runKey: rec.runKey, [spec.kind === 'video' ? 'video' : 'image']: rec.file, link: rec.link || null, assetId: rec.assetId || null, credits: rec.charged ?? rec.credits, dummy: !!rec.dummy, fallback: !!rec.fallback, provider: rec.provider || 'sloosh', outputs: rec.outputs || null });
          if (spec.kind === 'video' && d.image) fd.image = d.image; /* the draft's still as the poster */
          say(t, w, { from: 'ai', who: 'Brew', body: rec.dummy ? 'The final is here (simulated on this site).' : rec.provider === 'gemini' ? `The final is here, made with Gemini (Sloosh not ready: ${q.fallbackWhy || 'no credits yet'}).` : `The final is here: ${rec.charged ?? rec.credits} credits on ${q.space ? q.space.name || 'the Space' : q.label || q.model}.`, noMirror: true }); onReady(t, w, fd); }
      } catch (e) { Object.assign(fd, { state: 'ready', err: e.message, step: null, failed: !e.open, open: !!e.open, runKey: e.rec?.runKey || fd.runKey || null }); log.warn('[finals] run', slug, e.message); say(t, w, { from: 'ai', who: 'Brew', body: e.open ? e.message : `The final didn’t come through: ${e.message}`, noMirror: true }); } /* e.open: Sloosh may still be making it; the record stays running and reconcileAll collects it after the next restart */
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
  return sheet;
}

/* ---------- the studio: a final is the next version, labelled Final ---------- */
export function createStudioFinals({ on, C, ensurePkg, sync, version, pubChange, cardOf = () => null, cardPhoto = () => null, catalogOf = () => [], jobs, references = null, finals, sloosh, creditsLeft = () => null, brandOfT, slugOfT, meOf = () => null, onMedia = () => {}, isVideo = () => false, RATIO = {}, now = () => Date.now(), log = console }) {
  const sheet = createFinalsSheet({ finals, sloosh, references, creditsLeft, brandOfT, log, now });
  const nameOf = (t) => meOf(t)?.name || meOf(t)?.email || 'Someone';
  const headFinal = (ch) => (ch.versions || []).find?.((v) => v.id === ch.headVersionId)?.final || ch.lastFinal?.versionId === ch.headVersionId ? ch.lastFinal : null;
  const baseOf = (t, ch) => { const c = cardOf(t, ch) || {}, p = ch.pkg || {}; const fin = headFinal(ch); return { kind: isVideo(ch) ? 'video' : 'image', title: ch.after?.title || c.title || '', visual: [p.imageBrief, p.knobs?.scene ? `Scene: ${p.knobs.scene}.` : '', p.knobs?.audience ? `For ${p.knobs.audience}.` : ''].filter(Boolean).join(' '), scene: sceneOf(c), text: p.overlay || p.headline || '', copy: p.primaryText || p.copy || '', ratio: RATIO[p.format] || '4:5', script: (p.script || [])[0]?.line || '', fromFile: p.video || p.image || null, revision: fin ? (fin.revision || 0) + 1 : 0, format: c?.make?.format || p.format || '' }; };
  const photos = (t, ch) => { const c = cardOf(t, ch) || {}, p = ch.pkg || {}; return sheet.photosOf(t, c, [...(p.photos || []).filter((u) => !/^gen\//.test(u)), cardPhoto(t, c)]); };
  const draftOf = (t, ch) => { const p = ch.pkg || {}, b = baseOf(t, ch); return { id: ch.id, as: b.kind, title: b.title, visual: b.visual, motion: '', text: b.text, ratio: b.ratio, final: !!headFinal(ch), image: p.image || null, video: p.video || null }; };

  on('GET', '/api/changes/:chid/final/status', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); const base = baseOf(t, ch);
    return sheet.status(t, { slug: slugOfT(t), kind: base.kind, format: base.format, photos: photos(t, ch), draft: draftOf(t, ch), pending: ch.finalQuote ? { at: ch.finalQuote.at } : null }); });

  on('POST', '/api/changes/:chid/final/quote', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (ch.imagePending || ch.videoPending || ch.remakePending) return { error: 'A picture is still being made. One moment.' };
    const spec = sheet.spec(t, baseOf(t, ch), b); const q = await finals.quote(slugOfT(t), spec).catch((e) => ({ error: e.message }));
    if (q.error) { ch.finalQuote = null; return { error: q.error, missing: q.missing || null, fields: q.fields || null, inputs: q.inputs || null, filled: q.filled || null, credits: q.credits ?? null }; }
    ch.finalQuote = { spec, quote: q, at: now(), by: nameOf(t) }; sync(t, ch);
    const { raw, ...show } = q; return { quote: { ...show, refs: (q.refs || []).map((r) => ({ id: r.id, url: r.url, job: r.job, label: r.label, keep: r.keep })) } }; });

  on('POST', '/api/changes/:chid/final/run', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); const fq = ch.finalQuote; if (!fq) return { error: 'Get the quote first.' };
    const slug = slugOfT(t), by = nameOf(t), { quote: q, spec } = fq; ch.finalQuote = null; const isVid = spec.kind === 'video';
    if (isVid) { ch.videoPending = true; ch.videoStep = 'Sloosh is making the final'; } else ch.imagePending = true; ch.imageError = null; ch.finalPending = { at: now(), credits: q.credits, model: q.label || q.model || q.space?.name || null, fallback: !!q.fallback, provider: q.provider || 'sloosh' }; jobs?.add?.(ch.id); sync(t, ch);
    (async () => { try { const rec = await finals.run(slug, spec, { quote: q, by, target: { chid: ch.id, revision: spec.revision } });
        if (rec.state === 'checkpoint') { ch.finalCheckpoint = { runKey: rec.runKey, checkpoint: rec.checkpoint || null, at: now() }; ch.imageError = 'The Sloosh Space paused for a check. Open Make the final to carry on or stop.'; }
        else { ch.pkg = { ...ch.pkg, ...(isVid ? { video: rec.file } : { image: rec.file }) };
          const v = version(t, ch, rec.provider === 'gemini' ? 'gemini' : 'sloosh', `Final: ${rec.dummy ? 'simulated' : rec.provider === 'gemini' ? `made with Gemini (Sloosh not ready: ${q.fallbackWhy || 'no credits yet'})` : `${rec.charged ?? rec.credits} credits on ${q.space ? q.space.name || 'a Sloosh Space' : q.label || q.model}`}`, rec.dummy ? 'Final (Dummy)' : rec.provider === 'gemini' ? 'Final (Gemini)' : 'Final');
          v.final = { credits: rec.charged ?? rec.credits, model: q.model || null, label: q.label || null, space: q.space || null, dummy: !!rec.dummy, fallback: !!rec.fallback, provider: rec.provider || 'sloosh', link: rec.link || null, assetId: rec.assetId || null, assetKind: rec.assetKind || null, revision: spec.revision, runKey: rec.runKey, by };
          ch.lastFinal = { versionId: v.id, ...v.final };
          try { onMedia(t, ch, { kind: isVid ? 'video' : 'image', images: isVid ? [] : [rec.file], video: isVid ? rec.file : null, n: v.n, label: v.label }); } catch {} }
      } catch (e) { ch.imageError = String(e.message).slice(0, 200); log.warn('[finals] studio run', slug, e.message); }
      finally { ch.imagePending = false; ch.videoPending = null; ch.videoStep = null; ch.finalPending = null; jobs?.delete?.(ch.id); sync(t, ch); } })();
    return { change: pubChange(t, ch) }; });

  on('POST', '/api/changes/:chid/final/checkpoint', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; const ck = ch.finalCheckpoint; if (!ck?.runKey) return { error: 'Nothing is waiting here.' };
    const slug = slugOfT(t), by = nameOf(t); ch.finalCheckpoint = null; ch.imagePending = true; ch.imageError = null; jobs?.add?.(ch.id); sync(t, ch);
    (async () => { try { const rec = await finals.checkpoint(slug, ck.runKey, !!b.ok, String(b.note || '').slice(0, 300)); if (rec.error) throw new Error(rec.error);
        if (rec.state === 'done') { ch.pkg = { ...ch.pkg, image: rec.file }; const v = version(t, ch, 'sloosh', `Final: ${rec.charged ?? rec.credits} credits`, 'Final'); v.final = { credits: rec.charged ?? rec.credits, space: rec.space || null, link: rec.link || null, assetId: rec.assetId || null, runKey: rec.runKey, by }; ch.lastFinal = { versionId: v.id, ...v.final }; try { onMedia(t, ch, { kind: 'image', images: [rec.file], n: v.n, label: v.label }); } catch {} }
        else if (rec.state === 'checkpoint') { ch.finalCheckpoint = { runKey: rec.runKey, checkpoint: rec.checkpoint || null, at: now() }; ch.imageError = 'The Sloosh Space paused again. Open Make the final to carry on or stop.'; }
        else ch.imageError = rec.error || 'stopped at the checkpoint';
      } catch (e) { ch.imageError = String(e.message).slice(0, 200); } finally { ch.imagePending = false; jobs?.delete?.(ch.id); sync(t, ch); } })();
    return { change: pubChange(t, ch) }; });
  return sheet;
}
