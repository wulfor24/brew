// The brand's rules (the Brand Book's Rules chapter): plain sentences every maker and the claims check read.
// Four groups (claims & compliance, people & likeness, AI use, brand safety). Each rule says how strict it is (block: the
// work can't go out with it broken; warn: Brew flags it) and where it applies (every channel, or some; every market, or some).
// Brew suggests a starting set from the category, the market and what the read found, labelled "suggested" until the team
// confirms one; the team turns any off, changes its strength or reach, rewrites it, or adds its own. Three "choice" rules carry
// the comfort settings makers already read (people on camera, AI voice, testimonials).

export const GROUPS = { claims: 'Claims and compliance', people: 'People and likeness', ai: 'AI use', safety: 'Brand safety' };
export const CHANNELS = { ads: 'Ads', social: 'Social posts', site: 'Website', email: 'Email and WhatsApp', marketplaces: 'Marketplaces' };
const tidy = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/* the sentence a choice rule reads as, for each comfort value */
export const CHOICES = {
  people: { group: 'people', say: { none: 'No people appear in {n}’s pictures or videos.', hands: 'Only hands appear on camera, never faces.', 'ai-cast': 'AI people can appear on camera.', consented: 'Only {n}’s own people appear on camera, with their consent.' } },
  aiVoice: { group: 'ai', say: { yes: 'Videos can use an AI voice.', no: 'Videos use real voices only, never an AI voice.' } },
  testimonials: { group: 'ai', say: { yes: 'Testimonial-style videos are fine, using only real claims.', no: 'No testimonial-style videos.' } }
};

const countryOf = (m) => { const x = String(m || '').toLowerCase(); return /^(in|india)$/.test(x) ? 'IN' : /^(us|usa|united states)/.test(x) ? 'US' : /^(gb|uk|united kingdom)/.test(x) ? 'GB' : /^(ae|uae|united arab)/.test(x) ? 'AE' : /^(au|australia)$/.test(x) ? 'AU' : x.toUpperCase().slice(0, 2) || null; };

/* the starting set, from facts only: the category, the market, the category's never-say words, rivals, how it sells */
export function suggestRules({ name = 'the brand', category = '', market = null, never = [], rivals = [], sells = 'online' } = {}) {
  const c = String(category || '').toLowerCase(), cc = countryOf(market), R = [];
  const add = (id, group, strength, text, extra = {}) => R.push({ id, group, strength, text: text.replace(/\{n\}/g, name), src: 'suggested', ...extra });
  const health = /health|supplement|nutrition|wellness|pharma|medic|vitamin|protein/.test(c), beauty = /beauty|skin|hair|cosmetic|personal care|grooming/.test(c);
  const food = /food|snack|beverage|drink|nutrition|supplement|protein/.test(c), realty = /real estate|property|housing|apartment|villa|township/.test(c) || sells === 'by enquiry' && /home|living|project/.test(c);
  const kids = /baby|kid|child|toy/.test(c);
  /* claims and compliance */
  add('claims-own', 'claims', 'block', 'Only make claims {n} already makes on its own site or ads, word for word.');
  if (never.length) add('claims-never', 'claims', 'block', `Never use these words or claims: ${never.slice(0, 12).join(', ')}.`, { words: never.slice(0, 20) });
  if (health || beauty) add('claims-results', 'claims', 'warn', 'Results are “up to” or “in a study”, with the study named, never promised to everyone.');
  if (beauty || health) add('claims-beforeafter', 'claims', 'warn', 'Before-and-after pictures only from real customers, unedited, with their consent.');
  if (cc === 'IN') add('claims-asci', 'claims', 'warn', 'Follow the ASCI code: every claim in an ad can be backed by proof {n} could show.', { where: { channels: ['ads'] } });
  if (cc === 'IN' && food) add('claims-fssai', 'claims', 'block', 'No disease or cure claims for foods and supplements (FSSAI).');
  if (cc === 'US') add('claims-ftc', 'claims', 'warn', 'Results shown are typical, and paid creators say they’re paid (FTC).');
  if (cc === 'GB') add('claims-asa', 'claims', 'warn', 'Follow the ASA code: claims are backed by evidence and nothing misleads.');
  if (cc === 'IN' && realty) add('claims-rera', 'claims', 'block', 'Every ad that names a project shows its RERA number.', { where: { channels: ['ads'] } });
  /* people and likeness */
  add('people-consent', 'people', 'block', 'Real customers, staff or creators appear only with their written consent.');
  if (!kids) add('people-kids', 'people', 'warn', 'No children on camera.');
  /* AI use */
  add('ai-reviews', 'ai', 'block', 'Never invent a review, a rating or a customer quote.');
  add('ai-likeness', 'ai', 'block', 'An AI person never looks like a real, named person.');
  /* brand safety */
  add('safety-offers', 'safety', 'block', 'Never mention a price, offer or deadline that isn’t live on the site.');
  if (rivals.length) add('safety-rivals', 'safety', 'warn', 'Don’t name a rival in ads.', { where: { channels: ['ads'] } });
  add('safety-topics', 'safety', 'warn', 'Stay away from politics, religion and tragedies in the news.');
  return R;
}

/* the rules a reader sees: suggestions with the team's changes on top, then the team's own. `team` is bb.rulebook:
   { over: { [id]: { off, strength, where, text, confirmed } }, own: [rule] } */
