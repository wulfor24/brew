// Stage 6 · site: tech in the page source, then a headless walk home → product → add to cart → cart →
// checkout entry page with puppeteer-core. Times each step, counts clicks, records the payment options and
// popups seen, and whether guest checkout is offered. It STOPS at the checkout entry page: it never types
// personal data, never submits a form and never pays.
import fs from 'node:fs';
import { pathOf, clean } from '../util.js';
import { pageSpeed, keepSpeed } from '../../health.js';
/* PageSpeed is a live Google call: it needs PAGESPEED_API_KEY (without one Google answers 429), and is off under node --test */
export const speedOn = () => !!process.env.PAGESPEED_API_KEY && process.env.PAGESPEED_OFF !== '1' && !process.env.NODE_TEST_CONTEXT;

const TECH = {
  klaviyo: /static\.klaviyo\.com|klaviyo\.js|_learnq/i,
  metaPixel: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i,
  ga4: /googletagmanager\.com\/gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/i,
  gtm: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,}/,
  tiktokPixel: /analytics\.tiktok\.com|ttq\.load/i,
  googleAds: /gtag\(\s*['"]config['"]\s*,\s*['"]AW-/i,
  hotjar: /static\.hotjar\.com/i, clarity: /clarity\.ms\/tag/i, snapchat: /sc-static\.net\/scevent/i, pinterest: /s\.pinimg\.com\/ct\/core\.js|pintrk\(/i
};
const SUBS = [['recharge', /rechargepayments|rechargecdn|recharge-/i], ['skio', /skio/i], ['loop', /loopsubscriptions|loop-subscriptions/i], ['appstle', /appstle/i], ['seal', /sealsubscriptions/i], ['bold', /boldapps\.net\/subscriptions|bold-subscriptions/i], ['stay.ai', /stay\.ai|retextion/i], ['ordergroove', /ordergroove/i]];
const CHAT = [['gorgias', /gorgias/i], ['intercom', /widget\.intercom\.io|intercomSettings/i], ['zendesk', /zdassets\.com|zopim/i], ['tidio', /tidio/i], ['freshchat', /freshchat|wchat\.freshchat/i], ['richpanel', /richpanel/i], ['crisp', /client\.crisp\.chat/i], ['whatsapp', /wa\.me\/|api\.whatsapp\.com\/send|whatsapp-widget|interakt|wati\.io|gallabox/i], ['kustomer', /kustomer/i], ['re:amaze', /reamaze/i], ['livechat', /livechatinc/i], ['tawk', /tawk\.to/i], ['haptik', /haptik/i]];
const CHECKOUT_APPS = [['gokwik', /gokwik/i], ['shopflo', /shopflo/i], ['fastrr (shiprocket)', /fastrr|shiprocket.*checkout/i], ['razorpay magic', /magic-checkout|razorpay.*magic/i], ['simpl', /getsimpl|simpl-checkout/i], ['bold checkout', /boldcommerce.*checkout/i], ['shop pay', /shop-pay|shopify-payment-button/i]];
/* tags seen firing in the walk's own network requests: a pixel loaded through GTM is not in the page source */
const NET = { metaPixel: /facebook\.com\/tr[/?]|connect\.facebook\.net\/[^?]*fbevents\.js/i, ga4: /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect|googletagmanager\.com\/gtag\/js\?id=G-/i,
  googleAds: /googleadservices\.com\/pagead\/conversion|googleads\.g\.doubleclick\.net|googletagmanager\.com\/gtag\/js\?id=AW-/i, tiktokPixel: /analytics\.tiktok\.com/i, pinterest: /ct\.pinterest\.com|s\.pinimg\.com\/ct\//i,
  snapchat: /tr\.snapchat\.com|sc-static\.net\/scevent/i, clarity: /clarity\.ms\//i, hotjar: /hotjar\.(com|io)/i, klaviyo: /klaviyo\.com/i, gtm: /googletagmanager\.com\/gtm\.js/i };
/** a size, colour or variant picker on a product page: the first option that can be bought. Returns its label or null. */
export async function pickVariant(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const off = (e) => e.disabled || e.getAttribute('aria-disabled') === 'true' || /disabled|unavailable|sold-?out|out-?of-?stock|crossed|strike/i.test(e.className + ' ' + (e.getAttribute('data-state') || '') + ' ' + (e.getAttribute('aria-label') || ''));
    const picked = [];
    // a <select> for size/colour/variant with no choice made
    for (const sel of document.querySelectorAll('select')) {
      const k = (sel.name + ' ' + sel.id + ' ' + (sel.getAttribute('aria-label') || '') + ' ' + (sel.labels?.[0]?.innerText || '')).toLowerCase();
      if (!/size|colou?r|variant|option|shade|pack|qty|quantity/.test(k) || /qty|quantity/.test(k) || !vis(sel)) continue;
      const opt = [...sel.options].find((o) => o.value && !o.disabled && !/select|choose|pick/i.test(o.textContent)); if (!opt || sel.value === opt.value) continue;
      sel.value = opt.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); picked.push(opt.textContent.trim());
    }
    // swatches and size buttons: radio groups, or a group whose label says size
    const groups = [...document.querySelectorAll('[role=radiogroup], fieldset, [class*="size" i][class*="list" i], [class*="size" i][class*="select" i], [data-test-id*="size" i], [data-testid*="size" i], [class*="swatch" i], [class*="variant" i]')].filter(vis);
    for (const g of groups.slice(0, 6)) {
      const opts = [...g.querySelectorAll('input[type=radio], [role=radio], button, label, li')].filter((e) => vis(e) || e.type === 'radio');
      if (opts.length < 2 || opts.length > 40) continue;
      if (opts.some((e) => e.checked || e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-pressed') === 'true' || /\b(selected|active|is-checked)\b/.test(e.className))) continue;
      const o = opts.find((e) => !off(e) && !(e.type === 'radio' && e.disabled)); if (!o) continue;
      const target = o.type === 'radio' ? (o.labels?.[0] || o) : o; target.click(); picked.push(((target.innerText || o.value || '').trim().split(/\n+/).pop() || '').trim().slice(0, 20));
    }
    return picked.length ? picked.join(', ') : null;
  }).catch(() => null);
}
/** the number on the header's cart icon (any platform): null when there is no badge to read */
const badgeCount = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('[class*="cart" i] [class*="count" i], [class*="cart" i] [class*="badge" i], [class*="bag" i] [class*="count" i], [class*="bag" i] [class*="badge" i], [data-test-id*="cart" i] [class*="count" i], [aria-label*="cart" i], [aria-label*="bag" i], [class*="cart-count" i], [class*="cartCount" i], [data-cart-count]')];
  for (const e of els) { const t = (e.getAttribute('data-cart-count') || e.innerText || e.getAttribute('aria-label') || '').match(/\b(\d{1,3})\b/); if (t) return +t[1]; }
  return null; }).catch(() => null);
