// Paid makes (a Sloosh final, a Studio make, a slide, a video render) while Brew runs with its first design partners (MAKE_MODE=partner,
// set in deploy.sh and tools/prod-env.sh). Param, 28 Oct: for any brand we onboard, no price is shown to anyone, and anyone may press
// Make. One generous, silent budget guards against misuse: MAKE_DAY_CAP_USD (default $100) across every brand per UTC day, counted
// on the shared Postgres counters (counters.js) so every instance sees one total. Over it, a make says to try again tomorrow, never
// a price or a cap. MAKE_MODE=paid (or unset) is the priced, quote-first flow as before. Free first drafts are not counted here.
export const MAKE_MODE = () => (String(process.env.MAKE_MODE || '').toLowerCase() === 'partner' ? 'partner' : 'paid');
export const pageModeOf = () => ({ makeMode: MAKE_MODE() }); /* what the page shows: in partner mode, no price for anyone */
export const CREDIT_USD = 0.09; /* one Sloosh credit, as jam2/sloosh-studio.js prices it */
let C = null;
export const useCounters = (counters) => { C = counters || null; };
export const DAY_CAP_USD = () => +process.env.MAKE_DAY_CAP_USD || 100;
export const spentToday = () => (C ? C.total('make', 'usd') : 0);
/* in partner mode a make over today's budget is refused; in paid mode the quote is the guard, as before */
export const overCap = () => MAKE_MODE() === 'partner' && spentToday() >= DAY_CAP_USD();
export const bookMake = (usd) => { const n = +usd || 0; if (C && n > 0) C.add('make', 'usd', n); };
export const capNo = () => ({ status: 429, capped: true, error: 'We’ve made a lot today. Try again tomorrow.' });
