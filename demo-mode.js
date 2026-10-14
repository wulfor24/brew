// Demo Mode (DEMO_MODE=1, the demo site only): every visitor is the owner of a throwaway copy of the brand.
// A demo session is a cookie (brew_demo=<sid>); AsyncLocalStorage carries it through each request and through the
// background clock of that session's workspaces. The pack store maps the brand's private, per-team files to
// brands/<slug>/demo/<sid>/… (reading through to the brand's own file when the session has not written one yet), so
// one prospect's connections, changes and spend never reach another's. Without DEMO_MODE nothing here does anything.
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

export const DEMO = process.env.DEMO_MODE === '1';
const als = new AsyncLocalStorage();
export const demoSid = () => (DEMO ? als.getStore()?.sid || null : null);
export const runDemo = (sid, fn) => (DEMO && sid ? als.run({ sid }, fn) : fn());
export const okSid = (s) => typeof s === 'string' && /^[a-z0-9]{10,24}$/.test(s);
export const newSid = () => crypto.randomBytes(9).toString('hex');
/* the per-team state of a brand: what a session gets its own copy of */
const SANDBOXED = /^(private\/|connected-ledger\.json$|updates\.json$|memory\/|live\/)/;
export const sandboxName = (name, sid = demoSid()) => (DEMO && sid && SANDBOXED.test(name) ? `demo/${sid}/${name}` : null);
/* a cache key for anything held per brand in memory (connections, memory, spend): per session in demo mode */
export const sk = (slug) => { const s = demoSid(); return s ? `${slug}|${s}` : slug; };
export const demoEmail = (sid = demoSid()) => (sid ? `demo-${sid}@demo.brew` : null);
export const isDemoEmail = (e) => /^demo-[a-z0-9]+@demo\.brew$/.test(String(e || ''));
/* the files a fresh session starts with: the session's visitor owns the brand (so every team path is open to them) */
export function virtualFile(name, sid = demoSid()) {
  if (!DEMO || !sid) return null;
  if (name === 'private/members.json') { const e = demoEmail(sid); return { owner: e, claimedAt: Date.now(), via: 'Demo', members: [{ email: e, name: 'You', role: 'owner', seats: 'all', via: 'Demo', at: Date.now() }], requests: [], invites: [] }; }
  return null;
}
const COOKIE = 'brew_demo';
export const sidOf = (req) => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)brew_demo=([a-z0-9]+)/); return m && okSid(m[1]) ? m[1] : null; };
export const sidCookie = (sid) => `${COOKIE}=${sid}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; HttpOnly${process.env.K_SERVICE ? '; Secure' : ''}`;
/* the session for this request: ?d=<sid> (a share link or a reset) wins, then the cookie, else a new one. Returns the cookie to set */
export function sessionOf(req, u) {
  const q = u.searchParams.get('d'); if (q === 'new') { const s = newSid(); return { sid: s, set: sidCookie(s) }; }
  if (okSid(q)) return { sid: q, set: sidCookie(q) };
  const c = sidOf(req); if (c) return { sid: c, set: null };
  const s = newSid(); return { sid: s, set: sidCookie(s) };
}

/* the safety net: nothing on the demo site may change a real account or message a real person. Reads of public data
   (the brand's site, the ad library via treg, the AI) pass; a write to an account or sending API is refused */
const WRITE_HOSTS = /(^|\.)(graph\.facebook\.com|googleads\.googleapis\.com|myshopify\.com|a\.klaviyo\.com|judge\.me|slack\.com|api\.linear\.app|app\.asana\.com|api\.notion\.com|graph\.instagram\.com)$/;
const SEND_HOSTS = /(^|\.)(api\.resend\.com|api\.sendgrid\.com|api\.twilio\.com|hooks\.slack\.com)$/;
export function guardFetch(log = console) {
  if (!DEMO || globalThis.fetch.__demoGuard) return;
  const real = globalThis.fetch;
  const g = async (url, opts = {}) => {
    let host = ''; try { host = new URL(typeof url === 'string' ? url : url.url).hostname; } catch {}
    const method = String(opts.method || (typeof url === 'object' && url.method) || 'GET').toUpperCase();
    if (SEND_HOSTS.test(host) || (WRITE_HOSTS.test(host) && method !== 'GET')) { log.warn(`[demo] blocked ${method} ${host}`); throw new Error('Demo mode: Brew never changes a real account or sends a real message here.'); }
    return real(url, opts);
  };
  g.__demoGuard = true; globalThis.fetch = g;
}
