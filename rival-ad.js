// "Make our version" of a rival's ad. A rival ad card (research.kind 'ad', from the Meta Ad Library read in research.js)
// is remade in two steps, for every brand:
//   1. read the creative itself (the poster image, and the clip when it is a video ad and the AI can watch video): its
//      format, the hook and how it is built, the layout, the look, the words set on the image and where they sit, the beats
//      of a video, and what makes it work. One cheap vision call, kept per ad on this instance.
//   2. write and draw ours on the same angle, hook pattern, format, layout and look, with the brand's own product and only
//      the brand's facts. The rival's picture goes to the image model as a style reference (image 2), never as our product:
//      the product photo is always the brand's own (image 1), and the image guard still checks it.
// Nothing of theirs is copied as is: not their brand name, product, logo, faces, claims, numbers or sentences.
import fs from 'node:fs';
import { kindOf, mimeOf, RASTER } from './img-norm.js';

/* a research picture (a rival's poster or clip) is never a product photo of ours */
export const isResearchImage = (rel) => /^\/?research\//.test(String(rel || '')) || /(^|\/)b\/[a-z0-9-]+\/a\/ad-[^/]+$/.test(String(rel || '').split('?')[0]); /* the read's own Ad Library posters (b/<slug>/a/ad-<id>.jpg) too */
export const isRivalCard = (c) => c?.research?.kind === 'ad' || !!c?.research?.ad; /* a rival's ad card, or a card built on one (a how-to that tests its angle) */

export const STYLE_SCHEMA = { type: 'object', required: ['format', 'hookPattern', 'layout', 'look', 'words', 'beats', 'works'], properties: {
  format: { type: 'string', description: 'What kind of creative it is, in a few words: a studio product photo with a headline, a lifestyle photo, a flat graphic with an offer badge, a UGC selfie video, a demo video, a before-you-buy comparison, a carousel' },
  hookPattern: { type: 'string', description: 'How the hook is built, without the rival\'s words: e.g. "names a daily pain, then the fix", "a question the buyer asks", "a number of happy buyers", "price drop in the first line"' },
  layout: { type: 'string', description: 'One or two sentences: where the product sits and how big, the crop, the background, where people or hands are, where the words sit (top third, bottom band, over the product)' },
  look: { type: 'string', description: 'One or two sentences as things you can see: light, colours, photo or graphic, props, surface, mood of the setting' },
  words: { type: 'array', description: 'The words set ON the image, in reading order (empty when there are none)', items: { type: 'object', required: ['role', 'where', 'lettering'], properties: {
    role: { type: 'string', enum: ['headline', 'subline', 'badge', 'price', 'button', 'other'] },
    where: { type: 'string', description: 'Where it sits, e.g. "top third, centred", "a pill in the top-left corner", "bottom band"' },
    lettering: { type: 'string', description: 'The lettering, e.g. "bold white sans-serif", "handwritten black", "yellow sticker"' },
    words: { type: 'number', description: 'How many words it has' } } } },
  beats: { type: 'array', items: { type: 'string' }, description: 'A video ad only: 3 to 5 beats in order, each one short sentence on what is seen and said; empty for a still' },
  works: { type: 'array', items: { type: 'string' }, description: '3 to 5 things that make this ad work and that our version should copy (structure, framing, proof, pacing), never the rival\'s product or claims' }
} };

const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const MAX_VIDEO = 15 * 1024 * 1024; // a clip the AI can watch inline; bigger ones are read from their first frame

/* the read, kept per ad id on this instance (a second jam on the same ad reads nothing again) */
const READS = new Map();
export function forgetRivalReads() { READS.clear(); }

/* call(content, schema, max, name) → JSON: the jam's structured call (claudeTool), which takes text and image parts.
   fileOf(rel) → a local file for a research path (this instance's disk or the bucket's copy), or null */
