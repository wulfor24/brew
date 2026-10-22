// Jam v2: the Brand Book. Everything a deliverable is made from, in one place: the kit (logo, colours with roles, fonts),
// the look (their own best posts and ads as style refs), the words (voice, golden captions, claims they may make, words they
// never use), the spoken voice and music, the cast and places, how much AI they're comfortable with, and the taste Brew learns
// from their edits. Filled from the store read (profile.json, brief.json, config.json) the first time, then kept in
// brands/<slug>/private/brandbook.json. What the team confirms is marked; the rest says "from the read".
// Since 23 Oct it is the brand's whole profile, for v1 and v2 alike: the read's book (brand-book-read.js: story, voice, words,
// products, people, proof, the creative library by deliverable, playbooks, channels, rivals) is the bottom layer, uploads
// (a guidelines PDF, a deck, a link) sit over it, and the team's edits and confirms over those. view(bb, { scope }) decides who
// sees what: 'member' everything, 'share' the read plus the team's edits that aren't private (the share link and the kit),
// 'public' the read only (the free kit for brands not on Brew). Makers read refsFor / playbookFor / promptBlock / creativeBlock.
import { familiesFor, REF_FAMILIES } from '../brand-book-read.js';
const FILE = 'private/brandbook.json';
/* the chapters a team edit may change, by dotted path (story.mission, tone.summary, words.use, look.light, …) */
export const EDITABLE = /^(cover|story|tone|words|products|people|proof|look|naming|pillars|playbooks|markets|rules)(\.[\w-]+){0,2}$/;
const end = (s) => String(s ?? '').trim().replace(/[\s.;,:]+$/, ''); /* no doubled full stops in the blocks makers read */
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); let x = o; for (const k of ks) { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; } x[last] = v; };
const cleanVal = (v) => Array.isArray(v) ? v.slice(0, 30).map(cleanVal) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, cleanVal(x)])) : typeof v === 'string' ? tidy(v, 1200) : typeof v === 'number' || typeof v === 'boolean' || v == null ? v : String(v);
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

/* the brand's own references for a deliverable, best first: the team's picks, then the library's nearest families (a static ad
   gets their long-running static ads, a reel their reels and video ads), then any style ref. Each says why it is theirs. */
export function refsFor(v = {}, kind = '', n = 3) {
  const lib = v.library || {}, out = [], seen = new Set(), add = (x, fam) => { if (x?.src && !seen.has(x.src) && out.length < n) { seen.add(x.src); out.push({ src: x.src, why: x.why || null, words: x.words || null, proof: x.proof || null, family: fam || x.family || null, label: x.label || REF_FAMILIES[fam] || null }); } };
  (v.styleRefs || []).filter((x) => x.from === 'team').forEach((x) => add(x));
  for (const f of familiesFor(kind)) (lib[f] || []).forEach((x) => add(x, f));
  (v.styleRefs || []).forEach((x) => add(x));
  return out;
}
export const playbookFor = (v = {}, kind = '') => { const fs = familiesFor(kind); return [...(v.playbooks || [])].sort((a, b) => fs.indexOf(a.family) - fs.indexOf(b.family)).find((p) => fs.includes(p.family)) || null; };