const PAY = [['UPI', /\bUPI\b|google ?pay|phonepe|paytm|bhim/i], ['Cash on delivery', /cash on delivery|\bCOD\b|pay on delivery/i], ['Cards', /credit card|debit card|\bvisa\b|mastercard|amex|american express|rupay|card number/i], ['Net banking', /net ?banking/i], ['Wallets', /\bwallets?\b|mobikwik|amazon pay|freecharge/i], ['PayPal', /paypal/i], ['Apple Pay', /apple ?pay/i], ['Google Pay', /google ?pay|gpay/i], ['Shop Pay', /shop ?pay/i], ['Klarna', /klarna/i], ['Afterpay', /afterpay|clearpay/i], ['Affirm', /\baffirm\b/i], ['Sezzle', /sezzle/i], ['Simpl / pay later', /\bsimpl\b|lazypay|pay later|pay in 3|snapmint/i], ['EMI', /\bEMI\b/]];

export function detectTech(html) {
  const out = {}; for (const [k, re] of Object.entries(TECH)) out[k] = re.test(html);
  out.shopify = /cdn\.shopify\.com|Shopify\.shop/.test(html);
  out.subscriptionApp = SUBS.find(([, re]) => re.test(html))?.[0] || null;
  out.chat = CHAT.find(([, re]) => re.test(html))?.[0] || null;
  out.checkoutApp = CHECKOUT_APPS.filter(([k]) => k !== 'shop pay').find(([, re]) => re.test(html))?.[0] || null;
  return out;
}

const CHROME = () => process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
/** bump when the walk starts reading differently: heal() re-walks every saved read with an older version */
export const SITE_V = 4; /* 4: picks a size first, counts any cart, sees tags fire (GTM-loaded pixels) */
// one-click checkout apps open on their own host, usually in an iframe over the cart (GoKwik, Razorpay Magic, Shopflo…)
const APP_HOST = /gokwik|shopflo|razorpay|fastrr|shiprocket|getsimpl|simpl\.in|snapmint/i;
const APP_SEL = ['[id*="gokwik" i] button', 'button[class*="gokwik" i]', '[class*="gokwik" i] button', '[class*="shopflo" i] button', 'button[class*="shopflo" i]', '[class*="magic-checkout" i]', 'button[class*="razorpay" i]', '[class*="fastrr" i] button', 'button[class*="fastrr" i]'];
const CHECKOUT_SEL = ['button[name="checkout"]', 'input[name="checkout"]', 'a[href*="/checkout"]', '[data-testid*="checkout" i]', '#checkout', ...APP_SEL];
const CHECKOUT_RE = /^\s*(secure )?check ?out|^proceed to (checkout|buy|pay)|^place order|^buy now|^pay now|^continue to (checkout|pay)/i;
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** a URL without its query: checkout apps put session tokens there */
const bare = (u) => { try { const x = new URL(u); return x.origin === 'null' ? x.href : x.origin + x.pathname; } catch { return String(u || '').split('?')[0]; } };
export const isCheckoutUrl = (u) => { try { const x = new URL(u); return /\/checkouts?(\/|$)/.test(x.pathname) || APP_HOST.test(x.hostname); } catch { return false; } };

