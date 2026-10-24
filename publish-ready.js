// Ready to publish: everything a platform needs for a made creative, each part with its limit, and the one check that says
// "Ready to publish" or "Needs a look". Parts come from the package (the words Brew wrote, the team's edits) and from what Brew
// knows (the product's own page for the link, the jam for the UTM, the style for the alt text); nothing is invented to fill a
// gap: a missing part is named with the way to fill it. The check reads every word a shopper sees, the words in the picture
// too: lengths, made-up codes, guarantees and timed results (claims.js), copy that reads wrong, a price or a rating that isn't
// the brand's own, the right product, a link to the brand's own site. Pure: no calls, no spend; brand-agnostic.
import { claimFlags, copyFlags } from './claims.js';

const tidy = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,]+/)).map((x) => tidy(x, 80)).filter(Boolean);
export const META_CTAS = ['Shop now', 'Learn more', 'Order now', 'Get offer', 'Sign up', 'Book now', 'Contact us', 'Send WhatsApp message', 'Get quote', 'Subscribe'];
/* where each family runs, and the shapes it needs: the pack cuts every one from the one make (publish-pack.js SHAPES) */
const PLACES = { aplus: [['970×600', 'A+ header'], ['300×300', 'A+ tiles'], ['970×300', 'A+ wide image']], meta_ad: [['4:5', 'Feed'], ['1:1', 'Feed, right column'], ['9:16', 'Stories and Reels']], social: [['4:5', 'Post'], ['1:1', 'Grid'], ['9:16', 'Story']], post: [['9:16', 'Reels, TikTok, Shorts']], listing: [['1:1', 'Listing']], print: [['A5', 'Print']] };
const SOURCE = { meta_ad: ['meta', 'paid_social'], social: ['instagram', 'social'], post: ['social', 'social'], listing: ['marketplace', 'listing'], print: ['print', 'insert'] };
/* a UTM value: lower-case words joined by -, cut at a whole word (never "…-with-ou") */
const slug = (s) => { const w = tidy(s, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); if (w.length <= 40) return w || 'brew'; const cut = w.slice(0, 41); return cut.slice(0, cut.lastIndexOf('-') > 10 ? cut.lastIndexOf('-') : 40) || 'brew'; };

/* the product's own page (never a guessed path: platforms differ), with the jam's UTM */
export function linkOf({ family, product = null, host = '', campaign = '', content = '' }) {
  const base = product?.url && /^https?:\/\//.test(product.url) ? product.url : host ? `https://${String(host).replace(/^https?:\/\//, '').replace(/\/$/, '')}/` : '';
  if (!base) return '';
  const [src, med] = SOURCE[family] || ['brew', 'social'];
  try { const u = new URL(base); u.searchParams.set('utm_source', src); u.searchParams.set('utm_medium', med); u.searchParams.set('utm_campaign', slug(campaign)); if (content) u.searchParams.set('utm_content', slug(content)); return u.toString(); } catch { return base; }
}
export const altOf = ({ product = '', look = '', brand = '' }) => tidy(`${brand && product && !product.toLowerCase().includes(brand.toLowerCase()) ? `${tidy(brand, 40)} ` : ''}${tidy(product, 80) || 'The product'}${look ? `: ${tidy(look, 120).replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.$/, '')}` : ''}`, 220) + '.';

