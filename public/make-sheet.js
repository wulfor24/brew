/* Brew v2 "Make it yours": the one-sheet front door on every card (behind the V2 flag). The card on the left as it will ship;
   on the right the concept as editable words, a few chips, a prompt box, Decide together, Save and Cancel. Words change at
   once; a picture is redrawn in the background and lands on the card when it exists (never a blocking spinner). The studio
   stays one tap away. Agreeing a concept freezes the brief and opens its two doors: how to implement, and share with the team. */
(() => {
  const A = () => window.__BREW;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/\u2039(?=\s?\d)/g, '₹').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const B = () => A().B, brand = () => B().brand || {};
  /* a rival's ad card, or one built on a rival's ad: the server's own test (rival-ad.js isRivalCard), plus the make line it sets */
  const isRival = (p) => p?.research?.kind === 'ad' || !!p?.research?.ad || p?.make?.from === 'rival';
  /* any remake of somebody else's work: a rival ad, or a viral video (rival-ad.js isReferenceCard) */
  const isRef = (p) => isRival(p) || p?.research?.kind === 'viral' || p?.make?.from === 'viral';
  /* a rival's poster or clip (rival-ad.js isResearchImage): never shown as ours */
  const isTheirs = (u) => /(^|\/)research\//.test(String(u || '')) || /(^|\/)b\/[a-z0-9-]+\/a\/ad-[^/?]+/.test(String(u || ''));
  const kindOf = (p) => p.post?.platform ? 'heard' : isRef(p) ? 'rival-ad' : p.kind === 'answer' || p.agent === 'visibility' ? 'answer' : /^m\d+/.test(String(p.id)) || p.move ? 'move' : (p.images || []).length ? 'creative' : 'idea';
  /* the chips per kind: short instructions the writer understands; the sheet never says "AI" */
  const CHIPS = (p) => { const k = kindOf(p), hero = Object.values(B().lanes || {})[0]?.name, rival = (B().rivals || [])[0];
    const base = { creative: ['Rewrite the words', 'Change the photo', 'Try another look'], 'rival-ad': ['Make our version', 'Shorter', 'Warmer'], heard: ['Answer it once', 'Turn into a move', 'Warmer'], answer: ['Turn into a page', 'Shorter', 'Plainer'], move: ['Shorter', 'Warmer', hero ? `Lead with ${hero}` : 'Lead with the bestseller'], idea: ['Shorter', 'Warmer', 'Sharper'] }[k] || ['Shorter', 'Warmer'];
    if (rival && k !== 'rival-ad') base.push(`Make it about ${rival}`); return base.slice(0, 4); };
  const f = (x) => (window.fx || ((s) => s))(x);
  /* the picture "as it will ship": the latest take, else the card's first draft (its poster for a clip), else the card's own
     photo. A rival card has no picture of ours until one is drawn, so it shows none rather than theirs */
  const ourPics = (p, c, peek) => [...new Set([peek?.image, p.take?.image, ...(p.draft?.images || []), p.draft?.poster, p.draft?.fallback, ...(isRef(p) ? [] : c.images || [])].filter((u) => u && !isTheirs(u)))];
  const ourPic = (p, c, peek) => ourPics(p, c, peek)[0] || null;
  const cardHtml = (p, c, v) => { const img = v?.img, mk = brand().mark || brand().logo; return `<article class="card v2-card mk-card"><header class="card-head">${mk ? `<img class="v2-mk" src="${esc(mk)}" alt="">` : A().face('brew')}<div class="who"><b>${esc(brand().name || '')}</b><span>As it will ship</span></div>${v?.drawing ? '<span class="badge warn">drawing…</span>' : ''}</header>
    ${!img && isRef(p) ? `<p class="mk-nopic">Our version is drawn from your product when you ask for it.</p>` : ''}
    ${img ? `<div class="media portrait"><img src="${esc(img)}" alt=""${v?.fb?.length ? ` data-fb="${esc(v.fb.join('|'))}"` : ''}></div>` : ''}<div class="body"><h3 id="mk-pv-t">${esc(f(c.title))}</h3><p id="mk-pv-b">${esc(f(c.sub || c.p || ''))}</p></div></article>`; };

  const open = (p, o = {}) => {
    /* why it's here: the card's own reason (plain.js because, else its first why) and its source, linked when it has a link */
    const c = A().cardOf(p), chips = CHIPS(p), why = f(c.because || (c.detail?.why || [])[0] || ''), src = c.src || '', srcUrl = c.link?.url || (/^https?:/.test(src) ? src : '');
    /* the words are the ones that ship (the take Save writes to), read from the server; until they land the fields wait */
    const words = { title: '', body: '' }; let busy = true, dirty = false, saved = null, pics = ourPics(p, c), pic = pics[0] || null; /* the rest are the picture's fallbacks (asset-fallback.js) */
    A().modal(`<div class="sheet mk-sheet" role="dialog" aria-label="Make it yours"><button class="icon-btn mk-x" data-close aria-label="Close">${A().ic('x', 's18')}</button>
      <div class="mk-head"><h2>Make it yours.</h2><p>Your words, your call. Or decide together.</p></div>
      <div class="mk-grid"><div class="mk-left" id="mk-left">${cardHtml(p, { ...c, title: '', sub: '' }, { img: pic, fb: pics.slice(1) })}</div>
        <div class="mk-right">
          <label class="mk-f"><span>The headline <brew-load class="spin mk-sp"></brew-load></span><textarea id="mk-t" rows="2" disabled placeholder="Getting the words…"></textarea></label>
          <label class="mk-f"><span>The words</span><textarea id="mk-b" rows="4" disabled></textarea></label>
          ${why || src ? `<div class="mk-f is-ro"><span>Why it’s here</span><p>${esc(why)}${src ? ` ${srcUrl ? `<a class="mk-src" href="${esc(srcUrl)}" target="_blank" rel="noopener">${esc(String(src).replace(/^https?:\/\//, '').slice(0, 60))}</a>` : `<span class="mk-src">${esc(String(src).slice(0, 60))}</span>`}` : ''}</p></div>` : ''}
          <p class="mk-refs" id="mk-refs" hidden></p>
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
      const paint = (o = {}) => { $('#mk-left', w).innerHTML = cardHtml(p, { ...c, title: words.title, sub: words.body }, { img: pic, fb: pics.filter((u) => u !== pic), ...o }); };
      /* open on the take's words and picture (read only, nothing spent); on a failure, the card's own words as a start */
      A().tapi('POST', `/api/cards/${p.id}/remix`, { peek: true }).catch(() => null).then((r) => { if (!w.isConnected) return;
        const pw = r && !r.error ? r.words : null; words.title = pw?.title || (isRef(p) ? '' : f(c.title || '')); words.body = pw?.body || (isRef(p) ? '' : f(c.sub || ''));
        if (r?.ref && A().openRefs) { const el = $('#mk-refs', w); el.hidden = false; el.innerHTML = `<button type="button" class="ref-btn">${r.ref.poster ? `<img src="/${esc(String(r.ref.poster).replace(/^\//, ''))}" alt="">` : ''}<span><b>View references</b><small>${esc(r.ref.kind === 'viral' ? `${r.ref.platformName} video by ${r.ref.author}` : `${r.ref.brand}’s ad`)}</small></span></button>`; el.firstChild.onclick = () => A().openRefs(r.ref); }
        pics = ourPics(p, c, r); pic = pics[0] || null; tIn.value = words.title; bIn.value = words.body; tIn.disabled = bIn.disabled = false; tIn.placeholder = ''; w.querySelector('.mk-sp')?.remove(); busy = false; dirty = false; paint({ drawing: !!r?.drawing }); });
      /* a chip or a prompt: the words come back first and show at once; the picture, if the card has one, is queued and lands later */
      const ask = async (prompt, chip, btn) => { if (busy) return; busy = true; note('Rewriting the words…'); $$('.mks-chip', w).forEach((b) => (b.disabled = true)); const done = A().busyBtn?.(btn, btn?.classList.contains('mks-chip') ? btn.textContent : '') || (() => {});
        const r = await A().tapi('POST', `/api/cards/${p.id}/remix`, { words: true, prompt: prompt || '', chip: chip || '' }).catch((e) => ({ error: e.message }));
        done(); $$('.mks-chip', w).forEach((b) => (b.disabled = false)); busy = false;
        if (!r || r.error) { note(r?.error || 'That didn’t go through. You can still edit the words yourself.', 'bad'); return; }
        if (r.words) { tIn.value = r.words.title || tIn.value; bIn.value = r.words.body || bIn.value; sync(); dirty = false; saved = r.versionId || null; }
        if ((pic || isRef(p)) && chip !== 'Shorter' && chip !== 'Warmer' && chip !== 'Plainer' && chip !== 'Sharper') { const q = await A().tapi('POST', `/api/cards/${p.id}/remix`, { queue: true, prompt: prompt || '', chip: chip || '' }).catch(() => null); if (q?.queued) { note('Words done. The picture is being redrawn and lands on the card when it’s ready.'); paint({ drawing: true }); return; } }
        note('Done. Save to keep it.'); };
      $$('.mks-chip', w).forEach((b) => (b.onclick = () => ask('', b.dataset.chip, b)));
      $('#mk-ask', w).onsubmit = (e) => { e.preventDefault(); const q = $('#mk-q', w).value.trim(); if (!q) return; $('#mk-q', w).value = ''; ask(q, '', $('#mk-ask button', w)); };
      $('#mk-save', w).onclick = async () => { if (busy) return; busy = true; const b = $('#mk-save', w); b.disabled = true; b.innerHTML = '<brew-load class="spin"></brew-load>Saving';
        let r = { ok: true, versionId: saved };
        if (dirty) r = await A().tapi('POST', `/api/cards/${p.id}/remix`, { words: true, set: { title: words.title, body: words.body } }).catch((e) => ({ error: e.message }));
        busy = false; b.disabled = false; b.textContent = 'Save';
        if (!r || r.error) { note(r?.error || 'Could not save.', 'bad'); return; }
        /* the card carries the take now (feed-service pub): refresh this copy so the feed and the stack show what was saved */
        const g = await A().tapi('GET', `/api/cards/${p.id}`).catch(() => null); if (g?.card) { p.take = g.card.take; p.draft = g.card.draft; }
        dirty = false; note('Saved.'); $('#mk-doors', w).hidden = false; o.onSaved?.(r); };
      $('#mk-team', w).onclick = () => { window.LiveConn?.teamSheet?.(); setTimeout(() => A().openDetail(p, { jam: true }), 50); };
      $('#mk-how', w).onclick = async () => { const wk = A().workOfCard(p.id); if (!wk) { A().openDetail(p, { jam: true }); return; } const r = await A().tapi('GET', `/api/work/${wk.id}/handoff?base=${encodeURIComponent(location.origin)}`).catch(() => ({})); const u = r?.handoff?.links?.page; if (u) window.open(u, '_blank', 'noopener'); else note('The brief isn’t ready yet. Open the studio to finish it.'); };
      $('#mk-share', w).onclick = () => { A().closeModal(); A().shareSheet(p); };
      $('#mk-studio', w).onclick = () => { A().closeModal(); A().openRemix(p).catch?.(() => A().openDetail(p)); };
      setTimeout(() => $('#mk-q', w)?.focus(), 60);
    });
  };
  window.MakeSheet = { open, kindOf, chips: CHIPS, isRival, isRef, isTheirs, ourPic };
})();
