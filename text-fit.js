// Small, pure wording rules shared by the server: sentence case for titles, version labels and the one-line ship text.

/* ---------- sentence case ----------
   Titles written from skill names arrive Title Cased ("Signup And Account Creation"). Only a string that is plainly
   Title Cased is touched (every word capitalised, small joining words too, or 3+ words all capitalised). Kept as they
   are: the first word, acronyms (UNO, AI, SEO), words with digits or inner capitals (iPhone, 4K), the brand, product
   and rival names given in `keep`, and well-known proper nouns (platforms, places, days, months). */
const SMALL = new Set(['and', 'or', 'of', 'the', 'for', 'to', 'in', 'on', 'with', 'a', 'an', 'at', 'by', 'from', 'vs', 'into', 'per', 'your', 'our']);
const PROPER = new Set(['Instagram', 'Facebook', 'Meta', 'Google', 'YouTube', 'TikTok', 'WhatsApp', 'Shopify', 'Klaviyo', 'Amazon', 'Flipkart', 'Nykaa', 'Myntra', 'Reddit', 'Quora', 'Pinterest', 'LinkedIn', 'ChatGPT', 'Gemini', 'Perplexity', 'Claude',
  'India', 'Indian', 'Hindi', 'Hinglish', 'English', 'US', 'UK', 'America', 'American', 'Europe', 'Diwali', 'Christmas', 'Black', 'Friday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Brew', 'GA4', 'Stories', 'Reels']);
