// Cards from different moves that ask the team for the same thing ("fix the pack prices" written six ways after a reload): the feed
// shows one of them, the best-graded, where the first of them ranked; the others wait at the end of the feed. Nothing is dropped
// and no move is touched, so a rewrite that changes a card's ask brings it back on its own.
//
// An ask is the title's action (its first word, or the button's when the title states a finding) and the words of the title before
// its reason ("Fix the pack prices before markup tells Google" asks to fix pack prices). Two cards ask the same when they share the
// action and either two of those words, or one of them plus two money or percent figures in the card (the same ₹1,947 pack, ₹20.04 over three singles). A title
// that states a finding ("The Pack of 3 costs more than three singles") takes its button's action and always needs the figure.

const STOP = new Set('a an the of to for on in at by with and or its it is are be this that these those their your our my every each any all only more most than then into from as so not no one two three four five six seven eight nine ten first today now live new own same what which who how why when where they them we us you he she his her'.split(' '));
const NOT_VERB = new Set([...STOP, 'none', 'zero', 'there', 'here', 'we', 'you', 'they']);
const NUMBERY = /^(?:\d|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thir|four|fif|six|seven|eigh|nine|twent|thirt|fort|fift|hundred|thousand)/; /* "Seventeen serum pages…" states a count, not an action */
const VAGUE = new Set(['agree', 'approve', 'open', 'review', 'see', 'read', 'view', 'decide', 'answer', 'reply', 'start', 'make', 'draft', 'update', 'go', 'get', 'try', 'show', 'tell', 'ask', 'use', 'let', 'do']); /* a button's verb that says how, not what */
const SAME = { correct: 'fix', repair: 'fix', settle: 'fix', resolve: 'fix', sort: 'fix', mend: 'fix', remove: 'drop', cut: 'drop', pull: 'drop', kill: 'drop', retire: 'drop', post: 'publish', ship: 'publish',
  /* the same ask worded another way (feed audit 20 Oct: "Run localized ads…" next to six "Launch local trust ads…"; "Turn on" and "Set up" the review flow) */
  run: 'launch', start: 'launch', roll: 'launch', set: 'setup', turn: 'setup', enable: 'setup', switch: 'setup', automate: 'setup', build: 'setup' };
