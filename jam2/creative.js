// The creative engine (Jam v2): a card becomes an ad that looks really shot, not a collage. Stages:
//   direct  - art direction for this card and placement: the moment, the set, the light, where the words sit (AI, words only)
//   shoot   - candidates made around the real product, its catalog photos as the identity anchor (Vertex Gemini 3 Pro Image or
//             Higgsfield, priced through engines); a brand without a product photo (services, enquiry brands) gets the moment alone
//   critic  - a vision check of each candidate: the same product as the photos, looks shot, works as an ad, and where the words fit
//   layout  - the copy set as real type in the brand's kit on the best candidate (never drawn by the model)
//   extend  - another placement is the same photo shot wider (outpaint), not a crop
// When no candidate keeps the product exact, the old way (the real cut-out placed in a made scene) stands in, so the product is
// never wrong. Phase 0 (23 Oct, Cozy): single products came out really shot; a kit of three changed two items, which this catches.
import { recipe } from './catalogue.js';
import { refsFor, creativeBlock } from './brandbook.js';
import { claimFlags, sourceText } from '../claims.js'; // words a model drew are checked like written ones

const tidy = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ZONES = ['top', 'bottom', 'left', 'right'];
/* the image models take a fixed set of frames: a banner, Facebook/X or print asks for the nearest one and the layout's cover fit trims it */
const GEM_RATIO = { '3:1': '21:9', '1.91:1': '16:9', A5: '2:3' };
/* the scene's starting preset for where the words go (the layout below moves every layer into the free side) */
const presetFor = (zone) => (zone === 'bottom' ? 'bottom-bar' : zone === 'left' || zone === 'right' ? 'side-card' : 'top');

const DIRECT_SCHEMA = { type: 'object', additionalProperties: false, required: ['family', 'moment', 'zone'], properties: {
  family: { type: 'string', enum: ['product in use', 'lifestyle moment', 'product hero', 'flat lay', 'problem and fix', 'seasonal moment', 'gift moment', 'offer card'] },
  moment: { type: 'string', description: 'One real photograph described for a photographer: who and what is in it, where, the light, the camera and lens. The product is in it exactly as in its photos.' },
  zone: { type: 'string', enum: ZONES, description: 'The calm part of the frame kept free for the headline' } } };

const CRITIC_SCHEMA = { type: 'object', additionalProperties: false, required: ['same', 'shot', 'ad', 'zone', 'why'], properties: {
  same: { type: 'boolean', description: 'Image 2 shows the same product as image 1: shape, colours, materials, details and the number of items' },
  shot: { type: 'integer', description: '0-10: looks like a real photograph from a shoot (light, shadows, contact, textures), not a render or a collage' },
  ad: { type: 'integer', description: '0-10: would stop a thumb in the feed, the product is clear and the moment fits the angle' },
  zone: { type: 'string', enum: ZONES, description: 'where a headline can sit without covering the product or a face' },
  why: { type: 'string' } } };

