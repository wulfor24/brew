// Connected accounts and the brand's team.
// On the live site connecting is real (connectors/index.js): one-click sign-in where the platform allows it, or a pasted
// read-only key, then an account picker for Meta and Google. What an account returns is only shown to the brand's team.
// DUMMY: on the demo site (L.dummy) and for Slack every account is simulated from the brand's public read; the sheet and
// the cards say so (Dummy tag). See DUMMY.md.
// Also real: Google sign-in, who may connect (the brand's team, or the first official email, who claims the brand),
// and the team sheet (views, invites, owners).
(() => {
  const slug = window.BRAND, GENB = !!slug && slug !== 'brew';
  const L = (window.LIVE = { me: null, access: null, conns: {}, avail: {}, ready: false });
  const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
  window.LIVE_P = (async () => {
    try { const r = await Promise.race([fetch(GENB ? `/api/brands/${slug}/live` : '/api/me', { credentials: 'same-origin' }).then((x) => x.json()), timeout(2500).then(() => null)]); if (r) Object.assign(L, r, { user: r.me || r.user || null }); }
    catch (e) {} L.me = L.me || L.user || null; L.ready = true; return L;
  })();
  const A = () => window.__BREW;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, c) => A()?.ic?.(n, c) || '';
  const post = (p, b) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch(() => ({ error: 'You look offline. Try again.' }));
  const get = (p) => fetch(p, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
  const here = (h = '') => `/${slug}${h}`;
  /* the platform's sign-in leaves the page: remember the screen it started from, so the way back lands there, not on the first screen */
  const BACK = `brew-cxback:${slug}`;
  const leave = (url) => { try { sessionStorage.setItem(BACK, A()?.view || ''); } catch (e) {} location.href = url; };
  const keepPlace = (m) => m.querySelectorAll('a[href^="/auth/"]').forEach((a) => a.addEventListener('click', () => { try { sessionStorage.setItem(BACK, A()?.view || ''); } catch (e) {} }));
  const logo = (id) => A()?.glyph?.(id, 52) || `<span class="lc-gl">${esc(nm(id).slice(0, 1))}</span>`;
  const pair = (id) => `<div class="cx-pair"><span class="cx-so"><img src="/assets/brew-mark.svg" alt=""></span><span class="cx-link" aria-hidden="true"><i></i><i></i><i></i></span>${logo(id)}</div>`;
  const askAdmin = (id) => `${pair(id)}<header class="cx-head"><h3>${esc(nm(id))} is connected by an admin</h3><p>Only ${esc(B().brand.name)}’s admins connect or disconnect accounts. Ask ${esc(adminName())} to connect it; once it’s on, you can sync it any time.</p></header><div class="cx-btns"><button class="btn btn-primary" data-close>Got it</button></div>`;
  const setupView = () => ['ob', 'setup', 'check', 'wait', 'start'].includes(A()?.view);
  const signin = (next) => `/auth/google?next=${encodeURIComponent(next || location.pathname + location.search + location.hash)}`;
  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60e3); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const member = () => !!L.access?.role;
  /* connecting and disconnecting are for the brand's admins; a teammate syncs what is connected (the server enforces it too) */
  const boss = () => !L.access?.role || ['owner', 'admin'].includes(L.access.role);
  const adminName = () => (L.access?.team || []).find((x) => x.role === 'owner')?.name || 'your admin';
  const isLive = (id) => L.conns?.[id]?.state === 'live' && (L.conns[id].stats || []).length > 0;
  const B = () => A()?.B || window.FEED_DATA?.[slug];
  const nm = (id) => B()?.connectors?.[id]?.name || id;
  const host = () => L.access?.host || B()?.brand?.host || '';

  /* ---------- at boot: real accounts replace the demo numbers on the connectors ---------- */
  function overlay(Bd, S) {
    if (!GENB || !Bd?.connectors) return;
    for (const [id, x] of Object.entries(L.conns || {})) {
      const c = Bd.connectors[id]; if (!c) continue;
      if (x.state === 'live' && x.stats?.length) { Bd.connectors[id] = { ...c, stats: x.stats, changed: x.changed?.length ? x.changed : c.changed, demo: false, live: true, account: x.account || c.account }; S.conn[id] = true; (S.realConn ||= {})[id] = true; }
    }
    /* a real account that was disconnected: its switch goes off too, instead of quietly falling back to the demo */
    if (L.conns) for (const id of Object.keys(S.realConn || {})) if (!(L.conns[id]?.state === 'live')) { delete S.realConn[id]; S.conn[id] = false; }
    /* on the live site a real account is on only when the server says so: an old simulated switch saved in this browser goes off */
    if (L.avail && L.dummy === false) for (const id of Object.keys(Bd.connectors)) if (L.avail[id] && !L.avail[id].dummy && L.conns?.[id]?.state !== 'live' && S.conn[id]) S.conn[id] = false;
    // the brand's own team sees what each account does in plain words, not the demo's made-up numbers
    if (member()) for (const [id, c] of Object.entries(Bd.connectors)) if (!c.live && !S.conn[id] && c.changedPlain?.length) Bd.connectors[id] = { ...c, changed: c.changedPlain };
  }

  /* ---------- the connect sheet ---------- */
  const simId = (id) => !!(L.dummy || L.avail?.[id]?.dummy || !L.avail?.[id]);
  const open = (id, opts = {}) => (simId(id) ? openSim(id, opts) : openReal(id, opts));
  // a real account: sign in with the platform, or paste a read-only key
  function openReal(id, opts = {}) {
    if (!GENB || (!L.signin && !L.me)) return false;
    const av = L.avail[id], x = L.conns?.[id], n = B().brand.name, poss = `${esc(n)}${/s$/i.test(n || '') ? '’' : '’s'}`;
    const head = (h, p) => `<div class="cx-pair"><span class="cx-so"><img src="/assets/brew-mark.svg" alt=""></span><span class="cx-link" aria-hidden="true"><i></i><i></i><i></i></span>${logo(id)}</div><header class="cx-head"><h3>${h}</h3><p>${p}</p></header>`;
    const fine = `<small class="cx-fine">${ic('lock', 's14')}<span>Read-only. Keys and tokens are encrypted and never shown. Only ${poss} team sees what comes back.</span></small>`;
    let body;
    if (!L.me) body = `${head(`Connect ${esc(nm(id))}`, `Sign in with Google first, so the numbers stay with ${poss} team.`)}
      <div class="cx-btns"><a class="btn btn-primary" href="${signin(here(`#v=connectors&cx=${id}`))}">Sign in with Google</a></div>${fine}`;
    else if (L.access && !L.access.gen) { const h = esc(L.access.host || host());
      body = `${head(L.access.claimed ? `${poss} team connects its accounts` : 'Connect with your work email', L.access.claimed ? `${esc(n)} is on Brew. Ask its team to invite you.` : `You’re signed in as ${esc(L.me.email)}. Sign in with your work email at ${h}: the first person from ${h} to connect an account becomes ${poss} admin.`)}
      <div class="cx-btns"><a class="btn btn-primary" href="/auth/logout?next=${encodeURIComponent(signin(here(`#v=connectors&cx=${id}`)))}">Switch to your work email</a></div>`; }
    else if (!boss()) body = askAdmin(id);
    else {
      const claimNote = !L.access?.claimed && L.access?.eligible ? `<p class="lc-note">${ic('sparkles', 's14')}<span>You’re the first from ${esc(host())}: connecting makes you ${poss} admin on Brew.</span></p>` : '';
      const err = x?.error ? `<p class="lc-err">${esc(x.error)}</p>` : x?.why ? `<p class="lc-note"><span>${esc(x.why)}</span></p>` : '';
      const oauth = av.modes.includes('oauth') && av.oauth, key = av.modes.includes('key') && av.fields?.length;
      let action;
      if (av.modes.includes('public')) action = av.ready ? `<div class="cx-btns"><button class="btn btn-primary" data-pub>Read the listings now</button></div>` : `<p class="lc-err">The marketplace read is off on this server right now.</p>`;
      else if (!oauth && !key) action = `<p class="lc-note"><span>Connecting ${esc(nm(id))} is being switched on. Brew’s team will send you a link to connect it.</span></p>`;
      else {
        const shopF = id === 'shopify' && oauth ? `<label class="lc-f"><small>Store address</small><input data-shop value="${esc(L.shop || '')}" placeholder="your-store.myshopify.com"></label>` : '';
        const shopHelp = id === 'shopify' ? `<p class="lc-note"><span>In the Shopify Dev Dashboard, create an app for your store with read_products, read_inventory, read_orders and read_customers, install it, then paste its Client ID and Secret here.</span></p>` : '';
        const help = av.help ? `<p class="lc-note"><span>${esc(av.help)}</span></p>` : '';
        const keyForm = key ? `<details class="lc-key"${oauth ? '' : ' open'}><summary>${oauth ? (id === 'shopify' ? 'Or use your own app' : id === 'google' ? 'Or GA4 only, by property ID' : 'Or paste a key') : id === 'google' ? 'Connect GA4' : 'Paste the key'}</summary>${shopHelp}${help}
          ${av.fields.map((f) => `<label class="lc-f"><small>${esc(f.label)}</small><input data-k="${f.k}" ${f.secret ? 'type="password" autocomplete="off"' : ''} placeholder="${esc(f.hint || '')}" ${f.k === 'shop' ? `value="${esc(L.shop || '')}"` : ''}></label>`).join('')}
          <button class="btn btn-primary sm" data-key>Connect</button></details>` : '';
        action = `${oauth ? `${shopF}<div class="cx-btns"><button class="btn btn-primary" data-oauth>Connect with ${esc(nm(id).split(' ')[0])}</button></div>` : ''}${keyForm}`;
      }
      body = `${head(`Connect ${esc(nm(id))}`, esc(opts.why || `Brew reads it to put ${n}’s real numbers on the cards.`))}${claimNote}${err}${action}${fine}`;
    }
    A().modal(`<div class="sheet cx-sheet lc-sheet"><div class="cx-step" data-s="1">${body}</div><div class="cx-step" data-s="2" hidden><div class="cx-pair sm"><b>Reading ${esc(nm(id))}</b></div><ol class="cx-log"><li><span class="spin"></span>Connecting and reading the last 30 days</li></ol></div><div class="cx-step" data-s="3" hidden></div></div>`, (m) => {
      const $ = (q) => m.querySelector(q); keepPlace(m);
      $('[data-oauth]')?.addEventListener('click', () => { const shop = $('[data-shop]')?.value?.trim(); if (id === 'shopify' && !shop) { $('[data-shop]').focus(); return; } leave(`/connect/${id}/start?brand=${slug}${shop ? `&shop=${encodeURIComponent(shop)}` : ''}`); });
      $('[data-key]')?.addEventListener('click', () => { const fields = Object.fromEntries([...m.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()]).filter(([, v]) => v)); run(m, id, post(`/api/brands/${slug}/connect/${id}`, { action: 'key', fields }), opts); });
      $('[data-pub]')?.addEventListener('click', () => run(m, id, post(`/api/brands/${slug}/connect/${id}`, { action: 'sync' }), opts));
    });
    return true;
  }
  // DUMMY: a simulated account (demo site, Slack)
  function openSim(id, opts = {}) {
    if (!GENB || (!L.signin && !L.me)) return false;
    const n = B().brand.name, poss = `${esc(n)}${/s$/i.test(n || '') ? '’' : '’s'}`;
    const head = (h, p) => `<div class="cx-pair"><span class="cx-so"><img src="/assets/brew-mark.svg" alt=""></span><span class="cx-link" aria-hidden="true"><i></i><i></i><i></i></span>${logo(id)}</div><header class="cx-head"><h3>${h}</h3><p>${p}</p></header>`;
    const dummy = `<p class="lc-note is-dummy"><span class="dummy-tag">Dummy</span><span>A simulated ${esc(nm(id))} account, built from what Brew read about ${esc(n)}. No real account is connected or changed.</span></p>`;
    let body;
    if (!L.me) body = `${head(`Connect ${esc(nm(id))}`, `Sign in with Google first, so the numbers stay with ${poss} team.`)}${dummy}
      <div class="cx-btns"><a class="btn btn-primary" href="${signin(here(`#v=connectors&cx=${id}`))}">Sign in with Google</a></div>`;
    else if (L.access && !L.access.gen) { const h = esc(L.access.host || host());
      body = `${head(L.access.claimed ? `${poss} team connects its accounts` : 'Connect with your work email', L.access.claimed ? `${esc(n)} is on Brew. Ask its team to invite you; until then you see the demo.` : `You’re signed in as ${esc(L.me.email)}. Sign in with your work email at ${h}: the first person from ${h} to connect an account becomes ${poss} admin.`)}
      <div class="cx-btns"><a class="btn btn-primary" href="/auth/logout?next=${encodeURIComponent(signin(here(`#v=connectors&cx=${id}`)))}">Switch to your work email</a></div>`; }
    else if (!boss()) body = askAdmin(id);
    else {
      const claimNote = !L.access?.claimed && L.access?.eligible ? `<p class="lc-note">${ic('sparkles', 's14')}<span>You’re the first from ${esc(host())}: connecting makes you ${poss} admin on Brew.</span></p>` : '';
      body = `${head(`Connect ${esc(nm(id))}`, esc(opts.why || `Brew reads it to put ${n}’s numbers on the cards.`))}${dummy}${claimNote}<div class="cx-btns" style="justify-content:center"><button class="btn btn-primary" data-dm>Connect ${esc(nm(id).split(' ')[0])}</button></div>`;
    }
    A().modal(`<div class="sheet cx-sheet lc-sheet"><div class="cx-step" data-s="1">${body}</div><div class="cx-step" data-s="2" hidden><div class="cx-pair sm"><b>Reading ${esc(nm(id))}</b></div><ol class="cx-log"><li><span class="spin"></span>Connecting and reading the last 30 days</li></ol></div><div class="cx-step" data-s="3" hidden></div></div>`, (m) => {
      keepPlace(m); m.querySelector('[data-dm]')?.addEventListener('click', () => run(m, id, Promise.all([post(`/api/brands/${slug}/connect/${id}`, { action: 'connect' }), timeout(1600)]).then(([r]) => r), opts));
    });
    return true;
  }
  // reading the account: the spinner, then what came back
  async function run(m, id, p, opts = {}) {
    const s = (n) => m.querySelector(`[data-s="${n}"]`); s(1).hidden = true; s(2).hidden = false;
    const r = await p;
    if (!r?.ok) { s(2).hidden = true; s(1).hidden = false; let e = s(1).querySelector('.lc-err'); if (!e) { e = document.createElement('p'); e.className = 'lc-err'; s(1).querySelector('.cx-head').after(e); } e.textContent = r?.error || 'Could not connect.'; return; }
    s(2).hidden = true; s(3).hidden = false; s(3).innerHTML = result(id, r);
    const see = s(3).querySelector('[data-see]');
    /* during onboarding, stay on the step: a page load would start the onboarding again from the first screen */
    if (setupView()) { L.conns[id] = { ...r, state: r.state || 'live' }; overlay(B(), A().S); A().S.conn[id] = true; A().save(); A().cxDone?.(id);
      see.textContent = 'Continue'; see.onclick = () => A().closeModal(); return; }
    see.onclick = () => { A().closeModal(); location.href = here(opts.then ? location.hash : ''); };
  }
  const result = (id, r) => `<span class="plan-check">${ic('check')}</span><h3>${esc(nm(id))} is connected</h3>${r.claimed ? `<p class="lc-note">${ic('sparkles', 's14')}<span>You are now ${esc(B().brand.name)}${/s$/i.test(B().brand.name || '') ? '’' : '’s'} owner on Brew. Teammates with the same company email join on their own.</span></p>` : ''}
    ${(r.stats || []).length ? `<div class="cx-read"><small>What Brew read ${simId(id) || r.dummy ? '<span class="dummy-tag">Dummy</span>' : '<em class="is-live">Live</em>'}</small><dl>${r.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>` : ''}
    ${(r.changed || []).length ? `<p class="sh-p">Here is what changed in your feed:</p><ul class="cx-changed">${r.changed.map((t) => `<li>${ic('sparkles', 's14')}${esc(t)}</li>`).join('')}</ul>` : ''}
    ${r.why ? `<p class="lc-note"><span>${esc(r.why)}</span></p>` : ''}${(r.notes || []).length ? `<ul class="lc-notes">${r.notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <button class="btn btn-primary" data-see>See it in the feed</button>`;

  /* ---------- back from the account's own sign-in (#v=connectors&cx=meta&pick=1 | done=1 | cxerr=…) ---------- */
  async function resume() {
    if (!GENB) return; const hp = Object.fromEntries(location.hash.replace(/^#/, '').split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, ''] : [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
    const id = hp.cx; if (!id && !hp.cxerr) return;
    history.replaceState(history.state, '', location.pathname + '#v=connectors');
    if (hp.cxerr) { A().toastLong(`${ic('info', 's16')}${esc(hp.cxerr)}`, 8000); if (id) setTimeout(() => open(id), 300); return; }
    if (hp.pick) return pick(id);
    if (hp.done && L.conns[id]) { A().modal(`<div class="sheet cx-sheet lc-sheet"><div class="cx-step">${result(id, { ...L.conns[id], claimed: L.access?.role === 'owner' && L.access?.members?.length === 1 })}</div></div>`, (m) => { const see = m.querySelector('[data-see]');
      if (setupView()) { A().S.conn[id] = true; A().save(); A().cxDone?.(id); see.textContent = 'Continue'; see.onclick = () => A().closeModal(); return; }
      see.onclick = () => { A().closeModal(); location.href = here(); }; }); return; }
    if (id && !A().conn(id)) setTimeout(() => A().openConnect(id), 300);
  }
  // Meta: which ad account; Google: which GA4 property and which Ads account
  async function pick(id) {
    const n = B().brand.name;
    if (!boss()) return A().modal(`<div class="sheet cx-sheet lc-sheet"><div class="cx-step">${askAdmin(id)}</div></div>`);
    A().modal(`<div class="sheet cx-sheet lc-sheet"><div class="cx-step" data-s="1">${pair(id)}<header class="cx-head"><h3>Which ${id === 'google' ? 'accounts' : 'ad account'}?</h3><p>Pick the one that is ${esc(n)}${/s$/i.test(n || '') ? '’' : '’s'}.</p></header><div class="lc-opts"><span class="spin"></span></div></div><div class="cx-step" data-s="2" hidden><ol class="cx-log"><li><span class="spin"></span>Reading the last 30 days</li></ol></div><div class="cx-step" data-s="3" hidden></div></div>`, async (m) => {
      const r = await get(`/api/brands/${slug}/connect/${id}/options`), box = m.querySelector('.lc-opts'), opts = r.options || [];
      if (!opts.length) { box.innerHTML = `<p class="lc-err">${esc(r.error || 'No accounts came back for this login.')}</p><div class="cx-btns"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-again>Try again</button></div>`; box.querySelector('[data-again]').onclick = () => leave(`/connect/${id}/start?brand=${slug}`); return; }
      const groups = id === 'google' ? [['ga4', 'Google Analytics 4 property'], ['ads', 'Google Ads account']] : [[null, 'Ad account']];
      box.innerHTML = groups.map(([k, label]) => { const xs = opts.filter((o) => !k || o.kind === k); if (!xs.length) return k === 'ads' ? '<p class="lc-note"><span>No Google Ads account on this login. GA4 alone works.</span></p>' : '';
        const row = (name, val, nm2, sub, on) => `<label class="cx-acct lc-opt"><input type="radio" name="${name}" value="${esc(val)}" data-name="${esc(nm2)}"${on ? ' checked' : ''}><i class="lc-radio" aria-hidden="true"></i><span class="cx-acct-t"><b>${esc(nm2)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
        return `<fieldset class="lc-pick"><legend>${label}${xs.length > 1 ? ` <em>${xs.length}</em>` : ''}</legend><div class="lc-list">${xs.map((o) => row(k || 'acct', o.id, o.name, o.sub, xs.length === 1)).join('')}${k === 'ads' ? row('ads', '', 'Skip Google Ads', 'Connect GA4 only', false) : ''}</div></fieldset>`; }).join('') + '<div class="cx-btns lc-bar"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-go>Connect</button></div>';
      const go = m.querySelector('[data-go]'), ready = () => { go.disabled = id === 'google' ? !m.querySelector('input[name="ga4"]:checked, input[name="ads"]:checked:not([value=""])') : !m.querySelector('input[name="acct"]:checked'); };
      ready(); box.addEventListener('change', ready);
      m.querySelector('[data-close]')?.addEventListener('click', () => A().closeModal());
      m.querySelector('[data-go]').onclick = () => { const val = (k) => m.querySelector(`input[name="${k}"]:checked`);
        const choice = id === 'google' ? { ga4: val('ga4')?.value || null, ga4Name: val('ga4')?.dataset.name, ads: val('ads')?.value || null, adsName: val('ads')?.dataset.name } : { account: val('acct')?.value, name: val('acct')?.dataset.name };
        if (id !== 'google' && !choice.account) return A().toast('Pick an ad account'); if (id === 'google' && !choice.ga4 && !choice.ads) return A().toast('Pick a property or an Ads account');
        run(m, id, post(`/api/brands/${slug}/connect/${id}`, { action: 'select', choice })); };
    });
  }

  /* ---------- the connectors page: live accounts, sync, disconnect, who can see it ---------- */
  const status = (id) => { const x = L.conns?.[id]; if (!x) return null;
    if (x.state === 'live') return x.dummy ? `<span class="cn-st is-on is-live"><i></i>Connected</span><span class="dummy-tag">Dummy</span>` : `<span class="cn-st is-on is-live"><i></i>Live</span>${x.error ? '<span class="cn-st is-off" title="The last refresh did not go through">Last refresh failed</span>' : ''}`;
    if (x.state === 'syncing') return `<span class="cn-st is-on"><i></i>Reading…</span>`;
    return `<span class="cn-st is-off"><i></i>Needs attention</span>`; };
  const footer = (id) => { const x = L.conns?.[id]; if (!x || !member() && x.state !== 'live') return null;
    return `<span class="cn-acct">${ic('check', 's14')}${esc(x.account || nm(id))}${x.lastSync ? ` · ${ago(x.lastSync)}` : ''}</span>${member() || L.avail?.[id]?.modes?.includes('public') ? `<button class="cn-btn is-ghost" data-lsync="${id}">Sync now</button>` : ''}${member() && boss() ? `<button class="cn-btn is-ghost" data-lunlink="${id}">Disconnect</button>` : ''}`; };
  const intro = () => { if (!GENB || (!L.signin && !L.me)) return null; const n = B().brand.name;
    if (!L.me) return L.dummy ? `Every source Brew reads for ${n}. <a href="${signin()}">Sign in with Google</a> to connect accounts. Connected accounts are simulated in this demo (Dummy).` : `Every source Brew reads for ${n}. <a href="${signin()}">Sign in with Google</a> to connect ${n}’s real accounts, read-only.`;
    if (member() && !boss()) return `Every source Brew reads for ${n}. Only ${n}’s admins connect or disconnect accounts; you can sync the connected ones.`;
    if (member()) return L.dummy ? `Every source Brew reads for ${n}. Connected accounts are simulated in this demo (Dummy), built from what Brew read, and only ${n}’s team sees them.` : `Every source Brew reads for ${n}. Connected accounts are read-only, refresh once a day, and only ${n}’s team sees them.`;
    if (L.access?.claimed) return `Every source Brew reads for ${n}. Its team sees the live numbers; here you see the demo. Ask them to invite you.`;
    if (L.access?.eligible) return `Every source Brew reads for ${n}. You’re the first from ${esc(host())}: connect an account and ${n} is yours. <button class="linkish" data-lclaim>Claim it with your email</button>`;
    return `Every source Brew reads for ${n}. Here you see the demo: the first person to sign in with a work email at ${esc(host())} and connect an account becomes its admin.`; };
  function bindPage(root) {
    root.querySelectorAll('[data-lsync]').forEach((b) => b.onclick = async () => { b.disabled = true; b.textContent = 'Reading…'; const r = await post(`/api/brands/${slug}/connect/${b.dataset.lsync}`, { action: 'sync' }); if (r.ok) location.reload(); else { b.disabled = false; b.textContent = 'Sync now'; A().toast(esc(r.error || 'Could not sync')); } });
    root.querySelectorAll('[data-lunlink]').forEach((b) => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Disconnect for the team?'; return; } const r = await post(`/api/brands/${slug}/connect/${b.dataset.lunlink}`, { action: 'disconnect' }); if (r.ok) { const S = A().S; S.conn[b.dataset.lunlink] = false; A().save(); location.reload(); } });
    root.querySelectorAll('[data-lclaim]').forEach((b) => b.onclick = claim);
  }
  async function claim() { const r = await post(`/api/brands/${slug}/claim`); if (r.ok) { A().toast(`${ic('check', 's16')}${esc(B().brand.name)} is yours. Connect its accounts to see live numbers.`); setTimeout(() => location.reload(), 900); } else A().toastLong(esc(r.error || 'Could not claim'), 7000); }

  /* ---------- the account button in the rail ---------- */
  function menu(btn) {
    document.getElementById('lc-pop')?.remove();
    const pop = document.createElement('div'); pop.id = 'lc-pop'; pop.className = 'lc-pop';
    const r = btn.getBoundingClientRect(); pop.style.left = (r.right + 10) + 'px'; pop.style.bottom = Math.max(12, innerHeight - r.bottom) + 'px'; pop.style.position = 'fixed';
    const ac = L.access, n = B()?.brand?.name || 'this brand';
    const role = ac?.role === 'owner' ? `Owner of ${n}` : ac?.role === 'admin' ? 'Brew team · full access' : ac?.role ? `On ${n}’s team` : L.full ? 'Brew team · full access' : GENB ? `Visitor · you see ${n}’s demo` : '';
    pop.innerHTML = !L.me ? `<div class="lc-me"><b>Not signed in</b><small>Sign in to read a new brand, claim yours and connect real accounts.</small></div><a class="btn btn-primary sm" href="${signin()}">Sign in with Google</a>`
      : `<div class="lc-me">${L.me.pic ? `<img src="${esc(L.me.pic)}" alt="" referrerpolicy="no-referrer">` : ''}<span><b>${esc(L.me.name || L.me.email)}</b><small>${esc(L.me.email)}</small>${role ? `<em>${esc(role)}</em>` : ''}</span></div>
        ${GENB && ac?.canClaim ? `<button class="btn btn-primary sm" data-lclaim>Claim ${esc(n)}</button>` : ''}
        ${GENB && ac && !ac.gen ? `<small class="lc-hint">${ac.claimed ? `Ask ${esc(n)}’s team to invite you.` : `Sign in with your work email at ${esc(ac.host || host())} to claim it.`}</small>` : ''}
        ${GENB && ac?.role && ac.role !== 'owner' && ac.role !== 'admin' ? `<div class="lc-views"><small>Your views</small><span>${esc(seatWords(ac.seats))}</span></div>` : ''}
        ${GENB && ac?.role && ac.role !== 'owner' && ac.role !== 'admin' ? `<button class="btn btn-ghost sm lc-teambtn" data-lteamsheet>${ic('person', 's14')}Team and invites<span>${(ac.team || []).length}</span></button>` : ''}
        ${GENB && (ac?.role === 'owner' || ac?.role === 'admin') ? `<button class="btn btn-ghost sm lc-teambtn" data-lteamsheet>${ic('person', 's14')}Team and access<span>${(ac.members || []).length}${(ac.members || []).filter((x) => Array.isArray(x.seats) && !x.seats.length).length ? ' · needs you' : ''}</span></button>` : ''}
        <a class="lc-out" href="/auth/logout?next=${encodeURIComponent(location.pathname)}">Sign out</a>`;
    document.body.appendChild(pop); bindPage(pop);
    pop.querySelector('[data-lteamsheet]')?.addEventListener('click', () => { pop.remove(); teamSheet(); });
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
    const person = (x) => { if (x.via === 'Brew' && x.role === 'admin') return `<li class="tm-p"><div class="tm-line">${who(x)}<span class="tm-role">Brew admin</span><span class="tm-mw"></span></div></li>`; /* Brew's own people: shown, never edited here */
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



  window.LiveConn = { boss: () => !L.me || boss(), simId, teamSheet, seatWords, open, overlay, resume, status, footer, intro, bindPage, menu, claim, isLive, get L() { return L; }, gen: GENB, signin };
})();
