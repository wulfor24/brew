// Jam v2: the one make layer. Every board is made the same way: the idea and the words (one writer call, from the card and the
// Brand Book), then the pictures. A picture is never the model drawing the product: the real product photo is cut out (free,
// on our server), a scene is made with an empty spot for it (one partner call), the product is placed in it with a contact
// shadow, and the words are set in the brand's own type. Edits work on one layer at a time; free ones cost nothing, a model
// call shows its price first. Every step says which partner made it and what it cost.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { sceneHtml, typePreset, reflow, sentencesOf } from '../public/jam2/scene.js';
import { imgsOf } from './ingredients.js';
import { recipe, SIZES } from './catalogue.js';
import { productFor } from './ingredients.js';
import { addTake, headOf, sizeOf, uid, note } from './core.js';
import { createCreative } from './creative.js';
import { refsFor, creativeBlock } from './brandbook.js';
import { claimFlags, bannedHits } from '../claims.js';
import { cutQuality } from '../draft-quality.js'; // a cut-out is placed only when it is a clean matte

const tidy = (s, n = 240) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

/* the writer's answer, one schema for every kind (fields a kind doesn't use stay empty) */
const SCHEMA = { type: 'object', properties: {
  angle: { type: 'string', description: 'the one-line idea, in the brand’s words, outcome first' },
  goal: { type: 'string', enum: ['awareness', 'launch', 'conversion', 'community'] },
  audience: { type: 'string' }, offer: { type: 'string', description: 'only an offer the card or brand facts name; empty otherwise' },
  proof: { type: 'array', items: { type: 'string' }, description: '1–3 proof lines, each a real review quote or a fact from the card, word for word' },
  headline: { type: 'string', description: '≤ 7 words, set on the picture' }, sub: { type: 'string', description: '≤ 12 words, optional' },
  badge: { type: 'string', description: '≤ 4 words, only from the proof (e.g. "4.6★ from 2,100 reviews"), else empty' }, cta: { type: 'string', description: '1–3 words' },
  caption: { type: 'string', description: 'the post caption, native to the platform, in the brand voice' }, hashtags: { type: 'array', items: { type: 'string' } }, alt: { type: 'string' },
  scene: { type: 'string', description: 'the photo setting WITHOUT the product: surface, place, light, props, mood; leave clear space where the product will stand' },
  body: { type: 'string', description: 'for posts, replies, messages, page copy: the full text' }, subject: { type: 'string', description: 'email subject, if a message' },
  slides: { type: 'array', items: { type: 'object', properties: { onSlide: { type: 'string' }, small: { type: 'string' }, scene: { type: 'string' } } }, description: 'carousel / stories / set: 3–6' },
  shots: { type: 'array', items: { type: 'object', properties: { sec: { type: 'number' }, see: { type: 'string', description: 'what is on screen, product real' }, vo: { type: 'string' }, words: { type: 'string', description: 'on-screen text' }, camera: { type: 'string' } } }, description: 'video: 3–5 shots' },
  blocks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } } }, description: 'briefs, scripts, act-on plans: the sections' },
  cols: { type: 'array', items: { type: 'string' }, description: 'change lists: the 3 column names, e.g. ["Ad", "Where", "Change"]' },
  rows: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } } }, description: 'change lists: one row per change, 3–8 rows, real names from the facts given' }
}, required: ['angle', 'goal', 'headline', 'caption'] };

const BRIEF_SECTIONS = {
  creator: ['Who it’s for', 'The product truths', 'Open with this hook', 'Talking points (in your words)', 'Must say', 'Never say', 'Claims you may make', 'What to deliver', 'Filming tips', 'References', 'Call to action and link', 'Disclosure (#ad) and usage', 'Timeline'],
  script: ['Hook (0–2 s)', 'Beats with timing', 'Voiceover / dialogue', 'On-screen text', 'Shot list', 'B-roll', 'References', 'Call to action', 'Cut-downs'],
  shoot: ['The idea', 'Hero shots we need', 'Shot list (framing)', 'Props', 'Places', 'Cast', 'Mood (from our style refs)', 'Deliverables and sizes'],
  act: ['What to change', 'Owner', 'Steps (exactly where in your tools)', 'Assets', 'Done when']
};

