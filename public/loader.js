// Every tap that waits on the server shows the Brew loader (2026-10-20 audit: 61 buttons showed nothing, or only greyed out).
// A click marks the button; any fetch it starts (straight away, or chained right after the one before) ties to that button, which
// gets the loader until its calls are done. Fast answers never flash it. A button that already shows its own wait (busyBtn's
// .is-wait, aria-busy, a .spin inside) or sits under [data-noload] is left alone. Big tiles (a photo, a card) get the loader
// over them, not in place of their content. Loaded before every other script, so it sees every fetch.
(() => {
  const SEL = 'button,[role="button"],a.btn,a.chip,label.btn';
  const FIRST = 800, CHAIN = 600, DELAY = 140, MIN = 380; /* ms: click → first call; one call → the next; before showing; shown at least */
  let last = null, at = 0;
  const mark = (b) => { if (!b || b.closest('[data-noload]')) { last = null; return; } last = b; at = performance.now(); };
  document.addEventListener('click', (e) => mark(e.target.closest?.(SEL)), true);
  /* a file picked for upload: the label or button that opened the picker waits with it */
  document.addEventListener('change', (e) => { const i = e.target; if (i?.type !== 'file' || !i.files?.length) return; mark(i.closest('label,button,[role="button"]') || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || null); }, true);
  document.addEventListener('submit', (e) => mark(e.submitter || e.target.querySelector?.('button[type="submit"],button:not([type])')), true);

  const busy = new Map(); /* button → { n, timer, shownAt, undo } */
  const owns = (b) => b.matches('.is-wait,[aria-busy="true"]') || !!b.querySelector('.spin');
  /* the button's leading icon: the first thing in it, before any words. A chevron or a count after the words is not it */
  const leadIcon = (b) => { const w = document.createTreeWalker(b, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) { if (n.textContent.trim()) return null; continue; }
      if (n.tagName === 'IMG' || n.tagName === 'VIDEO') return null; if (n.tagName.toLowerCase() === 'svg') { const r = n.getBoundingClientRect(); return r.width && r.width <= 40 ? n : null; } }
    return null; };
  const show = (b) => {
    const media = !!b.querySelector('img,video'), big = media || b.offsetHeight > 72, sp = document.createElement('brew-load') /* its own tag: no page rule written for a button's spans or icons ever reaches it */, was = b.disabled;
    /* a photo tile: the loader over the middle of the picture. A big tile with words: small, in its top corner, clear of them */
    sp.className = media ? 'spin bl-pin' : big ? 'spin bl-corner' : 'spin bl-a'; sp.setAttribute('aria-hidden', 'true');
    b.classList.add(big ? 'bl-over' : 'bl-wait'); b.setAttribute('aria-busy', 'true');
    if (big && getComputedStyle(b).position === 'static') { b.style.position = 'relative'; sp.dataset.pos = '1'; }
    /* an icon: the loader takes its exact place (same box, same display, same margins), so nothing beside it moves */
    const ico = big ? null : leadIcon(b), icoDisp = ico?.style.display;
    if (ico) { const r = ico.getBoundingClientRect(), cs = getComputedStyle(ico);
      Object.assign(sp.style, { width: `${r.width}px`, height: `${r.height}px`, display: cs.display === 'inline' ? 'inline-block' : cs.display, margin: cs.margin, verticalAlign: cs.verticalAlign, flex: 'none' });
      sp.classList.add('is-ico'); ico.before(sp); ico.style.display = 'none'; }
    else if (big) { b.appendChild(sp); const m = media && b.querySelector('img,video'), mr = m?.getBoundingClientRect(), br = b.getBoundingClientRect(); /* centred on the picture, not on the tile with its label */
      if (mr?.width) Object.assign(sp.style, { left: `${mr.left - br.left + mr.width / 2}px`, top: `${mr.top - br.top + mr.height / 2}px` }); }
    else { /* words only: the button keeps its exact size; the words fade out under the loader, centred where they were */
      const col = getComputedStyle(b).color; sp.classList.replace('bl-a', 'bl-mid'); sp.style.color = col; b.classList.add('bl-hush');
      if (getComputedStyle(b).position === 'static') { b.style.position = 'relative'; sp.dataset.pos = '1'; } b.appendChild(sp); }
    if ('disabled' in b && b.tagName === 'BUTTON') b.disabled = true;
    return () => { if (sp.dataset.pos) b.style.position = ''; if (ico) ico.style.display = icoDisp || ''; sp.remove(); b.classList.remove('bl-over', 'bl-wait', 'bl-hush'); b.removeAttribute('aria-busy'); if (b.tagName === 'BUTTON' && b.isConnected) b.disabled = was; };
  };
  const done = (b) => {
    const s = busy.get(b); if (!s || --s.n > 0) return;
    if (last === b) at = performance.now() - FIRST + CHAIN; /* the handler's next call, if it makes one right away, keeps the loader on */
    setTimeout(() => {
      if (s.n > 0) return; clearTimeout(s.timer); busy.delete(b);
      if (!s.undo) return; const left = MIN - (performance.now() - s.shownAt);
      setTimeout(s.undo, Math.max(0, left));
    }, 80);
  };
  const tie = (b) => {
    let s = busy.get(b);
    if (!s) { if (owns(b)) return null; s = { n: 0, timer: 0, shownAt: 0, undo: null }; busy.set(b, s); s.timer = setTimeout(() => { if (s.n > 0 && b.isConnected && !owns(b)) { s.undo = show(b); s.shownAt = performance.now(); } }, DELAY); }
    s.n++; return b;
  };

  const f0 = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const b = last && last.isConnected && performance.now() - at < FIRST ? tie(last) : null;
    const p = BL.slow ? new Promise((r) => setTimeout(r, BL.slow)).then(() => f0(u, o)) : f0(u, o); if (b) p.then(() => done(b), () => done(b)); return p;
  };
  /* hold(el, promise): the same loader on a button for a wait that isn't a fetch it started (a call already in flight, a timer) */
  const hold = (b, p) => { const t = b && b.isConnected ? tie(b) : null; return Promise.resolve(p).finally(() => t && done(t)); };
  const BL = window.BrewLoad = { mark, hold, slow: 0 }; /* slow: ms added to every call, to see the loaders on a fast local server */
})();
