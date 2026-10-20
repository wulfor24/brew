// "Make our version" of a rival's ad. A rival ad card (research.kind 'ad', from the Meta Ad Library read in research.js)
// is remade in two steps, for every brand:
//   1. read the creative itself (the poster image, and the clip when it is a video ad and the AI can watch video): its
//      format, the hook and how it is built, the layout, the look, the words set on the image and where they sit, the beats
//      of a video, and what makes it work. One cheap vision call, kept per ad on this instance.
//   2. write and draw ours on the same angle, hook pattern, format, layout and look, with the brand's own product and only
//      the brand's facts. The image model gets only our product photo and the written breakdown, never the rival's picture:
//      given their picture it edits it, and their products, model, words and badges come through (probes, 17 Oct).
// Nothing of theirs is copied as is: not their brand name, product, logo, faces, claims, numbers or sentences.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { kindOf, mimeOf, RASTER } from './img-norm.js';

/* a research picture (a rival's poster or clip) is never a product photo of ours */
export const isResearchImage = (rel) => /^\/?research\//.test(String(rel || '')) || /(^|\/)b\/[a-z0-9-]+\/a\/ad-[^/]+$/.test(String(rel || '').split('?')[0]); /* the read's own Ad Library posters (b/<slug>/a/ad-<id>.jpg) too */
export const isRivalCard = (c) => c?.research?.kind === 'ad' || !!c?.research?.ad; /* a rival's ad card, or a card built on one (a how-to that tests its angle) */
/* "Make our version" of a viral video (research.js refreshViral): the same remake, from a creator's organic short instead of an ad */
export const isViralCard = (c) => c?.research?.kind === 'viral';
/* any card that remakes somebody else's work: the jam shows its references (View references) */
export const isReferenceCard = (c) => isRivalCard(c) || isViralCard(c);
/* what every writer gets for a viral remake: how the video is built, never the creator's words or face as ours */
export function viralBlock(v, brandName = 'the brand') {
  if (!v) return '';
  const r = v.read || {}, beats = (r.scenes || []).slice(0, 8).map((x) => `${x.t || ''} ${x.shot || ''}${x.onScreenText ? ` (on screen: ${x.onScreenText})` : ''}${x.voice ? ` (said: ${x.voice})` : ''}`.trim());
  return [`OUR VERSION OF A VIRAL VIDEO: a ${v.platform} video by ${v.author} got ${v.views ?? 'many'} views${v.score ? `, ${v.score}x their usual` : ''}. ${brandName} makes its own video on the same format.`,
    r.hook && `Its hook (first 3 seconds): ${r.hook.first3s || ''}${r.hook.visual ? ` Opening shot: ${r.hook.visual}.` : ''}`,
    r.format && `Format: ${r.format}. Pacing: ${r.pacing || 'not read'}.`, r.whyItWorks && `Why it worked: ${r.whyItWorks}`,
    beats.length && `Its beats in order:\n- ${beats.join('\n- ')}`,
    (() => { const theirs = [...new Set([r.hook?.text, ...(r.scenes || []).map((x) => x.onScreenText)].map((x) => String(x || '').trim()).filter((x) => x.length > 3))].slice(0, 8); return theirs.length ? `Their words, never to be reused or lightly reworded (write new lines in the same spirit): ${theirs.map((x) => `"${x}"`).join('; ')}` : ''; })(),
    `Follow the same structure, pacing and kind of hook, beat for beat, with ${brandName}'s product, ${brandName}'s facts and new words. Never reuse the creator's sentences, name, face, brand or products. Write the script as beats (shot + line), a caption, and filming directions (where to stand, framing and angle, energy, the first word on the first frame).`].filter(Boolean).join('\n');
}

