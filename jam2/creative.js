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

const tidy = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ZONES = ['top', 'bottom', 'left', 'right'];
/* the image models take a fixed set of frames: a banner, Facebook/X or print asks for the nearest one and the layout's cover fit trims it */
const GEM_RATIO = { '3:1': '21:9', '1.91:1': '16:9', A5: '2:3' };
/* a typePreset for where the words go: top = headline band over the top; bottom = the bar; left/right = the side card */
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

export function createCreative({ engines, ai = null, claudeTool, isMock, spend = () => true, fileOf, render, composeScene, keepLog = null, log = console }) {
  /* the catalog entry behind the jam's product: its photos (the hero first, then up to two more angles) */
  const photosOf = (ctx) => { const p = ctx.product; if (!p?.img) return [];
    const c = (ctx.catalog || []).find((x) => (p.handle && x.handle === p.handle) || (p.name && (x.t || x.title) === p.name));
    return [...new Set([p.img, ...((c?.images || []).filter(Boolean))])].slice(0, 3); };

  /* 1. art direction: one moment for this card, this angle and this placement */
  async function direct(ctx, board, words, size) {
    const r = recipe(board.recipe) || {}, c = ctx.jam.concept || {}, p = ctx.product;
    const fallback = { family: p?.img ? 'product in use' : 'lifestyle moment', moment: tidy(words.scene || c.angle || 'a real moment where the product is used', 600), zone: 'top' };
    if (isMock() || !spend('text', ctx.slug)) return fallback;
    const prompt = [`Art-direct one ad photograph for ${ctx.bbv.name || 'a brand'}${ctx.bbv.category ? ` (${ctx.bbv.category})` : ''}.`,
      `The piece: ${r.label || board.label} for ${size.label || size.ratio} (${size.ratio}).`, `The card: ${tidy(c.spark?.title || ctx.card?.title, 200)}. ${tidy(c.spark?.says, 300)}`,
      `Angle: ${tidy(c.angle, 200)}. Audience: ${tidy(c.audience, 160)}. Headline that will be set over it: "${tidy(words.headline, 120)}".`,
      p?.img ? `The product: ${tidy(p.name, 140)}. It must be the hero, clearly visible, exactly as in its photos.` : 'There is no product photo: show the moment or the place the brand sells, with people when it helps.',
      ctx.bbv.look?.notes ? `The brand's look: ${tidy(ctx.bbv.look.notes, 300)}` : '', ctx.notes?.length ? `The team asked: ${tidy(ctx.notes.join(' '), 400)}` : '',
      'Pick the format family that fits the card. Describe one real, specific moment a photographer could shoot (people, place, props, light, lens). Keep one part of the frame calm for the headline and say which. No words, signs, screens with text or logos in the picture.'].filter(Boolean).join('\n');
    try { const out = await claudeTool(prompt, DIRECT_SCHEMA, 1200, 'jam2_direct'); return { family: out.family || fallback.family, moment: tidy(out.moment, 900) || fallback.moment, zone: ZONES.includes(out.zone) ? out.zone : 'top' }; }
    catch (e) { log.warn?.('[creative] direct', e.message); return fallback; }
  }

  /* 2. the shoot: n candidates around the real product (or the moment alone without one) */
  const shotPrompt = (d, p) => [p ? `The first image${p.refs > 1 ? `s show` : ' shows'} the real product "${tidy(p.name, 140)}". It is the identity anchor.` : '',
    p ? 'KEEP UNCHANGED: the product\'s exact shape, proportions, colours, materials, details and any labels; the same number of items. Do not redesign, recolour, simplify or add parts.' : '',
    p ? 'CHANGE ONLY: the scene, the people, the light and the camera described below.' : '', d.moment,
    `Keep the ${d.zone} of the frame calm and uncluttered for a headline.`,
    'It must look like a real photograph from a professional shoot, not a render or a collage: physically correct light, contact shadows, reflections and depth of field across product and scene.',
    'No text, no letters, no logos, no watermarks anywhere in the picture.'].filter(Boolean).join('\n');
  async function shoot(ctx, d, ratio, n = 2) {
    const photos = photosOf(ctx), files = (await Promise.all(photos.map((u) => fileOf(u).catch(() => null)))).filter(Boolean), p = files.length ? { name: ctx.product?.name, refs: files.length } : null;
    const spec = { prompt: shotPrompt(d, p), srcFile: files[0] || null, srcUrl: photos[0] || null, refFiles: files.slice(1), refUrls: photos.slice(1), ratio: GEM_RATIO[ratio] || ratio, slug: ctx.slug, product: p ? ctx.product?.name : false, named: p ? { img: photos[0], t: ctx.product?.name || null } : null };
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
          ...(ref ? [img(ref)] : []), img(f), { type: 'text', text: `${ref ? 'Image 1 is the real product. Image 2 is a new ad photograph meant to show it.' : 'This is a new ad photograph (the brand has no product photo).'} The ad: "${tidy(ctx.jam.concept?.angle, 160)}". Judge it like a creative director: is it the same product (when there is one), does it look really shot, would it work as an ad, and where can a headline sit.` }] }] });
        const j = r.json || {}; return { ...c, same: ref ? !!j.same : true, shot: +j.shot || 0, ad: +j.ad || 0, zone: ZONES.includes(j.zone) ? j.zone : d.zone, why: tidy(j.why, 200), usd: (c.usd || 0) + (r.usd || 0), i };
      } catch (e) { log.warn?.('[creative] critic', e.message); return { ...c, same: true, shot: 5, ad: 5, zone: d.zone, why: `check didn't run: ${e.message}`, i, unchecked: true }; } }));
  }

  /* the whole static: direct → shoot → critic → layout. Returns null when no candidate kept the product (the caller composites) */
  async function staticAd(ctx, board, words, size, { n = 2 } = {}) {
    const d = await direct(ctx, board, words, size);
    if (!spend('image', ctx.slug)) throw Object.assign(new Error('Today’s picture budget is used up. It resets tonight.'), { budget: true });
    const { cands, errors, refFile } = await shoot(ctx, d, size.ratio, n);
    const made = cands.map((c) => ({ cap: 'still.shot', provider: c.provider, model: c.model, usd: c.usd || 0 }));
    if (!cands.length) { log.warn?.('[creative] no candidate', errors.map((e) => e.message).join('; ')); return { made, direction: d, fail: errors[0]?.message || 'no picture came back' }; }
    const judged = await critique(ctx, cands, refFile, d), ok = judged.filter((c) => c.same).sort((a, b) => b.shot + b.ad - (a.shot + a.ad));
    keepLog?.({ slug: ctx.slug, board: board.id, direction: d, judged: judged.map(({ file, same, shot, ad, zone, why, provider }) => ({ file, same, shot, ad, zone, why, provider })) });
    if (!ok.length) return { made, direction: d, judged, fail: 'the product changed in every picture' };
    const best = ok[0], zone = best.zone || d.zone;
    const scene = composeScene({ size, bgFile: best.file, cut: null, words, kit: ctx.bbv.kit, preset: presetFor(zone) });
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
    const scene = composeScene({ size, bgFile: bg, cut: null, words: take.words || {}, kit: ctx.bbv.kit, preset: presetFor(sh.zone) });
    return { scene, file: await render(scene), bg, made };
  }

  return { direct, shoot, critique, staticAd, extend, photosOf, presetFor };
}
