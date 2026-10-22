// "Check what we read" waits for a person, but not forever: Brew starts writing the brief and the moves with what it read
// BUILD_CONFIRM_WAIT_MS (15 minutes) after the wait began or after someone on the team last opened the check page (build.js
// confirmDueAt, status.writeAt), unless someone checks it first. A read started by someone who wasn't signed in waits for a
// signed-in check with no time limit. While a brand still waits and its build hasn't started, this reminds the person who
// started the read and the brand's admins by email: once after a few hours, once more a day later, each with a one-click
// link back to the check page. A brand that waits gets no background research (server.js attach).
//
//   private/remind.json   { sent: { '0': at, '1': at }, to: [emails], skipped: { '0': at } }
//
// Recipients: private/created.json (who started the read) and the owners in private/members.json. A brand nobody signed
// in for has no one to remind; it still shows "waiting for you" to whoever opens it.
import { emailHtml, p as mailP, esc as mailEsc } from './mail-layout.js';

export const REMIND_AT = [3 * 36e5, 24 * 36e5]; // a few hours, then a day

/* the brand's moves wait on the check: read, not confirmed, not finished or stopped */
export const awaitingCheck = (s) => !!s && !s.done && !s.cancelled && s.stages?.confirm?.state !== 'done' && !s.confirmedAt;
/* waiting for a person right now (the read is in, the check is open) */
export const waitingOnCheck = (s) => awaitingCheck(s) && !s.error && s.stages?.read?.state === 'done' && s.stages?.confirm?.state === 'waiting';
/* since when: stamped once when the wait began (status.waitingSince); older brands fall back to when the read started */
export const waitingSince = (s) => +s?.waitingSince || +s?.createdAt || 0;
/* the build went on without the check: the brief or the moves are being (or were) written */
export const buildStarted = (s) => !!(s?.stages?.brief?.state || s?.stages?.moves?.state || +s?.movesDone > 0);

/** which reminder is due now: the latest one whose time has come and that was not sent (an earlier one that was never
    sent is skipped, so a brand found late gets one email, not two at once), or -1 */
export function dueReminder(s, sent = {}, now = Date.now()) {
  if (!waitingOnCheck(s) || buildStarted(s)) return -1; /* still unconfirmed, and nothing written yet */
  const t0 = waitingSince(s); if (!t0) return -1;
  for (let i = REMIND_AT.length - 1; i >= 0; i--) { if (now - t0 < REMIND_AT[i]) continue; return sent[i] ? -1 : i; }
  return -1;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const realAddr = (e) => EMAIL.test(e) && !/@demo\.brew$/i.test(e);

/** who to remind: the starter and the brand's owners, once each */
export async function recipients(packs, slug) {
  const [created, members] = await Promise.all([packs.getJSON(slug, 'private/created.json', null).catch(() => null), packs.getJSON(slug, 'private/members.json', null).catch(() => null)]);
  const xs = [created?.by, ...((members?.members || []).filter((m) => m.role === 'owner').map((m) => m.email)), members?.owner];
  return [...new Set(xs.map((e) => String(e || '').trim().toLowerCase()).filter(realAddr))];
}

/* a time in the brand's own zone (config.timezone; else its UTC offset, else India), e.g. "14:05 IST" or "9:05 am GMT+5:30" */
export function timeLabel(ms, cfg = {}) {
  const tz = cfg?.timezone && cfg.timezone !== 'UTC' ? cfg.timezone : null;
  if (tz) try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms)); } catch { /* the offset below */ }
  const off = cfg?.timezone !== 'UTC' && cfg?.tzOffsetH != null && cfg.tzOffsetH !== '' && Number.isFinite(+cfg.tzOffsetH) ? +cfg.tzOffsetH : 5.5, d = new Date(ms + off * 36e5);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`, sign = off < 0 ? '-' : '+', a = Math.abs(off);
  return `${hm} UTC${sign}${Math.floor(a)}${a % 1 ? ':' + String(Math.round((a % 1) * 60)).padStart(2, '0') : ''}`;
}

/** the email: plain, one button back to the check page. writeAt: when Brew starts writing without the check (status.writeAt);
    none (a read started signed out) means it waits for someone on the team */
export function reminderMail({ name, slug, i, base = process.env.PUBLIC_URL || 'https://brew.joinsquareup.com', hours, writeAt = null, now = Date.now(), cfg = {} }) {
  const link = `${base}/${slug}?go=feed#check`;
  const subject = i === 0 ? `${name} is waiting for you to check what Brew read` : `Still waiting: check what Brew read for ${name}`;
  const lead = `Brew read ${name}: the store, products, reviews, rivals and ads. The brand brief and the moves are written from what you confirm.`;
  const when = +writeAt > now ? `Brew starts your brief at ${timeLabel(+writeAt, cfg)} with what it read, unless you check first.` : 'Brew starts your brief once someone on the team checks it.';
  const since = hours >= 24 ? `It has waited ${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''}.` : `It has waited ${Math.max(1, Math.round(hours))} hours.`;
  const close = i === 0 ? 'It takes a couple of minutes: fix anything we got wrong, star your hero products, then confirm.' : 'This is the last reminder. The read stays here whenever you’re ready.';
  const html = emailHtml({ title: subject, eyebrow: name, preheader: `${since} One click opens the check page.`, base,
    body: mailP(mailEsc(lead)) + mailP(mailEsc(`${since} ${close}`)), cta: { href: link, label: 'Check what we read' },
    after: mailP(mailEsc(when), { muted: true, small: true }) });
  return { subject, html, text: `${subject}\n\n${lead}\n\n${since} ${close}\n\n${when}\n\nCheck what we read: ${link}` };
}

