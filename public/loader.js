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
  const show = (b) => {
    const big = b.querySelector('img,video') || b.offsetHeight > 72, sp = document.createElement('span'), was = b.disabled;
    sp.className = big ? 'spin bl-pin' : 'spin bl-a'; sp.setAttribute('aria-hidden', 'true');
    b.classList.add(big ? 'bl-over' : 'bl-wait'); b.setAttribute('aria-busy', 'true');
    if (big && getComputedStyle(b).position === 'static') { b.style.position = 'relative'; sp.dataset.pos = '1'; }
    const ico = !big && [...b.querySelectorAll('svg')].find((x) => { const r = x.getBoundingClientRect(); return r.width && r.width <= 32; }); /* an icon and words: the loader takes the icon's place, the same size */
    if (ico) { const r = ico.getBoundingClientRect(); if (r.width) { sp.style.width = `${r.width}px`; sp.style.height = `${r.height}px`; } sp.classList.add('is-ico'); ico.before(sp); ico.hidden = true; }
    else if (big) b.appendChild(sp); else b.prepend(sp);
    if ('disabled' in b && b.tagName === 'BUTTON') b.disabled = true;
    return () => { if (sp.dataset.pos) b.style.position = ''; if (ico) ico.hidden = false; sp.remove(); b.classList.remove('bl-over', 'bl-wait'); b.removeAttribute('aria-busy'); if (b.tagName === 'BUTTON' && b.isConnected) b.disabled = was; };
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
