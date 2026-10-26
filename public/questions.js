/* The reading screen's questions (app.js setup, #v2-stage in its left rail): five taps while the store is read behind them,
   the seat, what comes first, the channels, the products to lead with and the rivals. app.js's own stream passes events in
   (feed); when the questions are over and the read is in, the confirm goes up (when a brand tap was answered) and onDone tells
   the reading screen to show its done bar. Answers are kept per brand in this browser (q1) and per person on the server. */
(() => {
  const A = () => window.__BREW; // app.js helpers, set before the boot router runs
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/\u2039(?=\s?\d)/g, '₹').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const B = () => A().B, slug = () => B().slug || window.BRAND;
  let QO = null, qWait = false;
  const KEY = () => `${A().LSP()}q1`;
  const ic = (k, s) => A().ic(k, s), face = (a) => A().face(a);

  /* ---------- state kept in this browser, so a refresh carries on where it was ---------- */
  const fresh = () => ({ v: 1, startedAt: Date.now(), i: 0, done: {}, v2: { hero: [], removed: [], removeRivals: [] }, picks: {}, ready: false, posted: false, confirmed: false });
  let st = null;
  const load = () => { try { st = { ...fresh(), ...JSON.parse(ls.get(KEY()) || '{}') }; } catch (e) { st = fresh(); } return st; };
  const save = () => ls.set(KEY(), JSON.stringify(st));

  const hint = (t) => `<p class="ob2-foot v2-hint">${t}</p>`;
  /* the questions draw into the reading screen's layer; when it is closed, onShow reopens it */
  const stage = (inner) => { let s = $('#v2-stage'); if (!s) { QO?.onShow?.(); s = $('#v2-stage'); } if (!s) return null; s.innerHTML = inner; s.classList.remove('is-in'); void s.offsetWidth; s.classList.add('is-in'); window.scrollTo(0, 0); };

  /* ---------- keys: the two that matter are always on screen ---------- */
  let keyFn = null; const keys = (fn) => { keyFn = fn; };
  const keysOn = () => !!$('#qfull #v2-stage');
  document.addEventListener('keydown', (e) => { if (!keyFn || !keysOn()) return; if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key === ' ' ? 'Space' : e.key; if (keyFn(k) === true) e.preventDefault(); });

  /* ---------- the questions ---------- */
  const S = () => A().S, V = () => S().viewer;
  const setViewer = (patch) => { Object.assign(S().viewer, patch); A().save(); };
  const seatTiles = () => A().seatEntries().map(([k, r]) => ({ v: k, t: r.title, s: r.line, face: r.face }));
  /* channels: every one they run (a cap would sink cards for a channel they do run), and none is an answer too */
  const beats = () => [
    { id: 'seat', kind: 'tap', q: 'Who’s this feed for?', p: 'Pick your seat. The feed ranks and words every card for it. You can switch any time.', tiles: seatTiles(), get: () => V().role, set: (v) => setViewer({ role: v, wants: V().wantsTouched ? V().wants : A().defaultWants(v) }) },
    { id: 'first', kind: 'tap', multi: 2, q: 'What should come first?', p: 'Pick up to two.', tiles: Object.entries(B().wants || {}).slice(0, 4).map(([k, w]) => ({ v: k, t: w.name, s: w.line })), get: () => V().wants || [], set: (v) => setViewer({ wants: v, wantsTouched: true }) },
    { id: 'channels', kind: 'tap', multi: 6, optional: true, q: 'Which channels do you run?', p: 'Pick every one you run. Plays for the others sit lower.', tiles: [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['google', 'Google'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['marketplace', 'Marketplaces']].map(([v, t]) => ({ v, t, chan: v })), get: () => V().channels || [], set: (v) => setViewer({ channels: v }) },
    { id: 'lead', kind: 'brand', needs: 'catalog', q: 'Which of these should we lead with?', p: 'Tap the ones to push first. × if it isn’t a real product.' },
    { id: 'rivals', kind: 'brand', needs: 'rivals', q: 'Who do you lose sales to?', p: 'Keep the brands you really compete with. × if it isn’t a rival.' }
  ].filter((b) => !(b.kind === 'brand' && st?.confirmed));
  const beatAt = (i) => beats()[i];
  const needsMet = (b) => { if (!b.needs) return true; if (st.confirmed) return 'skip'; const p = st.picks[b.needs]; if (p && !(Array.isArray(p) && !p.length)) return true; if (st.ready) return 'late'; return false; };
  const next = async () => {
    if (!QO || st.qDone) return; /* the reading screen was left, or the questions are over */
    const bs = beats();
    for (let i = 0; i < bs.length; i++) { const b = bs[i]; if (st.done[b.id]) continue;
      if (b.kind === 'brand') { const m = needsMet(b); if (m === false) continue; if (m === 'skip') { st.done[b.id] = 'skip'; continue; }
        if (m === 'late') { const ok = await lateData(b.needs); if (!ok) { st.done[b.id] = 'skip'; continue; } } }
      st.i = i; save(); return show(b); }
    return qEnd();
  };
  const finish = (b, val) => { st.done[b.id] = val ?? true; save(); if (window.__tapped?.()) window.__sound?.('step'); /* only when a tap moved it on */ return next(); };
  const show = (b) => { QO?.onStep?.(beats().findIndex((x) => x.id === b.id), beats().length); return (b.kind === 'brand' ? brandTap : tap)(b); };
  const back = () => { const bs = beats(); for (let i = st.i - 1; i >= 0; i--) { delete st.done[bs[i].id]; st.i = i; save(); return show(bs[i]); } };

  /* ---------- a tap: v1's tiles, keys 1–4, Space confirms a multi-select ---------- */
  const CHAN = { instagram: 'instagram.svg', facebook: 'meta.svg', google: 'google.svg', whatsapp: 'whatsapp.svg', marketplace: 'amazon.svg' };
  const chanGlyph = (v) => `<span class="ob2-ic">${CHAN[v] ? `<img src="assets/logos/${CHAN[v]}" alt="">` : ic(v === 'email' ? 'send' : 'grid', 's18')}</span>`;
  const tileHtml = (t, i, on) => `<button class="ob2-tile" data-v="${esc(t.v)}" aria-pressed="${on}">${t.face ? face(t.face) : t.chan ? chanGlyph(t.chan) : t.glyph ? `<span class="ob2-ic">${A().glyph(t.glyph, 34)}</span>` : ''}<b>${esc(t.t)}</b>${t.s ? `<span>${esc(t.s)}</span>` : ''}${t.star ? `<small class="v2-star">Our pick</small>` : ''}<kbd class="v2-kbd">${i + 1}</kbd><i class="ob2-tick">${ic('check', 's14')}</i></button>`;
  const nav = (label, back0 = true) => `<div class="ob2-nav">${back0 ? `<button class="btn btn-ghost lg" id="v2-back">${ic('left', 's18')} Back</button>` : '<span></span>'}<button class="btn btn-primary lg" id="v2-next">${label} ${ic('right', 's18')}</button></div>`;
  const tap = (b) => {
    let cur = b.multi ? [...(b.get() || [])] : b.get();
    const on = (v) => b.multi ? cur.map(String).includes(String(v)) : String(cur) === String(v);
    const paint = () => { $$('.ob2-tile').forEach((el) => el.setAttribute('aria-pressed', on(el.dataset.v))); const n = $('#v2-next'); if (n) n.disabled = !cur.length && !b.optional; };
    const cols = b.tiles.length === 3 || b.tiles.length > 4 ? ' three' : '';
    stage(`<h1 class="ob2-h">${b.q}</h1>${b.p ? `<p class="ob2-lede">${b.p}</p>` : ''}<div class="ob2-grid${cols}">${b.tiles.map((t, i) => tileHtml(t, i, on(t.v))).join('')}</div>
      ${b.multi ? nav('Next') : hint(`<kbd>1</kbd>–<kbd>${b.tiles.length}</kbd> or tap`)}`);
    const pick = (v0) => { const t = b.tiles.find((x) => String(x.v) === String(v0)); if (!t) return; const v = t.v;
      if (b.multi) { cur = on(v) ? cur.filter((x) => String(x) !== String(v)) : [...cur, v].slice(-b.multi); paint(); return; }
      cur = v; paint(); b.set(v); keys(null); setTimeout(() => finish(b, v), 180); };
    const confirm = () => { if (!b.multi || (!cur.length && !b.optional)) return; b.set(cur); keys(null); finish(b, cur); };
    $$('.ob2-tile').forEach((el) => (el.onclick = () => pick(el.dataset.v)));
    $('#v2-next')?.addEventListener('click', confirm); $('#v2-back')?.addEventListener('click', back);
    keys((k) => { const n = +k; if (n >= 1 && n <= b.tiles.length) { pick(b.tiles[n - 1].v); return true; } if ((k === 'Space' || k === 'Enter') && b.multi) { confirm(); return true; } if (k === 'Backspace') { back(); return true; } });
    paint();
  };

  /* ---------- brand taps: the check page as taps, from the reader's picks (or /check once the read is in) ---------- */
  const lateData = async (k) => { const D = await A().api(`/api/brands/${slug()}/check`).catch(() => null); if (!D || D.error) return false;
    if (k === 'catalog') st.picks.catalog = (D.products || []).slice(0, 12).map((x) => ({ handle: x.handle, title: x.title, price: x.price, img: x.img, hero: x.hero }));
    if (k === 'rivals') st.picks.rivals = (D.rivals || []).map((r) => ({ host: r.host, name: r.name, logo: r.logo, live: r.live }));
    save(); const p = st.picks[k]; return !!p && !(Array.isArray(p) && !p.length) && !p.error; };
  const brandTap = (b) => {
    const p = st.picks[b.needs]; if (!p || p.error) return finish(b, 'skip');
    if (b.needs === 'catalog') {
      const items = p.slice(0, 6); const hero = new Set(items.filter((x) => x.hero).map((x) => x.handle)); if (!hero.size) items.slice(0, Math.min(3, items.length)).forEach((x) => hero.add(x.handle)); const removed = new Set();
      const paint = () => $$('.ob2-prod').forEach((el) => { el.setAttribute('aria-pressed', hero.has(el.dataset.h)); el.hidden = removed.has(el.dataset.h); });
      stage(`<h1 class="ob2-h">${b.q}</h1><p class="ob2-lede">${b.p}</p><div class="ob2-grid three v2-prods">${items.map((x, i) => `<div class="ob2-prod" data-h="${esc(x.handle)}" role="button" tabindex="0" aria-pressed="false"><kbd class="v2-kbd">${i + 1}</kbd>${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : '<span class="v2-noimg"></span>'}<b>${esc(x.title)}</b><span>${esc(x.price || '')}</span><button class="icon-btn v2-x" data-x="${esc(x.handle)}" aria-label="Not a real product" title="Not a real product">${ic('x', 's14')}</button><i class="ob2-tick">${ic('check', 's14')}</i></div>`).join('')}</div>
        ${nav('Lead with these')}${hint(`<kbd>1</kbd>–<kbd>${items.length}</kbd> toggle · <kbd>Space</kbd> next`)}`);
      const tog = (h) => { hero.has(h) ? hero.delete(h) : hero.add(h); paint(); };
      $$('.ob2-prod').forEach((el) => { el.onclick = (e) => { const x = e.target.closest('[data-x]'); if (x) { removed.add(x.dataset.x); hero.delete(x.dataset.x); paint(); return; } tog(el.dataset.h); }; el.onkeydown = (e) => { if (e.key === 'Enter') tog(el.dataset.h); }; });
      const go = () => { st.v2.hero = [...hero]; st.v2.removed = [...removed]; keys(null); finish(b, true); };
      $('#v2-next').onclick = go; $('#v2-back').onclick = back; keys((k) => { const n = +k; if (n >= 1 && n <= items.length) { tog(items[n - 1].handle); return true; } if (k === 'Space' || k === 'Enter') { go(); return true; } if (k === 'Backspace') { back(); return true; } }); paint(); return;
    }
    if (b.needs === 'rivals') {
      const items = p.slice(0, 6); const gone = new Set();
      stage(`<h1 class="ob2-h">${b.q}</h1><p class="ob2-lede">${b.p}</p><div class="v2-rows">${items.map((r, i) => `<div class="lg-row v2-rival" data-host="${esc(r.host)}"><kbd class="v2-kbd">${i + 1}</kbd><span class="lg-ic"><img src="${esc(r.logo || `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(r.host)}`)}" alt="" loading="lazy"></span><span class="lg-tx"><b>${esc(r.name || r.host)}</b><span>${esc(r.host)}${r.live ? ` · ${r.live} live ad${r.live === 1 ? '' : 's'}` : ''}</span></span><button class="icon-btn" data-x="${esc(r.host)}" aria-label="Not a rival" title="Not a rival">${ic('x', 's16')}</button></div>`).join('')}</div>
        ${nav('These are the ones')}${hint(`<kbd>1</kbd>–<kbd>${items.length}</kbd> removes · <kbd>Space</kbd> next`)}`);
      const drop = (h) => { gone.add(h); $(`.v2-rival[data-host="${CSS.escape(h)}"]`)?.setAttribute('hidden', ''); };
      $$('[data-x]').forEach((x) => (x.onclick = () => drop(x.dataset.x)));
      const go = () => { st.v2.removeRivals = [...gone]; keys(null); finish(b, true); };
      $('#v2-next').onclick = go; $('#v2-back').onclick = back; keys((k) => { const n = +k; if (n >= 1 && n <= items.length) { drop(items[n - 1].host); return true; } if (k === 'Space' || k === 'Enter') { go(); return true; } if (k === 'Backspace') { back(); return true; } }); return;
    }
    finish(b, 'skip');
  };

  /* the taps replaced the check page: once the read is in and both brand taps are past, the same confirm goes up and the moves start */
  const postConfirm = async () => { if (st.posted || st.confirmed || !st.ready) return;
    const bt = ['lead', 'rivals']; if (!bt.every((k) => st.done[k])) return; if (!bt.some((k) => st.done[k] === true)) return; /* none answered → the check page instead (it also holds Is this you?) */
    st.posted = true; save();
    /* only the taps that were answered go up: an empty hero list would otherwise unset the brand's leads (build.js applyCheck) */
    const v2 = { who: {}, company: {}, sources: {} }; if (st.done.lead === true && (st.v2.hero || []).length) { v2.hero = st.v2.hero; v2.removed = st.v2.removed; } if (st.done.rivals === true) v2.removeRivals = st.v2.removeRivals;
    const r = await A().api(`/api/brands/${slug()}/confirm`, { v2 }).catch(() => null);
    if (r?.signin || r?.error) { st.posted = false; save(); if (r?.signin) A().signWall('check'); else A().toast(`${ic('info', 's16')}${esc(r.error || 'Could not save what you picked.')}`); return; }
    if (r?.notes?.length) A().toast(`${ic('info', 's16')}${esc(r.notes.join(' '))}`); };

  const qDone = () => { qWait = false; keys(null); st.qDone = true; save(); const o = QO; QO = null; o?.onDone?.({ posted: !!st.posted, skipped: !!st.skipped }); };
  const qEnd = async () => { keys(null);
    if (st.ready || st.error) { if (!st.error) await postConfirm(); return qDone(); }
    qWait = true; /* every question answered, the read still running: back to the read; a product or rival question whose
       data lands later reopens the layer (stage → onShow) */
    QO?.onWait?.(); };
  const qFeed = (ev) => { if (!st || st.qDone || !ev) return;
    if (ev.type === 'picks' && ev.k) { st.picks[ev.k] = ev.items; save(); if (qWait && beats().some((b) => b.kind === 'brand' && !st.done[b.id] && needsMet(b) === true)) { qWait = false; next(); } }
    if (ev.type === 'ready' && !st.ready) { st.ready = true; save(); if (qWait) { qWait = false; next(); } }
    if (ev.type === 'error') { st.error = ev.msg || 'The store did not open for us.'; save(); qDone(); } };
  const qSkip = () => { if (!st || st.qDone) return; keys(null); st.skipped = true; beats().forEach((b) => { if (!st.done[b.id]) st.done[b.id] = 'skip'; }); save(); qEnd(); };
  const questions = async (o = {}) => { QO = o; qWait = false; load();
    const s = await A().api(`/api/brands/${slug()}/status`).catch(() => null); st.confirmed = s?.stages?.confirm?.state === 'done'; if (s?.stages?.read?.state === 'done') st.ready = true; save();
    next();
    return { feed: qFeed, skip: qSkip, posted: () => !!st?.posted, answered: (id) => !!st?.done?.[id] && st.done[id] !== 'skip', stop: () => { keys(null); qWait = false; QO = null; } }; };
  const qState = () => { try { return JSON.parse(ls.get(`${A().LSP()}q1`) || '{}'); } catch (e) { return {}; } };
  const reset = () => { ls.del(KEY()); st = null; };
  const debug = () => ({ st, beat: beatAt(st?.i || 0)?.id, kind: beatAt(st?.i || 0)?.kind });
  window.OB2 = { reset, debug, questions, qState };
})();
