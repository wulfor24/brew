// Apify client (https://apify.com): run one actor and read its dataset in a single call; spend metered like treg.
// run(actor, input, o) → dataset items. Token from APIFY_TOKEN (or the Apify CLI's ~/.apify/auth.json); without one every run says 'needs APIFY_TOKEN'.
// Apify does not return the price of a sync run: usd is estimated from the actor's published prices (o.startUsd + items × o.perItemUsd),
// and maxTotalChargeUsd caps what a pay-per-event actor may charge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const cliToken = () => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.apify', 'auth.json'), 'utf8')).token || null; } catch { return null; } };

/* one cache for every Apify client (server.js sets it to the bucket on Cloud Run): a run with the same actor and input is
   paid for once per window (reviews a week, anything else a day), and identical runs in flight share one answer */
let sharedCache = null;
export const setApifyCache = (c) => { sharedCache = c; };
const ttlOf = (actor) => (/review/i.test(actor) ? 168 : +process.env.APIFY_CACHE_HOURS || 24);
const inflight = new Map();
/* every client's charges reach these too (server.js books them per brand in spend/<month>.json, tags prefixed apify) */
const anyCharge = [];
export const onAnyApifyCharge = (f) => anyCharge.push(f);
export function createApify({ token = process.env.APIFY_TOKEN || cliToken(), log = console, fetchImpl = (...a) => fetch(...a), cache = undefined } = {}) {
  const meter = { usd: 0, runs: 0, byTag: {}, hits: 0 }, listeners = [];
  const off = process.env.APIFY_OFF === '1';
  async function run(actor, input = {}, o = {}) {
    if (off) throw Object.assign(new Error('apify is off'), { off: true });
    if (!token) throw Object.assign(new Error('needs APIFY_TOKEN'), { needs: true });
    const c = cache === undefined ? sharedCache : cache, k = crypto.createHash('sha256').update(JSON.stringify([actor, input, o.maxItems || 200])).digest('hex').slice(0, 40);
    if (inflight.has(k)) return inflight.get(k);
    const p = (async () => {
      const hit = c && o.cache !== false ? await c.get(k).catch(() => null) : null;
      if (hit && Date.now() - Date.parse(hit.at) < ttlOf(actor) * 36e5) { meter.hits++; return hit.data; }
      const items = await runLive(actor, input, o);
      if (c) c.put(k, { at: new Date().toISOString(), actor, data: items }).catch(() => {});
      return items;
    })();
    inflight.set(k, p); p.finally(() => inflight.delete(k)).catch(() => {});
    return p;
  }
  async function runLive(actor, input = {}, { timeoutSecs = 240, maxItems = 200, startUsd = 0.005, perItemUsd = 0.003, maxUsd = 0.25, memory = null, tag } = {}) {
    const u = `https://api.apify.com/v2/acts/${String(actor).replace('/', '~')}/run-sync-get-dataset-items?format=json&clean=1&timeout=${timeoutSecs}&maxItems=${maxItems}&maxTotalChargeUsd=${maxUsd}${memory ? `&memory=${memory}` : ''}`; /* memory (MB): the account caps all runs at once */
    const r = await fetchImpl(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout((timeoutSecs + 30) * 1e3) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t || '[]'); } catch {}
    // a run that started is paid for even when it fails
    const items = Array.isArray(j) ? j : [], usd = +Math.min(maxUsd, startUsd + items.length * perItemUsd).toFixed(5);
    meter.usd += usd; meter.runs++; meter.byTag[tag || actor] = (meter.byTag[tag || actor] || 0) + usd; listeners.forEach((f) => f(tag || actor, usd, meter)); anyCharge.forEach((f) => f(tag || actor, usd));
    if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${(j?.error?.message || t).slice(0, 200)}`);
    if (!Array.isArray(j)) throw new Error(`apify ${actor}: not a dataset`);
    return items;
  }
  return { run, meter, onCharge: (f) => listeners.push(f), live: !off && !!token };
}
