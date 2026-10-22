// Brew Studio: every image and video deliverable, made through Higgsfield, set up from the card so the brand only says yes.
// The library (data/studio-styles.json + Higgsfield's own ad styles) lists every style; defaults() reads the card, the Brand
// Book and the products to pre-pick the kind, three styles, the product, the sizes, the length and how many; plan() says in
// one line what will be made and what it costs (Higgsfield's own estimates); make() makes one take for one board. Nothing is
// made without the price shown and a yes (the route checks it), and a take that fails its checks is retried once, never more.
import fs from 'node:fs'; import path from 'node:path';
import { SIZES } from './catalogue.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', f), 'utf8')); } catch { return d; } };
const LIB = readJSON('studio-styles.json', { image: [], video: [] }), HFSTYLES = readJSON('higgsfield-styles.json', { presets: [] }).presets || [];
const tidy = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/* the whole library, Higgsfield's designed ad styles filled into the Ads group (grouped as Higgsfield groups them) */
export function library() {
  const ads = HFSTYLES.map((p) => ({ id: `hf:${p.id}`, label: p.name, group: p.group || 'Ads', job: 'product-shot', type: 'drawn', preset: p.id, ratio: p.ratio || null, cover: p.cover || null }));
  return { image: LIB.image.map((g) => (g.source === 'higgsfield-presets' ? { ...g, styles: ads } : g)), video: LIB.video };
}
const ALL = () => { const L = library(); return [...L.image, ...L.video].flatMap((g) => g.styles.map((s) => ({ ...s, group: s.group || g.label, groupId: g.id, kind: L.video.includes(g) ? 'video' : 'image' }))); };
export const styleOf = (id) => ALL().find((s) => s.id === id) || null;

/* how many the card promises ("8 ads", "Queue the 12", "4 hooks"): that many takes, never more than 12 */
export function countOf(card) { const m = /\b(\d{1,2})\s+(?:new\s+|more\s+|fresh\s+)?(?:ads?|images?|pictures?|posts?|statics?|creatives?|videos?|reels?|clips?|hooks?|variants?|versions?|takes?|ideas?)\b/i.exec(`${card?.title || ''} ${card?.cta?.label || ''}`);
  const n = m ? +m[1] : 1; return Math.max(1, Math.min(12, n)); }
const VIDEO_RE = /\b(video|reel|reels|tiktok|short|shorts|ugc|clip|film|unbox)/i;