/* the words block every writer reads: rules first, then how the brand sounds (with its own lines), then the format's playbook, then taste */
export function promptBlock(v = {}, { recipe = null, kind = null } = {}) {
  const L = [], t = v.tone || {};
  if (v.never?.length) L.push(`Never use these words or claims: ${v.never.join(', ')}.`);
  if (v.words?.avoid?.length) L.push(`Words this brand avoids: ${v.words.avoid.join(', ')}.`);
  if (v.claims?.length) L.push(`Claims the brand may make (only these, as written): ${v.claims.slice(0, 6).map((c) => `"${c.text}"`).join('; ')}.`);
  if (t.summary) L.push(`How the brand sounds: ${end(t.summary)}${t.reading ? ` (${end(t.reading)})` : ''}${t.language ? `; writes in ${end(t.language)}` : ''}.`);
  if (t.traits?.length) L.push(`Voice traits, with their own lines (match the voice, never copy the line):\n${t.traits.map((x) => `- ${x.trait}${x.sounds ? `: "${x.sounds}"` : ''}`).join('\n')}`);
  if (t.never?.length) L.push(`It never sounds: ${t.never.map((x) => x.text).join('; ')}.`);
  if (t.pairs?.length) L.push(`Say it their way:\n${t.pairs.map((p) => `- yes: "${p.do}" / not: "${p.dont}"`).join('\n')}`);
  if (t.cta?.style || t.cta?.examples?.length) L.push(`Calls to action: ${[t.cta.style, t.cta.examples?.length ? `theirs: ${t.cta.examples.map((x) => `"${x}"`).join(', ')}` : ''].filter(Boolean).join('; ')}.`);
  if (v.voice?.written && v.voice.written !== 'site' && VOICES[v.voice.written]) L.push(`The team wants it ${VOICES[v.voice.written].toLowerCase()} than the site.`);
  if (v.words?.use?.length) L.push(`Words the brand uses: ${v.words.use.slice(0, 12).map((x) => `"${x}"`).join(', ')}.`);
  if (v.golden?.length) L.push(`How the brand really writes (match this, never copy it):\n${v.golden.slice(0, 3).map((g, i) => `${i + 1}. ${g.text}`).join('\n')}`);
  if (v.language?.length) L.push(`Words their customers use: ${v.language.slice(0, 8).map((x) => `"${x}"`).join(', ')}.`);
  if (v.reviews?.length) L.push(`Real review lines (quote only these, word for word): ${v.reviews.slice(0, 4).map((r) => `"${r.text}"`).join(' | ')}`);
  const pb = playbookFor(v, kind || recipe || '');
  if (pb) L.push(`Their ${REF_FAMILIES[pb.family] || pb.family} usually: ${[pb.headline && `headline ${pb.headline}`, pb.wordsOnImage && `words on the picture ${pb.wordsOnImage}`, pb.cta && `CTA ${pb.cta}`, pb.avoid && `never ${pb.avoid}`].filter(Boolean).join('; ')}.`);
  const dos = (v.taste?.rules || []).filter((r) => r.kind === 'do'), donts = (v.taste?.rules || []).filter((r) => r.kind === 'dont');
  if (dos.length) L.push(`The team keeps doing: ${dos.map((r) => r.text).join('; ')}.`);
  if (donts.length) L.push(`The team keeps undoing: ${donts.map((r) => r.text).join('; ')}.`);
  if (recipe && /ugc|founder/.test(recipe) && v.comfort?.testimonials === 'yes') L.push('Testimonials are the creator speaking about using it; only claims above, never invented results or fake reviews.');
  return L.join('\n');
}

/* the art-direction block every picture and video maker reads (jam2 creative/make on Higgsfield and Gemini, Sloosh finals, v1
   pictures): the brand's look from its own pictures, colours with their roles, type, logo use and the format's playbook */
