// Sloosh Spaces for Brew: which published Space fits a creative family, and the Space's form read from its input schema
// (get_space_input_schema, never hard-coded): one field type per input, a pre-fill rule for each from what Brew already
// holds (the card's product photo, the References tab, the copy, the brand), and the list of what the team still has to
// upload or type. The shapes come from Sloosh at run time, so every reader here is loose and says what it could not read.
import { JOBS } from './sloosh-prompt.js';

/* the published Spaces per Brew family, by the titles list_spaces really returns (read 2026-10-16, tools/sloosh-probe.mjs; the
   ids are pinned in SPACE_IDS so a renamed Space still matches), in the order the sheet offers them */
export const FAMILY_SPACES = {
  'single image ad': ['Product Poster / Ad Creative', '3×3 Product Ad Grid', 'Swap Product into a Reference Ad', 'Product in Scene + Relight'],
  'carousel ad': ['Instagram Carousel', 'Product Multi-Angle Shots'], 'instagram carousel': ['Instagram Carousel'], stories: ['Design Recomposer', 'Product Poster / Ad Creative'],
  'product photo': ['White Background Product Studio', 'Product Multi-Angle Shots', 'Product in Scene + Relight'], banner: ['Collection Banner', 'Seasonal Ad Refresh'],
  reel: ['Product Placement Video', 'Multishot Product Clips', 'Cinematic Ad Sequence'], 'product video': ['Product Placement Video', '360 Product Orbit Video', 'Multishot Product Clips'],
  ugc: ['UGC Selfie Video Ad', 'UGC Unboxing Clip', 'Product in Hand (UGC)'], resize: ['Design Recomposer'], season: ['Seasonal Ad Refresh'], apparel: ['Virtual Try-On', 'Ghost Mannequin', 'On-Model Studio Shoot'],
  listing: ['Amazon Listing Pack'], packaging: ['Packaging from Dieline', 'Colourway Generator']
};
export const SPACE_IDS = {
  'Product Poster / Ad Creative': 'sp_67d46254-de4c-4b7c-a00c-f9b18d8f3d7a', '3×3 Product Ad Grid': 'sp_0516fd12-81d9-4bde-b3e0-36c94d902561', 'Swap Product into a Reference Ad': 'sp_d3b3f14d-d7e3-4caf-bdfd-35a1aa979562',
  'Product in Scene + Relight': 'sp_ad1f2a61-3a61-4d66-b25f-e5c996b6d6c3', 'Instagram Carousel': 'sp_cd0e5323-1206-4b40-ac77-769e69e64d22', 'Product Multi-Angle Shots': 'sp_ac71a05c-7c62-433e-9848-51c6ebea16ee',
  'Design Recomposer': 'sp_65796cf2-f0fe-4e50-9981-71f97b82c797', 'White Background Product Studio': 'sp_9fa6d972-60d3-4554-8f88-61cf36e7e704', 'Collection Banner': 'sp_d417953b-7147-4d0e-ab4d-dbd8710ad2d2',
  'Seasonal Ad Refresh': 'sp_5a0357a9-3788-41a5-aac8-a47be3b83ce0', 'Product Placement Video': 'sp_fd325488-9d55-4a42-8a9d-3328885c5fa6', 'Multishot Product Clips': 'sp_b89fc5aa-1e02-4c72-83e4-151f497e475e',
  'Cinematic Ad Sequence': 'sp_01b1902f-9133-4f02-9322-d222dd723e52', '360 Product Orbit Video': 'sp_1ffe8b9a-3da4-4391-93e2-20fe328159be', 'UGC Selfie Video Ad': 'sp_d0c34b37-193b-4ad8-8da6-ab843270358e',
  'UGC Unboxing Clip': 'sp_a1a4d482-d3be-43b7-95ac-7697c6970e23', 'Product in Hand (UGC)': 'sp_7afb2768-f65f-4d8f-a929-b722751ac0d1', 'Virtual Try-On': 'sp_a4048a80-a935-45aa-a784-a46010077c06',
  'Ghost Mannequin': 'sp_4c40a381-cdd1-46de-b5e9-a4767bad432c', 'On-Model Studio Shoot': 'sp_7e415af3-2fec-4ce8-b900-e131ac5743c0', 'Amazon Listing Pack': 'sp_dacdf1ce-6832-4fd3-b13d-6349e383df9f',
  'Packaging from Dieline': 'sp_aa30bd47-c22d-4cf2-8675-da9e68bcf53c', 'Colourway Generator': 'sp_2b2d6da5-2223-412e-a812-456661cddc04'
};
export const familyOf = (format = '', kind = 'image') => { const f = String(format).toLowerCase();
  if (/ugc|creator|selfie|unboxing/.test(f)) return 'ugc'; if (/reel|video|clip/.test(f) || kind === 'video') return 'reel'; if (/carousel/.test(f)) return /instagram/.test(f) ? 'instagram carousel' : 'carousel ad';
  if (/stor(y|ies)/.test(f)) return 'stories'; if (/banner|hero/.test(f)) return 'banner'; if (/listing|amazon|marketplace/.test(f)) return 'listing'; if (/packag|dieline/.test(f)) return 'packaging';
  if (/try-?on|garment|mannequin|apparel/.test(f)) return 'apparel'; if (/product photo|packshot|studio/.test(f)) return 'product photo'; return 'single image ad'; };
