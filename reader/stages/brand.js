// Stage 2 · brand: logo (downloaded), top 3 colours ranked by use in the theme CSS, font families, tagline, descriptor.
import { meta, attr, tags, abs, clean, stripTags, pathOf, pool, hostOf } from '../util.js';
import { inlineSprite, drawableSvg } from '../svg-logo.js';

/* the "who you are" fields, from the same places the check page reads them (build.js checkData) */
export const whoOf = (p) => ({ name: p.name || null, descriptor: p.descriptor || p.tagline || null, category: p.category || null, country: p.country || null, currency: p.currency || null });

const GENERIC = /^(inherit|initial|unset|serif|sans-serif|monospace|cursive|fantasy|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|segoe ui|roboto|helvetica neue|helvetica|arial|noto sans|liberation sans|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|var\(.*|times new roman|times|georgia|courier new|courier|menlo|monaco|consolas|emoji|math|fangsong|swiper-icons|icomoon|fontawesome|font awesome.*|slick|star|stars|jdgm.*|judgeme.*|loox.*|yotpo.*|icons?|glyphicons.*|material icons|.*icons?)$/i;

export async function brand(ctx) {
  const { http, ledger, profile, state } = ctx; const html = state.home; const base = state.homeUrl;
  ctx.tick('brand', '/');

  /* logo */
  /* the site header, not the first <header> tag: themes put small ones in drawer and popup templates above it (scrubroom.in, 24 Oct),
     so the header holding a logo wins, then the biggest one */
  const hdrs = html.match(/<header\b[\s\S]*?<\/header>/gi) || [];
  const header = hdrs.find((h) => /<(?:img|svg)\b[^>]*logo|logo[^>]*>\s*<(?:img|svg)\b/i.test(h)) || [...hdrs].sort((a, b) => b.length - a.length)[0] || html.slice(0, 60000);
  const cands = [];
  for (const t of tags(header, 'img')) {
    const src = attr(t, 'src') || attr(t, 'data-src') || (attr(t, 'srcset') || '').split(/[\s,]+/)[0];
    if (!src) continue; const s = `${attr(t, 'class') || ''} ${attr(t, 'alt') || ''} ${src} ${attr(t, 'id') || ''}`;
    if (/logo/i.test(s) || (profile.name && new RegExp(`^${esc(profile.name)}$`, 'i').test(attr(t, 'alt') || ''))) cands.push({ url: abs(src, base), how: 'header <img>' });
  }
  const svgLogo = (header.match(/<a\b[^>]*(?:logo|header__heading-link|site-header__logo)[^>]*>\s*(<svg\b[\s\S]*?<\/svg>)/i) || header.match(/(<svg\b[^>]*(?:logo)[^>]*>[\s\S]*?<\/svg>)/i) || [])[1];
  /* a closed store: the logo set in its Shopify brand settings comes first (stages/admin.js) */
  if (state.admin?.brand?.logo) cands.push({ url: state.admin.brand.logo, how: 'Shopify brand settings' });
  const orgLogo = state.org?.logo ? (typeof state.org.logo === 'string' ? state.org.logo : state.org.logo.url || state.org.logo.contentUrl) : null;
  if (orgLogo) cands.push({ url: abs(orgLogo, base), how: 'Organization logo (JSON-LD)' });
  const icons = tags(html, 'link').filter((t) => /icon/i.test(attr(t, 'rel') || '')).map((t) => ({ rel: attr(t, 'rel').toLowerCase(), url: abs(attr(t, 'href'), base), sizes: attr(t, 'sizes') }));
  const touch = icons.find((i) => i.rel.includes('apple-touch-icon')) || icons.find((i) => /192|180|512/.test(i.sizes || '')) || icons[0];
  const og = meta(html, 'og:image:secure_url') || meta(html, 'og:image');
  let logo = null, logoHow = null;
  for (const c of cands) { if (!c.url) continue; const a = await ctx.asset(c.url, 'logo', { max: 3e6 }); if (a) { logo = a; logoHow = `${c.how}: ${c.url}`; break; } }
  /* a sprite reference is inlined from the page; an svg with nothing to draw is skipped for the site icon or share image (QA 20 Oct) */
  const svgFile = svgLogo ? inlineSprite(svgLogo, html) : null;
  if (!logo && svgFile && drawableSvg(svgFile)) { logo = await ctx.saveAsset(ctx.slug, 'logo.svg', Buffer.from(svgFile), 'image/svg+xml'); logoHow = 'inline <svg> in the header'; }
  const mark = touch?.url ? await ctx.asset(touch.url, 'mark', { max: 2e6 }) : null;
  if (!logo && mark) { logo = mark; logoHow = `site icon: ${touch.url}`; }
  if (!logo && og) { const a = await ctx.asset(abs(og, base), 'og-image', { max: 6e6 }); if (a) { logo = a; logoHow = `og:image (a share image, not a clean logo): ${og}`; } }
  profile.identity = { ...(profile.identity || {}), logo, mark: mark || null };
  if (logo) ledger.add({ key: 'brand.logo', label: 'Logo file', v: logo, url: base, method: 'crawl', note: logoHow });

  /* CSS: inline <style> + up to 6 same-site stylesheets */
  const sheets = tags(html, 'link').filter((t) => /stylesheet/i.test(attr(t, 'rel') || '') || /\.css(\?|$)/.test(attr(t, 'href') || '')).map((t) => abs(attr(t, 'href'), base)).filter(Boolean);
  const mine = sheets.filter((u) => hostOf(u) === hostOf(base) || /cdn\.shopify\.com\/s\/files|\/cdn\/shop\/t\//.test(u)).filter((u) => !/judgeme|loox|yotpo|okendo|stamped|swiper|slick|font-?awesome|apps\.css|vendor/i.test(u));
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).filter((c) => !/jdgm|loox|yotpo|okendo|stamped|klaviyo|gorgias|swiper|slick-/i.test(c)).join('\n') + '\n' + tags(html, '[a-z]+').map((t) => attr(t, 'style') || '').filter(Boolean).join(';');
  const fetchedCss = [];
  await pool(mine.slice(0, 6), 4, async (u, i) => { ctx.tick('brand', pathOf(u).replace(profile.host, '').split('?')[0]); const r = await http.get(u, { key: 'css-' + i, ms: 15e3 }); if (r.ok && r.text) fetchedCss.push({ i, url: u, css: r.text.slice(0, 1.5e6) }); });
  fetchedCss.sort((a, b) => a.i - b.i);
  const allCss = inline + '\n' + fetchedCss.map((x) => x.css).join('\n');

  /* colours: count every use, drop greys / near-white / near-black, rank */
  const counts = new Map();
  const bump = (hex, w = 1) => { if (hex) counts.set(hex, (counts.get(hex) || 0) + w); };
  for (const m of allCss.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b(?![0-9a-f])/gi)) bump(normHex(m[1]));
  for (const m of allCss.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) bump(rgbHex(+m[1], +m[2], +m[3]));
  // Shopify themes keep colour schemes as bare triples: --color-button: 18, 18, 18
  for (const m of allCss.matchAll(/--color[\w-]*\s*:\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*[;}]/gi)) bump(rgbHex(+m[1], +m[2], +m[3]), 2);
  const themeColor = meta(html, 'theme-color'); const tc = themeColor && /^#?[0-9a-f]{3,6}$/i.test(themeColor) ? normHex(themeColor.replace('#', '')) : null;
  if (tc) bump(tc, 3);
  const ranked = [...counts.entries()].map(([hex, n]) => ({ hex, n, ...hsl(hex) })).sort((a, b) => b.n - a.n);
  const chroma = ranked.filter((c) => c.s > 0.18 && c.l > 0.08 && c.l < 0.94);
  // merge near-duplicates (the same brand blue in three tints counts once, at its most used shade)
  const picked = [];
  for (const c of chroma) { if (picked.some((p) => dist(p, c) < 40)) { const p = picked.find((q) => dist(q, c) < 40); p.n += c.n; continue; } picked.push({ ...c }); }
  picked.sort((a, b) => b.n - a.n);
  let colors = picked.slice(0, 3);
  /* the brand colours set in Shopify, for a closed store whose password page has too few of its own */
  const setColors = (state.admin?.brand?.colors || []).map((hex) => ({ hex, n: 0, ...hsl(hex) })).filter((c) => !colors.some((x) => x.hex === c.hex));
  if (colors.length < 3 && setColors.length) colors = [...colors, ...setColors].slice(0, 3);
  const neutralNote = colors.length < 3 ? ' (fewer than 3 non-grey colours in the CSS; the rest are its most used dark/neutral)' : '';
  if (colors.length < 3) { const dark = ranked.filter((c) => !colors.some((p) => p.hex === c.hex) && c.l < 0.25); const light = ranked.filter((c) => !colors.some((p) => p.hex === c.hex) && c.l >= 0.25 && c.l < 0.97 && c.s <= 0.18); colors = [...colors, ...dark.slice(0, 1), ...light].slice(0, 3); }
  profile.identity.colors = colors.map((c) => c.hex);
  colors.forEach((c, i) => ledger.add({ key: `brand.color.${i + 1}`, label: `Brand colour ${i + 1}`, v: c.hex, n: c.n, unit: 'uses in CSS', url: fetchedCss[0]?.url || base, method: 'crawl', layer: 'inferred', conf: c.n >= 10 ? 'medium' : 'low', note: `ranked by use across ${fetchedCss.length} stylesheet(s) and inline styles${c.hex === tc ? '; also the theme-color meta' : ''}${neutralNote}` }));

  /* fonts */
  const faces = [...allCss.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*["']?([^;"'}]+)["']?/gi)].map((m) => clean(m[1]));
  const varFont = (re) => { const m = allCss.match(re); return m ? firstFamily(m[1]) : null; };
  let heading = varFont(/--font-heading-family\s*:\s*([^;}]+)/i) || varFont(/--(?:font-)?heading[\w-]*font[\w-]*\s*:\s*([^;}]+)/i) || selFont(allCss, /(^|[\s,}])h1\b[^{]*\{/i);
  let body = varFont(/--font-body-family\s*:\s*([^;}]+)/i) || varFont(/--(?:font-)?body[\w-]*font[\w-]*\s*:\s*([^;}]+)/i) || selFont(allCss, /(^|[\s,}])body\b[^{]*\{/i) || selFont(allCss, /(^|[\s,}])html\b[^{]*\{/i);
  const gf = tags(html, 'link').map((t) => attr(t, 'href') || '').filter((h) => /fonts\.googleapis\.com/.test(h)).flatMap((h) => [...h.replace(/&amp;/g, '&').matchAll(/family=([^&]+)/g)].flatMap((m) => { let v = m[1]; try { v = decodeURIComponent(v); } catch { /* as it is */ } return v.split('|').map(fontName); }));
  const famList = [...new Set([...faces, ...gf].map(fontName).filter((f) => f && !GENERIC.test(f)))];
  if (!heading && famList[0]) heading = famList[0];
  if (!body && famList[0]) body = famList[famList.length > 1 ? 1 : 0];
  heading = heading && fontName(heading); body = body && fontName(body);
  if (heading && GENERIC.test(heading)) heading = null; if (body && GENERIC.test(body)) body = null;
  const mono = famList.find((f) => /mono|code/i.test(f)) || null;
  heading = fontName(heading); body = fontName(body);
  profile.identity.fonts = { heading: heading || null, body: body || null, mono: fontName(mono) };
  profile.identity.typeName = heading || body || null;
  if (heading) ledger.add({ key: 'brand.font.heading', label: 'Heading font', v: heading, url: fetchedCss[0]?.url || base, method: 'crawl' });
  if (body) ledger.add({ key: 'brand.font.body', label: 'Body font', v: body, url: fetchedCss[0]?.url || base, method: 'crawl' });

  /* tagline: the hero headline when it is not just the name, else the meta description's first sentence */
  const heads = [...html.matchAll(/<h(1)\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(stripTags(m[2]))).filter((t) => t && t.length >= 8 && t.length <= 90 && t.toLowerCase() !== String(profile.name).toLowerCase() && !/cart|search|menu|newsletter|subscribe|log ?in|sign ?up|account|cookie|your bag|terms|conditions|privacy|promotion|opening soon|coming soon|launching soon|password|enter (the )?store|be the first to know/i.test(t));
  const md = meta(html, 'description') || meta(html, 'og:description');
  const mdLine = md ? (md.match(/^[^.!?]{12,140}[.!?]/) || [md.slice(0, 140)])[0] : null;
  const tagline = heads[0] || (mdLine && mdLine.trim().toLowerCase() !== String(profile.name).toLowerCase() ? mdLine : null);
  profile.tagline = tagline || null;
  if (tagline) ledger.add({ key: 'brand.tagline', label: 'Tagline (hero headline or meta description)', v: tagline, url: base, method: 'crawl', note: heads[0] ? 'the home page h1' : 'meta description, first sentence' });
  if (!profile.descriptor && md && md.length <= 60) profile.descriptor = md;
  ctx.picks?.('who', whoOf(profile)); /* the onboarding's "who you are" tap, as soon as the name and line are known (again when the category lands: index.js) */

  const face = [heading || body, 'system-ui', 'sans-serif'].filter(Boolean).map((f) => (/\s/.test(f) && !/,/.test(f) ? `"${f}"` : f)).join(', ');
  ctx.finding('brand', { kind: 'kit', t: 'Brand kit', src: fetchedCss[0] ? pathOf(fetchedCss[0].url).split('?')[0] : pathOf(base), logo, colors: profile.identity.colors, face, typeName: profile.identity.typeName || 'Font not found', ...(colors.length ? {} : { cap: 'No brand colours found in the CSS.' }) }, 'Pulled the brand kit');
  ctx.done('brand', [logo ? '1 logo' : state.closed ? 'no logo on the password page' : 'no logo found', colors.length ? `${colors.length} colours` : 'no colours found', profile.identity.typeName ? profile.identity.typeName : 'font not found'].join(', '));
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normHex = (h) => { h = h.toLowerCase(); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return '#' + h; };
const rgbHex = (r, g, b) => (r > 255 || g > 255 || b > 255 ? null : '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''));
function hsl(hex) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)); return { s, l, r: r * 255, g: g * 255, b: b * 255 }; }
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
/* a font's family name only: a Google Fonts link's family= value can carry its weights ("Cormorant:100,100italic,…", the colon
   often URL-encoded as %3A), the css2 axes ("Inter:wght@400"), or several families ("A|B"); saved reads heal through it too */
export const fontName = (s) => { let f = String(s ?? ''); try { f = decodeURIComponent(f); } catch { /* kept as it is */ }
  f = f.replace(/\+/g, ' ').split(/[|&]/)[0].split(/[:@;]/)[0].replace(/["']/g, '').replace(/\s+/g, ' ').trim(); return f && f.length <= 60 ? f : f ? f.slice(0, 60).trim() : null; };
const firstFamily = (s) => { const f = String(s).split(',').map((x) => x.replace(/["']/g, '').replace(/!important/, '').trim()).find((x) => x && !GENERIC.test(x) && !/^var\(/.test(x)); return f || null; };
function selFont(css, selRe) {
  const re = new RegExp(selRe.source + '([^}]*)\\}', 'gi');
  for (const m of css.matchAll(re)) { const ff = (m[m.length - 1].match(/font-family\s*:\s*([^;}]+)/i) || [])[1]; if (ff) { const f = firstFamily(ff); if (f) return f; } }
  return null;
}