export async function site(ctx) {
  const { profile, ledger, state } = ctx;
  ctx.tick('site', 'page source');
  // a heal has no page source: keep the tech read from the first walk
  const tech = state.home ? detectTech(state.home + ' ' + (state.heroPages || []).map((x) => x.html).join(' ')) : { ...(profile.site?.tech || detectTech('')) };
  tech.reviewApp = profile.reviews?.app || tech.reviewApp || null;
  profile.site = { ...(profile.site || {}), tech };
  if (state.home) for (const [k, v] of Object.entries(tech)) if (v) ledger.add({ key: `site.tech.${k}`, label: `Tech on the site: ${k}`, v: v === true ? 'yes' : v, url: state.homeUrl, method: 'crawl', note: 'found in the home / product page source' });

  /* Google PageSpeed for the health card's Storefront ring, run beside the walk; a failure is kept as { error } */
  const speed = state.homeUrl && speedOn() ? pageSpeed(state.homeUrl, { log: ctx.log }).then((ps) => { profile.site.pagespeed = keepSpeed(profile.site.pagespeed, ps); }) /* a failed check keeps the last good score with its date (health.js keepSpeed) */ : Promise.resolve();
  const hero = (profile.catalog?.hero || []).map((h) => (profile.catalog.products || []).find((p) => p.handle === h)).find((p) => p && p.inStock !== false) || profile.catalog?.products?.find((p) => p.inStock);
  const exe = CHROME();
  if (!exe) { await speed; profile.site.checkout = { v: SITE_V, error: 'no Chrome on this machine (set CHROME_PATH)' }; ctx.finding('site', { kind: 'rows', t: 'The path to checkout', src: pathOf(state.homeUrl), rows: techRows(tech), cap: 'Checkout not walked: no browser available.' }); return ctx.done('site', 'tech read, checkout not walked', 'empty'); }
  const { default: puppeteer } = await import('puppeteer-core');
  /* a brand that sells by enquiry (catalog.js storeKind): walk home → the enquiry form instead, and never submit it */
  if (profile.storeKind === 'enquiry') { await speed; return enquiryWalk(ctx, puppeteer, exe, tech); }
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900', '--lang=en-US'] });
  const kill = () => browser.close().catch(() => {});
  const onAbort = () => kill(); ctx.signal?.addEventListener?.('abort', onAbort, { once: true });
  let walk;
  try {
    walk = await walkOnce(ctx, browser, hero, tech, 'desktop');
    // many checkout apps render their button only for phones: walk again as a phone when the desktop walk fell short
    if (hero && !walk.reached && !ctx.signal?.aborted) {
      const m = await walkOnce(ctx, browser, hero, tech, 'mobile').catch(() => null);
      if (m && score(m) > score(walk)) { m.notes.unshift('The desktop walk fell short; this is the walk as a phone.'); walk = m; }
      else if (m) walk.notes.push('A second walk as a phone did not get further.');
    }
  } finally { ctx.signal?.removeEventListener?.('abort', onAbort); await kill(); await speed; }

  /* tags the walk saw fire count as on the site, whatever loaded them (GTM, a consent manager, the platform's own pixel) */
  const fired = Object.keys(walk.fired || {}).filter((k) => k in tech && !tech[k]);
  for (const k of fired) { tech[k] = true; ledger.add({ key: `site.tech.${k}`, label: `Tech on the site: ${k}`, v: 'yes', url: state.homeUrl, method: 'crawl', note: 'seen firing in the headless walk (not in the page source)' }); }
  if (Object.keys(walk.fired || {}).length) tech.firedLive = Object.keys(walk.fired);
  const ms = (label) => walk.steps.find((s) => s.step === label)?.ms;
  const toCart = walk.steps.filter((s) => ['Product page', 'Add to cart', 'Cart', 'Cart drawer'].includes(s.step)).reduce((a, s) => a + s.ms, 0);
  const reached = walk.reached;
  const app = walk.direct ? tech.checkoutApp || null : walk.checkoutApp || tech.checkoutApp || null;
  const stopErr = walk.reached ? null : walk.steps.find((s) => !s.ok)?.err || (hero ? null : 'no in-stock product');
  /* why the walk stopped, so a store that can't be walked headless is tried again weekly, not every day (reader/index.js siteFailed) */
  const stopReason = walk.reached ? null : !hero ? 'no-product' : /add-to-cart/i.test(stopErr || '') ? 'no-add-to-cart' : /cart not reachable/i.test(stopErr || '') ? 'no-cart' : /login|sign ?in/i.test(stopErr || '') ? 'login' : /checkout/i.test(stopErr || '') ? 'no-checkout' : 'other';
  profile.site.checkout = { v: SITE_V, at: new Date().toISOString(), stopReason, picked: walk.picked || null, steps: walk.steps.length, clicks: walk.clicks, msToCart: toCart || null, msToCheckout: reached ? walk.steps.reduce((a, s) => a + s.ms, 0) : null, payments: walk.payments, paymentsAfter: walk.paymentsAfter || null, cod: walk.cod, guest: walk.guest, popups: walk.popups, checkoutApp: app, direct: !!walk.direct, inPage: walk.inPage || null, device: walk.device, cartItems: walk.cartItems ?? null, otp: walk.otp || null, stoppedAt: walk.stoppedAt, notes: walk.notes, walk: walk.steps, product: hero?.url || null, ...(hero ? {} : { error: 'no in-stock product to walk with' }) };
  const src = state.homeUrl;
  ledger.add({ key: 'checkout.reached', label: 'Checkout entry page reached in a headless walk', v: reached ? 'yes' : 'no', url: src, method: 'crawl', note: walk.steps.map((s) => `${s.step} ${s.ok ? 'ok' : 'failed'} ${s.ms} ms`).join('; ') + (walk.device === 'mobile' ? ' (walked as a phone)' : '') });
  if (reached) ledger.add({ key: 'checkout.clicks', label: 'Clicks from product page to checkout', v: String(walk.clicks), n: walk.clicks, unit: 'clicks', url: hero.url, method: 'crawl' });
  if (toCart) ledger.add({ key: 'checkout.ms_to_cart', label: 'Time from product page to cart (headless, one run)', v: `${(toCart / 1e3).toFixed(1)} s`, n: toCart, unit: 'ms', url: hero.url, method: 'crawl', conf: 'low', note: 'one headless run from this machine, not a field measurement' });
  if (walk.payments.length) ledger.add({ key: 'checkout.payments', label: 'Payment options visible at checkout entry', v: walk.payments.join(', '), url: walk.stoppedAt || src, method: 'crawl' });
  if (walk.guest != null) ledger.add({ key: 'checkout.guest', label: 'Guest checkout offered', v: walk.guest ? 'yes' : 'no', url: walk.stoppedAt || src, method: 'crawl', layer: /inferred/.test(walk.notes.join(' ')) ? 'inferred' : 'observed', conf: 'medium' });
  if (walk.popups.length) ledger.add({ key: 'site.popups', label: 'Popups seen on the walk', v: String(walk.popups.length), n: walk.popups.length, url: src, method: 'crawl', note: walk.popups.join(' | ') });

  const rows = [];
  if (ms('Home') != null) rows.push(['Home page loads', `${(ms('Home') / 1e3).toFixed(1)} s`]);
  if (ms('Add to cart') != null) rows.push(['Add to cart', walk.steps.find((s) => s.step === 'Add to cart').ok ? '1 click' : 'button not found']);
  if (reached) rows.push(['To checkout', `${walk.clicks} click${walk.clicks === 1 ? '' : 's'}${walk.direct ? ' + /checkout opened' : ''}, ${(profile.site.checkout.msToCheckout / 1e3).toFixed(0)} s`]); else rows.push(['To checkout', hero ? 'not reached' : 'not walked']);
  if (app) rows.push(['Checkout', app]);
  // a step the walk never got to is not "none": say where the options show instead
  rows.push(['Payments seen', walk.payments.length ? walk.payments.slice(0, 4).join(', ') : !reached ? 'not checked' : walk.paymentsAfter ? `after the ${walk.paymentsAfter} step` : 'none shown yet']);
  rows.push(['Guest checkout', !reached && walk.guest == null ? 'not checked' : walk.guest == null ? 'unclear' : walk.guest ? 'yes' : 'no, login first']);
  if (walk.popups.length) rows.push(['Popups', String(walk.popups.length)]);
  // the product's name cut on a word, never mid-word ("…Hair Growth Se.")
  const heroName = hero ? ((t) => t.length <= 48 ? t : t.slice(0, 47).replace(/\s+\S*$/, '') + '…')(clean(hero.title || '').replace(/\s+-\s+\d+\s*(ml|g|gm|kg|l)\b.*$/i, '')) : '';
  const how = walk.device === 'mobile' ? ' as a phone' : '';
  const capT = !hero ? (profile.catalog?.products?.length ? 'No in-stock product to walk with: checkout not walked.' : "Checkout not walked: the catalog couldn't be read, so there was no product to walk with. The next refresh tries again.")
    : reached && walk.direct ? `Walked with ${heroName}${how}. Checkout button did not load headless, opened /checkout. Nothing entered.`
    : reached && walk.inPage ? `Walked with ${heroName}${how}. ${walk.inPage} opened over the page; stopped there, nothing entered.`
    : reached ? `Walked with ${heroName}${how}. Stopped at the checkout page, nothing entered.`
    : `Stopped early: ${walk.steps.find((s) => !s.ok)?.err || walk.notes[walk.notes.length - 1] || 'checkout not reached'}. The next refresh walks it again.`;
  ctx.finding('site', { kind: 'rows', t: 'The path to checkout', src: pathOf(hero?.url || src), rows: rows.slice(0, 6), cap: capT, tech: techRows(tech) }, reached ? 'Timed the checkout' : undefined);
  ctx.done('site', !hero ? 'tech read, no in-stock product to walk with' : reached ? `${walk.steps.length} steps, checkout timed` : `${walk.steps.filter((s) => s.ok).length} steps, checkout not reached`, reached ? 'done' : 'empty');
}