/* a frame far enough from the shot's that re-fitting would crop away the picture (more than about 12% either way) */
const ratioNum = (r) => { const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(r)); return m ? +m[1] / +m[2] : r === 'A5' ? 148 / 210 : 1; };
const farFrom = (shotRatio, s) => Math.abs(Math.log(ratioNum(shotRatio) / (s.w / s.h))) > 0.12;
export function createMaker({ engines, brandbook, claudeTool, ai = null, profileOf = async () => null, isMock, spend = () => true, spendMany = null, launchBrowser, withBrowser = null, shoot, saveGen, genFile, photoAsync, publicUrl = process.env.PUBLIC_URL || '', log = console }) {
  const keep = (buf, ext) => { const name = `j2-${sha(buf)}.${ext}`; saveGen(name, buf); return 'gen/' + name; };
  /* a stored src ('gen/x', '/b/slug/..', 'https://..') → a local file path */
  const fileOf = async (src) => { if (!src) return null; const s = String(src); if (s.startsWith('data:')) return null;
    if (/^\/?gen\//.test(s)) return (await genFile(s.replace(/^\/?gen\//, ''))) || null; return (await photoAsync(s).catch(() => null)) || null; };
  const dataUri = async (src) => { if (!src) return null; if (String(src).startsWith('data:')) return src; const f = await fileOf(src); if (!f || !fs.existsSync(f)) return null; const b = fs.readFileSync(f), ext = path.extname(f).slice(1).toLowerCase(); const head = b.slice(0, 200).toString('utf8').trimStart(); return `data:${/^<(\?xml|svg)/i.test(head) || ext === 'svg' ? 'image/svg+xml' : MIME[ext] || (b[0] === 0x89 ? 'image/png' : 'image/jpeg')};base64,${b.toString('base64')}`; };

  /* ---------- the idea and the words ---------- */
  async function write(ctx, board, { ask = '' } = {}) {
    const { card, bbv, jam } = ctx, r = recipe(board.recipe), c = jam.concept;
    if (isMock()) return mockWords(card, r, bbv);
    const brief = [
      `You are Brew's creative director for ${bbv.name || 'the brand'}${bbv.category ? ` (${bbv.category})` : ''}. Make ONE ${r.label} the brand can post today.`,
      `What it is: ${r.looks}`,
      `The spark (${c.spark?.kind || 'idea'}): ${c.spark?.title || ''}. ${c.spark?.says || ''} ${(c.spark?.why || []).join(' ')}`.trim(),
      c.angle ? `The idea so far: ${c.angle}. Goal: ${c.goal}.${c.audience ? ` For: ${c.audience}.` : ''}${c.offer ? ` Offer: ${c.offer}.` : ''}` : '',
      ctx.product?.name ? `The product: ${ctx.product.name}. It appears as its real photo; describe only the setting around it.` : '',
      ctx.storeKind === 'enquiry' ? 'The brand sells by enquiry (a service, a place to visit), not a cart: the button invites an enquiry or a visit ("Enquire now", "Book a visit"), never "Shop now" or "Buy".' : '',
      /* the facts as written (the fact brief, the card's evidence), not the claim checker's lowercase index cut at 2,500 characters */
      ctx.facts ? `Facts you may use (nothing else):\n${String(ctx.facts).slice(0, 4000)}` : ctx.source ? `Facts you may use (nothing else): ${tidy(ctx.source, 2500)}` : '',
      ctx.evidence ? `What the card is based on: ${tidy(ctx.evidence, 800)}` : '',
      (ctx.catalog || []).length ? `Products and prices: ${(ctx.catalog || []).slice(0, 14).map((p) => `${tidy(p.t || p.title, 70)}${p.price ? ` · ${p.price}` : ''}${p.out ? ' · sold out' : ''}`).join('; ')}` : '',
      ctx.bbv.currency ? `Prices are in ${ctx.bbv.currency}; never use another currency.` : '',
      brandbook.promptBlock(bbv, { recipe: r.id, product: ctx.product?.name || null }),
      ['creator', 'script', 'shoot', 'act'].includes(r.kind) ? `Write the sections as blocks, in this order: ${BRIEF_SECTIONS[r.kind].join(' · ')}. Concrete, specific to this brand, ready to hand over; nothing generic.` : '',
      r.kind === 'video' ? `Write ${Math.max(3, Math.round((r.seconds || 15) / 4))} shots that add up to about ${r.seconds || 15} seconds. Hook in the first 2 seconds. VO reads at about 2.5 words a second.` : '',
      ['carousel'].includes(r.kind) ? 'Write 4–6 slides: one idea each, a cover line first, a buy line last.' : '',
      ['post', 'message', 'page'].includes(r.kind) ? `Write the full text in body${r.id === 'email' ? ' and a subject' : ''}. Native to where it runs; never salesy in a community.` : '',
      r.id === 'pdp-set' || r.id === 'listing' ? 'Slides are the marketplace gallery in order: 1 hero on plain white, then lifestyle, benefits, size or how-to; each onSlide a short label. For a listing also put the title (≤ 200 characters) and 5 bullets in blocks.' : '',
      r.id === 'pmax' ? 'Write blocks "Headlines" (15 lines, each ≤ 30 characters) and "Descriptions" (4 lines, each ≤ 90 characters), one per line, for Google Ads.' : '',
      r.id === 'ai-faq' ? 'Write body as 3–5 questions people ask AI apps about this product, each on its own line ending in "?", each followed by a two-sentence answer on the next line. Then blocks: "Product schema" (JSON-LD, real price only) and "llms.txt line".' : '',
      r.kind === 'table' ? 'This is a change list someone applies by hand in their own tool. Fill cols (3 short names) and rows (one change per row, 3–8 rows). Use only names, prices and places from the facts given; where a fact is missing write [YOURS]. Put the steps to apply it in blocks: "Where", "Steps", "Done when".' : '',
      board.ask ? `This board: ${board.label}. ${board.ask}` : '',
      ctx.notes?.length ? `The team added for this jam (follow these):\n${ctx.notes.slice(-6).map((n) => `- ${tidy(n, /^The direction for this piece/.test(n) ? 1000 : 600)}`) /* the set-up's direction, whole (26 Oct) */.join('\n')}` : '',
      ctx.memory ? `What Brew has learned about this brand (memory is on):\n${tidy(ctx.memory, 2500)}` : '',
      ask ? `The team asked: ${ask}` : '',
      'Never invent numbers, discounts, codes, guarantees or reviews. Quote reviews only word for word from the lines given, and only as a customer\'s words (in quotes, said by a customer): a result a customer describes is never the brand\'s own headline or claim. One version only.'
    ].filter(Boolean).join('\n\n');
    if (!spend('text', ctx.slug)) throw Object.assign(new Error('Today’s writing budget is used up. It resets tonight.'), { budget: true });
    const need = { carousel: ['slides'], video: ['shots'], table: ['rows', 'cols'], post: ['body'], message: ['body'], page: ['body'], creator: ['blocks'], script: ['blocks'], shoot: ['blocks'], act: ['blocks'] }[r.kind] || [];
    const base = ['static', 'carousel', 'video'].includes(r.kind) ? ['angle', 'goal', 'headline', 'caption'] : ['angle', 'goal'];
    const schema = { ...SCHEMA, required: [...new Set([...base, ...need])] }, long = ['creator', 'script', 'shoot', 'act', 'carousel', 'video', 'table'].includes(r.kind);
    let out; try { out = await claudeTool(brief, schema, long ? 6000 : 3000, 'jam2_write'); } catch (e) { if (!/max_tokens|length|JSON|parse|truncat/i.test(e.message)) throw e; out = await claudeTool(brief + '\n\nBe brief: every field short.', schema, 8000, 'jam2_write'); }
    const w = clean(out, r);
    /* a picture or film never goes out with no headline: a model that left it empty (it happens on a long caption) writes just that */
    if (['static', 'carousel', 'video'].includes(r.kind) && !w.headline) {
      const h = await claudeTool([`Write the headline set on the picture of this ${r.label} for ${bbv.name || 'the brand'}: at most 7 words, plain, about the reader. And an optional sub line of at most 12 words.`,
        `The idea: ${tidy(w.angle || c.angle, 300)}`, `The caption: ${tidy(w.caption, 900)}`, (w.proof || []).length ? `A real review you may quote word for word: ${tidy(w.proof[0], 300)}` : '', 'Never invent numbers, discounts or claims.'].filter(Boolean).join('\n'), HEAD_SCHEMA, 600, 'jam2_headline').catch(() => null);
      w.headline = tidy(h?.headline, 60) || tidy(String(w.angle || '').split(/[.,:;—–-]\s/)[0].split(/\s+/).slice(0, 7).join(' '), 60); if (!w.sub && h?.sub) w.sub = tidy(h.sub, 90); }
    return w;
  }
  const HEAD_SCHEMA = { type: 'object', additionalProperties: false, required: ['headline'], properties: { headline: { type: 'string' }, sub: { type: 'string' } } };
  const clean = (o = {}, r) => ({ ...o, headline: tidy(o.headline, 60), sub: tidy(o.sub, 90), badge: tidy(o.badge, 34), cta: tidy(o.cta, 22), caption: tidy(o.caption, 2200), scene: tidy(o.scene, 400), hashtags: (o.hashtags || []).slice(0, 8).map((h) => `#${String(h).replace(/^#/, '').replace(/\s+/g, '')}`),
    slides: (o.slides || []).slice(0, 6).map((x) => ({ onSlide: tidy(x?.onSlide, 60), small: tidy(x?.small, 90), scene: tidy(x?.scene, 300) })).filter((x) => x.onSlide), cols: (o.cols || []).slice(0, 3).map((x) => tidy(x, 24)), rows: (o.rows || []).slice(0, 10).map((x) => ({ a: tidy(x.a, 120), b: tidy(x.b, 160), c: tidy(x.c, 80) })), shots: (o.shots || []).slice(0, 6).map((x) => ({ sec: x?.sec, see: tidy(x?.see, 200), vo: tidy(x?.vo, 200), words: tidy(x?.words, 60), camera: tidy(x?.camera, 40) })).filter((x) => x.see || x.vo), blocks: (o.blocks || []).slice(0, 16).map((x) => ({ title: tidy(x?.title, 60), text: tidy(x?.text, 1500) })).filter((x) => x.title || x.text), proof: (o.proof || []).slice(0, 3) });
  const mockWords = (card = {}, r, bbv) => { const t = tidy(card.title || r.label, 60), h = t.split(/\s+/).slice(0, 6).join(' ');
    return { angle: t, goal: 'conversion', audience: '', offer: '', proof: (bbv.reviews || []).slice(0, 1).map((x) => x.text), headline: h, sub: tidy(card.sub, 80), badge: '', cta: 'Shop now', caption: `${tidy(card.sub || card.title, 200)}`, hashtags: [], alt: t,
      scene: 'a sunlit bathroom shelf with soft morning light, a folded towel, clean tiles', body: `${tidy(card.sub || card.title, 400)}`, subject: h,
      slides: [1, 2, 3, 4].map((i) => ({ onSlide: `${h} (${i})`, small: '' })), shots: [{ sec: 3, see: 'the product on the shelf', vo: h, words: h, camera: 'push in' }, { sec: 4, see: 'hands use it', vo: tidy(card.sub, 60), words: '', camera: 'handheld' }, { sec: 4, see: 'the product close up', vo: 'Shop now', words: 'Shop now', camera: 'static' }],
      blocks: (BRIEF_SECTIONS[r.kind] || (r.kind === 'table' ? ['Where', 'Steps', 'Done when'] : [])).map((title) => ({ title, text: `${title}: from the card, ${tidy(card.title, 80)}.` })),
      cols: ['What', 'Where', 'Change'], rows: r.kind === 'table' ? [1, 2, 3].map((i) => ({ a: `${tidy(card.title, 40)} (${i})`, b: ['Meta', 'Google', 'Shopify'][i - 1], c: 'Change it' })) : [] }; };

  /* ---------- the product, cut out once and kept ---------- */
  async function cutout(ctx) {
    const p = ctx.product; if (!p?.img) return null; const src = await fileOf(p.img); if (!src) return null;
    /* v2 (23 Oct): cuts saved before see-through photos were kept as they are may have black fringes, so they are made again */
    /* v3 (25 Oct): a cut-out is checked (draft-quality.js cutQuality) before it is kept: one that is still a rectangle (the
       photo's own panel came with it) or has a jagged edge is never placed in a scene, so cuts kept before are checked again */
    const key = sha(Buffer.from(`${p.img}|cut-v3`)); ctx.cuts ||= {}; if (ctx.cuts[key]) return ctx.cuts[key];
    /* a catalog photo that is already cut out (a PNG whose corners are see-through) is the cut-out: cutting it again flattens the
       see-through parts to black (23 Oct, Arata's MitoActive pack). Trimmed and used as it is, free */
    try { const sharp = (await import('sharp')).default, m = await sharp(src).metadata();
      if (m.hasAlpha) { const corner = async (left, top) => (await sharp(src).ensureAlpha().extract({ left, top, width: 1, height: 1 }).raw().toBuffer())[3];
        if ((await Promise.all([corner(0, 0), corner(m.width - 1, 0), corner(0, m.height - 1), corner(m.width - 1, m.height - 1)])).every((a) => a < 8)) {
          const out = { file: keep(await sharp(src).trim({ threshold: 2 }).png().toBuffer(), 'png'), provider: 'own', model: 'already cut out', usd: 0, white: false }; ctx.cuts[key] = out; return out; } } } catch (e) { log.warn?.('[jam2] alpha check', e.message); }
    let r; try { r = await engines.run('cutout', { srcFile: src, slug: ctx.slug, product: p.name }); } catch (e) { log.warn?.('[jam2] cutout', e.message); return { file: p.img, raw: true, provider: 'none' }; }
    let file = r.file; /* trim the empty edges so the product fills its box */
    try { const sharp = (await import('sharp')).default; const f = await fileOf(file); if (f) { const t = await sharp(fs.readFileSync(f)).trim({ threshold: 2 }).png().toBuffer(); file = keep(t, 'png'); } } catch (e) { log.warn?.('[jam2] trim', e.message); }
    if (!r.white) { const f = await fileOf(file).catch(() => null), q = f ? await cutQuality(fs.readFileSync(f)) : { ok: false, why: 'the cut-out file is missing' };
      if (!q.ok) { log.warn?.('[jam2] cut-out not clean, not placed', p.name || p.img, q.why); const bad = { file: p.img, raw: true, provider: r.provider, poor: q.why, usd: r.usd || 0 }; ctx.cuts[key] = bad; return bad; } }
    const out = { file, provider: r.provider, model: r.model, usd: r.usd || 0, white: !!r.white }; ctx.cuts[key] = out; return out;
  }

  /* ---------- a scene with room for the product ---------- */
  /* the image models take a fixed set of frames: a banner (3:1), Facebook/X (1.91:1) or print (A5) asks for the nearest one and the scene is cropped to size */
  const GEM_RATIO = { '3:1': '21:9', '1.91:1': '16:9', A5: '2:3', '2:3': '2:3' };
  async function scene(ctx, { describe, ratio: ratio0, place = null, styleRefs = [] }) { const ratio = GEM_RATIO[ratio0] || ratio0;
    if (!spend('image', ctx.slug)) throw Object.assign(new Error('Today’s picture budget is used up. It resets tonight.'), { budget: true });
    const look = refsFor(ctx.bbv, ctx.kind || '', 2), refFiles = (await Promise.all([...styleRefs, ...look.map((x) => x.src)].slice(0, 2).map((s) => fileOf(s).catch(() => null)))).filter(Boolean);
    const prompt = [`A real photograph for an ad, ${ratio} frame: ${place?.describe || describe}.`,
      'Leave a clear, empty, well-lit spot in the lower middle of the frame where a product will be placed later: an uncluttered surface, nothing standing there.',
      'No product, no packaging, no bottle, no brand, no logo, no words, no letters, no numbers anywhere in the picture.', 'Natural light, true colours, real textures, shot on a full-frame camera, shallow depth of field in the background.',
      refFiles.length ? `The attached images are style references only (the brand’s own pictures for this kind of piece): match their light, colour and mood; copy nothing in them.` : '', creativeBlock(ctx.bbv, ctx.kind || '').split('\n').filter((x) => /^(The brand's look|light:|Colours:)/.test(x)).join(' ')].filter(Boolean).join(' ');
    return engines.run('still.scene', { prompt, ratio, refFiles, slug: ctx.slug, product: false });
  }

  /* ---------- compose a static scene ---------- */
  /* what a scene keeps of the Brand Book's kit: the font names, their uploaded files, the colours */
  const kitOf = (kit = {}) => ({ fonts: kit.fonts || {}, colors: kit.colors || [], files: (kit.fontFiles || []).filter((x) => x?.family && x.src).slice(0, 8) });
  /* a scene re-rendered later follows the latest Brand Book: its kit is refreshed, and words still in the old heading or body
     face move to the new one (a face the team picked by hand on one piece stays) */
  function refreshKit(sc, kit = {}) { if (!sc || !kit) return sc; const was = sc.kit?.fonts || {}, now = kitOf(kit);
    for (const l of sc.layers || []) { if (!l.style?.font) continue; if (was.heading && l.style.font === was.heading && now.fonts.heading) l.style.font = now.fonts.heading; else if (was.body && l.style.font === was.body && (now.fonts.body || now.fonts.heading)) l.style.font = now.fonts.body || now.fonts.heading; }
    sc.kit = { ...(sc.kit || {}), ...now }; return sc; }
  function composeScene({ size, bgFile, cut, words, kit, preset = 'top' }) {
    const { w, h } = size, tall = h / w > 1.6, wide = w / h > 1.4;
    const pw = Math.round(w * (tall ? 0.62 : wide ? 0.34 : 0.5)), ph = Math.round(h * (tall ? 0.42 : wide ? 0.7 : 0.48));
    const px = Math.round(wide ? w * 0.6 : (w - pw) / 2), py = Math.round(tall ? h * 0.44 : wide ? h * 0.18 : h * (preset === 'bottom-bar' ? 0.2 : 0.42));
    const layers = [];
    if (cut?.file && !cut.raw) layers.push({ id: 'product', kind: 'product', /* a raw photo (no clean cut-out) is never pasted: it brings its own background */ src: cut.file, x: px, y: py, w: pw, h: ph, z: 3, locked: true, shadow: true, fit: 'contain', blend: cut.white ? 'multiply' : null });
    layers.push(...typePreset(preset, { w, h, kit, headline: words.headline || '', sub: words.sub || '', badge: words.badge || '', cta: '' }));
    if (kit.logo) layers.push({ id: 'logo', kind: 'logo', src: kit.logo, x: w - Math.round(w * 0.2) - Math.round(w * 0.05), y: h - Math.round(h * 0.08) - Math.round(w * 0.05) - (tall ? Math.round(h * 0.14) : 0), w: Math.round(w * 0.2), h: Math.round(h * 0.07), z: 8, fit: 'contain' });
    return { w, h, bg: { color: kit.colors?.[1] || '#efece6', src: bgFile || null }, kit: kitOf(kit), layers };
  }

  /* ---------- render a scene to the file people download ---------- */
  /* one shared Chromium for every render, at most two pages at a time (a burst of drags or a ready link opened by many people
     can't start a browser each); the brand's fonts are in place before the shot */
  let slots = 0; const waiting = [];
  const slot = async (fn) => { if (slots >= 2) await new Promise((ok) => waiting.push(ok)); slots++; try { return await fn(); } finally { slots--; waiting.shift()?.(); } };
  async function render(sc, { ext = 'jpg', clear = false } = {}) {
    const srcs = {}; for (const s of [sc.bg?.src, ...(sc.layers || []).map((l) => l.src), ...(sc.kit?.files || []).map((x) => x?.src)].filter(Boolean)) srcs[s] = await dataUri(s);
    const html = sceneHtml(sc, { srcOf: (s) => srcs[s] || '' }), w = Math.min(4000, Math.max(50, +sc.w || 1080)), h = Math.min(4000, Math.max(50, +sc.h || 1350));
    return slot(() => (withBrowser || (async (fn) => { const b = await launchBrowser(); try { return await fn(b); } finally { await b.close?.().catch?.(() => {}); } }))(async (browser) => {
      const page = await browser.newPage();
      try { await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await page.setContent(html, { waitUntil: 'load', timeout: 30e3 }); await page.evaluate(() => document.fonts?.ready).catch(() => {});
        return keep(await page.screenshot({ type: ext === 'png' ? 'png' : 'jpeg', ...(ext === 'png' ? { omitBackground: clear } : { quality: 88 }) }), ext); }
      finally { await page.close().catch(() => {}); } }));
  }

  /* ---------- the gate: before the brand sees "Ready to post" ---------- */
  function gate(ctx, take, board) {
    const checks = [], r = recipe(board.recipe), text = [take.words?.headline, take.words?.sub, take.words?.badge, take.words?.caption, take.words?.body, ...(take.words?.slides || []).map((s) => s.onSlide), ...(take.timeline?.shots || take.words?.shots || []).map((s) => `${s.vo || ''} ${s.words || ''}`), ...(take.words?.blocks || []).filter((b) => !/never say|claims you may/i.test(b.title || '')).map((b) => b.text), ...(take.words?.rows || []).map((x) => `${x.a} ${x.b} ${x.c}`)].filter(Boolean).join('\n');
    const src = ctx.source || '';
    const flags = claimFlags(text, src); checks.push({ k: 'claims', ok: !flags.length, why: flags.length ? flags.slice(0, 2).map((f) => f.why).join('; ') : 'No invented codes, guarantees or timed results.' });
    let reHits = []; try { reHits = ctx.bbv.neverRe ? bannedHits(text, new RegExp(ctx.bbv.neverRe, 'i'), src) : []; } catch { reHits = []; }
    const never = [...new Set([...reHits, ...(ctx.bbv.neverSay || []).filter((w) => w && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))])]; checks.push({ k: 'never', ok: !never.length, why: never.length ? `Uses words the brand never uses: ${never.join(', ')}` : 'None of the brand’s never-say words.' });
    /* a Studio piece is judged by how it was made: shot around the real product photos and checked, cut out of the real photo,
       or drawn by the model and read back; a video is its finished file. A check that didn't run is never a pass */
    if (take.studio) {
      const st = take.studio, sc = take.scene, shots = [take.shot, ...(take.slides || []).map((x) => x.shot)].filter(Boolean), unchecked = shots.some((x) => /check didn.t run/.test(x.why || ''));
      const how = take.made?.some((m) => m.cap === 'cutout') ? 'The real product photo, cut out: its pixels are untouched.' : take.drawn ? 'Drawn by the model and read back: the same product, no words we can’t back up.' : shots.length ? 'Shot around the real product photos and checked against them.' : st.kind === 'video' ? 'Made from a checked first frame or the real product photos.' : 'No product photo was used.';
      checks.push({ k: 'product', soft: !ctx.product, ok: !unchecked, why: unchecked ? 'The product check couldn’t run on this one: look closely before you approve it.' : how });
      if (sc?.layers?.length) { const tall = sc.h / sc.w > 1.6, foot = tall ? sc.h * 0.84 : sc.h - 4, est = (l) => l.y + (l.h || Math.round((l.style?.size || 40) * 1.3));
        const outside = sc.layers.filter((l) => (l.kind === 'text' || l.kind === 'badge') && !l.hidden && (l.x < 0 || l.x + (l.w || 0) > sc.w + 2 || (tall && l.y < sc.h * 0.14) || est(l) > foot));
        checks.push({ k: 'safe', ok: !outside.length, why: outside.length ? 'Some words sit where the app draws its own bars or off the edge.' : 'Words inside the safe area.' }); }
      const fonts = ctx.bbv.kit?.fonts || {}; checks.push({ k: 'kit', ok: !!(fonts.heading || fonts.body) && !!ctx.bbv.kit?.colors?.length, why: fonts.heading ? `In ${fonts.heading}${ctx.bbv.kit?.colors?.length ? ' and your colours' : ''}.` : 'Your brand font isn’t set yet: add it in the Brand Book.', soft: true });
      checks.push({ k: 'spelling', ok: true, why: sc?.layers?.some((l) => l.kind === 'text') ? 'Words are set as real type from the approved text, never drawn by the model.' : take.drawn ? 'The words were drawn by the model, then read back against the approved words.' : 'No words on it.' });
      const miss = st.kind === 'video' ? (!/\.mp4$/i.test(take.file || '') ? 'the video didn’t come back' : '') : st.set ? ((take.slides || []).length < 2 ? 'fewer than 2 slides came back' : '') : !take.file ? 'the picture didn’t render' : '';
      checks.push({ k: 'content', ok: !miss, why: miss ? `Not ready: ${miss}.` : 'Everything it needs is there.' });
      const hard = checks.filter((c) => !c.ok && !c.soft); return { pass: !hard.length, checks, at: Date.now() }; }
    if (take.scene) {
      const prod = take.scene.layers.find((l) => l.kind === 'product'); checks.push({ k: 'product', soft: !ctx.product, ok: !!prod || !!take.harmonized, why: prod ? 'The real product photo, cut out: its pixels are untouched.' : take.harmonized ? (take.guard?.same === false ? 'The blended picture may have changed the product.' : 'Blended into the scene; checked against the real photo.') : !ctx.product ? 'No product photo yet: add one in References and swap it in.' : 'No product in this picture.' });
      const tall = take.scene.h / take.scene.w > 1.6; const outside = take.scene.layers.filter((l) => (l.kind === 'text' || l.kind === 'badge') && !l.hidden && (l.x < 0 || l.x + l.w > take.scene.w + 2 || (tall && (l.y < take.scene.h * 0.14 || l.y > take.scene.h * 0.84))));
      checks.push({ k: 'safe', ok: !outside.length, why: outside.length ? 'Some words sit where the app draws its own bars or off the edge.' : 'Words inside the safe area.' });
      const fonts = ctx.bbv.kit?.fonts || {}; checks.push({ k: 'kit', ok: !!(fonts.heading || fonts.body) && !!ctx.bbv.kit?.colors?.length, why: fonts.heading ? `In ${fonts.heading}${ctx.bbv.kit?.colors?.length ? ' and your colours' : ''}.` : 'Your brand font isn’t set yet: add it in the Brand Book.', soft: true });
      checks.push({ k: 'spelling', ok: true, why: 'Words are set as real type from the approved text, never drawn by the model.' });
    }
    if (['creator', 'script', 'shoot', 'act'].includes(r.kind)) { const norm = (x) => String(x || '').toLowerCase().replace(/[‘’'"“”]/g, '').replace(/[–—-]/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const want = BRIEF_SECTIONS[r.kind] || [], have = new Set((take.words?.blocks || []).filter((b) => b.text?.trim()).map((b) => norm(b.title))); const miss = want.filter((x) => !have.has(norm(x)));
      checks.push({ k: 'complete', ok: miss.length <= 1, why: miss.length ? `Still to fill: ${miss.join(', ')}` : 'Every section is there.' }); }
    /* the board has its content: a reply with a missing field never passes as checked */
    const w = take.words || {}, miss = r.kind === 'carousel' ? ((take.slides || []).length < 3 ? 'fewer than 3 slides came back' : '') : r.kind === 'video' ? (!(take.timeline?.shots || []).length ? 'the storyboard has no shots' : !take.file ? 'the video isn’t rendered yet' : '')
      : r.kind === 'table' ? (!(w.rows || []).length ? 'the list has no rows' : '') : ['post', 'message', 'page'].includes(r.kind) ? (!String(w.body || '').trim() ? 'no text came back' : '') : ['static'].includes(r.kind) ? (!take.file ? (take.held ? `the picture was held back (${take.held}); Redo makes it again` : 'the picture didn’t render') : '') : '';
    checks.push({ k: 'content', ok: !miss, why: miss ? `Not ready: ${miss}.` : 'Everything it needs is there.' });
    const hard = checks.filter((c) => !c.ok && !c.soft); return { pass: !hard.length, checks, at: Date.now() };
  }

  /* ---------- the first take of a board ---------- */
  /* the creative engine (creative.js): statics are shot around the real product, checked, and set in real type */
  const creative = createCreative({ engines, ai, claudeTool, isMock, spend, fileOf, profileOf, render: (sc) => render(sc), composeScene: (o) => composeScene(o), log });
  async function first(ctx, board, { ask = '' } = {}) {
    ctx.kind = board.recipe; /* the Brand Book's references and playbook follow the piece being made */
    /* an Every product board is remade from its source picture (free), never as a new paid carousel */
    const src = board.allOf ? ctx.jam.boards.find((x) => x.id === board.allOf) : null; if (src) return allProducts(ctx, board, src);
    const r = recipe(board.recipe), size = sizeOf(board), made = [];
    const words = await write(ctx, board, { ask });
    if (!ctx.jam.concept.by || ctx.jam.concept.by === 'card') Object.assign(ctx.jam.concept, { angle: words.angle || ctx.jam.concept.angle, goal: words.goal || ctx.jam.concept.goal, audience: words.audience || ctx.jam.concept.audience, offer: words.offer || '', proof: (words.proof || []).map((t) => ({ kind: 'proof', text: t })), by: 'brew' });
    const take = { op: 'first', by: ctx.by, words, made, how: board.how, made4: ctx.product ? { name: ctx.product.name || null, handle: ctx.product.handle || null, price: priceOf(ctx, ctx.product) } : null };
    if (['static', 'carousel'].includes(r.kind) || (r.kind === 'message' && r.est !== 'free')) {
      const cut = await cutout(ctx); if (cut && !cut.raw) made.push({ cap: 'cutout', provider: cut.provider, model: cut.model, usd: cut.usd });
      if (r.kind === 'carousel') {
        take.slides = [];
        for (const [i, s] of (words.slides || []).slice(0, 6).entries()) { const bg = await scene(ctx, { describe: s.scene || words.scene, ratio: size.ratio }).catch((e) => ({ error: e })); if (bg.file) made.push({ cap: 'still.scene', provider: bg.provider, model: bg.model, usd: bg.usd });
          const sc = composeScene({ size, bgFile: bg.file, cut, words: { headline: s.onSlide, sub: s.small }, kit: ctx.bbv.kit, preset: i === 0 ? 'top' : 'bottom-bar' }); take.slides.push({ scene: sc, file: await render(sc) }); }
        take.scene = take.slides[0]?.scene || null; take.file = take.slides[0]?.file || null;
      } else {
        /* the shoot first; the real cut-out in a made scene only when no shot kept the product exact (or a message card) */
        const shot = r.kind === 'static' ? await creative.staticAd(ctx, board, words, size).catch((e) => { if (e.budget) throw e; log.warn?.('[jam2] shoot', e.message); return { made: [], fail: e.message }; }) : null;
        if (shot) made.push(...shot.made);
        if (shot?.scene) { take.scene = shot.scene; take.file = shot.file; take.shot = shot.shot; take.direction = shot.direction; }
        else {
          if (shot?.fail) take.shotFail = shot.fail;
          /* the paste-up stands in only with a clean cut-out; without one the take is held back (never a collage of the raw photo on a scene) */
          if (ctx.product && (!cut?.file || cut.raw)) take.held = cut?.poor || shot?.fail || 'no clean cut-out of the product';
          else { const bg = await scene(ctx, { describe: shot?.direction?.moment || words.scene, ratio: size.ratio }); made.push({ cap: 'still.scene', provider: bg.provider, model: bg.model, usd: bg.usd });
            take.scene = composeScene({ size, bgFile: bg.file, cut, words, kit: ctx.bbv.kit }); take.file = await render(take.scene); }
        }
      }
    } else if (r.kind === 'video') {
      /* the storyboard is free: one still per shot (the real product in its scene comes on Render); nothing is rendered until the brand confirms the price */
      const cut = await cutout(ctx); take.timeline = { shots: (words.shots || []).map((s) => ({ id: uid('sh'), sec: Math.max(2, Math.min(10, +s.sec || 4)), see: s.see, vo: s.vo, words: s.words, camera: s.camera || 'static', still: null, clip: null })), voice: ctx.bbv.voice?.narrator || 'Kore', music: ctx.bbv.music?.moods?.[0] || 'no music', captions: true };
      take.cut = cut?.file && !cut.raw ? cut.file : null; /* a failed cut-out (the raw photo) is never kept: the render cuts again */ take.quote = await videoQuote(ctx, board, take);
    }
    take.cost = { usd: +made.reduce((s, m) => s + (m.usd || 0), 0).toFixed(3), credits: made.reduce((s, m) => s + (m.credits || 0), 0) };
    const t = addTake(ctx.jam, board, take); board.conceptRev = ctx.jam.concept.rev; t.gate = gate(ctx, t, board); return t;
  }

  /* ---------- video: price first, then render shots, voice, captions, stitch ---------- */
  /* a shot line as a place to shoot in: what the moment looks like, with nothing to hold, give or unbox in it */
  const placeOf = (see) => `the setting for this moment, with none of the objects, gifts, boxes or products it mentions and no hands or people: ${tidy(see, 220)}`;
  /* the motion for a shot: the scene moves a little; nothing new appears and the product stays exactly as photographed */
  const motionOf = (s, ask = '') => `${s.camera || 'static'} camera. Gentle natural motion in the setting (light, steam, fabric, leaves).${ask ? ` ${ask}.` : ''} The product stays exactly as in the first frame: same shape, label and colours. Nothing new appears: no hands, no people, no other products, no text, no logos.`;
  /* each shot line rewritten as an empty setting (one small text call): the image model draws only the place, never its own products */
  async function placesOf(ctx, shots) {
    if (isMock() || !shots.length || !spend('text', ctx.slug)) return [];
    try { const out = await claudeTool([`For each numbered shot of a product video, describe only the empty setting to photograph: the room or surface, light, colours and mood, in under 25 words.`,
        'Leave out every object someone could buy, hold, wear, give or unbox (products, gifts, boxes, packaging, masks, pillows, clothing, accessories) and any hands or people. Keep a clear empty surface in the lower middle.',
        ...shots.map((s, i) => `${i + 1}. ${tidy(s.see, 240)}`)].join('\n'), { type: 'object', properties: { places: { type: 'array', items: { type: 'string' } } }, required: ['places'] }, 800, 'jam2_places');
      return (out?.places || []).map((x) => placeOf(tidy(x, 200)));
    } catch (e) { log.warn?.('[jam2] places', e.message); return []; }
  }
  /* a shot's first frame: the background (only a place) with the real cut-out product placed on it; the logo goes on the end
     shot's caption overlay instead (captionCard), where a camera move can't push it out of frame */
  async function shotStill(ctx, size, bgFile, cut) {
    const sc = composeScene({ size: { ...size, w: 1080, h: 1920 }, bgFile, cut, words: { headline: '' }, kit: ctx.bbv.kit }); sc.layers = sc.layers.filter((l) => l.kind !== 'text' && l.kind !== 'shape' && l.kind !== 'badge' && l.kind !== 'logo');
    for (const l of sc.layers) if (l.kind === 'product') Object.assign(l, { x: 200, y: 640, w: 680, h: 720 }); /* above the caption bar (y 1430) and below the on-screen words */
    return render(sc);
  }
  async function videoQuote(ctx, board, take) {
    const r = recipe(board.recipe), cap = r.caps.includes('video.ugc') ? 'video.ugc' : 'video.shot'; let usd = 0, credits = 0, provider = null;
    for (const s of take.timeline?.shots || []) { const q = await engines.quote(cap, { seconds: Math.max(4, s.sec || 4), slug: ctx.slug }); /* Veo bills at least 4 s a clip */ if (q.error) return { error: q.error }; usd += q.usd || 0; credits += q.credits || 0; provider = q.provider; }
    const stills = (take.timeline?.shots || []).length; const sq = await engines.quote('still.scene', { slug: ctx.slug }); usd += (sq.usd || 0) * stills;
    /* the voice and the music are part of the price shown (the quote is the ceiling a render may spend) */
    if ((take.timeline?.shots || []).some((s) => s.vo)) usd += (await engines.quote('voice.tts', {}).catch(() => ({}))).usd || 0;
    if (take.timeline?.music && !/^no music$/i.test(take.timeline.music)) usd += (await engines.quote('music.gen', {}).catch(() => ({}))).usd || 0;
    return { cap, usd: +usd.toFixed(2), credits, provider, seconds: (take.timeline?.shots || []).reduce((a, s) => a + s.sec, 0), at: Date.now() };
  }
  async function renderVideo(ctx, board, { confirmUsd } = {}) {
    const t0 = headOf(board); if (!t0?.timeline) throw new Error('This board has no storyboard yet.');
    const q = await videoQuote(ctx, board, t0); if (q.error) throw new Error(q.error);
    if (!isMock() && (confirmUsd == null || +confirmUsd + 0.01 < q.usd)) return { needsConfirm: true, quote: q };
    const size = sizeOf(board), cut = t0.cut && /^gen\//.test(t0.cut) ? { file: t0.cut } : await cutout(ctx), made = [], shots = [];
    /* each shot on its own: a shot whose clip fails (or whose budget is used up) keeps its still, so nothing already paid for is lost */
    /* shots already paid for in a render a restart cut off are kept on the board (board.inflight) and used again, free */
    const key = sha(Buffer.from(JSON.stringify([t0.id, cut?.file, t0.timeline.shots.map((x) => [x.see, x.sec, x.camera])])));
    if (board.inflight?.key !== key) board.inflight = { key, shots: {} };
    /* the day's video budget is checked for every shot still to make before anything is spent: a render never pays for half a video */
    const toMake = t0.timeline.shots.filter((x, n) => !board.inflight.shots[n]?.clip).length, reserved = !!spendMany && !isMock();
    if (reserved && toMake && !spendMany('video', toMake)) throw Object.assign(new Error(`Today’s video budget doesn’t cover the ${toMake} shots this needs. It resets at midnight UTC; nothing was spent.`), { budget: true });
    let lost = 0; const places = await placesOf(ctx, t0.timeline.shots);
    for (const s of t0.timeline.shots) { const kept = board.inflight.shots[t0.timeline.shots.indexOf(s)]; if (kept?.clip) { shots.push({ ...s, still: kept.still, clip: kept.clip, bg: kept.bg || null }); made.push(...(kept.made || [])); continue; } /* paid before the restart: counted in this take's cost */ try {
      /* the scene is only the place: the shot line names products, and an image model asked for them draws its own versions */
      const bg = await scene(ctx, { describe: places[t0.timeline.shots.indexOf(s)] || placeOf(s.see), ratio: '9:16' }); made.push({ cap: 'still.scene', provider: bg.provider, model: bg.model, usd: bg.usd });
      const still = await shotStill(ctx, size, bg.file, cut); const sf = await fileOf(still);
      if (!reserved && !spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true });
      const clip = await engines.run(q.cap, { srcFile: sf, srcUrl: still, prompt: q.cap === 'video.shot' ? motionOf(s) : `${s.camera || 'static'} camera. ${s.see}. The product stays exactly as in the first frame: same shape, label and colours. Natural motion, no text, no logos added.`, seconds: s.sec, ratio: '9:16', slug: ctx.slug, by: ctx.by?.email, jamId: ctx.jam.id, boardId: board.id });
      made.push({ cap: q.cap, provider: clip.provider, model: clip.model, usd: clip.usd || 0, credits: clip.credits || 0 }); shots.push({ ...s, still, clip: clip.file, bg: bg.file }); board.inflight.shots[t0.timeline.shots.indexOf(s)] = { still, clip: clip.file, bg: bg.file, made: made.slice(-2) };
    } catch (e) { lost++; log.warn?.('[jam2] shot', e.message); const prev = shots[shots.length - 1]; shots.push({ ...s, still: prev?.still || null, clip: null, failed: tidy(e.message, 120) }); if (e.budget || /budget/i.test(e.message)) break; } }
    if (!shots.some((x) => x.still || x.clip)) throw new Error('No shot came through. Nothing else was made; try again later.');
    const done = await finishVideo(ctx, board, t0, shots, made, { op: 'render' }); board.inflight = null; return done;
  }
  /* the voice, the music and the captions over the shots, as one take; used by a full render and by a single re-made shot */
  async function finishVideo(ctx, board, t0, shots, made, { op }) {
    const tl = t0.timeline, vo = shots.map((s) => s.vo).filter(Boolean).join(' ');
    /* the voice is kept when the words and the narrator are the same (a re-made shot doesn't pay for it again) */
    const vKey = `${tl.voice}|${vo}`, voice = !vo || ctx.bbv.comfort?.aiVoice === 'no' ? null : tl.voiceFile && tl.voiceKey === vKey ? { file: tl.voiceFile, provider: 'kept', usd: 0 }
      : spend('voice', ctx.slug) ? await engines.run('voice.tts', { text: vo, voice: tl.voice, slug: ctx.slug }).catch((e) => { log.warn?.('[jam2] voice', e.message); return null; }) : null;
    if (voice?.usd) made.push({ cap: 'voice.tts', provider: voice.provider, model: voice.model, usd: voice.usd || 0 });
    /* music made for this video (Lyria): instrumental, in the mood the storyboard names; ours to use, no licence question */
    let music = null; const mood = String(tl.music || '').trim();
    if (mood && !/^no music$/i.test(mood) && spend('voice', ctx.slug)) { music = tl.musicFile && tl.musicMood === mood ? { file: tl.musicFile, provider: 'kept', usd: 0 } : await engines.run('music.gen', { prompt: `${mood}, instrumental background music for a short product video by ${ctx.bbv.name || 'a brand'}${ctx.bbv.category ? ` (${ctx.bbv.category})` : ''}, steady, no vocals`, slug: ctx.slug }).catch((e) => { log.warn?.('[jam2] music', e.message); return null; });
      if (music?.usd) made.push({ cap: 'music.gen', provider: music.provider, model: music.model, usd: music.usd }); }
    /* captions: each shot's voiceover set in the brand's type, burnt in at the bottom; on-screen words up top */
    const caps = []; for (const s of shots) { const end = s === shots[shots.length - 1] && !!ctx.bbv.kit?.logo, words = tl.captions !== false && (s.vo || s.words); caps.push(words || end ? await captionCard(ctx, words ? s : {}, { logo: end }) : null); }
    const file = await stitch(shots, { voiceFile: voice?.file || null, musicFile: music?.file || null, caps });
    const take = { op, by: ctx.by, words: t0.words, timeline: { ...tl, shots, musicFile: music?.file || null, musicMood: music ? mood : null, voiceFile: voice?.file || null, voiceKey: voice ? vKey : null }, file, made, cost: { usd: +made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(2), credits: made.reduce((a, m) => a + (m.credits || 0), 0) }, parent: t0.id, how: board.how };
    const t = addTake(ctx.jam, board, take); t.gate = gate(ctx, t, board); return { take: t };
  }
  /* one shot's caption card: a clear 1080×1920 PNG with the voiceover line at the bottom and the on-screen words at the top */
  async function captionCard(ctx, s, { logo = false } = {}) {
    const kit = ctx.bbv.kit || {}, font = kit.fonts?.heading || kit.fonts?.body || null, layers = [];
    if (logo && kit.logo) layers.push({ id: 'logo', kind: 'logo', src: kit.logo, x: 390, y: 1690, w: 300, h: 110, z: 8, fit: 'contain' });
    if (s.vo) layers.push({ id: 'cap', kind: 'text', role: 'small', words: tidy(s.vo, 140), x: 90, y: 1430, w: 900, z: 6, style: { font, size: 52, weight: 700, color: '#ffffff', align: 'center', bg: 'rgba(0,0,0,0.55)', pad: 18, radius: 18, lh: 1.2 } });
    if (s.words) layers.push({ id: 'ost', kind: 'text', role: 'headline', words: tidy(s.words, 60), x: 90, y: 330, w: 900, z: 6, style: { font, size: 70, weight: 800, color: '#ffffff', align: 'center', shadow: true, lh: 1.1 } });
    return render({ w: 1080, h: 1920, bg: { color: 'transparent' }, kit: { ...kitOf(kit), colors: [] }, layers }, { ext: 'png', clear: true });
  }
  /* edit one shot's first frame (an area or a whole new look), animate that shot again from it, and put the video back together:
     the other shots, the voice and the music are kept */
  async function reshot(ctx, board, { i, ask, region = null, confirmUsd = null } = {}) {
    const t0 = headOf(board), sh = t0?.timeline?.shots?.[i]; if (!t0?.file || !sh) throw new Error('Render the video first, then change one shot.');
    const qe = await engines.quote('still.edit', { slug: ctx.slug }), qv = await engines.quote('video.shot', { seconds: Math.max(4, sh.sec || 4), slug: ctx.slug }); if (qe.error || qv.error) throw new Error(qe.error || qv.error);
    const usd = +((qe.usd || 0) + (qv.usd || 0)).toFixed(2); if (!isMock() && (confirmUsd == null || +confirmUsd + 0.01 < usd)) return { needsConfirm: true, quote: { usd, seconds: sh.sec, provider: qv.provider } };
    if (!spend('image', ctx.slug) || !spend('video', ctx.slug)) throw Object.assign(new Error('Today’s budget for pictures or video is used up.'), { budget: true });
    const made = [], cut = t0.cut && /^gen\//.test(t0.cut) ? { file: t0.cut } : await cutout(ctx); if (!cut?.file || cut.raw) throw new Error('Your product photo couldn’t be cut out just now, so the shot wasn’t changed. Try again in a moment.');
    const where = region ? `Change only the area from ${Math.round(region.x * 100)}% to ${Math.round((region.x + region.w) * 100)}% across and ${Math.round(region.y * 100)}% to ${Math.round((region.y + region.h) * 100)}% down: ` : '';
    /* only the background is changed: the image model never sees or draws the product, and the real cut-out is placed on it again */
    const bf = sh.bg ? await fileOf(sh.bg) : null;
    const ed = bf ? await engines.run('still.edit', { srcFile: bf, srcUrl: sh.bg, prompt: `${where}${ask}. Keep everything else as it is. No products, no packaging, no hands or people, no words, no logos.`, ratio: '9:16', slug: ctx.slug })
      : await scene(ctx, { describe: placeOf(`${sh.see}. ${ask}`), ratio: '9:16' });
    made.push({ cap: bf ? 'still.edit' : 'still.scene', provider: ed.provider, model: ed.model, usd: ed.usd || 0 });
    const still = await shotStill(ctx, sizeOf(board), ed.file, cut), ef = await fileOf(still);
    const clip = await engines.run('video.shot', { srcFile: ef, srcUrl: still, prompt: motionOf(sh, ask), seconds: sh.sec, ratio: '9:16', slug: ctx.slug, by: ctx.by?.email, jamId: ctx.jam.id, boardId: board.id });
    made.push({ cap: 'video.shot', provider: clip.provider, model: clip.model, usd: clip.usd || 0, credits: clip.credits || 0 });
    const shots = t0.timeline.shots.map((x, n) => (n === i ? { ...x, still, clip: clip.file, bg: ed.file, failed: null } : x));
    return finishVideo(ctx, board, t0, shots, made, { op: `shot ${i + 1} re-made` });
  }
  /* ffmpeg: the shots end to end at 1080×1920, each with its caption card; the voice over them and the music under the voice;
     a shot that has no clip shows its still */
  async function stitch(shots, { voiceFile = null, musicFile = null, caps = [] } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'j2v-')), parts = [];
    const ff = (args) => new Promise((ok, no) => import('node:child_process').then(({ execFile }) => execFile('ffmpeg', ['-y', '-v', 'error', ...args], { timeout: 180e3 }, (e) => (e ? no(e) : ok()))));
    const V = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p';
    try {
      for (const [i, s] of shots.entries()) { const out = path.join(tmp, `p${i}.mp4`); const clip = s.clip ? await fileOf(s.clip) : null, still = s.still ? await fileOf(s.still) : null, cap = caps[i] ? await fileOf(caps[i]) : null;
        const src = clip ? ['-i', clip] : still ? ['-loop', '1', '-i', still] : null; if (!src) continue; const sec = String(Math.max(2, Math.min(10, +s.sec || 4)));
        if (cap) await ff([...src, '-loop', '1', '-i', cap, '-t', sec, '-filter_complex', `[0:v]${V}[b];[1:v]scale=1080:1920,format=rgba[c];[b][c]overlay=0:0:format=auto,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-r', '30', out]);
        else await ff([...src, '-t', sec, '-vf', V, '-an', '-c:v', 'libx264', '-preset', 'veryfast', out]);
        parts.push(out); }
      if (!parts.length) throw new Error('no shot came through');
      const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n')); const joined = path.join(tmp, 'joined.mp4'); await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
      const vf = voiceFile ? await fileOf(voiceFile) : null, mf = musicFile ? await fileOf(musicFile) : null; let final = joined;
      if (vf || mf) { final = path.join(tmp, 'final.mp4'); const ins = ['-i', joined, ...(vf ? ['-i', vf] : []), ...(mf ? ['-stream_loop', '-1', '-i', mf] : [])];
        const fc = vf && mf ? '[1:a]loudnorm=I=-14[v];[2:a]volume=0.16,afade=t=in:d=0.5[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0,apad[a]' : vf ? '[1:a]loudnorm=I=-14,apad[a]' : '[1:a]volume=0.5,afade=t=in:d=0.5,apad[a]';
        await ff([...ins, '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', final]); }
      return keep(fs.readFileSync(final), 'mp4');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  /* a scene sent from the page (drag, resize, retype, hide): it keeps only known keys and only pictures this board already has, so
     the page can never pull in another brand's files or a URL for the renderer to fetch; style values are checked in scene.js */
  const LAYER_KEYS = ['id', 'kind', 'x', 'y', 'w', 'h', 'rot', 'z', 'hidden', 'locked', 'src', 'fit', 'shadow', 'words', 'role', 'style', 'blend'];
  function safeScene(sc, base) {
    const own = new Set([base.scene?.bg?.src, ...(base.scene?.layers || []).map((l) => l.src), ...(base.slides || []).flatMap((x) => [x.scene?.bg?.src, ...(x.scene?.layers || []).map((l) => l.src)])].filter(Boolean));
    const n = (v, d = 0) => (Number.isFinite(+v) ? Math.max(-20000, Math.min(20000, +v)) : d);
    const layers = (Array.isArray(sc?.layers) ? sc.layers : []).slice(0, 40).filter((l) => !l.src || own.has(l.src)).map((l) => { const o = {}; for (const k of LAYER_KEYS) if (l[k] !== undefined) o[k] = l[k];
      for (const k of ['x', 'y', 'w', 'h', 'rot', 'z']) if (o[k] !== undefined) o[k] = n(o[k]); if (o.words != null) o.words = tidy(o.words, 400); o.style = o.style && typeof o.style === 'object' ? { ...o.style } : undefined; return o; });
    const bg = { ...(base.scene?.bg || {}), ...(sc?.bg && typeof sc.bg === 'object' ? { color: sc.bg.color, fit: sc.bg.fit, filter: sc.bg.filter } : {}) };
    if (sc?.bg?.src && own.has(sc.bg.src)) bg.src = sc.bg.src;
    return { w: base.scene.w, h: base.scene.h, bg, kit: base.scene.kit, layers };
  }

  /* ---------- Edit this: one element, one change ---------- */
  async function edit(ctx, board, { target = null, region = null, ask = '', patch = null, op = null } = {}) {
    ctx.kind = board.recipe;
    const h = headOf(board); if (!h) throw new Error('Nothing to edit yet.'); const r = recipe(board.recipe);
    const base = JSON.parse(JSON.stringify(h)); delete base.id; delete base.n; delete base.gate; base.parent = h.id; base.by = ctx.by; base.made = []; base.at = Date.now();
    /* every new version follows the latest Brand Book's fonts (an upload today reaches the piece made yesterday on its next edit) */
    if (base.scene?.layers?.length) refreshKit(base.scene, ctx.bbv?.kit); for (const sl of base.slides || []) if (sl.scene?.layers?.length) refreshKit(sl.scene, ctx.bbv?.kit);
    /* free: the canvas's own moves (drag, resize, retype, font, colour, hide, preset, size) arrive as a scene patch */
    if (patch?.scene && base.scene) { base.scene = safeScene(patch.scene, base); base.scene.kit = { ...(base.scene.kit || {}), files: kitOf(ctx.bbv?.kit).files }; base.op = 'arrange'; base.file = await render(base.scene); base.words = { ...base.words, ...(patch.words || {}) }; }
    else if (patch?.words) { base.words = { ...base.words, ...patch.words }; base.op = 'words';
      if (base.scene) for (const l of base.scene.layers) if (l.role && patch.words[l.role] !== undefined) l.words = patch.words[l.role]; if (base.scene) base.file = await render(base.scene); }
    else if (patch?.timeline && base.timeline) { const t0 = patch.timeline, old = base.timeline;
      base.timeline = { voice: ['Kore', 'Puck', 'Aoede', 'Charon', 'Fenrir', 'Leda'].includes(t0.voice) ? t0.voice : old.voice, music: tidy(t0.music || old.music, 40), captions: t0.captions !== undefined ? !!t0.captions : old.captions,
        shots: (Array.isArray(t0.shots) ? t0.shots : old.shots).slice(0, 6).map((x, i) => ({ id: tidy(x?.id || old.shots?.[i]?.id || uid('sh'), 30), sec: Math.max(2, Math.min(10, Math.round(+x?.sec || 4))), see: tidy(x?.see, 200), vo: tidy(x?.vo, 200), words: tidy(x?.words, 60), camera: tidy(x?.camera || 'static', 40), still: old.shots?.find((o) => o.id === x?.id)?.still || null, clip: null })) }; base.op = 'timeline'; if (/\.(mp4|webm|mov)$/i.test(String(base.file || ''))) base.file = null; /* the old cut no longer matches: render again */ base.quote = await videoQuote(ctx, board, base); }
    else if (patch?.slide != null && base.slides?.[patch.slide]) { const sl = base.slides[patch.slide]; if (patch.slideScene) sl.scene = safeScene(patch.slideScene, base);
      for (const l of sl.scene.layers) if (l.role && patch.slideWords?.[l.role] !== undefined) l.words = patch.slideWords[l.role];
      if (patch.slideWords?.headline !== undefined && base.words?.slides?.[patch.slide]) base.words.slides[patch.slide].onSlide = patch.slideWords.headline;
      sl.file = await render(sl.scene); if (patch.slide === 0) { base.scene = sl.scene; base.file = sl.file; } base.op = 'slide'; }
    else if (op === 'line') { const now = getLine(base, target); if (now == null) throw new Error('Pick a line first.'); const nx = await rewriteLine(ctx, board, now, ask || 'rewrite', target); setLine(base, target, nx); base.op = 'line';
      if (base.scene) { for (const l of base.scene.layers) if (l.role && base.words[l.role] !== undefined) l.words = base.words[l.role]; base.file = await render(base.scene); }
      if (target?.kind === 'slide' && base.slides?.[target.i]) { const sl = base.slides[target.i]; for (const l of sl.scene.layers) if (l.role === 'headline') l.words = nx; sl.file = await render(sl.scene); if (target.i === 0) { base.scene = sl.scene; base.file = sl.file; } } }
    else if (op === 'final' && base.scene) { const sc = JSON.parse(JSON.stringify(base.scene)); const comp = await render(sc), cf = await fileOf(comp);
      if (!spend('image', ctx.slug)) throw new Error('Today’s picture budget is used up.');
      const fq = await engines.quote('still.full', { slug: ctx.slug }); if (fq.credits && !spend('credits', ctx.slug, fq.credits)) throw new Error('This brand’s Sloosh credits for today are used up.');
      const out = await engines.run('still.full', { srcFile: cf, srcUrl: comp, prompt: `Finish this ad as a premium photograph: keep the layout, the product, its label and every word exactly as they are; lift the light, depth and detail. ${ask || ''}`.trim(), ratio: sizeOf(board).ratio, slug: ctx.slug, product: ctx.product?.name || null, words: [base.words?.headline, base.words?.sub].filter(Boolean), by: ctx.by?.email, jamId: ctx.jam.id, boardId: board.id });
      base.made.push({ cap: 'still.full', provider: out.provider, model: out.model, usd: out.usd || 0, credits: out.credits || 0 }); base.file = out.file; base.final = true; base.op = 'final'; }
    else if (op === 'resize' && base.scene) { const sk = String(patch?.size || ask || ''), s = Object.hasOwn(SIZES, sk) ? SIZES[sk] : null; if (!s) throw new Error('Pick a size.');
      /* a shot: another placement is the same photo extended (made once, priced, then kept); a near frame just re-fits */
      if (base.shot && !base.shot.bgs?.[s.ratio] && farFrom(base.shot.ratio, s)) throw Object.assign(new Error(`The ${s.label} version extends the photo: confirm its price first.`), { needsExtend: true });
      board.size = sk; if (base.shot?.bgs?.[s.ratio]) { const x = await creative.extend(ctx, base, s); base.scene = x.scene; base.file = x.file; } else { base.scene = reflow(base.scene, s.w, s.h); base.file = await render(base.scene); } base.op = 'resize'; }
    else if (op === 'extend' && base.shot) { const sk = String(patch?.size || ask || ''), s = Object.hasOwn(SIZES, sk) ? SIZES[sk] : null; if (!s) throw new Error('Pick a size.');
      const x = await creative.extend(ctx, base, s); base.made.push(...x.made); base.shot = { ...base.shot, bgs: { ...(base.shot.bgs || {}), [s.ratio]: x.bg } }; board.size = sk; base.scene = x.scene; base.file = x.file; base.op = 'extend'; }
    /* a shot is re-shot, never re-pasted: a new take, a new setting or another product goes back through the engine */
    else if (base.shot && ['redo', 'background', 'place', 'swap-product'].includes(op)) {
      if (op === 'swap-product') ctx.product = productFor({ pick: patch?.product, catalog: ctx.catalog });
      const place = op === 'place' ? (ctx.bbv.places || []).find((p) => p.id === patch?.place) : null, want = place?.describe || ask;
      if (want) ctx.notes = [...(ctx.notes || []), `For this picture: ${want}`];
      const x = await creative.staticAd(ctx, board, base.words || {}, sizeOf(board)); base.made.push(...x.made);
      if (!x.scene) throw new Error(`The new picture didn't keep your product exactly as it is (${x.fail}). Nothing changed; try again.`);
      base.scene = x.scene; base.file = x.file; base.shot = x.shot; base.direction = x.direction; base.op = op; }
    else if (base.shot && op === 'blend') throw new Error('This picture was shot with your product in it, so its light already matches.');
    else if (op === 'swap-product') { ctx.product = productFor({ pick: patch?.product, catalog: ctx.catalog }); ctx.cuts = {}; const cut = await cutout(ctx); if (!cut) throw new Error('That product has no photo.');
      for (const l of base.scene?.layers || []) if (l.kind === 'product') l.src = cut.file; base.op = 'swap-product'; base.file = await render(base.scene); }
    else if (op === 'redo-words') { const w = await write(ctx, board, { ask: ask || 'A different angle and new words; same product.' }); base.words = w; base.op = 'redo-words';
      if (base.slides?.length) { for (const [i, sl] of base.slides.entries()) { const ws = w.slides?.[i]; if (!ws || !sl.scene) continue; for (const l of sl.scene.layers) { if (l.role === 'headline') l.words = ws.onSlide; if (l.role === 'sub') l.words = ws.small || ''; } sl.file = await render(sl.scene); }
        base.scene = base.slides[0].scene; base.file = base.slides[0].file; }
      if (base.scene) { for (const l of base.scene.layers) if (l.role && w[l.role] !== undefined) l.words = w[l.role]; base.file = await render(base.scene); } }
    /* priced: the background only (the product is its own layer and never goes to the model), or a brushed area of it */
    else if ((op === 'background' || op === 'place' || op === 'redo' || op === 'blend' || op === 'final') && !base.scene) throw new Error('This piece has no picture to change.');
    else if (base.slides?.length && ['background', 'place', 'blend', 'final', 'swap-product', 'redo', 'resize'].includes(op)) throw new Error('On a carousel, change one slide at a time, or redo the carousel.');
    else if (op === 'background' || op === 'place' || (target === 'bg' && ask)) {
      const place = op === 'place' ? (ctx.bbv.places || []).find((p) => p.id === patch?.place) : null, size = sizeOf(board);
      let bg;
      if (region && base.scene?.bg?.src) { const sf = await fileOf(base.scene.bg.src); if (!spend('image', ctx.slug)) throw new Error('Today’s picture budget is used up.');
        bg = await engines.run('still.edit', { srcFile: sf, srcUrl: base.scene.bg.src, prompt: `Change only the area inside the box from ${Math.round(region.x * 100)}% to ${Math.round((region.x + region.w) * 100)}% across and ${Math.round(region.y * 100)}% to ${Math.round((region.y + region.h) * 100)}% down: ${ask}. Keep everything else exactly as it is. No words, no logos.`, ratio: size.ratio, slug: ctx.slug }); }
      else bg = await scene(ctx, { describe: ask || base.words?.scene, ratio: size.ratio, place });
      base.made.push({ cap: bg.cap || 'still.scene', provider: bg.provider, model: bg.model, usd: bg.usd || 0 }); base.scene.bg.src = bg.file; base.op = region ? 'edit-area' : 'background'; base.file = await render(base.scene); }
    /* priced: blend the real product into the light of the scene (checked against the real photo; a miss keeps the composite) */
    else if (op === 'blend') { const sc = JSON.parse(JSON.stringify(base.scene)); sc.layers = sc.layers.filter((l) => l.kind === 'product'); const comp = await render(sc), cf = await fileOf(comp);
      const pf = ctx.product?.img ? await fileOf(ctx.product.img) : null;
      if (!spend('image', ctx.slug)) throw new Error('Today’s picture budget is used up.');
      const out = await engines.run('still.harmonize', { srcFile: pf || cf, refFiles: pf ? [cf] : [], prompt: `Image 2 is a finished composition of image 1 (the product) placed in a scene. Return image 2 with the product's lighting, shadow and reflections matched to the scene so it looks photographed there. Do not move, resize, redraw or relabel the product: its shape, label, text and colours stay exactly as in image 1. Change nothing else. No words added.`, ratio: sizeOf(board).ratio, slug: ctx.slug, product: ctx.product?.name || null });
      base.made.push({ cap: 'still.harmonize', provider: out.provider, model: out.model, usd: out.usd || 0 });
      if (out.guard?.fallback || out.guard?.same === false) { base.op = 'blend-kept'; base.note = 'The blend changed the product, so the real photo stays as placed.'; }
      else { base.scene.bg.src = out.file; for (const l of base.scene.layers) if (l.kind === 'product') l.hidden = true; base.harmonized = true; base.guard = out.guard || null; base.op = 'blend'; base.file = await render(base.scene); } }
    /* priced: a new picture, same words (Redo) */
    else if (op === 'redo') { const size = sizeOf(board), bg = await scene(ctx, { describe: ask || base.words?.scene, ratio: size.ratio }); base.made.push({ cap: 'still.scene', provider: bg.provider, model: bg.model, usd: bg.usd || 0 });
      if (base.scene) { base.scene.bg.src = bg.file; for (const l of base.scene.layers) if (l.kind === 'product') l.hidden = false; base.harmonized = false; base.file = await render(base.scene); } base.op = 'redo'; }
    /* words-only boards: ask the writer */
    else if (ask) { const w = await write(ctx, board, { ask }); base.words = { ...base.words, ...w }; base.op = 'ask'; if (base.scene) { for (const l of base.scene.layers) if (l.role && w[l.role] !== undefined) l.words = w[l.role]; base.file = await render(base.scene); } }
    else throw new Error('Say what to change.');
    if (r.kind === 'video' && base.timeline && patch?.timeline) { base.timeline = patch.timeline; base.quote = await videoQuote(ctx, board, base); }
    base.cost = { usd: +base.made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(3), credits: base.made.reduce((a, m) => a + (m.credits || 0), 0) };
    const t = addTake(ctx.jam, board, base); t.gate = gate(ctx, t, board); note(ctx.jam, `${base.op} on ${board.label}`, ctx.by?.email); return t;
  }

  /* one line of a board: a headline, a sentence of the body, a block, a row cell, a slide or a shot's words */
  function getLine(t, g = {}) { const w = t.words || {};
    if (g.kind === 'role') return w[g.role] ?? null; if (g.kind === 'subject') return w.subject ?? null;
    if (g.kind === 'sent') { const p = sentencesOf(w.body); return p[g.i * 2] ?? null; }
    if (g.kind === 'block') return w.blocks?.[g.i]?.text ?? null; if (g.kind === 'row') return w.rows?.[g.i]?.[g.col || 'b'] ?? null;
    if (g.kind === 'slide') return w.slides?.[g.i]?.onSlide ?? null; if (g.kind === 'shot') return t.timeline?.shots?.[g.i]?.[g.field || 'vo'] ?? null; return null; }
  function setLine(t, g = {}, v) { const w = (t.words ||= {});
    if (g.kind === 'role') w[g.role] = v; else if (g.kind === 'subject') w.subject = v;
    else if (g.kind === 'sent') { const p = sentencesOf(w.body); p[g.i * 2] = v; w.body = p.join(''); }
    else if (g.kind === 'block' && w.blocks?.[g.i]) w.blocks[g.i].text = v; else if (g.kind === 'row' && w.rows?.[g.i]) w.rows[g.i][g.col || 'b'] = v;
    else if (g.kind === 'slide' && w.slides?.[g.i]) w.slides[g.i].onSlide = v; else if (g.kind === 'shot' && t.timeline?.shots?.[g.i]) t.timeline.shots[g.i][g.field || 'vo'] = v; }
  const HOWS = { shorter: 'Make it shorter: keep the meaning, cut words.', warmer: 'Make it warmer and more human.', friendlier: 'Make it friendlier, like a person talking.', hindi: 'Write it in natural Hindi (Devanagari), same meaning.', rewrite: 'Say it a different, better way.' };
  async function rewriteLine(ctx, board, text, how, ctxLine = null) {
    if (isMock()) return how === 'shorter' ? tidy(String(text).split(/[,;:–—]/)[0].replace(/[.!?]?$/, '.'), 120) : how === 'hindi' ? `(हिंदी) ${text}` : how === 'warmer' || how === 'friendlier' ? `Honestly, ${String(text).charAt(0).toLowerCase()}${String(text).slice(1)}` : `${text} `.trim();
    if (!spend('text', ctx.slug)) throw Object.assign(new Error('Today’s writing budget is used up. It resets tonight.'), { budget: true });
    const out = await claudeTool([`Rewrite one line for ${ctx.bbv.name || 'the brand'} (${recipe(board.recipe).label}).`, `The line: ${text}`, HOWS[how] || `The team asked: ${how}`, brandbook.promptBlock(ctx.bbv, { recipe: board.recipe }), 'Same facts only: never invent numbers, discounts, codes, guarantees or reviews. Return just the new line.'].join('\n\n'), { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, 400, 'jam2_line');
    const cap = { role: 70, subject: 90, slide: 60, shot: 200, row: 160, block: 1500, sent: 400 }[ctxLine?.kind] || 400;
    return tidy(String(out?.text || text).trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, ''), cap); }

  /* the catalog price of a product (by handle, then name): what a take was made with, so a later price change can be flagged */
  function priceOf(ctx, p) { if (!p) return null; const c = (ctx.catalog || []).find((x) => (p.handle && x.handle === p.handle) || (p.name && (x.t || x.title) === p.name)); return c?.price != null ? String(c.price) : null; }

  /* the same picture for every product: the scene and words stay, each real product is cut out and placed in turn (free with
     the local cut-out; a product whose cut-out falls back to the paid one says so in the take's cost) */
  const p0cur = (ctx) => ctx.currency || ctx.bbv?.currency || '';
  /* a price in any currency: a symbol, a real ISO code (AED 99, 99 SAR; never "SPF 50"), Rs, or a % off */
  const ISO = (() => { try { return Intl.supportedValuesOf('currency').join('|'); } catch { return 'USD|INR|EUR|GBP|AED|SAR|AUD|CAD|SGD|JPY|ZAR'; } })();
  const priceRe = (cur) => new RegExp(`[$₹€£¥₩₦₱฿₫₪₺₽]\\s?\\d|\\b(?:${ISO}|Rs\\.?|RS\\.?)\\s?\\d|\\d[\\d,.]*\\s?(?:(?:${ISO})\\b|[Rr]s\\.?|\\/-)|\\b\\d+\\s?%\\s?(?:off|OFF|Off)${/^[A-Za-z]{1,3}$/.test(cur || '') && !/^[A-Z]{3}$/.test(cur) ? `|\\b${cur}\\s?\\d` : ''}`); /* codes in capitals only: "Top 10" is not Tongan paʻanga */
  async function allProducts(ctx, board, src, { max = 12 } = {}) {
    const h = headOf(src); if (!h?.scene) throw new Error('Make the picture first.');
    const tiles = (ctx.catalog || []).filter((p) => p.img || imgsOf(p)[0]).slice(0, max); if (tiles.length < 2) throw new Error('Your catalog has fewer than two products with photos.');
    const made = [], slides = [];
    /* the words were written for the source product: on every other product, a line with a price or that product's name would
       be a false claim, so it becomes this product's own name and catalog price; store-wide lines (free shipping) stay */
    const srcName = String(ctx.product?.name || h.product || '').toLowerCase(), same = (p) => !!srcName && String(p.t || p.title || '').toLowerCase() === srcName;
    const short = (p) => tidy(String(p.t || p.title || '').split(/\s+[–—|-]\s+/)[0], 40), sym = (c) => ({ USD: '$', INR: '₹', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$' }[String(c || '').toUpperCase()] || '');
    const money = (p, v) => (v == null ? '' : `${sym(p.currency || ctx.currency) || ''}${v}${sym(p.currency || ctx.currency) ? '' : ` ${p.currency || ctx.currency || ''}`.trimEnd()}`);
    /* a price in any currency: a symbol, a 3-letter code (AED 99, 99 SAR), Rs or the brand's own code; or a % off */
    const FIG = priceRe(p0cur(ctx)), SHIP = /shipping|delivery/i;
    const srcWords = srcName.split(/\s+[–—|-]\s+/)[0].split(/\s+/).filter((w) => w.length > 3);
    const names = (t) => srcWords.length && srcWords.filter((w) => String(t).toLowerCase().includes(w)).length >= Math.min(2, srcWords.length);
    /* the headline goes first: once it carries the product's name, the line under it is just the price */
    function fitWords(l, p, named) { if (l.kind !== 'text' && l.kind !== 'badge') return; const t = String(l.words || ''); if (!t || (SHIP.test(t) && !names(t))) return; if (!FIG.test(t) && !names(t)) return;
      if (l.kind === 'badge') { l.hidden = true; return; }
      const price = `${p.price != null ? money(p, p.price) : ''}${p.mrp > p.price ? ` (was ${money(p, p.mrp)})` : ''}`;
      if (l.role === 'headline') { l.words = short(p); named.v = true; } else l.words = named.v ? (price ? `Now ${price}` : '') : `${short(p)}${price ? ` · ${price}` : ''}`; if (!l.words) l.hidden = true; }
    for (const p of tiles) { const c2 = { ...ctx, product: { img: p.img || imgsOf(p)[0], name: p.t || p.title || null, handle: p.handle || null }, cuts: ctx.cuts };
      const cut = await cutout(c2); if (!cut || cut.raw) continue; if (cut.usd) made.push({ cap: 'cutout', provider: cut.provider, model: cut.model, usd: cut.usd });
      const sc = JSON.parse(JSON.stringify(h.scene)); for (const l of sc.layers) if (l.kind === 'product') { l.src = cut.file; l.hidden = false; }
      if (!same(p)) { const named = { v: false }; for (const l of [...sc.layers].sort((a, b) => (a.role === 'headline' ? -1 : 0) - (b.role === 'headline' ? -1 : 0))) fitWords(l, p, named); }
      slides.push({ scene: sc, file: await render(sc), product: c2.product.name }); }
    if (!slides.length) throw new Error('None of the product photos could be cut out.');
    const take = { op: 'all-products', by: ctx.by, words: { ...h.words, slides: slides.map((x) => ({ onSlide: x.product || '', small: '' })) }, slides, scene: slides[0].scene, file: slides[0].file, made, how: board.how,
      cost: { usd: +made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(3), credits: 0 } };
    const t = addTake(ctx.jam, board, take); t.gate = gate(ctx, t, board); return t;
  }

  /* what each priced action would cost right now, for the buttons */
  async function prices(ctx) {
    const s = await engines.quote('still.scene', { slug: ctx.slug }), e = await engines.quote('still.edit', { slug: ctx.slug }), hz = await engines.quote('still.harmonize', { slug: ctx.slug });
    const f = await engines.quote('still.full', { slug: ctx.slug }).catch(() => ({}));
    const x = await engines.quote('still.extend', { slug: ctx.slug }).catch(() => ({})), sh = await engines.quote('still.shot', { slug: ctx.slug }).catch(() => ({}));
    /* shot: a re-shoot makes two candidates and keeps the better one */
    return { extend: x.usd ?? null, shot: sh.usd != null ? +(sh.usd * 2).toFixed(2) : null, background: s.usd ?? null, redo: s.usd ?? null, area: e.usd ?? null, blend: hz.usd ?? null, final: f.usd ?? null, finalCredits: f.credits ?? null, providers: { scene: s.provider || null, edit: e.provider || null } };
  }
  return { reshot, allProducts, priceOf, getLine, setLine, sentencesOf, write, first, edit, render, renderVideo, videoQuote, gate, prices, cutout, composeScene, fileOf, dataUri, creative, BRIEF_SECTIONS };
}
