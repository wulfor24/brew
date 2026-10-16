// Which of the brand's products a piece of copy is about, so a draft's picture shows the product its words name.
// Words are weighted by how rare they are across the catalog: "Hukum" (one product line) outweighs "sneaker" (every
// product), and the brand's own name counts for nothing. Works for any catalog; returns null when nothing is named.

const JUNK = /sold.?out|size.?chart|logo|wordmark|favicon|banner|icon|placeholder|gift.?card|screen.?shot|screen_?capture|\bscr_\d/i; // screenshots and brand marks are never product photos
// everyday words that are product names only by accident ("Astra DAY DREAM" is not what "every day" means)
const COMMON = new Set('day days every all new best top more life love time way made make one two our your you the and for with that this from just last lasts wear feel feels look looks fit fits shop buy get comfort comfortable classic everyday collection edition pair pairs shoe shoes sneaker sneakers'.split(' '));
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter((w) => w.length > 2);

// products: [{ title, img | images[] }] from profile.catalog.products → a compact, photo-bearing list
export const junkPhoto = (u) => JUNK.test(String(u || '').split('?')[0]);
/* a product's price as the store shows it: its own label, else the number in its currency */
const priceOf = (x) => { if (x.priceLabel) return String(x.priceLabel); const n = +x.price; if (!x.price || !Number.isFinite(n)) return ''; try { return new Intl.NumberFormat('en', { style: 'currency', currency: String(x.currency || 'USD').toUpperCase(), maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch { return String(x.price); } };
export const catalogOf = (profile, max = 400) => (profile?.catalog?.products || [])
  .map((x) => ({ t: String(x.title || ''), img: [x.img, ...(x.images || [])].find((u) => u && !JUNK.test(u)) || null, ...(priceOf(x) ? { price: priceOf(x) } : {}), ...(x.inStock === false ? { out: true } : {}), ...(x.url ? { url: String(x.url) } : {}), ...((x.claims || [])[0] ? { claim: String(x.claims[0]) } : {}) })) /* skip a "sold out" placeholder, keep the product; price and stock for a product grid (draft-mocks.js); its page and first claim for the jam's product line (studio productFor) */
  .filter((x) => x.t && x.img && !JUNK.test(x.t)).slice(0, max);

export function matchProduct(text, catalog, { brand = '', byNameOnly = false } = {}) {
  if (!catalog?.length || !text) return null;
  const said = new Set(words(text)), joined = words(text).join(''), skip = new Set([...words(brand), ...COMMON]);
  // a word written like a name: capitalised, and not just because it starts a sentence
  const named = (w) => [...String(text).matchAll(/\p{Lu}[\p{L}\p{N}]*/gu)].some((m) => m[0].toLowerCase().includes(w) && !/(^|[.!?:]\s+)$/.test(text.slice(0, m.index)));
  const says = (w) => said.has(w) || (w.length >= 6 && joined.includes(w)); /* "deep space" names "DEEPSPACE" */
  const df = new Map(); for (const p of catalog) for (const w of new Set(words(p.t))) df.set(w, (df.get(w) || 0) + 1);
  const N = catalog.length, idf = (w) => Math.log(1 + N / (df.get(w) || N));
  const spaced = ` ${words(text).join(' ')} `, spacedKey = ` ${words(text).filter((w) => !skip.has(w)).join(' ')} `; /* "The Desk Day Kit" is named in "the Desk Day Kit ad" with its common words set aside on both sides */
  let best = null, bestScore = 0;
  for (const p of catalog) {
    const ws = [...new Set(words(p.t))].filter((w) => !skip.has(w));
    const hit = ws.filter(says); if (!hit.length) continue;
    // a rare word must be named (not only common ones), and more of the title named wins ties
    // the product's own name, written out ("Snugglet Paw Warmer is only $39"), beats any overlap of loose words
    // ("toast your toes" with "foot warmer" once picked the Kitty Toes foot warmer over the Paw Warmer the copy names)
    const nameWs = words(String(p.t).split(/\s+[–—|:-]\s+|,\s/)[0]).filter((w) => !skip.has(w)), phrase = nameWs.join(' ');
    const byName = phrase && (nameWs.length >= 2 || nameWs.some((w) => (df.get(w) || N) <= Math.max(2, N * 0.08))) && (spaced.includes(` ${phrase} `) || spacedKey.includes(` ${phrase} `));
    const score = hit.reduce((a, w) => a + idf(w), 0) + hit.length / ws.length + (byName ? 10 : 0);
    const rare = hit.some((w) => (df.get(w) || N) <= Math.max(2, N * 0.08));
    // one word must look like a name in the copy; two words of the title together are enough
    const sure = byName || (!byNameOnly && (hit.length >= 2 || (rare && named(hit[0])))); /* byNameOnly: the product's own name, written out */
    if (sure && score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/* the product a card is about, for every card type and brand. A product named outright wins: in the title or body first (a
   "Desk Day Kit" card shows the kit, even when its asset line lists the kit's pieces), then in the asset line ("1 static
   image: an office worker wearing Snugglet Toe Toasters" on a card whose title names none), and only then the title's loose
   words. Loose words in an asset line ("office", "fleece") never pick a product on their own. null: nothing is named */
export const cardAssetText = (c = {}) => [c?.make?.pieces, c?.title, c?.sub].filter(Boolean).join('. ');
export function cardProduct(c, catalog, opts = {}) {
  const words = `${c?.title || ''}. ${c?.sub || ''}`, strict = { ...opts, byNameOnly: true };
  return matchProduct(words, catalog, strict) || (c?.make?.pieces && matchProduct(c.make.pieces, catalog, strict)) || (opts.byNameOnly ? null : matchProduct(words, catalog, opts));
}
/* the scene the card promises its asset shows, as a line for any picture prompt ('' when the card names none) */
export const sceneOf = (c = {}) => { const p = String(c?.make?.pieces || '').replace(/^[^:]{0,40}:\s*/, '').replace(/\.\s*$/, '').trim(); return p.length >= 8 ? p : ''; }; /* "1 static image: X" → "X" */
export const cardScene = (c = {}) => (sceneOf(c) ? `The picture must show what the card promises: ${sceneOf(c)}.` : '');
