// One brief, every picture and clip: the words Brew sends to an image or video model, for a Gemini draft (buildDraft) and for
// a Sloosh final (buildFinal). Written the way Sloosh's prompt guide and the model makers ask (sloosh.ai/docs/prompt-guide,
// prompting-nano-banana, prompting-gpt-image, video-prompts, seedance-2-5): a brief in plain sentences (subject, setting, look,
// use), references named by position with a job and a keep line, text only as exact quoted words with a place and a lettering,
// aspect ratio in the settings and never in the words, edits as "change only X, keep the rest". No keyword strings, no mood
// words, none of the stock-photo clichés that make a picture read as AI (SLOP). Pure functions; the tests pin the shape.

/* words that add noise, not detail: stripped from any sentence a model wrote, refused in the standing lines */
export const SLOP = /\b(?:4\s?k|8\s?k|ultra[- ]?(?:detailed|realistic|hd)|hyper[- ]?realistic|photo[- ]?realistic|trending(?: on \w+)?|award[- ]winning|masterpiece|cinematic|premium(?:-looking| look| feel)?|luxurious|stunning|breathtaking|gorgeous|magical|epic|aesthetic|vibes?|sparkl\w*|glitter\w*|confetti|lens flares?|bokeh balls?|floating(?: in mid[- ]?air| product)?|levitat\w+|swirl\w*|splash\w* of (?:water|milk|cream)|liquid splash\w*|explod\w+|dramatic (?:smoke|fog|lighting)|neon glow|glowing (?:aura|edges?)|light rays?|god rays?|depth of field|dof|octane|unreal engine|8-bit|high quality|best quality|professional photography|studio quality)\b[,.;: ]*/gi;
export const JOBS = ['product', 'scene', 'style', 'person', 'logo', 'other'];
/* what a reference of each job tells the model, and what must not change from it */
const JOB_LINE = {
  product: (r) => `Image ${r.n} is the product${r.label ? `, ${r.label}` : ''}. Keep its shape, proportions, colours, materials and brand mark as shown; its small print may be soft or turned away, never rewritten${r.keep ? `; ${r.keep}` : ''}.`, /* asking for exact small print made garbled labels, and a check that threw good pictures away */
  scene: (r) => `Image ${r.n} is the place${r.label ? `, ${r.label}` : ''}: use it as the setting and background${r.keep ? `; ${r.keep}` : ''}.`,
  style: (r) => `Image ${r.n} is the look${r.label ? `, ${r.label}` : ''}: match its light, colours, framing and mood, not its subject${r.keep ? `; ${r.keep}` : ''}.`,
  person: (r) => `Image ${r.n} is ${r.label || 'the person'}: keep their face, hair and build exactly as in that image${r.keep ? `; ${r.keep}` : ''}.`,
  logo: (r) => `Image ${r.n} is the logo${r.label ? `, ${r.label}` : ''}: reproduce it exactly, once, where the text sits${r.keep ? `; ${r.keep}` : ''}.`,
  other: (r) => `Image ${r.n}${r.label ? ` is ${r.label}` : ''}${r.keep ? `: ${r.keep}` : ': use it as a reference for what it shows'}.`
};
export const USE = { '4:5': 'a feed ad seen on a phone', '1:1': 'a square post seen on a phone', '9:16': 'a vertical story or reel on a phone; keep the top and bottom sixth free of anything that matters, the app draws its own bars there', '16:9': 'a wide banner', '3:4': 'a portrait post', '21:9': 'a wide site banner' };

