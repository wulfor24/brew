// The jam's composer row, like a modern AI chat: + (add to the jam), the model chip (Auto / Deep / Fast, and what
// makes images), Memory (what Brew remembers, on or off), and Connectors (the brand's accounts and what Brew can do
// on each). The choices travel with every jam request as headers (x-model, x-image-model, x-memory).
(() => {
  const A = () => window.__BREW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k, s) => A()?.ic(k, s) || '';
  const KEY = 'brew:jam-prefs';
  const read = () => { try { return { model: 'auto', image: 'auto', memory: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { model: 'auto', image: 'auto', memory: true }; } };
  let P = read(); const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch {} };
  const UI = { open: null, cat: null, mem: null, connOpen: null };
  const THINK = [['auto', 'Auto', 'Brew picks for each step'], ['deep', 'Deep', 'Thinks longer · strategy and plans'], ['fast', 'Fast', 'Answers quickly · short edits']];
  const IMAGE = [['auto', 'Auto', 'The right one for the format'], ['gemini', 'Gemini 3 Pro Image', 'Keeps the product and its label exact'], ['gpt-image', 'GPT Image', 'Edits your product photo']];
  const LOGO = { shopify: 'S', meta: '∞', google: 'G', klaviyo: 'K', reviews: '★', slack: '#' }; /* one style: a letter or mark on a soft tile, never an emoji */

  const headers = () => ({ 'x-model': P.model, 'x-image-model': P.image, 'x-memory': P.memory ? 'on' : 'off' });
  const work = () => A()?.currentDetail?.()?._work || null;
  const ensure = async () => { const a = A(), p = a.currentDetail?.() || a.studioCard?.(); if (!p) return null; let w = p._work || a.workOfCard?.(p.id); if (w) return w;
    const { _work, _ch, ...card } = p; const r = await a.tapi('POST', '/api/work', { cardId: p.id, card, decided: a.S.decided?.[p.id] || null }); if (r.work) a.putWork(r.work); return r.work || null; };
  /* the connectors the jam can read (DUMMY: simulated accounts, see connectors/index.js) */
  const loadCat = async () => { await window.LIVE_P; const L = window.LIVE || {}, nm = (id) => A().B?.connectors?.[id]?.name || id, ids = Object.keys(L.avail || {});
    UI.cat = { connected: ids.filter((id) => L.conns?.[id]?.state === 'live').map((id) => ({ id, name: nm(id) })), available: ids.filter((id) => L.conns?.[id]?.state !== 'live').map((id) => ({ id, name: nm(id) })) }; repaint(); };
  const loadMem = async () => { UI.mem = await A().tapi('GET', '/api/tenants/:t/learning'); repaint(); };

  /* the jam pane or the studio, whichever is open */
  const inStudio = () => !!document.querySelector('.std .st-panel');
  const repaint = () => (inStudio() ? window.__paintStudio?.() : window.JamRoom?.paint?.());
  const inBox = () => document.querySelector(inStudio() ? '#st-in' : '#jm-in');
  const pop = (k, body) => (UI.open === k ? `<div class="cmp-pop is-${k}" role="dialog">${body}</div>` : '');
  const plusPop = () => pop('plus', `<button type="button" data-cmp-file>${ic('doc', 's16')}<span><b>A CSV or text file</b><small>Numbers, a list, notes. The AI reads it</small></span></button>
    <button type="button" data-cmp-photo>${ic('pic', 's16')}<span><b>A photo of your product</b><small>Drafts use it as the product shot</small></span></button><input type="file" data-cmp-img hidden accept="image/png,image/jpeg,image/webp">
    <button type="button" data-cmp-link>${ic('link', 's16')}<span><b>A link</b><small>Adds the address to your message (Brew doesn’t open it)</small></span></button>
    <button type="button" data-jm-import>${ic('copy', 's16')}<span><b>Paste a chat</b><small>From WhatsApp or Slack</small></span></button>
    ${inStudio() ? '' : `<button type="button" data-cmp-learn>${ic('sparkles', 's16')}<span><b>Brand learnings</b><small>Paste a call, notes or emails. Brew learns from them</small></span></button>`}
    <input type="file" data-cmp-in hidden accept=".csv,.txt,.md,text/plain,text/csv">
    ${inStudio() ? '' : `<small class="cmp-k">Make a draft as</small><div class="cmp-as">${[['image', 'pic', 'Image'], ['carousel', 'grid', 'Carousel'], ['video', 'vid', 'Video'], ['voice', 'mic', 'Voice'], ['text', 'txt', 'Text']].map(([k, i, l]) => `<button type="button" data-jm-make="${k}">${ic(i, 's16')}<span>${l}</span></button>`).join('')}</div>`}`);
  const modelPop = () => pop('model', `<small class="cmp-k">Thinking</small>${THINK.map(([k, n, d]) => `<button class="${P.model === k ? 'is-on' : ''}" data-cmp-think="${k}"><span><b>${n}</b><small>${d}</small></span>${P.model === k ? ic('check', 's16') : ''}</button>`).join('')}
    <small class="cmp-k">Making images</small>${IMAGE.map(([k, n, d]) => `<button class="${P.image === k ? 'is-on' : ''}" data-cmp-image="${k}"><span><b>${n}</b><small>${d}</small></span>${P.image === k ? ic('check', 's16') : ''}</button>`).join('')}
    <small class="cmp-k">Making video and voice</small><div class="cmp-fixed"><span><b>Veo 3.1 Fast</b> video · 6 s clips</span><span><b>Gemini TTS</b> voiceover</span></div>`);
  const memPop = () => { const m = UI.mem, ls = (m?.lessons || []).slice(0, 6), rs = (m?.rules || []).filter((r) => r.on !== false).slice(0, 4);
    /* a header with a switch, then what Brew learned as quiet rows; Forget shows on hover (always on touch) */
    return pop('mem', `<label class="cmp-sw"><span><b>Memory</b><small>What Brew learned from your edits, choices and results</small></span><input type="checkbox" class="cmp-tg" role="switch" data-cmp-mem${P.memory ? ' checked' : ''} aria-label="Use memory in this jam"></label>
      ${!m ? '<div class="cmp-load"><span class="spin"></span></div>' : ls.length || rs.length ? `<ul class="cmp-mem${P.memory ? '' : ' is-off'}">${rs.map((r) => `<li><i class="cmp-mk is-rule" title="A rule your team set"></i><span>${esc(r.text)}</span></li>`).join('')}${ls.map((x) => `<li><i class="cmp-mk${x.results?.length ? ' is-res' : ''}" title="${x.results?.length ? 'Backed by a measured result' : 'Learned from your choices'}"></i><span>${esc(x.text)}</span><button class="cmp-forget" data-cmp-forget="${esc(x.id)}" title="Forget this" aria-label="Forget this">${ic('x', 's14')}</button></li>`).join('')}</ul>` : '<p class="cmp-none">Nothing learned yet. It builds as you jam, decide and see results.</p>'}`); };
  const connPop = () => { const c = UI.cat;
    if (!c) return pop('conn', '<div class="cmp-load"><span class="spin"></span>Reading your accounts…</div>');
    const row = (x) => `<div class="cmp-acc"><button class="cmp-acc-h" data-nav="connectors"><span class="cmp-logo">${esc(LOGO[x.id] || x.name[0])}</span><b>${esc(x.name)}</b><span class="cmp-ok">${ic('check', 's14')}<small class="dummy-tag">Dummy</small></span></button></div>`;
    return pop('conn', `<small class="cmp-k">Connected</small>${c.connected.map((x) => row(x)).join('') || '<p class="cmp-none">Nothing connected yet.</p>'}
      ${c.available.length ? `<small class="cmp-k">Available</small>${c.available.map((x) => `<div class="cmp-acc"><button class="cmp-acc-h" data-cx="${esc(x.id)}"><span class="cmp-logo">${esc(LOGO[x.id] || x.name[0])}</span><b>${esc(x.name)}</b>${ic('right', 's14')}</button></div>`).join('')}` : ''}
      <button class="cmp-manage" data-nav="connectors">Manage connectors ${ic('right', 's14')}</button>`); };

  const tools = () => { const label = THINK.find(([k]) => k === P.model)?.[1] || 'Auto';
    return `<span class="cmp-tools" data-cmp><button type="button" class="cmp-plus" data-cmp-open="plus" aria-label="Add to the jam" aria-expanded="${UI.open === 'plus'}">${ic('plus', 's16')}</button>
      <button type="button" class="cmp-chip" data-cmp-open="model" aria-expanded="${UI.open === 'model'}" aria-label="Model: ${esc(label)}"><span class="cmp-star">✱</span>${esc(label)} ${ic('chev', 's12')}</button>${plusPop()}${modelPop()}</span>`; };
  const foot = () => { const conns = UI.cat?.connected || [];
    /* two equal quiet pills: what the jam remembers and what it can reach; the count never shifts the line */
    return `<div class="cmp" data-cmp><div class="cmp-foot"><button type="button" class="cmp-mem-b" data-cmp-open="mem" aria-expanded="${UI.open === 'mem'}">${ic('book', 's14')}Memory <i class="cmp-dot${P.memory ? '' : ' is-off'}" aria-label="${P.memory ? 'on' : 'off'}"></i></button>
      <button type="button" class="cmp-conn-b" data-cmp-open="conn" aria-expanded="${UI.open === 'conn'}">${ic('plug', 's14')}Connectors${conns.length ? ` <em class="cmp-n">${conns.length}</em>` : ''}</button></div>${memPop()}${connPop()}</div>`; };
  const html = (p, w) => `<div class="cmp" data-cmp><div class="cmp-row">${tools()}</div></div>${foot()}`;


  document.addEventListener('click', async (e) => {
    const t = e.target; if (!t.closest) return;
    const o = t.closest('[data-cmp-open]'); if (o) { const k = o.dataset.cmpOpen; UI.open = UI.open === k ? null : k; if (k === 'conn' && UI.open) loadCat(); if (k === 'mem' && UI.open && !UI.mem) loadMem(); return repaint(); }
    const th = t.closest('[data-cmp-think]'); if (th) { P.model = th.dataset.cmpThink; save(); return repaint(); }
    const im = t.closest('[data-cmp-image]'); if (im) { P.image = im.dataset.cmpImage; save(); return repaint(); }
    if (t.closest('[data-jm-make]') && UI.open) { UI.open = null; } /* the jam pane makes the draft; the menu closes */
    const f = t.closest('[data-cmp-forget]'); if (f) { await A().tapi('PUT', `/api/tenants/:t/learning/lessons/${f.dataset.cmpForget}`, { forget: true }); UI.mem = null; return loadMem(); }
    if (t.closest('[data-cmp-file]')) return document.querySelector('[data-cmp-in]')?.click();
    /* in the studio a product photo becomes this version's photo (the Change photo picker takes uploads); in a jam it's the drafts' reference */
    if (t.closest('[data-cmp-photo]')) { if (inStudio() && window.__openPhotos) { UI.open = null; repaint(); return window.__openPhotos(); } return document.querySelector('[data-cmp-img]')?.click(); }
    /* the jam pane has its own paste box; in the studio the chat goes into the message the AI reads */
    if (t.closest('[data-jm-import]') && inStudio()) { UI.open = null; repaint(); const box = inBox(); if (box) { box.value = 'Here is a chat we had (from WhatsApp or Slack). Use what we agreed:\n'; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); box.setSelectionRange(box.value.length, box.value.length); } return; }
    if (t.closest('[data-cmp-talk]')) { UI.open = null; repaint(); const box = inBox(); return box && window.Mic?.supported ? window.Mic.talk(box) : null; }
    /* /update-brand-learnings (brand-learnings.js): the command goes in the box, the paste (or a text file from +) follows it */
    if (t.closest('[data-cmp-learn]')) { UI.open = null; const box = inBox(); if (box) { box.value = '/update-brand-learnings\n'; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); box.setSelectionRange(box.value.length, box.value.length); } return; }
    if (t.closest('[data-cmp-link]')) { UI.open = null; const box = inBox(); if (box) { box.value = 'For reference: https://'; box.focus(); } return; }
    // a click anywhere else closes an open popover
    if (UI.open && !t.closest('.cmp-pop') && !t.closest('[data-cmp]')) { UI.open = null; repaint(); }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.matches?.('[data-cmp-mem]')) { P.memory = e.target.checked; save(); repaint(); }
    if (e.target.matches?.('[data-cmp-img]')) { const f = e.target.files?.[0]; if (!f) return; UI.open = null; const w = await ensure(); if (!w) return;
      if (f.size > 8e6) return A().toast('That photo is over 8 MB.');
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      const x = await A().tapi('POST', `/api/work/${w.id}/reference`, { data, name: f.name }); if (x.error) return A().toast(esc(x.error)); if (x.work) A().putWork(x.work); A().repaintDetail(); A().toast(`${ic('done', 's16')}Photo added. Drafts use it as the product shot.`); return; }
    if (e.target.matches?.('[data-cmp-in]')) { const f = e.target.files?.[0]; if (!f) return; UI.open = null;
      // a text or CSV file joins the jam as text the AI reads
      const box = inBox(); if (!box) return;
      const learn = /^\s*\/update[-_ ]?brand[-_ ]?learnings?\b/i.test(box.value); /* a transcript for brand learnings is read whole, not cut at 6,000 */
      const txt = (await f.text()).slice(0, learn ? 120000 : 6000); box.value = learn ? `${box.value.trim()}\n${txt}` : `Here is ${f.name}:\n${txt}`;
      box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); repaint(); }
  });
  /* the catalogue loads once a jam opens, so the footer can show the connected logos */
  window.Composer = { html, tools, foot, load: () => { if (!UI.cat) loadCat(); }, headers, get prefs() { return P; } };
})();
