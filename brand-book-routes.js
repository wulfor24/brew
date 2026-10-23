// The Brand Book's routes (v1 and Jam v2 share one store, jam2/brandbook.js):
//   GET  /api/brands/:slug/book          the book as this viewer may see it (team: everything; anyone else: the share view)
//   POST /api/brands/:slug/book          a team edit (any field by path, kit, voice, never-say, confirm, private, an upload taken)
//   POST /api/brands/:slug/book/import   bring their own brand book: a file (PDF, Word, PowerPoint, Excel, text, a logo, a font,
//                                        a ZIP of assets), a link (Google Docs/Slides/Drive, Notion, Figma, Canva, any page) or
//                                        pasted text. Brew reads it and proposes changes field by field; nothing changes until
//                                        the team taps Use these (an upload is private unless they share it).
// Every brand alike: nothing here knows one brand. An error says what happened and how to fix it, never "nothing found".
import crypto from 'node:crypto';
import { readDrop, dropKind, unzip } from './drop-read.js';
import { COMFORT, NARRATORS, MOODS, VOICES, EDITABLE } from './jam2/brandbook.js';
import { REF_FAMILIES } from './brand-book-read.js';
import { safeFetch, stripTags, UA } from './reader/util.js';

const FONT = /\.(ttf|otf|woff2?)$/i, LOGO = /\.(svg|png|jpe?g|webp)$/i;
const tidy = (s, n = 400) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const fontName = (file) => String(file).replace(/\.[a-z0-9]+$/i, '').replace(/[-_](regular|bold|medium|light|semibold|black|italic|thin|book|\d{3})+$/gi, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

/* a share link turned into something readable without signing in: Docs/Slides/Sheets export, a Drive file's download, a page */
export function linkPlan(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch { return { error: 'That isn’t a link. Paste the full address, starting with https://' }; }
  if (!/^https?:$/.test(u.protocol)) return { error: 'Paste a link that starts with https://' };
  const id = (re) => (u.pathname.match(re) || [])[1];
  if (/docs\.google\.com$/.test(u.hostname)) {
    const doc = id(/\/document\/d\/([\w-]+)/), deck = id(/\/presentation\/d\/([\w-]+)/), sheet = id(/\/spreadsheets\/d\/([\w-]+)/);
    if (doc) return { url: `https://docs.google.com/document/d/${doc}/export?format=txt`, as: 'text', from: 'Google Docs' };
    if (deck) return { url: `https://docs.google.com/presentation/d/${deck}/export/pdf`, as: 'pdf', from: 'Google Slides' };
    if (sheet) return { url: `https://docs.google.com/spreadsheets/d/${sheet}/export?format=csv`, as: 'text', from: 'Google Sheets' };
  }
  if (/drive\.google\.com$/.test(u.hostname)) { const f = id(/\/file\/d\/([\w-]+)/) || u.searchParams.get('id'); if (f) return { url: `https://drive.google.com/uc?export=download&id=${f}`, as: 'file', from: 'Google Drive' };
    return { error: 'That is a Drive folder. Open the brand book file inside it and paste that file’s link.' }; }
  const from = /notion\.(so|site)$/.test(u.hostname) ? 'Notion' : /figma\.com$/.test(u.hostname) ? 'Figma' : /canva\.com$/.test(u.hostname) ? 'Canva'
    : /frontify|brandfolder|bynder|zeroheight/.test(u.hostname) ? 'brand portal' : 'web page';
  return { url: u.href, as: /\.pdf(\?|$)/i.test(u.pathname) ? 'pdf' : 'page', from, render: ['Notion', 'Figma', 'Canva', 'brand portal'].includes(from) };
}
const PRIVATE_HINT = (from) => `That ${from} link is private, so Brew can’t open it. Set sharing to “Anyone with the link can view”, or download it as a PDF and upload the file.`;

/* what a guidelines document says, mapped onto the Brand Book's fields */
const S = { type: 'string' }, A = { type: 'array', items: S };
const MAP_SCHEMA = { type: 'object', properties: {
  colors: { type: 'array', items: { type: 'object', properties: { hex: S, role: { type: 'string', enum: ['primary', 'accent', 'ink', 'background', 'support'] }, name: S, use: S } } },
  fonts: { type: 'object', properties: { heading: S, body: S } },
  story: { type: 'object', properties: { positioning: S, mission: S, values: A, tagline: S, founderStory: S } },
  tone: { type: 'object', properties: { summary: S, traits: { type: 'array', items: { type: 'object', properties: { trait: S, sounds: S } } }, never: { type: 'array', items: { type: 'object', properties: { text: S } } },
    pairs: { type: 'array', items: { type: 'object', properties: { do: S, dont: S } } }, cta: { type: 'object', properties: { style: S, examples: A } } } },
  words: { type: 'object', properties: { use: A, avoid: A } }, neverSay: A, claims: A,
  look: { type: 'object', properties: { notes: S, light: S, people: S, wordsOnImage: S, logoUse: S, colourUse: S, packaging: S } },
  logoRules: S
} };
export function proposalsOf(j = {}) {
  const P = [], add = (path, value, label) => { const empty = value == null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.values(value).some((x) => x != null && x !== '' && !(Array.isArray(x) && !x.length))); if (!empty && EDITABLE.test(path)) P.push({ path, value, label }); };
  const st = j.story || {}; add('story.positioning', tidy(st.positioning, 200), 'Positioning'); add('story.mission', tidy(st.mission, 240), 'Mission'); add('story.values', (st.values || []).map((x) => tidy(x, 40)).filter(Boolean).slice(0, 6), 'Values');
  add('cover.tagline', tidy(st.tagline, 80), 'Tagline'); add('story.founderStory', tidy(st.founderStory, 500), 'Founder story');
  const t = j.tone || {}; add('tone.summary', tidy(t.summary, 200), 'How the brand sounds');
  add('tone.traits', (t.traits || []).filter((x) => x.trait).slice(0, 6).map((x) => ({ trait: tidy(x.trait, 40), sounds: tidy(x.sounds, 200) || null })), 'Voice traits');
  add('tone.never', (t.never || []).filter((x) => x.text).slice(0, 5).map((x) => ({ text: tidy(x.text, 80) })), 'Never sounds like');
  add('tone.pairs', (t.pairs || []).filter((x) => x.do && x.dont).slice(0, 5).map((x) => ({ do: tidy(x.do, 160), dont: tidy(x.dont, 160) })), 'Say it this way');
  add('tone.cta', t.cta?.style || t.cta?.examples?.length ? { style: tidy(t.cta.style, 120) || null, examples: (t.cta.examples || []).slice(0, 5).map((x) => tidy(x, 40)) } : null, 'Calls to action');
  add('words.use', (j.words?.use || []).map((x) => tidy(x, 40)).filter(Boolean).slice(0, 20), 'Words we use'); add('words.avoid', (j.words?.avoid || []).map((x) => tidy(x, 30)).filter(Boolean).slice(0, 20), 'Words we avoid');
  const lk = j.look || {}; add('look.notes', tidy(lk.notes, 360), 'Photo style'); add('look.light', tidy(lk.light, 120), 'Light'); add('look.people', tidy(lk.people, 140), 'People on camera');
  add('look.wordsOnImage', tidy(lk.wordsOnImage, 140), 'Words on pictures'); add('look.logoUse', tidy(lk.logoUse || j.logoRules, 160), 'Logo use'); add('look.colourUse', tidy(lk.colourUse, 160), 'Colour use'); add('look.packaging', tidy(lk.packaging, 160), 'Packaging');
  add('proof.claimsAllowed', (j.claims || []).map((x) => tidy(x, 160)).filter(Boolean).slice(0, 12), 'Claims we may make');
  return P;
}
const kitOf = (j = {}) => ({ colors: (j.colors || []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(String(c.hex || '').trim())).slice(0, 8).map((c, i) => ({ hex: String(c.hex).trim().toLowerCase(), role: c.role || (i ? 'accent' : 'primary'), name: tidy(c.name, 30) || null, use: tidy(c.use, 80) || null })),
  fonts: Object.fromEntries(Object.entries(j.fonts || {}).filter(([, v]) => v).map(([k, v]) => [k, tidy(v, 40)])) });
