// Who may press a paid Make (a Sloosh final, a Studio make, a slide, a video render). While Brew runs with its first design partners
// (MAKE_MODE=partner, set in deploy.sh and promote.sh) nobody is charged, so a brand's own people never see a price or start paid work:
// "Our team makes it" sends the brief to us, and staff (FULL_ACCESS_DOMAINS / ADMIN_EMAILS) make it from the same jam. Arvind, 28 Oct.
// The free first drafts Brew makes on its own are not touched. MAKE_MODE=paid (or unset) is the priced, quote-first flow as before.
import { isFullAccess } from './auth.js';

export const MAKE_MODE = () => (String(process.env.MAKE_MODE || '').toLowerCase() === 'partner' ? 'partner' : 'paid');
/* email: whoever is signed in. Staff always make (they fulfil the partners' asks); everyone else follows the mode */
export const makeModeOf = (email) => (email && isFullAccess(email) ? 'paid' : MAKE_MODE());
/* what the page shows: in partner mode everyone sees the partner bar, staff too (Param, 28 Oct: a demo on a staff login still showed
   "Make it · about ₹14"). staffMake: this viewer may still make, from the ··· menu only */
export const pageModeOf = (email) => ({ makeMode: MAKE_MODE(), ...(MAKE_MODE() === 'partner' && makeModeOf(email) === 'paid' ? { staffMake: true } : {}) });
export const PARTNER_NOTE = 'Free for initial partners';
export const partnerNo = () => ({ status: 409, needsTeam: true, error: 'Our team makes this one for you, free for initial partners: press “Our team makes it” and we send it back here.' });
