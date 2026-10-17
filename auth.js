import { smallPage } from './small-page.js';
// Google sign-in, brand claiming and the team behind a brand.
// Sign-in is the Google OAuth code flow with PKCE (lifted from SquareUp's google-auth.ts): a nonce + verifier ride
// in a short httpOnly cookie, the code is traded server-to-server, and we trust only a Google-verified email.
// The session is an HMAC-signed cookie (FEED_SESSION_SECRET); there is no user table.
// A brand is claimed only with an official email, one at the brand's own domain (you@wearcomet.com for wearcomet.com):
//   1. the first person with an official email to connect one of the brand's accounts, or to tap Claim, becomes its admin
//   2. teammates on the same company domain join on their own once it is claimed, with every view (an admin can narrow it)
//   3. anyone else (another domain, a Gmail) joins only when the team invites them
//   4. SquareUp's own people (FULL_ACCESS_DOMAINS: joinsquareup.com, shopos.ai) and ADMIN_EMAILS see and make everything on
//      every brand, but never take a brand that isn't theirs
// The team and SquareUp make fresh work (moves, drafts, images, jams). Everyone else sees the brand in demo mode.
import crypto from 'node:crypto';
import { emailHtml, p as para } from './mail-layout.js';

const FREE = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|zoho|yandex|gmx|mail|rediffmail|hey|fastmail|tutanota|qq|163|126)\.[a-z.]+$/;
const b64 = (x) => Buffer.from(x).toString('base64url');
const unb64 = (x) => Buffer.from(String(x), 'base64url').toString('utf8');
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';
export const bareHost = (h) => String(h || '').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
export const freeMail = (email) => FREE.test(domainOf(email));
/* shared platform domains: many brands live under one of these (brand.myshopify.com), so the parent never proves a brand */
export const PLATFORM = /(^|\.)(myshopify\.com|shopify\.com|shop\.app|wixsite\.com|wix\.com|squarespace\.com|webflow\.io|vercel\.app|netlify\.app|github\.io|gitlab\.io|blogspot\.com|wordpress\.com|carrd\.co|framer\.website|framer\.app|notion\.site|google\.com|instagram\.com|facebook\.com|fb\.com|linktr\.ee|amazon\.[a-z.]+|etsy\.com|herokuapp\.com|pages\.dev|web\.app|firebaseapp\.com|bigcartel\.com|square\.site|ecwid\.com|dukaan\.app|mydukaan\.io|godaddysites\.com|weebly\.com|bio\.link|beacons\.ai)$/;
/* the very same site (www. ignored): the only match an account's free-text website field can prove */
export const exactSite = (a, b) => { a = bareHost(a); b = bareHost(b); return !!a && a === b; };
/* a work email that belongs to the brand: the same domain, a subdomain of the brand's site, or the company domain the brand's
   site sits under (shop.brand.com for you@brand.com); never a shared platform domain or a free mailbox */
export const ownDomain = (emailDomain, host) => { const a = bareHost(emailDomain), b = bareHost(host); if (!a || !b || FREE.test(a)) return false; if (a === b) return true; if (PLATFORM.test(a) || !a.includes('.')) return false; return a.endsWith('.' + b) || b.endsWith('.' + a); };

/* SquareUp's own people: every brand, every view, every generation (FULL_ACCESS_DOMAINS, subdomains included) */
const fullDomains = () => String(process.env.FULL_ACCESS_DOMAINS ?? 'joinsquareup.com,shopos.ai').toLowerCase().split(/[,;\s]+/).filter(Boolean);
export const fullDomain = (email) => { const d = domainOf(email); return !!d && fullDomains().some((x) => d === x || d.endsWith('.' + x)); };
export const isFullAccess = (email) => { const e = String(email || '').toLowerCase().trim(); return !!e && (fullDomain(e) || String(process.env.ADMIN_EMAILS || '').toLowerCase().split(/[,;\s]+/).includes(e)); };
/* the demo site (DEMO_MODE=1): every visitor owns a throwaway copy, so the generation gate stays open there */
const DEMO_SITE = () => process.env.DEMO_MODE === '1';

