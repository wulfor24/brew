// Stage 1 · open: the store's front door. Home page (plain fetch, treg browser fallback), robots.txt, sitemaps
// (pages per sitemap), key pages (about, FAQ, contact, shipping, returns), platform, and country/currency/locale.
import { sha, meta, titleOf, links, jsonLd, typeIs, stripTags, clean, pathOf, hostOf, registrable, pool, attr, tags } from '../util.js';
import { sellingMarket, applyMarket, nameOf } from '../../market.js';

const KEY_PAGES = {
  about: /\/(pages\/)?(about|about-us|our-story|story|who-we-are|brand-story|our-brand|about-[a-z-]+)(\/|$|\?)/i,
  faq: /\/(pages\/)?(faq|faqs|help|frequently-asked-questions)(\/|$|\?)/i,
  contact: /\/(pages\/)?(contact|contact-us|support)(\/|$|\?)/i,
  shipping: /\/(policies\/shipping-policy|pages\/(shipping|delivery)[a-z-]*|shipping[a-z-]*)(\/|$|\?)/i,
  returns: /\/(policies\/refund-policy|pages\/(returns?|refunds?|exchange)[a-z-]*|returns?[a-z-]*)(\/|$|\?)/i
};
const PHONE = [[/\+91[\s-]?\d{5}[\s-]?\d{5}|\b1800[\s-]?\d{3}[\s-]?\d{4}\b/, 'IN'], [/\+44[\s\d]{9,13}/, 'GB'], [/\+1[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/, 'US'], [/\+61[\s\d]{8,12}/, 'AU'], [/\+971[\s\d]{8,11}/, 'AE']];

export const looksBlocked = (r) => !r.ok || !r.text || r.text.length < 2000 || /cf-browser-verification|captcha|access denied|enable javascript to|Attention Required/i.test(r.text.slice(0, 20000)) && stripTags(r.text).length < 1500;

export async function open(ctx) {
  const { http, ledger, profile, url } = ctx;
  ctx.tick('open', '/');
  let home = await http.get(url.href, { key: 'home' });
  let homeVia = 'fetch';
  if (looksBlocked(home)) {
    const r = await ctx.render(url.href, 'home-rendered');
    if (r) { home = { ok: true, status: 200, url: r.url || url.href, text: r.html }; homeVia = 'treg:litescrape.web.fetch.post'; }
  }
  if (!home.ok || !home.text) throw new Error(`home page did not load (${home.status || home.error})`);
  let final = new URL(home.url || url.href);
  const origin = final.origin;
  Object.assign(ctx.state, { home: home.text, origin, homeUrl: final.href, homeVia });
  profile.url = final.href; profile.host = final.hostname.replace(/^www\./, '');
  let html = home.text;

  // platform
  const shopifyShop = (html.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/) || [])[1] || null;
  let platform = 'unknown';
  if (shopifyShop || /cdn\.shopify\.com|\/cdn\/shop\//.test(html)) platform = 'shopify';
  else if (/wp-content\/plugins\/woocommerce|woocommerce-/i.test(html)) platform = 'woocommerce';
  else if (/cdn\d*\.bigcommerce\.com|data-bc-/i.test(html)) platform = 'bigcommerce';
  else if (/Magento_|mage\/cookies|\/static\/version\d+\//.test(html)) platform = 'magento';
  else if (/demandware|\/on\/demandware\.store|dw\/shop/i.test(html)) platform = 'salesforce-commerce';
  else if (/static\.wixstatic\.com|wix\.com/.test(html)) platform = 'wix';
  else if (/squarespace\.com|static1\.squarespace/.test(html)) platform = 'squarespace';
  if (platform === 'unknown' || platform === 'shopify') {
    const pj = await http.get(`${origin}/products.json?limit=1`, { as: 'json', key: 'products-probe' });
    if (pj.ok && Array.isArray(pj.json?.products)) platform = 'shopify';
  }
  if (platform === 'unknown') platform = 'custom';
  profile.platform = platform; ctx.state.shopifyShop = shopifyShop;

  // Shopify's public /meta.json: the shop's own country, currency (products.json prices are in it) and city
  if (platform === 'shopify') {
    const mj = await http.get(`${origin}/meta.json`, { as: 'json', key: 'shop-meta' });
    const m = mj.ok ? mj.json : null;
    if (m && m.currency) {
      ctx.state.shopMeta = m; ctx.state.shopifyShop ||= m.myshopify_domain || null;
      ledger.add({ key: 'shop.currency', label: 'Shop currency (Shopify /meta.json)', v: m.currency, url: `${origin}/meta.json`, method: 'crawl' });
      if (m.country) ledger.add({ key: 'shop.country', label: 'Country the store is registered in (Shopify /meta.json; not where it sells)', v: m.country, url: `${origin}/meta.json`, method: 'crawl' });
      if (m.city) ledger.add({ key: 'shop.address', label: 'Store address city (Shopify /meta.json)', v: [m.city, m.province].filter(Boolean).join(', '), url: `${origin}/meta.json`, method: 'crawl' });
      if (Array.isArray(m.ships_to_countries)) ledger.add({ key: 'shop.ships_to', label: 'Countries the store ships to', v: String(m.ships_to_countries.length), n: m.ships_to_countries.length, unit: 'countries', url: `${origin}/meta.json`, method: 'crawl' });
      // the store sent this visit to another market (/en-in): read the home market instead
      const lp = (final.pathname.split('/')[1] || '').match(/^[a-z]{2}-([a-z]{2})$/i);
      if (lp && m.country && lp[1].toUpperCase() !== m.country) {
        const r = await http.get(`${origin}/?country=${m.country}`, { key: 'home-market' });
        if (r.ok && r.text && !looksBlocked(r) && !new URL(r.url).pathname.match(/^\/[a-z]{2}-[a-z]{2}(\/|$)/i)) {
          ctx.state.redirectedTo = final.pathname; html = r.text; final = new URL(r.url.replace(/\?country=[A-Z]{2}$/, '')); Object.assign(ctx.state, { home: html, homeUrl: final.href, walkUrl: `${origin}/?country=${m.country}`, mq: `country=${m.country}` });
          ledger.add({ key: 'site.geo_redirect', label: 'The store redirects visitors by location', v: `${ctx.state.redirectedTo} for this visit; read the ${m.country} home market instead`, url: origin, method: 'crawl' });
        }
      }
    }
  }
  ledger.add({ key: 'site.platform', label: 'Store platform', v: platform, layer: platform === 'custom' ? 'inferred' : 'observed', url: final.href, method: 'crawl', conf: platform === 'custom' ? 'low' : 'high', note: shopifyShop ? `Shopify.shop = ${shopifyShop}` : undefined });

  // name, descriptor
  const ld = jsonLd(html); ctx.state.homeLd = ld;
  const org = ld.find((x) => typeIs(x, 'Organization') || typeIs(x, 'OnlineStore') || typeIs(x, 'Corporation') || typeIs(x, 'Brand'));
  const title = titleOf(html) || '';
  const site = meta(html, 'og:site_name') || clean(org?.name) || null;
  const segs = title.split(/\s+[|–—-]\s+|\s*\|\s*/).map(clean).filter(Boolean);
  const name = site || (segs.length > 1 ? segs.sort((a, b) => a.length - b.length)[0] : segs[0]) || registrable(profile.host).split('.')[0];
  profile.name = name.replace(/\s*(official\s+(store|site|website)|online\s+store)$/i, '').trim() || name;
  const desc = segs.find((s) => s.toLowerCase() !== profile.name.toLowerCase() && !s.toLowerCase().includes(profile.name.toLowerCase() + ' ')) || null;
  profile.descriptor = desc && desc.length <= 60 ? desc : null;
  ledger.add({ key: 'brand.name', label: 'Brand name', v: profile.name, url: final.href, method: 'crawl', note: site ? 'og:site_name / Organization' : 'page title' });
  if (profile.descriptor) ledger.add({ key: 'brand.descriptor', label: 'Descriptor in the page title', v: profile.descriptor, url: final.href, method: 'crawl' });
  ctx.state.org = org || null;

  // robots + sitemaps
  ctx.tick('open', '/robots.txt');
  const robots = await http.get(`${origin}/robots.txt`, { key: 'robots' });
  const smUrls = robots.ok ? [...new Set((robots.text.match(/^\s*sitemap:\s*(\S+)/gim) || []).map((l) => l.replace(/^\s*sitemap:\s*/i, '').trim()))] : [];
  if (!smUrls.length) smUrls.push(`${origin}/sitemap.xml`);
  ctx.tick('open', pathOf(smUrls[0]).replace(profile.host, '') || '/sitemap.xml');
  const sitemaps = []; const pageUrls = []; let allSm = 0;
  // a locale path the store redirected to (/en-in, /en-us, /de-de, /en): read that market only
  const loc = (final.pathname.split('/')[1] || '').match(/^[a-z]{2}(-[a-z]{2})?$/i)?.[0]?.toLowerCase() || null;
  ctx.state.localePath = loc;
  const readSm = async (u, depth = 0) => {
    const r = await http.get(u, { key: 'sitemap-' + u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 80), ms: 25e3 });
    if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.text || '')) return;
    if (/<sitemapindex/i.test(r.text) && depth < 2) {
      // the brand's own host only (group sitemaps list sister brands), and the visited locale's files first
      let kids = [...r.text.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => clean(m[1])).filter((k) => registrable(hostOf(k)) === registrable(hostOf(origin)));
      allSm += kids.length;
      if (loc) { const tag = loc.replace('-', '[_-]'); const mine = kids.filter((k) => new RegExp(`[_/-]${tag}([_./-]|$)`, 'i').test(k)); const neutral = kids.filter((k) => !/[_-][a-z]{2}[_-][a-z]{2}(\.|_|$)/i.test(k.split('/').pop())); kids = [...new Set([...mine, ...neutral])]; }
      await pool(kids.slice(0, 25), 6, (k) => readSm(k, depth + 1)); return;
    }
    const locs = [...r.text.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => clean(m[1]));
    sitemaps.push({ url: u, pages: locs.length }); pageUrls.push(...locs);
  };
  await pool(smUrls.slice(0, 4), 4, (u) => readSm(u));
  let uniq = [...new Set(pageUrls)];
  const allUrls = uniq.length;
  if (loc) { const inLoc = uniq.filter((u) => { try { return new URL(u).pathname.toLowerCase().startsWith('/' + loc + '/') || new URL(u).pathname.toLowerCase() === '/' + loc; } catch { return false; } }); if (inLoc.length) uniq = inLoc; }
  const pages = uniq.length;
  profile.site = { ...(profile.site || {}), pages: pages || null, sitemaps: sitemaps.map((s) => ({ url: s.url, pages: s.pages })) };
  ctx.state.pageUrls = uniq;
  if (sitemaps.length) {
    ledger.add({ key: 'site.pages', label: 'Pages listed in the sitemaps', v: String(pages), n: pages, unit: 'pages', url: smUrls[0], method: 'crawl', note: loc ? `market /${loc} only (the site sent this visit there); ${allUrls} URLs in the sitemaps read` : undefined });
    ledger.add({ key: 'site.sitemaps', label: 'Sitemap files', v: String(sitemaps.length), n: sitemaps.length, url: smUrls[0], method: 'crawl' });
  }

  // key pages: links on the home page first, then sitemap URLs, then the Shopify defaults
  const homeLinks = links(html, final.href).filter((l) => hostOf(l.url) === hostOf(origin) && (!loc || new URL(l.url).pathname.toLowerCase().startsWith('/' + loc)));
  ctx.state.homeLinks = links(html, final.href);
  const keyPages = {};
  for (const [k, re] of Object.entries(KEY_PAGES)) {
    const hit = homeLinks.find((l) => re.test(new URL(l.url).pathname)) || ctx.state.pageUrls.map((u) => ({ url: u })).find((l) => { try { return re.test(new URL(l.url).pathname); } catch { return false; } });
    if (hit) keyPages[k] = hit.url.split('#')[0];
  }
  if (platform === 'shopify') { keyPages.shipping ||= `${origin}/policies/shipping-policy`; keyPages.returns ||= `${origin}/policies/refund-policy`; }
  const fetched = {};
  await pool(Object.entries(keyPages), 5, async ([k, u]) => {
    ctx.tick('open', pathOf(u).replace(profile.host, '') || '/');
    const mu = ctx.state.mq ? u + (u.includes('?') ? '&' : '?') + ctx.state.mq : u;
    let r = await http.get(mu, { key: 'page-' + k });
    if (r.ok && looksBlocked(r)) { const rr = await ctx.render(u, 'page-' + k + '-rendered'); if (rr) r = { ok: true, url: u, text: rr.html }; }
    if (r.ok && r.text) fetched[k] = { url: (r.url || u).replace(/[?&]country=[A-Z]{2}$/, ''), html: r.text, text: mainText(r.text) };
  });
  ctx.state.pages = fetched;
  profile.site.keyPages = Object.values(fetched).map((p) => p.url);
  profile.site.policies = { shipping: fetched.shipping ? fetched.shipping.url : null, returns: fetched.returns ? fetched.returns.url : null };
  { const fs = freeShip(stripTags(html)); if (fs) ledger.add({ key: 'offer.free_shipping_banner', label: 'Free shipping line on the home page', v: fs, url: final.href, method: 'crawl' }); }
  if (fetched.shipping) { const fs = freeShip(fetched.shipping.text); if (fs) ledger.add({ key: 'policy.free_shipping', label: 'Free shipping rule (shipping policy)', v: fs, url: fetched.shipping.url, method: 'crawl' }); }
  if (fetched.returns) { const rd = (fetched.returns.text.match(/\b(\d{1,3})[\s-]*(?:days?|day)\b[^.]{0,60}(return|refund|exchange)|(return|refund|exchange)[^.]{0,60}\b(\d{1,3})[\s-]*days?/i) || []); const d = rd[1] || rd[4]; if (d) ledger.add({ key: 'policy.return_days', label: 'Return / refund window', v: `${d} days`, n: +d, unit: 'days', url: fetched.returns.url, method: 'crawl', note: clean(rd[0]).slice(0, 160) }); }

  // currency, then the SELLING market (market.js): where customers are, kept apart from where the store is registered
  const sig = [];
  const sm = ctx.state.shopMeta;
  if (sm?.currency) sig.push(['currency', sm.currency, 'Shopify /meta.json'], ['currency', sm.currency, 'products.json prices are in the shop currency']);
  const shCur = (html.match(/Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/) || [])[1];
  const shCountry = (html.match(/Shopify\.country\s*=\s*"([A-Z]{2})"/) || [])[1];
  const shLocale = (html.match(/Shopify\.locale\s*=\s*"([a-zA-Z-]+)"/) || [])[1];
  if (shCur) sig.push(['currency', shCur, 'Shopify.currency']);
  const ldCur = (html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/) || [])[1] || meta(html, 'og:price:currency') || meta(html, 'product:price:currency');
  if (ldCur) sig.push(['currency', ldCur, 'JSON-LD priceCurrency / og:price:currency']);
  const lang = attr((html.match(/<html\b[^>]*>/i) || [''])[0], 'lang');
  const hreflang = tags(html, 'link').filter((t) => /hreflang/i.test(t)).map((t) => attr(t, 'hreflang')).filter(Boolean);
  const pageText = stripTags(html) + ' ' + Object.values(fetched).map((p) => p.text).join(' ');
  let phone = null; for (const [re, c] of PHONE) if (re.test(pageText)) { phone = c; break; }
  if (/₹|\bRs\.?\s?\d/.test(pageText)) sig.push(['currency', 'INR', 'rupee prices in the page text']);
  const vote = (k) => { const m = {}; sig.filter((s) => s[0] === k).forEach((s) => (m[s[1]] = (m[s[1]] || 0) + 1)); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const curV = vote('currency'); profile.currency = sm?.currency || curV[0]?.[0] || null; /* the shop's own currency is what products.json prices are in; the served one follows the visitor */
  const addr = org?.address?.addressCountry || org?.address?.[0]?.addressCountry;
  const msig = { registered: sm?.country || null, currency: profile.currency, shipsTo: Array.isArray(sm?.ships_to_countries) ? sm.ships_to_countries.slice(0, 300) : null, hreflang: [...new Set(hreflang.map((x) => String(x).toLowerCase()))].filter((x) => x !== 'x-default').slice(0, 40),
    localePath: loc && loc.includes('-') ? loc : null, tld: profile.host.split('.').pop(), lang: lang ? String(lang).toLowerCase().slice(0, 12) : null, phone, orgCountry: addr ? String(addr.name || addr).slice(0, 2).toUpperCase() : null, served: shCountry || null };
  const mk = sellingMarket(msig);
  applyMarket(profile, mk);
  if (!mk.primary) { profile.country = null; profile.markets = []; profile.market = { ...mk, at: new Date().toISOString() }; }
  profile.locale = shLocale ? `${shLocale}${profile.country ? '-' + profile.country : ''}` : profile.locale || lang || null;
  const confOf = (v, k) => (!v.length ? 'low' : v.length === 1 && sig.filter((s) => s[0] === k).length >= 2 ? 'high' : v.length === 1 ? 'medium' : 'low');
  if (profile.currency) ledger.add({ key: 'market.currency', label: 'Store currency', v: profile.currency, layer: 'inferred', url: final.href, method: 'crawl', conf: sm?.currency ? 'high' : confOf(curV, 'currency'), note: sig.filter((s) => s[0] === 'currency').map((s) => `${s[1]} from ${s[2]}`).join('; ') });
  if (profile.country) ledger.add({ key: 'market.country', label: 'Main selling market (where customers are)', v: profile.country, layer: 'inferred', url: final.href, method: 'crawl', conf: mk.conf,
    note: mk.why + (profile.markets.length > 1 ? `; other markets: ${profile.markets.slice(1).join(', ')}` : '') + (hreflang.length ? `; hreflang: ${hreflang.slice(0, 6).join(', ')}` : '') + (msig.localePath ? `; locale path /${msig.localePath} the site sent this visit to` : '') + (phone ? `; ${phone} from phone number format` : '') + (msig.orgCountry ? `; ${msig.orgCountry} from Organization address in JSON-LD` : '') + (shCountry ? `; Shopify.country ${shCountry} (served to this visit)` : '') + (final.href !== url.href && final.pathname.length > 1 ? `; the site redirected this visit to ${final.pathname}` : '') });
  if (mk.registered && mk.registered !== profile.country) ledger.add({ key: 'market.registered', label: 'Registered in (not the selling market)', v: mk.registered, layer: 'inferred', url: final.href, method: 'crawl', conf: 'high', note: `The store's address is in ${nameOf(mk.registered)}; ${mk.why}` });

  // the legal entity, from the footer: copyright holder, and India's company id (CIN) when shown
  const foot = stripTags((html.match(/<footer\b[\s\S]*?<\/footer>/i) || [html.slice(-40000)])[0]);
  const legal = (foot.match(/©\s*(?:\d{4}[\s,-]*)?(?:\d{4}\s*)?([A-Z][\w&.,' -]{2,80}?(?:Private Limited|Pvt\.? Ltd\.?|Limited|Ltd\.?|LLP|Inc\.?|LLC|Corp\.?|GmbH|S\.A\.|Pty Ltd))/) || [])[1];
  if (legal) ledger.add({ key: 'company.legal_name', label: 'Legal entity in the site footer', v: clean(legal), url: final.href, method: 'crawl' });
  const cin = (foot.match(/\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/) || [])[1];
  if (cin) { ledger.add({ key: 'company.cin', label: 'Company id (CIN) in the site footer', v: cin, url: final.href, method: 'crawl' });
    ledger.add({ key: 'company.incorporated', label: 'Year of incorporation (read from the CIN)', v: cin.slice(8, 12), n: +cin.slice(8, 12), unit: 'year', layer: 'inferred', conf: 'high', url: final.href, method: 'crawl', note: `CIN ${cin}: registered in ${cin.slice(6, 8)} in ${cin.slice(8, 12)}` }); }

  // About the brand: a faithful summary of the about page, or its opening sentences
  const about = fetched.about;
  let finding = null;
  if (about && about.text.length > 120) {
    profile.aboutUrl = about.url;
    let p = null;
    if (ctx.aiOn) {
      try {
        const r = await ctx.ai({ tag: 'reader-about', model: 'sonnet', max: 600,
          system: 'You summarise a brand\'s About page. Use only facts written on the page. Never add facts, numbers, names or claims that are not on the page. Keep the page\'s own words where you can. Plain, simple English. No marketing adjectives the page does not use. No em dashes.',
          prompt: `About page (${pathOf(about.url)}):\n"""\n${about.text.slice(0, 7000)}\n"""\nWrite 1 to 3 short sentences (max 60 words) that say who the brand is, what it makes and anything distinctive the page states (founding, founders, where, how). Output only the sentences.` });
        p = clean(r.text);
      } catch (e) { ctx.log.warn?.('[reader] about summary', e.message); }
    }
    if (!p) p = firstSentences(about.text, 3, 320, profile.name);
    profile.about = p;
    if (p) finding = { kind: 'text', t: 'About the brand', src: pathOf(about.url), p };
  } else {
    // no about page: the home page's own meta description, quoted
    const d = meta(html, 'description') || meta(html, 'og:description');
    if (d) { profile.about = d; finding = { kind: 'text', t: 'About the brand', src: pathOf(final.href) + ' · meta description', p: d, cap: 'No about page found.' }; }
  }
  if (finding) ctx.finding('open', finding, 'Read the about page');
  ctx.done('open', [pages ? `${pages.toLocaleString('en-US')} pages` : null, sitemaps.length ? `${sitemaps.length} sitemap${sitemaps.length > 1 ? 's' : ''}` : 'no sitemap found', `${Object.keys(fetched).length} key pages`].filter(Boolean).join(', '));
}

export function mainText(html) {
  let h = String(html || '');
  const m = h.match(/<main\b[\s\S]*?<\/main>/i); if (m) h = m[0];
  else h = h.replace(/<header\b[\s\S]*?<\/header>/gi, ' ').replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ').replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ');
  return stripTags(h).split('\n').map((l) => l.trim()).filter((l) => l.length > 2).join('\n');
}
// free fallback: the page's own sentences, preferring the ones that say who/what/when, kept in page order
export function firstSentences(text, n = 3, max = 320, name = '') {
  const lines = String(text).split('\n').filter((l) => l.split(' ').length >= 6);
  const s = (lines.join(' ').match(/[^.!?]+[.!?]+/g) || []).map((x) => x.trim()).filter((x) => x.split(' ').length >= 5);
  const re = new RegExp(`\\b(founded|started|began|launched|since|born|(19|20)\\d\\d|we make|we are|we're|our mission|lab|made in|based in)\\b${name ? `|\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b` : ''}`, 'i');
  const good = s.map((x, i) => [x, i]).filter(([x]) => re.test(x));
  const pick = (good.length ? good : s.map((x, i) => [x, i])).slice(0, n).sort((a, b) => a[1] - b[1]);
  let out = ''; for (const [x] of pick) { if ((out + ' ' + x).length > max) break; out += (out ? ' ' : '') + x; }
  return clean(out) || null;
}
function freeShip(text) {
  const m = String(text).match(/free (?:standard )?(?:shipping|delivery)[^.\n]{0,40}?(?:on|above|over|for) (?:all )?(?:orders?|purchases?)?\s*(?:of|above|over)?\s*((?:₹|Rs\.?|INR|\$|£|€|A\$|C\$)\s?[\d,]+(?:\.\d+)?|[\d,]+\s?(?:INR|USD|GBP|EUR))/i);
  return m ? clean(m[0]).slice(0, 120) : null;
}
