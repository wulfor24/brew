// Endless inspiration: a stream of ready-to-post social ideas for one brand, every one backed by its moves and data.
// Per idea: platform-native hook + copy + CTA + hashtags, a media plan (image, carousel slides, 5-beat video script) with
// generation prompts that keep the real product as in its photos, and where to post it: real communities and threads only
// (found live on Reddit through treg, or read from listen/*.json), never invented, and only places that pass community-gate.js:
// a reply's thread was active in the last two weeks, sits in the brand's market, is open and has Reddit's own reply count;
// a Quora answer goes to a real question page; a reply has to be about what its thread asked.
// Flow: read the pack → discover threads (treg, same-day cache) → slate (opus) → per-idea thread search (treg) → write (opus,
// in parallel chunks) → gates (numbers, links, disclosure) → check (sonnet) → ideas. next() stores to ideas/ideas.json.
import { loadView as bookView, promptBlock as bookBlock } from './jam2/brandbook.js'; // ideas follow the Brand Book's voice
import { marketLine } from './market.js';
import { promptBlock as creativeBlock } from './creative-catalog.js'; // what can be made, for ideas that make something
import crypto from 'node:crypto';
import { numbersIn, canon } from './fact-gate.js';
import { claimFlags, checkCopy, sourceText } from './claims.js'; // an idea's post carries only the brand's own claims
import { ideaCards, ideaUsable, rivalCards, categoryCards } from './social-feed.js';
import { usableThread, redditStats, withStats, repliesText, isQuoraQuestion, inMarket, matchesThread, REPLY_DAYS, usableCommunity, topicStems, typeaheadCommunities } from './community-gate.js'; // which threads and questions any brand may be pointed at
import { moveLabel, moveNum, moveSay } from './move-label.js'; // weekly moves read "Weekly move 11", never "Move 1011" (QA FEED-QA-12)

/* ---------- platforms ---------- */
export const PLATFORMS = {
  instagram: { label: 'Instagram', formats: ['reel', 'carousel', 'single image'], agent: 'creative', sector: 'creatives', social: 'instagram' },
  youtube: { label: 'YouTube Shorts', formats: ['short video'], agent: 'creative', sector: 'creatives', social: 'youtube' },
  tiktok: { label: 'TikTok', formats: ['short video'], agent: 'creative', sector: 'creatives', social: 'tiktok' },
  reddit: { label: 'Reddit', formats: ['reply', 'post'], agent: 'visibility', sector: 'visibility', community: true },
  x: { label: 'X', formats: ['thread', 'post'], agent: 'creative', sector: 'creatives', social: 'x' },
  linkedin: { label: 'LinkedIn', formats: ['founder post', 'brand post'], agent: 'creative', sector: 'creatives', social: 'linkedin' },
  pinterest: { label: 'Pinterest', formats: ['pin'], agent: 'creative', sector: 'creatives', social: 'pinterest' },
  quora: { label: 'Quora', formats: ['answer'], agent: 'visibility', sector: 'visibility', community: true },
  facebook: { label: 'Facebook', formats: ['group post'], agent: 'crm', sector: 'signals', community: true }
};
const NATIVE = {
  instagram: 'Caption 40-150 words, first line is the hook (it shows before "more"), line breaks, 0-3 emojis, 5-10 hashtags in hashtags[] (not in copy). Reel: media.kind video with a 5-beat script (hook in the first 1.5 s, on-screen text in line). Carousel: media.kind carousel, 5-8 slides, slide 1 is the hook, last slide the CTA, each slide 6-18 words. Single image: media.kind image.',
  youtube: 'Shorts: copy = title (under 60 chars) + blank line + description (2-4 lines). media.kind video, 5-beat script for 20-40 s, hook spoken in the first 2 s. 3-5 hashtags.',
  tiktok: 'Native TikTok: talky, first-person, trend-aware, copy = caption under 150 chars. media.kind video, 5-beat script. 3-5 hashtags.',
  reddit: 'Write like a real person in that subreddit, not a brand: no marketing words, no emojis, no hashtags (hashtags = []), no links in the copy. Post: copy starts with "Title: ..." on its own line, then the body. Reply: answer the OP\'s actual question first, be fair about rivals and about what the brand is not good at, keep it 60-180 words. Always end with a plain disclosure line (e.g. "Disclosure: I work at <brand>."). media.kind none unless a real photo helps; never AI images on Reddit.',
  x: 'Thread: 4-7 posts, each under 270 chars, separated by a blank line and numbered "1/" etc. Post: one under 270 chars. 0-2 hashtags. Plain, punchy, no corporate tone.',
  linkedin: 'Founder post in first person from a named co-founder (only facts on record about them): 120-250 words, short lines, one story with a lesson, ends with a question. 0-3 hashtags. No links in the body (say "link in comments").',
  pinterest: 'Pin title under 100 chars, description 150-400 chars, keyword-rich and search-led (what people type on Pinterest), CTA to the product page. media.kind image (2:3 vertical). 3-6 hashtags.',
  quora: 'Answer 150-320 words to a real buyer question, lead with the direct answer, give honest comparisons, state the affiliation in the first or last line. No hashtags, no links.',
  facebook: 'Group post: warm, community tone, asks or gives something useful (a fit tip, a question to the group), 60-160 words, disclosure line, no link in the post. No hashtags.'
};
// fallbacks when the writer leaves measure or timing empty: [metric, how, postAt]
const DEF = {
  instagram: ['Saves and shares per 1,000 reach', 'Instagram Insights for the post after 7 days, against the account average', 'Weekday 7-9 PM local'],
  youtube: ['Average percentage viewed', 'YouTube Studio after 7 days: viewed vs swiped away and average view duration', 'Friday 6-8 PM local'],
  tiktok: ['Average watch time and shares', 'TikTok analytics after 7 days', 'Weekday 7-10 PM local'],
  reddit: ['Upvotes, replies and no mod removal', 'Check the thread after 24 hours and 7 days', 'Weekday 8-10 PM local'],
  x: ['Replies and link clicks', 'X analytics after 3 days', 'Weekday 12-2 PM local'],
  linkedin: ['Comments per 1,000 impressions', 'LinkedIn post analytics after 7 days', 'Tuesday-Thursday 8-10 AM local'],
  pinterest: ['Saves and outbound clicks', 'Pinterest analytics after 30 days', 'Weekend evening local'],
  quora: ['Answer views and upvotes', 'Quora answer stats after 30 days', 'Weekday evening local'],
  facebook: ['Comments with real answers', 'Group post after 3 days', 'Sunday 11 AM local']
};
const NO_TIKTOK = ['IN']; /* TikTok is banned in India since 2020 */
const B2B = /\b(software|saas|b2b|agency|consult|industrial|wholesale|logistics|api|enterprise|manufactur|packaging|machin|chemical)\w*/i;
const VISUAL = /\b(fashion|footwear|sneaker|shoe|apparel|cloth|wear|jewel|beauty|skin|cosmetic|home|decor|furniture|food|bak|recipe|wedding|garden|art|craft|kitchen|interior)\w*/i;
const OLDER = /\b(health|wellness|pharma|supplement|ayurved|parent|baby|kid|pet|home|kitchen|garden|insurance|finance|senior)\w*/i;

/* ---------- small helpers ---------- */
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const squashN = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set('the and for with you your are this that from have what which best any just like does good get its not but how who why was were will can our out all has had than too very more most into over about they them their there then here when where some been also only want looks look'.split(' '));
const dateOf = (utc) => utc ? new Date(utc * 1000).toISOString().slice(0, 10) : '';
const URLRE = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|in|co|shop|store|io)\/\S*/gi;
/* digit runs as written ("5,899" → "5899"), for the no-invented-numbers gate */
const digitsIn = (s) => (String(s || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, '').replace(/\.0+$/, ''));

/* member: the team's stream (private/ideas/), whose evidence also holds the connected accounts' facts (private/facts.json, real
   accounts only); the public stream (ideas/) never reads them */
