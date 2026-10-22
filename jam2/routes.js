// Jam v2 routes (?v=2 only; v1's /api/work and /api/changes are untouched). Mounted by feed-service.js with its own route
// table (on), so every request runs as the signed-in viewer of that brand, like the rest of the service. Slow work (a picture,
// a video) runs in the background; the board shows it as busy and the page polls GET /api/jam2/jams/:jid.
import { createJam2Store } from './store.js';
import { createBrandbook, COMFORT, NARRATORS, MOODS, VOICES } from './brandbook.js';
import { createEngines } from './engines.js';
import { createMaker } from './make.js';
import { createReady, tokenFor, parseToken } from './ready.js';
import { RECIPES, FAMILIES, SIZES, HOW, HOW_LABEL, recipe, recipeFor, alsoFor, planFor } from './catalogue.js';
import { newJam, newBoard, boardOf, headOf, bumpConcept, fromV1, jamView, note, uid, OWNERS, BRIEF_STATUS } from './core.js';
import { productFor, productTiles } from './ingredients.js';
import { withBrowser } from '../pdf/render.js';

export function mountJam2(d) {
  const { on, packs, slugOfT, brandOfT, meOf, reqOf, cardOf, sourceOf, refsOf, isMock, spend, log = console } = d;
  const store = createJam2Store({ packs, log }), bb = createBrandbook({ packs, log });
  const engines = createEngines({ geminiImage: d.geminiImage, vertexVideo: d.vertexVideo, vertexVoice: d.vertexVoice, finals: d.finals, saveGen: d.saveGen, genFile: d.genFile, photo: d.photoAsync, mock: isMock, log });
  const maker = createMaker({ engines, brandbook: bb, claudeTool: d.claudeTool, isMock, spend, launchBrowser: d.launchBrowser, withBrowser, shoot: d.shoot, saveGen: d.saveGen, genFile: d.genFile, photoAsync: d.photoAsync, log });
  const ready = createReady({ maker, zipBuffer: d.zipBuffer, log });
  const busy = new Map(); // `${jid}:${bid}` → { op, at, error? }
  const whoOf = (t) => { const r = reqOf(t), me = meOf(t); return { member: !!r?.member, staff: !!me?.staff, tid: t.id, email: me?.email || null, me }; };

  async function ctxOf(t, jam, { pick = null } = {}) {
    const slug = slugOfT(t), br = brandOfT(t), card = jam.cardId ? cardOf(t, jam.cardId) : null, view = bb.view(await bb.load(slug));
    const refs = await refsOf(slug).catch(() => []), catalog = br?.catalog || [];
    const prod = productFor({ card, catalog, refs, pick: pick || jam.product || null, lanePhoto: null });
    return { slug, jam, card, bbv: view, catalog, product: prod, by: whoOf(t).me, source: sourceOf(t, card), cuts: jam.cuts || (jam.cuts = {}) };
  }
  /* run slow work in the background; the board says what it is doing and any error in plain words */
  const runBg = (t, jam, bid, op, fn) => { const k = `${jam.id}:${bid}`; if (busy.get(k)?.op && !busy.get(k).error) return false; busy.set(k, { op, at: Date.now() });
    Promise.resolve().then(fn).then(() => busy.delete(k)).catch((e) => { log.warn?.('[jam2]', op, e.message); busy.set(k, { op, at: Date.now(), error: e.budget ? e.message : e.open ? e.message : `${e.message}`.slice(0, 240) }); })
      .finally(() => { jam.updatedAt = Date.now(); return store.put(slugOfT(t), jam); }).catch((e) => log.warn?.('[jam2] save after', op, e.message)); return true; };
  const out = (jam) => { const v = jamView(jam); v.busy = Object.fromEntries(jam.boards.map((b) => [b.id, busy.get(`${jam.id}:${b.id}`) || null])); delete v.cuts; return v; };
  const load = async (t, jid) => { const j = await store.get(slugOfT(t), jid, whoOf(t)); if (!j) throw Object.assign(new Error('not found'), { status: 404 }); return j; };
  const wrap = (fn) => async (b, t, p, q) => { try { return await fn(b, t, p, q); } catch (e) { return { error: e.message, status: e.status || 200 }; } };

  /* ---------- catalogue, partners, brand book ---------- */
  on('GET', '/api/jam2/catalogue', wrap(async () => ({ recipes: RECIPES, families: FAMILIES, sizes: SIZES, how: HOW, howLabel: HOW_LABEL, partners: engines.status() })));
  on('GET', '/api/jam2/brandbook', wrap(async (b, t) => { const slug = slugOfT(t), raw = await bb.load(slug), v = bb.view(raw);
    return { book: v, readiness: bb.readiness(v, { products: (brandOfT(t)?.catalog || []).length }), options: { comfort: COMFORT, narrators: NARRATORS, moods: MOODS, voices: VOICES }, canEdit: whoOf(t).member || whoOf(t).staff }; }));
  on('POST', '/api/jam2/brandbook', wrap(async (b, t) => { const w = whoOf(t); if (!w.member && !w.staff) return { error: 'Only the brand’s team can change its Brand Book.' };
    const raw = await bb.update(slugOfT(t), b || {}, w.me); const v = bb.view(raw); return { book: v, readiness: bb.readiness(v, { products: (brandOfT(t)?.catalog || []).length }) }; }));
  on('GET', '/api/jam2/products', wrap(async (b, t) => ({ products: productTiles(brandOfT(t)?.catalog || []), refs: (await refsOf(slugOfT(t)).catch(() => [])).filter((r) => r.kind !== 'video').slice(0, 40) })));

  /* ---------- jams ---------- */
  on('GET', '/api/jam2/jams', wrap(async (b, t) => ({ jams: (await store.list(slugOfT(t), whoOf(t))).sort((a, c) => (c.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 60).map((j) => ({ id: j.id, title: j.title, cardId: j.cardId, updatedAt: j.updatedAt, boards: j.boards.map((x) => ({ label: x.label, status: x.status, file: headOf(x)?.file || null })) })) })));
  /* open a card (or a blank recipe) in v2: the card's v2 jam if there is one, else a new one whose first board starts at once */
  on('POST', '/api/jam2/open', wrap(async (b, t) => {
    const slug = slugOfT(t), who = whoOf(t), card = b.cardId ? cardOf(t, b.cardId) : null; if (b.cardId && !card) return { error: 'That card is gone.' };
    const cta = String(b.cta || card?.cta?.label || '').slice(0, 60);
    let jam = card && !b.fresh ? await store.byCard(slug, card.id, who, cta) : null;
    if (!jam) { const view = bb.view(await bb.load(slug)); jam = newJam({ card, owner: store.ownerOf(who), by: who.me, recipeId: b.recipe && recipe(b.recipe) ? b.recipe : null, bb: view, plan: card ? planFor(card, cta) : null, cta });
      /* a card with a v1 jam brings a copy of what v1 made (read only) */
      const w1 = card ? (t.work || []).find((w) => w.cardId === card.id) : null; if (w1) { const ch = w1.changeId ? t.changes?.[w1.changeId] : null; jam.from = { v1: w1.id, ...fromV1(w1, ch, []) }; }
      await store.put(slug, jam); note(jam, `opened from ${card ? 'a card' : 'Make'}`, who.email);
      /* only the button's own board starts now; the others are made when someone opens their tab and taps Make it (nothing is spent unseen) */
      const bd = jam.boards[0]; runBg(t, jam, bd.id, 'first', async () => { const ctx = await ctxOf(t, jam); await maker.first(ctx, bd); }); }
    return { jam: out(jam), also: alsoFor(jam.boards[0]?.recipe) };
  }));
  on('GET', '/api/jam2/jams/:jid', wrap(async (b, t, p) => { const j = await load(t, p.jid); return { jam: out(j), also: alsoFor(j.boards[0]?.recipe) }; }));
  on('POST', '/api/jam2/jams/:jid/concept', wrap(async (b, t, p) => { const j = await load(t, p.jid); const changed = bumpConcept(j, b || {}, whoOf(t).me); await store.put(slugOfT(t), j); return { jam: out(j), changed }; }));
  on('POST', '/api/jam2/jams/:jid/boards', wrap(async (b, t, p) => { const j = await load(t, p.jid); if (!recipe(b.recipe)) return { error: 'Pick what to make.' }; if (j.boards.length >= 12) return { error: 'This jam has 12 boards. Start a new jam for more.' };
    const bd = newBoard(b.recipe, { how: b.how || bb.view(await bb.load(slugOfT(t))).comfort?.how, conceptRev: j.concept.rev, label: b.label || null, ask: b.ask || '' }); j.boards.push(bd); await store.put(slugOfT(t), j);
    runBg(t, j, bd.id, 'first', async () => maker.first(await ctxOf(t, j), bd)); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/remove', wrap(async (b, t, p) => { const j = await load(t, p.jid); j.boards = j.boards.filter((x) => x.id !== p.bid); await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/how', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' }; const r = recipe(bd.recipe);
    if (!r.how.includes(b.how)) return { error: `${r.label} can be made: ${r.how.map((h) => HOW_LABEL[h]).join(', ')}.` }; bd.how = b.how; await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/head', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd?.takes.some((x) => x.id === b.takeId)) return { error: 'not found' }; bd.head = b.takeId; bd.approved = null; bd.status = 'draft'; await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  /* Edit this / Redo / Blend / swap: free ones finish in the request, priced ones run in the background */
  on('POST', '/api/jam2/jams/:jid/boards/:bid/op', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (!bd) return { error: 'not found' };
    const free = !!b.patch?.scene || !!b.patch?.words || !!b.patch?.timeline || b.patch?.slide != null || b.op === 'resize' || b.op === 'line' || b.op === 'redo-words' && isMock();
    if (bd.status === 'stale' && b.op === 'refresh') { runBg(t, j, bd.id, 'first', async () => maker.first(await ctxOf(t, j), bd)); return { jam: out(j) }; }
    if (b.op === 'first' || (!bd.takes.length && !free)) { runBg(t, j, bd.id, 'first', async () => maker.first(await ctxOf(t, j), bd, { ask: b.ask || '' })); return { jam: out(j) }; }
    /* Make the final runs on a partner's paid credits: only with the brand's yes on the price it was shown */
    if (b.op === 'final' && !isMock() && b.confirmUsd == null && b.confirmCredits == null) return { error: 'Confirm the price first.', jam: out(j) };
    if (free && busy.get(`${j.id}:${bd.id}`)?.op && !busy.get(`${j.id}:${bd.id}`).error) return { error: 'Brew is still working on this board. Your change can go in when it lands.', jam: out(j) };
    if (free) { const ctx = await ctxOf(t, j); await maker.edit(ctx, bd, b); await store.put(slugOfT(t), j); return { jam: out(j) }; }
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
    runBg(t, j, bd.id, 'render', async () => { const r = await maker.renderVideo(ctx, bd, { confirmUsd: b.confirmUsd ?? q.usd }); if (r.needsConfirm) throw new Error('The price went up; check it and confirm again.'); }); return { jam: out(j), quote: q }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/approve', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid), h = headOf(bd); if (!h) return { error: 'Nothing to approve yet.' };
    if (h.gate && !h.gate.pass && !b.anyway) return { error: `Fix this first: ${h.gate.checks.filter((c) => !c.ok && !c.soft).map((c) => c.why).join(' ')}`, gate: h.gate };
    const w = whoOf(t); bd.approved = { takeId: h.id, by: w.email, at: Date.now() }; bd.status = 'approved'; note(j, `approved ${bd.label}`, w.email);
    bb.taste(slugOfT(t), { kind: 'do', what: `${bd.recipe}:${h.op}`, text: `approved a ${bd.label.toLowerCase()} (${h.op})` }).catch(() => {}); await store.put(slugOfT(t), j); return { jam: out(j) }; }));
  on('POST', '/api/jam2/jams/:jid/boards/:bid/unapprove', wrap(async (b, t, p) => { const j = await load(t, p.jid), bd = boardOf(j, p.bid); if (bd) { bd.approved = null; bd.status = 'draft'; } await store.put(slugOfT(t), j); return { jam: out(j) }; }));

  /* the jam's chat: the team's lines and Brew's replies, kept with the jam (Slack and @mentions arrive here too) */
  on('POST', '/api/jam2/jams/:jid/say', wrap(async (b, t, p) => { const j = await load(t, p.jid), w = whoOf(t), text = String(b.t || '').trim().slice(0, 1200); if (!text) return { error: 'Say something first.' };
    (j.chat ||= []).push({ id: uid('m'), from: b.from === 'brew' ? 'brew' : 'you', by: w.email, name: w.me?.name || null, t: text, sel: b.sel ? String(b.sel).slice(0, 60) : null, at: Date.now() }); if (j.chat.length > 300) j.chat.splice(0, j.chat.length - 300);
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
    if (kind === 'post' && u.searchParams.get('zip') === '1') { const buf = await ready.zip(j); await store.put(tok.slug, j); res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${j.title.replace(/[^\w -]+/g, '').slice(0, 60) || 'brew'}.zip"`, 'cache-control': 'no-store' }); res.end(buf); return true; }
    let items = kind === 'post' ? await ready.packOf(j) : []; if (kind === 'post') await store.put(tok.slug, j);
    if (kind === 'brief') { const sent = one ? [one] : j.boards.filter((bd) => bd.brief?.status); items = (sent.length ? sent : j.boards).map((bd) => { const h = bd.approved ? bd.takes.find((x) => x.id === bd.approved.takeId) : headOf(bd); return h ? { board: bd.id, label: bd.label, status: bd.brief?.status || null, files: h.file ? [{ label: 'Brew’s draft (reference)', file: h.file }] : [], caption: '', body: '', subject: '', alt: '', hashtags: [], blocks: jamView(j).boards.find((x) => x.id === bd.id).briefView.map((x) => ({ title: x.h, text: x.t })), shots: [] } : null; }).filter(Boolean); }
    const name = (await bb.load(tok.slug).catch(() => null))?.read?.name || '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); res.end(ready.page(j, items, { kind, brand: name })); return true;
  }
  return { publicHandle, store, flush: () => store.flush(), engines, brandbook: bb };
}
