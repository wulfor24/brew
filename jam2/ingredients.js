// Jam v2: the ingredients a board is made from, resolved one way for every board. The product is always the real photo:
// the board's own pick → a References photo with job 'product' → the product the card names (product-match.js cardProduct) →
// the card's own pictures → the brand's lead catalog product. A rival's picture is never an ingredient (rival-ad.js).
import { cardProduct } from '../product-match.js';
import { isRivalCard, isResearchImage } from '../rival-ad.js';

/* a catalog entry's photos: the read keeps them as imgs (product-match.js catalogOf), older reads as images */
export const imgsOf = (p) => (Array.isArray(p?.imgs) ? p.imgs : Array.isArray(p?.images) ? p.images : []);
const imgOf = (p) => p?.img || imgsOf(p)[0] || null;
export function productFor({ card = null, catalog = [], refs = [], pick = null, lanePhoto = null }) {
  if (pick?.img) return { img: pick.img, name: pick.name || pick.t || null, from: pick.from || 'picked' };
  /* a photo the brand added for one product (its back, a side) belongs to that product only, never the default for every card */
  const ref = (refs || []).find((r) => r.job === 'product' && r.kind !== 'video' && r.file && !r.product);
  const named = card ? cardProduct(card, catalog) : null;
  if (named && imgOf(named)) return { img: imgOf(named), name: named.t || named.title || null, handle: named.handle || null, from: 'card' };
  if (ref) return { img: ref.url || ref.file, name: ref.label || null, from: 'references' };
  const own = card && !isRivalCard(card) ? (card.images || []).find((u) => u && !isResearchImage(u)) : null;
  if (own) return { img: own, name: null, from: 'card' };
  const lead = (catalog || []).find((p) => imgOf(p) && !p.out && !p.free) || (catalog || []).find((p) => imgOf(p) && !p.out) || (catalog || []).find((p) => imgOf(p)); /* in stock and for sale first, never a free sample */
  if (lead) return { img: imgOf(lead), name: lead.t || lead.title || null, handle: lead.handle || null, from: 'catalog' };
  if (lanePhoto) return { img: lanePhoto, name: null, from: 'lane' };
  return null;
}
/* the brand's products as Library tiles (the photo picker): real catalog photos only */
/* sold-out products come last and say so (the picker greys them), free samples after the products a shopper can buy */
export const productTiles = (catalog = [], max = 60) => (catalog || []).filter((p) => imgOf(p)).map((p, i) => [p, i]).sort(([a, i], [b, k]) => (!!a.out - !!b.out) || (!!a.free - !!b.free) || i - k).slice(0, max).map(([p]) => ({ img: imgOf(p), name: p.t || p.title || null, handle: p.handle || null, ...(p.out ? { out: true } : {}) }));
