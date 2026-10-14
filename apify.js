// Apify client (https://apify.com): run one actor and read its dataset in a single call; spend metered like treg.
// run(actor, input, o) → dataset items. Token from APIFY_TOKEN (or the Apify CLI's ~/.apify/auth.json); without one every run says 'needs APIFY_TOKEN'.
// Apify does not return the price of a sync run: usd is estimated from the actor's published prices (o.startUsd + items × o.perItemUsd),
// and maxTotalChargeUsd caps what a pay-per-event actor may charge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cliToken = () => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.apify', 'auth.json'), 'utf8')).token || null; } catch { return null; } };

export function createApify({ token = process.env.APIFY_TOKEN || cliToken(), log = console, fetchImpl = (...a) => fetch(...a) } = {}) {
  const meter = { usd: 0, runs: 0, byTag: {} }, listeners = [];
  const off = process.env.APIFY_OFF === '1';
  async function run(actor, input = {}, { timeoutSecs = 240, maxItems = 200, startUsd = 0.005, perItemUsd = 0.003, maxUsd = 0.25, tag } = {}) {
    if (off) throw Object.assign(new Error('apify is off'), { off: true });
    if (!token) throw Object.assign(new Error('needs APIFY_TOKEN'), { needs: true });
    const u = `https://api.apify.com/v2/acts/${String(actor).replace('/', '~')}/run-sync-get-dataset-items?format=json&clean=1&timeout=${timeoutSecs}&maxItems=${maxItems}&maxTotalChargeUsd=${maxUsd}`;
    const r = await fetchImpl(u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout((timeoutSecs + 30) * 1e3) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t || '[]'); } catch {}
    // a run that started is paid for even when it fails
    const items = Array.isArray(j) ? j : [], usd = +Math.min(maxUsd, startUsd + items.length * perItemUsd).toFixed(5);
    meter.usd += usd; meter.runs++; meter.byTag[tag || actor] = (meter.byTag[tag || actor] || 0) + usd; listeners.forEach((f) => f(tag || actor, usd, meter));
    if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${(j?.error?.message || t).slice(0, 200)}`);
    if (!Array.isArray(j)) throw new Error(`apify ${actor}: not a dataset`);
    return items;
  }
  return { run, meter, onCharge: (f) => listeners.push(f), live: !off && !!token };
}