export function createCreative({ engines, ai = null, claudeTool, isMock, spend = () => true, fileOf, render, composeScene, profileOf = async () => null, keepLog = null, log = console }) {
  /* the catalog entry behind the jam's product: its photos (the hero first, then up to two more angles) */
  const entryOf = (ctx) => { const p = ctx.product; return p ? (ctx.catalog || []).find((x) => (p.handle && x.handle === p.handle) || (p.name && (x.t || x.title) === p.name)) || null : null; };
  /* the product's photos, the profile's cleanest one first (a packshot, never a size chart or a crowded scene) */
  /* the photos the brand added for this product in its Brand Book (back of the pack, a side, a close-up): references.js `product` */
  /* a photo added for "Serum - 30 ml" also serves "Serum - 30 ml - Pack of 3" (the same item in a pack); ™, ® and spacing don't count */
  const norm = (x) => String(x || '').toLowerCase().replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  const refPhotos = (ctx) => { const p = ctx.product; if (!p) return []; const keys = [p.handle, p.name].filter(Boolean).map(norm);
    return (ctx.refs || []).filter((r) => r.kind === 'image' && r.job === 'product' && r.product && keys.some((k) => { const q = norm(r.product); return q.length >= 4 && (k === q || k.startsWith(`${q} `) || k.startsWith(`${q}-`)); })).map((r) => r.url); };
  /* the catalog entry the product profile is read from, with the brand's own extra photos of it first after the main one */
  const productEntry = (ctx) => { const e = entryOf(ctx) || { t: ctx.product?.name, img: ctx.product?.img, handle: ctx.product?.handle }; const extra = refPhotos(ctx);
    const own = Array.isArray(e.imgs) ? e.imgs : e.images || []; return { ...e, images: [...extra, ...own] }; }; /* the read keeps a product's photos as imgs; the profile reads images */
  const photosOf = (ctx, prof = null) => { const p = ctx.product; if (!p?.img) return [];
    const e = entryOf(ctx); return [...new Set([prof?.best, p.img, ...refPhotos(ctx), ...((Array.isArray(e?.imgs) ? e.imgs : e?.images || []).filter(Boolean))].filter(Boolean))].slice(0, 4); };
  /* the product in words, from its profile: what it is, its real colours, each item of a kit, printed words that must stay */
  const productLine = (prof) => (prof ? [`It is ${prof.what}${prof.colours ? `, in ${prof.colours}` : ''}${prof.materials ? `, ${prof.materials}` : ''}.`,
    prof.kit && prof.items?.length ? `It is a kit of ${prof.items.length}: ${prof.items.join('; ')}. All ${prof.items.length} items appear, each exactly as photographed.` : '',
    prof.label ? `Printed on it (keep exact): ${prof.label}.` : '', prof.size ? `Size: ${prof.size}.` : ''].filter(Boolean).join(' ') : '');

  /* the Brand Book's rules for a photograph: who may be on camera, the brand's own places and cast, and the taste it has learned */
  const PEOPLE = { none: 'No people at all in the picture.', hands: 'Hands only: no faces or full people.', 'ai-cast': 'People are fine (AI-cast, natural, not models posing).', consented: 'Only the brand\'s own people from its cast may appear.' };
  function bookLines(v = {}) {
    const L = [], t = v.taste?.rules || [];
    if (PEOPLE[v.comfort?.people]) L.push(PEOPLE[v.comfort.people]);
    if (v.cast?.length && v.comfort?.people !== 'none') L.push(`The brand's cast: ${v.cast.slice(0, 3).map((c) => c.label).join('; ')}.`);
    if (v.places?.length) L.push(`The brand's own places (prefer one when it fits): ${v.places.slice(0, 4).map((p) => p.describe || p.label).join('; ')}.`);
    if (v.styleRefs?.length || Object.keys(v.library || {}).length) L.push('The brand\'s own pictures for this kind of piece are the look reference: match their light, colour and styling.');
    const dos = t.filter((r) => r.kind === 'do').slice(0, 4).map((r) => r.text), donts = t.filter((r) => r.kind === 'dont').slice(0, 4).map((r) => r.text);
    if (dos.length) L.push(`The team likes: ${dos.join('; ')}.`); if (donts.length) L.push(`The team doesn't want: ${donts.join('; ')}.`);
    return L.map((x) => tidy(x, 400)); }

  /* 1. art direction: one moment for this card, this angle and this placement */
  async function direct(ctx, board, words, size, style = null, { film = false } = {}) {
    const r = recipe(board.recipe) || {}, c = ctx.jam.concept || {}, p = ctx.product;
    const fallback = { family: p?.img ? 'product in use' : 'lifestyle moment', moment: tidy(words.scene || c.angle || 'a real moment where the product is used', 600), zone: 'top' };
    if (isMock() || !spend('text', ctx.slug)) return fallback;
    const prompt = [`Art-direct one ${film ? 'vertical phone video (one continuous take)' : 'ad photograph'} for ${ctx.bbv.name || 'a brand'}${ctx.bbv.category ? ` (${ctx.bbv.category})` : ''}.`,
      `The piece: ${r.label || board.label} for ${size.label || size.ratio} (${size.ratio}).`, `The card: ${tidy(c.spark?.title || ctx.card?.title, 200)}. ${tidy(c.spark?.says, 300)}`,
      `Angle: ${tidy(c.angle, 200)}. Audience: ${tidy(c.audience, 160)}. Headline that will be set over it: "${tidy(words.headline, 120)}".`,
      p?.img ? `The product: ${tidy(p.name, 140)}. ${ctx.profile ? productLine(ctx.profile) + ' Describe it only with these facts.' : 'Never describe its colour, material, pattern or design (you can\'t see the photos): call it "the product".'} It must be the hero, clearly visible, exactly as in its photos.${ctx.profile?.use ? ` It is used: ${tidy(ctx.profile.use, 160)}.` : ''}` : 'There is no product photo: show the moment or the place the brand sells, with people when it helps.',
      ctx.market && !ctx.market.guessed ? `The brand sells in ${ctx.market.name}: any people are its customers there (how they look, dress and live), in places that look like there.` : ctx.market?.name && ctx.market.cc !== 'US' ? `The brand most likely sells in ${ctx.market.name} (not confirmed yet): cast and set it there unless the card says otherwise.` : 'Where the brand sells isn\'t known yet: keep people and places neutral, with nothing that names a country.',
      ctx.storeKind === 'enquiry' ? 'The brand sells by enquiry (a service or a place to visit), not a shop: show the place, the moment or the people it serves; nobody holds a product to buy.' : '',
      ...bookLines(ctx.bbv), creativeBlock(ctx.bbv, ctx.kind || r.id || ''), ctx.notes?.length ? `The team asked: ${tidy(ctx.notes.join(' '), 400)}` : '',
      style ? `The look the team picked (follow it exactly): ${tidy(style.look, 400)}${style.people === 'none' ? ' No people.' : style.people === 'hands' ? ' Hands only, no faces.' : ''}` : '',
      'Pick the format family that fits the card. Describe one real, specific moment a photographer could shoot (people, place, props, light, lens). Keep one part of the frame calm (real background, never a blank band) for the headline and say which. No words, signs, screens with text or logos in the picture.'].filter(Boolean).join('\n');
    try { const out = await claudeTool(prompt, DIRECT_SCHEMA, 1200, 'jam2_direct'); return { family: out.family || fallback.family, moment: tidy(out.moment, 900) || fallback.moment, zone: ZONES.includes(out.zone) ? out.zone : 'top' }; }
    catch (e) { log.warn?.('[creative] direct', e.message); return fallback; }
  }

  /* 2. the shoot: n candidates around the real product (or the moment alone without one) */
  const shotPrompt = (d, p, looks = 0) => [p ? `The first image${p.refs > 1 ? `s show` : ' shows'} the real product "${tidy(p.name, 140)}". It is the identity anchor.` : '',
    looks ? `The last ${looks > 1 ? `${looks} images are` : 'image is'} the brand's own published photo${looks > 1 ? 's' : ''}: match their light, colour grade, styling and mood. Copy nothing from ${looks > 1 ? 'them' : 'it'}: no products, people, text or layout.` : '',
    p?.line ? p.line : '', p ? 'KEEP UNCHANGED: the product\'s exact shape, proportions, colours, materials, details and any labels; the same number of items. Do not redesign, recolour, simplify or add parts.' : '',
    p ? 'CHANGE ONLY: the scene, the people, the light and the camera described below.' : '', d.moment,
    `Leave natural negative space in the ${d.zone} part of the frame for a headline: real background there (wall, sky, floor, soft out-of-focus room), never a blank band, border, panel or frame.`,
    'It must look like a real photograph from a professional shoot, not a render or a collage: physically correct light, contact shadows, reflections and depth of field across product and scene.',
    'No text, no letters, no logos, no watermarks anywhere in the picture.'].filter(Boolean).join('\n');
  async function shoot(ctx, d, ratio, n = 2) {
    const photos = photosOf(ctx, ctx.profile), files = (await Promise.all(photos.map((u) => fileOf(u).catch(() => null)))).filter(Boolean), p = files.length ? { name: ctx.product?.name, refs: files.length, line: productLine(ctx.profile) } : null;
    /* the Brand Book's look: two of the brand's own pictures for this kind of piece (refsFor: their static ads for a static, reels for a reel), after the product photos (never the identity anchor) */
    const lookSrc = refsFor(ctx.bbv, ctx.kind || '', 2).map((x) => x.src).filter(Boolean), looks = (await Promise.all(lookSrc.map((u) => fileOf(u).then((f) => (f ? { u, f } : null)).catch(() => null)))).filter(Boolean);
    const spec = { prompt: shotPrompt(d, p, looks.length), tier: ctx.tier || null /* the composer's quality: preview, standard, premium 4K */, srcFile: files[0] || null, srcUrl: photos[0] || null, refFiles: [...files.slice(1), ...looks.map((x) => x.f)], refUrls: [...photos.slice(1), ...looks.map((x) => x.u)], ratio: GEM_RATIO[ratio] || ratio, slug: ctx.slug, product: p ? ctx.product?.name : false, named: p ? { img: photos[0], t: ctx.product?.name || null } : null };
    const outs = await Promise.all(Array.from({ length: n }, () => engines.run('still.shot', spec).catch((e) => ({ error: e }))));
    return { cands: outs.filter((o) => o.file), errors: outs.filter((o) => o.error).map((o) => o.error), refFile: files[0] || null };
  }

  /* 3. the critic: a vision check of each candidate against the product photo */
  async function critique(ctx, cands, refFile, d) {
    if (isMock() || !ai) return cands.map((c, i) => ({ ...c, same: true, shot: 7, ad: 7, zone: d.zone, why: 'check off', i }));
    const ref = refFile ? await fileOf(refFile).catch(() => null) : null, fs = await import('node:fs');
    const img = (f) => { const b = fs.readFileSync(f); return { type: 'image', source: { type: 'base64', media_type: b[0] === 0x89 ? 'image/png' : 'image/jpeg', data: b.toString('base64') } }; };
    return Promise.all(cands.map(async (c, i) => { const f = await fileOf(c.file).catch(() => null); if (!f) return { ...c, same: false, shot: 0, ad: 0, zone: d.zone, why: 'file missing', i };
      try { const r = await ai.call({ model: 'sonnet', tag: 'jam2_critic', max: 1500, effort: 'low', schema: CRITIC_SCHEMA, messages: [{ role: 'user', content: [
          ...(ref ? [img(ref)] : []), img(f), { type: 'text', text: `${ref ? 'Image 1 is the real product. Image 2 is a new ad photograph meant to show it.' : 'This is a new ad photograph (the brand has no product photo).'} The ad: "${tidy(ctx.jam.concept?.angle, 160)}". Judge it like a creative director: is it the same product (when there is one), does it look really shot, would it work as an ad, and where can a headline sit. A blank band, border, panel, an empty grey area or an obvious paste-up is not a real photograph: score shot 4 or lower.` }] }] });
        const j = r.json || {}; return { ...c, same: ref ? !!j.same : true, shot: +j.shot || 0, ad: +j.ad || 0, zone: ZONES.includes(j.zone) ? j.zone : d.zone, why: tidy(j.why, 200), usd: (c.usd || 0) + (r.usd || 0), i };
      } catch (e) { log.warn?.('[creative] critic', e.message); return { ...c, same: true, shot: 6, ad: 6, zone: d.zone, why: `check didn't run: ${e.message}`, i, unchecked: true }; } /* a check that didn't run never buys a second picture */ }));
  }

  /* a designed piece (a Higgsfield ad style, a poster, a graphic) draws its own words, so it is read back before anyone sees it:
     the same product as the photo, and every word on it backed by what we know (the words we wrote, the real reviews, the catalog,
     the brand's name). A model that adds a size, a number, a claim, or dresses the brand's own line up as a customer review fails.
     23 Oct, Arata: a review style printed "10ml volume each" (the bottle is 30 ml) and set the tagline as a 5-star review */
  const MADE_SCHEMA = { type: 'object', additionalProperties: false, required: ['same', 'words', 'invented'], properties: {
    same: { type: 'boolean', description: 'The product in image 2 is the same as in image 1 (shape, colours, label, count); true when there is no image 1' },
    words: { type: 'array', items: { type: 'string' }, description: 'Every piece of text printed on image 2' },
    invented: { type: 'array', items: { type: 'string' }, description: 'Each printed text that states a fact, number, size, claim, result or review NOT backed by the facts given; also any line shown as a customer review or with stars that is not one of the real reviews given word for word' } } };
  async function checkMade(ctx, file, facts = {}) {
    if (isMock() || !ai) return { same: true, invented: [], words: [] };
    const fs = await import('node:fs'), f = await fileOf(file).catch(() => null); if (!f) return { same: false, invented: [], words: [], why: 'file missing' };
    const img = (x) => { const b = fs.readFileSync(x); return { type: 'image', source: { type: 'base64', media_type: b[0] === 0x89 ? 'image/png' : 'image/jpeg', data: b.toString('base64') } }; };
    const refSrc = photosOf(ctx, ctx.profile)[0], ref = refSrc ? await fileOf(refSrc).catch(() => null) : null, e = entryOf(ctx);
    const known = [`Brand: ${ctx.bbv?.name || ''}`, ctx.product?.name ? `Product: ${ctx.product.name}${e?.price ? ` · ${e.price}` : ''}` : '', ctx.profile ? `What it is: ${ctx.profile.what}; label: ${ctx.profile.label || ''}; size: ${ctx.profile.size || ''}` : '',
      `Our words: ${[facts.headline, facts.sub, facts.badge, facts.cta].filter(Boolean).join(' / ')}`, (facts.claims || []).length ? `Claims the brand may make, as written: ${facts.claims.map((c) => `"${tidy(c, 80)}"`).join(' ')}` : '', (facts.proof || []).length ? `Real customer reviews (word for word): ${facts.proof.map((q) => `"${tidy(q, 300)}"`).join(' ')}` : 'There are no customer reviews to quote.'].filter(Boolean).join('\n');
    try { const r = await ai.call({ model: 'sonnet', tag: 'jam2_made_check', max: 1500, effort: 'low', schema: MADE_SCHEMA, messages: [{ role: 'user', content: [...(ref ? [img(ref)] : []), img(f), { type: 'text', text: `${ref ? 'Image 1 is the real product. Image 2 is an ad made for it.' : 'This is an ad.'} The facts we can back up:\n${known}\nThe product's own printed label is fine. Read every text on the ad and list what is not backed by these facts.` }] }] });
      const j = r.json || {}, read = (j.words || []).slice(0, 20);
      /* the words the model drew, read back, go through the same claim check as every draft (1.5): "Dermat-approved" or "95% growth"
         the brand's own words and approved claims don't carry is invented, whatever the reader said */
      const src = sourceText(known, ctx.bbv?.claims || [], ctx.bbv?.reviews || []), claimed = read.filter((w) => claimFlags(String(w), src).length).map((x) => tidy(x, 120));
      return { same: ref ? !!j.same : true, invented: [...new Set([...(j.invented || []).map((x) => tidy(x, 120)), ...claimed])].filter(Boolean).slice(0, 6), words: read, usd: r.usd || 0 };
    } catch (err) { log.warn?.('[creative] made check', err.message); return { same: true, invented: [], words: [], unchecked: true }; } }

  /* a logo's width ÷ height (its box hugs the logo); null when it can't be read */
  const aspects = new Map();
  async function aspectOf(src) { if (!src) return null; if (aspects.has(src)) return aspects.get(src);
    let a = null; try { const f = await fileOf(src); if (f) { const sharp = (await import('sharp')).default; const m = await sharp(f).metadata(); if (m.width && m.height) a = m.width / m.height; } } catch {} aspects.set(src, a); return a; }
  /* how bright the photo is where the words go (0 dark … 1 light): the ink and the scrim follow it, so type reads on any photo */
  const SIDE = { top: [0, 0, 1, 0.42], bottom: [0, 0.58, 1, 0.42], left: [0, 0, 0.52, 1], right: [0.48, 0, 0.52, 1] };
  /* the part of the photo a frame of this size shows (the picture covers the frame, centred), as an extract box */
  const shown = (m, size) => { const r = size ? size.w / size.h : m.width / m.height, cw = Math.min(m.width, Math.round(m.height * r)), ch = Math.min(m.height, Math.round(m.width / r));
    return { left: Math.round((m.width - cw) / 2), top: Math.round((m.height - ch) / 2), width: cw, height: ch }; };
  async function lumaOf(file, zone, size = null) {
    try { const f = await fileOf(file); if (!f) return 0.3; const sharp = (await import('sharp')).default, m = shown(await sharp(f).metadata(), size), [x, y, ww, hh] = SIDE[zone] || SIDE.top;
      const { channels } = await sharp(f).extract({ left: m.left + Math.round(m.width * x), top: m.top + Math.round(m.height * y), width: Math.max(1, Math.round(m.width * ww)), height: Math.max(1, Math.round(m.height * hh)) }).greyscale().stats();
      return channels[0].mean / 255; } catch { return 0.3; } }
  /* the calm side, measured: edge energy (a Laplacian) of each side of the photo; the critic's pick stands unless another side is
     clearly calmer (a hand, a face or the product makes edges), so the words never land on the moment that sells. 23 Oct, Arata:
     the critic said right and the old card went left over the hand; measured right 4.4 vs 11.7-18.4 elsewhere */
  async function calmest(file, hint, size = null) {
    try { const f = await fileOf(file); if (!f) return hint; const sharp = (await import('sharp')).default, S = 256;
      const { data } = await sharp(f).extract(shown(await sharp(f).metadata(), size)).resize(S, S, { fit: 'fill' }).greyscale().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer({ resolveWithObject: true });
      const e = Object.fromEntries(Object.entries(SIDE).map(([z, [x, y, w, h]]) => { let t = 0, n = 0; for (let j = Math.round(y * S); j < Math.round((y + h) * S); j++) for (let i = Math.round(x * S); i < Math.round((x + w) * S); i++) { t += Math.abs(data[j * S + i] - 128); n++; } return [z, t / n]; }));
      const min = ZONES.reduce((a, z) => (e[z] < e[a] ? z : a), ZONES[0]); return hint && e[hint] <= e[min] * 1.35 ? hint : min; } catch { return hint; } }
  /* a see-through logo's own tone (0 dark … 1 light) on mid grey; null for a logo with its own background (it needs no plate) */
  async function logoTone(src) {
    try { const f = src && await fileOf(src); if (!f) return null; const sharp = (await import('sharp')).default; if (!(await sharp(f).metadata()).hasAlpha) return null;
      const { channels } = await sharp(f).flatten({ background: '#808080' }).greyscale().stats(); return channels[0].mean / 255; } catch { return null; } }
  /* the words over a real photograph, in the calm side the critic found (left, right, top or bottom): never a card or panel (that
     reads as a paste-up), a soft scrim only on that side, light or dark ink by the measured brightness there, any proof badge and the
     button stacked under the words so nothing lands on the product or a face, and the logo in a corner the words don't use */
  async function layout(ctx, size, bgFile, words, zone, logoAspect = null) {
    zone = await calmest(bgFile, ZONES.includes(zone) ? zone : 'top', size);
    const sc = composeScene({ size, bgFile, cut: null, words, kit: ctx.bbv.kit, preset: presetFor(zone) }), { w, h } = size, kit = ctx.bbv.kit || {};
    const light = (await lumaOf(bgFile, zone, size)) > 0.58, ink = light ? '#111111' : '#ffffff', head = kit.fonts?.heading || null, body = kit.fonts?.body || head;
    const accent = kit.accent || kit.colors?.[0] || '#111111', u = Math.min(w, h * 1.25), pad = Math.round(u * 0.065), tall = h / w > 1.6, side = zone === 'left' || zone === 'right';
    const headline = tidy(words.headline, 60), badge = tidy(words.badge, 34), cta = tidy(words.cta, 22) || (ctx.storeKind === 'enquiry' ? 'Enquire now' : ctx.product?.name ? 'Shop now' : 'Learn more');
    let sub = tidy(words.sub, 90);
    const colX = zone === 'right' ? Math.round(w * 0.54) : pad, colW = side ? Math.round(w * 0.46 - pad) : Math.min(w - pad * 2, Math.round(w * 0.82));
    /* the button's words in the colour that reads on the brand's own colour (a white or pastel brand colour gets dark words) */
    const lumOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return 0.2; const n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const L0 = lumOf(accent), ctaInk = (L0 + 0.05) / 0.0556 > 1.05 / (L0 + 0.05) ? '#111111' : '#ffffff'; /* whichever has more contrast (WCAG): a mid blue gets dark words */
    const safeTop = tall ? Math.round(h * 0.14) : pad, safeBot = tall ? Math.round(h * 0.2) : pad; /* stories and reels keep clear of the platform's own bars */
    /* the logo leads the words in the free side (never on the product, never on the button row) */
    const logo = sc.layers.find((l) => l.kind === 'logo');
    if (logo && logoAspect) { const lw = Math.min(logo.w, Math.round(logo.h * logoAspect)), lh = Math.round(lw / logoAspect); logo.w = lw; logo.h = lh; }
    /* every size from the frame's short side, then shrunk until the words fit the free space (a 3:1 banner or a 16:9 frame never
       pushes the button off the bottom); a sub that still doesn't fit is left out */
    const space = zone === 'bottom' || zone === 'top' ? Math.round(h * (tall ? 0.5 : 0.56)) - (zone === 'top' ? safeTop : safeBot) : h - safeTop - safeBot;
    const lines = (t, sz) => Math.max(1, Math.ceil(t.length / Math.max(6, colW / (sz * 0.56))));
    const measure = (k) => { const big = Math.round(u * (headline.length < 26 ? 0.085 : headline.length < 48 ? 0.068 : 0.056) * (side ? 0.8 : 1) * k), subS = Math.max(Math.round(u * 0.026 * k), Math.round(big * 0.45));
      const bs = Math.round(u * 0.026 * Math.max(k, 0.8)), bp = Math.round(u * 0.013 * Math.max(k, 0.8)), cs = Math.round(u * 0.03 * Math.max(k, 0.8)), cp = Math.round(u * 0.02 * Math.max(k, 0.8)), gap = Math.round(u * 0.028 * k);
      const headH = headline ? Math.round(lines(headline, big) * big * 1.12) : 0, subH = sub ? Math.round(lines(sub, subS) * subS * 1.32) : 0, badgeH = badge ? Math.round(bs * 1.25 + bp * 2) : 0, ctaH = Math.round(cs * 1.25 + cp * 2);
      const oneRow = !side && !!badge, logoTop = logo ? logo.h + gap * 1.5 : 0, total = logoTop + headH + (sub ? gap + subH : 0) + (badge && !oneRow ? gap + badgeH : 0) + gap * 1.4 + ctaH;
      return { big, subS, bs, bp, cs, cp, gap, headH, subH, badgeH, ctaH, oneRow, logoTop, total }; };
    let k = 1, M = measure(k); while (M.total > space && k > 0.56) { k -= 0.06; M = measure(k); } if (M.total > space && sub) { sub = ''; M = measure(k); }
    const { big, subS, bs, bp, cs, cp, gap, headH, subH, badgeH, ctaH, oneRow, logoTop, total } = M;
    let y = zone === 'bottom' ? h - safeBot - total : side ? Math.max(safeTop, Math.round((h - total) * 0.32)) : safeTop;
    if (logo) { logo.x = colX; logo.y = y; } y += logoTop;
    const shade = { left: '90deg', right: '270deg', top: '180deg', bottom: '0deg' }[zone], tone = light ? '255,255,255' : '0,0,0', reach = side ? 0.66 : 0.5;
    const L = [{ id: 'shade', kind: 'shape', x: zone === 'right' ? Math.round(w * (1 - reach)) : 0, y: zone === 'bottom' ? Math.round(h * (1 - reach)) : 0, w: side ? Math.round(w * reach) : w, h: side ? h : Math.round(h * reach), z: 5, style: { bg: `linear-gradient(${shade},rgba(${tone},${light ? 0.55 : 0.6}),rgba(${tone},0))` } }];
    if (headline) { L.push({ id: 'headline', kind: 'text', role: 'headline', words: headline, x: colX, y, w: colW, z: 6, style: { font: head, size: big, weight: 800, color: ink, shadow: !light, lh: 1.08 } }); y += headH; }
    if (sub) { y += gap; L.push({ id: 'sub', kind: 'text', role: 'sub', words: sub, x: colX, y, w: colW, z: 6, style: { font: body, size: subS, weight: 500, color: ink, shadow: !light, lh: 1.3 } }); y += subH; }
    const bw = Math.min(colW, Math.round(badge.length * bs * 0.58 + bp * 2 + bs)), badgeStyle = { font: body, size: bs, weight: 700, color: light ? '#fff' : '#111', bg: light ? 'rgba(17,17,17,.88)' : 'rgba(255,255,255,.92)', radius: 999, pad: bp, align: 'center', lh: 1.25 };
    if (badge && !oneRow) { y += gap; L.push({ id: 'badge', kind: 'badge', role: 'small', words: badge, x: colX, y, w: bw, h: badgeH, z: 7, style: badgeStyle }); y += badgeH; }
    y += Math.round(gap * 1.4);
    if (oneRow) L.push({ id: 'badge', kind: 'badge', role: 'small', words: badge, x: colX, y: y + Math.round((ctaH - badgeH) / 2), w: bw, h: badgeH, z: 7, style: badgeStyle });
    L.push({ id: 'cta', kind: 'badge', role: 'cta', words: cta, x: oneRow ? colX + bw + gap : colX, y, w: Math.min(Math.round(w * 0.62), colW - (oneRow ? bw + gap : 0), Math.max(Math.round(u * 0.26), Math.round(cta.length * cs * 0.62 + cp * 2 + cs * 1.4))), h: ctaH, z: 7, style: { font: body, size: cs, weight: 700, color: ctaInk, bg: accent, radius: 999, pad: cp, align: 'center', lh: 1.25 } });
    if (logo) { /* a plate only when the logo's own colour would vanish on the photo there (dark on dark, light on light) */
      const lt = await logoTone(kit.logo); if (lt != null && lt > 0.5 === light) { const pd = Math.round(u * 0.012); L.push({ id: 'logo-plate', kind: 'shape', x: logo.x - pd, y: logo.y - pd, w: logo.w + pd * 2, h: logo.h + pd * 2, z: (logo.z || 8) - 1, style: { bg: light ? 'rgba(17,17,17,.85)' : 'rgba(255,255,255,.88)', radius: Math.round(u * 0.016) } }); } }
    sc.layers = [...sc.layers.filter((l) => !['text', 'shape', 'badge'].includes(l.kind)), ...L];
    return sc;
  }

  /* the whole static: direct → shoot → critic → layout. Returns null when no candidate kept the product (the caller composites) */
  async function staticAd(ctx, board, words, size, { n = 1, style = null, noWords = false } = {}) {
    /* the product's profile first (read once, kept): a product with no usable photo is asked for, never shot blind */
    if (ctx.product?.img && ctx.profile === undefined) ctx.profile = await profileOf(ctx.slug, productEntry(ctx)).catch(() => null);
    if (ctx.profile && ctx.profile.usable === false) return { made: [], fail: `No photo shows ${ctx.profile.name || 'this product'} clearly enough to shoot it (${ctx.profile.why || 'add a clear product photo'}). Add one with + → Product photo.`, needPhoto: true };
    const d = await direct(ctx, board, words, size, style);
    if (!spend('image', ctx.slug)) throw Object.assign(new Error('Today’s picture budget is used up. It resets tonight.'), { budget: true });
    let { cands, errors, refFile } = await shoot(ctx, d, size.ratio, n);
    /* one take, checked; a second only when the critic turned the first down (its reason goes into the retry) */
    if (cands.length) { const j0 = await critique(ctx, cands, refFile, d); const good = j0.filter((c) => c.same && c.shot + c.ad >= 11);
      if (!good.length && spend('image', ctx.slug)) { const why = j0.map((c) => c.why).filter(Boolean).join(' ');
        const r2 = await shoot(ctx, { ...d, moment: `${d.moment}\nThe last attempt was rejected: ${tidy(why, 300)}. Fix that.` }, size.ratio, 1); cands = [...j0, ...r2.cands]; errors = [...errors, ...r2.errors]; }
      else cands = j0; }
    const made = cands.map((c) => ({ cap: 'still.shot', provider: c.provider, model: c.model, usd: c.usd || 0 }));
    if (!cands.length) { log.warn?.('[creative] no candidate', errors.map((e) => e.message).join('; ')); return { made, direction: d, fail: errors[0]?.message || 'no picture came back' }; }
    const judged = await critique(ctx, cands.filter((c) => c.same === undefined), refFile, d).then((x) => [...cands.filter((c) => c.same !== undefined), ...x]), ok = judged.filter((c) => c.same).sort((a, b) => b.shot + b.ad - (a.shot + a.ad));
    keepLog?.({ slug: ctx.slug, board: board.id, direction: d, judged: judged.map(({ file, same, shot, ad, zone, why, provider }) => ({ file, same, shot, ad, zone, why, provider })) });
    if (!ok.length) return { made, direction: d, judged, fail: 'the product changed in every picture' };
    const best = ok[0], zone = best.zone || d.zone;
    const scene = noWords ? { w: size.w, h: size.h, bg: { color: '#ffffff', src: best.file }, kit: { fonts: ctx.bbv.kit?.fonts || {}, colors: [] }, layers: [] } : await layout(ctx, size, best.file, words, zone, await aspectOf(ctx.bbv.kit?.logo));
    return { made, direction: d, judged, scene, file: await render(scene), shot: { file: best.file, ratio: size.ratio, zone, family: d.family, moment: d.moment, score: { shot: best.shot, ad: best.ad }, why: best.why, provider: best.provider, bgs: { [size.ratio]: best.file } } };
  }

  /* another placement: the same photo shot wider (or taller), then the words laid out again */
  async function extend(ctx, take, size) {
    const sh = take.shot; if (!sh?.file) throw new Error('This picture wasn’t made as a shoot.');
    let bg = sh.bgs?.[size.ratio];
    const made = [];
    if (!bg) { if (!spend('image', ctx.slug)) throw Object.assign(new Error('Today’s picture budget is used up. It resets tonight.'), { budget: true });
      const src = await fileOf(sh.file); const out = await engines.run('still.extend', { srcFile: src, srcUrl: sh.file, ratio: GEM_RATIO[size.ratio] || size.ratio, slug: ctx.slug, product: ctx.product?.name || false,
        prompt: `Extend this exact photograph to a ${size.ratio} frame. Keep every existing part of the photo unchanged (the people, the product, the light, the colours); only continue the scene naturally at the edges so it reads as one real photo shot ${size.w > size.h ? 'wider' : 'taller'}. No text, no logos.` });
      bg = out.file; made.push({ cap: 'still.extend', provider: out.provider, model: out.model, usd: out.usd || 0 }); }
    const scene = await layout(ctx, size, bg, take.words || {}, sh.zone, await aspectOf(ctx.bbv.kit?.logo));
    return { scene, file: await render(scene), bg, made };
  }

  return { direct, shoot, critique, checkMade, staticAd, extend, photosOf, refPhotos, productEntry, presetFor, productLine, entryOf, layout, aspectOf };
}
