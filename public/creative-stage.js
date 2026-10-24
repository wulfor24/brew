/* The creative stage in the v1 jam (Param, 23 Oct): a picture, a set or a video the card asks for is made by Brew Studio, right
   under the frame it will live in. Every slot arrives filled from what Brew already knows (the card, the Brand Book, the catalog,
   the reference the card is about), each with one line saying why, and every one can be changed. Nothing paid is made before the
   price is shown and Generate is pressed. The make runs on the server (jam2/studio.js through the card's Studio jam), so the
   person can leave: the take lands in the v1 jam as its next version and the Work tab says when it is ready.
   app.js owns the page; this keeps the composer's state per jam and asks app.js to repaint (init({ paint, landed, ... })). */
(() => {
  const H = {}; let S = null, LIB = null, SIZES = null, pollT = null, planT = null;
  const srcOf = (s) => (!s ? '' : /^(https?:|data:|blob:|\/)/.test(s) ? s : '/' + s);
  /* a price in the brand's own money, the dollar figure beside it (3.4: "prices in ₹"); rough rates, so "about" */
  const PER = { INR: 88, GBP: 0.75, EUR: 0.86, AUD: 1.52, CAD: 1.38, AED: 3.67, SGD: 1.29 }, CS = { INR: '₹', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$' };
  const usd = (n) => { if (n == null) return ''; if (H.money) return H.money(n); /* one money format on the page: the ship bar's */ const M = window.BREW_MONEY || {}, c = M.cur, r = PER[c]; if (!r || !+n) return `$${(+n).toFixed(2)}`; const v = +n * r; return `about ${CS[c] || M.sym || ''}${v >= 100 ? Math.round(v).toLocaleString(M.locale || 'en-IN') : v.toFixed(v < 10 ? 1 : 0)} ($${(+n).toFixed(2)})`; };
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
    const [o, L, C] = await Promise.all([api('POST', '/api/jam2/open', { cardId: ch.cardId, cta: ch.studioLabel || card?.cta?.label || '', v1ch: ch.id, recipe: ch.studio }), LIB ? { library: LIB } : api('GET', '/api/jam2/studio/library'), SIZES ? { sizes: SIZES } : api('GET', '/api/jam2/catalogue')]);
    if (S !== mine) return; LIB = L?.library || LIB; SIZES = C?.sizes || SIZES;
    const jam = o?.jam, bd = jam?.boards?.[0];
    if (!jam || !bd) { S.loading = false; S.error = o?.error || 'The studio couldn’t open just now.'; return paint(); }
    const d = await api('GET', `/api/jam2/jams/${jam.id}/studio?bid=${encodeURIComponent(bd.id)}`); if (S !== mine) return;
    if (!d?.defaults) { S.loading = false; S.error = d?.error || 'The studio couldn’t open just now.'; return paint(); }
    /* a board already made opens on the set-up its newest take was made with, so Redo makes that again at its price */
    const made0 = (bd.takes || []).at(-1)?.studio?.spec || null, D = made0 ? { ...d.defaults, ...Object.fromEntries(Object.entries(made0).filter(([, v]) => v != null && v !== '')), count: 1, styles: d.defaults.styles?.includes(made0.style) || !made0.style ? d.defaults.styles : [made0.style, ...(d.defaults.styles || []).slice(0, 2)] } : d.defaults, X = d.context?.slots || {};
    Object.assign(S, { loading: false, jid: jam.id, bid: bd.id, boards: jam.boards.map((b) => b.id), products: d.products || [], slots: X, missing: d.context?.missing || [], blocked: D.blocked || {}, picks: D.styles || [],
      spec: { ...D, ask: D.ask || '', direction: D.direction || X.direction?.value || '', cast: D.cast || (X.cast?.shown && X.cast.value !== 'none' ? X.cast.label : X.cast?.value === 'none' ? 'No people' : null), ref: made0 ? made0.ref || null : X.reference?.value?.label || null, quality: D.quality || ((bd.takes || []).length ? 'standard' : 'preview') /* the first take is a cheap low-res preview of the idea (3.4); the full one comes after it looks right */ },
      prefs: d.prefs || {}, kept: d.kept || {}, brand: d.context?.slots?.brand ? (window.B?.brand?.name || '') : '', busy: jam.busy || {}, made: !!ch.versions?.some((v) => v.studio) /* made here: a Studio version in this v1 jam */, earlier: (bd.takes || []).filter((x) => x.file).slice(-3).reverse().map((x) => ({ id: x.id, file: x.studio?.kind === 'video' ? (x.cover || x.poster || x.file) : x.file, video: x.studio?.kind === 'video', label: x.studio?.label || 'A take', at: x.at })), failed: Object.values(jam.busy || {}).find((b) => b?.error)?.error || null }); /* a make that stopped says so after a reload too */
    S.open = !S.made; /* made already: the set-up folds into one line under the frame */
    paint(); price(); if (anyBusy()) poll();
  }
  const anyBusy = () => !!S && Object.values(S.busy || {}).some((b) => b && b.op && !b.error);
  function price() { clearTimeout(planT); if (!S?.spec) return; S.plan = null; paint(); const mine = S, spec = S.spec;
    planT = setTimeout(async () => { const r = await api('POST', `/api/jam2/jams/${mine.jid}/studio/plan`, { spec }); if (S === mine && S.spec === spec) { S.plan = r?.plan || { error: r?.error || 'No price yet.' }; paint(); } }, 250); }
  /* who is on camera changes in the direction too: its sentence about the old cast becomes the new one (never two that disagree) */
  const set = (patch) => { if ('cast' in patch && S.spec?.direction) { const was = S.spec.cast || S.slots?.cast?.label || '', now = patch.cast || '';
      if (was && S.spec.direction.includes(was)) patch = { ...patch, direction: S.spec.direction.replace(`${was}.`, now ? `${now}.` : '').replace(was, now).replace(/\s{2,}/g, ' ').trim() }; }
    S.spec = { ...S.spec, ...patch }; S.pop = null; price(); };

  async function go(redo = false) {
    const pl = S?.plan; if (!pl || pl.error || pl.usd == null || S.working) return; const mine = S; S.working = true; paint();
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/make`, { spec: S.spec, confirmUsd: pl.usd, bid: S.bid, redo: redo || S.made });
    if (S !== mine) return; S.working = false;
    if (r?.needsConfirm) { S.plan = r.plan; paint(); return H.toast?.(`The price changed to ${usd(r.plan.usd)}. Tap Generate again.`); }
    if (r?.error) { paint(); return H.toast?.(H.esc(r.error)); }
    S.boards = r.jam?.boards?.map((b) => b.id) || S.boards; S.busy = r.jam?.busy || {}; S.making = { line: r.plan.line, usd: r.plan.usd, at: Date.now(), n: (r.boards || []).length || 1, video: S.spec?.kind === 'video' }; S.open = false; S.failed = null;
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
      const was = S.making; S.making = null; S.made = S.made || !err; /* made here once a take of this press lands */ if (err) { S.failed = err.error; if (!slidesOf(H.ch?.() || {})?.length && !H.ch?.()?.versions?.some((v) => v.studio)) S.open = true; /* nothing made yet: the set-up stays open with the reason */ } else S.failed = null;
      window.BrewGame?.done?.(); /* a game open over the stage stops and says it's ready */
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
    if (k === 'ref') { const r = X.reference?.value; return `<div class="j2-pop cs-pop">${head(why('reference'))}${r?.video ? `<video class="cs-refimg" src="${H.esc(srcOf(r.video))}" ${r.img ? `poster="${H.esc(srcOf(r.img))}"` : ''} muted playsinline controls></video>${r.beats ? `<p class="cs-why">${r.beats} shots read from it: Recreate keeps them, a viral short follows them.</p>` : ''}` : r?.img ? `<img class="cs-refimg" src="${H.esc(srcOf(r.img))}" alt="">` : ''}${sp.ref ? '<button data-cs-ref="off">Don’t follow a reference</button>' : r ? '<button data-cs-ref="on">Follow it</button>' : ''}</div>`; }
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
    /* who is on camera: only for a style that shows people (a motion clip or a packshot has none) */
    const castOn = setIds ? (setIds.map(styleById).some((x) => x && x.people && !['none'].includes(x.people))) : !!st && !!st.people && st.people !== 'none';
    const early = !S.made && (S.earlier || []).length ? `<div class="cs-early"><small>Made earlier in Studio for this card · already paid for</small><div>${S.earlier.map((x) => `<figure><img src="${H.esc(srcOf(x.file))}" alt=""><figcaption><b>${H.esc(x.label)}</b>${x.video ? 'Video' : 'Picture'}</figcaption><button class="j2-chip" data-cs-land="${H.esc(x.id)}">Use it</button></figure>`).join('')}</div></div>` : '';
    return `<div class="j2-studio cs">${S.gallery ? gallery() : ''}${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}${early}
      <div class="j2-st-top">${setIds && LISTING.has(S.recipe) ? `<div class="j2-seg"><button data-cs-mk="listing" class="${isAplus(setIds) ? '' : 'on'}">Listing images</button><button data-cs-mk="aplus" class="${isAplus(setIds) ? 'on' : ''}">Amazon A+</button></div><b>${setIds.length} ${isAplus(setIds) ? 'modules' : 'images'}</b>` : setIds ? `<b>${setIds.length} slides</b>` : `<div class="j2-seg"><button data-cs-kind="image" class="${kind === 'image' ? 'on' : ''}">Image</button><button data-cs-kind="video" class="${kind === 'video' ? 'on' : ''}">Video</button></div>`}<span class="j2-st-hint">${H.ic?.('sparkles', 's14') || ''}Filled in by Brew from the card and your Brand Book · change anything</span></div>
      <p class="cs-why cs-why-top">${H.esc(why('style'))}</p>
      <div class="j2-st-styles">${shown.map(tile).join('')}<button class="j2-sti more" data-cs-gal><span class="j2-sti-art">＋</span><b>Browse templates</b><small>${total} in all</small></button></div>
      <div class="cs-slots">
        ${chip('product', 'Product', sp.product?.name ? sp.product.name.slice(0, 30) : 'No product', sp.product?.img ? `<img src="${H.esc(srcOf(sp.product.img))}" alt="">` : '')}
        ${castOn ? chip('cast', 'On camera', sp.cast || X.cast?.label || 'Anyone') : ''}
        ${X.reference?.value ? chip('ref', 'Reference', sp.ref ? X.reference.value.label : 'Not used', X.reference.value.img && sp.ref ? `<img src="${H.esc(srcOf(X.reference.value.img))}" alt="">` : '') : ''}
        ${chip('brand', 'Brand kit', X.brand?.value?.logo ? 'Logo, colours, tone' : 'Colours, tone', (X.brand?.value?.colors || []).slice(0, 3).map((c) => `<i class="cs-dot" style="background:${H.esc(c)}"></i>`).join(''))}
        ${chip('size', 'Size', SIZES?.[sp.sizes?.[0]]?.label || sp.sizes?.[0] || 'Size')}
        ${kind === 'video' && st?.job === 'video-restyle' ? '<div class="cs-slot"><small>Length</small><span class="cs-why">As long as the reference</span></div>' : kind === 'video' ? `<div class="cs-slot"><small>Length</small><div class="j2-seg">${(st?.job === 'viral-short' ? [15, 20, 30] : [5, 10, 15]).map((n) => `<button data-cs-sec="${n}" class="${+sp.seconds === n ? 'on' : ''}">${n} s</button>`).join('')}</div></div>` : ''}
        ${setIds ? '' : `<div class="cs-slot"><small>How many</small><div class="j2-count"><button data-cs-count="-1" aria-label="Fewer">−</button><b>${sp.count}</b><button data-cs-count="1" aria-label="More">+</button></div></div>`}
        <div class="cs-slot"><small>Quality</small><div class="j2-seg">${[['preview', 'Preview'], ['standard', 'Standard'], ['premium', 'Premium']].map(([k, n]) => `<button data-cs-q="${k}" class="${(sp.quality || 'standard') === k ? 'on' : ''}" title="${H.esc(k === 'premium' ? '4K, for print and big screens' : k === 'preview' ? 'A quick, low-res look at the idea at about a third of the price: make the full one once it looks right' : why('quality'))}">${n}</button>`).join('')}</div></div>
        ${S.pop ? popHtml(S.pop) : ''}
      </div>
      <label class="cs-dir"><small>Direction <span>${H.esc(why('direction'))}</span></small><textarea id="cs-dir" rows="3">${H.esc(sp.direction || '')}</textarea></label>
      ${(S.missing || []).map((m) => `<p class="j2-st-note">${H.esc(m.text)}${m.go === 'brand' ? ` <button class="linkbtn" data-cs-brand>${H.esc(m.fix)}</button>` : ''}</p>`).join('')}${pl?.note ? `<p class="j2-st-note">${H.esc(pl.note)}</p>` : ''}
      ${look()}
      <div class="j2-st-go"><span>${pl ? H.esc(pl.error || pl.line) : 'Pricing it…'}</span>${setIds ? '' : `<button class="j2-chip" data-cs-look ${S.looking ? 'disabled' : ''} title="Brew’s words on your real product photo${kind === 'video' ? ', with the shot list' : ''}. No picture or video is made, so it costs nothing">${S.looking ? 'Sketching…' : S.look ? 'Another first look · free' : 'First look · free'}</button>`}<button class="j2-pri" data-cs-go ${!pl || pl.error || S.working ? 'disabled' : ''}>${S.working ? 'Starting…' : `Generate${pl?.usd != null ? ` · ${usd(pl.usd)}` : ''}`}</button></div>
      ${st && !setIds ? '' : ''}</div>`;
  }
  /* the free first look (3.4): Brew's words over the real product photo and, for a video, the shots; made before anything is paid */
  const look = () => { const L = S.look; if (!L) return ''; if (L.error) return `<p class="j2-err">${H.esc(L.error)}</p>`;
    return `<div class="cs-look"><small>First look · free · words and layout only; Generate makes the real ${L.shots?.length ? 'video' : 'picture'}</small><div class="cs-look-row">${L.file ? `<img src="${H.esc(srcOf(L.file))}" alt="First look">` : ''}<div>${L.headline ? `<b>${H.esc(L.headline)}</b>` : ''}${L.sub ? `<p>${H.esc(L.sub)}</p>` : ''}${L.shots?.length ? `<ol>${L.shots.map((x) => `<li><span>${x.sec} s</span> ${H.esc(x.see)}${x.vo ? `<em>“${H.esc(x.vo)}”</em>` : ''}</li>`).join('')}</ol>` : ''}${L.flags?.length ? `<p class="j2-st-note">Needs a source before it runs: ${H.esc(L.flags.join(', '))}. Brew’s check will ask for it, or change the words.</p>` : ''}</div></div></div>`; };
  async function sketch() { if (!S?.spec || S.looking) return; const mine = S; S.looking = true; paint();
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/sketch`, { spec: S.spec }); if (S !== mine) return; S.looking = false;
    S.look = r?.sketch || { error: r?.error || 'The first look didn’t come out. Try again.' }; paint(); }
  /* the stage's composer: the whole set-up, a line while it is being made, or one line under a made take */
  function html(ch) {
    if (!S || S.chId !== ch.id || S.loading) return `<div class="j2-studio cs"><p class="cs-wait"><brew-load class="spin"></brew-load> Setting it up from the card…</p></div>`;
    if (S.error) return `<div class="j2-studio cs"><p class="j2-err">${H.esc(S.error)}</p><button class="j2-pri" data-cs-retry>Try again</button></div>`;
    if (S.making || anyBusy()) { const m = S.making; return `<div class="j2-studio cs cs-making"><p><brew-load class="spin"></brew-load><b>Making ${H.esc(m?.line || 'it')}</b>${m?.usd != null ? ` · ${usd(m.usd)}` : ''}</p><p class="cs-why">You can leave this page: it lands here and in Work when it’s ready, and Brew tells you.</p><div class="cs-acts"><button class="j2-chip" data-cs-feed>Back to the feed</button><button class="j2-chip" data-cs-game>Play while it brews</button></div></div>`; }
    const sl = slidesOf(ch);
    /* a batch (How many above 1): every take of the newest run in one strip; tap one to look at it, Use it keeps it on the stage */
    const head0 = ch.versions?.find((v) => v.id === ch.head)?.studio, run = [...(ch.versions || [])].reverse().find((v) => v.studio?.run)?.studio?.run, batch = run ? (ch.versions || []).filter((v) => v.studio?.run === run) : [];
    const batchHtml = batch.length > 1 ? `<div class="cs-batch"><small>${batch.length}${batch[0].studio.runN > batch.length ? ` of ${batch[0].studio.runN}` : ''} made in one go · tap one to put it on the stage; the others stay in History</small><div class="cs-strip">${batch.map((v) => { const s0 = v.snapshot || {}; return `<button class="${(H.viewing?.() || ch.head) === v.id ? 'on' : ''}${v.passed ? ' is-drop' : ''}" data-v-view="${H.esc(v.id)}" title="v${v.n}"><img src="${H.esc(srcOf(s0.poster || s0.image || ''))}" alt=""><span>${v.n}</span></button>`; }).join('')}</div></div>` : '';
    /* Redo the set makes the set as it is now (after a drop or an add), so its price follows the slides on the stage */
    if (sl?.length > 1 && Array.isArray(S.spec?.set) && sl.map((x) => x.style).join() !== S.spec.set.join() && !S.making && !S.open) { S.spec = { ...S.spec, set: sl.map((x) => x.style) }; S.sel = Math.min(S.sel || 0, sl.length - 1); setTimeout(price, 0); }
    if (!S.open && sl?.length > 1) { const i = Math.min(S.sel || 0, sl.length - 1), cur = sl[i], st = styleById(cur.style); slidePrice(cur.style); const sp = S.slidePlan?.[cur.style];
      return `${batchHtml}<div class="cs-line cs-set">${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}${S.gallery && S.adding ? `<div class="j2-studio cs cs-addgal">${gallery()}</div>` : ''}
        <div class="cs-strip">${sl.map((x, k) => `<button class="${k === i ? 'on' : ''}" data-cs-sel="${k}" title="${H.esc(styleById(x.style)?.label || '')}"><img src="${H.esc(srcOf(x.file))}" alt=""><span>${k + 1}</span></button>`).join('')}<button class="cs-add" data-cs-addslide title="Add a slide">＋</button></div>
        ${S.adding && S.addStyle ? (() => { const ap = S.slidePlan?.[S.addStyle]; return `<div class="cs-acts cs-addrow"><span>Add a slide: ${H.esc(styleById(S.addStyle)?.label || '')}</span><button class="j2-pri" data-cs-addgo ${!ap || ap.error || S.working ? 'disabled' : ''}>${ap?.error ? H.esc(ap.error) : `Add this slide${ap?.usd != null ? ` · ${usd(ap.usd)}` : ''}`}</button><button class="j2-chip" data-cs-addx>Cancel</button></div>`; })() : ''}
        <div class="cs-acts"><span>Slide ${i + 1} of ${sl.length}${st ? ` · ${H.esc(st.label)}` : ''}</span><button class="j2-chip" data-cs-slide="redo" ${!sp || sp.error ? 'disabled' : ''}>Redo this slide${sp?.usd != null ? ` · ${usd(sp.usd)}` : ''}</button><button class="j2-chip" data-cs-slide="drop" ${sl.length <= 2 ? 'disabled title="A set needs at least two slides"' : ''}>Drop it</button><button class="j2-chip" data-cs-open>Change the set-up</button><button class="j2-pri" data-cs-redo ${!S.plan || S.plan.error ? 'disabled' : ''}>Redo the set${S.plan?.usd != null ? ` · ${usd(S.plan.usd)}` : ''}</button></div></div>`; }
    if (!S.open) return `${batchHtml}<div class="cs-line">${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}<span>${H.esc(S.plan?.line || 'Made by Brew Studio')}</span><button class="j2-chip" data-cs-open>Change the set-up</button><button class="j2-pri" data-cs-redo ${!S.plan || S.plan.error ? 'disabled' : ''}>Redo it${S.plan?.usd != null ? ` · ${usd(S.plan.usd)}` : ''}</button></div>`;
    return full();
  }
  /* clicks on the composer: true when handled */
  function click(e) {
    const g = (sel) => e.target.closest(sel); if (!S || !g('.cs, .cs-line, [data-cs-open], .cs-adjust')) return false; const sp = S.spec;
    if (g('[data-cs-retry]')) { const id = S.chId; S = null; H.paint?.(); H.remount?.(id); return true; }
    if (g('[data-cs-feed]')) { H.toFeed?.(); return true; }
    if (g('[data-cs-game]')) { /* the game is loaded on the first tap only (brew-game.js), never before */
      const go2 = () => window.BrewGame?.open?.({ progress: () => (S?.making || (anyBusy() ? { line: 'your creative', at: S?.makingAt } : null)), brand: S?.slots?.brand?.value?.colors || [], onSee: () => H.paint?.() });
      if (window.BrewGame) go2(); else { const sc = document.createElement('script'); sc.src = '/brew-game.js'; sc.onload = go2; sc.onerror = () => H.toast?.('The game didn’t load. Your creative keeps being made.'); document.head.appendChild(sc); } return true; }
    const rm = e.target.closest('[data-cs-remember],[data-cs-forget]'); if (rm && S?.spec) { remember(rm.dataset.csRemember || rm.dataset.csForget, rm, !!rm.dataset.csForget); return true; }
    if (g('[data-cs-open]')) { S.open = true; paint(); setTimeout(() => document.querySelector('.cs-stage .cs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); return true; }
    if (g('[data-cs-redo]')) { go(true); return true; }
    const ld = g('[data-cs-land]'); if (ld) { const mine = S; api('POST', `/api/jam2/jams/${S.jid}/studio/land`, { bid: S.bid, takeId: ld.dataset.csLand }).then((r) => { if (S !== mine) return; if (r?.error) return H.toast?.(H.esc(r.error)); S.made = true; S.open = false; H.landed?.(S.chId, {}); }); return true; }
    const sel = g('[data-cs-sel]'); if (sel) { S.sel = +sel.dataset.csSel; paint(); /* the frame swipes to the slide picked */
      requestAnimationFrame(() => toSel(true)); return true; }
    if (g('[data-cs-addslide]')) { S.adding = true; S.gallery = true; paint(); return true; }
    const so = g('[data-cs-slide]'); if (so) { const sl = slidesOf(H.ch?.() || {}) || []; const i = Math.min(S.sel || 0, sl.length - 1); slideOp(so.dataset.csSlide, i, sl[i]?.style); return true; }
    if (g('[data-cs-go]')) { go(false); return true; }
    if (g('[data-cs-look]')) { sketch(); return true; }
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
  /* the frame shows the slide picked in the strip, through every repaint (a price coming back redraws the stage) */
  const toSel = (smooth = false) => { if (!S?.sel) return; const sw = document.querySelector('.cs-frame .as-swipe'), it = sw?.children?.[S.sel]; if (sw && it) sw.scrollTo({ left: it.offsetLeft - sw.children[0].offsetLeft, behavior: smooth ? 'smooth' : 'auto' }); };
  /* the chat, on a set-up not made yet: the words become slot changes (server: studio/ask), shown as changed chips, re-priced */
  async function ask(text) { if (!S?.jid || !S.spec) return { error: 'The set-up is still opening.' };
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/ask`, { text, spec: S.spec }); if (r?.error || !r?.patch) return { error: r?.error || 'That didn’t go through.' };
    const { addDirection, ...pt } = r.patch; if ('cast' in pt) { set({ cast: pt.cast }); delete pt.cast; } if (addDirection) pt.direction = [S.spec.direction, addDirection].filter(Boolean).join(' ');
    if (pt.style && !S.picks.includes(pt.style)) S.picks = [pt.style, ...S.picks.slice(0, 2)]; S.changed = Object.keys(pt); S.open = true; set(pt); return { said: r.said }; }
  /* the Adjust tab on a creative: every slot, what it is now, why, and "Always use this for <brand>" */
  function adjustHtml(ch) { if (!S || S.chId !== ch.id || !S.spec) return '<p class="hs-tip">Setting it up from the card…</p>';
    const sp = S.spec, X = S.slots || {}, kind = sp.kind === 'video' ? 'video' : 'image', st = styleById(sp.style), bn = (window.LIVE?.brand?.name || document.title.split(' · ')[0] || 'this brand');
    const pr = S.prefs || {}, row = (label, value, why, rem) => `<div class="cs-adj"><small>${H.esc(label)}</small><b>${H.esc(value || '—')}</b>${why ? `<p class="cs-why">${H.esc(why)}</p>` : ''}${rem || ''}</div>`;
    const remBtn = (slot, value, saved, extra = '') => value == null || value === '' ? '' : saved ? `<span class="cs-saved">Always used for ${H.esc(bn)} · <button class="linkbtn" data-cs-forget="${slot}"${extra}>Stop</button></span>` : `<button class="linkbtn" data-cs-remember="${slot}"${extra}>Always use this for ${H.esc(bn)}</button>`;
    return `<div class="cs-adjust"><p class="hs-tip">Everything Brew set up for this piece, and why. Change any of it on the stage; save the ones you always want.</p>
      ${row('Style', Array.isArray(sp.set) ? `${sp.set.length} slides` : st?.label, why('style'))}
      ${row('Product', sp.product?.name, why('products'), sp.product?.img ? remBtn('product', sp.product.img, pr.photos?.[sp.product.name] === sp.product.img, ` data-name="${H.esc(sp.product.name || '')}"`) : '')}
      ${st?.people && st.people !== 'none' || Array.isArray(sp.set) ? row('On camera', sp.cast || X.cast?.label, why('cast'), remBtn('cast', sp.cast || X.cast?.label, pr.cast && pr.cast === (sp.cast || X.cast?.label))) : ''}
      ${row('Size', SIZES?.[sp.sizes?.[0]]?.label || sp.sizes?.[0], why('size'), remBtn('size', sp.sizes?.[0], pr.size?.[kind] === sp.sizes?.[0], ` data-kind="${kind}"`))}
      ${row('Quality', { preview: 'Preview', standard: 'Standard', premium: 'Premium (4K)' }[sp.quality || 'standard'], why('quality'), remBtn('quality', sp.quality || 'standard', (pr.quality || 'standard') === (sp.quality || 'standard') && !!pr.quality))}
      ${row('Reference', sp.ref || 'None', why('reference'))}
      ${row('Direction', (sp.direction || '').slice(0, 220), 'What the maker reads. Change it on the stage, or tell me in the chat.')}
      <button class="btn btn-ghost sm" data-cs-open>${S.made ? 'Change the set-up and make it again' : 'Go to the set-up'}</button></div>`; }
  async function remember(slot, el, off = false) { const sp = S.spec, kind = el.dataset.kind || (sp.kind === 'video' ? 'video' : 'image');
    const value = off ? null : slot === 'product' ? sp.product?.img : slot === 'cast' ? sp.cast || S.slots?.cast?.label : slot === 'size' ? sp.sizes?.[0] : slot === 'quality' ? sp.quality || 'standard' : null;
    const r = await api('POST', '/api/jam2/studio/remember', { slot, value, kind, name: el.dataset.name || sp.product?.name || '' }); if (r?.error) return H.toast?.(H.esc(r.error));
    S.prefs = r.prefs || S.prefs; H.toast?.(off ? 'Brew won’t always use that any more.' : 'Saved: Brew uses this for every new piece. Change it any time here or in your Brand Book.'); paint(); }
  const state = (id) => (S && S.chId === id ? { loading: !!S.loading, making: !!(S.making || anyBusy()), made: !!S.made, open: !!S.open, plan: S.plan, productImg: S.spec?.product?.img || null } : null);
  const reset = () => { clearTimeout(pollT); clearTimeout(planT); S = null; };
  window.CreativeStage = { init: (h) => Object.assign(H, h), mount, html, click, input, state, reset, redo: () => go(true), afterPaint: () => toSel(false), ask, adjustHtml };
})();
