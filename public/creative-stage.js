/* The creative stage in the v1 jam (Param, 23 Oct): a picture, a set or a video the card asks for is made by Brew Studio, right
   under the frame it will live in. Every slot arrives filled from what Brew already knows (the card, the Brand Book, the catalog,
   the reference the card is about), each with one line saying why, and every one can be changed. Nothing paid is made before the
   price is shown and Make it is pressed on the bar. The make runs on the server (jam2/studio.js through the card's Studio jam), so the
   person can leave: the take lands in the v1 jam as its next version and the Work tab says when it is ready.
   app.js owns the page; this keeps the composer's state per jam and asks app.js to repaint (init({ paint, landed, ... })). */
(() => {
  const H = {}; let S = null, LIB = null, SIZES = null, pollT = null, planT = null;
  const srcOf = (s) => (!s ? '' : /^(https?:|data:|blob:|\/)/.test(s) ? s : '/' + s);
  /* a price in the brand's own money, the dollar figure beside it (3.4: "prices in ₹"); rough rates, so "about" */
  const PER = { INR: 88, GBP: 0.75, EUR: 0.86, AUD: 1.52, CAD: 1.38, AED: 3.67, SGD: 1.29 }, CS = { INR: '₹', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$', AED: 'AED ', SGD: 'S$' };
  const PARTNER = () => window.LIVE?.makeMode === 'partner'; /* free for initial partners (make-mode.js): no prices, our team makes the paid parts */
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
    if (!S.made) S.spec = { ...S.spec, ...loadPick() }; /* what was picked here before a reload */
    if (!S.made) follow(ch, false); /* the jam's own product and size win over this panel's defaults */
    S.open = !S.made; /* made already: the set-up folds into one line under the frame */
    paint(); price(); if (anyBusy()) poll();
  }
  /* the jam moved (a product or a size said in the chat, picked on the stage, or set on another device): the set-up follows it,
     unless a make is running or this one is already made (Redo makes what was made) */
  function follow(ch, repaint = true) { if (!S?.spec || !ch || S.making || S.working || Date.now() - (S.syncAt || 0) < 8000 /* our own pick is on its way to the jam */) return false; let moved = false;
    const pn = ch.product?.name; if (pn && pn !== S.spec.product?.name) { const tile = (S.products || []).find((x) => x.name === pn); S.spec = { ...S.spec, product: { ...(S.spec.product || {}), ...(tile || {}), name: pn, img: tile?.img || ch.product.img || S.spec.product?.img || null } }; moved = true; }
    const r = ['meta_ad', 'social'].includes(ch.family) ? ch.pkg?.format : null, cur = S.spec.sizes?.[0] ? SIZES?.[S.spec.sizes[0]]?.ratio : null;
    if (r && cur && r !== cur && S.spec.kind !== 'video') { const id = [...(SIZE_OPTS.image || []), ...Object.keys(SIZES || {})].find((k) => SIZES?.[k]?.ratio === r); if (id) { S.spec = { ...S.spec, sizes: [id] }; moved = true; } }
    if (moved && repaint) price(); return moved; }
  const anyBusy = () => !!S && Object.values(S.busy || {}).some((b) => b && b.op && !b.error);
  function price() { clearTimeout(planT); if (!S?.spec) return; S.plan = null; paint(); const mine = S, spec = S.spec;
    planT = setTimeout(async () => { const r = await api('POST', `/api/jam2/jams/${mine.jid}/studio/plan`, { spec }); if (S === mine && S.spec === spec) { S.plan = r?.plan || { error: r?.error || 'No price yet.' }; paint(); } }, 250); }
  /* who is on camera changes in the direction too: its sentence about the old cast becomes the new one (never two that disagree) */
  const set = (patch) => { if ('cast' in patch && S.spec?.direction) { const was = S.spec.cast || S.slots?.cast?.label || '', now = patch.cast || '';
      if (was && S.spec.direction.includes(was)) patch = { ...patch, direction: S.spec.direction.replace(`${was}.`, now ? `${now}.` : '').replace(was, now).replace(/\s{2,}/g, ' ').trim() }; }
    /* the product and the size are the jam's, not this panel's: saved on the jam, so every part of the page says the same. The guard
       goes up before the repaint below: that repaint follows the jam, which still holds the old pick until the server answers (27 Oct:
       picking the Hug Hoodie snapped the set-up back to the Paw Warmer) */
    const fmt = patch.sizes?.[0] ? SIZES?.[patch.sizes[0]]?.ratio : null; if (patch.product?.name || fmt) S.syncAt = Date.now();
    S.spec = { ...S.spec, ...patch }; S.pop = null; savePick(); price(); relook();
    if (patch.product?.name || fmt) H.setup?.(S.chId, { ...(patch.product?.name ? { product: { name: patch.product.name, img: patch.product.img || null } } : {}), ...(fmt ? { format: fmt } : {}) }); };
  /* the set-up picked stays picked through a reload (26 Oct: a Story size went back to Feed): kept in this browser per jam, and
     brought back only when every pick is still offered (a style taken away or a size gone drops them all, never half a set-up) */
  const PICK_KEYS = ['kind', 'sizes', 'style', 'quality', 'count', 'seconds'];
  const savePick = () => { try { if (S?.chId && S.spec) localStorage.setItem(`cs-pick:${S.chId}`, JSON.stringify(Object.fromEntries(PICK_KEYS.filter((k) => S.spec[k] != null).map((k) => [k, S.spec[k]])))); } catch {} };
  const loadPick = () => { try { const x = JSON.parse(localStorage.getItem(`cs-pick:${S.chId}`) || 'null'); if (!x || typeof x !== 'object') return {};
    const ok = Object.entries(x).every(([k, v]) => k === 'sizes' ? Array.isArray(v) && v.length && v.every((id) => SIZES?.[id]) : k === 'style' ? !!styleById(v) && !S.blocked?.[v] : PICK_KEYS.includes(k));
    return ok ? x : {}; } catch { return {}; } };

  async function go(redo = false) {
    const pl = S?.plan; if (!pl || pl.error || pl.usd == null || S.working || S.making || anyBusy()) return; /* one paid make at a time, whichever button asked */ const mine = S; S.working = true; paint();
    /* one key per press: the server runs a press once, and one make per board, whichever instance or tab sent it (make-claim.js) */
    const press = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/make`, { spec: S.spec, confirmUsd: pl.usd, bid: S.bid, redo: redo || S.made, press });
    if (S !== mine) return; S.working = false;
    if (r?.needsConfirm) { S.plan = r.plan; paint(); return H.toast?.(`The price changed to ${usd(r.plan.usd)}. Tap Make it again.`); }
    if (r?.error) { paint(); return H.toast?.(H.esc(r.error)); }
    S.boards = r.jam?.boards?.map((b) => b.id) || S.boards; S.busy = r.jam?.busy || {}; S.making = { line: r.plan.line, usd: r.plan.usd, at: Date.now(), n: (r.boards || []).length || 1, video: S.spec?.kind === 'video' }; S.open = false; S.failed = null;
    H.making?.(S.chId, S.making); paint(); poll();
  }
  /* a quick preview made: the full one is the same set-up at standard quality, priced first (the bar's Make the full one) */
  function fullPrice() { if (!S || S.loading) return null; /* still opening: priced in a moment */ if (S.error) return { error: S.error }; if (!S.spec || !S.jid) return { error: 'The studio isn’t open for this piece yet: open the Set-up tab.' }; if (S.spec.quality !== 'preview') return { error: 'This version is already the full one.' }; const spec = { ...S.spec, quality: 'standard' }, key = JSON.stringify(spec);
    if (S.full?.key === key) return S.full.plan; S.full = { key, plan: null }; const mine = S;
    api('POST', `/api/jam2/jams/${S.jid}/studio/plan`, { spec }).then((r) => { if (S === mine && S.full?.key === key) { S.full.plan = r?.plan || { error: r?.error || 'No price yet.' }; paint(); } }); return null; }
  function makeFull() { const pl = fullPrice(); if (!pl || pl.error || pl.usd == null || S.working) return; S.spec = { ...S.spec, quality: 'standard' }; S.plan = pl; S.full = null; go(true); }
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
  /* a slot's picker opens right under its own chip (25 Oct: in the one-column panel it opened under Quality, out of sight) */
  const chip = (k, label, value, extra = '') => `<div class="cs-slot"><small>${H.esc(label)}</small><button class="j2-chip cs-chip${S.pop === k ? ' on' : ''}" data-cs-pop="${k}"${why(k) ? ` data-tip="${H.esc(why(k))}"` : ''}>${extra}<span>${H.esc(value)}</span></button></div>${S.pop === k ? popHtml(k) : ''}`;
  /* "An AI person who fits your buyer: The Hair-Fall Switcher" reads as the buyer first; the whole line stays in the picker */
  const castShort = (v) => { const m = /^(An AI person[^:]*):\s*(.+)$/i.exec(String(v || '')); return m ? `${m[2]} · AI person` : v; };
  const wideOn = () => !!document.querySelector('.st-body.is-wide');
  /* a tile shows its style before anything is paid: the product photo dressed as the style (a colour backdrop, white, a surface,
     a person or hands in it), and the look in a few words. A template's cover is another brand's example, and says so */
  const treat = (x) => (x.id === 'color-pop' ? 'pop' : x.id === 'studio-white' ? 'white' : /^(natural|flat-lay)$/.test(x.id) ? 'tex' : x.people === 'hands' ? 'hands' : ['person', 'any'].includes(x.people) ? 'person' : 'plain');
  const shortLook = (t) => { const parts = String(t || '').split(/(?<=[,:.;])\s+/); let w = ''; for (const x of parts) { w = `${w} ${x}`.trim(); if (w.split(/\s+/).length >= 4) break; } /* a whole phrase of four words or more: "A tight, joyful closeup", never "A tight" */
    w = w.replace(/[,:;.]$/, ''); return w.length > 52 ? `${w.slice(0, 50).replace(/\s+\S*$/, '')}…` : w; };
  const tile = (x) => { const on = Array.isArray(S.spec.set) ? S.spec.set.includes(x.id) : x.id === S.spec.style, no = S.blocked?.[x.id], pic = x.example || x.cover, ph = S.spec.product?.img;
    const art = pic ? `<span class="cs-pic"><img src="${H.esc(pic)}" alt="" loading="lazy"></span>` : ph ? `<span class="cs-pic is-own"><img src="${H.esc(srcOf(ph))}" alt="" loading="lazy"></span>` : `<span class="cs-pic is-none">${H.esc(x.label)}</span>`;
    const sub = x.cover ? `${x.group || 'Template'} layout` : shortLook(x.look) || x.group || '';
    return `<button class="j2-sti${on ? ' on' : ''}${no ? ' no' : ''}" data-cs-style="${H.esc(x.id)}" aria-pressed="${on}" data-tip="${H.esc(no || (x.cover ? 'A template made for another brand; yours uses your product, words and colours.' : x.look || x.label))}">${art}${on ? `<i class="cs-on">${Array.isArray(S.spec.set) ? S.spec.set.indexOf(x.id) + 1 : '✓'}</i>` : ''}<b>${H.esc(x.label)}</b><small>${H.esc(sub)}</small></button>`; };
  function popHtml(k) {
    const sp = S.spec, X = S.slots || {}, head = (t) => `<p class="cs-why">${H.esc(t)}</p>`;
    if (k === 'product') { /* one row per product: its photo, its whole name, and what tells look-alikes apart (size, price, sold out); the
         name the family shares is said once above them, so "Oil-Control Face Wash …" ×4 reads as 100 ml · Pack of 2 · … (Param, 26 Oct) */
      const q = (S.pq || '').toLowerCase().trim(), cur = sp.product || {}, isCur = (p) => (cur.name && p.name === cur.name) || (!cur.name && p.img === cur.img);
      const list = S.products.map((p, i) => ({ p, i })).filter(({ p }) => !q || String(p.name || '').toLowerCase().includes(q)).sort((a, b) => isCur(b.p) - isCur(a.p) || !!a.p.out - !!b.p.out);
      const SZ = /\s*[-–—|(,]\s*(?=(?:\d|pack|set|combo|kit|mini|trial)).*$/i, fam = (n) => String(n || '').replace(SZ, '').trim(), rest = (n) => { const f = fam(n); return String(n || '').slice(f.length).replace(/^[\s\-–—|(,]+|\)$/g, '').trim(); };
      const price = (v) => (v == null || v === '' ? '' : /[^\d.,\s]/.test(String(v)) ? String(v) : `₹${Math.round(+String(v).replace(/,/g, '')).toLocaleString('en-IN')}`);
      const row = ({ p, i }) => { const r = rest(p.name), sub = [r && r !== p.name ? r : '', price(p.price), p.out ? 'Sold out' : ''].filter(Boolean).join(' · ');
        return `<button type="button" role="option" class="cs-prow${isCur(p) ? ' on' : ''}${p.out ? ' is-out' : ''}" data-cs-prod="${i}" data-cs-pname="${H.esc(p.name || '')}" data-cs-pimg="${H.esc(p.img || '')}" aria-selected="${isCur(p)}" title="${H.esc(p.name || '')}"><span class="cs-pth"><img src="${H.esc(srcOf(p.img))}" alt="" loading="lazy"></span><span class="cs-ptx"><b>${H.esc(p.name || 'This product')}</b>${sub ? `<small>${H.esc(sub)}</small>` : ''}</span>${isCur(p) ? '<i class="cs-pck" aria-hidden="true">✓</i>' : ''}</button>`; };
      return `<div class="j2-pop cs-pop cs-prods">${head(why('products'))}${S.products.length > 6 ? `<input id="cs-pq" class="cs-search" type="search" placeholder="Search ${S.products.length} products" value="${H.esc(S.pq || '')}" autocomplete="off" aria-label="Search products">` : ''}<div class="cs-plist" role="listbox" aria-label="Products">${list.map(row).join('') || (q ? '<p class="cs-why">No product by that name.</p>' : '<p class="cs-why">No product photos yet. Add them in your Brand Book.</p>')}</div></div>`; }
    if (k === 'cast') return `<div class="j2-pop cs-pop">${head(why('cast'))}${(X.cast?.options || []).map((o) => `<button data-cs-cast="${H.esc(o.id)}" class="${(sp.cast || '') === (o.id === 'none' ? 'No people' : o.label) ? 'on' : ''}">${o.img ? `<img src="${H.esc(srcOf(o.img))}" alt="">` : ''}${H.esc(o.label)}</button>`).join('')}</div>`;
    if (k === 'ref') { const r = X.reference?.value; return `<div class="j2-pop cs-pop">${head(why('reference'))}${r?.video ? `<video class="cs-refimg" src="${H.esc(srcOf(r.video))}" ${r.img ? `poster="${H.esc(srcOf(r.img))}"` : ''} muted playsinline controls></video>${r.beats ? `<p class="cs-why">${r.beats} shots read from it: Recreate keeps them, a viral short follows them.</p>` : ''}` : r?.img ? `<img class="cs-refimg" src="${H.esc(srcOf(r.img))}" alt="">` : ''}${sp.ref ? '<button data-cs-ref="off">Don’t follow a reference</button>' : r ? '<button data-cs-ref="on">Follow it</button>' : ''}</div>`; }
    if (k === 'brand') { const b = X.brand?.value || {}; return `<div class="j2-pop cs-pop">${head(why('brand'))}<div class="cs-kit">${b.logo ? `<img src="${H.esc(srcOf(b.logo))}" alt="Logo">` : '<span>No logo yet</span>'}${(b.colors || []).map((c) => `<i style="background:${H.esc(c)}" title="${H.esc(c)}"></i>`).join('')}</div>${b.tone ? `<p class="cs-why">Tone: ${H.esc(b.tone)}</p>` : ''}<button data-cs-brand>Change it in your Brand Book</button></div>`; }
    if (k === 'count') return `<div class="j2-pop cs-pop cs-pop-row">${head('How many to make at once. Each is priced; pick the one you like.')}<div class="cs-opts">${[1, 2, 3, 4, 6].map((n) => `<button data-cs-n="${n}" class="${(+sp.count || 1) === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
    if (k === 'sec') { const st = styleById(sp.style); return `<div class="j2-pop cs-pop cs-pop-row">${head('How long the video runs.')}<div class="cs-opts">${(st?.job === 'viral-short' ? [15, 20, 30] : [5, 10, 15]).map((n) => `<button data-cs-sec="${n}" class="${+sp.seconds === n ? 'on' : ''}">${n} s</button>`).join('')}</div></div>`; }
    if (k === 'quality') return `<div class="j2-pop cs-pop">${head('Start with a quick preview; make the full one once it looks right.')}${[['preview', 'A quick preview', 'Low resolution, about a third of the price'], ['standard', 'Full quality', 'Sharp for feeds and ads'], ['premium', '4K', 'For print and big screens']].map(([q, n, d]) => `<button data-cs-q="${q}" class="cs-opt-l${(sp.quality || 'standard') === q ? ' on' : ''}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>`;
    if (k === 'setn') return `<div class="j2-pop cs-pop">${head(`${(sp.set || []).length} pictures, one per style, in the order shown below. Tap a style to take it out; All styles adds more.`)}<button data-cs-gal class="cs-opt-l"><b>Add a style</b><small>From all styles</small></button></div>`;
    if (k === 'size') return `<div class="j2-pop cs-pop">${head(why('size'))}${SIZE_OPTS[sp.kind === 'video' ? 'video' : 'image'].map((s) => `<button data-cs-size="${s}" class="${s === sp.sizes?.[0] ? 'on' : ''}">${H.esc(SIZES?.[s]?.label || s)}</button>`).join('')}</div>`;
    return '';
  }
  function gallery() { const sp = S.spec, kind = sp.kind === 'video' ? 'video' : 'image', gs = groups().filter((g) => g.kind === kind), g = gs.find((x) => x.id === S.group) || gs[0], q = (S.q || '').toLowerCase();
    const list = q ? gs.flatMap((x) => x.styles.map((y) => ({ ...y, group: y.group || x.label }))).filter((y) => `${y.label} ${y.group}`.toLowerCase().includes(q)) : (g?.styles || []).map((y) => ({ ...y, group: y.group || g.label }));
    return `<div class="j2-stgal"><div class="cs-galhead"><b>${kind === 'video' ? 'Video styles' : 'Templates'}</b><button class="cs-galx" data-cs-galx>Done</button></div><div class="j2-stgal-side">${gs.map((x) => `<button data-cs-grp="${H.esc(x.id)}" class="${x.id === g?.id ? 'on' : ''}">${H.esc(x.label)} <small>${x.styles.length}</small></button>`).join('')}</div>
      <div class="j2-stgal-main"><input id="cs-q" placeholder="Search templates" value="${H.esc(S.q || '')}"><div class="j2-stgrid">${list.map(tile).join('') || '<p>No template matches.</p>'}</div></div></div>`; }
  /* the set-up reads as one sentence (Param 25 Oct: "not fun, not quick to grasp"): "Make one In use picture of <product> with
     <who> for <size>, as a quick preview". Every underlined word is a choice; its picker opens under the sentence */
  const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const QN = { preview: 'a quick preview', standard: 'full quality', premium: '4K' };
  const tok = (k, text, extra = '') => `<button class="cs-tok${S.pop === k ? ' on' : ''}" data-cs-pop="${k}" aria-expanded="${S.pop === k}">${extra}<span>${H.esc(text)}</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const styleTok = (st) => `<button class="cs-tok" data-cs-gal><span>${H.esc(st?.label || 'a style')}</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  function sentence(sp, st, setIds, kind, castOn) {
    const X = S.slots || {}, size = SIZES?.[sp.sizes?.[0]]?.label || sp.sizes?.[0] || 'a size', prod = sp.product?.name || 'a product';
    const pimg = sp.product?.img ? `<img src="${H.esc(srcOf(sp.product.img))}" alt="">` : '';
    const who = castOn ? ` with ${tok('cast', castShort(sp.cast || X.cast?.label) || 'anyone')}` : '';
    const n = +sp.count || 1, many = n > 1;
    const what = setIds ? `a ${tok('setn', `${setIds.length}-${isAplus(setIds) ? 'module Amazon A+ page' : LISTING.has(S.recipe) ? 'image listing set' : 'slide set'}`)}`
      : kind === 'video' ? `${tok('count', NUM[n] || n)} ${st?.job === 'video-restyle' ? '' : tok('sec', `${sp.seconds || st?.seconds || 10}-second`)} ${styleTok(st)} video${many ? 's' : ''}`
      : `${tok('count', NUM[n] || n)} ${styleTok(st)} picture${many ? 's' : ''}`;
    return `<p class="cs-sent">Make ${what} of ${tok('product', prod, pimg)}${who} for ${tok('size', size)}, as ${tok('quality', QN[sp.quality || 'standard'])}.</p>`;
  }
  function full() {
    const sp = S.spec, X = S.slots || {}, setIds = Array.isArray(sp.set) ? sp.set : null, kind = sp.kind === 'video' ? 'video' : 'image';
    const shown = setIds ? setIds.map(styleById).filter(Boolean) : (() => { const picks = S.picks.map(styleById).filter((x) => x && x.kind === kind), cur = styleById(sp.style); return cur && !picks.some((x) => x.id === cur.id) ? [cur, ...picks.slice(0, 3)] : picks.slice(0, 4); })();
    const total = groups().filter((g) => g.kind === kind).reduce((a, g) => a + g.styles.length, 0), pl = S.plan, st = styleById(sp.style);
    /* who is on camera: only for a style that shows people (a motion clip or a packshot has none) */
    const castOn = setIds ? (setIds.map(styleById).some((x) => x && x.people && !['none'].includes(x.people))) : !!st && !!st.people && st.people !== 'none';
    const early = !S.made && (S.earlier || []).length ? `<div class="cs-early"><b>Already made for this card</b><div>${S.earlier.map((x) => `<figure><img src="${H.esc(srcOf(x.file))}" alt=""><figcaption>${H.esc(x.label)}</figcaption><button class="cs-ghost" data-cs-land="${H.esc(x.id)}">Use it · paid</button></figure>`).join('')}</div></div>` : '';
    if (S.gallery) return `<div class="j2-studio cs cs-galopen">${gallery()}</div>`; /* browsing templates takes the whole tab; ✕ comes back to the set-up */
    const acc = (X.brand?.value?.colors || []).find((c) => /^#[0-9a-f]{3,8}$/i.test(c)) || '';
    const sentKeys = ['product', 'cast', 'size', 'count', 'sec', 'quality', 'setn'];
    const mosaic = (() => { const cv = groups().filter((g) => g.kind === kind).flatMap((g) => g.styles).map((y) => y.example || y.cover).filter(Boolean).slice(0, 4); return cv.length === 4 ? `<span class="cs-mosaic">${cv.map((u) => `<img src="${H.esc(u)}" alt="" loading="lazy">`).join('')}</span>` : '<span class="cs-mosaic is-empty">＋</span>'; })();
    const more = S.more ?? wideOn();
    const refV = X.reference?.value, kit = X.brand?.value || {};
    const row = (k, label, value, extra = '') => `<button class="cs-row${S.pop === k ? ' on' : ''}" data-cs-pop="${k}"><span>${H.esc(label)}</span><b>${extra}${H.esc(value)}</b><svg viewBox="0 0 6 10" aria-hidden="true"><path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${S.pop === k ? popHtml(k) : ''}`;
    return `<div class="j2-studio cs cs-v2"${acc ? ` style="--acc:${acc}"` : ''}>${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}${early}
      <div class="cs-top">${setIds && LISTING.has(S.recipe) ? `<div class="j2-seg"><button data-cs-mk="listing" class="${isAplus(setIds) ? '' : 'on'}">Listing images</button><button data-cs-mk="aplus" class="${isAplus(setIds) ? 'on' : ''}">Amazon A+</button></div>` : setIds ? '' : `<div class="j2-seg"><button data-cs-kind="image" class="${kind === 'image' ? 'on' : ''}">Picture</button><button data-cs-kind="video" class="${kind === 'video' ? 'on' : ''}">Video</button></div>`}<span class="cs-hint">${H.ic?.('sparkles', 's14') || ''}We filled this in from the card</span></div>
      ${sentence(sp, st, setIds, kind, castOn)}
      ${S.pop && sentKeys.includes(S.pop) ? popHtml(S.pop) : ''}
      <p class="cs-because">${H.esc(setIds || !st || sp.style === S.slots?.style?.value ? why('style') : `${st.label}: ${String(st.look || st.group || '').replace(/[.\s]+$/, '')}.`)}</p>${''/* Brew's reason only for the style it picked; a style you picked says what it looks like */}
      <div class="cs-strip-h"><b>${setIds ? 'In the set' : 'Styles'}</b><span>${setIds ? 'Tap one to take it out, or add more from all styles' : 'Example pictures. Yours is made with your product.'}</span></div>
      <div class="cs-styles">${shown.map(tile).join('')}<button class="j2-sti more" data-cs-gal>${mosaic}<b>All styles</b><small>${total} to pick from</small></button></div>
      ${(S.missing || []).map((m) => `<p class="cs-note">${H.ic?.('info', 's14') || ''}<span>${H.esc(m.text)}${m.go === 'brand' ? ` <button class="linkbtn" data-cs-brand>${H.esc(m.fix)}</button>` : ''}</span></p>`).join('')}${pl?.note ? `<p class="cs-note">${H.ic?.('info', 's14') || ''}<span>${H.esc(pl.note)}</span></p>` : ''}${pl?.error ? `<p class="j2-err">${H.esc(pl.error)}</p>` : ''}
      <div class="cs-fine${more ? ' on' : ''}"><button class="cs-fine-h" data-cs-more aria-expanded="${!!more}"><b>Fine-tune</b><span>${more ? '' : 'Reference, brand kit and what the maker reads'}</span><i>${more ? '−' : '+'}</i></button>${more ? `<div class="cs-rows">
        ${refV ? row('ref', 'Reference', sp.ref ? refV.label : 'None', refV.img && sp.ref ? `<img src="${H.esc(srcOf(refV.img))}" alt="">` : '') : ''}
        ${row('brand', 'Brand kit', kit.logo ? 'Logo, colours, tone' : 'Colours, tone', (kit.colors || []).slice(0, 3).map((c) => `<i class="cs-dot" style="background:${H.esc(c)}"></i>`).join(''))}
        <label class="cs-dir"><span>What the maker reads</span><textarea id="cs-dir" rows="4">${H.esc(sp.direction || '')}</textarea><small>${H.esc(why('direction'))}</small></label></div>` : ''}</div>
      ${look()}
      ${setIds ? '' : `<button class="cs-look-btn" data-cs-look ${S.looking ? 'disabled' : ''}>${H.ic?.('eye', 's16') || ''}<span><b>${S.looking ? 'Sketching…' : S.look ? 'Another first look' : 'See a first look'}</b><small>Free · your words on your real photo${kind === 'video' ? ', with the shots' : ''}</small></span></button>`}
      </div>`;
  }
  /* the free first look (3.4): Brew's words over the real product photo and, for a video, the shots; made before anything is paid */
  const look = () => { const L = S.look; if (!L) return ''; if (L.error) return `<p class="j2-err">${H.esc(L.error)}</p>`;
    const st = styleById(L.style || S.spec?.style), ex = st?.example || st?.cover || null, stale = L.key && L.key !== lookKey(); /* the look follows the set-up: a pick since it was drawn redraws it (free) */
    return `<div class="cs-look${stale || S.looking ? ' is-stale' : ''}"><small>${S.looking ? 'Redrawing the first look for your set-up…' : `First look${PARTNER() ? '' : ' · free'} · your product, words, size and colours${st ? ` in the ${H.esc(st.label)} style` : ''}. Make it draws the real ${L.shots?.length ? 'video' : 'picture'}`}</small><div class="cs-look-row">${L.file ? `<img src="${H.esc(srcOf(L.file))}" alt="First look">` : ''}${ex && !L.shots?.length ? `<figure class="cs-look-ref"><img src="${H.esc(srcOf(ex))}" alt=""><figcaption>The style: ${H.esc(st.label)}</figcaption></figure>` : ''}<div>${L.headline ? `<b>${H.esc(L.headline)}</b>` : ''}${L.sub ? `<p>${H.esc(L.sub)}</p>` : ''}${L.shots?.length ? `<ol>${L.shots.map((x) => `<li><span>${x.sec} s</span> ${H.esc(x.see)}${x.vo ? `<em>“${H.esc(x.vo)}”</em>` : ''}</li>`).join('')}</ol>` : ''}${L.flags?.length ? `<p class="j2-st-note">Needs a source before it runs: ${H.esc(L.flags.join(', '))}. Our check will ask for it, or change the words.</p>` : ''}</div></div></div>`; };
  /* what the first look was drawn for: a new style, product, size or kind draws it again (free, rendered here), so it never shows
     a set-up you have moved away from (26 Oct, Param: "the first look doesn't adhere to whatever options we selected") */
  const lookKey = () => JSON.stringify([S?.spec?.kind, S?.spec?.style, S?.spec?.product?.name || S?.spec?.product?.img || null, S?.spec?.sizes?.[0] || null, S?.spec?.set || null]);
  async function sketch() { if (!S?.spec) return; if (S.looking) { S.lookAgain = true; return; } const mine = S, key = lookKey(); S.looking = true; paint();
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/sketch`, { spec: S.spec }); if (S !== mine) return; S.looking = false;
    S.look = r?.sketch ? { ...r.sketch, key, style: S.spec.style } : { error: r?.error || 'The first look didn’t come out. Try again.' }; paint();
    if (S.lookAgain || lookKey() !== key) { S.lookAgain = false; sketch(); } }
  const relook = () => { if (!S?.look || S.look.error || S.made) return; clearTimeout(S.lookT); S.lookT = setTimeout(() => { if (S?.look && S.look.key !== lookKey()) sketch(); }, 350); };
  /* the stage's composer: the whole set-up, a line while it is being made, or one line under a made take */
  function html(ch) {
    if (!S || S.chId !== ch.id || S.loading) return `<div class="j2-studio cs"><p class="cs-wait"><brew-load class="spin"></brew-load> Setting it up from the card…</p></div>`;
    if (S.error) return `<div class="j2-studio cs"><p class="j2-err">${H.esc(S.error)}</p><button class="j2-pri" data-cs-retry>Try again</button></div>`;
    if (S.making || anyBusy()) { const m = S.making; /* a status card: what is being made in one sentence, its price on its own line, then where it lands (26 Oct: the flex line split the words into ragged columns) */
      return `<div class="j2-studio cs cs-making"><div class="cs-mk-h"><brew-load class="spin"></brew-load><b>Being made</b>${m?.usd != null && !PARTNER() ? `<small>about ${usd(m.usd)}</small>` : ''}</div><p class="cs-mk-what">${H.esc(String(m?.line || 'Your picture').replace(/^./, (c) => c.toUpperCase()))}</p><p class="cs-why">You can leave this page: it lands here and in Work when it’s ready, and we tell you.</p><div class="cs-acts"><button class="j2-chip" data-cs-feed>Back to the feed</button><button class="j2-chip" data-cs-game>Play while it brews</button></div></div>`; }
    const sl = slidesOf(ch);
    /* a batch (How many above 1): every take of the newest run in one strip; tap one to look at it, Use it keeps it on the stage */
    const head0 = ch.versions?.find((v) => v.id === ch.head)?.studio, run = [...(ch.versions || [])].reverse().find((v) => v.studio?.run)?.studio?.run, batch = run ? (ch.versions || []).filter((v) => v.studio?.run === run) : [];
    const batchHtml = batch.length > 1 ? `<div class="cs-batch"><small>${batch.length}${batch[0].studio.runN > batch.length ? ` of ${batch[0].studio.runN}` : ''} made in one go · tap one to put it on the stage; the others stay in History</small><div class="cs-strip">${batch.map((v) => { const s0 = v.snapshot || {}; return `<button class="${(H.viewing?.() || ch.head) === v.id ? 'on' : ''}${v.passed ? ' is-drop' : ''}" data-v-view="${H.esc(v.id)}" title="v${v.n}"><img src="${H.esc(srcOf(s0.poster || s0.image || ''))}" alt=""><span>${v.n}</span></button>`; }).join('')}</div></div>` : '';
    /* Redo the set makes the set as it is now (after a drop or an add), so its price follows the slides on the stage */
    if (sl?.length > 1 && Array.isArray(S.spec?.set) && sl.map((x) => x.style).join() !== S.spec.set.join() && !S.making && !S.open) { S.spec = { ...S.spec, set: sl.map((x) => x.style) }; S.sel = Math.min(S.sel || 0, sl.length - 1); setTimeout(price, 0); }
    /* made: the Set-up tab is the set itself (big numbered slides, the picked one's own actions) and what it was made with, one
       button to change it; Redo it and Make the full one are on the bar under the stage (25 Oct: tiny strip, centred pills, v1 knobs) */
    const sp0 = S.spec || {}, X = S.slots || {}, AR = String(SIZES?.[sp0.sizes?.[0]]?.ratio || '9:16').replace(':', '/') /* thumbnails at the shape they were made in */, QL = { preview: 'Preview (quick, low resolution)', standard: 'Standard', premium: 'Premium (4K)' };
    const madeWith = () => { const st = styleById(sp0.style), size = SIZES?.[sp0.sizes?.[0]]?.label || sp0.sizes?.[0], set = Array.isArray(sp0.set) ? sp0.set.map((id) => styleById(id)?.label || id) : null, QN2 = { preview: 'a quick preview', standard: 'full quality', premium: '4K' };
      const what = set ? `a ${set.length}-picture set (${set.join(', ')})` : `${sp0.kind === 'video' && sp0.seconds ? `a ${sp0.seconds}-second ` : 'an '}${st?.label || 'Studio'} ${sp0.kind === 'video' ? 'video' : 'picture'}`.replace(/^an ([^AEIOUaeiou])/, 'a $1');
      const who = sp0.cast && !/^no people$/i.test(sp0.cast) && (set || (st?.people && st.people !== 'none')) ? ` with ${castShort(sp0.cast)}` : '';
      return `<div class="cs-sec cs-madewith"><p>Made ${H.esc(what)}${sp0.product?.name ? ` of <b>${H.esc(sp0.product.name)}</b>` : ''}${H.esc(who)}${size ? ` for ${H.esc(size)}` : ''}, as ${H.esc(QN2[sp0.quality || 'standard'])}.</p><button class="cs-look-btn" data-cs-open>${H.ic?.('sliders', 's16') || ''}<span><b>Change the set-up</b><small>Then Redo it under the stage makes it again</small></span></button></div>`; };
    if (!S.open && sl?.length > 1) { const i = Math.min(S.sel || 0, sl.length - 1), cur = sl[i], st = styleById(cur.style); slidePrice(cur.style); const sp = S.slidePlan?.[cur.style];
      return `${batchHtml}<div class="cs-line cs-made">${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}${S.gallery && S.adding ? `<div class="j2-studio cs cs-addgal">${gallery()}</div>` : ''}
        <div class="cs-sec"><small>Your set · ${sl.length} slides</small><div class="cs-grid" style="--ar:${AR}">${sl.map((x, k) => `<button class="${k === i ? 'on' : ''}" data-cs-sel="${k}" title="${H.esc(styleById(x.style)?.label || '')}"><img src="${H.esc(srcOf(x.file))}" alt=""><span>${k + 1}</span></button>`).join('')}<button class="cs-add" data-cs-addslide title="Add a slide">＋<small>Add a slide</small></button></div>
        ${S.adding && S.addStyle ? (() => { const ap = S.slidePlan?.[S.addStyle]; return `<div class="cs-acts cs-addrow"><span>Add a slide: ${H.esc(styleById(S.addStyle)?.label || '')}</span>${PARTNER() ? '<button class="j2-pri" data-rx="share-shopos" data-team-change>Ask our team to add it</button>' : `<button class="j2-pri" data-cs-addgo ${!ap || ap.error || S.working ? 'disabled' : window.BrewTips?.attr('price') || ''}>${ap?.error ? H.esc(ap.error) : `Add this slide${ap?.usd != null ? ` · ${usd(ap.usd)}` : ''}`}</button>`}<button class="linkbtn" data-cs-addx>Cancel</button></div>`; })() : ''}
        <div class="cs-pick"><b>Slide ${i + 1} of ${sl.length}${st ? ` · ${H.esc(st.label)}` : ''}</b><div>${PARTNER() ? '<button class="btn btn-ghost sm" data-rx="share-shopos" data-team-change>Ask our team to redo it</button>' : `<button class="btn btn-ghost sm" data-cs-slide="redo" ${!sp || sp.error ? 'disabled' : window.BrewTips?.attr('price') || ''}>Redo this slide${sp?.usd != null ? ` · ${usd(sp.usd)}` : ''}</button>`}<button class="linkbtn" data-cs-slide="drop" ${sl.length <= 2 ? 'disabled title="A set needs at least two slides"' : ''}>Drop it</button></div></div></div>
        ${madeWith()}</div>`; }
    if (!S.open) { const img = (H.ch?.() || ch)?.pkg?.poster || ch.pkg?.image;
      return `${batchHtml}<div class="cs-line cs-made">${S.failed ? `<p class="j2-err">${H.esc(S.failed)}</p>` : ''}${img ? `<div class="cs-sec"><small>Made</small><div class="cs-grid is-one" style="--ar:${AR}"><button class="on" type="button" tabindex="-1"><img src="${H.esc(srcOf(img))}" alt=""></button></div></div>` : ''}${madeWith()}</div>`; }
    return full();
  }
  /* clicks on the composer: true when handled */
  function click(e) {
    const g = (sel) => e.target.closest(sel); if (!S || !g('.cs, .cs-line, [data-cs-open], .cs-adjust, .cs-sizes')) return false; /* .cs-sizes: the sizes under the piece on the stage */ const sp = S.spec;
    if (g('[data-cs-retry]')) { const id = S.chId; S = null; H.paint?.(); H.remount?.(id); return true; }
    if (g('[data-cs-feed]')) { H.toFeed?.(); return true; }
    if (g('[data-cs-game]')) { /* the game is loaded on the first tap only (brew-game.js), never before */
      const go2 = () => window.BrewGame?.open?.({ progress: () => (S?.making || (anyBusy() ? { line: 'your creative', at: S?.makingAt } : null)), brand: S?.slots?.brand?.value?.colors || [], onSee: () => H.paint?.() });
      if (window.BrewGame) go2(); else { const sc = document.createElement('script'); sc.src = '/brew-game.js'; sc.onload = go2; sc.onerror = () => H.toast?.('The game didn’t load. Your creative keeps being made.'); document.head.appendChild(sc); } return true; }
    const rm = e.target.closest('[data-cs-remember],[data-cs-forget]'); if (rm && S?.spec) { remember(rm.dataset.csRemember || rm.dataset.csForget, rm, !!rm.dataset.csForget); return true; }
    if (g('[data-cs-open]')) { S.open = true; H.showSetup?.(); paint(); return true; } /* the set-up is the panel's Set-up tab */
    if (g('[data-cs-redo]')) { go(true); return true; }
    const ld = g('[data-cs-land]'); if (ld) { const mine = S; api('POST', `/api/jam2/jams/${S.jid}/studio/land`, { bid: S.bid, takeId: ld.dataset.csLand }).then((r) => { if (S !== mine) return; if (r?.error) return H.toast?.(H.esc(r.error)); S.made = true; S.open = false; H.landed?.(S.chId, {}); }); return true; }
    const sel = g('[data-cs-sel]'); if (sel) { S.sel = +sel.dataset.csSel; paint(); /* the frame swipes to the slide picked */
      requestAnimationFrame(() => toSel(true)); return true; }
    if (g('[data-cs-addslide]')) { S.adding = true; S.gallery = true; paint(); return true; }
    const so = g('[data-cs-slide]'); if (so) { const sl = slidesOf(H.ch?.() || {}) || []; const i = Math.min(S.sel || 0, sl.length - 1); slideOp(so.dataset.csSlide, i, sl[i]?.style); return true; }
    if (g('[data-cs-go]')) { go(false); return true; }
    if (g('[data-cs-look]')) { sketch(); return true; }
    if (!sp) return true;
    if (g('[data-cs-more]')) { S.more = !(S.more ?? (wideOn() || ['ref', 'brand', 'size'].includes(S.pop))); paint(); return true; }
    const closed = !!S.pop && !g('.cs-pop, [data-cs-pop]'); if (closed) S.pop = null; /* a tap outside the open picker closes it (and still does what it tapped) */
    const pop = g('[data-cs-pop]'); if (pop) { S.pop = S.pop === pop.dataset.csPop ? null : pop.dataset.csPop; paint(); if (S.pop) requestAnimationFrame(() => document.querySelector('.cs-pop')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); return true; }
    if (g('[data-cs-gal]')) { S.gallery = true; paint(); return true; } if (g('[data-cs-galx]')) { S.gallery = false; S.adding = false; paint(); return true; }
    const grp = g('[data-cs-grp]'); if (grp) { S.group = grp.dataset.csGrp; S.q = ''; paint(); return true; }
    const mk = g('[data-cs-mk]'); if (mk) { const want = SETS[mk.dataset.csMk]; const ids = want.set.filter((id) => !S.blocked?.[id]); if (ids.length < 2) { H.toast?.('Your Brand Book rules out most of these.'); return true; } set({ set: ids, sizes: want.sizes }); return true; }
    const k = g('[data-cs-kind]'); if (k && k.dataset.csKind !== sp.kind) { const kind = k.dataset.csKind, first = groups().find((x) => x.kind === kind)?.styles?.[0]; S.picks = groups().filter((x) => x.kind === kind).flatMap((x) => x.styles.slice(0, 1)).map((x) => x.id); set({ kind, style: first?.id || null, sizes: [SIZE_OPTS[kind][0]], seconds: kind === 'video' ? first?.seconds || 10 : null }); return true; }
    const s = g('[data-cs-style]'); if (s && S.adding) { const id = s.dataset.csStyle; if (S.blocked?.[id]) { H.toast?.(H.esc(S.blocked[id])); return true; } S.addStyle = id; S.gallery = false; slidePrice(id); paint(); return true; } /* the price shows first; the add is its own press */
    if (g('[data-cs-addgo]')) { slideOp('add', 0, S.addStyle); return true; } if (g('[data-cs-addx]')) { S.adding = false; S.addStyle = null; paint(); return true; }
    if (s) { const id = s.dataset.csStyle; if (S.blocked?.[id]) { H.toast?.(H.esc(S.blocked[id])); return true; }
      if (Array.isArray(sp.set)) { const has = sp.set.includes(id); if (has && sp.set.length <= 2) { H.toast?.('A set needs at least two slides.'); return true; } if (!has && sp.set.length >= 10) { H.toast?.('Ten slides at most.'); return true; } S.gallery = false; set({ set: has ? sp.set.filter((x) => x !== id) : [...sp.set, id] }); return true; }
      const x = styleById(id); S.gallery = false; set({ style: id, ...(x?.seconds && sp.kind === 'video' ? { seconds: x.seconds } : {}), ...(x?.ratio === '1:1' ? { sizes: ['ig-square'] } : {}) }); return true; }
    const pr = g('[data-cs-prod]'); if (pr) { const p = S.products.find((x) => (pr.dataset.csPname ? x.name === pr.dataset.csPname : x.img === pr.dataset.csPimg)) || S.products[+pr.dataset.csProd]; /* by the row's own product, never its place in a list that may have changed under it (27 Oct: Hug Hoodie set the Long Day Kit) */ if (p && p.name !== S.spec.product?.name) { S.pq = ''; set({ product: { img: p.img, name: p.name || null, handle: p.handle || null } }); H.toast?.(`Switched to ${H.esc(p.name || 'that product')}. The words follow in a moment.`); } else { S.pop = null; paint(); } return true; } /* one tap: picked, closed, said; the same one again just closes */
    const c = g('[data-cs-cast]'); if (c) { const o = (S.slots.cast?.options || []).find((x) => x.id === c.dataset.csCast); set({ cast: o?.id === 'none' ? 'No people' : o?.label || null }); return true; }
    const rf = g('[data-cs-ref]'); if (rf) { set({ ref: rf.dataset.csRef === 'on' ? S.slots.reference?.value?.label || null : null }); return true; }
    if (g('[data-cs-brand]')) { H.toBrand?.(); return true; }
    const sz = g('[data-cs-size]'); if (sz) { set({ sizes: [sz.dataset.csSize] }); return true; }
    const sec = g('[data-cs-sec]'); if (sec) { set({ seconds: +sec.dataset.csSec }); return true; }
    const nn = g('[data-cs-n]'); if (nn) { set({ count: +nn.dataset.csN }); return true; }
    const n = g('[data-cs-count]'); if (n) { set({ count: Math.max(1, Math.min(12, (+sp.count || 1) + +n.dataset.csCount)) }); return true; }
    const q = g('[data-cs-q]'); if (q) { set({ quality: q.dataset.csQ }); return true; }
    if (closed) paint(); return true;
  }
  /* typing: the direction and the template search change the set-up without a repaint under the cursor */
  function input(e) { if (!S?.spec) return false;
    if (e.target.id === 'cs-dir') { S.spec = { ...S.spec, direction: e.target.value }; clearTimeout(S.dirT); S.dirT = setTimeout(price, 600); return true; }
    if (e.target.id === 'cs-pq') { S.pq = e.target.value; const pos = e.target.selectionStart; paint(); const el = document.getElementById('cs-pq'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return true; }
    if (e.target.id === 'cs-q') { S.q = e.target.value; const pos = e.target.selectionStart; paint(); const el = document.getElementById('cs-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } return true; }
    return false; }
  /* the frame shows the slide picked in the strip, through every repaint (a price coming back redraws the stage) */
  const toSel = (smooth = false) => { if (S?.sel == null) return; const sw = document.querySelector('.cs-frame .as-swipe'), it = sw?.children?.[S.sel]; if (sw && it) { sw.scrollTo({ left: it.offsetLeft - sw.children[0].offsetLeft, behavior: smooth ? 'smooth' : 'auto' }); return; }
    /* an A+ page or a listing's photo tiles have no swipe row: the picked slide's own picture is outlined and brought into view */
    const f = slidesOf(H.ch?.() || {})?.[S.sel]?.file; if (!f) return; const fr = document.querySelector('.cs-frame'); if (!fr) return;
    fr.querySelectorAll('.cs-pick').forEach((x) => x.classList.remove('cs-pick')); const img = [...fr.querySelectorAll('img')].find((x) => (x.getAttribute('src') || '').replace(/^\//, '') === String(f).replace(/^\//, ''));
    const box = img?.closest('figure, .az-mod, .al-tile') || img; if (box) { box.classList.add('cs-pick'); if (smooth) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
  /* the chat, on a set-up not made yet: the words become slot changes (server: studio/ask), shown as changed chips, re-priced */
  async function ask(text) { if (!S?.jid || !S.spec) return { error: 'The set-up is still opening.' };
    const r = await api('POST', `/api/jam2/jams/${S.jid}/studio/ask`, { text, spec: S.spec, made: !!S.made }); if (r?.error || !r?.patch) return { error: r?.error || 'That didn’t go through.' };
    const { addDirection, ...pt } = r.patch; if ('cast' in pt) { set({ cast: pt.cast }); delete pt.cast; } if (addDirection) pt.direction = [S.spec.direction, addDirection].filter(Boolean).join(' ');
    if (pt.style && !S.picks.includes(pt.style)) S.picks = [pt.style, ...S.picks.slice(0, 2)]; S.changed = Object.keys(pt); S.open = true; set(pt); return { said: r.said }; }
  /* the Adjust tab on a creative: every slot, what it is now, why, and "Always use this for <brand>" */
  function adjustHtml(ch) { if (!S || S.chId !== ch.id || !S.spec) return '<p class="hs-tip">Setting it up from the card…</p>';
    const sp = S.spec, X = S.slots || {}, kind = sp.kind === 'video' ? 'video' : 'image', st = styleById(sp.style), bn = (window.LIVE?.brand?.name || document.title.split(' · ')[0] || 'this brand');
    const pr = S.prefs || {}, row = (label, value, why, rem) => `<div class="cs-adj"><small>${H.esc(label)}</small><b>${H.esc(value || '—')}</b>${why ? `<p class="cs-why">${H.esc(why)}</p>` : ''}${rem || ''}</div>`;
    const remBtn = (slot, value, saved, extra = '') => value == null || value === '' ? '' : saved ? `<span class="cs-saved">Always used for ${H.esc(bn)} · <button class="linkbtn" data-cs-forget="${slot}"${extra}>Stop</button></span>` : `<button class="linkbtn" data-cs-remember="${slot}"${extra}>Always use this for ${H.esc(bn)}</button>`;
    return `<div class="cs-adjust"><p class="hs-tip">Everything we set up for this piece, and why. Change any of it on the stage; save the ones you always want.</p>
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
    S.prefs = r.prefs || S.prefs; H.toast?.(off ? 'We won’t always use that any more.' : 'Saved: we use this for every new piece. Change it any time here or in your Brand Book.'); paint(); }
  const state = (id) => (S && S.chId === id ? { loading: !!S.loading, making: !!(S.making || anyBusy()), working: !!S.working, made: !!S.made, open: !!S.open, plan: S.plan, productImg: S.spec?.product?.img || null, styleLabel: Array.isArray(S.spec?.set) ? null : styleById(S.spec?.style)?.label || null, treat: (() => { const x = styleById(S.spec?.style); return x && !x.cover ? treat(x) : 'plain'; })(), bc: (S.slots?.brand?.value?.colors || [])[0] || null, /* the stage's preview dresses the photo like the style */ frames: Array.isArray(S.spec?.set) ? S.spec.set.length : null /* the stage previews this many frames */,
    /* the size set up, so the stage draws the piece in that shape, and the three sizes the stage offers under it (26 Oct: Set-up said Story 9:16, the stage drew a 4:5 feed post) */
    ratio: SIZES?.[S.spec?.sizes?.[0]]?.ratio || null, size: S.spec?.sizes?.[0] || null, productName: S.spec?.product?.name || null, kind: S.spec?.kind || 'image', seconds: S.spec?.seconds || null,
    sizeOpts: [...new Set([...(SIZE_OPTS[S.spec?.kind === 'video' ? 'video' : 'image']).slice(0, 3), ...(S.spec?.sizes?.[0] ? [S.spec.sizes[0]] : [])])].map((id) => ({ id, label: SIZES?.[id]?.label || id, ratio: SIZES?.[id]?.ratio || '' })), sel: S.sel ?? 0 /* the slide picked here is the one on the stage */, error: S.error || null } : null);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S?.pop) { if (document.activeElement?.closest?.('.cs-pop')) document.activeElement.blur(); /* the page holds repaints while a field has focus */ S.pop = null; paint(); } });
  const reset = () => { clearTimeout(pollT); clearTimeout(planT); S = null; };
  const openSetup = () => { if (!S) return; S.open = true; H.showSetup?.(); paint(); };
  window.CreativeStage = { init: (h) => Object.assign(H, h), mount, follow: (ch) => (S && ch && S.chId === ch.id && !S.made ? follow(ch) : false), html, click, input, state, reset, openSetup, redo: () => go(true), make: () => go(false) /* the bar's Make it */, select: (i) => { if (S) S.sel = +i || 0; }, fullPrice: () => fullPrice(), makeFull: () => makeFull(), /* a version restored: Redo, Made with and the full one follow the version on the stage, not the newest take (QV 25 Oct) */ respec: (v) => { if (!S?.spec || !v) return; const sl = (v.slides || []).map((x) => x.style).filter(Boolean); S.spec = { ...S.spec, ...(v.quality ? { quality: v.quality } : {}), ...(v.style ? { style: v.style } : {}), ...(v.size ? { size: v.size } : {}), ...(sl.length > 1 ? { set: sl } : {}) }; S.full = null; S.sel = 0; price(); }, afterPaint: () => toSel(false), ask, adjustHtml };
})();
