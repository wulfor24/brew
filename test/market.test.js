// The selling market (market.js): where a brand's customers are, kept apart from where its store is registered. An
// Indian-registered store that prices in dollars and sells to the US gets the US playbook; connected orders and visits beat
// the public read; a brand can sell in more than one market; saved reads heal from what they already hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sellingMarket, signalsFromSaved, marketFor, applyMarket, connectedOf, marketLine, regionOf } from '../market.js';
import { configFromProfile } from '../derive.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };
const shipsTo29 = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'IN', 'AE', 'SG', 'NL', 'IE', 'NZ', 'SE', 'IT', 'ES', 'CH', 'AT', 'BE', 'DK', 'NO', 'FI', 'PT', 'PL', 'JP', 'HK', 'MY', 'SA', 'QA', 'KW'];
const at = new Date().toISOString();
const row = (key, v, n) => ({ key, label: key, v, ...(n != null ? { n } : {}), layer: 'observed', method: `account:${key.split('.')[0]}`, at });

test('an Indian-registered store pricing in USD with US traffic sells to the US', () => {
  const sig = { registered: 'IN', currency: 'USD', shipsTo: shipsTo29, hreflang: [], tld: 'shop', phone: 'IN', served: 'AE' };
  const m = sellingMarket(sig);
  assert.equal(m.primary, 'US');
  assert.equal(m.registered, 'IN', 'the address is kept, as the registered country');
  assert.equal(m.by, 'site');
  assert.match(m.why, /prices are in USD/);
  assert.match(m.why, /registered in India/);
  // with its visits connected: still the US, now with India as a second market, and sure of it
  const live = connectedOf([row('ga4.countries', 'US 65%; IN 13%; DE 3%; FR 3%; CA 2%'), row('ga4.sessions.30d', '4,210', 4210)]);
  const g = sellingMarket(sig, live);
  assert.deepEqual([g.primary, g.others, g.by, g.conf], ['US', ['IN'], 'ga4', 'high']);
});

test('an Indian store pricing in INR sells to India', () => {
  const m = sellingMarket({ registered: 'IN', currency: 'INR', shipsTo: ['IN'], hreflang: [], tld: 'in', phone: 'IN' });
  assert.deepEqual([m.primary, m.others, m.conf], ['IN', [], 'high']);
  const g = sellingMarket({ registered: 'IN', currency: 'INR', shipsTo: null, tld: 'com' });
  assert.equal(g.primary, 'IN', 'currency and address agree without a ccTLD or a ships-to list');
  assert.equal(g.registered, 'IN');
});

test('connected orders and visits beat the public read; orders beat visits; too little data does not count', () => {
  const site = { registered: 'IN', currency: 'INR', shipsTo: ['IN', 'US'], tld: 'in' };
  assert.equal(sellingMarket(site).primary, 'IN');
  const ga4 = row('ga4.countries', 'US 58%; IN 30%; GB 6%'), sess = row('ga4.sessions.30d', '9,000', 9000);
  assert.equal(sellingMarket(site, connectedOf([ga4, sess])).primary, 'US', 'GA4 visits beat the site');
  const orders = row('shopify.orders.countries', 'GB 70%; US 20%; IN 10%', 140);
  const both = sellingMarket(site, connectedOf([ga4, sess, orders]));
  assert.deepEqual([both.primary, both.others, both.by], ['GB', ['US', 'IN'], 'orders'], 'orders by shipping country beat visits');
  const few = sellingMarket(site, connectedOf([ga4, sess, row('shopify.orders.countries', 'GB 100%', 3)]));
  assert.equal(few.by, 'ga4', 'three orders are noise: visits decide');
  assert.equal(sellingMarket(site, connectedOf([row('ga4.countries', 'US 90%'), row('ga4.sessions.30d', '40', 40)])).primary, 'IN', '40 visits are noise: the site decides');
  // simulated (demo) rows are never evidence
  assert.equal(sellingMarket(site, connectedOf([{ ...ga4, demo: true }, sess])).primary, 'IN');
  // the brand's own correction beats everything
  assert.equal(sellingMarket({ ...site, brand: 'AE' }, connectedOf([ga4, sess, orders])).primary, 'AE');
});

