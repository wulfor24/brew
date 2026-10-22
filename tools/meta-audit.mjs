// Read-only audit of a brand's connected Meta ad account: re-reads Graph with the stored token and prints what Brew shows
// next to what Meta says. Writes nothing (no vault save, no token refresh, no pack write).
// Usage: FEED_VAULT_KEY=$(gcloud secrets versions access latest --secret=FEED_VAULT_KEY) node tools/meta-audit.mjs <slug>
import { execFileSync } from 'node:child_process';
import { decrypt } from '../vault.js';

const slug = process.argv[2]; if (!slug) { console.error('usage: node tools/meta-audit.mjs <slug>'); process.exit(1); }
const V = process.env.META_GRAPH_VERSION || 'v26.0', G = `https://graph.facebook.com/${V}`;
const cat = (p) => JSON.parse(execFileSync('gcloud', ['storage', 'cat', `gs://brew-prototype/brands/${slug}/${p}`], { encoding: 'utf8', maxBuffer: 64e6 }));
const c = JSON.parse(decrypt(cat('private/vault/meta.json').c)), snap = cat('private/live/meta.json'), profile = cat('profile.json');
const q = (o) => new URLSearchParams({ access_token: c.token, ...o });
const get = async (path, o = {}) => { const r = await fetch(`${G}/${path}?${q(o)}`); const j = await r.json(); if (!r.ok) { const e = new Error(`${path} ${r.status}: ${j?.error?.message}`); e.code = j?.error?.code; e.sub = j?.error?.error_subcode; throw e; } return j; };
const all = async (path, o, max = 50) => { const out = []; let after; for (let i = 0; i < max; i++) { const j = await get(path, { ...o, ...(after ? { after } : {}) }); out.push(...(j.data || [])); after = j.paging?.cursors?.after; if (!after || !j.paging?.next) return { rows: out, capped: false }; } return { rows: out, capped: true }; };
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
const pick = (xs, ts) => { for (const t of ts) { const x = (xs || []).find((y) => y.action_type === t); if (x) return +x.value; } return null; };
const out = { slug, graph: V, adLibraryPageId: profile.ads?.own?.pageId || null, adLibraryPage: profile.ads?.own?.page || null, host: profile.host || null };
// which Graph versions still answer, and what the sign-in was granted (debug_token needs the app's own token)
out.versions = {}; for (const v of ['v21.0', 'v22.0', 'v23.0', 'v24.0', 'v25.0', 'v26.0']) out.versions[v] = await fetch(`https://graph.facebook.com/${v}/me?${q({ fields: 'id' })}`).then(async (r) => (r.ok ? 'ok' : `${r.status} ${(await r.json())?.error?.message?.slice(0, 80)}`)).catch((e) => e.message);
if (process.env.META_ADS_OAUTH_CLIENT_ID && process.env.META_ADS_OAUTH_CLIENT_SECRET) out.token = await get('debug_token', { input_token: c.token, access_token: `${process.env.META_ADS_OAUTH_CLIENT_ID}|${process.env.META_ADS_OAUTH_CLIENT_SECRET}` }).then((j) => ({ scopes: j.data?.scopes, granular: j.data?.granular_scopes, expires: j.data?.expires_at ? new Date(j.data.expires_at * 1e3).toISOString() : null, valid: j.data?.is_valid })).catch((e) => ({ error: e.message }));

for (const a of c.accounts || []) {
  const A = `act_${a.id}`, r = { account: A };
  r.info = await get(A, { fields: 'name,currency,timezone_name,account_status,business{name}' }).catch((e) => ({ error: e.message }));
  r.pages = await all(`${A}/promote_pages`, { fields: 'id,name,website,link', limit: 100 }).then((x) => x.rows.map((p) => ({ id: p.id, name: p.name, website: p.website }))).catch((e) => ({ error: e.message }));
  // the exact read meta.js does (limit 200, 10 pages), then a smaller-page retry to see if it's a size or permission failure
  r.adsAsBrew = await all(`${A}/ads`, { fields: 'id,campaign_id,effective_status,creative{effective_object_story_id,object_story_spec}', limit: 200 }, 10).then((x) => ({ n: x.rows.length, capped: x.capped })).catch((e) => ({ error: e.message, code: e.code, sub: e.sub }));
  const ads = await all(`${A}/ads`, { fields: 'id,effective_status,creative{effective_object_story_id}', limit: 50 }).catch((e) => ({ error: e.message, code: e.code }));
  if (ads.rows) { const pg = {}; for (const x of ads.rows) { const p = String(x.creative?.effective_object_story_id || '').split('_')[0] || '?'; pg[p] = (pg[p] || 0) + 1; }
    r.ads = { n: ads.rows.length, capped: ads.capped, active: ads.rows.filter((x) => x.effective_status === 'ACTIVE').length, byPage: pg }; } else r.ads = ads;
  r.adPageSpec = await all(`${A}/ads`, { fields: 'id,creative{object_story_spec{page_id},effective_object_story_id}', limit: 50 }, 2).then((x) => [...new Set(x.rows.map((y) => y.creative?.object_story_spec?.page_id || String(y.creative?.effective_object_story_id || '').split('_')[0]))]).catch((e) => ({ error: e.message, code: e.code }));
  r.attribution = await get(`${A}/insights`, { date_preset: 'last_30d', fields: 'attribution_setting,spend' }).then((j) => j.data?.[0]?.attribution_setting || null).catch((e) => e.message);
  const [tot] = (await get(`${A}/insights`, { date_preset: 'last_30d', fields: 'spend,actions,action_values,reach,frequency' })).data || [];
  const spend = +tot?.spend || 0, buys = pick(tot?.actions, PURCHASE), value = pick(tot?.action_values, PURCHASE);
  r.last30 = { spend, purchases: buys, value, cpa: buys ? +(spend / buys).toFixed(2) : null, roas: value ? +(value / spend).toFixed(3) : null };
  const wk = await all(`${A}/insights`, { date_preset: 'last_7d', level: 'ad', fields: 'ad_id,ad_name,campaign_id,campaign_name,frequency,spend,action_values', limit: 200 });
  const camp = new Map(); for (const x of wk.rows) { const k = x.campaign_id; const o = camp.get(k) || { name: x.campaign_name, s: 0, v: 0, fw: 0 }; o.s += +x.spend || 0; o.v += pick(x.action_values, PURCHASE) || 0; o.fw += (+x.spend || 0) * (+x.frequency || 0); camp.set(k, o); }
  r.week = { adRows: wk.rows.length, capped: wk.capped, campaignsWithSpend: [...camp.values()].filter((x) => x.s > 0).length,
    campaigns: [...camp.values()].filter((x) => x.s > 0).sort((p, q2) => q2.s - p.s).map((x) => ({ name: x.name, spendDay: Math.round(x.s / 7), roas: x.s ? +(x.v / x.s).toFixed(2) : null, freq: x.s ? +(x.fw / x.s).toFixed(2) : 0 })),
    tired: wk.rows.filter((x) => +x.frequency >= 3.5 && +x.spend > 0).map((x) => ({ ad: x.ad_name, freq: +(+x.frequency).toFixed(2) })) };
  r.activeCampaigns = await all(`${A}/campaigns`, { fields: 'id,effective_status', limit: 200, effective_status: '["ACTIVE"]' }).then((x) => x.rows.length).catch((e) => e.message);
  out[A] = r;
}
out.brewShows = { stats: snap.stats, changed: snap.changed, cards: (snap.cards || []).map((x) => ({ id: x.id, title: x.title, rows: x.rows })), notes: snap.notes };
console.log(JSON.stringify(out, null, 1));
