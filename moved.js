// Brands whose home is production now (Phase 6). Only staging reads MOVED_TO_PROD (comma list of slugs): there a moved
// brand's own people are sent to production (staff, the full-access domains and admins, can still open it here), and the
// background work that spends money or writes to the brand's people (builds, rewrites, research, digests, reminders) stops,
// so the two sites never pay twice or email a partner twice. Its connectors keep reading on both (Arata stays connected).
export const movedList = () => (process.env.ENV === 'production' ? [] : String(process.env.MOVED_TO_PROD || '').toLowerCase().split(/[,\s]+/).filter(Boolean));
export const movedAway = (slug) => !!slug && movedList().includes(String(slug).toLowerCase());
export const prodUrl = () => String(process.env.PROD_URL || 'https://feed.joinsquareup.com').replace(/\/+$/, '');
/* background loops: the brands they may still work on here */
export const stayHere = (list) => (movedList().length ? list.filter((b) => !movedAway(b?.slug ?? b)) : list);
