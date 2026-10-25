// One brief, every picture and clip: the words Brew sends to an image or video model, for a Gemini draft (buildDraft) and for
// a Sloosh final (buildFinal). Written the way Sloosh's prompt guide and the model makers ask (sloosh.ai/docs/prompt-guide,
// prompting-nano-banana, prompting-gpt-image, video-prompts, seedance-2-5): a brief in plain sentences (subject, setting, look,
// use), references named by position with a job and a keep line, text only as exact quoted words with a place and a lettering,
// aspect ratio in the settings and never in the words, edits as "change only X, keep the rest". No keyword strings, no mood
// words, none of the stock-photo clichés that make a picture read as AI (SLOP). Pure functions; the tests pin the shape.

/* words that add noise, not detail: stripped from any sentence a model wrote, refused in the standing lines */
export const SLOP = /\b(?:4\s?k|8\s?k|ultra[- ]?(?:detailed|realistic|hd)|hyper[- ]?realistic|photo[- ]?realistic|trending(?: on \w+)?|award[- ]winning|masterpiece|cinematic|premium(?:-looking| look| feel)?|luxurious|stunning|breathtaking|gorgeous|magical|epic|aesthetic|vibes?|sparkl\w*|glitter\w*|confetti|lens flares?|bokeh balls?|floating(?: in mid[- ]?air| product)?|levitat\w+|swirl\w*|splash\w* of (?:water|milk|cream)|liquid splash\w*|explod\w+|dramatic (?:smoke|fog|lighting)|neon glow|glowing (?:aura|edges?)|light rays?|god rays?|depth of field|dof|octane|unreal engine|8-bit|high quality|best quality|professional photography|studio quality)\b[,.;: ]*/gi;
export const JOBS = ['product', 'scene', 'style', 'person', 'logo', 'layout', 'frame', 'motion', 'other']; /* layout: the approved draft picture; frame: a video's opening frame (sent as start_frame, never numbered) */
/* what a reference of each job tells the model, and what must not change from it */
const JOB_LINE = {
  product: (r) => `Image ${r.n} is the product${r.label && !/^product( photo)?$/i.test(r.label) ? `, ${r.label}` : ''}. Keep its shape, proportions, colours, materials and brand mark as shown; its small print may be soft or turned away, never rewritten${r.keep ? `; ${r.keep}` : ''}.`, /* asking for exact small print made garbled labels, and a check that threw good pictures away */
  scene: (r) => `Image ${r.n} is the place${r.label ? `, ${r.label}` : ''}: use it as the setting and background${r.keep ? `; ${r.keep}` : ''}.`,
  style: (r) => `Image ${r.n} is the look${r.label ? `, ${r.label}` : ''}: match its light, colours, framing and mood, not its subject${r.keep ? `; ${r.keep}` : ''}.`,
  person: (r) => `Image ${r.n} is ${r.label || 'the person'}: keep their face, hair and build exactly as in that image${r.keep ? `; ${r.keep}` : ''}.`,
  /* the draft the team approved: the final keeps its composition, the product comes only from the product photo (a draft is a
     Gemini picture, so its product may be a little off; the photo is the truth) */
  layout: (r) => `Image ${r.n} is the approved draft${r.label ? `, ${r.label}` : ''}: keep its framing, where everything sits, the setting and the light, and make it sharper and more finished; take the product itself only from the product photo, never from this image${r.keep ? `; ${r.keep}` : ''}.`,
  logo: (r) => `Image ${r.n} is the logo${r.label ? `, ${r.label}` : ''}: reproduce it exactly, once, where the text sits${r.keep ? `; ${r.keep}` : ''}.`,
  /* a viral video the team is making its own version of (viral cards only): its format, never its people or products */
  /* 21 Oct: given only "follow its format", Seedance copied the creator's striped socks and wooden floor: only the timing comes across */
  motion: (r) => `The reference video${r.label ? ` is ${r.label}` : ''}: take only its pacing, shot order, framing and camera moves. Everything you see in it changes: a different room and background, different floor and furniture, different clothes, socks and shoes, different props and different people. Never copy its people, faces, products, words or brand${r.keep ? `; ${r.keep}` : ''}.`,
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
/* anyone in a picture is an everyday customer, never a doctor or scientist (a lab coat reads as a fake endorsement: Arata 25 Oct, a
   first draft put a woman in a lab coat beside the shampoo). Same rule as Studio's (jam2/studio.js NO_EXPERT) */
export const EVERYDAY = 'Anyone shown is an everyday customer: never a doctor, dermatologist, scientist, pharmacist or other expert, no lab coat, scrubs, clinic or laboratory';
export const keepLine = ({ brand = {}, text = false, people = true } = {}) => one(`${text ? 'No writing anywhere except the words asked for and the product’s own label' : 'Nothing in the picture carries writing except the product’s own label'}: no calendars, notes, signs, screens, books, posters or other packaging. No logos or watermarks that are not the brand’s own. No body shown as a result, no before and after of a body${people ? `. ${EVERYDAY}` : ', no people'}. Nothing invented on the product. ${scrub(text ? noTextOff(brand.avoid) : brand.avoid || '')}`);
/* a brand's avoid line says "No text" for its photos; where words were asked for it would cancel them (Arata's reel, 21 Oct) */
const noTextOff = (s) => String(s || '').replace(/\b(?:no|without) (?:text|words|writing|copy)(?: (?:on|in) (?:the )?(?:image|picture|photo))?\s*(?:,\s*|\.\s*|;\s*|$)/gi, '').replace(/^\s*[,;.]\s*/, '');
/* "HEADLINE" in bold sans-serif, top third: exact words, a place, a lettering; one line each; rendered once */
export const textLines = (text = []) => { const xs = (Array.isArray(text) ? text : [text]).map((t) => (typeof t === 'string' ? { words: t } : t)).filter((t) => one(t?.words)); if (!xs.length) return '';
  return xs.map((t) => `Text: "${one(t.words).replace(/"/g, '”')}" in ${t.style || 'clean bold sans-serif'}, ${t.where || 'in the clear space'}.`).join(' ') + ' Render each line once, spelled exactly, and add no other text.'; };
/* light, lens and colours as things you can see: the brand's style line when it has one, else a real phone-camera moment in
   natural light (a still life on a surface reads as a catalog photo and is scrolled past) */
export const lookOf = (brand = {}, kind = 'image') => scrub(brand.style || brand.editorial || (kind === 'video' ? 'Natural daylight in a real place, true colours, handheld on a phone' : 'A real moment shot on a phone held slightly above, natural daylight in a real home, office or outdoors, true colours, a little lived-in, not a studio still'));
export const useOf = (ratio, topSpace = false) => `${USE[ratio] || USE['4:5']}${topSpace ? '; keep the top third calm and simple, the words sit there' : ''}`;

/* planning notes a writer left in a picture brief ("Measure: high watch time…", "Goal: …") are not things to draw */
export const dropNotes = (s) => String(s || '').split(/(?<=[.!?])\s+/).filter((x) => !/^\s*(measure|metric|kpi|goal|why|hypothesis|test|success|target audience|audience|cta|button)\s*:/i.test(x)).join(' ');
/* ---------- the normalised brief every renderer reads ---------- */
export function brief(spec = {}) {
  const brand = spec.brand || {}; const all = (spec.refs || []).map((r) => ({ job: JOBS.includes(r?.job) ? r.job : 'other', label: one(r?.label), keep: one(r?.keep), id: r?.id, url: r?.url, file: r?.file }));
  const frame = all.find((r) => r.job === 'frame') || null, refs = all.filter((r) => r.job !== 'frame').map((r, i) => ({ ...r, n: i + 1 }));
  if (!refs.length && spec.hasSrc) refs.push({ n: 1, job: 'product', label: one(spec.product?.name || `${brand.name || ''} ${brand.noun || ''}`) || '', keep: '' });
  const named = spec.subject || spec.product?.name || [brand.name, brand.noun].filter(Boolean).join(' '), subject = named ? scrub(named) : 'the product'; /* never "The subject is The product." */
  return { kind: spec.kind || 'image', title: one(spec.title), subject, visual: scrub(dropNotes(spec.visual)), scene: scrub(dropNotes(spec.scene)), look: lookOf(brand, spec.kind), ratio: spec.ratio || '4:5', use: useOf(spec.ratio || '4:5', !!spec.topSpace),
    refs, frame, text: spec.text || [], brand, motion: scrub(spec.motion), beats: spec.beats || [], seconds: spec.seconds || 6, sound: spec.sound ?? false, index: spec.index, count: spec.count, people: spec.people !== false, revise: spec.revise || null };
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
/* Veo draws whatever words a prompt mentions, and draws them badly ("Over? Not yeith."): a scripted shot's text overlay, caption,
   price pop-up or quoted line is taken out of the motion here, and the words go on afterwards in exact type (headClip). A shot
   list joined with "Then" made Veo cut to new scenes with new people (a son who wasn't in the frame, the father's face changed),
   so a draft clip is one shot (the caller passes the first shot only) of the people already in its first frame */
const WORDY = /\b(text|overlay|caption|subtitle|title card|on-?screen|super(?:imposed)?|lower third|price tag|pops? up|typography|headline|words? appear|voice-?over|says?|asks?)\b/i;
export const motionOnly = (s) => one(String(s || '').replace(/["“”][^"“”]*["“”]/g, '').split(/(?<=[.!?])\s+/).filter((x) => !WORDY.test(x)).join(' ')).replace(/[\s,;:]+$/, '');
/* the words a scripted shot asks to show on screen ('Bold text overlay in the first second: "Over? Not yet."'), for headClip */
export const onScreen = (shot) => one(/\b(?:text|overlay|caption|title|super|headline|on-?screen)\b[^"“]{0,60}["“]([^"”]{2,80})["”]/i.exec(String(shot || ''))?.[1] || '');
export const VEO_NO_TEXT = 'Draw no words anywhere: no text overlays, captions, subtitles, titles, price tags, signs or logos; any words are added afterwards.';
export const VEO_SAME_PEOPLE = 'Only the people already in the first frame appear, each keeping the same face, hair, build and clothes throughout; no one new enters and no cuts.';
export function veoDraft(b) { return one(`${sentence(motionOnly(b.motion)) || 'A hand picks the product up and uses it.'} One continuous handheld phone shot at a natural pace that fills the whole frame; hands may move and use the product; the product keeps its shape, colours and brand mark as in the first frame. ${VEO_SAME_PEOPLE} ${b.sound ? 'Quiet room tone.' : ''} ${VEO_NO_TEXT}`); }
/* what a script line is: words shown on screen, a sound, or a line said. The jam writes "(On-screen text) Keeping your feet warm…",
   "(Sound effect) Loud crinkling" or a plain line; a reel final used to send all three as speech, so its joke never showed (21 Oct).
   Emoji go: video models draw them as garbage */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
/* one line can carry several parts: "(Sound effect) Squeaking crunch (On-screen text) Locked in a crunch prison" (Arata, 21 Oct) */
const TAG = /\(\s*(on-?screen(?: text)?|text overlay|caption|title|super|sound(?: effect)?|sfx|voice-?over|vo|said|voice)\s*\)\s*[:\-–]?\s*|^\s*(on-?screen(?: text)?|sound effect|sfx|voice-?over)\s*:\s*/gi;
export function beatWords(x = {}) {
  /* "(Sound effect: soft water)" carries its words inside the brackets (Arata, 21 Oct): read as "(Sound effect) soft water" */
  const raw = one(typeof x === 'string' ? '' : x.line).replace(/\(\s*(on-?screen(?: text)?|text overlay|caption|sound(?: effect)?|sfx|voice-?over|vo)\s*:\s*([^)]*)\)/gi, '($1) $2 '), out = { say: [], show: [], sfx: [] }, tidy = (t) => one(String(t || '').replace(EMOJI, '')).replace(/^["“]+|["”]+$/g, '');
  let last = 0, kind = 'say', m; TAG.lastIndex = 0;
  while ((m = TAG.exec(raw))) { const t = tidy(raw.slice(last, m.index)); if (t) out[kind].push(t); const k = m[1] || m[2]; kind = /sound|sfx/i.test(k) ? 'sfx' : /voice|vo|said/i.test(k) ? 'say' : 'show'; last = TAG.lastIndex; }
  const t = tidy(raw.slice(last)); if (t) out[kind].push(t);
  const show = out.show.join(' / ') || tidy(onScreen(typeof x === 'string' ? x : x.shot));
  return { say: out.say.join(' '), show, sfx: out.sfx.join(', ') };
}
/* Seedance 2.5: references by job, one summary sentence, then timed beats in whole seconds with no gaps; SFX in <>, lines in quotes,
   words on screen named exactly with where they sit */
export function seedanceBeats(b) {
  const S = Math.max(4, Math.min(30, Math.round(b.seconds || 6))); const beats = (b.beats || []).filter((x) => one(typeof x === 'string' ? x : x?.shot || x?.beat || x?.line)).slice(0, 6);
  const n = beats.length || 1, cut = (i) => Math.round((S * i) / n); let shows = 0;
  const body = beats.length ? beats.map((x, i) => { const shot = scrub(motionOnly(typeof x === 'string' ? x : x.shot || x.beat || '') || (typeof x === 'string' ? x : x.shot || x.beat || '')), w = beatWords(x); if (w.show) shows++;
    return `${cut(i)}-${cut(i + 1)}s: ${sentence(shot) || 'The same shot carries on.'}${w.show ? ` On screen, in clean bold white type in the top third, exactly: "${w.show.replace(/"/g, '”')}"` : ''}${w.sfx ? ` <${w.sfx.replace(/[<>]/g, '')}>` : ''}${w.say ? ` "${w.say.replace(/"/g, '”')}"` : ''}`; }).join('\n') : `0-${S}s: ${sentence(b.motion) || 'The camera pushes in slowly on the product.'}`;
  return [b.frame ? FRAME_LINE : `${refLines(b.refs)}`.trim(), one(`A ${b.title ? `${b.title}: ` : ''}${b.subject}${b.visual || b.scene ? `, ${[b.visual, b.scene].filter(Boolean).join(' ')}` : ''}. ${b.look} One camera move per beat, slow and steady.`), body, one(`${b.sound ? 'Quiet ambient sound that fits the room.' : 'No music.'} ${shows ? 'Only the on-screen words given appear, spelled exactly, one line at a time; no other subtitles or captions, no logo, no watermark.' : 'No subtitles, no captions, no logo, no watermark.'} ${keepLine({ brand: b.brand, text: !!shows, people: b.people })}`)].filter(Boolean).join('\n');
}
/* a clip that opens on the approved draft's first frame (sent as start_frame; Seedance takes a frame or references, not both) */
export const FRAME_LINE = 'The video opens exactly on the start frame given and moves on from it. Keep the product exactly as it appears in that frame: its shape, colours, label and brand mark; never redraw it.';
/* Seedance 2.0 reads numbered shots, not timestamps */
export function seedanceShots(b) { return seedanceBeats(b).replace(/^(\d+)-(\d+)s:/gm, (m, a, c, off, s) => `Shot ${s.slice(0, off).split('\n').filter((l) => /^\d+-\d+s:/.test(l)).length + 1}:`); }
/* Gemini Omni: one continuous shot with its own Audio line, nothing negative */
export function omniShot(b) { return one(`A single continuous ${Math.max(3, Math.min(10, b.seconds || 6))}-second shot. ${b.look} ${[b.visual, b.scene].filter(Boolean).join(' ')} The camera ${b.motion ? b.motion.replace(/^the camera\s*/i, '') : 'pushes in slowly'} as ${b.subject} stays in sharp focus. ${b.frame ? FRAME_LINE : refLines(b.refs)}`) + `\nAudio: ${b.sound ? 'quiet room tone, no music.' : 'silence.'}`; }
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
  'seedance-2.5': { ratios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], res: ['480p', '720p', '1080p'], seconds: [4, 30], refs: 30, maxChars: 30000, frames: { start: 'optional', end: 'optional' }, framesAlone: true, audio: 'optional' },
  'seedance-2.0': { ratios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], res: ['480p', '720p', '1080p', '4k'], seconds: [4, 6, 8, 10, 12, 15], refs: 9, maxChars: 30000, frames: { start: 'optional', end: 'optional' }, framesAlone: true, audio: 'optional' },
  'gemini-omni-1.1-flash': { ratios: ['16:9', '9:16'], res: ['360p', '720p', '1080p', '4k'], seconds: [3, 4, 5, 6, 7, 8, 9, 10], refs: 6, audio: 'always' }
};
const asNum = (r) => { const [a, b] = String(r).split(':').map(Number); return a && b ? a / b : NaN; };
/* the options a model takes, from list_models when Brew has it (live) and from MODEL_OPTS when Sloosh can't be asked: a field the
   live model doesn't list (Kling has no aspect ratio, Qwen no resolution) is left out of the quote rather than sent and refused */
export function optsOf(model, live = null) {
  if (live?.fields) { const f = live.fields, c = live.constraints || {}, nums = (xs) => (xs || []).map(Number).filter(Number.isFinite);
    return { live: true, ratios: f.aspectRatio || null, res: f.resolution || null, seconds: f.duration ? nums(f.duration) : null, quality: f.quality || null,
      refs: c.maxReferenceImages ?? null, videos: c.includeVideo ? c.maxReferenceVideos ?? null : 0, maxChars: c.maxPromptChars || null, frames: c.frames || null, framesAlone: !!c.framesExcludesReferenceImages,
      audio: live.controls?.generateAudio?.state || null }; }
  const o = MODEL_OPTS[model]; if (!o) return null;
  return { live: false, ratios: o.ratios, res: o.res, seconds: o.seconds ? (o.seconds.length === 2 && o.seconds[1] > 12 ? Array.from({ length: o.seconds[1] - o.seconds[0] + 1 }, (_, i) => o.seconds[0] + i) : o.seconds) : null, quality: null,
    refs: o.refs ?? null, videos: null, maxChars: o.maxChars || null, frames: o.frames || null, framesAlone: !!o.framesAlone, audio: o.audio || null };
}
/* snap a ratio, a resolution and a length onto what the model offers (nearest ratio by its number, the resolution asked or the best
   below it, the nearest length); sound only where the model lets it be switched (Gemini Omni, Grok and MiniMax always make sound and
   refuse the switch with owner_invalid_request, 19 Oct; Kling 2.5 never does) */
export function fitSettings(model, settings = {}, live = null) {
  const o = optsOf(model, live); if (!o) return settings; const out = { ...settings };
  const r = settings.aspect_ratio; if (r && o.ratios) { if (!o.ratios.includes(r)) { const want = asNum(r); const cands = o.ratios.filter((x) => x !== 'auto'); out.aspect_ratio = cands.length ? (Number.isFinite(want) ? cands.reduce((best, x) => (Math.abs(asNum(x) - want) < Math.abs(asNum(best) - want) ? x : best), cands[0]) : cands[0]) : 'auto'; } } else if (o.live && !o.ratios) delete out.aspect_ratio;
  const rank = (x) => ({ '512': 0.5, '360p': 0.36, '480p': 0.48, '720p': 0.72, '768p': 0.77, '1080p': 1.08, '1K': 1, '2K': 2, '2k': 2, '4K': 4, '4k': 4 })[x] ?? 1;
  const res = settings.resolution; if (res && o.res) { if (!o.res.includes(res)) { const want = rank(res); const below = o.res.filter((x) => rank(x) <= want); out.resolution = (below.length ? below : o.res).reduce((b, x) => (Math.abs(rank(x) - want) < Math.abs(rank(b) - want) ? x : b)); } } else if (o.live && !o.res) delete out.resolution;
  if (settings.duration != null) { if (o.seconds?.length) { const d = Math.round(settings.duration); out.duration = o.seconds.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b)); } else if (o.live) delete out.duration; }
  if ('sound' in out && o.audio && o.audio !== 'optional') delete out.sound;
  return out;
}
/* the next resolution down that the model offers (a reel at 1080p that would pass the day's limit is asked again at 720p) */
export function lowerRes(model, res, live = null) { const o = optsOf(model, live); const order = ['4k', '4K', '2k', '2K', '1080p', '1K', '768p', '720p', '480p', '360p'];
  const xs = (o?.res || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)); const i = xs.indexOf(res); return i >= 0 && i < xs.length - 1 ? xs[i + 1] : null; }