const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const sentence = (s) => { const t = one(s); return t ? (/[.!?]$/.test(t) ? t : t + '.') : ''; };
/* a model-written sentence with the noise taken out and the first letter up */
export const scrub = (s) => { const t = one(String(s || '').replace(SLOP, ' ')).replace(/\s+([,.;:])/g, '$1').replace(/([,.;:])[,;: ]*(?=[,.;:])/g, '$1').replace(/^[,.;: ]+|[,;: ]+$/g, ''); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
export const hasSlop = (s) => { SLOP.lastIndex = 0; return SLOP.test(String(s || '')); };
export const refLines = (refs = []) => refs.filter(Boolean).map((r, i) => (JOB_LINE[JOBS.includes(r.job) ? r.job : 'other'])({ ...r, n: r.n || i + 1 })).join(' ');
/* the standing rules every picture keeps, for the brand (its own avoid line wins over the default one) */
export const keepLine = ({ brand = {}, text = false, people = true } = {}) => one(`${text ? 'No writing anywhere except the words asked for and the product’s own label' : 'Nothing in the picture carries writing except the product’s own label'}: no calendars, notes, signs, screens, books, posters or other packaging. No logos or watermarks that are not the brand’s own. No body shown as a result, no before and after of a body${people ? '' : ', no people'}. Nothing invented on the product. ${scrub(brand.avoid || '')}`);
/* "HEADLINE" in bold sans-serif, top third: exact words, a place, a lettering; one line each; rendered once */
export const textLines = (text = []) => { const xs = (Array.isArray(text) ? text : [text]).map((t) => (typeof t === 'string' ? { words: t } : t)).filter((t) => one(t?.words)); if (!xs.length) return '';
  return xs.map((t) => `Text: "${one(t.words).replace(/"/g, '”')}" in ${t.style || 'clean bold sans-serif'}, ${t.where || 'in the clear space'}.`).join(' ') + ' Render each line once, spelled exactly, and add no other text.'; };
/* light, lens and colours as things you can see: the brand's style line when it has one, else a real phone-camera moment in
   natural light (a still life on a surface reads as a catalog photo and is scrolled past) */
export const lookOf = (brand = {}, kind = 'image') => scrub(brand.style || brand.editorial || (kind === 'video' ? 'Natural daylight in a real place, true colours, handheld on a phone' : 'A real moment shot on a phone held slightly above, natural daylight in a real home, office or outdoors, true colours, a little lived-in, not a studio still'));
export const useOf = (ratio, topSpace = false) => `${USE[ratio] || USE['4:5']}${topSpace ? '; keep the top third calm and simple, the words sit there' : ''}`;

/* ---------- the normalised brief every renderer reads ---------- */
export function brief(spec = {}) {
  const brand = spec.brand || {}; const refs = (spec.refs || []).map((r, i) => ({ n: i + 1, job: JOBS.includes(r?.job) ? r.job : 'other', label: one(r?.label), keep: one(r?.keep), id: r?.id, url: r?.url, file: r?.file }));
  if (!refs.length && spec.hasSrc) refs.push({ n: 1, job: 'product', label: one(spec.product?.name || `${brand.name || ''} ${brand.noun || ''}`) || '', keep: '' });
  const named = spec.subject || spec.product?.name || [brand.name, brand.noun].filter(Boolean).join(' '), subject = named ? scrub(named) : 'the product'; /* never "The subject is The product." */
  return { kind: spec.kind || 'image', title: one(spec.title), subject, visual: scrub(spec.visual), scene: scrub(spec.scene), look: lookOf(brand, spec.kind), ratio: spec.ratio || '4:5', use: useOf(spec.ratio || '4:5', !!spec.topSpace),
    refs, text: spec.text || [], brand, motion: scrub(spec.motion), beats: spec.beats || [], seconds: spec.seconds || 6, sound: spec.sound ?? false, index: spec.index, count: spec.count, people: spec.people !== false, revise: spec.revise || null };
}

/* ---------- image renderers ---------- */
/* Nano Banana (Gemini image) reads a scene in sentences: style, subject, setting, action, composition, then the words */
export function nanoScene(b) {
  const where = [b.visual, b.scene].filter(Boolean).map(sentence).join(' ');
  const head = b.index ? `Photograph ${b.index} of ${b.count} for one ${b.title || 'carousel'}; every photo in the set shares the same look, light and colours.` : `A photograph${b.title ? ` for ${b.title}` : ''}.`;
  return one(`${head} ${b.subject ? `The subject is ${b.subject}.` : ''} ${sentence(where) || 'The product in use in a real home, held close to the camera.'} ${sentence(b.look)} Made for ${b.use}. ${refLines(b.refs)} ${textLines(b.text)} ${keepLine({ brand: b.brand, text: !!(b.text || []).length, people: b.people })}`);
}
/* GPT Image reads a spec: one kind of instruction per line */
export function gptSpec(b) {
  const lines = [`Result: ${b.title ? `${b.title}, ` : ''}${b.use}.`, `Subject: ${b.subject}. ${[b.visual, b.scene].filter(Boolean).join(' ')}`.trim(), `Setting and light: ${b.look}`, `Camera: at eye level, the product filling about two thirds of the frame, sharp.`];
  const t = textLines(b.text); if (t) lines.push(t);
  lines.push(`Keep: ${refLines(b.refs) || 'the product exactly as it is sold.'} ${keepLine({ brand: b.brand, text: !!(b.text || []).length, people: b.people })}`);
  return lines.map(one).join('\n');
}
/* Flux 2 Pro takes exact colours as hex, each tied to an object */
export function fluxHex(b) { const cs = (b.brand.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))).slice(0, 3); const hex = cs.length ? ` Brand colours, exact: ${cs.map((c, i) => `${c} for ${['the backdrop', 'the accent props', 'the small details'][i]}`).join(', ')}.` : ''; return nanoScene(b) + hex; }

