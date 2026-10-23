// The Brand Book, shared: one link and one download that any person or AI tool can use. Built from the share view (the read plus
// the team's edits that aren't private; uploads and connected numbers never), so the same files serve a brand on Brew and the
// free kit for a brand Brew only read.
//   /<slug>/brand            the book as a read-only page (brand-book.js, readOnly)
//   /<slug>/brand.md         an AI-ready brand prompt: paste it into ChatGPT, Claude or Gemini, or a project's instructions
//   /<slug>/brand.json       the whole book as data, every line with where it came from
//   /<slug>/llms.txt         the index an AI agent reads first
//   /<slug>/brand-kit.zip    all of it, plus design tokens (W3C), colors.css, an .ase palette, logos, references by format,
//                            product photos and the project instructions for Claude and ChatGPT
import { loadView } from './jam2/brandbook.js';
import { zipBuffer } from './pdf/render.js';

const one = (s, n = 400) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const famName = { 'ad-image': 'Image ads', 'ad-video': 'Video ads', 'ad-carousel': 'Carousel ads', 'ig-post': 'Instagram posts', 'ig-reel': 'Instagram reels', 'ig-carousel': 'Instagram carousels', tiktok: 'TikTok', youtube: 'YouTube films', 'product-photo': 'Product photos', 'site-photo': 'On their site', email: 'Emails' };
const end = (s) => String(s ?? '').trim().replace(/[\s.;,:]+$/, ''); /* a sentence the model already ended doesn't get a second full stop */
const same = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const nameOf = (v) => v.cover?.name || v.name || 'the brand';
const slugify = (s) => String(s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

/* the AI-ready prompt: what matters most for good work first (rules, voice, words), then look, then facts; under ~2.5k tokens */
export function toMarkdown(v = {}, { url = '' } = {}) {
  const n = nameOf(v), t = v.tone || {}, w = v.words || {}, lk = v.look || {}, k = v.kit || {}, pr = v.products || {}, L = [];
  const H = (h) => L.push('', `## ${h}`), B = (x) => x && L.push(`- ${x}`);
  const pos = v.story?.positioning && !same(v.story.positioning, v.cover?.oneLine) ? ` ${end(one(v.story.positioning, 200))}.` : '';
  L.push(`# ${n} brand book`, '', `Use this for everything you write or design for ${n}.${v.cover?.oneLine ? ` ${n}: ${end(one(v.cover.oneLine, 160))}.` : ''}${pos}`);
  const never = [...new Set([...(v.neverSay || []), ...(v.never || [])])];
  H('Rules'); B(never.length ? `Never use these words or claims: ${never.join(', ')}.` : null); B(w.avoid?.length ? `Avoid: ${w.avoid.join(', ')}.` : null);
  B((v.claims || []).length ? `Only make these claims, as written: ${v.claims.slice(0, 8).map((c) => `"${one(c.text, 140)}"`).join('; ')}.` : 'Make no claim the brand hasn’t made itself.');
  B('Quote customers only from the review lines below, word for word. Never invent results, reviews, prices or numbers.');
  for (const r of (v.rulebook || []).filter((x) => !x.off && !x.choice && !/^Never use these words or claims/.test(x.text))) B(`${r.strength === 'block' ? 'Must: ' : 'Prefer: '}${end(r.text)}${r.where?.channels?.length ? ` (${r.where.channels.join(', ')} only)` : ''}.`);
  if (t.summary || t.traits?.length) { H('Voice'); B(t.summary); for (const x of t.traits || []) B(`${x.trait}${x.sounds ? `: like "${one(x.sounds, 180)}"` : ''}`);
    for (const x of t.never || []) B(`Never ${x.text.toLowerCase().replace(/^never\s+/, '')}`); B(t.reading ? `Reading level: ${end(t.reading)}.` : null); B(t.language ? `Writes in ${end(t.language)}.` : null);
    if (t.pairs?.length) { L.push('', `Say it the ${n} way:`); for (const p of t.pairs) L.push(`- Yes: "${one(p.do, 160)}" Not: "${one(p.dont, 160)}"`); }
    if (t.cta?.style || t.cta?.examples?.length) B(`Calls to action: ${[end(t.cta.style), t.cta.examples?.length ? `theirs are ${t.cta.examples.map((x) => `"${x}"`).join(', ')}` : ''].filter(Boolean).join('; ')}.`); }
  if (w.use?.length || w.customers?.length) { H('Words'); B(w.use?.length ? `${n} says: ${w.use.join(', ')}.` : null); B(w.customers?.length ? `Customers say: ${w.customers.join(', ')}.` : null); }
  if (lk.notes || k.roles?.length || k.fonts?.heading) { H('Look');
    B(lk.notes); for (const [k, x] of [['Light', lk.light], ['People', lk.people], ['Framing', lk.framing], ['Words on pictures', lk.wordsOnImage], ['Logo', lk.logoUse]]) B(x ? `${k}: ${end(x)}.` : null);
    B((k.roles || []).length ? `Colours: ${k.roles.map((c) => `${c.hex}${c.role ? ` (${c.role}${c.share ? `, ~${c.share}` : ''})` : ''}${c.use ? ` ${one(c.use, 60)}` : ''}`).join('; ')}.` : null);
    B(k.fonts?.heading || k.fonts?.body ? `Type: ${[k.fonts.heading && `headings in ${k.fonts.heading}`, k.fonts.body && `body in ${k.fonts.body}`].filter(Boolean).join(', ')}.` : null); }
  if ((v.playbooks || []).length) { H('Formats'); for (const p of v.playbooks) B(`${famName[p.family] || p.family}: ${[p.layout && `${end(p.layout)}.`, p.headline && `Headline: ${end(p.headline)}.`, p.wordsOnImage && `Words on it: ${end(p.wordsOnImage)}.`, p.cta && `Call to action: ${end(p.cta)}.`, p.avoid && `Never: ${end(p.avoid)}.`].filter(Boolean).join(' ')}`); }
  if (pr.heroes?.length) { H('Products'); for (const p of pr.heroes.slice(0, 8)) B(`${p.title}${p.price ? `, ${p.price}` : ''}${p.about ? `: ${one(p.about, 140)}` : ''}`); B(pr.offers?.length ? `Offers: ${pr.offers.join('; ')}.` : null); B(pr.guarantee ? `Promise: ${pr.guarantee}.` : null); }
  if ((v.people?.personas || []).length) { H('Who buys'); for (const p of v.people.personas) B(`${p.name}: ${p.who}${p.job ? `; wants ${p.job.toLowerCase()}` : ''}`); }
  if ((v.proof?.quotes || []).length || (v.proof?.ratings || []).length) { H('Proof'); for (const r of v.proof.ratings || []) B(`${r.rating ? `${r.rating}★ from ` : ''}${Number(r.count).toLocaleString('en-US')} reviews on ${r.where}`); for (const q of (v.proof.quotes || []).slice(0, 4)) B(`"${one(q.text, 220)}"`); }
  if ((v.rivals || []).length) { H('Rivals'); B(`Never copy ${v.rivals.map((r) => r.name).join(', ')}: their products, names, words or people.`); }
  if (url) L.push('', `Full brand book with pictures: ${url}`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* the whole book as data, with absolute links, for any tool */
export function toJSON(v = {}, { origin = '' } = {}) {
  const abs = (p) => (p && /^\//.test(p) ? origin + p : p || null);
  const lib = Object.fromEntries(Object.entries(v.library || {}).map(([f, xs]) => [f, xs.map((x) => ({ image: abs(x.src), video: abs(x.video), why: x.why || null, words: x.words || null, proof: x.proof || null, original: x.url || null }))]));
  return { $schema: 'https://brew.joinsquareup.com/schema/brand-book-1.json', name: nameOf(v), site: v.host ? `https://${v.host}` : null, made: 'Brew, from the brand’s own site, ads and posts, plus its team’s edits',
    cover: { ...v.cover, logo: abs(v.cover?.logo || v.kit?.logo), mark: abs(v.cover?.mark || v.kit?.mark) }, story: v.story || null,
    kit: { logo: abs(v.kit?.logo), mark: abs(v.kit?.mark), colors: v.kit?.roles || [], fonts: v.kit?.fonts || {}, typeUse: v.typeUse || null },
    voice: v.tone || null, words: { ...(v.words || {}), never: [...new Set([...(v.neverSay || []), ...(v.never || [])])] }, claims: (v.claims || []).map((c) => ({ text: c.text, source: c.src || null })),
    look: v.look || null, playbooks: v.playbooks || [], library: lib, products: v.products ? { ...v.products, heroes: (v.products.heroes || []).map((p) => ({ ...p, img: abs(p.img) })) } : null,
    people: v.people || null, proof: v.proof || null, channels: v.channels || [], markets: v.markets || null, rivals: v.rivals || [], naming: v.naming || null };
}

/* design tokens in the W3C format (Figma variables, Style Dictionary), and the same as CSS */
export function tokens(v = {}) {
  const t = { color: {}, font: {} }, seen = {};
  for (const c of v.kit?.roles || []) { if (!c.hex) continue; const k = c.role || 'support'; seen[k] = (seen[k] || 0) + 1; t.color[seen[k] > 1 ? `${k}-${seen[k]}` : k] = { $type: 'color', $value: c.hex, ...(c.use ? { $description: c.use } : {}) }; }
  if (v.kit?.fonts?.heading) t.font.heading = { $type: 'fontFamily', $value: [v.kit.fonts.heading, 'serif'] };
  if (v.kit?.fonts?.body) t.font.body = { $type: 'fontFamily', $value: [v.kit.fonts.body, 'sans-serif'] };
  return { [slugify(nameOf(v))]: t };
}
export function colorsCss(v = {}) {
  const tk = Object.values(tokens(v))[0];
  return `/* ${nameOf(v)}: colours and type from its brand book */\n:root {\n${Object.entries(tk.color).map(([k, x]) => `  --brand-${k}: ${x.$value};`).join('\n')}\n${Object.entries(tk.font).map(([k, x]) => `  --brand-font-${k}: "${x.$value[0]}", ${x.$value[1]};`).join('\n')}\n}\n`;
}
/* an Adobe swatch exchange palette (Illustrator, Photoshop, Figma plugins) */
export function ase(v = {}) {
  const cols = (v.kit?.roles || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex || ''));
  const blocks = cols.map((c) => { const name = `${c.role || 'colour'} ${c.hex}`, nameBuf = Buffer.alloc((name.length + 1) * 2); for (let i = 0; i < name.length; i++) nameBuf.writeUInt16BE(name.charCodeAt(i), i * 2);
    const rgb = Buffer.alloc(12); [1, 3, 5].forEach((o, i) => rgb.writeFloatBE(parseInt(c.hex.slice(o, o + 2), 16) / 255, i * 4));
    const body = Buffer.concat([Buffer.from([0, name.length + 1]), nameBuf, Buffer.from('RGB '), rgb, Buffer.from([0, 2])]);
    const head = Buffer.alloc(6); head.writeUInt16BE(1, 0); head.writeUInt32BE(body.length, 2); return Buffer.concat([head, body]); });
  const h = Buffer.alloc(12); h.write('ASEF', 0); h.writeUInt16BE(1, 4); h.writeUInt16BE(0, 6); h.writeUInt32BE(blocks.length, 8);
  return Buffer.concat([h, ...blocks]);
}
export function llmsTxt(v = {}, { base = '' } = {}) {
  return `# ${nameOf(v)}\n\n> ${one(v.cover?.oneLine || v.story?.positioning || `${nameOf(v)}'s brand book`, 200)}\n\nThe brand book for ${nameOf(v)}: voice, words, never-say list, look, colours, type, claims it can make, products and its own best work by format. Follow it for anything written or designed for this brand.\n\n- [Brand book for AI](${base}/brand.md): the rules, voice and look as one prompt\n- [Brand book data](${base}/brand.json): every chapter as JSON, with sources\n- [Brand book page](${base}/brand): the book with pictures\n- [Brand kit](${base}/brand-kit.zip): tokens, palette, logos, references and product photos\n`;
}
const projectNote = (v, tool, url) => `# ${nameOf(v)} (${tool} instructions)\n\nYou write and design for ${nameOf(v)}. Before every answer, follow the brand book in brand.md (attached to this ${tool === 'Claude' ? 'project' : 'GPT'}${url ? `, also at ${url}` : ''}).\n\n- Use its voice traits and its own lines as the model; never copy a line as it is.\n- Never use a word or claim on its never-say list. Only make claims it lists.\n- For pictures and video: follow its Look and Formats, and use the files in references/ that match the format you are making.\n- If something you need isn't in the brand book, ask instead of guessing.\n`;

export function createBrandKit({ packs, log = console }) {
  const viewOf = (slug) => loadView(packs, slug, { scope: 'share' });
  async function zip(slug, { origin = '', pdf = null } = {}) {
    const v = await viewOf(slug); if (!v?.name && !v?.cover) return null;
    const base = `${origin}/${slug}`, files = [], text = (name, s) => files.push({ name, data: Buffer.from(s) });
    const asset = async (p) => { const m = String(p || '').match(/^\/b\/[^/]+\/a\/([^?#]+)$/); if (!m) return null; return packs.get(slug, 'assets/' + m[1]).catch(() => null); };
    text('brand.md', toMarkdown(v, { url: `${base}/brand` })); text('brand.json', JSON.stringify(toJSON(v, { origin }), null, 2)); text('tokens.json', JSON.stringify(tokens(v), null, 2));
    text('colors.css', colorsCss(v)); if ((v.kit?.roles || []).length) files.push({ name: 'palette.ase', data: ase(v) });
    text('CLAUDE-PROJECT.md', projectNote(v, 'Claude', `${base}/brand.md`)); text('CUSTOM-GPT.md', projectNote(v, 'ChatGPT', `${base}/brand.md`)); text('llms.txt', llmsTxt(v, { base }));
    for (const [k, p] of [['logo', v.kit?.logo], ['mark', v.kit?.mark]]) { const b = await asset(p); if (b) files.push({ name: `logos/${k}${String(p).match(/\.[a-z0-9]+$/i)?.[0] || '.png'}`, data: b }); }
    for (const [f, xs] of Object.entries(v.library || {})) { const caps = [];
      for (const [i, x] of xs.entries()) { const b = await asset(x.src); if (!b) continue; const nm = `${String(i + 1).padStart(2, '0')}${String(x.src).match(/\.[a-z0-9]+$/i)?.[0] || '.jpg'}`; files.push({ name: `references/${f}/${nm}`, data: b }); caps.push({ file: nm, why: x.why || null, words: x.words || null, proof: x.proof || null, original: x.url || null }); }
      if (caps.length) text(`references/${f}/captions.json`, JSON.stringify(caps, null, 2)); }
    /* the book itself, printed: a PDF that couldn't be made leaves the rest of the kit as it is */
    if (pdf) { const b = await pdf().catch((e) => (log.warn?.('[kit] pdf', slug, e.message), null)); if (b?.length) files.push({ name: 'brand-book.pdf', data: b }); }
    for (const p of v.products?.heroes || []) { const b = await asset(p.img); if (b) files.push({ name: `products/${slugify(p.title)}${String(p.img).match(/\.[a-z0-9]+$/i)?.[0] || '.jpg'}`, data: b }); }
    return { buf: zipBuffer(files), name: `${slugify(nameOf(v))}-brand-kit.zip`, files: files.length };
  }
  return { viewOf, zip };
}
