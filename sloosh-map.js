// Which Sloosh model or public Space makes each kind of Brew creative, and how a frontend choice (size, length, count, quality,
// sound) becomes a Sloosh setting. One table, read live against list_models: a model Sloosh drops or a ratio it lacks falls to the
// next model in the list that has it, never to another provider. Read 27 Oct from Sloosh's live list_models and list_spaces
// (Nano Banana 2.1 = gemini-nano-banana-2.1 is Sloosh's default image model; Muse = muse-image-1.0, 1K only).

/* best first, per job */
export const ROUTES = {
  image: ['gemini-nano-banana-2.1', 'gemini-3-pro-image-preview', 'gpt-image-2.5-sunburst', 'flux-3-image', 'seedream-5-0-pro', 'muse-image-1.0'],
  /* a scene with many named things or a real place: Muse plans the layout and knows the world; 1K, so only when asked */
  concept: ['muse-image-1.0', 'gemini-nano-banana-2.1', 'gemini-3-pro-image-preview'],
  /* exact type is the point (a headline set in the picture, a poster, an infographic) */
  type: ['gemini-3-pro-image-preview', 'gpt-image-2.5-sunburst', 'gemini-nano-banana-2.1', 'ideogram-4.5'],
  /* change one thing, keep the rest */
  edit: ['gemini-nano-banana-2.1', 'gpt-image-2.5-sunburst', 'gemini-3-pro-image-preview', 'ideogram-4.5'],
  video: ['seedance-2.5', 'kling-v3-omni-video', 'happy-horse-1.1', 'kling-4.0', 'wan-3.0', 'seedance-2.0'],
  videoEdit: ['seedance-2.5', 'seedance-2.0', 'gemini-omni-1.1-flash']
};
/* draft vs final: the frontend's quality choice */
export const TIER = { draft: { image: '2K', video: '720p' }, final: { image: '4K', video: '1080p' } };

/* Sloosh's own public Spaces, by the Brew family they make (ids from list_spaces scope all, 27 Oct). A Space runs as it is; its
   form is filled from the card and the brand (sloosh-spaces.js prefill). The first live one wins. */
export const SPACES = {
  ugc: ['sp_d0c34b37-193b-4ad8-8da6-ab843270358e' /* UGC Selfie Video Ad */, 'sp_6f1e2ebc-3b72-46dd-a9ce-99fbbb6aa947' /* AI UGC Video Ad Creator */],
  'ugc-photo': ['sp_7afb2768-f65f-4d8f-a929-b722751ac0d1' /* Product in Hand (UGC) */],
  tryon: ['sp_a4048a80-a935-45aa-a784-a46010077c06' /* Virtual Try-On */],
  'tryon-video': ['sp_28e9fa7f-b696-4987-884d-5fb849985367' /* Virtual Try-On Demo Video */],
  'on-model': ['sp_f821717f-60f0-4590-abe3-3f81737aa78f' /* Flat-Lay to On-Model Shoot */, 'sp_ebecf8c9-c72e-4f97-b551-9c610ee34619' /* Fashion Editorial Shots */],
  'white-bg': ['sp_9fa6d972-60d3-4554-8f88-61cf36e7e704' /* White Background Product Studio */],
  angles: ['sp_ac71a05c-7c62-433e-9848-51c6ebea16ee' /* Product Multi-Angle Shots */],
  'in-scene': ['sp_ad1f2a61-3a61-4d66-b25f-e5c996b6d6c3' /* Product in Scene + Relight */],
  'ref-ad': ['sp_d3b3f14d-d7e3-4caf-bdfd-35a1aa979562' /* Swap Product into a Reference Ad */],
  poster: ['sp_67d46254-de4c-4b7c-a00c-f9b18d8f3d7a' /* Product Poster / Ad Creative */],
  'before-after': ['sp_b41e0982-6888-4b6a-aaf0-ea8bcb938f93' /* Before / After Ad */],
  'us-vs-them': ['sp_40fb9ab2-0a96-4f40-b697-07b090a1c66b' /* Us vs Them Comparison */],
  reviews: ['sp_1200adb7-ea36-46f9-acd5-2e65230a63ab' /* Review Card Creatives */],
  hooks: ['sp_3c53fe19-0bae-480c-a177-e475697fe0f8' /* Ad Hook Test Matrix */],
  banner: ['sp_837c0e5b-ea1e-4681-863d-e8dbe0a37613' /* Sale & Offer Banner Set */],
  'mail-header': ['sp_2dc8b733-29ac-4c9b-a5ef-b3aa16c87bc7' /* Email & WhatsApp Header */],
  covers: ['sp_84da3f2b-907b-4717-9d87-b594335e42d8' /* Social Profile Kit: profile image, highlight covers, banners */, 'sp_a0cf6c8f-a934-4b2e-9122-6cbf48b37ebd' /* Brand Icon Set */],
  thumbnail: ['sp_8a633fe1-a201-43d3-bc2e-13d9cfa47da6' /* YouTube Thumbnail Maker */],
  localise: ['sp_328fdcd6-0c4d-4ce2-a9b0-fe3dadbe31fd' /* Ad Localiser (Indian languages) */],
  resize: ['sp_65796cf2-f0fe-4e50-9981-71f97b82c797' /* Design Recomposer */, 'sp_e4bf89dc-bc67-4c5a-88d9-593f5d382552' /* Change Aspect Ratio */],
  storyboard: ['sp_01b1902f-9133-4f02-9322-d222dd723e52' /* Cinematic Ad Sequence */],
  'product-video': ['sp_b89fc5aa-1e02-4c72-83e4-151f497e475e' /* Multishot Product Clips */, 'sp_fd325488-9d55-4a42-8a9d-3328885c5fa6' /* Product Placement Video */, 'sp_1ffe8b9a-3da4-4391-93e2-20fe328159be' /* 360 Product Orbit Video */],
  'ref-video': ['sp_f6ebd361-3110-4981-86f2-1bfc5b978249' /* Create Ad of any product (from a reference video) */, 'shadow_clone_sloosh' /* Shadow Clone */],
  captions: ['sp_6d7c73b2-ec50-41d2-a1a7-cd3e6ef57aa5' /* Add Captions */],
  soundtrack: ['sp_df9f9909-da98-4b8e-bac3-714a28527409' /* Add a Soundtrack */],
  'talking-clip': ['sp_b2219522-1836-48fd-bd63-8764336a8e9f' /* Talking Clip */],
  'video-upscale': ['sp_84040385-b410-4182-9a5b-ac45943990d4' /* Video Upscale */],
  listing: ['sp_9fa6d972-60d3-4554-8f88-61cf36e7e704', 'sp_ac71a05c-7c62-433e-9848-51c6ebea16ee'],
  packaging: ['sp_ff2ac65f-9d6d-42da-aab4-f5941d306375' /* Packaging Mockup Pack */, 'sp_aa30bd47-c22d-4cf2-8675-da9e68bcf53c' /* Packaging from Dieline */]
};

