// Demo connected accounts for a generated brand: what Shopify, Meta, Google + GA4, the marketplaces, reviews, WhatsApp
// and Klaviyo would show once the brand connects them. Built from the real read (the brand's real products and
// prices, its real review count, its real live ads, its real search terms and rivals) and filled with numbers in
// typical ranges for a brand of that size. Deterministic per brand, so every viewer sees the same demo account.
// Every number made here is labelled as demo data: on the connect sheet, the cards ("demo account") and the ledger.
import { moneyFmt } from './brand-pack.js';

export const DEMO_V = 4; /* 4: Google Analytics and Google Ads are separate accounts */
const seeded = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909), (h >>> 0) / 4294967296)); };
const round = (x, to = 1) => Math.round(x / to) * to;
const pct = (x, d = 0) => `${(+x).toFixed(d)}%`;
const n0 = (x) => Math.round(x).toLocaleString('en-US');

export function demoFor(profile, seed = {}) {
  const p = profile || {}, slug = p.slug || p.host || 'brand', R = seeded(slug + ':demo'), j = (lo, hi) => lo + (hi - lo) * R();
  const india = (p.country || 'IN') === 'IN', cur = p.currency || (india ? 'INR' : 'USD'), money = moneyFmt(cur, p.locale || (india ? 'en-IN' : 'en-US'));
  const big = (x) => (india && x >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : india && x >= 1e5 ? `₹${(x / 1e5).toFixed(1)} L` : money(round(x, x > 1e4 ? 100 : 1)));
  const prods = (p.catalog?.products || []).filter((x) => +x.price > 0 && !/gift ?wrap|gift ?card|protection/i.test(x.title || ''));
  const prices = prods.slice(0, 12).map((x) => +x.price).sort((a, b) => a - b), med = prices[Math.floor(prices.length / 2)] || (india ? 1499 : 49);
  const name = p.name || seed.brand?.name || slug, hero = prods.slice(0, 5);
  const lane = Object.keys(seed.lanes || { core: 1 })[0];
  // size: a review is left on roughly 1 order in 25; the review count is real
  const reviews = +p.reviews?.total || 0;
  const orders = Math.max(240, Math.min(60000, round((reviews ? reviews / 0.04 / 30 : 900) * j(0.85, 1.15), 10)));
  const aov = round(med * j(1.04, 1.18), india ? 10 : 1), revenue = orders * aov;
  const mob = j(76, 86), mobCr = j(1.0, 1.7), deskCr = mobCr * j(1.8, 2.3), cr = (mob * mobCr + (100 - mob) * deskCr) / 100, sessions = round(orders / (cr / 100), 100);
  const atc = j(6.5, 9), started = round(orders / j(0.44, 0.56), 10), left = started - orders, repeat = j(15, 25), newShare = j(68, 78);
  const cod = india ? j(42, 58) : 0, rto = india ? j(14, 22) : 0;
  const share = [27, 18, 13, 10, 8].map((x) => x * j(0.85, 1.15));
  const top = hero.map((x, i) => ({ title: x.title, price: x.priceLabel || money(+x.price), orders: round(orders * share[i] / 100, 1) }));
  const shopify = { orders, aov, revenue, sessions, cr, mob, mobCr, deskCr, atc, started, left, leftValue: left * aov, repeat, newShare, cod, rto, top,
    stats: [['Orders, last 30 days', n0(orders)], ['Average order', money(aov)], ['Conversion', pct(cr, 1)], ['Back for a second order in 90 days', pct(repeat)]] };
  // Meta: spend a typical share of sales; the brand's real live ads and products name the campaigns
  const live = +p.ads?.own?.live || round(j(12, 30));
  const spend = round(revenue * j(0.13, 0.19), india ? 1000 : 10), roas = j(2.1, 3.1), cpa = spend / Math.max(1, orders * newShare / 100 * j(0.5, 0.62));
  const camp = [
    { name: `Prospecting | ${hero[0]?.title || 'Best sellers'}`, share: j(0.38, 0.46), roas: roas * j(0.85, 1.05), freq: j(1.6, 2.2) },
    { name: 'Advantage+ shopping | Catalog', share: j(0.28, 0.34), roas: roas * j(1.08, 1.3), freq: j(1.8, 2.4) },
    { name: 'Retargeting | 30 days', share: 0, roas: roas * j(1.3, 1.7), freq: j(3.6, 4.8) }];
  camp[2].share = 1 - camp[0].share - camp[1].share; camp.forEach((c) => { c.spend = round(spend * c.share / 30, india ? 100 : 1); });
  const meta = { spend, roas, cpa, live, camp, tired: Math.max(2, round(live * j(0.2, 0.35))),
    stats: [['Spend, last 30 days', big(spend)], ['Return on ad spend', `${roas.toFixed(1)}x`], ['Cost per first order', money(round(cpa, india ? 10 : 1))], ['Live ads', n0(live)]] };
  // Google + GA4: the real category searches the read found
  const terms = (p.search?.terms || []).slice(0, 4), branded = j(52, 68), gspend = round(spend * j(0.25, 0.4), india ? 1000 : 10);
  const mix = [['Paid social', j(30, 38)], ['Direct', j(18, 24)], ['Organic search', j(14, 20)], ['Paid search', j(10, 15)], ['Email and WhatsApp', j(4, 8)]];
  const google = { gspend, branded, terms, mix, pdp: j(38, 48), atc, checkout: (started / sessions) * 100,
    stats: [['Search spend, 30 days', big(gspend)], ['Searches that are your own name', pct(branded)], ['Paid search share of visits', pct(mix[3][1])]] };
  const ga4 = { stats: [['Sessions, last 30 days', n0(sessions)], ['Conversion (GA4)', pct(cr, 2)], ['Mobile share of visits', pct(mob)]] };
  // marketplaces: the brand's own catalog, listed where the read saw it sold
  const mkts = (seed.marketplaces?.length ? seed.marketplaces : india ? ['Amazon', 'Flipkart'] : ['Amazon']).slice(0, 3);
  const listings = Math.min(prods.length || 12, 40), thinListings = Math.max(1, round(listings * j(0.2, 0.4)));
  const mShare = j(14, 26), mRank = round(j(6, 18)), mTerm = terms[0] || p.category || 'your category';
  const marketplaces = { mkts, listings, thin: thinListings, share: mShare, rank: mRank, term: mTerm,
    stats: [['Live listings', `${n0(listings)} on ${mkts.join(', ')}`], ['Share of orders', pct(mShare)], ['Listings with 1 or 2 photos', n0(thinListings)], ['Search rank, top term', `#${mRank}`]] };
  const rating = +(p.reviews?.platforms?.find((x) => x.rating)?.rating || j(4.4, 4.7)).toFixed(1);
  const unans = round(j(14, 40)), photoShare = j(8, 16);
  const reviewsA = { total: reviews || round(orders * 0.6), rating, unanswered: unans, photo: photoShare, month: round(orders * 0.04),
    stats: [['Reviews', n0(reviews || round(orders * 0.6))], ['Average rating', `${rating} of 5`], ['1 and 2 star, no reply yet', n0(unans)], ['With a photo', pct(photoShare)]] };
  const customers = round(orders * 12 * newShare / 100 * 0.9, 10), optins = round(customers * j(0.26, 0.38), 10);
  const tpl = round(j(3, 7)), readR = j(72, 84), list = round(optins * j(1.2, 1.6), 10), openR = j(28, 38), emailRev = j(4, 9);
  const whatsapp = { optins, templates: tpl, sentMonth: 0, read: readR,
    stats: [['Opted in', n0(optins)], ['Approved templates', n0(tpl)], ['Messages sent this month', '0'], ['Read rate, last campaign', pct(readR)]] };
  const klaviyo = { list, flows: [['Welcome', true], ['Abandoned checkout', true], ['Browse abandonment', false], ['Post-purchase', false], ['Win-back', false]], open: openR,
    stats: [['Email list', n0(list)], ['Flows live', '2 of 5'], ['Open rate', pct(openR)], ['Revenue from email', pct(emailRev)]] };
  const A = { shopify, meta, google, ga4, marketplaces, reviews: reviewsA, whatsapp, klaviyo };

  /* the cards each account unlocks (hidden until it is connected: onlyWhen) */
  const D = 'demo account';
  const card = (id, k, o) => ({ id: `demo-${k}-${id}`, onlyWhen: k, demo: true, lane, roles: o.roles, agent: o.agent, sector: o.sector, type: o.type, kind: 'rows', time: o.time || '6 min', src: `${CONN_NAME[k]} · ${D}`, title: o.title, sub: o.sub, rows: o.rows, badge: o.badge, detail: o.detail, cta: { label: o.cta } });
  const sp = (x) => money(round(x, india ? 100 : 1));
  const worst = camp[0], best = camp[1], rt = camp[2];
  const cards = [
    card('carts', 'shopify', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm', 'founder', 'ecom'], badge: ['Shopify', 'info'], cta: 'Turn on the journey',
      title: `${n0(left)} checkouts left last month, ${big(left * aov)} in carts`, sub: `${n0(started)} people started checkout and ${n0(orders)} finished. Today one reminder email goes out; three steps across email and WhatsApp, starting an hour after they leave, bring back more of them.`,
      rows: [['Checkouts started', n0(started)], ['Finished', n0(orders)], ['Left', n0(left)], ['Value left', big(left * aov)]], detail: { why: [`${pct(100 * left / started)} of checkouts are never finished.`, `The average order is ${money(aov)}.`], how: ['Send a reminder after one hour', 'Send the product and its reviews after a day', 'Stop the moment they buy'] } }),
    card('repeat', 'shopify', { agent: 'crm', sector: 'signals', type: 'idea', roles: ['crm', 'founder'], badge: [pct(repeat), 'warn'], cta: 'Approve the flows',
      title: `Only ${pct(repeat)} buy from ${name} again within 90 days`, sub: `Most of last month’s ${n0(orders)} orders came from people buying for the first time. A second-order flow timed to when the first one wears in turns some of them into regulars.`,
      rows: [['New customers', pct(newShare)], ['Second order in 90 days', pct(repeat)], ['Top first buy', top[0]?.title || '—'], ['Average order', money(aov)]], detail: { why: ['A second order costs no ad spend.', `${top[0]?.title || 'The best seller'} is the most common first buy.`], how: ['Pick the day the flow starts', 'Write the three messages', 'Leave out anyone with an open return'] } }),
    card('mobile', 'shopify', { agent: 'storefront', sector: 'storefront', type: 'report', roles: ['ecom', 'founder', 'growth'], badge: ['Mobile', 'warn'], cta: 'Start the tests',
      title: `Phones bring ${pct(mob)} of visits but convert at ${pct(mobCr, 1)}`, sub: `Desktop converts at ${pct(deskCr, 1)}. Closing half that gap on phones is worth more than any new campaign, so the first test is the mobile product page.`,
      rows: [['Mobile visits', pct(mob)], ['Mobile conversion', pct(mobCr, 1)], ['Desktop conversion', pct(deskCr, 1)], ['Sessions, 30 days', n0(sessions)]], detail: { why: ['Most visits are on phones.', 'The gap shows up before add to cart.'], how: ['Move price, size and reviews above the fold', 'Test it on half the visitors for 14 days', 'Keep the winner'] } }),
    ...(india ? [card('cod', 'shopify', { agent: 'storefront', sector: 'storefront', type: 'decision', roles: ['ecom', 'founder'], badge: [`RTO ${pct(rto)}`, 'warn'], cta: 'Agree with the call',
      title: `${pct(rto)} of cash-on-delivery orders come back unpaid`, sub: `Cash on delivery is ${pct(cod)} of orders. A small prepaid discount and a WhatsApp confirm before dispatch cut the returns without losing the buyers who need COD.`,
      rows: [['COD share of orders', pct(cod)], ['Returned unpaid (RTO)', pct(rto)], ['Orders lost a month', n0(orders * cod / 100 * rto / 100)], ['Average order', money(aov)]], detail: { why: ['Every RTO costs shipping both ways.', 'Most RTO orders never confirm.'], how: ['Ask for a WhatsApp confirm on COD', 'Offer a small prepaid discount', 'Read RTO again in 30 days'] } })] : []),
    card('freq', 'meta', { agent: 'performance', sector: 'ads', type: 'decision', roles: ['growth', 'founder', 'brand'], badge: [`Frequency ${rt.freq.toFixed(1)}`, 'warn'], cta: 'Rotate creative',
      title: `Retargeting is showing the same ads ${rt.freq.toFixed(1)} times a week`, sub: `${n0(meta.tired)} of the ${n0(live)} live ads are tired: same people, falling clicks. Swap in fresh versions of the best ones before cost per order climbs further.`,
      rows: [['Campaign', rt.name], ['Frequency, 7 days', rt.freq.toFixed(1)], ['Spend a day', sp(rt.spend)], ['Tired ads', n0(meta.tired)]], detail: { why: ['Above 3.5 a week, clicks fall and cost rises.', 'Fresh versions of winners reset it fastest.'], how: ['Pick the 3 best ads by cost per order', 'Make 2 new versions of each', 'Pause the tired ones as the new ones go live'] } }),
    card('shift', 'meta', { agent: 'performance', sector: 'ads', type: 'decision', roles: ['growth', 'founder'], badge: [`${best.roas.toFixed(1)}x`, 'ok'], cta: 'Shift budget',
      title: `Move ${sp(worst.spend * 0.2)} a day to ${best.name.split(' | ')[0]}`, sub: `${best.name} returns ${best.roas.toFixed(1)}x and ${worst.name} ${worst.roas.toFixed(1)}x. Moving a fifth of the weaker budget, in one step, keeps learning intact.`,
      rows: [['From', `${worst.name} · ${worst.roas.toFixed(1)}x`], ['To', `${best.name} · ${best.roas.toFixed(1)}x`], ['Move a day', sp(worst.spend * 0.2)], ['Cost per first order', money(round(cpa, india ? 10 : 1))]], detail: { why: [`The catalog campaign earns more per ${india ? 'rupee' : 'dollar'}.`, 'One step of 20% keeps the learning phase.'], how: ['Move the budget tomorrow at 7 am', 'Read it after 7 days', 'Move it back if cost per order rises 15%'] } }),
    card('brand', 'google', { agent: 'performance', sector: 'ads', type: 'idea', roles: ['growth', 'founder', 'ecom'], badge: [pct(branded), 'info'], cta: 'Launch the ad group',
      title: `${pct(branded)} of your search clicks are people typing ${name}`, sub: `Searches like ${terms[0] ? `“${terms[0]}”` : 'your category'} bring few clicks, so new buyers who don’t know ${name} yet rarely find you. One category ad group tests it on a small budget.`,
      rows: [['Searches for your name', pct(branded)], ['Category searches', pct(100 - branded)], ['Search spend, 30 days', big(gspend)], ['Term to test', terms[0] || 'your category']], detail: { why: ['Branded clicks would mostly come anyway.', 'Category searches are where new buyers start.'], how: [`Start with ${terms.slice(0, 3).map((t) => `“${t}”`).join(', ') || 'three category terms'}`, 'Send them to the best-selling product page', 'Read cost per first order after 14 days'] } }),
    card('funnel', 'ga4', { agent: 'storefront', sector: 'storefront', type: 'report', roles: ['ecom', 'growth'], badge: ['GA4', 'info'], cta: 'Start the tests',
      title: `${pct(100 - atc / google.pdp * 100)} of product-page visitors never add to cart`, sub: `GA4 shows ${pct(google.pdp)} of sessions reach a product page and ${pct(atc, 1)} add to cart. The product page is the biggest leak, ahead of checkout.`,
      rows: [['Reach a product page', pct(google.pdp)], ['Add to cart', pct(atc, 1)], ['Start checkout', pct(google.checkout, 1)], ['Buy', pct(cr, 1)]], detail: { why: ['The drop is largest at the product page.', 'Fixes there help every channel at once.'], how: ['Test the first screen of the product page', 'Add size and delivery date near the button', 'Read it after 14 days'] } }),
    card('listings', 'marketplaces', { agent: 'storefront', sector: 'catalog', type: 'decision', roles: ['ecom', 'founder'], badge: [`${n0(thinListings)} thin`, 'warn'], cta: 'Push the titles',
      title: `${n0(thinListings)} of your ${n0(listings)} marketplace listings have one or two photos`, sub: `Listings on ${mkts.join(' and ')} with fewer photos rank lower and convert less. The photos already exist on ${p.host}, so this is a push, not a shoot.`,
      rows: [['Live listings', n0(listings)], ['With 1 or 2 photos', n0(thinListings)], ['Share of orders', pct(marketplaces.share)], ['Where', mkts.join(', ')]], detail: { why: ['Photos are the first thing shoppers compare.', 'Your site already has the angles.'], how: ['Push the site photos to each listing', 'Rewrite the titles with the search terms', 'Read rank again in 14 days'] } }),
    card('reply', 'reviews', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm', 'brand', 'founder'], badge: [`${n0(reviewsA.unanswered)} waiting`, 'warn'], cta: 'Send the review ask',
      title: `${n0(reviewsA.unanswered)} low-star reviews have no reply yet`, sub: `Shoppers read the bad reviews first, and a calm reply that fixes the problem reads better than silence. Replies are drafted for you; nothing posts without your OK.`,
      rows: [['Average rating', `${rating} of 5`], ['1 and 2 star, no reply', n0(reviewsA.unanswered)], ['Reviews a month', n0(reviewsA.month)], ['With a photo', pct(reviewsA.photo)]], detail: { why: ['Unanswered low stars sit at the top of filters.', 'Most are about size, delivery or returns.'], how: ['Draft a reply for each', 'You approve them in one go', 'Ask happy buyers for a photo review'] } }),
    card('optins', 'whatsapp', { agent: 'crm', sector: 'signals', type: 'idea', roles: ['crm', 'founder'], badge: [n0(optins), 'info'], cta: 'Turn on the journey',
      title: `${n0(optins)} people opted in to WhatsApp and got nothing this month`, sub: `They asked to hear from ${name}. One message on a launch or a restock, to the people who bought that line before, is the cheapest order you can get.`,
      rows: [['Opted in', n0(optins)], ['Messages this month', '0'], ['Approved templates', n0(whatsapp.templates)], ['Read rate, last send', pct(whatsapp.read)]], detail: { why: ['WhatsApp messages are read within minutes.', 'Opt-ins go cold after 90 days.'], how: ['Pick the next launch or restock', 'Send it to past buyers of that line', 'Read orders after 48 hours'] } }),
    card('flows', 'klaviyo', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm'], badge: ['2 of 5 live', 'warn'], cta: 'Approve the flows',
      title: 'Browse, post-purchase and win-back emails are off', sub: `Klaviyo runs welcome and abandoned-checkout for ${n0(klaviyo.list)} people. The three flows that bring second orders are not built yet; they are drafted and wait for your OK.`,
      rows: klaviyo.flows.map(([f, on]) => [f, on ? 'Live' : 'Off']), detail: { why: ['Post-purchase and win-back drive second orders.', 'They run on their own once live.'], how: ['Read the three drafts', 'Approve them', 'Read revenue from email after 30 days'] } })
  ];
  // what each account changes, in this brand's numbers (the connect sheet and the connectors page)
  const changed = {
    shopify: [`Cards read your ${n0(orders)} orders a month and the ${n0(left)} checkouts left`, `Second orders: ${pct(repeat)} in 90 days, with a flow to lift it`, india ? `Cash on delivery: ${pct(cod)} of orders, ${pct(rto)} returned` : `Phones: ${pct(mob)} of visits at ${pct(mobCr, 1)} conversion`],
    meta: [`Ad cards show live cost per first order (${money(round(cpa, india ? 10 : 1))})`, `${n0(meta.tired)} tired ads flagged for fresh versions`, `Budget moves between your ${camp.length} campaigns`],
    google: [`${pct(branded)} of search clicks are your own name`, 'Search ads tested on the category terms the read found'],
    ga4: [`Cards read your ${n0(sessions)} sessions from GA4`, `The product-page leak: ${pct(100 - atc / google.pdp * 100)} never add to cart`],
    marketplaces: [`${n0(listings)} listings on ${mkts.join(', ')} read`, `${n0(thinListings)} thin listings get your site photos`],
    reviews: [`${n0(reviewsA.unanswered)} low-star reviews get drafted replies`, 'Review asks timed to delivery'],
    whatsapp: [`${n0(optins)} opt-ins get launch and restock messages`, 'Replies come back into the feed'],
    klaviyo: ['Three missing flows drafted for your OK', `${n0(klaviyo.list)} people on the list`]
  };
  // the same numbers as evidence for the moves (refresh.js reads these keys), labelled as demo data
  const L = (key, label, v, n) => ({ key, label: `${label} (demo account)`, v: String(v), ...(n != null ? { n: +(+n).toFixed(2) } : {}), layer: 'observed', src: 'Demo account in Brew', method: 'demo connector', demo: true });
  const ledger = {
    shopify: [L('shopify.orders.30d', 'Orders, last 30 days', n0(orders), orders), L('shopify.aov', 'Average order value', money(aov), aov), L('shopify.conversion', 'Store conversion rate', pct(cr, 1), cr), L('shopify.repeat.90d', 'Second order within 90 days', pct(repeat), repeat), L('shopify.checkout.left', 'Checkouts started but not finished, 30 days', n0(left), left), ...(india ? [L('shopify.cod.share', 'Cash on delivery share of orders', pct(cod), cod), L('shopify.rto', 'COD orders returned unpaid', pct(rto), rto)] : [])],
    meta: [L('meta.spend.30d', 'Meta spend, last 30 days', big(spend), spend), L('meta.roas', 'Meta return on ad spend', `${roas.toFixed(1)}x`, roas), L('meta.cpa.first', 'Meta cost per first order', money(round(cpa)), cpa), L('meta.retargeting.frequency', 'Retargeting frequency, 7 days', rt.freq.toFixed(1), rt.freq)],
    ga4: [L('ga4.sessions.30d', 'Sessions, last 30 days', n0(sessions), sessions), L('ga4.mobile.share', 'Mobile share of sessions', pct(mob), mob), L('ga4.pdp.to.cart', 'Product page to add-to-cart', pct(atc / google.pdp * 100), atc / google.pdp * 100)],
    google: [L('gads.branded.share', 'Branded share of search clicks', pct(branded), branded)],
    klaviyo: [L('klaviyo.list', 'Email list size', n0(klaviyo.list), klaviyo.list), L('klaviyo.flows.live', 'Email flows live', '2 of 5', 2)]
  };
  return { v: DEMO_V, accounts: A, cards, changed, ledger, at: new Date().toISOString().slice(0, 10) };
}
const CONN_NAME = { shopify: 'Shopify', meta: 'Meta Ads', google: 'Google Ads', ga4: 'Google Analytics', marketplaces: 'Marketplaces', reviews: 'Reviews', whatsapp: 'WhatsApp', klaviyo: 'Klaviyo' };

/* the seed a viewer gets: connectors carry the demo numbers, and the demo cards wait for their account. The modelled
   numbers are never shown as if read from the store: `changed` keeps the seed's number-free lines (what connecting
   unlocks), and the demo's numbered lines sit in `changedDemo`, each marked as an estimate, for a demo account only. */
const estimate = (line) => /\d/.test(line) ? `${line} (estimate)` : line;
// the seed a viewer gets: connectors carry the demo numbers, and the demo cards wait for their account
export function withDemo(seed, demo) {
  if (!demo || !seed?.connectors) return seed;
  const conn = Object.fromEntries(Object.entries(seed.connectors).map(([k, c]) => [k, demo.accounts[k] ? { ...c, stats: demo.accounts[k].stats, changed: c.changed, changedDemo: (demo.changed[k] || []).map(estimate), demo: true } : c]));
  const have = new Set((seed.posts || []).map((x) => x.id));
  const marketLogos = seed.marketLogos || (demo.accounts.marketplaces?.mkts || []).map((m) => m.toLowerCase());
  return { ...seed, connectors: conn, marketLogos, posts: [...(seed.posts || []), ...demo.cards.filter((x) => !have.has(x.id))] };
}
