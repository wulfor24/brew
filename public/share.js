// Share the brief: the jam's one exit. Both freeze the brief (BR-n). "Send brief" (the ShopOS team) emails the whole brief to
// the ShopOS team and tracks its status (sent, received, in progress, needs info, delivered); "Share with my team" copies it,
// with the link to the full read-only brief, to paste where your team works.
// Used by the studio's ship bar and the card page; the jam room has the same two buttons (jam-room.js ship()).
(() => {
  const A = () => window.__BREW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k, s) => A()?.ic(k, s) || '';
  const WHO = { shopos: 'the ShopOS team', team: 'your team' };

  // the work this card's jam runs on (made if the jam hasn't started yet)
  const workFor = async (p) => {
    const a = A(); let w = p._work || a.workOfCard?.(p.id); if (w) return w;
    const { _work, ...card } = p; const r = await a.tapi('POST', '/api/work', { cardId: p.id, card, decided: a.S.decided?.[p.id] || null });
    if (r.work) { a.putWork(r.work); return r.work; } return null;
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } };

  const send = async (p, w, to, force) => {
    const a = A();
    const r = await a.tapi('POST', `/api/work/${w.id}/doc/ship`, { to, force, base: location.origin, decided: a.S.decided?.[p.id] || null });
    if (r.needs) return ask(p, w, to, r.needs);
    a.closeModal?.(); if (r.error) return a.toast(esc(r.error));
    if (r.work) a.putWork(r.work); a.counts?.(); a.repaintDetail?.(); window.__shareDone?.(r);
    if (to === 'shopos' && r.emailed && r.status) return a.toast(`${ic('send', 's16')}Brief ${esc(r.work?.ticket || '')} sent to the ShopOS team. Its status shows in the top bar.`);
    const ok = await copy(r.share?.text || r.work?.jamBrief?.md || '');
    a.toast(ok ? `${ic('copy', 's16')}Brief ${esc(r.work?.ticket || '')} copied. Paste it where ${WHO[to]} works.` : `${ic('info', 's16')}Brief ${esc(r.work?.ticket || '')} is ready. Copy it from View the brief.`);
  };
  // the brief still misses something: say what, once, then copy it anyway
  const ask = (p, w, to, missing) => A().modal(`<div class="sheet act-sheet"><header class="sh-h"><b class="sh-t">Share the brief</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <p class="rv-note is-warn">${ic('clock', 's14')}<span>Still missing: <b>${esc(missing.join(', ').toLowerCase())}</b>. Whoever runs it will ask you.</span></p>
      <div class="sp-row rv-acts"><button class="btn btn-ghost" data-close>Keep jamming</button><button class="btn btn-primary" data-share-force>${ic(to === 'shopos' ? 'send' : 'copy', 's16')}${to === 'shopos' ? 'Send it anyway' : 'Copy it anyway'}</button></div></div>`,
    (m) => m.querySelector('[data-share-force]')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; send(p, w, to, true); }));

  /* open(p, to): to = 'shopos' | 'team'; without one, a small sheet asks which */
  const open = async (p0, to) => {
    const a = A(), p = p0 || a.currentDetail?.() || a.studioCard?.(); if (!p) return;
    const w = await workFor(p); if (!w) return a.toast('Couldn’t start the jam. Try again.');
    if (to) return send(p, w, to, false);
    a.modal(`<div class="sheet act-sheet"><header class="sh-h"><b class="sh-t">Share the brief</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
        <p class="sh-sub">Send it to the ShopOS team and they take it from here, or copy it with a link to everything for your own team.</p>
        <div class="sp-row rv-acts"><button class="btn btn-primary" data-share-to="shopos">${ic('send', 's16')}Send to the ShopOS team</button><button class="btn btn-ghost" data-share-to="team">Share with my team</button></div></div>`,
      (m) => m.querySelectorAll('[data-share-to]').forEach((b) => b.addEventListener('click', () => { b.disabled = true; send(p, w, b.dataset.shareTo, false); })));
  };
  window.Share = { open };
})();
