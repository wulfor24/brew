// "Make the final" routes, for the jam's drafts and for the studio's versions: what the sheet needs (the connection, the
// credits left, the photos and references to pick, the Spaces that fit), a quote on the chosen brief or Space, the run on
// that quote, and a Space checkpoint's yes or no. Mounted by feed-service.js (jam) and remix.js (studio) with one line each.
// A final lands as a draft card marked final, or as the next studio version labelled Final, and posts to the thread like
// every other asset. Chat never reaches these routes: only the button does.
import { isResearchImage } from './rival-ad.js'; // a rival's ad is never a photo a final stands on
import { sceneOf, cardProduct } from './product-match.js';
import { familyOf, matchSpaces } from './sloosh-spaces.js';

const firstLine = (md = '') => String(md).split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim()).find((l) => l && !/^(headline|primary text|button|cta)[:\s]/i.test(l)) || '';
const SPACES_TTL = 24 * 3600e3;
const isStill = (f) => typeof f === 'string' && /\.(png|jpe?g|webp)(\?|$)/i.test(f);
/* a spoken script → one beat per line or sentence, the first carrying the draft's shot (a whole script in one beat made one long take) */
export const beatsOf = (script = '', shot = '') => { const xs = String(script || '').split(/\n+|(?<=[.!?])\s+(?=[A-Z"“])/).map((x) => x.replace(/^\s*(?:\d+\s*[-–]\s*\d+\s*s|shot\s*\d+|vo|voiceover)\s*[:.)-]\s*/i, '').trim()).filter(Boolean).slice(0, 6);
  return xs.length ? xs.map((line, i) => ({ shot: i === 0 ? shot || '' : '', line })) : []; };

/* ---------- shared by the jam and the studio: the sheet's status and a spec from the body ---------- */
export function createFinalsSheet({ finals, sloosh, references = null, creditsLeft = () => null, brandOfT, log = console, now = () => Date.now() }) {
  let spacesMemo = null; /* list_spaces gives one page: pageSize 50 (the schema's maximum, through the `limit` alias) so every pinned Space is offered */
  const spacesList = async () => { if (spacesMemo && now() - spacesMemo.at < SPACES_TTL) return spacesMemo.list; const list = await sloosh.listSpaces({ limit: 50 }).catch((e) => { log.warn('[finals] list_spaces', e.message); return []; }); spacesMemo = { at: now(), list }; return list; };
  const brandFacts = (t) => { const b = brandOfT(t) || {}; const pr = b.config?.product || {}; return { name: b.seed?.brand?.name || b.name || '', noun: pr.noun, style: pr.style, avoid: pr.avoid, editorial: pr.editorial, colors: b.seed?.brand?.colors || b.profile?.identity?.colors || [] }; };
  /* the real photos a final can stand on: the ones given first, the product the card names, the card's own, the catalog lead */
  const photosOf = (t, c, extra = []) => { const b = brandOfT(t) || {}, cat = b.catalog || []; const named = c ? cardProduct(c, cat, { brand: b.seed?.brand?.name || '' }) : null;
    const rels = [...new Set([...extra, named?.img, ...(c?.images || []), c?.img, ...cat.slice(0, 12).map((x) => x.img)].filter((x) => x && typeof x === 'string' && !/^\/?gen\//.test(x) && !/statics\//.test(x)))];
    /* a rival's ad ("Make our version") is never offered: a model given their picture copies it; its composition already
       rides in the draft's brief as words (rival-ad.js) */
    /* the product's own name, matched on the photo's path (a ?v= query on a Shopify URL missed it and the card's title, "Fix cold feet
       for $39", became the product's name in the brief); never the card's title */
    const bare = (u) => String(u || '').split('?')[0];
    return rels.filter((rel) => !isResearchImage(rel)).slice(0, 16).map((rel) => { const p = cat.find((x) => bare(x.img) === bare(rel)); return { url: rel, label: p?.t || p?.title || (named && extra.some((x) => bare(x) === bare(rel)) ? named.t : '') || 'Product photo', job: 'product', named: bare(rel) === bare(named?.img) }; }); }; /* the card's own photo shows the product the card names */
  async function status(t, { slug, kind = 'image', format = '', photos = [], draft = null, pending = null }) {
    const st = await finals.status(); const fam = familyOf(format, kind);
    const spaces = st.ok && !st.dummy ? matchSpaces(await spacesList(), fam).map((s) => ({ id: s.spaceId || s.id, name: s.title || s.name, about: s.description || '', output: (s.outputTypes || []).join('/') || null, credits: null })) : [];
    let refs = []; try { refs = references ? (await references(t, slug)) || [] : []; } catch (e) { log.warn('[finals] references', e.message); }
    return { status: st, credits: creditsLeft(slug), photos, references: refs.map((r) => ({ id: r.id, url: r.url || (r.file ? `/b/${slug}/${r.file}` : null), label: r.label, job: r.job, keep: r.keep || '', kind: r.kind })).filter((r) => r.url), spaces, family: fam, draft, pending };
  }
  /* base: what the draft or version already says; b: what the sheet sent */
  function spec(t, base, b = {}) { const kind = base.kind === 'video' ? 'video' : 'image';
    const refs = (Array.isArray(b.refs) ? b.refs : []).filter((r) => r && (r.url || r.file || r.id) && !isResearchImage(r.url || r.file || '') && r.job !== 'frame').slice(0, 20).map((r) => ({ id: r.id, url: r.url || r.file, job: r.job || 'other', label: String(r.label || '').slice(0, 80), keep: String(r.keep || '').slice(0, 160), kind: r.kind }));
    /* the draft the team approved rides along: an image final keeps its composition (job 'layout', after the product photos), a reel
       opens on its first frame (job 'frame', sent as start_frame where the model takes one). A revision edits the last final instead */
    const draftPic = !b.revise?.change && isStill(base.still || base.fromFile) && !isResearchImage(base.still || base.fromFile) ? base.still || base.fromFile : null;
    if (draftPic && kind === 'image' && refs.some((r) => r.job === 'product') && !refs.some((r) => r.url === draftPic)) refs.push({ url: draftPic, job: 'layout', label: '', keep: '' });
    if (draftPic && kind === 'video') refs.push({ url: draftPic, job: 'frame', label: '', keep: '' });
    const text = kind === 'image' ? (Array.isArray(b.text) ? b.text : b.text != null ? [b.text] : base.text ? [base.text] : []).map((x) => (typeof x === 'string' ? x : x?.words || '')).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [];
    /* our version of a rival's ad (base.rival, rival-ad.js rivalPicture): their composition and look ride as words after the brief,
       and our words sit where theirs did (the sheet's edited words replace ours in order). Sloosh and the Gemini fallback get the same */
    const pic = base.rival?.visual ? base.rival : null, own = String(b.visual ?? base.visual ?? '').slice(0, 900);
    const brand0 = brandFacts(t), brand = pic?.look ? { ...brand0, style: pic.look } : brand0, visual = pic && !own.includes(pic.visual) ? `${own} ${pic.visual}`.trim().slice(0, 1800) : own;
    const none = Array.isArray(b.text) && !text.length; /* the sheet's "empty for none" */
    const placed = pic?.text?.length && kind === 'image' && !none ? pic.text.map((x, i) => ({ ...x, words: text[i] ?? x.words })).filter((x) => String(x.words || '').trim()) : text;
    return { kind, title: base.title, visual, scene: base.scene || '', text: placed, refs, rival: !!pic, ratio: base.ratio || (kind === 'video' ? '9:16' : '4:5'), seconds: +b.seconds || base.seconds || 6, sound: !!b.sound, motion: base.motion, beats: base.beats || [],
      brand, brandName: brand.name, product: base.product ? { name: base.product } : (() => { const l = refs.find((r) => r.job === 'product' && r.label && !/^product( photo)?$/i.test(r.label))?.label; return l ? { name: l } : undefined; })(), fromFile: base.fromFile || null, model: b.model || undefined,
      space: b.space?.id ? { id: String(b.space.id), name: b.space.name || null, inputs: b.space.inputs || {}, ctx: { productPhoto: refs.find((r) => r.job === 'product') || null, refs, copy: { headline: text[0] || '', script: base.script || '', primaryText: base.copy || '' }, brief: [visual, base.scene].filter(Boolean).join(' '), productName: base.product || '', ratio: base.ratio, seconds: +b.seconds || 6, sound: !!b.sound, brand, language: brandOfT(t)?.config?.language || 'English', country: brandOfT(t)?.config?.countryName || '' } } : null,
      revise: b.revise?.change ? { change: String(b.revise.change).slice(0, 300) } : null, revision: base.revision || 0, format: base.format || '' };
  }
  return { status, spec, photosOf, brandFacts };
}

/* ---------- the jam: a final is a draft card ---------- */
export function createFinalsRoutes({ on, W, say, meOf, slugOfT, brandOfT, cardOfW = () => null, references = null, finals, sloosh, creditsLeft = () => null, rivalOf = async () => null, onReady = () => {}, save = () => {}, now = () => Date.now(), uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`, log = console }) {
  const sheet = createFinalsSheet({ finals, sloosh, references, creditsLeft, brandOfT, log, now });
  const nameOf = (t) => meOf(t)?.name || meOf(t)?.email || 'Someone';
  const draftOf = (w, id) => (w.drafts || []).find((d) => d.id === id && d.state !== 'making');
  /* a draft of "Make our version": the rival's ad read (rival-ad.js), with our headline and button where theirs sit */
  const withRival = async (t, w, d, base) => { const rival = await rivalOf(t, cardOfW(t, w), { headline: base.text || '', button: (String(d.copy || '').match(/button[^:]*:\s*([^\n]+)/i) || [])[1] || '' }).catch(() => null); return rival ? { ...base, rival } : base; };
  const baseOf = (t, w, d) => { const c = cardOfW(t, w); return { kind: d.as === 'video' ? 'video' : 'image', title: d.title, visual: d.visual || '', scene: sceneOf(c), text: d.as !== 'video' ? firstLine(d.copy || '') : '', ratio: d.ratio, motion: d.motion, beats: d.as === 'video' ? beatsOf(d.script, d.motion || d.visual) : [], script: d.script || '', copy: d.copy || '', product: d.product || '', fromFile: d.video || d.image || null, still: d.as === 'video' ? [d.poster, d.image].find(isStill) || null : null, revision: d.final ? (d.revision || 0) + 1 : 0, format: c?.make?.format || '' }; };

  on('GET', '/api/work/:wid/final/status', async (b, t, p, q) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const slug = slugOfT(t); const d = draftOf(w, q?.get?.('draftId') || b.draftId) || null; const c = cardOfW(t, w);
    return sheet.status(t, { slug, kind: d?.as === 'video' ? 'video' : 'image', format: c?.make?.format || '', photos: sheet.photosOf(t, c), pending: w.finalQuote?.draftId ? { draftId: w.finalQuote.draftId, at: w.finalQuote.at } : null,
      draft: d ? { id: d.id, as: d.as, title: d.title, visual: d.visual || '', motion: d.motion || '', text: d.as !== 'video' ? firstLine(d.copy || '') : '', ratio: d.ratio, final: !!d.final, image: d.image, video: d.video } : null }); });

  on('POST', '/api/work/:wid/final/quote', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const d = draftOf(w, b.draftId); if (!d) return { error: 'That draft is not here any more.' };
    const spec = sheet.spec(t, await withRival(t, w, d, baseOf(t, w, d)), b); const q = await finals.quote(slugOfT(t), spec).catch((e) => ({ error: e.message }));
    if (q.error) { w.finalQuote = null; return { error: q.error, missing: q.missing || null, fields: q.fields || null, inputs: q.inputs || null, filled: q.filled || null, credits: q.credits ?? null }; }
    w.finalQuote = { draftId: d.id, spec, quote: q, at: now(), by: nameOf(t) }; save(t);
    const { raw, ...show } = q; return { quote: { ...show, refs: (q.refs || []).map((r) => ({ id: r.id, url: r.url, job: r.job, label: r.label, keep: r.keep })) } }; });

  on('POST', '/api/work/:wid/final/run', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const fq = w.finalQuote; if (!fq || fq.draftId !== b.draftId) return { error: 'Get the quote first.' };
    const d = draftOf(w, b.draftId); if (!d) return { error: 'That draft is not here any more.' }; const slug = slugOfT(t), by = nameOf(t), q = fq.quote, spec = fq.spec; w.finalQuote = null;
    const fd = { id: uid('fn'), as: d.as, state: 'making', step: q.dummy ? 'Making the final' : q.provider === 'gemini' ? `Making the final with Gemini (Sloosh not ready: ${q.fallbackWhy || 'no credits yet'})` : `Sloosh is making the final (${q.space ? q.space.name || 'a Space' : q.label || q.model})`, provider: q.provider || (q.dummy ? 'dummy' : 'sloosh'), final: true, from: d.id, revision: spec.revision, title: `Final: ${String(d.title || '').replace(/^(first draft|final):\s*/i, '')}`.slice(0, 70), copy: d.copy, ratio: spec.ratio, credits: q.credits, model: q.model || null, space: q.space || null, refs: (q.refs || []).map((r) => ({ id: r.id, job: r.job, label: r.label })), by, at: now(t), dummy: !!q.dummy, product: d.product || null, visual: spec.visual, motion: d.motion || null, script: d.script || null };
    w.drafts.unshift(fd); w.drafts.splice(12); w.updatedAt = now(t); save(t);
    say(t, w, { from: 'system', body: `${by} asked for the final${q.credits ? ` (${q.credits} credits, ${q.space ? q.space.name || 'a Sloosh Space' : q.label || q.model})` : q.provider === 'gemini' ? ' (made with Gemini: Sloosh is not ready yet)' : ''}.`, noMirror: true });
    (async () => { try { const rec = await finals.run(slug, spec, { quote: q, by, target: { wid: w.id, draftId: d.id, revision: spec.revision }, land: { tid: t.id || null, fid: fd.id } });
        landIn(t, w, fd, rec, { label: q.label || q.model, space: q.space, fallbackWhy: q.fallbackWhy, poster: d.image });
      } catch (e) { Object.assign(fd, { state: 'ready', err: e.message, step: null, failed: !e.open, open: !!e.open, runKey: e.rec?.runKey || fd.runKey || null }); log.warn('[finals] run', slug, e.message); say(t, w, { from: 'ai', who: 'Brew', body: e.open ? e.message : `The final didn’t come through: ${e.message}`, noMirror: true }); } /* e.open: Sloosh may still be making it; the record stays running and reconcileAll collects it after the next restart */
      w.updatedAt = now(t); save(t); })();
    return { work: true, draftId: fd.id }; });

  /* a run's record onto its final draft card: the image or clip, the credits, and a line in the thread */
  function landIn(t, w, fd, rec, { label = null, space = null, fallbackWhy = null, poster = null } = {}) {
    if (rec.state === 'checkpoint') { Object.assign(fd, { state: 'checkpoint', step: 'The Space is waiting for a yes', runKey: rec.runKey, checkpoint: rec.checkpoint || null }); say(t, w, { from: 'ai', who: 'Brew', body: 'The Sloosh Space paused for a check. Open the final to approve or stop it.', noMirror: true }); return; }
    if (rec.state !== 'done') { Object.assign(fd, { state: 'ready', err: rec.error || 'The final didn’t come through.', failed: true, step: null, runKey: rec.runKey }); say(t, w, { from: 'ai', who: 'Brew', body: `The final didn’t come through: ${rec.error || 'Sloosh gave nothing back'}`, noMirror: true }); return; }
    const vid = fd.as === 'video' || rec.kind === 'video';
    Object.assign(fd, { state: 'ready', step: null, err: null, failed: false, runKey: rec.runKey, [vid ? 'video' : 'image']: rec.file, link: rec.link || null, assetId: rec.assetId || null, credits: rec.charged ?? rec.credits, dummy: !!rec.dummy, fallback: !!rec.fallback, provider: rec.provider || 'sloosh', outputs: rec.outputs || null });
    if (vid && poster && !fd.image) fd.image = poster; /* the draft's still as the poster */
    const maker = space?.name || rec.space?.name || label || rec.model || 'Sloosh';
    say(t, w, { from: 'ai', who: 'Brew', body: rec.dummy ? 'The final is here (simulated on this site).' : rec.provider === 'gemini' ? `The final is here, made with Gemini (Sloosh not ready: ${fallbackWhy || 'no credits yet'}).` : `The final is here: ${rec.charged ?? rec.credits} credits on ${maker}.`, noMirror: true }); onReady(t, w, fd); }
  /* after a restart (finals.reconcileAll → onDone): the run Sloosh finished while Brew was away lands on the card it was asked from */
  function landDone(t, rec) { const w = W(t, rec?.target?.wid); if (!w) return false; const fd = (w.drafts || []).find((x) => x.id === rec.land?.fid); if (!fd) return false; if (fd.runKey === rec.runKey && fd.state === 'ready' && !fd.failed) return true;
    const src = (w.drafts || []).find((x) => x.id === rec.target?.draftId); landIn(t, w, fd, rec, { poster: src?.image || null }); w.updatedAt = now(t); save(t); return true; }

  on('POST', '/api/work/:wid/final/checkpoint', async (b, t, p) => { const w = W(t, p.wid); if (!w) return { error: 'not found' }; const fd = (w.drafts || []).find((d) => d.id === b.draftId && d.state === 'checkpoint'); if (!fd?.runKey) return { error: 'Nothing is waiting here.' };
    const slug = slugOfT(t), by = nameOf(t); fd.state = 'making'; fd.step = b.ok ? 'Sloosh is carrying on' : 'Stopping'; save(t);
    (async () => { try { const rec = await finals.checkpoint(slug, fd.runKey, !!b.ok, String(b.note || '').slice(0, 300)); if (rec.error) throw new Error(rec.error);
        if (rec.state === 'done') { Object.assign(fd, { state: 'ready', step: null, [fd.as === 'video' ? 'video' : 'image']: rec.file, link: rec.link || null, assetId: rec.assetId || null, credits: rec.charged ?? rec.credits }); say(t, w, { from: 'ai', who: 'Brew', body: `The final is here: ${rec.charged ?? rec.credits} credits.`, noMirror: true }); onReady(t, w, fd); }
        else if (rec.state === 'checkpoint') { Object.assign(fd, { state: 'checkpoint', step: 'The Space is waiting for a yes', checkpoint: rec.checkpoint || null }); }
        else { Object.assign(fd, { state: 'ready', err: rec.error || 'stopped', failed: true, step: null }); say(t, w, { from: 'system', body: `${by} stopped the final at the Space’s check.`, noMirror: true }); }
      } catch (e) { Object.assign(fd, { state: 'ready', err: e.message, failed: true, step: null }); } w.updatedAt = now(t); save(t); })();
    return { ok: true }; });
  return { ...sheet, landDone };
}

/* ---------- the studio: a final is the next version, labelled Final ---------- */
export function createStudioFinals({ headOf = () => null, useVersion = () => {}, versionById = () => null, on, C, ensurePkg, sync, version, pubChange, cardOf = () => null, cardPhoto = () => null, catalogOf = () => [], jobs, vidJobs = null, references = null, finals, sloosh, creditsLeft = () => null, rivalOf = async () => null, brandOfT, slugOfT, meOf = () => null, onMedia = () => {}, isVideo = () => false, RATIO = {}, now = () => Date.now(), log = console }) {
  const sheet = createFinalsSheet({ finals, sloosh, references, creditsLeft, brandOfT, log, now });
  const nameOf = (t) => meOf(t)?.name || meOf(t)?.email || 'Someone';
  const headFinal = (ch) => (ch.versions || []).find?.((v) => v.id === ch.headVersionId)?.final || ch.lastFinal?.versionId === ch.headVersionId ? ch.lastFinal : null;
  /* a version remade as a reel, a carousel or a picture (remix.js remakeOf): the final is made in that format, from that draft's
     own media and words (its first slide for a carousel), and lands back in the draft the stage shows */
  const remade = (ch) => (ch.pkg?.draft?.remade ? ch.pkg.draft : null);
  /* the final's file onto the package: into a remade draft (the stage shows it), else the version's own photo or clip */
  /* words: the final has its words set in the picture (Sloosh or Gemini drew them), so the studio lays no overlay on it and the brief
     never asks for them to be set again (pkg.wordsIn names that file; a new photo shows the overlay again) */
  const grewFrom = (t, ch, v, id) => { for (let x = v, k = 0; x && k < 400; x = x.parentVersionId ? versionById(t, ch, x.parentVersionId) : null, k++) if (x.id === id) return true; return false; };
  const land = (ch, isVid, file, words = false) => { const d = remade(ch);
    ch.pkg = d ? { ...ch.pkg, draft: { ...d, ...(isVid ? { video: file, poster: d.poster || d.images?.[0] || null } : { images: [file, ...(d.images || []).slice(1)] }), pending: false } } : { ...ch.pkg, ...(isVid ? { video: file } : { image: file, wordsIn: words ? file : null }) }; };
  const baseOf = (t, ch) => { const c = cardOf(t, ch) || {}, p = ch.pkg || {}, d = remade(ch); const fin = headFinal(ch);
    if (d) { const vid = d.as === 'video', s0 = (d.slides || [])[0] || {};
      return { kind: vid ? 'video' : 'image', title: d.title || ch.after?.title || c.title || '', visual: [d.imageBrief || s0.visual || (d.script || [])[0]?.shot || p.imageBrief, p.knobs?.scene ? `Scene: ${p.knobs.scene}.` : ''].filter(Boolean).join(' '), scene: sceneOf(c), text: d.overlay || s0.text || (d.script || [])[0]?.line || p.headline || '', copy: p.primaryText || p.copy || '', ratio: d.ratio || (vid ? '9:16' : RATIO[p.format] || '4:5'), motion: d.motion || undefined, script: (d.script || [])[0]?.line || '', beats: vid ? (d.script || []).map((x) => ({ shot: x.shot, line: x.line })) : [], fromFile: (vid ? d.video : null) || d.images?.[0] || p.image || null, still: vid ? [d.poster, ...(d.images || []), p.poster, p.image].find(isStill) || null : null, revision: fin ? (fin.revision || 0) + 1 : 0, format: vid ? 'reel' : d.as === 'carousel' ? 'carousel ad' : c?.make?.format || p.format || '' }; }
    /* a reel's final gets its whole script as timed beats (it used to get only the first line) */
    return { kind: isVideo(ch) ? 'video' : 'image', beats: isVideo(ch) ? (p.script || []).filter((x) => x?.shot || x?.line).map((x) => ({ shot: x.shot || '', line: x.line || '' })) : [], title: ch.after?.title || c.title || '', visual: [p.imageBrief, p.knobs?.scene ? `Scene: ${p.knobs.scene}.` : '', p.knobs?.audience ? `For ${p.knobs.audience}.` : ''].filter(Boolean).join(' '), scene: sceneOf(c), text: p.overlay || p.headline || '', copy: p.primaryText || p.copy || '', ratio: isVideo(ch) ? '9:16' : RATIO[p.format] || '4:5', /* the draft reel and its first frame are 9:16 (remix makeVideo): a 4:5 post format snapped to 3:4 cropped the opening frame */ script: (p.script || [])[0]?.line || '', fromFile: p.video || p.image || null, still: isVideo(ch) ? [p.poster, p.image].find(isStill) || null : null, revision: fin ? (fin.revision || 0) + 1 : 0, format: c?.make?.format || p.format || '' }; };
  /* the product a reel's script names counts too ("This is the Snugglet Paw Warmer" on a card titled "Fix cold feet for $39") */
  const photos = (t, ch) => { const c0 = cardOf(t, ch) || {}, p = ch.pkg || {}; const c = { ...c0, sub: [c0.sub, p.headline, p.overlay, ...(p.script || []).map((x) => x?.line)].filter(Boolean).join('. ') }; return sheet.photosOf(t, c, [...(p.photos || []).filter((u) => !/^gen\//.test(u)), cardPhoto(t, c)]); };
  const draftOf = (t, ch) => { const p = ch.pkg || {}, b = baseOf(t, ch), d = remade(ch); return { id: ch.id, as: b.kind, title: b.title, visual: b.visual, motion: '', text: b.text, ratio: b.ratio, final: !!headFinal(ch), image: d?.images?.[0] || p.image || null, video: d ? d.video || null : p.video || null }; };

  on('GET', '/api/changes/:chid/final/status', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); const base = baseOf(t, ch);
    return sheet.status(t, { slug: slugOfT(t), kind: base.kind, format: base.format, photos: photos(t, ch), draft: draftOf(t, ch), pending: ch.finalQuote ? { at: ch.finalQuote.at } : null }); });

  on('POST', '/api/changes/:chid/final/quote', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); if (ch.imagePending || ch.videoPending || ch.remakePending) return { error: 'A picture is still being made. One moment.' };
    const base = baseOf(t, ch), rival = await rivalOf(t, ch, ch.pkg || {}).catch(() => null); /* "Make our version": their composition and look, our words where theirs sit */
    /* one tap (the studio's main button, Param 19 Oct): what the sheet fills by hand. The draft's own product photo as image 1 (label
       kept exact); a reel runs about 3 seconds a beat (6–15) with sound, so the script's lines are spoken. The quote itself is free */
    if (b.auto) { const ps = photos(t, ch) || [], lead = ps.find((x) => x.named) || ps[0] || null;
      b = { ...b, refs: lead ? [{ id: lead.id, url: lead.url, job: 'product', label: lead.label || 'Product', keep: '', kind: lead.kind }] : [], /* no "keep the label exact": asking for exact small print garbled labels (sloosh-prompt JOB_LINE.product) */
        ...(base.kind === 'video' ? { seconds: Math.max(6, Math.min(15, 3 * Math.max(2, (base.beats || []).length))), sound: true } : {}) }; }
    const spec = sheet.spec(t, rival ? { ...base, rival } : base, b); const q = await finals.quote(slugOfT(t), spec).catch((e) => ({ error: e.message }));
    if (q.error) { ch.finalQuote = null; return { error: q.error, missing: q.missing || null, fields: q.fields || null, inputs: q.inputs || null, filled: q.filled || null, credits: q.credits ?? null }; }
    ch.finalQuote = { spec, quote: q, at: now(), by: nameOf(t) }; sync(t, ch);
    const { raw, ...show } = q; return { quote: { ...show, refs: (q.refs || []).map((r) => ({ id: r.id, url: r.url, job: r.job, label: r.label, keep: r.keep })) } }; });

  on('POST', '/api/changes/:chid/final/run', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; ensurePkg(t, ch); const fq = ch.finalQuote; if (!fq) return { error: 'Get the quote first.' };
    /* the main button carries the price it showed (expect): a quote that changed or ran out spends nothing and is asked for again */
    if (b.expect && fq.quote?.quoteId !== b.expect) return { error: 'The price changed. Tap again to see it.', requote: true };
    if (b.expect && fq.quote?.expiresAt && fq.quote.expiresAt < now()) { ch.finalQuote = null; return { error: 'The price ran out. Tap again.', requote: true }; }
    const slug = slugOfT(t), by = nameOf(t), { quote: q, spec } = fq; ch.finalQuote = null; const isVid = spec.kind === 'video';
    /* a video final is a video job (vidJobs), so a read while it is made never calls it stopped (C() clears a videoPending it
       can't find there); an earlier video error is cleared as it starts */
    const set = isVid ? vidJobs || jobs : jobs;
    if (isVid) { ch.videoPending = now(); ch.videoStep = 'Sloosh is making the final'; ch.videoError = null; } else ch.imagePending = true; ch.imageError = null; ch.finalPending = { from: headOf(t, ch)?.id || null /* the option it is made for: it lands there */, at: now(), credits: q.credits, model: q.label || q.model || q.space?.name || null, fallback: !!q.fallback, provider: q.provider || 'sloosh' }; set?.add?.(ch.id); sync(t, ch);
    (async () => { try { const from = ch.finalPending?.from || null, rec = await finals.run(slug, spec, { quote: q, by, target: { chid: ch.id, revision: spec.revision }, land: { tid: t.id || null, from } });
        landIn(t, ch, rec, { from, label: q.label, model: q.model, space: q.space, fallbackWhy: q.fallbackWhy, by, vid: isVid });
      } catch (e) { if (isVid) ch.videoError = `The final video didn’t come through (${String(e.message).slice(0, 160)}). Make it again.`; ch.imageError = String(e.message).slice(0, 200); log.warn('[finals] studio run', slug, e.message); }
      finally { set?.delete?.(ch.id); if (isVid) { ch.videoPending = null; ch.videoStep = null; } else ch.imagePending = !!jobs?.has?.(ch.id) /* another picture still drawing keeps its spinner */; ch.finalPending = null; sync(t, ch); } })();
    return { change: pubChange(t, ch) }; });

  /* a run's record as the change's next version, labelled Final */
  function landIn(t, ch, rec, { label = null, model = null, space = null, fallbackWhy = null, by = null, vid = null, from = null } = {}) {
    if (rec.state === 'checkpoint') { ch.finalCheckpoint = { runKey: rec.runKey, checkpoint: rec.checkpoint || null, at: now() }; ch.imageError = 'The Sloosh Space paused for a check. Open Make the final to carry on or stop.'; return; }
    if (rec.state !== 'done') { ch.imageError = String(rec.error || 'The final didn’t come through.').slice(0, 200); return; }
    /* the final belongs to the option it was made from: if the stage moved to another option meanwhile, it goes back there first */
    const fromV = (from || rec.land?.from) ? versionById(t, ch, from || rec.land.from) : null; if (fromV && !grewFrom(t, ch, headOf(t, ch), fromV.id)) useVersion(t, ch, fromV);
    const isVid = vid ?? (rec.kind || 'image') === 'video', sp = space || rec.space || null; land(ch, isVid, rec.file, !!rec.words);
    const v = version(t, ch, rec.provider === 'gemini' ? 'gemini' : 'sloosh', `Final: ${rec.dummy ? 'simulated' : rec.provider === 'gemini' ? `made with Gemini (Sloosh not ready: ${fallbackWhy || 'no credits yet'})` : `${rec.charged ?? rec.credits} credits on ${sp ? sp.name || 'a Sloosh Space' : label || model || rec.model}`}`, rec.dummy ? 'Final (Dummy)' : rec.provider === 'gemini' ? 'Final (Gemini)' : 'Final');
    v.final = { credits: rec.charged ?? rec.credits, model: model || rec.model || null, label: label || null, space: sp, dummy: !!rec.dummy, fallback: !!rec.fallback, provider: rec.provider || 'sloosh', link: rec.link || null, assetId: rec.assetId || null, assetKind: rec.assetKind || null, revision: rec.revision || 0, runKey: rec.runKey, by: by || rec.by || null };
    ch.lastFinal = { versionId: v.id, ...v.final };
    try { onMedia(t, ch, { kind: isVid ? 'video' : 'image', images: isVid ? [] : [rec.file], video: isVid ? rec.file : null, n: v.n, label: v.label }); } catch {} }
  /* after a restart (finals.reconcileAll → onDone): the final Sloosh finished while Brew was away becomes the change's next version */
  function landDone(t, rec) { const ch = C(t, rec?.target?.chid); if (!ch) return false; if (ch.lastFinal?.runKey === rec.runKey) return true; landIn(t, ch, rec); sync(t, ch); return true; }

  on('POST', '/api/changes/:chid/final/checkpoint', async (b, t, p) => { const ch = C(t, p.chid); if (!ch) return { error: 'not found' }; const ck = ch.finalCheckpoint; if (!ck?.runKey) return { error: 'Nothing is waiting here.' };
    const slug = slugOfT(t), by = nameOf(t); ch.finalCheckpoint = null; ch.imagePending = true; ch.imageError = null; jobs?.add?.(ch.id); sync(t, ch);
    (async () => { try { const rec = await finals.checkpoint(slug, ck.runKey, !!b.ok, String(b.note || '').slice(0, 300)); if (rec.error) throw new Error(rec.error);
        if (rec.state === 'done') { land(ch, false, rec.file); const v = version(t, ch, 'sloosh', `Final: ${rec.charged ?? rec.credits} credits`, 'Final'); v.final = { credits: rec.charged ?? rec.credits, space: rec.space || null, link: rec.link || null, assetId: rec.assetId || null, runKey: rec.runKey, by }; ch.lastFinal = { versionId: v.id, ...v.final }; try { onMedia(t, ch, { kind: 'image', images: [rec.file], n: v.n, label: v.label }); } catch {} }
        else if (rec.state === 'checkpoint') { ch.finalCheckpoint = { runKey: rec.runKey, checkpoint: rec.checkpoint || null, at: now() }; ch.imageError = 'The Sloosh Space paused again. Open Make the final to carry on or stop.'; }
        else ch.imageError = rec.error || 'stopped at the checkpoint';
      } catch (e) { ch.imageError = String(e.message).slice(0, 200); } finally { jobs?.delete?.(ch.id); ch.imagePending = !!jobs?.has?.(ch.id); sync(t, ch); } })();
    return { change: pubChange(t, ch) }; });
  return { ...sheet, landDone };
}