/* what the composer opens with, from the card: kind, three styles, product, sizes, length, count */
export function defaults(ctx, board = null) {
  const card = ctx.card || {}, text = `${card.title || ''} ${card.cta?.label || ''} ${card.sub || ''} ${ctx.jam?.concept?.angle || ''}`, people = ctx.bbv?.comfort?.people || 'ai-cast';
  const kind = board?.kind === 'video' || VIDEO_RE.test(card.cta?.label || '') || VIDEO_RE.test(card.title || '') ? 'video' : 'image';
  const okPeople = (s) => !s.people || s.people === 'none' || s.people === 'any' || (s.people === 'hands' ? people !== 'none' : people === 'ai-cast' || people === 'consented');
  let picks;
  if (kind === 'video') picks = /\b(reviews?|testimonials?|ugc|creators?|unbox\w*|haul)\b(?! ready)/i.test(text.replace(/ready to review/i, '')) ? ['ugc-review', 'ugc-unbox', 'hypermotion'] : /how|tutorial|routine|guide/i.test(text) ? ['ugc-tutorial', 'in-life', 'showcase'] : /tiktok|trend|viral|hook/i.test(text) ? ['tt-hook', 'tt-pov', 'hypermotion'] : ['in-life', 'ugc-home', 'showcase'];
  else {
    const grp = /\bvs\b|versus|compare|switch|rival|instead of|than /i.test(text) ? 'Compare & Switch' : /\b(reviews|customer review|stars?|rated|loved|testimonials?)\b/i.test(text) ? 'Social Proof' : /problem|fix|tired of|cold|pain|struggle/i.test(text) ? 'Problem Solved' : /spec|ingredient|feature|why it works|benefit/i.test(text) ? 'Proof & Specs' : 'Hero Spotlight';
    const ad = HFSTYLES.find((p) => p.group === grp); const mp = /amazon|flipkart|marketplace|listing|nykaa|myntra/i.test(text);
    picks = mp ? ['mp-main', 'mp-lifestyle', 'mp-benefits'] : /offer|sale|% off|deal|discount|bundle|free shipping/i.test(text) ? ['in-use', ad ? `hf:${ad.id}` : 'color-pop', 'offer-card'] : /gift|holiday|christmas|diwali|valentine/i.test(text) ? ['gift', 'in-use', ad ? `hf:${ad.id}` : 'flat-lay'] : ['in-use', ad ? `hf:${ad.id}` : 'closeup', 'color-pop'];
  }
  picks = picks.map(styleOf).filter(Boolean).filter(okPeople);
  if (picks.length < 3) picks.push(...ALL().filter((s) => s.kind === kind && okPeople(s) && !picks.some((p) => p.id === s.id)).slice(0, 3 - picks.length));
  const sizes = kind === 'video' ? ['story'] : picks[0]?.ratio === '1:1' ? ['ig-square'] : [board?.size && SIZES[board.size] ? board.size : 'ig-portrait'];
  return { kind, styles: picks.slice(0, 3).map((s) => s.id), style: picks[0]?.id || null, product: ctx.product ? { img: ctx.product.img, name: ctx.product.name || null, handle: ctx.product.handle || null } : null,
    sizes, seconds: kind === 'video' ? picks[0]?.seconds || 10 : null, count: countOf(card) };
}

