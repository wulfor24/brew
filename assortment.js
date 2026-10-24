// Whose products a store sells: its own label, other brands', or both. Scrubroom (24 Oct) sells 68 Littmann stethoscopes and
// Cherokee and Healing Hands scrubs beside its own Scrub Story line, and was read as a plain apparel brand: the plays then
// spoke as if it made everything. Pure: the catalog stage works it out from each product's brand (Shopify vendor, WooCommerce
// brand, JSON-LD brand), the reader's heal does it for saved reads, and the line, the category, the brief and the plays read it.

export const ASSORT_V = 2; // 2: a retailer's category is asked again, named by everything it sells (Scrubroom stayed "Apparel" with 53% stethoscopes)
const squash = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
/* not a brand a shopper buys: suppliers, print-on-demand and placeholder vendors (a D2C store's dropshipper is not a rival) */
const NOT_A_BRAND = /^(?:zendrop|cj ?dropshipping|cjdropshipping|aliexpress|alibaba|spocket|dsers|printful|printify|gelato|teelaunch|gooten|syncee|modalyst|default|default vendor|vendor|unknown|na|n\/a|none|generic|my store|store|shop)$/i;
/* the about page naming a label as the store's own ("its own homegrown performance scrub brand, Scrub Story") */
const OWN_WORDS = /\b(?:own|homegrown|home-grown|in-house|house|private|our)\b[^.]{0,40}\b(?:brand|label|line|range)\b/i;

/** the brand names in a catalog, grouped: "ScrubStory Lite" and "Scrubstory" are one label, "3M Littmann" and "Littmann" one brand */
export function brandGroups(products = []) {
  const counts = new Map();
  for (const p of products) { const b = String(p?.brand || p?.vendor || '').trim(); if (!b || NOT_A_BRAND.test(b)) continue; counts.set(b, (counts.get(b) || 0) + 1); }
  const groups = [];
  for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const k = squash(name), first = squash(name.split(/\s+/)[0]);
    const g = groups.find((x) => x.keys.some((y) => (y.length >= 4 && k.includes(y)) || (k.length >= 4 && y.includes(k))) || (first.length >= 4 && x.first === first));
    if (g) { g.n += n; g.names.push(name); g.keys.push(k); } else groups.push({ name, n, names: [name], keys: [k], first });
  }
  /* a group reads as the words its names share ("Cherokee WW"), else its shortest name ("Scrubstory") */
  const label = (names) => { const ws = names.map((x) => x.split(/\s+/)); const common = []; for (let i = 0; ws.every((w) => w[i] && w[i].toLowerCase() === ws[0][i].toLowerCase()); i++) common.push(ws[0][i]);
    return names.length > 1 && common.length && common.join(' ').length >= 4 ? common.join(' ') : [...names].sort((a, b) => a.length - b.length)[0]; };
  return groups.map(({ n, names, keys }) => ({ name: label(names), n, names, keys }));
}

/** → { v, kind: 'own' | 'mixed' | 'retailer' | null, own: [names], others: [{ name, n }], ownShare, otherShare, branded } */
export function assortmentOf({ products = [], name = '', brandName = '', host = '', about = '' } = {}) {
  const branded = products.filter((p) => String(p?.brand || p?.vendor || '').trim() && !NOT_A_BRAND.test(String(p.brand || p.vendor).trim())).length;
  const groups = brandGroups(products), total = products.length;
  /* fewer than half the products name a brand, or one brand only with no store name to tell: the catalog can't say */
  if (!total || branded < Math.max(3, total * 0.5)) return { v: ASSORT_V, kind: null, own: [], others: [], ownShare: null, otherShare: null, branded };
  const mine = [name, brandName, String(host || '').replace(/^www\./, '').split('.')[0]].map(squash).filter((x) => x.length >= 3);
  /* a sentence of the about page that says "own / homegrown / in-house ... brand" and names the label */
  const ownSentences = String(about || '').split(/(?<=[.!?])\s+/).filter((x) => OWN_WORDS.test(x)).map(squash);
  const named = (g) => ownSentences.some((x) => g.keys.some((k) => k.length >= 5 && x.includes(k.slice(0, 10))));
  const isOwn = (g) => g.keys.some((k) => mine.some((m) => k.includes(m) || m.includes(k))) || named(g);
  /* one brand only: the store's own, whatever its vendor field says (a D2C store often fills it with a company name) */
  if (groups.length === 1) return { v: ASSORT_V, kind: 'own', own: [groups[0].name], others: [], ownShare: 1, otherShare: 0, branded };
  const own = groups.filter(isOwn), others = groups.filter((g) => !isOwn(g));
  const ownN = own.reduce((a, g) => a + g.n, 0), otherN = others.reduce((a, g) => a + g.n, 0), all = ownN + otherN || 1;
  const otherShare = otherN / all, ownShare = ownN / all;
  /* other brands with real weight: at least two of them, or one that is most of the catalog, and not a sliver */
  const weighty = others.filter((g) => g.n >= 3 || g.n / all >= 0.1);
  const kind = !weighty.length || otherShare < 0.2 ? 'own' : otherShare >= 0.5 ? 'retailer' : 'mixed';
  return { v: ASSORT_V, kind, own: own.map((g) => g.name), others: others.map((g) => ({ name: g.name, n: g.n })), ownShare: +ownShare.toFixed(2), otherShare: +otherShare.toFixed(2), branded };
}

/** one sentence for prompts, the ledger and the team's memory; null when the store sells only its own label or can't tell */
export function assortmentLine(a, storeName = 'The store') {
  if (!a?.kind || a.kind === 'own') return null;
  const top = a.others.slice(0, 4).map((g) => g.name).join(', '), pct = Math.round(a.otherShare * 100);
  const ownPart = a.own.length ? ` Its own label${a.own.length > 1 ? 's' : ''}: ${a.own.join(', ')}.` : ' No own label found in the catalog.';
  return a.kind === 'retailer'
    ? `${storeName} is a curated retailer: ${pct}% of its catalog is other brands' products (${top}).${ownPart} Speak of the store as where to buy them, never as their maker; the own label is the store's to claim.`
    : `${storeName} sells its own label and other brands: ${pct}% of its catalog is other brands' products (${top}).${ownPart} Only the own label's products are the store's to claim as made by it.`;
}