/* a ratio Brew asks for → the nearest one a model offers (4:5 → 3:4 on a model without 4:5, never a landscape for a portrait) */
const NEAR = { '4:5': ['4:5', '3:4', '2:3', '9:16', '1:1'], '5:4': ['5:4', '4:3', '3:2', '16:9', '1:1'], '9:16': ['9:16', '2:3', '3:4'], '16:9': ['16:9', '3:2', '21:9'], '1:1': ['1:1'], '3:4': ['3:4', '4:5', '2:3'], '4:3': ['4:3', '5:4', '3:2'], '2:3': ['2:3', '3:4', '9:16'], '3:2': ['3:2', '4:3', '16:9'], '21:9': ['21:9', '16:9'] };
const RES_ORDER = ['512', '360p', '480p', '720p', '768p', '1K', '1080p', '2K', '2k', '4K', '4k'];
const has = (opts, v) => !opts?.length || opts.includes(String(v));
const nearest = (opts, want, order) => { if (!opts?.length) return want; if (opts.includes(String(want))) return String(want); const i = order.indexOf(String(want));
  const ranked = [...opts].sort((a, b) => Math.abs(order.indexOf(a) - i) - Math.abs(order.indexOf(b) - i) || order.indexOf(b) - order.indexOf(a)); return ranked[0]; };

/**
 * pick({ specs, job, ratio, tier, seconds, sound, refs, model }) → { model, ratio, resolution, seconds, sound, maxRefs, frames }
 * specs: sloosh.modelSpecs(mode) ({ default, models: { id: { fields, constraints, controls } } }). The first model in the job's
 * list that Sloosh offers today and that has the ratio wins; with none, the first offered model at its nearest ratio.
 */
