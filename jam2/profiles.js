// Product profiles: each product read once by vision from its catalog photos and kept per brand (private/product-profiles.json):
// what it is, its real colours and materials, one item or a kit (and what is in it), printed words on it, its size against a hand,
// how it's used, and which photo is the cleanest reference. The creative engine reads it so the art director never guesses a
// colour, the shoot anchors on the best photo (a clean packshot, not a lifestyle shot or a size chart), a kit is held item by
// item, and a product with no usable photo is asked for before anything is spent. A read that fails is never saved as known.
const FILE = 'private/product-profiles.json';
const tidy = (s, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const SCHEMA = { type: 'object', additionalProperties: false, required: ['what', 'colours', 'kit', 'items', 'best', 'usable'], properties: {
  what: { type: 'string', description: 'What the product is, in plain words (e.g. "plush bootie slippers that heat over USB")' },
  colours: { type: 'string', description: 'Its real colours as they look in the photos' },
  materials: { type: 'string' },
  kit: { type: 'boolean', description: 'More than one item sold together' },
  items: { type: 'array', items: { type: 'string' }, description: 'Each item with its look, when it is a kit; else one entry' },
  label: { type: 'string', description: 'Printed words or logos that must stay exact, or empty' },
  sides: { type: 'array', items: { type: 'string' }, description: 'Which sides the photos show: front, back, side, top, bottom, in use' },
  size: { type: 'string', description: 'Its size against a hand or a body' },
  use: { type: 'string', description: 'How and where it is used' },
  best: { type: 'integer', description: 'Index (0-based) of the photo that shows the whole product most clearly on a plain background' },
  usable: { type: 'boolean', description: 'At least one photo shows the real product clearly enough to recreate it' },
  why: { type: 'string', description: 'If not usable: what photo is missing' } } };

export function createProfiles({ packs, ai = null, fileOf, isMock = () => false, spend = () => true, log = console }) {
  const mem = new Map();
  const load = async (slug) => { if (mem.has(slug)) return mem.get(slug); const x = (await packs.getJSON(slug, FILE, null).catch(() => null)) || {}; mem.set(slug, x); return x; };
  const keyOf = (p) => String(p?.handle || p?.t || p?.title || p?.name || '').toLowerCase().slice(0, 120);
  const photosOf = (p) => [...new Set([p?.img, ...((p?.images) || [])].filter(Boolean))].slice(0, 6); /* the main photo, the brand's own extra views, then the catalog's */
  /* the profile of one catalog product: from the store when read before (and its photos haven't changed), else read now */
  async function of(slug, p, { force = false } = {}) {
    if (!p) return null; const key = keyOf(p), photos = photosOf(p); if (!key || !photos.length) return null;
    const all = await load(slug), have = all[key];
    if (!force && have && have.photos?.join('|') === photos.join('|')) return have;
    if (isMock() || !ai || !spend('text', slug)) return have || null;
    const fs = await import('node:fs'), files = (await Promise.all(photos.map((u) => fileOf(u).catch(() => null))));
    const img = (f) => { const b = fs.readFileSync(f); return { type: 'image', source: { type: 'base64', media_type: b[0] === 0x89 ? 'image/png' : b.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : 'image/jpeg', data: b.toString('base64') } }; };
    const shown = files.map((f, i) => (f ? { f, i } : null)).filter(Boolean); if (!shown.length) return have || null;
    try {
      const r = await ai.call({ model: 'sonnet', tag: 'product_profile', max: 1500, effort: 'low', schema: SCHEMA, messages: [{ role: 'user', content: [
        ...shown.map((x) => img(x.f)), { type: 'text', text: `These ${shown.length} photos are the store's own photos of "${tidy(p.t || p.title || p.name, 160)}" (some may show its back, side or a close-up). Describe the real product exactly as it looks from every side shown, including what is printed on its back, for a photographer who must recreate it. "best" is the index of the clearest whole-product photo on a plain background (photos are numbered 0 to ${shown.length - 1}); a size chart, a graphic or a crowded lifestyle shot is not a good reference.` }] }] });
      const j = r.json || {}; const best = Number.isInteger(j.best) && shown[j.best] ? shown[j.best].i : 0;
      const prof = { name: tidy(p.t || p.title || p.name, 160), photos, best: photos[best], what: tidy(j.what, 200), colours: tidy(j.colours, 160), materials: tidy(j.materials, 160), kit: !!j.kit,
        items: (j.items || []).slice(0, 8).map((x) => tidy(x, 140)), label: tidy(j.label, 160), sides: (j.sides || []).slice(0, 6).map((x) => tidy(x, 20).toLowerCase()), size: tidy(j.size, 120), use: tidy(j.use, 200), usable: j.usable !== false, why: tidy(j.why, 200), at: Date.now() };
      all[key] = prof; await packs.put(slug, FILE, all).catch((e) => log.warn?.('[profiles] save', e.message)); return prof;
    } catch (e) { log.warn?.('[profiles] read', slug, key, e.message); return have || null; }
  }
  /* a team correction (the Brand Book's product check): what they changed wins over the read */
  async function correct(slug, key, patch = {}) { const all = await load(slug), p = all[key]; if (!p) return null;
    for (const k of ['what', 'colours', 'materials', 'label', 'size', 'use']) if (patch[k] != null) p[k] = tidy(patch[k], 200);
    if (patch.best && p.photos.includes(patch.best)) p.best = patch.best; if (patch.items) p.items = patch.items.slice(0, 8).map((x) => tidy(x, 140)); if (patch.kit != null) p.kit = !!patch.kit;
    p.confirmed = { at: Date.now(), by: patch.by || null }; await packs.put(slug, FILE, all); return p; }
  const list = async (slug) => Object.entries(await load(slug)).map(([key, v]) => ({ key, ...v }));
  return { of, correct, list, keyOf };
}