export function creativeBlock(v = {}, kind = '') {
  const L = [], lk = v.look || {}, k = v.kit || {};
  if (lk.notes) L.push(`The brand's look (from its own pictures): ${lk.notes}`);
  const bits = [lk.light && `light: ${end(lk.light)}`, lk.setting && `settings: ${end(lk.setting)}`, lk.people && `people: ${end(lk.people)}`, lk.props && `props: ${end(lk.props)}`, lk.framing && `framing: ${end(lk.framing)}`].filter(Boolean);
  if (bits.length) L.push(bits.join('; ') + '.');
  if (lk.colourUse || k.roles?.length) L.push(`Colours: ${(k.roles || []).filter((c) => c.hex).map((c) => `${c.hex}${c.role ? ` ${c.role}` : ''}${c.share ? ` ~${c.share}` : ''}`).join(', ')}${lk.colourUse ? `. ${lk.colourUse}` : ''}.`);
  if (k.fonts?.heading || k.fonts?.body) L.push(`Type: ${[k.fonts.heading && `headings in ${k.fonts.heading}${v.typeUse?.heading ? ` (${v.typeUse.heading})` : ''}`, k.fonts.body && `body in ${k.fonts.body}`].filter(Boolean).join(', ')}.`);
  if (lk.wordsOnImage) L.push(`Words on their pictures: ${end(lk.wordsOnImage)}.`);
  if (lk.logoUse) L.push(`Logo: ${end(lk.logoUse)}.`);
  if (lk.packaging) L.push(`Packaging: ${end(lk.packaging)}.`);
  const pb = playbookFor(v, kind);
  if (pb) L.push(`For a ${REF_FAMILIES[pb.family] || pb.family}: ${[pb.layout, pb.wordsOnImage && `words ${pb.wordsOnImage}`, pb.logo && `logo ${pb.logo}`, pb.avoid && `never ${pb.avoid}`].filter(Boolean).join('; ')}.`);
  const refs = refsFor(v, kind, 3).filter((r) => r.why);
  if (refs.length) L.push(`What makes their own ${REF_FAMILIES[refs[0].family] || 'pictures'} theirs: ${refs.map((r) => r.why).join(' | ')}`);
  return L.map((x) => tidy(x, 500)).join('\n');
}