const ACRO = new Set(['seo', 'ai', 'cro', 'aeo', 'geo', 'sms', 'aso', 'pr', 'ugc', 'sku', 'cta', 'roas', 'cpa', 'ltv', 'aov', 'b2b', 'd2c', 'dtc', 'faq', 'ppc', 'rto', 'cod', 'llms', 'ga4']);
const isTitleCased = (words) => {
  const ws = words.filter((w) => /^[A-Za-z]/.test(w));
  if (ws.length < 3) return false;
  const cap = (w) => /^[A-Z]/.test(w);
  const smallCapped = ws.slice(1).some((w) => SMALL.has(w.toLowerCase()) && cap(w));
  const big = ws.filter((w) => !SMALL.has(w.toLowerCase()));
  const smallLower = ws.slice(1).some((w) => SMALL.has(w.toLowerCase()) && !cap(w)); // "Comet vs Gully Labs": cased on purpose
  return big.every(cap) && !smallLower && (smallCapped || big.length >= 3);
};
export function sentenceCase(s, keep = [], { force = false } = {}) { // force: the source is known to be Title Cased (skill names)
  const str = String(s ?? ''); if (!str.trim()) return str;
  const parts = str.split(/(\s+)/);
  if (!force && !isTitleCased(str.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean))) return str; // a note in brackets doesn't count
  // names to keep, word by word ("Wool Runner", "Gully Labs")
  const K = new Set(); for (const k of keep || []) String(k || '').split(/\s+/).forEach((w) => { const x = w.replace(/[^\p{L}\p{N}'’-]/gu, ''); if (x && /^[A-Z]/.test(x)) K.add(x); });
  let first = true;
  return parts.map((p) => {
    if (!p.trim()) return p;
    const core = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (ACRO.has(core.toLowerCase())) { first = false; return p.replace(core, core.toUpperCase()); } // "Seo" from a slug is SEO
    if (first) { first = false; return p; }
    if (!core || !/^[A-Z]/.test(core)) return p;
    if (/\d/.test(core) || /^[A-Z0-9&]+$/.test(core) && core.length > 1 || /[a-z][A-Z]/.test(core) || K.has(core) || PROPER.has(core)) return p;
    return p.replace(core, core[0].toLowerCase() + core.slice(1));
  }).join('');
}

/* ---------- who ships it, in plain words ---------- */
export const shipLine = ({ team, target }) => {
  const on = target && target !== 'Brew' ? ` on ${target}` : '';
  return team ? `${team} makes the change${on}. You get a note here when it’s live.`
    : `The ShopOS team makes the change${on} with you. You get a note here when it’s live.`;
};

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

/* ---------- version labels ----------
   A version list shows a short name of 2 to 4 words ("As a thread", "Shorter", "Hook: question"), never the raw
   chat message ("can we post 2, 3, 4,5, an…"). The AI names the version when it makes it; this is the rule-based
   name for every other version (knobs, variations, undo, offline, and versions made before labels existed). */
const VL_RULES = [
  [/\b(thread|replies|reply chain|as a series|split (it )?into)\b/i, 'As a thread'],
  [/\bcarousel\b/i, 'As a carousel'],
  [/\b(shorter|shorten|trim|tighter|cut it down|less words|fewer words|too long)\b/i, 'Shorter'],
  [/\b(longer|expand|more detail|add more)\b/i, 'Longer'],
  [/\bhinglish\b/i, 'In Hinglish'], [/\bhindi\b/i, 'In Hindi'], [/\bspanish\b/i, 'In Spanish'],
  [/\b(downside|honest|trade-?off|caveat)\b/i, 'Honest downside'],
  [/\b(question first|answer the question|first line|lead with the answer)\b/i, 'Answer first'],
  [/\b(less like an ad|less salesy|less sales|not salesy|softer sell)\b/i, 'Less like an ad'],
  [/\b(casual|friendlier|warmer|relaxed)\b/i, 'More casual'],
  [/\b(formal|professional)\b/i, 'More formal'],
  [/\b(funny|humou?r|playful|witty)\b/i, 'Lighter tone'],
  [/\b(punchier|bolder|stronger)\b/i, 'Punchier'],
  [/\b(price|cost)\b.*\b(first|up front|upfront|top|lead)\b|\b(lead|open|start) with (the )?price\b/i, 'Price up front'],
  [/\bno (emoji|emojis)\b|\bremove (the )?emoji/i, 'No emoji'],
  [/\bemoji/i, 'With emoji'],
  [/\bhashtags?\b/i, 'Hashtags changed'],
  [/\b(cta|call to action|button)\b/i, 'New call to action'],
  [/\b(hook|opening line|first line|opener)\b/i, 'New hook'],
  [/\b(headline|title)\b/i, 'New headline'],
  [/\b(photo|image|picture|visual)\b/i, 'New photo'],
  [/\b(video|reel|footage)\b/i, 'New video idea'],
  [/\breview|testimonial|quote\b/i, 'With a review'],
];
const VL_FILLER = /^(?:(?:hey|hi|ok(?:ay)?|so|pls|please|also|and|but|now|then|just|maybe|could|can|would|will|you|we|i|let'?s|lets|let us|make|it|this|that|the|a|an|try|do|please|want|wanna|need|to|should|be|more|bit|little|version|v\d+)\b[\s,.:;!?-]*)+/i;
const vlWords = (s, n = 4) => { const ws = String(s).replace(/https?:\/\/\S+/g, '').replace(/[“”"'`()[\]{}]/g, '').replace(/[,.;:!?]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = ws.slice(0, n).join(' '); return out ? out[0].toUpperCase() + out.slice(1) : ''; };
export function versionLabel(reason = '', { first = false } = {}) {
  const offline = /\(AI offline\)/i.test(String(reason || '')); // nothing was rewritten: say so, never name the ask
  let r = String(reason || '').replace(/\s*\(AI offline\)/i, '').trim();
  if (!r || first || /^remix\b/i.test(r) || /^the original card$/i.test(r)) return 'First draft';
  if (/^undo\b/i.test(r)) return 'Undone';
  if (/^variation [A-C]\b/i.test(r)) { const a = r.replace(/^variation [A-C]:?\s*/i, ''); return a && !/^a different cut$/i.test(a) ? vlWords(a, 4) : `Variation ${r.match(/^variation ([A-C])/i)[1].toUpperCase()}`; }
  if (/^another version/i.test(r)) { const a = r.replace(/^another version:?\s*/i, ''); return a ? vlWords(a, 4) : 'Another take'; }
  if (/^new creative\b/i.test(r)) return 'New photo';
  if (/^photos for \d+/i.test(r)) return vlWords(r, 4);
  if (/^(your edit|new image brief|jam version|trimmed to a \+20% step)/i.test(r)) return vlWords(r.replace(/ so .*/i, ''), 4);
  const knob = r.match(/^(?:knob:\s*)?([A-Z][\w ]{1,18}):\s*(.{1,30})$/); // "Hook: Question", "Language: Hindi"
  if (knob) return `${knob[1].trim()}: ${knob[2].trim()}`.split(/\s+/).slice(0, 4).join(' ');
  if (offline) return 'Not rewritten';
  for (const [re, label] of VL_RULES) if (re.test(r)) return label;
  const rest = r.replace(VL_FILLER, '').trim();
  return vlWords(rest || r, 4) || 'Edited';
}

/* "Meta ads" → "Meta ad", "markup fixes" → "markup fix", "Instagram Stories" → "Instagram Story": the asset said as one */
export const one = (x) => String(x || '').replace(/(\S+)$/, (w) => (/ies$/i.test(w) ? w.slice(0, -3) + 'y' : /(?:ch|sh|x|ss)es$/i.test(w) ? w.slice(0, -2) : /[^s]s$/i.test(w) ? w.slice(0, -1) : w));
/* a count of options in saved words ("Write 3 new hooks per winner", "Draft the two new hook variants") said as one: cards and
   plans written before the one-version rule heal wherever they are read */
const COUNT = /\b(?:the\s+)?(?:two|three|four|five|six|[2-6])\s+(new\s+|more\s+|different\s+|fresh\s+)?((?:[a-z-]+\s+)?)(hooks?|versions?|variants?|variations?|cuts?|options?|ads?|scripts?|videos?|reels?|posts?|emails?|messages?|headlines?|captions?|creatives?|angles?|takes?|concepts?|carousels?|statics?)\b/gi;
export const oneOf = (x) => String(x ?? '').replace(COUNT, (m, nw, mid, noun, at) => `${at === 0 ? "One" : "one"} ${nw || ''}${mid}${one(noun)}`);
/* the card's own prose (title, line, how-steps): only counts of creative takes become one ("three hook variants", "Make three reel
   scripts", "Two fresh versions of each winner"); counts that are the plan itself stay ("Pack of 2", "three featured options",
   "8 ads", "two posts a week") */
const TAKES = /(?<!\b(?:of|pack|set|buy|get)\s)\b(?:two|three|four|five|six|[2-6])\s+(new\s+|more\s+|different\s+|fresh\s+)?((?:hook|reel|video|ad|caption|headline|creative)\s+)?(hooks|versions|variants|variations|cuts|scripts|takes|concepts|angles)\b/gi;
export const oneTake = (x) => String(x ?? '').replace(TAKES, (m, nw, mid, noun, at) => `${at === 0 || /[.!?]\s*$/.test(String(x).slice(0, at)) ? 'One' : 'one'} ${nw || ''}${mid || ''}${one(noun)}`);
