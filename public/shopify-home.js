// Brew's home inside the Shopify admin (/shopify): ask the server who this store is, then open its brand, offer the read
// of a store Brew hasn't read, or finish a legacy install. App Bridge (loaded first) adds the session token to every fetch.
(() => {
  const box = document.getElementById('sh'), q = new URLSearchParams(location.search);
  const keep = () => { const k = new URLSearchParams(); for (const n of ['shop', 'host']) if (q.get(n)) k.set(n, q.get(n)); k.set('embedded', '1'); return k.toString(); };
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (h) => { box.innerHTML = h; };
  const call = async (path) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return r.json().catch(() => ({ error: 'Brew didn’t answer. Try again in a minute.' })); };
  const open = (slug) => location.replace(`/${encodeURIComponent(slug)}?${keep()}`);
  async function go() {
    say('Opening Brew…');
    const s = await call('/shopify/api/session');
    if (s.state === 'linked') return open(s.slug);
    if (s.state === 'authorize') return window.open(s.url, '_top'); /* a legacy install: Shopify's permission screen, then back here */
    if (s.state === 'unread') {
      if (s.locked) return say(`<p><b>${esc(s.host)}</b> is behind Shopify’s password page, so Brew can’t read your store yet.</p><p>Brew reads your storefront the way a shopper sees it, then suggests what to do next. Remove the password in <b>Online Store → Preferences</b>, then come back here.</p><p><button class="go" id="again">Check again</button></p>`), (document.getElementById('again').onclick = go);
      say(`<p>Brew reads <b>${esc(s.host)}</b> the way a shopper sees it, then suggests what to do next. Your Shopify numbers join in once the read is done.</p><p>The first read takes about half an hour. You can leave this page; it keeps going.</p><p><button class="go" id="read">Read my store</button></p><p class="err" id="err" hidden></p>`);
      const b = document.getElementById('read'), err = document.getElementById('err');
      b.onclick = async () => { b.disabled = true; b.textContent = 'Starting…'; err.hidden = true;
        const r = await call('/shopify/api/read'); if (r.slug) return open(r.slug);
        b.disabled = false; b.textContent = 'Read my store'; err.textContent = r.error || 'The read didn’t start. Try again in a minute.'; err.hidden = false; };
      return;
    }
    say(`<p class="err">${esc(s.error || 'Brew couldn’t open. Try again in a minute.')}</p><p><button class="go" id="again">Try again</button></p>`); document.getElementById('again').onclick = go;
  }
  go().catch(() => say('<p class="err">Brew couldn’t open. Reload the page to try again.</p>'));
})();
