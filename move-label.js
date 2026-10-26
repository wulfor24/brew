// How a move's number is said to a person (QA FEED-QA-12): the build's moves are "Move 07"; weekly moves are numbered from 1001
// inside Brew (moves-cadence.js CADENCE_BASE) and read "Weekly move 11", never "Move 1011". The numbers on file never change:
// a card's src still says "Move 1011" for the code that reads it (moves.js numsOf); this is only what a person reads.
export const WEEKLY_BASE = 1000; /* = moves-cadence.js CADENCE_BASE */
export const isWeekly = (n) => Number.isFinite(+n) && +n > WEEKLY_BASE;
/* timely moves (a festival, a reply that reached its threshold: moves-engine.js dynamicSpecs) are numbered 100–999 by a hash of
   their id; "Move 966" beside Move 01–65 reads like a missing 900, so a person reads "Timely move" with no number (final QA pass 19 Oct) */
export const isTimely = (n) => Number.isInteger(+n) && +n >= 100 && +n <= 999;
export const moveNum = (n) => (isWeekly(n) ? String(+n - WEEKLY_BASE) : isTimely(n) ? 'T' : String(n).padStart(2, '0'));
export const moveLabel = (n) => (isWeekly(n) ? `Weekly play ${+n - WEEKLY_BASE}` : isTimely(n) ? 'Timely play' : `Play ${String(n).padStart(2, "0")}`); /* a person reads Plays (23 Oct QA 3.10); the files and ids keep move */
/* any text a person reads: "Move 1011 · …" → "Weekly move 11 · …", "Moves 1011 and 1012" → "Weekly moves 11 and 12", "MOVE 966" → "Timely move" */
const W = (all, at, w = 'Weekly') => (at === 0 || /[.!?:·(\n]\s*$/.test(all.slice(Math.max(0, at - 3), at)) ? w : w.toLowerCase()); /* a capital only where a sentence starts */
const one = (n, all, at) => (isWeekly(n) ? `${W(all, at)} play ${+n - WEEKLY_BASE}` : isTimely(n) ? `${W(all, at, 'Timely')} play` : null);
export const moveSay = (s) => (typeof s !== 'string' || !/\bMoves?\b[\d ,&and]*\b\d{3,4}\b/i.test(s) ? s : s
  .replace(/\bMoves ((?:1\d{3})(?:(?:, | and | & )1\d{3})+)\b/gi, (m, list, at, all) => `${W(all, at)} plays ${list.replace(/1\d{3}/g, (x) => String(+x - WEEKLY_BASE))}`)
  .replace(/\bMoves (\d{1,4}(?:(?:, | and | & )\d{1,4})+)\b/gi, (m, list, at, all) => (!/\b\d{3,4}\b/.test(list) ? m : list.replace(/\d{1,4}/g, (x, i) => { const l = one(x, all, i ? 1 : at) || `${W(all, i ? 1 : at, 'Play')} ${String(x).padStart(2, '0')}`; return i ? l[0].toLowerCase() + l.slice(1) : l; }))) /* a mixed list: each move as it reads alone ("Move 05 and timely move") */
  .replace(/\bMove (\d{3,4})\b/gi, (m, n, at, all) => one(n, all, at) || m));
/* a source line a person reads ("Move 08 · Ads", "Moves 3 and 4"): moves are called Plays (23 Oct QA 3.10). Only lines that name a
   plan item by its number, never a card's own words, where "Move 5 ads" is an instruction */
export const playSrc = (s) => (typeof s !== 'string' ? s : moveSay(s).replace(/\b(Weekly |Timely )?(M|m)oves(?= \d| and \d)/g, (m, w = '', c) => `${w}${c === 'M' ? 'P' : 'p'}lays`).replace(/\b(Weekly |Timely )?(M|m)ove(?= \d{1,2}\b| T\b| ·|$)/g, (m, w = '', c) => `${w}${c === 'M' ? 'P' : 'p'}lay`));
