// Jam chat: a question gets an answer, never a new version; "keep the photo" never makes one; an answer says only
// what the card, the move, the facts and the connected numbers say, and says so when they don't.
//
//   isQuestion(text)   a question to answer, not a change to make ("Can you make it shorter?" is a change)
//   photoAsk(text)     'keep' when the person wants the photo left alone, 'change' when they want a new one, else null
//   groundCheck(a, ev) the cheap check on an answer: numbers it quotes are in the evidence, and a claim about how
//                      something performs ("highest engagement", "converts best") needs performance numbers in the evidence
//   answerGrounded()   one small AI call (no package, no brief rewritten), then groundCheck; an answer that fails it is
//                      cut to what passes, plus a plain "I don't know that yet"

const EDIT = '(?:make|change|rewrite|re-?write|write|add|remove|drop|cut|shorten|lengthen|swap|replace|use|try|put|turn|redo|fix|update|move|translate|tighten|give|include|mention|lead|start|end|switch|keep|show|set|lower|raise|bump|trim|simplify|punch)';
const POLITE = new RegExp(`^(?:(?:hey|ok|okay|so|and|now|also|please)[,\\s]+)*(?:(?:can|could|would|will) (?:you|we)\\s+(?:please\\s+)?|please\\s+|let'?s\\s+|i want (?:you )?to\\s+|go ahead and\\s+)?${EDIT}\\b`, 'i');
const ASK = /^(?:(?:hey|ok|okay|so|and|but|also)[,\s]+)*(?:what|why|how|which|who|whom|whose|when|where|is|are|was|were|does|do|did|has|have|had|should|would|could|can|will|explain|tell me|any idea|i wonder)\b/i;

const SUGGEST = /^(?:(?:hey|ok|okay|so|and|but)[,\s]+)*(?:how|what) about\b|^(?:maybe|perhaps)\b|^(?:what if|why not) (?:we|you)\b/i; /* "how about a Hindi version?": a change asked politely */

export function isQuestion(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (SUGGEST.test(s)) return false;
  if (POLITE.test(s)) return false; /* "can you make it shorter?", "please add the price": a change, even with a question mark */
  return /\?\s*$/.test(s) || ASK.test(s);
}

const PIC = '(?:photos?|images?|pictures?|pics?|visuals?|shots?|creatives?)';
const KEEP = new RegExp([
  `\\b(?:keep|same|leave|retain|reuse|stick with)\\b[^.?!]{0,30}\\b${PIC}\\b`,
  `\\b(?:don'?t|do not|never|no need to|without)\\s+(?:change|changing|touch|touching|swap|swapping|replace|replacing|redo|redoing|make|making)\\b[^.?!]{0,20}\\b${PIC}\\b`,
  `\\bno new\\s+${PIC}\\b`,
  `\\b${PIC}\\b[^.?!]{0,20}\\b(?:stays?|as (?:it )?is|unchanged|is fine|is good|the same)\\b`,
  `\\b(?:words?|text|copy|caption|headline|wording)s?\\s+only\\b`, `\\bonly\\s+(?:change\\s+)?(?:the\\s+)?(?:words?|text|copy|caption|headline|wording)\\b`
].join('|'), 'i');
const CHANGE = new RegExp(`\\b(?:change|swap|replace|new|different|another|other|better|redo|fresh)\\b[^.?!,;]{0,40}\\b${PIC}\\b|\\b${PIC}\\b[^.?!,;]{0,20}\\b(?:change|swap|replace|redo)\\b`, 'i'); /* never across a comma: "photo, change the hook" is about the hook */

export function photoAsk(text) {
  const s = String(text || '');
  if (KEEP.test(s)) return 'keep'; /* "keep the same photo, change the words only": never a paid photo */
  return CHANGE.test(s) ? 'change' : null;
}

const PERF_CLAIM = /\b(?:highest|lowest|best|worst|top|most|least|strongest|weakest)\b[^.!?]{0,40}\b(?:engag\w*|perform\w*|convert\w*|conversions?|clicks?|ctr|roas|sales|results?|views|reach|returns?|response)\b|\b(?:outperform\w*|performs? (?:best|better|well|worse)|converts? (?:best|better|well)|(?:gets?|drives?|got|drove) (?:the )?(?:most|more|higher|better) (?:engagement|clicks|sales|views|conversions))\b/i;
const PERF_DATA = /\b(?:roas|ctr|click[- ]?through|clicks?|conversion rate|conversions?|engagement|impressions|reach|purchases|orders|revenue|views|cost per|cpa|cpc|spend)\b[^\n]{0,60}\d|\d[\d,.]*\s*%?\s*(?:roas|ctr|clicks?|conversions?|impressions|views|orders|purchases)\b/i;
const numsOf = (s) => (String(s || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, '')).filter((x) => x.length > 0);
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+/).filter(Boolean);

/** { ok, issues: [{ kind: 'number' | 'performance', text }] } */
export function groundCheck(answer, evidence) {
  const ev = String(evidence || ''), evNums = new Set(numsOf(ev)), hasPerf = PERF_DATA.test(ev), issues = [];
  for (const s of sentences(answer)) {
    const bad = numsOf(s).filter((n) => +n >= 10 && !evNums.has(n) && !/^(19|20)\d\d$/.test(n)); /* small counts (3 steps) and years pass */
    if (bad.length) issues.push({ kind: 'number', text: s, nums: bad });
    else if (PERF_CLAIM.test(s) && !hasPerf) issues.push({ kind: 'performance', text: s });
  }
  return { ok: !issues.length, issues };
}

export const ANSWER_SCHEMA = { type: 'object', required: ['answer', 'known'], properties: {
  answer: { type: 'string', description: 'Under 60 words, plain words, lead with the answer. Only what the evidence says; when it does not say, say "I don\'t know that yet" and what would tell us.' },
  known: { type: 'boolean', description: 'False when the evidence does not answer the question' } } };

export const UNKNOWN = 'I don’t know that yet: Brew has no results for this, so nothing shows how it performs. Connected ad and analytics accounts would tell us once it runs.';

/** ai(prompt, schema, max, tag) → json. evidence: the card, the package or brief, the facts and the connected numbers. */
export async function answerGrounded({ ai, question, evidence, history = [], who = 'Brew' }) {
  const prompt = [`You are ${who}, answering a question in a jam about one card. Answer from the evidence below only.`,
    `Evidence:\n"""\n${String(evidence || '').slice(0, 9000)}\n"""`,
    history.length ? `The conversation so far:\n${history.slice(-6).join('\n')}` : '',
    `Question: "${String(question).slice(0, 1500)}"`,
    'Rules: quote numbers only from the evidence, exactly. Never say how something performs, engages, converts or sells (best, highest, most) unless the evidence has the numbers that show it. If the evidence does not answer it, say "I don\'t know that yet" and name what would tell us. Do not change anything: this is only an answer.'].filter(Boolean).join('\n\n');
  const j = await ai(prompt, ANSWER_SCHEMA, 700, 'jam_answer');
  const raw = String(j?.answer || '').trim();
  if (!raw) return { answer: UNKNOWN, known: false, checked: false };
  const g = groundCheck(raw, evidence);
  if (g.ok) return { answer: raw, known: j.known !== false, checked: true };
  /* the answer said something the evidence doesn't: keep what it backs, then say plainly what isn't known */
  const badSet = new Set(g.issues.map((x) => x.text));
  const kept = sentences(raw).filter((s) => !badSet.has(s)).join(' ').trim();
  return { answer: `${kept ? kept + ' ' : ''}${UNKNOWN}`, known: false, checked: true, cut: g.issues };
}
