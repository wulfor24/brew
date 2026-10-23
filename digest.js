// The weekly digest: what changed for a brand in Brew this week, one email per person on its team, on Monday morning in the
// brand's own time. It is what pulls a lapsed teammate back: the moves Brew rewrote and why, the new weekly moves, rival ads
// Brew spotted, what people are saying (the top theme and one question someone asked, with its link), the next date on the
// calendar and the jams waiting on that person. Built only from files already in the pack: no AI call, no paid call.
// Titles only: a move written from the team's connected accounts is named by its shared title, or only counted, so no
// private number reaches an inbox or a Slack channel. Nothing new in every section: no email.
//
//   private/digest.json   { lastAt, sent: { email: at }, n, subject, slack, emptyAt }
//
// Recipients: everyone on the team (private/members.json) and the person who started the read (private/created.json), once
// each, minus anyone who turned Brew's emails off (private/mail-prefs.json mail: 'off', the switch the jam emails' footer sets).
// Schedule: checked hourly; due on a Monday at 09:00 or later, brand time (config.timezone, else config.tzOffsetH, else IST),
// once seven calendar days have passed since the last one (the first one seven days after the brand became Ready).
// Live site only (server.js starts it on Cloud Run), never on the demo site. If the brand's Slack is connected, the same
// lines go to its channel once.
import { emailHtml, esc, p as mailP, list as mailList, heading, images as mailImages, footLink } from './mail-layout.js';
import { officialFor } from './auth.js'; // the read's starter hears about the brand only on its official email
import { moveLabel, moveNum, moveSay } from './move-label.js'; // weekly moves read "Weekly move 11", never "Move 1011" (QA FEED-QA-12)

const DAY = 864e5, WEEK = 7 * DAY, IST = 5.5;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const lc = (e) => String(e || '').trim().toLowerCase();
const pad2 = (n) => String(n).padStart(2, '0');
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v || '') || 0);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const realAddr = (e) => EMAIL.test(e) && !/@demo\.brew$/i.test(e);
const getJ = (packs, slug) => (f, d = null) => Promise.resolve().then(() => packs.getJSON(slug, f, d)).then((v) => v ?? d).catch(() => d);

/** who hears from Brew about a brand: the addresses that asked (extra), the person who started its read and everyone on its
    team, lowercased and once each, never a demo address and never anyone whose mail is off. membersOnly: the team alone */
export async function teamRecipients(packs, slug, { extra = [], membersOnly = false } = {}) {
  const g = getJ(packs, slug);
  const [created, members, prefs, st] = await Promise.all([g('private/created.json'), g('private/members.json'), g('private/mail-prefs.json'), g('status.json')]);
  const by = officialFor(created?.by, members?.host || st?.host) ? created.by : null; /* a starter on Gmail or another domain is not the team */
  const team = [...(members?.members || []).map((m) => m?.email), members?.owner];
  const off = (e) => prefs?.[e]?.mail === 'off';
  return [...new Set((membersOnly ? team : [...extra, by, ...team]).map(lc).filter((e) => realAddr(e) && !off(e)))];
}

/* ---------- the brand's clock ---------- */
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** the brand's local date, weekday and hour: config.timezone (an IANA zone; 'UTC' is derive.js's "unknown market"), else
    config.tzOffsetH, else India */
