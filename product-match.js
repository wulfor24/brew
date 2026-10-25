// Which of the brand's products a piece of copy is about, so a draft's picture shows the product its words name.
// Words are weighted by how rare they are across the catalog: "Hukum" (one product line) outweighs "sneaker" (every
// product), and the brand's own name counts for nothing. Works for any catalog; returns null when nothing is named.

/* screenshots and brand marks are never product photos; whole words only, so "Silicone", "Iconic" and "Logo Cap" stay products */
const JUNK = /sold.?out|size.?chart|(?<![a-z])(?:logo|wordmark|favicon|banner|icon|placeholder)(?![a-z])|gift.?card|screen.?shot|screen_?capture|\bscr_\d/i;
/* a title is junk only when it names a non-product listing, never because it says "logo" or "banner" (a Logo Cap, a Banner Stand) */
const JUNK_TITLE = /^(?:gift.?card|e-?gift|size.?chart)\b|\bplaceholder\b/i;
// everyday words that are product names only by accident ("Astra DAY DREAM" is not what "every day" means)
const COMMON = new Set('day days every all new best top more life love time way made make one two our your you the and for with that this from just last lasts wear feel feels look looks fit fits shop buy get comfort comfortable classic everyday collection edition pair pairs shoe shoes sneaker sneakers product products pack packs combo combos kit kits'.split(' '));
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter((w) => w.length > 2);

