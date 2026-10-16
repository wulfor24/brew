// What Slack sends Brew (the Brew Slack app, docs/slack-app-manifest.json): thread replies (/slack/events) and button
// presses (/slack/actions). Every request is checked against the app's signing secret before anything is read, answered
// within Slack's 3 seconds, and worked on after the answer. A reply finds its jam by the thread it is in (feed-service
// slackIn); the workspace finds its brand by the Slack connection (connectors slackSlug). Bots, edits and Brew's own posts
// are skipped, so a message mirrored from the jam never comes back as a reply.
import { verify } from './connectors/slack.js';

/* Slack's markup to plain words: <@U1> mentions, <url|label> links, <#C1|name> channels */
export const plain = (s, names = {}) => String(s || '')
  .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, n) => `@${n || names[id] || 'someone'}`)
  .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)').replace(/<(https?:[^>]+)>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

/* the thread reply Brew takes: a person's message inside a thread, not an edit, a join, a bot or the thread's own post */
export const isReply = (ev) => ev?.type === 'message' && !ev.subtype && !ev.bot_id && !!ev.user && !!ev.thread_ts && ev.thread_ts !== ev.ts;

/* who may act from Slack: the brand's team in Brew (auth teamRole: its members, and Brew's own staff), matched by the email
   Slack shares. A jam's guests and anyone else in the workspace are not the team. With no check wired, nobody is */
export const DENY = (name) => `Only ${name || 'the brand'}’s team in Brew can approve or make things here. Ask them to invite you to Brew with this email.`;