/* ---------- video renderers ---------- */
/* a draft clip from a still (Veo on Vertex, image to video): one handheld shot at a natural pace, what moves and who uses the
   product; the product keeps its shape, colours and brand mark (a pinned, still product made clips nobody stopped for) */
export function veoDraft(b) { return one(`${sentence(b.motion) || 'A hand picks the product up and uses it.'} One continuous handheld phone shot at a natural pace; hands and people may move and use the product; the product keeps its shape, colours and brand mark as in the first frame. ${b.sound ? 'Quiet room tone.' : ''} No new text appears, no captions, no logo.`); }
/* Seedance 2.5: references by job, one summary sentence, then timed beats in whole seconds with no gaps; SFX in <>, lines in quotes */
export function seedanceBeats(b) {
  const S = Math.max(4, Math.min(30, Math.round(b.seconds || 6))); const beats = (b.beats || []).filter((x) => one(x?.shot || x?.beat || x)).slice(0, 6);
  const n = beats.length || 1, cut = (i) => Math.round((S * i) / n);
  const body = beats.length ? beats.map((x, i) => { const shot = scrub(x.shot || x.beat || x), line = one(x.line); return `${cut(i)}-${cut(i + 1)}s: ${sentence(shot)}${line ? ` "${line.replace(/"/g, '”')}"` : ''}`; }).join('\n') : `0-${S}s: ${sentence(b.motion) || 'The camera pushes in slowly on the product.'}`;
  return [`${refLines(b.refs)}`.trim(), one(`A ${b.title ? `${b.title}: ` : ''}${b.subject}${b.visual || b.scene ? `, ${[b.visual, b.scene].filter(Boolean).join(' ')}` : ''}. ${b.look} One camera move per beat, slow and steady.`), body, one(`${b.sound ? 'Quiet ambient sound that fits the room.' : 'No music.'} No subtitles, no captions, no logo, no watermark. ${keepLine({ brand: b.brand, people: b.people })}`)].filter(Boolean).join('\n');
}
/* Seedance 2.0 reads numbered shots, not timestamps */
export function seedanceShots(b) { return seedanceBeats(b).replace(/^(\d+)-(\d+)s:/gm, (m, a, c, off, s) => `Shot ${s.slice(0, off).split('\n').filter((l) => /^\d+-\d+s:/.test(l)).length + 1}:`); }
/* Gemini Omni: one continuous shot with its own Audio line, nothing negative */
export function omniShot(b) { return one(`A single continuous ${Math.max(3, Math.min(10, b.seconds || 6))}-second shot. ${b.look} ${[b.visual, b.scene].filter(Boolean).join(' ')} The camera ${b.motion ? b.motion.replace(/^the camera\s*/i, '') : 'pushes in slowly'} as ${b.subject} stays in sharp focus. ${refLines(b.refs)}`) + `\nAudio: ${b.sound ? 'quiet room tone, no music.' : 'silence.'}`; }
/* Veo 3.1: cinematography first, no reference tags; the references are matched by what the words describe */
export function veoShot(b) { return one(`Slow push in, eye level, 50mm, shallow focus on ${b.subject}. ${[b.visual, b.scene].filter(Boolean).join(' ')} ${b.look} ${sentence(b.motion)} The product stays still with its label readable. ${b.sound ? 'Ambient noise: the quiet of the room.' : ''} No captions, no logo.`); }

