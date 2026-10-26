// The day's AI budget, by kind (text, image, video, voice, and Sloosh credits for finals): one ceiling for the whole server and a share for each brand, so one
// brand (or the Slack workspace that acts for it) can't use the whole day. Counters live in the bucket (_brew/usage-day.json) and
// are loaded before the server takes its first call (server.js awaits load()), so a restart or a deploy never hands out a fresh day.
// A brand's share: BRAND_<KIND>_CAP when set, else DAILY_BRAND_SHARE (default a third) of the server's cap, at least one.
// Calls with no brand (the Brew default context) count only against the ceiling.
import { B } from './brand-ctx.js';

export const KINDS = ['text', 'image', 'video', 'voice', 'credits'];
const NOUN = { text: 'writing', image: 'picture', video: 'video', voice: 'voice', credits: 'Sloosh credit' };
const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10); /* UTC: one reset time for every brand */

export function capsFrom(env = process.env) {
  /* pictures, clips and credits are all Sloosh since 27 Oct, on an account Param keeps unlimited for now: counted, not capped (set the
     env caps to cap them again) */
  const OPEN = 1e9;
  const all = { text: +env.DAILY_TEXT_CAP || 400, image: +env.DAILY_IMAGE_CAP || OPEN, video: +env.DAILY_VIDEO_CAP || OPEN, voice: +env.DAILY_VOICE_CAP || 60, credits: +env.DAILY_CREDITS_CAP || OPEN };
  const share = Math.min(1, Math.max(0.01, +(env.DAILY_BRAND_SHARE ?? 1 / 3) || 1 / 3));
  const brand = Object.fromEntries(KINDS.map((k) => [k, Math.max(1, +env[`BRAND_${k.toUpperCase()}_CAP`] || Math.ceil(all[k] * share))]));
  return { all, brand };
}

let current = null; /* the server's budget, for modules that only need to say why a spend was refused (drafts.js) */

/* store: { get: async () => saved | null, put: async (state) => {} } */
/* shared: counters.js on Postgres, so every instance counts against the same day (the saved file stays as a record) */
export function createBudget({ env = process.env, store = null, shared = null, now = () => Date.now(), log = console, debounceMs = 3000 } = {}) {
  const caps = capsFrom(env);
  const fresh = () => ({ day: dayOf(now()), all: Object.fromEntries(KINDS.map((k) => [k, 0])), brands: {} });
  let s = fresh(), loaded = false, t = null;
  const roll = () => { if (s.day !== dayOf(now())) s = fresh(); };
  const save = () => { if (!store) return; clearTimeout(t); t = setTimeout(() => store.put(snapshot()).catch((e) => log.warn?.('[budget] save', e.message)), debounceMs); t.unref?.(); };
  const slugNow = (slug) => slug === undefined ? (B()?.kind === 'default' ? null : B()?.slug || null) : slug || null;
  const mine = (slug) => (s.brands[slug] ||= Object.fromEntries(KINDS.map((k) => [k, 0])));
  const snapshot = () => ({ ...JSON.parse(JSON.stringify(s)), at: new Date(now()).toISOString() });
  const sh = shared?.on ? shared : null;
  const usedAll = (k) => (sh ? Math.max(s.all[k], sh.total('ai', `${k}|*`)) : s.all[k]);
  const usedBrand = (slug, k) => (sh ? Math.max(mine(slug)[k], sh.total('ai', `${k}|${slug}`)) : mine(slug)[k]);

  /* the saved day, merged (a counter never goes down): awaited before the first call */
  async function load() {
    if (!store) { loaded = true; return; }
    try { const j = await store.get(); roll();
      if (j && (j.day === s.day || j.day === new Date(now()).toDateString())) { /* the old file kept toDateString() and only the totals */
        for (const k of KINDS) s.all[k] = Math.max(s.all[k], +(j.all?.[k] ?? j[k]) || 0);
        for (const [sl, x] of Object.entries(j.brands || {})) { const m = mine(sl); for (const k of KINDS) m[k] = Math.max(m[k], +x?.[k] || 0); } }
    } catch (e) { log.warn?.('[budget] load', e.message); }
    loaded = true;
  }
  /* why a spend of n units would be refused now: null when it can go (credits are weighted: a final costs what Sloosh quotes) */
  function refusal(kind, slug, n = 1) {
    roll(); slug = slugNow(slug); n = Math.max(0, +n || 0) || 1;
    if (usedAll(kind) + n > caps.all[kind]) return 'all';
    if (slug && usedBrand(slug, kind) + n > caps.brand[kind]) return 'brand';
    return null;
  }
  /* n units of kind (default one) for this brand (default: the brand of the request or job in hand): false when its share or the ceiling is used */
  function spend(kind, slug, n = 1) {
    if (!KINDS.includes(kind)) return true;
    slug = slugNow(slug); n = Math.max(0, +n || 0) || 1; if (refusal(kind, slug, n)) return false;
    s.all[kind] += n; if (slug) mine(slug)[kind] += n; if (sh) { sh.add('ai', `${kind}|*`, n); if (slug) sh.add('ai', `${kind}|${slug}`, n); } save(); return true;
  }
  /* units taken for a paid call that then didn't go out (Sloosh refused it): given back */
  function refund(kind, slug, n = 1) {
    if (!KINDS.includes(kind)) return; roll(); slug = slugNow(slug); n = Math.max(0, +n || 0) || 1;
    s.all[kind] = Math.max(0, s.all[kind] - n); if (slug) mine(slug)[kind] = Math.max(0, mine(slug)[kind] - n); if (sh) { sh.add('ai', `${kind}|*`, -n); if (slug) sh.add('ai', `${kind}|${slug}`, -n); } save();
  }
  /* what is left today for a brand, for the page and /api/config */
  function left(slug) {
    roll(); slug = slugNow(slug); const m = slug ? mine(slug) : null;
    return Object.fromEntries(KINDS.map((k) => { const ub = m ? usedBrand(slug, k) : 0, brandLeft = m ? caps.brand[k] - ub : Infinity, allLeft = caps.all[k] - usedAll(k);
      return [k, { used: m ? ub : usedAll(k), cap: m ? caps.brand[k] : caps.all[k], left: Math.max(0, Math.min(brandLeft, allLeft)), out: brandLeft <= 0 ? 'brand' : allLeft <= 0 ? 'all' : null }]; }));
  }
  /* a plain sentence for the UI when a spend was refused */
  function why(kind, slug, name = null, units = 1) {
    const r = refusal(kind, slug, units), n = NOUN[kind] || kind;
    if (r === 'brand') { const have = Math.max(0, caps.brand[kind] - usedBrand(slugNow(slug), kind)); /* a final that costs more than what is left is not "used up" */
      return units > 1 && have > 0 ? `This costs ${Math.ceil(units)} ${n}s and ${name || 'this brand'} has ${Math.floor(have)} of ${caps.brand[kind]} left today. It resets at midnight UTC.` : `${name || 'This brand'}’s ${n} share for today is used up (${caps.brand[kind]} a day). It resets at midnight UTC.`; }
    if (r === 'all') return `Our ${n} budget for today is used up across all brands. It resets at midnight UTC.`;
    return null;
  }
  const api = { caps, load, spend, refund, touch: save, refusal, left, why, snapshot, get loaded() { return loaded; }, get state() { roll(); return s; }, flush: async () => { clearTimeout(t); if (store) await store.put(snapshot()); } };
  current = api;
  return api;
}

/* the reason a spend was just refused, for the brand in hand, or null (no budget made yet, or nothing refused) */
export const budgetWhy = (kind, slug, name) => current?.why(kind, slug, name) || null;
