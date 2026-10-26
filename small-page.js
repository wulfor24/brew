import { PRODUCT_NAME } from './product-name.js';
// The small server pages (invite, access, email settings): one shell in Brew's look (dark, with light for light systems).
// h and p are escaped here; extra is trusted HTML from the caller; link is { href, label }.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MARK = '<svg viewBox="0 0 200 200" width="36" height="36" aria-hidden="true"><rect width="200" height="200" rx="56" fill="currentColor"/><path d="M62 38h26v62.5a50 50 0 1 1-26 43.8z" fill="var(--bg)"/><circle cx="112" cy="138" r="24" fill="currentColor"/></svg>';
export const smallPage = (h, p, { extra = '', link = null } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(PRODUCT_NAME)}</title><meta name="description" content="${esc(p)}"><meta name="robots" content="noindex"><link rel="icon" href="/assets/brew-mark.svg">
<style>:root{--bg:#0a0a0a;--card:#1b1b1b;--line:#262626;--fg:#fafafa;--fg-2:#a3a3a3;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f6f6;--card:#fff;--line:#e6e6e6;--fg:#0a0a0a;--fg-2:#505050;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.55 "SF Pro Text","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px 16px}
main{width:min(440px,100%);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px 24px;text-align:center}
main svg{color:var(--fg);margin-bottom:14px}h1{font-size:22px;line-height:28px;letter-spacing:-.015em;margin:0 0 8px}p{color:var(--fg-2);margin:0 0 6px}
a.btn{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:12px;background:var(--fg);color:var(--bg);text-decoration:none;font-weight:500}</style></head>
<body><main>${MARK}<h1>${esc(h)}</h1><p>${esc(p)}</p>${extra}${link ? `<a class="btn" href="${esc(link.href)}">${esc(link.label)}</a>` : ''}</main></body></html>`;
