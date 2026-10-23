/* The creative stage in the v1 jam (Param, 23 Oct): a picture, a set or a video the card asks for is made by Brew Studio, right
   under the frame it will live in. Every slot arrives filled from what Brew already knows (the card, the Brand Book, the catalog,
   the reference the card is about), each with one line saying why, and every one can be changed. Nothing paid is made before the
   price is shown and Generate is pressed. The make runs on the server (jam2/studio.js through the card's Studio jam), so the
   person can leave: the take lands in the v1 jam as its next version and the Work tab says when it is ready.
   app.js owns the page; this keeps the composer's state per jam and asks app.js to repaint (init({ paint, landed, ... })). */
(() => {
  const H = {}; let S = null, LIB = null, SIZES = null, pollT = null, planT = null;
  const srcOf = (s) => (!s ? '' : /^(https?:|data:|blob:|\/)/.test(s) ? s : '/' + s);
  const usd = (n) => (n == null ? '' : `$${(+n).toFixed(2)}`);
  const SIZE_OPTS = { image: ['ig-portrait', 'ig-square', 'story', 'pinterest', 'youtube', 'fbx', 'email', 'banner', 'pdp', 'a5'], video: ['story', 'ig-square', 'ig-portrait', 'youtube'] };
  const groups = () => (LIB ? [...LIB.image.map((g) => ({ ...g, kind: 'image' })), ...LIB.video.map((g) => ({ ...g, kind: 'video' }))] : []);
  const styleById = (id) => { for (const g of groups()) { const x = g.styles.find((y) => y.id === id); if (x) return { ...x, group: x.group || g.label, kind: g.kind }; } return null; };
  const paint = () => H.paint?.();
  /* a listing card makes the marketplace image set, or the brand's Amazon A+ modules instead (each at Amazon's own size) */
  const LISTING = new Set(['listing', 'pdp-set', 'aplus']), isAplus = (set) => (set || []).length > 0 && set.every((x) => /^aplus-/.test(x));
  const SETS = { listing: { set: ['mp-main', 'mp-lifestyle', 'mp-benefits', 'mp-size'], sizes: ['pdp'] }, aplus: { set: ['aplus-hero', 'aplus-use', 'aplus-detail', 'aplus-hands', 'aplus-wide'], sizes: ['aplus-header'] } };
  const api = (m, p, b) => H.tapi(m, p, b).catch((e) => ({ error: e?.message || 'That didn’t go through.' }));

  /* open (or reopen) the composer for this v1 jam: its Studio jam, the filled set-up, the styles, the sizes, then the price */
  async function mount(ch, card) {
    if (S && S.chId === ch.id && !S.error) return; clearTimeout(pollT);
    const mine = S = { chId: ch.id, loading: true, open: true, pop: null, recipe: ch.studio || null, sel: 0 };
    const [o, L, C] = await Promise.all([api('POST', '/api/jam2/open', { cardId: ch.cardId, cta: ch.studioLabel || card?.cta?.label || '', v1ch: ch.id }), LIB ? { library: LIB } : api('GET', '/api/jam2/studio/library'), SIZES ? { sizes: SIZES } : api('GET', '/api/jam2/catalogue')]);
    if (S !== mine) return; LIB = L?.library || LIB; SIZES = C?.sizes || SIZES;
    const jam = o?.jam, bd = jam?.boards?.[0];
    if (!jam || !bd) { S.loading = false; S.error = o?.error || 'The studio couldn’t open just now.'; return paint(); }
    const d = await api('GET', `/api/jam2/jams/${jam.id}/studio?bid=${encodeURIComponent(bd.id)}`); if (S !== mine) return;
    if (!d?.defaults) { S.loading = false; S.error = d?.error || 'The studio couldn’t open just now.'; return paint(); }
    const D = d.defaults, X = d.context?.slots || {};
    Object.assign(S, { loading: false, jid: jam.id, bid: bd.id, boards: jam.boards.map((b) => b.id), products: d.products || [], slots: X, missing: d.context?.missing || [], blocked: D.blocked || {}, picks: D.styles || [],
      spec: { ...D, ask: '', direction: X.direction?.value || '', cast: X.cast?.shown && X.cast.value !== 'none' ? X.cast.label : X.cast?.value === 'none' ? 'No people' : null, ref: X.reference?.value?.label || null, quality: 'standard' },
      busy: jam.busy || {}, made: (bd.takes || []).length > 0 });
    S.open = !ch.versions?.some((v) => v.studio) && !S.made; /* made already: the set-up folds into one line under the frame */
    paint(); price(); if (anyBusy()) poll();
  }
  const anyBusy = () => !!S && Object.values(S.busy || {}).some((b) => b && b.op && !b.error);
  function price() { clearTimeout(planT); if (!S?.spec) return; S.plan = null; paint(); const mine = S, spec = S.spec;
    planT = setTimeout(async () => { const r = await api('POST', `/api/jam2/jams/${mine.jid}/studio/plan`, { spec }); if (S === mine && S.spec === spec) { S.plan = r?.plan || { error: r?.error || 'No price yet.' }; paint(); } }, 250); }
  const set = (patch) => { S.spec = { ...S.spec, ...patch }; S.pop = null; price(); };

  async function go(redo = false) {
    const pl = S?.plan; if (!pl || pl.error || pl.usd == null || S.working) return; const mine = S; S.working = true; paint();
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/make`, { spec: S.spec, confirmUsd: pl.usd, bid: S.bid, redo: redo || S.made });
    if (S !== mine) return; S.working = false;
    if (r?.needsConfirm) { S.plan = r.plan; paint(); return H.toast?.(`The price changed to ${usd(r.plan.usd)}. Tap Generate again.`); }
    if (r?.error) { paint(); return H.toast?.(H.esc(r.error)); }
    S.boards = r.jam?.boards?.map((b) => b.id) || S.boards; S.busy = r.jam?.busy || {}; S.making = { line: r.plan.line, usd: r.plan.usd, at: Date.now(), n: (r.boards || []).length || 1 }; S.open = false;
    H.making?.(S.chId, S.making); paint(); poll();
  }
  /* one slide of a made set: redo it or add one (priced, from the plan of that one style), or drop it (free) */
  const slidesOf = (ch) => ch.versions?.find((v) => v.id === ch.head)?.studio?.slides || null;
  function slidePrice(style) { if (!S?.spec || !style) return; S.slidePlan ||= {}; if (S.slidePlan[style] !== undefined) return; S.slidePlan[style] = null; const mine = S;
    api('POST', `/api/jam2/jams/${S.jid}/studio/plan`, { spec: { ...S.spec, set: null, kind: 'image', style, count: 1 } }).then((r) => { if (S === mine) { S.slidePlan[style] = r?.plan || { error: 'No price yet.' }; paint(); } }); }
  async function slideOp(op, i, style) { if (S.working) return; const pl = op === 'drop' ? null : S.slidePlan?.[style]; if (op !== 'drop' && (!pl || pl.error)) return;
    const mine = S; S.working = true; paint();
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/slide`, { bid: S.bid, i, op, style, confirmUsd: pl?.usd });
    if (S !== mine) return; S.working = false;
    if (r?.needsConfirm) { S.slidePlan[style] = r.plan; paint(); return H.toast?.(`The price changed to ${usd(r.plan.usd)}. Tap it again.`); }
    if (r?.error) { paint(); return H.toast?.(H.esc(r.error)); }
    if (op === 'drop') { S.sel = Math.max(0, i - 1); H.landed?.(S.chId, {}); return; }
    S.busy = r.jam?.busy || {}; S.making = { line: `${op === 'add' ? 'a new slide' : `slide ${i + 1}`} · ${styleById(style)?.label || ''}`, usd: pl.usd, at: Date.now(), n: 1 }; S.adding = false; S.gallery = false; H.making?.(S.chId, S.making); paint(); poll(); }
  /* the jam's boards until every take this press started has landed (or failed): then the v1 jam is read again, with its new version */
  function poll() { clearTimeout(pollT); const mine = S;
    pollT = setTimeout(async () => { if (S !== mine) return; const r = await api('GET', `/api/jam2/jams/${S.jid}`); if (S !== mine) return; if (!r?.jam) { pollT = setTimeout(poll, 6000); return; }
      S.busy = r.jam.busy || {}; S.boards = r.jam.boards.map((b) => b.id); const err = Object.values(S.busy).find((b) => b?.error);
      if (anyBusy()) { paint(); return poll(); }
      const was = S.making; S.making = null; S.made = r.jam.boards.some((b) => (b.takes || []).length); if (err) S.failed = err.error; else S.failed = null;
      H.landed?.(S.chId, { failed: S.failed, was }); }, 3000); }

  /* ---------- the composer ---------- */
  const why = (k) => S.slots?.[k]?.why || '';
  const chip = (k, label, value, extra = '') => `<div class="cs-slot"><small>${H.esc(label)}</small><button class="j2-chip cs-chip${S.pop === k ? ' on' : ''}" data-cs-pop="${k}" title="${H.esc(why(k))}">${extra}${H.esc(value)}</button></div>`;
  const tile = (x) => { const on = Array.isArray(S.spec.set) ? S.spec.set.includes(x.id) : x.id === S.spec.style, no = S.blocked?.[x.id], ph = S.spec.product?.img;
    return `<button class="j2-sti${on ? ' on' : ''}${no ? ' no' : ''}" data-cs-style="${H.esc(x.id)}" title="${H.esc(no || x.look || x.label)}">${x.cover ? `<img src="${H.esc(x.cover)}" alt="" loading="lazy">` : ph ? `<span class="j2-sti-ph"><img src="${H.esc(srcOf(ph))}" alt="" loading="lazy"></span>` : `<span class="j2-sti-art">${H.esc(x.label)}</span>`}<b>${Array.isArray(S.spec.set) && on ? `<span class="j2-sti-n">${S.spec.set.indexOf(x.id) + 1}</span> ` : ''}${H.esc(x.label)}</b><small>${H.esc(x.group || '')}</small></button>`; };
  function popHtml(k) {
    const sp = S.spec, X = S.slots || {}, head = (t) => `<p class="cs-why">${H.esc(t)}</p>`;
    if (k === 'product') return `<div class="j2-pop cs-pop">${head(why('products'))}<div class="cs-grid">${S.products.map((p, i) => `<button data-cs-prod="${i}" class="${p.img === sp.product?.img ? 'on' : ''}"><img src="${H.esc(srcOf(p.img))}" alt=""><span>${H.esc((p.name || '').slice(0, 40))}</span></button>`).join('') || '<p>No product photos yet. Add them in your Brand Book.</p>'}</div></div>`;
    if (k === 'cast') return `<div class="j2-pop cs-pop">${head(why('cast'))}${(X.cast?.options || []).map((o) => `<button data-cs-cast="${H.esc(o.id)}" class="${(sp.cast || '') === (o.id === 'none' ? 'No people' : o.label) ? 'on' : ''}">${o.img ? `<img src="${H.esc(srcOf(o.img))}" alt="">` : ''}${H.esc(o.label)}</button>`).join('')}</div>`;
    if (k === 'ref') { const r = X.reference?.value; return `<div class="j2-pop cs-pop">${head(why('reference'))}${r?.img ? `<img class="cs-refimg" src="${H.esc(srcOf(r.img))}" alt="">` : ''}${sp.ref ? '<button data-cs-ref="off">Don’t follow a reference</button>' : r ? '<button data-cs-ref="on">Follow it</button>' : ''}</div>`; }
    if (k === 'brand') { const b = X.brand?.value || {}; return `<div class="j2-pop cs-pop">${head(why('brand'))}<div class="cs-kit">${b.logo ? `<img src="${H.esc(srcOf(b.logo))}" alt="Logo">` : '<span>No logo yet</span>'}${(b.colors || []).map((c) => `<i style="background:${H.esc(c)}" title="${H.esc(c)}"></i>`).join('')}</div>${b.tone ? `<p class="cs-why">Tone: ${H.esc(b.tone)}</p>` : ''}<button data-cs-brand>Change it in your Brand Book</button></div>`; }
    if (k === 'size') return `<div class="j2-pop cs-pop">${head(why('size'))}${SIZE_OPTS[sp.kind === 'video' ? 'video' : 'image'].map((s) => `<button data-cs-size="${s}" class="${s === sp.sizes?.[0] ? 'on' : ''}">${H.esc(SIZES?.[s]?.label || s)}</button>`).join('')}</div>`;
    return '';
  }
  function gallery() { const sp = S.spec, kind = sp.kind === 'video' ? 'video' : 'image', gs = groups().filter((g) => g.kind === kind), g = gs.find((x) => x.id === S.group) || gs[0], q = (S.q || '').toLowerCase();
    const list = q ? gs.flatMap((x) => x.styles.map((y) => ({ ...y, group: y.group || x.label }))).filter((y) => `${y.label} ${y.group}`.toLowerCase().includes(q)) : (g?.styles || []).map((y) => ({ ...y, group: y.group || g.label }));
    return `<div class="j2-stgal"><div class="j2-stgal-side">${gs.map((x) => `<button data-cs-grp="${H.esc(x.id)}" class="${x.id === g?.id ? 'on' : ''}">${H.esc(x.label)} <small>${x.styles.length}</small></button>`).join('')}</div>
      <div class="j2-stgal-main"><input id="cs-q" placeholder="Search templates" value="${H.esc(S.q || '')}"><div class="j2-stgrid">${list.map(tile).join('') || '<p>No template matches.</p>'}</div></div><button class="j2-ghost j2-stgal-x" data-cs-galx aria-label="Close">✕</button></div>`; }
  function full() {
    const sp = S.spec, X = S.slots || {}, setIds = Array.isArray(sp.set) ? sp.set : null, kind = sp.kind === 'video' ? 'video' : 'image';
    const shown = setIds ? setIds.map(styleById).filter(Boolean) : (() => { const picks = S.picks.map(styleById).filter((x) => x && x.kind === kind), cur = styleById(sp.style); return cur && !picks.some((x) => x.id === cur.id) ? [cur, ...picks.slice(0, 2)] : picks.slice(0, 3); })();
    const total = groups().filter((g) => g.kind === kind).reduce((a, g) => a + g.styles.length, 0), pl = S.plan, st = styleById(sp.style);
    const castOn = X.cast?.shown || kind === 'video' || /ugc|tt-|on-model|full-body|hands/.test(sp.style || '');
    return `<div class="j2-studio cs">${S.gallery ? gallery() : ''}
      <div class="j2-st-top">${setIds && LISTING.has(S.recipe) ? `<div class="j2-seg"><button data-cs-mk="listing" class="${isAplus(setIds) ? '' : 'on'}">Listing images</button><button data-cs-mk="aplus" class="${isAplus(setIds) ? 'on' : ''}">Amazon A+</button></div><b>${setIds.length} ${isAplus(setIds) ? 'modules' : 'images'}</b>` : setIds ? `<b>${setIds.length} slides</b>` : `<div class="j2-seg"><button data-cs-kind="image" class="${kind === 'image' ? 'on' : ''}">Image</button><button data-cs-kind="video" class="${kind === 'video' ? 'on' : ''}">Video</button></div>`}<span class="j2-st-hint">${H.ic?.('sparkles', 's14') || ''}Filled in by Brew from the card and your Brand Book · change anything</span></div>
      <p class="cs-why cs-why-top">${H.esc(why('style'))}</p>
      <div class="j2-st-styles">${shown.map(tile).join('')}<button class="j2-sti more" data-cs-gal><span class="j2-sti-art">＋</span><b>Browse templates</b><small>${total} in all</small></button></div>
      <div class="cs-slots">
        ${chip('product', 'Product', sp.product?.name ? sp.product.name.slice(0, 30) : 'No product', sp.product?.img ? `<img src="${H.esc(srcOf(sp.product.img))}" alt="">` : '')}
        ${castOn ? chip('cast', 'On camera', sp.cast || X.cast?.label || 'Anyone') : ''}
        ${X.reference?.value ? chip('ref', 'Reference', sp.ref ? X.reference.value.label : 'Not used', X.reference.value.img && sp.ref ? `<img src="${H.esc(srcOf(X.reference.value.img))}" alt="">` : '') : ''}
        ${chip('brand', 'Brand kit', X.brand?.value?.logo ? 'Logo, colours, tone' : 'Colours, tone', (X.brand?.value?.colors || []).slice(0, 3).map((c) => `<i class="cs-dot" style="background:${H.esc(c)}"></i>`).join(''))}
        ${chip('size', 'Size', SIZES?.[sp.sizes?.[0]]?.label || sp.sizes?.[0] || 'Size')}
        ${kind === 'video' ? `<div class="cs-slot"><small>Length</small><div class="j2-seg">${[5, 10, 15].map((n) => `<button data-cs-sec="${n}" class="${+sp.seconds === n ? 'on' : ''}">${n} s</button>`).join('')}</div></div>` : ''}
        ${setIds ? '' : `<div class="cs-slot"><small>How many</small><div class="j2-count"><button data-cs-count="-1" aria-label="Fewer">−</button><b>${sp.count}</b><button data-cs-count="1" aria-label="More">+</button></div></div>`}
        <div class="cs-slot"><small>Quality</small><div class="j2-seg">${[['preview', 'Preview'], ['standard', 'Standard'], ['premium', 'Premium']].map(([k, n]) => `<button data-cs-q="${k}" class="${(sp.quality || 'standard') === k ? 'on' : ''}" title="${H.esc(k === 'premium' ? '4K, for print and big screens' : k === 'preview' ? 'A quick, cheap look at the idea' : why('quality'))}">${n}</button>`).join('')}</div></div>
        ${S.pop ? popHtml(S.pop) : ''}
      </div>
      <label class="cs-dir"><small>Direction <span>${H.esc(why('direction'))}</span></small><textarea id="cs-dir" rows="3">${H.esc(sp.direction || '')}</textarea></label>
      ${(S.missing || []).map((m) => `<p class="j2-st-note">${H.esc(m.text)}${m.go === 'brand' ? ` <button class="linkbtn" data-cs-brand>${H.esc(m.fix)}</button>` : ''}</p>`).join('')}${pl?.note ? `<p class="j2-st-note">${H.esc(pl.note)}</p>` : ''}
      <div class="j2-st-go"><span>${pl ? H.esc(pl.error || pl.line) : 'Pricing it…'}</span><button class="j2-pri" data-cs-go ${!pl || pl.error || S.working ? 'disabled' : ''}>${S.working ? 'Starting…' : `Generate${pl?.usd != null ? ` · ${usd(pl.usd)}` : ''}`}</button></div>
      ${st && !setIds ? '' : ''}</div>`;
  }
  /* the stage's composer: the whole set-up, a line while it is being made, or one line under a made take */
  function html(ch) {
    if (!S || S.chId !== ch.id || S.loading) return `<div class="j2-studio cs"><p class="cs-wait"><brew-load class="spin"></brew-load> Setting it up from the card…</p></div>`;
    if (S.error) return `<div class="j2-studio cs"><p class="j2-err">${H.esc(S.error)}</p><button class="j2-pri" data-cs-retry>Try again</button></div>`;
    if (S.making || anyBusy()) { const m = S.making; return `<div class="j2-studio cs cs-making"><p><brew-load class="spin"></brew-load><b>Making ${H.esc(m?.line || 'it')}</b>${m?.usd != null ? ` · ${usd(m.usd)}` : ''}</p><p class="cs-why">You can leave this page: it lands here and in Work when it’s ready, and Brew tells you.</p><div class="cs-acts"><button class="j2-chip" data-cs-feed>Back to the feed</button>${window.BrewGame ? '<button class="j2-chip" data-cs-game>Play while it brews</button>' : ''}</div></div>`; }
    const sl = slidesOf(ch);
    if (!S.open && sl?.length > 1) { const i = Math.min(S.sel || 0, sl.length - 1), cur = sl[i], st = styleById(cur.style); slidePrice(cur.style); const sp = S.slidePlan?.[cur.style];
      return `<div class="cs-line cs-set">${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}${S.gallery && S.adding ? `<div class="j2-studio cs cs-addgal">${gallery()}</div>` : ''}
        <div class="cs-strip">${sl.map((x, k) => `<button class="${k === i ? 'on' : ''}" data-cs-sel="${k}" title="${H.esc(styleById(x.style)?.label || '')}"><img src="${H.esc(srcOf(x.file))}" alt=""><span>${k + 1}</span></button>`).join('')}<button class="cs-add" data-cs-addslide title="Add a slide">＋</button></div>
        ${S.adding && S.addStyle ? (() => { const ap = S.slidePlan?.[S.addStyle]; return `<div class="cs-acts cs-addrow"><span>Add a slide: ${H.esc(styleById(S.addStyle)?.label || '')}</span><button class="j2-pri" data-cs-addgo ${!ap || ap.error || S.working ? 'disabled' : ''}>${ap?.error ? H.esc(ap.error) : `Add this slide${ap?.usd != null ? ` · ${usd(ap.usd)}` : ''}`}</button><button class="j2-chip" data-cs-addx>Cancel</button></div>`; })() : ''}
        <div class="cs-acts"><span>Slide ${i + 1} of ${sl.length}${st ? ` · ${H.esc(st.label)}` : ''}</span><button class="j2-chip" data-cs-slide="redo" ${!sp || sp.error ? 'disabled' : ''}>Redo this slide${sp?.usd != null ? ` · ${usd(sp.usd)}` : ''}</button><button class="j2-chip" data-cs-slide="drop" ${sl.length <= 2 ? 'disabled title="A set needs at least two slides"' : ''}>Drop it</button><button class="j2-chip" data-cs-open>Change the set-up</button><button class="j2-pri" data-cs-redo ${!S.plan || S.plan.error ? 'disabled' : ''}>Redo the set${S.plan?.usd != null ? ` · ${usd(S.plan.usd)}` : ''}</button></div></div>`; }
    if (!S.open) return `<div class="cs-line">${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}<span>${H.esc(S.plan?.line || 'Made by Brew Studio')}</span><button class="j2-chip" data-cs-open>Change the set-up</button><button class="j2-pri" data-cs-redo ${!S.plan || S.plan.error ? 'disabled' : ''}>Redo it${S.plan?.usd != null ? ` · ${usd(S.plan.usd)}` : ''}</button></div>`;
    return full();
  }
  /* clicks on the composer: true when handled */
  function click(e) {
    const g = (sel) => e.target.closest(sel); if (!S || !g('.cs, .cs-line, [data-cs-open]')) return false; const sp = S.spec;
    if (g('[data-cs-retry]')) { const id = S.chId; S = null; H.paint?.(); H.remount?.(id); return true; }
    if (g('[data-cs-feed]')) { H.toFeed?.(); return true; }
    if (g('[data-cs-game]')) { window.BrewGame?.open?.({ progress: () => S?.making }); return true; }
    if (g('[data-cs-open]')) { S.open = true; paint(); setTimeout(() => document.querySelector('.cs-stage .cs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); return true; }
    if (g('[data-cs-redo]')) { go(true); return true; }
    const sel = g('[data-cs-sel]'); if (sel) { S.sel = +sel.dataset.csSel; paint(); return true; }
    if (g('[data-cs-addslide]')) { S.adding = true; S.gallery = true; paint(); return true; }
    const so = g('[data-cs-slide]'); if (so) { const sl = slidesOf(H.ch?.() || {}) || []; const i = Math.min(S.sel || 0, sl.length - 1); slideOp(so.dataset.csSlide, i, sl[i]?.style); return true; }
    if (g('[data-cs-go]')) { go(false); return true; }
    if (!sp) return true;
    const pop = g('[data-cs-pop]'); if (pop) { S.pop = S.pop === pop.dataset.csPop ? null : pop.dataset.csPop; paint(); return true; }
    if (g('[data-cs-gal]')) { S.gallery = true; paint(); return true; } if (g('[data-cs-galx]')) { S.gallery = false; S.adding = false; paint(); return true; }
    const grp = g('[data-cs-grp]'); if (grp) { S.group = grp.dataset.csGrp; S.q = ''; paint(); return true; }
    const mk = g('[data-cs-mk]'); if (mk) { const want = SETS[mk.dataset.csMk]; const ids = want.set.filter((id) => !S.blocked?.[id]); if (ids.length < 2) { H.toast?.('Your Brand Book rules out most of these.'); return true; } set({ set: ids, sizes: want.sizes }); return true; }
    const k = g('[data-cs-kind]'); if (k && k.dataset.csKind !== sp.kind) { const kind = k.dataset.csKind, first = groups().find((x) => x.kind === kind)?.styles?.[0]; S.picks = groups().filter((x) => x.kind === kind).flatMap((x) => x.styles.slice(0, 1)).map((x) => x.id); set({ kind, style: first?.id || null, sizes: [SIZE_OPTS[kind][0]], seconds: kind === 'video' ? first?.seconds || 10 : null }); return true; }
    const s = g('[data-cs-style]'); if (s && S.adding) { const id = s.dataset.csStyle; if (S.blocked?.[id]) { H.toast?.(H.esc(S.blocked[id])); return true; } S.addStyle = id; S.gallery = false; slidePrice(id); paint(); return true; } /* the price shows first; the add is its own press */
    if (g('[data-cs-addgo]')) { slideOp('add', 0, S.addStyle); return true; } if (g('[data-cs-addx]')) { S.adding = false; S.addStyle = null; paint(); return true; }
    if (s) { const id = s.dataset.csStyle; if (S.blocked?.[id]) { H.toast?.(H.esc(S.blocked[id])); return true; }
      if (Array.isArray(sp.set)) { const has = sp.set.includes(id); if (has && sp.set.length <= 2) { H.toast?.('A set needs at least two slides.'); return true; } if (!has && sp.set.length >= 10) { H.toast?.('Ten slides at most.'); return true; } S.gallery = false; set({ set: has ? sp.set.filter((x) => x !== id) : [...sp.set, id] }); return true; }
      const x = styleById(id); S.gallery = false; set({ style: id, ...(x?.seconds && sp.kind === 'video' ? { seconds: x.seconds } : {}), ...(x?.ratio === '1:1' ? { sizes: ['ig-square'] } : {}) }); return true; }
    const pr = g('[data-cs-prod]'); if (pr) { const p = S.products[+pr.dataset.csProd]; if (p) set({ product: { img: p.img, name: p.name || null, handle: p.handle || null } }); return true; }
    const c = g('[data-cs-cast]'); if (c) { const o = (S.slots.cast?.options || []).find((x) => x.id === c.dataset.csCast); set({ cast: o?.id === 'none' ? 'No people' : o?.label || null }); return true; }
    const rf = g('[data-cs-ref]'); if (rf) { set({ ref: rf.dataset.csRef === 'on' ? S.slots.reference?.value?.label || null : null }); return true; }
    if (g('[data-cs-brand]')) { H.toBrand?.(); return true; }
    const sz = g('[data-cs-size]'); if (sz) { set({ sizes: [sz.dataset.csSize] }); return true; }
    const sec = g('[data-cs-sec]'); if (sec) { set({ seconds: +sec.dataset.csSec }); return true; }
    const n = g('[data-cs-count]'); if (n) { set({ count: Math.max(1, Math.min(12, (+sp.count || 1) + +n.dataset.csCount)) }); return true; }
    const q = g('[data-cs-q]'); if (q) { set({ quality: q.dataset.csQ }); return true; }
    return true;
  }
  /* typing: the direction and the template search change the set-up without a repaint under the cursor */
  function input(e) { if (!S?.spec) return false;
    if (e.target.id === 'cs-dir') { S.spec = { ...S.spec, direction: e.target.value }; clearTimeout(S.dirT); S.dirT = setTimeout(price, 600); return true; }
    if (e.target.id === 'cs-q') { S.q = e.target.value; const pos = e.target.selectionStart; paint(); const el = document.getElementById('cs-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return true; }
    return false; }
  const state = (id) => (S && S.chId === id ? { loading: !!S.loading, making: !!(S.making || anyBusy()), made: !!S.made, open: !!S.open, plan: S.plan, productImg: S.spec?.product?.img || null } : null);
  const reset = () => { clearTimeout(pollT); clearTimeout(planT); S = null; };
  window.CreativeStage = { init: (h) => Object.assign(H, h), mount, html, click, input, state, reset, redo: () => go(true) };
})();