/* a prompt over the model's limit is cut at the last whole sentence that fits (the keep line is the last sentence on most renderers,
   so the cut comes out of the middle: the beats or the scene) */
export function trimPrompt(prompt, max) { const p = String(prompt || ''); if (!max || p.length <= max) return p;
  const lines = p.split('\n'), last = lines.length > 1 ? lines.pop() : '', room = max - (last ? last.length + 1 : 0); let head = lines.join('\n');
  if (room < 200) { head = p; } else if (head.length > room) { const cut = head.slice(0, room); const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n')); head = stop > room * 0.5 ? cut.slice(0, stop + 1) : cut; return last ? `${head}\n${last}` : head; }
  return p.slice(0, max); }
export function pickModel(b) {
  if (b.force) return { model: b.force, why: b.forceWhy || pickModel({ ...b, force: null }).why }; /* the model fitted to Sloosh's live list (finals.quote) */
  if (b.revise && b.kind !== 'video') return { model: MODELS.edit, why: 'a precise edit of the previous picture' }; /* never an image model for a reel */
  if (b.kind === 'video') return b.model && Object.values(MODELS).includes(b.model) ? { model: b.model, why: 'as picked' } : /^veo/.test(b.model || '') ? { model: MODELS.omni, why: 'one continuous shot (Veo is not on Sloosh)' } : { model: MODELS.video, why: 'timed beats, the product kept from its photo' };
  if (b.model === 'flux-2-pro' || (!(b.text || []).length && (b.brand.colors || []).some((c) => /^#[0-9a-f]{6}$/i.test(c)) && b.brand.exactColors)) return { model: MODELS.hex, why: 'exact brand colours' };
  if ((b.text || []).length >= 3) return { model: MODELS.type, why: 'several lines of type' };
  return { model: MODELS.image, why: (b.text || []).length ? 'finished work with the words set in the picture' : 'finished product photography' };
}

/* ---------- the two entry points ---------- */
/* a Gemini image or Veo draft: the same brief, rendered as a scene (Gemini image is the Nano Banana family) or a Veo shot */
export function buildDraft(spec = {}) { const b = brief(spec); return b.kind === 'video' ? { prompt: veoDraft(b), ratio: b.ratio, brief: b } : { prompt: nanoScene(b), ratio: b.ratio, brief: b }; }
/* a Sloosh final: the model, its prompt and the settings the chips carry (never in the words) */
export function buildFinal(spec = {}, live = null) {
  const b = brief(spec); const { model, why } = pickModel({ ...b, model: spec.model, revise: spec.revise, force: spec.forceModel || null });
  const prompt = spec.revise && b.kind !== 'video' ? reviseBrief({ text: b.text, keepLine: keepLine({ brand: b.brand, text: !!b.text.length, people: b.people }) }, spec.revise.change)
    : b.kind === 'video' ? (model === MODELS.videoShots ? seedanceShots(b) : model === MODELS.omni ? omniShot(b) : seedanceBeats(b))
    : model === MODELS.edit ? gptSpec(b) : model === MODELS.hex ? fluxHex(b) : nanoScene(b);
  const settings = fitSettings(model, b.kind === 'video' ? { aspect_ratio: b.ratio, resolution: spec.resolution || '1080p', duration: Math.max(4, Math.min(30, Math.round(b.seconds || 6))), sound: !!b.sound } : { aspect_ratio: b.ratio, resolution: spec.resolution || '2K' }, live);
  return { model, label: live?.label || MODEL_LABELS[model] || model, prompt: trimPrompt(prompt, optsOf(model, live)?.maxChars), settings, why, refs: b.refs, frame: b.frame, brief: b };
}
