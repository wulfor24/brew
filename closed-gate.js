// A store that hasn't launched: read from its Shopify Admin API while its storefront is behind Shopify's password page
// (reader/stages/admin.js, status.json source.kind 'shopify-admin', profile.closed set). Its read holds the merchant's
// unpublished catalog (active products, prices) and the moves made from it, so while it stays closed only its team sees it:
// the brand's members (auth.roleOf) and Brew's own full-access people. Everyone else gets a plain "This store isn't open yet"
// page (or a 401/403 for the API and files), never the brand in demo mode and never a 404. When a heal finds the store open
// (reopenCheck clears profile.closed) the brand goes back to the public behaviour every other brand has.
// Every other brand is untouched: only a brand whose read came from the Shopify admin is ever looked at twice.
import { smallPage } from './small-page.js';

/* closed: read from the Shopify admin, and the read has not seen the store open. A profile not written yet (the read is still
   running, or a restart emptied it) counts as closed, as build.js adminFor does */
export const isClosedRead = (status, profile) => status?.source?.kind === 'shopify-admin' && !(profile && !profile.closed);

/* the brand a request names: its page (/<slug>), its seed, facts and PDFs (/b/<slug>/…), its routes (/api/brands/<slug>/…), the Shopify
   connector's start (?brand=), or the brand an /api call runs for (x-brand). Workspaces (/api/tenants/<id>/…, cards, jams)
   name theirs through the tenant: feed-service asks closedFor with it */
const RESERVED = new Set(['api', 'b', 'auth', 'join', 'connect', 'assets', 'gen', 'research', 'h', 'tour', 'shopify', 'privacy', 'terms', 'data', 'mail', 'index.html']);
export function slugIn(req, u) {
  const p = u.pathname; let m;
  /* its files: the seed and facts scripts and the move PDFs. Photos (a/, refs/, statics/) stay as they are: their names come only
     from what this gate keeps back, the products' photos are on Shopify's own CDN anyway, and inside the Shopify admin an <img>
     can't carry the session token, so the team would lose every picture */
  if ((m = /^\/b\/([a-z0-9-]+)\/(?:seed\.js|facts\.js|pdf\/)/.exec(p))) return m[1];
  if ((m = /^\/api\/brands\/([a-z0-9-]+)(?:\/|$)/.exec(p))) return m[1];
  if (/^\/connect\/[a-z0-9]+\/start$/.test(p)) return String(u.searchParams.get('brand') || '').replace(/[^a-z0-9-]/g, '') || null;
  if (p.startsWith('/api/')) { const b = String(req.headers?.['x-brand'] || (p === '/api/tenants' ? u.searchParams.get('brand') || '' : '')).replace(/[^a-z0-9-]/g, ''); return b || null; }
  if ((m = /^\/([A-Za-z0-9-]+)\/?$/.exec(p)) && !RESERVED.has(m[1].toLowerCase())) return m[1].toLowerCase();
  return null;
}

export const CLOSED_H = 'This store isn’t open yet';
export const CLOSED_P = 'It’s still behind Shopify’s password page, so we show it to the store’s own team until it opens.';
const enc = encodeURIComponent;

/** createClosedGate({ status, profile, user, roleOf, on, renew }):
 *   status(slug) → status.json, profile(slug) → profile.json, user(req) → the signed-in person, roleOf(slug, user) → their role
 *   on() → is the gate on here (live, with sign-in; the demo site and a local server with sign-in off stay open)
 *   renew(req, u, res) → a page that asks the Shopify admin who is looking and loads again (shopify-app.js), or null: a page
 *     inside the admin can't send its session token on its own load, so nobody is signed in on it until it asks
 *  gate(req, res, u) answers a request for a closed brand from outside its team (true) or lets it through (false);
 *  closedFor(req, res, u, slug) does the same for a brand the caller already knows (feed-service's workspaces). */
export function createClosedGate({ status, profile, user, roleOf, on = () => true, renew = () => null, ttl = 15e3, log = console }) {
  const MEMO = new Map(); /* slug → { at, closed }: assets, files and API calls come in bursts; a reopen shows within ttl */
  async function closed(slug) {
    const c = MEMO.get(slug); if (c && Date.now() - c.at < ttl) return c.closed;
    const s = await status(slug).catch(() => null); if (!s) return false; /* an unknown brand: its own route answers */
    const v = s.source?.kind === 'shopify-admin' ? isClosedRead(s, await profile(slug).catch(() => null)) : false; /* only an admin read pays for the profile */
    MEMO.set(slug, { at: Date.now(), closed: v }); if (MEMO.size > 5000) MEMO.clear(); return v;
  }
  /* the team: members (owner, member, an invite or the company domain that joins them, auth.js roleOf) and Brew's own people */
  const team = async (slug, me) => !!me && !!(await roleOf(slug, me).catch(() => null));
  function answer(req, res, u, slug, me) {
    const p = u.pathname, head = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }, code = me ? 403 : 401;
    if (p.startsWith('/api/')) { res.writeHead(code, { ...head, 'content-type': 'application/json' }); res.end(JSON.stringify({ error: `${CLOSED_H}. We show it to the store’s team only until it opens.`, closed: true, team: true, signin: !me })); return true; }
    if (/^\/b\/[^/]+\/(seed|facts)\.js$/.test(p)) { res.writeHead(code, { ...head, 'content-type': 'text/javascript; charset=utf-8' }); res.end('/* this store isn’t open yet */'); return true; }
    if (p.startsWith('/b/')) { res.writeHead(code, { ...head, 'content-type': 'text/plain; charset=utf-8' }); res.end(`${CLOSED_H}.`); return true; }
    /* the page (and the connector's start, a jam's handoff page): plain words, and the way in for the team. Inside the Shopify
       admin, nobody signed in yet means the frame hasn't said who it is: it asks once, then this runs again with the person */
    const again = me ? null : renew(req, u, res); if (again) { res.writeHead(200, { ...head, 'content-type': 'text/html; charset=utf-8' }); res.end(again); return true; }
    const back = `/${slug}`, signin = `/auth/google?next=${enc(back)}`;
    const html = smallPage(CLOSED_H, CLOSED_P, me
      ? { extra: `<p>You’re signed in as ${String(me.email).replace(/[&<>"]/g, '')}. Ask the store’s team to invite you.</p>`, link: { href: `/auth/logout?next=${enc(signin)}`, label: 'Switch account' } }
      : { extra: '<p>On the store’s team? Sign in to see it.</p>', link: { href: signin, label: 'Sign in' } });
    res.writeHead(403, { ...head, 'content-type': 'text/html; charset=utf-8' }); res.end(html); return true;
  }
  async function closedFor(req, res, u, slug) {
    if (!slug || !on()) return false;
    if (!(await closed(slug))) return false;
    const me = user(req); if (await team(slug, me)) return false;
    if (!u.pathname.startsWith('/b/')) log.log?.(`[closed] ${slug}: ${me?.email || 'someone signed out'} kept out of ${u.pathname}`); /* a page's files would say it many times */
    return answer(req, res, u, slug, me);
  }
  const gate = (req, res, u) => closedFor(req, res, u, slugIn(req, u));
  return { gate, closedFor, closed, forget: (slug) => (slug ? MEMO.delete(slug) : MEMO.clear()) };
}