const score = (w) => (w.reached ? 100 : 0) + w.steps.filter((s) => s.ok).length;

/** one walk home → product → add to cart → cart → checkout entry, as a desktop or a phone. Never throws. */
async function walkOnce(ctx, browser, hero, tech, device) {
  const { profile, state } = ctx;
  const walk = { device, steps: [], clicks: 0, popups: [], payments: [], guest: null, cod: null, notes: [], stoppedAt: null, reached: false };
  // its own cookie jar: the phone walk starts with an empty cart
  const cx = await browser.createBrowserContext().catch(() => null);
  const page = await (cx || browser).newPage();
  try {
    if (device === 'mobile') { await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await page.setUserAgent(MOBILE_UA); }
    else { await page.setViewport({ width: 1366, height: 900 }); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); }
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); }).catch(() => {});
    page.setDefaultTimeout(20e3);
    // never send anything: a form POST that navigates is allowed only for the cart (add to cart, go to checkout;
    // WooCommerce posts add-to-cart to the product page itself)
    walk.fired = {}; page.on('requestfinished', (rq) => { const u = rq.url(); for (const [k, re] of Object.entries(NET)) if (!walk.fired[k] && re.test(u)) walk.fired[k] = true; });
    await page.setRequestInterception(true);
    page.on('request', (rq) => { let p = ''; try { p = new URL(rq.url()).pathname; } catch {} if (rq.method() === 'POST' && rq.isNavigationRequest() && rq.frame() === page.mainFrame() && !/^\/cart(\/(add|change|update))?(\.js)?\/?$/.test(p) && !/add-to-cart/.test(rq.url() + (rq.postData() || ''))) { walk.blocked = (walk.blocked || 0) + 1; return rq.abort(); } rq.continue(); });
    const t = async (label, fn) => { const s = Date.now(); let ok = true, err = null; try { await fn(); } catch (e) { ok = false; err = e.message.slice(0, 120); } walk.steps.push({ step: label, ms: Date.now() - s, ok, url: bare(page.url()), ...(err ? { err } : {}) }); return ok; };
    const popups = async () => { const found = await page.evaluate(() => { const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 200 && r.height > 120 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.1; };
      return [...document.querySelectorAll('[role=dialog],[aria-modal=true],.modal,.popup,[class*="popup"],[class*="Popup"],[id*="popup"],[class*="klaviyo-form"],[class*="needsclick"]')].filter(vis).map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter((x) => x.length > 8).slice(0, 3); }).catch(() => []);
      for (const f of found) if (!walk.popups.includes(f)) walk.popups.push(f); if (found.length) await page.keyboard.press('Escape').catch(() => {}); };
    const origin = new URL(state.homeUrl).origin;
    const shopOrigin = origin + (state.localePath ? '/' + state.localePath : '');

    ctx.tick('site', device === 'mobile' ? '/ (as a phone)' : '/');
    await t('Home', () => page.goto(state.walkUrl || state.homeUrl, { waitUntil: 'domcontentloaded', timeout: 30e3 }));
    await settle(page, 2500); await popups();
    if (!hero) { walk.notes.push('No in-stock product to walk with.'); return walk; }
    ctx.tick('site', pathOf(hero.url).replace(profile.host, ''));
    await t('Product page', () => page.goto(hero.url, { waitUntil: 'domcontentloaded', timeout: 30e3 }));
    await settle(page, 2500); await popups();
    ctx.tick('site', 'add to cart');
    const ATC = ['form[action*="/cart/add"] [type=submit]:not([disabled])', 'button[name="add"]:not([disabled])', '[data-add-to-cart]', '.product-form__submit', '#AddToCart', 'button.single_add_to_cart_button', '#add-to-cart-button', '[data-testid*="add-to-cart" i]', '[data-test-id*="add-to-cart" i]'];
    const ATC_RE = /^(add to (cart|bag|basket)|buy now|add)\b/i;
    // apparel and many non-Shopify stores need a size before Add to cart: pick the first one that can be bought
    const size = await pickVariant(page); if (size) { walk.picked = size; walk.notes.push(`Picked ${size} first.`); await settle(page, 1200); }
    const asksSize = () => page.evaluate(() => /(please )?(select|choose|pick) (a |your )?(size|colou?r|variant|option)/i.test(document.body.innerText.slice(0, 40000))).catch(() => false);
    const badge0 = await badgeCount(page);
    const added = await t('Add to cart', async () => {
      let clicked = await pollClick(page, ATC, ATC_RE, 8e3);
      if (!clicked) throw new Error('no add-to-cart button found'); walk.clicks++;
      await settle(page, 3000);
      // the store asked for a size after the click: pick one and click again, once
      if (await asksSize()) { const s2 = await pickVariant(page); if (s2) { walk.picked = s2; walk.notes.push(`The store asked for a size; picked ${s2}.`); await settle(page, 1000); if (await pollClick(page, ATC, ATC_RE, 5e3)) { walk.clicks++; await settle(page, 3000); } } }
    });
    await popups();
    if (!added) return walk;
    ctx.tick('site', '/cart');
    // a cart drawer often opens: use its checkout button if there is one, else open the cart page
    const drawerCheckout = await page.$$eval('button, a, input[type=submit]', (els) => els.some((e) => /check ?out/i.test((e.innerText || e.value || '').trim()) && e.offsetParent !== null)).catch(() => false);
    /* the cart page under the market path (/in/en/cart), then the common other names, then the header's cart icon */
    const openCart = async () => { for (const pth of [...new Set([`${shopOrigin}/cart`, `${origin}/cart`, `${shopOrigin}/bag`, `${shopOrigin}/basket`])]) { const r = await page.goto(pth, { waitUntil: 'domcontentloaded', timeout: 25e3 }).catch(() => null); if (r && r.status() < 400 && !/\/404|not-?found/i.test(page.url())) { await settle(page, 2000); return; } }
      const c = await clickFirst(page, ['a[href$="/cart"]', 'a[href*="/cart"]', 'a[href*="/bag"]', '[aria-label*="cart" i]', '[aria-label*="bag" i]', '.cart-icon', '#cart-icon-bubble'], /cart|bag|basket/i); if (!c) throw new Error('cart not reachable'); walk.clicks++; await settle(page, 2000); };
    let atCart;
    if (!drawerCheckout) atCart = await t('Cart', openCart);
    else { walk.steps.push({ step: 'Cart drawer', ms: 0, ok: true, url: bare(page.url()) }); atCart = true; }
    const cartCount = () => page.evaluate(() => fetch('/cart.js', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.item_count).catch(() => null)).catch(() => null);
    walk.cartItems = profile.platform === 'shopify' || tech.shopify ? await cartCount() : null;
    /* any other store: the header badge (null when there is none: unknown is never 0) */
    if (walk.cartItems == null) { const b = await badgeCount(page); if (b != null) walk.cartItems = b; else if (badge0 == null && walk.picked) walk.notes.push('Cart count not shown on this store.'); }
    // the click "worked" but the cart is empty (the theme's script wasn't ready, so the form posted without it):
    // add the product through the store's own cart API, then reload the cart. An empty cart's /checkout goes home.
    if (profile.platform === 'shopify' && walk.cartItems === 0) {
      const ok = await page.evaluate(async (handleUrl) => {
        const p = await fetch(handleUrl.replace(/[?#].*$/, '').replace(/\/$/, '') + '.js').then((r) => r.json()).catch(() => null);
        const v = (p?.variants || []).find((x) => x.available) || p?.variants?.[0]; if (!v) return false;
        const r = await fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ items: [{ id: v.id, quantity: 1 }] }) });
        return r.ok; }, hero.url).catch(() => false);
      walk.cartItems = await cartCount();
      walk.notes.push(ok && walk.cartItems ? "The add-to-cart click left the cart empty; added the product through the store's cart API instead." : 'The add-to-cart click left the cart empty, and the cart API did not take the product either.');
      if (walk.cartItems) await openCart().catch(() => {});
    }
    if (!atCart) return walk;

    ctx.tick('site', 'checkout');
    const before = page.url();
    let hit = null;
    await t('Checkout entry', async () => {
      // click the checkout button (apps render theirs late, so keep looking), then wait for the checkout to show:
      // a new page, or an app's iframe or modal over this one
      const tryButton = async (sel, wait) => { const seen = new Set(page.frames().map((f) => f.url())); const c = await pollClick(page, sel, CHECKOUT_RE, wait); if (!c) return null; walk.clicks++; return (await waitCheckout(page, before, seen, 20e3)) || 'clicked'; };
      let r = await tryButton(CHECKOUT_SEL, 15e3);
      if (r && r !== 'clicked') hit = r;
      if (!hit) {
        // the button never rendered headless or did nothing: open the store's own checkout entry and say so
        const path = profile.platform === 'woocommerce' ? '/checkout/' : '/checkout';
        await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded', timeout: 30e3 }).catch(() => null); await settle(page, 4000);
        if (isCheckoutUrl(page.url())) { hit = { how: 'direct' }; walk.direct = true;
          walk.notes.push(`${r ? 'The checkout button did nothing' : 'No visible checkout button'} in a headless browser${tech.checkoutApp ? ` (${tech.checkoutApp} button still loading)` : ''}; opened ${origin}${path} directly${profile.platform === 'shopify' ? ", which shows Shopify's own checkout" : ''}${tech.checkoutApp ? `. Shoppers may see ${tech.checkoutApp} instead` : ''}.`); }
        else {
          // the store sent /checkout back (checkout apps do): try the app's button on the cart page once more
          const back = new URL(page.url()).pathname;
          await openCart().catch(() => {});
          const r2 = await tryButton(CHECKOUT_SEL, 10e3);
          if (r2 && r2 !== 'clicked') hit = r2;
          else throw new Error((r || r2 ? `the checkout button did nothing and ${path} went back to ${back}` : `no checkout button found, and ${path} went back to ${back}`) + (walk.cartItems === 0 ? ' (the cart was empty)' : ''));
        }
      }
    });
    if (!hit) return walk;
    walk.reached = true;
    if (hit.how === 'frame' || hit.how === 'modal') walk.inPage = CHECKOUT_APPS.find(([, re]) => re.test(hit.url || hit.text || ''))?.[0] || tech.checkoutApp || 'A checkout';
    walk.stoppedAt = bare(hit.url || page.url());
    if (walk.inPage) await sleep(3000); // let the app's form draw before reading it
    // read what the checkout entry shows (page + any iframes, e.g. one-page checkout apps), never type
    // an app over the page: read only the app (the product page behind it says "COD available" and the like)
    const texts = hit.how === 'frame' ? [] : hit.how === 'modal' ? [hit.text] : [await page.evaluate(() => document.body?.innerText || '').catch(() => '')];
    for (const f of page.frames()) if (f !== page.mainFrame() && (hit.how !== 'frame' || APP_HOST.test(f.url()))) texts.push(await f.evaluate(() => document.body?.innerText || '').catch(() => ''));
    const txt = texts.join('\n');
    const html = await page.content().catch(() => '');
    walk.payments = PAY.filter(([, re]) => re.test(txt)).map(([k]) => k);
    walk.otp = /\bOTP\b|one[- ]time password/i.test(txt) || null;
    if (!walk.payments.length) {
      if (/shopify\.com\/checkouts|\/checkouts\//.test(page.url())) { walk.paymentsAfter = 'address'; walk.notes.push('Shopify checkout: payment options show after the address step, not on the entry page.'); }
      else if (/\b(mobile|phone)\b|\bOTP\b/i.test(txt)) { walk.paymentsAfter = 'phone'; walk.notes.push(`${walk.inPage ? walk.inPage[0].toUpperCase() + walk.inPage.slice(1) : 'The checkout'} asks for a phone number first; payment options show after it.`); }
    }
    walk.cod = walk.payments.includes('Cash on delivery') ? true : null;
    const login = /\b(log ?in|sign ?in)\b[^\n]{0,40}\b(to (continue|checkout)|required)\b/i.test(txt) && !/guest|continue without/i.test(txt);
    walk.guest = /guest checkout|continue as guest|checkout as guest/i.test(txt) ? true : login ? false : /\b(email|phone|mobile)\b/i.test(txt) ? true : null;
    if (walk.guest === true && !/guest/i.test(txt)) walk.notes.push('Guest checkout inferred: the entry page asks only for email or phone, no account.');
    walk.checkoutApp = walk.inPage && walk.inPage !== 'A checkout' ? walk.inPage : CHECKOUT_APPS.find(([, re]) => re.test(html + txt + page.url()))?.[0] || null;
  } catch (e) { walk.notes.push(e.message.slice(0, 140)); }
  finally { await page.close().catch(() => {}); await cx?.close().catch(() => {}); }
  return walk;
}

