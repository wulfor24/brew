// Brew Studio: every image and video deliverable, made through Higgsfield, set up from the card so the brand only says yes.
// The library (data/studio-styles.json + Higgsfield's own ad styles) lists every style; defaults() reads the card, the Brand
// Book and the products to pre-pick the kind, three styles, the product, the sizes, the length and how many; plan() says in
// one line what will be made and what it costs (Higgsfield's own estimates); make() makes one take for one board. Nothing is
// made without the price shown and a yes (the route checks it), and a take that fails its checks is retried once, never more.
import fs from 'node:fs'; import path from 'node:path';
import { SIZES } from './catalogue.js';
import { srtOf } from '../video-finish.js';
import { claimFlags } from '../claims.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', f), 'utf8')); } catch { return d; } };
const LIB = readJSON('studio-styles.json', { image: [], video: [] }), HFSTYLES = readJSON('higgsfield-styles.json', { presets: [] }).presets || [];
const tidy = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/* a film delivered at the placement's exact pixels (a 720p model clip covers 1080×1920 for Reels/Stories): scaled to cover and
   centre-cropped, lanczos with a light sharpen, H.264 + AAC, fast start. Free, local; when ffmpeg can't, the model's clip stands */
export async function finishVideo(buf, size, log = console) {
  const os = await import('node:os'), { execFile } = await import('node:child_process'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')), a = path.join(dir, 'in.mp4'), b = path.join(dir, 'out.mp4');
  try { fs.writeFileSync(a, buf); const w = size?.w || 1080, h = size?.h || 1920;
    await new Promise((ok, no) => execFile('ffmpeg', ['-v', 'error', '-y', '-i', a, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},unsharp=5:5:0.6:5:5:0.0,setsar=1`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', b], { timeout: 180e3 }, (e) => (e ? no(e) : ok())));
    return fs.readFileSync(b); } catch (e) { log.warn?.('[studio] finish video', e.message); return buf; } finally { fs.rmSync(dir, { recursive: true, force: true }); } }

/* the whole library, Higgsfield's designed ad styles filled into the Ads group (grouped as Higgsfield groups them) */
export function library() {
  const ads = HFSTYLES.map((p) => ({ id: `hf:${p.id}`, label: p.name, group: p.group || 'Ads', job: 'product-shot', type: 'drawn', preset: p.id, ratio: p.ratio || null, cover: p.cover || null }));
  return { image: LIB.image.map((g) => (g.source === 'higgsfield-presets' ? { ...g, styles: ads } : g)), video: LIB.video };
}
const ALL = () => { const L = library(); return [...L.image, ...L.video].flatMap((g) => g.styles.map((s) => ({ ...s, group: s.group || g.label, groupId: g.id, kind: L.video.includes(g) ? 'video' : 'image' }))); };
export const styleOf = (id) => ALL().find((s) => s.id === id) || null;

/* how many the card promises ("8 ads", "Queue the 12", "4 hooks"): that many takes, never more than 12 */
export function countOf(card) { const m = /(?<![\d:.,x×/-])\b(\d{1,2})\s+(?:new\s+|more\s+|fresh\s+)?(?:ads?|images?|pictures?|posts?|statics?|creatives?|videos?|reels?|clips?|hooks?|variants?|versions?|takes?|ideas?)\b/i.exec(`${card?.cta?.label || ''} ${card?.make?.pieces || ''} ${/^(ship|make|create|queue|launch|run|test|draft|generate|try|shoot|film|post|publish|build)\b/i.test(String(card?.title || '').trim()) ? card.title : ''}`); /* the button, what the card says to make, and a title that asks to make them ("Ship 8 new ads"); "Rival is running 14 ads" is no ask for 14 */
  const n = m ? +m[1] : 1; return Math.max(1, Math.min(12, n)); }
/* a card that asks for a film (whole words only: "running shorts", "hair clip" and "cling film" are products, not videos) */
const VIDEO_RE = /\b(videos?|reels?|tiktoks?|youtube shorts|ugc|unboxing)\b/i;
/* each deliverable a board can be (jam2/catalogue.js): the styles it opens with, its sizes and length. Carousel-type boards (a carousel,
   a stories set, a marketplace listing, a product page set, a photoshoot) open as a SET: one style per slide, all on one board */
const BY_RECIPE = {
  'native-ad': { picks: ['ugc-still', 'meme', 'hands'] }, 'ig-post': { picks: ['in-use', 'editorial', 'flat-lay'] }, 'moment-post': { picks: ['gift', 'flat-lay', 'in-use'] },
  pin: { picks: ['flat-lay', 'in-use', 'editorial'], sizes: ['pinterest'] }, meme: { picks: ['meme', 'ugc-still', 'hands'], sizes: ['ig-square'] },
  banner: { picks: ['editorial', 'natural', 'color-pop'], sizes: ['banner'] }, insert: { picks: ['quote-card', 'offer-card', 'illustration'], sizes: ['a5'] },
  tryon: { picks: ['on-model', 'full-body', 'closeup'] },
  'motion-static': { picks: ['color-pop-v', 'hypermotion', 'unveil'], seconds: 5 }, gif: { picks: ['gif-loop', 'showcase', 'color-pop-v'], seconds: 5, sizes: ['ig-square'] }, 'demo-video': { picks: ['ugc-tutorial', 'in-life', 'showcase'] },
  'ugc-ad': { picks: ['ugc-review', 'ugc-home', 'ugc-unbox'] }, 'asmr-video': { picks: ['asmr', 'in-life', 'dark-minimal'], seconds: 5 },
  'hook-variant': { picks: ['tt-hook', 'tt-pov', 'ugc-review'] }, orbit: { picks: ['orbit-360', 'showcase', 'dark-minimal'], seconds: 5, sizes: ['ig-square'] },
  listing: { set: ['mp-main', 'mp-lifestyle', 'mp-benefits', 'mp-size'], sizes: ['pdp'] }, 'pdp-set': { set: ['mp-main', 'in-use', 'mp-benefits', 'closeup'], sizes: ['pdp'] },
  photoshoot: { set: ['studio-white', 'in-use', 'editorial', 'flat-lay'] }, 'carousel-ad': { set: ['in-use', 'closeup', 'flat-lay', 'color-pop'], sizes: ['ig-square'] },
  'ig-carousel': { set: ['editorial', 'in-use', 'hands', 'flat-lay'] }, stories: { set: ['ugc-still', 'in-use', 'closeup'], sizes: ['story'] },
  /* Amazon A+: the header, three tiles, the wide image; each style carries its own Amazon size */
  aplus: { set: ['aplus-hero', 'aplus-use', 'aplus-detail', 'aplus-hands', 'aplus-wide'], sizes: ['aplus-header'] } };
/* a board the composer makes: every picture, set and video. A founder video stays a script for the real founder: an AI face
   presented as the brand's founder would be a lie */
export const inStudio = (bd) => !!bd && ['static', 'video', 'carousel'].includes(bd.kind) && bd.recipe !== 'founder-ad';

/* what this brand's Brand Book and catalog allow, one rule for the composer, the price and the make: a reason a style can't be
   made for this brand, or null. People on camera follow comfort.people (none / hands / AI people / our own people, which Brew
   can't film yet), a style that shows the product needs a product photo, a review style needs a real review, a testimonial
   needs the brand's yes to testimonials */
const REVIEWISH = (st) => st.group === 'Social Proof' || st.id === 'quote-card';
export function blockOf(st, ctx = {}) {
  if (!st) return 'Pick a style.';
  const people = ctx.bbv?.comfort?.people || 'ai-cast', p = st.people || 'any';
  if (p === 'person' && people === 'none') return `${st.label} shows a person, and your Brand Book says no people on camera. Pick a style without people, or change it in Brand Book → People.`;
  if (p === 'person' && people === 'hands') return `${st.label} shows a person, and your Brand Book says hands only. Pick a hands or product style, or change it in Brand Book → People.`;
  if (p === 'hands' && people === 'none') return `${st.label} shows hands, and your Brand Book says no people on camera. Pick a style without people.`;
  if (p === 'person' && people === 'consented') return `${st.label} would show an AI person, and your Brand Book says only your own people. Pick a hands or product style, or allow AI people in Brand Book → People.`;
  /* Recreate swaps the product into the reference footage and keeps everything else: the people, their faces and voices, their
     words. That is only the brand's to post when the footage is its own; a creator's or a rival's video would put a real person
     and their work in the brand's ad (Arata, 24 Oct: the creator, her room and her words came back with a tube swapped) */
  if (st.needsRef === 'video' && !(ctx.ref?.video && ctx.ref.own)) return ctx.ref?.video ? `${st.label} would keep ${ctx.ref.author || ctx.ref.brand || 'the creator'}’s own people, face, voice and words in your ad, so it only runs on videos that are yours. Make a Viral short instead: it follows the same shots with your product and your cast.` : `${st.label} remakes one of your own videos with this product in it: it needs a video of yours to start from.`;
  if ((st.job === 'packshot' || st.designed || st.preset || st.job === 'ugc-video' || st.job === 'video-restyle' || st.job === 'viral-short') && !ctx.product?.img) return `${st.label} shows your product: pick a product with a photo, or a style that shows a place or a moment.`;
  if (REVIEWISH(st) && !(ctx.bbv?.reviews || []).length) return `${st.label} needs a real customer review, and there are none in your Brand Book yet.`;
  if (st.says && /review|testimonial/i.test(`${st.id} ${st.look}`) && ctx.bbv?.comfort?.testimonials === 'no') return `${st.label} is a testimonial, and your Brand Book says no testimonials.`;
  return null; }
/* the styles this brand can't use, with why (the composer greys them out and says so) */
export const blockedFor = (ctx) => Object.fromEntries(ALL().map((st) => [st.id, blockOf(st, ctx)]).filter(([, w]) => w));

/* what the composer opens with, from the card: kind, three styles, product, sizes, length, count */
export function defaults(ctx, board = null) {
  const card = ctx.card || {}, text = `${card.title || ''} ${card.cta?.label || ''} ${card.sub || ''} ${ctx.jam?.concept?.angle || ''}`, enquiry = ctx.storeKind === 'enquiry';
  /* the board's own kind wins (a picture board stays a picture even when the card says "reel"); a fresh board follows the card */
  const kind = board?.kind === 'video' ? 'video' : ['static', 'carousel'].includes(board?.kind) ? 'image' : VIDEO_RE.test(card.cta?.label || '') || VIDEO_RE.test(card.title || '') ? 'video' : 'image';
  const okPeople = (s) => !blockOf(s, ctx);
  /* a brand that sells by enquiry (services, property) opens on places and moments, never marketplace or product-hero styles */
  const R = enquiry && BY_RECIPE[board?.recipe]?.set ? { set: ['in-use', 'editorial', 'natural', 'flat-lay'], sizes: BY_RECIPE[board.recipe].sizes } : BY_RECIPE[board?.recipe] || {};
  if (R.set) { const set = R.set.map(styleOf).filter(Boolean).filter(okPeople);
    if (set.length < 3) set.push(...ALL().filter((s) => s.kind === 'image' && s.groupId === 'product-shot' && okPeople(s) && !set.some((x) => x.id === s.id)).slice(0, 3 - set.length));
    return { kind: 'image', set: set.map((x) => x.id), styles: set.map((x) => x.id), style: set[0]?.id || null, product: ctx.product ? { img: ctx.product.img, name: ctx.product.name || null, handle: ctx.product.handle || null } : null,
      sizes: R.sizes || [board?.size && SIZES[board.size] ? board.size : 'ig-portrait'], seconds: null, count: set.length, blocked: blockedFor(ctx) }; }
  let picks;
  if (R.picks) picks = R.picks;
  else if (kind === 'video' && ctx.ref?.video) picks = ctx.ref.own ? ['recreate-swap', 'viral-short', 'ugc-review'] : ['viral-short', 'tt-hook', 'ugc-review']; /* someone else's video: a short in its pattern with our cast, never their footage; our own video can be recreated */
  else if (kind === 'video') picks = /\b(reviews?|testimonials?|ugc|creators?|unbox\w*|haul)\b(?! ready)/i.test(text.replace(/ready to review/i, '')) ? ['ugc-review', 'ugc-unbox', 'hypermotion'] : /\bhow to\b|tutorial|routine|\bguide\b/i.test(text) ? ['ugc-tutorial', 'in-life', 'showcase'] : /tiktok|trend|viral|hook/i.test(text) ? ['tt-hook', 'tt-pov', 'hypermotion'] : ['in-life', 'ugc-home', 'showcase'];
  else {
    const grp = /\bvs\b|versus|compare|switch|rival|instead of|than /i.test(text) ? 'Compare & Switch' : /\b(reviews|customer review|stars?|rated|loved|testimonials?)\b/i.test(text) ? 'Social Proof' : /problem|fix|tired of|cold|pain|struggle/i.test(text) ? 'Problem Solved' : /spec|ingredient|feature|why it works|benefit/i.test(text) ? 'Proof & Specs' : 'Hero Spotlight';
    const ad = HFSTYLES.find((p) => p.group === grp); const mp = /amazon|flipkart|marketplace|listing|nykaa|myntra/i.test(text);
    picks = enquiry ? ['in-use', 'editorial', 'natural'] : mp ? ['mp-main', 'mp-lifestyle', 'mp-benefits'] : /offer|sale|% off|deal|discount|bundle|free shipping/i.test(text) ? ['in-use', ad ? `hf:${ad.id}` : 'color-pop', 'offer-card'] : /gift|holiday|christmas|diwali|valentine/i.test(text) ? ['gift', 'in-use', ad ? `hf:${ad.id}` : 'flat-lay'] : ['in-use', ad ? `hf:${ad.id}` : 'closeup', 'color-pop'];
  }
  picks = picks.map(styleOf).filter(Boolean).filter(okPeople);
  if (picks.length < 3) picks.push(...ALL().filter((s) => s.kind === kind && okPeople(s) && !picks.some((p) => p.id === s.id)).slice(0, 3 - picks.length));
  const sizes = R.sizes || (kind === 'video' ? ['story'] : picks[0]?.ratio === '1:1' ? ['ig-square'] : [board?.size && SIZES[board.size] ? board.size : 'ig-portrait']);
  return { kind, styles: picks.slice(0, 3).map((s) => s.id), style: picks[0]?.id || null, product: ctx.product ? { img: ctx.product.img, name: ctx.product.name || null, handle: ctx.product.handle || null } : null,
    sizes, seconds: kind === 'video' ? R.seconds || picks[0]?.seconds || 10 : null, count: countOf(card), blocked: blockedFor(ctx) };
}

/* who may appear in a film: an everyday customer, never shown as a doctor, dermatologist, scientist or other expert (an AI person
   in a lab coat is a fake endorsement: Arata 24 Oct, a viral short copied a real dermatologist's post with an AI one), unless the
   Brand Book holds the brand's own, consented expert */
const NO_EXPERT = 'Everyone on camera is an everyday customer: no doctor, dermatologist, scientist, pharmacist or other expert, no lab coat, scrubs, clinic or laboratory, and nobody presented as a professional or as endorsing the product.';
/* the saved cast's own photos go to the film maker with the product's, so the same face is in every film (a text note alone gave a new face each time) */
const castRefs = (ctx, spec = {}, pub = (u) => u) => { const c = (ctx.bbv?.cast || []).find((x) => x && spec.cast && (x.id === spec.cast || x.label === spec.cast || String(spec.cast).startsWith(x.label || '\u0000'))); return (c?.refs || []).slice(0, 2).map((u) => pub(u)).filter(Boolean); };
/* the language the brand speaks to its buyers (its Brand Book tone), so a film for a Hindi-first brand isn't in English */
const spokeIn = (ctx) => { const l = String(ctx.bbv?.tone?.language || '').trim(); return l && !/^english\b/i.test(l) ? `Spoken in ${l.replace(/[.]+$/, '')}, the way the brand's buyers talk.` : ''; };
const expertOk = (ctx) => (ctx.bbv?.cast || []).some((c) => c.kind === 'real' && (c.refs || c.photos || []).length && /doctor|dermatolog|expert|scientist|pharmacist|trichologist/i.test(`${c.label || ''}`)); /* a real, consented expert with their own photos; a founder is no expert */
/* what is said in a film: a claim the store doesn't make is taken out before the model ever hears it */
const sayable = (line, ctx) => { const flags = claimFlags(line, ctx.source || ''); if (!flags.length) return line; let out = line; for (const f of flags) out = out.split(/(?<=[.!?])\s+/).filter((sn) => !sn.toLowerCase().includes(String(f.phrase).toLowerCase())).join(' '); return out.replace(/\b(dermatologist|doctor)[- ](approved|recommended|tested)\b/gi, '').replace(/\s{2,}/g, ' ').trim(); };
export function createStudio({ engines, maker, profileOf = async () => null, isMock = () => false, spend = () => true, finish = null, log = console }) {
  /* a film made ready to post (video-finish.js): spoken words as captions (an .srt, and burned in for muted feeds), a cover with the
     headline, a looping GIF for a short silent clip. Local and nearly free; a step that can't run leaves the film as it is and says why */
  async function finishFilm(take, { words = {}, line = '', spoken = false, loop = false } = {}) {
    if (!finish || !take.file) return; const f = await maker.fileOf(take.file).catch(() => null); if (!f || !fs.existsSync(f)) return; const buf = fs.readFileSync(f), out = {};
    if (spoken) { const c = await finish.captions(buf, { script: line }).catch((e) => ({ segs: [], error: e.message }));
      out.captions = { n: c.segs.length, approx: !!c.approx, none: c.none || null, error: c.error || null, segs: c.segs.slice(0, 160) }; /* every line of a 30 s or longer film, so a rebuilt .srt is whole */
      if (c.segs.length) { out.srt = engines.keep(Buffer.from(srtOf(c.segs)), 'srt'); const burned = await finish.burn(buf, c.segs).catch(() => null); if (burned) { out.raw = take.file; out.file = engines.keep(burned, 'mp4'); } else out.captions.error = 'The captions couldn’t be set in the film; the .srt has them.'; } }
    const cv = await finish.cover(buf, { headline: words.headline || '' }).catch(() => null); if (cv) { out.cover = engines.keep(cv.cover, 'jpg'); out.poster = take.poster || engines.keep(cv.frame, 'jpg'); }
    if (loop) { const g = await finish.gif(buf, { seconds: 3 }).catch(() => null); if (g) out.gif = engines.keep(g.gif, 'gif'); }
    Object.assign(take, out); }
  const hf = engines.hf, cr = maker.creative;
  /* the product's profile (read once, kept): the facts every prompt carries */
  const ensureProfile = async (ctx) => { if (ctx.product?.img && ctx.profile === undefined) ctx.profile = await profileOf(ctx.slug, cr.productEntry(ctx)).catch(() => null); return ctx.profile || null; };
  const sizeOf = (k) => (Object.hasOwn(SIZES, k) ? { key: k, ...SIZES[k] } : { key: 'ig-portrait', ...SIZES['ig-portrait'] });
  /* how a drawn picture sits on a frame: cover when the shapes match (within 4%), else whole ("contain") on the colour of its own edges */
  async function fitOf(src, size) {
    try { const sharp = (await import('sharp')).default, f = await maker.fileOf(src), m = await sharp(f).metadata(), r = (m.width / m.height) / (size.w / size.h);
      if (Math.abs(Math.log(r)) < 0.04) return { fit: 'cover' };
      const edge = await sharp(f).resize(8, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer(), px = []; for (let k = 0; k < 64; k++) if (k < 8 || k >= 56 || k % 8 === 0 || k % 8 === 7) px.push(k);
      const c = [0, 1, 2].map((ch) => Math.round(px.reduce((a, k) => a + edge[k * 3 + ch], 0) / px.length)); return { fit: 'contain', color: `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}` };
    } catch (e) { log.warn?.('[studio] fit', e.message); return { fit: 'contain', color: '#ffffff' }; } }
  /* the price of one take of a style (what Higgsfield will charge, plus the check), in dollars */
  async function perTake(ctx, st, size, seconds) {
    const shot = await engines.quote('still.shot', { slug: ctx.slug }).catch(() => ({ usd: 0.14 }));
    if (st.job === 'packshot') { const q = await engines.quote('cutout', { slug: ctx.slug }).catch(() => null); return +(q?.usd || 0); } /* the real photo cut out and set on white: free on Brew's own cut-out, the paid one's price when that is what runs */
    if (st.job === 'product-shot') return (shot.usd ?? 0.14) * 1.5 * (ctx.tier === 'premium' ? 2 : ctx.tier === 'preview' ? 0.3 : 1); /* Flare 4K ≈ 2× 2K; 1K preview ≈ 0.3× */ /* one take, a retry about half the time */
    if (st.job === 'type-poster' || st.job === 'brand-graphic') { const o = hf.pick(st.job); const e = await hf.estimate(o.id, { ...o.input, prompt: 'a poster with the brand offer in large type for a product ad', aspect_ratio: hf.nearestRatio(o.id, size.ratio) }); return (e.usd ?? 0.1) * 1.5; /* a retry about half the time */ }
    if (st.job === 'product-motion') { const o = hf.pick('product-motion', ctx.tier || 'default'); const e = await hf.estimate(o.id, { ...o.input, prompt: 'p', image_url: 'https://brew.joinsquareup.com/x.jpg', duration: seconds || 5 }); return (shot.usd ?? 0.14) * 1.5 + (e.usd ?? 0.11 * (seconds || 5)); }
    if (st.job === 'video-restyle') { const o = hf.pick('video-restyle'); const e = await hf.estimate(o.id, { ...o.input, prompt: 'p', video_url: ctx.ref?.video ? engines.pub(ctx.ref.video) : 'https://brew.joinsquareup.com/x.mp4', image_urls: [ctx.product?.img ? engines.pub(ctx.product.img) : 'https://brew.joinsquareup.com/x.jpg'] }); /* priced on the real reference: Higgsfield charges by its length */
      if (e.usd == null) { ctx.priceNote = 'Higgsfield couldn’t price this one exactly, so this is Brew’s estimate from its usual rate; the real charge can differ.'; return 0.25 * (seconds || 10); } return e.usd; }
    if (st.job === 'viral-short') { const o = hf.pick('viral-short', ctx.tier || 'default'); const e = await hf.estimate(o.id, { ...o.input, prompt: 'p', image_urls: ['https://brew.joinsquareup.com/x.jpg'], duration: Math.max(8, Math.min(30, seconds || 30)) }); return e.usd ?? 0.32 * Math.max(8, Math.min(30, seconds || 30)); } /* priced at the length it is made: a short is at least 8 s */
    if (st.job === 'ugc-video') { const o = hf.pick('ugc-video', ctx.tier || 'default'); const e = await hf.estimate(o.id, { ...o.input, prompt: 'p', image_urls: ['https://brew.joinsquareup.com/x.jpg'], duration: seconds || 10 }); return e.usd ?? 0.3 * (seconds || 10); }
    return 0.14;
  }
  /* the plan line and its price: what will be made, how many, at what cost */
  async function plan(ctx, spec) {
    if (spec.product?.img) ctx.product = { ...spec.product }; if (spec.quality) ctx.tier = spec.quality === 'premium' ? 'premium' : spec.quality === 'preview' ? 'preview' : null;
    if (Array.isArray(spec.set)) { const set = spec.set.map(styleOf).filter((x) => x && x.kind === 'image').slice(0, 10); if (set.length < (spec.fill ? 1 : 2)) return { error: spec.fill ? 'Nothing is missing.' : 'Pick at least two slides.' }; /* filling in left-out slides may be one */
      const no = set.map((x) => blockOf(x, ctx)).find(Boolean); if (no) return { error: no };
      const size = sizeOf(spec.sizes?.[0] || 'ig-portrait'), each = await Promise.all(set.map((x) => perTake(ctx, x, x.size ? sizeOf(x.size) : size))), usd = +each.reduce((a, b) => a + b, 0).toFixed(2), prod = spec.product?.name || ctx.product?.name;
      return { line: `${set.length} slides · ${set.map((x) => x.label).join(', ')}${prod ? ` · ${tidy(prod, 60)}` : ''} · ${size.label}`, usd, per: usd, count: 1, kind: 'image', set: set.map((x) => x.id) }; }
    const st = styleOf(spec.style); if (!st) return { error: 'Pick a style.' }; const no = blockOf(st, ctx); if (no) return { error: no };
    const secs = st.kind === 'video' ? (st.job === 'viral-short' ? Math.max(8, Math.min(30, +spec.seconds || st.seconds || 30)) : +spec.seconds || st.seconds || 10) : null; /* the same length the make runs, so the price is that film's */
    const size = sizeOf(spec.sizes?.[0] || (st.kind === 'video' ? 'story' : 'ig-portrait')), n = Math.max(1, Math.min(12, Math.floor(+spec.count || 1))), per = await perTake(ctx, st, size, secs);
    const usd = +(per * n).toFixed(2), prod = spec.product?.name || ctx.product?.name;
    /* a style that shows every side says so before anything is spent when no photo shows the back (it would be drawn by AI) */
    let note = null; if (st.allSides && ctx.product?.img) { const prof = await ensureProfile(ctx);
      if (prof && !(prof.sides || []).some((x) => /back/.test(x))) note = 'No photo shows its back yet, so the back would be drawn by AI. Add one in Brand Book → Products → Add photos.'; }
    const line = `${n > 1 ? `${n} ` : ''}${st.job === 'video-restyle' ? `the reference video, remade${n > 1 ? ` ×${n}` : ''}` : st.kind === 'video' ? `${secs} s ${st.group} video${n > 1 ? 's' : ''}` : `${st.group.toLowerCase()} picture${n > 1 ? 's' : ''}`} · ${st.label}${prod ? ` · ${tidy(prod, 60)}` : ''} · ${size.label}`;
    if (!note && ctx.priceNote) note = ctx.priceNote; /* a price Higgsfield couldn't give is said to be an estimate */
    return { line, usd, per: +per.toFixed(3), count: n, kind: st.kind, style: st.id, note };
  }

  /* one take for one board */
  async function make(ctx, board, spec, i = 0, opts = {}) {
    /* every Higgsfield request is written down the moment it is bought (opts.jobs, saved on the board): a restart picks the same
       request up again instead of buying a second one, and a request still running is never paid for twice */
    /* a job left open is picked up again only by the same ask (style, product, direction, cast, size, length, quality): a Redo that changed any of them buys its own */
    const ask = (() => { const x = JSON.stringify([spec.product?.name || null, spec.product?.img || null, spec.direction || null, spec.cast || null, spec.ref || null, spec.sizes || null, spec.seconds || null, spec.quality || null]); let h = 5381; for (let q = 0; q < x.length; q++) h = ((h << 5) + h + x.charCodeAt(q)) | 0; return (h >>> 0).toString(36); })();
    const runHF = async (step, id, input, o = {}) => { const k = `${spec.style}:${i}:${step}:${ask}`, J = opts.jobs || {};
      const k0 = `${spec.style}:${i}:${step}`; /* the key used before 24 Oct */
      try { const out = await hf.run(id, input, { ...o, resume: J[k] || J[k0] || null, onSubmit: (j) => { J[k] = j; return opts.save?.(); } }); delete J[k]; delete J[k0]; await opts.save?.()?.catch?.(() => {}); return out; }
      catch (e) { if (!e.open) { delete J[k]; await opts.save?.()?.catch?.(() => {}); } throw e; } };
    const st = styleOf(spec.style); if (!st) throw new Error('Pick a style.');
    const size = sizeOf(st.size || spec.sizes?.[0] || (st.kind === 'video' ? 'story' : 'ig-portrait')); /* an A+ module's own size wins */
    if (spec.product?.img) ctx.product = { ...spec.product };
    /* what the team set on the composer (the direction Brew wrote and they may have changed, who is on camera, the reference to
       follow, the quality) is what every maker below reads: the art direction, the shot, the film */
    const asks = [spec.direction ? `The direction for this piece (follow it): ${tidy(spec.direction, 600)}` : '', spec.cast ? `On camera: ${tidy(spec.cast, 160)}.` : '', spec.ref ? `Follow the idea and layout of the reference (${tidy(spec.ref, 120)}), never copy its brand, words or people.` : ''].filter(Boolean);
    if (asks.length && !ctx.asked) { ctx.notes = [...(ctx.notes || []), ...asks]; ctx.asked = true; } if (spec.quality) ctx.tier = spec.quality === 'premium' ? 'premium' : spec.quality === 'preview' ? 'preview' : null;
    const no = blockOf(st, ctx); if (no) throw new Error(no); /* the Brand Book may have changed since the price was shown */
    /* the first take carries the jam's own words (the headline and line the brand already has, checked and edited), so the picture
       and the copy say the same thing; later takes of a batch write their own hooks */
    const v1 = ctx.v1 || {}, mine = i === 0 && !spec.ask ? tidy(v1.headline || v1.overlay || v1.slides?.[0]?.onSlide || v1.heading || '', 90) : '';
    const words = mine ? { headline: mine, sub: tidy(String(v1.primaryText || v1.caption || v1.copy || v1.description || '').split(/\n|(?<=[.!?])\s/)[0], 120) || '', cta: v1.cta || '' } : await maker.write(ctx, board, { ask: spec.count > 1 ? `This is take ${i + 1} of ${spec.count}: a different hook and headline from the others${spec.ask ? `; ${spec.ask}` : ''}.` : spec.ask || '' }).catch(() => ({}));
    const made = [], take = { op: 'studio', by: ctx.by, words, made, studio: { style: st.id, label: st.label, group: st.group, kind: st.kind, size: size.key } };
    if (st.job === 'packshot') { /* a marketplace main image is the real product, never a drawing: cut out of its clearest photo, alone on pure white
         at 85% of the frame (Amazon, Flipkart, Nykaa, Myntra main-image rules); a photo that won't cut out cleanly is said so */
      await ensureProfile(ctx); if (ctx.profile?.usable === false) throw new Error(`No photo shows ${ctx.profile.name || 'this product'} clearly enough (${ctx.profile.why || 'add a clear product photo'}).`);
      const best = ctx.profile?.best || ctx.product?.img; if (!best) throw new Error('Pick a product with a photo first.');
      const cut = await maker.cutout({ ...ctx, product: { ...ctx.product, img: best } }); if (!cut || cut.raw) throw Object.assign(new Error('The product couldn’t be cut out of its photo cleanly. Add a photo of it on a plain background.'), { made });
      const sharp = (await import('sharp')).default, f = await maker.fileOf(cut.file), box = Math.round(Math.min(size.w, size.h) * 0.85);
      const prod = await sharp(fs.readFileSync(f)).resize(box, box, { fit: 'inside' }).toBuffer(), m = await sharp(prod).metadata();
      const buf = await sharp({ create: { width: size.w, height: size.h, channels: 3, background: '#ffffff' } }).composite([{ input: prod, left: Math.round((size.w - m.width) / 2), top: Math.round((size.h - m.height) / 2) }]).jpeg({ quality: 92 }).toBuffer();
      const file = engines.keep(buf, 'jpg'); made.push({ cap: 'cutout', provider: cut.provider || 'local', model: cut.model || 'cutout', usd: cut.usd || 0 });
      Object.assign(take, { file, scene: { w: size.w, h: size.h, bg: { color: '#ffffff', src: file }, layers: [] } });
    } else if (st.kind === 'image' && st.job === 'product-shot' && !st.preset && !st.designed) {
      const x = await cr.staticAd(ctx, board, words, size, { style: st, noWords: st.type === 'none' }); made.push(...x.made);
      if (!x.scene) throw Object.assign(new Error(x.fail || 'The picture didn’t come out right.'), { made }); /* what it spent still counts */
      /* a word-free picture whose shape is far from the frame's (an A+ 970×300 wide image from a 21:9 shot, a 3:1 banner) is fitted whole on its own edge colour, never cropped into the product */
      if (st.type === 'none' && x.scene?.bg?.src && !x.scene.layers?.length) { const ft = await fitOf(x.scene.bg.src, size); if (ft.fit === 'contain') { x.scene = { ...x.scene, bg: { ...x.scene.bg, ...ft } }; x.file = await maker.render(x.scene).catch(() => x.file); } }
      Object.assign(take, { scene: x.scene, file: x.file, shot: x.shot, direction: x.direction });
    } else if (st.preset || st.kind === 'image') { /* Higgsfield's designed ad style (Flare with its preset, the real product photo as image 1), or a
      type-led poster / illustration (Ideogram / Recraft): either way the model draws the words, so they are given exactly and read back */
      if (!spend('image', ctx.slug)) throw Object.assign(new Error('Today’s picture budget is used up.'), { budget: true });
      await ensureProfile(ctx); if ((st.preset || st.designed) && ctx.profile?.usable === false) throw new Error(`No photo shows ${ctx.profile.name || 'this product'} clearly enough (${ctx.profile.why || 'add a clear product photo'}).`);
      /* a review style quotes only a real customer review from the Brand Book (the writer's proof line may be a fact from the card) */
      /* only a review of this product (or one about the brand as a whole): another product's review is never quoted on this one */
      const low = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim(), pn = low(ctx.product?.name), same = (rp) => !!pn && !!low(rp) && (pn.includes(low(rp)) || low(rp).includes(pn));
      const rv = (ctx.bbv?.reviews || []).filter((r) => tidy(r?.text, 300)), ok = rv.filter((r) => same(r.product)), loose = rv.filter((r) => !low(r.product));
      const real = [...ok, ...loose].map((r) => tidy(r.text, 300));
      const said = (words.proof || []).map((q) => tidy(q, 300)).find((q) => q && real.some((r) => low(r).includes(low(q)))), forProduct = ok.length ? tidy(ok[0].text, 300) : null;
      const proof = [said || forProduct || real[0]].filter(Boolean), review = REVIEWISH(st) && proof.length;
      const claims = (ctx.bbv?.claims || []).map((c) => tidy(c.text || c, 60)).filter(Boolean).slice(0, 3); /* the only benefit callouts a designed piece may print */
      const market = st.groupId === 'marketplace'; /* a marketplace image carries no button, price or promotion (their rules) */
      const exact = [words.headline && `Headline: "${words.headline}"`, words.sub && `Line: "${words.sub}"`, review && `Customer review, word for word, with its stars: "${tidy(proof[0], 220)}"`, words.cta && !market && `Button: "${words.cta}"`].filter(Boolean).join('; ');
      const callouts = st.id === 'mp-benefits' ? (claims.length ? ` Benefit callouts, word for word: ${claims.map((c) => `"${c}"`).join(', ')}.` : ' No benefit callouts: the product and the headline only.') : '';
      const people = { none: ' No people and no hands anywhere in the picture.', hands: ' At most hands; no faces or bodies.', consented: ' No people; hands at most.' }[ctx.bbv?.comfort?.people] || (ctx.market && !ctx.market.guessed ? ` Any people are customers in ${ctx.market.name}.` : '');
      const rules = `The only words on the image: ${exact}${ctx.bbv?.name ? `, and the brand name ${ctx.bbv.name}` : ''}.${callouts} No other text: no sizes, numbers, prices, percentages, ingredients or claims.${review ? '' : ' Nothing styled as a customer review or star rating.'}${market ? ' No button, badge, price or call to action: this is a marketplace product image.' : ''}${people}`;
      /* a piece that shows the product (an ad style, a marketplace infographic or scale image) is drawn by Flare around the real
         product photos and must keep it; a type-led poster or an illustration (Ideogram / Recraft) carries no product */
      const showsProduct = !!(st.preset || st.designed), job = showsProduct ? 'product-shot' : st.job, o = hf.pick(job, ctx.tier || 'default'), photos = showsProduct ? cr.photosOf(ctx, ctx.profile).slice(0, st.preset ? 1 : 3).map((u) => engines.pub(u)) : [];
      const base = st.preset ? { ...o.input, enhance_prompt: true, preset_id: st.preset, quality: 'high', image_urls: photos, aspect_ratio: hf.nearestRatio(o.id, size.ratio) }
        : showsProduct ? { ...o.input, quality: 'high', image_urls: photos, aspect_ratio: hf.nearestRatio(o.id, size.ratio) } : { ...o.input, aspect_ratio: hf.nearestRatio(o.id, size.ratio) };
      const colours = (ctx.bbv?.kit?.colors || []).filter(Boolean), promptOf = (fix = '') => tidy([st.preset ? `An ad for ${ctx.bbv?.name || 'the brand'}.` : `${st.look} For ${ctx.bbv?.name || 'the brand'}${colours.length ? `, in its colours ${colours.join(', ')}` : ''}.`, showsProduct && photos.length ? 'The product is exactly the one in the reference photos: same shape, colours, label and count.' : '', cr.productLine(ctx.profile), spec.direction ? tidy(spec.direction, 600) : '', rules, fix].filter(Boolean).join(' '), st.preset ? 4800 : 2000);
      let file = null, check = null;
      for (let t = 0; t < 2 && !file; t++) {
        const input = { ...base, prompt: promptOf(t && check ? `The last one was wrong: ${check.same ? '' : 'the product changed. '}${check.invented.length ? `it added "${check.invented.join('", "')}" — leave those out.` : ''}` : '') };
        const e = await hf.estimate(o.id, input), out = await runHF(`designed${t}`, o.id, input); const f = engines.keep(out.buf, /jpe?g/.test(out.type) ? 'jpg' : 'png');
        made.push({ cap: st.preset ? 'still.styled' : 'still.graphic', provider: 'higgsfield', model: o.id, usd: e.usd ?? 0.1 });
        check = await cr.checkMade(ctx, f, { ...words, proof: review ? proof : [], claims }); made.push({ cap: 'check', provider: 'gemini', model: 'made-check', usd: check.usd || 0 });
        if ((check.same || !showsProduct) && !check.invented.length && !check.unchecked) file = f;
        else if (t === 0 && !spend('image', ctx.slug)) break; }
      if (!file) { const why = [photos.length && check?.same === false ? 'changed the product' : '', check?.invented?.length ? `added words we can’t back up (${check.invented.join(', ')})` : '', check?.unchecked ? 'couldn’t be read back to check it' : ''].filter(Boolean).join(' and ') || 'didn’t pass its check';
        const err = new Error(`The ${st.label} picture ${why}, twice, so it isn’t shown. Try another style.`); err.made = made; throw err; }
      /* the drawn piece set on the placement's exact frame: a model frame that differs (A5 print, a 3:1 banner) is fitted whole on its
         own edge colour, never cropped (its words are in the picture) */
      const scene = { w: size.w, h: size.h, bg: { src: file, ...(await fitOf(file, size)) }, layers: [] };
      Object.assign(take, { file: await maker.render(scene), drawn: file, scene, check: { words: check.words, unchecked: false } });
    } else if (st.job === 'product-motion') { /* a checked product shot (the style's look, no words), then Kling moves it */
      if (!spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true }); /* before the first frame is paid for */
      const shot = await cr.staticAd(ctx, board, words, size, { style: { ...st, people: 'none' }, noWords: true }); made.push(...shot.made); if (!shot.shot) throw Object.assign(new Error(shot.fail || 'The first frame didn’t keep the product.'), { made });
      const o = hf.pick('product-motion', ctx.tier || 'default'), input = { ...o.input, prompt: tidy(`${st.look} ${cr.productLine(ctx.profile)} Nothing new appears; no text.`, 2400), image_url: engines.pub(shot.shot.file), duration: +spec.seconds || st.seconds || 5 };
      const e = await hf.estimate(o.id, input), out = await runHF('motion', o.id, input, { maxMs: 20 * 60e3 }); const file = engines.keep(await finishVideo(out.buf, size, log), 'mp4'); made.push({ cap: 'video.motion', provider: 'higgsfield', model: o.id, usd: e.usd ?? 0.55 });
      Object.assign(take, { file, poster: shot.shot.file, shot: shot.shot });
      await finishFilm(take, { words, loop: true }).catch((e) => log.warn?.('[studio] finish', e.message)); /* silent: a cover and a GIF */
    } else if (st.job === 'video-restyle') { /* Recreate (Ad Multiplier): the reference video as it is, our product swapped in (Genjutsu object swap) */
      if (!spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true }); await ensureProfile(ctx);
      const photos = cr.photosOf(ctx, ctx.profile).slice(0, 4).map((u) => engines.pub(u)), o = hf.pick('video-restyle'), ref = engines.pub(ctx.ref.video);
      const input = { ...o.input, prompt: tidy([st.look, ctx.product?.name ? `Our product: ${ctx.product.name}. ${cr.productLine(ctx.profile)}` : '', spec.direction || ''].filter(Boolean).join(' '), 2400), video_url: ref, image_urls: photos };
      const e = await hf.estimate(o.id, input), out = await runHF('swap', o.id, input, { maxMs: 25 * 60e3 }).catch((err) => { if (err.moderated || /nsfw|content safety/i.test(err.message)) throw Object.assign(new Error('Higgsfield’s safety filter refused this reference video (footage with skin, showers or close-ups often trips it). Nothing was charged. Try the Viral short instead: it follows the same shots without sending their footage.'), { moderated: true, plain: true, made }); throw err; }); const file = engines.keep(await finishVideo(out.buf, size, log), 'mp4'); made.push({ cap: 'video.swap', provider: 'higgsfield', model: o.id, usd: e.usd ?? 2.5 });
      Object.assign(take, { file, recreated: { from: ctx.ref.url || null, by: ctx.ref.author || ctx.ref.brand || null } });
      await finishFilm(take, { words, spoken: true }).catch((e2) => log.warn?.('[studio] finish', e2.message)); /* captions from what is said in it, a cover */
    } else if (st.job === 'viral-short') { /* a viral-style short: several shots, up to 30 s, in the pattern of the reference when there is one */
      if (!spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true }); await ensureProfile(ctx);
      const photos = cr.photosOf(ctx, ctx.profile).map((u) => engines.pub(u)), o = hf.pick('viral-short', ctx.tier || 'default'), secs = Math.max(8, Math.min(30, +spec.seconds || st.seconds || 30));
      const beats = (ctx.ref?.beats || []).slice(0, 6).map((b, k) => `${k + 1}) ${tidy(b.shot || '', 120)}`).join(' '), line = sayable(tidy([words.headline, words.sub].filter(Boolean).join(' '), 260), ctx);
      if (!expertOk(ctx) && !(ctx.notes || []).includes(NO_EXPERT)) ctx.notes = [...(ctx.notes || []), NO_EXPERT]; /* the art direction never casts an expert */
      const d = await cr.direct(ctx, board, words, size, { ...st, people: 'person' }, { film: true }).catch(() => null);
      const input = { ...o.input, prompt: tidy([st.look, beats ? `Follow this shot pattern from a video that went viral, with our product and our people: ${beats}. Only the pattern: our own words, our own people and place, nothing they said or showed on screen.` : 'Shots: 1) the hook, a problem in one second; 2) the product in use; 3) the result; 4) the reason to buy; 5) an ending that loops.', d?.moment ? `Who and where: ${d.moment}` : '', ctx.product?.name ? `The product (exactly as in the reference photos): ${ctx.product.name}. ${cr.productLine(ctx.profile)}` : '', line ? `What is said: "${line}"` : '', spokeIn(ctx), spec.direction || '', expertOk(ctx) ? '' : NO_EXPERT, 'Vertical phone video, natural light, no on-screen text.'].filter(Boolean).join(' '), 4000),
        image_urls: [...photos.slice(0, 3), ...castRefs(ctx, spec, engines.pub)].slice(0, 5), duration: secs, aspect_ratio: hf.nearestRatio(o.id, size.ratio) };
      const e = await hf.estimate(o.id, input), out = await runHF('short', o.id, input, { maxMs: 30 * 60e3 }); const file = engines.keep(await finishVideo(out.buf, size, log), 'mp4'); made.push({ cap: 'video.short', provider: 'higgsfield', model: o.id, usd: e.usd ?? 0.32 * secs });
      Object.assign(take, { file, pattern: beats ? (ctx.ref?.url || 'the reference') : null });
      await finishFilm(take, { words, line, spoken: true }).catch((e2) => log.warn?.('[studio] finish', e2.message));
    } else { /* UGC / TikTok: a person with the real product, talking, Seedance with the product photos as references */
      if (!spend('video', ctx.slug)) throw Object.assign(new Error('Today’s video budget is used up.'), { budget: true }); await ensureProfile(ctx);
      const photos = cr.photosOf(ctx, ctx.profile).map((u) => engines.pub(u)), o = hf.pick('ugc-video', ctx.tier || 'default'), line = sayable(tidy([words.headline, words.sub].filter(Boolean).join(' '), 220), ctx);
      /* the same art direction as a photo: the brand's market, cast, places and taste decide who is on camera and where (23 Oct, Arata:
         the look alone gave a Western presenter for an Indian hair brand) */
      if (!expertOk(ctx) && !(ctx.notes || []).includes(NO_EXPERT)) ctx.notes = [...(ctx.notes || []), NO_EXPERT]; /* the art direction never casts an expert */
      const d = await cr.direct(ctx, board, words, size, { ...st, people: 'person' }, { film: true }).catch(() => null);
      const input = { ...o.input, prompt: tidy([st.look, d?.moment ? `Who, where and how: ${d.moment}` : '', ctx.product?.name ? `The product (exactly as in the reference photos): ${ctx.product.name}. ${cr.productLine(ctx.profile)}` : '', st.says && line ? `They say: "${line}"` : '', spokeIn(ctx), spec.direction || '' /* the brand's own direction, as on the composer */, expertOk(ctx) ? '' : NO_EXPERT, 'Vertical phone video, natural light, real person, no on-screen text.'].filter(Boolean).join(' '), 2400),
        image_urls: [...photos.slice(0, 3), ...castRefs(ctx, spec, engines.pub)].slice(0, 5), duration: +spec.seconds || st.seconds || 10, aspect_ratio: hf.nearestRatio(o.id, size.ratio) };
      const e = await hf.estimate(o.id, input), out = await runHF('ugc', o.id, input, { maxMs: 25 * 60e3 }); const file = engines.keep(await finishVideo(out.buf, size, log), 'mp4'); made.push({ cap: 'video.ugc', provider: 'higgsfield', model: o.id, usd: e.usd ?? 3 });
      Object.assign(take, { file });
      await finishFilm(take, { words, line: st.says ? line : '', spoken: true }).catch((e) => log.warn?.('[studio] finish', e.message)); /* captions from what is really said, a cover */
    }
    take.cost = { usd: +made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(3), credits: 0 };
    return take;
  }
  /* a set (carousel, stories, listing, product page set, photoshoot): one take per slide in its own style, all on one board as slides;
     each slide's words follow on from the others. A slide that fails is left out and named; the rest stand */
  async function makeSet(ctx, board, spec, opts = {}) {
    const set = (spec.set || []).map(styleOf).filter((x) => x && x.kind === 'image').slice(0, 10), labels = set.map((x) => x.label).join(', '), slides = [], made = [], missing = [], missingIds = [];
    /* each finished slide is written down on the board the moment it lands (opts.jobs, saved with the jam): a set a restart cuts
       off picks up at the next slide, never buying the slides it already made (23 Oct, a deploy mid-set). The run's key is its
       set-up and the board's take count, so a later Redo of the same set never reuses this run's slides */
    const J = opts.jobs || {}, runKey = `set:${board.takes?.length || 0}:${set.map((x) => x.id).join(',')}:${tidy(spec.product?.img || '', 80)}`;
    for (let i = 0; i < set.length; i++) {
      const kept = J[`${runKey}:${i}`]; if (kept?.slide) { slides.push(kept.slide); continue; } /* made before the restart: paid for once */
      try { const t = await make(ctx, board, { ...spec, set: null, style: set[i].id, count: 1, ask: [`Slide ${i + 1} of ${set.length} of one ${tidy(board.label, 40) || 'carousel'} (${labels}): its own short line that builds on the slides before it${i === 0 ? '; this one is the cover, the hook' : i === set.length - 1 ? '; this one closes with the reason to buy' : ''}.`, spec.ask].filter(Boolean).join(' ') }, i, opts);
        made.push(...(t.made || [])); const slide = { scene: t.scene, file: t.file, style: set[i].id, words: t.words, shot: t.shot || null, drawn: t.drawn || null }; slides.push(slide);
        J[`${runKey}:${i}`] = { slide, at: Date.now() }; await Promise.resolve(opts.save?.()).catch(() => {}); }
      catch (e) { made.push(...(e.made || [])); missing.push(`${set[i].label}: ${tidy(e.message, 120)}`); missingIds.push(set[i].id); log.warn?.('[studio] slide', set[i].id, e.message); } }
    if (!slides.length) { const err = new Error(missing[0] || 'No slide came out right.'); err.made = made; throw err; }
    for (const k of Object.keys(J)) if (k.startsWith(`${runKey}:`)) delete J[k]; /* the take carries them now (saved with it) */
    return { op: 'studio', by: ctx.by, words: slides[0].words, slides, file: slides[0].file, scene: slides[0].scene, made, missing, missingIds, studio: { set: slides.map((x) => x.style), label: labels, kind: 'image', size: spec.sizes?.[0] || null },
      cost: { usd: +made.reduce((a, m) => a + (m.usd || 0), 0).toFixed(3), credits: 0 } };
  }
  /* a free first look (3.4): Brew's words for this set-up laid over the real product photo in the brand's colours, rendered here,
     and for a video its shot list. No picture or video model runs, so nothing is charged; Generate makes the real one */
  async function sketch(ctx, spec) {
    if (spec.product?.img) ctx.product = { ...spec.product }; const st = styleOf(spec.style), video = st?.kind === 'video' || spec.kind === 'video';
    if (spec.direction && !ctx.asked) { ctx.notes = [...(ctx.notes || []), `The direction for this piece (follow it): ${tidy(spec.direction, 600)}`]; ctx.asked = true; }
    const words = await maker.write(ctx, { recipe: video ? 'reel' : 'image-ad' }, { ask: spec.ask || '' }).catch(() => ({}));
    const size = sizeOf(spec.sizes?.[0] || (video ? 'story' : 'ig-portrait')), img = ctx.product?.img || null;
    const scene = maker.composeScene({ size, bgFile: null, cut: img ? { file: img } : null, words, kit: ctx.bbv?.kit || {} });
    const file = await maker.render(scene).catch((e) => { log.warn?.('[studio] sketch render', e.message); return null; });
    const flags = claimFlags([words.headline, words.sub, ...(words.shots || []).map((x) => `${x.vo || ''} ${x.words || ''}`)].join(' '), ctx.source || '').map((f) => f.phrase).filter(Boolean);
    return { file, headline: words.headline || '', sub: words.sub || '', shots: video ? (words.shots || []).slice(0, 8).map((x) => ({ sec: +x.sec || 4, see: tidy(x.see, 200), vo: tidy(x.vo, 200) })) : [], flags, usd: 0 };
  }
  return { library, defaults, plan, make, makeSet, sketch, styleOf, countOf };
}
