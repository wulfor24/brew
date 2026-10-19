/* Brew v2 onboarding: "the morning". Behind the V2 flag (app.js: ?v=2 / BREW_V). The store is read in the background while
   the person taps through a few questions, a short story and a hands-on tutorial, all inside Brew's own onboarding shell:
   the question on the left, the live read on the right where v1 shows the preview. Done is "Good morning, {Brand}" with the
   real health rings; then the first three real cards as a swipe stack, the gate, and the feed. The same stack runs each
   morning when FEED_STACK is on. Honest by rule: the read rail follows the real stream, a stage that found nothing shows a
   dash, errors are shown as errors, no time saved is invented. */
(() => {
  const A = () => window.__BREW; // app.js helpers, set before the boot router runs
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/\u2039(?=\s?\d)/g, '₹').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const root = () => $('#root');
  const B = () => A().B, slug = () => B().slug || window.BRAND, brand = () => B().brand || {}, name = () => brand().name || brand().host || 'your store';
  /* mode 'q' (2026-10-19): v1's reading screen asks the same questions (OB2.questions); its own key, so v1 and v2 never mix */
  let mode = 'v2', QO = null, qWait = false;
  const KEY = () => `${A().LSP()}${mode === 'q' ? 'q1' : 'v2'}`;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ic = (k, s) => A().ic(k, s), face = (a) => A().face(a), f = (x) => (window.fx || ((s) => s))(x);

  /* ---------- state kept in this browser, so a refresh carries on where it was ---------- */
  const fresh = () => ({ v: 1, startedAt: Date.now(), i: 0, done: {}, v2: { hero: [], removed: [], removeRivals: [], who: {}, company: {}, sources: {} }, picks: {}, steps: [], findings: [], ready: false, posted: false, confirmed: false, kept: [], acted: 0, stage: 'onboard' });
  let st = null;
  /* a finding's identity: a reopened stream replays the whole read, so the same finding must count once (it was counted twice) */
  const fKey = (f) => [f?.k, f?.kind, f?.t, f?.src].join('|');
  const uniqF = (list) => { const seen = new Set(); return (list || []).filter((f) => { const k = fKey(f); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const load = () => { try { st = { ...fresh(), ...JSON.parse(ls.get(KEY()) || '{}') }; } catch (e) { st = fresh(); } st.findings = uniqF(st.findings); return st; };
  const save = () => ls.set(KEY(), JSON.stringify(st));

  /* ---------- the read, as the right-hand rail tells it (v1's reading screen, one column) ---------- */
  const STEP_KEYS = ['open', 'brand', 'catalog', 'reviews', 'ads', 'site', 'answers'];
  const STEP_T = { open: 'Open the store', brand: 'Read the brand', catalog: 'Pull the catalog', reviews: 'Read what customers say', ads: 'Find live ads, yours and rivals’', site: 'Walk the path to checkout', answers: 'Ask the AI tools' };
  let es = null, lastSay = '', readingK = null, tick = null, peek = null;
  const stepsDone = () => st.steps.filter((s) => s && s.state === 'done').length;
  const elapsed = () => { const s = Math.max(0, Math.round((Date.now() - st.startedAt) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const stepRow = (k, i) => { const s = st.steps[i], on = (!s && readingK === k) || s?.state === 'reading', done = s?.state === 'done';
    return `<li class="step${done ? ' done' : on ? ' reading' : ''}${s?.empty ? ' empty' : ''}"><span class="dot">${done ? ic(s.empty ? 'minus' : 'check', 's14') : on ? '<span class="spin"></span>' : ''}</span><div><b>${esc(STEP_T[k])}</b><span>${esc(done ? s.done || (s.empty ? 'Nothing found' : 'Done') : on ? 'Reading' : 'Queued')}</span></div></li>`; };
  /* the one line under the question: where the read is, in words; never a bar that runs ahead of it */
  const statusLine = () => st.error ? `<p class="ob2-foot v2-status is-bad">${ic('info', 's14')}We couldn’t read ${esc(name())}: ${esc(st.error)}</p>`
    : st.ready ? `<p class="ob2-foot v2-status">${ic('check', 's14')}${esc(name())} is read: ${stepsDone()} of ${STEP_KEYS.length} sources${st.findings.length ? `, ${st.findings.length} findings` : ''}.</p>`
    : `<p class="ob2-foot v2-status"><span class="spin"></span>Reading ${esc(name())}: ${stepsDone()} of ${STEP_KEYS.length} sources · <time>${elapsed()}</time>${lastSay ? ` · ${esc(lastSay)}` : ''}</p>`;
  const peekCard = () => peek && !peek.error ? `<article class="scr fc v2-peek"><header><h5>Your site</h5><span class="fc-src">${ic('link', 's14')}${esc(peek.host || brand().host || '')}</span></header>${peek.ogImage ? `<div class="fc-media"><img src="${esc(peek.ogImage)}" alt=""></div>` : ''}<p class="fc-p"><b>${esc(peek.title || '')}</b>${peek.description ? ` ${esc(String(peek.description).slice(0, 140))}` : ''}</p></article>` : '';
  const railHtml = () => `<div class="v2-rail"><div class="host">${brand().mark ? `<img src="${esc(brand().mark)}" alt="">` : `<span class="so-mark">${A().SO()}</span>`}<span>${esc(brand().host || name())}</span></div>
      <ol class="steps">${STEP_KEYS.map(stepRow).join('')}</ol></div>
    <div class="v2-found scr-grid" id="v2-found">${peekCard()}${st.findings.slice(-8).map(A().scrCard).join('')}</div>`;
  const paintRead = () => { const r = $('#v2-show'); if (r && !r.dataset.hold) r.innerHTML = railHtml(); const s = $('#v2-status'); if (s) s.innerHTML = statusLine(); };
  const paintTime = () => { const t = $('#v2-status time'); if (t) t.textContent = elapsed(); };
  const listen = () => {
    if (es) return; const tid = A().TID; if (!tid) return;
    es = new EventSource(`/api/tenants/${tid}/onboarding`);
    es.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.type === 'step' && ev.state === 'reading') { readingK = STEP_KEYS[ev.i] || readingK; st.steps[ev.i] = { k: STEP_KEYS[ev.i], state: 'reading' }; }
      if (ev.type === 'step' && ev.state === 'done') { st.steps[ev.i] = { k: STEP_KEYS[ev.i], state: 'done', empty: !!ev.empty, done: ev.done }; if (readingK === STEP_KEYS[ev.i]) readingK = null; }
      if (ev.type === 'finding' && ev.finding) { const fk = fKey(ev.finding); st.findings = st.findings.filter((f) => fKey(f) !== fk); st.findings.push(ev.finding); if (st.findings.length > 40) st.findings.shift(); if (ev.say) lastSay = ev.say; if (ev.finding.kind === 'kit') washIn(ev.finding); }
      if (ev.type === 'picks' && ev.k) st.picks[ev.k] = ev.items;
      if (ev.type === 'error') { st.error = ev.msg || 'The store did not open for us.'; save(); es.close(); es = null; paintRead(); return errorScreen(); }
      if (ev.type === 'ready') { st.ready = true; save(); paintRead(); afterReady(); idle(); return; } /* the stream stays open a little: the demo's paced replay sends ready first and its findings after */
      save(); paintRead(); if (st.ready) idle(); };
    es.onerror = () => { es?.close(); es = null; setTimeout(pollStatus, 4000); }; /* the stream drops on a restart: the status poll says what is true */
    clearInterval(tick); tick = setInterval(paintTime, 1000);
  };
  /* once the read is in, the stream closes after 12 quiet seconds (every late step or finding still lands until then) */
  let idleT = 0; const idle = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (es) { es.close(); es = null; } st.steps = STEP_KEYS.map((k, i) => (st.steps[i]?.state === 'done' ? st.steps[i] : { k, state: 'done', empty: false, done: 'Done' })); save(); paintRead(); }, 12000); };
  const pollStatus = async () => { if (st.ready || st.error) return; const s = await A().api(`/api/brands/${slug()}/status`).catch(() => null);
    if (s?.error && s.unreadable) { st.error = s.state || 'The store did not open for us.'; save(); paintRead(); return errorScreen(); }
    if (s?.stages?.read?.state === 'done') { st.ready = true; save(); paintRead(); return afterReady(); }
    if (!es) listen(); setTimeout(pollStatus, 8000); };
  const washIn = (fd) => { const cols = fd.colors || brand().colors || []; if (!cols.length) return; const r = document.documentElement; cols.slice(0, 3).forEach((c, i) => r.style.setProperty(`--brand-${i + 1}`, c)); };
  /* the first card on the right is the site itself: title, line and picture, within a couple of seconds (GET /api/peek, no read starts) */
  const peekIn = async () => { const host = brand().host; if (!host || peek) return; try { peek = JSON.parse(sessionStorage.getItem(`brew-peek:${host}`) || 'null'); } catch (e) {}
    if (!peek) { peek = await A().api(`/api/peek?url=${encodeURIComponent(host)}`).catch(() => null); try { if (peek && !peek.error) sessionStorage.setItem(`brew-peek:${host}`, JSON.stringify(peek)); } catch (e) {} } paintRead(); };

  /* ---------- the shell: v1's onboarding frame, the question left, the read right ---------- */
  const lockup = () => `<span class="ob2-lock"><span class="so-mark">${A().SO()}</span>${brand().mark && !/^brew$/i.test(name()) ? `<i>×</i><img src="${esc(brand().mark)}" alt=""><span><b>Brew</b> for ${esc(name())}</span>` : '<span><b>Brew</b></span>'}</span>`;
  const hint = (t) => `<p class="ob2-foot v2-hint">${t}</p>`;
  const shell = (inner, o = {}) => { root().innerHTML = `<main class="screen ob2 v2${o.cls ? ' ' + o.cls : ''}">
      <section class="ob2-form"><header class="ob2-top">${lockup()}${o.skip === false ? '' : `<button class="btn btn-ghost sm" data-v2-skip>${o.skipLabel || 'Skip ahead'}</button>`}</header>
        <div class="ob2-body v2-body" id="v2-stage">${inner}</div>
        <div id="v2-status">${o.noStatus ? '' : statusLine()}</div></section>
      <aside class="ob2-show v2-show" aria-hidden="true"><div class="ob2-wash v2-wash"></div><div class="v2-read" id="v2-show"${o.right != null ? ' data-hold="1"' : ''}>${o.right != null ? o.right : railHtml()}</div></aside></main>`;
    $('[data-v2-skip]')?.addEventListener('click', () => (o.onSkip || skipAhead)()); window.scrollTo(0, 0); };
  const stage = (inner, o = {}) => { let s = $('#v2-stage'); if (!s && mode === 'q') { QO?.onShow?.(); s = $('#v2-stage'); } if (!s) return mode === 'q' ? null : shell(inner, o); /* v1 owns its screen: it reopens its question layer, never a v2 shell */ s.innerHTML = inner; s.classList.remove('is-in'); void s.offsetWidth; s.classList.add('is-in'); if (o.right != null) { const r = $('#v2-show'); if (r) { r.dataset.hold = '1'; r.innerHTML = o.right; } } window.scrollTo(0, 0); };
  const skipAhead = () => { if (st.error && mode !== 'q') return errorScreen(); /* a failed read never skips into an empty feed (QA 19 Oct) */ keys(null); beats().forEach((b) => { if (!['done', 'hold'].includes(b.kind)) st.done[b.id] ||= 'skip'; }); save(); next(); };

  /* ---------- keys: the two that matter are always on screen ---------- */
  let keyFn = null; const keys = (fn) => { keyFn = fn; };
  const keysOn = () => document.body.classList.contains('v2-on') || (mode === 'q' && !!$('#qfull #v2-stage'));
  document.addEventListener('keydown', (e) => { if (!keyFn || !keysOn()) return; if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key === ' ' ? 'Space' : e.key; if (keyFn(k) === true) e.preventDefault(); });

  /* ---------- the beats ---------- */
  const S = () => A().S, V = () => S().viewer;
  const setViewer = (patch) => { Object.assign(S().viewer, patch); A().save(); };
  const seatTiles = () => A().seatEntries().slice(0, mode === 'q' ? 99 : 4).map(([k, r]) => ({ v: k, t: r.title, s: r.line, face: r.face }));
  const BEATS = () => [
    { id: 'intro', kind: 'slide', kick: '6:30', ico: 'clock', h: st?.ready ? `Brew has read ${esc(name())}.` : `While Brew reads ${esc(name())}…`, p: 'A few taps, so your mornings fit you. Nothing to type.', cta: true },
    { id: 'seat', kind: 'tap', q: 'Who’s this feed for?', p: 'Pick your seat. The feed ranks and words every card for it. You can switch any time.', tiles: seatTiles(), get: () => V().role, set: (v) => setViewer({ role: v, wants: V().wantsTouched ? V().wants : A().defaultWants(v) }) },
    { id: 'first', kind: 'tap', multi: 2, q: 'What should come first?', p: 'Pick up to two.', tiles: Object.entries(B().wants || {}).slice(0, 4).map(([k, w]) => ({ v: k, t: w.name, s: w.line })), get: () => V().wants || [], set: (v) => setViewer({ wants: v, wantsTouched: true }) },
    { id: 's1', kind: 'slide', kick: 'Most mornings', ico: 'doc', h: 'Start with a blank page.', p: 'What do we make today? For whom? Why that?' },
    { id: 's2', kind: 'slide', kick: 'Then', ico: 'grid', h: 'Twelve tabs.', p: 'The Ad Library, three rival sites, the reviews, ChatGPT giving everyone the same five ideas.' },
    { id: 's3', kind: 'slide', kick: 'Brew', ico: 'sun', h: st?.ready ? `Read all of that for ${esc(name())}.` : `Reads all of that for ${esc(name())}.`, p: 'Your store, your reviews, your rivals’ ads, your checkout, what AI tools say about you. Every number with its source.' },
    { id: 'lead', kind: 'brand', needs: 'catalog', q: 'Which of these should Brew lead with?', p: 'Tap the ones to push first. × if it isn’t a real product.' },
    { id: 'channels', kind: 'tap', multi: 3, q: 'Which channels do you run?', p: 'Up to three. Moves for channels you don’t run stay out of the way.', tiles: [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['google', 'Google'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['marketplace', 'Marketplaces']].map(([v, t]) => ({ v, t, chan: v })), get: () => V().channels || [], set: (v) => setViewer({ channels: v }) },
    { id: 'perDay', kind: 'tap', q: 'How many moves a morning?', p: 'A preference, not a cap.', tiles: [{ v: 3, t: '3', s: 'Just the top of the pile' }, { v: 5, t: '5', s: 'A short morning' }, { v: 10, t: '10', s: 'The full morning', star: true }], get: () => V().perDay || 10, set: (v) => setViewer({ perDay: v }) },
    { id: 'rivals', kind: 'brand', needs: 'rivals', q: 'Who do you lose sales to?', p: 'Keep the brands you really compete with. × if it isn’t a rival.' },
    { id: 's4', kind: 'slide', kick: 'Every morning', ico: 'feed', h: 'Ready moves.', p: 'Each card says the move, why it’s here, what it moves, and asks for your call. Ads your rivals run, what people are saying, how your store scores. All of it, with sources.' },
    { id: 's5', kind: 'slide', kick: 'And', ico: 'heart', h: 'Every tap teaches tomorrow’s feed.', p: 'Keep what fits. Drop what doesn’t. Brew learns your taste, not a persona.' },
    { id: 'adPace', kind: 'tap', q: `How many ads did ${esc(name())} run last month?`, p: 'It sets what comes first: new ads, or the ground under them.', tiles: [{ v: 'none', t: 'None', s: 'Not yet' }, { v: 'few', t: 'A few', s: 'Now and then' }, { v: 'ten', t: '10 or more', s: 'Most weeks' }, { v: 'always', t: 'Always on', s: 'Every day' }], get: () => V().adPace, set: (v) => setViewer({ adPace: v }) },
    { id: 'voice', kind: 'tap', q: 'How should Brew sound?', p: 'Every draft follows it. You can change it later from any card.', tiles: [{ v: 'site', t: 'Like our site', s: 'The voice Brew read', star: true }, { v: 'warmer', t: 'Warmer', s: 'More human, fewer claims' }, { v: 'sharper', t: 'Sharper', s: 'Shorter, bolder' }, { v: 'plainer', t: 'Plainer', s: 'No flourish, just facts' }], get: () => V().voice || 'site', set: (v) => { setViewer({ voice: v }); if (mode !== 'q') voiceMemory(v); } },
    { id: 'who', kind: 'brand', needs: 'who', q: 'Is this you?', p: 'Fix anything that’s off. Brew writes from these.' },
    { id: 'tools', kind: 'tap', multi: 4, q: 'Which of these do you use?', p: 'Pick now, connect later. Read-only, always.', tiles: Object.entries(B().connectors || {}).filter(([k]) => k !== 'marketplaces').slice(0, 8).map(([k, c]) => ({ v: k, t: c.name, s: c.kind, glyph: k })), get: () => V().tools || [], set: (v) => setViewer({ tools: v }) },
    { id: 'team', kind: 'tap', q: 'Who else should see this?', p: 'You can invite them at the end, or later from the menu.', tiles: [{ v: 'me', t: 'Just me' }, { v: 'few', t: '2 to 5 of us' }, { v: 'team', t: 'A team' }, { v: 'agency', t: 'Us and an agency' }], get: () => V().teamSize, set: (v) => setViewer({ teamSize: v }) },
    { id: 'tut', kind: 'tutorial' },
    { id: 'hold', kind: 'hold' },
    { id: 'done', kind: 'done' }
  ];
  /* v1 (mode q, 19 Oct): five questions, full screen, while the read runs behind them: the seat, what comes first, the channels,
     the products to lead with, the rivals. No slides, tutorial, hold or done. Ad pace comes from the ads the read counted
     (channel-fit paceOf); voice, moves a morning, tools and team keep their defaults and live in Your feed and the later steps.
     Channels: every one they run (a cap would sink cards for a channel they do run), and none is an answer too */
  const Q_ORDER = ['seat', 'first', 'channels', 'lead', 'rivals'];
  const V1COPY = { channels: { multi: 6, optional: true, p: 'Pick every one you run. Moves for the others sit lower.' } };
  const beats = () => { const bs = BEATS(); if (mode !== 'q') return bs;
    return Q_ORDER.map((id) => bs.find((b) => b.id === id)).filter((b) => b && !(b.kind === 'brand' && st?.confirmed)).map((b) => (V1COPY[b.id] ? { ...b, ...V1COPY[b.id] } : b)); };
  const beatAt = (i) => beats()[i];
  const needsMet = (b) => { if (!b.needs) return true; if (st.confirmed) return 'skip'; const p = st.picks[b.needs]; if (p && !(Array.isArray(p) && !p.length)) return true; if (st.ready) return 'late'; return false; };
  const next = async () => {
    if (mode === 'q' && (!QO || st.qDone)) return; /* v1 left the reading screen, or the questions are over */
    const bs = beats();
    for (let i = 0; i < bs.length; i++) { const b = bs[i]; if (st.done[b.id]) continue;
      if (b.kind === 'brand') { const m = needsMet(b); if (m === false) continue; if (m === 'skip') { st.done[b.id] = 'skip'; continue; }
        if (m === 'late') { const ok = await lateData(b.needs); if (!ok) { st.done[b.id] = 'skip'; continue; } } }
      if (b.kind === 'hold' && (st.ready || st.error)) { st.done[b.id] = 'skip'; continue; }
      st.i = i; save(); return show(b); }
    if (mode === 'q') return qEnd();
    return show(bs[bs.length - 1]);
  };
  const finish = (b, val) => { st.done[b.id] = val ?? true; save(); return next(); };
  const show = (b) => { if (mode === 'q') QO?.onStep?.(beats().findIndex((x) => x.id === b.id), beats().length); return ({ slide, tap, brand: brandTap, tutorial, hold, done }[b.kind] || slide)(b); };
  const back = () => { const bs = beats(); for (let i = st.i - 1; i >= 0; i--) { if (bs[i].kind === 'hold' || bs[i].kind === 'done') continue; delete st.done[bs[i].id]; st.i = i; save(); return show(bs[i]); } };

  /* ---------- a slide: a kicker, one line, one sentence; a key or a tap moves on, or it moves on by itself ---------- */
  const kick = (t, inner) => `<span class="ob2-eyebrow v2-kick"><span class="v2-ic">${inner}</span>${esc(t)}</span>`;
  const slide = (b) => {
    stage(`${kick(b.kick || '', ic(b.ico || 'sparkles', 's16'))}<h1 class="ob2-h">${b.h}</h1><p class="ob2-lede">${b.p || ''}</p>${hint(`<kbd>Space</kbd> or tap to continue`)}`);
    let gone = false; const go = () => { if (gone) return; gone = true; clearTimeout(auto); keys(null); finish(b); };
    keys((k) => { if (k === 'Space' || k === 'Enter' || k === 'ArrowRight') { go(); return true; } if (k === 'Backspace') { back(); return true; } });
    $('#v2-stage').onclick = (e) => { if (!e.target.closest('a,button,input')) go(); };
    const auto = setTimeout(go, b.cta ? 9e3 : 3800 + (b.p || '').length * 20);
  };

  /* ---------- a tap: v1's tiles, keys 1–4, Space confirms a multi-select ---------- */
  const CHAN = { instagram: 'instagram.svg', facebook: 'meta.svg', google: 'google.svg', whatsapp: 'whatsapp.svg', marketplace: 'amazon.svg' };
  const chanGlyph = (v) => `<span class="ob2-ic">${CHAN[v] ? `<img src="assets/logos/${CHAN[v]}" alt="">` : ic(v === 'email' ? 'send' : 'grid', 's18')}</span>`;
  const tileHtml = (t, i, on) => `<button class="ob2-tile" data-v="${esc(t.v)}" aria-pressed="${on}">${t.face ? face(t.face) : t.chan ? chanGlyph(t.chan) : t.glyph ? `<span class="ob2-ic">${A().glyph(t.glyph, 34)}</span>` : ''}<b>${esc(t.t)}</b>${t.s ? `<span>${esc(t.s)}</span>` : ''}${t.star ? `<small class="v2-star">Brew’s pick</small>` : ''}<kbd class="v2-kbd">${i + 1}</kbd><i class="ob2-tick">${ic('check', 's14')}</i></button>`;
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
  const voiceMemory = async (v) => { const line = { warmer: 'Voice: warmer than the site. More human, fewer claims, no exclamation marks.', sharper: 'Voice: sharper than the site. Short lines, bold claims only when a number backs them.', plainer: 'Voice: plainer than the site. No flourish, say the fact and stop.' }[v]; if (!line) return;
    A().tapi('POST', `/api/brands/${slug()}/drop`, { dest: 'memory', text: line }).catch(() => null); };

  /* ---------- brand taps: the check page as taps, from the reader's picks (or /check once the read is in) ---------- */
  const lateData = async (k) => { const D = await A().api(`/api/brands/${slug()}/check`).catch(() => null); if (!D || D.error) return false;
    if (k === 'catalog') st.picks.catalog = (D.products || []).slice(0, 12).map((x) => ({ handle: x.handle, title: x.title, price: x.price, img: x.img, hero: x.hero }));
    if (k === 'rivals') st.picks.rivals = (D.rivals || []).map((r) => ({ host: r.host, name: r.name, logo: r.logo, live: r.live }));
    if (k === 'who') st.picks.who = Object.fromEntries((D.who || []).map((x) => [x.key, { v: x.v, label: x.label, src: x.src, type: x.type }]));
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
    if (b.needs === 'who') {
      const w = p; const rows = [['name', 'Brand name'], ['descriptor', 'What you are, in one line'], ['category', 'Category'], ['country', 'Main selling market'], ['currency', 'Currency']].map(([k, label]) => ({ k, label: w[k]?.label || label, v: w[k]?.v ?? (typeof w[k] === 'string' ? w[k] : '') ?? '' })).filter((r) => r.v || r.k !== 'descriptor');
      stage(`<h1 class="ob2-h">${b.q}</h1><p class="ob2-lede">${b.p}</p><section class="ck2-card v2-who"><div class="ck2-grid">${rows.map((r) => `<label class="ck2-f${r.k === 'descriptor' ? ' ck2-wide' : ''}"><span>${esc(r.label)}</span><input data-k="${r.k}" value="${esc(r.v)}" placeholder="Add it if you know it"></label>`).join('')}</div></section>
        ${nav('Yes, that’s us')}${hint(`<kbd>Space</kbd> yes · edit any field first`)}`);
      const go = () => { $$('.v2-who input').forEach((i) => { const was = rows.find((r) => r.k === i.dataset.k)?.v || ''; if (i.value.trim() && i.value.trim() !== was) st.v2.who[i.dataset.k] = i.value.trim(); }); keys(null); finish(b, true); };
      $('#v2-next').onclick = go; $('#v2-back').onclick = back; keys((k) => { if (k === 'Space' || k === 'Enter') { go(); return true; } if (k === 'Backspace') { back(); return true; } }); return;
    }
    finish(b, 'skip');
  };

  /* ---------- the card: the feed's own card, for the tutorial's examples and the stack's real ones ---------- */
  const KIND_T = { move: 'A move', 'rival-ad': 'A rival’s ad', heard: 'Heard this week', answer: 'What AI says', report: 'A number moved', creative: 'A draft, yours', idea: 'An idea', joke: 'A move?' };
  const cardHtml = ({ id, who, kind, img, theirs, title, body, moves, example, drawing }) => `<article class="card v2-card" data-id="${esc(id)}">
      <header class="card-head">${who.mark ? `<img class="v2-mk" src="${esc(who.mark)}" alt="">` : face('brew')}<div class="who"><b>${esc(who.name)}</b><span>${esc(KIND_T[kind] || 'A card')}</span></div>${example ? '<span class="badge info">Example</span>' : ''}${drawing ? '<span class="badge warn">drawing…</span>' : ''}</header>
      ${img ? `<div class="media portrait"><img src="${esc(img)}" alt="">${theirs ? '<span class="fd-lab">Their ad</span>' : ''}</div>` : ''}
      <div class="body"><h3>${esc(title)}</h3><p>${esc(body || '')}</p>${moves ? `<div class="v2-moves">${ic('trendup', 's14')}${esc(moves)}</div>` : ''}</div></article>`;
  /* rival test and "our picture" are the sheet's own (make-sheet.js): a rival's poster is shown only as theirs, never as ours */
  const MS = () => window.MakeSheet || {}, isRival = (p) => MS().isRival?.(p) ?? (p?.research?.kind === 'ad' || !!p?.research?.ad);
  const kindOf = (p) => p.post?.platform ? 'heard' : isRival(p) ? 'rival-ad' : p.kind === 'answer' || p.agent === 'visibility' ? 'answer' : /^m\d+/.test(String(p.id)) || p.move ? 'move' : p.family === 'result' ? 'report' : (p.images || []).length ? 'creative' : 'idea';
  const whyOf = (c) => f(c.because || (c.detail?.why || [])[0] || '');
  const realCard = (p) => { const c = A().cardOf(p), ours = MS().ourPic?.(p, c) || null, theirs = !ours && isRival(p) ? (c.images || [])[0] : null;
    return cardHtml({ id: p.id, who: { name: name(), mark: brand().mark || brand().logo }, kind: kindOf(p), img: ours || theirs, theirs: !!theirs, title: f(c.title), body: f(c.sub || c.p || ''), drawing: !!c.take?.drawing }); };
  const openParts = (card, c) => { const body = $('.body', card); if (!body || $('.v2-parts', card)) return; body.insertAdjacentHTML('beforeend', `<div class="inset v2-parts"><div class="rows"><div><span>The move</span><b>${esc(c.title)}</b></div>${c.why ? `<div><span>Why it’s here</span><b>${esc(c.why)}</b></div>` : ''}${c.moves ? `<div><span>What it moves</span><b>${esc(c.moves)}</b></div>` : ''}<div><span>Your call</span><b>Keep, drop, another take, or make it yours</b></div></div></div>`); };
  const nudge = (card, want) => { card.classList.remove('nudge-keep', 'nudge-drop', 'nudge-open'); void card.offsetWidth; card.classList.add(`nudge-${want}`); };
  const flyOut = (card, verb) => new Promise((r) => { card.classList.add(verb === 'keep' ? 'fly-right' : 'fly-left'); setTimeout(r, reduced() ? 0 : 380); });

  /* ---------- verbs: keep, not for me, another take, open, make it yours; swipe and buttons mean the same ---------- */
  const verbsHtml = (ex) => `<div class="v2-verbs"><button class="btn btn-ghost" data-verb="drop">${ic('x', 's16')}Not for me</button>${ex ? '' : `<button class="btn btn-ghost" data-verb="take" title="Another take">${ic('refresh', 's16')}Another take</button>`}<button class="btn btn-ghost" data-verb="open">${ic('inf', 's16')}Open</button>${ex ? '' : `<button class="btn btn-ghost" data-verb="make">${ic('sparkles', 's16')}Make it yours</button>`}<button class="btn btn-primary" data-verb="keep">${ic('check', 's16')}Keep</button></div>`;
  const bindVerbs = (card, did) => {
    $$('[data-verb]').forEach((b) => (b.onclick = () => did(b.dataset.verb)));
    let x0 = null, dx = 0, drag = false;
    const down = (e) => { if (e.target.closest('button,a,input')) return; x0 = e.clientX; dx = 0; drag = true; card.setPointerCapture?.(e.pointerId); card.classList.add('is-drag'); };
    const move = (e) => { if (!drag) return; dx = e.clientX - x0; card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`; card.classList.toggle('lean-keep', dx > 40); card.classList.toggle('lean-drop', dx < -40); };
    const up = () => { if (!drag) return; drag = false; card.classList.remove('is-drag', 'lean-keep', 'lean-drop'); const v = dx > 80 ? 'keep' : dx < -80 ? 'drop' : null; card.style.transform = ''; if (v) did(v); };
    card.addEventListener('pointerdown', down); card.addEventListener('pointermove', move); card.addEventListener('pointerup', up); card.addEventListener('pointercancel', up);
  };

  /* ---------- the tutorial, on Brew's own example cards (never the brand's data) ---------- */
  /* EXAMPLE: these four cards are Brew's own teaching examples. They are tagged Example on screen and are never shown as the brand's. */
  const EXAMPLE_CARDS = [
    { id: 'ex-1', kind: 'move', title: 'Lead the week with the bestseller, not the new drop', why: 'Your top product gets 3 of every 5 orders; the new drop gets the homepage.', moves: 'First orders' },
    { id: 'ex-2', kind: 'rival-ad', title: 'A rival has run the same ad for 61 days', why: 'A long-running ad is a working ad. Here is the angle, in your words.', moves: 'Cost per first order' },
    { id: 'ex-3', kind: 'joke', title: 'Rename the brand to something with more vowels', why: 'A very confident model suggested it. No source.', moves: 'Nothing, honestly' },
    { id: 'ex-4', kind: 'heard', title: '14 people asked the same sizing question this week', why: 'On Reddit and in your reviews. Answer it once, everywhere.', moves: 'Returns' }
  ];
  const exCard = (c) => cardHtml({ id: c.id, who: { name: 'Brew' }, kind: c.kind, title: c.title, body: c.why, moves: c.moves, example: true });
  const TUT = [
    { c: EXAMPLE_CARDS[0], h: 'Your turn. Swipe right to <b>keep</b> it.', want: 'keep', after: 'Kept. It goes to the top of your feed.' },
    { c: EXAMPLE_CARDS[1], h: 'Tap <b>Open</b> to see the four parts.', want: 'open', after: 'The move, why it’s here, what it moves, your call.' },
    { c: EXAMPLE_CARDS[2], h: 'Not every card is for you. Swipe left to <b>drop</b> it.', want: 'drop', after: 'Gone. Brew learns from what you drop.' },
    { c: EXAMPLE_CARDS[3], h: 'One more. Keep or drop, your call.', want: 'any', after: 'Every tap teaches tomorrow’s feed.' }
  ];
  const tutorial = (b) => { let i = +(st.done.tutAt || 0); const step = () => { if (i >= TUT.length) { delete st.done.tutAt; return finish(b, true); } const t = TUT[i];
      stage(`<h1 class="ob2-h v2-h-sm">${t.h}</h1><div class="v2-stackwrap" id="v2-stack">${exCard(t.c)}</div>${verbsHtml(true)}<p class="ob2-foot v2-after" id="v2-after"></p>${hint(`<kbd>←</kbd> drop · <kbd>→</kbd> keep · <kbd>O</kbd> open`)}`);
      const card = $('.v2-card', $('#v2-stack'));
      const did = async (verb) => { if (t.want !== 'any' && verb !== t.want) { nudge(card, t.want); return; }
        if (verb === 'open') { openParts(card, t.c); await wait(1500); } else await flyOut(card, verb);
        const a = $('#v2-after'); if (a) a.textContent = t.after; i++; st.done.tutAt = i; save(); setTimeout(step, 900); };
      bindVerbs(card, did); keys((k) => { if (k === 'ArrowRight') { did('keep'); return true; } if (k === 'ArrowLeft') { did('drop'); return true; } if (k === 'o' || k === 'O' || k === 'Enter') { did('open'); return true; } }); };
    step(); };

  /* ---------- hold: the read is still running; the rail on the right carries it, the left says so ---------- */
  const hold = (b) => {
    if (st.ready || st.error) return finish(b, 'skip');
    stage(`${kick('Still reading', '<span class="spin"></span>')}<h1 class="ob2-h" id="v2-holdh">${esc(name())}, ${stepsDone()} of ${STEP_KEYS.length} sources.</h1><p class="ob2-lede" id="v2-holdsub">${esc(lastSay || 'Your store, your reviews, your rivals’ ads. It carries on by itself.')}</p>${hint('Your feed opens the moment the read is in.')}`);
    const t = setInterval(() => { if (!$('#v2-holdsub')) return clearInterval(t); const sub = $('#v2-holdsub'); if (sub && lastSay) sub.textContent = lastSay; const h = $('#v2-holdh'); if (h) h.textContent = `${name()}, ${stepsDone()} of ${STEP_KEYS.length} sources.`;
      if (st.ready || st.error) { clearInterval(t); return finish(b, true); }
      if (beats().some((b2) => b2.kind === 'brand' && !st.done[b2.id] && needsMet(b2) === true)) { clearInterval(t); next(); } }, 1500);
    keys(() => false);
  };
  const afterReady = async () => { await postConfirm(); const b = beatAt(st.i); if (b && b.kind === 'hold') return finish(b, true); };
  /* the taps replaced the check page: once the read is in and the who tap is past, the same confirm goes up and the moves start */
  const postConfirm = async () => { if (st.posted || st.confirmed || !st.ready) return;
    if (mode === 'q') { const bt = ['lead', 'rivals']; if (!bt.every((k) => st.done[k])) return; if (!bt.some((k) => st.done[k] === true)) return; } /* v1: both brand taps past, at least one answered; none answered → v1's check page instead (it also holds Is this you?) */
    else { const whoPast = st.done.who || st.done.tut || st.done.done; if (!whoPast) return; }
    st.posted = true; save();
    /* only the taps that were answered go up: an empty hero list would otherwise unset the brand's leads (build.js applyCheck) */
    const v2 = { who: st.v2.who || {}, company: {}, sources: {} }; if (st.done.lead === true && (mode !== 'q' || (st.v2.hero || []).length)) { v2.hero = st.v2.hero; v2.removed = st.v2.removed; } if (st.done.rivals === true) v2.removeRivals = st.v2.removeRivals;
    const r = await A().api(`/api/brands/${slug()}/confirm`, { v2 }).catch(() => null);
    if (r?.signin || r?.error) { st.posted = false; save(); if (r?.signin) A().signWall('check'); else A().toast(`${ic('info', 's16')}${esc(r.error || 'Could not save what you picked.')}`); return; }
    if (r?.notes?.length) A().toast(`${ic('info', 's16')}${esc(r.notes.join(' '))}`); };

  /* ---------- done: good morning, the rings, the one ceremonial button ---------- */
  const ringsOf = async () => { try { const txt = await fetch(`/b/${slug()}/seed.js?t=${Date.now()}`).then((r) => r.text()); const m = txt.match(/window\.fxDeep\((.*)\) \};\n/); const seed = m ? JSON.parse(m[1]) : null; return seed?.health || null; } catch (e) { return null; } };
  const ringSvg = (rings) => { const R = [56, 44, 32]; return `<svg viewBox="0 0 130 130" width="100%" role="img" aria-label="Brand health">${rings.slice(0, 3).map((r, i) => { const c = 2 * Math.PI * R[i], v = r.read === false ? 0 : r.v; return `<circle cx="65" cy="65" r="${R[i]}" fill="none" stroke="var(--surface-2)" stroke-width="8"/><circle class="ring-arc" cx="65" cy="65" r="${R[i]}" fill="none" stroke="var(--fg)" stroke-opacity="${1 - i * .3}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 65 65)"/>`; }).join('')}</svg>`; };
  const done = async (b) => {
    await postConfirm();
    const n = st.findings.length, srcs = stepsDone();
    stage(`${kick('Morning', ic('sun', 's16'))}<h1 class="ob2-h">Good morning, ${esc(name())}.</h1>
      <p class="ob2-lede">${srcs} of ${STEP_KEYS.length} sources read${n ? `, ${n} findings` : ''}. ${st.confirmed ? 'Your team checked this read already.' : 'Your first moves are being written now; they land in the feed as they finish.'}</p>
      <div class="inset v2-ringbox" id="v2-rings" hidden></div>
      <div class="ob2-nav"><span>${st.confirmed ? '' : `<a class="linkbtn" href="/${esc(slug())}#check">Edit what we read</a>`}</span><button class="lm" id="v2-open"><span class="lm-rim"><span class="lm-in">Open my feed ${ic('right', 's18')}</span></span></button></div>${hint(`<kbd>Space</kbd> to open`)}`);
    $('[data-v2-skip]')?.remove();
    ringsOf().then((h) => { const el = $('#v2-rings'); if (!el || !h?.rings) return; const read = h.rings.filter((r) => r.read !== false); if (!read.length) return;
      el.hidden = false; el.innerHTML = `<div class="ring-wrap">${ringSvg(h.rings)}<div class="ring-rows">${h.rings.map((r) => `<div><b>${esc(r.k)}</b><em>${r.read === false ? '–' : r.v}</em><span>${esc(r.what || '')}</span></div>`).join('')}</div></div>`; });
    const go = () => { keys(null); st.stage = 'stack'; st.done[b.id] = true; save(); S().onboarded = false; A().save(); A().ls.set(`${A().LSP()}continue`, 'v2'); location.reload(); /* a reload: the page gets the real seed (logo, colours, cards) before the stack */ };
    $('#v2-open').onclick = go; keys((k) => { if (k === 'Space' || k === 'Enter') { go(); return true; } });
  };
  const errorScreen = () => { keys(null); stage(`<h1 class="ob2-h">We couldn’t read ${esc(name())}.</h1><p class="ob2-lede">${esc(window.__readFail ? window.__readFail(st.error) : st.error)}</p><div class="ob2-nav"><span></span><a class="btn btn-primary lg" href="/">Back to the start</a></div>`); $('[data-v2-skip]')?.remove(); };

  /* ---------- the stack: the first three real cards after onboarding, and the morning stack (FEED_STACK) ---------- */
  const mixN = (ranked, n) => { const S0 = S(), ok = (p) => p && p.id && p.id !== 'build-moves' && !A().cardOf(p).done && !S0.dismissed?.[p.id] && !S0.hearts?.[p.id] && !!A().cardOf(p).title; const used = new Set(), out = []; const take = (pred) => { const p = ranked.find((x) => !used.has(x.id) && ok(x) && pred(x)); if (p) { used.add(p.id); out.push(p); } };
    take((p) => kindOf(p) === 'move'); take((p) => kindOf(p) === 'rival-ad'); take((p) => ['heard', 'answer'].includes(kindOf(p)));
    for (const p of ranked) { if (out.length >= n) break; if (!used.has(p.id) && ok(p)) { used.add(p.id); out.push(p); } } return out.slice(0, n); };
  const firstThree = (ranked) => mixN(ranked, 3);
  const keptHtml = (kept, cap) => `<div class="v2-kept"><p class="pv-cap">${esc(cap)}</p>${kept.length ? `<ol class="wt2-steps">${kept.map((x) => `<li class="is-${x.v === 'keep' ? 'done' : 'wait'}"><i>${ic(x.v === 'keep' ? 'check' : x.v === 'take' ? 'refresh' : 'minus', 's14')}</i><div><b>${esc(x.t)}</b><span>${x.v === 'keep' ? 'Kept' : x.v === 'take' ? 'Another take on its way' : 'Not for you'}</span></div></li>`).join('')}</ol>` : `<p class="ob2-foot">Nothing yet. Keep or drop, your call.</p>`}</div>`;
  /* one stack runner for the onboarding's first three and the morning stack: a card list, the verbs, a quiet counter when asked,
     a way out at any time, and onDone when the cards are acted on or the person skips */
  const runStack = (o) => {
    const queue = o.cards.slice(), total = queue.length, max = Math.min(o.max || total, total), kept = o.kept || []; let acted = 0, over = false;
    const finish = () => { if (over) return; over = true; keys(null); o.onDone(); };
    document.body.classList.add('v2-on');
    shell(`<h1 class="ob2-h v2-h-sm">${o.head}</h1><p class="ob2-lede">${o.sub}</p>${o.counter ? '<p class="ob2-foot v2-count" id="v2-count" role="status"></p>' : ''}<div class="v2-stackwrap" id="v2-stack"></div>${verbsHtml(false)}${hint(`<kbd>←</kbd> drop · <kbd>→</kbd> keep · <kbd>O</kbd> open · <kbd>R</kbd> another take · <kbd>E</kbd> make it yours${o.skip ? ' · <kbd>Esc</kbd> the feed' : ''}`)}`,
      { noStatus: true, right: keptHtml(kept, o.cap || 'Kept'), skipLabel: o.skip || 'Skip to my feed', onSkip: finish });
    const paintKept = () => { const r = $('#v2-show'); if (r) r.innerHTML = keptHtml(kept, o.cap || 'Kept'); };
    const paintCount = () => { const c = $('#v2-count'); if (c) c.textContent = `${Math.min(acted + 1, total)} of ${total}`; };
    const showNext = () => { const p = queue.shift(); if (!p || acted >= max) return finish(); paintCount(); const host = $('#v2-stack'); host.innerHTML = realCard(p); const card = $('.v2-card', host);
      const did = async (verb) => {
        if (verb === 'open') { const c = A().cardOf(p); openParts(card, { title: f(c.title), why: whyOf(c), moves: '' }); if (!$('[data-full]', card)) { $('.body', card).insertAdjacentHTML('beforeend', `<button class="linkbtn v2-full" data-full>Open in full</button>`); $('[data-full]', card).onclick = () => A().openDetail(p); } return; }
        if (verb === 'make') { window.MakeSheet?.open(p, { onSaved: () => { const c2 = A().byId(p.id) || p; host.innerHTML = realCard(c2); bindVerbs($('.v2-card', host), did); } }); return; }
        if (verb === 'keep') { S().hearts[p.id] = true; A().save(); A().tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'heart' }).catch(() => {}); kept.push({ id: p.id, t: f(A().cardOf(p).title), v: 'keep' }); }
        if (verb === 'drop') { S().dismissed[p.id] = true; A().save(); A().tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'not_interested' }).catch(() => {}); kept.push({ id: p.id, t: f(A().cardOf(p).title), v: 'drop' }); }
        if (verb === 'take') { const done = A().busyBtn?.($('[data-verb="take"]'), 'Starting…') || (() => {}); const r = await A().tapi('POST', `/api/cards/${p.id}/remix`, { queue: true, take: true }).catch(() => null); done(); if (!r || r.error) { A().toast(`${ic('info', 's16')}${esc(r?.error || 'Another take isn’t available yet.')}`); return; } kept.push({ id: p.id, t: f(A().cardOf(p).title), v: 'take' }); }
        acted++; o.onActed?.(acted); paintKept(); await flyOut(card, verb === 'keep' ? 'keep' : 'drop'); showNext(); };
      bindVerbs(card, did); keys((k) => { if (k === 'ArrowRight') { did('keep'); return true; } if (k === 'ArrowLeft') { did('drop'); return true; } if (k === 'o' || k === 'O') { did('open'); return true; } if (k === 'r' || k === 'R') { did('take'); return true; } if (k === 'e' || k === 'E') { did('make'); return true; } if (k === 'Escape' && o.skip && !$('#modal')) { finish(); return true; } }); };
    paintKept(); showNext();
  };
  /* FEED_STACK: today's stack is counted once per workspace, by the brand's own date (the onboarding's first three count as today's) */
  const markDay = () => { if (!A().FEED_STACK) return; V().stackDay = A().brandClock().day; A().save(); };
  /* the onboarding's stack: the first three real cards, then the gate */
  const stack = async () => {
    document.body.classList.add('v2-on'); load(); st.stage = 'stack'; save();
    shell(`<h1 class="ob2-h v2-h-sm">Your first three.</h1><p class="ob2-lede">Real cards for ${esc(name())}. Keep what fits.</p><div class="v2-stackwrap" id="v2-stack"><div class="card v2-card is-wait"><span class="spin"></span></div></div>`, { noStatus: true, right: keptHtml(st.kept, 'Your first three'), skipLabel: 'Skip to my feed', onSkip: () => gate() });
    await A().loadFeed(); const queue = firstThree(A().rank());
    if (!queue.length) return gate();
    markDay();
    runStack({ cards: queue, max: 3, head: 'Your first three.', sub: `Real cards for ${esc(name())}. Keep what fits.`, cap: 'Your first three', kept: st.kept, skip: 'Skip to my feed', onActed: (n) => { st.acted = n; save(); }, onDone: gate });
  };
  /* FEED_STACK: the morning stack. The day's top N ranked cards (N = how many a morning the person asked for, 10 by default), mixed by
     the first-three rule, as the same swipe stack before the scroll feed. Esc or "Open the feed" leaves at any time; every verb
     writes what it writes in the feed. Called by app.js feed() once per brand-day per workspace; onDone opens the feed. */
  const morning = async (o = {}) => {
    const n = Math.max(1, Math.min(50, +V().perDay || 10));
    document.body.classList.add('v2-on');
    shell(`<div class="v2-stackwrap" id="v2-stack"><div class="card v2-card is-wait"><span class="spin"></span></div></div>`, { noStatus: true, right: keptHtml([], 'Today'), skipLabel: 'Open the feed', onSkip: () => done0() });
    const done0 = () => { keys(null); document.body.classList.remove('v2-on'); o.onDone?.(); };
    await A().loadFeed().catch(() => null); const cards = mixN(A().rank(), n);
    if (!cards.length) return done0();
    const h = A().brandClock().hour, part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    runStack({ cards, head: `${part}, ${esc(name())}.`, sub: 'Today’s cards, one at a time. Keep what fits; the feed is behind them.', cap: 'Today', counter: true, skip: 'Open the feed', kept: [], onDone: done0 });
  };
  /* the gate: the fourth card blurred, then what the plan allows (BREW_GATE: trial | plan | off) */
  const gate = async () => {
    const mode = String(window.BREW_GATE || 'trial'); if (mode === 'off') return team();
    const total = await A().api(`/api/brands/${slug()}/status`).then((s) => +s?.total || 0).catch(() => 0); const more = total > 3 ? `${total - 3} more moves` : 'the rest of the moves';
    const kept = st.kept.filter((x) => x.v === 'keep');
    stage(`<h1 class="ob2-h">${esc(more[0].toUpperCase() + more.slice(1))}, written for ${esc(name())}.</h1>
      <p class="ob2-lede">${mode === 'plan' ? 'Pick a plan to unlock them.' : 'Fourteen days, no card. Every move with its sources, the jam, the brief.'}</p>
      <div class="v2-stackwrap v2-blur"><div class="card v2-card is-blur"><div class="media portrait"></div><div class="body"><h3>&nbsp;</h3><p>&nbsp;</p></div></div><span class="badge v2-lockbadge">${ic('lock', 's14')}${esc(more)}</span></div>
      <div class="ob2-nav"><button class="linkbtn" id="v2-back">Go back</button>${mode === 'plan' ? `<button class="btn btn-primary lg" id="v2-go">See the plans ${ic('right', 's18')}</button>` : `<button class="lm" id="v2-go"><span class="lm-rim"><span class="lm-in">Start my 14 days ${ic('right', 's18')}</span></span></button>`}</div>${hint(`<kbd>Space</kbd> to continue`)}`,
      { right: `<div class="v2-kept"><p class="pv-cap">What you kept</p>${kept.length ? `<div class="pv-win v2-fanwin">${kept.slice(0, 3).map((x) => `<div class="pv-card"><span class="pv-ph">${face('brew')}</span><div><small>Kept</small><b>${esc(x.t)}</b></div></div>`).join('')}<div class="pv-card is-blur"><span class="pv-ph"></span><div><small>Locked</small><b>&nbsp;</b></div></div></div>` : `<p class="ob2-foot">Nothing kept yet. The rest of the moves are still yours to unlock.</p>`}</div>` });
    $('[data-v2-skip]')?.remove();
    $('#v2-back').onclick = () => { st.acted = 0; save(); stack(); };
    const go = async () => { if (mode === 'plan') { A().openPlan?.('moves', () => team()); return; } setViewer({ trial: Date.now() }); A().toast(`${ic('check', 's16')}Your 14 days start today.`); team(); };
    $('#v2-go').onclick = go; keys((k) => { if (k === 'Space' || k === 'Enter') { go(); return true; } });
  };
  /* the last step: invite your team (the rule from SCOPE), the existing step; then the feed */
  const team = () => { keys(null); st.stage = 'team'; save(); document.body.classList.remove('v2-on'); const ac = window.LIVE?.access; if (ac?.role && window.LIVE?.me && (V().teamSize || 'me') !== 'me') return A().teamStep(); A().finishOnboarding(); };

  /* ---------- entry points the app's router calls ---------- */
  const run = async () => { document.body.classList.add('v2-on'); load();
    if (st.stage === 'stack') return stack();
    const s = await A().api(`/api/brands/${slug()}/status`).catch(() => null); st.confirmed = s?.stages?.confirm?.state === 'done'; if (s?.stages?.read?.state === 'done') st.ready = true; if (s?.error && s.unreadable) st.error = s.state;
    if (st.ready) st.steps = STEP_KEYS.map((k, i) => st.steps[i] || { k, state: 'done', empty: false, done: 'Done' });
    save(); shell(''); listen(); peekIn();
    if (st.error) return errorScreen();
    next(); };
  /* the landing keeps v1's start page; a brand's own page (the demo tour) goes straight into the read */
  const start = async () => { await A().ensureTenant(true); return run(); };
  const route = (kind) => { load(); if (kind === 'continue' || st.stage === 'stack') return stack(); return run(); };
  const resume = () => run();
  /* ---------- v1: the questions only, inside v1's reading screen (app.js setup, #v2-stage in its left rail) ----------
     v1's own stream passes events in (feed); no second stream, shell, tutorial, stack or gate. When the questions are over and
     the read is in, the same confirm goes up (when a brand tap was answered) and onDone tells v1 to show its done bar. */
  const qDone = () => { qWait = false; keys(null); st.qDone = true; save(); const o = QO; QO = null; o?.onDone?.({ posted: !!st.posted, skipped: !!st.skipped }); };
  const qEnd = async () => { keys(null);
    if (st.ready || st.error) { if (!st.error) await postConfirm(); return qDone(); }
    qWait = true; /* every question answered, the read still running: v1 goes back to the read; a product or rival question whose
       data lands later reopens the layer (stage → onShow) */
    QO?.onWait?.(); };
  const qFeed = (ev) => { if (mode !== 'q' || !st || st.qDone || !ev) return;
    if (ev.type === 'picks' && ev.k) { st.picks[ev.k] = ev.items; save(); if (qWait && beats().some((b) => b.kind === 'brand' && !st.done[b.id] && needsMet(b) === true)) { qWait = false; next(); } }
    if (ev.type === 'ready' && !st.ready) { st.ready = true; save(); if (qWait) { qWait = false; next(); } }
    if (ev.type === 'error') { st.error = ev.msg || 'The store did not open for us.'; save(); qDone(); } };
  const qSkip = () => { if (!st || st.qDone) return; keys(null); st.skipped = true; beats().forEach((b) => { if (!st.done[b.id]) st.done[b.id] = 'skip'; }); save(); qEnd(); };
  const questions = async (o = {}) => { mode = 'q'; QO = o; qWait = false; load();
    const s = await A().api(`/api/brands/${slug()}/status`).catch(() => null); st.confirmed = s?.stages?.confirm?.state === 'done'; if (s?.stages?.read?.state === 'done') st.ready = true; save();
    next();
    return { feed: qFeed, skip: qSkip, posted: () => !!st?.posted, answered: (id) => !!st?.done?.[id] && st.done[id] !== 'skip', stop: () => { keys(null); qWait = false; QO = null; } }; };
  const qState = () => { try { return JSON.parse(ls.get(`${A().LSP()}q1`) || '{}'); } catch (e) { return {}; } };
  const reset = () => { ls.del(KEY()); st = null; };
  const debug = () => ({ st, beat: beatAt(st?.i || 0)?.id, kind: beatAt(st?.i || 0)?.kind, lastSay, es: !!es });
  window.OB2 = { start, run, route, resume, reset, debug, stack, morning, mixN, questions, qState };
})();
