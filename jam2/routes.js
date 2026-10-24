// Jam v2 routes (?v=2 only; v1's /api/work and /api/changes are untouched). Mounted by feed-service.js with its own route
// table (on), so every request runs as the signed-in viewer of that brand, like the rest of the service. Slow work (a picture,
// a video) runs in the background; the board shows it as busy and the page polls GET /api/jam2/jams/:jid.
import { askMarket } from '../market.js';
import { createStudio, library as studioLibrary, inStudio } from './studio.js';
import { contextOf } from './context.js';
import { createVideoFinish, vertexTranscribe, srtOf } from '../video-finish.js';
import { gToken } from '../vertex-media.js';
import { isBatchCard } from '../card-plan.js';
import { createProfiles } from './profiles.js';
import { bestSlots } from './slots.js';
import { createJam2Store } from './store.js';
import { createBrandbook, COMFORT, NARRATORS, MOODS, VOICES } from './brandbook.js';
import { createEngines } from './engines.js';
import { createMaker } from './make.js';
import { createReady, tokenFor, parseToken } from './ready.js';
import { RECIPES, FAMILIES, SIZES, HOW, HOW_LABEL, recipe, recipeFor, alsoFor, planFor } from './catalogue.js';
import { newJam, newBoard, boardOf, headOf, bumpConcept, fromV1, jamView, note, uid, addTake, OWNERS, BRIEF_STATUS, publicView } from './core.js';
import { productFor, productTiles } from './ingredients.js';
import { withBrowser } from '../pdf/render.js';
import { answerGrounded } from '../jam-answer.js';