export const STYLE_SCHEMA = { type: 'object', required: ['format', 'angle', 'hookPattern', 'stopper', 'audience', 'proof', 'layout', 'look', 'words', 'beats', 'works'], properties: {
  angle: { type: 'string', description: 'The selling angle in a few words, e.g. "pain first, then the fix", "social proof", "price drop", "founder story", "taste test", "routine"' },
  stopper: { type: 'string', description: 'What stops the scroll: what the eye or ear meets in the first glance or first two seconds, and why it works' },
  audience: { type: 'string', description: 'Who it speaks to and the moment it catches them in, in one short sentence' },
  proof: { type: 'string', description: 'The proof device it uses (a number, reviews, a demo, a comparison, a face, none), in a few words' },
  format: { type: 'string', description: 'What kind of creative it is, in a few words: a studio product photo with a headline, a lifestyle photo, a flat graphic with an offer badge, a UGC selfie video, a demo video, a before-you-buy comparison, a carousel' },
  hookPattern: { type: 'string', description: 'How the hook is built, without the rival\'s words: e.g. "names a daily pain, then the fix", "a question the buyer asks", "a number of happy buyers", "price drop in the first line"' },
  layout: { type: 'string', description: 'One or two sentences: where the product sits and how big, the crop, the background, where people or hands are, where the words sit (top third, bottom band, over the product). Say "the product" and "a person": never name or describe their product, pack, flavour, brand, retailer or badge' },
  look: { type: 'string', description: 'One or two sentences as things you can see: light, colours, photo or graphic, props, surface, mood of the setting. No product, pack, brand or retailer names' },
  words: { type: 'array', description: 'The words set ON the image, in reading order (empty when there are none)', items: { type: 'object', required: ['role', 'where', 'lettering'], properties: {
    role: { type: 'string', enum: ['headline', 'subline', 'badge', 'price', 'button', 'other'] },
    where: { type: 'string', description: 'Where it sits, e.g. "top third, centred", "a pill in the top-left corner", "bottom band"' },
    lettering: { type: 'string', description: 'The lettering, e.g. "bold white sans-serif", "handwritten black", "yellow sticker"' },
    words: { type: 'number', description: 'How many words it has' } } } },
  beats: { type: 'array', items: { type: 'string' }, description: 'A video ad only: 3 to 5 beats in order, each one short sentence on what is seen and said; empty for a still' },
  works: { type: 'array', items: { type: 'string' }, description: '3 to 5 things that make this ad work and that our version should copy (structure, framing, proof, pacing), never the rival\'s product or claims' }
} };

const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const MAX_VIDEO = 15 * 1024 * 1024; // a clip the AI can watch inline; a bigger one is shrunk first (480p, first 30 s), else read from its first frame

/* the read, kept per ad id on this instance (a second jam on the same ad reads nothing again) */
const READS = new Map();
export function forgetRivalReads() { READS.clear(); }

/* call(content, schema, max, name) → JSON: the jam's structured call (claudeTool), which takes text and image parts.
   fileOf(rel) → a local file for a research path (this instance's disk or the bucket's copy), or null */
/* a clip over the inline limit is shrunk once (480p, first 30 seconds, quiet audio kept for spoken hooks), so a video ad is read whole */
async function shrinkClip(file, log) {
  const out = path.join(os.tmpdir(), `rival-${path.basename(file).replace(/\W+/g, '_')}-small.mp4`);
  if (!fs.existsSync(out)) await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-v', 'error', '-i', file, '-t', '30', '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-c:a', 'aac', '-b:a', '48k', out], { timeout: 120e3 }, (e) => (e ? rej(e) : res())));
  const st = fs.statSync(out); if (st.size > MAX_VIDEO) throw new Error(`still ${Math.round(st.size / 1e6)} MB after shrinking`); log.info?.(`[rival-ad] shrunk ${path.basename(file)} to ${Math.round(st.size / 1e5) / 10} MB`); return out;
}

