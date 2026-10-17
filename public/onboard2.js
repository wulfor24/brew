/* Brew v2 onboarding: "the morning". Behind the V2 flag (app.js: ?v=2 / BREW_V). The brand's site is read in the background
   while the person taps through a few 4-tile questions, a short story and a hands-on tutorial. The sky goes from night to
   sunrise as the read's stages land; Done is "Good morning, {Brand}" with the real health rings; then the first three cards
   as a swipe stack, the gate, and the feed. Honest by rule: the progress card is driven only by the real SSE, a stage that
   found nothing shows a dash, errors are shown as errors, and no time-saved number is ever invented. */
(() => {
  const A = () => window.__BREW; // app.js helpers, set before the boot router runs
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  const root = () => $('#root');
  const B = () => A().B, slug = () => B().slug || window.BRAND, brand = () => B().brand || {}, name = () => brand().name || brand().host || 'your store';
  const KEY = () => `${A().LSP()}v2`;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* the one display serif, loaded only when v2 is on */
  const fontIn = () => { if ($('#v2-font')) return; const l = document.createElement('link'); l.id = 'v2-font'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap'; document.head.appendChild(l); };

  /* ---------- the sky: eight steps from night to morning, one per completed read stage ---------- */
  const SKY = [['#0b1026', '#1b2340'], ['#101735', '#28304f'], ['#1a2246', '#3a3d63'], ['#2b2d58', '#6b4f73'], ['#3f3a68', '#b76a6a'], ['#5a4a74', '#e59a6a'], ['#8a6f85', '#f6c08a'], ['#f3d9b1', '#fff4e0']];
  const sky = (i) => { const [a, b] = SKY[Math.max(0, Math.min(SKY.length - 1, i))]; const r = document.documentElement; r.style.setProperty('--sky-a', a); r.style.setProperty('--sky-b', b); r.style.setProperty('--sky-i', String(i)); };

  /* ---------- state kept in this browser, so a refresh carries on where it was ---------- */
  const fresh = () => ({ v: 1, startedAt: Date.now(), i: 0, done: {}, v2: { hero: [], removed: [], removeRivals: [], who: {}, company: {}, sources: {} }, picks: {}, steps: [], findings: [], ready: false, posted: false, confirmed: false, kept: [], acted: 0, stage: 'onboard' });
  let st = null;
  const load = () => { try { st = { ...fresh(), ...JSON.parse(ls.get(KEY()) || '{}') }; } catch (e) { st = fresh(); } return st; };
  const save = () => ls.set(KEY(), JSON.stringify(st));

  /* ---------- the read, as the progress card tells it ---------- */
  const STEP_KEYS = ['open', 'brand', 'catalog', 'reviews', 'ads', 'site', 'answers'];
  const STEP_T = { open: 'Opening the store', brand: 'Reading the brand', catalog: 'Pulling the catalog', reviews: 'Reading what customers say', ads: 'Finding live ads, yours and rivals’', site: 'Walking the path to checkout', answers: 'Asking the AI tools' };
  let es = null, lastSay = '', readingK = null, tick = null;
  const stepsDone = () => st.steps.filter((s) => s && s.state === 'done').length;
  const stepState = (k) => st.steps[STEP_KEYS.indexOf(k)]?.state || null;
  const elapsed = () => { const s = Math.max(0, Math.round((Date.now() - st.startedAt) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const progressHtml = () => {
    if (st.error) return `<div class="v2-prog is-bad"><i>${A().ic('info', 's16')}</i><div><b>We couldn’t read ${esc(name())}.</b><span>${esc(st.error)}</span></div></div>`;
    if (st.ready) return `<div class="v2-prog is-ready"><i>${A().ic('check', 's16')}</i><div><b>${esc(name())} is read.</b><span>${stepsDone()} of ${STEP_KEYS.length} sources${st.findings.length ? ` · ${st.findings.length} findings` : ''}</span></div></div>`;
    const n = stepsDone(), k = readingK || STEP_KEYS[n] || 'open';
    return `<div class="v2-prog" role="status"><span class="v2-bar"><i style="width:${Math.max(3, Math.round(100 * n / STEP_KEYS.length))}%"></i></span>
      <i class="v2-prog-ic"><span class="spin"></span></i><div><b>${esc(STEP_T[k] || 'Reading')}…</b><span>${esc(lastSay || `Reading ${esc(brand().host || name())}`)}</span></div>
      <small>${n} of ${STEP_KEYS.length} · <time>${elapsed()}</time></small>
      <ol class="v2-dots">${STEP_KEYS.map((x, i) => `<li class="${st.steps[i]?.state === 'done' ? (st.steps[i].empty ? 'is-empty' : 'is-done') : i === STEP_KEYS.indexOf(k) ? 'is-on' : ''}" title="${esc(STEP_T[x])}"></li>`).join('')}</ol></div>`;
  };
  const paintProgress = () => { const el = $('#v2-prog'); if (el) el.innerHTML = progressHtml(); const t = $('#v2-prog time'); if (t) t.textContent = elapsed(); };
  const listen = () => {
    if (es) return; const tid = A().TID; if (!tid) return;
    es = new EventSource(`/api/tenants/${tid}/onboarding`);
    es.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.type === 'step' && ev.state === 'reading') { readingK = STEP_KEYS[ev.i] || readingK; st.steps[ev.i] = { k: STEP_KEYS[ev.i], state: 'reading' }; }
      if (ev.type === 'step' && ev.state === 'done') { st.steps[ev.i] = { k: STEP_KEYS[ev.i], state: 'done', empty: !!ev.empty, done: ev.done }; if (readingK === STEP_KEYS[ev.i]) readingK = null; sky(1 + stepsDone()); if (STEP_KEYS[ev.i] === 'brand') onBrand(); }
      if (ev.type === 'finding' && ev.finding) { st.findings.push(ev.finding); if (st.findings.length > 40) st.findings.shift(); if (ev.say) lastSay = ev.say; floatIn(ev.finding); if (ev.finding.kind === 'kit') washIn(ev.finding); }
      if (ev.type === 'picks' && ev.k) { st.picks[ev.k] = ev.items; }
      if (ev.type === 'error') { st.error = ev.msg || 'The store did not open for us.'; save(); es.close(); es = null; paintProgress(); return errorScreen(); }
      if (ev.type === 'ready') { st.ready = true; st.steps = STEP_KEYS.map((k, i) => st.steps[i] || { k, state: 'done', empty: false, done: 'Done' }); sky(7); es.close(); es = null; save(); paintProgress(); afterReady(); return; }
      save(); paintProgress(); unlock(); };
    es.onerror = () => { /* the stream drops on a restart: the status poll below says what is true */ es?.close(); es = null; setTimeout(pollStatus, 4000); };
    clearInterval(tick); tick = setInterval(() => { const t = $('#v2-prog time'); if (t) t.textContent = elapsed(); }, 1000);
  };
  const pollStatus = async () => { if (st.ready || st.error) return; const s = await A().api(`/api/brands/${slug()}/status`).catch(() => null);
    if (s?.error && s.unreadable) { st.error = s.state || 'The store did not open for us.'; save(); paintProgress(); return errorScreen(); }
    if (s?.stages?.read?.state === 'done') { st.ready = true; sky(7); save(); paintProgress(); return afterReady(); }
    if (!es) listen(); setTimeout(pollStatus, 8000); };

  /* ---------- the brand's own things float in as they are found (its OG image, products, findings) ---------- */
  const floats = [];
  const floatIn = (f) => { const host = $('#v2-float'); if (!host) return; let inner = '';
    if (f.kind === 'grid' && f.imgs?.length) inner = `<img src="${esc(f.imgs[0])}" alt="">`;
    else if ((f.kind === 'ad' || f.kind === 'film') && f.img) inner = `<img src="${esc(f.img)}" alt="">`;
    else if (f.kind === 'quotes' && f.quotes?.[0]) inner = `<blockquote>${esc(String(f.quotes[0]).slice(0, 110))}</blockquote>`;
    else if (f.kind === 'kit' && (f.logo || brand().logo)) inner = `<span class="v2-fl-logo"><img src="${esc(f.logo || brand().logo)}" alt=""></span>`;
    else if (f.kind === 'answer' && f.q) inner = `<small>${esc(f.q)}</small><b>${esc(String(f.a || '').slice(0, 90))}</b>`;
    else return;
    const n = floats.length; floats.push(f); const el = document.createElement('figure'); el.className = `v2-fl v2-fl${n % 6}`; el.innerHTML = inner; host.appendChild(el);
    while (host.children.length > 7) host.firstElementChild.remove(); };
  const washIn = (f) => { const cols = f.colors || brand().colors || []; if (!cols.length) return; const r = document.documentElement; cols.slice(0, 3).forEach((c, i) => r.style.setProperty(`--brand-${i + 1}`, c)); document.body.classList.add('v2-washed'); };
  const peekFloat = () => { const pk = peekOf(); if (pk?.ogImage) floatIn({ kind: 'ad', img: pk.ogImage }); };

  /* ---------- screens share one shell: the sky, the floating things, the stage, the pinned progress card ---------- */
  const hint = (t) => `<p class="v2-hint">${t}</p>`;
  const shell = (inner, o = {}) => { const r = root(); const had = $('#v2-float');
    r.innerHTML = `<main class="v2-screen${o.cls ? ' ' + o.cls : ''}"><div class="v2-sky"></div><div class="v2-wash"></div><div class="v2-float" id="v2-float"></div>
      <header class="v2-top"><a class="v2-lock" href="/">${A().SO()}<b>Brew</b></a>${o.right || ''}</header>
      <section class="v2-stage" id="v2-stage">${inner}</section>
      ${o.noProg ? '' : `<div class="v2-progwrap" id="v2-prog">${progressHtml()}</div>`}</main>`;
    if (had) $('#v2-float').replaceChildren(...had.children); window.scrollTo(0, 0); };
  const stage = (inner, o = {}) => { const s = $('#v2-stage'); if (!s) return shell(inner, o); s.innerHTML = inner; s.classList.remove('is-in'); void s.offsetWidth; s.classList.add('is-in'); window.scrollTo(0, 0); };

  /* ---------- keys: the two that matter are always on screen ---------- */
  let keyFn = null; const keys = (fn) => { keyFn = fn; };
  document.addEventListener('keydown', (e) => { if (!keyFn || !document.body.classList.contains('v2-on')) return; if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key === ' ' ? 'Space' : e.key; if (keyFn(k) === true) e.preventDefault(); });

  /* ---------- the beats: taps, slides, brand taps, tutorial; each says what it waits for ---------- */
  const S = () => A().S;
  const seatTiles = () => A().seatEntries().slice(0, 4).map(([k, r]) => ({ v: k, t: r.title, s: r.line, face: r.face }));
  const V = () => S().viewer;
  const setViewer = (patch) => { Object.assign(S().viewer, patch); A().save(); };
  const BEATS = () => [
    { id: 'intro', kind: 'slide', art: 'clock', h: `It’s 6:30.`, p: st?.ready ? `Brew has read ${esc(name())}. A few taps so your mornings fit you.` : `While Brew reads ${esc(name())}, a few taps so your mornings fit you.`, cta: true },
    { id: 'seat', kind: 'tap', q: 'Who’s this feed for?', tiles: seatTiles(), get: () => V().role, set: (v) => { setViewer({ role: v, wants: V().wantsTouched ? V().wants : A().defaultWants(v) }); } },
    { id: 'first', kind: 'tap', multi: 2, q: 'What should come first?', tiles: Object.entries(B().wants || {}).slice(0, 4).map(([k, w]) => ({ v: k, t: w.name, s: w.line })), get: () => V().wants || [], set: (v) => setViewer({ wants: v, wantsTouched: true }) },
    { id: 's1', kind: 'slide', art: 'page', h: 'Most mornings start with a blank page.', p: 'What do we make today? For whom? Why that?' },
    { id: 's2', kind: 'slide', art: 'tabs', h: 'Then twelve tabs.', p: 'The Ad Library, three rival sites, the reviews, ChatGPT giving everyone the same five ideas.' },
    { id: 's3', kind: 'slide', art: 'dawn', h: st?.ready ? `Brew read all of that for ${esc(name())}.` : `Brew reads all of that for ${esc(name())}.`, p: 'Your store, your reviews, your rivals’ ads, your checkout, and what AI tools say about you. Every number with its source.' },
    { id: 'lead', kind: 'brand', needs: 'catalog', q: 'Which of these should Brew lead with?', sub: 'Tap the ones to push first. × if it isn’t a real product.' },
    { id: 'channels', kind: 'tap', multi: 3, q: 'Which channels do you run?', tiles: [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['google', 'Google'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['marketplace', 'Marketplaces']].map(([v, t]) => ({ v, t, chan: v })), get: () => V().channels || [], set: (v) => setViewer({ channels: v }) },
    { id: 'perDay', kind: 'tap', q: 'How many moves a morning?', tiles: [{ v: 3, t: '3', s: 'Just the top of the pile' }, { v: 5, t: '5', s: 'A short morning' }, { v: 10, t: '10', s: 'The full morning', star: true }], get: () => V().perDay || 10, set: (v) => setViewer({ perDay: v }) },
    { id: 'rivals', kind: 'brand', needs: 'rivals', q: 'Who do you lose sales to?', sub: 'Keep the brands you really compete with. × if it isn’t a rival.' },
    { id: 's4', kind: 'slide', art: 'card', h: 'Every morning, ready moves.', p: 'Each card says the move, why it’s here, what it moves, and asks for your call. Ads your rivals run, what people are saying, how your store scores: all of it, with sources.' },
    { id: 's5', kind: 'slide', art: 'taps', h: 'Every tap teaches tomorrow’s feed.', p: 'Keep what fits. Drop what doesn’t. Brew learns your taste, not a persona.' },
    { id: 'adPace', kind: 'tap', q: `How many ads did ${esc(name())} run last month?`, tiles: [{ v: 'none', t: 'None', s: 'Not yet' }, { v: 'few', t: 'A few', s: 'Now and then' }, { v: 'ten', t: '10 or more', s: 'Most weeks' }, { v: 'always', t: 'Always on', s: 'Every day' }], get: () => V().adPace, set: (v) => setViewer({ adPace: v }) },
    { id: 'voice', kind: 'tap', q: 'How should Brew sound?', tiles: [{ v: 'site', t: 'Like our site', s: 'The voice Brew read', star: true }, { v: 'warmer', t: 'Warmer', s: 'More human, fewer claims' }, { v: 'sharper', t: 'Sharper', s: 'Shorter, bolder' }, { v: 'plainer', t: 'Plainer', s: 'No flourish, just facts' }], get: () => V().voice || 'site', set: (v) => { setViewer({ voice: v }); voiceMemory(v); } },
    { id: 'who', kind: 'brand', needs: 'who', q: 'Is this you?', sub: 'Fix anything that’s off. Brew writes from these.' },
    { id: 'tools', kind: 'tap', multi: 4, q: 'Which of these do you use?', sub: 'Pick now, connect later. Read-only, always.', tiles: Object.entries(B().connectors || {}).filter(([k]) => k !== 'marketplaces').slice(0, 8).map(([k, c]) => ({ v: k, t: c.name, glyph: k })), get: () => V().tools || [], set: (v) => setViewer({ tools: v }) },
    { id: 'team', kind: 'tap', q: 'Who else should see this?', tiles: [{ v: 'me', t: 'Just me' }, { v: 'few', t: '2 to 5 of us' }, { v: 'team', t: 'A team' }, { v: 'agency', t: 'Us and an agency' }], get: () => V().teamSize, set: (v) => setViewer({ teamSize: v }) },
    { id: 'tut', kind: 'tutorial' },
    { id: 'hold', kind: 'hold' },
    { id: 'done', kind: 'done' }
  ];
  const beats = () => BEATS();
  const beatAt = (i) => beats()[i];
  const needsMet = (b) => { if (!b.needs) return true; if (st.confirmed) return 'skip'; const p = st.picks[b.needs]; if (p && !(Array.isArray(p) && !p.length)) return true; if (st.ready) return 'late'; return false; };

  /* the next beat: the lowest one not done whose data is here; a brand tap whose data never came is skipped once the read is in */
  const next = async () => {
    const bs = beats();
    for (let i = 0; i < bs.length; i++) { const b = bs[i]; if (st.done[b.id]) continue;
      if (b.kind === 'brand') { const m = needsMet(b); if (m === false) continue; if (m === 'skip') { st.done[b.id] = 'skip'; continue; }
        if (m === 'late') { const ok = await lateData(b.needs); if (!ok) { st.done[b.id] = 'skip'; continue; } } }
      if (b.kind === 'hold' && (st.ready || st.error)) { st.done[b.id] = 'skip'; continue; }
      st.i = i; save(); return show(b); }
    return show(bs[bs.length - 1]);
  };
  const unlock = () => { /* data landed while a slide or tap is up: nothing moves on screen; the scheduler picks it up at the next step */ };
  const finish = (b, val) => { st.done[b.id] = val ?? true; save(); return next(); };
  const show = (b) => ({ slide, tap, brand: brandTap, tutorial, hold, done }[b.kind] || slide)(b);

  /* ---------- a slide: one line types in, the next step is a key or a tap away ---------- */
  const ART = {
    clock: '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" stroke-width="3"/><path d="M60 30v30l18 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    page: '<svg viewBox="0 0 120 120"><rect x="28" y="18" width="64" height="84" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M40 40h40M40 54h28M40 68h34" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".25"/><path d="M40 86h2" stroke="currentColor" stroke-width="3" stroke-linecap="round"><animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite"/></path></svg>',
    tabs: '<svg viewBox="0 0 120 120">' + [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${14 + i * 9}" y="${18 + i * 7}" width="60" height="44" rx="5" fill="var(--v2-paper)" stroke="currentColor" stroke-width="2.5" opacity="${.35 + i * .1}"/>`).join('') + '</svg>',
    dawn: '<svg viewBox="0 0 120 120"><path d="M10 84h100" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M28 84a32 32 0 0 1 64 0" fill="none" stroke="currentColor" stroke-width="3"/><path d="M60 32v-12M30 44l-8-8M90 44l8-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    card: '<svg viewBox="0 0 120 120"><rect x="24" y="14" width="72" height="92" rx="10" fill="var(--v2-paper)" stroke="currentColor" stroke-width="3"/><rect x="34" y="24" width="52" height="34" rx="6" fill="currentColor" opacity=".18"/><path d="M34 70h44M34 82h30M34 94h22" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".5"/></svg>',
    taps: '<svg viewBox="0 0 120 120"><path d="M30 60l30-20 30 20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".35"/><path d="M30 78l30-20 30 20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sun: '<svg viewBox="0 0 120 120"><circle cx="60" cy="64" r="22" fill="currentColor"/><path d="M60 20v10M60 98v10M16 64h10M94 64h10M29 33l7 7M84 33l-7 7M29 95l7-7M84 95l-7-7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'
  };
  const typeIn = (el, text, ms = 18) => new Promise((res) => { if (reduced()) { el.textContent = text; return res(); } let i = 0; el.textContent = ''; el.classList.add('is-typing'); const t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(t); el.classList.remove('is-typing'); res(); } }, ms); el._stop = () => { clearInterval(t); el.textContent = text; el.classList.remove('is-typing'); res(); }; });
  const slide = async (b) => {
    stage(`<div class="v2-slide"><div class="v2-art">${ART[b.art] || ''}</div><h1 class="v2-h" id="v2-line"></h1><p class="v2-p" id="v2-sub" style="opacity:0">${b.p || ''}</p>${hint(`<kbd>Space</kbd> or tap to continue`)}</div>`);
    let gone = false; const go = () => { if (gone) return; gone = true; clearTimeout(auto); keys(null); finish(b); };
    keys((k) => { if (k === 'Space' || k === 'Enter' || k === 'ArrowRight') { go(); return true; } if (k === 'Backspace') { back(); return true; } });
    $('#v2-stage').onclick = (e) => { if (!e.target.closest('a,button')) go(); };
    const line = $('#v2-line'); await typeIn(line, b.h.replace(/&#?\w+;/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }[m] || m)));
    if (gone) return; const sub = $('#v2-sub'); if (sub) sub.style.opacity = 1;
    const auto = setTimeout(go, b.cta ? 9e3 : 4200 + (b.p || '').length * 22);
  };
  const back = () => { const bs = beats(); for (let i = st.i - 1; i >= 0; i--) { if (bs[i].kind === 'hold' || bs[i].kind === 'done') continue; delete st.done[bs[i].id]; st.i = i; save(); return show(bs[i]); } };

  /* ---------- a tap: four tiles, keys 1-4, Space confirms a multi-select ---------- */
  const CHAN = { instagram: 'instagram.svg', facebook: 'meta.svg', google: 'google.svg', whatsapp: 'whatsapp.svg', marketplace: 'amazon.svg' };
  const chanGlyph = (v) => CHAN[v] ? `<img src="assets/logos/${CHAN[v]}" alt="">` : `<i class="v2-letter">${esc(String(v)[0].toUpperCase())}</i>`;
  const tileHtml = (t, i, on) => `<button class="v2-tile${on ? ' is-on' : ''}${t.star ? ' is-star' : ''}" data-v="${esc(t.v)}" aria-pressed="${on}"><kbd>${i + 1}</kbd>${t.face ? A().face(t.face) : t.chan ? `<span class="v2-glyph">${chanGlyph(t.chan)}</span>` : t.glyph ? `<span class="v2-glyph">${A().glyph(t.glyph, 34)}</span>` : ''}<b>${esc(t.t)}</b>${t.s ? `<span>${esc(t.s)}</span>` : ''}${t.star ? '<em>Brew’s pick</em>' : ''}<i>${A().ic('check', 's14')}</i></button>`;
  const tap = (b) => {
    let cur = b.multi ? [...(b.get() || [])] : b.get();
    const on = (v) => b.multi ? cur.map(String).includes(String(v)) : String(cur) === String(v);
    const paint = () => { $$('.v2-tile').forEach((el) => { const o = on(el.dataset.v); el.classList.toggle('is-on', o); el.setAttribute('aria-pressed', o); }); const c = $('#v2-confirm'); if (c) c.hidden = !(b.multi && cur.length); };
    stage(`<div class="v2-tap"><h1 class="v2-h">${b.q}</h1>${b.sub ? `<p class="v2-p">${b.sub}</p>` : ''}<div class="v2-tiles n${b.tiles.length}">${b.tiles.map((t, i) => tileHtml(t, i, on(t.v))).join('')}</div>
      ${b.multi ? `<button class="btn btn-primary v2-confirm" id="v2-confirm" hidden>Continue ${A().ic('right', 's16')}</button>${hint(`Pick up to ${b.multi}, then <kbd>Space</kbd>`)}` : hint(`<kbd>1</kbd>–<kbd>${b.tiles.length}</kbd> or tap`)}</div>`);
    const pick = (v0) => { const t = b.tiles.find((x) => String(x.v) === String(v0)); if (!t) return; const v = t.v;
      if (b.multi) { cur = on(v) ? cur.filter((x) => String(x) !== String(v)) : [...cur, v].slice(-b.multi); paint(); return; }
      cur = v; paint(); b.set(v); keys(null); setTimeout(() => finish(b, v), 220); };
    const confirm = () => { if (!b.multi) return; b.set(cur); keys(null); finish(b, cur); };
    $$('.v2-tile').forEach((el) => (el.onclick = () => pick(el.dataset.v)));
    const c = $('#v2-confirm'); if (c) c.onclick = confirm;
    keys((k) => { const n = +k; if (n >= 1 && n <= b.tiles.length) { pick(b.tiles[n - 1].v); return true; } if ((k === 'Space' || k === 'Enter') && b.multi) { if (cur.length) confirm(); return true; } if (k === 'Backspace') { back(); return true; } });
    paint();
  };
  const voiceMemory = async (v) => { const line = { warmer: 'Voice: warmer than the site. More human, fewer claims, no exclamation marks.', sharper: 'Voice: sharper than the site. Short lines, bold claims only when a number backs them.', plainer: 'Voice: plainer than the site. No flourish, say the fact and stop.' }[v]; if (!line) return;
    A().tapi('POST', `/api/brands/${slug()}/drop`, { dest: 'memory', text: line }).catch(() => null); /* not on the team yet: the preference stays in this workspace's viewer */ };

  /* ---------- brand taps: the check page as taps, from the reader's picks (or /check once the read is in) ---------- */
  const lateData = async (k) => { const D = await A().api(`/api/brands/${slug()}/check`).catch(() => null); if (!D || D.error) return false;
    if (k === 'catalog') st.picks.catalog = (D.products || []).slice(0, 12).map((x) => ({ handle: x.handle, title: x.title, price: x.price, img: x.img, hero: x.hero }));
    if (k === 'rivals') st.picks.rivals = (D.rivals || []).map((r) => ({ host: r.host, name: r.name, logo: r.logo, live: r.live }));
    if (k === 'who') st.picks.who = Object.fromEntries((D.who || []).map((x) => [x.key, { v: x.v, label: x.label, src: x.src, type: x.type }]));
    save(); const p = st.picks[k]; return !!p && !(Array.isArray(p) && !p.length) && !p.error; };
  const brandTap = (b) => {
    const p = st.picks[b.needs];
    if (!p || p.error) return finish(b, 'skip');
    if (b.needs === 'catalog') {
      const items = p.slice(0, 8); let hero = new Set(items.filter((x) => x.hero).map((x) => x.handle)); if (!hero.size) items.slice(0, Math.min(3, items.length)).forEach((x) => hero.add(x.handle)); const removed = new Set();
      const paint = () => $$('.v2-prod').forEach((el) => { el.classList.toggle('is-on', hero.has(el.dataset.h)); el.hidden = removed.has(el.dataset.h); });
      stage(`<div class="v2-tap"><h1 class="v2-h">${b.q}</h1><p class="v2-p">${b.sub}</p><div class="v2-prods">${items.map((x, i) => `<div class="v2-prod" data-h="${esc(x.handle)}" role="button" tabindex="0" aria-pressed="false"><kbd>${i + 1}</kbd><span class="v2-prod-i">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : ''}</span><b>${esc(x.title)}</b><span>${esc(x.price || '')}</span><button class="v2-x" data-x="${esc(x.handle)}" aria-label="Not a real product">×</button><i>${A().ic('check', 's14')}</i></div>`).join('')}</div>
        <button class="btn btn-primary v2-confirm" id="v2-confirm">Lead with these ${A().ic('right', 's16')}</button>${hint(`<kbd>1</kbd>–<kbd>${items.length}</kbd> toggle · <kbd>Space</kbd> to continue`)}</div>`);
      const tog = (h) => { hero.has(h) ? hero.delete(h) : hero.add(h); paint(); };
      $$('.v2-prod').forEach((el) => { el.onclick = (e) => { const x = e.target.closest('[data-x]'); if (x) { removed.add(x.dataset.x); hero.delete(x.dataset.x); paint(); return; } tog(el.dataset.h); }; el.onkeydown = (e) => { if (e.key === 'Enter') tog(el.dataset.h); }; });
      const go = () => { st.v2.hero = [...hero]; st.v2.removed = [...removed]; keys(null); finish(b, true); };
      $('#v2-confirm').onclick = go; keys((k) => { const n = +k; if (n >= 1 && n <= items.length) { tog(items[n - 1].handle); return true; } if (k === 'Space' || k === 'Enter') { go(); return true; } if (k === 'Backspace') { back(); return true; } }); paint(); return;
    }
    if (b.needs === 'rivals') {
      const items = p.slice(0, 8); const gone = new Set();
      stage(`<div class="v2-tap"><h1 class="v2-h">${b.q}</h1><p class="v2-p">${b.sub}</p><div class="v2-rivals">${items.map((r, i) => `<div class="v2-rival" data-host="${esc(r.host)}"><kbd>${i + 1}</kbd><img src="${esc(r.logo || `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(r.host)}`)}" alt="" loading="lazy"><div><b>${esc(r.name || r.host)}</b><span>${esc(r.host)}${r.live ? ` · ${r.live} live ad${r.live === 1 ? '' : 's'}` : ''}</span></div><button class="v2-x" data-x="${esc(r.host)}" aria-label="Not a rival">×</button></div>`).join('')}</div>
        <button class="btn btn-primary v2-confirm" id="v2-confirm">These are the ones ${A().ic('right', 's16')}</button>${hint(`<kbd>1</kbd>–<kbd>${items.length}</kbd> removes · <kbd>Space</kbd> to continue`)}</div>`);
      const drop = (h) => { gone.add(h); $(`.v2-rival[data-host="${CSS.escape(h)}"]`)?.setAttribute('hidden', ''); };
      $$('[data-x]').forEach((x) => (x.onclick = () => drop(x.dataset.x)));
      const go = () => { st.v2.removeRivals = [...gone]; keys(null); finish(b, true); };
      $('#v2-confirm').onclick = go; keys((k) => { const n = +k; if (n >= 1 && n <= items.length) { drop(items[n - 1].host); return true; } if (k === 'Space' || k === 'Enter') { go(); return true; } if (k === 'Backspace') { back(); return true; } }); return;
    }
    if (b.needs === 'who') {
      const w = p; const rows = [['name', 'Name'], ['descriptor', 'In one line'], ['category', 'Category'], ['country', 'Main market'], ['currency', 'Currency']].map(([k, label]) => ({ k, label: w[k]?.label || label, v: w[k]?.v ?? w[k] ?? '', src: w[k]?.src })).filter((r) => r.v || r.k !== 'descriptor');
      stage(`<div class="v2-tap"><h1 class="v2-h">${b.q}</h1><p class="v2-p">${b.sub}</p><div class="v2-who">${brand().logo ? `<span class="v2-who-logo"><img src="${esc(brand().logo)}" alt=""></span>` : ''}<dl>${rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd><span data-k="${r.k}">${esc(r.v) || '<i>Not found on the site</i>'}</span><input data-k="${r.k}" value="${esc(r.v)}" placeholder="Add it if you know it" hidden></dd></div>`).join('')}</dl></div>
        <div class="v2-row"><button class="btn btn-ghost lg" id="v2-edit">Edit</button><button class="btn btn-primary lg" id="v2-confirm">Yes, that’s us ${A().ic('right', 's16')}</button></div>${hint(`<kbd>Space</kbd> yes · <kbd>E</kbd> edit`)}</div>`);
      const edit = () => { $$('.v2-who span[data-k]').forEach((s) => (s.hidden = true)); $$('.v2-who input').forEach((i) => (i.hidden = false)); $('.v2-who input')?.focus(); $('#v2-edit').hidden = true; };
      const go = () => { $$('.v2-who input').forEach((i) => { const was = rows.find((r) => r.k === i.dataset.k)?.v || ''; if (!i.hidden && i.value.trim() && i.value.trim() !== was) st.v2.who[i.dataset.k] = i.value.trim(); }); keys(null); finish(b, true); };
      $('#v2-edit').onclick = edit; $('#v2-confirm').onclick = go; keys((k) => { if (k === 'Space' || k === 'Enter') { go(); return true; } if (k === 'e' || k === 'E') { edit(); return true; } if (k === 'Backspace') { back(); return true; } }); return;
    }
    finish(b, 'skip');
  };
  const onBrand = () => { /* the brand stage landed: the floating layer gets the OG image if the peek had one */ peekFloat(); };

  /* ---------- the tutorial, on Brew's own example cards (never the brand's data) ---------- */
  /* EXAMPLE: these four cards are Brew's own teaching examples. They are tagged Example on screen and are never shown as the brand's. */
  const EXAMPLE_CARDS = [
    { id: 'ex-1', kind: 'move', title: 'Lead the week with the bestseller, not the new drop', why: 'Your top product gets 3 of every 5 orders; the new drop gets the homepage.', moves: 'First orders', img: null },
    { id: 'ex-2', kind: 'rival-ad', title: 'A rival has run the same ad for 61 days', why: 'A long-running ad is a working ad. Here is the angle, in your words.', moves: 'Cost per first order', img: null },
    { id: 'ex-3', kind: 'joke', title: 'Rename the brand to something with more vowels', why: 'A very confident model suggested it. No source.', moves: 'Nothing, honestly', img: null },
    { id: 'ex-4', kind: 'heard', title: '14 people asked the same sizing question this week', why: 'On Reddit and in your reviews. Answer it once, everywhere.', moves: 'Returns', img: null }
  ];
  const exCard = (c) => `<article class="v2-card is-example" data-id="${c.id}"><header><span class="v2-card-mk">${A().SO()}</span><b>Brew</b><em class="v2-ex">Example</em></header>
    <div class="v2-card-body"><small>${esc({ move: 'A move', 'rival-ad': 'A rival’s ad', joke: 'A move?', heard: 'Heard this week' }[c.kind] || 'A card')}</small><h3>${esc(c.title)}</h3><p>${esc(c.why)}</p><span class="v2-moves">${A().ic('up', 's14')}${esc(c.moves)}</span></div></article>`;
  const TUT = [
    { c: EXAMPLE_CARDS[0], h: 'Your turn. Swipe right to <b>keep</b> it.', want: 'keep', after: 'Kept. It goes to the top of your feed.' },
    { c: EXAMPLE_CARDS[1], h: 'Tap <b>Open</b> to see the four parts.', want: 'open', after: 'The move, why it’s here, what it moves, your call.' },
    { c: EXAMPLE_CARDS[2], h: 'Not every card is for you. Swipe left to <b>drop</b> it.', want: 'drop', after: 'Gone. Brew learns from what you drop.' },
    { c: EXAMPLE_CARDS[3], h: 'One more. Keep or drop, your call.', want: 'any', after: 'Every tap teaches tomorrow’s feed.' }
  ];
  const tutorial = (b) => { let i = +(st.done.tutAt || 0); const step = () => { if (i >= TUT.length) { delete st.done.tutAt; return finish(b, true); } const t = TUT[i];
      stage(`<div class="v2-tut"><h1 class="v2-h v2-h-sm">${t.h}</h1><div class="v2-stackwrap" id="v2-stack">${exCard(t.c)}</div>${verbsHtml(true)}${hint(`<kbd>←</kbd> drop · <kbd>→</kbd> keep · <kbd>O</kbd> open`)}</div>`);
      const card = $('.v2-card', $('#v2-stack'));
      const did = async (verb) => { if (t.want !== 'any' && verb !== t.want) { nudge(card, t.want); return; }
        if (verb === 'open') { openParts(card, t.c); await wait(1600); }
        else { await flyOut(card, verb); if (verb === 'keep') confetti(); }
        toastLine(t.after); i++; st.done.tutAt = i; save(); setTimeout(step, 900); };
      bindVerbs(card, did, { example: true }); keys((k) => { if (k === 'ArrowRight') { did('keep'); return true; } if (k === 'ArrowLeft') { did('drop'); return true; } if (k === 'o' || k === 'O' || k === 'Enter') { did('open'); return true; } }); };
    step(); };
  const openParts = (card, c) => { const body = $('.v2-card-body', card); if (!body || $('.v2-parts', card)) return; body.insertAdjacentHTML('beforeend', `<dl class="v2-parts"><div><dt>The move</dt><dd>${esc(c.title)}</dd></div><div><dt>Why it’s here</dt><dd>${esc(c.why)}</dd></div><div><dt>What it moves</dt><dd>${esc(c.moves)}</dd></div><div><dt>Your call</dt><dd>Keep, drop, another take, or make it yours.</dd></div></dl>`); card.classList.add('is-open'); };
  const nudge = (card, want) => { card.classList.remove('nudge-keep', 'nudge-drop', 'nudge-open'); void card.offsetWidth; card.classList.add(`nudge-${want}`); };
  const flyOut = (card, verb) => new Promise((r) => { card.classList.add(verb === 'keep' ? 'fly-right' : 'fly-left'); setTimeout(r, reduced() ? 0 : 420); });
  const toastLine = (t) => { const s = $('#v2-stage'); if (!s) return; $('.v2-after', s)?.remove(); s.insertAdjacentHTML('beforeend', `<p class="v2-after">${esc(t)}</p>`); };
  const confetti = () => { if (reduced()) return; const host = document.createElement('div'); host.className = 'v2-confetti'; for (let i = 0; i < 40; i++) { const p = document.createElement('i'); p.style.left = `${50 + (Math.random() - .5) * 30}%`; p.style.setProperty('--dx', `${(Math.random() - .5) * 360}px`); p.style.setProperty('--dy', `${-120 - Math.random() * 260}px`); p.style.setProperty('--r', `${Math.random() * 720}deg`); p.style.animationDelay = `${Math.random() * .2}s`; host.appendChild(p); } document.body.appendChild(host); setTimeout(() => host.remove(), 1800); };

  /* ---------- verbs: keep, drop, another take, make it yours; swipe and buttons mean the same ---------- */
  const verbsHtml = (ex) => `<div class="v2-verbs"><button class="v2-verb is-drop" data-verb="drop" aria-label="Not for me">${A().ic('x', 's18')}<span>Not for me</span></button>${ex ? '' : `<button class="v2-verb" data-verb="take" aria-label="Another take">${A().ic('refresh', 's18')}<span>Another take</span></button>`}<button class="v2-verb" data-verb="open" aria-label="Open">${A().ic('inf', 's18')}<span>Open</span></button>${ex ? '' : `<button class="v2-verb" data-verb="make" aria-label="Make it yours">${A().ic('sparkles', 's18')}<span>Make it yours</span></button>`}<button class="v2-verb is-keep" data-verb="keep" aria-label="Keep">${A().ic('check', 's18')}<span>Keep</span></button></div>`;
  const bindVerbs = (card, did) => {
    $$('.v2-verb').forEach((b) => (b.onclick = () => did(b.dataset.verb)));
    let x0 = null, dx = 0, drag = false;
    const down = (e) => { if (e.target.closest('button,a,input')) return; x0 = e.clientX; dx = 0; drag = true; card.setPointerCapture?.(e.pointerId); card.classList.add('is-drag'); };
    const move = (e) => { if (!drag) return; dx = e.clientX - x0; card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`; card.classList.toggle('lean-keep', dx > 40); card.classList.toggle('lean-drop', dx < -40); };
    const up = () => { if (!drag) return; drag = false; card.classList.remove('is-drag', 'lean-keep', 'lean-drop'); const v = dx > 80 ? 'keep' : dx < -80 ? 'drop' : null; card.style.transform = ''; if (v) did(v); };
    card.addEventListener('pointerdown', down); card.addEventListener('pointermove', move); card.addEventListener('pointerup', up); card.addEventListener('pointercancel', up);
  };

  /* ---------- hold: the read is still running; the real findings and the brand's own photos fill the time ---------- */
  const hold = (b) => {
    if (st.ready || st.error) return finish(b, 'skip');
    stage(`<div class="v2-hold"><h1 class="v2-h v2-h-sm">Still reading ${esc(name())}.</h1><p class="v2-p" id="v2-holdsub">${esc(lastSay || 'Your store, your reviews, your rivals’ ads.')}</p><div class="v2-found" id="v2-found">${st.findings.slice(-6).map(A().scrCard).join('')}</div>${hint('It carries on by itself. <kbd>Space</kbd> does nothing here, honestly.')}</div>`);
    const t = setInterval(() => { if (!$('#v2-found')) return clearInterval(t); const sub = $('#v2-holdsub'); if (sub && lastSay) sub.textContent = lastSay; const f = $('#v2-found'); const want = st.findings.slice(-6); if (f.children.length !== want.length) f.innerHTML = want.map(A().scrCard).join('');
      if (st.ready || st.error) { clearInterval(t); return finish(b, true); }
      /* a brand tap's data landed mid-hold: show it now and come back to the hold after */
      if (beats().some((b2) => b2.kind === 'brand' && !st.done[b2.id] && needsMet(b2) === true)) { clearInterval(t); next(); } }, 1500);
    keys(() => false);
  };
  const afterReady = async () => { await postConfirm(); const b = beatAt(st.i); if (b && b.kind === 'hold') return finish(b, true); };
  /* the taps replaced the check page: once the read is in and the who tap is past, the same confirm goes up and the moves start */
  const postConfirm = async () => { if (st.posted || st.confirmed || !st.ready) return; const whoPast = st.done.who || st.done.tut || st.done.done; if (!whoPast) return;
    st.posted = true; save();
    /* only the taps that were answered go up: an empty hero list would otherwise unset the brand's leads (build.js applyCheck) */
    const v2 = { who: st.v2.who || {}, company: {}, sources: {} }; if (st.done.lead === true) { v2.hero = st.v2.hero; v2.removed = st.v2.removed; } if (st.done.rivals === true) v2.removeRivals = st.v2.removeRivals;
    const r = await A().api(`/api/brands/${slug()}/confirm`, { v2 }).catch(() => null);
    if (r?.signin || r?.error) { st.posted = false; save(); if (r?.signin) A().signWall('check'); else A().toast(`${A().ic('info', 's16')}${esc(r.error || 'Could not save what you picked.')}`); return; }
    if (r?.notes?.length) A().toast(`${A().ic('info', 's16')}${esc(r.notes.join(' '))}`); };

  /* ---------- done: sunrise, the rings, the first moves landing ---------- */
  const ringsOf = async () => { try { const txt = await fetch(`/b/${slug()}/seed.js?t=${Date.now()}`).then((r) => r.text()); const m = txt.match(/window\.fxDeep\((.*)\) \};\n/); const seed = m ? JSON.parse(m[1]) : null; return seed?.health || null; } catch (e) { return null; } };
  const ringSvg = (rings) => { const R = [56, 44, 32]; return `<svg viewBox="0 0 130 130" width="120" height="120" role="img" aria-label="Brand health">${rings.slice(0, 3).map((r, i) => { const c = 2 * Math.PI * R[i], v = r.read === false ? 0 : r.v; return `<circle cx="65" cy="65" r="${R[i]}" fill="none" stroke="var(--v2-ring-bg)" stroke-width="8"/><circle class="v2-arc" cx="65" cy="65" r="${R[i]}" fill="none" stroke="var(--v2-ink)" stroke-opacity="${1 - i * .28}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 65 65)"/>`; }).join('')}</svg>`; };
  const done = async (b) => {
    await postConfirm(); sky(7);
    const n = st.findings.length, srcs = stepsDone();
    stage(`<div class="v2-done"><div class="v2-art v2-sun">${ART.sun}</div><h1 class="v2-h">Good morning, ${esc(name())}.</h1><div class="v2-rings" id="v2-rings"></div>
      <p class="v2-p">${srcs} of ${STEP_KEYS.length} sources read${n ? `, ${n} findings` : ''}. ${st.confirmed ? 'Your team checked this read already.' : 'Your first moves are being written now.'}</p>
      <div class="v2-row"><button class="btn btn-primary lg" id="v2-open">Open my feed ${A().ic('right', 's18')}</button>${st.confirmed ? '' : `<a class="linkbtn" href="/${esc(slug())}#check">Edit what we read</a>`}</div>${hint(`<kbd>Space</kbd> to open`)}</div>`, { noProg: false });
    confetti();
    ringsOf().then((h) => { const el = $('#v2-rings'); if (!el || !h?.rings) return; const read = h.rings.filter((r) => r.read !== false); if (!read.length) { el.innerHTML = `<p class="v2-p v2-dim">Your store score lands with the first moves.</p>`; return; }
      el.innerHTML = `${ringSvg(h.rings)}<ul>${h.rings.map((r) => `<li class="${r.read === false ? 'is-dim' : ''}"><b>${esc(r.k)}</b><em>${r.read === false ? 'not read' : r.v}</em></li>`).join('')}</ul>`; });
    const go = () => { keys(null); st.stage = 'stack'; st.done[b.id] = true; save(); S().onboarded = false; A().save(); A().ls.set(`${A().LSP()}continue`, 'v2'); location.reload(); /* a reload: the page gets the real seed (logo, colours, cards) before the stack */ };
    $('#v2-open').onclick = go; keys((k) => { if (k === 'Space' || k === 'Enter') { go(); return true; } });
  };
  const errorScreen = () => { keys(null); stage(`<div class="v2-done"><h1 class="v2-h">We couldn’t read ${esc(name())}.</h1><p class="v2-p">${esc(st.error)} Check the address, or try again in a few minutes.</p><div class="v2-row"><a class="btn btn-primary lg" href="/">Back to the start</a></div></div>`); };

  /* ---------- the review stack: the first three real cards, one at a time, then the gate ---------- */
  const kindOf = (p) => p.post?.platform ? 'heard' : p.kind === 'ad' || p.rival || /rival/i.test(p.family || '') ? 'rival-ad' : p.kind === 'answer' || p.agent === 'visibility' ? 'answer' : /^m\d+/.test(String(p.id)) || p.move ? 'move' : p.family === 'result' ? 'report' : (p.images || []).length ? 'creative' : 'idea';
  const firstThree = (ranked) => { const used = new Set(), out = []; const take = (pred) => { const p = ranked.find((x) => !used.has(x.id) && pred(x) && !A().cardOf(x).done); if (p) { used.add(p.id); out.push(p); } };
    take((p) => kindOf(p) === 'move'); take((p) => kindOf(p) === 'rival-ad'); take((p) => ['heard', 'answer'].includes(kindOf(p)));
    for (const p of ranked) { if (out.length >= 3) break; if (!used.has(p.id) && !A().cardOf(p).done) { used.add(p.id); out.push(p); } } return out; };
  const KIND_T = { move: 'A move', 'rival-ad': 'A rival’s ad', heard: 'Heard this week', answer: 'What AI says', report: 'A number moved', creative: 'A draft, yours', idea: 'An idea' };
  const realCard = (p) => { const c = A().cardOf(p), img = (c.images || [])[0], f = window.fx || ((x) => x), k = kindOf(p);
    return `<article class="v2-card" data-id="${esc(p.id)}"><header>${brand().mark || brand().logo ? `<img class="v2-card-mk" src="${esc(brand().mark || brand().logo)}" alt="">` : `<span class="v2-card-mk">${A().SO()}</span>`}<b>${esc(name())}</b><em>${esc(KIND_T[k] || 'A card')}</em></header>
      ${img ? `<div class="v2-card-img"><img src="${esc(img)}" alt="">${c.drawing ? '<span class="v2-drawing">drawing…</span>' : ''}</div>` : ''}
      <div class="v2-card-body"><small>${esc(c.from || c.sub0 || '')}</small><h3>${esc(f(c.title))}</h3><p>${esc(f(c.sub || c.p || c.why || ''))}</p>${c.stat || c.gives ? `<span class="v2-moves">${A().ic('up', 's14')}${esc(f(c.stat || c.gives))}</span>` : ''}</div></article>`; };
  const stack = async () => {
    document.body.classList.add('v2-on'); fontIn(); load(); st.stage = 'stack'; save(); sky(7);
    shell(`<div class="v2-tut"><h1 class="v2-h v2-h-sm">Your first three.</h1><p class="v2-p">Real cards for ${esc(name())}. Keep what fits.</p><div class="v2-stackwrap" id="v2-stack"><div class="v2-card is-wait"><span class="spin"></span></div></div>${verbsHtml(false)}${hint(`<kbd>←</kbd> drop · <kbd>→</kbd> keep · <kbd>O</kbd> open · <kbd>R</kbd> another take · <kbd>E</kbd> make it yours`)}</div>`, { noProg: true, right: `<ol class="v2-kept" id="v2-kept"></ol>` });
    await A().loadFeed(); let ranked = A().rank(); let queue = firstThree(ranked); let acted = 0;
    if (!queue.length) { return gate(); }
    const paintKept = () => { const k = $('#v2-kept'); if (k) k.innerHTML = st.kept.map((x) => `<li class="is-${x.v}">${A().ic(x.v === 'keep' ? 'check' : x.v === 'take' ? 'refresh' : 'x', 's14')}<span>${esc(x.t)}</span><em>${x.v === 'keep' ? 'Kept' : x.v === 'take' ? 'Another take' : 'Passed'}</em></li>`).join(''); };
    const showNext = () => { const p = queue.shift(); if (!p || acted >= 3) return gate(); const host = $('#v2-stack'); host.innerHTML = realCard(p); const card = $('.v2-card', host);
      const did = async (verb) => {
        if (verb === 'open') { const c = A().cardOf(p); openParts(card, { title: c.title, why: c.sub || c.p || c.why || '', moves: c.stat || c.gives || '' }); const o = $('.v2-parts', card); if (o && !$('.v2-full', card)) o.insertAdjacentHTML('afterend', `<button class="linkbtn v2-full" data-full>Open in full</button>`); $('[data-full]', card)?.addEventListener('click', () => A().openDetail(p)); return; }
        if (verb === 'make') { window.MakeSheet?.open(p, { onSaved: () => { const c2 = A().byId(p.id) || p; host.innerHTML = realCard(c2); bindVerbs($('.v2-card', host), did); } }); return; }
        if (verb === 'keep') { S().hearts[p.id] = true; A().save(); A().tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'heart' }).catch(() => {}); st.kept.push({ id: p.id, t: A().cardOf(p).title, v: 'keep' }); confetti(); }
        if (verb === 'drop') { S().dismissed[p.id] = true; A().save(); A().tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'not_interested' }).catch(() => {}); st.kept.push({ id: p.id, t: A().cardOf(p).title, v: 'drop' }); }
        if (verb === 'take') { const r = await A().tapi('POST', `/api/cards/${p.id}/remix`, { queue: true, take: true }).catch(() => null); if (!r || r.error) { A().toast(`${A().ic('info', 's16')}${esc(r?.error || 'Another take isn’t available yet.')}`); return; } st.kept.push({ id: p.id, t: A().cardOf(p).title, v: 'take' }); }
        acted++; st.acted = acted; save(); paintKept(); await flyOut(card, verb === 'keep' ? 'keep' : 'drop'); showNext(); };
      bindVerbs(card, did); keys((k) => { if (k === 'ArrowRight') { did('keep'); return true; } if (k === 'ArrowLeft') { did('drop'); return true; } if (k === 'o' || k === 'O') { did('open'); return true; } if (k === 'r' || k === 'R') { did('take'); return true; } if (k === 'e' || k === 'E') { did('make'); return true; } }); };
    paintKept(); showNext();
  };
  /* the gate: the fourth card blurred, then what the plan allows (BREW_GATE: trial | plan | off) */
  const gate = async () => {
    const mode = String(window.BREW_GATE || 'trial'); if (mode === 'off') return team();
    const total = await A().api(`/api/brands/${slug()}/status`).then((s) => +s?.total || 0).catch(() => 0); const more = total > 3 ? `${total - 3} more moves` : 'the rest of the moves';
    stage(`<div class="v2-tut"><div class="v2-stackwrap v2-blur"><div class="v2-card is-blur"><div class="v2-card-img"></div><div class="v2-card-body"><h3>&nbsp;</h3><p>&nbsp;</p></div></div><button class="btn btn-primary lg v2-unlock" id="v2-unlock">${A().ic('lock', 's16')} Unlock ${esc(more)}</button></div>${hint(`<kbd>Space</kbd> to unlock`)}</div>`);
    keys((k) => { if (k === 'Space' || k === 'Enter') { $('#v2-unlock')?.click(); return true; } });
    $('#v2-unlock').onclick = () => {
      stage(`<div class="v2-gate"><div class="v2-fan">${st.kept.filter((x) => x.v === 'keep').slice(0, 3).map((x, i) => `<span class="v2-fan-c f${i}"><b>${esc(x.t)}</b></span>`).join('')}<span class="v2-fan-c f3 is-blur"></span></div>
        <h1 class="v2-h v2-h-sm">${esc(more[0].toUpperCase() + more.slice(1))}, written for ${esc(name())}.</h1>
        ${mode === 'plan' ? `<p class="v2-p">Pick a plan to unlock them.</p><div class="v2-row"><button class="btn btn-primary lg" id="v2-plan">See the plans ${A().ic('right', 's18')}</button><button class="linkbtn" id="v2-back">Go back</button></div>`
          : `<p class="v2-p">Fourteen days, no card. Every move with its sources, the jam, the brief.</p><div class="v2-row"><button class="btn btn-primary lg" id="v2-trial">Start my 14 days ${A().ic('right', 's18')}</button><button class="linkbtn" id="v2-back">Go back</button></div>`}
        ${hint(`<kbd>Space</kbd> to continue`)}</div>`);
      $('#v2-back').onclick = () => gate();
      const go = async () => { if (mode === 'plan') { A().openPlan?.('moves', () => team()); return; } setViewer({ trial: Date.now() }); A().toast(`${A().ic('check', 's16')}Your 14 days start today.`); team(); };
      $('#v2-trial,#v2-plan')?.addEventListener('click', go); keys((k) => { if (k === 'Space' || k === 'Enter') { go(); return true; } });
    };
  };
  /* the last step: invite your team (the rule from SCOPE), the existing step inside the v2 shell; then the feed */
  const team = () => { keys(null); st.stage = 'team'; save(); document.body.classList.remove('v2-on'); const ac = window.LIVE?.access; if (ac?.role && window.LIVE?.me && (V().teamSize || 'me') !== 'me') return A().teamStep(); A().finishOnboarding(); };

  /* ---------- the hero on the landing: one field, the typewriter, then the peek while the read starts ---------- */
  const peekOf = () => { try { return JSON.parse(ss.get(`brew-peek:${brand().host || ''}`) || 'null'); } catch (e) { return null; } };
  const CATS = ['skincare', 'sneaker', 'coffee', 'pet', 'home', 'jewellery', 'wellness', 'fashion', 'baby', 'furniture'];
  const start = async () => {
    document.body.classList.add('v2-on'); fontIn(); sky(5);
    shell(`<div class="v2-hero"><h1 class="v2-h v2-h-xl">Your next move,<br>for <span class="v2-type" id="v2-cat">${CATS[0]}</span> brands.</h1>
      <p class="v2-p">Paste your store. Brew reads it, your reviews, your rivals and what AI tools say about you, and writes your first moves while you set up.</p>
      <form class="v2-url" id="v2-url" autocomplete="off">${A().ic('link', 's18')}<input id="v2-in" value="${A().LANDING ? '' : esc(brand().host || '')}" placeholder="yourbrand.com" aria-label="Your website" inputmode="url" autocapitalize="off" spellcheck="false"${!A().LANDING && window.BREW_DEMO ? ` readonly aria-readonly="true" title="This demo is set up for ${esc(brand().host || '')}"` : ''}><button class="btn btn-primary" id="v2-go" type="submit">Read my store ${A().ic('right', 's16')}</button></form>
      <p class="v2-foot">${window.LIVE?.me ? `Signed in as ${esc(window.LIVE.me.email)}.` : window.LIVE?.signin ? 'You sign in with Google to start.' : ''} <a href="/?v=1">The earlier flow</a></p></div>`, { noProg: true });
    /* the categories Brew has read, else a plain list */
    A().api('/api/demo-brands').then((r) => { const cs = (r?.brands || []).map((b) => (b.category || '').toLowerCase()).filter(Boolean); if (cs.length) CATS.splice(0, CATS.length, ...new Set(cs)); }).catch(() => {});
    let ci = 0, alive = true; const cycle = async () => { const el = $('#v2-cat'); if (!el || !alive) return; ci = (ci + 1) % CATS.length; if (!reduced()) { for (let n = el.textContent.length; n >= 0; n--) { el.textContent = el.textContent.slice(0, n); await wait(22); } } await typeIn(el, CATS[ci], 40); setTimeout(cycle, 1800); }; setTimeout(cycle, 2200);
    const going = (on, t) => { const b = $('#v2-go'), i = $('#v2-in'); if (!b) return; b.disabled = on; if (i) i.readOnly = on; if (on) { b.dataset.t ??= b.innerHTML; b.innerHTML = `<span class="spin"></span>${esc(t)}`; } else if (b.dataset.t) b.innerHTML = b.dataset.t; };
    const go = async (e) => { e?.preventDefault(); if ($('#v2-go').disabled) return; const url = $('#v2-in').value.trim(); if (!url) return $('#v2-in').focus(); alive = false;
      going(true, 'Opening your store…');
      /* a brand's own page (the demo tour starts here): no new brand, the read of this one plays */
      if (!A().LANDING) { const pk = await A().api(`/api/peek?url=${encodeURIComponent(url)}`).catch(() => null); if (pk && !pk.error) ss.set(`brew-peek:${pk.host || url}`, JSON.stringify(pk)); await peekScreen(pk, url.replace(/^https?:\/\//, '').split('/')[0]); await A().ensureTenant(true); return run(); }
      const host = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      /* the peek and the real read start together: the site card shows within a couple of seconds while the read begins */
      const peekP = A().api(`/api/peek?url=${encodeURIComponent(url)}`).catch(() => null);
      const r = await A().api('/api/brands', { url }).catch(() => null);
      if (r?.signin) { going(true, 'Taking you to sign in…'); location.href = `/auth/google?next=${encodeURIComponent('/?v=2&build=' + encodeURIComponent(url))}`; return; }
      if (!r?.slug) { going(false); alive = true; cycle(); A().toast(`${A().ic('info', 's16')}${esc(r?.error || 'That address did not open. Check it and try again.')}`); return; }
      const pk = await peekP; if (pk && !pk.error) ss.set(`brew-peek:${pk.host || host}`, JSON.stringify(pk));
      await peekScreen(pk, host); location.href = '/' + r.slug + '?v=2'; };
    $('#v2-url').onsubmit = go;
    const q = new URLSearchParams(location.search), bq = q.get('build'); if (bq) { $('#v2-in').value = bq; history.replaceState(null, '', '/?v=2'); setTimeout(go, 150); }
    if (q.get('signin') === 'failed') { history.replaceState(null, '', '/?v=2'); A().toast(`${A().ic('info', 's16')}Google sign-in did not finish. Try again.`); }
    setTimeout(() => $('#v2-in')?.focus(), 300);
  };
  /* the site card: the brand's own OG image, title typed in, description; honest when it did not answer */
  const peekScreen = async (pk, host) => {
    stage(`<div class="v2-peek"><div class="v2-frame"><div class="v2-frame-bar"><i></i><i></i><i></i><span>${esc(host)}</span></div><div class="v2-frame-img">${pk?.ogImage ? `<img src="${esc(pk.ogImage)}" alt="">` : `<span class="v2-globe">${A().ic('inf', 's18')}</span>`}</div><div class="v2-frame-txt"><b id="v2-pk-t"></b><p id="v2-pk-d"></p></div></div>
      <p class="v2-p v2-dim">${pk?.error ? `${esc(host)} didn’t answer in two seconds. Brew keeps reading.` : `Opening ${esc(host)}…`}</p></div>`);
    if (pk && !pk.error) { await typeIn($('#v2-pk-t'), pk.title || host, 14); if (pk.description) await typeIn($('#v2-pk-d'), String(pk.description).slice(0, 160), 6); await wait(700); } else await wait(1200);
  };

  /* ---------- entry points the app's router calls ---------- */
  const run = async () => { document.body.classList.add('v2-on'); fontIn(); load();
    if (st.stage === 'stack') return stack();
    const s = await A().api(`/api/brands/${slug()}/status`).catch(() => null); st.confirmed = s?.stages?.confirm?.state === 'done'; if (s?.stages?.read?.state === 'done') st.ready = true; if (s?.error && s.unreadable) st.error = s.state;
    sky(st.ready ? 7 : 1 + stepsDone()); save();
    shell('', {}); peekFloat(); listen(); if (st.ready) st.steps = STEP_KEYS.map((k, i) => st.steps[i] || { k, state: 'done', empty: false, done: 'Done' });
    if (st.error) return errorScreen();
    next(); };
  const route = (kind) => { load(); if (kind === 'continue' || st.stage === 'stack') return stack(); return run(); };
  const resume = () => run();
  const reset = () => { ls.del(KEY()); st = null; };
  const debug = () => ({ st, beat: beatAt(st?.i || 0)?.id, lastSay, es: !!es });
  window.OB2 = { start, run, route, resume, reset, debug, stack };
})();
