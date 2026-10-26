// What the Studio composer arrives with, and why. Every slot (what to make, the style, the products, the cast, the reference, the
// brand kit, the words, the direction, the size, the length, how many, the quality) is filled from what Brew already knows: the
// card, the Brand Book, the catalog, the references, the rival or viral post the card is about. Each says where it came from in
// one line, and the brand can change any of it. What Brew doesn't know is said plainly with the one thing that would fix it;
// nothing is made up to fill a gap. Pure: no calls, no spend.
import { styleOf, blockOf, angleOf, carriesAngle, cardText } from './studio.js';
import { SIZES } from './catalogue.js';
import { refsFor } from './brandbook.js';
import { kitColours, colourName, fitDirection, healDirection } from './kit-colours.js'; // the kit's own colours, named (26 Oct)
export { UI_DEFAULTS, colourName, kitColours, fitDirection, healDirection } from './kit-colours.js';

const tidy = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const VIDEO_KINDS = new Set(['video']);
/* "…in use.; The product…" and "wash.”.": each part ends once, with its own stop */
const stop = (s) => { s = String(s || '').trim().replace(/[\s;,:]+$/, ''); return !s ? '' : /[.!?…][”’"')]*$/.test(s) ? s : `${s}.`; };
const PEOPLE = { none: 'No people on camera', hands: 'Hands only', 'ai-cast': 'An AI person who fits your buyer', consented: 'Your own people (with consent)' };

/* the brand's rules for the maker, each one whole sentence: its colours in words (never hex), and its Never list */
export const DIR_MAX = 900; // what the set-up keeps (jam2/routes.js cleanSpec)
export const rulesOf = (bbv = {}) => { const names = [...new Set(kitColours(bbv).slice(0, 3).map(colourName).filter(Boolean))];
  return { colours: names.length ? `In the brand’s ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}.` : 'No brand colours in the Brand Book yet: the colours follow the product photo.',
    never: (bbv.never || []).length ? stop(`Never: ${(bbv.never || []).slice(0, 3).map((x) => String(x).replace(/[.;\s]+$/, '')).join('; ')}`) : '' }; };
/* a saved direction (a made take's set-up, written before 26 Oct): healed (the brand's colours in words, clean joins), with the brand's
   rules put back when a cut had dropped them; whole sentences. Free */
export const healDir = (dir, bbv = {}) => { if (typeof dir !== 'string' || !dir.trim()) return dir; const R = rulesOf(bbv); let x = healDirection(dir, kitColours(bbv));
  if (!/(?:^|[.!?”]\s)(?:In the brand[’']s\b|No brand colou?rs\b)/.test(x)) x = `${x} ${R.colours}`; if (R.never && !/(?:^|[.!?”]\s)Never:/.test(x)) x = `${x} ${R.never}`;
  return fitDirection(x, DIR_MAX); };

/* the platform a size is for, in the words the card used */
const sizeWhy = (card, key) => { const s = SIZES[key]; if (!s) return null; const where = /instagram|\big\b|reel|story|stories/i.test(`${card?.title || ''} ${card?.cta?.label || ''}`) ? 'Instagram' : /meta|facebook|ad\b|ads\b/i.test(`${card?.title || ''} ${card?.cta?.label || ''} ${card?.agent || ''}`) ? 'Meta ads' : null;
  return `${s.label}${where ? `, the shape that runs best on ${where}` : ''}. Every other placement is cut from the same make.`; };

export function contextOf(ctx = {}, d0 = {}) {
  const card = ctx.card || {}, bbv = ctx.bbv || {}, kind = d0.kind || 'image', st = styleOf(d0.style), set = Array.isArray(d0.set) ? d0.set.map(styleOf).filter(Boolean) : null;
  const text = `${card.title || ''} ${card.sub || ''}`, missing = [];
  /* what to make: the card's button */
  const make = { value: set ? 'set' : kind, why: card.cta?.label ? `The card’s button: “${tidy(card.cta.label, 40)}”.` : 'From the card.' };
  /* the style: the card's angle */
  const an = angleOf(cardText(ctx)), angle = carriesAngle(st, an) ? an.line : null; /* the reason names the angle only when this style carries it */
  const style = { value: set ? set.map((x) => x.id) : st?.id || null, label: set ? `${set.length} slides · ${set.map((x) => x.label).join(', ')}` : st?.label || null,
    why: set ? `A ${set.length}-slide set, one style per slide, the order that sells: what it is, it in use, why it works.` : st?.id === 'recreate-swap' ? 'Recreate it, because this card is about a video that already works: we keep it as it is and put your product in.' : st?.id === 'viral-short' && ctx.ref?.beats?.length ? `A viral short in the same ${ctx.ref.beats.length}-shot pattern as the post this card is about, with your product and your people.` : st ? `${st.label}${angle ? `, because ${angle}` : ', the style that shows the product best for this card'}.` : 'Pick a style.' };
  /* the products: the card's own, with every photo of it Brew has */
  const p = ctx.product || null, photos = p ? [p.img, ...(() => { const m0 = (ctx.catalog || []).find((x) => (p.handle && x.handle === p.handle) || (p.name && (x.t || x.title) === p.name) || (p.img && (x.imgs || x.images || []).includes(p.img))) || {}; return [...(m0.imgs || []), ...(m0.images || [])]; })()].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 8) : [];
  const products = { value: p ? [{ img: p.img, name: p.name || null, handle: p.handle || null, photos }] : [], why: p ? `${tidy(p.name || 'The product', 60)}: the product on the card${photos.length > 1 ? `, with ${photos.length} of its photos so it looks exactly right` : ''}.` : 'No product photo yet.' };
  if (!p) missing.push({ text: 'No product photo, so styles that show the product are off.', fix: 'Add product photos', go: 'brand' });
  else if (photos.length < 2 && (st?.allSides || (set || []).some((x) => x.allSides))) missing.push({ /* only where the style turns the product round (catalog rows keep their photos as imgs: the note showed for products with six) */ text: 'Only one photo of this product: sides and the back would be drawn by AI.', fix: 'Add more photos', go: 'brand' });
  /* the cast: the Brand Book's people rule, then the saved cast, then the buyer it is aimed at */
  const people = bbv.comfort?.people || 'ai-cast', saved = (bbv.cast || [])[0] || null, persona = (bbv.personas || [])[0] || null;
  const showsPeople = (st && ['person', 'hands'].includes(st.people)) || (set || []).some((x) => ['person', 'hands'].includes(x.people)) || VIDEO_KINDS.has(kind) && /ugc|tt-/.test(st?.id || '');
  const cast = { value: people === 'none' ? 'none' : saved ? saved.id : people, label: people === 'none' ? PEOPLE.none : saved ? saved.label : persona ? `${PEOPLE[people] || PEOPLE['ai-cast']}: ${tidy(persona.name || persona.label || persona.who || '', 60)}` : PEOPLE[people] || PEOPLE['ai-cast'],
    why: people === 'none' ? 'Your Brand Book says no people on camera.' : saved ? 'Your saved cast, so every ad has the same face.' : persona ? 'Who this is aimed at, from your Brand Book’s buyers.' : 'Your Brand Book allows AI people.', shown: !!showsPeople,
    options: [...(bbv.cast || []).map((c) => ({ id: c.id, label: c.label, img: c.refs?.[0] || null })), ...Object.entries(PEOPLE).filter(([k]) => k !== 'consented' || (bbv.cast || []).some((c) => c.kind === 'real')).map(([id, label]) => ({ id, label: id === 'ai-cast' && persona ? `${label}: ${tidy(persona.name || persona.label || persona.who || '', 60)}` : label }))] }; /* the AI person keeps the buyer it fits, so the picker shows it picked and picking it again never drops them */
  /* the reference: the rival ad or viral post the card is about, else their own best ad, else a look from the Brand Book */
  const rk = card.research?.kind, own = refsFor(bbv, kind === 'video' ? 'reel' : 'image-ad', 3);
  const rf = ctx.ref || null; /* the reference itself (feed-service refSummary): its video, poster and beats */
  const reference = rk ? { value: { img: rf?.poster || (card.images || [])[0] || null, video: rf?.video || null, beats: (rf?.beats || []).length, kind: rk === 'viral' ? 'video' : 'ad', label: rk === 'viral' ? `${tidy(card.creatorName || 'A creator', 40)}’s post` : `${tidy(card.rivalName || 'A rival', 40)}’s ad` }, why: rk === 'viral' ? 'The viral post this card is about: we copy what made it work, with your product.' : 'The rival ad this card is about: we keep its idea and make it yours.' }
    : own[0] ? { value: { img: own[0].src, kind: 'look', label: own[0].label || 'Your look' }, why: own[0].proof ? `Your own ad that worked (${tidy(own[0].proof, 60)}), so the new one keeps its look.` : 'A look from your Brand Book.' } : { value: null, why: 'No reference: we follow your Brand Book’s look.' };
  /* the brand kit */
  const kit = bbv.kit || {}, kc = kitColours(bbv), brand = { value: { logo: kit.logo || null, colors: kc.slice(0, 5), fonts: kit.fonts || {}, tone: tidy(bbv.tone?.summary || bbv.tone?.line || (typeof bbv.tone === 'string' ? bbv.tone : ''), 80) || null }, why: 'Your Brand Book: logo, colours, type and tone.' };
  if (!kit.logo) missing.push({ text: 'No logo in your Brand Book, so the ad goes out without one.', fix: 'Add your logo', go: 'brand' });
  if (!kc.length) missing.push({ text: 'No brand colours in your Brand Book yet, so the colours follow the product photo.', fix: 'Add your colours', go: 'brand' });
  /* the words on it: the card's own claim and today's price, a real review only */
  const pn = String(ctx.product?.name || '').toLowerCase(), rp = (r) => String(r?.product || '').toLowerCase(); /* only this product's review, or one about the whole brand */
  const review = (bbv.reviews || []).find((r) => pn && rp(r) && (pn.includes(rp(r)) || rp(r).includes(pn))) || (bbv.reviews || []).find((r) => !rp(r)) || null;
  /* the words on it come from the jam's own copy (the ad's headline, the post's first line), never the card's title: that is Brew's note to the team ("Browse emails are off") */
  const v1 = ctx.v1 || {}, first = (x) => tidy(String(x || '').split(/\n|(?<=[.!?])\s/)[0], 140);
  const head0 = v1.headline || v1.overlay || v1.slides?.[0]?.onSlide || v1.cards?.[0]?.headline || v1.heading || card.make?.hook || card.hook || '';
  const line0 = v1.primaryText || v1.caption || v1.copy || v1.description || v1.body || '';
  const words = { value: { headline: tidy(head0, 90), line: first(line0) || null, review: review ? tidy(review.text || review.quote || review, 160) : null }, why: review ? 'The card’s claim, and a real review from your Brand Book.' : 'The card’s claim. No review is quoted: none are in your Brand Book yet.' };
  /* the direction: one paragraph a person can read and change */
  const look = (set ? set.map((x) => stop(x.look || x.label)).join(' ') : stop(st?.look || st?.label || ''));
  const hl = String(words.value.headline || '').replace(/[\s.!?…]+$/, ''), R = rulesOf(bbv);
  /* the brand's rules first (its colours, its Never list), then the look: whole sentences, so a set-up with many styles never loses
     the rules (26 Oct, QV N-P1-5: cut at 600 characters mid-sentence) */
  const direction = { value: fitDirection([p?.name ? `${p.name}, exactly as in its photos.` : '', R.colours, R.never, look, hl ? `Built around: “${hl}”.` : '', cast.shown && people !== 'none' ? stop(cast.label) : people === 'none' ? 'No people.' : ''].filter(Boolean).join(' '), DIR_MAX), rules: [R.colours, R.never].filter(Boolean), why: 'Written by us from everything above. Change anything; it is what the maker reads.' };
  const size = { value: d0.sizes?.[0] || null, why: sizeWhy(card, d0.sizes?.[0]) };
  const length = kind === 'video' ? { value: d0.seconds, why: `${d0.seconds} s: ${st?.group === 'UGC' || /ugc/.test(st?.id || '') ? 'long enough for a hook, the product and a reason to buy' : d0.seconds <= 5 ? 'one moment that loops well in a feed' : 'the length this format holds attention for'}.` } : null;
  const count = { value: d0.count || 1, why: (d0.count || 1) > 1 ? `The card asks for ${d0.count}.` : 'One. Not right? Redo it.' };
  const quality = { value: 'standard', options: [{ id: 'preview', label: 'Preview' }, { id: 'standard', label: 'Standard' }, { id: 'premium', label: 'Premium (4K)' }], why: 'Sharp enough for feeds and ads. Premium is for print and big screens.' };
  if (st && blockOf(st, ctx)) missing.push({ text: blockOf(st, ctx), fix: 'Pick another style', go: 'style' });
  return { slots: { make, style, products, cast, reference, brand, words, direction, size, length, count, quality }, missing };
}