/* store: { get(id), put(id, read) } keeps a read with the brand (rival-reads.json), so a deploy or a second instance never pays for it again */
export async function readRivalAd(ad, { call, fileOf = async () => null, video = process.env.AI_PROVIDER !== 'anthropic', store = null, log = console } = {}) {
  if (!ad?.id || !call) return null;
  if (ad.style?.layout) return ad.style;
  if (READS.has(ad.id)) return READS.get(ad.id);
  const kept = store ? await store.get(ad.id).catch(() => null) : null; if (kept?.layout) { READS.set(ad.id, Promise.resolve(kept)); return kept; }
  const ask = (watched) => ({ type: 'text', text: `This is a live Meta ad by ${ad.brand} (${ad.format || 'image'} ad${ad.days ? `, live ${ad.days} days` : ''}${ad.versions ? ` in ${ad.versions} version${ad.versions > 1 ? 's' : ''}` : ''}).
Its copy: headline "${one(ad.headline)}"; text "${one(ad.body).slice(0, 500)}"; button "${one(ad.cta)}".
${watched ? 'You are watching the clip itself.' : 'You see its picture (for a video ad, its first frame).'} Read how this creative is MADE, so another brand can make its own ad in the same style with its own product. Describe what you see, not what you guess. Never quote the rival's words in hookPattern, layout or look.` });
  const shape = (j, from) => ({ format: one(j.format), angle: one(j.angle), stopper: one(j.stopper), audience: one(j.audience), proof: one(j.proof), hookPattern: one(j.hookPattern), layout: one(j.layout), look: one(j.look), beats: (j.beats || []).map(one).filter(Boolean).slice(0, 5), works: (j.works || []).map(one).filter(Boolean).slice(0, 5),
    words: (j.words || []).filter((w) => w && (w.where || w.role)).slice(0, 4).map((w) => ({ role: w.role || 'other', where: one(w.where), lettering: one(w.lettering), words: +w.words || null })), from });
  const posterPart = async () => { if (!ad.poster) return null; try { const f = await fileOf(ad.poster); if (!f) return null; const b = fs.readFileSync(f); return RASTER.has(kindOf(b)) ? { type: 'image', source: { type: 'base64', media_type: mimeOf(b), data: b.toString('base64') } } : null; } catch (e) { log.warn?.('[rival-ad] poster', e.message); return null; } };
  const p = (async () => {
    /* the clip when the AI can watch it; a clip that can't be read (too big, refused) falls back to the poster, so a video ad is never left unread */
    if (video && ad.video) { try { let f = await fileOf(ad.video); const st = f && fs.statSync(f); if (st && st.size > MAX_VIDEO) f = await shrinkClip(f, log);
        if (f) return shape(await call([{ type: 'document', source: { type: 'base64', media_type: 'video/mp4', data: fs.readFileSync(f).toString('base64') } }, ask(true)], STYLE_SCHEMA, 1500, 'rival_style'), 'video'); }
      catch (e) { log.warn?.('[rival-ad] clip read, trying the poster', e.message); } }
    const pp = await posterPart(); if (!pp) return null; /* nothing to look at: the remake works from the copy alone */
    return shape(await call([pp, ask(false)], STYLE_SCHEMA, 1500, 'rival_style'), 'poster');
  })().then(async (r) => { if (r && store) await store.put(ad.id, r).catch((e) => log.warn?.('[rival-ad] keep', e.message)); return r; })
    .catch((e) => { READS.delete(ad.id); log.warn?.('[rival-ad] read', e.message); return null; });
  READS.set(ad.id, p);
  return p;
}

/* the block every writer gets (the studio's packages, the jam's drafts): the rival ad, how it is made, and the rule */
export function rivalBlock(ad, style, brand) {
  if (!ad) return '';
  const made = style ? [
    `Format: ${style.format}.`, style.angle ? `Angle: ${style.angle}.` : '', style.stopper ? `What stops the scroll: ${style.stopper}` : '', style.audience ? `Who it speaks to: ${style.audience}` : '', style.proof ? `Proof device: ${style.proof}.` : '', `Hook pattern: ${style.hookPattern}.`, `Layout: ${style.layout}`, `Look: ${style.look}`,
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
export function rivalPicture(ad, style, { headline = '', sub = '', button = '' } = {}) {
  /* The image model gets OUR product only (image 1) and this written breakdown of their ad, never their picture: an image
     model given the rival's ad edits it, and their products, model, words and retailer badge came through every time
     (probes, 17 Oct). Read from the picture, written as words, drawn with our product: the same composition, not a copy. */
  const role = (r) => style?.words?.find((w) => w.role === r) || null;
  const fit = (txt, w, max = 9) => one(txt).split(' ').slice(0, Math.max(2, Math.min(max, w?.words || max))).join(' ');
  const head = role('headline') || style?.words?.[0] || null, subW = role('subline'), btnW = role('button');
  /* the read names the words' places; when it described them only in the layout ("the headline sits top left"), our words
     still go there, so the model never invents its own (probe, 17 Oct: "SNA\\CK BETTER") */
  const says = (re) => re.test(String(style?.layout || ''));
  const at = (w, re, fallback) => (w ? { where: w.where || fallback, style: w.lettering || 'bold sans-serif' } : says(re) ? { where: fallback, style: 'bold sans-serif' } : null);
  const hAt = at(head, /headline|title|text|words|copy/i, 'where the layout above puts the headline'), sAt = at(subW, /sub-?head|subline|subtext|supporting/i, 'under the headline, where the layout above puts it'), bAt = at(btnW, /button|cta|call-to-action|pill/i, 'where the layout above puts the button');
  const text = [hAt && one(headline) && { words: fit(headline, head), ...hAt },
    sAt && one(sub) && { words: fit(sub, subW, 10), ...sAt },
    bAt && one(button) && { words: fit(button, btnW, 4), ...bAt }].filter(Boolean);
  return {
    refs: [{ job: 'product', label: '', keep: '' }],
    visual: style ? `The composition of ${ad.brand}'s ad, made with our product: ${style.layout} ${style.look} Every product, pack or tub in the picture is the product from image 1; no other products, brands, logos, badges or retailer marks.` : '',
    look: style?.look || '',
    text
  };
}
