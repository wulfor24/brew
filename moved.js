// Brands whose home is production now (Phase 6). Only staging reads MOVED_TO_PROD (comma list of slugs): there a moved
// brand's own people are sent to production (staff, the full-access domains and admins, can still open it here), and the
// background work that spends money or writes to the brand's people (builds, rewrites, research, digests, reminders) stops,
// so the two sites never pay twice or email a partner twice. Its connectors keep reading on both (Arata stays connected).
// The reverse, on production (26 Oct): STAGING_HOME lists partners onboarded on staging first (Arata, Nutrova). Production treats
// them as moved away to staging the same way, so only one site serves, builds, emails and renews sign-ins for a brand.
const prodSite = () => process.env.ENV === 'production';
export const movedList = () => String((prodSite() ? process.env.STAGING_HOME : process.env.MOVED_TO_PROD) || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
export const movedAway = (slug) => !!slug && movedList().includes(String(slug).toLowerCase());
/* the brand's home: production from staging, staging from production */
export const prodUrl = () => String((prodSite() ? process.env.STAGING_URL || 'https://brew.joinsquareup.com' : process.env.PROD_URL) || 'https://feed.joinsquareup.com').replace(/\/+$/, '');
/* background loops: the brands they may still work on here */
export const stayHere = (list) => (movedList().length ? list.filter((b) => !movedAway(b?.slug ?? b)) : list);

/* staging, staff testing a moved brand: an email about it reaches staff only (full-access domains, admins), never the brand's
   own people, and nothing is posted to its Slack (the partner's real workspace). "About it": the brand being served (runIn) or a
   link to it in the message. Production and a staging with no moved brands are untouched */
const SLACK_SEND = /^\/api\/(chat\.(postMessage|update|postEphemeral|scheduleMessage)|files\.(upload|completeUpload|completeUploadExternal|uploadV2)|files\.getUploadURLExternal|conversations\.join)$/;
export function guardMovedSends({ isStaff, current = () => null, log = console } = {}) {
  if (!movedList().length || globalThis.fetch.__movedGuard) return false;
  const real = globalThis.fetch;
  const about = (text) => { const s = current(); if (movedAway(s)) return s; for (const m of movedList()) if (new RegExp(`/${m}(?=[/#?"'\\s<]|$)`).test(String(text || ''))) return m; return null; };
  const g = async (url, opts = {}) => {
    let u = null; try { u = new URL(typeof url === 'string' ? url : url.url); } catch {}
    const post = String(opts.method || 'GET').toUpperCase() === 'POST', readable = opts.body == null || typeof opts.body === 'string' || opts.body instanceof URLSearchParams;
    const body = typeof opts.body === 'string' ? opts.body : opts.body instanceof URLSearchParams ? opts.body.toString() : '';
    /* a send this guard can't read (a Buffer, a stream) fails closed on staging: kept back, never sent unchecked */
    const sending = u && post && ((u.hostname === 'api.resend.com' && u.pathname === '/emails') || (u.hostname === 'slack.com' && SLACK_SEND.test(u.pathname)) || u.hostname === 'hooks.slack.com');
    if (sending && !readable) { log.warn?.(`[moved] a ${u.hostname} send with a body this guard can't read was kept back (staging)`); return new Response(JSON.stringify({ ok: true, id: 'muted-unreadable' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    if (u && post && u.hostname === 'api.resend.com' && u.pathname === '/emails') {
      let j = null; try { j = JSON.parse(body); } catch {}
      const slug = j && about(`${j.html || ''}\n${j.text || ''}\n${j.subject || ''}`);
      if (slug) { const all = [].concat(j.to || []), keep = all.filter((e) => isStaff(String(e).replace(/^.*<|>.*$/g, '')));
        if (keep.length < all.length) log.warn?.(`[moved] ${slug}: email "${String(j.subject || '').slice(0, 60)}" kept from ${all.length - keep.length} of its people (staging; the brand lives on production)`);
        if (!keep.length) return new Response(JSON.stringify({ id: 'muted-moved' }), { status: 200, headers: { 'content-type': 'application/json' } });
        return real(url, { ...opts, body: JSON.stringify({ ...j, to: keep, cc: undefined, bcc: undefined }) }); } }
    if (u && post && ((u.hostname === 'slack.com' && SLACK_SEND.test(u.pathname)) || u.hostname === 'hooks.slack.com')) {
      const slug = about(body); if (slug) { log.warn?.(`[moved] ${slug}: Slack post not sent (staging; the brand lives on production)`); return new Response(JSON.stringify({ ok: true, muted: 'moved' }), { status: 200, headers: { 'content-type': 'application/json' } }); } }
    return real(url, opts);
  };
  g.__movedGuard = true; globalThis.fetch = g; return true;
}