export function pick({ specs = null, job = 'image', ratio = '4:5', tier = 'draft', seconds = null, sound = undefined, model = null } = {}) {
  /* a final picture leads with Nano Banana Pro (the most faithful small print and type; 27 Oct A/B on Arata), a draft with Nano Banana 2.1 (bolder, 2.6x cheaper) */
  const base = job === 'image' && tier === 'final' ? ['gemini-3-pro-image-preview', ...ROUTES.image] : ROUTES[job] || ROUTES.image;
  const vid = job === 'video' || job === 'videoEdit', live = specs?.models || {}, list = [model, ...base].filter(Boolean);
  const offered = Object.keys(live).length ? list.filter((m) => live[m]) : list; const pool = offered.length ? offered : [specs?.default || list[0]];
  const want = ratio === 'auto' ? 'auto' : String(ratio || (vid ? '9:16' : '4:5'));
  const exact = pool.find((m) => has(live[m]?.fields?.aspectRatio, want)) || pool.find((m) => (NEAR[want] || []).some((r) => has(live[m]?.fields?.aspectRatio, r))) || pool[0];
  const f = live[exact]?.fields || {}, c = live[exact]?.constraints || {}, ctl = live[exact]?.controls || {};
  const r = has(f.aspectRatio, want) ? want : ((NEAR[want] || []).find((x) => has(f.aspectRatio, x)) || f.aspectRatio?.[0] || want);
  const resolution = f.resolution?.length ? nearest(f.resolution, TIER[tier]?.[vid ? 'video' : 'image'] || TIER.draft.image, RES_ORDER) : undefined;
  const dur = vid && f.duration?.length ? f.duration.map(Number).sort((a, b) => Math.abs(a - (seconds || 8)) - Math.abs(b - (seconds || 8)))[0] : vid ? (seconds || 8) : undefined;
  const audio = ctl.generateAudio?.state === 'never' ? undefined : ctl.generateAudio?.state === 'always' ? undefined : vid ? (sound ?? true) : undefined;
  return { model: exact, ratio: r, resolution, seconds: dur, sound: audio, maxRefs: c.maxReferenceImages ?? 14, frames: c.frames || null, framesAlone: !!c.framesExcludesReferenceImages };
}

/* what a Brew frontend option becomes on Sloosh; sloosh-map.test.js walks every deliverable and option against this */
export const OPTION = {
  size: (v) => ({ ratio: v }), ratio: (v) => ({ ratio: v }), format: (v) => ({ ratio: FORMAT_RATIO[v] || v }),
  length: (v) => ({ seconds: +v }), seconds: (v) => ({ seconds: +v }), count: (v) => ({ count: Math.max(1, +v || 1) }),
  quality: (v) => ({ tier: /final|high|best|premium|4k/i.test(String(v)) ? 'final' : 'draft' }), sound: (v) => ({ sound: !!v }),
  style: (v) => ({ look: v }), direction: (v) => ({ look: v }), words: (v) => ({ text: v }), language: (v) => ({ language: v }),
  cast: (v) => ({ people: v }), products: (v) => ({ products: v }), reference: (v) => ({ refs: v }), brand: (v) => ({ brand: v }), make: (v) => ({ job: v })
};
export const FORMAT_RATIO = { post: '4:5', feed: '4:5', square: '1:1', story: '9:16', stories: '9:16', reel: '9:16', short: '9:16', tiktok: '9:16', pin: '2:3', pinterest: '2:3',
  banner: '16:9', youtube: '16:9', landscape: '16:9', email: '16:9', page: '16:9', hero: '16:9', whatsapp: '1:1', listing: '1:1', 'a+': '16:9', aplus: '16:9', cover: '1:1', carousel: '4:5', display: '16:9' };
/* a deliverable (data/deliverables.json layout + key) → how Sloosh makes it: a Space family, or a direct image / video job */
/* layouts that carry a picture or clip (data/deliverables.json): a mail, page or message gets its hero / header picture; acct, brief and
   check rows are words only */
export const CREATIVE_LAYOUTS = ['pic', 'set', 'reel', 'mail', 'page', 'msg', 'post'];
export function routeOf(d = {}) {
  if (d.layout && !CREATIVE_LAYOUTS.includes(d.layout)) return null;
  const k = `${d.id || d.key || ''} ${d.layout || ''} ${d.name || d.label || ''}`.toLowerCase();
  if (d.layout === 'mail' || d.layout === 'msg') return { space: 'mail-header', job: 'image', ratio: d.layout === 'msg' ? '1:1' : '16:9' };
  if (d.layout === 'page') return { job: 'image', ratio: '16:9' };
  if (/ugc|creator|testimonial video|founder video/.test(k)) return { space: 'ugc', job: 'video' };
  if (/try.?on|on.?model|lookbook/.test(k)) return { space: /video|reel/.test(k) ? 'tryon-video' : 'tryon', job: 'image' };
  if (/highlight|cover|profile/.test(k)) return { space: 'covers', job: 'image' };
  if (/thumbnail/.test(k)) return { space: 'thumbnail', job: 'image' };
  if (/listing|a\+|aplus|marketplace|amazon|flipkart|nykaa/.test(k)) return { job: 'image', set: true };
  if (/reel|video|short|tiktok|film|clip/.test(k) || d.layout === 'reel') return { job: 'video' };
  if (/carousel|set|stories|story|collection|catalog/.test(k) || d.layout === 'set') return { job: 'image', set: true };
  if (/poster|headline|infographic|banner/.test(k)) return { job: 'type' };
  return { job: 'image' };
}