/** wait until the checkout shows after a click: the page moved to a checkout, a checkout app's iframe appeared and is
 *  visible, or a modal asks for a phone number or payment. Returns { how, url?, text? } or null. */
async function waitCheckout(page, before, framesBefore, max) {
  const end = Date.now() + max;
  while (Date.now() < end) {
    await sleep(800);
    const u = page.url();
    if (u !== before && isCheckoutUrl(u)) { await settle(page, 2000); return { how: 'page', url: u }; }
    for (const f of page.frames()) {
      if (f === page.mainFrame() || framesBefore.has(f.url()) && !APP_HOST.test(f.url())) continue;
      if (!APP_HOST.test(f.url()) && !/\/checkouts?\b/.test(f.url())) continue;
      const box = await f.frameElement().then((el) => el && el.boundingBox()).catch(() => null);
      if (box && box.width > 200 && box.height > 200) return { how: 'frame', url: f.url() };
    }
    const modal = await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[aria-modal=true],[class*="modal" i],[class*="checkout" i]')].map((el) => { const r = el.getBoundingClientRect(); return r.width > 250 && r.height > 250 && getComputedStyle(el).visibility !== 'hidden' ? (el.innerText || '') : ''; }).find((t) => /(mobile|phone) (number|no)|enter (your )?(mobile|phone)|payment (method|option)s?|continue to pay/i.test(t)) || '').catch(() => '');
    if (modal) return { how: 'modal', text: modal.slice(0, 400) };
    if (u !== before && !/\/cart\/?$/.test(new URL(u).pathname)) { await settle(page, 2000); if (isCheckoutUrl(page.url())) return { how: 'page', url: page.url() }; }
  }
  return null;
}

