// Social feed: what listening heard and the ideas stream, as feed cards, for ANY brand pack; plus the background
// scheduler that keeps both fresh. Pure helpers (cards, rotation, gating) are exported so tests can run them free.
//   ideaCards(ideas, seed)        ideas/ideas.json items → feed cards (the card shape seed.json posts use)
//   pickIdeas(items, { now })     dedupe by id, newest first, at most 12 at once, rotated by day
//   heardCards(listen, seed)      listen/*.json → "asked in r/x, reply as the brand" and theme cards (quant + qual)
//   socialize(seed, social)       appends both to seed.posts (brand-pack.js calls it next to visualize)
//   readSocial(packs, slug)       the files socialize needs; a brand with none gets nothing, silently
//   heardView(listen, name)       the "Heard" section of What Brew learned
//   createSocialScheduler(...)    listen every ~24h per built brand (asked threads re-read with it), ideas at most daily for brands opened in 3 days
// Nothing is invented here: every thread, quote, count and community comes from the files listen-watch.js and ideas.js wrote.
import { createListenWatch, sourceName } from './listen-watch.js';
import { createIdeas, PLATFORMS } from './ideas.js';
import { usableThread, usableCommunity, topicStems, repliesText, isQuoraQuestion, inMarket } from './community-gate.js'; // which threads any brand may be pointed at

const H = 3600e3, DAY = 24 * H;
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const dayIndex = (ms) => Math.floor(ms / DAY);
// a card's "time" as the feed reads it (ageOf in feed-service: min, hr, day)
export const ageText = (at, now = Date.now()) => { const ms = Math.max(0, now - (typeof at === 'number' ? at : Date.parse(at) || now)); if (ms < H) return `${Math.max(1, Math.round(ms / 60e3))} min`; if (ms < DAY) return `${Math.round(ms / H)} hr`; return `${Math.round(ms / DAY)} day${Math.round(ms / DAY) === 1 ? '' : 's'}`; };
const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const SENT = { pos: 'mostly positive', neg: 'mostly negative', neutral: 'mostly neutral' };
// buy/sell boards and deal feeds are not places to reply as a brand
const NOT_A_PLACE = /marketplace|buysell|buy_sell|deals?\b|coupon|loot/i;
// a video post (a review, an unboxing) is not a question to answer unless its title asks one
const asksQ = (t) => t?.intent === 'question' && (/\?/.test(String(t.title || '')) || !/youtube\.com|youtu\.be|tiktok\.com|instagram\.com/i.test(String(t.url || '')));

/* a card that asks the brand to reply or post in a community (a thread listening heard, a Reddit / Quora / Facebook group idea):
   the feed keeps one of these in its first screen (feed-service.js social seats) */
export const isCommunityCard = (c) => !!c && (c.heard?.kind === 'thread' || (c.stream === 'ideas' && !!PLATFORMS[c.post?.platform]?.community));

/* a saved community idea still points at a real, usable place: a reply's thread passes the community gate (fresh, in the
   market, open), a Quora answer goes to a real question page, and no idea's only place is a search link. Ideas written before
   the gate heal here, at load, with no rerun */
export function ideaUsable(i, { now = Date.now(), profile = {} } = {}) {
  if (!PLATFORMS[i?.platform]?.community) return true;
  const where = i.where || [], real = where.filter((w) => w.kind !== 'search' && w.kind !== 'own');
  if (!real.length) return false;
  if (i.platform === 'quora') return real.some((w) => isQuoraQuestion(w.url));
  /* a Reddit post's communities: in the market, not a deals, general-chat or a city's own board (the topic was checked when written) */
  if (i.platform === 'reddit' && i.format !== 'reply' && !real.some((w) => w.kind === 'thread' || (w.kind === 'community' && usableCommunity({ name: w.name, url: w.url, weekly: w.weekly ?? null }, { profile }).ok))) return false;
  if (i.format === 'reply') { const t = real.find((w) => w.kind === 'thread'); if (!t) return false;
    const sub = (String(t.url).match(/\/r\/([^/]+)/) || [])[1] || '';
    return usableThread({ url: t.url, sub, title: String(t.name || '').replace(/^[^:]+:\s*/, ''), intent: 'question' /* the writer picked it as a question to answer */, at: t.at, lastActive: t.lastActive, locked: t.locked, archived: t.archived, removed: t.removed }, { now, profile }).ok; }
  return true;
}

/* ---------- ideas → cards ---------- */
/* what an idea's rows say, read by a person (QA 20 Oct): an own channel stored as its id ("@UCbuKp…") is "your YouTube channel"; a
   thread key ("C1", "T5") is no name; "Backed by" says why, never a bare price; "Post at" is a day and time ahead of today in plain
   words (no raw ISO stamp, no zone from another market, no "at at"), else nothing */
const placeName = (w) => { const n = String(w?.name || '').split(':')[0].trim(); return /^@?UC[\w-]{20,}/.test(n) ? `your ${/youtube/i.test(`${w?.name} ${w?.url}`) || /^@?UC/.test(n) ? 'YouTube channel' : 'channel'}` : /^[CT]\d{1,2}$/.test(n) ? '' : n; };
const backedBy = (e) => { if (!e?.value) return ''; const v = String(e.value).trim(); const bare = !/[a-z]{3,}/i.test(v.replace(/\b(?:rs|inr|usd|eur|gbp)\b/gi, '')); return bare ? (e.label ? cut(`${e.label}: ${v}`, 70) : '') : cut(v, 70); };
const postAtOf = (x, now) => { let s = String(x || '').trim().replace(/^at\s+/i, ''); if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s); if (iso) { const day = Date.UTC(+iso[1], +iso[2] - 1, +iso[3]); if (!Number.isFinite(day) || day + 864e5 < now) return ''; /* the day and time as written: no zone shift */
    const d = new Date(day), wd = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', ''); return iso[4] ? `${wd}, ${iso[4]}:${iso[5]}` : wd; }
  const dm = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/.exec(s); if (dm) { const d = Date.parse(`${dm[1]} ${dm[2]} ${dm[3]}`); if (Number.isFinite(d) && d + 864e5 < now) return ''; }
  return s.replace(/\s*\b(?:[A-Z][a-z]+\/[A-Za-z_]+|E[SD]T|P[SD]T|C[SD]T|M[SD]T|GMT|UTC|IST|BST|CET)\b/g, '').trim(); };
