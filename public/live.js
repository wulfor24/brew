// Connected accounts and the brand's team.
// On the live site connecting is real (connectors/index.js): one-click sign-in where the platform allows it, or a pasted
// read-only key, then an account picker for Meta and Google. What an account returns is only shown to the brand's team.
// DUMMY: on the demo site (L.dummy) every account is simulated from the brand's public read; the sheet and the cards say so
// (Dummy tag). See DUMMY.md. Slack is real on the live site (connectors/slack.js).
// Also real: Google sign-in, who may connect (the brand's team, or the first official email, who claims the brand),
// and the team sheet (views, invites, owners).
(() => {
  const slug = window.BRAND, GENB = !!slug && slug !== 'brew';
  const L = (window.LIVE = { me: null, access: null, conns: {}, avail: {}, ready: false });
  const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
  /* the server's view of who you are and what is connected. It is awaited in full (no 2.5 s race: a slow first load left
     avail empty and the app fell back to a fake sign-in sheet); a failed call is tried once more. L.ready says it answered */
  const liveCall = () => fetch(GENB ? `/api/brands/${slug}/live` : '/api/me', { credentials: 'same-origin' }).then((x) => { if (!x.ok) throw new Error(`live ${x.status}`); return x.json(); });
  window.LIVE_P = (async () => {
    let r = null; for (let i = 0; i < 2 && !r; i++) { try { r = await liveCall(); } catch (e) { if (!i) await timeout(800); } }
    if (r) { Object.assign(L, r, { user: r.me || r.user || null }); L.ready = true; } else L.failed = true;
    L.me = L.me || L.user || null; return L;
  })();
  const A = () => window.__BREW;
  const esc = (s) => String(s ?? '').replace(/\u2039(?=\s?\d)/g, '₹').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, c) => A()?.ic?.(n, c) || '';
  const post = (p, b) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({ error: 'You look offline. Try again.' }));
  const get = (p) => fetch(p, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
  const here = (h = '') => `/${slug}${h}`;
  /* the platform's sign-in leaves the page: remember the screen it started from, so the way back lands there, not on the first screen */
  const BACK = `brew-cxback:${slug}`;
  const leave = (url) => { try { sessionStorage.setItem(BACK, A()?.view || ''); } catch (e) {} location.href = url; };
  const keepPlace = (m) => m.querySelectorAll('a[href^="/auth/"]').forEach((a) => a.addEventListener('click', () => { try { sessionStorage.setItem(BACK, A()?.view || ''); } catch (e) {} }));
  const logo = (id) => A()?.glyph?.(id, 36) || `<span class="lc-gl">${esc(nm(id).slice(0, 1))}</span>`;
  const setupView = () => ['ob', 'setup', 'check', 'wait', 'start'].includes(A()?.view);
  const signin = (next) => `/auth/google?next=${encodeURIComponent(next || location.pathname + location.search + location.hash)}`;
  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60e3); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const member = () => !!L.access?.role;
  /* connecting and disconnecting are for the brand's admins; a teammate syncs what is connected (the server enforces it too) */
  const boss = () => !L.access?.role || ['owner', 'admin'].includes(L.access.role);
  const adminName = () => (L.access?.team || []).find((x) => x.role === 'owner')?.name || 'your admin';
  const isLive = (id) => L.conns?.[id]?.state === 'live' && (L.conns[id].stats || []).length > 0;
  const B = () => A()?.B || window.FEED_DATA?.[slug];
  /* the platform's own name on the sheets (a brand pack may label it "Reviews on judge.me" or "amazon.in") */
  const PLAT = { shopify: 'Shopify', meta: 'Meta Ads', ga4: 'Google Analytics', google: 'Google Ads', klaviyo: 'Klaviyo', reviews: 'Judge.me', slack: 'Slack' };
  const nm = (id) => PLAT[id] || B()?.connectors?.[id]?.name || id;
  const host = () => L.access?.host || B()?.brand?.host || '';

  /* ---------- at boot: real accounts replace the demo numbers on the connectors ---------- */
  function overlay(Bd, S) {
    if (!GENB || !Bd?.connectors) return;
    for (const [id, x] of Object.entries(L.conns || {})) {
      const c = Bd.connectors[id]; if (!c) continue;
      /* live means real: its own numbers, or none (an empty account never keeps the demo numbers) */
      if (x.state === 'live' && (x.stats || x.changed || x.account)) { Bd.connectors[id] = { ...c, stats: x.stats || [], changed: x.changed || [], demo: false, live: true, account: x.account || c.account, ...(id === 'reviews' && /judge\.?me/i.test(x.account || '') ? { name: 'Judge.me' } : id === 'reviews' && /loox/i.test(x.account || '') ? { name: 'Loox' } : {}) }; S.conn[id] = true; (S.realConn ||= {})[id] = true; }
    }
    /* a real account that was disconnected: its switch goes off too, instead of quietly falling back to the demo */
    if (L.conns) for (const id of Object.keys(S.realConn || {})) if (!(L.conns[id]?.state === 'live')) { delete S.realConn[id]; S.conn[id] = false; }
    /* on the live site a real account is on only when the server says so: an old simulated switch saved in this browser goes off */
    if (L.avail && L.dummy === false) for (const id of Object.keys(Bd.connectors)) if (L.avail[id] && !L.avail[id].dummy && L.conns?.[id]?.state !== 'live' && S.conn[id]) S.conn[id] = false;
    // the brand's own team sees what each account does in plain words, not the demo's made-up numbers
    if (member()) for (const [id, c] of Object.entries(Bd.connectors)) if (!c.live && !S.conn[id] && c.changedPlain?.length) Bd.connectors[id] = { ...c, changed: c.changedPlain };
  }

  /* ---------- the connect box: one glass box per connector; its states (connect, key, busy, error, picked, done) swap in place ---------- */
  const poss = () => { const n = B().brand.name || ''; return `${esc(n)}${/s$/i.test(n) ? '’' : '’s'}`; };
  /* header and buttons stay put; only the body between them scrolls, so the button is always in reach */
  const box = ({ id, title, line = '', body = '', status = '', ghost = '', go = '' }) => `<div class="cxb-h">${logo(id)}<span><b>${title}</b>${line ? `<em>${line}</em>` : ''}</span><button type="button" class="cxb-x" data-close aria-label="Close">${ic('x', 's16')}</button></div><div class="cxb-b">${body}${status}</div>${ghost || go ? `<div class="cxb-f">${ghost}${go}</div>` : ''}`;
  const kick = (t) => `<p class="cxb-k">${t}</p>`;
  const ticks = (xs) => (xs.length ? `<ul class="cxb-l">${xs.map((t) => `<li>${ic('check', 's14')}<span>${t}</span></li>`).join('')}</ul>` : '');
  const note = (t, icon = 'sparkles') => `<p class="cxb-note">${ic(icon, 's14')}<span>${t}</span></p>`;
  const stat = (t, kind = '', icon = 'lock') => `<div class="cxb-st${kind ? ` is-${kind}` : ''}" data-st>${icon === 'spin' ? '<brew-load class="spin"></brew-load>' : ic(icon, 's16')}<span>${t}</span></div>`;
  const READONLY = (id) => (id === 'slack' ? stat('Posts the cards and jams your team sends to the channel you pick. Disconnect any time.', '', 'send') : stat('Read-only. Disconnect any time.')); /* Slack posts; every other connector only reads */
  const ghostBtn = (t, attr = 'data-close') => `<button type="button" class="cxb-gh" ${attr}>${t}</button>`;
  const goBtn = (t, attr) => `<button type="button" class="cxb-go" ${attr}>${t}</button>`;
  const goLink = (t, href) => `<a class="cxb-go" href="${href}">${t}</a>`;
  const pane = (k, html, on) => `<div class="cxb-p" data-pane="${k}"${on ? '' : ' hidden'}>${html}</div>`;
  const shell = (html) => `<div class="sheet cxb" role="dialog" aria-modal="true">${html}</div>`;
  /* the header draws its bottom line only once the body has scrolled under it; the buttons' top line only while more is below */
  const edges = (m) => m.querySelectorAll('.cxb-b').forEach((b) => { if (b.dataset.edged) return; b.dataset.edged = 1;
    const f = () => { const p = b.parentElement; p.classList.toggle('is-up', b.scrollTop > 2); p.classList.toggle('is-down', b.scrollHeight - b.scrollTop - b.clientHeight > 2); };
    b.addEventListener('scroll', f, { passive: true }); new ResizeObserver(f).observe(b); f(); });
  /* what a connector unlocks, from the brand's own connector card; a plain line per platform when the pack has none */
  const READS = { google: ['Spend, clicks and orders from search', 'Which searches bring buyers'], ga4: ['Sessions, sources and checkouts', 'Where shoppers drop off'], meta: ['Spend, return and cost per purchase, 30 days', 'Which campaigns return most this week', 'Ads people have seen too often'],
    shopify: ['Orders, customers and carts', 'Products and stock'], klaviyo: ['Flows, campaigns and their revenue', 'How the list grows'], reviews: ['Reviews and ratings', 'What customers praise and complain about'], slack: ['Post cards and jams to a channel', 'Thread replies land in the jam', 'Approve from Slack'] };
  const unlocks = (id) => { const xs = (B()?.connectors?.[id]?.changed || READS[id] || []).slice(0, 3).map(esc); return xs.length ? kick('What it unlocks') + ticks(xs) : ''; };
  const askAdmin = (id) => box({ id, title: `${esc(nm(id))} is connected by an admin`, line: `Ask ${esc(adminName())} to connect it. Once it’s on, you can sync it any time.`, go: goBtn('Got it', 'data-close') });
  /* the gates before connecting: signed out, or signed in with an email that isn't the brand's */
  function gate(id, dummy) {
    const n = esc(B().brand.name), back = signin(here(`#v=connectors&cx=${id}`));
    if (!L.me) return box({ id, title: `Connect ${esc(nm(id))}`, line: `Sign in first, so the numbers stay with ${poss()} team.`, body: unlocks(id), status: dummy ? DUMMY(id) : READONLY(id), ghost: ghostBtn('Not now'), go: goLink('Sign in with Google', back) });
    if (L.access && !L.access.gen) { const h = esc(L.access.host || host());
      return box({ id, title: L.access.claimed ? `${poss()} team connects its accounts` : 'Use your work email', line: L.access.claimed ? `${n} is already set up here. Ask its team to invite you.` : `You’re signed in as ${esc(L.me.email)}. The first person from ${h} to connect an account becomes ${poss()} admin.`,
        ghost: L.access.claimed ? '' : ghostBtn('Not now'), go: L.access.claimed ? goBtn('Got it', 'data-close') : goLink('Switch email', `/auth/logout?next=${encodeURIComponent(back)}`) }); }
    if (!boss()) return askAdmin(id);
    return null;
  }
  /* the ownership check (advisory for every connector but GA4 by ID): a miss is said plainly, in the box, not hidden in a note */
  const notMine = (why, err = false) => stat(err ? `The check didn’t go through: ${esc(why)}` : `This account doesn’t look like ${poss()}: ${esc(why)}. We read it anyway; disconnect it if it’s the wrong one.`, 'bad', 'info');
  const claimNote = () => (!L.access?.claimed && L.access?.eligible ? note(`You’re the first from ${esc(host())}. Connecting makes you ${poss()} admin.`) : '');
  // DUMMY: the status line on a simulated account
  const DUMMY = (id) => stat(`<span class="dummy-tag">Dummy</span>A simulated ${esc(nm(id))} account, built from what we read. Nothing real is connected.`, '', 'info');

  const simId = (id) => !!(L.dummy || L.avail?.[id]?.dummy || (L.ready && !L.avail?.[id]));
  /* false only when the server said this connector isn't available here; while the live call hasn't answered yet the box
     waits for it (never a fake sheet because of a slow load) */
  const open = (id, opts = {}) => {
    if (L.ready) return simId(id) ? openSim(id, opts) : openReal(id, opts);
    /* still loading: open once it answers. The load failed: ask again now, and say so if Brew still can't be reached */
    const again = L.failed ? liveCall().then((r) => { Object.assign(L, r, { user: r.me || r.user || null }); L.me = L.me || L.user || null; L.ready = true; L.failed = false; }).catch(() => null) : window.LIVE_P;
    window.BrewLoad?.hold(document.activeElement?.closest?.('button,[role="button"]'), again); /* the tapped connector shows the loader meanwhile */
    again.then(() => { if (L.ready) open(id, opts); else A()?.toast?.(`${ic('info', 's16')}Couldn’t reach us to connect ${esc(nm(id))}. Check your connection and try again.`); });
    return true; };
  // a real account: sign in with the platform, or paste a read-only key
  function openReal(id, opts = {}) {
    if (!GENB || (!L.signin && !L.me)) return false;
    let html = gate(id, false);
    if (!html) {
      const av = L.avail[id], x = L.conns?.[id], short = esc(nm(id).split(' ')[0]);
      const oauth = av.modes.includes('oauth') && av.oauth, key = av.modes.includes('key') && av.fields?.length;
      const g = guide(id, av, oauth), solo = g.steps.length === 1 && g.steps[0].oauth ? g.steps[0] : null;
      const status = x?.error ? stat(esc(x.error), 'bad', 'info') : READONLY(id), why = x?.why ? notMine(x.why) : '';
      const line = esc(opts.why || '') || solo?.p || `Puts ${poss()} real numbers on your cards.`;
      if (av.modes.includes('public')) html = box({ id, title: `Connect ${esc(nm(id))}`, line, body: unlocks(id) + why, status: av.ready ? READONLY(id) : stat('The marketplace read is off on this server right now.', 'bad', 'info'), ghost: ghostBtn('Not now'), go: av.ready ? goBtn('Read the listings now', 'data-pub') : '' });
      else if (!oauth && !key) html = box({ id, title: `Connect ${esc(nm(id))}`, line, body: unlocks(id), status: stat(`Connecting ${esc(nm(id))} is being switched on. Our team will send you a link.`, '', 'clock'), go: goBtn('Got it', 'data-close') });
      else {
        const steps = g.steps.filter((s) => !s.oauth), alt = oauth && key && steps.length;
        const oauthPane = oauth ? box({ id, title: `Connect ${esc(nm(id))}`, line, body: claimNote() + unlocks(id) + why + (id === 'shopify' && !av.install ? `<div class="cxb-form">${field({ k: 'shop', label: 'Store address', hint: 'your-store.myshopify.com' }, 'data-shop')}</div>` : ''), status,
          ghost: alt ? ghostBtn(esc(g.alt), 'data-swap="key"') : ghostBtn('Not now'), go: goBtn(`${id === 'shopify' && av.install ? `Install ${globalThis.PRODUCT_NAME} on` : 'Continue with'} ${short}${ic('right', 's16')}`, 'data-oauth') }) : ''; /* Shopify installs from Shopify itself: nobody types a store address (App Store requirement 2.3.1) */
        const keyPane = key && steps.length ? box({ id, title: `Connect ${esc(nm(id))}`, line: esc(g.time), body: (oauth ? '' : claimNote() + why) + stepList(steps) + `<div class="cxb-form">${fieldsOf(id, av)}</div>`, status,
          ghost: alt ? ghostBtn('Back', 'data-swap="oauth"') : ghostBtn('Not now'), go: goBtn('Connect', 'data-key') }) : '';
        html = oauth ? pane('oauth', oauthPane, true) + (alt ? pane('key', keyPane, false) : '') : pane('key', keyPane, true);
      }
    }
    A().modal(shell(html), (m) => {
      const $ = (q) => m.querySelector(q); keepPlace(m); bindBox(m);
      $('[data-oauth]')?.addEventListener('click', () => { const shop = $('[data-shop]')?.value?.trim(); if (id === 'shopify' && !shop && !av.install) { $('[data-shop]').closest('.lc-f')?.classList.add('is-miss'); $('[data-shop]').focus(); return; } leave(`/connect/${id}/start?brand=${slug}${shop ? `&shop=${encodeURIComponent(shop)}` : ''}`); });
      $('[data-key]')?.addEventListener('click', () => { const ins = [...m.querySelectorAll('[data-k]')], miss = ins.find((i) => i.required && !i.value.trim() && !i.closest('[hidden]'));
        if (miss) { miss.focus(); miss.closest('.lc-f')?.classList.add('is-miss'); return; }
        const fields = Object.fromEntries(ins.map((i) => [i.dataset.k, i.value.trim()]).filter(([, v]) => v)); run(m, id, post(`/api/brands/${slug}/connect/${id}`, { action: 'key', fields }), opts); });
      $('[data-pub]')?.addEventListener('click', () => run(m, id, post(`/api/brands/${slug}/connect/${id}`, { action: 'sync' }), opts));
    });
    return true;
  }
  /* ---------- the guided connect: what to do on each platform, in order, with the links that land on the right page ---------- */
  const SHOPIFY_SCOPES = 'read_products,read_inventory,read_locations,read_orders,read_customers';
  function guide(id, av, oauth) {
    const shop = L.shop || '', handle = shop.replace(/\.myshopify\.com$/, ''), n = B().brand.name;
    const last = (t, p) => ({ t, p, last: true });
    if (id === 'meta') return { time: 'About 1 minute', steps: [{ t: 'Sign in with Facebook', p: `Facebook asks which ad accounts we may read. Tick ${esc(n)}’s, then pick it here.`, last: true, oauth: true }] };
    if (id === 'shopify') return oauth && !av.fields?.length ? { time: 'About 1 minute', steps: [{ t: 'Sign in with Shopify', last: true, oauth: true }] } : { time: 'Takes about 3 minutes', alt: 'Use your own app', steps: [
      { t: `Create an app called ${globalThis.PRODUCT_NAME}`, p: 'Sign in to the Dev Dashboard (the store’s owner, or an agency or collaborator login). Click <b>Create app</b>, paste this as the <b>App URL</b> and untick <b>Embed app in Shopify admin</b>.', go: ['Open the Dev Dashboard', 'https://dev.shopify.com/dashboard'], copy: location.origin },
      { t: 'Let it come back here', p: 'Paste this into <b>Allowed redirection URL(s)</b> and tick <b>Use legacy install flow</b>. If the app sits in another organization than the store, we open the store’s approve screen once and come back here.', copy: `${location.origin}/shopify/own/callback` },
      { t: 'Give it read-only access', p: 'On the same page, under <b>API access</b>, paste these into <b>Scopes</b>. Then click <b>Create app</b>.', copy: SHOPIFY_SCOPES },
      { t: `Install it on ${shop ? esc(shop) : 'your store'}`, p: 'On the app’s home, click <b>Install app</b>.' },
      last('Paste the app’s keys', 'They’re in the app’s <b>Settings</b>.') ] };
    if (id === 'slack') return { time: 'About 1 minute', steps: [{ t: 'Sign in with Slack', p: 'Slack asks which channel we post to. Pick the one your team plans in. Replies in our threads come back to the jam.', last: true, oauth: true }] };
    if (id === 'google') return { time: 'About 1 minute', steps: [{ t: 'Sign in with Google', p: `Pick ${esc(n)}’s Google Ads account. You can add Google Analytics in the same step.`, last: true, oauth: true }] };
    if (id === 'ga4') return { time: 'Takes about a minute', alt: 'Use a property ID', steps: [
      ...(av.email ? [{ t: 'Add us to GA4 as a Viewer', p: '<b>Admin</b> → <b>Property access management</b> → <b>Add users</b>. Paste this email and pick <b>Viewer</b>.', copy: av.email, go: ['Open GA4 Admin', 'https://analytics.google.com/analytics/web/#/admin'] }] : []),
      last('Paste the property ID', 'It’s under <b>Admin</b> → <b>Property details</b>.') ] };
    if (id === 'klaviyo') return { time: 'Takes about a minute', steps: [
      { t: 'Create a read-only private key', p: `Name it ${globalThis.PRODUCT_NAME} and choose <b>Read-only key</b>.`, go: ['Open Klaviyo', 'https://www.klaviyo.com/settings/account/api-keys'] },
      last('Paste the key', 'Klaviyo shows it once. It starts with pk_.') ] };
    if (id === 'reviews') return { time: 'Takes about a minute', alt: 'Paste an API token', steps: [
      { t: 'Copy your Judge.me API token', p: '<b>Settings</b> → <b>Integrations</b> → <b>Developers</b> → <b>View API token</b>.', go: ['Open Judge.me', handle ? `https://admin.shopify.com/store/${encodeURIComponent(handle)}/apps/judgeme` : 'https://judge.me/login'] },
      last('Paste it here', '') ] };
    return { time: 'Takes about a minute', steps: [last(`Connect ${esc(nm(id))}`, av.help ? esc(av.help) : '')] };
  }
  const stepList = (steps) => `<ol class="cxb-n">${steps.map((st, i) => `<li><i>${i + 1}</i><span><b>${esc(st.t)}</b>${st.p ? `<small>${st.p}</small>` : ''}${st.go ? `<a class="cxb-a" href="${esc(st.go[1])}" target="_blank" rel="noopener">${esc(st.go[0])}${ic('external', 's14')}</a>` : ''}${st.copy ? `<span class="cxb-copy"><code>${esc(st.copy).replace(/,/g, ',<wbr>')}</code><button type="button" class="gd-cp" data-copy="${esc(st.copy)}">${ic('copy', 's14')}<span>Copy</span></button></span>` : ''}</span></li>`).join('')}</ol>`;
  const canPaste = () => !!navigator.clipboard?.readText;
  const field = (f, attr = '') => { const v = f.k === 'shop' ? L.shop || '' : '';
    return `<label class="lc-f${f.alt ? ' is-alt' : ''}"${f.alt ? ' hidden' : ''}><small>${esc(f.label)}</small><span class="lc-in"><input ${attr || `data-k="${f.k}"`} ${f.secret ? 'type="password" autocomplete="off"' : 'autocomplete="off"'} spellcheck="false" placeholder="${esc(f.hint || '')}" value="${esc(v)}"${f.req ? ' required' : ''}>${canPaste() && f.k !== 'shop' ? `<button type="button" class="lc-paste" data-paste>${ic('paste', 's14')}Paste</button>` : ''}</span></label>`; };
  function fieldsOf(id, av) {
    let fs = av.fields.map((f) => ({ ...f, req: !f.optional }));
    if (id === 'shopify') { fs = fs.map((f) => f.k === 'token' ? { ...f, label: 'Admin API access token', alt: true } : { ...f, req: true }).map((f) => f.k === 'clientId' || f.k === 'clientSecret' ? { ...f, hint: '' } : f.k === 'token' ? { ...f, hint: 'shpat_…' } : f);
      return fs.map((f) => field(f)).join('') + '<button type="button" class="lc-alt" data-alt>I have an Admin API token instead</button>'; }
    if (id === 'ga4') fs = fs.map((f) => ({ ...f, label: 'Property ID or GA4 page address', hint: '123456789' }));
    if (id === 'reviews') fs = fs.map((f) => f.k === 'token' ? { ...f, hint: 'Your private API token' } : f);
    if (id === 'klaviyo') fs = fs.map((f) => ({ ...f, hint: 'pk_…' }));
    return fs.map((f) => field(f)).join('');
  }
  /* the box's own controls: swap between sign-in and key, copy, paste, the Shopify token toggle */
  function bindBox(m) {
    edges(m);
    m.querySelectorAll('[data-swap]').forEach((b) => b.onclick = () => { m.querySelectorAll('.cxb-p').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.swap; }); m.querySelector('.cxb-p:not([hidden]) input:not([value]), .cxb-p:not([hidden]) input[value=""]')?.focus({ preventScroll: true }); });
    m.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); } catch (e) { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); }
      const t = b.querySelector('span'); t.textContent = 'Copied'; b.classList.add('is-ok'); setTimeout(() => { t.textContent = 'Copy'; b.classList.remove('is-ok'); }, 1600); });
    m.querySelectorAll('[data-paste]').forEach((b) => b.onclick = async () => { const i = b.previousElementSibling; try { i.value = (await navigator.clipboard.readText()).trim(); i.dispatchEvent(new Event('input')); i.closest('.lc-f')?.classList.remove('is-miss'); } catch (e) { i.focus(); } });
    m.querySelectorAll('.lc-f input').forEach((i) => i.addEventListener('input', () => i.closest('.lc-f')?.classList.remove('is-miss')));
    m.querySelector('[data-alt]')?.addEventListener('click', (e) => { const alt = m.querySelectorAll('.lc-f.is-alt'), on = alt[0]?.hidden;
      m.querySelectorAll('[data-pane="key"] .lc-f, .cxb > .lc-f').forEach((f) => { f.hidden = f.classList.contains('is-alt') ? !on : on; f.querySelector('input').required = !f.hidden; });
      e.target.textContent = on ? 'Use the app’s Client ID and Secret instead' : 'I have an Admin API token instead'; });
  }
  // DUMMY: a simulated account (demo site, Slack)
  function openSim(id, opts = {}) {
    if (!GENB || (!L.signin && !L.me)) return false;
    const html = gate(id, true) || box({ id, title: `Connect ${esc(nm(id))}`, line: esc(opts.why || '') || (id === 'slack' ? 'Share cards with your team and approve them in a thread.' : `Puts ${poss()} numbers on your cards.`), body: claimNote() + unlocks(id), status: DUMMY(id), ghost: ghostBtn('Not now'), go: goBtn(`Connect ${esc(nm(id).split(' ')[0])}`, 'data-dm') });
    A().modal(shell(html), (m) => {
      keepPlace(m); edges(m); m.querySelector('[data-dm]')?.addEventListener('click', () => run(m, id, Promise.all([post(`/api/brands/${slug}/connect/${id}`, { action: 'connect' }), timeout(1600)]).then(([r]) => r), opts));
    });
    return true;
  }
  /* the box's status line and button, in place: busy while it reads, the reason when it fails */
  const setStat = (p, html) => { const s = p.querySelector('[data-st]'); if (s) s.outerHTML = html; else p.querySelector('.cxb-b')?.insertAdjacentHTML('beforeend', html);
    const b = p.querySelector('[data-st]')?.closest('.cxb-b'); if (b && /is-(bad|busy)/.test(html)) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); };
  // the accounts as the server sees them now (state, stats, what changed), laid over the brand's connector cards
  async function refreshLive() { const r = await get(`/api/brands/${slug}/live`); if (!r?.conns) return; Object.assign(L, r, { user: r.me || r.user || null }); overlay(B(), A().S); A().save(); }
  // reading the account: busy in place, then what came back
  async function run(m, id0, p, opts = {}) {
    const box0 = m.querySelector('.cxb'), cur = [...m.querySelectorAll('.cxb-p')].find((x) => !x.hidden) || box0, go = cur.querySelector('.cxb-go');
    if (go) { go.disabled = true; go.innerHTML = '<brew-load class="spin"></brew-load>Connecting…'; }
    m.querySelectorAll('.cxb-gh').forEach((b) => { b.disabled = true; });
    setStat(cur, stat(`Reading ${esc(nm(id0))}, the last 30 days…`, 'busy', 'spin'));
    const r = await p, id = r?.moved || id0; /* a Google sign-in that only picked GA4 connected Google Analytics instead */
    for (const [k, x] of Object.entries(r?.also || {})) if (x?.ok && k !== id) { L.conns[k] = { ...(L.conns[k] || {}), ...x, state: x.state || 'live' }; A().S.conn[k] = true; }
    if (!r?.ok && r?.approve) { setStat(cur, stat(esc(r.error), 'busy', 'spin')); location.assign(r.approve); return; } /* Shopify's approve screen, then back here connected */
    if (!r?.ok) { if (go) { go.disabled = false; go.textContent = 'Try again'; } m.querySelectorAll('.cxb-gh').forEach((b) => { b.disabled = false; }); setStat(cur, stat(esc(r?.error || 'That didn’t connect. Check it and try again.'), 'bad', 'info')); return; }
    box0.innerHTML = result(id, r); bindDone(m, id, opts);
    L.conns[id] = { ...(L.conns[id] || {}), ...r, state: r.state || 'live' }; overlay(B(), A().S); A().S.conn[id] = true; A().save();
    /* the page behind the box shows the new account at once: the server's view of every account, then the cards and the feed */
    if (!setupView()) refreshLive().then(() => A().refreshAfterConnect?.(id)).catch(() => {});
    else A().cxDone?.(id);
  }
  /* connected: what Brew read, the green line, and the rest a tap away */
  const lc1 = (s) => String(s || '').replace(/^\p{Lu}(?!\p{Lu})/u, (c) => c.toLowerCase());
  const result = (id, r) => { const also = Object.entries(r.also || {}).some(([k, x]) => x?.ok && k !== id), dummy = simId(id) || r.dummy;
    const read = (r.stats || []).slice(0, 3).map(([k, v]) => `<b>${esc(v)}</b> <small>${esc(lc1(k))}</small>`), did = read.length ? [] : (r.changed || []).slice(0, 2).map(esc);
    const done = box({ id, title: `${esc(nm(id))}${also ? ' and Google Analytics are' : ' is'} connected`, line: dummy ? 'Your cards now use its simulated numbers.' : 'Your cards now use its numbers.',
      body: (r.claimed ? note(`You’re ${poss()} owner now. Teammates with the same company email join on their own.`) : '') + (read.length ? kick('What we read') + ticks(read) : did.length ? kick('In your feed') + ticks(did) : '')
        + (r.proof && !r.proof.ok ? notMine(r.proof.why || r.why || 'no match', !!r.proof.error) : r.why ? notMine(r.why) : '') + accountList(r) + (r.notes || []).slice(0, 2).map((t) => note(esc(t), 'info')).join(''),
      status: dummy ? stat('<span class="dummy-tag">Dummy</span>Connected. Nothing real was read or changed.', 'on', 'check') : stat(`Live. Refreshes every ${L.avail?.[id]?.every || 12} hours.`, 'on', 'check'),
      ghost: others(id).length && boss() ? ghostBtn('Connect another', 'data-swap="next"') : '', go: goBtn(setupView() ? 'Continue' : 'See it in the feed', 'data-see') });
    const xs = others(id), next = xs.length && boss() ? box({ id, title: 'Connect another', line: 'One tap each.', body: `<div class="cxb-rows">${xs.map((k) => `<button type="button" class="cxb-row" data-next-cx="${k}">${A()?.glyph?.(k, 28) || ''}<span><b>${esc(nm(k))}</b></span>${ic('right', 's16')}</button>`).join('')}</div>`, ghost: ghostBtn('Back', 'data-swap="done"') }) : '';
    return pane('done', done, true) + (next ? pane('next', next, false) : ''); };
  /* several ad accounts read at once (Meta): each one's spend on the done box */
  const accountList = (r) => { const xs = (r.accounts || []).filter((a) => a && (a.ok !== false)); if (xs.length < 2) return ''; return kick(`${xs.length} ad accounts`) + ticks(xs.map((a) => `${esc(a.name)}${a.spend != null ? ` <small>${esc(a.currency || '')} ${esc(Number(a.spend).toLocaleString())}</small>` : ''}`)); };
  /* after one account, the rest are a tap away: the brand's other accounts that are not connected yet */
  const others = (id) => Object.keys(B()?.connectors || {}).filter((k) => k !== id && !(A()?.conn?.(k)) && !(L.conns?.[k]?.state === 'live') && (simId(k) ? k !== 'slack' || L.dummy : L.avail?.[k]?.ready !== false));
  function bindDone(m, id, opts = {}) {
    bindBox(m);
    m.querySelectorAll('[data-next-cx]').forEach((b) => b.onclick = () => { const k = b.dataset.nextCx; A().closeModal(); setTimeout(() => A().openConnect(k), 60); });
    const see = m.querySelector('[data-see]'); if (!see) return;
    /* during onboarding, stay on the step: a page load would start the onboarding again from the first screen */
    see.onclick = () => { A().closeModal(); if (!setupView()) location.href = here(opts.then ? location.hash : ''); };
  }

  /* ---------- back from the account's own sign-in (#v=connectors&cx=meta&pick=1 | done=1 | cxerr=…) ---------- */
  async function resume() {
    if (!GENB) return; const hp = Object.fromEntries(location.hash.replace(/^#/, '').split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, ''] : [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
    const id = hp.cx; if (!id && !hp.cxerr) return;
    history.replaceState(history.state, '', location.pathname + '#v=connectors');
    if (hp.cxerr) { A().toastLong(`${ic('info', 's16')}${esc(hp.cxerr)}`, 8000); if (id) setTimeout(() => open(id), 300); return; }
    if (hp.pick) return pick(id);
    if (hp.done && L.conns[id]) { if (setupView()) { A().S.conn[id] = true; A().save(); A().cxDone?.(id); }
      A().modal(shell(result(id, { ...L.conns[id], claimed: L.access?.role === 'owner' && L.access?.members?.length === 1 })), (m) => bindDone(m, id)); return; }
    if (id && !A().conn(id)) setTimeout(() => A().openConnect(id), 300);
  }
  // Meta: which ad account; Google Ads: which Ads account (and, if they like, the GA4 property too); Google Analytics: which property
  async function pick(id) {
    if (!boss()) return A().modal(shell(askAdmin(id)));
    const what = id === 'google' ? 'accounts' : id === 'ga4' ? 'property' : L.avail?.[id]?.multi ? 'ad accounts' : 'ad account', many = id === 'google' || !!L.avail?.[id]?.multi;
    A().modal(shell(box({ id, title: `Pick the ${what}`, line: `The ${many ? 'ones' : 'one'} that ${many ? 'are' : 'is'} ${poss()}.`, body: '<div class="cxb-opts"><brew-load class="spin"></brew-load></div>', ghost: ghostBtn('Cancel'), go: goBtn('Connect', 'data-go') })), async (m) => {
      edges(m);
      const r = await get(`/api/brands/${slug}/connect/${id}/options`), box0 = m.querySelector('.cxb'), opts = r.options || [], go = m.querySelector('[data-go]');
      if (!opts.length) { m.querySelector('.cxb-opts').remove(); setStat(box0, stat(esc(r.error || 'No accounts came back for this login. Try a login that can see them.'), 'bad', 'info')); go.textContent = 'Try again'; go.onclick = () => leave(`/connect/${id}/start?brand=${slug}`); return; }
      const GOOG = id === 'google' || id === 'ga4', groups = id === 'google' ? [['ads', 'Google Ads'], ['ga4', 'Google Analytics']] : id === 'ga4' ? [['ga4', 'Google Analytics property']] : [[null, 'Ad account']];
      /* several accounts at once (Meta): checkboxes, the brand's own ones ticked first (the server checked each for the brand's Page) */
      const multi = !!(r.multi || L.avail?.[id]?.multi) && !GOOG;
      const row = (name, val, nm2, sub, on, o = {}) => `<label class="cxb-row"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(val)}" data-name="${esc(nm2)}"${on ? ' checked' : ''}><span><b>${esc(nm2)}</b>${sub ? `<small>${esc(sub)}${o.own === true ? ` · ${esc(B().brand.name)}’s page` : o.own === false ? ' · another page' : ''}</small>` : ''}</span><i class="cxb-radio" aria-hidden="true"></i></label>`;
      /* Google Ads sign-in with no Ads account on that login: Ads can't connect, so the sheet offers Google Analytics alone
         (no "Connect Google Ads only" row) and a way back to sign in with the login that runs the ads */
      const noAds = id === 'google' && !opts.some((o) => o.kind === 'ads');
      m.querySelector('.cxb-opts').innerHTML = groups.map(([k, label]) => { const xs = opts.filter((o) => !k || o.kind === k); if (!xs.length) return k === 'ads' ? note(r.adsNote ? `${esc(r.adsNote)} You can still connect Google Analytics below.` : 'There’s no Google Ads account on this Google login, so Google Ads can’t connect with it. Pick a property to connect Google Analytics, or use the login that runs your ads.', 'info') : '';
        const tick = (o) => (multi ? (xs.some((y) => y.own === true) ? o.own === true : xs.length === 1) : xs.length === 1);
        return kick(`${label}${xs.length > 1 ? ` · ${xs.length}` : ''}`) + `<div class="cxb-rows" role="${multi ? 'group' : 'radiogroup'}">${xs.map((o) => row(k || 'acct', o.id, o.name, o.sub, tick(o), o)).join('')}${k === 'ga4' && id === 'google' && !noAds ? row('ga4', '', 'Not now', 'Connect Google Ads only', false) : ''}</div>`; }).join('');
      /* the button says how many: "Use these 3 accounts" */
      const picked = () => [...m.querySelectorAll('input[name="acct"]:checked')].map((i) => ({ id: i.value, name: i.dataset.name }));
      const label = () => { if (!multi) return; const n = picked().length; go.textContent = n > 1 ? `Use these ${n} accounts` : n === 1 ? 'Use this account' : 'Pick an ad account'; };
      if (multi) { label(); m.querySelectorAll('input[name="acct"]').forEach((i) => i.addEventListener('change', label)); }
      if (noAds) { go.textContent = 'Connect Google Analytics'; const gh = m.querySelector('.cxb-gh'); if (gh) { gh.textContent = 'Use another login'; gh.removeAttribute('data-close'); gh.onclick = () => leave(`/connect/${id}/start?brand=${slug}`); } }
      go.onclick = () => { const val = (k) => m.querySelector(`input[name="${k}"]:checked`);
        const choice = GOOG ? { ga4: val('ga4')?.value || null, ga4Name: val('ga4')?.dataset.name, ads: val('ads')?.value || null, adsName: val('ads')?.dataset.name } : multi ? { accounts: picked() } : { account: val('acct')?.value, name: val('acct')?.dataset.name };
        if (!GOOG && !(multi ? choice.accounts.length : choice.account)) return setStat(box0, stat('Pick an ad account first.', 'bad', 'info')); if (GOOG && !choice.ga4 && !choice.ads) return setStat(box0, stat(id === 'ga4' || noAds ? 'Pick a property first.' : 'Pick an Ads account or a property first.', 'bad', 'info'));
        run(m, id, post(`/api/brands/${slug}/connect/${id}`, { action: 'select', choice })); };
    });
  }
  /* disconnecting is for the whole team: the same box asks once, then reads nothing more */
  function unlinkBox(id) {
    const what = id === 'slack' ? ['We stop posting to Slack', 'Replies in our threads stop coming back to the jams', 'You can connect it again any time']
      : ['Cards stop using its live numbers', 'You can connect it again any time'];
    A().modal(shell(box({ id, title: `Disconnect ${esc(nm(id))}?`, line: `For everyone on ${poss()} team.`, body: kick('What happens') + ticks(what), ghost: ghostBtn('Keep it'), go: goBtn('Disconnect', 'data-unlink-go') })), (m) => {
      edges(m);
      const go = m.querySelector('[data-unlink-go]');
      go.onclick = async () => { go.disabled = true; go.innerHTML = '<brew-load class="spin"></brew-load>Disconnecting…';
        const r = await post(`/api/brands/${slug}/connect/${id}`, { action: 'disconnect' });
        /* stay on the page you were on: the connectors redraw in place, no reload (a reload landed on the feed) */
        if (r.ok) { delete L.conns[id]; A().S.conn[id] = false; A().save(); A().closeModal?.(); A().toast?.(`${ic('check', 's16')}${esc(nm(id))} disconnected`);
          refreshLive().then(() => A().refreshAfterConnect?.()).catch(() => {}); return; }
        go.disabled = false; go.textContent = 'Try again'; setStat(m.querySelector('.cxb'), stat(esc(r.error || 'That didn’t go through. Try again.'), 'bad', 'info')); };
    });
  }

  /* ---------- the connectors page: live accounts, sync, disconnect, who can see it ---------- */
  const status = (id) => { const x = L.conns?.[id]; if (!x) return null;
    /* one signal per state: reconnect, then stale, then the sign-in running out, then a failed refresh (rate limits retry on their own) */
    const left = x.daysLeft, warn = x.needsReconnect || (left != null && left < 0) ? '<span class="cn-st is-off" title="Connect it again to bring its numbers back">Sign-in expired: connect again</span>'
      : x.stale ? `<span class="cn-st is-off" title="${esc(`Its last numbers are not used until it reads again${x.staleWhy ? ` (${x.staleWhy})` : ''}`)}">Stale</span>`
      : left != null && left <= 7 ? `<span class="cn-st is-off" title="Connect it again before then so we keep reading it">Sign-in runs out in ${left} day${left === 1 ? '' : 's'}</span>`
      : x.error ? `<span class="cn-st is-off" title="${esc(x.rateLimited ? 'The platform asked us to slow down; we try again on our own' : 'The last refresh did not go through')}">${x.rateLimited ? 'Busy, retrying' : 'Last refresh failed'}</span>` : '';
    if (x.state === 'live') return x.dummy ? `<span class="cn-st is-on is-live"><i></i>Connected</span><span class="dummy-tag">Dummy</span>` : (warn || '<span class="cn-st is-on is-live"><i></i>Live</span>'); /* one pill: the warning replaces Live, never sits beside it */
    if (x.state === 'syncing') return `<span class="cn-st is-on"><i></i>Reading…</span>`;
    return `<span class="cn-st is-off"><i></i>Needs attention</span>`; };
  const footer = (id) => { const x = L.conns?.[id]; if (!x || !member() && x.state !== 'live') return null;
    /* the full account name(s) on hover, always: a long name is cut on the card, and the time read stays in sight */
    const full = (x.accounts || []).length > 1 ? x.accounts.map((a) => a.name || a.id).join(', ') : x.account || nm(id), accts = ` title="${esc(`${full}${x.lastSync ? ` · read ${ago(x.lastSync)}` : ''}`)}"`;
    return `<span class="cn-acct"${accts}>${ic('check', 's14')}<span class="cn-an">${esc(x.account || nm(id))}</span>${x.lastSync ? `<span class="cn-ago">· ${ago(x.lastSync)}</span>` : ''}</span>${member() || L.avail?.[id]?.modes?.includes('public') ? `<button class="cn-btn is-ghost" data-lsync="${id}">Sync now</button>` : ''}${member() && boss() ? `<button class="cn-btn is-ghost" data-lunlink="${id}">Disconnect</button>` : ''}`; };
  const intro = () => { if (!GENB || (!L.signin && !L.me)) return null; const n = B().brand.name;
    if (!L.me) return L.dummy ? `Every source we read for ${n}. <a href="${signin()}">Sign in with Google</a> to connect accounts. Connected accounts are simulated in this demo (Dummy).` : `Every source we read for ${n}. <a href="${signin()}">Sign in with Google</a> to connect ${n}’s real accounts, read-only (Slack posts to the channel you pick).`;
    if (member() && !boss()) return `Every source we read for ${n}. Only ${n}’s admins connect or disconnect accounts; you can sync the connected ones.`;
    if (member()) return L.dummy ? `Every source we read for ${n}. Connected accounts are simulated in this demo (Dummy), built from what we read, and only ${n}’s team sees them.` : `Every source we read for ${n}. Connected accounts are read-only (Slack posts to the channel you pick), refresh every few hours, and only ${n}’s team sees them.`;
    if (L.access?.claimed) return `Every source we read for ${n}. Its team sees the live numbers; here you see the demo. Ask them to invite you.`;
    if (L.access?.eligible) return `Every source we read for ${n}. You’re the first from ${esc(host())}: connect an account and ${n} is yours. <button class="linkish" data-lclaim>Claim it with your email</button>`;
    return `Every source we read for ${n}. Here you see the demo: the first person to sign in with a work email at ${esc(host())} and connect an account becomes its admin.`; };
  function bindPage(root) {
    root.querySelectorAll('[data-lsync]').forEach((b) => b.onclick = async () => { b.disabled = true; b.textContent = 'Reading…'; const r = await post(`/api/brands/${slug}/connect/${b.dataset.lsync}`, { action: 'sync' });
      /* read a few minutes ago, or already reading: said plainly, nothing reloads; a platform asking Brew to slow down is said in plain words */
      if (r.ok && (r.recent || r.busy)) { b.disabled = false; b.textContent = 'Sync now'; A().toast(esc(r.note || 'Read a few minutes ago')); return; }
      if (r.ok) location.reload(); else { b.disabled = false; b.textContent = 'Sync now'; A().toast(esc(r.rateLimited ? `${nm(b.dataset.lsync)} asked us to slow down. We read it again on our own${r.retryAt ? ` after ${new Date(r.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ' shortly'}.` : r.error || 'Could not sync')); } });
    root.querySelectorAll('[data-lunlink]').forEach((b) => b.onclick = () => unlinkBox(b.dataset.lunlink));
    root.querySelectorAll('[data-lclaim]').forEach((b) => b.onclick = claim);
  }
  async function claim() { const r = await post(`/api/brands/${slug}/claim`); if (r.ok) { A().toast(`${ic('check', 's16')}${esc(B().brand.name)} is yours. Connect its accounts to see live numbers.`); setTimeout(() => location.reload(), 900); } else A().toastLong(esc(r.error || 'Could not claim'), 7000); }

  /* ---------- the account button in the rail ---------- */
  /* Your feed (tune what the feed shows you) */
  const tuneRow = () => `<button class="lc-it" data-nav="tune">${ic('sliders', 's16')}<b>Your feed</b><span>Tune it</span></button>`;
  /* ---------- help, privacy and deleting your data: the same rows for everyone (staff, team, visitor, signed out) ---------- */
  const HELLO = 'hello@joinsquareup.com';
  const meMail = () => { const e = L.me?.email; return e && !L.me?.demo && !/@demo\.brew$/i.test(e) ? e : ''; }; /* a demo visitor has no real address */
  const brandTag = () => (GENB ? `${B()?.brand?.name || slug} (${slug})` : '');
  const helpRows = () => `<div class="lc-grp lc-help">
      <a class="lc-it" href="mailto:${HELLO}?subject=${encodeURIComponent(`Help${GENB ? ` · ${brandTag()}` : ''}`)}">${ic('info', 's16')}<b>Help</b><span>Email us</span></a>
      <span class="lc-it lc-legal">${ic('shield', 's16')}<b><a href="/privacy" target="_blank" rel="noopener">Privacy</a> &amp; <a href="/terms" target="_blank" rel="noopener">terms</a></b></span>
      ${meMail() ? `<button class="lc-it" type="button" data-ldelete>${ic('minus', 's16')}<b>Delete my data</b></button>` : ''}</div>`;
  /* "Delete my data" is a real request, handled by hand (Param, 25 Oct): it drafts an email from the person's own mail app to
     the Brew team with the brand and their address; the team deletes and replies. The sheet says exactly that (DUMMY.md row 9) */
  function deleteSheet() {
    const em = meMail(), n = B()?.brand?.name || 'this brand';
    const body = `Please delete my data.\n\nBrand: ${GENB ? brandTag() : 'none'}\nMy email: ${em}\n`;
    const href = `mailto:${HELLO}?subject=${encodeURIComponent(`Delete my data${GENB ? ` · ${slug}` : ''}`)}&body=${encodeURIComponent(body)}`;
    A()?.modal?.(`<div class="sheet del-sheet"><h3>Delete my data</h3>
      <p>This sends a deletion request to our team from your own email. We delete your data within 7 days and reply when it’s done.</p>
      <ul class="del-what"><li>Your sign-in: the name, email and photo Google gave us</li><li>Your saved cards, feed settings and jam messages</li>${GENB ? `<li>If you’re ${esc(n)}’s admin and ask for it: the whole workspace (the read, plays, jams and connected keys)</li>` : ''}</ul>
      <div class="cx-btns"><button class="btn btn-ghost" data-close>Cancel</button><a class="btn btn-primary" href="${esc(href)}" data-close>Email the request</a></div></div>`);
  }
  function menu(btn) {
    document.getElementById('lc-pop')?.remove();
    const pop = document.createElement('div'); pop.id = 'lc-pop'; pop.className = 'lc-pop';
    const r = btn.getBoundingClientRect(); pop.style.left = (r.right + 10) + 'px'; pop.style.bottom = Math.max(12, innerHeight - r.bottom) + 'px'; pop.style.position = 'fixed';
    const ac = L.access, n = B()?.brand?.name || 'this brand';
    const role = ac?.role === 'owner' ? `Owner of ${n}` : ac?.role === 'admin' ? 'Our team · full access' : ac?.role ? `On ${n}’s team` : L.full ? 'Our team · full access' : GENB ? `Visitor · you see ${n}’s demo` : '';
    pop.innerHTML = !L.me ? `<div class="lc-me"><b>Not signed in</b><small>Sign in to read a new brand, claim yours and connect real accounts.</small></div><a class="btn btn-primary sm" href="${signin()}">Sign in with Google</a><div class="lc-grp">${tuneRow()}</div>${window.BrewAcct?.rows?.() || ''}${helpRows()}`
      : `<div class="lc-me">${L.me.pic ? `<img src="${esc(L.me.pic)}" alt="" referrerpolicy="no-referrer">` : ''}<span><b>${esc(L.me.name || L.me.email)}</b><small>${esc(L.me.demo || /@demo\.brew$/i.test(L.me.email || '') ? 'Demo visitor, no email' : L.me.email)}</small>${role ? `<em>${esc(role)}</em>` : ''}</span></div>
        ${GENB && ac?.canClaim ? `<button class="btn btn-primary sm" data-lclaim>Claim ${esc(n)}</button>` : ''}
        ${GENB && ac && !ac.gen ? `<small class="lc-hint">${ac.claimed ? `Ask ${esc(n)}’s team to invite you.` : `Sign in with your work email at ${esc(ac.host || host())} to claim it.`}</small>` : ''}
        ${GENB && ac?.role && ac.role !== 'owner' && ac.role !== 'admin' ? `<div class="lc-views"><small>Your views</small><span>${esc(seatWords(ac.seats))}</span></div>` : ''}
        <div class="lc-grp">${GENB && ac?.role && ac.role !== 'owner' && ac.role !== 'admin' ? `<button class="lc-it" data-lteamsheet>${ic('person', 's16')}<b>Team and invites</b><span>${(ac.team || []).length}</span></button>` : ''}
        ${GENB && (ac?.role === 'owner' || ac?.role === 'admin') ? `<button class="lc-it" data-lteamsheet>${ic('person', 's16')}<b>Team and access</b><span>${(ac.members || []).length}${(ac.members || []).filter((x) => Array.isArray(x.seats) && !x.seats.length).length ? ' · needs you' : ''}</span></button>` : ''}
        ${tuneRow()}</div>${window.BrewAcct?.rows?.() || ''}${helpRows()}
        ${L.me.demo || /@demo\.brew$/i.test(L.me.email || '') ? '' : `<a class="lc-out" href="/auth/logout?next=${encodeURIComponent(location.pathname)}">Sign out</a>`}`; /* a demo visitor's session is the tour: Sign out did nothing there, Start again covers it (QA 19 Oct) */
    document.body.appendChild(pop); bindPage(pop); window.BrewAcct?.bind?.(pop);
    pop.querySelector('[data-nav="tune"]')?.addEventListener('click', () => pop.remove()); /* the app's nav opens the page */
    pop.querySelector('[data-lteamsheet]')?.addEventListener('click', () => { pop.remove(); teamSheet(); });
    pop.querySelector('[data-ldelete]')?.addEventListener('click', () => { pop.remove(); deleteSheet(); });
    setTimeout(() => document.addEventListener('click', function off(e) { if (!pop.contains(e.target) && e.target !== btn) { pop.remove(); document.removeEventListener('click', off); } }), 0);
  }
  /* ---------- the team: invite by email, pick each person's views, change the admin ---------- */
  const SEATS = () => Object.entries(B()?.roles || {});
  const seatWords = (seats) => (seats == null || seats === 'all' ? 'Every view' : seats.length ? seats.map((k) => B()?.roles?.[k]?.title || k).join(', ') : 'No views yet');
  const seatShort = (seats) => (seats == null || seats === 'all' ? 'Every view' : !seats.length ? 'Pick views' : seats.length === 1 ? (B()?.roles?.[seats[0]]?.title || seats[0]) : `${seats.length} views`);
  /* view chips: a small agent face (the 30px face, scaled) and the seat title; on = filled */
  const BOSS = () => ['owner', 'admin'].includes(L.access?.role);
  /* the views this person may hand out: every view for an admin, their own for a teammate */
  const OKSEATS = () => { const s0 = L.access?.seats; return SEATS().filter(([k]) => BOSS() || s0 == null || s0 === 'all' || s0.includes(k)); };
  const chips = (sel, attr, list = SEATS()) => `<div class="tm-chips" role="group" aria-label="Views">${list.map(([k, r]) => { const on = sel === 'all' || (Array.isArray(sel) && sel.includes(k)); return `<button type="button" class="tm-chip${on ? ' is-on' : ''}" aria-pressed="${on}" ${attr}="${k}"><span class="tm-face">${A()?.face?.(r.face) || ''}</span>${esc(r.title)}</button>`; }).join('')}</div>`;
  const initials = (x) => (x.name || x.email || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const TS = { draft: ['growth'], open: null, edit: null, busy: false, msg: null, email: '' };
  function teamHtml() {
    const ac = L.access || {}, me = ac.me || L.me?.email, owners = (ac.members || []).filter((x) => x.role === 'owner'), iAmOwner = owners.some((o) => o.email === me);
    const av = (x) => x.pic ? `<img class="tm-av" src="${esc(x.pic)}" alt="" referrerpolicy="no-referrer">` : `<span class="tm-av" aria-hidden="true">${esc(initials(x))}</span>`;
    const who = (x, sub) => `${av(x)}<span class="tm-who"><b>${esc(x.name || x.email)}${x.email === me ? ' <i>(you)</i>' : ''}</b><small>${esc(sub ?? (x.name ? x.email : ''))}</small></span>`;
    const person = (x) => { if (x.via === 'Brew' && x.role === 'admin') return `<li class="tm-p"><div class="tm-line">${who(x)}<span class="tm-role">Our team</span><span class="tm-mw"></span></div></li>`; /* Brew's own people: shown, never edited here */
      const own = x.role === 'owner', none = Array.isArray(x.seats) && !x.seats.length, open = TS.open === x.email, edit = TS.edit === x.email && !own;
      /* the only admin: removing it would leave the brand with none, so the menu says so and offers the hand-over right here */
      const heirs = (ac.members || []).filter((y) => y.role !== 'owner' && !(y.via === 'Brew' && y.role === 'admin'));
      const menu = own ? (owners.length > 1 ? `<button role="menuitem" data-top="step_down|${esc(x.email)}">${x.email === me ? 'Step down as admin' : 'Remove admin rights'}</button>${x.email !== me ? `<button role="menuitem" class="is-bad" data-top="remove|${esc(x.email)}">Remove from team</button>` : ''}`
        : `<p class="tm-hint">A brand always has an admin. ${heirs.length ? 'Hand it to someone, or make them admin too, then remove this one.' : 'Invite someone first, then hand it over.'}</p>${x.email === me ? heirs.map((y) => `<button role="menuitem" data-top="transfer|${esc(y.email)}">Hand admin to ${esc(y.name || y.email)}</button>`).join('') : ''}`)
        : `<button role="menuitem" data-top="make_owner|${esc(x.email)}">Make admin too</button>${iAmOwner ? `<button role="menuitem" data-top="transfer|${esc(x.email)}">Make admin instead of me</button>` : ''}<button role="menuitem" class="is-bad" data-top="remove|${esc(x.email)}">Remove from team</button>`;
      return `<li class="tm-p${edit ? ' is-edit' : ''}"><div class="tm-line">${who(x)}
        ${own ? '<span class="tm-role">Admin</span>' : `<button class="tm-views${none ? ' is-wait' : ''}" data-tedit="${esc(x.email)}" aria-expanded="${edit}">${esc(seatShort(x.seats ?? 'all'))}${ic('chev', 's14')}</button>`}
        ${menu ? `<span class="tm-mw"><button class="tm-more" data-tmore="${esc(x.email)}" aria-label="More for ${esc(x.email)}" aria-expanded="${open}">${ic('more', 's16') || '•••'}</button>${open ? `<div class="tm-menu" role="menu">${menu}</div>` : ''}</span>` : '<span class="tm-mw"></span>'}</div>
        ${edit ? `<div class="tm-edit">${chips(x.seats ?? 'all', `data-tseat="${esc(x.email)}" data-k`)}</div>` : ''}</li>`; };
    const teamHead = () => `<div class="sheet tm-sheet" role="dialog" aria-labelledby="tm-title">
      <header class="tm-head"><div><h3 id="tm-title">${BOSS() ? 'Team and access' : 'Your team'}</h3><p>${BOSS() ? 'Everyone sees only the cards for the views you give them.' : 'Invite people to the views you have. An admin can change them later.'}</p></div><button class="tm-x" data-close aria-label="Close">${ic('x', 's16')}</button></header>
      <form class="tm-invite" data-tinv novalidate>
        <div class="tm-row1"><input id="tm-email" type="email" placeholder="Invite by email" autocomplete="off" aria-label="Email to invite" value="${esc(TS.email)}"><button class="btn btn-primary tm-send">Send invite</button></div>
        <div class="tm-can"><span>Can see</span>${chips(TS.draft, 'data-tdraft', OKSEATS())}</div>
        <p class="tm-msg" role="status" ${TS.msg ? '' : 'hidden'} data-kind="${TS.msg?.kind || ''}">${esc(TS.msg?.text || '')}</p>
      </form>
`;
    const invs = ac.invites || [], mems = ac.members || [];
    if (!BOSS()) { const team = ac.team || []; /* a teammate sees who is on the team, nothing to edit */
      return teamHead() + `<div class="tm-people">${team.length ? `<h4>People · ${team.length}</h4><ul class="tm-list">${team.map((x) => `<li class="tm-p"><div class="tm-line">${who(x)}<span class="tm-role">${x.role === 'owner' ? 'Admin' : ''}</span><span class="tm-mw"></span></div></li>`).join('')}</ul>` : ''}</div></div>`; }
    return teamHead() + `      <div class="tm-people">
        ${mems.length ? `<h4>People · ${mems.length}</h4><ul class="tm-list">${mems.map(person).join('')}</ul>` : ''}
        ${invs.length ? `<h4>Invited · ${invs.length}</h4><ul class="tm-list">${invs.map((v) => { const edit = TS.edit === 'i:' + v.email; return `<li class="tm-p${edit ? ' is-edit' : ''}"><div class="tm-line">${who({ email: v.email }, `Sent ${ago(v.at)}`)}<button class="tm-views" data-tedit="i:${esc(v.email)}" aria-expanded="${edit}">${esc(seatShort(v.seats ?? 'all'))}${ic('chev', 's14')}</button><span class="tm-acts"><button class="tm-link" data-top="resend|${esc(v.email)}">Resend</button><button class="tm-link" data-top="revoke|${esc(v.email)}">Cancel</button></span></div>${edit ? `<div class="tm-edit">${chips(v.seats ?? 'all', `data-tiseat="${esc(v.email)}" data-k`)}</div>` : ''}</li>`; }).join('')}</ul>` : ''}
      </div></div>`;
  }
  /* only the people list re-renders; the invite form keeps its focus, text and chips */
  function teamPeople() { const host = document.querySelector('.tm-people'); if (!host) return; const tmp = document.createElement('div'); tmp.innerHTML = teamHtml(); host.replaceWith(tmp.querySelector('.tm-people')); teamBindPeople(document.querySelector('.tm-sheet')); }
  const tmMsg = (m, kind, text) => { TS.msg = text ? { kind, text } : null; const el = m.querySelector('.tm-msg'); if (!el) return; el.hidden = !text; el.dataset.kind = kind || ''; el.textContent = text || ''; };
  const tmPost = async (b) => { const r = await post(`/api/brands/${slug}/team`, b); if (r.members || r.team) L.access = { ...L.access, ...r }; return r; };
  const tog = (arr, k) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  const flip = (b, on) => { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); };
  function teamBind(m) {
    const me = () => L.access?.me || L.me?.email, input = m.querySelector('#tm-email'), send = m.querySelector('.tm-send');
    input.oninput = () => { TS.email = input.value; if (TS.msg?.kind === 'bad') tmMsg(m); };
    m.querySelectorAll('[data-tdraft]').forEach((b) => b.onclick = () => { TS.draft = tog(TS.draft, b.dataset.tdraft); flip(b, TS.draft.includes(b.dataset.tdraft)); if (TS.msg?.kind === 'bad') tmMsg(m); });
    m.querySelector('[data-tinv]').onsubmit = async (e) => {
      e.preventDefault(); if (TS.busy) return;
      const email = input.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) { tmMsg(m, 'bad', 'Enter a full email address.'); return input.focus(); }
      if (email === me()) { tmMsg(m, 'bad', 'That’s you. You’re already on the team.'); return input.focus(); }
      if ([...(L.access?.members || []), ...(L.access?.team || [])].some((x) => x.email === email)) { tmMsg(m, 'bad', `${email} is already on the team. Change their views below.`); return; }
      if (!TS.draft.length) return tmMsg(m, 'bad', 'Pick at least one view they can see.');
      TS.busy = true; send.disabled = true; send.textContent = 'Sending…';
      const r = await tmPost({ action: 'invite', email, seats: TS.draft });
      TS.busy = false; send.disabled = false; send.textContent = 'Send invite';
      if (r.error) return tmMsg(m, 'bad', r.error);
      TS.email = ''; input.value = ''; TS.link = r.link || null; tmMsg(m, r.warn ? 'warn' : 'ok', r.warn || `Invite sent to ${email}. They’ll see ${seatWords(TS.draft)}.`); teamPeople(); teamLink(m);
    };
    teamBindPeople(m);
  }
  function teamBindPeople(m) {
    const me = L.access?.me || L.me?.email, all = () => SEATS().map(([k]) => k), act = async (b, btn) => { if (btn) btn.disabled = true; const r = await tmPost(b); if (r.error) tmMsg(m, 'bad', r.error); else if (TS.msg?.kind === 'bad') tmMsg(m); teamPeople(); return r; };
    m.querySelectorAll('[data-tedit]').forEach((b) => b.onclick = () => { TS.edit = TS.edit === b.dataset.tedit ? null : b.dataset.tedit; TS.open = null; teamPeople(); });
    m.querySelectorAll('[data-tiseat]').forEach((b) => b.onclick = async () => { const e = b.dataset.tiseat, v = (L.access.invites || []).find((y) => y.email === e); if (!v) return; const cur = v.seats === 'all' || v.seats == null ? all() : v.seats, next = tog(cur, b.dataset.k);
      flip(b, next.includes(b.dataset.k)); const r = await tmPost({ action: 'seats', email: e, seats: next }); if (r.error) { flip(b, cur.includes(b.dataset.k)); tmMsg(m, 'bad', r.error); }
      const btn = m.querySelector(`[data-tedit="i:${CSS.escape(e)}"]`); if (btn && !r.error) btn.firstChild.textContent = seatShort(next); });
    m.querySelectorAll('[data-tseat]').forEach((b) => b.onclick = async () => { const e = b.dataset.tseat, x = (L.access.members || []).find((y) => y.email === e); if (!x) return; const cur = x.seats === 'all' || x.seats == null ? all() : x.seats, next = tog(cur, b.dataset.k);
      flip(b, next.includes(b.dataset.k)); const r = await tmPost({ action: 'seats', email: e, seats: next }); if (r.error) { flip(b, cur.includes(b.dataset.k)); tmMsg(m, 'bad', r.error); }
      const btn = m.querySelector(`[data-tedit="${CSS.escape(e)}"]`); if (btn) { btn.firstChild.textContent = seatShort(next); btn.classList.toggle('is-wait', !next.length); } });
    m.querySelectorAll('[data-tmore]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); TS.open = TS.open === b.dataset.tmore ? null : b.dataset.tmore; teamPeople(); });
    m.querySelectorAll('[data-top]').forEach((b) => b.onclick = async () => { const [action, email] = b.dataset.top.split('|'); TS.open = null;
      if (action === 'remove' && !confirm(`Remove ${email} from the team?`)) return teamPeople();
      if (action === 'transfer') { if (!confirm(`Make ${email} the admin instead of you? You keep every view until they change yours.`)) return teamPeople(); return act({ action: 'transfer', email }, b); }
      if (action === 'step_down') return act({ action, email, seats: all() }, b);
      if (action === 'resend') { b.disabled = true; b.textContent = 'Sending…'; const r = await tmPost({ action, email }); TS.link = r.link || null; tmMsg(m, r.error ? 'bad' : r.warn ? 'warn' : 'ok', r.error || r.warn || `Sent again to ${email}.`); teamPeople(); return teamLink(m); }
      act({ action, email }, b); });
  }
  /* the invite link, when the email didn't go (or was just sent): the admin sends it themselves */
  function teamLink(m) { m.querySelector('.tm-copy')?.remove(); if (!TS.link) return; const el = m.querySelector('.tm-msg'); el?.insertAdjacentHTML('afterend', `<button type="button" class="btn btn-ghost sm tm-copy" data-tcopy>${ic('link', 's14')}Copy the invite link</button>`);
    m.querySelector('[data-tcopy]').onclick = async (e) => { try { await navigator.clipboard.writeText(TS.link); e.currentTarget.textContent = 'Link copied'; } catch { prompt('Copy the invite link', TS.link); } }; }
  function teamSheet() { const ok = OKSEATS().map(([k]) => k); TS.draft = TS.draft.filter((k) => ok.includes(k)); if (!TS.draft.length && ok[0]) TS.draft = [ok[0]]; TS.link = null; TS.msg = null; TS.open = null; TS.edit = null; A().modal(teamHtml(), (m) => teamBind(m.querySelector('.tm-sheet'))); setTimeout(() => document.querySelector('#tm-email')?.focus(), 50); }



  window.LiveConn = { boss: () => !L.me || boss(), isReady: () => !!L.ready, simId, teamSheet, seatWords, open, overlay, resume, status, footer, intro, bindPage, menu, helpRows, deleteSheet, claim, isLive, get L() { return L; }, gen: GENB, signin };
})();
