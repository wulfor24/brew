// Briefs sent to our team: the staff controls in the jam (the studio's ship bar and the jam room's ship row).
// Only our own people see them (window.LIVE.full, the same check as auth.isAdmin on the server); a brand member never does.
// They show where the brief is, one clear button for the usual next step and the other allowed steps in a small menu, and
// call POST /api/work/:wid/brief/status (jam-brief.js), which checks staff again. The brand sees the change in its top bar.
// NEXT must stay the same as brief-status.js NEXT: test/brief-staff.test.js checks every pair.
(() => {
  const NEXT = { sent: ['received', 'in_progress', 'needs_info', 'delivered'], received: ['in_progress', 'needs_info', 'delivered'], in_progress: ['needs_info', 'delivered'], needs_info: ['in_progress', 'delivered'], delivered: ['in_progress'] };
  /* the usual next step: the one big button. A delivered brief has none; reopening it is a quiet button */
  const PRIMARY = { sent: 'received', received: 'in_progress', in_progress: 'delivered', needs_info: 'in_progress', delivered: null };
  const LABEL = { sent: 'Sent', received: 'Received', in_progress: 'In progress', needs_info: 'Needs info', delivered: 'Delivered' };
  const VERB = (to, from) => (to === 'received' ? 'Mark received' : to === 'in_progress' ? (from === 'delivered' ? 'Reopen it' : from === 'needs_info' ? 'Back to work' : 'Start work') : to === 'needs_info' ? 'Ask for info' : to === 'delivered' ? 'Mark delivered' : LABEL[to] || to);
  const S = { ask: null, busy: null, repaint: [] };
  const staff = () => !!(window.LIVE?.full || window.LIVE?.access?.full) && !window.BREW_DEMO;
  /* a brief our team tracks: sent by email (it has a status), not one copied for the brand's own team */
  const tracked = (w) => !!(w?.jamBrief?.status && w.jamBrief.to !== 'team' && NEXT[w.jamBrief.status]);
  const shows = (w) => staff() && tracked(w);
  const plainEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* the controls for one jam. '' for anyone but our team, and for a brief that isn't tracked */
  const html = (w, { esc = plainEsc, ic = () => '', cls = 'ship info' } = {}) => {
    if (!shows(w)) return '';
    const st = w.jamBrief.status, nx = NEXT[st] || [], main = PRIMARY[st] && nx.includes(PRIMARY[st]) ? PRIMARY[st] : null, rest = nx.filter((x) => x !== main), busy = S.busy === w.id;
    const ni = st === 'needs_info' ? (w.jamBrief.history || []).find((h) => h.s === 'needs_info') : null;
    const head = `<b>${ic('send', 's16')}Our team${w.ticket ? ` · ${esc(w.ticket)}` : ''} · <span data-bs-now>${esc(LABEL[st])}</span></b>`;
    if (S.ask === w.id) return `<div class="${cls} bs-staff" data-bs="${esc(w.id)}"><div class="ship-tx">${head}<span>What do you need from them? They get it by email and answer in the jam.</span>
      <textarea class="bs-note" data-bs-note rows="2" maxlength="2000" aria-label="What we need from them" placeholder="One plain question"></textarea></div>
      <div class="ship-btns"><button type="button" class="btn btn-ghost" data-bs-cancel>Cancel</button><button type="button" class="btn btn-primary" data-bs-go="needs_info" data-bs-wid="${esc(w.id)}"${busy ? ' disabled' : ''}>Send the question</button></div></div>`;
    const btn = (to, primary) => `<button type="button" class="btn ${primary ? 'btn-primary ship-go' : 'btn-ghost'}" data-bs-go="${esc(to)}" data-bs-wid="${esc(w.id)}"${busy ? ' disabled' : ''}>${esc(VERB(to, st))}</button>`;
    const menu = main && rest.length ? `<details class="rd2-more ship-more bs-more"><summary aria-label="Other steps">${ic('more', 's16')}</summary><div class="rd2-menu">${rest.map((to) => `<button type="button" data-bs-go="${esc(to)}" data-bs-wid="${esc(w.id)}"${busy ? ' disabled' : ''}><span><b>${esc(VERB(to, st))}</b><small>${esc(`Status: ${LABEL[to]}`)}</small></span></button>`).join('')}</div></details>` : '';
    const sub = ni?.note ? `Asked: ${esc(ni.note)}` : 'Only our team sees this. The brand sees the status in its top bar and gets an email.';
    return `<div class="${cls} bs-staff" data-bs="${esc(w.id)}"><div class="ship-tx">${head}<span>${sub}</span></div><div class="ship-btns">${menu}${main ? btn(main, true) : rest.map((to) => btn(to, false)).join('')}</div></div>`;
  };

  const paint = () => S.repaint.forEach((fn) => { try { fn(); } catch (e) { /* a view that isn't open */ } });
  const go = async (wid, to, note) => {
    const A = window.__BREW; if (!A?.tapi || !staff() || S.busy) return;
    if (to === 'needs_info' && !String(note || '').trim()) { S.ask = wid; paint(); setTimeout(() => document.querySelector(`[data-bs="${CSS.escape(wid)}"] [data-bs-note]`)?.focus(), 0); return; }
    S.busy = wid; paint();
    const r = await A.tapi('POST', `/api/work/${encodeURIComponent(wid)}/brief/status`, { status: to, ...(note ? { note } : {}) });
    S.busy = null;
    if (r?.error || !r?.work) { A.toast?.(r?.error ? A.esc(r.error) : 'That didn’t go through. Try again.'); return paint(); }
    S.ask = null; A.putWork?.(r.work); A.toast?.(`${A.ic ? A.ic('check', 's16') : ''}${A.esc(LABEL[r.status] || 'Updated')}. The brand sees it now.`);
    await A.pullWork?.(true); A.counts?.(); paint();
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-bs-go]'); if (b) { e.preventDefault(); e.stopPropagation(); b.closest('details')?.removeAttribute('open');
      const box = b.closest('[data-bs]'), note = box?.querySelector('[data-bs-note]')?.value || ''; return go(b.dataset.bsWid, b.dataset.bsGo, note.trim()); }
    if (e.target.closest?.('[data-bs-cancel]')) { e.preventDefault(); e.stopPropagation(); S.ask = null; paint(); }
  }, true);

  window.BriefStaff = { NEXT, PRIMARY, LABEL, VERB, html, shows, onPaint: (fn) => S.repaint.push(fn), _state: S };
})();
