// Loaded only on Brew pages opened inside the Shopify admin (shopify-app.js embedHtml), right after App Bridge.
// App Bridge puts the session token on fetch; this covers what fetch doesn't:
//   - EventSource (the read's progress stream) can't send a header, so it carries the token in its query
//   - every Brew link and page keeps ?embedded=1&shop&host, so the next page knows it is inside the admin
//   - sign-ins that refuse a frame (Google, Meta, Slack) and other sites open in a new tab: a signed hop for Brew's own
//     sign-in routes, the plain address for everything else
//   - a brand's PDFs (/b/<slug>/pdf/…) are its team's, and a link or new tab sends no header: their links carry a fresh token
(() => {
  if (!window.shopify) return;
  /* a store not open yet (closed-gate.js) asks who is looking before it shows its page: a frame's own load can't send the
     session token, so the address carries it once (id_token, a minute's life, fresh=1 so it is asked only once) */
  /* this script runs in <head>, before the page's body: the "Opening Brew…" box is looked for once the page is parsed */
  const renewNow = () => { const renew = document.getElementById('brew-renew'); if (!renew) return;
    shopify.idToken().then((t) => { const u = new URL(location.href); u.searchParams.set('id_token', t); u.searchParams.set('fresh', '1'); location.replace(u.pathname + u.search + u.hash); })
      .catch(() => { renew.textContent = 'That didn’t open. Reload the page to try again.'; }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renewNow, { once: true }); else renewNow();
  /* the page has loaded as the person: the token leaves the address, so a reload (after it expires) asks again */
  try { const u = new URL(location.href); if (u.searchParams.has('id_token') || u.searchParams.has('fresh')) { u.searchParams.delete('id_token'); u.searchParams.delete('fresh'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) {}
  const q = new URLSearchParams(location.search), keep = {};
  for (const n of ['shop', 'host']) if (q.get(n)) keep[n] = q.get(n);
  keep.embedded = '1';
  try { const s = JSON.parse(sessionStorage.getItem('brew-embed') || '{}'); for (const k of ['shop', 'host']) keep[k] ||= s[k]; sessionStorage.setItem('brew-embed', JSON.stringify(keep)); } catch (e) {}
  const withKeep = (href) => { try { const u = new URL(href, location.href); if (u.origin !== location.origin || /^\/(api|shopify|gen|research|b)\//.test(u.pathname)) return href;
    for (const [k, v] of Object.entries(keep)) if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); return u.pathname + u.search + u.hash; } catch (e) { return href; } };
  /* the page's own address keeps them too (a reload, or a link built from location) */
  try { const here = withKeep(location.href); if (here !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', here); } catch (e) {}

  let tok = null, tokAt = 0;
  const refresh = () => shopify.idToken().then((t) => { tok = t; tokAt = Date.now(); }).catch(() => {});
  refresh(); setInterval(refresh, 40e3);
  const ES = window.EventSource;
  if (ES) window.EventSource = function (url, init) { try { const u = new URL(url, location.href); if (u.origin === location.origin && tok) u.searchParams.set('id_token', tok); url = u.href; } catch (e) {} return new ES(url, init); };
  if (ES) window.EventSource.prototype = ES.prototype;

  const hop = async (next) => { const w = window.open('', '_blank'); /* opened inside the tap, so no popup blocker */
    try { const r = await fetch('/shopify/api/hop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ next }) }); const j = await r.json();
      if (j.url && w) w.location = j.url; else { w?.close(); alert(j.error || 'That didn’t open. Try again.'); } } catch (e) { w?.close(); } };
  /* a PDF link (Open the PDF, the move's PDF icon, Download the PDF): server.js teamRead asks who is looking, and a link sends
     no header, so the link itself carries the session token (a minute's life). It is set as the link is pressed, right-clicked
     (Open in new tab) or middle-clicked; a token older than 45 s is asked for again first, in a tab opened inside the tap */
  const pdfOf = (e) => { const a = e.target.closest?.('a[href]'); if (!a) return null; let u; try { u = new URL(a.getAttribute('href'), location.href); } catch (er) { return null; }
    return u.origin === location.origin && /^\/b\/[a-z0-9-]+\/pdf\//.test(u.pathname) ? { a, u } : null; };
  const withTok = (u, t) => { u.searchParams.set('id_token', t); return u.pathname + u.search + u.hash; };
  for (const ev of ['pointerdown', 'contextmenu', 'auxclick']) document.addEventListener(ev, (e) => { const l = pdfOf(e); if (l && tok) l.a.setAttribute('href', withTok(l.u, tok)); }, true);
  const pdfClick = (e, { a, u }) => { if (tok && Date.now() - tokAt < 45e3) return a.setAttribute('href', withTok(u, tok));
    e.preventDefault(); const w = window.open('', '_blank'); /* opened inside the tap, so no popup blocker */
    shopify.idToken().then((t) => { tok = t; tokAt = Date.now(); const h = withTok(u, t); a.setAttribute('href', h); if (w) w.location = h; else alert('That didn’t open. Try again.'); })
      .catch(() => { w?.close(); alert('That didn’t open. Try again.'); }); };
  const outside = (u) => /^\/(auth|connect)\//.test(u.pathname) && u.pathname !== '/connect/shopify/start';
  document.addEventListener('click', (e) => {
    const go = e.target.closest?.('button.go[data-next]'); if (go) { e.preventDefault(); return hop(go.dataset.next); }
    const pdf = !e.defaultPrevented && pdfOf(e); if (pdf) return pdfClick(e, pdf);
    const a = e.target.closest?.('a[href]'); if (!a || e.defaultPrevented || a.target === '_blank' || a.hasAttribute('download')) return;
    let u; try { u = new URL(a.getAttribute('href'), location.href); } catch (er) { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.origin !== location.origin) { e.preventDefault(); window.open(u.href, '_blank', 'noopener'); return; }
    if (outside(u)) { e.preventDefault(); return hop(u.pathname + u.search); }
    const k = withKeep(u.href); if (k !== u.href && k !== a.getAttribute('href')) a.setAttribute('href', k);
  }, true);
})();
