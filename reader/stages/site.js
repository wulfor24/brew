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

export async function site(ctx) {
  const { profile, ledger, state } = ctx;
  ctx.tick('site', 'page source');
  const tech = detectTech(state.home + ' ' + (state.heroPages || []).map((x) => x.html).join(' '));
  tech.reviewApp = profile.reviews?.app || null;
  profile.site = { ...(profile.site || {}), tech };
  for (const [k, v] of Object.entries(tech)) if (v) ledger.add({ key: `site.tech.${k}`, label: `Tech on the site: ${k}`, v: v === true ? 'yes' : v, url: state.homeUrl, method: 'crawl', note: 'found in the home / product page source' });

  const hero = (profile.catalog?.hero || []).map((h) => profile.catalog.products.find((p) => p.handle === h)).find((p) => p && p.inStock !== false) || profile.catalog?.products?.find((p) => p.inStock);
  const exe = CHROME();
  if (!exe) { profile.site.checkout = { error: 'no Chrome on this machine (set CHROME_PATH)' }; ctx.finding('site', { kind: 'rows', t: 'The path to checkout', src: pathOf(state.homeUrl), rows: techRows(tech), cap: 'Checkout not walked: no browser available.' }); return ctx.done('site', 'tech read, checkout not walked', 'empty'); }
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900', '--lang=en-US'] });
  const walk = { steps: [], clicks: 0, popups: [], payments: [], guest: null, cod: null, notes: [], stoppedAt: null };
  const kill = () => browser.close().catch(() => {});
  const onAbort = () => kill(); ctx.signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    page.setDefaultTimeout(20e3);
    // never send anything: a form POST that navigates is allowed only for the cart (add to cart, go to checkout)
    await page.setRequestInterception(true);
    page.on('request', (rq) => { let p = ''; try { p = new URL(rq.url()).pathname; } catch {} if (rq.method() === 'POST' && rq.isNavigationRequest() && rq.frame() === page.mainFrame() && !/^\/cart(\/(add|change|update))?(\.js)?\/?$/.test(p)) { walk.blocked = (walk.blocked || 0) + 1; return rq.abort(); } rq.continue(); });
    const t = async (label, fn) => { const s = Date.now(); let ok = true, err = null; try { await fn(); } catch (e) { ok = false; err = e.message.slice(0, 120); } walk.steps.push({ step: label, ms: Date.now() - s, ok, url: page.url(), ...(err ? { err } : {}) }); return ok; };
    const popups = async () => { const found = await page.evaluate(() => { const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 200 && r.height > 120 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.1; };
      return [...document.querySelectorAll('[role=dialog],[aria-modal=true],.modal,.popup,[class*="popup"],[class*="Popup"],[id*="popup"],[class*="klaviyo-form"],[class*="needsclick"]')].filter(vis).map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter((x) => x.length > 8).slice(0, 3); }).catch(() => []);
      for (const f of found) if (!walk.popups.includes(f)) walk.popups.push(f); if (found.length) await page.keyboard.press('Escape').catch(() => {}); };

    ctx.tick('site', '/');
    await t('Home', () => page.goto(state.walkUrl || state.homeUrl, { waitUntil: 'domcontentloaded', timeout: 30e3 }));
    await sleep(2500); await popups();
    if (!hero) { walk.notes.push('No in-stock product to walk with.'); throw new Error('no product'); }
    ctx.tick('site', pathOf(hero.url).replace(profile.host, ''));
    await t('Product page', () => page.goto(hero.url, { waitUntil: 'domcontentloaded', timeout: 30e3 }));
    await sleep(2500); await popups();
    ctx.tick('site', 'add to cart');
    const added = await t('Add to cart', async () => {
      const clicked = await clickFirst(page, ['form[action*="/cart/add"] [type=submit]:not([disabled])', 'button[name="add"]:not([disabled])', '[data-add-to-cart]', '.product-form__submit', '#AddToCart', 'button.single_add_to_cart_button', '#add-to-cart-button', '[data-testid*="add-to-cart" i]'], /^(add to (cart|bag|basket)|buy now|add)\b/i);
      if (!clicked) throw new Error('no add-to-cart button found'); walk.clicks++;
      await sleep(3000);
    });
    await popups();
    ctx.tick('site', '/cart');
    let atCart = false;
    if (added) {
      // a cart drawer often opens: use its checkout button if there is one, else open the cart page
      const drawerCheckout = await page.$$eval('button, a, input[type=submit]', (els) => els.some((e) => /check ?out/i.test((e.innerText || e.value || '').trim()) && e.offsetParent !== null)).catch(() => false);
      if (!drawerCheckout) {
        atCart = await t('Cart', async () => { const origin = new URL(state.homeUrl).origin + (state.localePath ? '/' + state.localePath : ''); const r = await page.goto(`${origin}/cart`, { waitUntil: 'domcontentloaded', timeout: 25e3 }); if (!r || r.status() >= 400) { const c = await clickFirst(page, ['a[href$="/cart"]', '[aria-label*="cart" i]', '.cart-icon', '#cart-icon-bubble'], /cart|bag|basket/i); if (!c) throw new Error('cart not reachable'); walk.clicks++; } await sleep(2000); });
      } else { walk.steps.push({ step: 'Cart drawer', ms: 0, ok: true, url: page.url() }); atCart = true; }
      walk.cartItems = await page.evaluate(() => fetch('/cart.js').then((r) => r.json()).then((j) => j.item_count).catch(() => null)).catch(() => null);
    }
    if (atCart) {
      ctx.tick('site', 'checkout');
      const before = page.url();
      await t('Checkout entry', async () => {
        const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25e3 }).catch(() => null);
        const c = await clickFirst(page, ['button[name="checkout"]', 'input[name="checkout"]', 'a[href*="/checkout"]', '[data-testid*="checkout" i]', '#checkout'], /^\s*(secure )?check ?out|^proceed to (checkout|buy)|^place order|^buy now/i);
        if (c) { walk.clicks++; await nav; await sleep(6000); }
        // some checkout buttons (one-click apps like GoKwik) never render for a headless browser: open the
        // store's own /checkout entry instead, and say so
        if (!c || page.url() === before) {
          if (profile.platform !== 'shopify') throw new Error('no checkout button found');
          walk.notes.push(`${c ? 'The checkout button did nothing' : 'No visible checkout button'} in a headless browser${tech.checkoutApp ? ` (${tech.checkoutApp} button still loading)` : ''}; opened ${new URL(state.homeUrl).origin}/checkout directly, which shows Shopify's own checkout${tech.checkoutApp ? `. Shoppers may see ${tech.checkoutApp} instead` : ''}.`);
          walk.direct = true;
          await page.goto(`${new URL(state.homeUrl).origin}/checkout`, { waitUntil: 'domcontentloaded', timeout: 30e3 }); await sleep(6000);
        }
      });
      walk.stoppedAt = page.url() !== before ? page.url() : null;
      // read what the checkout entry shows (page + any iframes, e.g. one-page checkout apps), never type
      const texts = [await page.evaluate(() => document.body?.innerText || '').catch(() => '')];
      for (const f of page.frames()) if (f !== page.mainFrame()) texts.push(await f.evaluate(() => document.body?.innerText || '').catch(() => ''));
      const txt = texts.join('\n');
      const html = await page.content().catch(() => '');
      walk.payments = PAY.filter(([, re]) => re.test(txt)).map(([k]) => k);
      if (/shopify\.com\/checkouts|\/checkouts\//.test(page.url()) && !walk.payments.length) walk.notes.push('Shopify checkout: payment options show after the address step, not on the entry page.');
      walk.cod = walk.payments.includes('Cash on delivery') ? true : null;
      const login = /\b(log ?in|sign ?in)\b[^\n]{0,40}\b(to (continue|checkout)|required)\b/i.test(txt) && !/guest|continue without/i.test(txt);
      walk.guest = /guest checkout|continue as guest|checkout as guest/i.test(txt) ? true : login ? false : /\b(email|phone|mobile)\b/i.test(txt) ? true : null;
      if (walk.guest === true && !/guest/i.test(txt)) walk.notes.push('Guest checkout inferred: the entry page asks only for email or phone, no account.');
      walk.checkoutApp = CHECKOUT_APPS.find(([, re]) => re.test(html + txt))?.[0] || null;
      walk.otp = /\bOTP\b|one[- ]time password/i.test(txt) || null;
    }
  } catch (e) { if (e.message !== 'no product') walk.notes.push(e.message.slice(0, 140)); }
  finally { ctx.signal?.removeEventListener?.('abort', onAbort); await kill(); }

  const ms = (label) => walk.steps.find((s) => s.step === label)?.ms;
  const toCart = walk.steps.filter((s) => ['Product page', 'Add to cart', 'Cart', 'Cart drawer'].includes(s.step)).reduce((a, s) => a + s.ms, 0);
  const reached = walk.steps.find((s) => s.step === 'Checkout entry' && s.ok);
  profile.site.checkout = { steps: walk.steps.length, clicks: walk.clicks, msToCart: toCart || null, msToCheckout: reached ? walk.steps.reduce((a, s) => a + s.ms, 0) : null, payments: walk.payments, cod: walk.cod, guest: walk.guest, popups: walk.popups, checkoutApp: walk.direct ? tech.checkoutApp || null : walk.checkoutApp || tech.checkoutApp || null, direct: !!walk.direct, otp: walk.otp || null, stoppedAt: walk.stoppedAt, notes: walk.notes, walk: walk.steps, product: hero?.url || null };
  const src = state.homeUrl;
  ledger.add({ key: 'checkout.reached', label: 'Checkout entry page reached in a headless walk', v: reached ? 'yes' : 'no', url: src, method: 'crawl', note: walk.steps.map((s) => `${s.step} ${s.ok ? 'ok' : 'failed'} ${s.ms} ms`).join('; ') });
  if (reached) ledger.add({ key: 'checkout.clicks', label: 'Clicks from product page to checkout', v: String(walk.clicks), n: walk.clicks, unit: 'clicks', url: hero.url, method: 'crawl' });
  if (toCart) ledger.add({ key: 'checkout.ms_to_cart', label: 'Time from product page to cart (headless, one run)', v: `${(toCart / 1e3).toFixed(1)} s`, n: toCart, unit: 'ms', url: hero.url, method: 'crawl', conf: 'low', note: 'one headless run from this machine, not a field measurement' });
  if (walk.payments.length) ledger.add({ key: 'checkout.payments', label: 'Payment options visible at checkout entry', v: walk.payments.join(', '), url: walk.stoppedAt || src, method: 'crawl' });
  if (walk.guest != null) ledger.add({ key: 'checkout.guest', label: 'Guest checkout offered', v: walk.guest ? 'yes' : 'no', url: walk.stoppedAt || src, method: 'crawl', layer: /inferred/.test(walk.notes.join(' ')) ? 'inferred' : 'observed', conf: 'medium' });
  if (walk.popups.length) ledger.add({ key: 'site.popups', label: 'Popups seen on the walk', v: String(walk.popups.length), n: walk.popups.length, url: src, method: 'crawl', note: walk.popups.join(' | ') });

  const rows = [];
  if (ms('Home') != null) rows.push(['Home page loads', `${(ms('Home') / 1e3).toFixed(1)} s`]);
  if (ms('Add to cart') != null) rows.push(['Add to cart', walk.steps.find((s) => s.step === 'Add to cart').ok ? `${walk.clicks ? 1 : 0} click` : 'button not found']);
  if (reached) rows.push(['To checkout', `${walk.clicks} click${walk.clicks === 1 ? '' : 's'}${walk.direct ? ' + /checkout opened' : ''}, ${(profile.site.checkout.msToCheckout / 1e3).toFixed(0)} s`]); else rows.push(['To checkout', 'not reached']);
  if (profile.site.checkout.checkoutApp) rows.push(['Checkout', profile.site.checkout.checkoutApp]);
  rows.push(['Payments seen', walk.payments.length ? walk.payments.slice(0, 4).join(', ') : 'none shown yet']);
  rows.push(['Guest checkout', walk.guest == null ? 'unclear' : walk.guest ? 'yes' : 'no, login first']);
  if (walk.popups.length) rows.push(['Popups', String(walk.popups.length)]);
  const capT = reached && walk.direct ? `Walked with ${clean(hero.title).slice(0, 40)}. Checkout button did not load headless, opened /checkout. Nothing entered.` : reached ? `Walked with ${clean(hero.title).slice(0, 40)}. Stopped at the checkout page, nothing entered.` : `Stopped early: ${walk.steps.find((s) => !s.ok)?.err || walk.steps.find((s) => !s.ok)?.err || 'checkout not reached'}.`;
  ctx.finding('site', { kind: 'rows', t: 'The path to checkout', src: pathOf(hero?.url || src), rows: rows.slice(0, 6), cap: capT, tech: techRows(tech) }, reached ? 'Timed the checkout' : undefined);
  ctx.done('site', reached ? `${walk.steps.length} steps, checkout timed` : `${walk.steps.filter((s) => s.ok).length} steps, checkout not reached`, reached ? 'done' : 'empty');
}

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
