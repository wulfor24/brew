// Jam v2: the Brand Book. Everything a deliverable is made from, in one place: the kit (logo, colours with roles, fonts),
// the look (their own best posts and ads as style refs), the words (voice, golden captions, claims they may make, words they
// never use), the spoken voice and music, the cast and places, how much AI they're comfortable with, and the taste Brew learns
// from their edits. Filled from the store read (profile.json, brief.json, config.json) the first time, then kept in
// brands/<slug>/private/brandbook.json. What the team confirms is marked; the rest says "from the read".
// Until Jam v2 is merged, taste learned here stays here: it never writes brand-memory, so v1 drafts don't change.
const FILE = 'private/brandbook.json';
const tidy = (s, n = 240) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const hexOk = (c) => /^#[0-9a-f]{3,8}$/i.test(String(c || ''));
const lum = (hex) => { const h = String(hex).replace('#', ''), f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

export const COMFORT = {
  people: { label: 'People on camera', options: { none: 'No people', hands: 'Hands only', 'ai-cast': 'AI people', consented: 'Our own people (with consent)' } },
  aiVoice: { label: 'AI voice', options: { yes: 'Yes', no: 'No, real voices only' } },
  testimonials: { label: 'UGC-style testimonials', options: { yes: 'Yes, real claims only', no: 'No' } },
  how: { label: 'Default way things get made', options: { ai: 'AI makes it', 'ai+people': 'AI + people', brief: 'Brief people' } }
};
export const VOICES = { site: 'Like the site', warmer: 'Warmer', sharper: 'Sharper', plainer: 'Plainer' };
/* the spoken narrator: Gemini TTS voices today (vertex), ElevenLabs when its adapter is wired; picked once, used in every video */
export const NARRATORS = [{ id: 'Kore', label: 'Kore · warm, clear (female)' }, { id: 'Puck', label: 'Puck · upbeat (male)' }, { id: 'Aoede', label: 'Aoede · calm (female)' }, { id: 'Charon', label: 'Charon · deep, steady (male)' }];
export const MOODS = ['warm acoustic', 'upbeat pop', 'calm lo-fi', 'cinematic', 'no music'];

export function createBrandbook({ packs, log = console, now = () => Date.now() }) {
  const cache = new Map();
  const P = (slug, n, d) => packs.getJSON(slug, n, d).catch(() => d);

  /* the kit, style refs, words and claims as the read found them */
  async function fromRead(slug) {
    const [profile, brief, config] = await Promise.all([P(slug, 'profile.json', null), P(slug, 'brief.json', null), P(slug, 'config.json', {})]);
    const id = profile?.identity || {}, colors = (id.colors || []).filter(hexOk).slice(0, 5);
    const dark = colors.filter((c) => lum(c) < 0.35), light = colors.filter((c) => lum(c) > 0.7);
    const kit = { logo: id.logo || null, mark: id.mark || null, colors: colors.map((hex, i) => ({ hex, role: i === 0 ? 'primary' : dark.includes(hex) ? 'ink' : light.includes(hex) ? 'background' : 'accent' })),
      fonts: { heading: id.fonts?.heading || null, body: id.fonts?.body || id.fonts?.heading || null }, accent: colors.find((c) => !light.includes(c)) || '#111111', ink: '#ffffff', from: 'read' };
    const ig = profile?.socials?.instagram?.posts || [], ads = profile?.ads?.own?.items || [];
    const styleRefs = [...ig.filter((x) => x.img).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 4).map((x) => ({ src: x.img, label: `Instagram ${x.kind || 'post'}${x.likes ? `, ${x.likes} likes` : ''}`, from: 'read' })),
      ...ads.filter((x) => x.poster).sort((a, b) => (b.days || 0) - (a.days || 0)).slice(0, 2).map((x) => ({ src: x.poster, label: `Own ad, running ${x.days || '?'} days`, from: 'read' }))].slice(0, 6);
    const golden = ig.filter((x) => x.caption && x.caption.length > 30).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 3).map((x) => ({ text: tidy(x.caption, 400), from: 'read', likes: x.likes || null }));
    if (golden.length < 3) ads.filter((x) => x.body || x.hook).sort((a, b) => (b.days || 0) - (a.days || 0)).slice(0, 3 - golden.length).forEach((x) => golden.push({ text: tidy([x.hook, x.body].filter(Boolean).join(' — '), 400), from: 'read', days: x.days || null }));
    /* config.banned is a regex: the gate runs it as one (claims.js bannedHits), and the writer gets its top-level alternatives in words.
       Splitting inside groups turned "heal(?:your|their|the)…" into the words "the", "their" (QA 22 Oct) */
    const neverRe = String(config?.banned || '').trim() || null;
    const top = []; { let d = 0, cur = ''; for (const ch of String(neverRe || '')) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d = Math.max(0, d - 1); if (ch === '|' && d === 0) { top.push(cur); cur = ''; } else cur += ch; } if (cur) top.push(cur); }
    const banned = top.map((x) => x.replace(/\(\?:/g, '(').replace(/\\[bsdw]\*?|\\[bsdw]\+?|[\^$]/g, ' ').replace(/\[([^\]]*)\]\??/g, '').replace(/\(([^()|]*)\|[^()]*\)\??/g, '$1').replace(/[()?*+\\]/g, '').replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 4).slice(0, 20);
    const claims = (brief?.claims || []).slice(0, 8).map((x) => ({ text: tidy(x.claim, 140), basis: tidy(x.basis, 80), product: x.product || null, from: 'read' }));
    const reviews = (profile?.reviews?.quotes || []).slice(0, 8).map((q) => ({ text: tidy(q.text, 220), rating: q.rating || null, product: q.product || null, src: q.src || 'review' }));
    return { name: profile?.name || brief?.name || slug, host: profile?.host || null, category: profile?.category || null, kit, styleRefs, golden, claims, never: banned, neverRe, reviews,
      personas: (brief?.personas || []).slice(0, 4).map((p) => ({ name: p.name, who: tidy(p.who, 120), job: tidy(p.job, 100) })), language: (brief?.language || []).slice(0, 10), currency: profile?.currency || null };
  }

  const blank = () => ({ v: 1, voice: { written: 'site', narrator: 'Kore', clones: [] }, music: { moods: ['warm acoustic'], never: ['trending audio we have no rights to'] },
    comfort: { people: 'ai-cast', aiVoice: 'yes', testimonials: 'yes', how: 'ai' }, cast: [], places: [], pinned: { golden: [], styleRefs: [] }, removed: { golden: [], styleRefs: [] },
    kitEdits: {}, claimsAllowed: [], neverSay: [], taste: { counts: {}, rules: [] }, confirmed: {}, updatedAt: null });

  async function load(slug, { fresh = false } = {}) {
    if (!fresh && cache.has(slug)) return cache.get(slug);
    /* a saved Brand Book that couldn't be read is never replaced by a blank one: the error goes to the page and nothing is cached or saved */
    const [got, read] = await Promise.all([packs.readJSON ? packs.readJSON(slug, FILE) : P(slug, FILE, null).then((data) => ({ ok: true, data })), fromRead(slug)]);
    if (!got.ok) throw Object.assign(new Error('The Brand Book couldn’t be read just now. Try again in a moment; nothing was changed.'), { status: 503 });
    const saved = got.data; const bb = { ...blank(), ...(saved || {}), read };
    cache.set(slug, bb); return bb;
  }
  async function save(slug, bb) { const { read, ...keep } = bb; keep.updatedAt = now(); cache.set(slug, bb); await (packs.putStrict || packs.put)(slug, FILE, keep).catch((e) => log.warn?.('[brandbook] save', slug, e.message)); return bb; }

  /* the Brand Book as the page and every maker read it: confirmed edits over the read */
  function view(bb) {
    const r = bb.read || {}, k = { ...r.kit, ...bb.kitEdits, fonts: { ...(r.kit?.fonts || {}), ...(bb.kitEdits?.fonts || {}) } };
    if (bb.kitEdits?.colors) k.colors = bb.kitEdits.colors;
    const colors = (k.colors || []).map((c) => c.hex), accent = (k.colors || []).find((c) => c.role === 'accent' || c.role === 'primary')?.hex || k.accent || '#111111';
    const styleRefs = [...bb.pinned.styleRefs, ...(r.styleRefs || [])].filter((x) => !bb.removed.styleRefs.includes(x.src)).slice(0, 6);
    const golden = [...bb.pinned.golden, ...(r.golden || [])].filter((x) => !bb.removed.golden.includes(x.text)).slice(0, 6);
    return { name: r.name, host: r.host, category: r.category, kit: { ...k, colors, accent, roles: k.colors || [] }, styleRefs, golden,
      claims: [...bb.claimsAllowed, ...(r.claims || [])], never: [...new Set([...(r.never || []), ...bb.neverSay])], neverRe: r.neverRe || null, neverSay: bb.neverSay || [], reviews: r.reviews || [], personas: r.personas || [], language: r.language || [],
      voice: bb.voice, music: bb.music, comfort: bb.comfort, cast: bb.cast, places: bb.places, taste: bb.taste, confirmed: bb.confirmed, currency: r.currency };
  }

  /* what each family still needs, in plain words, one ask at a time (the readiness meter) */
  function readiness(v, { products = 0 } = {}) {
    const need = (ok, what) => (ok ? null : what);
    return {
      statics: [need(products > 0, 'a clear photo of each product'), need(v.kit.logo, 'your logo'), need(v.kit.colors?.length, 'your brand colours')].filter(Boolean),
      video: [need(v.voice?.narrator, 'pick a narrator voice'), need(v.music?.moods?.length, 'pick a music mood')].filter(Boolean),
      ugc: [need(v.comfort?.people !== 'none', 'allow people on camera (How much AI)'), need(v.cast?.length || v.comfort?.people === 'ai-cast', 'add a cast member')].filter(Boolean),
      words: [need(v.golden?.length, 'pin 2–3 captions that sound like you')].filter(Boolean)
    };
  }

  /* the block every writer and maker reads: rules first, then the brand's own words, then taste */
  function promptBlock(v, { recipe = null } = {}) {
    const L = [];
    if (v.never?.length) L.push(`Never use these words or claims: ${v.never.join(', ')}.`);
    if (v.claims?.length) L.push(`Claims the brand may make (only these, as written): ${v.claims.slice(0, 6).map((c) => `"${c.text}"`).join('; ')}.`);
    if (v.voice?.written && v.voice.written !== 'site') L.push(`Voice: ${VOICES[v.voice.written]?.toLowerCase()} than the site.`);
    if (v.golden?.length) L.push(`How the brand really writes (match this, never copy it):\n${v.golden.slice(0, 3).map((g, i) => `${i + 1}. ${g.text}`).join('\n')}`);
    if (v.language?.length) L.push(`Words their customers use: ${v.language.slice(0, 8).map((x) => `"${x}"`).join(', ')}.`);
    if (v.reviews?.length) L.push(`Real review lines (quote only these, word for word): ${v.reviews.slice(0, 4).map((r) => `"${r.text}"`).join(' | ')}`);
    const dos = (v.taste?.rules || []).filter((r) => r.kind === 'do'), donts = (v.taste?.rules || []).filter((r) => r.kind === 'dont');
    if (dos.length) L.push(`The team keeps doing: ${dos.map((r) => r.text).join('; ')}.`);
    if (donts.length) L.push(`The team keeps undoing: ${donts.map((r) => r.text).join('; ')}.`);
    if (recipe && /ugc|founder/.test(recipe) && v.comfort?.testimonials === 'yes') L.push('Testimonials are the creator speaking about using it; only claims above, never invented results or fake reviews.');
    return L.join('\n');
  }

  /* taste: an edit, an approve or a redo reason counts toward a rule; two of the same kind make it a rule */
  async function taste(slug, ev) {
    const bb = await load(slug), key = `${ev.kind}:${ev.what}`; bb.taste.counts[key] = (bb.taste.counts[key] || 0) + 1;
    if (bb.taste.counts[key] === 2 && !bb.taste.rules.some((r) => r.key === key)) bb.taste.rules.push({ key, kind: ev.kind, text: tidy(ev.text || ev.what, 120), at: now() });
    await save(slug, bb); return bb.taste;
  }

  /* the page's edits: keep/swap a ref or caption, kit, voice, music, comfort, cast, places, claims, never-say */
  async function update(slug, patch = {}, by = null) {
    const bb = await load(slug);
    if (patch.kit) { const k = patch.kit; bb.kitEdits = { ...bb.kitEdits };
      if (k.logo !== undefined) bb.kitEdits.logo = k.logo || null; if (k.fonts) bb.kitEdits.fonts = { ...(bb.kitEdits.fonts || {}), ...k.fonts };
      if (Array.isArray(k.colors)) bb.kitEdits.colors = k.colors.filter((c) => hexOk(c.hex || c)).slice(0, 6).map((c, i) => ({ hex: c.hex || c, role: c.role || (i ? 'accent' : 'primary') })); }
    if (patch.voice) bb.voice = { ...bb.voice, ...(VOICES[patch.voice.written] ? { written: patch.voice.written } : {}), ...(NARRATORS.some((n) => n.id === patch.voice.narrator) ? { narrator: patch.voice.narrator } : {}) };
    if (patch.music) bb.music = { ...bb.music, ...(Array.isArray(patch.music.moods) ? { moods: patch.music.moods.filter((m) => MOODS.includes(m)).slice(0, 3) } : {}) };
    if (patch.comfort) for (const [k, val] of Object.entries(patch.comfort)) if (COMFORT[k]?.options[val]) bb.comfort[k] = val;
    if (patch.pinGolden) bb.pinned.golden = [{ text: tidy(patch.pinGolden, 400), from: 'team' }, ...bb.pinned.golden].slice(0, 6);
    if (patch.removeGolden) bb.removed.golden = [...new Set([...bb.removed.golden, patch.removeGolden])];
    if (patch.pinStyleRef) bb.pinned.styleRefs = [{ src: patch.pinStyleRef, label: 'Picked by the team', from: 'team' }, ...bb.pinned.styleRefs].slice(0, 6);
    if (patch.removeStyleRef) bb.removed.styleRefs = [...new Set([...bb.removed.styleRefs, patch.removeStyleRef])];
    if (patch.claim) bb.claimsAllowed = [{ text: tidy(patch.claim, 140), from: 'team' }, ...bb.claimsAllowed].slice(0, 20);
    if (patch.never) bb.neverSay = [...new Set([...bb.neverSay, tidy(patch.never, 40)])].slice(0, 30);
    if (patch.cast) { const c = patch.cast; if (c.remove) bb.cast = bb.cast.filter((x) => x.id !== c.remove);
      else if (c.label) { if (c.real && !c.consent) throw Object.assign(new Error('Tick that you have their consent before adding a real person.'), { status: 400 });
        bb.cast.push({ id: `cast_${Math.random().toString(36).slice(2, 8)}`, label: tidy(c.label, 60), kind: c.real ? 'real' : 'ai', refs: (c.refs || []).slice(0, 80), voice: c.voice || null, consent: c.real ? { by: by?.email || null, at: now() } : null }); } }
    if (patch.place) { const p = patch.place; if (p.remove) bb.places = bb.places.filter((x) => x.id !== p.remove); else if (p.label) bb.places.push({ id: `pl_${Math.random().toString(36).slice(2, 8)}`, label: tidy(p.label, 60), describe: tidy(p.describe || p.label, 200), ref: p.ref || null }); }
    if (patch.confirm) bb.confirmed[patch.confirm] = { by: by?.email || null, at: now() };
    return save(slug, bb);
  }
  return { load, save, view, readiness, promptBlock, taste, update, fromRead, drop: (slug) => cache.delete(slug) };
}
