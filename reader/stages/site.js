// Stage 6 · site: tech in the page source, then a headless walk home → product → add to cart → cart →
// checkout entry page with puppeteer-core. Times each step, counts clicks, records the payment options and
// popups seen, and whether guest checkout is offered. It STOPS at the checkout entry page: it never types
// personal data, never submits a form and never pays.
import fs from 'node:fs';
import { pathOf, clean } from '../util.js';

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
export const SITE_V = 2;
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

  const hero = (profile.catalog?.hero || []).map((h) => (profile.catalog.products || []).find((p) => p.handle === h)).find((p) => p && p.inStock !== false) || profile.catalog?.products?.find((p) => p.inStock);
  const exe = CHROME();
  if (!exe) { profile.site.checkout = { v: SITE_V, error: 'no Chrome on this machine (set CHROME_PATH)' }; ctx.finding('site', { kind: 'rows', t: 'The path to checkout', src: pathOf(state.homeUrl), rows: techRows(tech), cap: 'Checkout not walked: no browser available.' }); return ctx.done('site', 'tech read, checkout not walked', 'empty'); }
  const { default: puppeteer } = await import('puppeteer-core');
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
  } finally { ctx.signal?.removeEventListener?.('abort', onAbort); await kill(); }

  const ms = (label) => walk.steps.find((s) => s.step === label)?.ms;
  const toCart = walk.steps.filter((s) => ['Product page', 'Add to cart', 'Cart', 'Cart drawer'].includes(s.step)).reduce((a, s) => a + s.ms, 0);
  const reached = walk.reached;
  const app = walk.direct ? tech.checkoutApp || null : walk.checkoutApp || tech.checkoutApp || null;
  profile.site.checkout = { v: SITE_V, steps: walk.steps.length, clicks: walk.clicks, msToCart: toCart || null, msToCheckout: reached ? walk.steps.reduce((a, s) => a + s.ms, 0) : null, payments: walk.payments, paymentsAfter: walk.paymentsAfter || null, cod: walk.cod, guest: walk.guest, popups: walk.popups, checkoutApp: app, direct: !!walk.direct, inPage: walk.inPage || null, device: walk.device, otp: walk.otp || null, stoppedAt: walk.stoppedAt, notes: walk.notes, walk: walk.steps, product: hero?.url || null, ...(hero ? {} : { error: 'no in-stock product to walk with' }) };
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
  const capT = !hero ? 'No in-stock product to walk with: checkout not walked.'
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
    const added = await t('Add to cart', async () => {
      const clicked = await pollClick(page, ['form[action*="/cart/add"] [type=submit]:not([disabled])', 'button[name="add"]:not([disabled])', '[data-add-to-cart]', '.product-form__submit', '#AddToCart', 'button.single_add_to_cart_button', '#add-to-cart-button', '[data-testid*="add-to-cart" i]'], /^(add to (cart|bag|basket)|buy now|add)\b/i, 8e3);
      if (!clicked) throw new Error('no add-to-cart button found'); walk.clicks++;
      await settle(page, 3000);
    });
    await popups();
    if (!added) return walk;
    ctx.tick('site', '/cart');
    // a cart drawer often opens: use its checkout button if there is one, else open the cart page
    const drawerCheckout = await page.$$eval('button, a, input[type=submit]', (els) => els.some((e) => /check ?out/i.test((e.innerText || e.value || '').trim()) && e.offsetParent !== null)).catch(() => false);
    const openCart = async () => { const r = await page.goto(`${shopOrigin}/cart`, { waitUntil: 'domcontentloaded', timeout: 25e3 }); if (!r || r.status() >= 400) { const c = await clickFirst(page, ['a[href$="/cart"]', '[aria-label*="cart" i]', '.cart-icon', '#cart-icon-bubble'], /cart|bag|basket/i); if (!c) throw new Error('cart not reachable'); walk.clicks++; } await settle(page, 2000); };
    let atCart;
    if (!drawerCheckout) atCart = await t('Cart', openCart);
    else { walk.steps.push({ step: 'Cart drawer', ms: 0, ok: true, url: bare(page.url()) }); atCart = true; }
    walk.cartItems = await page.evaluate(() => fetch('/cart.js').then((r) => r.json()).then((j) => j.item_count).catch(() => null)).catch(() => null);
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
          else throw new Error(r || r2 ? `the checkout button did nothing and ${path} went back to ${back}` : `no checkout button found, and ${path} went back to ${back}`);
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
