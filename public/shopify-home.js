// Brew's home inside the Shopify admin (/shopify): ask the server who this store is, then open its brand, offer the read
// of a store Brew hasn't read (from the Shopify admin when the storefront is behind the password page), or finish a legacy install. App Bridge (loaded first) adds the session token to every fetch.
(() => {
  const box = document.getElementById('sh'), q = new URLSearchParams(location.search);
  const keep = () => { const k = new URLSearchParams(); for (const n of ['shop', 'host']) if (q.get(n)) k.set(n, q.get(n)); k.set('embedded', '1'); return k.toString(); };
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (h) => { box.innerHTML = h; };
  const call = async (path) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return r.json().catch(() => ({ error: 'No answer from us. Try again in a minute.' })); };
  /* the brand page loads as this person: a frame's own load can't send the session token, so its address carries it (a store
     not open yet shows its page to its team only; shopify-embed.js takes the token out of the address once the page is up) */
  const open = async (slug) => { const k = new URLSearchParams(keep()); try { const t = await window.shopify?.idToken?.(); if (t) k.set('id_token', t); } catch (e) {} location.replace(`/${encodeURIComponent(slug)}?${k}`); };
  async function go() {
    say('Opening your feed…');
    const s = await call('/shopify/api/session');
    if (s.state === 'linked') return open(s.slug);
    if (s.state === 'authorize') return window.open(s.url, '_top'); /* a legacy install: Shopify's permission screen, then back here */
    if (s.state === 'unread') {
      /* a store behind Shopify's password page (every development store) is read from the Shopify admin instead */
      if (s.locked) say(`<p>Your storefront is behind Shopify’s password page, so we read <b>${esc(s.name || s.host)}</b> from your Shopify admin instead: your products, prices, photos and descriptions. Then it suggests what to do next.</p><p>The checkout walk, page speed and AI answers wait until your store opens; we check each day and run them then.</p><p>The first read takes about half an hour. You can leave this page; it keeps going.</p><p><button class="go" id="read">Read my store</button></p><p class="err" id="err" hidden></p>`);
      else say(`<p>We read <b>${esc(s.host)}</b> the way a shopper sees it, then suggest what to do next. Your Shopify numbers join in once the read is done.</p><p>The first read takes about half an hour. You can leave this page; it keeps going.</p><p><button class="go" id="read">Read my store</button></p><p class="err" id="err" hidden></p>`);
      const b = document.getElementById('read'), err = document.getElementById('err');
      b.onclick = async () => { b.disabled = true; b.textContent = 'Starting…'; err.hidden = true;
        const r = await call('/shopify/api/read'); if (r.slug) return open(r.slug);
        b.disabled = false; b.textContent = 'Read my store'; err.textContent = r.error || 'The read didn’t start. Try again in a minute.'; err.hidden = false; };
      return;
    }
    say(`<p class="err">${esc(s.error || 'That didn’t open. Try again in a minute.')}</p><p><button class="go" id="again">Try again</button></p>`); document.getElementById('again').onclick = go;
  }
  go().catch(() => say('<p class="err">That didn’t open. Reload the page to try again.</p>'));
})();
