// The plain pages every site needs: Privacy, Terms (both marked as the design-partner preview's policy) and a real
// "page not found". Same look as small-page.js (dark, with light for light systems), readable without any script.
import { smallPage } from './small-page.js';

export const CONTACT = 'hello@joinsquareup.com';
const UPDATED = '19 October 2026';

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Brew</title><link rel="icon" href="/assets/brew-mark.svg">
<style>:root{--bg:#0a0a0a;--card:#1b1b1b;--line:#262626;--fg:#fafafa;--fg-2:#a3a3a3;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f6f6;--card:#fff;--line:#e6e6e6;--fg:#0a0a0a;--fg-2:#505050;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "SF Pro Text","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px 16px 48px}
main{width:min(680px,100%);margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px 24px}
h1{font-size:24px;line-height:30px;letter-spacing:-.015em;margin:0 0 6px}h2{font-size:16px;margin:22px 0 4px}p,li{color:var(--fg-2);margin:0 0 8px}ul{padding-left:20px;margin:0 0 8px}
.tag{display:inline-block;margin:0 0 14px;padding:2px 10px;border:1px dashed var(--line);border-radius:999px;font-size:12.5px;color:var(--fg-2)}
a{color:var(--fg)}nav{display:flex;gap:16px;margin-top:24px;padding-top:14px;border-top:1px solid var(--line);font-size:14px}</style></head>
<body><main>${body}<nav><a href="/">Brew</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:${CONTACT}">${CONTACT}</a></nav></main></body></html>`;

export const privacyPage = () => shell('Privacy', `<h1>Privacy</h1><span class="tag">Preview policy · ${UPDATED}</span>
<p>Brew is in a design-partner preview. This page says plainly what Brew does today. A full policy comes before Brew opens to everyone.</p>
<h2>What Brew reads</h2>
<ul><li>Your store’s public website: pages, products and prices.</li><li>Public reviews of your brand.</li><li>Your rivals’ public websites, and the ads you and they run in Meta’s public Ad Library.</li><li>What AI assistants answer when shoppers ask about your category.</li></ul>
<h2>Accounts you connect</h2>
<p>Only if your team connects them (for example Shopify, Meta Ads, Google Analytics, Klaviyo). Access is read-only: Brew never changes your accounts. Keys are stored encrypted, and only your team sees what they show. Slack posts only to the channel you pick.</p>
<h2>Signing in</h2>
<p>You sign in with Google. Brew gets your name, email address and photo, nothing else.</p>
<h2>Where it is kept</h2>
<p>Brew runs on Google Cloud, and your brand’s data is stored there. AI models on Google Cloud write the moves and drafts from what Brew read. Some public data (search results, ads, social posts) is fetched through data providers. A final image or video your team asks for may be made by Sloosh, ShopOS’s studio. Brew’s emails to your team are sent through Resend.</p>
<h2>Who sees what</h2>
<p>Your team sees your feed, moves, jams and connected numbers. Anyone else sees only what is public.</p>
<h2>Deleting your data</h2>
<p>Email <a href="mailto:${CONTACT}?subject=Delete%20my%20data">${CONTACT}</a> from your work email and name your store’s address. We delete the brand’s read, moves, jams and connected keys, and reply when it is done.</p>`);

export const termsPage = () => shell('Terms', `<h1>Terms</h1><span class="tag">Preview terms · ${UPDATED}</span>
<p>Brew is in a design-partner preview. These short terms cover the preview. Full terms come before Brew opens to everyone.</p>
<h2>Use it on your own store</h2>
<p>Run Brew on your own store, or one you work on. Your team claims the workspace; others only see what is public.</p>
<h2>It is a preview</h2>
<p>Brew is free during the preview, is offered as it is, and can change or stop. Things may break; tell us when they do.</p>
<h2>Check before you act</h2>
<p>Brew’s moves, cards and drafts are suggestions. Every number shows its source, but sources change: check before you spend or publish.</p>
<h2>Yours stays yours</h2>
<p>Your content and data stay yours. What Brew makes for you is yours to use.</p>
<h2>Fair use</h2>
<p>Don’t use Brew to harm a site, a person or a brand. We may stop a read or remove access that breaks this.</p>
<h2>Questions</h2>
<p>Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`);

export const notFoundPage = () => smallPage('We couldn’t find that page', 'The link may be old, or the address has a typo.', { link: { href: '/', label: 'Go to Brew' } });

/* the pages the server answers itself, by path */
export const LEGAL = { '/privacy': privacyPage, '/terms': termsPage };

/* what a path that no route took is (server.js serve, the last step): an unknown /api/ path is a JSON 404, never the landing;
   "/" is the landing; /privacy and /terms are plain pages; "/<slug>" is a brand page when that brand exists (the caller
   checks), and a slug typed in capitals goes to its lower-case page; anything else is a real 404 page */
export function pageOf(pathname = '/') {
  const p = String(pathname || '/');
  if (p === '/api' || p.startsWith('/api/')) return { kind: 'api' };
  if (p === '/' || p === '/index.html') return { kind: 'landing' };
  const lp = p.replace(/\/+$/, '') || '/';
  if (LEGAL[lp.toLowerCase()]) return { kind: 'legal', page: lp.toLowerCase() };
  const m = /^\/([A-Za-z0-9-]+)\/?$/.exec(p);
  if (m) return m[1] === m[1].toLowerCase() ? { kind: 'slug', slug: m[1] } : { kind: 'slug', slug: m[1].toLowerCase(), redirect: true };
  return { kind: 'missing' };
}