export function createStudio({ engines, maker, profileOf = async () => null, isMock = () => false, spend = () => true, log = console }) {
  const hf = engines.hf, cr = maker.creative;
  /* the product's profile (read once, kept): the facts every prompt carries */
  const ensureProfile = async (ctx) => { if (ctx.product?.img && ctx.profile === undefined) ctx.profile = await profileOf(ctx.slug, cr.entryOf(ctx) || { t: ctx.product.name, img: ctx.product.img, handle: ctx.product.handle }).catch(() => null); return ctx.profile || null; };
  const sizeOf = (k) => ({ key: k, ...(SIZES[k] || SIZES['ig-portrait']) });
  /* the price of one take of a style (what Higgsfield will charge, plus the check), in dollars */
  async function perTake(ctx, st, size, seconds) {
    const shot = await engines.quote('still.shot', { slug: ctx.slug }).catch(() => ({ usd: 0.14 }));
    if (st.job === 'product-shot') return (shot.usd ?? 0.14) * 1.5; /* one take, a retry about half the time */
    if (st.job === 'type-poster' || st.job === 'brand-graphic') { const o = hf.pick(st.job); const e = await hf.estimate(o.id, { ...o.input, prompt: 'a poster with the brand offer in large type for a product ad', aspect_ratio: hf.nearestRatio(o.id, size.ratio) }); return e.usd ?? 0.1; }
    if (st.job === 'product-motion') { const o = hf.pick('product-motion'); const e = await hf.estimate(o.id, { ...o.input, prompt: 'p', image_url: 'https://brew.joinsquareup.com/x.jpg', duration: seconds || 5 }); return (shot.usd ?? 0.14) + (e.usd ?? 0.11 * (seconds || 5)); }
    if (st.job === 'ugc-video') { const o = hf.pick('ugc-video'); const e = await hf.estimate(o.id, { ...o.input, prompt: 'p', image_urls: ['https://brew.joinsquareup.com/x.jpg'], duration: seconds || 10 }); return e.usd ?? 0.3 * (seconds || 10); }
    return 0.14;
  }
  /* the plan line and its price: what will be made, how many, at what cost */
  async function plan(ctx, spec) {
    const st = styleOf(spec.style); if (!st) return { error: 'Pick a style.' };
    const size = sizeOf(spec.sizes?.[0] || (st.kind === 'video' ? 'story' : 'ig-portrait')), n = Math.max(1, Math.min(12, +spec.count || 1)), per = await perTake(ctx, st, size, spec.seconds);
    const usd = +(per * n).toFixed(2), prod = spec.product?.name || ctx.product?.name;
    const line = `${n > 1 ? `${n} ` : ''}${st.kind === 'video' ? `${spec.seconds || st.seconds || 10} s ${st.group} video${n > 1 ? 's' : ''}` : `${st.group.toLowerCase()} picture${n > 1 ? 's' : ''}`} · ${st.label}${prod ? ` · ${tidy(prod, 60)}` : ''} · ${size.label}`;
    return { line, usd, per: +per.toFixed(3), count: n, kind: st.kind, style: st.id };
  }

  /* one take for one board */
  async function make(ctx, board, spec, i = 0) {
    const st = styleOf(spec.style); if (!st) throw new Error('Pick a style.');
    const size = sizeOf(spec.sizes?.[0] || (st.kind === 'video' ? 'story' : 'ig-portrait'));
    if (spec.product?.img) ctx.product = { ...spec.product };
    const words = await maker.write(ctx, board, { ask: spec.count > 1 ? `This is take ${i + 1} of ${spec.count}: a different hook and headline from the others${spec.ask ? `; ${spec.ask}` : ''}.` : spec.ask || '' }).catch(() => ({}));
    const made = [], take = { op: 'studio', by: ctx.by, words, made, studio: { style: st.id, label: st.label, group: st.group, kind: st.kind, size: size.key } };
    if (st.kind === 'image' && st.job === 'product-shot' && !st.preset) {
      const x = await cr.staticAd(ctx, board, words, size, { style: st, noWords: st.type === 'none' }); made.push(...x.made);
      if (!x.scene) throw new Error(x.fail || 'The picture didn’t come out right.');
      Object.assign(take, { scene: x.scene, file: x.file, shot: x.shot, direction: x.direction });
    } else if (st.preset || st.kind === 'image') { /* Higgsfield's designed ad style (Flare with its preset, the real product photo as image 1), or a
      type-led poster / illustration (Ideogram / Recraft): either way the model draws the words, so they are given exactly and read back */
      if (!spend('image', ctx.slug)) throw Object.assign(new Error('Today’s picture budget is used up.'), { budget: true });
      await ensureProfile(ctx);
      const proof = (words.proof || []).filter(Boolean).slice(0, 1), review = /social proof|review/i.test(`${st.group} ${st.label} ${st.look || ''}`) && proof.length;
      const exact = [words.headline && `Headline: "${words.headline}"`, words.sub && `Line: "${words.sub}"`, review && `Customer review, word for word, with its stars: "${tidy(proof[0], 220)}"`, words.cta && `Button: "${words.cta}"`].filter(Boolean).join('; ');
      const rules = `The only words on the image: ${exact}${ctx.bbv?.name ? `, and the brand name ${ctx.bbv.name}` : ''}. No other text: no sizes, numbers, prices, percentages, ingredients or claims.${review ? '' : ' Nothing styled as a customer review or star rating.'}`;
      const job = st.preset ? 'product-shot' : st.job, o = hf.pick(job), photos = st.preset ? cr.photosOf(ctx, ctx.profile).slice(0, 1).map((u) => engines.pub(u)) : [];
      const base = st.preset ? { ...o.input, enhance_prompt: true, preset_id: st.preset, quality: 'high', image_urls: photos, aspect_ratio: hf.nearestRatio(o.id, size.ratio) } : { ...o.input, aspect_ratio: hf.nearestRatio(o.id, size.ratio) };
      const promptOf = (fix = '') => tidy([st.preset ? `An ad for ${ctx.bbv?.name || 'the brand'}.` : `${st.look} For ${ctx.bbv?.name || 'the brand'}, in its colours ${(ctx.bbv?.kit?.colors || []).join(', ')}.`, cr.productLine(ctx.profile), rules, fix].filter(Boolean).join(' '), st.preset ? 4800 : 2000);
      let file = null, check = null;
      for (let t = 0; t < 2 && !file; t++) {
        const input = { ...base, prompt: promptOf(t && check ? `The last one was wrong: ${check.same ? '' : 'the product changed. '}${check.invented.length ? `it added "${check.invented.join('", "')}" — leave those out.` : ''}` : '') };
        const e = await hf.estimate(o.id, input), out = await hf.run(o.id, input); const f = engines.keep(out.buf, /jpe?g/.test(out.type) ? 'jpg' : 'png');
        made.push({ cap: st.preset ? 'still.styled' : 'still.graphic', provider: 'higgsfield', model: o.id, usd: e.usd ?? 0.1 });
        check = await cr.checkMade(ctx, f, { ...words, proof: review ? proof : [] }); made.push({ cap: 'check', provider: 'gemini', model: 'made-check', usd: check.usd || 0 });
        if ((check.same || !st.preset) && !check.invented.length) file = f;
        else if (t === 0 && !spend('image', ctx.slug)) break; }
      if (!file) { const err = new Error(`The ${st.label} picture ${check?.same === false ? 'changed the product' : `added words we can’t back up (${(check?.invented || []).join(', ')})`}, twice, so it isn’t shown. Try another style.`); err.made = made; throw err; }
      Object.assign(take, { file, scene: { w: size.w, h: size.h, bg: { src: file }, layers: [] }, check: { words: check.words, unchecked: !!check.unchecked } });
    } else if (st.job === 'product-motion') { /* a checked product shot (the style's look, no words), then Kling moves it */
      const shot = await cr.staticAd(ctx, board, words, sizeOf('story'), { style: { ...st, people: 'none' }, noWords: true }); made.push(...shot.made); if (!shot.shot) throw new Error(shot.fail || 'The first frame didn’t keep the product.');
      if (!spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true });
      const o = hf.pick('product-motion'), input = { ...o.input, prompt: tidy(`${st.look} ${cr.productLine(ctx.profile)} Nothing new appears; no text.`, 2400), image_url: engines.pub(shot.shot.file), duration: spec.seconds || st.seconds || 5 };
      const e = await hf.estimate(o.id, input), out = await hf.run(o.id, input, { maxMs: 20 * 60e3 }); const file = engines.keep(out.buf, 'mp4'); made.push({ cap: 'video.motion', provider: 'higgsfield', model: o.id, usd: e.usd ?? 0.55 });
      Object.assign(take, { file, poster: shot.shot.file, shot: shot.shot });
    } else { /* UGC / TikTok: a person with the real product, talking, Seedance with the product photos as references */
      if (!spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true }); await ensureProfile(ctx);
      const photos = cr.photosOf(ctx, ctx.profile).map((u) => engines.pub(u)), o = hf.pick('ugc-video'), line = tidy([words.headline, words.sub].filter(Boolean).join(' '), 220);
      const input = { ...o.input, prompt: tidy([st.look, ctx.product?.name ? `The product (exactly as in the reference photos): ${ctx.product.name}. ${cr.productLine(ctx.profile)}` : '', st.says && line ? `They say: "${line}"` : '', 'Vertical phone video, natural light, real person, no on-screen text.'].filter(Boolean).join(' '), 2400),
        image_urls: photos, duration: spec.seconds || st.seconds || 10, aspect_ratio: hf.nearestRatio(o.id, size.ratio) };
      const e = await hf.estimate(o.id, input), out = await hf.run(o.id, input, { maxMs: 25 * 60e3 }); const file = engines.keep(out.buf, 'mp4'); made.push({ cap: 'video.ugc', provider: 'higgsfield', model: o.id, usd: e.usd ?? 3 });
      Object.assign(take, { file });
    }
    take.cost = { usd: +made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(3), credits: 0 };
    return take;
  }
  return { library, defaults, plan, make, styleOf, countOf };
}
