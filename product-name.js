/* The product's public name, in one place. The name is not picked yet: every email, page, notification, Slack post,
   PDF and listing that has to name the product reads it from here (the server imports it; the browser reads
   globalThis.PRODUCT_NAME, set by productNameScript() in the page head), so the rename is this one line.
   Copy that can say "we" or "our team" instead of naming the product does so. Code names (routes, keys, env vars,
   cookies, file names, the "brew" kind in saved data) are not this and stay as they are. */
export const PRODUCT_NAME = 'Brew';

/* the inline script a served page puts first in its head, so every client script can read the name */
export const productNameScript = () => `<script>globalThis.PRODUCT_NAME=${JSON.stringify(PRODUCT_NAME).replace(/</g, '\\u003c')}</script>`;
