// What the Studio composer arrives with, and why. Every slot (what to make, the style, the products, the cast, the reference, the
// brand kit, the words, the direction, the size, the length, how many, the quality) is filled from what Brew already knows: the
// card, the Brand Book, the catalog, the references, the rival or viral post the card is about. Each says where it came from in
// one line, and the brand can change any of it. What Brew doesn't know is said plainly with the one thing that would fix it;
// nothing is made up to fill a gap. Pure: no calls, no spend.
import { styleOf, blockOf } from './studio.js';
import { SIZES } from './catalogue.js';
import { refsFor } from './brandbook.js';

const tidy = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const VIDEO_KINDS = new Set(['video']);
const PEOPLE = { none: 'No people on camera', hands: 'Hands only', 'ai-cast': 'An AI person who fits your buyer', consented: 'Your own people (with consent)' };

/* the platform a size is for, in the words the card used */
const sizeWhy = (card, key) => { const s = SIZES[key]; if (!s) return null; const where = /instagram|\big\b|reel|story|stories/i.test(`${card?.title || ''} ${card?.cta?.label || ''}`) ? 'Instagram' : /meta|facebook|ad\b|ads\b/i.test(`${card?.title || ''} ${card?.cta?.label || ''} ${card?.agent || ''}`) ? 'Meta ads' : null;
  return `${s.label}${where ? `, the shape that runs best on ${where}` : ''}. Every other placement is cut from the same make.`; };