/* ---------- a revision keeps everything but the one change ---------- */
export function reviseBrief(prev = {}, change = '') { const keep = ['the product and every word on its label', 'the framing and the camera', 'the light and the colours', ...(prev.text?.length ? [`the text ${prev.text.map((t) => `"${one(typeof t === 'string' ? t : t.words)}"`).join(', ')}`] : [])];
  return one(`Image 1 is the previous picture. Change only this: ${scrub(change) || 'nothing'}. Keep everything else exactly as in image 1: ${keep.join('; ')}. ${prev.keepLine || ''}`); }

/* ---------- which model, and why ---------- */
/* the ids Sloosh's list_models really returns (read 2026-10-16, tools/sloosh-probe.mjs); there is no Veo on Sloosh, so a Veo-style
   single shot runs on Gemini Omni. MODEL_OPTS pins each model's aspect ratios and resolutions so a setting is snapped before the quote. */
export const MODELS = { image: 'gemini-3-pro-image-preview', draft: 'gemini-3.1-flash-image-preview', type: 'ideogram-4.5', hex: 'flux-2-pro', edit: 'gpt-image-2.5-sunburst', video: 'seedance-2.5', videoShots: 'seedance-2.0', omni: 'gemini-omni-1.1-flash' };
export const MODEL_LABELS = { 'gemini-3-pro-image-preview': 'Nano Banana Pro', 'gemini-3.1-flash-image-preview': 'Nano Banana 2', 'ideogram-4.5': 'Ideogram 4.5', 'flux-2-pro': 'Flux 2 Pro', 'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst', 'seedance-2.5': 'Seedance 2.5', 'seedance-2.0': 'Seedance 2.0', 'gemini-omni-1.1-flash': 'Gemini Omni 1.1 Flash' };
export const MODEL_OPTS = {
  'gemini-3-pro-image-preview': { ratios: ['auto', '1:1', '2:3', '3:2', '16:9', '9:16', '4:3', '3:4', '21:9', '4:5', '5:4'], res: ['1K', '2K', '4K'], refs: 14 },
  'gemini-3.1-flash-image-preview': { ratios: ['auto', '1:1', '2:3', '3:2', '16:9', '9:16', '4:3', '3:4', '21:9', '4:5', '5:4'], res: ['512', '1K', '2K', '4K'], refs: 14 },
  'ideogram-4.5': { ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5'], res: ['1K', '2K'], refs: 5 },
  'flux-2-pro': { ratios: ['1:1', '2:3', '3:2', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '21:9'], res: ['1K'], refs: 8 },
  'gpt-image-2.5-sunburst': { ratios: ['auto', '1:1', '3:2', '2:3', '16:9', '9:16', '4:5', '5:4'], res: ['1K', '2K', '4K'], refs: 16 },
  'seedance-2.5': { ratios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], res: ['480p', '720p', '1080p'], seconds: [4, 30], refs: 30 },
  'seedance-2.0': { ratios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], res: ['480p', '720p', '1080p', '4k'], seconds: [4, 6, 8, 10, 12, 15], refs: 9 },
  'gemini-omni-1.1-flash': { ratios: ['16:9', '9:16'], res: ['360p', '720p', '1080p', '4k'], seconds: [3, 10], refs: 6 }
};
const asNum = (r) => { const [a, b] = String(r).split(':').map(Number); return a && b ? a / b : NaN; };
/* snap a ratio, a resolution and a length onto what the model offers (nearest ratio by its number, the resolution asked or the best below it) */
export function fitSettings(model, settings = {}) {
  const o = MODEL_OPTS[model]; if (!o) return settings; const out = { ...settings };
  const r = settings.aspect_ratio; if (r && !o.ratios.includes(r)) { const want = asNum(r); const cands = o.ratios.filter((x) => x !== 'auto'); out.aspect_ratio = Number.isFinite(want) ? cands.reduce((best, x) => (Math.abs(asNum(x) - want) < Math.abs(asNum(best) - want) ? x : best), cands[0]) : cands[0]; }
  const rank = (x) => ({ '512': 0.5, '360p': 0.36, '480p': 0.48, '720p': 0.72, '768p': 0.77, '1080p': 1.08, '1K': 1, '2K': 2, '2k': 2, '4K': 4, '4k': 4 })[x] ?? 1;
  const res = settings.resolution; if (res && !o.res.includes(res)) { const want = rank(res); const below = o.res.filter((x) => rank(x) <= want); out.resolution = (below.length ? below : o.res).reduce((b, x) => (Math.abs(rank(x) - want) < Math.abs(rank(b) - want) ? x : b)); }
  if (o.seconds && settings.duration != null) { const d = Math.round(settings.duration); out.duration = o.seconds.length === 2 && o.seconds[1] > 12 ? Math.max(o.seconds[0], Math.min(o.seconds[1], d)) : o.seconds.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b)); }
  return out;
}
export function pickModel(b) {
  if (b.revise) return { model: MODELS.edit, why: 'a precise edit of the previous picture' };
  if (b.kind === 'video') return b.model && Object.values(MODELS).includes(b.model) ? { model: b.model, why: 'as picked' } : /^veo/.test(b.model || '') ? { model: MODELS.omni, why: 'one continuous shot (Veo is not on Sloosh)' } : { model: MODELS.video, why: 'timed beats, the product kept from its photo' };
  if (b.model === 'flux-2-pro' || (!(b.text || []).length && (b.brand.colors || []).some((c) => /^#[0-9a-f]{6}$/i.test(c)) && b.brand.exactColors)) return { model: MODELS.hex, why: 'exact brand colours' };
  if ((b.text || []).length >= 3) return { model: MODELS.type, why: 'several lines of type' };
  return { model: MODELS.image, why: (b.text || []).length ? 'finished work with the words set in the picture' : 'finished product photography' };
}

/* ---------- the two entry points ---------- */
/* a Gemini image or Veo draft: the same brief, rendered as a scene (Gemini image is the Nano Banana family) or a Veo shot */
export function buildDraft(spec = {}) { const b = brief(spec); return b.kind === 'video' ? { prompt: veoDraft(b), ratio: b.ratio, brief: b } : { prompt: nanoScene(b), ratio: b.ratio, brief: b }; }
/* a Sloosh final: the model, its prompt and the settings the chips carry (never in the words) */
export function buildFinal(spec = {}) {
  const b = brief(spec); const { model, why } = pickModel({ ...b, model: spec.model, revise: spec.revise });
  const prompt = spec.revise ? reviseBrief({ text: b.text, keepLine: keepLine({ brand: b.brand, text: !!b.text.length, people: b.people }) }, spec.revise.change)
    : b.kind === 'video' ? (model === MODELS.videoShots ? seedanceShots(b) : model === MODELS.omni ? omniShot(b) : seedanceBeats(b))
    : model === MODELS.edit ? gptSpec(b) : model === MODELS.hex ? fluxHex(b) : nanoScene(b);
  const settings = fitSettings(model, b.kind === 'video' ? { aspect_ratio: b.ratio, resolution: '1080p', duration: Math.max(4, Math.min(30, Math.round(b.seconds || 6))), sound: !!b.sound } : { aspect_ratio: b.ratio, resolution: spec.resolution || '2K' });
  return { model, label: MODEL_LABELS[model] || model, prompt, settings, why, refs: b.refs, brief: b };
}