const norm = (s) => String(s || '').toLowerCase().replace(/×/g, 'x').replace(/[^a-z0-9]+/g, ' ').trim();
/* the Spaces from list_spaces ({ spaces: [{ spaceId, title, description, outputTypes }] }) that match a family: the pinned id first,
   then the title, then the description; best first, at most three */
export function matchSpaces(list = [], family = 'single image ad', max = 3) {
  const items = Array.isArray(list) ? list : list?.spaces || list?.items || []; const names = FAMILY_SPACES[family] || FAMILY_SPACES['single image ad']; const terms = names.map(norm), ids = names.map((n) => SPACE_IDS[n] || null);
  const score = (sp) => { const id = sp.spaceId || sp.id, n = norm(sp.name || sp.title), d = norm(sp.description || sp.summary); let best = 0; terms.forEach((t, i) => { const w = terms.length - i; if (ids[i] && id === ids[i]) best = Math.max(best, 12 * w); else if (n === t || n.includes(t)) best = Math.max(best, 10 * w); else if (t.split(' ').every((x) => n.includes(x))) best = Math.max(best, 6 * w); else if (d.includes(t)) best = Math.max(best, 2 * w); }); return best; };
  return items.map((sp) => ({ sp, s: score(sp) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.sp);
}
/* a Space's form as get_space_input_schema returns it: { form: { widget_props: { steps: [{ formSchema: { fields: [{ id, type, label, required, validation, props }] } }] } } };
   quote_space takes { input: { <field id>: value } } with an https URL for an image-upload field (checked live 2026-10-16) */
const WIDGET_TYPE = { 'image-upload': 'image', 'images-upload': 'images', 'file-upload': 'image', 'video-upload': 'video', 'audio-upload': 'audio', text: 'text', textarea: 'text', number: 'number', select: 'select', dropdown: 'select', radio: 'select', checkbox: 'boolean', toggle: 'boolean', switch: 'boolean', color: 'color', 'color-picker': 'color' };
export function widgetFields(form) { const steps = form?.widget_props?.steps || form?.steps || []; const out = [];
  for (const st of steps) for (const f of st?.formSchema?.fields || st?.fields || []) { const accept = (f.validation?.acceptedTypes || []).join(' '); let type = WIDGET_TYPE[f.type] || null;
    if (/upload/.test(f.type || '') && /video/.test(accept) && !/image/.test(accept)) type = 'video'; if (f.type === 'image-upload' && (f.props?.multiple || f.validation?.maxFiles > 1)) type = 'images';
    const opts = f.props?.options || f.options || []; if (!type) type = opts.length ? 'select' : 'text';
    out.push({ key: f.id, type, label: f.label || f.id, help: f.props?.placeholder || f.props?.help || f.description || '', required: !!f.required, step: st.label || null,
      options: opts.map((o) => (typeof o === 'object' ? { value: o.value ?? o.id, label: o.label || o.name || String(o.value ?? o.id) } : { value: o, label: String(o) })), min: f.validation?.min ?? f.props?.min ?? null, max: f.validation?.max ?? f.validation?.maxFiles ?? f.props?.max ?? null, default: f.props?.defaultValue ?? f.default ?? null }); }
  return out; }

/* ---------- the form: one field per input, typed from the schema and the input's name ---------- */
const NAME_TYPE = [[/\b(video|clip|footage|motion ref)/i, 'video'], [/\b(audio|voice ?over|music|track|sound)\b/i, 'audio'], [/\b(colou?r|hex|palette)\b/i, 'color'],
  [/\b(folder|batch|directory)\b/i, 'folder'], [/\b(photo|image|picture|img|logo|frame|face|creator|model|person|background|scene|reference|ad|dieline|garment|mannequin|shot|still|pack)\b/i, 'image']];
export const typeOf = (key, def = {}) => {
  const t = def.type, fmt = String(def.format || def['x-type'] || def['x-input'] || def.widget || def.input_type || def.kind || '').toLowerCase(), items = def.items || {};
  if (/image|photo|picture/.test(fmt)) return t === 'array' ? 'images' : 'image'; if (/video/.test(fmt)) return 'video'; if (/audio|voice|music/.test(fmt)) return 'audio'; if (/colou?r|hex/.test(fmt)) return 'color'; if (/folder|batch/.test(fmt)) return 'folder';
  if (def.enum || items.enum) return 'select'; if (t === 'boolean') return 'boolean'; if (t === 'number' || t === 'integer') return 'number';
  const byName = NAME_TYPE.find(([re]) => re.test(`${key} ${def.title || ''} ${def.description || ''}`))?.[1];
  if (byName === 'image') return t === 'array' ? 'images' : (/uri|url|asset/.test(fmt) || /\b(asset|media|file|upload|uri|url)\b/i.test(`${def.description || ''} ${fmt}`) || t === 'array' || t === 'object' || !t) ? 'image' : 'text';
  if (byName) return byName; if (t === 'array') return (items.type === 'string' && !/uri|asset/.test(String(items.format || ''))) ? 'list' : 'images'; return 'text';
};
export function formOf(schema = {}) {
  if (schema?.widget_props || schema?.form?.widget_props || (Array.isArray(schema?.steps) && schema.steps[0]?.formSchema)) return widgetFields(schema.form?.widget_props ? schema.form : schema);
  const props = schema.properties || schema.inputs || schema.fields || {}; const req = new Set(schema.required || []); const list = Array.isArray(props) ? props : Object.entries(props).map(([key, d]) => ({ key, ...(d || {}) }));
  return list.map((d) => { const key = d.key || d.name || d.id; const type = typeOf(key, d); return { key, type, label: d.title || d.label || key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), help: d.description || '', required: req.has(key) || !!d.required,
    options: (d.enum || d.items?.enum || d.options || []).map((o) => (typeof o === 'object' ? { value: o.value ?? o.id, label: o.label || o.name || String(o.value ?? o.id) } : { value: o, label: String(o) })),
    min: d.minimum ?? d.min ?? d.minItems ?? null, max: d.maximum ?? d.max ?? d.maxItems ?? null, default: d.default ?? null }; });
}
/* what Brew already holds for each field; what the team still has to give is returned as missing (required first) */
export function prefill(fields = [], ctx = {}) {
  const refs = ctx.refs || [], byJob = (j) => refs.filter((r) => r.job === j), product = ctx.productPhoto || null, copy = ctx.copy || {}, brand = ctx.brand || {};
  const text = (f) => { const k = norm(`${f.key} ${f.label}`); if (/headline|title|hook/.test(k)) return copy.headline || copy.overlay || ''; if (/brief|description|scene|prompt|concept|instruction/.test(k)) return ctx.brief || ''; if (/script|voice ?over|line|caption/.test(k)) return copy.script || copy.primaryText || ''; if (/product ?name|product\b/.test(k)) return ctx.productName || ''; if (/offer|cta|button/.test(k)) return copy.cta || copy.offer || ''; if (/brand/.test(k)) return brand.name || ''; return ''; };
  const image = (f, many) => { const k = norm(`${f.key} ${f.label} ${f.help}`); const pick = /logo/.test(k) ? byJob('logo') : /creator|person|model|face|selfie|influencer/.test(k) ? byJob('person') : /background|scene|place|location/.test(k) ? byJob('scene') : /reference ad|style|look|inspiration|ad\b/.test(k) ? byJob('style') : [...(product ? [product] : []), ...byJob('product')];
    const urls = pick.map((r) => r.url || r).filter(Boolean); return many ? urls.slice(0, f.max || 10) : urls[0] || null; };
  const values = {}, missing = [], filled = {};
  for (const f of fields) { let v = null, from = null;
    if (f.type === 'image') { v = image(f, false); from = v ? 'your photos' : null; } else if (f.type === 'images') { v = image(f, true); if (!v.length) v = null; from = v ? 'your photos' : null; }
    else if (f.type === 'video') { v = byJob('other').concat(refs).find((r) => r.kind === 'video')?.url || null; from = v ? 'your references' : null; }
    else if (f.type === 'text') { v = text(f) || null; from = v ? 'the card' : null; } else if (f.type === 'select') { const k = norm(f.key + ' ' + f.label); const want = /aspect|ratio|format/.test(k) ? ctx.ratio : /lang/.test(k) ? ctx.language : /country|market|region/.test(k) ? ctx.country : null;
      const hit = want && f.options.find((o) => norm(o.value) === norm(want) || norm(o.label) === norm(want)); v = hit ? hit.value : f.default ?? f.options[0]?.value ?? null; from = hit ? 'the card' : v != null ? 'the Space’s default' : null; }
    else if (f.type === 'number') { const k = norm(f.key + ' ' + f.label); v = /second|length|duration/.test(k) && ctx.seconds ? Math.min(f.max ?? 1e9, Math.max(f.min ?? 0, ctx.seconds)) : f.default ?? f.min ?? null; from = v != null ? 'the draft' : null; }
    else if (f.type === 'boolean') { v = f.default ?? (/sound|audio/.test(norm(f.key)) ? !!ctx.sound : /caption|subtitle/.test(norm(f.key)) ? false : null); from = v != null ? 'the brand’s defaults' : null; }
    else if (f.type === 'color') { v = (brand.colors || [])[0] || null; from = v ? 'the brand' : null; } else if (f.type === 'folder') { v = null; } else if (f.type === 'list') { v = null; }
    if (v != null) { values[f.key] = v; filled[f.key] = from; } else if (f.required) missing.push({ key: f.key, type: f.type, label: f.label, why: f.type === 'folder' ? 'Batch folders are not in Brew yet.' : `Upload or type ${f.label.toLowerCase()}.` }); }
  return { values, filled, missing };
}
export const JOB_FOR_FIELD = (f) => { const k = norm(`${f.key} ${f.label} ${f.help}`); return /logo/.test(k) ? 'logo' : /creator|person|model|face|selfie|influencer/.test(k) ? 'person' : /background|scene|place|location/.test(k) ? 'scene' : /reference ad|style|look|inspiration/.test(k) ? 'style' : /product|photo|pack/.test(k) ? 'product' : 'other'; };
export { JOBS };