export function contextOf(ctx = {}, d0 = {}) {
  const card = ctx.card || {}, bbv = ctx.bbv || {}, kind = d0.kind || 'image', st = styleOf(d0.style), set = Array.isArray(d0.set) ? d0.set.map(styleOf).filter(Boolean) : null;
  const text = `${card.title || ''} ${card.sub || ''}`, missing = [];
  /* what to make: the card's button */
  const make = { value: set ? 'set' : kind, why: card.cta?.label ? `The card’s button: “${tidy(card.cta.label, 40)}”.` : 'From the card.' };
  /* the style: the card's angle */
  const angle = /\bvs\b|versus|compare|switch|rival|instead of/i.test(text) ? 'it compares you with a rival' : /review|rated|loved|stars?\b/i.test(text) ? 'it leads with what customers say' : /problem|fix|tired of|pain|struggle/i.test(text) ? 'it starts from a problem' : /offer|sale|% off|deal|bundle|combo/i.test(text) ? 'it sells an offer' : /gift|festival|diwali|christmas/i.test(text) ? 'it is a gifting moment' : null;
  const style = { value: set ? set.map((x) => x.id) : st?.id || null, label: set ? `${set.length} slides · ${set.map((x) => x.label).join(', ')}` : st?.label || null,
    why: set ? `A ${set.length}-slide set, one style per slide, the order that sells: what it is, it in use, why it works.` : st ? `${st.label}${angle ? `, because ${angle}` : ', the style that shows the product best for this card'}.` : 'Pick a style.' };
  /* the products: the card's own, with every photo of it Brew has */
  const p = ctx.product || null, photos = p ? [p.img, ...((ctx.catalog || []).find((x) => (p.handle && x.handle === p.handle) || (p.name && (x.t || x.title) === p.name))?.images || [])].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 8) : [];
  const products = { value: p ? [{ img: p.img, name: p.name || null, handle: p.handle || null, photos }] : [], why: p ? `${tidy(p.name || 'The product', 60)}: the product on the card${photos.length > 1 ? `, with ${photos.length} of its photos so it looks exactly right` : ''}.` : 'No product photo yet.' };
  if (!p) missing.push({ text: 'No product photo, so styles that show the product are off.', fix: 'Add product photos', go: 'brand' });
  else if (photos.length < 2) missing.push({ text: 'Only one photo of this product: sides and the back would be drawn by AI.', fix: 'Add more photos', go: 'brand' });
  /* the cast: the Brand Book's people rule, then the saved cast, then the buyer it is aimed at */
  const people = bbv.comfort?.people || 'ai-cast', saved = (bbv.cast || [])[0] || null, persona = (bbv.personas || [])[0] || null;
  const showsPeople = (st && ['person', 'hands'].includes(st.people)) || (set || []).some((x) => ['person', 'hands'].includes(x.people)) || VIDEO_KINDS.has(kind) && /ugc|tt-/.test(st?.id || '');
  const cast = { value: people === 'none' ? 'none' : saved ? saved.id : people, label: people === 'none' ? PEOPLE.none : saved ? saved.label : persona ? `${PEOPLE[people] || PEOPLE['ai-cast']}: ${tidy(persona.name || persona.label || persona.who || '', 60)}` : PEOPLE[people] || PEOPLE['ai-cast'],
    why: people === 'none' ? 'Your Brand Book says no people on camera.' : saved ? 'Your saved cast, so every ad has the same face.' : persona ? 'Who this is aimed at, from your Brand Book’s buyers.' : 'Your Brand Book allows AI people.', shown: !!showsPeople,
    options: [...(bbv.cast || []).map((c) => ({ id: c.id, label: c.label, img: c.refs?.[0] || null })), ...Object.entries(PEOPLE).filter(([k]) => k !== 'consented' || (bbv.cast || []).some((c) => c.kind === 'real')).map(([id, label]) => ({ id, label }))] };
  /* the reference: the rival ad or viral post the card is about, else their own best ad, else a look from the Brand Book */
  const rk = card.research?.kind, own = refsFor(bbv, kind === 'video' ? 'reel' : 'image-ad', 3);
  const rf = ctx.ref || null; /* the reference itself (feed-service refSummary): its video, poster and beats */
  const reference = rk ? { value: { img: rf?.poster || (card.images || [])[0] || null, video: rf?.video || null, beats: (rf?.beats || []).length, kind: rk === 'viral' ? 'video' : 'ad', label: rk === 'viral' ? `${tidy(card.creatorName || 'A creator', 40)}’s post` : `${tidy(card.rivalName || 'A rival', 40)}’s ad` }, why: rk === 'viral' ? 'The viral post this card is about: Brew copies what made it work, with your product.' : 'The rival ad this card is about: Brew keeps its idea and makes it yours.' }
    : own[0] ? { value: { img: own[0].src, kind: 'look', label: own[0].label || 'Your look' }, why: own[0].proof ? `Your own ad that worked (${tidy(own[0].proof, 60)}), so the new one keeps its look.` : 'A look from your Brand Book.' } : { value: null, why: 'No reference: Brew follows your Brand Book’s look.' };
  /* the brand kit */
  const kit = bbv.kit || {}, brand = { value: { logo: kit.logo || null, colors: (kit.colors || []).slice(0, 5), fonts: kit.fonts || {}, tone: tidy(bbv.tone?.summary || bbv.tone?.line || (typeof bbv.tone === 'string' ? bbv.tone : ''), 80) || null }, why: 'Your Brand Book: logo, colours, type and tone.' };
  if (!kit.logo) missing.push({ text: 'No logo in your Brand Book, so the ad goes out without one.', fix: 'Add your logo', go: 'brand' });
  /* the words on it: the card's own claim and today's price, a real review only */
  const review = (bbv.reviews || [])[0] || null;
  const words = { value: { headline: tidy(card.headline || card.title, 90), line: tidy(card.sub, 140), review: review ? tidy(review.text || review.quote || review, 160) : null }, why: review ? 'The card’s claim, and a real review from your Brand Book.' : 'The card’s claim. No review is quoted: none are in your Brand Book yet.' };
  /* the direction: one paragraph a person can read and change */
  const look = (set ? set.map((x) => x.look || x.label).join('; ') : st?.look || st?.label || '').replace(/[.\s]+$/, '');
  const direction = { value: tidy([p?.name ? `${p.name}, exactly as in its photos.` : '', look ? `${look}.` : '', words.value.headline ? `Built around: “${words.value.headline}”.` : '', cast.shown && people !== 'none' ? `${cast.label}.` : people === 'none' ? 'No people.' : '', kit.colors?.length ? `In the brand colours ${kit.colors.slice(0, 3).join(', ')}.` : '', (bbv.never || []).length ? `Never: ${(bbv.never || []).slice(0, 3).join('; ')}.` : ''].filter(Boolean).join(' '), 600), why: 'Written by Brew from everything above. Change anything; it is what the maker reads.' };
  const size = { value: d0.sizes?.[0] || null, why: sizeWhy(card, d0.sizes?.[0]) };
  const length = kind === 'video' ? { value: d0.seconds, why: `${d0.seconds} s: ${st?.group === 'UGC' || /ugc/.test(st?.id || '') ? 'long enough for a hook, the product and a reason to buy' : d0.seconds <= 5 ? 'one moment that loops well in a feed' : 'the length this format holds attention for'}.` } : null;
  const count = { value: d0.count || 1, why: (d0.count || 1) > 1 ? `The card asks for ${d0.count}.` : 'One. Not right? Redo it.' };
  const quality = { value: 'standard', options: [{ id: 'preview', label: 'Preview' }, { id: 'standard', label: 'Standard' }, { id: 'premium', label: 'Premium (4K)' }], why: 'Sharp enough for feeds and ads. Premium is for print and big screens.' };
  if (st && blockOf(st, ctx)) missing.push({ text: blockOf(st, ctx), fix: 'Pick another style', go: 'style' });
  return { slots: { make, style, products, cast, reference, brand, words, direction, size, length, count, quality }, missing };
}