export function localNow(ms, cfg = {}) {
  const tz = cfg?.timezone && cfg.timezone !== 'UTC' ? cfg.timezone : null;
  if (tz) try {
    const P = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { ymd: `${P.year}-${P.month}-${P.day}`, day: WD[P.weekday], hour: +P.hour % 24, minute: +P.minute };
  } catch { /* an unknown zone: the offset below */ }
  const off = cfg?.timezone !== 'UTC' && cfg?.tzOffsetH != null && cfg.tzOffsetH !== '' && Number.isFinite(+cfg.tzOffsetH) ? +cfg.tzOffsetH : IST;
  const d = new Date(ms + off * 3600e3);
  return { ymd: d.toISOString().slice(0, 10), day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
/** due: a Monday at 09:00 or later, brand time, seven calendar days or more after the last digest (or after Ready) */
export function digestDue({ now = Date.now(), lastAt = 0, readyAt = 0, cfg = {} } = {}) {
  const since = +lastAt || +readyAt; if (!since) return false;
  const L = localNow(now, cfg); if (L.day !== 1 || L.hour < 9) return false;
  return daysBetween(localNow(since, cfg).ymd, L.ymd) >= 7;
}

/* ---------- what changed, from the pack's own files ---------- */
const NOT_A_PLACE = /marketplace|buysell|buy_sell|deals?\b|coupon|loot/i; /* the same rules as the Heard panel (social-feed.js) */
const asksQ = (t) => t?.intent === 'question' && !!t.url && (/\?/.test(String(t.title || '')) || !/youtube\.com|youtu\.be|tiktok\.com|instagram\.com/i.test(String(t.url || ''))) && !NOT_A_PLACE.test(`${t.where || ''} ${t.title || ''}`);
const OPEN = (w) => w && !w.archived && !w.discarded && !['out', 'measuring', 'result'].includes(w.stage);

/** the jams waiting on this person: given to them, or asking for the team's OK with nobody named */
export function jamsFor(jams, email) {
  const e = lc(email);
  return (jams?.work || []).filter((w) => OPEN(w) && (lc(w.assignee?.email) === e || (w.stage === 'needs_you' && !w.assignee?.email)))
    .sort((a, b) => (+b.updatedAt || 0) - (+a.updatedAt || 0)).slice(0, 5)
    .map((w) => ({ id: w.id, title: cut(w.title || 'A jam', 70), ask: w.assignee?.ask === 'approve' || w.stage === 'needs_you' ? 'needs your OK' : 'is yours' }));
}

/** every section but the person's jams: { rewritten, weekly, teamOnly, rivalAds, theme, question, event, images, needsOk } */
export async function digestContent(packs, slug, { since, now = Date.now(), base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com' } = {}) {
  const g = getJ(packs, slug), year = new Date(now).getUTCFullYear();
  const [pub, priv, themes, threads, lstatus, cfg, drafts, research, cal0, cal1, jams] = await Promise.all([g('moves.json', {}), g('private/moves.json', {}), g('listen/themes.json'), g('listen/threads.json'), g('listen/status.json'),
    g('config.json', {}), g('drafts/cards.json', {}), g('research.json'), g(`calendar/${year}.json`), g(`calendar/${year + 1}.json`), g('private/jams.json')]);
  const P = pub || {}, Q = priv || {}, after = (v) => toMs(v) > since;
  /* moves Brew rewrote: a shared one with its reason; a team-only one by its shared title (never the private version's words) */
  const rewritten = [], teamOnly = { rewritten: 0, weekly: 0 };
  for (const [k, m] of Object.entries(P)) { const n = +k; if (n >= 1 && n < 1000 && after(m?.meta?.rewrittenAt)) rewritten.push({ n, title: cut(m.title, 90), because: Q[k] ? null : cut(m.meta?.because || '', 160) || null }); }
  for (const [k, m] of Object.entries(Q)) { const n = +k; if (!(n >= 1 && n < 1000) || !after(m?.meta?.rewrittenAt) || rewritten.some((x) => x.n === n)) continue;
    if (P[k]?.title) rewritten.push({ n, title: cut(P[k].title, 90), because: null, team: true }); else teamOnly.rewritten++; }
  rewritten.sort((a, b) => a.n - b.n);
  /* the week's new moves (listening and automation moves, numbered from 1001) */
  const weekly = Object.entries(P).filter(([k, m]) => +k >= 1001 && after(m?.meta?.at)).map(([k, m]) => ({ n: +k, title: cut(m.title, 90) })).sort((a, b) => a.n - b.n);
  teamOnly.weekly = Object.entries(Q).filter(([k, m]) => +k >= 1001 && !P[k] && after(m?.meta?.at)).length;
  /* what people say: only when listening ran since the last digest (a stale theme is not news) */
  const heardNew = after(lstatus?.at);
  const top = heardNew ? (themes?.themes || []).filter((t) => t?.name && +t.n >= 3).sort((a, b) => (+b.n || 0) - (+a.n || 0))[0] : null;
  const q = heardNew ? (threads?.threads || []).filter(asksQ).sort((a, b) => (+b.score || 0) - (+a.score || 0))[0] : null;
  /* rival ads Brew spotted since (research.js Popular ads: first seen) */
  const seenAds = new Map(); for (const a of [...(research?.ads?.items || []), ...(research?.ads?.archive || [])]) if (a?.id && after(a.firstSeen) && !seenAds.has(a.id)) seenAds.set(a.id, a);
  const rivalAds = [...seenAds.values()].sort((a, b) => (+a.rank || 99) - (+b.rank || 99)).map((a) => ({ brand: cut(a.brand || a.page || 'A rival', 40), title: cut(a.title || a.headline || a.hook || '', 80) }));
  /* the next date on the brand's calendar (calendar.js saves calendar/<year>.json), within 30 days */
  const today = new Date(now).toISOString().slice(0, 10);
  const ev = [...(cal0?.events || []), ...(cal1?.events || [])].filter((e) => e?.name && e.date && (e.end || e.date) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const evDays = ev ? Math.max(0, Math.round((Date.parse(`${ev.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY)) : null;
  const event = ev && evDays <= 30 ? { name: cut(ev.name, 60), date: ev.date, days: evDays } : null;
  /* pictures: first drafts made since, else the static ads from the ad plan; public files only */
  const abs = (u) => { const s = String(u || ''); if (/^https:\/\//.test(s)) return s.startsWith(base) ? s : null; return /^\/?(gen|b)\/[\w./-]+\.(png|jpe?g|webp)$/i.test(s) ? `${base}/${s.replace(/^\//, '')}` : null; };
  const fresh = Object.values(drafts || {}).filter((d) => d && after(d.at)).sort((a, b) => toMs(b.at) - toMs(a.at)).map((d) => abs(d.render || d.image || d.slides?.[0]?.image)).filter(Boolean);
  const statics = (cfg?.statics || []).map((id) => abs(`b/${slug}/statics/${id}.jpg`)).filter(Boolean);
  const images = [...new Set([...fresh, ...statics])].slice(0, 3);
  const needsOk = (jams?.work || []).filter((w) => OPEN(w) && w.stage === 'needs_you').length;
  /* on the shelf this week: a price move or a new out-of-stock on Blinkit, Zepto, Instamart or a marketplace since the last digest (market-pulse.js) */
  const shelfFiles = await Promise.all(['blinkit', 'zepto', 'instamart', 'nykaa', 'flipkart', 'myntra', 'amazon'].map((k) => g(`shelf/${k}.json`)));
  const shelf = shelfFiles.filter((f) => f && !f.error && after(f.at)).flatMap((f) => (f.changes || []).map((ch) => ({ ...ch, where: f.label + (f.city ? ` (${f.city})` : '') })))
    .sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0)).slice(0, 4).map((ch) => (ch.kind === 'stock' ? `${ch.who}: ${cut(ch.name, 50)} went out of stock on ${ch.where}` : `${ch.who}: ${cut(ch.name, 50)} ${ch.from} → ${ch.to} on ${ch.where}`));
  const out = { since, rewritten, weekly, teamOnly, rivalAds, shelf, theme: top ? { name: cut(top.name, 60), n: +top.n } : null,
    question: q ? { title: cut(q.title, 120), url: q.url, where: cut(q.where || '', 40) } : null, event, images, needsOk };
  Object.defineProperty(out, 'jams', { value: jams, enumerable: false }); /* each person's own jams are picked from it (jamsFor), never listed whole */
  return out;
}

/* ---------- the email ---------- */
const join2 = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] || '');
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** one person's digest: { subject, html, text, empty } (empty: nothing new for them, no email) */
export function digestMail({ name, slug, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', c, jams = [], prefHref = null }) {
  const href = `${base}/${slug}?go=feed`;
  const nMoves = c.rewritten.length + c.teamOnly.rewritten, nNew = c.weekly.length + c.teamOnly.weekly, nAds = c.rivalAds.length;
  const empty = !nMoves && !nNew && !nAds && !(c.shelf || []).length && !c.theme && !c.question && !c.event && !jams.length;
  if (empty) return { empty: true };
  const parts = [nNew && plural(nNew, 'new move'), nMoves && plural(nMoves, 'updated move'), nAds && (nAds === 1 ? 'a rival ad' : `${nAds} rival ads`), (c.shelf || []).length && ((c.shelf || []).length === 1 ? 'a change on the shelf' : `${c.shelf.length} changes on the shelf`), jams.length && `${plural(jams.length, 'jam')} waiting on you`,
    c.question && 'a question people asked', c.event && `${c.event.name} coming up`].filter(Boolean);
  const subject = parts.length ? `${parts.slice(0, 2).join(' and ')} for ${name} this week` : `What people said about ${name} this week`;
  const html = [], text = [];
  const sec = (h, items, after = '') => { if (!items.length) return; html.push(heading(h) + mailList(items) + after); text.push(`${h}\n${items.map((x) => `- ${x}`).join('\n')}`); };
  if (jams.length) sec('Waiting on you', jams.map((j) => `“${j.title}” ${j.ask}`));
  sec('Moves Brew rewrote', [...c.rewritten.slice(0, 8).map((m) => `${moveLabel(m.n)} · ${m.title}${m.because ? `: ${m.because}` : ''}`), ...(c.teamOnly.rewritten ? [`and ${plural(c.teamOnly.rewritten, 'more move')} for your team, in Brew`] : [])]);
  sec('New this week', [...c.weekly.slice(0, 6).map((m) => m.title), ...(c.teamOnly.weekly ? [`and ${plural(c.teamOnly.weekly, 'more')} for your team, in Brew`] : [])]);
  sec(nAds === 1 ? 'A rival ad Brew spotted' : 'Rival ads Brew spotted', c.rivalAds.slice(0, 3).map((a) => (a.title ? `${a.brand}: ${a.title}` : a.brand)));
  sec('On the shelf this week', c.shelf || []);
  if (c.theme || c.question) {
    const t = c.theme ? `Most talked about: “${c.theme.name}” (${plural(c.theme.n, 'mention')}).` : '';
    const qh = c.question ? `Someone asked${c.question.where ? ` on ${esc(c.question.where)}` : ''}: <a href="${esc(c.question.url)}" style="color:#0A0A0A;text-decoration:underline">${esc(c.question.title)}</a>` : '';
    html.push(heading('What people are saying') + (t ? mailP(esc(t)) : '') + (qh ? mailP(qh) : ''));
    text.push(['What people are saying', t, c.question ? `Someone asked${c.question.where ? ` on ${c.question.where}` : ''}: ${c.question.title} ${c.question.url}` : ''].filter(Boolean).join('\n'));
  }
  if (c.event) { const l = `${c.event.name}, ${dayLabel(c.event.date)}: ${c.event.days === 0 ? 'today' : `${plural(c.event.days, 'day')} away`}.`; html.push(heading('Coming up') + mailP(esc(l))); text.push(`Coming up\n${l}`); }
  if (c.images.length) html.push(mailImages(c.images, { href, alt: `From ${name}’s feed` }));
  const footer = prefHref ? `You’re getting this because you’re on ${esc(name)}’s team on Brew.<br>${footLink(prefHref, 'No more emails like this')}` : `You’re getting this because you’re on ${esc(name)}’s team on Brew.`;
  return { empty: false, subject,
    html: emailHtml({ title: `This week for ${name}`, eyebrow: name, preheader: cut(subject, 140), body: html.join(''), cta: { href, label: 'Open the feed' }, footer, base }),
    text: `This week for ${name}\n\n${text.join('\n\n')}\n\nOpen the feed: ${href}${prefHref ? `\n\nNo more emails like this: ${prefHref}` : ''}` };
}
/** the same week in the brand's Slack channel: shared lines only (no one's own jams) */
export function digestSlack({ name, slug, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', c }) {
  const L = [];
  const nMoves = c.rewritten.length + c.teamOnly.rewritten, nNew = c.weekly.length + c.teamOnly.weekly;
  if (nMoves) L.push(`• ${plural(nMoves, 'move')} rewritten: ${c.rewritten.slice(0, 4).map((m) => m.title).join('; ')}${nMoves > 4 ? '…' : ''}`);
  if (nNew) L.push(`• ${plural(nNew, 'new move')}: ${c.weekly.slice(0, 3).map((m) => m.title).join('; ')}${nNew > 3 ? '…' : ''}`);
  if (c.rivalAds.length) L.push(`• Rival ads: ${c.rivalAds.slice(0, 3).map((a) => a.brand).join(', ')}`);
  if ((c.shelf || []).length) L.push(`• On the shelf: ${c.shelf.slice(0, 2).join('; ')}`);
  if (c.theme) L.push(`• Most talked about: “${c.theme.name}” (${plural(c.theme.n, 'mention')})`);
  if (c.question) L.push(`• Someone asked: <${c.question.url}|${c.question.title.replace(/[<>|]/g, '')}>`);
  if (c.event) L.push(`• Coming up: ${c.event.name}, ${dayLabel(c.event.date)}`);
  if (c.needsOk) L.push(`• ${plural(c.needsOk, 'jam')} waiting for an OK`);
  if (!L.length) return null;
  return `*This week in Brew for ${name}*\n${L.join('\n')}\n<${base}/${slug}?go=feed|Open the feed>`;
}

/* ---------- the job ---------- */
export function createDigest({ packs, mail, slack = () => null, prefLink = null, log = console, now = () => Date.now(), base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', demo = () => process.env.DEMO_MODE === '1' }) {
  const running = new Set();
  /** one brand's digest. dryRun: everything worked out, nothing sent or saved. force: the schedule is skipped (ops, tests) */
  async function digestFor(slug, { dryRun = false, force = false, at = now() } = {}) {
    const g = getJ(packs, slug), s = await g('status.json');
    if (!s?.done || s.cancelled || s.error) return { skipped: 'not ready' };
    if (!dryRun && demo()) return { skipped: 'demo' };
    const cfg = (await g('config.json', {})) || {}, D = (await g('private/digest.json', {})) || {}, readyAt = +s.doneAt || +s.updatedAt || 0;
    if (!force && !digestDue({ now: at, lastAt: D.lastAt, readyAt, cfg })) return { skipped: 'not due' };
    if (!force && D.emptyAt && localNow(D.emptyAt, cfg).ymd === localNow(at, cfg).ymd) return { skipped: 'nothing new today' };
    const since = +D.lastAt || Math.max(readyAt, at - WEEK), name = s.name || slug;
    const c = await digestContent(packs, slug, { since, now: at, base });
    const to = await teamRecipients(packs, slug);
    const mails = to.map((e) => ({ to: e, ...digestMail({ name, slug, base, c, jams: jamsFor(c.jams, e), prefHref: prefLink ? prefLink(slug, e) : null }) })).filter((m) => !m.empty);
    const slackText = digestSlack({ name, slug, base, c });
    if (dryRun) return { dryRun: true, since, content: c, to, mails, slack: slackText };
    if (!mails.length) { await packs.put(slug, 'private/digest.json', { ...D, emptyAt: at }); log.log?.(`[digest] ${slug}: nothing new this week`); return { skipped: 'empty', to }; }
    const ok = [];
    for (const m of mails) { if (await Promise.resolve(mail(m.to, m.subject, m.html, m.text)).catch(() => false)) ok.push(m.to); }
    if (!ok.length) { log.warn?.(`[digest] ${slug}: no digest went out`); return { failed: true, to: [] }; } /* tried again next hour */
    let posted = null;
    const S = slack?.(); if (slackText && S?.slackOf && S.slackPost && (await S.slackOf(slug).catch(() => null))) posted = await S.slackPost(slug, { text: slackText }).then((r) => !r?.error).catch(() => false);
    await packs.put(slug, 'private/digest.json', { lastAt: at, since, n: ok.length, subject: mails[0].subject, sent: Object.fromEntries(ok.map((e) => [e, at])), ...(posted != null ? { slack: posted } : {}) });
    log.log?.(`[digest] ${slug}: sent to ${ok.length}${posted ? ', and Slack' : ''}: ${mails[0].subject}`);
    return { ok: true, to: ok, subject: mails[0].subject, slack: posted };
  }
  let busy = false;
  async function tick() {
    if (busy || demo()) return []; busy = true; const out = [];
    try { for (const b of await packs.list().catch(() => [])) { if (!b?.status?.done || running.has(b.slug)) continue; running.add(b.slug);
      try { const r = await digestFor(b.slug); if (r?.ok || r?.failed) out.push({ slug: b.slug, ...r }); } catch (e) { log.warn?.('[digest]', b.slug, e.message); } finally { running.delete(b.slug); } } }
    finally { busy = false; }
    return out;
  }
  /* DIGEST_NOW=<slug,...>: send those brands' digests now, once (not again within 12 hours, so a redeploy with it set sends nothing twice) */
  async function now1(slugs) {
    for (const slug of slugs) { const D = (await getJ(packs, slug)('private/digest.json', {})) || {}; if (now() - (+D.lastAt || 0) < 12 * 3600e3) continue;
      await digestFor(slug, { force: true }).then((r) => log.log?.(`[digest] ${slug} now: ${JSON.stringify(r).slice(0, 160)}`)).catch((e) => log.warn?.('[digest] now', slug, e.message)); }
  }
  const start = ({ every = 3600e3, first = 5 * 60e3 } = {}) => {
    const a = setTimeout(() => { now1(String(process.env.DIGEST_NOW || '').split(',').map((x) => x.trim()).filter(Boolean)).catch(() => {}).finally(() => tick().catch(() => {})); }, first);
    const b = setInterval(() => tick().catch(() => {}), every); a.unref?.(); b.unref?.(); return () => { clearTimeout(a); clearInterval(b); };
  };
  return { tick, start, digestFor };
}