test('a brand can sell in more than one market', () => {
  const m = sellingMarket({ registered: 'US', currency: 'USD', hreflang: ['en-us', 'en-gb', 'en-ca', 'x-default'], tld: 'com' });
  assert.equal(m.primary, 'US');
  assert.deepEqual(m.others, ['GB', 'CA'], 'the regions the site serves itself');
  const s = sellingMarket({ registered: 'GB', currency: 'GBP', shipsTo: ['GB', 'IE', 'NL'] });
  assert.deepEqual([s.primary, s.others], ['GB', ['IE', 'NL']], 'a short ships-to list');
  const g = sellingMarket({ registered: 'US', currency: 'USD' }, connectedOf([row('ga4.countries', 'US 48%; GB 31%; AU 12%; CA 5%')]));
  assert.deepEqual([g.primary, g.others], ['US', ['GB', 'AU']], '10% of visits or more is a market; 5% is not');
  const p = applyMarket({ locale: 'en-IN' }, g);
  assert.deepEqual(p.markets, ['US', 'GB', 'AU']);
  assert.equal(p.locale, 'en-US', 'the locale region follows the market');
  const cfg = configFromProfile({ ...p, currency: 'USD' });
  assert.deepEqual([cfg.country, cfg.countryName, cfg.markets, cfg.locale, cfg.locationCode], ['US', 'the US', ['US', 'GB', 'AU'], 'en-US', 2840]);
  assert.equal(regionOf('/en-gb'), 'GB'); assert.equal(regionOf('en'), null);
});

test('a saved read heals from its own ledger, and a brand correction there pins the market', () => {
  const ledger = [{ key: 'shop.currency', v: 'USD' }, { key: 'shop.country', v: 'IN' }, { key: 'market.currency', v: 'USD' },
    { key: 'market.country', v: 'IN', note: 'IN from Shopify /meta.json shop country; IN from Shopify store address; AE from Shopify.country (the market served to this visit)' }];
  const old = { slug: 'x', host: 'cozy.shop', country: 'IN', currency: 'USD', locale: 'en-IN' };
  const r = marketFor(old, ledger);
  assert.deepEqual([r.market.primary, r.moved, r.changed], ['US', true, true]);
  assert.equal(signalsFromSaved(old, ledger).registered, 'IN');
  const healed = applyMarket({ ...old }, r.market);
  assert.equal(marketFor(healed, ledger).changed, false, 'healed once: the next load changes nothing');
  const pinned = marketFor(healed, [...ledger, { key: 'market.country.confirmed', v: 'IN', method: 'brand-confirmed' }]);
  assert.deepEqual([pinned.market.primary, pinned.market.by], ['IN', 'brand'], 'the brand said India: India');
  assert.match(marketLine(healed), /Selling market: the US \(US\)\. The store is registered in India \(IN\)/);
  assert.equal(marketLine({ country: 'IN', registeredCountry: 'IN' }), 'Selling market: India (IN).');
});

async function brand(profile, ledger) {
  const { createPacks } = await import('../brand-pack.js'); const { createBuilder } = await import('../build.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-market-'));
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: quiet });
  const slug = profile.slug;
  await P.put(slug, 'status.json', { slug, name: profile.name, done: true, ready: true, state: 'Ready' });
  await P.put(slug, 'profile.json', profile); await P.put(slug, 'ledger.json', ledger);
  await P.put(slug, 'config.json', { country: profile.country, countryName: 'India', locale: 'en-IN', statics: ['s1'] });
  await P.put(slug, 'moves.json', Object.fromEntries([1, 2, 3].map((n) => [n, { n, title: `Move ${n}`, meta: { at: 'a' } }])));
  const moves = { SPECS: [1, 2, 3].map((n) => ({ n })), createMovesEngine: () => ({ runAll: async () => {} }) };
  const b = createBuilder({ ROOT, packs: P, ai: { onCharge() {} }, treg: { onCharge() {} }, log: quiet, modules: { reader: null, brief: null, moves, pdf: null } });
  return { b, P, slug };
}

test('a saved Indian-registered dollar store heals to the US on load: profile, ledger, and its moves flagged for the pot', async () => {
  const { b, P, slug } = await brand({ slug: 'cozy-shop', name: 'Cozy', host: 'cozy.shop', url: 'https://cozy.shop/', country: 'IN', currency: 'USD', locale: 'en-IN', catalog: { products: [] } },
    [{ key: 'shop.currency', v: 'USD' }, { key: 'shop.country', label: 'Shop country (Shopify /meta.json)', v: 'IN' }, { key: 'market.country', v: 'IN', note: 'IN from Shopify store address' }]);
  const r = await b.marketCheck(slug);
  assert.deepEqual([r.was, r.now, r.moved], ['IN', 'US', true]);
  const p = await P.getJSON(slug, 'profile.json');
  assert.deepEqual([p.country, p.registeredCountry, p.locale, p.market.by], ['US', 'IN', 'en-US', 'site']);
  const L = await P.getJSON(slug, 'ledger.json');
  assert.equal(L.find((e) => e.key === 'market.country').v, 'US');
  assert.equal(L.find((e) => e.key === 'market.registered').v, 'IN');
  assert.match(L.find((e) => e.key === 'shop.country').label, /registered in/);
  const cfg = await P.getJSON(slug, 'config.json');
  assert.deepEqual([cfg.country, cfg.countryName, cfg.locale, cfg.locationCode, cfg.registeredCountry, cfg.statics], ['US', 'the US', 'en-US', 2840, 'IN', ['s1']], 'config follows; the rest of it stays');
  const u = await P.getJSON(slug, 'updates.json');
  const f = Object.values(u.stale || {});
  assert.deepEqual(f.map((x) => x.n).sort(), [1, 2, 3], 'every move is flagged once');
  assert.ok(f.every((x) => x.via === 'market' && x.priority === 'high' && x.real), 'flags the weekly run draws from the pot');
  const { flagKind } = await import('../rewrite-pot.js');
  assert.equal(flagKind(f[0]), 'check', 'a market flag is paid from the week\'s pot like the site check\'s');
  assert.match(f[0].why, /shoppers in India.*Rewritten for the US/);
  assert.equal(await b.marketCheck(slug), null, 'once healed, a load changes nothing');
});

