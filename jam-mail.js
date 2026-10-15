// Brew's emails about jams, to the brand's own team (never to its customers).
// Right away: you were tagged (@you), asked a question, assigned the jam, or asked for your OK.
// Batched: new messages in a jam you're part of, at most one email per jam per person every 15 minutes.
// Nobody gets an email about their own message, about a jam they have open right now, or about lines they've already read.
// Each email carries one-tap links: mute this jam, only tags, or no jam emails at all (per person, brands/<slug>/private/mail-prefs.json).
// The demo site never sends (demo-mode.js blocks api.resend.com).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  const link = (slug, wid) => `${base()}/${slug}#jam=${encodeURIComponent(wid)}`;
  const prefLink = (slug, email, set, wid) => `${base()}/mail/pref?t=${encodeURIComponent(sign({ slug, email: lc(email), set, wid: wid || null }, 180 * 86400, 'mailpref'))}`;
  const footer = (slug, email, wid) => `<p style="color:#888;font-size:12px;margin-top:28px">You’re getting this because you’re in this jam on Brew. <a style="color:#888" href="${prefLink(slug, email, 'mute', wid)}">Mute this jam</a> · <a style="color:#888" href="${prefLink(slug, email, 'tags')}">Only when I’m tagged</a> · <a style="color:#888" href="${prefLink(slug, email, 'off')}">No jam emails</a></p>`;
  const btn = (href, label) => `<a href="${href}" style="background:#111;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a>`;
  const wrap = (title, body) => `<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:540px"><p style="font-size:18px;font-weight:600;margin:0 0 12px">${esc(title)}</p>${body}</div>`;
  const quote = (who, text) => `<div style="border-left:3px solid #ddd;padding:2px 0 2px 12px;margin:10px 0;color:#333"><b>${esc(who)}</b><br>${esc(cut(text, 280))}</div>`;

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
        const html = wrap(subject, `${text ? quote(by?.name || by?.email || 'Someone', text) : ''}<p style="color:#555">${esc(brand)} · Brew</p><p style="margin:22px 0">${btn(url, cta)}</p>${footer(slug, e0, w.id)}`);
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
  const flush = async () => {
    let n = 0;
    for (const [k, p] of [...pending]) {
      const t = clock(); if (t - p.first < settleMs || t - (lastSent.get(k) || 0) < batchMs) continue;
      pending.delete(k);
      const seen = p.jam?.reads?.[p.email] || 0, lines = p.lines.filter((l) => l.at > seen);
      if (!lines.length || watching(p.wid, p.email)) continue;
      if (!(await wants(p.slug, p.email, p.wid, 'reply'))) continue;
      const brand = brandName(p.slug), who = [...new Set(lines.map((l) => l.who.split(/\s+/)[0]))], url = link(p.slug, p.wid);
      const subject = `${who.slice(0, 2).join(' and ')}${who.length > 2 ? ` and ${who.length - 2} more` : ''} in “${cut(p.title, 60)}”`;
      const show = lines.slice(-5), more = lines.length - show.length;
      const html = wrap(subject, `${show.map((l) => quote(l.who, l.text)).join('')}${more > 0 ? `<p style="color:#777">and ${more} more</p>` : ''}<p style="color:#555">${esc(brand)} · Brew</p><p style="margin:22px 0">${btn(url, 'Open the jam')}</p>${footer(p.slug, p.email, p.wid)}`);
      if (await send(p.email, subject, html, `${subject}\n\n${show.map((l) => `${l.who}: ${l.text}`).join('\n')}\n\nOpen the jam: ${url}`)) { lastSent.set(k, clock()); n++; }
    }
    return n;
  };
  const timer = everyMs ? setInterval(() => flush().catch((e) => log.warn?.('[jam-mail] flush', e.message)), everyMs) : null; timer?.unref?.();

  /* the one-tap links in the footer */
  const handle = async (req, res, u) => {
    if (u.pathname !== '/mail/pref' || req.method !== 'GET') return false;
    const t = verify(u.searchParams.get('t') || '', 'mailpref');
    const page = (h, p) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brew</title><body style="font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:18vh auto;padding:0 20px;color:#111;background:#fff"><h1 style="font-size:22px;margin:0 0 8px">${esc(h)}</h1><p style="color:#555">${esc(p)}</p>${t?.slug ? `<p><a href="/${esc(t.slug)}" style="color:#111">Open ${esc(brandName(t.slug))}</a></p>` : ''}</body>`); return true; };
    if (!t?.slug || !t.email) return page('This link has expired', 'Open Brew to change your email settings.');
    if (t.set === 'mute' && t.wid) { await setPref(t.slug, t.email, { mute: t.wid }); return page('Muted', 'You won’t get emails about this jam unless someone tags you.'); }
    if (t.set === 'tags') { await setPref(t.slug, t.email, { mail: 'tags' }); return page('Only when you’re tagged', 'You’ll get an email when someone tags you, asks you something or gives you a jam.'); }
    if (t.set === 'off') { await setPref(t.slug, t.email, { mail: 'off' }); return page('No jam emails', 'You won’t get emails about jams. Invites and team changes still come.'); }
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
    const html = wrap(subject, `${text ? quote(by?.name || by?.email || 'Someone', text) : ''}<p style="color:#555">${esc(brand)}${ticket ? ` · ${esc(ticket)}` : ''} · ${esc(by?.email || '')}</p><p style="margin:22px 0">${btn(jamUrl || link(slug, w.id), 'Join the jam')}</p>${briefUrl ? `<p><a href="${briefUrl}" style="color:#111">Read the brief</a> (read-only)</p>` : ''}<p style="color:#888;font-size:12px">Sign in with your ShopOS Google account to take part.</p>`);
    const ok = await send(to, subject, html, `${subject}\n\n${text ? `${by?.name || by?.email}: ${cut(text, 400)}\n\n` : ''}Join the jam: ${jamUrl || link(slug, w.id)}${briefUrl ? `\nThe brief (read-only): ${briefUrl}` : ''}`);
    if (!ok) shoposSent.delete(k); return ok;
  };

  return { event, flush, shopos, handle, prefsOf, setPref, prefLink, pending, stop: () => timer && clearInterval(timer) };
}