// products: [{ title, img | images[] }] from profile.catalog.products → a compact, photo-bearing list
export const junkPhoto = (u) => JUNK.test(String(u || '').split('?')[0]);
/* a product's price as the store shows it: its own label, else the number in its currency */
const priceOf = (x) => { if (x.priceLabel) return String(x.priceLabel); const n = +x.price; if (!x.price || !Number.isFinite(n)) return ''; try { return new Intl.NumberFormat('en', { style: 'currency', currency: String(x.currency || 'USD').toUpperCase(), maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch { return String(x.price); } };
/* a listing a shopper can buy: never the store's test or duplicate listings ("Sunscreen Gel … Test Product", "GL Event test",
   a "-copy" handle), which became card photos and draft products (QA 20 Oct). A real "test kit" stays */
const NOT_FOR_SALE = /\b(?:test|dummy|sample|placeholder)\s+(?:product|listing|item|sku)\b|\bdo not (?:buy|use|purchase|order)\b|(?:^|\s)test\s*$|^\s*test\b(?!\s+kits?\b)|\bevent test\b/i;
export const sellable = (x) => !!x && !NOT_FOR_SALE.test(String(x.title || x.t || '')) && !/-copy(?:-\d+)?\/?$/i.test(String(x.handle || x.url || '').split('?')[0]);
export const catalogOf = (profile, max = 400) => (profile?.catalog?.products || []).filter(sellable)
  .map((x) => ({ t: String(x.title || ''), img: [x.img, ...(x.images || [])].find((u) => u && !JUNK.test(u)) || null, ...(priceOf(x) ? { price: priceOf(x) } : {}), ...(x.inStock === false ? { out: true } : {}), ...(x.url ? { url: String(x.url) } : {}), ...((x.claims || [])[0] ? { claim: String(x.claims[0]) } : {}), imgs: [...new Set([x.img, ...(x.images || [])].filter((u) => u && typeof u === 'string' && !JUNK.test(u)))].slice(0, 8) /* every photo of it: a listing's photo set where no photo can be made (remix listingFromCatalog) */ })) /* skip a "sold out" placeholder, keep the product; price and stock for a product grid (draft-mocks.js); its page and first claim for the jam's product line (studio productFor) */
  .filter((x) => x.t && x.img && !JUNK_TITLE.test(x.t)).slice(0, max);

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
    /* a name that is one word once its common words are set aside ("The Desk Day Kit" → "desk") is named only when written out
       whole: "freezing desk hands" never names the Desk Day Kit (25 Oct, Cozy: a puppy-warmer idea drew the kit) */
    const fullName = words(String(p.t).split(/\s+[–—|:-]\s+|,\s/)[0]).filter((w) => !words(brand).includes(w)).join(' '), whole = nameWs.length >= 2 || fullName === phrase || spaced.includes(` ${fullName} `);
    const byName = phrase && whole && (nameWs.length >= 2 || nameWs.some((w) => (df.get(w) || N) <= Math.max(2, N * 0.08))) && (spaced.includes(` ${phrase} `) || spacedKey.includes(` ${phrase} `));
    const score = hit.reduce((a, w) => a + idf(w), 0) + hit.length / ws.length + (byName ? 10 : 0);
    const rare = hit.some((w) => (df.get(w) || N) <= Math.max(2, N * 0.08));
    // one word must look like a name in the copy; two words of the title together are enough
    const sure = byName || (!byNameOnly && (hit.length >= 2 || (rare && named(hit[0])))); /* byNameOnly: the product's own name, written out */
    if (sure && score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/* an idea's product when its words state a price ("Hydrate curls with your ₹449 conditioner"): the product named outright wins;
   else the loose words choose only among products at that price, so a "conditioner" idea never lands on a ₹349 styling stick
   (25 Oct, Arata; Cozy's "$44 puppy warmer" on a $44 kit). No stated price: the plain match. null when nothing fits */
const priceKey = (p) => String(p || '').replace(/[^\d.]/g, '').replace(/\.0+$/, '');
export function pricedProduct(text, catalog, opts = {}) {
  if (!catalog?.length || !text) return null; const strict = matchProduct(text, catalog, { ...opts, byNameOnly: true }); if (strict) return strict;
  const want = new Set((String(text).match(/[₹$€£]\s?\d[\d,]*(?:\.\d+)?/g) || []).map(priceKey)); if (!want.size) return matchProduct(text, catalog, opts);
  const pool = catalog.filter((x) => x.price && want.has(priceKey(x.price))); if (!pool.length) return null;
  const m = matchProduct(text, pool, opts); if (m) return m;
  /* at that price one shared word is enough, when only one product there has it ("conditioner") */
  const said = new Set(words(text)), skip = new Set([...words(opts.brand || ''), ...COMMON]), df = new Map(); for (const x of catalog) for (const w of new Set(words(x.t))) df.set(w, (df.get(w) || 0) + 1);
  const rare = (w) => (df.get(w) || 0) <= Math.max(2, catalog.length * 0.08); /* "conditioner", never "hair" in a hair-care store */
  const hits = pool.filter((x) => words(x.t).some((w) => !skip.has(w) && said.has(w) && rare(w)));
  return hits.length === 1 ? hits[0] : null;
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
/* the scene the card promises its asset shows, as a line for any picture prompt ('' when the card names none). The words an ad
   carries ("headline 'Warm toes'", "price line $39", "button Shop now") are set afterwards in exact type, never asked of the
   image model, so those clauses are taken out here */
const WORD_CLAUSE = /(?:^|[,;:.]\s*|\s+(?:with|and|plus)\s+)(?:an?\s+|the\s+)?(?:(?:sub-?)?headlines?|price(?:\s+(?:lines?|tags?|badges?|callouts?|points?)|\s*[:=]?\s*[$₹€£\d])|buttons?|cta|captions?|taglines?|text(?:\s+overlays?)?|overlays?|on-?screen\s+text|copy\s+lines?|supers?)\b[^,;.]*/gi;
const tidyScene = (x) => String(x || '').replace(WORD_CLAUSE, '').replace(/^[\s,;:.]+|[\s,;:]+$/g, '').replace(/\.\s*$/, '').trim();
/* a card with no make.pieces (a watcher's idea, an older card) still says what its picture shows in a how-step ("Design a
   split-screen layout contrasting heavy oils with light serum"): the first step that describes a picture, not words, a link
   or a setting, without its "Design a" (Param, 19 Oct: the jam's first photo was a plain pack shot under that card) */
const SEE = /\b(split[- ]?screen|side[- ]by[- ]side|contrast\w*|versus|vs\.?|close-?ups?|macro|shots?|photos?|pictures?|images?|visuals?|scenes?|layouts?|flat ?lays?|lifestyle|in use|in hand|hands?|model|wearing|beside|next to|show(?:s|ing)?|demo\w*|texture|drops?|pour\w*|bathroom|shower|kitchen|desk|bed|window|outdoors?)\b/i;
const NOT_SEE = /\b(typograph\w*|fonts?|headlines?|copy|captions?|buttons?|cta|checkout|links?|landing|url|utm|budget|bid\w*|audiences?|targeting|ad sets?|placements?|pixel|track\w*|schedule|post at|hashtags?|subject line|email|whatsapp|test|launch|price|discount|offer|reviews?|rating)\b/i;
const VERB = /^(?:design|create|make|use|shoot|build|show|film|feature|style|open(?: on| with)?|lead with|start with|frame|stage|picture|photograph)\s+(?:it\s+(?:as|with)\s+)?(?:an?\s+|the\s+)?/i;
const howScene = (c = {}) => { const h = (c?.detail?.how || []).find((x) => typeof x === 'string' && SEE.test(x) && !NOT_SEE.test(x)); const p = tidyScene(String(h || '').replace(VERB, '')); return p.length >= 8 && p.length <= 160 ? p : ''; };
export const sceneOf = (c = {}) => { const p = tidyScene(String(c?.make?.pieces || '').replace(/^[^:]{0,40}:\s*/, '')); return p.length >= 8 ? p : howScene(c); }; /* "1 static image: X, headline Y" → "X" */
export const cardScene = (c = {}) => (sceneOf(c) ? `The picture must show what the card promises: ${sceneOf(c)}.` : '');