/* one word for one thing: localized/local, trust-first/trust, Bulgarian/Bulgaria, post-purchase/post delivery, abandoned checkout/cart */
const NORM_W = { localized: 'local', localised: 'local', localize: 'local', localise: 'local', locally: 'local', localization: 'local', abandoned: 'cart', abandon: 'cart', checkout: 'cart', automated: 'auto', automatic: 'auto', reviews: 'review' };
const normW = (w) => { if (NORM_W[w]) return NORM_W[w]; const x = w.replace(/-(?:first|led|based|only)$/, ''); return x.length > 6 && /[^aeiou]ian$/.test(x) ? x.slice(0, -1) : x; };
const prep = (s) => String(s || '').replace(/\bpost[- ]?(?:purchase|delivery|order)\b|\bafter (?:purchase|delivery)\b/gi, ' postpurchase ');
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => prep(s).toLowerCase().replace(/[’']s\b/g, '').split(/[^a-zÀ-ɏ-]+|-(?![a-z])|(?<![a-z])-/).filter(Boolean).map(stem).map(normW); /* "post-purchase" stays one word */
/* where or in what form, not what: two "landing page" cards are not one ask */
const FORMAT = new Set('page pdp landing listing template ad email mail message post thread sequence campaign flow block product site store shopify website section popup banner carousel reel video story static poster whatsapp sms buyer customer shopper visitor people user'.split(' '));
const verbOf = (w) => SAME[w] || w;
/* the part of a title that names the thing to do: up to its reason or its colon */
const headOf = (t) => String(t || '').split(/\s+(?:before|until|so|while|after|then|because|once|ahead of|instead of)\s+|\s*[:;,(—–]\s*|\s+-\s+/i)[0];
const figures = (s) => new Set((String(s || '').match(/(?:[₹$€£]|rs\.?\s?)\s?\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?\s?%/gi) || []).map((x) => x.toLowerCase().replace(/[^\d.%]/g, '').replace(/\.0+$/, '')).filter((x) => x && x !== '0'));

/* noise: words that name the brand itself ("Arata", "Cozy Snugglet") say nothing about the ask */
export function askOf(c, noise = new Set()) {
  const t = String(c?.title || ''), w = words(t), first = w[0];
  let verb = first && !NOT_VERB.has(first) && !NUMBERY.test(first) && !noise.has(first) ? verbOf(first) : null;
  let borrowed = false; /* a title that states a finding takes its button's verb, and then needs a shared figure too */
  if (!verb) { const b = words(c?.cta?.label || (typeof c?.cta === 'string' ? c.cta : ''))[0]; if (b && !VAGUE.has(b) && !NOT_VERB.has(b)) { verb = verbOf(b); borrowed = true; } }
  const head = new Set(words(verb && verbOf(first) === verb ? headOf(t) : t).filter((x) => x.length > 2 && !STOP.has(x) && !FORMAT.has(x) && !noise.has(x) && verbOf(x) !== verb));
  return { verb, borrowed, head, figs: figures(`${t} ${c?.sub || ''}`) };
}

export function sameAsk(a, b) {
  const A = a?.head ? a : askOf(a), B = b?.head ? b : askOf(b);
  if (!A.verb || A.verb !== B.verb) return false;
  let n = 0; for (const x of A.head) if (B.head.has(x)) n++;
  if (n >= 2 && n / Math.min(A.head.size, B.head.size) >= 0.6 && !A.borrowed && !B.borrowed) return true;
  if (n < 1) return false;
  let f = 0; for (const x of A.figs) if (B.figs.has(x)) f++;
  return f >= 2; /* one shared price is often just the hero product's price; two is the same finding */
}

export const noiseOf = (...names) => new Set(names.flatMap((x) => words(x)).filter((x) => x.length > 2 && !STOP.has(x)));

/* groups of move cards from different moves that ask the same (joined through any pair, so six wordings of one ask land in one
   group), each led by its best-graded card. moveOf(c) gives a card's move (null: not a move card, never grouped), value(c) its
   grade, noise the brand's own name words. Returns Map card id -> leader card */
export function askLeaders(cards, { moveOf, value, noise } = {}) {
  const list = cards.filter((c) => moveOf(c) != null), asks = list.map((c) => askOf(c, noise)), up = list.map((_, i) => i);
  const root = (i) => (up[i] === i ? i : (up[i] = root(up[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (moveOf(list[i]) !== moveOf(list[j]) && sameAsk(asks[i], asks[j])) up[root(i)] = root(j);
  const best = new Map();
  list.forEach((c, i) => { const r = root(i), b = best.get(r); if (!b || value(c) > value(b) || (value(c) === value(b) && String(c.id) < String(b.id))) best.set(r, c); });
  return new Map(list.map((c, i) => [c.id, best.get(root(i))]));
}

/* a ranked list with one card per ask: the leader takes the place of the first of its group to rank; the rest (sunk) go to the
   end, in rank order. keep(c) holds a card in place anyway (a card someone already engaged with) */
export function oneAsk(ranked, { moveOf, value, noise, keep = () => false }) {
  const lead = askLeaders(ranked, { moveOf, value, noise }), out = [], tail = [], placed = new Set();
  const put = (c) => { out.push(c); placed.add(c.id); };
  for (const c of ranked) {
    if (placed.has(c.id)) continue;
    const l = lead.get(c.id);
    if (!l || keep(c)) put(c);
    else if (!placed.has(l.id)) { put(l); if (l !== c) tail.push(c); }
    else tail.push(c);
  }
  return { list: [...out, ...tail], sunk: new Set(tail.map((c) => c.id)) };
}
