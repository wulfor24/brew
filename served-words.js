// Words fixed in whatever the server sends, for every page and brand (QV round 2, 26 Oct). A name ending in s takes an apostrophe only:
// "Mana Projects’s" (6 times on the Brand Book), "Birla Estates's 30-day payment plan" (Deck titles), "Fix My Curls's 183-day campaign"
// (a card), "Projects's" (Plays). Those words were written by AI or saved before the poss() helpers; fixing them where they are served
// covers cards, stories, plays, the deck and the Brand Book's data at once, and saved words heal without a rewrite.
/* a capitalised name ending in s ("Projects", "Estates", "Curls", "PUMA SPORTS"), then 's or ’s */
const POSS = /\b([A-Z][\p{L}\p{N}.&-]*[sS])['’]s\b/gu;
export const possFix = (s) => (typeof s === 'string' && /[sS]['’]s\b/.test(s) ? s.replace(POSS, '$1’') : s);
/* a served body (JSON or text): the apostrophe never needs escaping in JSON, so the body is fixed as text */
export const possBody = (b) => possFix(b);