/* the kit, style refs, words, claims and the read's book as the read found them (pure: the pack loader uses it too) */
export function readLayer({ slug = null, profile = null, brief = null, config = {}, book = null } = {}) {
    const id = profile?.identity || {}, colors = (id.colors || []).filter(hexOk).slice(0, 5), roleOf = new Map((book?.kit?.colors || []).filter((c) => c.role).map((c) => [String(c.hex).toLowerCase(), c.role]));
  const dark = colors.filter((c) => lum(c) < 0.35), light = colors.filter((c) => lum(c) > 0.7);
  const kit = { logo: id.logo || null, mark: id.mark || null, colors: colors.map((hex, i) => ({ hex, role: roleOf.get(String(hex).toLowerCase()) || (i === 0 ? 'primary' : dark.includes(hex) ? 'ink' : light.includes(hex) ? 'background' : 'accent') })),
    fonts: { heading: id.fonts?.heading || null, body: id.fonts?.body || id.fonts?.heading || null }, from: 'read' };
  kit.accent = kit.colors.find((c) => c.role === 'primary' || c.role === 'accent')?.hex || colors.find((c) => !light.includes(c)) || '#111111';
  kit.ink = lum(kit.accent) > 0.55 ? '#111111' : '#ffffff'; /* the colour words sit in on the accent: readable, never a fixed white */
  const ig = profile?.socials?.instagram?.posts || [], ads = profile?.ads?.own?.items || [];
  /* the read's library (saved pictures, ranked with proof) when the book is built; else the profile's own saved pictures */
  const lib = book?.library || {}, libRefs = Object.entries(lib).filter(([f]) => f !== 'product-photo').flatMap(([f, xs]) => xs.slice(0, 2).map((x) => ({ src: x.src, label: `${REF_FAMILIES[f] || f}${x.proof ? `, ${x.proof}` : ''}`, why: x.why || null, family: f, from: 'read' })));
  const styleRefs = libRefs.length ? libRefs.slice(0, 6) : [...ig.filter((x) => x.img).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 4).map((x) => ({ src: x.img, label: `Instagram ${x.kind || 'post'}${x.likes ? `, ${x.likes} likes` : ''}`, from: 'read' })),
    ...ads.filter((x) => x.poster).sort((a, b) => (b.days || 0) - (a.days || 0)).slice(0, 2).map((x) => ({ src: x.poster, label: `Own ad, running ${x.days || '?'} days`, from: 'read' }))].slice(0, 6);
  const golden = ig.filter((x) => x.caption && x.caption.length > 30).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 3).map((x) => ({ text: tidy(x.caption, 400), from: 'read', likes: x.likes || null }));
  if (golden.length < 3) ads.filter((x) => x.body || x.hook).sort((a, b) => (b.days || 0) - (a.days || 0)).slice(0, 3 - golden.length).forEach((x) => golden.push({ text: tidy([x.hook, x.body].filter(Boolean).join(' — '), 400), from: 'read', days: x.days || null }));
  /* config.banned is a regex: the gate runs it as one (claims.js bannedHits), and the writer gets its top-level alternatives in words.
     Splitting inside groups turned "heal(?:your|their|the)…" into the words "the", "their" (QA 22 Oct) */
  const neverRe = String(config?.banned || '').trim() || null;
  const top = []; { let d = 0, cur = ''; for (const ch of String(neverRe || '')) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d = Math.max(0, d - 1); if (ch === '|' && d === 0) { top.push(cur); cur = ''; } else cur += ch; } if (cur) top.push(cur); }
  const banned = top.map((x) => x.replace(/\(\?:/g, '(').replace(/\\[bsdw]\*?|\\[bsdw]\+?|[\^$]/g, ' ').replace(/\[([^\]]*)\]\??/g, '').replace(/\(([^()|]*)\|[^()]*\)\??/g, '$1').replace(/[()?*+\\]/g, '').replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 4).slice(0, 20);
  const claims = [...(book?.proof?.claims || []).map((c) => ({ text: c.text, basis: 'on their own site or ads', from: 'read', src: c.from?.[0]?.url || null })),
    ...(brief?.claims || []).slice(0, 8).map((x) => ({ text: tidy(x.claim, 140), basis: tidy(x.basis, 80), product: x.product || null, from: 'read' }))].filter((c, i, a) => c.text && a.findIndex((y) => y.text === c.text) === i).slice(0, 12);
  const reviews = (profile?.reviews?.quotes || []).slice(0, 8).map((q) => ({ text: tidy(q.text, 220), rating: q.rating || null, product: q.product || null, src: q.src || 'review' }));
  return { name: profile?.name || brief?.name || slug, host: profile?.host || null, category: profile?.category || null, kit, styleRefs, golden, claims, never: banned, neverRe, reviews,
    personas: (brief?.personas || []).slice(0, 4).map((p) => ({ name: p.name, who: tidy(p.who, 120), job: tidy(p.job, 100) })), language: (brief?.language || []).slice(0, 10), currency: profile?.currency || null, book: book || null };
}

export const blankBook = () => ({ v: 1, voice: { written: 'site', narrator: 'Kore', clones: [] }, music: { moods: ['warm acoustic'], never: ['trending audio we have no rights to'] },
  comfort: { people: 'ai-cast', aiVoice: 'yes', testimonials: 'yes', how: 'ai' }, cast: [], places: [], pinned: { golden: [], styleRefs: [] }, removed: { golden: [], styleRefs: [] },
  kitEdits: {}, claimsAllowed: [], neverSay: [], taste: { counts: {}, rules: [] }, confirmed: {}, recipes: [], edits: {}, uploads: [], updatedAt: null });
