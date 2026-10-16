// Ops alerts: one email to the ShopOS team (ALERT_EMAIL, default hello@joinsquareup.com) when something that stops paid work goes
// wrong, at most once per issue per day (the day's sent list is kept in the bucket, _brew/alerts.json, so a restart never
// repeats one). Issues:
//   vertex-billing  a Vertex call failed on billing or credits (Google credits out, billing off)
//   vertex-quota    VERTEX_429_ALERT (5) or more 429 / quota errors from Vertex within 10 minutes
//   ai-pause        the AI pause turned on (ai.js: a billing failure stops every call for 15 minutes)
//   treg-low        treg's team balance is under TREG_LOW_USD (default $10, about one store read is $6)
//   5xx             ALERT_5XX_RATE (5%) or more of the last 10 minutes' responses were 5xx, once there were ALERT_5XX_MIN (50)
// On Cloud Run only (ALERTS=1 turns it on locally, ALERTS=0 off), never under AI_MOCK or on the demo site.
import { emailHtml, p as mailP, list as mailList } from './mail-layout.js';

const WINDOW = 10 * 60e3;
const BILLING = /billing|BILLING_DISABLED|credits? (are|is) (exhausted|used)|out of credits|insufficient.{0,20}(credit|funds|balance)|account.{0,20}(suspended|closed)/i;
const QUOTA = /RESOURCE_EXHAUSTED|quota|rate limit/i;

let sink = null;
/* anyone can report: the watcher (once made) decides whether it is worth an email */
export const noteAlert = (kind, detail = '') => { try { sink?.note(kind, detail); } catch {} };
/* a failed Vertex call (text, image, voice, video): billing errors alert at once, 429s and quota errors when they pile up */
export function noteVertex(status, text = '') {
  const t = String(text || '');
  if (BILLING.test(t) || (status === 403 && /billing|credit/i.test(t))) return noteAlert('vertex-billing', `${status}: ${t.slice(0, 200)}`);
  if (status === 429 || QUOTA.test(t)) return noteAlert('vertex-quota', `${status}: ${t.slice(0, 200)}`);
}

const TITLE = {
  'vertex-billing': 'Vertex is refusing calls on billing',
  'vertex-quota': 'Vertex quota is running out',
  'ai-pause': 'Brew’s AI is paused',
  'treg-low': 'treg balance is low',
  '5xx': 'Brew is returning server errors'
};
const WHAT = {
  'vertex-billing': 'Check the Google Cloud billing account and credits for squareup-492617. Until it is fixed, moves, drafts and images fail.',
  'vertex-quota': 'Vertex keeps answering 429 (quota). Check the quota page for squareup-492617, or slow the background jobs down.',
  'ai-pause': 'A billing failure paused every AI call for 15 minutes. It turns itself back on, and pauses again while the credit is out.',
  'treg-low': 'Top up the squareup team on treg. Store reads, rivals’ ads, SERP and Instagram need it; at $0 the reads fall back or fail.',
  '5xx': 'Look at the Cloud Run logs for shopos-feed (severity ERROR) to see what is failing.'
};

export function createAlerts({ env = process.env, store = null, treg = null, sendMail = null, now = () => Date.now(), log = console } = {}) {
  const on = env.ALERTS === '1' || (env.ALERTS !== '0' && !!env.K_SERVICE && env.AI_MOCK !== '1' && env.DEMO_MODE !== '1');
  const cfg = { to: env.ALERT_EMAIL || 'hello@joinsquareup.com', quotaN: +env.VERTEX_429_ALERT || 5, tregLow: +(env.TREG_LOW_USD ?? 10), rate: +(env.ALERT_5XX_RATE ?? 0.05), minReq: +env.ALERT_5XX_MIN || 50 };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  let sent = { day: day(), issues: {} }, loaded = !store, quota = [], reqs = [], timer = null;
  const ready = store ? store.get().then((j) => { if (j?.day === day()) sent = { day: j.day, issues: { ...(j.issues || {}) } }; }).catch(() => {}).finally(() => { loaded = true; }) : Promise.resolve();

  async function fire(issue, detail = '') {
    await ready; if (sent.day !== day()) sent = { day: day(), issues: {} };
    if (sent.issues[issue]) return false; /* once per issue per day */
    sent.issues[issue] = new Date(now()).toISOString();
    if (on) await store?.put(sent).catch((e) => log.warn?.('[alerts] save', e.message));
    log.warn?.(`[alerts] ${issue}: ${detail}`);
    if (!on || !sendMail) return true;
    const title = TITLE[issue] || issue, html = emailHtml({ eyebrow: 'Brew ops', title, preheader: WHAT[issue] || detail,
      body: mailP(WHAT[issue] || '') + (detail ? mailList([String(detail).slice(0, 400)]) : '') + mailP(`This alert is sent at most once a day. Revision ${env.K_REVISION || 'local'}.`, { muted: true, small: true }) });
    await sendMail({ to: cfg.to, subject: `Brew alert: ${title}`, html, text: `${title}\n\n${WHAT[issue] || ''}\n${detail}` }).catch((e) => log.warn?.('[alerts] send', e.message));
    return true;
  }
  function note(kind, detail = '') {
    if (kind === 'vertex-quota') { const t = now(); quota = quota.filter((x) => t - x < WINDOW); quota.push(t); if (quota.length >= cfg.quotaN) return fire(kind, `${quota.length} in 10 minutes. Last: ${detail}`); return null; }
    return fire(kind, detail);
  }
  /* every response: counted for the 5xx rate */
  function response(status) { reqs.push([now(), +status >= 500]); if (reqs.length > 20000) reqs = reqs.slice(-10000); }
  async function check() {
    const t = now(); reqs = reqs.filter(([at]) => t - at < WINDOW);
    const bad = reqs.filter(([, b]) => b).length;
    if (reqs.length >= cfg.minReq && bad / reqs.length >= cfg.rate) await fire('5xx', `${bad} of ${reqs.length} responses in the last 10 minutes were 5xx`);
    if (treg?.balance && cfg.tregLow > 0) { const b = await treg.balance().catch((e) => ({ error: e.message }));
      if (b && b.usd != null && b.usd < cfg.tregLow) await fire('treg-low', `Balance $${b.usd.toFixed(2)}, under $${cfg.tregLow}.`); }
  }
  function start(everyMs = WINDOW) { if (!on || timer) return; timer = setInterval(() => check().catch((e) => log.warn?.('[alerts] check', e.message)), everyMs); timer.unref?.(); setTimeout(() => check().catch(() => {}), 60e3).unref?.(); }
  const api = { on, cfg, note, fire, response, check, start, ready, get sent() { return sent; }, get loaded() { return loaded; } };
  sink = api;
  return api;
}