test('a connected GA4 account that shows another market moves it and flags the moves; an INR store stays put', async () => {
  const { b, P, slug } = await brand({ slug: 'desi-in', name: 'Desi', host: 'desi.in', url: 'https://desi.in/', country: 'IN', currency: 'INR', locale: 'en-IN', catalog: { products: [] } },
    [{ key: 'shop.currency', v: 'INR' }, { key: 'shop.country', v: 'IN' }, { key: 'market.country', v: 'IN', note: 'IN from .in domain' }]);
  const first = await b.marketCheck(slug);
  assert.equal(first?.moved ?? false, false, 'an Indian store pricing in rupees stays India');
  assert.equal((await P.getJSON(slug, 'profile.json')).country, 'IN');
  assert.deepEqual(Object.keys((await P.getJSON(slug, 'updates.json', {})).stale || {}), []);
  await b.liveConnected(slug, 'ga4', [row('ga4.countries', 'AE 61%; IN 22%; SA 9%'), row('ga4.sessions.30d', '12,400', 12400)], true, { public: false });
  const p = await P.getJSON(slug, 'profile.json');
  assert.deepEqual([p.country, p.markets, p.market.by], ['AE', ['AE', 'IN'], 'ga4']);
  const f = Object.values((await P.getJSON(slug, 'updates.json')).stale || {}).filter((x) => x.via === 'market');
  assert.equal(f.length, 3);
});

test('the read itself: open() on an Indian-registered Shopify store pricing in USD sets the US, keeps India as registered', async () => {
  const { open } = await import('../reader/stages/open.js');
  const pad = '<p>' + 'Warm slippers for cold nights. '.repeat(120) + '</p>';
  const read = async (meta, extraHead = '') => {
    const pages = {
      'https://cozy.shop/': `<html lang="en"><head><title>Cozy</title><meta property="og:site_name" content="Cozy">${extraHead}<script>Shopify.shop = "cozy.myshopify.com"; Shopify.country = "AE"; Shopify.currency = {"active":"USD"};</script></head><body>${pad}<footer>Call +91 98765 43210</footer></body></html>`,
      'https://cozy.shop/meta.json': JSON.stringify(meta)
    };
    const http = { get: async (u, o = {}) => { const t = pages[u.split('?')[0]] ?? pages[u]; if (t == null) return { ok: false, status: 404 }; return { ok: true, status: 200, url: u, text: t, ...(o.as === 'json' ? { json: JSON.parse(t) } : {}) }; } };
    const added = [], profile = {};
    await open({ http, profile, url: new URL('https://cozy.shop/'), state: {}, ledger: { add: (e) => added.push(e) }, tick() {}, render: async () => null, finding() {}, done() {}, aiOn: false, log: quiet });
    return { profile, added };
  };
  const { profile, added } = await read({ currency: 'USD', country: 'IN', city: 'Bengaluru', ships_to_countries: shipsTo29 });
  assert.deepEqual([profile.country, profile.registeredCountry, profile.currency], ['US', 'IN', 'USD']);
  assert.equal(profile.market.signals.shipsTo.length, 29, 'the ships-to list is kept, so the market heals from it later');
  assert.equal(added.find((e) => e.key === 'market.country').v, 'US');
  assert.equal(added.find((e) => e.key === 'market.registered').v, 'IN');
  const inr = await read({ currency: 'INR', country: 'IN', ships_to_countries: ['IN'] });
  assert.deepEqual([inr.profile.country, inr.profile.registeredCountry, inr.profile.locale], ['IN', 'IN', 'en-IN']);
  assert.equal(inr.added.find((e) => e.key === 'market.registered'), undefined, 'no "registered elsewhere" line when they agree');
  const multi = await read({ currency: 'USD', country: 'US', ships_to_countries: ['US', 'CA', 'GB'] }, '<link rel="alternate" hreflang="en-us" href="/"><link rel="alternate" hreflang="en-gb" href="/en-gb">');
  assert.deepEqual(multi.profile.markets, ['US', 'GB', 'CA']);
});
