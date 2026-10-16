// The creative catalog: what Brew can have made (its own statics, carousels, reels, emails, messages, page sections) and what
// Sloosh's Spaces and models make, one entry per asset (data/creative-catalog.json). The card, move and idea writers get a
// compact "What can be made" block from it so a card proposes a specific, makeable asset ("6 slides: the fit room, one body
// type per slide"), never "a new ad". isGeneric() catches the phrasings the catalog forbids; keyOf() turns a card into
// format + exact product + angle words so repeats inside one feed can be found. Brand-agnostic: the brand's product name is
// substituted into the examples at render time, nothing here names a brand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardProduct } from './product-match.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'creative-catalog.json');
let cache = null;
export function load({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  cache = { v: j.v, avoid: (j.avoid || []).map((s) => String(s).toLowerCase()), formats: (j.formats || []).map((e) => ({ ...e, family: e.family || null })) };
  return cache;
}
/* the family names: the values make.format may take (every old MAKE_FORMAT name is one) */
export const formats = () => load().formats.filter((e) => !e.family).map((e) => e.format);
/* the whole catalog: families plus the Spaces and models that make them */
export const entries = () => load().formats;
const norm = (s) => String(s || '').trim().toLowerCase();
/* exact name first (the Sloosh Space "Instagram Carousel" beside the family "instagram carousel"), then case-blind */
export const entry = (format) => { const all = load().formats, f = String(format || '').trim(); return all.find((e) => e.format === f) || all.find((e) => norm(e.format) === norm(f)) || null; };
/* the family a catalog name maps to ("UGC Unboxing Clip" → "reel"; a family maps to itself; unknown → null) */
export const familyOf = (format) => { const e = entry(format); return e ? (e.family || e.format) : null; };
export const isFormat = (format) => formats().includes(norm(format));

/* the "What can be made" block for a prompt: one line per family (looks · needs · example pieces) and, under it, the Sloosh
   Spaces and models grouped by the family they make. product: the brand's own hero product name for the examples. family:
   only that family and its makers. limit: families to list (default all). Stays under ~2,500 characters for the full set. */
export function promptBlock({ family = null, limit = 99, product = null, examples = 1 } = {}) {
  const all = load().formats, sub = (s) => String(s).replace(/\bthe \[product\]/g, '[product]').replace(/\[product\]/g, product ? String(product) : 'the product');
  const fams = all.filter((e) => !e.family && e.format !== 'other' && (!family || norm(e.format) === norm(family))).slice(0, limit);
  const lines = fams.map((e) => {
    const makers = all.filter((x) => x.family === e.format && x.makes === 'sloosh-space').map((x) => x.format);
    const secs = e.seconds ? `, ${e.seconds[0]}-${e.seconds[1]} s` : '';
    return `- ${e.format} (${(e.ratio || []).slice(0, 2).join('/')}${secs}): ${e.short || e.looks}. E.g. "${(e.examples || []).slice(0, examples).map(sub).join('" / "')}"${makers.length ? ` · Sloosh: ${makers.slice(0, 2).join(', ')}` : ''}`;
  });
  return `WHAT CAN BE MADE (pick one; say the format, the exact product as the store lists it, the scene or angle, the hook):\n${lines.join('\n')}`;
}

/* generic asset asks: the catalog's avoid list as whole phrases, plus the short shapes they come in. A pieces line that is
   only "a new ad" or "fresh creatives for the launch" is generic; "3 hooks, 4:5: the Paw Warmer on the desk" is not */
const GENERIC_RE = /^(?:\d+\s+)?(?:new|fresh|some|a few|several|more|updated|engaging|compelling|eye-catching|high-quality|great|good)?\s*(?:ads?|creatives?|visuals?|content|posts?|videos?|images?|graphics?|banners?|assets?|designs?|photos?|campaigns?|materials?)(?:\s+(?:for|about|on|of)\s+[\w' -]{0,40})?\.?$/i;
const SPECIFIC = /\b(?:\d+\s*(?:slides?|cards?|frames?|hooks?|versions?|emails?|messages?|clips?|beats?|tiles?|images?|angles?|rows?|quotes?)|\d+\s*s\b|\d+:\d+|9:16|4:5|1:1|16:9)\b/i;
export function isGeneric(pieces) {
  const s = norm(pieces).replace(/[.!]+$/, '');
  if (!s) return true;
  if (SPECIFIC.test(s) && s.length > 24) return false; /* a count, a ratio or a duration with a scene is a real asset line */
  if (GENERIC_RE.test(s)) return true;
  const { avoid } = load();
  if (avoid.includes(s)) return true;
  /* a short line that is an avoid phrase plus filler ("a new ad for the launch", "some visuals for Diwali") */
  const head = s.replace(/\s+(?:for|about|on|of|to|that|which|with|showing|featuring|highlighting)\b[\s\S]*$/, '');
  if (avoid.includes(head) && s.length < 60) return true;
  return false;
}

/* the key that makes two cards the same ask: family format + the exact product + the angle words (the scene or hook, with
   counts, stop words and the product's own words removed, sorted). catalog: product-match catalogOf(profile); without one
   the product is the first Capitalised run in the pieces line. Two identical asks give one key; two angles on one product do not */
const STOP = new Set('a an the and or of for with on in at to from by as is are be our your their its one two three four five six seven eight nine ten new each per every this that these those into over under then first last same different'.split(' '));
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const COUNT_RE = /\b\d+\s*(?:slides?|cards?|frames?|hooks?|versions?|emails?|messages?|clips?|beats?|tiles?|images?|angles?|static(?:s)?|s)\b/gi;
export function keyOf(card = {}, catalog = null, { brand = '' } = {}) {
  const format = familyOf(card?.make?.format) || norm(card?.make?.format) || 'none';
  const pieces = String(card?.make?.pieces || '');
  let product = '';
  if (catalog?.length) product = cardProduct(card, catalog, { brand })?.t || '';
  if (!product) product = (pieces.match(/\b(?:\p{Lu}[\p{L}\p{N}'-]*)(?:\s+\p{Lu}[\p{L}\p{N}'-]*)+/u) || [])[0] || ''; /* "Paw Warmer" in the asset line */
  const prodWs = new Set(words(product)), brandWs = new Set([...words(brand), ...words(format), 'static', 'statics', 'post', 'ad', 'ads', 'message', 'email', 'frame', 'frames', 'slide', 'slides', 'card', 'cards', 'clip', 'clips']);
  const angleSrc = (pieces || card?.title || '').replace(COUNT_RE, ' ').replace(/\b\d+:\d+\b/g, ' ');
  const angle = [...new Set(words(angleSrc).filter((w) => !prodWs.has(w) && !brandWs.has(w)))].sort().slice(0, 8);
  return `${format}|${norm(product)}|${angle.join(' ')}`;
}
/* the cards in one window that ask for the same thing: [{ key, ids }] for every key held by more than one card */
export function repeats(cards = [], catalog = null, opts = {}) {
  const by = new Map();
  for (const c of cards) { if (!c?.make?.format) continue; const k = keyOf(c, catalog, opts); if (!by.has(k)) by.set(k, []); by.get(k).push(c.id || c.title); }
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}
