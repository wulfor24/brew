// Klaviyo: the brand pastes a read-only private API key (Settings → API keys → Read-only). Reads the lists and their
// size, and which of the five flows that bring second orders are live. It proves the brand's own when the account's
// website is the brand's site.
import { exactSite } from '../auth.js';
import { card, L, n0, has, getJSON } from './common.js';
const ppl = (n) => `${n0(n)} ${+n === 1 ? 'person' : 'people'}`;

const K = 'https://a.klaviyo.com/api';
const H = (c) => ({ authorization: `Klaviyo-API-Key ${c.key}`, revision: '2024-10-15', accept: 'application/vnd.api+json' });
const get = (c, p) => getJSON(`${K}/${p}`, { headers: H(c) }, `klaviyo ${p.split('?')[0]}`);
const FLOWS = [['Welcome', /welcome|sign ?up|new subscriber/i], ['Abandoned checkout', /abandon|checkout|cart/i], ['Browse abandonment', /browse|viewed product/i], ['Post-purchase', /post[- ]?purchase|thank|after purchase|review request|cross[- ]?sell/i], ['Win-back', /win[- ]?back|lapsed|we miss you|re-?engage/i]];

export default {
  id: 'klaviyo', name: 'Klaviyo', modes: ['key'],
  ready: () => true,
  keyFields: [{ k: 'key', label: 'Private API key', hint: 'Klaviyo → Settings → API keys → Create private key, with Read-only access. Brew only reads', secret: true }],
  async fromKey({ key }) {
    /* a copied key can carry spaces, quotes or invisible characters; past the pk_ prefix Klaviyo itself is the judge
       (an over-strict shape check here turned real keys away) */
    const k = String(key || '').replace(/[\s"'`\u200b-\u200d\u2060\ufeff]/g, '').replace(/^Klaviyo-API-Key/i, '');
    if (!/^pk_.{10,}$/.test(k)) throw Object.assign(new Error(/^[A-Za-z0-9]{6}$/.test(k) ? 'That’s the public key (6 characters). Paste the private key, which starts with pk_.' : 'That does not look like a Klaviyo private key (it starts with pk_).'), { user: true });
    await get({ key: k }, 'accounts/').catch((e) => { throw Object.assign(new Error(e.status === 401 || e.status === 403 ? 'Klaviyo did not accept that key.' : e.message), { user: true }); });
    return { key: k };
  },
  async owns(c, ctx) {
    const a = (await get(c, 'accounts/')).data?.[0]?.attributes || {}, site = a.contact_information?.website_url || '';
    const ok = exactSite(site, ctx.host); /* the account's website is free text: never strong enough to own the brand */
    return { ok, strong: false, account: { id: a.contact_information?.organization_name || 'Klaviyo', name: `${a.contact_information?.organization_name || 'Klaviyo'}${site ? ` · ${site.replace(/^https?:\/\//, '')}` : ''}` }, why: ok ? `The Klaviyo account’s website is ${ctx.host}` : `The Klaviyo account’s website is ${site || 'not set'}` };
  },
  async sync(c, ctx) {
    const m = {}, notes = [];
    const lists = (await get(c, 'lists/?fields[list]=name&page[size]=10').catch((e) => (notes.push(e.message), { data: [] }))).data || [];
    const sized = [];
    for (const l of lists.slice(0, 8)) { const j = await get(c, `lists/${l.id}/?additional-fields[list]=profile_count`).catch(() => null); if (j?.data?.attributes?.profile_count != null) sized.push({ name: l.attributes.name, n: j.data.attributes.profile_count }); }
    if (sized.length) { sized.sort((a, b) => b.n - a.n); m.list = sized[0].n; m.listName = sized[0].name; }
    const flows = []; let next = 'flows/?fields[flow]=name,status&page[size]=50';
    for (let i = 0; i < 4 && next; i++) { const j = await get(c, next).catch((e) => (notes.push(e.message), null)); if (!j) break; flows.push(...(j.data || [])); next = j.links?.next ? j.links.next.replace(`${K}/`, '') : null; }
    m.flows = FLOWS.map(([nm, re]) => [nm, flows.some((f) => re.test(f.attributes?.name || '') && f.attributes?.status === 'live')]);
    m.liveCount = m.flows.filter(([, on]) => on).length; m.flowsTotal = flows.length;
    const k = 'klaviyo', src = 'Klaviyo', out = [];
    const off = m.flows.filter(([, on]) => !on).map(([nm]) => nm);
    if (flows.length && off.length) out.push(card(k, 'Klaviyo', ctx.lane, 'flows', { agent: 'crm', sector: 'signals', type: 'decision', roles: ['crm'], badge: [`${m.liveCount} of 5 live`, off.length >= 3 ? 'warn' : 'info'], cta: 'Plan the flows',
      title: `${off.slice(0, 3).join(', ')} ${off.length === 1 ? 'is' : 'are'} not live in Klaviyo`, sub: `${has(m.list) ? `Your biggest list has ${ppl(m.list)}. ` : ''}The flows that bring second orders run on their own once live, with no ad spend.`,
      rows: m.flows.map(([f, on]) => [f, on ? 'Live' : 'Off']), detail: { why: ['Post-purchase and win-back drive second orders.'], how: ['Build the missing flows', 'Turn them on', 'Read revenue from email after 30 days'] } }));
    /* quiet: no zero tiles, and one person is a person */
    const stats = [has(m.list) && ['Biggest list', ppl(m.list)], ['Key flows live', `${m.liveCount} of 5`], m.flowsTotal > 0 && ['Flows in the account', n0(m.flowsTotal)]].filter(Boolean);
    const changed = [m.liveCount ? `${m.liveCount} of the 5 key flows are live${off.length ? `; ${off.length} not built yet` : ''}` : 'None of the 5 key flows are live yet', has(m.list) && `${ppl(m.list)} on ${m.listName}`].filter(Boolean);
    const ledger = [has(m.list) && L('klaviyo.list', 'Email list size (largest list)', n0(m.list), m.list, src), L('klaviyo.flows.live', 'Key email flows live (of 5)', `${m.liveCount} of 5`, m.liveCount, src), L('klaviyo.flows.off', 'Key email flows not live', off.join(', ') || 'none', null, src)].filter(Boolean);
    return { metrics: m, stats, changed, cards: out, ledger, notes };
  }
};