export async function readRivalAd(ad, { call, fileOf = async () => null, video = process.env.AI_PROVIDER !== 'anthropic', log = console } = {}) {
  if (!ad?.id || !call) return null;
  if (ad.style?.layout) return ad.style;
  if (READS.has(ad.id)) return READS.get(ad.id);
  const ask = (watched) => ({ type: 'text', text: `This is a live Meta ad by ${ad.brand} (${ad.format || 'image'} ad${ad.days ? `, live ${ad.days} days` : ''}${ad.versions ? ` in ${ad.versions} version${ad.versions > 1 ? 's' : ''}` : ''}).
Its copy: headline "${one(ad.headline)}"; text "${one(ad.body).slice(0, 500)}"; button "${one(ad.cta)}".
${watched ? 'You are watching the clip itself.' : 'You see its picture (for a video ad, its first frame).'} Read how this creative is MADE, so another brand can make its own ad in the same style with its own product. Describe what you see, not what you guess. Never quote the rival's words in hookPattern, layout or look.` });
  const shape = (j, from) => ({ format: one(j.format), hookPattern: one(j.hookPattern), layout: one(j.layout), look: one(j.look), beats: (j.beats || []).map(one).filter(Boolean).slice(0, 5), works: (j.works || []).map(one).filter(Boolean).slice(0, 5),
    words: (j.words || []).filter((w) => w?.where).slice(0, 4).map((w) => ({ role: w.role || 'other', where: one(w.where), lettering: one(w.lettering), words: +w.words || null })), from });
  const posterPart = async () => { if (!ad.poster) return null; try { const f = await fileOf(ad.poster); if (!f) return null; const b = fs.readFileSync(f); return RASTER.has(kindOf(b)) ? { type: 'image', source: { type: 'base64', media_type: mimeOf(b), data: b.toString('base64') } } : null; } catch (e) { log.warn?.('[rival-ad] poster', e.message); return null; } };
  const p = (async () => {
    /* the clip when the AI can watch it; a clip that can't be read (too big, refused) falls back to the poster, so a video ad is never left unread */
    if (video && ad.video) { try { const f = await fileOf(ad.video); const st = f && fs.statSync(f);
        if (st && st.size <= MAX_VIDEO) return shape(await call([{ type: 'document', source: { type: 'base64', media_type: 'video/mp4', data: fs.readFileSync(f).toString('base64') } }, ask(true)], STYLE_SCHEMA, 1500, 'rival_style'), 'video'); }
      catch (e) { log.warn?.('[rival-ad] clip read, trying the poster', e.message); } }
    const pp = await posterPart(); if (!pp) return null; /* nothing to look at: the remake works from the copy alone */
    return shape(await call([pp, ask(false)], STYLE_SCHEMA, 1500, 'rival_style'), 'poster');
  })().catch((e) => { READS.delete(ad.id); log.warn?.('[rival-ad] read', e.message); return null; });
  READS.set(ad.id, p);
  return p;
}

/* the block every writer gets (the studio's packages, the jam's drafts): the rival ad, how it is made, and the rule */
export function rivalBlock(ad, style, brand) {
  if (!ad) return '';
  const made = style ? [
    `Format: ${style.format}.`, `Hook pattern: ${style.hookPattern}.`, `Layout: ${style.layout}`, `Look: ${style.look}`,
    style.words?.length ? `Words on the image: ${style.words.map((w) => `${w.role} (${w.words ? `${w.words} words, ` : ''}${w.lettering}, ${w.where})`).join('; ')}.` : 'No words on the image.',
    style.beats?.length ? `Beats: ${style.beats.map((b, i) => `${i + 1}. ${b}`).join(' ')}` : '',
    style.works?.length ? `What makes it work: ${style.works.join('; ')}.` : ''
  ].filter(Boolean).join('\n') : `Format: ${ad.format || 'image'} ad.${ad.angle ? ` Angle: ${ad.angle}.` : ''}`;
  return `THE RIVAL AD TO REMAKE (this card is ${ad.brand}'s live ad, ${ad.days || '?'} days live in ${ad.versions || 1} version${(ad.versions || 1) > 1 ? 's' : ''}):
Their copy: headline "${one(ad.headline)}"; text "${one(ad.body).slice(0, 400)}"; button "${one(ad.cta)}".${ad.hook ? ` Hook: ${one(ad.hook)}.` : ''}${ad.angle ? ` Angle: ${one(ad.angle)}.` : ''}
How it is made (read from the creative):
${made}
MAKE ${String(brand || 'the brand').toUpperCase()}'S OWN VERSION OF THIS AD: the same angle, the same hook pattern and structure, the same format, layout and look, with ${brand}'s own product and only ${brand}'s facts. Option 1 is the closest remake: same format, same layout, same order of ideas. Rewrite every line in ${brand}'s words: never ${ad.brand}'s name, product names, claims, offers or numbers, and never their sentences word for word. Words set on the image keep the rival's places and roughly their length. The imageBrief (or visual) describes the same composition and look with ${brand}'s product in the place of theirs.`;
}

/* the picture: our product is image 1 (kept exactly), the rival's ad is image 2 (the look only); words go where theirs sit */
export function rivalPicture(ad, style, { headline = '' } = {}) {
  const head = style?.words?.find((w) => w.role === 'headline') || style?.words?.[0] || null;
  const words = one(headline).split(' ').slice(0, Math.max(3, Math.min(9, head?.words || 7))).join(' ');
  return {
    refs: [{ job: 'product', label: '', keep: '' }, { job: 'style', label: `${ad.brand}'s ad`, keep: 'copy its layout, crop, framing, light, colours and where the words sit; take nothing else from it: not its product, packaging, logo, brand name, people or words' }],
    visual: style ? `${style.layout} ${style.look}` : '',
    text: head && words ? [{ words, where: head.where, style: head.lettering }] : []
  };
}
