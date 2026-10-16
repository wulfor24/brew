// Margin notes: the handwritten aside next to a feed card ("MOVE 21 · twelve this week. forty by day 30.").
// The first hand-made seed carried them; generated brands never got one, so the margin went empty. This writes them for any
// brand: one Sonnet call reads the cards that have no note yet, picks the ones worth a scribble (about one in two) and
// writes a short aside from the card's own numbers. Every number in a note must be on its card (fact gate); a note that
// fails is dropped. Kept in the pack as notes.json { notes: {cardId: {k, h}}, seen: [cardId] }; feed-service lays them
// on cards at publish time, so cards already in a workspace get them too. NOTES_OFF=1 stops it.

const P = 'notes.json';
export const MIN_NOTES = 12; // the feed's margin wants a note every 2 or 3 cards
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, half: 50 };
const nums = (s) => [...String(s || '').toLowerCase().replace(/(\d),(\d)/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)].map((m) => +m[0]);
const wordNums = (s) => (String(s || '').toLowerCase().match(/[a-z]+/g) || []).filter((w) => WORDS[w] && w !== 'one' && w !== 'half').map((w) => WORDS[w]);
const textOf = (c) => JSON.stringify([c.title, c.sub, c.src, c.rows, c.detail, c.campaign, c.badge, c.options?.map?.((o) => [o.name, o.sub])]);

// a note may only quote numbers its card carries ("day 30", "4 of 7", "twelve"); small counting words like "one" pass
export function noteOk(note, card) {
  if (!note?.h || note.h.length > 70 || (note.k || '').length > 28 || /—/.test(note.h)) return false;
  const have = new Set(nums(textOf(card))), want = [...nums(`${note.k} ${note.h}`), ...wordNums(note.h)];
  return want.every((n) => have.has(n) || (n <= 1));
}

// lay notes on the posts that have none (pure; brand-pack and feed-service use it)
export const withNotes = (posts, notes) => (notes ? (posts || []).map((p) => (p && !p.note && notes[p.id] ? { ...p, note: notes[p.id] } : p)) : posts);

const SCHEMA = { type: 'object', additionalProperties: false, required: ['notes'], properties: { notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'k', 'h'],
  properties: { id: { type: 'string' }, k: { type: 'string' }, h: { type: 'string' } } } } } };

export function createNotes({ ai, packs, log = console, allow = () => true } = {}) {
  const busy = new Set();
  const stateOf = async (slug) => (await packs.getJSON(slug, P, null).catch(() => null)) || { notes: {}, seen: [] };

  // write notes for the cards of a loaded pack that were never considered; sets pack.notes in place when done
  async function fill(pack) {
    const slug = pack?.slug; if (!slug || pack.kind !== 'generated' || busy.has(slug) || process.env.NOTES_OFF === '1' || !allow()) return null;
    busy.add(slug);
    try {
      const st = await stateOf(slug); pack.notes = st.notes;
      /* simulated-account cards (demo-data.js: demo / onlyWhen) never show on the live site, so they get no paid note there */
      const seen = new Set(st.seen), all = (pack.rawSeed?.posts || pack.seed?.posts || []).filter((p) => p?.id && !p.note && p.title && p.kind !== 'conflict' && !(process.env.DEMO_MODE !== '1' && (p.demo || p.onlyWhen)));
      let posts = all.filter((p) => !seen.has(p.id));
      /* the feed shows a note every 2 or 3 cards, so a brand needs about one note per three cards: one with fewer (written
         when it was one in three of fewer cards) gets one more pass over its cards without a note, once */
      const want = Math.min(MIN_NOTES, Math.ceil(all.length / 3)), have = Object.keys(st.notes || {}).length;
      if (posts.length < 3 && have < want && !st.toppedAt) { posts = all.filter((p) => !st.notes[p.id]); st.toppedAt = Date.now(); }
      if (posts.length < 3) return st;
      const brand = pack.seed?.brand?.name || slug; let usd = 0, made = 0;
      for (let i = 0; i < posts.length; i += 40) {
        const batch = posts.slice(i, i + 40), byId = new Map(batch.map((p) => [p.id, p]));
        const list = batch.map((p) => ({ id: p.id, src: p.src || '', title: p.title, sub: String(p.sub || '').slice(0, 400), rows: (p.rows || []).slice(0, 6) }));
        let j = null;
        try { const r = await ai.call({ model: 'sonnet', schema: SCHEMA, max: 3000, tag: 'notes', prompt: `These are feed cards for ${brand}'s team. Next to some cards a teammate scribbles a short handwritten note in the margin, the way a founder writes on a printout.

Pick about one card in two where a scribble adds something: the stake, the target, the one number that matters, or a blunt nudge. Skip cards where it would only repeat the title. Prefer cards with a clear number or deadline.

For each pick write:
- k: a tiny eyebrow, lowercase, 1 to 3 words, naming where it comes from, like "move 21", "reviews", "rival ads", "this week". Use the card's src for it when it names a move.
- h: the scribble itself, all lowercase, 3 to 10 words, one or two short sentences ending with a period, like "twelve this week. forty by day 30." or "they copy us. we ship first." Spell small counts as words if it reads more naturally.

Every number in k or h must appear on that card. No em dashes, no hashtags, no emoji, no quotes.

CARDS (JSON):
${JSON.stringify(list)}` });
          j = r.json; usd += r.usd || 0; } catch (e) { log.warn?.('[notes]', slug, e.message); if (e.mock) return st; continue; }
        for (const n of j?.notes || []) { const c = byId.get(n.id), note = { k: String(n.k || '').trim().toLowerCase(), h: String(n.h || '').trim() };
          if (c && noteOk(note, c)) { st.notes[n.id] = note; made++; } }
        batch.forEach((p) => seen.add(p.id));
      }
      st.seen = [...seen].slice(-2000); st.at = Date.now();
      await packs.put(slug, P, st); pack.notes = st.notes;
      log.log?.('[notes]', slug, `${made} new of ${posts.length} cards`, `$${usd.toFixed(3)}`);
      return st;
    } finally { busy.delete(slug); }
  }
  return { fill, stateOf };
}