export function createIdeas({ slug, packs, ai, treg, log = console, now = () => Date.now(), member = false }) {
  const DIR = member ? 'private/ideas/' : 'ideas/';
  const T = () => (typeof now === 'function' ? now() : +now || Date.now());
  const today = () => new Date(T()).toISOString().slice(0, 10);
  let ctx = null;
  const spend = { ai: 0, treg: 0 };
  const callAI = async (o) => { const r = await ai.call(o); spend.ai += r.usd || 0; return r; };
  const tregOn = () => !!treg && treg.live !== false;
  const callTreg = async (id, query, extra = {}) => { const u0 = treg.meter?.usd || 0; try { return await treg.call(id, { ...(query ? { query } : {}), ...extra, tag: 'ideas:' + id }); } finally { spend.treg += (treg.meter?.usd || 0) - u0; } };

  /* ---------- read the pack ---------- */
  async function load(fresh = false) {
    if (ctx && !fresh) return ctx;
    const g = (n, d = null) => packs.getJSON(slug, n, d).catch(() => d);
    const [profile, facts, config, seed, moves, ledger, brief, lThreads, lThemes, lComms, lItems, lCfg, research, pulse] = await Promise.all([
      g('profile.json', {}), g('facts.json', {}), g('config.json', {}), g('seed.json', {}), g('moves.json', {}), g('ledger.json', []), g('brief.json', {}),
      g('listen/threads.json'), g('listen/themes.json'), g('listen/communities.json'), g('listen/items.json'), g('listen/config.json'), g('research.json'), g('pulse/latest.json')]);
    const name = profile.name || seed.brand?.name || config.name || slug;
    const sym = config.symbol || '';
    const cat = [profile.category, profile.subcategory, config.category].filter(Boolean).join(', ');
    const noun = (String(profile.subcategory || profile.category || 'products').toLowerCase().match(/[a-z]+$/) || ['products'])[0];
    // evidence pool: every claim an idea makes must point at one of these (quoted exactly as stored)
    const ev = []; const seenEv = new Set();
    const add = (label, value, source, kind) => { value = cut(value, 320); if (!value || seenEv.has(label + value)) return; seenEv.add(label + value); ev.push({ id: 'E' + (ev.length + 1), label: cut(label, 120), value, source: source || '', kind }); };
    if (profile.about) add('About the brand (own site)', profile.about, profile.aboutUrl || profile.url, 'doc');
    if (profile.host) add('Website', profile.host, profile.url, 'doc');
    for (const f of Object.values(facts)) if (f.kind !== 'price' && f.kind !== 'demo' && f.label && !/font|logo|sitemap|platform|currency|shop country|tech on the site|checkout|pages listed/i.test(f.label)) add(f.label, f.v, f.url || f.src, 'fact');
    const acct = member ? Object.values((await g('private/facts.json', null))?.facts || {}).filter((f) => f?.kind === 'connected' && f.label && f.v != null) : [];
    for (const f of acct) add(`${f.label} (${f.src || 'connected account'})`, f.v, '', 'account');
    for (const r of (profile.reviews?.recent || profile.reviews?.quotes || [])) if ((r.text || '').length >= 12) add(`Review, ${r.product || name} (${r.src || 'review'}${r.verified ? ', verified' : ''}, ${r.rating || '?'}★, ${r.at || ''})`, r.text, r.url, 'review');
    for (const q of (brief.quotes || [])) add(`Review quote (${q.src})`, q.text, '', 'review');
    for (const c of (brief.claims || [])) add(`Brand claim: ${c.product} (${c.basis})`, c.claim, '', 'claim');
    const ig = profile.socials?.instagram;
    for (const p of (ig?.posts || []).slice(0, 12)) add(`Instagram @${ig.handle} ${p.kind}, ${p.at}, ${(p.likes || 0).toLocaleString('en-IN')} likes`, p.caption, p.url, 'social');
    // what moves around the brand this week (research.js, market-pulse.js): trends, rising searches, industry and rival news,
    // rivals' long-running ads, and the market pulse. Timely angles for the writer; every one is a cited fact like the rest
    const stamp = (ms) => { const t = typeof ms === 'number' ? ms : Date.parse(ms || ''); return t > 0 ? new Date(t).toISOString().slice(0, 10) : ''; };
    const ownName = squashN(profile.name || seed.brand?.name || '');
    for (const t of (research?.trends?.items || []).slice(0, 6)) if (t?.h) add(`Trend (${t.kind || 'search'}, read ${stamp(t.firstSeen || research.trends.fetchedAt)})`, [t.h, t.p].filter(Boolean).join(': '), '', 'trend');
    const geo = profile.country || config.country || '';
    const catWords = new Set(`${profile.category || ''} ${profile.subcategory || ''} ${(lCfg?.terms?.category || []).join(' ')}`.toLowerCase().match(/[a-z]{4,}/g) || []);
    for (const [term, qs] of Object.entries(research?.trends?.rising || {})) { const on = (qs || []).filter((x) => x?.q && String(x.q).toLowerCase().split(/\s+/).some((w) => catWords.has(w) || catWords.has(w.replace(/s$/, '')) || squashN(x.q).includes(ownName))).slice(0, 5); /* rising queries that share a word with the category: Google's rising list carries noise */
      if (on.length) add(`Rising Google searches around "${term}"${geo ? ` (${geo})` : ''}, last 90 days`, on.map((x) => `${x.q}${x.v ? ` (+${x.v}%)` : ''}`).join(', '), `https://trends.google.com/trends/explore?${geo ? `geo=${geo}&` : ''}q=${encodeURIComponent(term)}`, 'trend'); }
    for (const n of [...(research?.news?.items || [])].sort((a, b) => (Date.parse(b.date || '') || b.firstSeen || 0) - (Date.parse(a.date || '') || a.firstSeen || 0)).slice(0, 6)) if (n?.h) add(`News, ${n.source || n.domain || 'web'}${n.date ? `, ${stamp(n.date)}` : ''}`, [n.h, n.p].filter(Boolean).join('. '), n.url || '', 'news');
    const rivalAds = (research?.ads?.items || []).filter((a) => a?.brand && squashN(a.brand) !== ownName && (a.headline || a.body || a.hook)).sort((a, b) => (+b.days || 0) - (+a.days || 0)).slice(0, 6); /* the longest-running first: an ad that keeps running is one that works */
    for (const a of rivalAds) add(`Rival ad: ${a.brand}, live ${a.days || '?'} days${a.versions ? `, ${a.versions} versions` : ''} (Meta Ad Library)`, [a.headline || a.hook, cut(a.body, 160)].filter(Boolean).join(' · '), a.url || '', 'rival-ad');
    const pl = (Array.isArray(pulse?.lines) ? pulse.lines : Object.values(pulse?.lines || {})).filter((x) => x?.label && x.value != null && x.value !== '' && ['seasonal', 'rival-weakness', 'price-offer', 'social-posts', 'weather', 'research'].includes(x.family) && !(x.value === 0 && x.family !== 'seasonal'));
    const PRI = { seasonal: 0, 'rival-weakness': 1, 'price-offer': 2, weather: 3, 'social-posts': 4, research: 5 }; /* what changed first, standing counts last */
    for (const x of pl.sort((a, b) => (PRI[a.family] ?? 9) - (PRI[b.family] ?? 9)).slice(0, 12)) add(`Market pulse: ${x.label} (${x.source || x.family}, ${stamp(x.at)})`, `${typeof x.value === 'number' ? x.value.toLocaleString('en-IN') : x.value}${x.unit && x.unit !== 'count' ? ` ${x.unit}` : ''}`, x.url || '', 'pulse');
    for (const a of (profile.ads?.own?.items || []).slice(0, 6)) add(`Own Meta ad live since ${a.since} (${a.format})`, [a.hook, a.body].filter(Boolean).join(' · '), a.url, 'ad');
    // listen-watch.js output: themes with counts and their quoted posts (exact text, with links)
    const themes = (Array.isArray(lThemes) ? lThemes : lThemes?.themes || []).slice(0, 12);
    const itemsL = Array.isArray(lItems) ? lItems : lItems?.items || [];
    const itemBy = new Map(itemsL.map((x) => [x.id, x]));
    const when = (x) => { const t = x.postedAt || x.lastActive || x.at; return t ? new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10) : ''; };
    for (const t of themes) {
      add(`Listen theme "${t.name || t.theme}" (${t.n != null ? `${t.n} mentions${t.pos != null ? `: ${t.pos} positive, ${t.neg} negative` : ''}` : 'mentions'})`, t.quote || t.summary || t.name, t.quoteLink || t.url, 'listen');
      for (const id of (t.quoteIds || []).slice(0, 2)) { const x = itemBy.get(id); if (x) add(`${x.platform === 'reddit' ? 'Reddit' : x.platform || 'Post'} ${x.kind || ''}${(x.link || '').match(/\/r\/[^/]+/)?.[0] ? ' in ' + (x.link || '').match(/\/r\/([^/]+)/)[0].slice(1) : ''}, ${when(x)} (theme: ${t.name})`, [x.title, x.text].filter(Boolean).join(' · '), x.link || x.url, 'listen'); }
    }
    // what people dislike about the rivals and what the category keeps asking (the same counts as the feed's rival and category cards)
    { const LL = { items: itemsL, config: { rivals: lCfg?.rivals || config.rivals || [], noun: lCfg?.noun || noun } };
      for (const r of rivalCards(LL, { profile, max: 3 })) add(`Listen: what people dislike about ${r.heard.name} (${r.heard.neg} of ${r.heard.n} mentions negative, last 90 days; complaints: ${r.heard.themes.join(', ')})`, r.heard.quotes.map((q) => `“${q.text}”`).join(' · ') || r.sub, r.heard.quotes[0]?.url || '', 'listen');
      for (const k of categoryCards(LL, { profile, max: 2 })) add(`Listen: ${k.heard.n} category posts about ${k.heard.name} (${k.heard.questions} questions, ${k.heard.complaints} complaints, last 90 days)`, k.heard.quotes.map((q) => `“${q.text}”`).join(' · '), k.heard.quotes[0]?.url || '', 'listen'); }
    if (!themes.length) for (const l of itemsL.slice(0, 30)) add(`Listen: ${l.platform || l.kind || 'mention'}${when(l) ? ', ' + when(l) : ''}`, l.quote || l.text || l.title, l.link || l.url, 'listen');
    // products: heroes, the brief's catalogue, then the newest in stock (real photos for the media prompts)
    const all = profile.catalog?.products || [];
    const byTitle = new Map(all.map((p) => [norm(p.title), p]));
    const pick = []; const pushP = (p) => p && !pick.includes(p) && pick.push(p);
    (profile.catalog?.hero || []).forEach((h) => pushP(all.find((p) => p.handle === h)));
    (brief.catalogue || []).forEach((c) => pushP(byTitle.get(norm(c.name))));
    /* in stock (or not known, off Shopify), newest first where the platform dates them */
    all.filter((p) => p.inStock !== false).sort((a, b) => String(b.published || '').localeCompare(String(a.published || ''))).slice(0, 10).forEach(pushP);
    const products = pick.slice(0, 24).map((p) => ({ handle: p.handle, title: p.title, type: p.type, price: p.price, priceText: p.priceText || null, inStock: p.inStock, url: p.url, images: (p.images || []).slice(0, 3), claim: (p.claims || [])[0] || '' }));
    for (const p of products) { if (+p.price > 0) add(`${p.title} price (product page)`, p.priceText || `${sym || ''}${Number(p.price).toLocaleString('en-IN')}`, p.url, 'price'); /* no price read: never ₹0 */ if (p.claim) add(`${p.title} product page claim`, p.claim, p.url, 'claim'); }
    // moves digest: title, what it gives, key takeaways
    const cardsOf = {}; for (const c of (seed.posts || [])) { const m = /^Move (\d+)/.exec(c.src || ''); if (m) (cardsOf[m[1]] ||= []).push(c.id); }
    const movesD = Object.values(moves).filter((m) => m && m.n > 0).sort((a, b) => a.n - b.n).map((m) => {
      const take = []; for (const s of m.sections || []) { let on = false; for (const b of s.blocks || []) { if (b.t === 'h3') on = /takeaway/i.test(b.text || ''); else if (on && b.t === 'list') take.push(...(b.items || [])); } }
      return { ref: moveLabel(m.n), n: m.n, title: m.title, skill: m.skill, gives: cut(m.gives, 220), take: take.slice(0, 3).map((x) => cut(String(x).replace(/\*\*/g, ''), 220)), cards: cardsOf[m.n] || [] };
    });
    const socials = Object.entries(profile.socials || {}).filter(([, v]) => v?.url).map(([k, v]) => ({ platform: k, url: v.url, handle: v.handle || v.url.replace(/\/$/, '').split('/').pop() }));
    const founders = (profile.company?.founders || []).map((f) => f.name), founderRoles = Object.fromEntries((profile.company?.founders || []).filter((f) => f?.name).map((f) => [f.name, f.role || f.title || 'Co-founder']));
    const listen = {
      threads: (Array.isArray(lThreads) ? lThreads : lThreads?.threads || []).map(normThread).filter(Boolean),
      communities: (Array.isArray(lComms) ? lComms : lComms?.communities || []).filter((c) => c?.url).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 30).map((c) => ({ name: c.name || (c.subreddit ? 'r/' + c.subreddit : c.url), url: c.url, platform: c.platform || (c.subreddit ? 'reddit' : ''), sub: c.subreddit || (c.url.match(/\/r\/([^/]+)/) || [])[1] || '', rules: typeof c.rules === 'string' ? c.rules : Array.isArray(c.rules) ? c.rules.map((r) => r.text || r.name || r).join('\n') : '', weekly: c.weekly || null, why: c.why || '', themes: c.themes || [], brand: c.brand || 0, rival: c.rival || 0, category: c.category || 0, threads: c.threads || 0 })),
      /* the words a community about this category carries in its name (community-gate.js topicStems), from listening's category searches */
      stems: topicStems({ noun, terms: [...(lCfg?.terms?.category || []), ...(lCfg?.terms?.problems || []).slice(0, 2), String(profile.subcategory || ''), String(profile.category || '')] }),
      categoryQs: (lCfg?.terms?.category || []).map((q) => String(q).replace(/["']/g, '')).slice(0, 2)
    };
    // real Quora questions listening's web search found (a question page, never a profile, space or search)
    listen.quora = itemsL.filter((x) => isQuoraQuestion(x.link || x.url)).map((x) => ({ url: x.link || x.url, title: cut(x.title || x.text, 200), platform: 'quora' }));
    const lanes = Object.keys(seed.lanes || {});
    const bookWords = bookBlock(await bookView(packs, slug, { scope: member ? 'member' : 'share' }).catch(() => ({})), { kind: 'post' });
    ctx = { bookWords, member, accountFacts: acct.length, profile, facts, config, seed, brief, ledger, name, sym, cat, noun, ev, products, movesD, socials, founders, founderRoles, listen, lanes, country: profile.country || config.country || '', countryName: config.countryName || profile.country || '' };
    // the allowed numbers: anything that appears in the evidence, facts, ledger, product titles or the threads we hand the writer
    ctx.allowNums = new Set(); ctx.allowMoney = new Set();
    const feed = ctx.feed = (s) => { digitsIn(s).forEach((d) => ctx.allowNums.add(d)); numbersIn(s).forEach((n) => ctx.allowMoney.add(n)); };
    ev.forEach((e) => { feed(e.value); feed(e.label); });
    Object.values(facts).forEach((f) => { feed(f.v); (f.aliases || []).forEach(feed); });
    (Array.isArray(ledger) ? ledger : []).forEach((l) => feed(l.v));
    all.forEach((p) => feed(p.title));
    return ctx;
  }
  function normThread(t) {
    if (!t) return null;
    const url = t.url && /^https?:/.test(t.url) ? t.url : t.permalink ? 'https://www.reddit.com' + t.permalink : null; if (!url) return null;
    const sub = t.subreddit || (url.match(/\/r\/([^/]+)/) || [])[1] || '';
    const ms = t.lastActive || t.postedAt; const at = t.created_at_iso?.slice(0, 10) || (ms ? new Date(ms).toISOString().slice(0, 10) : '') || t.at || dateOf(t.created_utc);
    return { id: t.id || sha(url).slice(0, 8), platform: t.platform || (sub ? 'reddit' : 'web'), sub, title: cut(t.title, 200), text: cut(t.selftext || t.text || t.body || (t.quote !== t.title ? t.quote : '') || '', 400), url, comments: t.num_comments ?? t.comments ?? t.replies ?? null, ...(t.repliesFloor || t.commentsFloor ? { commentsFloor: true } : {}), at, ...(ms ? { lastActive: ms } : {}), ...(t.locked ? { locked: true } : {}), ...(t.archived ? { archived: true } : {}), ...(t.intent ? { intent: t.intent } : {}), ...(t.sentiment ? { sentiment: t.sentiment } : {}) };
  }

  /* ---------- live discovery: real Reddit threads + subreddit rules (same-day cache in the pack) ---------- */
  async function cacheGet() { const c = await packs.getJSON(slug, 'ideas/cache.json', null).catch(() => null); return c && c.day === today() ? c : { day: today(), q: {}, rules: {} }; }
  async function cachePut(c) { await packs.put(slug, 'ideas/cache.json', c).catch((e) => log.warn?.('[ideas] cache', e.message)); }
  async function searchReddit(cache, query, timeframe = 'month') {
    const k = `${query}|${timeframe}`; if (cache.q[k]) return cache.q[k];
    if (!tregOn()) return [];
    try { const j = await callTreg('scrapecreators.reddit.search.posts', { query, sort: 'relevance', timeframe }); cache.q[k] = (j?.posts || []).map(normThread).filter((t) => t && !t.over18); }
    catch (e) { log.warn?.('[ideas] reddit search', query, e.message); cache.q[k] = []; }
    return cache.q[k];
  }
  async function rulesOf(cache, sub) {
    if (cache.rules[sub] !== undefined) return cache.rules[sub];
    if (!tregOn()) return null;
    try { const j = await callTreg('scrapecreators.x.v1-reddit-subreddit-details', { subreddit: sub, cache_max_age: '7d' }); cache.rules[sub] = { rules: String(j?.rules || '').slice(0, 2400), weekly: j?.weekly_active_users || null, desc: cut(j?.description, 160) }; }
    catch (e) { log.warn?.('[ideas] rules', sub, e.message); cache.rules[sub] = null; }
    return cache.rules[sub];
  }
  // how relevant a thread is to this brand: names the brand, the category, a rival or a search term
  const relevance = (c, t) => {
    const txt = norm(t.title + ' ' + t.text); let s = 0;
    if (new RegExp(`\\b${norm(c.name)}\\b`).test(txt)) s += 3;
    if (txt.includes(c.noun.replace(/s$/, ''))) s += 2;
    (c.config.rivals || []).forEach((r) => { if (txt.includes(norm(r))) s += 2; });
    if (/\b(buy|sell|wts|wtb)\b/i.test(t.title) || /buysell|marketplace/i.test(t.sub)) s -= 3;
    if (s <= 0) return s; /* a busy thread about nothing of the brand's is not relevant: popularity counts only on top of a brand, category or rival word (QV 28 Oct) */
    const age = t.at ? (T() - Date.parse(t.at)) / 864e5 : 60;
    return s + Math.min(2, Math.log10((t.comments || 0) + 1)) + (age <= 30 ? 1 : age > 120 ? -2 : 0);
  };
  const MIN_REL = 3; /* names the brand (3), or the category and a rival (2 + 2), or the category on a thread with replies */
  const idOfUrl = (u) => (String(u || '').match(/\/comments\/([a-z0-9]+)/i) || [])[1] || null;
  /* the shared treg client, with this run's spend counted */
  const countingTreg = () => ({ live: treg.live, call: async (id, o) => { const u0 = treg.meter?.usd || 0; try { return await treg.call(id, o); } finally { spend.treg += (treg.meter?.usd || 0) - u0; } } });
  /* real Quora questions: what listening found, then one web search for the brand (shared treg client, 24-hour cache) when
     fewer than four; a question must be close to the brand and, in an English market, in English */
  async function quoraQuestions(c, cache) {
    const have = new Map((c.listen.quora || []).map((q) => [q.url, q]));
    if (have.size < 4 && tregOn()) {
      const k = `quora|${c.name}`;
      if (!cache.q[k]) { try { const j = await callTreg('treg.web.search', undefined, { body: { q: `site:quora.com ${c.name} ${c.noun}`, limit: 10 } }); cache.q[k] = (j?.output?.results || []).filter((r) => isQuoraQuestion(r.url)).map((r) => ({ url: r.url.replace(/[?#].*$/, ''), title: cut(String(r.title || '').replace(/\s*-\s*Quora\s*$/i, ''), 200), platform: 'quora' })); }
        catch (e) { log.warn?.('[ideas] quora search', e.message); cache.q[k] = []; } }
      for (const q of cache.q[k]) if (!have.has(q.url)) have.set(q.url, q);
    }
    return [...have.values()].map((q) => ({ ...q, rel: relevance(c, { title: q.title, text: '', comments: 0, at: new Date(T()).toISOString() }) - 1 })) /* no age or reply bonus for an evergreen question */
      .filter((q) => q.title && q.rel >= 2 && inMarket({ title: q.title }, c.profile).ok).sort((a, b) => b.rel - a.rel).slice(0, 8);
  }
  async function communitiesFor(c, cache, threads, rejected = []) {
    const subs = {}; threads.forEach((t) => { if (t.sub) (subs[t.sub] ||= []).push(t); });
    const cand = new Map(), put = (x) => { const k = String(x.sub || '').toLowerCase(); if (!k) return; const was = cand.get(k); cand.set(k, { ...(was || {}), ...x, threads: Math.max(was?.threads || 0, x.threads || 0, subs[x.sub]?.length || 0), from: [...new Set([...(was?.from || []), x.from])] }); };
    Object.entries(subs).forEach(([sub, ts]) => put({ name: 'r/' + sub, sub, url: `https://www.reddit.com/r/${sub}/`, platform: 'reddit', threads: ts.length, from: 'threads' }));
    c.listen.communities.filter((x) => x.platform === 'reddit' && x.sub).forEach((x) => put({ ...x, from: 'listen' }));
    for (const q of (c.listen.categoryQs?.length ? c.listen.categoryQs : [c.noun]).slice(0, 2)) {
      const k = `subs|${q}`;
      if (!cache.q[k] && tregOn()) { try { cache.q[k] = typeaheadCommunities(await callTreg('tikhub.x.reddit-app-fetch-search-typeahead', { query: q, safe_search: 'unset', allow_nsfw: '0', need_format: false })); } catch (e) { log.warn?.('[ideas] community search', q, e.message); cache.q[k] = []; } }
      (cache.q[k] || []).forEach((x) => put({ ...x, from: 'search' }));
    }
    // the gate on what is known now (name, market, size from the search), then rules and size for the ones that pass
    const out = [];
    const ranked = [...cand.values()].map((m) => ({ m, g: usableCommunity(m, { profile: c.profile, stems: c.listen.stems }) })).filter(({ m, g }) => { if (!g.ok) rejected.push({ url: m.url, why: g.why }); return g.ok; })
      .sort((a, b) => (b.m.threads || 0) - (a.m.threads || 0) || (b.m.brand || 0) - (a.m.brand || 0) || (b.m.weekly || 0) - (a.m.weekly || 0)).map(({ m }) => m);
    for (const m of ranked) { if (out.length >= 10) break;
      const r = !m.rules ? await rulesOf(cache, m.sub) : null, x = { ...m, rules: m.rules || r?.rules || '', weekly: m.weekly || r?.weekly || null, desc: m.desc || r?.desc || '' };
      const g = usableCommunity(x, { profile: c.profile, stems: c.listen.stems }); if (!g.ok) { rejected.push({ url: x.url, why: g.why }); continue; } /* the size the rules read gave */
      out.push(x); }
    return out;
  }
  async function discover({ fresh = false } = {}) {
    const c = await load();
    const cache = fresh ? { day: today(), q: {}, rules: {} } : await cacheGet();
    const terms = (c.config.terms || []).flat().slice(0, 3);
    const rivals = (c.config.rivals || []).slice(0, 2);
    const qs = [`${c.name} ${c.noun}`, `${c.name} ${c.noun} review`, ...terms, ...rivals.map((r) => `${r} ${c.noun}`)].slice(0, 7);
    const found = new Map(c.listen.threads.filter((t) => t.platform === 'reddit').map((t) => [t.url, { ...t, from: 'listen' }])); /* Reddit replies go to Reddit threads */
    for (const q of qs) for (const t of await searchReddit(cache, q)) if (!found.has(t.url)) found.set(t.url, { ...t, from: 'search: ' + q });
    // the community gate (community-gate.js): fresh, in the market, open, close enough to the brand; then Reddit's own counts
    const rejected = [];
    const gated = [...found.values()].map((t) => ({ ...t, rel: relevance(c, t) })).filter((t) => { const g = usableThread(t, { now: T(), profile: c.profile, rel: t.rel, minRel: MIN_REL, brand: c.name }); if (!g.ok) rejected.push({ url: t.url, why: g.why }); return g.ok; }).sort((a, b) => b.rel - a.rel).slice(0, 30);
    const stats = await redditStats(gated, { treg: tregOn() ? countingTreg() : null, paid: 6, log });
    const threads = gated.map((t) => withStats(t, stats.get(idOfUrl(t.url)))).filter((t) => { const g = usableThread(t, { now: T(), profile: c.profile, brand: c.name }); if (!g.ok) rejected.push({ url: t.url, why: g.why }); return g.ok; });
    const quora = await quoraQuestions(c, cache);
    // communities (community-gate.js usableCommunity): where the live threads are, where listening heard the brand, its rivals
    // and the category, and the category's biggest communities from Reddit's own search; each one about the category, in the
    // market, not a deals or general-chat board, with its rules and size read before an idea may post there
    const communities = await communitiesFor(c, cache, threads, rejected);
    await cachePut(cache);
    c.disc = { threads, communities, quora, queries: qs, rejected: rejected.slice(0, 40) };
    return c.disc;
  }

  /* ---------- which platforms, and why ---------- */
  async function platformsFor() {
    const c = await load(); const d = c.disc || await discover().catch(() => ({ threads: [], communities: [] }));
    const txt = `${c.cat} ${c.profile.about || ''} ${c.brief.businessModel || ''}`;
    const b2b = B2B.test(c.cat) && !/\b(d2c|consumer|shopify)\b/i.test(txt) && c.profile.platform !== 'shopify';
    const visual = VISUAL.test(c.cat), older = OLDER.test(c.cat);
    const has = (k) => c.socials.find((s) => s.platform === k);
    const igAvg = c.facts.social_instagram_avg_likes?.v;
    const subs = d.communities.filter((x) => x.platform === 'reddit').map((x) => x.name);
    const out = [];
    const P = (platform, weight, why, formats = PLATFORMS[platform].formats) => out.push({ platform, label: PLATFORMS[platform].label, formats, weight, why, own: has(PLATFORMS[platform].social || '')?.url || null });
    if (!b2b) P('instagram', 5, has('instagram') ? `@${has('instagram').handle} is the brand's main channel${igAvg ? ` (${igAvg} average likes on the last 12 posts)` : ''}; ${visual ? 'a visual category that sells on the look' : 'Reels reach non-followers'}.` : `No Instagram account on record, but ${visual ? 'the category sells on the look' : 'Reels are the widest consumer reach'}; start from Reels.`);
    if (!b2b) P('youtube', 3, `Shorts reach ${c.countryName || 'the market'} buyers who search before they buy${c.country === 'IN' ? ' and fill the gap TikTok left in India' : ''}; ${has('youtube') ? 'the channel exists' : 'no channel on record, so Shorts can start one'}.`);
    if (!b2b && !NO_TIKTOK.includes(c.country)) P('tiktok', 3, `Short video is where ${c.cat || 'this category'} gets discovered; ${has('tiktok') ? 'the account exists' : 'no account on record yet'}.`);
    P('reddit', b2b ? 4 : 4, d.threads.length ? `${d.threads.length} live threads from the last ${REPLY_DAYS} days${subs.length ? ` across ${subs.slice(0, 4).join(', ')}` : ''}, people asking about ${c.name} and its rivals by name.` : `Buyers ask for honest takes on Reddit before they buy; no live thread found this month, so start with a value post.`, d.threads.length ? ['reply', 'post'] : ['post']);
    P('x', b2b ? 3 : 2, has('x') ? `@${has('x').handle} exists; threads carry the story behind drops and launches.` : `No X account on record; a founder thread tells the story behind the brand where press and early adopters read.`);
    if (c.founders.length || has('linkedin')) P('linkedin', b2b ? 5 : 2, `${c.founders.length ? `Founders on record (${c.founders.slice(0, 2).join(', ')})` : 'A company page exists'}; ${b2b ? 'buyers are here' : 'founder stories here reach press, partners, retail buyers and hires'}.`);
    if (visual && !b2b) P('pinterest', 2, `${c.cat} is searched on Pinterest as outfit and style ideas; pins send search traffic to product pages for months.`);
    if ((d.quora || []).length) P('quora', b2b ? 3 : 2, `${d.quora.length} real Quora questions about ${c.name} and its category (e.g. "${cut(d.quora[0].title, 70)}"); Quora answers rank on Google and feed AI answers.`);
    if (!b2b && d.communities.some((x) => /facebook\.com\/groups\//.test(x.url || '')) && (older || ['IN', 'PH', 'ID', 'BR', 'MX', 'NG'].includes(c.country))) P('facebook', 1, `${c.countryName} buyers still swap recommendations in Facebook groups${older ? ', and this category skews to an audience that lives there' : ''}.`);
    return out.sort((a, b) => b.weight - a.weight);
  }

  /* ---------- the slate: n slots spread across platforms and formats ---------- */
  function slots(plats, n, only) {
    const ps = plats.filter((p) => !only || only.includes(p.platform)); if (!ps.length) return [];
    const tot = ps.reduce((s, p) => s + p.weight, 0);
    const cnt = Object.fromEntries(ps.map((p) => [p.platform, 0]));
    for (let i = 0; i < n; i++) { const p = ps.map((p) => ({ p, gap: (p.weight / tot) * (i + 1) - cnt[p.platform] })).sort((a, b) => b.gap - a.gap)[0].p; cnt[p.platform]++; }
    const out = []; for (const p of ps) for (let k = 0; k < cnt[p.platform]; k++) out.push({ platform: p.platform, format: p.formats[k % p.formats.length] });
    return out.map((s, i) => ({ slot: i + 1, ...s }));
  }

  function context(c, d) {
    const ev = c.ev.map((e) => `${e.id} [${e.kind}] ${e.label}: ${e.value}`).join('\n');
    const prods = c.products.map((p) => `- ${p.handle}: ${p.title}${p.type ? ` (${p.type})` : ''}${+p.price > 0 ? `, ${p.priceText || c.sym + Number(p.price).toLocaleString('en-IN')}` : ''}${p.inStock === false ? ', SOLD OUT' : ''}${p.claim ? ' · ' + cut(p.claim, 140) : ''}`).join('\n');
    const mv = c.movesD.map((m) => `${m.ref} · ${m.title}: ${m.gives}${m.take.length ? '\n   takeaways: ' + m.take.join(' | ') : ''}`).join('\n');
    const th = d.threads.map((t, i) => `T${i + 1} r/${t.sub} · ${t.at} · ${repliesText(t.comments, t.commentsFloor) || 'replies not counted'}${t.intent ? ` · ${t.intent}/${t.sentiment || '?'}` : ''} · "${t.title}"${t.text ? ' · OP: ' + cut(t.text, 260) : ''}`).join('\n');
    const cm = d.communities.map((x, i) => `C${i + 1} ${x.name}${x.weekly ? ` (${x.weekly.toLocaleString('en-IN')} weekly active)` : ''}: ${x.desc || ''}${x.why ? ' · heard: ' + x.why : ''}\n   RULES: ${cut(x.rules, 1100) || 'not read'}`).join('\n');
    const own = c.socials.map((s) => `${s.platform}: ${s.url}`).join(', ') || 'none on record';
    const voice = [...(c.brief.language || [])].slice(0, 16).join(', ');
    return `BRAND: ${c.name} (${c.profile.host}) · ${c.cat} · ${c.countryName || 'selling market not confirmed'} · prices in ${c.config.currency || 'the store’s currency'}
MARKET: ${marketLine(c.profile)}
ABOUT: ${c.profile.about || c.brief.oneLine || ''}
FOUNDERS ON RECORD: ${c.founders.join(', ') || 'none'} · OWN ACCOUNTS: ${own}
RIVALS: ${(c.config.rivals || []).join(', ')}
VOICE (words the brand and its buyers use): ${voice}
PERSONAS: ${(c.brief.personas || []).map((p) => `${p.name}: ${p.job}`).join(' | ')}
OBJECTIONS: ${(c.brief.objections || []).map((o) => o.objection).join(' | ')}
TO CONFIRM (unknown, never state as fact): ${(c.brief.toConfirm || []).join(' | ')}
BUYER QUESTIONS: ${(c.config.questions || []).map((q) => q.q || q).join(' | ')}

PRODUCTS (handle: title, price):
${prods}

EVIDENCE (cite by id; the only facts and numbers you may use):
${ev}

MOVES (the brand's strategy; tie each idea to one or two):
${mv}

LIVE THREADS (real, active in the last ${REPLY_DAYS} days, in the brand's market):
${th || 'none found'}

COMMUNITIES (real, with their rules):
${cm || 'none found'}

QUORA QUESTIONS (real, open):
${(d.quora || []).map((q, i) => `Q${i + 1} "${q.title}"`).join('\n') || 'none found'}`;
  }

  const SYS = (c) => `You are the social team for ${c.name}, writing ready-to-post ideas for its own channels and the real communities where its buyers talk. Hard rules:
- Use only facts and numbers from EVIDENCE (cite ids). Never invent numbers, stats, customer counts, sell-out claims, materials, backstory or quotes. If a number is not in EVIDENCE, write without it. Items under TO CONFIRM are unknown.
- Quote reviews and captions exactly as written.
- Respect each community's RULES literally (self-promotion, links, AI images, sales/deals, reco limits). If a rule forbids the idea there, pick another place.
- On Reddit, Quora and Facebook groups: be useful first, disclose the affiliation, no links, no hashtags, no AI images.
- Write natively for each platform; no "elevate", "game-changer", "unleash", "dive in", em dashes or corporate tone. Indian English where the brand is Indian.
- Never add disclaimers, "illustrative" labels or fine print.
- EVIDENCE also holds what moves this week: [trend], [news] (the industry and rivals), [rival-ad] (rivals' ads that keep running) and [pulse] (the market's numbers). Where one fits, tie an idea to it so the post is timely: a rising search, a festival, a rival's move, a complaint about a rival. Answer a rival's long-running ad with ${c.name}'s own angle; never copy its words, offer or picture, and never name or knock the rival in the post.${c.bookWords ? `\n\nThe brand's Brand Book (follow it in every word):\n${c.bookWords}` : ''}`;

  /* ---------- schemas (strict structured output: no limits, explicit properties) ---------- */
  const S_SLATE = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
    slot: { type: 'integer' }, platform: { type: 'string', enum: Object.keys(PLATFORMS) }, format: { type: 'string' }, angle: { type: 'string', description: 'one line: the idea, specific to the brand, with the hook direction' },
    product: { type: 'string', description: 'product handle from PRODUCTS, or empty' }, evidence: { type: 'array', items: { type: 'string' }, description: 'E ids that back it' },
    where: { type: 'array', items: { type: 'string' }, description: 'T or C ids (Reddit), Q ids (Quora) where it goes, empty for own channels' }, moves: { type: 'array', items: { type: 'string' }, description: 'e.g. "Move 21"' },
    query: { type: 'string', description: '3-6 word Reddit search to find more live threads on this topic' } } } } } };
  const S_IDEAS = { type: 'object', properties: { ideas: { type: 'array', items: { type: 'object', properties: {
    slot: { type: 'integer' }, title: { type: 'string', description: 'one line for the feed card, under 70 chars, the point first' }, hook: { type: 'string' }, copy: { type: 'string', description: 'the full post, ready to paste, native length and style' },
    cta: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
    media: { type: 'object', properties: { kind: { type: 'string', enum: ['none', 'image', 'carousel', 'video'] }, prompt: { type: 'string', description: 'image/video generation prompt or real-photo brief; the product must match its photos exactly' },
      slides: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, prompt: { type: 'string' } } } },
      script: { type: 'array', items: { type: 'object', properties: { beat: { type: 'string' }, shot: { type: 'string' }, line: { type: 'string' } } } } } },
    where: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string', description: 'T, C or Q id' }, why: { type: 'string' }, rule: { type: 'string', description: 'the community rule that applies and how this post respects it' } } } },
    why: { type: 'string', description: 'one line: why this works for this brand now' }, evidence: { type: 'array', items: { type: 'string' } }, moves: { type: 'array', items: { type: 'string' } },
    measure: { type: 'object', properties: { metric: { type: 'string' }, how: { type: 'string' } } }, postAt: { type: 'string', description: 'best day and local time for this platform and audience' }, product: { type: 'string' } } } } } };
  const S_CHECK = { type: 'object', properties: { checks: { type: 'array', items: { type: 'object', properties: {
    slot: { type: 'integer' }, verdict: { type: 'string', enum: ['ok', 'fix', 'drop'] }, problems: { type: 'array', items: { type: 'string' } },
    title: { type: 'string', description: 'fixed title, or empty to keep' }, hook: { type: 'string', description: 'fixed hook, or empty' }, copy: { type: 'string', description: 'fixed full copy, or empty to keep' },
    extra: { type: 'array', items: { type: 'string' }, description: 'T ids from CANDIDATES that fit this idea and whose community allows it' },
    badWhere: { type: 'array', items: { type: 'string' }, description: 'URLs from WHERE whose community rules forbid this post, or that do not fit it' } } } } } };

  /* ---------- generate ---------- */
  async function generate({ n = 12, platforms, seed, avoid = [], fresh = false } = {}) {
    const a0 = spend.ai, t0 = spend.treg; dropped = [];
    const c = await load(fresh); const d = await discover({ fresh });
    const plats = await platformsFor();
    const plan = slots(plats, n, platforms);
    if (!plan.length) return { ideas: [], platforms: plats, usd: { ai: 0, treg: 0 } };
    const ctxText = context(c, d);
    const avoidTxt = avoid.length ? `\nALREADY MADE (do not repeat these angles or reply to the same threads again):\n${avoid.slice(-80).map((x) => '- ' + x).join('\n')}` : '';
    // 1. the slate: one angle per slot, diverse across products, personas, moves and evidence
    const slate = (await callAI({ model: 'opus', effort: 'medium', max: 12000, tag: 'ideas:slate', schema: S_SLATE, system: SYS(c),
      prompt: `${ctxText}${avoidTxt}\n\n${creativeBlock({ product: c.products[0]?.title || null })}\n\nPlan ${plan.length} social ideas, one per slot:\n${plan.map((s) => `slot ${s.slot}: ${PLATFORMS[s.platform].label} ${s.format}`).join('\n')}\n${seed ? `\nFOCUS for this batch: ${seed}\n` : ''}
Each angle must be specific to ${c.name} (a named product, drop, review line, rival comparison, buyer question or founder fact), grounded in EVIDENCE ids, and different from the others (spread across products, personas, moves). Where a slot makes an image, carousel or video, plan it from WHAT CAN BE MADE: the format, the exact product as the store lists it, the scene or angle, the hook; never "a new post", "fresh creative" or "some visuals", and no two slots share format + product + angle. Reddit replies must answer a specific T thread whose subreddit rules allow it, about exactly what its poster asked (skip buy/sell threads); a Reddit post goes to a C community whose rules allow it. A Quora slot answers one Q question, about exactly what it asks. Prefer the freshest, most-replied threads.` })).json?.items || [];
    const bySlot = new Map(slate.map((s) => [s.slot, s]));
    const items = plan.map((p) => ({ ...p, ...(bySlot.get(p.slot) || { angle: '', evidence: [], where: [], moves: [], query: '' }), platform: p.platform, format: p.format }));
    // 2. live threads per community idea (treg), as extra candidates for the writer and the checker
    const cache = await cacheGet(); const extra = {};
    const known = new Set(d.threads.map((t) => t.url));
    for (const it of items.filter((x) => x.platform === 'reddit' && x.query).slice(0, 6)) {
      const ts = (await searchReddit(cache, it.query)).filter((t) => !known.has(t.url)).map((t) => ({ ...t, rel: relevance(c, t) + [...words(it.query)].filter((w) => words(t.title + ' ' + t.text).has(w)).length })).filter((t) => usableThread(t, { now: T(), profile: c.profile, rel: t.rel, minRel: MIN_REL, brand: c.name }).ok).sort((a, b) => b.rel - a.rel).slice(0, 4);
      ts.forEach((t) => { known.add(t.url); d.threads.push(t); });
      extra[it.slot] = ts.map((t) => 'T' + (d.threads.indexOf(t) + 1));
    }
    await cachePut(cache);
    const ctxText2 = Object.keys(extra).length ? context(c, d) : ctxText;
    // 3. write, in parallel chunks of 4
    const chunks = []; for (let i = 0; i < items.length; i += 4) chunks.push(items.slice(i, i + 4));
    const all = items.map((s) => `slot ${s.slot} ${PLATFORMS[s.platform].label} ${s.format}: ${s.angle}`).join('\n');
    const written = (await Promise.all(chunks.map((ch, k) => callAI({ model: 'opus', effort: 'high', max: 24000, tag: 'ideas:write', schema: S_IDEAS, system: SYS(c),
      prompt: `${ctxText2}\n\n${creativeBlock({ product: c.products[0]?.title || null })}\n\nTHE WHOLE BATCH (for context, do not overlap):\n${all}\n\nWRITE THESE ${ch.length}, finished and ready to post:\n${ch.map((s) => `slot ${s.slot}: ${PLATFORMS[s.platform].label} ${s.format}\n  angle: ${s.angle}\n  product: ${s.product || 'none'} · evidence: ${(s.evidence || []).join(', ')} · where: ${[...(s.where || []), ...(extra[s.slot] || [])].join(', ') || 'own account'} · moves: ${(s.moves || []).join(', ')}\n  style: ${NATIVE[s.platform]}`).join('\n')}
For each: title, hook, full copy, cta, hashtags, media (kind; for image/carousel/video a generation prompt that places the REAL product from its photos, unchanged, written as a makeable asset from WHAT CAN BE MADE: the exact product, the scene or angle, the hook, backed by a named EVIDENCE id or review line, never a generic ad and never a repeat of another slot's format + product + angle; carousel = slides with text + prompt; video = exactly 5 beats with shot + line), where (only places to post THIS idea on its own platform: for a Reddit reply the first ref is the T thread being replied to, and the title and copy answer what that thread asks; for Quora the Q question being answered; T/C/Q refs with why and the exact rule that applies; empty for own channels), why, evidence ids, moves, measure (metric + how to read it), postAt (local time, ${c.config.timezone || 'local'}), product handle.`
    }).then((r) => r.json?.ideas || []).catch((e) => { log.warn?.('[ideas] write chunk', k, e.message); return []; })))).flat();
    // 4. assemble with real references, then the deterministic gates
    d.threads.forEach((t) => { c.feed(t.title); c.feed(t.text); });
    let ideas = written.map((w) => { const s = items.find((x) => x.slot === w.slot); return s ? assemble(c, d, s, w) : null; }).filter(Boolean);
    // rules for any subreddit an idea points at that we have not read yet, so the checker can hold the idea to them
    const need = [...new Set(ideas.flatMap((i) => i.where.filter((w) => w.kind === 'thread').map((w) => (w.url.match(/\/r\/([^/]+)/) || [])[1])).filter(Boolean))].filter((sub) => !d.communities.some((x) => x.sub === sub)).slice(0, 5);
    for (const sub of need) { const r = await rulesOf(cache, sub); d.communities.push({ name: 'r/' + sub, sub, url: `https://www.reddit.com/r/${sub}/`, platform: 'reddit', threads: 0, weekly: r?.weekly || null, rules: r?.rules || '', desc: r?.desc || '' }); }
    if (need.length) await cachePut(cache);
    ideas.forEach((i) => i.where.forEach((w) => { const x = w.kind === 'thread' && d.communities.find((x) => w.url.includes(`/r/${x.sub}/`)); if (x?.weekly && !w.weekly) w.weekly = x.weekly; }));
    // 5. the check (sonnet): native, on-voice, claims backed, community rules respected; may fix copy and add threads
    ideas = await check(c, d, ideas, extra);
    ideas = await places(c, d, ideas);
    ideas.forEach((i) => gate(c, i));
    /* an idea's post is copied word for word into a community: no health claim, guarantee or code the brand's own words don't back (1.5) */
    { const src = sourceText(c.facts || {}, c.profile?.catalog?.products || [], c.profile?.about || '', c.profile?.tagline || '');
      for (const i of ideas) { if (i._drop) continue; if (claimFlags(i.title || '', src).length) { i._drop = true; i.gated = [...(i.gated || []), 'claim in the title']; continue; }
        for (const k of ['copy', 'hook', 'cta']) if (typeof i[k] === 'string') i[k] = checkCopy(i[k], src).text; if ((i.copy || '').length < 40) i._drop = true; } }
    ideas.filter((i) => i._drop).forEach((i) => dropped.push({ title: i.title, platform: i.platform, why: ['unbacked numbers or claims: ' + (i.gated || []).join(', ')] }));
    ideas = ideas.filter((i) => !i._drop);
    if (written.length < items.length) dropped.push(...items.filter((s) => !written.some((w) => w.slot === s.slot)).map((s) => ({ title: s.angle, platform: s.platform, why: ['not written (chunk failed)'] })));
    ideas.forEach((i) => { delete i._drop; delete i._slot; });
    return { ideas, dropped, platforms: plats, threads: d.threads.length, communities: d.communities.map((x) => x.name), usd: { ai: +(spend.ai - a0).toFixed(4), treg: +(spend.treg - t0).toFixed(4) } };
  }

  // the model sometimes writes "\\u20b9" literally inside JSON strings: turn escapes back into characters, everywhere
  const unesc = (o) => typeof o === 'string' ? o.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/—/g, ', ').replace(/ ,/g, ',') : Array.isArray(o) ? o.map(unesc) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, unesc(v)])) : o;
  function assemble(c, d, s, w) {
    w = unesc(w);
    const P = PLATFORMS[s.platform]; if (!P || !w?.copy) return null;
    const prod = c.products.find((p) => p.handle === (w.product || s.product)) || null;
    const refOf = (r) => { const m = /^([TCQ])(\d+)$/.exec(String(r).trim()); if (!m) return null; const x = (m[1] === 'T' ? d.threads : m[1] === 'Q' ? d.quora || [] : d.communities)[+m[2] - 1]; return x ? { x: m[1] === 'Q' ? { ...x, platform: 'quora' } : x, kind: m[1] === 'T' ? 'thread' : m[1] === 'Q' ? 'question' : 'community' } : null; };
    const where = [];
    for (const wh of (w.where || [])) { const r = refOf(wh.ref); if (!r || r.x.platform !== s.platform || /\b(do not|don't|won't|never) (post|comment|answer|reply)|not (post|answer)ing there|signal|context only|not a place/i.test(wh.rule + ' ' + wh.why) || where.some((x) => x.url === r.x.url)) continue; const comm = r.kind === 'thread' ? d.communities.find((x) => x.sub === r.x.sub) : r.x;
      where.push({ name: r.kind === 'thread' ? `r/${r.x.sub}: ${r.x.title}` : r.kind === 'question' ? `Quora: ${r.x.title}` : r.x.name, url: r.x.url, kind: r.kind, why: wh.why || '', rule: wh.rule || '', ...(r.kind === 'thread' ? { at: r.x.at, comments: r.x.comments, ...(r.x.commentsFloor ? { commentsFloor: true } : {}), ...(r.x.lastActive ? { lastActive: r.x.lastActive } : {}) } : {}), ...(comm?.weekly && r.kind !== 'question' ? { weekly: comm.weekly } : {}) }); }
    // own channels: the brand's real account; community platforms with no live thread: a real search link, flagged as such
    const own = c.socials.find((x) => x.platform === P.social);
    if (!where.length && own) where.push({ name: `@${own.handle} (own ${P.label})`, url: own.url, kind: 'own', why: 'The brand\'s own account.', rule: '' });
    /* a community idea with no real place (no thread, community, question or group read) is dropped after the check (ideaUsable) */
    const whereNote = !where.length && P.social ? `${c.name} has no ${P.label} account on record: start one, or post from a founder's account.` : '';
    const evid = (w.evidence || s.evidence || []).map((id) => c.ev.find((e) => e.id === String(id).trim())).filter(Boolean).map(({ label, value, source }) => ({ label, value, source }));
    const moves = [...new Set([...(w.moves || []), ...(s.moves || [])].map((m) => (String(m).match(/\d+/) || [])[0]).filter(Boolean))].map((n) => c.movesD.find((m) => m.n === +n)).filter(Boolean);
    const m = w.media || {}; const kind = ['image', 'carousel', 'video'].includes(m.kind) ? m.kind : 'none';
    const keep = prod ? ` Use the reference photos of ${c.name} ${prod.title} (${prod.images.slice(0, 2).join(' , ')}) and keep the product exactly as photographed: same shape, colours, materials, details and logo; do not redraw or add text on the product.` : '';
    const real = P.community;
    const media = { kind, prompt: (real && kind !== 'none' ? 'Shoot for real, no AI image (community rules): ' : '') + (m.prompt || '') + (kind !== 'none' && !real ? keep : ''),
      slides: kind === 'carousel' ? (m.slides || []).map((x) => ({ text: x.text, prompt: (x.prompt || '') + (x.prompt && prod ? ' Product exactly as in its reference photos.' : '') })) : [],
      script: kind === 'video' ? (m.script || []).slice(0, 5) : [], ...(prod ? { product: { title: prod.title, url: prod.url, images: prod.images } } : {}), ...(real ? { real: true } : {}) };
    const title = String(w.title || s.angle).trim();
    // a founder post is written in one founder's voice: name that founder (never the one the copy names as the other, “Tanvi and I”)
    const other = new Set((c.founders || []).filter((n) => new RegExp(`\\b${n.split(' ')[0]}\\s+and\\s+I\\b`, 'i').test(w.copy || '')));
    const author = s.format === 'founder post' && c.founders?.length ? (c.founders.find((n) => !other.has(n)) || null) : null;
    return { id: 'idea-' + sha(s.platform + norm(title)).slice(0, 10), platform: s.platform, platformLabel: P.label, format: s.format, title, hook: w.hook || '', copy: w.copy, cta: w.cta || '',
      hashtags: P.community ? [] : (w.hashtags || []).map((h) => '#' + String(h).replace(/^#+/, '').replace(/\s+/g, '')).filter((h) => h.length > 1).slice(0, 12),
      media, where, ...(whereNote ? { whereNote } : {}), why: w.why || '', evidence: evid, moves: moves.map((x) => x.ref), moveCards: moves.flatMap((x) => x.cards), measure: { metric: w.measure?.metric || DEF[s.platform][0], how: w.measure?.how || DEF[s.platform][1] },
      ...(author ? { author: { name: author, role: c.founderRoles?.[author] || 'Co-founder' } } : {}), postAt: w.postAt || DEF[s.platform][2], angle: s.angle, query: s.query || '', at: new Date(T()).toISOString(), _slot: s.slot };
  }

  // deterministic gates: no number outside the evidence; links and disclosure on community platforms
  const textsOf = (i) => [['title', i.title], ['hook', i.hook], ['copy', i.copy], ['cta', i.cta], ...i.media.slides.map((x, k) => [`slide${k + 1}`, x.text]), ...i.media.script.map((x, k) => [`beat${k + 1}`, x.line])];
  function unbackedNums(c, i) {
    const bad = [];
    for (const [at, s0] of textsOf(i)) {
      const s = String(s0 || '').replace(/#\w+/g, '').replace(/\b\d+\s*\/\s*(?=\s|$)/gm, '').replace(/^\s*\d+[/.)]\s/gm, '').replace(/\b\d{1,2}(:\d{2})?\s?(am|pm)\b/gi, '');
      for (const n of numbersIn(s)) if (!c.allowMoney.has(n)) bad.push({ at, n });
      for (const n of digitsIn(s)) if (!c.allowNums.has(n) && !(+n >= 1 && +n <= 9 && new RegExp(`\\b${n}\\s+(ways?|looks?|outfits?|things?|tips?|reasons?|steps?|questions?|points?|slides?|takes?|picks?|pairs? to|signs?|mistakes?|rules?|checks?)\\b`, 'i').test(s))) bad.push({ at, n });
    }
    return bad;
  }
  function gate(c, i) {
    const P = PLATFORMS[i.platform];
    if (P.community) {
      i.copy = i.copy.replace(URLRE, '').replace(/[ \t]+\n/g, '\n');
      const DISC = /disclos|i work (at|for|with|on)|i('| a)m (one of )?the (co-?)?founder|co-?founder of|i('| a)m (on|part of|with) the|full disclosure|affiliat|upfront: i/i;
      if (!DISC.test(i.copy)) i.copy = i.copy.trimEnd() + `\n\nDisclosure: I work at ${c.name}.`;
      else { const paras = i.copy.split(/\n{2,}/); if (paras.length > 2 && DISC.test(paras[0]) && /^disclosure:/i.test(paras.at(-1).trim()) && paras.at(-1).length < 80) i.copy = paras.slice(0, -1).join('\n\n'); }
    }
    const bad = unbackedNums(c, i);
    if (bad.length) {
      // last resort: drop the sentences that carry an unbacked number; drop the idea if the copy itself is gutted
      const fix = (s) => String(s || '').split(/(\n+)/).map((line) => /^\n+$/.test(line) ? line : line.split(/(?<=[.!?])\s+/).filter((x) => !bad.some((b) => digitsIn(x).includes(b.n) || numbersIn(x).includes(b.n))).join(' ')).join('').replace(/\n{3,}/g, '\n\n').trim();
      for (const b of bad) { if (b.at === 'copy') i.copy = fix(i.copy); else if (b.at === 'hook') i.hook = fix(i.hook); else if (b.at === 'title') i._drop = true; else if (b.at === 'cta') i.cta = fix(i.cta);
        else if (b.at.startsWith('slide')) { const x = i.media.slides[+b.at.slice(5) - 1]; if (x) x.text = fix(x.text); } else if (b.at.startsWith('beat')) { const x = i.media.script[+b.at.slice(4) - 1]; if (x) x.line = fix(x.line); } }
      if (i.copy.length < 40) i._drop = true;
      i.gated = bad.map((b) => `${b.at}: ${b.n}`);
      log.warn?.('[ideas] gate stripped', i.title, i.gated.join(', '));
    }
  }

  /* the places every community idea points at, made sure (community-gate.js): a reply's thread is re-read for Reddit's live
     count and whether it is still open, the reply is about what that thread asked, and no community idea is left without a
     real place. What fails is dropped and said in dropped[], never shown */
  async function places(c, d, ideas) {
    const targets = ideas.filter((i) => i.platform === 'reddit').flatMap((i) => i.where.filter((w) => w.kind === 'thread'));
    const stats = await redditStats(targets.map((w) => ({ url: w.url })), { treg: tregOn() ? countingTreg() : null, paid: targets.length, log });
    return ideas.filter((i) => {
      const no = (why) => { dropped.push({ title: i.title, platform: i.platform, why: [why] }); log.info?.('[ideas] dropped', i.title, why); return false; };
      for (const w of i.where) if (w.kind === 'thread') { const st = stats.get(idOfUrl(w.url)); if (st) { const at0 = w.at; Object.assign(w, withStats({}, st)); if (at0) w.at = at0; if (st.comments == null) delete w.comments; } }
      if (i.platform === 'reddit' && i.format === 'reply') {
        const w = i.where.find((x) => x.kind === 'thread'); if (!w) return no('a reply with no thread to reply to');
        if (w.locked || w.archived || w.removed) return no('the thread is closed to replies now');
        const t = d.threads.find((x) => x.url === w.url) || { title: String(w.name || '').replace(/^[^:]+:\s*/, '') };
        if (!matchesThread(i, t)) return no(`not about what the thread asked ("${cut(t.title, 80)}")`);
      }
      /* a post (not a reply) keeps only the threads on its topic as places; the community itself stays */
      if (i.format !== 'reply') i.where = i.where.filter((w) => w.kind !== 'thread' || matchesThread(i, d.threads.find((x) => x.url === w.url) || { title: String(w.name || '').replace(/^[^:]+:\s*/, '') }));
      if (i.platform === 'quora') { const q = i.where.find((x) => x.kind === 'question'); const src = q && (d.quora || []).find((x) => x.url === q.url); if (q && src && !matchesThread(i, src)) return no(`not about the Quora question ("${cut(src.title, 80)}")`); }
      if (!ideaUsable(i, { now: T(), profile: c.profile })) return no('no real thread, question or group to post it in');
      return true;
    });
  }

  let dropped = [];
  async function check(c, d, ideas, extra) {
    if (!ideas.length) return ideas;
    // pre-check the numbers, so the checker rewrites around them instead of the gate cutting sentences later
    const pre = Object.fromEntries(ideas.map((i) => [i._slot, unbackedNums(c, i)]));
    const cand = (i) => (extra[i._slot] || []).map((r) => { const t = d.threads[+r.slice(1) - 1]; return t ? `${r} r/${t.sub} · ${t.at} · "${t.title}"` : ''; }).filter(Boolean);
    const evText = c.ev.map((e) => `${e.id} ${e.label}: ${e.value}`).join('\n');
    const rules = d.communities.map((x) => `${x.name}: ${cut(x.rules, 700) || 'rules not read'}`).join('\n');
    let r;
    try {
      r = await callAI({ model: 'sonnet', max: 16000, tag: 'ideas:check', schema: S_CHECK, system: SYS(c),
        prompt: `EVIDENCE:\n${evText}\n\nCOMMUNITY RULES:\n${rules}\n\nCheck each idea. Creative direction (scenes, styling, shots, outfit pairings, questions to the audience) needs no evidence; factual claims about the product, the brand, its customers, founders, sales, or numbers do. Answer "ok" when the idea is fine: do not rewrite for taste. "fix" when: a claim or number is not in EVIDENCE, a review is misquoted, it reads like an ad on Reddit/Quora/Facebook, it breaks a community rule, it is off-platform in style or length, it uses AI-tell words, or it states a TO CONFIRM item as fact. Give the fixed title/hook/copy (keep everything good; same platform style). "drop" only if it cannot be saved. List in badWhere any WHERE url whose rules forbid this post or that does not fit it. For CANDIDATES, return the T ids that genuinely fit (same topic, community rules allow it).\n\n${ideas.map((i) => `--- slot ${i._slot} · ${i.platformLabel} ${i.format}\nTITLE: ${i.title}\nHOOK: ${i.hook}\nCOPY:\n${i.copy}\nSLIDES: ${i.media.slides.map((x) => x.text).join(' | ')}\nSCRIPT: ${i.media.script.map((x) => x.line).join(' | ')}\nWHERE: ${i.where.map((w) => `${w.name} <${w.url}>`).join(' | ')}${(() => { const w = i.where.find((x) => x.kind === 'thread' || x.kind === 'question'); const t = w && [...d.threads, ...(d.quora || [])].find((x) => x.url === w.url); return t ? `\nIT ANSWERS: "${t.title}"${t.text ? ' · ' + cut(t.text, 300) : ''} (title and copy must answer exactly this; if they do not, fix them to, or drop)` : ''; })()}\nCITED: ${i.evidence.map((e) => e.value).join(' | ')}${pre[i._slot]?.length ? `\nUNBACKED NUMBERS (must go): ${pre[i._slot].map((b) => b.n).join(', ')}` : ''}${cand(i).length ? `\nCANDIDATES:\n${cand(i).join('\n')}` : ''}`).join('\n\n')}` });
    } catch (e) { log.warn?.('[ideas] check failed', e.message); return ideas; }
    const by = new Map((r.json?.checks || []).map((x) => [x.slot, x]));
    return ideas.filter((i) => {
      const k = by.get(i._slot); if (!k) return true;
      i.checked = k.verdict; if (k.problems?.length) i.problems = k.problems;
      if (k.verdict === 'drop') { log.info?.('[ideas] dropped', i.title, k.problems?.join('; ')); dropped.push({ title: i.title, platform: i.platform, why: k.problems || [] }); return false; }
      Object.assign(k, unesc({ title: k.title, hook: k.hook, copy: k.copy }));
      if (k.verdict === 'fix') { if (k.title?.trim()) i.title = k.title.trim(); if (k.hook?.trim()) i.hook = k.hook.trim(); if (k.copy?.trim()) i.copy = k.copy.trim(); }
      if (k.badWhere?.length) i.where = i.where.filter((w) => !k.badWhere.includes(w.url));
      for (const ref of (i.format === 'reply' ? [] : k.extra || [])) { const t = d.threads[+String(ref).slice(1) - 1]; if (t && !i.where.some((w) => w.url === t.url)) i.where.push({ name: `r/${t.sub}: ${t.title}`, url: t.url, kind: 'thread', why: 'Live thread on the same topic, found for this idea.', rule: cut(d.communities.find((x) => x.sub === t.sub)?.rules, 160) || 'Read the subreddit rules before posting.', at: t.at, comments: t.comments }); }
      if (PLATFORMS[i.platform].community) i.where = i.where.filter((w) => w.kind !== 'own');
      if (i.format === 'reply') { const t = i.where.find((w) => w.kind === 'thread'); i.where = t ? [t, ...i.where.filter((w) => w.kind === 'community' && t.url.startsWith(w.url))].slice(0, 2) : i.where; }
      delete i._slot; return true;
    });
  }

  /* ---------- the stream: fresh batches, stored ---------- */
  async function next({ n = 12, platforms, seed } = {}) {
    const stored = await packs.getJSON(slug, `${DIR}ideas.json`, { items: [] }).catch(() => ({ items: [] }));
    const seen = await packs.getJSON(slug, `${DIR}seen.json`, { titles: [], threads: [] }).catch(() => ({ titles: [], threads: [] }));
    const st = new Set(seen.titles || []), sth = new Set(seen.threads || []);
    /* the team's stream also steers clear of the public ideas (the team sees both) */
    const other = member ? ((await packs.getJSON(slug, 'ideas/ideas.json', { items: [] }).catch(() => ({ items: [] })))?.items || []).slice(-40) : [];
    const r = await generate({ n, platforms, seed, avoid: [...[...other, ...(stored.items || []).slice(-60)].map((i) => `${i.platformLabel || i.platform}: ${i.title}`), ...[...sth].slice(-30).map((u) => 'replied: ' + u)] });
    if (member) r.ideas.forEach((i) => { i.member = true; });
    const fresh = r.ideas.filter((i) => !st.has(norm(i.title)) && !(i.format === 'reply' && i.where.some((w) => w.kind === 'thread' && sth.has(w.url))));
    r.dropped.push(...r.ideas.filter((i) => !fresh.includes(i)).map((i) => ({ title: i.title, platform: i.platform, why: ['already made (title or replied thread)'] })));
    fresh.forEach((i) => { st.add(norm(i.title)); if (i.format === 'reply') i.where.filter((w) => w.kind === 'thread').forEach((w) => sth.add(w.url)); });
    const items = [...(stored.items || []), ...fresh].slice(-300);
    await packs.put(slug, `${DIR}ideas.json`, { at: new Date(T()).toISOString(), items });
    await packs.put(slug, `${DIR}seen.json`, { titles: [...st].slice(-2000), threads: [...sth].slice(-1000) });
    return { ...r, ideas: fresh };
  }

  /* ---------- feed cards (mirrors seed.json posts; the shape lives in social-feed.js so pack loads can make them without a run) ---------- */
  const toCards = (ideas) => ideaCards(ideas, ctx?.seed || {}, { now: T() });

  return { platformsFor, generate, next, toCards, discover, load, spend };
}