export function mergeRules(suggested = [], team = {}, comfort = null, name = 'the brand') {
  const over = team?.over || {}, out = [];
  if (comfort) for (const [k, ch] of Object.entries(CHOICES)) { const val = comfort[k]; if (!ch.say[val]) continue;
    out.push({ id: `choice-${k}`, group: ch.group, choice: k, value: val, strength: 'block', text: ch.say[val].replace(/\{n\}/g, name), src: 'team', confirmed: true }); }
  for (const r of suggested) { const o = over[r.id] || {}; out.push({ ...r, ...pick(o), off: !!o.off, confirmed: !!o.confirmed, src: o.text ? 'team' : r.src }); }
  for (const r of team?.own || []) { const o = over[r.id] || {}; out.push({ ...r, ...pick(o), off: !!o.off, src: r.src || 'team', confirmed: true }); }
  return out;
}
const pick = (o) => Object.fromEntries(['strength', 'where', 'text', 'words'].filter((k) => o[k] != null).map((k) => [k, o[k]]));

const STRENGTH = new Set(['block', 'warn']);
const cleanWhere = (w) => { if (!w) return null; const channels = (w.channels || []).filter((x) => CHANNELS[x]); const markets = (w.markets || []).map((x) => tidy(x, 30)).filter(Boolean).slice(0, 8);
  return channels.length || markets.length ? { ...(channels.length ? { channels } : {}), ...(markets.length ? { markets } : {}) } : null; };
const guessGroup = (t) => /\b(claim|cure|result|proof|study|clinic|approved|asci|fssai|fda|ftc|rera|before.and.after|guarantee)/i.test(t) ? 'claims'
  : /\b(ai\b|artificial|generated|synthetic|voice|avatar|deepfake|review|testimonial)/i.test(t) ? 'ai'
  : /\b(people|person|face|model|creator|customer|staff|child|kid|consent|cast|founder)/i.test(t) ? 'people' : 'safety';

/* a team change: one of { add: {text, group?, strength?, where?}, set: {id, strength?, where?, text?, off?, confirmed?}, drop: id } */
export function applyRuleChange(team = {}, ch = {}, idOf = () => `r${Date.now().toString(36)}`) {
  const t = { over: { ...(team.over || {}) }, own: [...(team.own || [])] };
  if (ch.add?.text) { const text = tidy(ch.add.text, 220); if (!t.own.some((r) => r.text.toLowerCase() === text.toLowerCase())) t.own.push({ id: idOf(), text, group: GROUPS[ch.add.group] ? ch.add.group : guessGroup(text), strength: STRENGTH.has(ch.add.strength) ? ch.add.strength : 'block', where: cleanWhere(ch.add.where), ...(ch.add.words?.length ? { words: ch.add.words.map((w) => tidy(w, 40)).filter(Boolean).slice(0, 20) } : {}), src: ch.add.src || 'team', at: new Date().toISOString() }); }
  if (ch.set?.id) { const o = { ...(t.over[ch.set.id] || {}) };
    if (STRENGTH.has(ch.set.strength)) o.strength = ch.set.strength;
    if ('where' in ch.set) o.where = cleanWhere(ch.set.where);
    if (ch.set.text) o.text = tidy(ch.set.text, 220);
    if ('off' in ch.set) o.off = !!ch.set.off;
    if ('confirmed' in ch.set) o.confirmed = !!ch.set.confirmed;
    t.over[ch.set.id] = o; }
  if (ch.drop) { if (t.own.some((r) => r.id === ch.drop)) t.own = t.own.filter((r) => r.id !== ch.drop); else t.over[ch.drop] = { ...(t.over[ch.drop] || {}), off: true }; }
  t.own = t.own.slice(-60);
  return t;
}

/* does a rule reach this piece of work? channel: ads | social | site | email | marketplaces (null = unknown: every rule counts) */
export const reaches = (r, { channel = null, market = null } = {}) => !r.off && (!channel || !r.where?.channels?.length || r.where.channels.includes(channel))
  && (!market || !r.where?.markets?.length || r.where.markets.some((m) => countryOf(m) === countryOf(market)));
const whereText = (r) => [r.where?.channels?.length ? r.where.channels.map((c) => CHANNELS[c]).join(', ') : null, r.where?.markets?.length ? r.where.markets.join(', ') : null].filter(Boolean).join(' in ');

/* the lines every writer and picture maker reads: musts, then things to avoid where possible */
export function ruleLines(rules = [], o = {}) {
  const on = rules.filter((r) => reaches(r, o));
  const fmt = (r) => `- ${r.text}${r.where && !o.channel ? ` (${whereText(r)} only)` : ''}`;
  const picks = on.filter((r) => r.choice), must = on.filter((r) => !r.choice && r.strength === 'block'), soft = on.filter((r) => !r.choice && r.strength !== 'block');
  return [picks.length ? `What the team allows: ${picks.map((r) => r.text).join(' ')}` : '', must.length ? `Rules you must follow:\n${must.map(fmt).join('\n')}` : '', soft.length ? `Rules to follow unless the brief says otherwise:\n${soft.map(fmt).join('\n')}` : ''].filter(Boolean).join('\n');
}
/* words a blocking rule forbids: they join the banned check every gate already runs (claims.js, remix filters) */
export const blockWords = (rules = []) => [...new Set(rules.filter((r) => !r.off && r.strength === 'block' && !r.where?.channels?.length).flatMap((r) => r.words || []))];
