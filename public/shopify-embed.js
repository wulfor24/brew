// Loaded only on Brew pages opened inside the Shopify admin (shopify-app.js embedHtml), right after App Bridge.
// App Bridge puts the session token on fetch; this covers what fetch doesn't:
//   - EventSource (the read's progress stream) can't send a header, so it carries the token in its query
//   - every Brew link and page keeps ?embedded=1&shop&host, so the next page knows it is inside the admin
//   - sign-ins that refuse a frame (Google, Meta, Slack) and other sites open in a new tab: a signed hop for Brew's own
//     sign-in routes, the plain address for everything else
(() => {
  if (!window.shopify) return;
  const q = new URLSearchParams(location.search), keep = {};
  for (const n of ['shop', 'host']) if (q.get(n)) keep[n] = q.get(n);
  keep.embedded = '1';
  try { const s = JSON.parse(sessionStorage.getItem('brew-embed') || '{}'); for (const k of ['shop', 'host']) keep[k] ||= s[k]; sessionStorage.setItem('brew-embed', JSON.stringify(keep)); } catch (e) {}
  const withKeep = (href) => { try { const u = new URL(href, location.href); if (u.origin !== location.origin || /^\/(api|shopify|gen|research|b)\//.test(u.pathname)) return href;
    for (const [k, v] of Object.entries(keep)) if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); return u.pathname + u.search + u.hash; } catch (e) { return href; } };
  /* the page's own address keeps them too (a reload, or a link built from location) */
  try { const here = withKeep(location.href); if (here !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', here); } catch (e) {}

  let tok = null;
  const refresh = () => shopify.idToken().then((t) => { tok = t; }).catch(() => {});
  refresh(); setInterval(refresh, 40e3);
  const ES = window.EventSource;
  if (ES) window.EventSource = function (url, init) { try { const u = new URL(url, location.href); if (u.origin === location.origin && tok) u.searchParams.set('id_token', tok); url = u.href; } catch (e) {} return new ES(url, init); };
  if (ES) window.EventSource.prototype = ES.prototype;

  const hop = async (next) => { const w = window.open('', '_blank'); /* opened inside the tap, so no popup blocker */
    try { const r = await fetch('/shopify/api/hop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ next }) }); const j = await r.json();
      if (j.url && w) w.location = j.url; else { w?.close(); alert(j.error || 'That didn’t open. Try again.'); } } catch (e) { w?.close(); } };
  const outside = (u) => /^\/(auth|connect)\//.test(u.pathname) && u.pathname !== '/connect/shopify/start';
  document.addEventListener('click', (e) => {
    const go = e.target.closest?.('button.go[data-next]'); if (go) { e.preventDefault(); return hop(go.dataset.next); }
    const a = e.target.closest?.('a[href]'); if (!a || e.defaultPrevented || a.target === '_blank' || a.hasAttribute('download')) return;
    let u; try { u = new URL(a.getAttribute('href'), location.href); } catch (er) { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.origin !== location.origin) { e.preventDefault(); window.open(u.href, '_blank', 'noopener'); return; }
    if (outside(u)) { e.preventDefault(); return hop(u.pathname + u.search); }
    const k = withKeep(u.href); if (k !== u.href && k !== a.getAttribute('href')) a.setAttribute('href', k);
  }, true);
})();
