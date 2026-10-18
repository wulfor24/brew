/* Brew v2 "Make it yours": the one-sheet front door on every card (behind the V2 flag). The card on the left as it will ship;
   on the right the concept as editable words, a few chips, a prompt box, Decide together, Save and Cancel. Words change at
   once; a picture is redrawn in the background and lands on the card when it exists (never a blocking spinner). The studio
   stays one tap away. Agreeing a concept freezes the brief and opens its two doors: how to implement, and share with the team. */
(() => {
  const A = () => window.__BREW;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const B = () => A().B, brand = () => B().brand || {};
  const kindOf = (p) => p.post?.platform ? 'heard' : p.kind === 'ad' || p.rival ? 'rival-ad' : p.kind === 'answer' || p.agent === 'visibility' ? 'answer' : /^m\d+/.test(String(p.id)) || p.move ? 'move' : (p.images || []).length ? 'creative' : 'idea';
  /* the chips per kind: short instructions the writer understands; the sheet never says "AI" */
  const CHIPS = (p) => { const k = kindOf(p), hero = Object.values(B().lanes || {})[0]?.name, rival = (B().rivals || [])[0];
    const base = { creative: ['Rewrite the words', 'Change the photo', 'Try another look'], 'rival-ad': ['Make our version', 'Shorter', 'Warmer'], heard: ['Answer it once', 'Turn into a move', 'Warmer'], answer: ['Turn into a page', 'Shorter', 'Plainer'], move: ['Shorter', 'Warmer', hero ? `Lead with ${hero}` : 'Lead with the bestseller'], idea: ['Shorter', 'Warmer', 'Sharper'] }[k] || ['Shorter', 'Warmer'];
    if (rival && k !== 'rival-ad') base.push(`Make it about ${rival}`); return base.slice(0, 4); };
  const f = (x) => (window.fx || ((s) => s))(x);
  const cardHtml = (p, c, v) => { const img = (c.images || [])[0], mk = brand().mark || brand().logo; return `<article class="card v2-card mk-card"><header class="card-head">${mk ? `<img class="v2-mk" src="${esc(mk)}" alt="">` : A().face('brew')}<div class="who"><b>${esc(brand().name || '')}</b><span>As it will ship</span></div>${v?.drawing ? '<span class="badge warn">drawing…</span>' : ''}</header>
    ${img ? `<div class="media portrait"><img src="${esc(img)}" alt=""></div>` : ''}<div class="body"><h3 id="mk-pv-t">${esc(f(c.title))}</h3><p id="mk-pv-b">${esc(f(c.sub || c.p || ''))}</p></div></article>`; };

  const open = (p, o = {}) => {
    const c = A().cardOf(p), chips = CHIPS(p), why = f(c.why || c.from || c.sub0 || ''), src = c.src || (c.sources || [])[0] || '';
    const words = { title: f(c.title || ''), body: f(c.sub || c.p || '') }; let busy = false, dirty = false, saved = null;
    A().modal(`<div class="sheet mk-sheet" role="dialog" aria-label="Make it yours"><button class="icon-btn mk-x" data-close aria-label="Close">${A().ic('x', 's18')}</button>
      <div class="mk-head"><h2>Make it yours.</h2><p>Your words, your call. Or decide together.</p></div>
      <div class="mk-grid"><div class="mk-left" id="mk-left">${cardHtml(p, c)}</div>
        <div class="mk-right">
          <label class="mk-f"><span>The move</span><textarea id="mk-t" rows="2">${esc(words.title)}</textarea></label>
          <label class="mk-f"><span>The words</span><textarea id="mk-b" rows="4">${esc(words.body)}</textarea></label>
          ${why ? `<div class="mk-f is-ro"><span>Why it’s here</span><p>${esc(why)}${src ? ` <a class="mk-src" href="${/^https?:/.test(src) ? esc(src) : '#'}" target="_blank" rel="noopener">${esc(String(src).replace(/^https?:\/\//, '').slice(0, 40))}</a>` : ''}</p></div>` : ''}
          ${c.stat || c.gives ? `<div class="mk-f is-ro"><span>What it moves</span><p>${esc(f(c.stat || c.gives))}</p></div>` : ''}
          <div class="mks-chips">${chips.map((x) => `<button class="mks-chip" data-chip="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <form class="mk-ask" id="mk-ask"><input id="mk-q" placeholder="What would you change?" autocomplete="off"><button class="btn btn-primary sm" type="submit">Go</button></form>
          <p class="mk-note" id="mk-note" role="status" hidden></p>
          <div class="mk-acts"><button class="btn btn-ghost" id="mk-team">${A().ic('person', 's16')} Decide together</button><span class="sp"></span><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mk-save">Save</button></div>
          <div class="mk-doors" id="mk-doors" hidden><b>Agreed.</b><button class="linkbtn" id="mk-how">How to implement</button><button class="linkbtn" id="mk-share">Share with the team</button></div>
          <p class="mk-foot"><button class="linkbtn" id="mk-studio">Open the studio</button></p>
        </div></div></div>`, (w) => {
      const note = (t, kind) => { const n = $('#mk-note', w); n.hidden = !t; n.dataset.kind = kind || ''; n.textContent = t || ''; };
      const tIn = $('#mk-t', w), bIn = $('#mk-b', w); const sync = () => { words.title = tIn.value.trim(); words.body = bIn.value.trim(); dirty = true; const pt = $('#mk-pv-t', w), pb = $('#mk-pv-b', w); if (pt) pt.textContent = words.title; if (pb) pb.textContent = words.body; };
      tIn.oninput = sync; bIn.oninput = sync;
      /* a chip or a prompt: the words come back first and show at once; the picture, if the card has one, is queued and lands later */
      const ask = async (prompt, chip) => { if (busy) return; busy = true; note('Rewriting the words…'); $$('.mks-chip', w).forEach((b) => (b.disabled = true));
        const r = await A().tapi('POST', `/api/cards/${p.id}/remix`, { words: true, prompt: prompt || '', chip: chip || '' }).catch((e) => ({ error: e.message }));
        $$('.mks-chip', w).forEach((b) => (b.disabled = false)); busy = false;
        if (!r || r.error) { note(r?.error || 'That didn’t go through. You can still edit the words yourself.', 'bad'); return; }
        if (r.words) { tIn.value = r.words.title || tIn.value; bIn.value = r.words.body || bIn.value; sync(); dirty = false; saved = r.versionId || null; }
        if ((c.images || []).length && chip !== 'Shorter' && chip !== 'Warmer' && chip !== 'Plainer' && chip !== 'Sharper') { const q = await A().tapi('POST', `/api/cards/${p.id}/remix`, { queue: true, prompt: prompt || '', chip: chip || '' }).catch(() => null); if (q?.queued) { note('Words done. The picture is being redrawn and lands on the card when it’s ready.'); $('#mk-left', w).innerHTML = cardHtml(p, { ...c, title: words.title, sub: words.body }, { drawing: true }); return; } }
        note('Done. Save to keep it.'); };
      $$('.mks-chip', w).forEach((b) => (b.onclick = () => ask('', b.dataset.chip)));
      $('#mk-ask', w).onsubmit = (e) => { e.preventDefault(); const q = $('#mk-q', w).value.trim(); if (!q) return; $('#mk-q', w).value = ''; ask(q, ''); };
      $('#mk-save', w).onclick = async () => { if (busy) return; busy = true; const b = $('#mk-save', w); b.disabled = true; b.innerHTML = '<span class="spin"></span>Saving';
        let r = { ok: true, versionId: saved };
        if (dirty) r = await A().tapi('POST', `/api/cards/${p.id}/remix`, { words: true, set: { title: words.title, body: words.body } }).catch((e) => ({ error: e.message }));
        busy = false; b.disabled = false; b.textContent = 'Save';
        if (!r || r.error) { note(r?.error || 'Could not save.', 'bad'); return; }
        dirty = false; note('Saved.'); $('#mk-doors', w).hidden = false; o.onSaved?.(r); };
      $('#mk-team', w).onclick = () => { window.LiveConn?.teamSheet?.(); setTimeout(() => A().openDetail(p, { jam: true }), 50); };
      $('#mk-how', w).onclick = async () => { const wk = A().workOfCard(p.id); if (!wk) { A().openDetail(p, { jam: true }); return; } const r = await A().tapi('GET', `/api/work/${wk.id}/handoff?base=${encodeURIComponent(location.origin)}`).catch(() => ({})); const u = r?.handoff?.links?.page; if (u) window.open(u, '_blank', 'noopener'); else note('The brief isn’t ready yet. Open the studio to finish it.'); };
      $('#mk-share', w).onclick = () => { A().closeModal(); A().shareSheet(p); };
      $('#mk-studio', w).onclick = () => { A().closeModal(); A().openRemix(p).catch?.(() => A().openDetail(p)); };
      setTimeout(() => $('#mk-q', w)?.focus(), 60);
    });
  };
  window.MakeSheet = { open, kindOf, chips: CHIPS };
})();
