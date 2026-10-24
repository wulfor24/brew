// The publish pack: one change version as a zip the team posts or applies themselves. Brew never writes to an account,
// so every family gets what its place needs, ready to upload or paste: the ad's images in each shape and its words, a
// post and where it goes, a message template, a page section, a marketplace CSV, FAQ markup, a Google Ads Editor sheet,
// a checklist, a shot list, the Ads Manager changes to make by hand, a print file. README.txt says what goes where.
// Pure: the caller hands in the version's package and how to read files; remix.js serves it (GET /api/changes/:chid/pack).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { emailHtml } from './draft-mocks.js';
import { boardOf } from './film-board.js'; // a film brief's storyboard: timed shots, the founder's script, captions
import { splitCode, codeBlocks, codeExt, wordsHtml } from './code-md.js'; // fenced code stays code in every file

const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const csvCell = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const list = (x) => (Array.isArray(x) ? x : x ? String(x).split('\n') : []).map((s) => String(s).trim()).filter(Boolean);
const lines = (...xs) => xs.flat().filter((x) => x != null && x !== '' && x !== false && x !== 0).join('\n'); // `n && text` parts drop out when n is 0
/* a checklist step that carries code: the step, then its code as a fenced block under it (never fences inside a "- [ ]" line) */
const stepMd = (s) => splitCode(s).map((x, i) => (x.code ? `\n\`\`\`${x.lang}\n${x.text}\n\`\`\`\n` : `${i ? '' : '- [ ] '}${x.text.trim()}`)).join('\n').replace(/^(?!- \[ \])/, '- [ ] ');
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'brew';
export const SHAPES = { '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 };
const SHAPE_USE = { '1:1': 'feed (square)', '4:5': 'feed (portrait, the most room in the feed)', '9:16': 'Stories and Reels' };
const extOf = (f) => (path.extname(f).toLowerCase().replace('.', '') || 'jpg').replace('jpeg', 'jpg');

/* a centre crop of a picture to a shape, by ffmpeg (in the image; free, local). null when ffmpeg isn't there */
export const cropTo = (file, shape) => new Promise((res) => {
  const r = SHAPES[shape]; if (!r) return res(null);
  const out = path.join(os.tmpdir(), `brew-pack-${crypto.createHash('sha1').update(file + shape).digest('hex').slice(0, 12)}.jpg`);
  execFile(process.env.FFMPEG || 'ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', `crop='min(iw,ih*${r})':'min(ih,iw/${r})',format=yuvj420p`, '-q:v', '3', '-frames:v', '1', out], { timeout: 30e3 }, (e) => {
    if (e || !fs.existsSync(out)) return res(null); const buf = fs.readFileSync(out); fs.rmSync(out, { force: true }); res(buf); });
});

/* a picture that carries its own words is never cropped (a centre crop slices the headline): it is set whole on a soft blurred
   copy of itself at the shape's size. sharp, local, free; null when it can't */
export const fitTo = async (file, shape) => { const r = SHAPES[shape]; if (!r) return null;
  try { const sharp = (await import('sharp')).default, m = await sharp(file).metadata(), W0 = m.width, H0 = m.height; if (!W0 || !H0) return null;
    const [W, H] = r > W0 / H0 ? [Math.round(H0 * r), H0] : [W0, Math.round(W0 / r)];
    const bg = await sharp(file).resize(W, H, { fit: 'cover' }).blur(Math.max(20, Math.round(Math.min(W, H) / 30))).modulate({ brightness: 0.94 }).toBuffer();
    const fg = await sharp(file).resize(W, H, { fit: 'inside' }).toBuffer();
    return await sharp(bg).composite([{ input: fg, gravity: 'center' }]).jpeg({ quality: 90 }).toBuffer(); } catch { return null; } };
/* the picture's words are in it: a Brew Studio take (gen/j2-…) or a version marked so */
export const hasWords = (rel, p = {}) => !!rel && (p.wordsIn === rel || /^\/?gen\/j2-/.test(rel));

/* Ads Editor wants one row per keyword with its match type in its own column: "minoxidil alternative (phrase)" → phrase */
const kwRow = (s) => { const m = /^\[(.+)\]$/.exec(s) || /^"(.+)"$/.exec(s); if (m) return [m[1], s.startsWith('[') ? 'Exact' : 'Phrase'];
  const t = /^(.*?)\s*\((exact|phrase|broad)\)\s*$/i.exec(s); return t ? [t[1].replace(/^["[]|["\]]$/g, ''), t[2][0].toUpperCase() + t[2].slice(1).toLowerCase()] : [s, 'Broad']; };