/* views (seats) a member may use: 'all' or a list of seat keys; a missing field is a member from before views existed (all) */
export const cleanSeats = (x) => (x === 'all' ? 'all' : [...new Set((Array.isArray(x) ? x : []).map((k) => String(k).toLowerCase()).filter((k) => /^[a-z]{2,16}$/.test(k)))].slice(0, 12));
const seatList = (x) => (x == null || x === 'all' ? null : x);

export function createAuth({ packs, hostOf, seatNames = async () => ({}), onTeamChange = () => {}, log = console }) {
  const SECRET = process.env.FEED_SESSION_SECRET || (process.env.K_SERVICE ? '' : 'local-dev-session-secret');
  if (!SECRET) log.warn('[auth] FEED_SESSION_SECRET is not set: sign-in is off');
  // FEED_SIGNIN=0 keeps sign-in hidden (until the redirect URI is registered on the Google client)
  const CID = process.env.FEED_SIGNIN === '0' ? '' : process.env.GOOGLE_CLIENT_ID || '', CSEC = process.env.GOOGLE_CLIENT_SECRET || '';
  const ADMINS = new Set(String(process.env.ADMIN_EMAILS || '').toLowerCase().split(/[,;\s]+/).filter(Boolean));
  const secure = !!process.env.K_SERVICE;
  const baseOf = (req) => process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  /* ---------- signed tokens (session cookie, OAuth state, approve links) ---------- */
  const mac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
  /* every token says what it is (typ): a session, a sign-in or connect state, an approve link, a Slack button. verify() takes
     the type it expects and refuses any other, so a connect state or an approve link never works as a session cookie */
  const sign = (obj, ttlSec, typ) => { if (!typ) throw new Error('auth.sign needs a token type'); const body = b64(JSON.stringify({ ...obj, typ, exp: Math.floor(Date.now() / 1e3) + ttlSec })); return `${body}.${mac(body)}`; };
  const verify = (tok, typ) => {
    if (!SECRET || !typ || typeof tok !== 'string' || !tok.includes('.')) return null;
    const [body, sig] = tok.split('.'); const want = mac(body);
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try { const o = JSON.parse(unb64(body)); return o.exp > Date.now() / 1e3 && o.typ === typ ? o : null; } catch { return null; }
  };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
  const setCookie = (res, name, val, maxAge) => { const prev = res.getHeader('set-cookie') || []; res.setHeader('set-cookie', [...(Array.isArray(prev) ? prev : [prev]), `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`]); };
  const user = (req) => { const s = verify(cookies(req).fs_s, 'session'); return s?.email ? { email: s.email, name: s.name || null, pic: s.pic || null, sub: s.sub || null } : null; };
  const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  /* a same-site path only; % is allowed so a return address can carry another encoded one (Switch account → sign in → back to the invite) */
  const safeNext = (n) => (typeof n === 'string' && /^\/[A-Za-z0-9/_#=&?.%~:,+-]*$/.test(n) && !n.startsWith('//') && !/^\/%2f/i.test(n) ? n : '/');

  /* ---------- members: brands/<slug>/private/members.json ---------- */
  // { owner, members: [{ email, role: owner|member, seats, via, at }], invites: [{ email, seats, by, at }], domain }
  // (requests: asking for access is gone, joining is by invite only; old requests are dropped on the next edit)
  let lock = Promise.resolve();
  const MF = 'private/members.json', INVITE_DAYS = 14;
  const getM = async (slug) => ({ owner: null, members: [], invites: [], ...(await packs.getJSON(slug, MF, {})), requests: [] });
  /* m.owner follows the first remaining owner, so "claimed" and the owner label stay right when the admin changes */
  const editM = (slug, f) => { const run = lock.then(async () => { const m = await getM(slug); const r = await f(m); const o = m.members.filter((x) => x.role === 'owner'); if (o.length && !o.some((x) => x.email === m.owner)) m.owner = o[0].email; await packs.put(slug, MF, m); try { onTeamChange(slug); } catch {} return r ?? m; }); lock = run.catch(() => {}); return run; };
  const isAdmin = (u) => !!u && (ADMINS.has(u.email) || fullDomain(u.email));
  // who this person is to the brand: owner | member | admin | null
  async function roleOf(slug, u) {
    if (!u) return null;
    const m = await getM(slug), me = m.members.find((x) => x.email === u.email);
    /* the name and picture follow the Google account: copied when they joined, refreshed when they change */
    if (me && ((u.name && me.name !== u.name) || (u.pic && me.pic !== u.pic)) && !u.demo) editM(slug, (mm) => { const x = mm.members.find((y) => y.email === u.email); if (x) { if (u.name) x.name = u.name; if (u.pic) x.pic = u.pic; } }).catch(() => {});
    if (me) return me.role;
    /* a pending invite for this Google-verified email: they join with the invited views however they arrived (not only through the link) */
    const inv = (m.invites || []).find((x) => x.email === u.email && Date.now() - x.at < INVITE_DAYS * 86400e3);
    if (inv) { await addMember(slug, u, 'member', `Invited by ${inv.by}`, inv.seats); log.log?.(`[auth] ${slug}: ${u.email} joined from an invite (on sign-in)`); return 'member'; }
    if (isAdmin(u)) return 'admin';
    // a claimed brand: a teammate on the owner's company domain joins on their own with every view (an empty feed lost them);
    // the admins hear and can narrow their views on Team
    if (m.owner && m.domain && !freeMail(u.email) && domainOf(u.email) === m.domain) { const added = await addMember(slug, u, 'member', 'Same company email', 'all'); if (added === true) joinedMail(slug, u).catch((e) => log.warn('[auth] mail', e.message)); return 'member'; } /* two requests at once: only the one that added them emails the owners */
    return null;
  }
  /* the views this person may use on the brand: null = every view (owners, Brew admins, members from before views, visitors) */
  async function seatsOf(slug, u) {
    if (!u) return null;
    const me = (await getM(slug)).members.find((x) => x.email === u.email); /* on the brand's team: the views they were given, Brew's own people too */
    if (!me && isAdmin(u)) return null; // Brew's own people, not on this brand's team, see every view
    if (!me) { await roleOf(slug, u); const again = (await getM(slug)).members.find((x) => x.email === u.email); return again && again.role !== 'owner' ? seatList(again.seats) : null; }
    return me.role === 'owner' ? null : seatList(me.seats);
  }
  const owners = (m) => m.members.filter((x) => x.role === 'owner').map((x) => x.email);
  const brandName = async (slug) => packs.peek?.(slug)?.seed?.brand?.name || packs.peek?.(slug)?.name || (await hostOf(slug)) || slug;
  const seatWords = async (slug, seats) => { if (seats === 'all' || seats == null) return 'every view'; const N = await seatNames(slug).catch(() => ({})); return seats.length ? seats.map((k) => N[k] || k).join(', ') : 'no views yet'; };
  async function joinedMail(slug, u) {
    const m = await getM(slug), name = await brandName(slug), base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', link = `${base}/${slug}?go=feed#team`;
    const subject = `${u.name || u.email} joined ${name} on Brew`;
    for (const o of owners(m)) await mail(o, subject, emailHtml({ title: subject, eyebrow: name, preheader: 'They see every view. You can narrow that on Team.', body: para(`${esc(u.name || u.email)}${u.name ? ` (${esc(u.email)})` : ''} signed in with a company email, so they're on the team.`) + para('They see every view. If they should see less, pick their views on Team.'), cta: { href: link, label: 'Review their views' } }), `${subject}\n\nThey see every view. If they should see less, pick their views on Team: ${link}`);
  }
  const isMember = async (slug, u) => !!(await roleOf(slug, u));
  async function addMember(slug, u, role, via, seats = 'all') {
    return editM(slug, (m) => {
      const added = !m.members.some((x) => x.email === u.email);
      if (added) m.members.push({ email: u.email, name: u.name || null, pic: u.pic || null, role, seats: role === 'owner' ? 'all' : cleanSeats(seats), via, at: Date.now() });
      if (role === 'owner' && !m.owner) { m.owner = u.email; m.claimedAt = Date.now(); m.via = via; if (ownDomain(domainOf(u.email), m.host || '')) m.domain = domainOf(u.email); }
      m.requests = m.requests.filter((x) => x.email !== u.email);
      m.invites = (m.invites || []).filter((x) => x.email !== u.email);
      return added;
    });
  }
  /* the person who started the read (private/created.json, written on the first confirm or check): while nobody has claimed
     the brand they count as its own, whatever their email's domain (a founder on Gmail), and may claim it. Brew's own people
     never do (they see everything already) */
  const starterOf = async (slug, u) => { if (!u || isAdmin(u)) return false; const c = await packs.getJSON(slug, 'private/created.json', null).catch(() => null); return !!c?.by && String(c.by).toLowerCase() === String(u.email).toLowerCase(); };
  // claim by email domain (instant); a connected account claims through claimWith (connectors/index.js)
  async function claimInfo(slug, u) {
    const host = await hostOf(slug), m = await getM(slug), role = await roleOf(slug, u);
    const domainOk = !!u && !freeMail(u.email) && ownDomain(domainOf(u.email), host);
    const boss = role === 'owner' || role === 'admin', seats = role ? await seatsOf(slug, u) : null;
    const starter = !!u && !role && !m.owner && !domainOk && (await starterOf(slug, u));
    /* eligible: an official email on a brand nobody has claimed yet, or the person who started its read (they may claim it). gen: may make fresh work here */
    const eligible = !!u && !role && !m.owner && (domainOk || starter), gen = DEMO_SITE() || !!role || eligible;
    return { host, claimed: !!m.owner, role, seats, canClaim: eligible, eligible, starter, gen, full: isAdmin(u), domainOk, 
      owner: m.owner ? m.owner.replace(/^(.).*@/, '$1•••@') : null, me: u?.email || null,
      /* the person looking is always on the list: Brew's own people (admins on every brand) show as themselves, first */
      members: boss ? [...(role === 'admin' && !m.members.some((x) => x.email === u.email) ? [{ email: u.email, name: u.name || null, role: 'admin', seats: 'all', via: 'Brew' }] : []),
        ...m.members.map((x) => ({ email: x.email, name: x.name, pic: x.pic || null, role: x.role, seats: x.role === 'owner' ? 'all' : x.seats ?? 'all', via: x.via }))] : undefined,
      /* everyone on the team sees who else is on it (to tag them in a jam): names and pictures, never views */
      team: role ? m.members.map((x) => ({ email: x.email, name: x.name || null, pic: x.pic || null, role: x.role })) : undefined,
      invited: role ? (m.invites || []).filter((x) => Date.now() - x.at < INVITE_DAYS * 86400e3).map((x) => x.email) : undefined,
      invites: boss ? (m.invites || []).filter((x) => Date.now() - x.at < INVITE_DAYS * 86400e3).map((x) => ({ email: x.email, seats: x.seats, by: x.by, at: x.at })) : undefined };
  }
  /* only an official email (at the brand's own domain) claims; via says how (Claim, connecting an account, confirming the read).
     SquareUp's people already see everything, so they never take a brand that isn't at their own domain */
  async function claim(slug, u, via) {
    const host = await hostOf(slug); await editM(slug, (m) => { m.host ||= host; });
    const m = await getM(slug);
    if (m.owner) return (await roleOf(slug, u)) ? { ok: true } : { error: 'This brand is already claimed. Ask its team to invite you.' };
    const mine = (!freeMail(u.email) && ownDomain(domainOf(u.email), host)) || (await starterOf(slug, u)); /* the brand's domain, or the person who started its read */
    if (!mine && isAdmin(u)) return { error: `You have full access as Brew team. Only someone with an email at ${host} can claim it.`, full: true };
    if (!mine) return { error: `Sign in with the email you used to start this read, or with your work email at ${host}, to claim it.`, needs: 'work_email' };
    await addMember(slug, u, 'owner', via || `Email at ${domainOf(u.email)}`);
    log.log?.(`[auth] ${slug} claimed by ${u.email} (${via || 'email domain'})`);
    return { ok: true, role: 'owner' };
  }

  /* ---------- asking for access: one-tap approve from the owner's inbox ---------- */
  async function mail(to, subject, html, text) {
    const key = process.env.RESEND_API_KEY; if (!key) return log.warn('[auth] no RESEND_API_KEY'), false;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.NOTIFY_FROM || 'Brew <hello@send.joinsquareup.com>', to: [to], subject, html, text }) });
    if (!r.ok) log.warn('[auth] resend', r.status, (await r.text()).slice(0, 200)); return r.ok;
  }

  /* ---------- invites: an owner names an email and its views; the link only works for that Google account ---------- */
  const inviteLink = (base, slug, email) => `${base}/join?t=${sign({ slug, email }, INVITE_DAYS * 86400, 'invite')}`;
  async function invite(slug, by, email, seats, base, quiet = false) { /* quiet: a jam tag invites them; its own email carries the jam link */
    const m = await getM(slug); seats = cleanSeats(seats);
    if (m.members.some((x) => x.email === email)) return { error: `${email} is already on the team.` };
    if (seats !== 'all' && !seats.length) return { error: 'Pick at least one view.' };
    await editM(slug, (mm) => { mm.invites = [...(mm.invites || []).filter((x) => x.email !== email), { email, seats, by: by.email, at: Date.now() }].slice(-50); mm.requests = mm.requests.filter((x) => x.email !== email); });
    if (quiet) { log.log?.(`[auth] ${slug}: ${by.email} invited ${email} from a jam`); return { ok: true, sent: null, link: inviteLink(base, slug, email) }; }
    const name = await brandName(slug), link = inviteLink(base, slug, email), who = by.name || by.email, views = await seatWords(slug, seats);
    const subject = `${who} invited you to ${name} on Brew`;
    const sent = await mail(email, subject, emailHtml({ title: `${who} invited you to ${name}`, eyebrow: name, preheader: `You'll see ${name}'s feed as ${views}.`, body: para(`You'll see ${esc(name)}'s feed as <b style="color:#111">${esc(views)}</b>: the moves, numbers and work for your part of the business.`), cta: { href: link, label: `Join ${name}` }, after: para(`Sign in with Google as <b style="color:#111">${esc(email)}</b>. The link works for ${INVITE_DAYS} days.`, { muted: true, small: true }) }), `${subject}\n\nViews: ${views}\nJoin: ${link}\n\nSign in with Google as ${email}. The link works for ${INVITE_DAYS} days.`).catch(() => false);
    log.log?.(`[auth] ${slug}: ${by.email} invited ${email} (${seats === 'all' ? 'all' : seats.join(',')})`);
    return { ok: true, sent, link };
  }
  /* owner changes: never leave a brand with no owner */
  async function teamOp(slug, me, b) {
    const email = String(b.email || '').toLowerCase().trim(), act = b.action;
    let err = null;
    await editM(slug, (m) => {
      const x = m.members.find((y) => y.email === email);
      if (act === 'seats' && !x) { const inv = (m.invites || []).find((y) => y.email === email); if (!inv) return void (err = 'Not on the team.'); const sv = cleanSeats(b.seats); if (sv !== 'all' && !sv.length) return void (err = 'Pick at least one view.'); inv.seats = sv; return; } /* an invite's views change before they join */
      if (act === 'transfer') { const mine = m.members.find((y) => y.email === me.email); if (!x) return void (err = 'Not on the team.'); if (!mine || mine.role !== 'owner') return void (err = 'Only an admin hands it over.'); x.role = 'owner'; x.seats = 'all'; x.ownerSince = Date.now(); x.madeOwnerBy = me.email; mine.role = 'member'; mine.seats = 'all'; return; } /* in one change: never two admins or none if half of it fails */
      if (act === 'seats') { if (!x) return void (err = 'Not on the team.'); if (x.role === 'owner') return void (err = 'Admins see every view.'); x.seats = cleanSeats(b.seats); }
      else if (act === 'make_owner') { if (!x) return void (err = 'Not on the team.'); x.role = 'owner'; x.seats = 'all'; x.ownerSince = Date.now(); x.madeOwnerBy = me.email; }
      else if (act === 'step_down') { if (!x || x.role !== 'owner') return void (err = 'Not an admin.'); if (owners(m).length < 2) return void (err = 'Make someone else admin first: a brand always has one.'); x.role = 'member'; x.seats = cleanSeats(b.seats ?? []); }
      else if (act === 'remove') { if (!x) return; if (x.role === 'owner' && owners(m).length < 2) return void (err = 'A brand always has an admin: make someone else admin first.'); m.members = m.members.filter((y) => y.email !== email); } /* an admin removes anyone, other admins too, while one admin stays (yourself: refused by the route) */
      else if (act === 'revoke') m.invites = (m.invites || []).filter((y) => y.email !== email);
    });
    if (err) return { error: err };
    if (act === 'transfer') { const name = await brandName(slug), base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', subject = `You're now the admin of ${name} on Brew`; mail(email, subject, emailHtml({ title: subject, eyebrow: name, body: para(`${esc(me.name || me.email)} handed it over to you.`) + para('You can invite people, pick their views and connect accounts.'), cta: { href: `${base}/${slug}?go=feed`, label: `Open ${name}` } }), subject).catch(() => {}); }
    if (act === 'make_owner' || act === 'step_down') {
      const name = await brandName(slug), base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', subject = act === 'make_owner' ? `You're now an admin of ${name} on Brew` : `You're no longer an admin of ${name} on Brew`;
      if (email !== me.email) mail(email, subject, emailHtml({ title: subject, eyebrow: name, body: para(`${esc(me.name || me.email)} made the change.`) + para(act === 'make_owner' ? 'You can invite people, pick their views and connect accounts.' : `Your views: <b style="color:#111">${esc(await seatWords(slug, cleanSeats(b.seats ?? [])))}</b>.`), cta: { href: `${base}/${slug}?go=feed`, label: `Open ${name}` } }), subject).catch(() => {});
    }
    return { ok: true };
  }

  /* ---------- routes ---------- */
  async function handle(req, res, u) {
    const p = u.pathname;
    if (p === '/auth/google' && req.method === 'GET') {
      if (!CID || !SECRET) return json(res, 503, { error: 'Google sign-in is not configured on this server.' }), true;
      const nonce = crypto.randomBytes(16).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      setCookie(res, 'fs_g', JSON.stringify({ n: nonce, v: verifier }), 600);
      const q = new URLSearchParams({ client_id: CID, redirect_uri: `${baseOf(req)}/auth/google/callback`, response_type: 'code', scope: 'openid email profile', state: sign({ n: nonce, next: safeNext(u.searchParams.get('next')) }, 600, 'gstate'), nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account', access_type: 'online' });
      return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`), true;
    }
    if (p === '/auth/google/callback' && req.method === 'GET') {
      const fail = (why) => { log.warn('[auth] sign-in failed:', why); return redirect(res, '/?signin=failed'), true; };
      let hs; try { hs = JSON.parse(cookies(req).fs_g || ''); } catch { return fail('no handshake'); }
      setCookie(res, 'fs_g', '', 0);
      const st = verify(u.searchParams.get('state'), 'gstate'); if (!st || st.n !== hs?.n) return fail('state');
      const code = u.searchParams.get('code'); if (!code) return fail(u.searchParams.get('error') || 'no code');
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: CID, client_secret: CSEC, redirect_uri: `${baseOf(req)}/auth/google/callback`, code_verifier: hs.v }) }).catch(() => null);
      if (!r?.ok) return fail(`token ${r?.status}`);
      const tk = await r.json(); let c; try { c = JSON.parse(unb64(String(tk.id_token).split('.')[1])); } catch { return fail('id_token'); }
      if (c.aud !== CID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || !(c.exp > Date.now() / 1e3) || c.nonce !== hs.n) return fail('claims');
      if (!(c.email_verified === true || c.email_verified === 'true') || !c.email) return fail('email not verified');
      const me = { email: String(c.email).toLowerCase(), name: c.name || null, pic: c.picture || null, sub: c.sub || null };
      setCookie(res, 'fs_s', sign(me, 30 * 86400, 'session'), 30 * 86400);
      log.log?.(`[auth] signed in ${me.email}`);
      return redirect(res, st.next || '/'), true;
    }
    /* local testing only (never on Cloud Run): sign in as anyone, to try a jam as two teammates in two browsers */
    if (p === '/auth/dev' && req.method === 'GET' && (process.env.DEV_LOGIN === '1' || process.env.DEV_MEMBER === '1') && !process.env.K_SERVICE) {
      const email = String(u.searchParams.get('email') || '').toLowerCase().trim(); if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return json(res, 400, { error: 'email=' }), true;
      setCookie(res, 'fs_s', sign({ email, name: u.searchParams.get('name') || email.replace(/@.*/, ''), pic: null, sub: 'dev' }, 86400, 'session'), 86400);
      return redirect(res, safeNext(u.searchParams.get('next'))), true;
    }
    if (p === '/auth/logout') { setCookie(res, 'fs_s', '', 0); if (req.method === 'GET') return redirect(res, safeNext(u.searchParams.get('next'))), true; return json(res, 200, { ok: true }), true; }
    /* old one-tap approve links (asking for access is gone): the owner invites them instead */
    if (p === '/auth/approve' && (req.method === 'GET' || req.method === 'POST')) {
      const t = verify(u.searchParams.get('t'), 'approve');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
      return res.end(page('Access is by invite now', 'Brew no longer takes access requests. Invite them by email from Team and access on the brand page.', t?.slug || null)), true;
    }
    if (p === '/join' && req.method === 'GET') {
      const raw = u.searchParams.get('t') || '', t = verify(raw, 'invite'), html = (s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }); res.end(s); return true; };
      if (!t?.slug) return html(page('This invite has expired', 'Ask the person who invited you to send a new one.'));
      const m = await getM(t.slug), me = user(req), next = `/join?t=${raw}`;
      if (me && m.members.some((x) => x.email === me.email)) return redirect(res, `/${t.slug}?go=feed`), true; /* an email link lands in the product, never the read replay */
      const inv = (m.invites || []).find((x) => x.email === t.email);
      if (!inv || Date.now() - inv.at > INVITE_DAYS * 86400e3) return html(page('This invite is no longer valid', 'It was cancelled or replaced. Ask the person who invited you to send a new one.'));
      if (!me) return redirect(res, `/auth/google?next=${encodeURIComponent(next)}`), true;
      if (me.email !== t.email) return html(page(`This invite is for ${t.email}`, `You're signed in as ${me.email}. Switch to the invited Google account to join.`, null, `<p style="margin-top:18px"><a href="/auth/logout?next=${encodeURIComponent(`/auth/google?next=${encodeURIComponent(next)}`)}" style="background:#111;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600">Switch account</a></p>`));
      await addMember(t.slug, me, 'member', `Invited by ${inv.by}`, inv.seats);
      log.log?.(`[auth] ${t.slug}: ${me.email} joined from an invite`);
      return redirect(res, `/${t.slug}?go=feed&joined=1`), true;
    }
    if (p === '/api/me' && req.method === 'GET') {
      const me = user(req), slug = String(u.searchParams.get('brand') || '').replace(/[^a-z0-9-]/g, '');
      return json(res, 200, { user: me, signin: !!(CID && SECRET), access: slug && slug !== 'brew-sample' ? await claimInfo(slug, me) : null, full: isAdmin(me) }), true;
    }
    const m = p.match(/^\/api\/brands\/([a-z0-9-]+)\/(claim|team)$/);
    if (m) {
      const [, slug, what] = m, me = user(req);
      if (!me) return json(res, 401, { error: 'Sign in first.', signin: true }), true;
      if (!(await hostOf(slug))) return json(res, 404, { error: 'unknown brand' }), true;
      /* Claim: idempotent (the team gets { ok }); the client calls it as the seat picker opens, so a brand whose check was
         missed is still claimed by its starter or a same-domain person before "Invite your team" and jam tags need a team */
      if (what === 'claim' && req.method === 'POST') { const r = await claim(slug, me); return json(res, 200, { ...r, access: await claimInfo(slug, me) }), true; }
      if (what === 'team') {
        const role = await roleOf(slug, me); if (!role) return json(res, 403, { error: 'Only the team sees the team.' }), true;
        const boss = role === 'owner' || role === 'admin', mine = boss ? null : await seatsOf(slug, me);
        let out = {};
        if (req.method === 'POST') { const b = await readBody(req), email = String(b.email || '').toLowerCase().trim();
          /* a teammate may invite people, with no more views than their own; everything else is for admins */
          if (!boss && b.action !== 'invite') return json(res, 403, { error: 'Only an admin changes the team.' }), true;
          if (!boss && (!Array.isArray(b.seats) || !b.seats.length || (mine && b.seats.some((k) => !mine.includes(k))))) return json(res, 403, { error: 'You can invite people to your own views only.' }), true;
          if (!boss && (await getM(slug)).invites?.some((x) => x.email === email)) out = { error: `${email} is already invited.` };
          else if (b.action === 'remove' && email === me.email) out = { error: 'You can’t remove yourself.' };
          else if ((b.action === 'invite' || b.action === 'add' || b.action === 'resend') && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) {
            const prev = b.action === 'resend' ? ((await getM(slug)).invites || []).find((x) => x.email === email) : null;
            if (prev && Date.now() - prev.at < 10 * 60e3) out = { error: 'Sent a few minutes ago. Give it a little while, or copy the link instead.', link: inviteLink(baseOf(req), slug, email) };
            else { out = await invite(slug, me, email, prev ? prev.seats : b.seats ?? 'all', baseOf(req)); if (out.sent !== false) delete out.link; } } /* the link shows only when the email didn't go, so the admin can send it themselves */
          else if (['seats', 'make_owner', 'step_down', 'transfer', 'remove', 'revoke'].includes(b.action)) out = await teamOp(slug, me, b);
          else out = { error: 'Unknown team change.' }; }
        return json(res, 200, { ...(await claimInfo(slug, me)), ...(out.error ? { error: out.error } : {}), ...(out.sent === false ? { warn: 'The invite is saved but the email didn’t send. Copy the link and send it yourself.' } : {}), ...(out.link ? { link: out.link } : {}) }), true;
      }
    }
    return false;
  }
  const page = (h, p, slug, extra = '') => smallPage(h, p, { extra, link: slug ? { href: `/${slug}`, label: 'Open the brand' } : null });

  return { handle, signinOn: () => !!(CID && SECRET), user, roleOf, seatsOf, isMember, isAdmin, claim, claimInfo, accessOf: claimInfo, addMember, invite, teamOp, getMembers: getM, sign, verify, baseOf, setCookie, cookies, mail };
}