/* a price in the words is the brand's own when the store, the card's evidence or the catalog has it */
const PRICE = /(₹|rs\.?|inr|\$|€|£|aed|sgd)\s?([\d,]+(?:\.\d+)?)/gi;
const num = (s) => +String(s).replace(/,/g, '');
function pricesOk(text, src, catalog = []) {
  const known = new Set(); for (const x of catalog || []) for (const k of ['price', 'compareAt', 'compare_at', 'p']) if (x?.[k] != null && Number.isFinite(num(x[k]))) known.add(Math.round(num(x[k])));
  const s = String(src || '').toLowerCase(), bad = [];
  for (const m of String(text).matchAll(PRICE)) { const n = num(m[2]); if (!Number.isFinite(n)) continue; const r = Math.round(n);
    if (known.has(r) || s.includes(m[2].toLowerCase()) || s.includes(String(r))) continue; bad.push(m[0]); }
  return [...new Set(bad)];
}
/* a star rating in the words is backed only when the brand's own reviews say that number */
const RATING = /(\d(?:\.\d)?)\s*(?:★|⭐|stars?\b|\/\s*5\b|out of 5)|rated\s+(\d(?:\.\d)?)/gi;
function ratingsOk(text, src) {
  const s = String(src || '').toLowerCase(), bad = [];
  for (const m of String(text).matchAll(RATING)) { const n = m[1] || m[2]; let ok = false; let i = s.indexOf(n);
    while (i >= 0 && !ok) { const near = s.slice(Math.max(0, i - 60), i + n.length + 60); if (/rat|★|⭐|star|review/.test(near)) ok = true; i = s.indexOf(n, i + 1); }
    if (!ok) bad.push(m[0].trim()); }
  /* a review count ("from 226 reviews", "2,100+ ratings") is the brand's own only when that number is in its reviews too */
  for (const m of String(text).matchAll(/(\d[\d,]{1,})\+?\s*(?:verified\s+)?(reviews?|ratings?|happy customers|customers)\b/gi)) { const n = m[1].replace(/,/g, ''); let ok = false;
    for (const v of [m[1], n]) { let i = s.indexOf(v.toLowerCase()); while (i >= 0 && !ok) { const near = s.slice(Math.max(0, i - 60), i + v.length + 60); if (/review|rating|customer|★|star/.test(near)) ok = true; i = s.indexOf(v.toLowerCase(), i + 1); } }
    if (!ok) bad.push(m[0].trim()); }
  return [...new Set(bad)];
}

/* Amazon's A+ content rules: no prices or deals, no ratings, reviews or quotes, no "best" or "#1", no shipping, guarantees or
   time-limited offers, no links or contact details */