/* without the AI (mock runs, a paused account) a document still gives its colour codes: never a made-up rest */
export const hexesIn = (text) => [...new Set((String(text).match(/#[0-9a-f]{6}\b/gi) || []).map((x) => x.toLowerCase()))].slice(0, 8);

export function mountBrandBook({ on, BOOK, GP, reqOf, meOf = () => null, isMock = () => false, spend = () => true, ai = null, builder = null, refreshPack = async () => {}, render = null, log = console, DEFAULT_BRAND = null }) {
  const slugOf = (t, p) => { const s = t.brandId || DEFAULT_BRAND; return p.slug === s ? s : null; };
  const member = (t) => !!reqOf(t)?.member || process.env.DEMO_MODE === '1';
  const teamNo = (t, what) => member(t) ? null : { status: reqOf(t)?.email ? 403 : 401, error: `Only this brand’s team can ${what}.`, team: true };
  const out = async (slug, t) => {
    const raw = await BOOK.load(slug), v = BOOK.view(raw, { scope: member(t) ? 'member' : 'share' });
    const building = !!builder?.book?.running?.(slug), stale = builder?.book ? await builder.book.stale(slug).catch(() => false) : false;
    if (stale && !building && !isMock()) builder.bookAfter?.(slug); /* a missing or older read layer is written now, in the background */
    return { book: v, building: building || stale, canEdit: member(t), readiness: BOOK.readiness(v, { products: (v.products?.heroes || []).length }),
      options: { comfort: COMFORT, narrators: NARRATORS, moods: MOODS, voices: VOICES, families: REF_FAMILIES }, share: { page: `/${slug}/brand`, md: `/${slug}/brand.md`, json: `/${slug}/brand.json`, llms: `/${slug}/llms.txt`, zip: `/${slug}/brand-kit.zip`, pdf: `/${slug}/brand.pdf` } };
  };
  on('GET', '/api/brands/:slug/book', async (b, t, p) => { const slug = slugOf(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' };
    try { return await out(slug, t); } catch (e) { return { status: e.status || 500, error: e.message }; } });
  on('POST', '/api/brands/:slug/book', async (b, t, p) => { const slug = slugOf(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' };
    const no = teamNo(t, 'change its Brand Book'); if (no) return no;
    try { await BOOK.update(slug, b || {}, meOf(t)); refreshPack(slug).catch(() => {}); /* the writers' system text follows at once */ return await out(slug, t); }
    catch (e) { return { status: e.status || 400, error: e.message }; } });
  /* rebuild the read layer now (the page's "Read my site again" for the book): free chapters always, the AI part when it is on */
  on('POST', '/api/brands/:slug/book/refresh', async (b, t, p) => { const slug = slugOf(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' };
    const no = teamNo(t, 'rebuild its Brand Book'); if (no) return no; if (!builder?.bookAfter) return { error: 'The Brand Book can’t be rebuilt on this server.' };
    builder.bookAfter(slug, { force: true, why: 'team' }); return { ok: true, building: true }; });

  /* ---------- bring your own brand book ---------- */
  async function fetchLink(plan) {
    const get = async (u) => { const r = await safeFetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25e3) });
      if ([401, 403].includes(r.status) || /accounts\.google\.com|\/login|signin/i.test(r.url || '')) throw Object.assign(new Error('private'), { private: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}`); return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' }; };
    const g = await get(plan.url);
    if (/text\/html/.test(g.type) && plan.as !== 'page' && plan.from === 'Google Drive') throw Object.assign(new Error('private'), { private: true }); /* a Drive "sign in" or virus-scan page */
    if (plan.as === 'pdf' || /application\/pdf/.test(g.type)) return { name: `${plan.from}.pdf`, type: 'application/pdf', data: g.buf.toString('base64') };
    if (plan.as === 'text' || /^text\/(plain|csv)/.test(g.type)) return { name: `${plan.from}.txt`, text: g.buf.toString('utf8') };
    let html = g.buf.toString('utf8');
    /* pages drawn by script (Notion, Figma, Canva, portals) are rendered once in the browser when the plain page is thin */
    if (render && (plan.render || stripTags(html).length < 400)) { const h = await render(plan.url).catch(() => null); if (h) html = h; }
    const text = stripTags(html); if (text.length < 120) throw Object.assign(new Error('empty'), { empty: true });
    return { name: `${plan.from} page.txt`, text };
  }
  on('POST', '/api/brands/:slug/book/import', async (b, t, p) => {
    const slug = slugOf(t, p); if (!slug) return { status: 400, error: 'This workspace is for another brand.' };
    const no = teamNo(t, 'add to its Brand Book'); if (no) return no;
    const name = String(b.name || (b.url ? 'link' : 'notes')).replace(/[\r\n]+/g, ' ').slice(0, 120), id = `up_${crypto.randomBytes(4).toString('hex')}`;
    const upload = { id, name, kind: b.url ? 'link' : b.text != null && !b.data ? 'text' : 'file', url: b.url || null, private: b.private !== false, proposed: [], kit: null, neverSay: [] };
    const buf = () => Buffer.from(String(b.data || '').replace(/^data:[^;,]*(;[^,]*)?,/, ''), 'base64');
    /* a font: saved for the canvas and the specimen, proposed as the heading or body face */
    if (FONT.test(name) && b.data) { const bytes = buf(); if (!bytes.length || bytes.length > 4e6) return { error: `${name} is empty or over 4 MB.` };
      const file = `font-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}${name.match(FONT)[0].toLowerCase()}`; await GP.put(slug, 'assets/' + file, bytes, 'font/' + name.match(FONT)[1].toLowerCase());
      upload.kind = 'font'; upload.kit = { fonts: { [b.role === 'body' ? 'body' : 'heading']: fontName(name) }, fontFiles: [{ family: fontName(name), src: `/b/${slug}/a/${file}` }] };
      upload.proposed = []; await BOOK.update(slug, { upload }, meOf(t)); return { ok: true, upload: { id, name, kind: 'font', family: fontName(name), proposed: [], kit: upload.kit } }; }
    /* a logo: saved as the brand's logo asset and proposed for the kit */
    if (LOGO.test(name) && b.data && /logo|mark|wordmark|icon/i.test(name)) { const bytes = buf(); if (!bytes.length || bytes.length > 6e6) return { error: `${name} is empty or over 6 MB.` };
      const ext = name.match(LOGO)[1].toLowerCase().replace('jpeg', 'jpg'), file = `logo-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}.${ext}`;
      await GP.put(slug, 'assets/' + file, bytes, ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
      upload.kind = 'logo'; upload.kit = { logo: `/b/${slug}/a/${file}` }; await BOOK.update(slug, { upload }, meOf(t)); return { ok: true, upload: { id, name, kind: 'logo', proposed: [], kit: upload.kit } }; }
    /* the words: a file, a ZIP of files, a link or pasted text */
    const live = !isMock() && !!ai && spend('text'), reader = live ? { ...ai, live: true } : null; let texts = [];
    try {
      if (b.url) { const plan = linkPlan(b.url); if (plan.error) return { error: plan.error };
        let got; try { got = await fetchLink(plan); } catch (e) { return { error: e.private ? PRIVATE_HINT(plan.from) : e.empty ? `That ${plan.from} page has no words Brew can read. Download it as a PDF and upload the file.` : `Brew couldn’t open that link (${tidy(e.message, 60)}). Check it opens in a private window, or upload the file.` }; }
        upload.name = got.name.replace(/\.(pdf|txt)$/, ''); upload.from = plan.from;
        if (got.text != null) texts.push(got.text); else { const f = await readDrop(got, { ai: reader }); if (f.error) return f; texts.push(f.text); }
      } else if (/\.zip$/i.test(name) && b.data) {
        const z = unzip(buf()); let n = 0;
        for (const [file, bytes] of z) { if (n >= 12 || /(^|\/)(__MACOSX|\.)/.test(file)) continue;
          if (FONT.test(file)) { const f = `font-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}${file.match(FONT)[0].toLowerCase()}`; await GP.put(slug, 'assets/' + f, bytes, 'font/woff2');
            upload.kit = { ...(upload.kit || {}), fontFiles: [...(upload.kit?.fontFiles || []), { family: fontName(file.split('/').pop()), src: `/b/${slug}/a/${f}` }] }; continue; }
          if (LOGO.test(file) && /logo|mark|wordmark/i.test(file) && !upload.kit?.logo) { const ext = file.match(LOGO)[1].toLowerCase().replace('jpeg', 'jpg'), f = `logo-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}.${ext}`;
            await GP.put(slug, 'assets/' + f, bytes, ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`); upload.kit = { ...(upload.kit || {}), logo: `/b/${slug}/a/${f}` }; continue; }
          if (!dropKind(file)) continue; n++;
          const f = await readDrop({ name: file.split('/').pop(), data: bytes.toString('base64') }, { ai: reader }).catch(() => null); if (f?.text) texts.push(`[${file}]\n${f.text}`); }
        if (!texts.length && !upload.kit) return { error: 'That ZIP has no file Brew can read: put PDFs, Word or PowerPoint files, logos or fonts in it.' };
      } else if (b.data) { const f = await readDrop({ name, type: b.type, data: b.data }, { ai: reader }); if (f.error) return f; texts.push(f.text); }
      else if (String(b.text || '').trim().length >= 4) texts.push(String(b.text));
      else return { error: 'Upload a file, paste a link, or paste some text.' };
    } catch (e) { log.warn?.('[book] import read', slug, e.message); return { error: `Brew couldn’t read ${name}. Try again, or upload it as a PDF.` }; }
    const text = texts.join('\n\n').slice(0, 150000);
    if (live && text.trim().length > 20) {
      try { const r = await ai.call({ model: 'sonnet', tag: 'brandbook-import', max: 6000, effort: 'low', schema: MAP_SCHEMA,
          prompt: `A brand's team gave Brew this document about their brand (${upload.name}). Copy out what it says about the brand's colours (hex codes as written), fonts, story, voice, words, claims they may make, words they must never use, photo style and logo rules. Copy their own wording; leave out anything the document doesn't say. Never invent.\n\n${text}` });
        const j = r.json || {}; upload.proposed = proposalsOf(j); const k = kitOf(j); upload.kit = { ...(upload.kit || {}), ...(k.colors.length ? { colors: k.colors } : {}), ...(Object.keys(k.fonts).length ? { fonts: k.fonts } : {}) };
        upload.neverSay = (j.neverSay || []).map((x) => tidy(x, 40)).filter(Boolean).slice(0, 30); upload.usd = +(+r.usd || 0).toFixed(4);
      } catch (e) { log.warn?.('[book] import map', slug, e.message); return { error: e.billing ? 'The AI is paused, so Brew can’t read the brand book right now. Try again once it’s back.' : 'Brew read the file but couldn’t sort it into the Brand Book. Try again.' }; }
    } else { const hx = hexesIn(text); if (hx.length) upload.kit = { ...(upload.kit || {}), colors: hx.map((hex, i) => ({ hex, role: i ? 'accent' : 'primary' })) };
      if (!live && !hx.length && !upload.kit) return { error: 'Reading a brand book needs the AI, which is off on this server.' }; }
    const found = upload.proposed.length + (upload.kit?.colors?.length ? 1 : 0) + (upload.kit?.fonts && Object.keys(upload.kit.fonts).length ? 1 : 0) + (upload.kit?.logo ? 1 : 0) + (upload.neverSay.length ? 1 : 0);
    if (!found) return { error: `Brew read ${upload.name} but found nothing about the brand’s look, voice or rules in it.` };
    await BOOK.update(slug, { upload }, meOf(t));
    const raw = await BOOK.load(slug), confirmed = raw.confirmed || {};
    return { ok: true, upload: { id, name: upload.name, kind: upload.kind, from: upload.from || null, private: upload.private, kit: upload.kit, neverSay: upload.neverSay,
      proposed: upload.proposed.map((x) => ({ ...x, confirmed: !!confirmed[x.path] })) } };
  });
}