/* the Brand Book as the page and every maker read it (pure: the pack loader builds the share view from it too) */
export function viewOf(bb, { scope = 'member' } = {}) {
  const r = bb.read || {}, team = scope !== 'public', k = { ...r.kit, ...(team ? bb.kitEdits : {}), fonts: { ...(r.kit?.fonts || {}), ...(team ? bb.kitEdits?.fonts || {} : {}) } };
  if (team && bb.kitEdits?.colors) k.colors = bb.kitEdits.colors;
  const colors = (k.colors || []).map((c) => c.hex), accent = (k.colors || []).find((c) => c.role === 'accent' || c.role === 'primary')?.hex || k.accent || '#111111';
  const styleRefs = [...(team ? bb.pinned.styleRefs : []), ...(r.styleRefs || [])].filter((x) => !team || !bb.removed.styleRefs.includes(x.src)).slice(0, 6);
  const golden = [...(team ? bb.pinned.golden : []), ...(r.golden || [])].filter((x) => !team || !bb.removed.golden.includes(x.text)).slice(0, 6);
  const v = { name: r.name, host: r.host, category: r.category, kit: { ...k, colors, accent, ink: lum(accent) > 0.55 ? '#111111' : '#ffffff', roles: k.colors || [] }, styleRefs, golden,
    claims: [...(team ? bb.claimsAllowed : []), ...(r.claims || [])], never: [...new Set([...(r.never || []), ...(team ? bb.neverSay : [])])], neverRe: r.neverRe || null, neverSay: team ? bb.neverSay || [] : [],
    reviews: r.reviews || [], personas: r.personas || [], language: r.language || [], currency: r.currency, ...structuredClone(chapters(r.book)) }; /* a copy: edits never touch the cached read */
  v.src = {}; /* where each edited field came from: the page's source chips */
  if (scope === 'member') Object.assign(v, { recipes: bb.recipes || [], voice: bb.voice, music: bb.music, comfort: bb.comfort, cast: bb.cast, places: bb.places, taste: bb.taste, confirmed: bb.confirmed,
    uploads: (bb.uploads || []).map(({ id, name, kind, at, by, private: pv, applied }) => ({ id, name, kind, at, by, private: !!pv, applied: applied || 0 })) });
  else Object.assign(v, { voice: { narrator: bb.voice?.narrator || null }, music: bb.music, places: (bb.places || []).map(({ label, describe }) => ({ label, describe })), confirmed: scope === 'share' ? bb.confirmed : {} });
  /* edits by path, over the read: a share leaves out what the team marked private, the public kit leaves them all out */
  if (team) for (const [path, e] of Object.entries(bb.edits || {})) { if (scope === 'share' && e.private) continue; setPath(v, path, e.value); v.src[path] = e.src || 'team'; }
  return v;
}
/* the read's book as chapters (empty when it isn't built yet: the page says it is still being written) */
function chapters(b) {
  if (!b) return { book: null };
  return { book: { at: b.at, error: b.error || null, guides: b.guides || [] }, cover: b.cover || null, story: b.story || null, tone: b.voice || null, pillars: b.pillars || [], words: b.words || null,
    products: b.products || null, people: b.people || null, proof: b.proof || null, look: b.look || null, naming: b.naming || null, typeUse: b.kit?.typeUse || null,
    library: b.library || {}, playbooks: b.playbooks || [], channels: b.channels || [], markets: b.markets || null, rivals: b.rivals || [] };
}

/* the Brand Book view for code that only has packs (background writers: cards, statics, ideas, moves): never throws, {} when unread */
export async function loadView(packs, slug, { scope = 'share' } = {}) {
  const P = (n, d) => packs.getJSON(slug, n, d).catch(() => d);
  const [profile, brief, config, book, saved] = await Promise.all([P('profile.json', null), P('brief.json', null), P('config.json', {}), P('brandbook-read.json', null), P('private/brandbook.json', null)]);
  if (!profile) return {};
  return viewOf({ ...blankBook(), ...(saved || {}), read: readLayer({ slug, profile, brief, config, book }) }, { scope });
}