const ideaTitle = (t) => String(t || '').replace(/^(?:reddit|quora|x|linkedin)\s+(?:post|reply|answer)\s+(?:in|on)\s+[CT]\d{1,2}:\s*/i, '').split(/\s+\|\s+/)[0].replace(/!+$/, '').trim();
export function ideaCards(ideas, seed = {}, { now = Date.now() } = {}) {
  const posts = seed?.posts || [];
  const rolesOf = (agent) => posts.find((p) => p.agent === agent)?.roles || ['founder', 'brand', 'growth'];
  const lane = Object.keys(seed?.lanes || {})[0];
  const ctaOf = (i) => { const sub = (i.where || []).find((w) => /^r\//.test(w.name))?.name.split(':')[0];
    if (i.platform === 'reddit') return i.format === 'reply' && sub ? `Reply in ${sub}` : sub ? `Post in ${sub}` : 'Post on Reddit';
    if (i.platform === 'quora') return 'Answer on Quora'; if (i.platform === 'facebook') return 'Post in the group';
    if (i.media?.kind === 'video') return `Make the ${i.format === 'reel' ? 'reel' : 'video'}`; if (i.media?.kind === 'carousel') return 'Make the carousel'; return 'Post it'; };
  return (ideas || []).filter((i) => i?.id && i.title && i.copy).map((i) => {
    const P = PLATFORMS[i.platform] || PLATFORMS.instagram, where = i.where || [], ev = i.evidence || [];
    const hasMedia = i.media?.kind && i.media.kind !== 'none';
    const imgs = hasMedia ? (i.media.product?.images || []).filter((x) => typeof x === 'string' && /^https?:|^\/?b\//.test(x)).slice(0, 3) : [];
    const thread = where.find((w) => w.kind === 'thread');
    const rt = thread ? repliesText(thread.comments, thread.commentsFloor) : '';
    const heard = thread ? `${thread.name.split(':')[0]}${rt ? ` · ${rt}` : ''}` : ev.some((e) => /^Listen|^Reddit/i.test(e.label || '')) ? 'from what Brew heard' : '';
    return { id: i.id, agent: P.agent, sector: P.sector, type: 'idea', kind: imgs.length ? 'media' : 'rows', ...(lane ? { lane } : {}), roles: rolesOf(P.agent), origin: 'ideas', stream: 'ideas',
      src: `Ideas · ${P.label} ${i.format}${heard ? ` · Heard ${heard}` : i.moves?.[0] ? ' · ' + i.moves[0] : ''}`, time: ageText(i.at, now),
      badge: [`${P.label} ${i.format}`, 'info'], title: cut(ideaTitle(i.title), 76), sub: cut(i.hook || i.copy, 220), ...(imgs.length ? { images: imgs } : {}),
      rows: [['Where', [...new Set(where.map(placeName).filter(Boolean))].slice(0, 2).join(', ') || P.label], ['Post at', postAtOf(i.postAt, now)], ['Backed by', backedBy(ev[0])], ['Measure', i.measure?.metric]].filter((r) => r[1]),
      ...(thread ? { link: { label: 'Open the thread', url: thread.url } } : where[0]?.url ? { link: { label: `Open ${placeName(where[0]) || P.label}`, url: where[0].url } } : {}),
      cta: { label: ctaOf(i) }, detail: { why: [i.why, ...ev.slice(0, 3).map((e) => `${e.label}: ${cut(e.value, 120)}`)].filter(Boolean),
        how: [`Copy the ${i.platform === 'reddit' && i.format === 'reply' ? 'reply' : 'post'}${hasMedia ? ' and make the ' + i.media.kind : ''}.`, where[0] ? `Open ${placeName(where[0]) || P.label}${where[0].rule ? ' and follow its rule: ' + cut(where[0].rule, 120) : ''}.` : `Post on ${P.label}.`, postAtOf(i.postAt, now) ? `Post ${postAtOf(i.postAt, now)}.` : '', i.measure?.how ? `Measure: ${i.measure.how}` : ''].filter(Boolean) },
      post: i };
  });
}

/* ---------- which ideas are in the feed today: newest batch first, then the rest in a daily rotation ---------- */
export function pickIdeas(items, { now = Date.now(), max = 12, fresh = 6, profile = {} } = {}) {
  const seen = new Set(), seenT = new Set();
  const xs = [...(items || [])].filter((i) => i?.id && i.title && i.copy && ideaUsable(i, { now, profile })).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .filter((i) => { const t = `${i.platform}:${norm(i.title)}`; if (seen.has(i.id) || seenT.has(t)) return false; seen.add(i.id); seenT.add(t); return true; });
  if (xs.length <= max) return xs;
  const head = xs.slice(0, fresh), rest = xs.slice(fresh), k = max - head.length;
  const off = (dayIndex(now) * k) % rest.length;
  return [...head, ...Array.from({ length: k }, (_, j) => rest[(off + j) % rest.length])];
}

/* ---------- what listening heard → cards ---------- */
export function heardCards(L, seed = {}, { now = Date.now(), name = seed?.brand?.name || 'the brand', maxQ = 2, maxT = 2, maxR = 2, maxC = 1, profile = {} } = {}) {
  const out = [], lane = Object.keys(seed?.lanes || {})[0], posts = seed?.posts || [];
  const rolesOf = (agent) => posts.find((p) => p.agent === agent)?.roles || ['founder', 'brand', 'growth'];
  const items = new Map((L?.items || []).map((x) => [x.id, x]));
  const at = L?.status?.at || L?.at || now;
  // the questions people asked, where a reply from the brand would help (recent, about the brand or the category)
  /* Reddit threads only: a creator's video or a rival's post is not a community. Fresh, in the market, open, asking (community-gate.js) */
  const qs = (L?.threads || []).filter((t) => t?.url && asksQ(t) && /\?/.test(`${t.title} ${t.quote || ''}`) && ['brand', 'category', 'rival'].includes(t.about) && !NOT_A_PLACE.test(`${t.where} ${t.title}`)
      && usableThread({ ...t, sub: /^r\//.test(t.where || '') ? t.where : '', text: t.quote }, { now, profile, brand: name }).ok)
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, maxQ);
  for (const t of qs) {
    /* a count shows only when it is the platform's own (repliesLive) or a floor: threads saved before 20 Oct counted what Brew kept */
    const n = t.repliesLive || t.repliesFloor ? t.replies ?? null : null, rt = repliesText(n, t.repliesFloor), where = t.where || t.platform, q = cut(t.title, 90);
    out.push({ id: `heard-q-${hash(t.url)}`, agent: 'visibility', sector: 'visibility', type: 'idea', kind: 'rows', ...(lane ? { lane } : {}), roles: rolesOf('visibility'), origin: 'listen', stream: 'heard',
      src: `Heard · ${where}${rt ? ` · ${rt}` : ''}`, time: ageText(Math.min(now, t.lastActive || at), now), badge: ['Asked', 'info'],
      title: `Asked in ${where}: “${cut(t.title, 60)}”`, sub: `${rt ? `${rt} so far` : n === 0 ? 'No replies yet' : 'Replies not counted'}, last active ${dateText(t.lastActive)}. ${t.about === 'brand' ? `They are asking about ${name} by name.` : t.about === 'rival' ? 'They are weighing a rival.' : 'They are choosing in your category.'} Reply as ${name}: answer the question first, say who you are.`,
      rows: [['Where', where], ...(rt ? [['Replies', rt]] : []), ['Last active', dateText(t.lastActive)], ['Mood', SENT[t.sentiment] || 'mixed']],
      link: { label: 'Open the thread', url: t.url }, cta: { label: 'Reply as the brand' },
      detail: { why: [`“${cut(t.quote || t.title, 220)}”`, `Read in public on ${t.platform === 'reddit' ? 'Reddit' : t.platform}, ${dateText(t.lastActive)}.`], how: ['Open the thread and read the replies.', `Answer what they asked, plainly, and say you work at ${name}.`, 'No links or discount codes unless the community allows them.'] },
      heard: { kind: 'thread', url: t.url, where, replies: n, ...(t.repliesFloor ? { repliesFloor: true } : {}), quote: t.quote || t.title },
      post: { id: `heard-q-${hash(t.url)}`, platform: t.platform === 'reddit' ? 'reddit' : t.platform, platformLabel: t.platform === 'reddit' ? 'Reddit' : t.platform, format: 'reply', title: q, hook: '', copy: '', hashtags: [],
        media: { kind: 'none', slides: [], script: [] }, where: [{ name: `${where}: ${q}`, url: t.url, kind: 'thread', why: 'A real question about the brand, asked in public.', rule: 'Read the community rules before replying.', comments: n, ...(t.repliesFloor ? { commentsFloor: true } : {}), lastActive: t.lastActive }], why: 'Someone asked in public; a plain answer from the brand helps them and everyone who reads the thread later.', evidence: [], moves: [], measure: { metric: 'Upvotes, replies and no mod removal', how: 'Check the thread after 24 hours and 7 days' }, postAt: 'Today', at: new Date(at).toISOString() } });
  }
  // themes: how many said it, how they felt, and two of them in their own words
  const total = L?.total || (L?.items || []).filter((x) => x.themes?.length).length || 0;
  const th = (L?.themes || []).filter((t) => t?.name && t.n >= 3 && (t.brand || 0) > 0);
  const picks = []; const byN = th[0]; if (byN) picks.push(byN);
  const byNeg = [...th].filter((t) => t !== byN && t.neg >= 3).sort((a, b) => b.neg / b.n - a.neg / a.n || b.neg - a.neg)[0]; if (byNeg) picks.push(byNeg);
  for (const t of th) { if (picks.length >= maxT) break; if (!picks.includes(t)) picks.push(t); }
  for (const t of picks.slice(0, maxT)) {
    const qs2 = [...new Set([...(t.quoteIds || [])])].map((id) => items.get(id)).filter(Boolean).map((x) => ({ text: cut([x.title, x.text].filter(Boolean).join('. '), 200), url: x.link, where: x.sub || x.platform }));
    if (!qs2.length && t.quote) qs2.push({ text: cut(t.quote, 200), url: t.quoteLink, where: (String(t.quoteLink || '').match(/\/r\/[^/]+/) || [''])[0].slice(1) || 'public post' });
    const quotes = qs2.slice(0, 2), negP = pct(t.neg, t.n), posP = pct(t.pos, t.n), mood = t.neg > t.pos ? 'neg' : t.pos > t.neg ? 'pos' : 'neutral';
    const wk = t.wow ? `${t.wow.week} this week vs ${t.wow.lastWeek} the week before` : '';
    out.push({ id: `heard-t-${hash(t.name)}`, agent: 'brew', sector: 'signals', type: 'report', family: 'learning', kind: 'rows', ...(lane ? { lane } : {}), roles: rolesOf('brew'), origin: 'listen', stream: 'heard',
      src: `Heard · ${t.n} mentions${total ? ` of ${total}` : ''} · ${quotes[0]?.where || 'public posts'}`, time: ageText(at, now), badge: [mood === 'neg' ? `${negP}% negative` : `${posP}% positive`, mood === 'neg' ? 'warn' : 'ok'],
      title: `People talk about ${t.name}: ${t.n} mentions, ${mood === 'neg' ? `${negP}% negative` : mood === 'pos' ? `${posP}% positive` : 'mostly neutral'}`, sub: quotes[0] ? `“${quotes[0].text}” (${quotes[0].where})` : `${t.n} public posts and comments about ${t.name}.`,
      rows: [['Mentions', `${t.n}${total ? ` · ${pct(t.n, total)}% of what Brew heard` : ''}`], ['Mood', `${t.pos} positive · ${t.neg} negative · ${t.neutral} neutral`], ...(t.brand ? [[`About ${name}`, String(t.brand)]] : []), ...(wk ? [['Trend', wk]] : [])],
      ...(quotes[0]?.url ? { link: { label: `Read it in ${quotes[0].where}`, url: quotes[0].url } } : {}), cta: { label: mood === 'neg' ? 'Answer it on the product page' : 'Use their words in a post' },
      detail: { why: [...quotes.map((q) => `“${q.text}” (${q.where})`), `Counted from ${total || t.n} tagged public posts, comments and reviews.`], how: [mood === 'neg' ? `Answer the worry where buyers decide: the product page and the FAQ.` : `Use their words in the next post or ad.`, 'Reply in the threads where it comes up.', 'Brew keeps counting, so you see if it moves.'] },
      heard: { kind: 'theme', name: t.name, n: t.n, pos: t.pos, neg: t.neg, neutral: t.neutral, quotes } });
  }
  out.push(...rivalCards(L, { now, name, at, lane, roles: rolesOf('brew'), max: maxR, profile }), ...categoryCards(L, { now, name, at, lane, roles: rolesOf('brew'), max: maxC, skip: new Set(picks.map((t) => norm(t.name))), profile }));
  return out;
}

/* ---------- what listening heard about the rivals and the category, as cards (any brand) ----------
   Listening already searches every rival by name and the category's searches and problems; before 20 Oct that talk only fed
   the writer. A rival card: what people dislike about one rival (its complaints by theme, two quotes, linked). A category card:
   what buyers in the category keep asking or complaining about that no brand card covers. Counted over the last 90 days. */
const WINDOW = 90 * DAY;
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const SRC = { reddit: 'Reddit', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', facebook: 'Facebook', amazon: 'Amazon', trustpilot: 'Trustpilot', google: 'Google reviews', news: 'News', web: 'Forums', threads: 'Threads', pinterest: 'Pinterest', walmart: 'Walmart', site: 'Site reviews', nykaa: 'Nykaa', flipkart: 'Flipkart', myntra: 'Myntra' };
const quoteOfItem = (x) => ({ text: cut([x.title, x.text].filter(Boolean).join('. '), 200), url: x.link || x.url || null, where: x.sub || SRC[x.platform] || x.platform || 'public post' });
/* a theme that names a kind of post, not a need ("product review", "feedback", "comparison") is no complaint or question */
const META_THEME = /\b(reviews?|feedback|general|discussion|opinions?|experiences?|comparisons?|recommendations?|routine|content|post|video)\b/i;
const themeCount = (xs) => { const m = {}; xs.forEach((x) => (x.themes || []).forEach((t) => { m[t] = (m[t] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const whereOf = (xs) => Object.entries(xs.reduce((m, x) => ((m[SRC[x.platform] || x.platform] = (m[SRC[x.platform] || x.platform] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(' · ');
/* two quotes that say the thing: linked, readable in the brand's market, and carrying the theme's own words when there is one */
const bestQuotes = (xs, { words = '', profile = {} } = {}) => { const ws = String(words).toLowerCase().match(/[a-z]{3,}/g) || [];
  const ok = [...xs].filter((x) => (x.link || x.url) && String(x.text || x.title || '').length >= 30 && inMarket({ title: x.title, text: x.text }, profile).ok);
  const hit = (x) => ws.some((w) => `${x.title || ''} ${x.text || ''}`.toLowerCase().includes(w.replace(/s$/, '')));
  return (ws.length ? ok.filter(hit) : ok).sort((a, b) => (b.kind === 'review' || b.kind === 'comment') - (a.kind === 'review' || a.kind === 'comment') || String(a.text || '').length - String(b.text || '').length).slice(0, 2).map(quoteOfItem); };
/* separate conversations (one video's comment section is one) */
const convos = (xs) => new Set(xs.map((x) => x.thread || x.threadUrl || x.link || x.id)).size;
const recentOf = (L, now) => (L?.items || []).filter((x) => x && x.mode !== 'asked' && (x.postedAt || 0) > now - WINDOW && (x.postedAt || 0) <= now + DAY);
export function rivalCards(L, { now = Date.now(), name = 'the brand', at = now, lane, roles = ['founder', 'brand', 'growth'], max = 2, profile = {} } = {}) {
  const rivals = (L?.config?.rivals || []).filter((r) => typeof r === 'string' && squash(r).length >= 3); if (!rivals.length) return [];
  const xs = recentOf(L, now).filter((x) => x.about === 'rival'), by = new Map(rivals.map((r) => [r, []]));
  for (const x of xs) { const t = squash(`${x.title || ''} ${x.text || ''} ${x.sub || ''} ${x.threadTitle || ''}`); const r = rivals.find((r) => t.includes(squash(r))); if (r) by.get(r).push(x); }
  const out = [];
  /* a complaint is a theme most of whose mentions are negative (a topic like "product review" is not one) */
  const complaints = (ys, neg) => { const all = Object.fromEntries(themeCount(ys)); return themeCount(neg).filter(([t, n]) => n >= 2 && n / (all[t] || n) >= 0.4 && !META_THEME.test(t)).slice(0, 2).map(([t]) => t); };
  const ranked = [...by.entries()].map(([r, ys]) => { const neg = ys.filter((y) => y.sentiment === 'neg'); return { r, ys, neg, th: complaints(ys, neg) }; })
    .filter((v) => v.ys.length >= 6 && v.neg.length >= 4 && v.neg.length / v.ys.length >= 0.15 && v.th.length && convos(v.neg) >= 3).sort((a, b) => b.neg.length - a.neg.length || b.ys.length - a.ys.length);
  for (const { r, ys, neg, th } of ranked.slice(0, max)) {
    const pos = ys.filter((y) => y.sentiment === 'pos').length, negP = pct(neg.length, ys.length), quotes = bestQuotes(neg, { words: th.join(' '), profile }).concat(bestQuotes(neg, { profile })).filter((q, i, a) => a.findIndex((x) => x.url === q.url) === i).slice(0, 2);
    const since = Math.min(...ys.map((y) => y.postedAt || now));
    out.push({ id: `heard-r-${hash(r)}`, agent: 'brew', sector: 'signals', type: 'report', family: 'learning', kind: 'rows', ...(lane ? { lane } : {}), roles, origin: 'listen', stream: 'heard',
      src: `Heard · ${r} · ${ys.length} mentions`, time: ageText(at, now), badge: ['Rival', 'warn'],
      title: th.length ? `What people dislike about ${r}: ${th.join(' and ')}` : `${neg.length} people unhappy with ${r} lately`,
      sub: quotes[0] ? `“${quotes[0].text}” (${quotes[0].where})` : `${neg.length} of ${ys.length} public posts about ${r} were negative.`,
      rows: [['Mentions', `${ys.length} since ${dateText(since)}`], ['Mood', `${pos} positive · ${neg.length} negative (${negP}%)`], ...(th.length ? [['Top complaints', th.join(', ')]] : []), ['Where', whereOf(ys)]],
      ...(quotes[0]?.url ? { link: { label: `Read it in ${quotes[0].where}`, url: quotes[0].url } } : {}), cta: { label: 'Win their unhappy buyers' },
      detail: { why: [...quotes.map((q) => `“${q.text}” (${q.where})`), `Counted from ${ys.length} public posts, comments and reviews that name ${r}, last 90 days.`],
        how: [th.length ? `Show how ${name} handles ${th[0]}, in the ads and on the product page where ${r}'s buyers compare.` : `Show where ${name} does better, in the ads and on the product page.`, `Reply where people complain, as ${name}: help first, say who you are, never knock ${r}.`, 'Brew keeps counting, so you see if it moves.'] },
      heard: { kind: 'rival', name: r, n: ys.length, neg: neg.length, pos, themes: th, quotes } });
  }
  return out;
}
export function categoryCards(L, { now = Date.now(), name = 'the brand', at = now, lane, roles = ['founder', 'brand', 'growth'], max = 1, skip = new Set(), profile = {} } = {}) {
  const xs = recentOf(L, now).filter((x) => x.about === 'category' && ['question', 'complaint'].includes(x.intent)); if (xs.length < 5) return [];
  const noun = L?.config?.noun || 'the category', out = [];
  for (const [t, n] of themeCount(xs)) { if (out.length >= max) break; if (n < 5 || skip.has(norm(t)) || META_THEME.test(t)) continue;
    const ys = xs.filter((x) => (x.themes || []).includes(t)), q = ys.filter((x) => x.intent === 'question').length, cpl = ys.length - q, quotes = bestQuotes(ys, { words: t, profile }), asks = q >= cpl;
    if (!quotes.length || convos(ys) < 3) continue; /* no post that says it in the theme's own words, or all of it one conversation: not sure enough to show */
    out.push({ id: `heard-c-${hash(t)}`, agent: 'brew', sector: 'signals', type: 'report', family: 'learning', kind: 'rows', ...(lane ? { lane } : {}), roles, origin: 'listen', stream: 'heard',
      src: `Heard · ${noun} buyers · ${ys.length} posts`, time: ageText(at, now), badge: [asks ? 'Asked' : 'Complaint', asks ? 'info' : 'warn'],
      title: asks ? `Buyers keep asking about ${t}: ${ys.length} posts, none of them about ${name} yet` : `What buyers complain about in ${noun}: ${t}, ${ys.length} posts`,
      sub: quotes[0] ? `“${quotes[0].text}” (${quotes[0].where})` : `${ys.length} public posts about ${t}.`,
      rows: [['Posts', `${ys.length} in the last 90 days`], ['Questions', String(q)], ['Complaints', String(cpl)], ['Where', whereOf(ys)]],
      ...(quotes[0]?.url ? { link: { label: `Read it in ${quotes[0].where}`, url: quotes[0].url } } : {}), cta: { label: asks ? 'Answer it in a post' : 'Show how we solve it' },
      detail: { why: [...quotes.map((x) => `“${x.text}” (${x.where})`), `Counted from public posts about ${noun} that do not name a brand, last 90 days.`],
        how: [asks ? `Answer it once, well: a post, a reel or an FAQ on the product page that ${name} can link to.` : `Show how ${name} solves it, with the product, in the next post or ad.`, 'Reply where it comes up, as the brand.', 'Brew keeps counting, so you see if it moves.'] },
      heard: { kind: 'category', name: t, n: ys.length, questions: q, complaints: cpl, quotes } });
  }
  return out;
}

/* ---------- into the seed, next to visualize ---------- */
export function socialize(seed, social, { now = Date.now(), profile = {} } = {}) {
  if (!social || !seed) return seed;
  try {
    const have = new Set((seed.posts || []).map((p) => p.id));
    const add = [...heardCards(social.listen, seed, { now, profile }), ...ideaCards(pickIdeas(social.ideas, { now, profile }), seed, { now })].filter((c) => !have.has(c.id) && (have.add(c.id), true));
    return add.length ? { ...seed, posts: [...(seed.posts || []), ...add] } : seed;
  } catch { return seed; } // the feed never breaks on a bad file
}
// a pack is re-read on every page view: keep what was read for 10 minutes (a run clears it at once with forgetSocial)
const SOCIAL_MEMO = new Map();
export const forgetSocial = (slug) => SOCIAL_MEMO.delete(slug);
export async function readSocial(packs, slug, { ttlMs = 10 * 60e3 } = {}) {
  const m = SOCIAL_MEMO.get(slug); if (m && Date.now() - m.at < ttlMs) return m.v;
  const v = await readSocialNow(packs, slug); SOCIAL_MEMO.set(slug, { at: Date.now(), v }); if (SOCIAL_MEMO.size > 500) SOCIAL_MEMO.clear(); return v;
}
async function readSocialNow(packs, slug) {
  const g = (n) => packs.getJSON(slug, n, null).catch(() => null);
  const [ideas, threads, themes, comms, status, config] = await Promise.all([g('ideas/ideas.json'), g('listen/threads.json'), g('listen/themes.json'), g('listen/communities.json'), g('listen/status.json'), g('listen/config.json')]);
  if (!ideas?.items?.length && !threads?.threads?.length && !themes?.themes?.length) return null;
  // items only to resolve the quotes of the themes we show (the file is big; read it only when themes exist)
  const items = themes?.themes?.length ? (await g('listen/items.json'))?.items || [] : [];
  return { ideas: ideas?.items || [], listen: { threads: threads?.threads || [], themes: themes?.themes || [], total: themes?.total || 0, communities: comms?.communities || [], status, items, config: config ? { rivals: config.rivals || [], noun: config.noun || '', terms: config.terms || {}, category: config.category || '' } : null } };
}

/* ---------- What Brew learned → Heard ---------- */
export function heardView(L, { name = 'the brand', now = Date.now(), profile = {} } = {}) {
  if (!L || (!L.themes?.length && !L.threads?.length)) return null;
  const items = new Map((L.items || []).map((x) => [x.id, x]));
  const quote = (x) => x && ({ text: cut([x.title, x.text].filter(Boolean).join('. '), 220), url: x.link, where: x.sub || x.platform, at: x.postedAt || null });
  const themes = (L.themes || []).filter((t) => t.n >= 3).slice(0, 4).map((t) => ({ name: t.name, n: t.n, share: t.share, pos: t.pos, neg: t.neg, neutral: t.neutral, brand: t.brand, week: t.wow?.week ?? null, lastWeek: t.wow?.lastWeek ?? null,
    quotes: (t.quoteIds || []).map((id) => quote(items.get(id))).filter(Boolean).slice(0, 2).concat(!(t.quoteIds || []).some((id) => items.has(id)) && t.quote ? [{ text: cut(t.quote, 220), url: t.quoteLink, where: '' }] : []).slice(0, 2) }));
  /* the communities that pass the community gate (about the category, in the market, not deals or general chat), and the
     questions from the last two weeks there; a reply count only when it is the platform's own or a floor */
  const stems = L.config ? topicStems({ noun: L.config.noun, terms: [...(L.config.terms?.category || []), String(L.config.category || '')] }) : null;
  const communities = (L.communities || []).filter((c) => c.platform !== 'reddit' || usableCommunity(c, { profile, stems }).ok).slice(0, 5).map((c) => ({ name: c.name, url: c.url, posts: c.posts, threads: c.threads, brand: c.brand, questions: c.questions, why: c.why, lastActive: c.lastActive }));
  const questions = (L.threads || []).filter((t) => t.url && asksQ(t) && !NOT_A_PLACE.test(`${t.where} ${t.title}`) && (t.platform !== 'reddit' || usableThread({ ...t, sub: /^r\//.test(t.where || '') ? t.where : '', text: t.quote }, { now, profile, brand: name }).ok)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5)
    .map((t) => ({ title: t.title, url: t.url, where: t.where, replies: t.repliesLive || t.repliesFloor ? t.replies : null, ...(t.repliesFloor ? { repliesFloor: true } : {}), lastActive: t.lastActive, about: t.about }));
  const st = L.status || {}, okSources = Object.entries(st.sources || {}).filter(([, s]) => s.state === 'ok').map(([, s]) => s.name);
  /* sources the last run could not read, with why: shown as not read, never as "none found" */
  /* a source skipped on purpose (not sold there, no channel known) is not a failure: only real errors are listed as "couldn't read" */
  const skippedOnPurpose = (s) => /^skipped:/i.test(String(s.error || ''));
  const failed = Object.values(st.sources || {}).filter((s) => ['error', 'needs'].includes(s.state) && !skippedOnPurpose(s)).map((s) => ({ name: s.name, why: String(s.error || '').slice(0, 120) }));
  const skipped = Object.values(st.sources || {}).filter((s) => skippedOnPurpose(s)).map((s) => ({ name: s.name, why: String(s.error || '').replace(/^skipped:\s*/i, '').slice(0, 120) }));
  // everything heard, counted by where it was said (display names only), by how (heard without asking, or replies to a question the brand asked)
  // and by reach (direct: about the brand; indirect: about rivals, the category or a problem it solves)
  const all = L.items || [], cnt = {}; all.forEach((x) => { if (x.platform) cnt[x.platform] = (cnt[x.platform] || 0) + 1; });
  // a source the last run counted items for shows even when the items file read here is missing them
  for (const [id, s] of Object.entries(st.sources || {})) if (!cnt[id] && s?.total > 0) cnt[id] = s.total;
  const sources = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: sourceName(id), n }));
  const byMode = { heard: all.filter((x) => (x.mode || 'heard') === 'heard').length, asked: all.filter((x) => x.mode === 'asked').length };
  const direct = (x) => (x.reach ? x.reach === 'direct' : x.about === 'brand'), byReach = { direct: all.filter(direct).length, indirect: all.filter((x) => !direct(x)).length };
  return { name, at: st.at || null, items: st.items ?? all.length, total: all.length || st.items || 0, byMode, byReach, tagged: L.total || null, sources: sources.length ? sources : okSources.map((n) => ({ id: n, name: n, n: null })), okSources, failed, skipped, themes, communities, questions };
}

/* ---------- the background scheduler ---------- */
// Gating is pure so tests can drive it: kill switches, mock, the last-open window, the cadence and the daily cap.
// Listening runs every 8 hours: the first run of a day (every listenFullEveryH) is the full paid sweep under listenRunCapUsd,
// the runs between are light reads (free sources plus a few newest-first paid searches) under listenLiteCapUsd.
export const SOCIAL_DEFAULTS = { tickMs: 30 * 60e3, firstMs: 2 * 60e3, listenEveryH: 8, listenFullEveryH: 24, ideasEveryH: 24, openDays: 3, dayCapUsd: 3, ideasN: 6, ideasEstUsd: 1, listenEstUsd: 0.3, listenLiteEstUsd: 0.05, listenRunCapUsd: 0.6, listenLiteCapUsd: 0.15, perTick: 3 };
export function socialConfig(env = process.env) {
  const n = (k, d) => (env[k] != null && env[k] !== '' && Number.isFinite(+env[k]) ? +env[k] : d);
  return { ...SOCIAL_DEFAULTS, dayCapUsd: n('SOCIAL_DAY_CAP_USD', SOCIAL_DEFAULTS.dayCapUsd), ideasN: n('IDEAS_N', SOCIAL_DEFAULTS.ideasN), listenEveryH: n('LISTEN_EVERY_H', SOCIAL_DEFAULTS.listenEveryH), ideasEveryH: n('IDEAS_EVERY_H', SOCIAL_DEFAULTS.ideasEveryH),
    listenRunCapUsd: n('LISTEN_RUN_CAP_USD', SOCIAL_DEFAULTS.listenRunCapUsd), listenLiteCapUsd: n('LISTEN_LITE_CAP_USD', SOCIAL_DEFAULTS.listenLiteCapUsd), listenFullEveryH: n('LISTEN_FULL_EVERY_H', SOCIAL_DEFAULTS.listenFullEveryH),
    // every source runs by default (paid ones under the per-run and daily caps); LISTEN_PAID=0 keeps listening to free sources
    listenOff: env.LISTEN_OFF === '1', ideasOff: env.IDEAS_OFF === '1', paid: env.LISTEN_PAID !== '0',
    // local servers set RESEARCH_OFF/LIVE_OFF: nothing runs in the background there unless SOCIAL_BG=1 asks for it
    off: env.SOCIAL_BG === '0' || (env.SOCIAL_BG !== '1' && (!!env.RESEARCH_OFF || !!env.LIVE_OFF)), mock: env.AI_MOCK === '1', tregOff: env.TREG_OFF === '1' };
}
const today = (now) => new Date(now).toISOString().slice(0, 10);
export const spentToday = (st, now) => (st?.spend?.day === today(now) ? st.spend.usd || 0 : 0);
// what is due for one brand right now, and why not when it isn't
export function dueFor(st = {}, cfg, { now = Date.now(), aiLive = true, ready = true } = {}) {
  const why = [], left = cfg.dayCapUsd - spentToday(st, now);
  if (cfg.off) return { listen: false, ideas: false, why: ['background work is off here (SOCIAL_BG / RESEARCH_OFF / LIVE_OFF)'] };
  if (cfg.mock || !aiLive) return { listen: false, ideas: false, why: ['AI is on mock: nothing runs, nothing is spent'] };
  if (!ready) return { listen: false, ideas: false, why: ['the brand is not built yet'] };
  let listen = !cfg.listenOff && now - (st.lastListen || 0) >= cfg.listenEveryH * H;
  if (cfg.listenOff) why.push('LISTEN_OFF'); else if (!listen) why.push(`listened in the last ${cfg.listenEveryH} hours`);
  // the full paid sweep once a day; the runs between are light (a run before this field existed counts as not full)
  const listenFull = now - (st.lastFullListen || 0) >= cfg.listenFullEveryH * H, listenEst = listenFull ? cfg.listenEstUsd : cfg.listenLiteEstUsd;
  const opened = st.lastOpen && now - st.lastOpen <= cfg.openDays * DAY;
  let ideas = !cfg.ideasOff && opened && now - (st.lastIdeas || 0) >= cfg.ideasEveryH * H && today(st.lastIdeas || 0) !== today(now);
  if (cfg.ideasOff) why.push('IDEAS_OFF'); else if (!opened) why.push(`nobody opened it in the last ${cfg.openDays} days`); else if (!ideas) why.push('ideas already made today');
  if (listen && left < listenEst) { listen = false; why.push(`daily cap $${cfg.dayCapUsd} (spent $${(cfg.dayCapUsd - left).toFixed(2)})`); }
  if (ideas && left - (listen ? listenEst : 0) < cfg.ideasEstUsd) { ideas = false; why.push(`daily cap $${cfg.dayCapUsd} leaves too little for ideas`); }
  return { listen, listenFull, ideas, left: +left.toFixed(4), why };
}

export function createSocialScheduler({ packs, ai, treg, memory = null, log = console, now = () => Date.now(), env = process.env, onFresh = async () => {}, make = {} } = {}) {
  const cfg = socialConfig(env);
  const P = 'social/state.json', mem = new Map(), opens = new Map(), rotDay = new Map();
  const stateOf = async (slug) => { if (mem.has(slug)) return mem.get(slug); const s = (await packs.getJSON(slug, P, null).catch(() => null)) || {}; mem.set(slug, s); return s; };
  const save = async (slug, s) => { mem.set(slug, s); await packs.put(slug, P, s).catch((e) => log.warn?.('[social] state', slug, e.message)); };
  const charge = (s, usd) => { const d = today(now()); if (s.spend?.day !== d) s.spend = { day: d, usd: 0 }; s.spend.usd = +((s.spend.usd || 0) + (usd || 0)).toFixed(4); };
  // someone opened this brand's feed (kept in memory, written at most once an hour)
  async function opened(slug) {
    if (!slug) return; const t = now(), last = opens.get(slug) || 0; opens.set(slug, t); if (t - last < H) return;
    try { const s = await stateOf(slug); s.lastOpen = t; await save(slug, s); } catch {}
  }
  const W = make.listen || ((slug) => createListenWatch({ slug, packs, treg, ai, log }));
  const I = make.ideas || ((slug, o = {}) => createIdeas({ slug, packs, ai, treg: cfg.tregOff ? null : treg, log, member: !!o.member }));
  /* a brand whose team connected real accounts also gets the team's own ideas (private/ideas/), written with their facts */
  const hasAccounts = async (slug) => Object.values((await packs.getJSON(slug, 'private/facts.json', null).catch(() => null))?.facts || {}).some((f) => f?.kind === 'connected');
  async function remember(slug, r) {
    if (!memory || !r?.themes?.length) return;
    const src = { kind: 'live', label: `Public listening (${Object.values(r.status?.sources || {}).filter((x) => x.state === 'ok').map((x) => x.name).join(', ') || 'Reddit'}), read ${today(now())}` };
    const lines = r.themes.slice(0, 3).map((t) => ({ key: `listen.theme.${norm(t.name).replace(/ /g, '-')}`, text: `People talk about ${t.name} in ${t.n} public posts and comments (${t.pos} positive, ${t.neg} negative), e.g. "${cut(t.quote, 120)}"`, url: t.quoteLink }));
    const cm = r.communities?.[0]; if (cm) lines.push({ key: 'listen.community.top', text: `The most active community for the brand is ${cm.name} (${cm.posts} posts heard; ${cm.why})`, url: cm.url });
    for (const x of lines) await memory.add(slug, x.text, { key: x.key, topic: 'audience', infer: false, source: { ...src, url: x.url } }).catch((e) => log.warn?.('[social] memory', e.message));
  }
  async function runOne(slug, due) {
    const s = await stateOf(slug); let changed = false;
    if (due.listen) { const full = due.listenFull !== false; s.lastListen = now(); if (full) s.lastFullListen = now(); await save(slug, s);
      const w = W(slug);
      try { const r = await w.run({ paid: cfg.paid, lite: !full, capUsd: Math.max(0, Math.min(full ? cfg.listenRunCapUsd : cfg.listenLiteCapUsd, due.left)) });
        charge(s, r?.status?.usd?.total || 0); s.listen = { at: now(), full, items: r?.status?.items ?? null, usd: r?.status?.usd?.total || 0 }; changed = !r?.busy; if (!r?.busy) await remember(slug, r); }
      catch (e) { const part = +e?.usd || w.status?.usd?.total || 0; if (part) charge(s, part); /* a run that failed after spending still counts */ s.listen = { at: now(), error: e.message }; log.warn?.('[social] listen', slug, e.message); }
      // asked threads: re-read the replies to questions the brand posted (1, 3, 7 and 14 days after posting)
      if (w.askedRun && cfg.paid) try { const a = await w.askedRun({ capUsd: Math.max(0, Math.min(0.1, due.left - (s.listen?.usd || 0))) }); if (a?.read) { charge(s, a.usd || 0); s.asked = { at: now(), read: a.read, usd: a.usd || 0 }; changed = true; } }
      catch (e) { s.asked = { at: now(), error: e.message }; log.warn?.('[social] asked', slug, e.message); } }
    if (due.ideas && cfg.dayCapUsd - spentToday(s, now()) < cfg.ideasEstUsd) { s.ideas = { at: now(), skipped: `daily cap $${cfg.dayCapUsd} reached after listening` }; due = { ...due, ideas: false }; } /* re-check with what listening really spent */
    if (due.ideas) { s.lastIdeas = now(); await save(slug, s);
      const ideas = I(slug);
      try { const r = await ideas.next({ n: cfg.ideasN }); charge(s, (r?.usd?.ai || 0) + (r?.usd?.treg || 0)); s.ideas = { at: now(), made: r?.ideas?.length || 0, usd: r?.usd || null, ...(r?.dropped?.length ? { dropped: r.dropped.slice(0, 12).map((d) => ({ title: cut(d.title, 90), platform: d.platform, why: (d.why || []).slice(0, 2).map((w) => cut(w, 160)) })) } : {}) }; /* why ideas were dropped, so a thin run explains itself */ if (!s.ideas.made) { s.ideas.empty = true; log.warn(`[ideas] ${slug}: a paid run made no ideas ($${((r?.usd?.ai || 0) + (r?.usd?.treg || 0)).toFixed(2)})`); } /* an empty paid run is flagged, not silent */ changed = true; }
      catch (e) { charge(s, (ideas.spend?.ai || 0) + (ideas.spend?.treg || 0)); s.ideas = { at: now(), error: e.message }; log.warn?.('[social] ideas', slug, e.message); } }
    /* the team's ideas: the same day, under what is left of the same daily cap */
    if (due.ideas && await hasAccounts(slug)) {
      if (cfg.dayCapUsd - spentToday(s, now()) < cfg.ideasEstUsd) s.memberIdeas = { at: now(), skipped: `daily cap $${cfg.dayCapUsd} reached` };
      else { const mi = I(slug, { member: true });
        try { const r = await mi.next({ n: cfg.ideasN }); charge(s, (r?.usd?.ai || 0) + (r?.usd?.treg || 0)); s.memberIdeas = { at: now(), made: r?.ideas?.length || 0, usd: r?.usd || null }; changed = true; }
        catch (e) { charge(s, (mi.spend?.ai || 0) + (mi.spend?.treg || 0)); s.memberIdeas = { at: now(), error: e.message }; log.warn?.('[social] member ideas', slug, e.message); } } }
    await save(slug, s);
    if (changed) await onFresh(slug).catch((e) => log.warn?.('[social] refresh', slug, e.message));
    return s;
  }
  let busy = false;
  async function tick() {
    if (busy) return { busy: true }; busy = true; const ran = [];
    try {
      const brands = (await packs.list().catch(() => [])).filter((b) => b.slug && b.status?.name);
      for (const b of brands) {
        const s = await stateOf(b.slug); if (opens.get(b.slug) > (s.lastOpen || 0)) s.lastOpen = opens.get(b.slug);
        const due = dueFor(s, cfg, { now: now(), aiLive: ai?.live !== false, ready: !!b.status.ready });
        // the feed's rotation turns over once a day for brands people look at, even when nothing new was made
        const opened = s.lastOpen && now() - s.lastOpen <= cfg.openDays * DAY;
        if (!due.listen && !due.ideas) { if (opened && rotDay.has(b.slug) && rotDay.get(b.slug) !== dayIndex(now())) await onFresh(b.slug).catch(() => {}); rotDay.set(b.slug, dayIndex(now())); continue; }
        if (ran.length >= cfg.perTick) break;
        ran.push(b.slug); rotDay.set(b.slug, dayIndex(now()));
        await runOne(b.slug, due).catch((e) => log.warn?.('[social] run', b.slug, e.message));
      }
    } finally { busy = false; }
    return { ran };
  }
  let timer = null;
  const start = () => { if (timer || cfg.off || cfg.mock) { log.log?.(`[social] background listening and ideas ${cfg.off ? 'off here' : cfg.mock ? 'off (AI mock)' : 'already on'}`); return false; }
    timer = setTimeout(function go() { tick().catch((e) => log.warn?.('[social] tick', e.message)).finally(() => { timer = setTimeout(go, cfg.tickMs); timer.unref?.(); }); }, cfg.firstMs); timer.unref?.(); return true; };
  return { cfg, tick, start, opened, runOne, stateOf, due: async (slug, ready = true) => dueFor(await stateOf(slug), cfg, { now: now(), aiLive: ai?.live !== false, ready }) };
}
