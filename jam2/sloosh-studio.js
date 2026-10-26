// Studio's makers on Sloosh (27 Oct): the same small surface the Higgsfield helper had (pick, estimate, run, nearestRatio), so every
// Studio style and engine job runs on Sloosh without rewriting each branch. A job names what is made; sloosh-make.js picks the model
// from Sloosh's live list. Higgsfield's preset ad styles stay as references only: a preset's own example ad (its cover) goes to Sloosh
// as the layout to follow, with our product, colours and words.
import { makersNow } from '../media.js';

/* what one take costs in dollars, for the price on the button (Sloosh credits at about $0.09 each; the ledger records the real
   credits). Pictures ≈ 2 credits at 2K, 4 at 4K; video ≈ 3.5 credits a second at 720p, 7 at 1080p */
const CREDIT_USD = 0.09;
const USD = { image: 2 * CREDIT_USD, imageFinal: 4 * CREDIT_USD, videoSecond: 3.5 * CREDIT_USD, videoSecondFinal: 7 * CREDIT_USD };
const VIDEO = new Set(['product-motion', 'video-restyle', 'viral-short', 'ugc-video']);

export function createSlooshStudio({ makers = makersNow, log = console } = {}) {
  const m = () => { const x = makers(); if (!x?.image) throw Object.assign(new Error('Sloosh is not connected here, so nothing was made or charged.'), { soft: true }); return x; };
  const live = () => !!makers()?.image;
  /* a job and its tier: premium is the final tier (4K / 1080p), preview and default the draft tier */
  const pick = (job, tier = 'default') => (job ? { id: `sloosh:${job}`, job, label: job, input: { job, tier: tier === 'premium' ? 'final' : 'draft' } } : null);
  const nearestRatio = (id, want) => want;
  async function estimate(id, input = {}) {
    const job = String(id).replace(/^sloosh:/, ''), fin = input.tier === 'final' || input.job && input.tier === 'final';
    if (!VIDEO.has(job)) return { usd: +(fin ? USD.imageFinal : USD.image).toFixed(2), model: 'sloosh' };
    const secs = Math.max(4, +input.duration || 8); return { usd: +(secs * (fin ? USD.videoSecondFinal : USD.videoSecond)).toFixed(2), model: 'sloosh' };
  }
  /* input: what Studio sends (prompt, image_urls / image_url, video_url, aspect_ratio, duration, cover, slug) → { buf, type } */
  async function run(id, input = {}) {
    const job = String(id).replace(/^sloosh:/, ''), M = m(), tier = input.tier || 'draft', slug = input.slug || null;
    const urls = [...(input.image_urls || []), input.image_url].filter(Boolean);
    const refs = urls.map((u, i) => ({ src: u, job: i === 0 ? 'product' : 'product', label: i === 0 ? 'the product' : `the product, another view` }));
    if (input.cast_urls?.length) refs.push(...input.cast_urls.map((u) => ({ src: u, job: 'person', label: 'the person on camera' })));
    /* a Higgsfield preset (or any style with an example ad): its example is the layout and idea to follow, never its product or words */
    if (input.cover) refs.push({ src: input.cover, job: 'style', label: 'the ad style to follow', keep: 'follow its layout, type placement, energy and idea; use our product, our brand colours and our words, never its product, brand or text' });
    let buf;
    if (job === 'product-motion') buf = await M.video({ slug, frame: input.image_url || urls[0], prompt: input.prompt, ratio: input.aspect_ratio || '9:16', seconds: +input.duration || 5, sound: !!input.sound, tier, brand: false, path: 'studio:motion' });
    else if (job === 'video-restyle') buf = await M.editVideo({ slug, src: input.video_url, instruction: input.prompt, refs: refs.filter((r) => r.job === 'product'), tier, path: 'studio:recreate' });
    else if (job === 'viral-short' || job === 'ugc-video') buf = await M.video({ slug, prompt: input.prompt, refs, ratio: input.aspect_ratio || '9:16', seconds: +input.duration || 10, sound: true, tier, brand: false, path: `studio:${job}` });
    else buf = await M.image({ slug, prompt: input.prompt, refs: job === 'type-poster' || job === 'brand-graphic' ? refs.filter((r) => r.job !== 'product') : refs, ratio: input.aspect_ratio || '4:5', job: job === 'type-poster' || job === 'brand-graphic' ? 'type' : 'image', tier, brand: false, path: `studio:${job}` });
    return { buf, type: VIDEO.has(job) ? 'video/mp4' : 'image/png', id: buf.generationId || null, provider: 'sloosh', model: buf.model || 'sloosh' };
  }
  return { live, pick, estimate, run, nearestRatio, workflow: () => ({ schema: {} }), fitInput: (id, input) => ({ input, problems: [] }), catalog: [], routes: { jobs: {} } };
}
