// How a move's number is said to a person (QA FEED-QA-12): the build's moves are "Move 07"; weekly moves are numbered from 1001
// inside Brew (moves-cadence.js CADENCE_BASE) and read "Weekly move 11", never "Move 1011". The numbers on file never change:
// a card's src still says "Move 1011" for the code that reads it (moves.js numsOf); this is only what a person reads.
export const WEEKLY_BASE = 1000; /* = moves-cadence.js CADENCE_BASE */
export const isWeekly = (n) => Number.isFinite(+n) && +n > WEEKLY_BASE;
export const moveNum = (n) => (isWeekly(n) ? String(+n - WEEKLY_BASE) : String(n).padStart(2, '0'));
export const moveLabel = (n) => (isWeekly(n) ? `Weekly move ${+n - WEEKLY_BASE}` : `Move ${String(n).padStart(2, "0")}`);
/* any text a person reads: "Move 1011 · …" → "Weekly move 11 · …", "Moves 1011 and 1012" → "Weekly moves 11 and 12" */
const W = (all, at) => (at === 0 || /[.!?:·(\n]\s*$/.test(all.slice(Math.max(0, at - 3), at)) ? 'Weekly' : 'weekly'); /* a capital only where a sentence starts */
export const moveSay = (s) => (typeof s !== 'string' || !/\b1\d{3}\b/.test(s) ? s : s
  .replace(/\bMoves ((?:1\d{3})(?:(?:, | and | & )1\d{3})+)\b/gi, (m, list, at, all) => `${W(all, at)} moves ${list.replace(/1\d{3}/g, (x) => String(+x - WEEKLY_BASE))}`)
  .replace(/\bMove (1\d{3})\b/gi, (m, n, at, all) => (+n > WEEKLY_BASE ? `${W(all, at)} move ${+n - WEEKLY_BASE}` : m)));