export function mountJam2(d) {
  const { on, packs, slugOfT, brandOfT, meOf, reqOf, cardOf, sourceOf, refsOf, isMock, spend, log = console } = d;
  /* the team pieces v1 already has, reused as they are: presence (JAMS.beat/here), the team list and invites, the jam emails, Slack, memory */
  const { presence = null, teamOf = null, inviteTo = null, jamMail = null, slack = null, memoryOf = null } = d;
  const store = createJam2Store({ packs, log }), bb = d.brandbook || createBrandbook({ packs, log }); /* one Brand Book, shared with v1 (feed-service) */
  const engines = createEngines({ geminiImage: d.geminiImage, vertexVideo: d.vertexVideo, vertexVoice: d.vertexVoice, vertexMusic: d.vertexMusic, finals: d.finals, saveGen: d.saveGen, genFile: d.genFile, photo: d.photoAsync, mock: isMock, log });
  const maker = createMaker({ engines, brandbook: bb, claudeTool: d.claudeTool, ai: d.ai || null, profileOf: (slug, p) => profiles.of(slug, p), isMock, spend, spendMany: d.spendMany, launchBrowser: d.launchBrowser, withBrowser, shoot: d.shoot, saveGen: d.saveGen, genFile: d.genFile, photoAsync: d.photoAsync, log });
  /* each product read once by vision and kept (profiles.js): the engine's facts about it, and the Brand Book's product check */
  const profiles = createProfiles({ packs, ai: d.ai || null, fileOf: (u) => maker.fileOf(u), isMock, spend, log });
  /* Brew Studio (studio.js): every image and video deliverable through Higgsfield, set up from the card, priced, made on a yes */
  /* a Studio film made ready to post: captions from a speech read (Vertex; none in mock), the cover and the GIF drawn here */
  const finish = createVideoFinish({ launchBrowser: d.launchBrowser || null, transcribe: isMock() ? null : vertexTranscribe({ gToken: d.gToken || gToken, spend: () => spend('text') }), log });
  const studio = createStudio({ engines, maker, profileOf: (slug, p) => profiles.of(slug, p), isMock, spend, finish, log });
  const ready = createReady({ maker, zipBuffer: d.zipBuffer, log });
  const busy = new Map(); // `${jid}:${bid}` → { op, at, error? }
  const whoOf = (t) => { const r = reqOf(t), me = meOf(t); return { member: !!r?.member, staff: !!me?.staff, tid: t.id, email: me?.email || null, me }; };

  /* how the brand sells (profile.storeKind: 'enquiry' for services and property, else a store), read once every ten minutes */
  const storeKinds = new Map();
  const kindOfStore = async (slug) => { const c = storeKinds.get(slug); if (c && Date.now() - c.at < 600e3) return c.v; const v = (await packs.getJSON(slug, 'profile.json', null).catch(() => null))?.storeKind || null; storeKinds.set(slug, { v, at: Date.now() }); return v; };
  async function ctxOf(t, jam, { pick = null } = {}) {
    const slug = slugOfT(t), br = brandOfT(t), card = jam.cardId ? cardOf(t, jam.cardId) : null, view = bb.view(await bb.load(slug));
    const refs = await refsOf(slug).catch(() => []), catalog = br?.catalog || [];
    const prod = productFor({ card, catalog, refs, pick: pick || jam.product || null, lanePhoto: null });
    let memory = ''; try { memory = memoryOf ? memoryOf(t, card?.agent && card.agent !== 'brew' ? card.agent : 'creative') || '' : ''; } catch { memory = ''; }
    const cfg = br?.config || {}, market = br ? askMarket({ country: cfg.country, locale: cfg.locale, market: cfg.market }, cfg) : null; /* who the people in a picture or film look like */
    const ref = card && d.refOf ? d.refOf(t, card) : null; /* the reference the card is about (Recreate, viral shorts) */
    return { slug, jam, card, ref, bbv: view, catalog, product: prod, by: whoOf(t).me, source: sourceOf(t, card), cuts: jam.cuts || (jam.cuts = {}), memory, notes: (jam.notes || []).map((n) => n.text), market, refs, storeKind: br?.profile?.storeKind || await kindOfStore(slug) };
  }
  /* run slow work in the background; the board says what it is doing and any error in plain words */
  /* a job also leaves a mark on the jam (saved with it): after a restart, a mark with no job running says the job was cut off */
  const tidyLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  /* what a person reads when a make fails: plain words, never a model id or a provider's status code */
  const plainErr = (e) => { const m = String(e?.message || e || ''); if (e?.plain) return m.slice(0, 300); /* already said for a person */ if (e?.moderated || /\bnsfw\b|content safety|safety (filter|restriction)|moderat/i.test(m)) return 'The image makers’ safety filters refused this one (they sometimes misread hair, skin or close-ups). Nothing was charged for it. Press it again, or try another style or drop the reference.';
    if (/still being made after/i.test(m)) return 'It’s taking longer than usual. It will land here on its own; nothing is paid twice.';
    return m.replace(/\bHiggsfield\s+[a-z0-9-]+(?:\/[a-z0-9.-]+)+\s*(failed|error|canceled|cancelled)?:?\s*/gi, '').slice(0, 240) || 'That didn’t come through. Press it again.'; };
  const runBg = (t, jam, bid, op, fn, mark = {}) => { const k = `${jam.id}:${bid}`; if (busy.get(k)?.op && !busy.get(k).error) return false; busy.set(k, { op, at: Date.now() }); (jam.running ||= {})[bid] = { ...mark, op, at: Date.now() };
    Promise.resolve().then(fn).then(() => { busy.delete(k); if (jam.running) delete jam.running[bid]; }).catch((e) => { log.warn?.('[jam2]', op, e.message); if (op === 'studio' && jam.v1ch) try { d.onStudioState?.(t, jam.v1ch, { state: 'failed', error: plainErr(e).slice(0, 240), jid: jam.id }); } catch {}
      /* what a failed run already spent is kept on the board (a check that failed twice still paid for two pictures) */
      const spent = (e.made || []).filter((m) => m.usd); const bd0 = jam.boards.find((x) => x.id === bid); if (spent.length && bd0) bd0.spent = [...(bd0.spent || []), { at: Date.now(), op, usd: +spent.reduce((a, m) => a + m.usd, 0).toFixed(3), made: spent.slice(0, 8), error: String(e.message).slice(0, 160) }].slice(-20); const error = e.budget ? e.message : e.open ? plainErr(e) : plainErr(e); busy.set(k, { op, at: Date.now(), error }); if (jam.running?.[bid]) jam.running[bid] = { op, at: Date.now(), error }; /* the error outlives a restart */ })
      .finally(() => { jam.updatedAt = Date.now(); return store.put(slugOfT(t), jam); }).catch((e) => log.warn?.('[jam2] save after', op, e.message)); return true; };
  /* a board made with a product whose catalog price has changed since says so (words can follow free) */
  const priceAlerts = (t, jam) => { const cat = brandOfT(t)?.catalog || []; for (const b of jam.boards) { const m = headOf(b)?.made4; b.priceAlert = null; if (!m?.price) continue;
    const c = cat.find((x) => (m.handle && x.handle === m.handle) || (m.name && (x.t || x.title) === m.name)); if (c?.price != null && String(c.price) !== m.price) b.priceAlert = { name: m.name, was: m.price, now: String(c.price) }; } };
  const out = (jam, t = null) => { if (t) try { priceAlerts(t, jam); } catch {} const v = jamView(jam); /* a job a restart cut off: its mark (saved with the jam) shows as the board's state until it is resumed or tried again */
    v.busy = Object.fromEntries(jam.boards.map((b) => [b.id, busy.get(`${jam.id}:${b.id}`) || (jam.running?.[b.id] ? { op: jam.running[b.id].op, at: jam.running[b.id].at, error: jam.running[b.id].error || 'Brew restarted while this was being made. Press it again.' } : null)])); delete v.running; delete v.cuts; return v; };
  const load = async (t, jid) => { const j = await store.get(slugOfT(t), jid, whoOf(t)); if (!j) throw Object.assign(new Error('not found'), { status: 404 }); return j; };
  /* every jam call reads the brand's pack (catalog, config): right after a restart it may not be loaded yet, so it is loaded first
     (23 Oct: the first Studio make after a deploy refused the brand's own product as "not from your catalog") */
  const wrap = (fn) => async (b, t, p, q) => { try { if (t && !brandOfT(t) && d.loadBrandOfT) await d.loadBrandOfT(t).catch(() => null); return await fn(b, t, p, q); } catch (e) { return { error: e.message, status: e.status || 200 }; } };

  /* ---------- catalogue, partners, brand book ---------- */
  on('GET', '/api/jam2/catalogue', wrap(async () => ({ recipes: RECIPES, families: FAMILIES, sizes: SIZES, how: HOW, howLabel: HOW_LABEL, partners: engines.status() })));
  on('GET', '/api/jam2/brandbook', wrap(async (b, t) => { const slug = slugOfT(t), raw = await bb.load(slug), v = bb.view(raw);
    return { book: v, readiness: bb.readiness(v, { products: (brandOfT(t)?.catalog || []).length }), options: { comfort: COMFORT, narrators: NARRATORS, moods: MOODS, voices: VOICES }, canEdit: whoOf(t).member || whoOf(t).staff }; }));
  on('POST', '/api/jam2/brandbook', wrap(async (b, t) => { const w = whoOf(t); if (!w.member && !w.staff) return { error: 'Only the brand’s team can change its Brand Book.' };
    const raw = await bb.update(slugOfT(t), b || {}, w.me); const v = bb.view(raw); return { book: v, readiness: bb.readiness(v, { products: (brandOfT(t)?.catalog || []).length }) }; }));
  on('GET', '/api/jam2/products', wrap(async (b, t) => ({ products: productTiles(brandOfT(t)?.catalog || []), refs: (await refsOf(slugOfT(t)).catch(() => [])).filter((r) => r.kind !== 'video' && !r.product).slice(0, 40) }))); /* a product's own extra views (its back, a side) aren't products to swap in */

  /* ---------- jams ---------- */
  on('GET', '/api/jam2/jams', wrap(async (b, t) => ({ jams: (await store.list(slugOfT(t), whoOf(t))).sort((a, c) => (c.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 60).map((j) => ({ id: j.id, title: j.title, cardId: j.cardId, updatedAt: j.updatedAt, boards: j.boards.map((x) => ({ label: x.label, status: x.status, file: headOf(x)?.file || null })) })) })));
  /* open a card (or a blank recipe) in v2: the card's v2 jam if there is one, else a new one whose first board starts at once */
  on('POST', '/api/jam2/open', wrap(async (b, t) => {
    const slug = slugOfT(t), who = whoOf(t), card = b.cardId ? cardOf(t, b.cardId) : null; if (b.cardId && !card) return { error: 'That card is gone.' };
    const cta = String(b.cta || card?.cta?.label || '').slice(0, 60);
    let jam = card && !b.fresh ? await store.byCard(slug, card.id, who, cta) : null;
    /* a batch card ("8 ads from your ad plan, ready to review"): one tab per finished ad, the ads it already holds, nothing made again */
    if (!jam && card && isBatchCard(card)) { const view = bb.view(await bb.load(slug)), team = card.images.some((x) => /\/team\/statics\//.test(x)), text = (await (d.staticTextOf?.(t, team) || {})) || {};
      jam = newJam({ card, owner: store.ownerOf(who), by: who.me, bb: view, plan: [{ recipe: 'image-ad' }], cta }); jam.batch = true;
      jam.boards = card.images.slice(0, 12).map((img, i) => { const bd = newBoard('image-ad', { label: `Ad ${i + 1}` }), tx = text[img.split('/').pop().replace(/\.[a-z]+$/i, '')] || {}, sz = SIZES[bd.size] || { w: 1080, h: 1350 };
        addTake(jam, bd, { op: 'imported', by: who.me, words: { headline: tx.headline || '', sub: tx.small || tx.sub || '' }, file: img, scene: { w: sz.w, h: sz.h, bg: { src: img }, layers: [] }, made: [], cost: { usd: 0, credits: 0 } }); return bd; });
      await store.put(slug, jam); note(jam, `opened the ${jam.boards.length} ads of a batch card`, who.email); return { jam: out(jam), also: alsoFor('image-ad') }; }
    if (!jam) { const view = bb.view(await bb.load(slug)); jam = newJam({ card, owner: store.ownerOf(who), by: who.me, recipeId: b.recipe && recipe(b.recipe) ? b.recipe : null, bb: view, plan: card ? planFor(card, cta) : null, cta });
      /* a card with a v1 jam brings a copy of what v1 made (read only) */
      const w1 = card ? (t.work || []).find((w) => w.cardId === card.id) : null; if (w1) { const ch = w1.changeId ? t.changes?.[w1.changeId] : null; jam.from = { v1: w1.id, ...fromV1(w1, ch, []) }; }
      await store.put(slug, jam); note(jam, `opened from ${card ? 'a card' : 'Make'}`, who.email);
      /* only the button's own board starts now; the others are made when someone opens their tab and taps Make it (nothing is spent unseen) */
      /* words start at once (cheap); a picture or a video waits on the Studio composer, set up from the card, until the price gets a yes */
      const bd = jam.boards[0]; if (!inStudio(bd) || isMock() && process.env.STUDIO_AUTO === '1') runBg(t, jam, bd.id, 'first', async () => { const ctx = await ctxOf(t, jam); await maker.first(ctx, bd); }); else jam.studio = true; }
    if (b.v1ch && t.changes?.[b.v1ch] && jam.v1ch !== b.v1ch) { jam.v1ch = String(b.v1ch); await store.put(slug, jam); } /* the v1 jam this composer sits on */
    return { jam: out(jam), also: alsoFor(jam.boards[0]?.recipe) };
  }));
  /* v1 asks this when a card's button is pressed: does it make a picture, a set or a video? Then Studio makes it (v1's own Make
     keeps the words, messages, briefs and batches) */
  on('POST', '/api/jam2/studio-for', wrap(async (b, t) => { const card = b.cardId ? cardOf(t, b.cardId) : null; if (!card || isBatchCard(card)) return { studio: false };
    const r = recipe(planFor(card, String(b.cta || card.cta?.label || '').slice(0, 60))[0]?.recipe); return { studio: inStudio(r ? { kind: r.kind, recipe: r.id } : null), recipe: r?.id || null }; }));
  /* a paid render (already said yes to, at that price) or a free every-product run that a restart cut off picks up again the next
     time the jam is opened, keeping the shots already made; three tries within 3 hours, then it says so and waits for a press */
  const resumeCut = async (t, j) => { for (const bd of j.boards) { const m = j.running?.[bd.id]; if (!m || m.error || busy.get(`${j.id}:${bd.id}`)) continue;
    /* a set that kept slides since the last try is making progress: that restart doesn't count against it (deploys every few minutes) */
    const kept = Object.keys(bd.hfJobs || {}).filter((k) => /^set:/.test(k)).length; if (m.op === 'studio' && kept > (m.kept || 0)) m.tries = 0; m.kept = kept;
    if (!m.resume || Date.now() - m.at > 3 * 3600e3 || (m.tries || 0) >= 3) { m.error = `Brew restarted while this was being made. Press it again${bd.inflight || kept ? ': what was already made is kept, free' : ''}.`;
      if (m.op === 'studio' && j.v1ch && !m.told) { m.told = true; try { d.onStudioState?.(t, j.v1ch, { state: 'failed', error: m.error, jid: j.id }); } catch {} } continue; } /* the v1 jam and Work say it stopped */
    const tries = (m.tries || 0) + 1, ctx = await ctxOf(t, j);
    if (m.op === 'render') runBg(t, j, bd.id, 'render', async () => { const r = await maker.renderVideo(ctx, bd, { confirmUsd: m.confirmUsd }); if (r.needsConfirm) throw new Error('The price went up; check it and confirm again.'); }, { resume: true, confirmUsd: m.confirmUsd, tries });
    /* a shot change resumes only on the video it was asked for (a newer take means someone moved on) */
    else if (m.op === 'reshot' && headOf(bd)?.id === m.head) runBg(t, j, bd.id, 'reshot', async () => { const r = await maker.reshot(ctx, bd, { i: m.i, ask: m.ask, region: m.region, confirmUsd: m.confirmUsd }); if (r.needsConfirm) throw new Error('The price went up; check it and confirm again.'); }, { ...m, tries });
    else if (m.op === 'studio' && m.spec) runBg(t, j, bd.id, 'studio', async () => { const take = m.spec.set ? await studio.makeSet(ctx, bd, m.spec, jobsOf(t, j, bd)) : await studio.make(ctx, bd, m.spec, m.i || 0, jobsOf(t, j, bd)); take.studio.spec = specOf(m.spec); const tk = addTake(j, bd, take); tk.gate = maker.gate(ctx, tk, bd); toV1(t, j, tk); }, { ...m, tries });
    else if (m.op === 'all' && boardOf(j, bd.allOf)) runBg(t, j, bd.id, 'all', async () => maker.allProducts(ctx, bd, boardOf(j, bd.allOf)), { resume: true, tries });
    else m.error = 'Brew restarted while this was being made. Press it again.'; } };
  /* a Studio jam opened from a v1 jam (its stage's composer) hands each finished take to that v1 jam as its next version, so the
     v1 stage, its History, the Work tab and the brief all have it, whoever is (or isn't) on the page when it lands */
  const toV1 = (t, j, tk) => { if (!j.v1ch || !d.onStudioTake) return; try { d.onStudioTake(t, j.v1ch, { ...tk, jid: j.id }); } catch (e) { log.warn?.('[jam2] to v1', e.message); } };
  /* the v1 jam (and its Work item) says it is being made, what and for how much, so nobody has to wait on the page */
  const v1State = (t, j, pl, n) => { if (!j.v1ch || !d.onStudioState) return; try { d.onStudioState(t, j.v1ch, { state: 'making', line: pl.line, usd: pl.usd, n, kind: pl.kind, jid: j.id }); } catch (e) { log.warn?.('[jam2] v1 state', e.message); } };
  /* ---------- Brew Studio ---------- */
  on('GET', '/api/jam2/studio/library', wrap(async () => ({ library: studioLibrary() })));
  /* the product a Studio spec may use: one of the brand's own photos (its whole catalog, its References, the card's own pictures,
     the jam's product or the composer's default), never a URL of anyone's choosing */
  const ownProduct = async (t, j, ctx, want) => { const img = String(want?.img || ''); if (!img) return null;
    const cat = productTiles(brandOfT(t)?.catalog || [], 5000).find((x) => x.img === img); if (cat) return cat;
    if (ctx.product?.img === img) return { img, name: ctx.product.name || null, handle: ctx.product.handle || null };
    if (j.product?.img === img) return { img, name: j.product.name || null, handle: j.product.handle || null };
    if ((ctx.card?.images || []).includes(img)) return { img, name: want.name ? tidyLabel(want.name) : ctx.product?.name || null, handle: null };
    const r = (ctx.refs || []).find((x) => x.kind !== 'video' && (x.url === img || x.file === img)); return r ? { img: r.url || r.file, name: r.product || r.label || null, handle: null } : null; };
  /* a spec as the server will run it: known sizes only, whole counts, a sane length, a short note, the product checked */
  const cleanSpec = async (t, j, ctx, spec = {}) => { const sp = { ...spec }; const kind = sp.kind === 'video' ? 'video' : 'image';
    sp.sizes = [Array.isArray(sp.sizes) && Object.hasOwn(SIZES, sp.sizes[0]) ? sp.sizes[0] : kind === 'video' ? 'story' : 'ig-portrait'];
    sp.count = Math.max(1, Math.min(12, Math.floor(+sp.count || 1))); sp.seconds = kind === 'video' && Number.isFinite(+sp.seconds) ? Math.max(3, Math.min(studio.styleOf(sp.style)?.job === 'viral-short' ? 30 : 15, Math.round(+sp.seconds))) : null; /* a viral short runs to 30 s */
    sp.ask = String(sp.ask || '').replace(/\s+/g, ' ').trim().slice(0, 300); for (const [k, n] of [['direction', 900], ['cast', 160], ['ref', 160]]) sp[k] = String(sp[k] || '').replace(/\s+/g, ' ').trim().slice(0, n) || null; sp.quality = ['preview', 'premium'].includes(sp.quality) ? sp.quality : null; sp.fill = !!sp.fill; if (sp.set != null && !Array.isArray(sp.set)) sp.set = null; if (Array.isArray(sp.set)) sp.set = sp.set.map(String).slice(0, 10);
    if (sp.product?.img) { const own = await ownProduct(t, j, ctx, sp.product); if (!own) return { error: 'Pick a product from your catalog or References.' }; sp.product = own; } else sp.product = null;
    return { spec: sp }; };
  on('GET', '/api/jam2/jams/:jid/studio', wrap(async (b, t, p, q) => { const j = await load(t, p.jid), bd = boardOf(j, q?.get?.('bid')) || j.boards[0]; const ctx = await ctxOf(t, j);
    const d0 = studio.defaults(ctx, bd), tiles = productTiles(brandOfT(t)?.catalog || [], 400);
    /* the picks the team asked Brew to always use for this brand win over the card's defaults, and say so */
    const pr = ctx.bbv?.studioPrefs || {}, kept = {};
    if (pr.quality) { d0.quality = pr.quality; kept.quality = true; }
    if (pr.size?.[d0.kind] && SIZES[pr.size[d0.kind]] && !Array.isArray(d0.set)) { d0.sizes = [pr.size[d0.kind]]; kept.size = true; }
    if (pr.cast) { d0.cast = pr.cast; kept.cast = true; }
    const ph = d0.product?.name && pr.photos?.[d0.product.name]; if (ph) { d0.product = { ...d0.product, img: ph }; kept.product = true; }
    if (d0.product?.img && !tiles.some((x) => x.img === d0.product.img)) tiles.unshift(d0.product); /* the card's own product is always pickable */
    const cx = contextOf(ctx, d0), BN0 = ctx.bbv?.name || 'this brand';
    for (const [k, slot] of [['quality', 'quality'], ['size', 'size'], ['cast', 'cast'], ['product', 'products']]) if (kept[k] && cx.slots[slot]) cx.slots[slot].why = `You asked Brew to always use this for ${BN0}.`;
    return { defaults: d0, products: tiles, context: cx, prefs: pr, kept }; })); /* each slot filled from what Brew knows, with why */
  /* "Always use this for <brand>": a composer pick saved to the Brand Book's Studio picks (the brand's team only) */
  /* a take made earlier in Studio (v2) for this card, landed in the v1 jam it now sits on: free, it is already paid for */
  on('POST', '/api/jam2/jams/:jid/studio/land', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, b.bid), tk = bd && (bd.takes || []).find((x) => x.id === b.takeId);
    if (!tk) return { error: 'That take is gone.' }; if (!j.v1ch) return { error: 'This jam isn’t linked to a v1 jam.' }; toV1(t, j, tk); return { ok: true }; }));
  on('POST', '/api/jam2/studio/remember', wrap(async (b, t) => { const w = whoOf(t); if (!w.member && !w.staff) return { error: 'Only the brand’s team can change what Brew always uses.' };
    const k = String(b.slot || ''), v = b.value ?? null, patch = k === 'quality' ? { quality: v } : k === 'size' ? { size: { kind: b.kind === 'video' ? 'video' : 'image', key: v } } : k === 'cast' ? { cast: v } : k === 'product' ? { photo: { name: b.name, img: v } } : null;
    if (!patch) return { error: 'That can’t be remembered.' };
    if (k === 'cast' && /^no people$/i.test(String(v || ''))) await bb.update(slugOfT(t), { comfort: { people: 'none' } }, w.me); /* "no people" is the Brand Book's own people rule */
    const raw = await bb.update(slugOfT(t), { studio: patch }, w.me); return { prefs: bb.view(raw).studioPrefs || {} }; }));
  /* a chat message on a composer that hasn't made anything yet changes the set-up, never the words: "make it a UGC video with a
     woman in her 30s, in Hindi" → kind, style, cast, direction. Free (a cheap words call); the price follows on the stage */
  const ASK_SCHEMA = { type: 'object', properties: { kind: { type: 'string', enum: ['image', 'video', ''] }, style: { type: 'string' }, seconds: { type: 'number' }, count: { type: 'number' }, quality: { type: 'string', enum: ['preview', 'standard', 'premium', ''] }, size: { type: 'string' }, cast: { type: 'string' }, direction: { type: 'string' }, said: { type: 'string' } }, required: ['said'] };
  on('POST', '/api/jam2/jams/:jid/studio/ask', wrap(async (b, t, p) => { const j = await load(t, p.jid), text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 400); if (!text) return { error: 'Say what to change.' };
    const lib = studioLibrary(), styles = [...lib.image, ...lib.video].flatMap((g) => g.styles.map((x) => ({ id: x.id, label: x.label, group: g.label, kind: lib.video.includes(g) ? 'video' : 'image' }))), sp = b.spec || {};
    let out = null;
    if (!isMock() && d.claudeTool && spend('text', slugOfT(t))) { try {
      out = await d.claudeTool(`A brand is setting up one creative in Brew Studio. Turn what they asked into changes to the set-up. Change only what they asked; leave the rest empty.\nWhat they asked: "${text}"\nThe set-up now: ${JSON.stringify({ kind: sp.kind, style: sp.style, seconds: sp.seconds, count: sp.count, quality: sp.quality, size: sp.sizes?.[0], cast: sp.cast, direction: tidyLabel(sp.direction || '') })}\nStyles (pick one id only if they name a kind of piece): ${styles.map((x) => `${x.id} (${x.kind}: ${x.label}, ${x.group})`).join('; ')}\nSizes: ${Object.keys(SIZES).join(', ')}\ncast: who is on camera in plain words (e.g. "a woman in her 30s"), or "No people". direction: one or two sentences to ADD to the direction (mood, setting, language, what to say). said: one short line telling them what changed.`, ASK_SCHEMA, 600, 'studio_ask');
    } catch (e) { log.warn?.('[jam2] studio ask', e.message); } }
    if (!out) { /* no AI here: the plain words still move the obvious slots */
      const l = text.toLowerCase(); out = { said: 'Changed what I could read from that.' };
      if (/\b(video|reel|film|clip|ugc)\b/.test(l)) out.kind = 'video'; else if (/\b(image|picture|photo|static|still)\b/.test(l)) out.kind = 'image';
      if (/\bugc|talking|review video|creator\b/.test(l)) out.style = 'ugc-review'; const n = /(\d{1,2})\s*(?:s|sec|seconds)\b/.exec(l); if (n) out.seconds = +n[1];
      if (/no (people|person|face)/.test(l)) out.cast = 'No people'; else { const c = /\b(a|an)\s+((?:young\s+|older\s+)?(?:woman|man|girl|boy|person|mother|father|couple)[^,.;]*)/.exec(text); if (c) out.cast = c[0].slice(0, 80); }
      if (/premium|4k|best quality/.test(l)) out.quality = 'premium'; if (/hindi|tamil|telugu|marathi|bengali|spanish|french|arabic/.test(l)) out.direction = `In ${(/hindi|tamil|telugu|marathi|bengali|spanish|french|arabic/.exec(l) || [])[0]}.`; }
    const patch = {}; if (['image', 'video'].includes(out.kind)) patch.kind = out.kind; if (out.style && styles.some((x) => x.id === out.style)) { patch.style = out.style; patch.kind = styles.find((x) => x.id === out.style).kind; }
    if (Number.isFinite(+out.seconds) && +out.seconds > 0) patch.seconds = Math.max(3, Math.min(30, Math.round(+out.seconds))); if (Number.isFinite(+out.count) && +out.count > 0) patch.count = Math.max(1, Math.min(12, Math.round(+out.count)));
    if (['preview', 'standard', 'premium'].includes(out.quality)) patch.quality = out.quality; if (out.size && SIZES[out.size]) patch.sizes = [out.size]; if (out.cast) patch.cast = tidyLabel(out.cast).slice(0, 80) || String(out.cast).slice(0, 80);
    if (out.direction) patch.addDirection = String(out.direction).replace(/\s+/g, ' ').trim().slice(0, 300);
    note(j, `Studio set-up from chat: ${text.slice(0, 80)}`, whoOf(t).email); return { patch, said: String(out.said || 'Changed the set-up.').slice(0, 200) }; }));
  /* the free first look: words over the real product photo (and a video's shot list); nothing paid runs, nothing is saved */
  on('POST', '/api/jam2/jams/:jid/studio/sketch', wrap(async (b, t, p) => { const j = await load(t, p.jid), ctx = await ctxOf(t, j), c = await cleanSpec(t, j, ctx, b.spec); if (c.error) return { error: c.error }; return { sketch: await studio.sketch(ctx, c.spec) }; }));
  on('POST', '/api/jam2/jams/:jid/studio/plan', wrap(async (b, t, p) => { const j = await load(t, p.jid), ctx = await ctxOf(t, j), c = await cleanSpec(t, j, ctx, b.spec); if (c.error) return { plan: { error: c.error } }; return { plan: await studio.plan(ctx, c.spec) }; }));
  /* what a Studio take keeps of its set-up, so Redo makes it again the same way */
  const specOf = (sp) => ({ kind: sp.kind || null, style: sp.style || null, set: sp.set || null, product: sp.product || null, sizes: sp.sizes || null, seconds: sp.seconds || null, ask: sp.ask || '', direction: sp.direction || null, cast: sp.cast || null, ref: sp.ref || null, quality: sp.quality || null, count: 1 });
  /* each board keeps the Higgsfield requests it has bought (a restart polls them instead of buying again) */
  const jobsOf = (t, j, bd) => ({ jobs: (bd.hfJobs ||= {}), save: () => store.put(slugOfT(t), j) });
  /* a test server with Higgsfield really connected still asks for the price (mock mode only skips it when nothing can be spent) */
  const mustConfirm = () => !isMock() || !!engines.hf?.live?.();
  /* make: only with the brand's yes on the price it was shown; one board per take (the empty board the composer sat on first) */
  on('POST', '/api/jam2/jams/:jid/studio/make', wrap(async (b, t, p) => { const j = await load(t, p.jid), ctx0 = await ctxOf(t, j), c = await cleanSpec(t, j, ctx0, b.spec); if (c.error) return { error: c.error }; const spec = c.spec;
    const pl = await studio.plan(ctx0, spec); if (pl.error) return { error: pl.error };
    if (mustConfirm() && !(+b.confirmUsd + 0.01 >= pl.usd)) return { needsConfirm: true, plan: pl };
    const busyOn = (bd) => !!bd && !!busy.get(`${j.id}:${bd.id}`)?.op && !busy.get(`${j.id}:${bd.id}`)?.error;
    /* a set is one board of slides: the carousel board it was opened on, else a new carousel */
    if (pl.set) { spec.set = pl.set; let host = boardOf(j, b.bid); if (busyOn(host)) return { error: 'That board is still being made. Wait for it, or make this on a new one.' };
      if (!host || (host.takes.length && !b.redo && !spec.fill) || host.kind !== 'carousel') { if (j.boards.length >= 12) return { error: 'This jam has 12 boards. Start a new jam for more.' }; host = newBoard('ig-carousel', { label: 'Carousel', size: spec.sizes?.[0] || null, conceptRev: j.concept.rev }); j.boards.push(host); }
      await store.put(slugOfT(t), j); runBg(t, j, host.id, 'studio', async () => { const ctx = await ctxOf(t, j); const take = await studio.makeSet(ctx, host, spec, jobsOf(t, j, host)); take.studio.spec = specOf(spec);
        /* filling in the slides left out: the new ones join the slides already made, in the set's order; only the new ones were paid for */
        const prev = spec.fill ? headOf(host) : null; if (prev?.slides?.length && prev.studio?.spec?.set) { const order = prev.studio.spec.set, all = [...prev.slides, ...take.slides].sort((a, c) => order.indexOf(a.style) - order.indexOf(c.style));
          Object.assign(take, { slides: all, file: all[0].file, scene: all[0].scene, words: all[0].words || take.words, missing: take.missing, missingIds: take.missingIds }); take.studio = { ...take.studio, set: all.map((x) => x.style), label: all.map((x) => studio.styleOf(x.style)?.label).filter(Boolean).join(', ') }; take.studio.spec = { ...prev.studio.spec }; } const tk = addTake(j, host, take); tk.gate = maker.gate(ctx, tk, host); toV1(t, j, tk); }, { resume: true, spec, i: 0, confirmUsd: pl.usd });
      note(j, `Studio: ${pl.line} · $${pl.usd}`, whoOf(t).email); v1State(t, j, pl, 1); return { jam: out(j), plan: pl, boards: [host.id] }; }
    const recipeId = pl.kind === 'video' ? 'reel' : 'image-ad', st = studio.styleOf(spec.style), boards = [];
    /* the empty board the composer sat on takes the first one (and becomes what is made on it: a video on a picture board is a video
       board); Redo puts its take on the same board as the next version */
    const host = boardOf(j, b.bid); if (busyOn(host)) return { error: 'That board is still being made. Wait for it, or make this on a new one.' };
    if (host && b.redo && host.takes.length) boards.push(host);
    else if (host && !host.takes.length) { const want = recipe(recipeId); if (host.kind !== want.kind) Object.assign(host, { recipe: recipeId, kind: want.kind }); boards.push(Object.assign(host, { label: tidyLabel(st?.label || host.label) })); }
    const room = 12 - j.boards.length; if (pl.count - boards.length > room) return { error: room > 0 ? `This jam has room for ${room + boards.length} more. Lower the count, or start a new jam.` : 'This jam has 12 boards. Start a new jam for more.' };
    while (boards.length < pl.count) { const nb = newBoard(recipeId, { label: tidyLabel(`${st?.label || 'Take'} ${boards.length + 1}`), size: spec.sizes?.[0] || null, conceptRev: j.concept.rev }); j.boards.push(nb); boards.push(nb); }
    await store.put(slugOfT(t), j);
    const run = boards.length > 1 ? uid('run') : null; /* a batch: its takes land together in the v1 jam, one strip to keep or drop each */
    boards.forEach((bd, i) => runBg(t, j, bd.id, 'studio', async () => { const ctx = await ctxOf(t, j); const take = await studio.make(ctx, bd, spec, i, jobsOf(t, j, bd)); take.studio.spec = specOf(spec); if (run) Object.assign(take, { run, runN: boards.length, runI: i }); const tk = addTake(j, bd, take); tk.gate = maker.gate(ctx, tk, bd); toV1(t, j, tk); }, { resume: true, spec, i, confirmUsd: pl.per }));
    note(j, `Studio: ${pl.line} · $${pl.usd}`, whoOf(t).email); v1State(t, j, pl, boards.length); return { jam: out(j), plan: pl, boards: boards.map((x) => x.id) }; }));
  /* one slide of a set: redo it (priced, one take of its style, the rest kept), drop it (free) or add one (priced). Each lands
     as the set's next take and, from v1, as the jam's next version */
  on('POST', '/api/jam2/jams/:jid/studio/slide', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, b.bid), head = bd && headOf(bd);
    if (!head?.slides?.length) return { error: 'There’s no set to change yet.' };
    if (busy.get(`${j.id}:${bd.id}`)?.op && !busy.get(`${j.id}:${bd.id}`)?.error) return { error: 'This set is still being made. Wait for it.' };
    const i = Math.max(0, Math.min(head.slides.length - 1, Math.floor(+b.i || 0))), base = head.studio?.spec || {}, copyOf = (slides) => { const { id: _i, n: _n, at: _a, gate: _g, ...rest } = head; return { ...rest, slides, file: slides[0].file, scene: slides[0].scene, words: slides[0].words || head.words, made: [], cost: { usd: 0, credits: 0 }, missing: [], missingIds: [], studio: { ...(head.studio || {}), set: slides.map((x) => x.style), spec: { ...base, set: slides.map((x) => x.style) } } }; };
    if (b.op === 'drop') { if (head.slides.length <= 2) return { error: 'A set needs at least two slides.' }; const tk = addTake(j, bd, copyOf(head.slides.filter((_, k) => k !== i))); await store.put(slugOfT(t), j); toV1(t, j, tk); return { jam: out(j) }; }
    const style = studio.styleOf(b.op === 'add' ? b.style : head.slides[i].style); if (!style || style.kind !== 'image') return { error: 'Pick a picture style.' };
    if (b.op === 'add' && head.slides.length >= 10) return { error: 'Ten slides at most.' };
    const ctx0 = await ctxOf(t, j), c = await cleanSpec(t, j, ctx0, { ...base, kind: 'image', set: null, style: style.id, count: 1 }); if (c.error) return { error: c.error };
    const pl = await studio.plan(ctx0, c.spec); if (pl.error) return { error: pl.error };
    if (mustConfirm() && !(+b.confirmUsd + 0.01 >= pl.usd)) return { needsConfirm: true, plan: pl };
    const n = head.slides.length + (b.op === 'add' ? 1 : 0), k = b.op === 'add' ? head.slides.length : i;
    runBg(t, j, bd.id, 'studio', async () => { const ctx = await ctxOf(t, j);
      const one = await studio.make(ctx, bd, { ...c.spec, ask: [`Slide ${k + 1} of ${n} of one set: its own short line that builds on the others${k === 0 ? '; this one is the cover, the hook' : ''}.`, c.spec.ask].filter(Boolean).join(' ') }, k, jobsOf(t, j, bd));
      const slide = { scene: one.scene, file: one.file, style: style.id, words: one.words, shot: one.shot || null, drawn: one.drawn || null };
      const slides = b.op === 'add' ? [...head.slides, slide] : head.slides.map((x, q) => (q === i ? slide : x));
      const tk = addTake(j, bd, { ...copyOf(slides), made: one.made || [], cost: one.cost || { usd: 0, credits: 0 } }); tk.gate = maker.gate(ctx, tk, bd); toV1(t, j, tk); });
    v1State(t, j, { ...pl, line: `${b.op === 'add' ? 'a new slide' : `slide ${i + 1}`} · ${style.label}` }, 1);
    note(j, `Studio: ${b.op === 'add' ? 'added a slide' : `slide ${i + 1} again`} · ${style.label} · $${pl.usd}`, whoOf(t).email); return { jam: out(j), plan: pl }; }));
  /* a film's captions file saved before .srt could be stored (24 Oct) is written again from the captions its take kept: the same
     words give the same name, so the link the jam already holds starts working */
  const healFiles = async (j) => { for (const bd of j.boards) for (const tk of bd.takes || []) { if (!tk.srt || !tk.captions?.segs?.length || !d.genFile || !d.saveGen) continue;
    const name = String(tk.srt).replace(/^\/?gen\//, ''); if (await d.genFile(name).catch(() => null)) continue; const buf = Buffer.from(srtOf(tk.captions.segs)); if (engines.keep(buf, 'srt') !== tk.srt) tk.srt = engines.keep(buf, 'srt'); } };
  on('GET', '/api/jam2/jams/:jid', wrap(async (b, t, p) => { const j = await load(t, p.jid); await healFiles(j).catch((e) => log.warn?.('[jam2] heal files', e.message)); await resumeCut(t, j).catch((e) => log.warn?.('[jam2] resume', e.message)); return { jam: out(j, t), also: alsoFor(j.boards[0]?.recipe) }; }));
  on('POST', '/api/jam2/jams/:jid/concept', wrap(async (b, t, p) => { const j = await load(t, p.jid); const changed = bumpConcept(j, b || {}, whoOf(t).me); await store.put(slugOfT(t), j); return { jam: out(j), changed }; }));
  on('POST', '/api/jam2/jams/:jid/boards', wrap(async (b, t, p) => { const j = await load(t, p.jid);
    if (b.fromRecipe) { const rc = ((await bb.load(slugOfT(t))).recipes || []).find((x) => x.id === b.fromRecipe); if (!rc) return { error: 'That recipe is gone.' }; Object.assign(b, { recipe: rc.recipe, label: rc.name, ask: rc.ask, how: rc.how }); }
    if (!recipe(b.recipe)) return { error: 'Pick what to make.' }; if (j.boards.length >= 12) return { error: 'This jam has 12 boards. Start a new jam for more.' };
    const bd = newBoard(b.recipe, { how: b.how || bb.view(await bb.load(slugOfT(t))).comfort?.how, conceptRev: j.concept.rev, label: b.label || null, ask: b.ask || '' }); j.boards.push(bd); await store.put(slugOfT(t), j);
    /* a picture, set or video board waits on the Studio composer (priced, then a yes); words start at once (cheap) */
    if (!inStudio(bd) || isMock() && process.env.STUDIO_AUTO === '1') runBg(t, j, bd.id, 'first', async () => maker.first(await ctxOf(t, j), bd)); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/remove', wrap(async (b, t, p) => { const j = await load(t, p.jid); j.boards = j.boards.filter((x) => x.id !== p.bid); await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/how', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' }; const r = recipe(bd.recipe);
    if (!r.how.includes(b.how)) return { error: `${r.label} can be made: ${r.how.map((h) => HOW_LABEL[h]).join(', ')}.` }; bd.how = b.how; await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/head', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd?.takes.some((x) => x.id === b.takeId)) return { error: 'not found' }; bd.head = b.takeId; bd.approved = null; bd.status = 'draft'; await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  /* Edit this / Redo / Blend / swap: free ones finish in the request, priced ones run in the background */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/op', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' }; if (j.running?.[bd.id]?.error) delete j.running[bd.id]; /* any change clears a cut-off note */
    const free = !!b.patch?.scene || !!b.patch?.words || !!b.patch?.timeline || b.patch?.slide != null || b.op === 'resize' || b.op === 'line' || b.op === 'redo-words' && isMock();
    if (bd.status === 'stale' && b.op === 'refresh' && headOf(bd)?.studio) return { error: 'Use Redo: it makes it again through Studio, priced first.', jam: out(j) };
    if (bd.status === 'stale' && b.op === 'refresh') { runBg(t, j, bd.id, 'first', async () => maker.first(await ctxOf(t, j), bd)); return { jam: out(j) }; }
    if ((b.op === 'first' || !bd.takes.length) && inStudio(bd) && !free && !(isMock() && process.env.STUDIO_AUTO === '1')) return { error: 'Pick a style first: each one shows its price before anything is made.', jam: out(j) };
    /* a paid change (a new take, a new scene, blending, another product) only with the brand's yes on the price it was shown */
    if (['redo', 'background', 'blend', 'swap-product', 'place'].includes(b.op) && !free && !isMock() && b.confirmUsd == null) return { error: 'Confirm the price first.', jam: out(j) };
    if (b.op === 'first' || (!bd.takes.length && !free)) { runBg(t, j, bd.id, 'first', async () => maker.first(await ctxOf(t, j), bd, { ask: b.ask || '' })); return { jam: out(j) }; }
    /* Make the final runs on a partner's paid credits: only with the brand's yes on the price it was shown */
    if (b.op === 'final' && !isMock() && b.confirmUsd == null && b.confirmCredits == null) return { error: 'Confirm the price first.', jam: out(j) };
    if (free && busy.get(`${j.id}:${bd.id}`)?.op && !busy.get(`${j.id}:${bd.id}`).error) return { error: 'Brew is still working on this board. Your change can go in when it lands.', jam: out(j) };
    if (free) { const ctx = await ctxOf(t, j); try { await maker.edit(ctx, bd, b); } catch (e) { if (e.needsExtend) return { error: e.message, needsExtend: true, jam: out(j) }; throw e; } await store.put(slugOfT(t), j); return { jam: out(j) }; }
    /* another placement of a shot is made by extending the photo: priced, so only with the brand's yes */
    if (b.op === 'extend' && !isMock() && b.confirmUsd == null) return { error: 'Confirm the price first.', jam: out(j) };
    /* a product pick from the page is only ever one of the brand's own catalog photos or References (never a URL of anyone's choosing) */
    if (b.patch?.product) { const want = String(b.patch.product.img || ''), refs = await refsOf(slugOfT(t)).catch(() => []);
      const own = productTiles(brandOfT(t)?.catalog || []).find((x) => x.img === want) || refs.filter((r) => r.kind !== 'video').map((r) => ({ img: r.url || r.file, name: r.label || null })).find((x) => x.img === want);
      if (!own) return { error: 'Pick a product from your catalog or References.', jam: out(j) }; b.patch.product = { img: own.img, name: own.name || null, handle: own.handle || null }; }
    const started = runBg(t, j, bd.id, b.op || 'edit', async () => { const ctx = await ctxOf(t, j, { pick: b.patch?.product || null }); if (b.op === 'swap-product' && b.patch?.product) j.product = b.patch.product; await maker.edit(ctx, bd, b);
      if (b.why && ['redo', 'redo-words'].includes(b.op)) await bb.taste(slugOfT(t), { kind: 'dont', what: String(b.why).toLowerCase().slice(0, 60), text: b.why }).catch(() => {}); });
    return started ? { jam: out(j) } : { error: 'Brew is still working on this board.', jam: out(j) }; }));
  on('GET', '/api/jam2/jams/:jid/prices', wrap(async (b, t, p) => { const j = await load(t, p.jid); return { prices: await maker.prices(await ctxOf(t, j)), partners: engines.status() }; }));
  /* video: the quote, then Render only with the brand's yes on that price */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/render', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' }; const ctx = await ctxOf(t, j);
    const h = headOf(bd); const q = await maker.videoQuote(ctx, bd, h); if (q.error) return { error: q.error };
    if (!isMock() && !(+b.confirmUsd + 0.01 >= q.usd)) return { needsConfirm: true, quote: q };
    runBg(t, j, bd.id, 'render', async () => { const r = await maker.renderVideo(ctx, bd, { confirmUsd: b.confirmUsd ?? q.usd }); if (r.needsConfirm) throw new Error('The price went up; check it and confirm again.'); }, { resume: true, confirmUsd: b.confirmUsd ?? q.usd }); return { jam: out(j), quote: q }; }));
  /* one shot of a rendered video: edit its first frame and animate it again (price first), the rest of the video kept */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/reshot', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' }; const ctx = await ctxOf(t, j);
    const i = Number.isInteger(b.i) ? b.i : -1, ask = String(b.ask || '').slice(0, 300).trim(); if (!ask) return { error: 'Say what should change in this shot.' };
    const region = b.region && [b.region.x, b.region.y, b.region.w, b.region.h].every((v) => Number.isFinite(+v) && +v >= 0 && +v <= 1) ? { x: +b.region.x, y: +b.region.y, w: +b.region.w, h: +b.region.h } : null;
    if (b.confirmUsd == null && !isMock()) { const r = await maker.reshot(ctx, bd, { i, ask, region, confirmUsd: null }); return r.needsConfirm ? { needsConfirm: true, quote: r.quote } : { jam: out(j) }; }
    const started = runBg(t, j, bd.id, 'reshot', async () => { const r = await maker.reshot(await ctxOf(t, j), bd, { i, ask, region, confirmUsd: b.confirmUsd ?? 0 }); if (r.needsConfirm) throw new Error('The price went up; check it and confirm again.'); }, { resume: true, confirmUsd: b.confirmUsd ?? 0, i, ask, region, head: headOf(bd)?.id });
    return started ? { jam: out(j) } : { error: 'Brew is still working on this board.', jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/approve', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid), h = headOf(bd); if (!h) return { error: 'Nothing to approve yet.' };
    if (h.gate && !h.gate.pass && !b.anyway) return { error: `Fix this first: ${h.gate.checks.filter((c) => !c.ok && !c.soft).map((c) => c.why).join(' ')}`, gate: h.gate };
    const w = whoOf(t); bd.approved = { takeId: h.id, by: w.email, at: Date.now() }; bd.status = 'approved'; note(j, `approved ${bd.label}`, w.email);
    if (bd.okAsk?.by && bd.okAsk.by !== w.email) notifyPeople(t, j, { kind: 'approved', to: [bd.okAsk.by], text: `${bd.label} v${h.n}`, id: `okd_${bd.id}_${h.n}` }); bd.okAsk = null;
    bb.taste(slugOfT(t), { kind: 'do', what: `${bd.recipe}:${h.op}`, text: `approved a ${bd.label.toLowerCase()} (${h.op})` }).catch(() => {}); await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/unapprove', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (bd) { bd.approved = null; bd.status = 'draft'; } await store.put(slugOfT(t), j); return { jam: out(j) }; }));

  /* the same picture for every product in the catalog: a new board, one slide per product (scene and words kept) */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/all', wrap(async (b, t, p) => { const j = await load(t, p.jid), src = boardOf(j, p.bid); if (!headOf(src)?.scene) return { error: 'Make the picture first.' };
    if (j.boards.length >= 12) return { error: 'This jam has 12 boards. Start a new jam for more.' };
    const nb = newBoard('carousel-ad', { label: 'Every product', conceptRev: j.concept.rev }); nb.allOf = src.id; j.boards.push(nb); await store.put(slugOfT(t), j);
    runBg(t, j, nb.id, 'all', async () => maker.allProducts(await ctxOf(t, j), nb, src), { resume: true }); return { jam: out(j) }; }));
  /* recipes: a board's look and layout saved by name, to start the next one from */
  on('POST', '/api/jam2/recipes', wrap(async (b, t) => { const w = whoOf(t); if (!w.member && !w.staff) return { error: 'Only the brand’s team can save recipes.' };
    const j = await load(t, b.jid), bd = boardOf(j, b.bid), h = headOf(bd); if (!h) return { error: 'Make it first.' };
    const raw = await bb.load(slugOfT(t)); const r = { id: uid('rc'), name: String(b.name || bd.label).slice(0, 60), recipe: bd.recipe, label: bd.label, size: bd.size, how: bd.how,
      ask: [bd.ask, h.words?.scene && `The look: ${h.words.scene}`, h.words?.headline && `Headline style like: “${h.words.headline}”`].filter(Boolean).join(' ').slice(0, 600), by: w.email, at: Date.now() };
    raw.recipes = [r, ...(raw.recipes || []).filter((x) => x.name !== r.name)].slice(0, 30); await bb.save(slugOfT(t), raw); return { recipe: r, recipes: raw.recipes }; }));
  on('POST', '/api/jam2/recipes/:rid/remove', wrap(async (b, t, p) => { const w = whoOf(t); if (!w.member && !w.staff) return { error: 'Only the brand’s team can change recipes.' };
    const raw = await bb.load(slugOfT(t)); raw.recipes = (raw.recipes || []).filter((x) => x.id !== p.rid); await bb.save(slugOfT(t), raw); return { recipes: raw.recipes }; }));
  on('GET', '/api/jam2/recipes', wrap(async (b, t) => ({ recipes: (await bb.load(slugOfT(t))).recipes || [] })));
  /* pick a day: the brand's own best slots from its Instagram posts when there are enough of them; otherwise it says it has no data */
  on('GET', '/api/jam2/slots', wrap(async (b, t) => { const prof = await packs.getJSON(slugOfT(t), 'profile.json', null).catch(() => null); return bestSlots(prof?.socials?.instagram?.posts, prof?.country || prof?.market?.country); }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/schedule', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' };
    const at = Date.parse(b.at || ''); bd.schedule = Number.isFinite(at) ? { at, by: whoOf(t).email, note: String(b.note || '').slice(0, 120) } : null; await store.put(slugOfT(t), j); return { jam: out(j) }; }));

  /* ---------- the team ---------- */
  const person = (t) => { const me = meOf(t) || {}; return { email: me.email || null, name: me.name || null, pic: me.pic || null }; };
  const jamLike = (j) => ({ id: j.id, title: j.title });
  /* who's here and typing (the same presence v1 uses, keyed by the v2 jam id) */
  on('GET', '/api/jam2/jams/:jid/here', wrap(async (b, t, p, q) => { await load(t, p.jid); const me = person(t); if (presence && me.email) presence.beat(p.jid, me, q?.get?.('typing') === '1');
    return { here: presence ? presence.here(p.jid).filter((x) => x.email !== me.email) : [] }; }));
  /* the brand's team, for @ */
  on('GET', '/api/jam2/team', wrap(async (b, t) => { const w = whoOf(t); if (!w.member && !w.staff) return { team: [] }; const tm = teamOf ? await teamOf(slugOfT(t)).catch(() => null) : null;
    return { team: [...(tm?.members || []).map((m) => ({ email: m.email, name: m.name || null, pic: m.pic || null })), ...(tm?.invites || []).map((x) => ({ email: x.email || x, name: null, invited: true }))].filter((x) => x.email) }; }));
  const notifyPeople = async (t, j, { kind, to, text, id }) => { const slug = slugOfT(t), by = meOf(t) || {}; if (!jamMail) return 0;
    return jamMail.event(slug, jamLike(j), { kind, to, by: { email: by.email, name: by.name }, text, id }).catch((e) => { log.warn?.('[jam2] mail', e.message); return 0; }); };
  /* @someone: they get an email with a link straight to this jam; someone not on the team yet is invited first (the team only) */
  on('POST', '/api/jam2/jams/:jid/mention', wrap(async (b, t, p) => { const j = await load(t, p.jid), w = whoOf(t); if (!w.member && !w.staff) return { error: 'Only the brand’s team can tag people.' };
    const emails = [...new Set((b.emails || []).map((e) => String(e).toLowerCase().trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)))].slice(0, 8); if (!emails.length) return { error: 'Who should see it? Type @ and their email.' };
    const tm = teamOf ? await teamOf(slugOfT(t)).catch(() => null) : null, known = new Set([...(tm?.members || []).map((m) => m.email?.toLowerCase()), ...(tm?.invites || []).map((x) => String(x.email || x).toLowerCase())]);
    const invited = []; for (const e of emails) if (!known.has(e) && inviteTo) { const r = await inviteTo(slugOfT(t), w.email, e).catch((x) => ({ error: x.message })); if (!r?.error) invited.push(e); }
    const text = String(b.text || '').slice(0, 600), id = uid('mn'); const n = await notifyPeople(t, j, { kind: 'tagged', to: emails, text, id });
    (j.people ||= []); for (const e of emails) if (!j.people.some((x) => x.email === e)) j.people.push({ email: e, how: 'tagged', at: Date.now() }); await store.put(slugOfT(t), j);
    return { jam: out(j), mailed: n, invited }; }));
  /* ask someone for their OK on one piece: they get an email; when it's approved, the person who asked hears back */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/ask-ok', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid), w = whoOf(t); if (!bd) return { error: 'not found' }; if (!w.member && !w.staff) return { error: 'Only the brand’s team can ask for an OK.' };
    const e = String(b.email || '').toLowerCase().trim(); if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return { error: 'Whose OK? Pick someone from the team.' };
    bd.okAsk = { email: e, by: w.email, at: Date.now(), note: String(b.note || '').slice(0, 300) }; const n = await notifyPeople(t, j, { kind: 'approve', to: [e], text: `${bd.label}${b.note ? `: ${b.note}` : ''}`, id: `ok_${bd.id}_${headOf(bd)?.n || 0}` });
    note(j, `asked ${e} for an OK on ${bd.label}`, w.email); await store.put(slugOfT(t), j); return { jam: out(j), mailed: n }; }));
  /* Ask Brew: a real answer from the card's evidence and the store's facts, checked against them (jam-answer.js); never invented */
  on('POST', '/api/jam2/jams/:jid/ask', wrap(async (b, t, p) => { const j = await load(t, p.jid), q0 = String(b.q || '').trim().slice(0, 600); if (!q0) return { error: 'Ask something.' };
    const card = j.cardId ? cardOf(t, j.cardId) : null, c = j.concept || {};
    const evidence = [c.spark?.title && `The card: ${c.spark.title}`, c.spark?.says, ...(c.spark?.why || []), ...(c.proof || []).map((x) => `Proof (${x.kind}): ${x.text}`), card?.detail?.why?.length ? `Why: ${card.detail.why.join(' ')}` : '', sourceOf(t, card) ? `Store facts: ${String(sourceOf(t, card)).slice(0, 3000)}` : ''].filter(Boolean).join('\n');
    if (isMock() || !spend('text', slugOfT(t))) return { answer: 'I can’t answer just now (the writing budget is used up or AI is off). Here is what the card says:\n' + evidence.slice(0, 600), known: false };
    const r = await answerGrounded({ ai: d.claudeTool, question: q0, evidence, history: (j.chat || []).slice(-6).map((m) => ({ who: m.from === 'brew' ? 'Brew' : m.name || 'Team', text: m.t })) }).catch((e) => ({ answer: `That didn’t go through (${e.message}). Try again in a moment.`, known: false }));
    (j.chat ||= []).push({ id: uid('m'), from: 'brew', t: String(r.answer || '').slice(0, 1500), at: Date.now(), grounded: !!r.checked }); await store.put(slugOfT(t), j); return { jam: out(j), answer: r.answer, known: r.known }; }));
  /* a line for this jam only (Drop anything → just this jam): the writer reads it on every board of this jam */
  on('POST', '/api/jam2/jams/:jid/note', wrap(async (b, t, p) => { const j = await load(t, p.jid), text = String(b.text || '').trim().slice(0, 4000); if (!text) return { error: 'Nothing to add.' };
    (j.notes ||= []).push({ text, by: whoOf(t).email, at: Date.now() }); if (j.notes.length > 20) j.notes.shift(); await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  /* Slack: one piece posted to the brand's connected channel with an Approve button; replies in its thread come back here */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/slack', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid), w = whoOf(t), h = headOf(bd); if (!h) return { error: 'Make it first.' };
    if (!slack?.slackPost) return { error: 'Slack isn’t on here.' }; if (!w.member) return { error: 'Only the brand’s team posts to its Slack.' };
    const page = `${process.env.PUBLIC_URL || 'https://brew.joinsquareup.com'}/${slugOfT(t)}?v=2&go=feed#jam2=${j.id}`, pic = h.file && !/\.(mp4|wav)$/.test(h.file) ? `${process.env.PUBLIC_URL || 'https://brew.joinsquareup.com'}/${String(h.file).replace(/^\//, '')}` : null;
    const text = `*${bd.label}* · v${h.n} · ${j.title}\n${String(b.text || h.words?.headline || h.words?.subject || '').slice(0, 500)}`;
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text } }, ...(pic ? [{ type: 'image', image_url: pic, alt_text: bd.label }] : []),
      { type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: `Approve v${h.n}` }, action_id: 'approve', value: `${slugOfT(t)}|${j.id}|${h.n}` }, { type: 'button', text: { type: 'plain_text', text: 'Open in Brew' }, url: page, action_id: 'open' }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Reply in this thread: replies land in the Brew jam.' }] }];
    const r = await slack.slackPost(slugOfT(t), { text, blocks }); if (r?.error) return { error: r.connect ? 'Connect Slack first (Connectors).' : r.error };
    j.slack = { ts: r.ts, channel: r.channel, bid: bd.id, n: h.n, page, tid: t.id, at: Date.now() }; note(j, `posted ${bd.label} to Slack`, w.email); await store.put(slugOfT(t), j); return { jam: out(j), channel: r.channelName || null }; }));

  /* the jam's chat: the team's lines and Brew's replies, kept with the jam (Slack and @mentions arrive here too) */
  on('POST', '/api/jam2/jams/:jid/say', wrap(async (b, t, p) => { const j = await load(t, p.jid), w = whoOf(t), text = String(b.t || '').trim().slice(0, 1200); if (!text) return { error: 'Say something first.' };
    (j.chat ||= []).push({ id: uid('m'), from: b.from === 'brew' ? 'brew' : 'you', by: w.email, name: w.me?.name || null, t: text, sel: b.sel ? String(b.sel).slice(0, 60) : null, at: Date.now() }); if (j.chat.length > 300) j.chat.splice(0, j.chat.length - 300);
    if (b.from !== 'brew' && j.slack?.ts && slack?.slackPost) slack.slackPost(slugOfT(t), { channel: j.slack.channel, thread_ts: j.slack.ts, text: `${w.me?.name || w.email || 'Someone'} in Brew: ${text.slice(0, 1500)}` }).catch(() => {});
    await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  /* a board as a brief for a team: who makes it, by when, section edits; send = the brief link goes out and the status starts */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/brief', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' }; const w = whoOf(t);
    const br = bd.brief ||= { owner: OWNERS[0], due: null, edits: {}, status: null, log: [] };
    if (b.owner) br.owner = String(b.owner).slice(0, 60); if (b.due !== undefined) br.due = b.due ? String(b.due).slice(0, 30) : null;
    if (b.edit && Number.isInteger(b.edit.i) && b.edit.i >= 0 && b.edit.i < 8) br.edits[b.edit.i] = String(b.edit.t || '').slice(0, 1200); if (br.log?.length > 50) br.log.splice(0, br.log.length - 50);
    if (b.mode) { const r = recipe(bd.recipe); const how = b.mode === 'brief' ? 'brief' : r.how.find((h) => h !== 'brief') || r.how[0]; if (r.how.includes(how)) bd.how = how; }
    let url = null;
    /* each board's brief has its own link: the team that gets one sees and moves only that brief */
    if (b.send) { if (!br.nonce) { br.nonce = uid('b').slice(2); br.revoked = false; } if (!br.status) br.status = 'sent'; br.sentAt = Date.now(); br.log.push({ status: 'sent', at: Date.now(), by: w.email });
      note(j, `sent the ${bd.label} brief to ${br.owner}`, w.email); url = `/brief/${tokenFor('brief', slugOfT(t), j.id, br.nonce)}`; }
    await store.put(slugOfT(t), j); return { jam: out(j), url }; }));

  /* ---------- exits ---------- */
  on('POST', '/api/jam2/jams/:jid/ready', wrap(async (b, t, p) => { const j = await load(t, p.jid); if (!j.boards.some((x) => x.approved)) return { error: 'Approve at least one board first.' };
    j.post = j.post && !j.post.revoked ? j.post : { nonce: uid('p').slice(2), at: Date.now(), by: whoOf(t).email, revoked: false }; await store.put(slugOfT(t), j);
    return { url: `/p/${tokenFor('post', slugOfT(t), j.id, j.post.nonce)}`, jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/handoff', wrap(async (b, t, p) => { const j = await load(t, p.jid);
    j.brief = j.brief && !j.brief.revoked ? j.brief : { nonce: uid('b').slice(2), at: Date.now(), by: whoOf(t).email, revoked: false, to: b.to || null }; await store.put(slugOfT(t), j);
    return { url: `/brief/${tokenFor('brief', slugOfT(t), j.id, j.brief.nonce)}`, jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/revoke', wrap(async (b, t, p) => { const j = await load(t, p.jid); const bd = b.board ? boardOf(j, b.board) : null;
    if (bd?.brief) { bd.brief.revoked = true; bd.brief.nonce = null; } else if (b.kind === 'brief' && j.brief) j.brief.revoked = true; else if (j.post) j.post.revoked = true; await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/posted', wrap(async (b, t, p) => { const j = await load(t, p.jid); if ((j.posted ||= []).length >= 50) j.posted.shift(); j.posted.push({ platform: String(b.platform || '').slice(0, 30), link: String(b.link || '').slice(0, 300), at: Date.now(), by: whoOf(t).email });
    await bb.taste(slugOfT(t), { kind: 'do', what: `posted:${j.boards.find((x) => x.approved)?.recipe || 'board'}`, text: `posted a ${j.boards.find((x) => x.approved)?.label?.toLowerCase() || 'board'}` }).catch(() => {}); await store.put(slugOfT(t), j); return { jam: out(j) }; }));

  /* the public pages (/p/<token>, /brief/<token>), answered before the API routes; a revoked link is gone */
  async function publicHandle(req, res, u) {
    /* the team that got a brief moves its status: received → in progress → delivered (no sign-in: the link is the key) */
    const sm = /^\/brief\/([\w~-]+)\/status$/.exec(u.pathname);
    if (sm && req.method === 'POST') { const tok = parseToken('brief', sm[1]), j = tok ? await store.getAny(tok.slug, tok.jid) : null; let body = ''; for await (const ch of req) { body += ch; if (body.length > 4000) break; }
      const q = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })(), bd = !j ? null : j.boards.find((x) => x.brief?.nonce === tok.nonce && !x.brief.revoked) || (j.brief && !j.brief.revoked && j.brief.nonce === tok.nonce ? boardOf(j, q.board) : null);
      if (!bd?.brief || !BRIEF_STATUS.includes(q.status) || BRIEF_STATUS.indexOf(q.status) <= BRIEF_STATUS.indexOf(bd.brief.status)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"not found"}'); return true; }
      bd.brief.status = q.status; (bd.brief.log ||= []).push({ status: q.status, at: Date.now(), by: 'brief link' }); note(j, `${bd.label} brief: ${q.status}`, 'brief link'); await store.put(tok.slug, j);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, status: q.status })); return true; }
    const m = /^\/(p|brief)\/([\w~-]+)$/.exec(u.pathname); if (!m || req.method !== 'GET') return false;
    const kind = m[1] === 'p' ? 'post' : 'brief', tok = parseToken(kind, m[2]), j = tok ? await store.getAny(tok.slug, tok.jid) : null;
    const one = kind === 'brief' && j ? j.boards.find((x) => x.brief?.nonce === tok.nonce && !x.brief.revoked) : null, link = one ? one.brief : j?.[kind === 'post' ? 'post' : 'brief'];
    if (!j || !link || link.revoked || link.nonce !== tok.nonce) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('This link is not valid any more.'); return true; }
    const jp = publicView(j); /* a jam from a team-only card shows no account numbers to whoever holds the link */
    if (kind === 'post' && u.searchParams.get('zip') === '1') { const buf = await ready.zip(j); await store.put(tok.slug, j); res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${jp.title.replace(/[^\w -]+/g, '').slice(0, 60) || 'brew'}.zip"`, 'cache-control': 'no-store' }); res.end(buf); return true; }
    let items = kind === 'post' ? await ready.packOf(j) : []; if (kind === 'post') await store.put(tok.slug, j);
    if (kind === 'brief') { const sent = one ? [one] : j.boards.filter((bd) => bd.brief?.status); items = (sent.length ? sent : j.boards).map((bd) => { const h = bd.approved ? bd.takes.find((x) => x.id === bd.approved.takeId) : headOf(bd); return h ? { board: bd.id, label: bd.label, status: bd.brief?.status || null, files: h.file ? [{ label: 'Brew’s draft (reference)', file: h.file }] : [], caption: '', body: '', subject: '', alt: '', hashtags: [], blocks: jamView(jp).boards.find((x) => x.id === bd.id).briefView.map((x) => ({ title: x.h, text: x.t })), shots: [] } : null; }).filter(Boolean); }
    const name = (await bb.load(tok.slug).catch(() => null))?.read?.name || '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); res.end(ready.page(jp, items, { kind, brand: name })); return true;
  }
  /* a reply in a v2 jam's Slack thread, or its Approve pressed (slack-routes.js → feed slackIn, only when no v1 jam has that thread) */
  async function slackIn({ slug, kind, thread, ts, user = {}, text = '', n = null }) {
    const box = await store.load(slug).catch(() => null), j = box && Object.values(box.jams).find((x) => x.slack?.ts === thread); if (!j) return null;
    const bd = boardOf(j, j.slack.bid), h = headOf(bd), shape = { id: j.id, current: h?.n || 0, slack: { page: j.slack.page } };
    if (kind === 'reply') { const seen = (j.slack.seen ||= []); if (seen.includes(ts)) return { dup: true, w: shape }; seen.push(ts); if (seen.length > 200) seen.splice(0, seen.length - 200);
      (j.chat ||= []).push({ id: uid('m'), from: 'you', name: `${user.name || 'Someone'} (Slack)`, by: user.email || null, t: String(text).slice(0, 1200), at: Date.now(), via: 'slack' }); await store.put(slug, j); return { w: shape }; }
    if (kind === 'approve') { if (!bd || !h) return { w: shape, stale: true }; if (n != null && Number.isFinite(n) && n !== h.n) return { w: shape, stale: true };
      bd.approved = { takeId: h.id, by: user.email || `${user.name || 'Someone'} (Slack)`, at: Date.now(), via: 'slack' }; bd.status = 'approved';
      (j.chat ||= []).push({ id: uid('m'), from: 'brew', t: `${user.name || 'Someone'} approved ${bd.label} v${h.n} in Slack.`, at: Date.now() }); await store.put(slug, j); return { w: shape }; }
    return { w: shape };
  }
  return { slackIn, publicHandle, store, flush: () => store.flush(), engines, brandbook: bb };
}