/** let a script-heavy page finish: network quiet (capped), then a short pause */
async function settle(page, ms) { await page.waitForNetworkIdle({ idleTime: 800, timeout: 8e3 }).catch(() => {}); await sleep(Math.min(ms, 1500)); }
/** keep looking for a button that renders late (checkout apps inject theirs after load) */
async function pollClick(page, selectors, textRe, max) { const end = Date.now() + max; do { if (await clickFirst(page, selectors, textRe)) return true; await sleep(1000); } while (Date.now() < end); return false; }

function techRows(tech) { return [['Email', tech.klaviyo ? 'Klaviyo' : 'not seen in source'], ['Meta pixel', tech.metaPixel ? 'yes' : tech.shopify ? 'not in source (may load as a Shopify web pixel)' : 'not seen in source'], ['GA4', tech.ga4 ? 'yes' : tech.gtm ? 'via GTM (not confirmed)' : 'not seen'], ['Chat', tech.chat || 'not seen'], ['Subscriptions', tech.subscriptionApp || 'not seen']]; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickFirst(page, selectors, textRe) {
  for (const s of selectors) {
    const els = await page.$$(s).catch(() => []);
    for (const el of els) { const ok = await el.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; }).catch(() => false); if (ok) { await el.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}); await el.click().catch(() => el.evaluate((e) => e.click())); return true; } }
  }
  if (textRe) {
    const h = await page.evaluateHandle((src, flags) => { const re = new RegExp(src, flags); return [...document.querySelectorAll('button, a, input[type=submit], [role=button]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled && re.test((e.innerText || e.value || e.getAttribute('aria-label') || '').trim()); }) || null; }, textRe.source, textRe.flags);
    const el = h.asElement(); if (el) { await el.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}); await el.click().catch(() => el.evaluate((e) => e.click())); return true; }
  }
  return false;
}

/* ---------- the path to an enquiry (real estate, services, B2B): home → the enquiry button → the form. Never types, never submits ---------- */
const ENQ_RE = /^\s*(enquire( now)?|enquiry|inquire( now)?|book an? (site |free |home )?(visit|demo|consultation|appointment|call)|schedule an? (visit|demo|call)|request an? (call ?back|callback|quote|demo|brochure)|get a quote|get in touch|contact( us| sales)?|talk to (an? )?(expert|advisor|sales)|download (the )?brochure)\b/i;
async function enquiryWalk(ctx, puppeteer, exe, tech) {
  const { profile, ledger, state } = ctx;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900', '--lang=en-US'] });
  const w = { steps: [], clicks: 0, fields: [], channels: [], cta: null, notes: [], fired: {} };
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1366, height: 900 }); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    page.on('requestfinished', (rq) => { const u = rq.url(); for (const [k, re] of Object.entries(NET)) if (!w.fired[k] && re.test(u)) w.fired[k] = true; });
    await page.setRequestInterception(true); page.on('request', (rq) => (rq.method() === 'POST' && rq.isNavigationRequest() ? rq.abort() : rq.continue())); /* nothing is ever submitted */
    const t = async (label, fn) => { const s0 = Date.now(); let ok = true, err = null; try { await fn(); } catch (e) { ok = false; err = e.message.slice(0, 120); } w.steps.push({ step: label, ms: Date.now() - s0, ok, ...(err ? { err } : {}) }); return ok; };
    ctx.tick('site', '/');
    await t('Home', () => page.goto(state.walkUrl || state.homeUrl || profile.url, { waitUntil: 'domcontentloaded', timeout: 30e3 })); await settle(page, 2500);
    w.channels = await page.evaluate(() => { const hs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || ''); const out = [];
      if (hs.some((h) => /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(h))) out.push('WhatsApp'); if (hs.some((h) => /^tel:/i.test(h))) out.push('Phone'); if (hs.some((h) => /^mailto:/i.test(h))) out.push('Email');
      if ([...document.querySelectorAll('iframe, script')].some((e) => /tawk|intercom|freshchat|zopim|crisp|drift|livechat|wati|interakt|gallabox/i.test(e.src || e.textContent.slice(0, 300)))) out.push('Live chat'); return out; }).catch(() => []);
    const formNow = () => page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const forms = [...document.querySelectorAll('form')].filter(vis).filter((f) => !/search/i.test(f.getAttribute('role') + ' ' + f.className + ' ' + f.action));
      const f = forms.find((x) => [...x.querySelectorAll('input, select, textarea')].filter((i) => vis(i) && !['hidden', 'submit', 'button'].includes(i.type)).length >= 2); if (!f) return null;
      return [...f.querySelectorAll('input, select, textarea')].filter((i) => vis(i) && !['hidden', 'submit', 'button'].includes(i.type)).map((i) => { const k = (i.name + ' ' + i.placeholder + ' ' + (i.labels?.[0]?.innerText || '') + ' ' + i.type).toLowerCase();
        return /phone|mobile|tel/.test(k) ? 'phone' : /mail/.test(k) ? 'email' : /name/.test(k) ? 'name' : /otp|code/.test(k) ? 'OTP' : /city|location|pin/.test(k) ? 'location' : /budget|price/.test(k) ? 'budget' : /project|property|interest|service|config|bhk/.test(k) ? 'interest' : i.tagName === 'TEXTAREA' ? 'message' : i.type === 'checkbox' ? 'consent' : 'other'; }); }).catch(() => null);
    ctx.tick('site', 'enquiry button');
    let fields = await formNow();
    await t('Enquiry button', async () => { const c = await pollClick(page, ['[data-enquire]', 'a[href*="enquir" i]', 'button[class*="enquir" i]', 'a[href*="contact" i]'], ENQ_RE, 6e3); if (!c) { if (fields) { w.notes.push('The enquiry form is on the home page itself.'); return; } throw new Error('no enquiry button found'); }
      w.clicks++; w.cta = await page.evaluate(() => (document.activeElement?.innerText || '').trim().slice(0, 40)).catch(() => null); await settle(page, 2500); });
    await t('Enquiry form', async () => { fields = (await formNow()) || fields; if (!fields) throw new Error('no form showed after the button'); });
    w.fields = [...new Set(fields || [])].filter((f) => f !== 'other');
    w.reached = !!fields;
    w.stoppedAt = (() => { try { return new URL(page.url()).origin + new URL(page.url()).pathname; } catch { return null; } })();
  } finally { await browser.close().catch(() => {}); }
  for (const k of Object.keys(w.fired).filter((k) => k in tech && !tech[k])) { tech[k] = true; ledger.add({ key: `site.tech.${k}`, label: `Tech on the site: ${k}`, v: 'yes', url: state.homeUrl, method: 'crawl', note: 'seen firing in the headless walk (not in the page source)' }); }
  if (Object.keys(w.fired).length) tech.firedLive = Object.keys(w.fired);
  const home = w.steps.find((s) => s.step === 'Home')?.ms;
  profile.site.checkout = { v: SITE_V, at: new Date().toISOString(), kind: 'enquiry', reached: !!w.reached, clicks: w.clicks, fields: w.fields, channels: w.channels, cta: w.cta, walk: w.steps, notes: w.notes, stoppedAt: w.stoppedAt,
    stopReason: w.reached ? null : /button/.test(w.steps.find((s) => !s.ok)?.err || '') ? 'no-enquiry-button' : 'no-form', payments: [], popups: [] };
  ledger.add({ key: 'enquiry.reached', label: 'Enquiry form reached in a headless walk', v: w.reached ? 'yes' : 'no', url: state.homeUrl, method: 'crawl', note: w.steps.map((s) => `${s.step} ${s.ok ? 'ok' : 'failed'} ${s.ms} ms`).join('; ') });
  if (w.fields.length) ledger.add({ key: 'enquiry.fields', label: 'What the enquiry form asks for', v: w.fields.join(', '), n: w.fields.length, unit: 'fields', url: w.stoppedAt || state.homeUrl, method: 'crawl' });
  if (w.channels.length) ledger.add({ key: 'enquiry.channels', label: 'Other ways to get in touch on the home page', v: w.channels.join(', '), url: state.homeUrl, method: 'crawl' });
  const rows = [];
  if (home != null) rows.push(['Home page loads', `${(home / 1e3).toFixed(1)} s`]);
  rows.push(['To the enquiry form', w.reached ? (w.clicks ? `${w.clicks} click${w.clicks === 1 ? '' : 's'}` : 'on the home page') : 'not reached']);
  rows.push(['Form asks for', w.fields.length ? w.fields.join(', ') : 'not checked']);
  rows.push(['Other ways in', w.channels.length ? w.channels.join(', ') : 'none seen']);
  const cap = w.reached ? `Walked to the enquiry form${w.cta ? ` ("${w.cta}")` : ''}. Nothing typed, nothing sent.` : `Stopped early: ${w.steps.find((s) => !s.ok)?.err || 'enquiry form not reached'}. The next refresh walks it again.`;
  ctx.finding('site', { kind: 'rows', t: 'The path to an enquiry', src: pathOf(state.homeUrl || profile.url), rows, cap, tech: techRows(tech) }, w.reached ? 'Walked to the enquiry form' : undefined);
  ctx.done('site', w.reached ? `enquiry form in ${w.clicks} click${w.clicks === 1 ? '' : 's'}, asks ${w.fields.length} things` : 'enquiry form not reached', w.reached ? 'done' : 'empty');
}
