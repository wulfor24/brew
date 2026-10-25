// Read-only check that a brand's stored sign-ins open its accounts from this environment (Phase 6: Arata's copied sign-ins on
// production). One harmless read per account (Meta: the ad account's name; Shopify: the shop's name), nothing written anywhere,
// no refresh, no token printed. Run inside the VPC with this environment's DATABASE_URL and FEED_VAULT_KEY:
//   node db/connector-ping.mjs arata-in
import { q, close } from './index.js';
import { decrypt } from '../vault.js';

const slug = String(process.argv[2] || '').replace(/[^a-z0-9-]/g, '');
if (!slug) { console.log('[ping] STOP: name a brand'); process.exit(1); }
const V = process.env.META_GRAPH_VERSION || 'v26.0';
const secret = async (id) => { const r = (await q('SELECT body FROM objects WHERE key = $1', [`brands/${slug}/private/vault/${id}.json`])).rows[0]; if (!r) return null; const x = JSON.parse(r.body.toString('utf8')); return x.c ? JSON.parse(decrypt(x.c)) : null; };
const conns = (await q('SELECT body FROM objects WHERE key = $1', [`brands/${slug}/private/connections.json`])).rows[0];
const states = conns ? Object.fromEntries(Object.entries(JSON.parse(conns.body.toString('utf8'))).map(([k, v]) => [k, v?.state || null])) : {};
console.log(`[ping] ${slug} connections: ${JSON.stringify(states)}`);
let bad = 0;
const meta = await secret('meta');
if (meta) { try { const acct = String(meta.account || '').replace(/^act_/, ''); const r = await fetch(`https://graph.facebook.com/${V}/act_${acct}?fields=name,account_status`, { headers: { authorization: `Bearer ${meta.token}` }, signal: AbortSignal.timeout(20e3) }); const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || r.status); console.log(`[ping] ${slug} meta: reads act_${acct} "${j.name}" (status ${j.account_status})`); } catch (e) { bad++; console.log(`[ping] ${slug} meta FAILED: ${e.message}`); } }
const shop = await secret('shopify');
if (shop) { try { const r = await fetch(`https://${shop.shop}/admin/api/2026-04/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': shop.token }, body: JSON.stringify({ query: '{ shop { name myshopifyDomain } }' }), signal: AbortSignal.timeout(20e3) }); const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || r.status).slice(0, 200)); console.log(`[ping] ${slug} shopify: reads ${j.data.shop.myshopifyDomain} "${j.data.shop.name}"`); } catch (e) { bad++; console.log(`[ping] ${slug} shopify FAILED: ${e.message}`); } }
await close();
console.log(bad ? `[ping] ${bad} failed` : '[ping] every stored sign-in reads');
if (bad) process.exit(1);