export function createBrandbook({ packs, log = console, now = () => Date.now() }) {
  const cache = new Map();
  const P = (slug, n, d) => packs.getJSON(slug, n, d).catch(() => d);

  /* the kit, style refs, words and claims as the read found them */
  async function fromRead(slug) {
    const [profile, brief, config, book] = await Promise.all([P(slug, 'profile.json', null), P(slug, 'brief.json', null), P(slug, 'config.json', {}), P(slug, 'brandbook-read.json', null)]);
    return readLayer({ slug, profile, brief, config, book });
  }

  const blank = blankBook;

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
  const view = viewOf;

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

  /* the block every writer and maker reads: promptBlock / creativeBlock above (module level, so v1 makers use them too) */

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
    /* any chapter field, by path: an edit, its undo (back to the read), and private (kept out of the share link and kit) */
    if (patch.edit && EDITABLE.test(String(patch.edit.path || ''))) bb.edits = { ...bb.edits, [patch.edit.path]: { value: cleanVal(patch.edit.value), by: by?.email || null, at: now(), src: patch.edit.src || 'team', private: !!patch.edit.private } };
    if (patch.unedit && bb.edits?.[patch.unedit]) { const { [patch.unedit]: _, ...rest } = bb.edits; bb.edits = rest; }
    if (patch.private && bb.edits?.[patch.private.path]) bb.edits[patch.private.path] = { ...bb.edits[patch.private.path], private: !!patch.private.on };
    /* an upload's proposed changes, taken in one tap: each becomes an edit sourced to the file, private unless the team shares it */
    if (patch.applyUpload) { const u = (bb.uploads || []).find((x) => x.id === patch.applyUpload.id); if (!u) throw Object.assign(new Error('That upload is gone.'), { status: 404 });
      const take = new Set(patch.applyUpload.paths || u.proposed.map((x) => x.path)); let n = 0;
      for (const x of u.proposed) if (take.has(x.path) && x.path === 'proof.claimsAllowed') { bb.claimsAllowed = [...(x.value || []).map((c) => ({ text: tidy(c, 140), from: `upload:${u.name}` })), ...bb.claimsAllowed].slice(0, 20); n++; }
      else if (take.has(x.path) && EDITABLE.test(x.path) && !(bb.confirmed?.[x.path] && !patch.applyUpload.overrideConfirmed)) { bb.edits = { ...bb.edits, [x.path]: { value: cleanVal(x.value), by: by?.email || null, at: now(), src: `upload:${u.name}`, private: !!u.private } }; n++; }
      const skip = new Set(patch.applyUpload.skipKit || []);
      if (u.kit) { if (u.kit.colors?.length && !skip.has('colors')) bb.kitEdits = { ...bb.kitEdits, colors: u.kit.colors.filter((c) => hexOk(c.hex)).slice(0, 8) }; if (u.kit.fonts && !skip.has('fonts')) bb.kitEdits = { ...bb.kitEdits, fonts: { ...(bb.kitEdits?.fonts || {}), ...u.kit.fonts } }; if (u.kit.logo && !skip.has('logo')) bb.kitEdits = { ...bb.kitEdits, logo: u.kit.logo }; if (u.kit.fontFiles?.length) bb.kitEdits = { ...bb.kitEdits, fontFiles: [...u.kit.fontFiles, ...(bb.kitEdits?.fontFiles || [])].slice(0, 8) }; }
      if (u.neverSay?.length && !skip.has('never')) bb.neverSay = [...new Set([...bb.neverSay, ...u.neverSay.map((x) => tidy(x, 40))])].slice(0, 40);
      u.applied = n; u.appliedAt = now(); }
    if (patch.upload) bb.uploads = [{ ...patch.upload, at: now(), by: by?.email || null }, ...(bb.uploads || []).filter((x) => x.id !== patch.upload.id)].slice(0, 30);
    if (patch.removeUpload) bb.uploads = (bb.uploads || []).filter((x) => x.id !== patch.removeUpload);
    return save(slug, bb);
  }
  return { load, save, view, readiness, promptBlock, creativeBlock, refsFor, playbookFor, taste, update, fromRead, drop: (slug) => cache.delete(slug) };
}