/* the version's package → { entries: [{ name, data }], readme, todo } — entries is what the zip holds.
   read(rel) → a local file path or null (gen/…, the brand's photos); renderPdf(html) → a PDF buffer or throws */
export async function buildPack({ ch, pkg: p = {}, family, version = 1, brand = {}, assets = [], read = async () => null, renderPdf = null, crop = cropTo, fit = fitTo, cut = [] }) {
  const entries = [], put = (name, data) => entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(String(data)) });
  const where = [], todo = [], links = [];
  const name = brand.name || 'the brand', act = ch.actionLabel || 'The change', target = ch.target || {};
  const place = target.name || target.object || 'its place';
  const addFile = async (rel, as) => { const f = rel && !/^https?:/.test(rel) ? await read(rel) : null; if (!f) { if (/^https?:/.test(rel || '')) links.push(rel); return null; }
    const n = `${as}.${extOf(f)}`; put(n, fs.readFileSync(f)); return { file: f, name: n }; };
  /* the creative in every feed shape: the image as made plus centre crops to the shapes it wasn't made in */
  const shapes = async (rel, base, made = p.format || '4:5') => {
    const f = rel && !/^https?:/.test(rel) ? await read(rel) : null; if (!f) { if (rel) (/^https?:/.test(rel) ? links : todo).push(/^https?:/.test(rel) ? rel : `${base}: the picture couldn’t be read for the pack; download it from the studio`); return []; }
    const got = [];
    for (const s of Object.keys(SHAPES)) {
      if (s === made) { const n = `${base}-${s.replace(':', 'x')}.${extOf(f)}`; put(n, fs.readFileSync(f)); got.push(n); continue; }
      const buf = hasWords(rel, p) ? await fit(f, s) || await crop(f, s) : await crop(f, s); if (buf) { const n = `${base}-${s.replace(':', 'x')}.jpg`; put(n, buf); got.push(n); }
      else todo.push(`${base} at ${s}: crop it from the ${made} file (this server couldn’t)`);
    }
    return got;
  };
  const video = async () => { if (p.video) { const v = await addFile(p.video, 'media/video'); if (v) where.push(`media/${path.basename(v.name)}: the video${p.film?.raw ? ', captions burned in for muted feeds' : ''}`); else todo.push('The video: download it from the studio'); if (!p.film?.cover && (p.poster || p.image)) { const c = await addFile(p.poster || p.image, 'media/cover'); if (c) where.push(`${c.name}: the cover (set it as the video’s cover)`); } }
    /* a Studio film's ready-to-post parts: the clean cut, its captions file, the cover, a looping GIF */
    const fm = p.film || {}; for (const [rel, as, says] of [[fm.raw, 'media/video-no-captions', 'the same film without captions (for a platform that adds its own from captions.srt)'], [fm.cover, 'media/cover', 'the cover (set it as the reel’s cover)'], [fm.gif, 'media/loop', 'a looping GIF of it (email, WhatsApp, banners)']]) { if (!rel) continue; const x = await addFile(rel, as); if (x) where.push(`${x.name}: ${says}`); }
    if (fm.srt) { const sf = await read(fm.srt); if (sf) { put('captions.srt', fs.readFileSync(sf)); where.push(`captions.srt: the words said, timed${fm.captions?.approx ? ' (by estimate: check them once)' : ''}; upload it as the video’s captions`); } } };

  switch (family) {
    case 'meta_ad': case 'social': {
      /* a film is the creative: its cover goes as the cover (in video()), never cut into stills that look like the ad to upload */
      const imgs = p.video ? [] : await shapes(p.image, 'media/creative');
      if (imgs.length) where.push(`media/creative-*: the creative in each shape — ${Object.keys(SHAPES).map((s) => `${s} for ${SHAPE_USE[s]}`).join('; ')}`);
      else if (!p.image && !p.video) todo.push(`The creative is still to be made: ${p.imageBrief || 'see the image brief in copy.txt'}`);
      const rows = p.cards || p.slides || [];
      for (let i = 0; i < rows.length; i++) { const img = (p.cardImages || [])[i] || (i === 0 ? p.image : null); if (img) { const x = await addFile(img, `media/${p.cards ? 'card' : 'slide'}-${String(i + 1).padStart(2, '0')}`); if (!x) todo.push(`${p.cards ? 'Card' : 'Slide'} ${i + 1} photo: download it from the studio`); } else if (i) todo.push(`${p.cards ? 'Card' : 'Slide'} ${i + 1} photo still to be made${rows[i].imageBrief ? `: ${rows[i].imageBrief}` : ''}`); }
      await video();
      const pubLines = [p.publish?.link && `LINK (WITH UTM)\n${p.publish.link}\n`, p.publish?.alt && `ALT TEXT\n${p.publish.alt}\n`]; /* ready to publish (publish-ready.js) */
      put('copy.txt', lines(
        family === 'meta_ad' ? [p.primaryText && `PRIMARY TEXT\n${p.primaryText}\n`, p.headline && `HEADLINE\n${p.headline}\n`, p.description && `DESCRIPTION\n${p.description}\n`, p.cta && `CALL TO ACTION BUTTON\n${p.cta}\n`, p.overlay && `TEXT ON THE IMAGE\n${p.overlay}\n`] : [p.overlay && `TEXT ON THE IMAGE\n${p.overlay}\n`],
        p.caption && `CAPTION\n${p.caption}\n`, list(p.hashtags).length && `HASHTAGS\n${list(p.hashtags).join(' ')}\n`, p.stickers && `STICKER\n${p.stickers}\n`,
        rows.length && `${p.cards ? 'CAROUSEL CARDS' : 'SLIDES'}, IN ORDER\n${rows.map((r, i) => `${i + 1}. ${[r.headline, r.text, r.onSlide].filter(Boolean).join(' — ')}${r.link ? ` (opens ${r.link})` : ''}`).join('\n')}\n`,
        (p.chat || []).length && `WHATSAPP CHAT THAT OPENS\n${p.chat.map((m) => `${m.from === 'in' ? 'Customer' : name}: ${m.text}`).join('\n')}\n`,
        list(p.products).length && `PRODUCTS IN THE GRID\n${list(p.products).join('\n')}${p.instantPage ? `\nOpens to: ${p.instantPage}` : ''}\n`,
        p.productSet && `CATALOG SET\n${p.productSet}${p.frame ? `\nFrame on every photo: ${p.frame}` : ''}\n`,
        pubLines,
        p.imageBrief && `IMAGE BRIEF\n${p.imageBrief}\n`,
        family === 'meta_ad' && `SETTINGS\n${[['Audience', p.audience], ['Placements', p.placements], ['Ad set', p.adSet], ['Daily budget', p.dailyBudget], ['Schedule', p.schedule], ['Link', p.utm]].filter((x) => x[1] != null && x[1] !== '').map(([k, v]) => `${k}: ${v}`).join('\n')}\n`,
        family === 'social' && [p.account && `ACCOUNT\n${p.account}\n`, p.postAt && `GOES UP\n${p.postAt}\n`]));
      where.unshift(family === 'meta_ad' ? `Meta Ads Manager: make the ad with copy.txt and the creative for each placement.${p.adSet ? ` Ad set: ${p.adSet}.` : ''}` : `Instagram${p.account ? ` (${p.account})` : ''}: upload the picture${rows.length > 1 ? 's in order' : ''}, then paste the caption and hashtags from copy.txt.`);
      if (p.utm) links.push(p.utm);
      break; }
    case 'post': {
      if (p.image && !p.video) { const x = await addFile(p.image, 'media/picture'); if (x) where.push(`${x.name}: the picture to attach`); } /* a film's still is its cover (below), not a picture to post */
      for (const [i, u] of (p.photos || []).entries()) if (u !== p.image) await addFile(u, `media/photo-${i + 1}`);
      await video();
      put('copy.txt', lines(p.platform && `PLATFORM\n${p.platform}\n`, p.title && `TITLE\n${p.title}\n`, p.copy && `POST\n${p.copy}\n`, list(p.hashtags).length && `HASHTAGS\n${list(p.hashtags).join(' ')}\n`,
        (p.script || []).length && `SCRIPT\n${p.script.map((x, i) => `${i + 1}. ${x.beat ? x.beat + ': ' : ''}${x.shot} · ${x.line}`).join('\n')}\n`, p.media && `PICTURE OR VIDEO\n${p.media}\n`,
        p.author && `POSTED BY\n${p.author}${p.authorRole ? `, ${p.authorRole}` : ''}\n`, p.postAt && `GOES UP\n${p.postAt}\n`));
      const ws = (p.where || []).filter((w) => w?.name || w?.url);
      put('where.txt', ws.length ? ws.map((w) => `${w.name || 'Here'}${w.url ? `\n${w.url}` : ''}${w.rule ? `\nRule: ${w.rule}` : ''}`).join('\n\n') + '\n' : `${p.platform || place}\n`);
      ws.forEach((w) => /^https?:/.test(w.url || '') && links.push(w.url));
      /* a Meta video ad (remix labelFor: a video card about paid ads) is made in Ads Manager, not posted */
      if (ch?.target?.conn === 'meta') where.unshift(`Meta Ads Manager: make a video ad with the video file for Reels and Stories placements, and the words in copy.txt as its primary text.`);
      else where.unshift(`${p.platform || place}: paste the post from copy.txt in the place named in where.txt${ws.some((w) => w.rule) ? ', keeping to its rule' : ''}. A person posts it; communities want you to say you work at ${name}.`);
      if (p.media && !p.image && !p.video) todo.push(`The picture or video: ${p.media}`);
      break; }
    case 'crm': {
      const ch0 = p.channel || 'WhatsApp', btns = list(p.buttons);
      const head = lines(p.flow && `Flow and step: ${p.flow}`, p.trigger && `Sends: ${p.trigger}`, p.segment && `To: ${p.segment}`, p.exclusions && `Left out: ${p.exclusions}`, p.code && `Code: ${p.code}`, p.expiry && `Expires: ${p.expiry}`);
      put('whatsapp-template.txt', lines('WhatsApp template (submit it for approval in your WhatsApp Business tool). Variables are in {curly braces}.', '', p.message || '', btns.length ? `\nButtons: ${btns.join(' | ')}` : '', head && `\n${head}`));
      const img = p.image ? await addFile(p.image, 'media/email-photo') : null;
      put('email.html', emailHtml({ brand, title: p.subject || ch.title || act, copy: lines(p.subject && `Subject: ${p.subject}`, '', p.message || '', btns[0] && `Button: ${btns[0]}`), photo: img ? img.name : null }));
      put('email.txt', lines(p.subject && `Subject: ${p.subject}`, '', p.message || '', btns.length && `\nButton: ${btns[0]}`, head && `\n${head}`));
      const sms = String(p.message || '').replace(/\s+/g, ' ').trim();
      put('sms.txt', lines(sms.length > 160 ? `${sms.slice(0, 157)}…` : sms, '', sms.length > 160 ? `(Cut to 160 characters for one SMS. The full message is in email.txt.)` : '(Fits one SMS.)'));
      where.unshift(`${ch0 === 'Email' ? 'Your email tool' : ch0 === 'SMS' ? 'Your SMS tool' : 'Your WhatsApp Business tool'}${target.name && target.name !== 'A person' ? ` (${target.name})` : ''}: ${ch0 === 'WhatsApp' ? 'whatsapp-template.txt' : ch0 === 'SMS' ? 'sms.txt' : 'email.html (open it in a browser to see it) and email.txt'} hold the message; the other files are the same words for the other channels.`);
      break; }
    case 'store': {
      const sec = `<section class="brew-section">\n  <h2>${esc(p.heading)}</h2>\n${wordsHtml(p.body, esc).replace(/^(?=<p>|<pre)/gm, '  ')}${list(p.bullets).length ? `\n  <ul>\n${list(p.bullets).map((b) => `    <li>${esc(b)}</li>`).join('\n')}\n  </ul>` : ''}${p.button ? `\n  <a class="brew-button" href="#">${esc(p.button)}</a>` : ''}\n</section>\n`;
      put('section.html', sec);
      put('section.txt', lines(p.pages && `Where: ${p.pages}`, p.section && `Section: ${p.section}`, (p.priceBefore || p.priceAfter) && `Price: ${p.priceBefore || 'now'} → ${p.priceAfter || ''}`, '', p.heading, '', p.body, ...list(p.bullets).map((b) => `• ${b}`), p.button && `[${p.button}]`));
      if (p.image) await addFile(p.image, 'media/section-photo');
      where.unshift(`Your store theme${p.pages ? ` (${p.pages})` : ''}: paste section.html where it says (${p.section || 'see section.txt'}), or copy the words from section.txt into the theme editor.${p.priceAfter ? ' The price change is done in the product’s own settings.' : ''}`);
      break; }
    case 'listing': {
      const items = (p.items || []).length ? p.items : [{ marketplace: '', now: 'As listed today', new: p.name || '' }];
      put('listings.csv', csv([['marketplace', 'product', 'current_title', 'new_title', 'bullets', 'backend_search_terms', 'images'], ...items.map((r) => [r.marketplace, p.product || '', r.now, r.new, list(p.bullets).join(' | '), p.searchTerms || '', p.images || ''])]));
      if (p.reason) put('takedown-request.txt', p.reason + '\n');
      /* the photo set Brew made, in order (the first is the main image), and an Amazon A+ set as its modules at Amazon's sizes */
      if (!(p.photoSet || []).length && !(p.aplus || []).length && p.image) { const f = await addFile(p.image, 'media/listing-01'); if (f) where.push(`${f.name}: listing image 1 (the main image)`); else todo.push('Listing image 1: download it from the jam'); } /* a single Studio listing image */
      for (const [i, x] of (p.photoSet || []).entries()) { const f = await addFile(x?.image, `media/listing-${String(i + 1).padStart(2, '0')}`); if (f) where.push(`${f.name}: listing image ${i + 1}${i === 0 ? ' (the main image)' : ''}`); else if (x?.image) todo.push(`Listing image ${i + 1}: download it from the studio`); }
      if ((p.aplus || []).length) { const W = { header: '970×600 header image', tile: '300×300 tile', wide: '970×300 image' };
        for (const [i, m] of p.aplus.entries()) { const f = await addFile(m.image, `media/aplus-${String(i + 1).padStart(2, '0')}-${m.kind}`); if (!f) todo.push(`A+ module ${i + 1}: download it from the studio`); }
        put('aplus.txt', lines('AMAZON A+ CONTENT, MODULE BY MODULE (Seller Central → Advertising → A+ Content Manager)', '', ...p.aplus.map((m, i) => `${i + 1}. ${W[m.kind] || m.kind} — media/aplus-${String(i + 1).padStart(2, '0')}-${m.kind}\n${m.headline ? `Headline: ${m.headline}\n` : ''}${m.body ? `Text: ${m.body}\n` : ''}`), p.publish?.alt ? `Image alt text: ${p.publish.alt}` : ''));
        where.push('aplus.txt and media/aplus-*: the A+ modules in order, each image at Amazon’s size with its headline and text'); }
      where.unshift(`Each marketplace’s seller tool: listings.csv has one row per listing with the new title${list(p.bullets).length ? ', bullets' : ''} and search terms. Upload it as a flat file or paste each row by hand.${p.reason ? ' takedown-request.txt is the request to file.' : ''}`);
      break; }
    case 'vis': {
      const es = (p.entries || []).filter((e) => e?.q && e?.a), key = String(ch.action || '').split('.').pop();
      if (key === 'llms_txt') put('llms.txt', lines(`# ${name}`, '', `> ${p.asOf ? `As of ${p.asOf}. ` : ''}Facts about ${name}, with sources.`, '', ...es.map((e) => `## ${e.q}\n${e.a}${e.source ? `\nSource: ${e.source}` : ''}\n`)));
      else if (key === 'schema_fix') { /* product markup from the catalog's own product: its name, price, currency, page and photo (never the file's description as the name) */
        const it = brand.item || {}, amt = it.price != null ? +String(it.price).replace(/[^\d.]/g, '') : null, cur = brand.currency || null;
        put('product-schema.json', JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: it.name || brand.product || name, ...(it.img && /^https?:/.test(it.img) ? { image: it.img } : {}), brand: { '@type': 'Brand', name },
          ...(amt && cur ? { offers: { '@type': 'Offer', price: amt, priceCurrency: cur, availability: `https://schema.org/${it.out ? 'OutOfStock' : 'InStock'}`, ...(it.url ? { url: it.url } : {}) } } : {}),
          ...(es.length ? { additionalProperty: es.map((e) => ({ '@type': 'PropertyValue', name: e.q, value: e.a })) } : {}) }, null, 2) + '\n');
        if (!(amt && cur)) todo.push('Add the price and currency to product-schema.json (offers): Brew couldn’t read them for this product.'); }
      if (key !== 'schema_fix') {
      put('faq.html', `<section class="brew-faq">\n${p.asOf ? `  <p class="as-of">As of ${esc(p.asOf)}</p>\n` : ''}${es.map((e) => `  <details>\n    <summary>${esc(e.q)}</summary>\n    ${wordsHtml(e.a, esc) || '<p></p>'}${e.source ? `\n    <p class="source">Source: ${esc(e.source)}</p>` : ''}\n  </details>`).join('\n')}\n</section>\n`);
      put('faq-jsonld.html', `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: es.map((e) => ({ '@type': 'Question', name: e.q, acceptedAnswer: { '@type': 'Answer', text: e.a } })) }, null, 2)}\n</script>\n`);
      }
      where.unshift(key === 'schema_fix' ? 'Your product page: add product-schema.json as JSON-LD (in a <script type="application/ld+json"> tag), then test it in Google’s Rich Results Test.' : `${p.file || 'Your site'}: ${key === 'llms_txt' ? 'upload llms.txt to the site root; ' : ''}faq.html is the answers as a page section and faq-jsonld.html the markup AI tools and Google read. Put both on the same page.`);
      break; }
    case 'search': {
      const camp = `${name} · ${p.adGroup || 'Search'}`, hs = list(p.headlines).slice(0, 15), ds = list(p.descriptions).slice(0, 4);
      /* Editor's own values: the bid strategy by its name, the campaign as Search and Paused (the README says it comes in paused) */
      const bid = /target cpa|cost per (?:order|acquisition|first order)|cpa/i.test(p.bidding || '') ? 'Target CPA' : /roas|return on ad spend/i.test(p.bidding || '') ? 'Target ROAS' : /conversion value/i.test(p.bidding || '') ? 'Maximize conversion value' : /click/i.test(p.bidding || '') ? 'Maximize clicks' : 'Maximize conversions';
      const head = ['Campaign', 'Campaign Type', 'Campaign Status', 'Ad group', 'Ad Group Status', 'Keyword', 'Criterion Type', ...hs.map((_, i) => `Headline ${i + 1}`), ...ds.map((_, i) => `Description ${i + 1}`), 'Final URL', 'Ad type', 'Budget', 'Bid Strategy Type'];
      const blank = (n) => Array(n).fill(''), pad = hs.length + ds.length;
      const rows = [head, [camp, 'Search', 'Paused', '', '', '', '', ...blank(pad), '', '', p.dailyBudget ?? '', bid], [camp, '', '', p.adGroup || '', 'Enabled', '', '', ...hs, ...ds, p.finalUrl || '', 'Responsive search ad', '', '']];
      for (const k of list(p.keywords)) { const [kw, mt] = kwRow(k); rows.push([camp, '', '', p.adGroup || '', '', kw, mt, ...blank(pad), '', '', '', '']); }
      for (const k of list(p.negatives)) { const [kw, mt] = kwRow(k); rows.push([camp, '', '', p.adGroup || '', '', kw, `Negative ${mt}`, ...blank(pad), '', '', '', '']); }
      if (p.bidding && bid === 'Maximize conversions' && !/maxim/i.test(p.bidding)) todo.push(`Bid strategy: the plan says “${p.bidding}”; the file sets Maximize conversions. Change it in Editor if you want another.`);
      put('google-ads-editor.csv', csv(rows));
      if (p.finalUrl) links.push(p.finalUrl);
      where.unshift('Google Ads Editor: Account › Import › From file, pick google-ads-editor.csv, review the changes, then post them from Editor yourself. The campaign comes in paused until you turn it on.');
      break; }
    case 'setup':
      put('checklist.md', lines(`# ${act}`, '', p.tool && `**Where:** ${p.tool}`, '', p.what && `## What changes\n${p.what}\n`, '## Steps', ...list(p.steps).map(stepMd), '', p.verify && `## How we know it worked\n${p.verify}\n`, p.customerSees && `## What customers see\n${p.customerSees}\n`));
      where.unshift(`${p.tool || place}: work down checklist.md and tick each step.`);
      break;
    case 'outreach':
      put('email.txt', lines([p.to, p.company].some(Boolean) && `To: ${[p.to, p.company].filter(Boolean).join(', ')}`, p.subject && `Subject: ${p.subject}`, '', p.body || ''));
      where.unshift('Your own inbox: email.txt is one email to one person at the business; a person on your team sends it (no list, no flow).');
      break;
    case 'brief':
      put('shot-list.md', lines(`# ${p.title || act}`, '', list(p.deliverables).length && `## Deliverables\n${list(p.deliverables).map((d) => `- ${d}`).join('\n')}\n`, '## Shots', ...(p.scenes || []).map((x, i) => `${i + 1}. **${x.shot}** — ${x.line}`), '', [['Talent', p.talent], ['Location', p.location], ['Deadline', p.deadline]].filter((x) => x[1]).map(([k, v]) => `**${k}:** ${v}`).join('  \n')));
      { const fb = boardOf({ ...(ch || {}), family, pkg: p }); /* a film brief: the timed storyboard, the script to read on camera and the captions */
        if (fb) { put('storyboard.md', lines(`# ${p.title || 'Storyboard'}`, '', `${fb.total} s · ${fb.format} · On camera: ${fb.talent}`, '', ...fb.shots.map((x) => `${x.n}. **${x.from}–${x.to} s · ${x.shot}**${x.line ? `\n   ${x.say ? 'Says' : fb.vo ? 'Voiceover' : 'On screen'}: ${x.line}` : ''}`)));
          if (fb.script) put('script.txt', fb.script + '\n'); if (fb.srt) put('captions.srt', fb.srt); }
        where.unshift(fb ? 'Your crew or creator: shot-list.md is the brief to shoot from; storyboard.md times every shot, script.txt is what is said on camera and captions.srt drops onto the cut.' : 'Your crew or creator: shot-list.md is the brief to shoot from.'); }
      break;
    case 'meta_ops':
      put('ads-manager-changes.csv', csv([['ad_set_or_ad', 'now', 'change_to', 'rule', 'checks'], ...(p.items || []).map((r) => [r.name, r.now, r.next, p.rule || '', p.checkAt || ''])]));
      put('do-this-in-ads-manager.txt', lines(`${act}${p.summary ? `: ${p.summary}` : ''}`, '', 'Brew changes nothing in your ad account. Open Meta Ads Manager and make each change below by hand:', '', ...(p.items || []).map((r, i) => `${i + 1}. ${r.name}: ${r.now} → ${r.next}`), p.rule && `\nRule: ${p.rule}`, p.checkAt && `Checks: ${p.checkAt}`, p.spendChangeWeek ? `\nSpend change a week: ${p.spendChangeWeek}` : ''));
      where.unshift('Meta Ads Manager: make each change in ads-manager-changes.csv by hand (do-this-in-ads-manager.txt says it step by step).');
      break;
    case 'print': {
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${/a6/i.test(p.size || '') ? 'A6' : /a5/i.test(p.size || '') ? 'A5' : '105mm 148mm'};margin:0}body{margin:0;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}.pg{height:100vh;box-sizing:border-box;padding:12mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}h1{font-size:20pt;margin:0 0 6mm}p{font-size:11pt;line-height:1.4;white-space:pre-wrap;margin:0}.qr{margin-top:8mm;font-size:9pt;color:#555}</style></head><body>
<div class="pg"><h1>${esc(name)}</h1><p>${esc(p.front)}</p></div>${p.back ? `<div class="pg"><p>${esc(p.back)}</p>${p.qr ? `<p class="qr">QR code: ${esc(p.qr)}</p>` : ''}</div>` : ''}</body></html>`;
      let pdf = null; if (renderPdf) { try { pdf = await renderPdf(html); } catch { pdf = null; } }
      if (pdf) put('print.pdf', pdf); else { put('print.html', html); todo.push('print.pdf couldn’t be made on this server: open print.html in Chrome and Save as PDF'); }
      put('print-spec.txt', lines(`Size and paper: ${p.size || 'to confirm'}`, `Quantity: ${p.quantity ?? 'to confirm'}`, `Goes into: ${p.goesIn || 'to confirm'}`, p.qr && `QR code goes to: ${p.qr}`));
      /* the designed front Studio made goes to the printer as the artwork, the words file stays as the back and the proof */
      const art = p.image ? await addFile(p.image, 'print-front') : null; if (art) where.unshift(`Your printer: ${art.name} is the front artwork; ${pdf ? 'print.pdf' : 'print.html (saved as PDF)'} has the back and the words, with print-spec.txt. A printed run can’t be changed, so check the proof first.`);
      else where.unshift(`Your printer: send ${pdf ? 'print.pdf' : 'print.html (saved as PDF)'} with print-spec.txt. A printed run can’t be changed, so check the proof first.`);
      break; }
    default:
      put('decision.md', lines(`# ${p.decision || act}`, '', p.why && `## Why\n${p.why}\n`, p.owner && `**Who decides:** ${p.owner}`, '', list(p.changes).length && `## What changes\n${list(p.changes).map((c) => `- ${c}`).join('\n')}`));
      where.unshift('The team: decision.md is the call to make and what it changes.');
  }
  /* a version remade as a video, carousel or image (remix.js remake), or the card's first draft: its media and words, for any family */
  const d = p.draft;
  if (d && !d.text && (d.images?.length || d.video || d.slides || d.script)) {
    const as = /^(video|carousel|image)$/.test(d.as || '') ? d.as : 'draft', seen = new Set([p.image, p.video, ...(p.cardImages || [])].filter(Boolean)), got = [];
    for (const [i, rel] of (d.images || []).entries()) if (!seen.has(rel)) { const x = await addFile(rel, `media/${as}-${String(i + 1).padStart(2, '0')}`); if (x) got.push(x.name); }
    if (d.video && !seen.has(d.video)) { const x = await addFile(d.video, `media/${as}-video`); if (x) got.push(x.name); else todo.push('The video: download it from the studio'); }
    const words = lines((d.slides || []).length && `SLIDES, IN ORDER\n${d.slides.map((x, i) => `${i + 1}. ${x.text || x.onSlide || ''}`).join('\n')}\n`, (d.script || []).length && `SCRIPT\n${d.script.map((x, i) => `${i + 1}. ${x.beat ? x.beat + ': ' : ''}${x.shot ? x.shot + ' · ' : ''}${x.line}`).join('\n')}\n`, d.overlay && `TEXT ON THE IMAGE\n${d.overlay}\n`);
    if (words) put(`${as}.txt`, words);
    if (got.length || words) where.push(`${as === 'draft' ? 'The first draft' : `The ${as} version`}: ${got.length ? `${got.length > 1 ? 'files' : 'file'} media/${as}-*` : 'the media is still being made in the studio'}${words ? ` and its words in ${as}.txt` : ''}. Post it ${as === 'video' ? 'as a Reel, Short or Story' : as === 'carousel' ? 'as a carousel, in order' : 'as a single image'} on ${name}’s own accounts.`);
    if (d.pending) todo.push(`The ${as} is still being made: download the pack again when it’s ready`);
  }
  /* a text draft that is code (product markup, llms.txt, a snippet): each block as the file it is, ready to paste */
  if (d?.text && d.code) {
    const bs = codeBlocks(d.code), ak = String(ch.action || '').split('.').pop(), names = bs.map((b, i) => `code/${ak === 'schema_fix' || /json-?ld|ld\+json/i.test(`${b.lang} ${b.text.slice(0, 80)}`) || /"@context"/.test(b.text) ? 'markup' : 'snippet'}-${i + 1}.${codeExt(b.lang)}`);
    bs.forEach((b, i) => put(names[i], b.text.replace(/\n*$/, '\n')));
    if (bs.length) where.push(`The first draft's code: ${names.join(', ')}, exactly as written.${names.some((n) => n.endsWith('.json') && n.includes('markup')) ? ' A JSON-LD file goes inside <script type="application/ld+json"> on the page.' : ''}`);
  }
  for (const a of assets) if (a.kind === 'link' && a.url && !links.includes(a.url)) links.push(a.url);
  if (links.length) put('links.txt', [...new Set(links)].join('\n') + '\n');
  if (cut.length) todo.unshift(`Brew took these out of the copy here because your store doesn’t back them: ${cut.map((x) => `“${x}”`).join(', ')}. The jam still shows them: edit them there too.`); /* the zip's words differ from the jam's: say so */
  const readme = lines(`${act} — ${name}, version ${version}`, '',
    `Brew made this pack and changes nothing in your accounts. Nothing here is live until someone on your team puts it up.`, '',
    'WHERE EACH PART GOES', ...where.map((w) => `- ${w}`), '',
    todo.length && ['STILL TO DO', ...todo.map((x) => `- ${x}`), ''].join('\n'),
    ch.money ? `Spend: ${ch.costLabel || 'this spends money; confirm the budget before it runs'}` : 'Spend: none',
    ch.irreversible ? `Can’t be undone: ${ch.irreversible}` : ch.rollback ? `If it goes wrong: ${ch.rollback}` : '',
    '', 'FILES', ...entries.map((e) => `- ${e.name}`), '- README.txt');
  entries.unshift({ name: 'README.txt', data: Buffer.from(readme + '\n') });
  return { entries, readme, todo, fileName: `${slugOf(name)}-${slugOf(act)}-v${version}.zip` };
}
