// Sloosh Spaces for Brew: which published Space fits a creative family, and the Space's form read from its input schema
// (get_space_input_schema, never hard-coded): one field type per input, a pre-fill rule for each from what Brew already
// holds (the card's product photo, the References tab, the copy, the brand), and the list of what the team still has to
// upload or type. The shapes come from Sloosh at run time, so every reader here is loose and says what it could not read.
import { JOBS } from './sloosh-prompt.js';

/* search terms per Brew family, in the order the sheet offers them */
export const FAMILY_SPACES = {
  'single image ad': ['Product Poster', 'Product Ad Grid', 'Swap Product into a Reference Ad', 'Product in Scene'],
  'carousel ad': ['Instagram Carousel', 'Product Multi-Angle'], 'instagram carousel': ['Instagram Carousel'], stories: ['Design Recomposer', 'Product Poster'],
  'product photo': ['White Background Product Studio', 'Product Multi-Angle Shots', 'Product in Scene'], banner: ['Collection Banner', 'Seasonal Ad Refresh'],
  reel: ['Product Placement Video', 'Multishot Product Clips', 'Cinematic Ad Sequence'], 'product video': ['Product Placement Video', '360 Product Orbit', 'Multishot Product Clips'],
  ugc: ['UGC Selfie Video Ad', 'UGC Unboxing Clip', 'Product in Hand'], resize: ['Design Recomposer'], season: ['Seasonal Ad Refresh'], apparel: ['Virtual Try-On', 'Ghost Mannequin'],
  listing: ['Amazon Listing Pack'], packaging: ['Packaging from Dieline', 'Colourway Generator']
};
export const familyOf = (format = '', kind = 'image') => { const f = String(format).toLowerCase();
  if (/ugc|creator|selfie|unboxing/.test(f)) return 'ugc'; if (/reel|video|clip/.test(f) || kind === 'video') return 'reel'; if (/carousel/.test(f)) return /instagram/.test(f) ? 'instagram carousel' : 'carousel ad';
  if (/stor(y|ies)/.test(f)) return 'stories'; if (/banner|hero/.test(f)) return 'banner'; if (/listing|amazon|marketplace/.test(f)) return 'listing'; if (/packag|dieline/.test(f)) return 'packaging';
  if (/try-?on|garment|mannequin|apparel/.test(f)) return 'apparel'; if (/product photo|packshot|studio/.test(f)) return 'product photo'; return 'single image ad'; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/* the Spaces from list_spaces that match a family, best first (name words, then description), at most three */
export function matchSpaces(list = [], family = 'single image ad', max = 3) {
  const items = Array.isArray(list) ? list : list?.spaces || list?.items || []; const terms = (FAMILY_SPACES[family] || FAMILY_SPACES['single image ad']).map(norm);
  const score = (sp) => { const n = norm(sp.name || sp.title), d = norm(sp.description || sp.summary); let best = 0; terms.forEach((t, i) => { const w = terms.length - i; if (n.includes(t)) best = Math.max(best, 10 * w); else if (t.split(' ').every((x) => n.includes(x))) best = Math.max(best, 6 * w); else if (d.includes(t)) best = Math.max(best, 2 * w); }); return best; };
  return items.map((sp) => ({ sp, s: score(sp) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.sp);
}

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
