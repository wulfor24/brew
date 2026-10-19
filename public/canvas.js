// The jam's left side: the thing being made, as it will really look, changing as you jam.
// A canvas is a stack of blocks (data/canvas-blocks.json). The card's family gives the defaults, and the server can
// compose any other mix (w.canvas.blocks) for moves nobody planned.
// Every block reads live data only: the brief's plan (w.doc.plan) and how we'll know (w.doc.measure), the drafts
// (w.drafts), the versions and the change package (ch).
(() => {
  let LIB = null;
  fetch('/data/canvas-blocks.json').then((r) => r.json()).then((j) => { LIB = j; window.__BREW?.repaintDetail?.(); }).catch(() => {});
  const SECTOR_FAMILY = { creatives: 'paid_ads', ads: 'paid_ads', storefront: 'site', signals: 'messages', catalog: 'listings', visibility: 'search' };

  /* the canvas shows what the card's own action makes: its change package's widget when there is one, else the format the
     card plans, then the area. A "page section" card is a page, never a sponsored ad */
  const ACT_CANVAS = { meta_ad: 'paid_ads', social: 'content', post: 'content', store: 'site', crm: 'messages', listing: 'listings', vis: 'ai_search', setup: 'foundations', brief: 'partners', decision: 'strategy', print: 'offline', meta_ops: 'change' };
  const MAKE_CANVAS = { 'page section': 'site', email: 'messages', 'whatsapp message': 'messages', 'single image ad': 'paid_ads', 'carousel ad': 'paid_ads', 'collection ad': 'paid_ads', 'catalog ad': 'paid_ads', 'video ad': 'paid_ads', reel: 'content', 'instagram post': 'content', 'instagram carousel': 'content', 'instagram stories': 'content' };
  const familyOf = (c, ch) => ACT_CANVAS[ch?.family] || MAKE_CANVAS[c?.make?.format] || SECTOR_FAMILY[c?.sector] || 'other';
  const asked = new Set();
  const isChange = (c) => (c?.rows || []).some(([k]) => /^(from|to|move a day|budget|bid)/i.test(String(k)));
  const blocksFor = (c, w, ch) => {
    if (w?.canvas?.blocks?.length) return w.canvas.blocks;
    // a card no family fits: ask the server once to compose its canvas from the library
    if (w && familyOf(c, ch) === 'other' && !asked.has(w.id)) { asked.add(w.id); window.__BREW?.tapi('POST', `/api/work/${w.id}/canvas`, {}).then((r) => { if (r.work) { window.__BREW.putWork(r.work); window.__BREW.repaintDetail(); } }); }
    const f = familyOf(c, ch), base = (f === 'change' ? ['change', 'measure'] : LIB?.families?.[f] || LIB?.fallback || ['doc']).slice();
    const rows = (c?.rows || []).map(([k]) => String(k).toLowerCase());
    if (isChange(c)) { ['change', 'creative', 'page', 'message'].forEach((b) => { const i = base.indexOf(b); if (i >= 0) base.splice(i, 1); }); base.unshift('change'); } // an account change is the change, not an ad
    // a table card (a budget split, a plan) with nothing made yet leads with its numbers, not a text-only ad
    const made = c?.img || c?.images?.length || w?.refImages?.length || w?.doc?.plan?.headline || (w?.drafts || []).some((d) => d.state === 'making' || (d.state === 'ready' && (d.image || d.video || d.slides?.length)));
    if (c?.kind === 'rows' && rows.length && !made) { const i = base.indexOf('creative'); if (i >= 0) base.splice(i, 1); if (!base.includes('change')) base.unshift('change'); else if (base[0] !== 'change') { base.splice(base.indexOf('change'), 1); base.unshift('change'); } }
    return [...new Set(base)];
  };

  /* ---------- the content every block reads ---------- */
  const ctxOf = (p, c, w, ch, H) => {
    const bp = w?.doc?.plan || {}, v = w?.versions?.find((x) => x.n === w.current) || null;
    const draft = (w?.drafts || []).find((d) => d.state === 'ready' && (d.image || d.video || d.slides?.length || d.copy)) || null;
    const making = (w?.drafts || []).find((d) => d.state === 'making') || null;
    /* a rival's ad card: its picture and its title are about their ad, never ours (make-sheet.js isRival); ours waits for a draft */
    const theirs = window.MakeSheet?.isRival?.(c) ?? (c?.research?.kind === 'ad' || !!c?.research?.ad);
    const img = draft?.image || ch?.pkg?.image || (v && v.n > 1 ? v.images?.[0] : null) || w?.refImages?.[0] || (theirs ? null : c.images?.[0]) || null;
    const head = bp.headline || ch?.after?.title || (v && v.n > 1 ? v.title : '') || (theirs ? c.make?.what || '' : c.title) || '';
    const body = bp.body || ch?.after?.sub || (v && v.n > 1 ? v.sub : '') || (theirs ? '' : c.sub) || '';
    return { p, c, w, ch, H, bp, v, draft, making, img, head, body, btn: bp.button || '', brand: H.B.brand };
  };
  const ph = (H, text, ask) => `<button type="button" class="cv-ph${text ? '' : ' is-row'}" data-cv-ask="${H.esc(ask || `Fill in: ${text}`)}">${H.ic('sparkles', 's12')}${text ? `<em>${H.esc(text)}</em>` : ''}<span>Ask in the chat →</span></button>`; /* in a labelled row the label already says what is missing */
  const media = (x, ratio = '4/5') => {
    const { H, draft, making, img, c } = x;
    if (making) return `<div class="cv-media is-making" style="aspect-ratio:${ratio}"><span class="spin"></span><span>${H.esc(making.step || 'Making it')}…</span></div>`;
    if (draft?.video) return `<video class="cv-media" src="${H.esc(draft.video)}"${draft.image ? ` poster="${H.esc(draft.image)}"` : ''} controls playsinline loop preload="metadata" style="aspect-ratio:${H.esc((draft.ratio || '9:16').replace(':', '/'))}"></video>`;
    if (draft?.slides?.length) return `<div class="cv-slides">${draft.slides.map((s, i) => `<img src="${H.esc(s.image)}" alt="Slide ${i + 1}" loading="lazy">`).join('')}</div>`;
    if (img) return `<img class="cv-media" src="${H.esc(img)}" alt="" style="aspect-ratio:${H.esc((draft?.ratio || '').replace(':', '/') || ratio)}">`;
    if (c.kind === 'media' || c.kind === 'chat' || c.kind === 'answer') return `<div class="cv-media is-slot">${H.slotHtml(c)}</div>`;
    return `<div class="cv-media is-type" style="aspect-ratio:${ratio}"><b>${H.esc(x.head)}</b></div>`;
  };
  const avatar = (x) => x.brand.mark ? `<img class="cv-av" src="/${String(x.brand.mark).replace(/^\//, '')}" alt="">` : `<span class="cv-av">${x.H.esc((x.brand.name || 'B')[0])}</span>`;

  /* ---------- the blocks ---------- */
  const B = {
    creative: (x) => { const { H } = x;
      return `<figure class="cv-b cv-creative"><div class="cv-ig"><div class="cv-ig-top">${avatar(x)}<span><b>${H.esc(x.brand.host || x.brand.name)}</b><small>Sponsored</small></span></div>
        ${media(x)}<div class="cv-ig-cta"><span>${H.esc(x.btn || 'Shop now')}</span>${H.ic('right', 's14')}</div>
        <figcaption class="cv-ig-cap"><b>${H.esc(x.brand.host || x.brand.name)}</b> ${x.head ? H.esc(x.head) : ''}${x.body && x.body !== x.head ? ` <span>${H.esc(x.body)}</span>` : ''}</figcaption></div>
        ${x.draft?.copy && !x.bp.body ? `<p class="cv-note">${H.esc(String(x.draft.copy).slice(0, 220))}</p>` : ''}</figure>`; },
    message: (x) => { const { H, bp } = x, fmt = String(x.c.make?.format || ''), email = /email|newsletter|klaviyo|mail/i.test(bp.channel || '') || (!/whatsapp|sms|text|push/i.test(`${bp.channel || ''} ${fmt}`) && /email|newsletter|klaviyo|mail/i.test(`${fmt} ${bp.change || ''} ${x.c.title} ${x.c.plan?.target || ''}`)); /* the card's own format first: an email card is an inbox, a WhatsApp card a phone */
      if (email) return `<figure class="cv-b cv-mail"><div class="cv-mail-top"><b>${H.esc(x.brand.name)}</b><small>to you · now</small></div><h4>${x.head ? H.esc(x.head) : ph(H, 'Subject line')}</h4>${x.img ? `<img src="${H.esc(x.img)}" alt="">` : ''}<p>${x.body ? H.esc(x.body) : ph(H, 'The email text')}</p><span class="cv-btn">${H.esc(x.btn || 'Shop now')}</span></figure>`;
      return `<figure class="cv-b cv-phone"><div class="cv-wa-top">${avatar(x)}<b>${H.esc(x.brand.name)}</b><small>Business account</small></div>
        <div class="cv-wa-body"><div class="cv-wa-msg">${x.img ? `<img src="${H.esc(x.img)}" alt="">` : ''}${x.head ? `<p><b>${H.esc(x.head)}</b></p>` : ph(H, 'The first line')}${x.body && x.body !== x.head ? `<p>${H.esc(x.body)}</p>` : ''}<small>10:04</small></div>
        <div class="cv-wa-btns"><span>${H.esc(x.btn || 'Shop now')}</span><span>Not now</span></div></div></figure>`; },
    page: (x) => { const { H } = x;
      return `<figure class="cv-b cv-web"><div class="cv-web-bar"><i></i><i></i><i></i><span>${H.esc(x.brand.host || '')}</span></div>
        <div class="cv-web-hero"><div><small>${H.esc(x.brand.name)}</small><b>${x.head && x.head !== x.c.title ? H.esc(x.head) : ph(H, 'The page headline')}</b>${x.body && x.body !== x.c.sub ? `<p>${H.esc(x.body)}</p>` : ''}<span class="cv-btn">${H.esc(x.btn || 'Shop now')}</span></div>${x.img ? `<img src="${H.esc(x.img)}" alt="">` : ''}</div></figure>`; },
    listing: (x) => { const { H } = x;
      return `<figure class="cv-b cv-listing">${x.img ? `<img src="${H.esc(x.img)}" alt="">` : '<div class="cv-media is-type"></div>'}<div><b>${H.esc(x.head)}</b><p>${H.esc(x.body)}</p><span class="cv-stars">★★★★☆</span></div></figure>`; },
    change: (x) => { const { H, c, bp, w } = x;
      // the real account's exact changes when the action tray has them, else the card's own numbers and the brief's plan
      const ops = w?.actPreview?.ops || [];
      const rows = ops.length ? ops.flatMap((o) => (o.lines || [o.say || o.kind]).map((l) => [o.target || o.kind, l]))
        : (c.rows || []).map(([k, v]) => [k, v]);
      const plan = [['When', bp.when], ['Budget', bp.budget], ['Stop rule', bp.guard]].filter(([, v]) => v);
      // a move from one place to another (budget, traffic, spend): the two sides with what moves between them
      const row = (re) => (c.rows || []).find(([k]) => re.test(String(k))), get = (re) => row(re)?.[1], from = get(/^from$/i), to = get(/^to$/i), amt = get(/^(move|shift|budget)/i), amtK = row(/^(move|shift|budget)/i)?.[0] || '';
      const rest = (c.rows || []).filter(([k]) => !/^(from|to|move|shift|budget)/i.test(String(k)));
      if (!ops.length && from && to) return `<section class="cv-b cv-change is-move"><header><small>The change</small></header>
        <div class="cv-move"><div class="cv-side is-from"><small>From</small><b>${H.esc(from)}</b></div><div class="cv-arrow">${amt ? `<b>${H.esc(amt)}</b>` : ''}<span>→</span>${amt ? `<small>${H.esc(amtK.toLowerCase())}</small>` : ''}</div><div class="cv-side is-to"><small>To</small><b>${H.esc(to)}</b></div></div>
        ${rest.length ? `<dl>${rest.map(([k, v]) => `<div><dt>${H.esc(k)}</dt><dd><b>${H.esc(v)}</b></dd></div>`).join('')}</dl>` : ''}
        ${plan.length ? `<dl class="cv-plan">${plan.map(([k, v]) => `<div><dt>${H.esc(k)}</dt><dd>${H.esc(v)}</dd></div>`).join('')}</dl>` : `<p class="cv-soft">${ph(H, 'When it starts and the stop rule', 'When should this start, and when should we stop or undo it?')}</p>`}</section>`;
      return `<section class="cv-b cv-change"><header><small>${ops.length ? 'Exactly what changes on the account' : isChange(c) ? 'The change' : 'At a glance'}</small>${w?.actPreview?.target ? `<em>${H.esc(w.actPreview.target)}</em>` : ''}</header>
        <dl>${rows.map(([k, v]) => { const m = String(v).match(/^(.*?)\s*(?:→|->)\s*(.*)$/); return `<div><dt>${H.esc(k)}</dt><dd>${m ? `<s>${H.esc(m[1])}</s><b>${H.esc(m[2])}</b>` : `<b>${H.esc(v)}</b>`}</dd></div>`; }).join('')}</dl>
        ${plan.length ? `<dl class="cv-plan">${plan.map(([k, v]) => `<div><dt>${H.esc(k)}</dt><dd>${H.esc(v)}</dd></div>`).join('')}</dl>` : ops.length || isChange(c) ? `<p class="cv-soft">${ph(H, 'When it starts and the stop rule', 'When should this start, and when should we stop or undo it?')}</p>` : ''}</section>`; },
    offer: (x) => { const { H, bp } = x, code = (String(bp.change || '').match(/\b[A-Z0-9]{5,}\b/) || [])[0];
      return `<section class="cv-b cv-offer"><div class="cv-ticket"><small>${H.esc(x.brand.name)}</small><b>${H.esc(bp.offer || x.head)}</b>${code ? `<code>${H.esc(code)}</code>` : ph(H, 'The code')}<span>${H.esc(bp.when || 'Dates to set')}</span></div></section>`; },
    audience: (x) => { const { H, bp } = x, hold = null;
      return `<section class="cv-b cv-aud"><small>Who gets it</small><b>${bp.audience ? H.esc(bp.audience) : ph(H, 'Who it’s for')}</b>${(() => { const h = Math.round((hold || 0.1) * 100); return `<div class="cv-split" aria-hidden="true"><span style="flex:${100 - h}"></span><span class="is-hold" style="flex:${h}"></span></div><p class="cv-split-k"><span><i></i>${100 - h}% get it</span><span><i class="is-hold"></i>${h}% held back${hold ? '' : ' (suggested)'}, to measure it</span></p>`; })()}</section>`; },
    tasks: (x) => { const { H, bp } = x;
      const list = bp.owner ? [{ title: bp.change || x.head, owner: bp.owner, day: null }] : [];
      return `<section class="cv-b cv-tasks"><small>Who does what</small>${list.length ? `<ul>${list.map((s) => `<li><span class="cv-chk${s.state === 'done' ? ' is-done' : ''}"></span><b>${H.esc(s.title)}</b><em>${H.esc(s.owner || 'to assign')}${s.day != null ? ` · day ${H.esc(s.day)}` : ''}</em></li>`).join('')}</ul>` : ph(H, 'Who does what, by when', 'Who on the team does each part, and by when?')}</section>`; },
    doc: (x) => { const { H, bp } = x;
      const rows = [['What changes', bp.change], ['Who it’s for', bp.audience], ['When', bp.when], ['Budget', bp.budget], ['Owner', bp.owner], ['Stop rule', bp.guard]];
      return `<section class="cv-b cv-doc">${x.img ? `<img class="cv-doc-img" src="${H.esc(x.img)}" alt="">` : ''}${x.head && x.head !== x.c.title ? `<h3>${H.esc(x.head)}</h3>` : ''}${bp.why ? `<p class="cv-why">${H.esc(bp.why)}</p>` : ''}<dl>${rows.map(([k, v], i) => `<div><dt>${H.esc(k)}</dt><dd>${v ? H.esc(v) : i === rows.findIndex((r) => !r[1]) ? ph(H, '', `Fill in: ${k}`) : '<span class="cv-dash">—</span>'}</dd></div>`).join('')}</dl></section>`; }, /* only the first gap invites: six 'ask' rows read as noise */
    table: (x) => { const { H, c } = x; return c.rows?.length ? `<section class="cv-b cv-table"><table>${c.rows.map(([k, v]) => `<tr><th>${H.esc(k)}</th><td>${H.esc(v)}</td></tr>`).join('')}</table></section>` : ''; },
    file: (x) => { const { H, c } = x; return c.link ? `<a class="cv-b cv-file" href="${H.esc(c.link.url)}" target="_blank" rel="noopener">${H.ic('doc', 's16')}<b>${H.esc(c.link.label)}</b></a>` : ''; },
    event: (x) => { const { H, bp } = x; return `<section class="cv-b cv-event"><small>The event</small><b>${H.esc(x.head)}</b><dl><div><dt>When</dt><dd>${bp.when ? H.esc(bp.when) : ph(H, '', 'Fill in: the date')}</dd></div><div><dt>Where</dt><dd>${bp.where ? H.esc(bp.where) : ph(H, '', 'Which cities or venues?')}</dd></div><div><dt>Budget</dt><dd>${bp.budget ? H.esc(bp.budget) : ph(H, '', 'Fill in: budget')}</dd></div></dl></section>`; },
    measure: (x) => { const { H, w, bp } = x, m = w?.doc?.measure; const metric = m?.metric || bp.metric; if (!metric) return '';
      return `<section class="cv-b cv-measure"><small>How we’ll know</small><b>${H.esc(metric)}</b>${m?.summary || bp.target ? `<span>${H.esc(m?.summary || bp.target)}${bp.window ? ` · read after ${H.esc(bp.window)} days` : ''}</span>` : ''}</section>`; }
  };

  /* ---------- the canvas, the versions, the quick turns ---------- */
  const versions = (w, ch, H) => {
    const vs = ch?.versions?.length > 1 ? ch.versions.map((v) => ({ n: v.n, by: v.author, on: v.id === ch.head, note: v.reason || '', attr: `data-cv-chv="${H.esc(v.id)}"` }))
      : (w?.versions || []).length > 1 ? w.versions.map((v) => ({ n: v.n, by: v.by, on: v.n === w.current, note: v.note || '', attr: `data-ver="${v.n}"` })) : [];
    return vs.length ? `<div class="cv-vers" role="tablist" aria-label="Versions">${vs.map((v) => `<button role="tab" aria-selected="${v.on}" class="${v.on ? 'is-on' : ''}" ${v.attr} title="${H.esc(v.note)}">v${v.n}</button>`).join('')}</div>` : '';
  };
  const turns = (c, w, ch, H) => {
    if (['measuring', 'result', 'out', 'deploying'].includes(w?.stage)) return '';
    const knobs = (window.__BREW?.fitKnobs ? window.__BREW.fitKnobs(ch?.knobs) : (ch?.knobs || [])).slice(0, 3);
    const chips = knobs.length ? knobs.map((k) => `<span class="cv-knob"><button class="chip" data-cv-knob="${H.esc(k.k)}" aria-expanded="false">${H.esc(k.label)} ${H.ic('chev', 's12')}</button><span class="cv-opts" hidden>${(k.opts || []).map((o) => `<button class="chip" data-cv-knobv="${H.esc(k.k)}" data-v="${H.esc(o)}">${H.esc(o)}</button>`).join('')}</span></span>`).join('')
      : (LIB?.turns?.[isChange(c) ? 'change' : familyOf(c, ch)] || LIB?.turns?.other || []).map((t) => `<button class="chip" data-cv-ask="${H.esc(t)}">${H.esc(t)}</button>`).join('');
    const visual = blocksFor(c, w, ch).some((b) => ['creative', 'message', 'page', 'listing'].includes(b)), drafts = w?.drafts || [], making = drafts.some((d) => d.state === 'making');
    const make = !visual ? '' : making ? `<span class="chip is-make is-busy"><span class="spin"></span>Making the draft…</span>` : `<button class="chip is-make" data-jm-make="auto">${H.ic('sparkles', 's12')}${drafts.some((d) => d.state === 'ready') ? 'Make another draft' : 'Make the first draft'}</button>`;
    return `<div class="cv-turns">${make}${chips}<button class="chip is-3" data-cv-ask="Make 3 different versions of this, each with a different angle.">${H.ic('sparkles', 's12')}Try 3 versions</button></div>`;
  };
  // the jam view: the blocks, the versions, the quick turns
  const linked = new Set();
  const html = (p, c, w, ch, H) => {
    // knobs on every jam: once per jam, the card's change package is made and linked (quick turns then make versions)
    if (w && !w.changeId && window.LIVE?.access?.gen !== false && !linked.has(w.id) && !/^(jam-|work:)/.test(String(p.id)) && !['out', 'measuring', 'result', 'deploying'].includes(w.stage)) { linked.add(w.id);
      window.__BREW?.tapi('POST', `/api/work/${w.id}/link-change`, {}).then((r) => { if (r.change) { window.__BREW.putWork(r.work); window.__BREW.setChange(r.change); window.__BREW.repaintDetail(); } }); }
    const x = ctxOf(p, c, w, ch, H), list = blocksFor(c, w, ch);
    const body = list.map((b) => (B[b] ? B[b](x) : '')).filter(Boolean).join('');
    const live = w?.stage === 'measuring' ? `<span class="cv-live"><i class="pulse"></i>Live${w.deploy?.liveAt ? ` since ${H.esc(H.ago(w.deploy.liveAt))}` : ''}</span>` : w?.stage === 'out' ? '<span class="cv-live is-out">Out with team</span>' : '';
    return `<div class="cv" data-canvas data-fam="${H.esc(familyOf(c, ch))}"><header class="cv-h"><div>${w?.ticket ? `<small>${H.esc(w.ticket)}</small>` : ''}<h1>${H.esc(c.title || w?.title || x.head)}</h1></div>${live}</header>
      ${versions(w, ch, H)}<div class="cv-stack">${body || B.doc(x)}</div>${turns(c, w, ch, H)}</div>`;
  };
  // a small preview of one option (fresh card tiles) or the brief's still
  const thumb = (p, c, w, ch, H, o) => {
    const x = ctxOf(p, c, w, ch, H); if (o) { x.head = o.name || x.head; x.body = o.says || o.effect || x.body; }
    const first = blocksFor(c, w, ch).find((b) => ['creative', 'message', 'page', 'listing', 'change', 'offer', 'event', 'doc'].includes(b)) || 'doc';
    /* a still: nothing in it is clickable, so it can sit inside a tile that is itself a button (a button in a button breaks the page) */
    const still = B[first](x).replace(/<(button|a)\b/g, '<span').replace(/<\/(button|a)>/g, '</span>').replace(/<input\b[^>]*>/g, '').replace(/\s(data-[\w-]+|href|type|role|aria-expanded|disabled)(="[^"]*")?/g, '');
    return `<div class="cv is-thumb" aria-hidden="true">${still}</div>`;
  };
  // whether the card has something real to show: a mock ad or listing with no picture only repeats the title as fake ad text
  const hasStill = (p, c, w, ch, H) => {
    const x = ctxOf(p, c, w, ch, H), first = blocksFor(c, w, ch).find((b) => ['creative', 'message', 'page', 'listing', 'change', 'offer', 'event', 'doc'].includes(b)) || 'doc';
    return !['creative', 'listing'].includes(first) || !!(x.img || x.draft || x.making);
  };

  // quick turns and placeholders talk to the jam; knobs make versions on the change
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-cv-ask]'); if (a) { e.preventDefault(); return window.JamRoom?.send?.(a.dataset.cvAsk); }
    const k = e.target.closest('[data-cv-knob]'); if (k) { const o = k.parentElement.querySelector('.cv-opts'); o.hidden = !o.hidden; k.setAttribute('aria-expanded', String(!o.hidden)); return; }
    const kv = e.target.closest('[data-cv-knobv]'); if (kv) { const A = window.__BREW, w = A.currentDetail?.()?._work, cid = w?.changeId; if (!cid) return;
      kv.disabled = true; A.toast(`${A.ic('sparkles', 's16')}Making the ${A.esc(kv.dataset.v.toLowerCase())} version…`);
      const r = await A.tapi('POST', `/api/changes/${cid}/knob`, { k: kv.dataset.cvKnobv, v: kv.dataset.v }); if (r.change) A.setChange(r.change); A.repaintDetail(); return; }
    const cv = e.target.closest('[data-cv-chv]'); if (cv) { const A = window.__BREW, w = A.currentDetail?.()?._work; if (!w?.changeId) return; const r = await A.tapi('POST', `/api/changes/${w.changeId}/restore`, { versionId: cv.dataset.cvChv }); if (r.error) return A.toast(A.esc(r.error)); if (r.change) A.setChange(r.change); A.repaintDetail(); }
  });

  window.Canvas = { html, thumb, hasStill, blocksFor, familyOf, get lib() { return LIB; } };
})();