export function createConfirmRemind({ packs, mail, log = console, now = () => Date.now(), base }) {
  let busy = false;
  async function remindOne(slug, s) {
    const R = (await packs.getJSON(slug, 'private/remind.json', null).catch(() => null)) || { sent: {} }; R.sent ||= {};
    /* a new wait (a restarted read) starts the reminders over */
    if (R.since && R.since !== waitingSince(s)) { R.sent = {}; R.skipped = {}; }
    const i = dueReminder(s, R.sent, now()); if (i < 0) return null;
    const to = await recipients(packs, slug);
    for (let k = 0; k < i; k++) if (!R.sent[k]) (R.skipped ||= {})[k] = now();
    R.since = waitingSince(s);
    if (!to.length) { R.sent[i] = now(); R.to = []; await packs.put(slug, 'private/remind.json', R); log.log?.(`[remind] ${slug}: waiting on the check, nobody to email`); return { i, to: [] }; }
    const cfg = (await packs.getJSON(slug, 'config.json', null).catch(() => null)) || {};
    const m = reminderMail({ name: s.name || s.host || slug, slug, i, base, hours: (now() - waitingSince(s)) / 36e5, writeAt: s.writeAt || null, now: now(), cfg });
    const ok = [];
    for (const e of to) { if (await Promise.resolve(mail(e, m.subject, m.html, m.text)).catch(() => false)) ok.push(e); }
    if (!ok.length) { log.warn?.(`[remind] ${slug}: no reminder went out`); return { i, to: [], failed: true }; } /* tried again next tick */
    R.sent[i] = now(); R.to = ok; await packs.put(slug, 'private/remind.json', R);
    log.log?.(`[remind] ${slug}: reminder ${i + 1} to ${ok.join(', ')}`);
    return { i, to: ok };
  }
  async function tick() {
    if (busy) return []; busy = true; const out = [];
    try { for (const b of await packs.list().catch(() => [])) { if (!waitingOnCheck(b.status)) continue; try { const r = await remindOne(b.slug, b.status); if (r) out.push({ slug: b.slug, ...r }); } catch (e) { log.warn?.('[remind]', b.slug, e.message); } } }
    finally { busy = false; }
    return out;
  }
  const start = ({ every = 15 * 60e3, first = 3 * 60e3 } = {}) => { const a = setTimeout(() => tick().catch(() => {}), first), b = setInterval(() => tick().catch(() => {}), every); a.unref?.(); b.unref?.(); return () => { clearTimeout(a); clearInterval(b); }; };
  return { tick, start, remindOne };
}
