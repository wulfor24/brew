import { smallPage } from './small-page.js';
// Brew's emails about jams, to the brand's own team (never to its customers).
// Right away: you were tagged (@you), asked a question, assigned the jam, or asked for your OK.
// Batched: new messages in a jam you're part of, at most one email per jam per person every 15 minutes.
// Nobody gets an email about their own message, about a jam they have open right now, or about lines they've already read.
// Each email carries one-tap links: mute this jam, only tags, or no jam emails at all (per person, brands/<slug>/private/mail-prefs.json).
// The demo site never sends (demo-mode.js blocks api.resend.com).
import { emailHtml, esc, p as para, quote as mquote, footLink, list } from './mail-layout.js';
import { mdToEmailHtml } from './brief-status.js';
const FONT_ = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const lc = (e) => String(e || '').toLowerCase().trim();
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'; };
const first = (p) => String(p?.name || p?.email || 'Someone').trim().split(/\s+/)[0].replace(/@.*/, '');
const PREFS = 'private/mail-prefs.json';
const NOW = { tagged: 1, asked: 1, assigned: 1, approve: 1, approved: 1 };

export function createJamMail({ mail, packs, sign, verify, base = () => process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', brandName = (slug) => slug, watching = () => false, log = console, batchMs = 15 * 60e3, settleMs = 60e3, everyMs = 60e3, clock = () => Date.now() }) {
  const pending = new Map(); // `${slug}|${wid}|${email}` → { slug, wid, title, email, lines: [], first, reads }
  const lastSent = new Map(); // same key → when the last batched email went
  const sentKeys = new Set(); // (jam, person, event) already emailed
  const prefsCache = new Map();
  const prefsOf = async (slug) => { if (prefsCache.has(slug)) return prefsCache.get(slug); const p = (await packs.getJSON(slug, PREFS, null).catch(() => null)) || {}; prefsCache.set(slug, p); return p; };
  const setPref = async (slug, email, change) => { const p = await prefsOf(slug), e = lc(email), x = (p[e] ||= { mail: 'all', muted: [] }); if (change.mail) x.mail = change.mail; if (change.mute) x.muted = [...new Set([...(x.muted || []), change.mute])]; if (change.unmute) x.muted = (x.muted || []).filter((w) => w !== change.unmute); await packs.put(slug, PREFS, p); return x; };
  /* does this person want this email: off = none; tags = only being tagged/asked/assigned; a muted jam sends nothing but tags */
  const wants = async (slug, email, wid, kind) => { const x = (await prefsOf(slug))[lc(email)]; if (!x) return true; if (x.mail === 'off') return false; const direct = kind === 'tagged' || kind === 'asked' || kind === 'assigned'; if ((x.muted || []).includes(wid)) return direct && kind === 'tagged'; if (x.mail === 'tags') return direct; return true; };

  const link = (slug, wid) => `${base()}/${slug}?go=feed#jam=${encodeURIComponent(wid)}`; /* ?go=feed: straight into the jam, never the read replay */
  const prefLink = (slug, email, set, wid) => `${base()}/mail/pref?t=${encodeURIComponent(sign({ slug, email: lc(email), set, wid: wid || null }, 180 * 86400, 'mailpref'))}`;
  const footer = (slug, email, wid) => `You’re getting this because you’re in this jam.<br>${footLink(prefLink(slug, email, 'mute', wid), 'Mute this jam')} · ${footLink(prefLink(slug, email, 'tags'), 'Only when I’m tagged')} · ${footLink(prefLink(slug, email, 'off'), 'No emails from Brew')}`;
  const quote = (who, text) => mquote(who, cut(text, 280));

  const send = async (to, subject, html, text) => { try { const ok = await mail(to, subject, html, text); if (ok) return true; } catch (e) { log.warn?.('[jam-mail] send', e.message); }
    try { return !!(await mail(to, subject, html, text)); } catch (e) { log.warn?.('[jam-mail] retry', e.message); return false; } };

  const WHAT = {
    tagged: (by, w) => [`${first(by)} tagged you in “${cut(w.title, 60)}”`, 'Open the jam'],
    asked: (by, w) => [`${first(by)} asked you a question on “${cut(w.title, 60)}”`, 'Answer it'],
    assigned: (by, w) => [`${first(by)} gave you “${cut(w.title, 60)}”`, 'Open the jam'],
    approve: (by, w) => [`${first(by)} needs your OK on “${cut(w.title, 60)}”`, 'Review it'],
    approved: (by, w) => [`${first(by)} approved “${cut(w.title, 60)}”`, 'Open the jam']
  };
  /* one event in a jam. kind: tagged | asked | assigned | approve | approved (right away) or reply (batched).
     to: the people it is for; by: who did it; text: what they said; id: the message or event id (never emailed twice) */
  const event = async (slug, w, { kind, to = [], by, text = '', id }) => {
    if (!slug || !w) return 0; const author = lc(by?.email); let n = 0;
    for (const e0 of new Set(to.map(lc).filter(Boolean))) {
      if (e0 === author || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e0)) continue;
      if (!(await wants(slug, e0, w.id, kind))) continue;
      if (NOW[kind]) {
        const key = `${w.id}|${e0}|${kind}|${id || text}`; if (sentKeys.has(key)) continue; sentKeys.add(key); if (sentKeys.size > 20000) sentKeys.clear();
        if (watching(w.id, e0) && kind !== 'approve' && kind !== 'asked') continue; // they're looking at it: the jam shows it
        const brand = brandName(slug), [subject, cta] = WHAT[kind](by, w), url = link(slug, w.id);
        const html = emailHtml({ title: subject, eyebrow: brand, preheader: text ? cut(text, 140) : subject, body: text ? quote(by?.name || by?.email || 'Someone', text) : '', cta: { href: url, label: cta }, footer: footer(slug, e0, w.id), base: base() });
        if (await send(e0, subject, html, `${subject}\n\n${text ? `${by?.name || by?.email}: ${cut(text, 280)}\n\n` : ''}${cta}: ${url}`)) n++;
        // what was said right away is not repeated in the next batched email
        const p = pending.get(`${slug}|${w.id}|${e0}`); if (p && id) p.lines = p.lines.filter((l) => l.id !== id);
      } else {
        const k = `${slug}|${w.id}|${e0}`, p = pending.get(k) || { slug, wid: w.id, title: w.title, email: e0, lines: [], first: clock() };
        p.title = w.title; p.lines.push({ id, who: by?.name || by?.email || 'Someone', text: cut(text, 200), at: clock() }); p.jam = w; pending.set(k, p);
      }
    }
    return n;
  };
  /* the batched emails: a person's new lines in a jam, once they've settled a minute and at most every 15 minutes */
  const flush = async ({ all = false } = {}) => {
    let n = 0;
    for (const [k, p] of [...pending]) {
      const t = clock(); if (!all && (t - p.first < settleMs || t - (lastSent.get(k) || 0) < batchMs)) continue;
      pending.delete(k);
      const seen = p.jam?.reads?.[p.email] || 0, lines = p.lines.filter((l) => l.at > seen);
      if (!lines.length || watching(p.wid, p.email)) continue;
      if (!(await wants(p.slug, p.email, p.wid, 'reply'))) continue;
      const brand = brandName(p.slug), who = [...new Set(lines.map((l) => l.who.split(/\s+/)[0]))], url = link(p.slug, p.wid);
      const subject = `${who.slice(0, 2).join(' and ')}${who.length > 2 ? ` and ${who.length - 2} more` : ''} in “${cut(p.title, 60)}”`;
      const show = lines.slice(-5), more = lines.length - show.length;
      const html = emailHtml({ title: subject, eyebrow: brand, preheader: `${show[show.length - 1].who}: ${show[show.length - 1].text}`.slice(0, 140), body: show.map((l) => quote(l.who, l.text)).join('') + (more > 0 ? para(`and ${more} more`, { muted: true, small: true }) : ''), cta: { href: url, label: 'Open the jam' }, footer: footer(p.slug, p.email, p.wid), base: base() });
      if (await send(p.email, subject, html, `${subject}\n\n${show.map((l) => `${l.who}: ${l.text}`).join('\n')}\n\nOpen the jam: ${url}`)) { lastSent.set(k, clock()); n++; }
    }
    return n;
  };
  /* the instance is going (SIGTERM): every batch still waiting goes now, settled or not, so no line is lost with the process
     (the same rules: nobody gets their own lines, lines they've read, or a jam they have open) */
  const drain = () => flush({ all: true });
  const timer = everyMs ? setInterval(() => flush().catch((e) => log.warn?.('[jam-mail] flush', e.message)), everyMs) : null; timer?.unref?.();

  /* the one-tap links in the footer */
  const handle = async (req, res, u) => {
    if (u.pathname !== '/mail/pref' || req.method !== 'GET') return false;
    const t = verify(u.searchParams.get('t') || '', 'mailpref');
    const page = (h, p) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }); res.end(smallPage(h, p, { link: t?.slug ? { href: `/${t.slug}?go=feed`, label: `Open ${brandName(t.slug)}` } : null })); return true; };
    if (!t?.slug || !t.email) return page('This link has expired', 'Open Brew to change your email settings.');
    if (t.set === 'mute' && t.wid) { await setPref(t.slug, t.email, { mute: t.wid }); return page('Muted', 'You won’t get emails about this jam unless someone tags you.'); }
    if (t.set === 'tags') { await setPref(t.slug, t.email, { mail: 'tags' }); return page('Only when you’re tagged', 'You’ll get an email when someone tags you, asks you something or gives you a jam.'); }
    /* off also stops the weekly digest and the "moves ready / updated" emails (digest.js teamRecipients reads mail: 'off') */
    if (t.set === 'off') { await setPref(t.slug, t.email, { mail: 'off' }); return page('No emails from Brew', `No emails from Brew for ${brandName(t.slug)}. Turn them back on any time.`); }
    if (t.set === 'all') { await setPref(t.slug, t.email, { mail: 'all' }); return page('Jam emails are on', 'You’ll hear about the jams you’re in.'); }
    return page('Nothing changed', 'Open Brew to change your email settings.');
  };

  /* the ShopOS team was tagged (in the chat, by Share with the ShopOS team, or by asking it a question): one email to the
     team's shared inbox (SHOPOS_EMAIL), at most once per jam an hour. Their shopos.ai Google accounts open the jam from the link */
  const shoposSent = new Map();
  const shopos = async (slug, w, { by, text = '', why = 'tagged the ShopOS team', ticket = null, jamUrl, briefUrl }) => {
    const to = process.env.SHOPOS_EMAIL || 'hello@joinsquareup.com', k = `${slug}|${w.id}`;
    if (clock() - (shoposSent.get(k) || 0) < 60 * 60e3) return false; shoposSent.set(k, clock());
    const brand = brandName(slug), subject = `${brand}: ${first(by)} ${why} on “${cut(w.title, 60)}”${ticket ? ` (${ticket})` : ''}`;
    const html = emailHtml({ title: `${first(by)} ${why} on “${cut(w.title, 60)}”`, eyebrow: `${brand}${ticket ? ` · ${ticket}` : ''}`, preheader: text ? cut(text, 140) : subject, body: (text ? quote(by?.name || by?.email || 'Someone', text) : '') + para(`From ${esc(by?.name || '')}${by?.name && by?.email ? ' · ' : ''}${esc(by?.email || '')}`, { muted: true, small: true }), cta: { href: jamUrl || link(slug, w.id), label: 'Join the jam' }, secondary: briefUrl ? { href: briefUrl, label: 'Read the brief (read-only)' } : null, after: para('Sign in with your ShopOS Google account to take part.', { muted: true, small: true }), base: base() });
    const ok = await send(to, subject, html, `${subject}\n\n${text ? `${by?.name || by?.email}: ${cut(text, 400)}\n\n` : ''}Join the jam: ${jamUrl || link(slug, w.id)}${briefUrl ? `\nThe brief (read-only): ${briefUrl}` : ''}`);
    if (!ok) shoposSent.delete(k); return ok;
  };

  /* Send brief (UI2): the WHOLE brief to the ShopOS team's inbox, every time it is sent (not throttled like the tag email above):
     the brief itself, deliverables, assets (images inline, links), rules, done-when and where, plus who sent it. key: one email
     per send (a retry of the same send is not a second email) */
  const briefSentKeys = new Set();
  const briefSent = async (slug, w, { by, md = '', parts = {}, ticket = null, jamUrl, briefUrl, key = null }) => {
    const to = process.env.SHOPOS_EMAIL || 'hello@joinsquareup.com', k = `${slug}|${w.id}|${key || ''}`;
    if (key && briefSentKeys.has(k)) return false; briefSentKeys.add(k);
    const brand = brandName(slug), title = `New brief from ${brand}: “${cut(w.title, 70)}”`, subject = `${ticket ? `${ticket} · ` : ''}${title}`;
    const sec = (h, items) => (items?.length ? `<h2 style="margin:20px 0 8px;font:700 16px/1.35 ${FONT_};color:#111">${esc(h)}</h2>${list(items)}` : '');
    const imgs = (parts.assets || []).filter((a) => a.image), links = (parts.assets || []).filter((a) => !a.image);
    const assetsHtml = imgs.length || links.length ? `<h2 style="margin:20px 0 8px;font:700 16px/1.35 ${FONT_};color:#111">Assets</h2>` +
      imgs.map((a) => `<p style="margin:0 0 12px"><a href="${esc(a.url)}"><img src="${esc(a.url)}" alt="${esc(a.label)}" width="240" style="display:block;max-width:100%;border:1px solid #E7E5E4;border-radius:10px"></a><span style="font:13px/1.5 ${FONT_};color:#6B6B6B">${esc(a.label)} · <a href="${esc(a.url)}" style="color:#111">Open</a></span></p>`).join('') +
      links.map((a) => para(`<a href="${esc(a.url)}" style="color:#111">${esc(a.label)}</a>`)).join('') : '';
    const body = para(`From ${esc(by?.name || '')}${by?.name && by?.email ? ' · ' : ''}${esc(by?.email || '')}`, { muted: true, small: true }) +
      (parts.where ? para(`<b>Where:</b> ${esc(parts.where)}`) : '') + sec('Deliverables', parts.deliverables) +
      `<h2 style="margin:20px 0 8px;font:700 16px/1.35 ${FONT_};color:#111">The brief</h2>` + mdToEmailHtml(md, { esc, p: para }) +
      assetsHtml + ((parts.reference || []).length ? `<h2 style="margin:20px 0 8px;font:700 16px/1.35 ${FONT_};color:#111">How the reference is made</h2>` + parts.reference.map((r) => para(esc(r).replace(/\n/g, '<br>'))).join('') : '') + sec('Rules', parts.rules) + sec('Done when', parts.doneWhen);
    const html = emailHtml({ title, eyebrow: `${brand}${ticket ? ` · ${ticket}` : ''}`, preheader: cut(String(md).replace(/^#.*$/m, '').replace(/[#*_-]+/g, ' '), 140), body, cta: { href: jamUrl || link(slug, w.id), label: 'Open the jam' }, secondary: briefUrl ? { href: briefUrl, label: 'Read the brief (read-only)' } : null, after: para('Move it on from the jam: Received, In progress, Needs info or Delivered. The brand sees each step.', { muted: true, small: true }), base: base() });
    const txt = [subject, '', `From ${by?.name || ''} ${by?.email || ''}`.trim(), parts.where ? `Where: ${parts.where}` : '', parts.deliverables?.length ? `Deliverables:\n${parts.deliverables.map((x) => `- ${x}`).join('\n')}` : '', '', md, '',
      (parts.assets || []).length ? `Assets:\n${parts.assets.map((a) => `- ${a.label}: ${a.url}`).join('\n')}` : '', (parts.reference || []).length ? `How the reference is made:\n${parts.reference.join('\n\n')}` : '', parts.rules?.length ? `Rules:\n${parts.rules.map((x) => `- ${x}`).join('\n')}` : '', parts.doneWhen?.length ? `Done when:\n${parts.doneWhen.map((x) => `- ${x}`).join('\n')}` : '',
      `Open the jam: ${jamUrl || link(slug, w.id)}`, briefUrl ? `The brief (read-only): ${briefUrl}` : ''].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
    const ok = await send(to, subject, html, txt); if (!ok) briefSentKeys.delete(k); return ok;
  };
  /* the ShopOS team moved a brief on: the person who sent it hears (needs_info quotes what they need). Delivered and Needs info
     are the jam's news, so everyone in the jam hears them too (never the person who moved it; their mail settings count, the
     sender's email always goes). Other steps only reach the sender */
  const EM = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
  const briefStatus = async (slug, w, { to, by, label, status, note = '', ticket = null, jamUrl }) => {
    const sender = lc(to), mover = lc(by?.email), wide = status === 'delivered' || status === 'needs_info';
    const list = [...new Set([sender, ...(wide ? (w.people || []).map((x) => lc(x.email)) : [])])].filter((e) => e && EM.test(e) && e !== mover);
    if (!list.length) return false;
    const brand = brandName(slug), title = status === 'needs_info' ? `The ShopOS team needs something for “${cut(w.title, 60)}”` : `${wide ? 'The' : 'Your'} brief “${cut(w.title, 60)}” is ${String(label).toLowerCase()}`;
    const html = emailHtml({ title, eyebrow: `${brand}${ticket ? ` · ${ticket}` : ''}`, preheader: note ? cut(note, 140) : title, body: note ? quote(by?.name || 'ShopOS team', note) : para(`${esc(label)}.`), cta: { href: jamUrl || link(slug, w.id), label: status === 'needs_info' ? 'Answer in the jam' : 'Open the jam' }, base: base() });
    const txt = `${title}\n\n${note ? `${by?.name || 'ShopOS team'}: ${note}\n\n` : ''}Open the jam: ${jamUrl || link(slug, w.id)}`;
    let n = 0;
    for (const e of list) { if (e !== sender && !(await wants(slug, e, w.id, status === 'needs_info' ? 'asked' : 'reply'))) continue; if (await send(e, `${ticket ? `${ticket} · ` : ''}${title}`, html, txt)) n++; }
    return n > 0;
  };

  return { event, flush, drain, shopos, briefSent, briefStatus, handle, prefsOf, setPref, prefLink, pending, stop: () => timer && clearInterval(timer) };
}