const APLUS_BAN = [[/[₹$€£]\s?\d|\b(rs\.?|inr|aed)\s?\d|\bprice[ds]?\b|\b(sale|discount|deal|% off|off on|save \d|offer)\b/i, 'a price or a deal'], [/\d(\.\d)?\s*(★|⭐|stars?\b|\/\s*5)|\b(rated|reviews?|testimonials?|customers say)\b/i, 'a rating or a review'],
  [/\b(best|number one|no\.?\s?1|top[- ]rated|best[- ]selling|bestseller)\b|#\s?1\b/i, '“best” or “#1”'], [/\b(free (shipping|delivery)|ships?|delivery|guarantee[ds]?|warranty|money[- ]back|refund)\b/i, 'shipping or a guarantee'],
  [/\b(limited time|today only|hurry|now only|new arrival|this week)\b/i, 'a time-limited line'], [/https?:\/\/|www\.|\.com\b|@\w+\.|\+?\d[\d\s-]{8,}/i, 'a link or contact details']];
export const aplusFlags = (text) => APLUS_BAN.filter(([re]) => re.test(String(text || ''))).map(([, why]) => why);

/* the parts each family publishes with, as the platform shows them */
function partsOf(family, action, p, extra) {
  const P = []; const add = (k, label, value, o = {}) => P.push({ k, label, value: value ?? '', ...o });
  const pub = p.publish || {};
  if (Array.isArray(p.aplus) && p.aplus.length) { /* Amazon A+: each module's words are page text beside its image */
    p.aplus.forEach((m, i) => { const name = m.kind === 'header' ? 'Header' : m.kind === 'wide' ? 'Wide image' : `Tile ${p.aplus.slice(0, i + 1).filter((x) => x.kind === 'tile').length}`;
      add(`aplus.${i}.headline`, `${name} · headline`, m.headline, { max: 160, req: m.kind !== 'header', aplus: true }); if (m.kind !== 'header') add(`aplus.${i}.body`, `${name} · text`, m.body, { max: 1000, aplus: true }); });
    add('alt', 'Alt text', pub.alt || extra.alt, { max: 100, req: true, made: !pub.alt, note: 'Amazon keeps 100 characters' }); return P; }
  if (family === 'meta_ad') {
    add('primaryText', 'Primary text', p.primaryText, { soft: 125, max: 2200, req: true, note: 'Meta shows about 125 characters before “…more”' });
    add('headline', 'Headline', p.headline, { soft: 40, max: 255, req: true, note: 'Meta cuts it at about 40 on phones' });
    add('description', 'Description', p.description, { soft: 30, max: 255 });
    add('cta', 'Button', p.cta, { req: true, opts: META_CTAS });
    (Array.isArray(p.cards) ? p.cards : []).forEach((c, i) => { add(`cards.${i}.headline`, `Card ${i + 1} · headline`, c.headline, { soft: 40, max: 255, req: true }); if (c.text) add(`cards.${i}.text`, `Card ${i + 1} · line`, c.text, { soft: 60, max: 255 }); });
  } else if (family === 'social') {
    (Array.isArray(p.slides) ? p.slides : []).forEach((c, i) => { add(`slides.${i}.onSlide`, `Slide ${i + 1} · words`, c.onSlide, { soft: 60, max: 120 }); });
    add('caption', 'Caption', p.caption, { soft: 125, max: 2200, req: true, note: 'The first line is what shows before “more”' });
    add('hashtags', 'Hashtags', list(p.hashtags).join(' '), { req: true, tags: [3, 8] });
  } else if (family === 'post') {
    add('title', 'Title', p.title, { soft: 70, max: 100, req: !/short_video$/.test(action) /* Reels and TikTok have no title; YouTube and posts do */ }); add('copy', 'Caption', p.copy, { soft: 150, max: 2200, req: true });
    add('hashtags', 'Hashtags', list(p.hashtags).join(' '), { tags: [3, 8] });
  } else if (family === 'listing') {
    add('name', 'Title', p.name || p.items?.[0]?.new, { max: 200, req: true }); add('bullets', 'Bullet points', list(p.bullets).join('\n'), { req: true, lines: 5, lineMax: 250 });
    add('searchTerms', 'Search terms', p.searchTerms, { max: 250 });
  }
  if (family !== 'listing' && family !== 'print') add('link', 'Link', pub.link || extra.link, { req: true, link: true, made: !pub.link });
  add('alt', 'Alt text', pub.alt || extra.alt, { max: 220, req: true, made: !pub.alt });
  return P;
}

export function readyOf({ family, action = '', pkg = {}, card = {}, product = null, cardProduct = null, catalog = [], brand = '', host = '', source = '', words = [], wordsRead = true, recreated = null, style = null, version = 1, quality = null }) {
  const p = pkg || {}, look = style?.label || '';
  const extra = { link: linkOf({ family, product, host, campaign: card.title || card.id || brand, content: `${style?.id || 'creative'}-v${version}` }), alt: altOf({ product: product?.name || cardProduct?.name || '', look: style?.look || look, brand }) };
  const parts = partsOf(family, action, p, extra).map((x) => {
    const v = String(x.value || ''), n = v.length, why = [];
    if (x.req && !v.trim()) why.push({ bad: true, t: `${x.label} is empty` });
    if (x.max && n > x.max) why.push({ bad: true, t: `${x.label} is ${n} characters; the most is ${x.max}` });
    else if (x.soft && n > x.soft) why.push({ t: `${x.label}: ${n} characters; ${x.note || `over ${x.soft} gets cut`}` });
    if (x.opts && v && !x.opts.includes(v)) why.push({ bad: true, t: `“${v}” isn’t a ${x.label.toLowerCase()} the platform offers` });
    if (x.tags) { const k = list(v.replace(/\s+/g, '\n')).length; if (v && (k < x.tags[0] || k > x.tags[1])) why.push({ t: `${k} hashtags; ${x.tags[0]}–${x.tags[1]} work best` }); }
    if (x.lines) { const ls = v.split('\n').filter(Boolean); if (v && ls.length !== x.lines) why.push({ t: `${ls.length} bullets; listings take ${x.lines}` }); if (ls.some((l) => l.length > x.lineMax)) why.push({ bad: true, t: `A bullet is over ${x.lineMax} characters` }); }
    if (x.aplus && v) for (const w of aplusFlags(v)) why.push({ bad: true, t: `Amazon doesn’t allow ${w} in A+ content` });
    if (x.link && v && host && !new RegExp(String(host).replace(/^www\./, '').replace(/[.]/g, '\\.'), 'i').test(v)) why.push({ bad: true, t: 'The link isn’t on your own site' });
    return { ...x, n, ok: !why.some((w) => w.bad), warn: why.filter((w) => !w.bad).map((w) => w.t), why: why.filter((w) => w.bad).map((w) => w.t) };
  });
  /* every word a shopper reads: the parts, and the words in the picture itself */
  const seen = [...parts.filter((x) => !x.link).map((x) => x.value), p.overlay, ...(words || [])].filter(Boolean).join('\n');
  const checks = [];
  const cf = claimFlags(seen, source); checks.push({ k: 'claims', ok: !cf.length, t: cf.length ? `Claims your store doesn’t make: ${cf.slice(0, 3).map((f) => f.why).join('; ')}` : 'No made-up codes, guarantees or timed results' });
  const written = parts.filter((x) => !x.link && !x.opts && !x.tags && x.k !== 'alt').map((x) => x.value).filter(Boolean).join('\n\n'); /* hashtags and alt text are not sentences: "#Arata" then "Arata Curl Serum" is no repeated word */ /* a button in caps in the picture is an ad's button, not shouting */
  const lf = copyFlags(written, { source, names: [brand, ...(catalog || []).map((x) => x?.t || x?.title)].filter(Boolean) }); checks.push({ k: 'copy', ok: !lf.length, t: lf.length ? `Reads wrong: ${lf.slice(0, 2).join('; ')}` : 'Reads right' });
  const bp = pricesOk(seen, source, catalog); checks.push({ k: 'price', ok: !bp.length, t: bp.length ? `${bp.join(', ')} isn’t a price on your store today` : 'Every price is today’s' });
  const br = ratingsOk(seen, source); checks.push({ k: 'rating', ok: !br.length, t: br.length ? `“${br.join('”, “')}” isn’t from your own reviews` : 'No rating that isn’t yours', fix: br.length ? 'redo' : null });
  /* a picture whose words Brew didn't keep (made before it kept them) was never read: say so, never "no problems" */
  if (!wordsRead) { const i = checks.findIndex((c) => c.k === 'price'); for (const c of checks) if (['price', 'rating', 'claims'].includes(c.k) && c.ok) c.t = `${c.t} in the words above`; checks.splice(i, 0, { k: 'picture', ok: false, soft: true, t: 'The words in the picture weren’t read for this version: check its prices, ratings and claims yourself, or Redo it' }); }
  /* someone else's footage with the product swapped in keeps their people, faces, voices and words: never the brand's to post */
  if (quality === 'preview') checks.unshift({ k: 'preview', ok: false, soft: true, fix: 'redo', t: 'This is the quick preview, at low resolution: make the full one before you post it' });
  if (recreated) checks.unshift({ k: 'rights', ok: false, t: `This is ${recreated.by ? `${recreated.by}’s` : 'someone else’s'} video with your product swapped in: their face, voice and words are still in it. Don’t post it without their written permission; make a Viral short in its pattern instead.` });
  /* a film: its spoken words are captioned (most feeds play muted), and an approximate timing is said */
  if (p.video && p.film) { const c = p.film.captions || {};
    checks.push(c.none ? { k: 'captions', ok: true, t: c.none } : c.n && p.film.srt ? { k: 'captions', ok: !c.approx, soft: !!c.approx, t: c.approx ? 'Captions are set from the script, timed by estimate: watch it once before it goes up' : `Captions on (${c.n} lines), and an .srt for the platform’s own captions` } : { k: 'captions', ok: false, t: c.error || 'No captions: muted feeds will play it without words' });
    if (!p.film.cover) checks.push({ k: 'cover', ok: false, soft: true, t: 'No cover picked: the platform will take a frame' }); }
  /* the words were written for this piece: they name the product it shows (a caption written for another idea before the film was made reads wrong) */
  const key = String(product?.name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !/^(pack|with|from|this|that|combo|bottle|tube)$/.test(w)).slice(0, 3);
  const said = parts.filter((x) => ['caption', 'copy', 'primaryText', 'title', 'headline'].includes(x.k)).map((x) => String(x.value || '')).join(' ').toLowerCase();
  if (key.length && said.trim() && !key.some((w) => said.includes(w))) checks.push({ k: 'match', ok: false, soft: true, t: `The words don’t mention ${tidy(product.name, 50)}: they may have been written for another idea. Ask Brew to rewrite them from this ${p.video ? 'film' : 'picture'}.` });
  if (cardProduct?.name && product?.name && cardProduct.name !== product.name) checks.push({ k: 'product', ok: false, soft: true, t: `It shows ${tidy(product.name, 50)}; the card is about ${tidy(cardProduct.name, 50)}` });
  else if (product?.name) checks.push({ k: 'product', ok: true, t: `Shows ${tidy(product.name, 60)}, the card’s product` });
  const places = p.video ? [] /* a film runs in the shape it was made; its cover and GIF are listed with it */ : (PLACES[Array.isArray(p.aplus) && p.aplus.length ? 'aplus' : family] || []).map(([shape, where]) => ({ shape, where }));
  const bad = parts.filter((x) => !x.ok).length + checks.filter((x) => !x.ok && !x.soft).length, warn = parts.reduce((a, x) => a + x.warn.length, 0) + checks.filter((x) => !x.ok && x.soft).length;
  return { parts, checks, places, ready: bad === 0, bad, warn };
}
