// A storefront behind Shopify's password page (a development store, a store not launched yet), in one place for the reader,
// the rings, the scorecard and the Shopify app. No imports: health.js and the stages both read it.
export const CLOSED_WHY = 'the storefront is behind Shopify’s password page';
/* a page Shopify serves instead of the store: the /password page, or its form on the home page */
export const isPasswordPage = (r) => {
  try { if (new URL(r?.url || 'x:/').pathname.replace(/\/+$/, '') === '/password') return true; } catch {}
  return /<form[^>]+action=["'][^"']*\/password["']|template-password/i.test(String(r?.text || '').slice(0, 200000));
};
/* the line a ring or a scorecard row says for a part a closed store can't have yet */
export const closedLine = (what) => `${what}: not checked, ${CLOSED_WHY}. We check once the store opens`;