export function createSlackRoutes({ connectors, feed, member = async () => false, brandName = async (s) => s, log = console, secret = () => process.env.SLACK_SIGNING_SECRET || '' }) {
  const seen = new Map(); // event ids already handled (Slack retries): 1 hour
  const once = (id) => { const now = Date.now(); for (const [k, at] of seen) if (now - at > 3600e3) seen.delete(k); if (!id || seen.has(id)) return !id; seen.set(id, now); return true; };
  const raw = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => r(d)); req.on('error', () => r('')); });
  const out = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body == null ? '' : JSON.stringify(body)); };
  const onTeam = async (slug, user) => !!user?.email && !!(await member(slug, String(user.email).toLowerCase()).catch(() => false));
  const told = new Map(); // a non-member told once per thread (1 day), so their chatter isn't answered every time

  async function reply(ev, team) {
    const slug = await connectors.slackSlug(team); if (!slug) return log.warn('[slack] no brand has workspace', team);
    const user = await connectors.slackUser(slug, ev.user); if (user.bot) return;
    /* someone outside the brand's team in Brew: their words don't reach the jam (no brief edit, no yes, no @Brew change) */
    if (!(await onTeam(slug, user))) {
      const k = `${slug}|${ev.thread_ts}|${ev.user}`, now = Date.now(); for (const [x, at] of told) if (now - at > 86400e3) told.delete(x);
      log.log?.(`[slack] ${slug}: a reply from ${user.name} (not on the team) left out`);
      if (!told.has(k)) { told.set(k, now); await connectors.slackEphemeral?.(slug, { channel: ev.channel, user: ev.user, thread_ts: ev.thread_ts, text: DENY(await brandName(slug)) }).catch(() => {}); }
      return;
    }
    /* written to @Brew: a change applies at once (still never a paid image or video without a yes) */
    const bot = (await connectors.slackOf?.(slug)?.catch?.(() => null))?.bot, mention = !!bot && String(ev.text || '').includes(`<@${bot}>`);
    const r = await feed()?.slackIn({ slug, kind: 'reply', thread: ev.thread_ts, ts: ev.ts, user: { ...user, team: true }, mention, text: plain(ev.text, bot ? { [bot]: 'Brew' } : {}) });
    log.log?.(r?.w ? `[slack] ${slug}: a reply from ${user.name} in jam ${r.w.id}` : `[slack] ${slug}: no jam has thread ${ev.thread_ts}`);
  }
  async function press(p) {
    const a = (p.actions || [])[0];
    if (a?.action_id === 'apply' || a?.action_id === 'dismiss') return proposal(p, a);
    if (a?.action_id !== 'approve') return;
    const [slug, wid, n] = String(a.value || '').split('|'), team = p.team?.id, ts = p.message?.ts, root = p.message?.thread_ts || ts; /* pressed on the jam's post or on an asset in its thread */
    const tell = (text) => p.response_url && fetch(p.response_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }) }).catch(() => {});
    /* the button must come from the workspace this brand connected, on the jam's own post */
    if (!slug || (await connectors.slackSlug(team)) !== slug) return tell('This workspace isn’t connected to that brand in Brew any more.');
    const user = await connectors.slackUser(slug, p.user?.id); if (user.bot) return;
    if (!(await onTeam(slug, user))) return tell(DENY(await brandName(slug)));
    const r = await feed()?.slackIn({ slug, kind: 'approve', thread: root, user: { ...user, team: true }, n: +n });
    if (!r?.w || r.w.id !== wid) return tell('Brew couldn’t find that jam. Open it in Brew to approve.');
    if (r.stale) return tell(`It changed to v${r.w.current} in Brew since this was posted. Open it in Brew, check it, then approve.`);
    /* the post now says who approved it, in place of the button */
    const blocks = (p.message.blocks || []).filter((b) => b.type !== 'actions').concat([{ type: 'context', elements: [{ type: 'mrkdwn', text: `:white_check_mark: Approved v${r.w.current} by ${user.name}${r.w.slack?.page ? ` · <${r.w.slack.page}|Open in Brew>` : ''}` }] }]);
    await connectors.slackPost(slug, { channel: p.channel?.id, update: ts, text: p.message.text || 'Approved', blocks });
  }

  /* Make it / Not now on a proposal Brew posted in the thread */
  async function proposal(p, a) {
    const [slug, wid, pid] = String(a.value || '').split('|');
    const tell = (text) => p.response_url && fetch(p.response_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }) }).catch(() => {});
    if (!slug || (await connectors.slackSlug(p.team?.id)) !== slug) return tell('This workspace isn’t connected to that brand in Brew any more.');
    const user = await connectors.slackUser(slug, p.user?.id); if (user.bot) return;
    if (!(await onTeam(slug, user))) return tell(DENY(await brandName(slug)));
    const r = await feed()?.slackIn({ slug, kind: a.action_id, thread: p.message?.thread_ts || p.message?.ts, user: { ...user, team: true }, pid });
    if (!r?.w || r.w.id !== wid) return tell('Brew couldn’t find that jam. Open it in Brew.');
    if (r.gone) return tell('That was already answered.');
    if (r.error) tell(r.error);
  }
  return async function handle(req, res, u) {
    if (req.method !== 'POST' || !['/slack/events', '/slack/actions'].includes(u.pathname)) return false;
    const body = await raw(req);
    if (!verify(body, req.headers, secret())) return out(res, 401, { error: 'bad signature' }), true;
    if (u.pathname === '/slack/events') {
      let j = {}; try { j = JSON.parse(body); } catch {}
      if (j.type === 'url_verification') return out(res, 200, { challenge: j.challenge }), true;
      out(res, 200, null); /* answered: Slack retries anything slower than 3 seconds */
      if (j.type !== 'event_callback' || !once(j.event_id)) return true;
      const ev = j.event || {};
      log.log?.(`[slack] event ${ev.type}${ev.subtype ? '/' + ev.subtype : ''} from ${j.team_id}${ev.thread_ts ? ' in a thread' : ''}`);
      if (ev.type === 'app_uninstalled' || ev.type === 'tokens_revoked') connectors.slackGone(j.team_id).then((s) => s && log.log?.(`[slack] ${s}: Slack was removed`)).catch(() => {});
      else if (isReply(ev)) reply(ev, j.team_id || ev.team).catch((e) => log.warn('[slack] reply', e.message));
      return true;
    }
    let p = {}; try { p = JSON.parse(new URLSearchParams(body).get('payload') || '{}'); } catch {}
    out(res, 200, null);
    if (p.type === 'block_actions') press(p).catch((e) => log.warn('[slack] action', e.message));
    return true;
  };
}
