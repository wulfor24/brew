/* Make the final: the one place a Sloosh credit is spent. The sheet is the "Choose a photo" sheet grown by a few rows:
   the photos and references to pick (an ordered set: the number is the "image N" the brief names), the brief Brew wrote,
   the words on the image, the way to make it (Brew's brief on a model, or a Sloosh Space with its own form), the quote,
   and one button that says what it costs. Nothing is spent until that button. */
(() => {
  const A = window.__BREW; if (!A) return;
  const { $, esc, ic, toast } = A;
  const F = { base: null, wid: null, draftId: null, st: null, picks: [], visual: '', text: '', way: 'brief', space: null, inputs: {}, quote: null, busy: false, err: '', fields: null, missing: null, filled: null, revise: '' };
  const api = (m, p, b) => A.tapi(m, p, b);
  const JOBS = [['product', 'Product'], ['scene', 'Place'], ['style', 'Look'], ['person', 'Person'], ['logo', 'Logo'], ['other', 'Other']];
  const pickKey = (x) => x.id || x.url;
  const picked = (x) => F.picks.findIndex((p) => pickKey(p) === pickKey(x));
  const maxRefs = () => (F.way === 'brief' ? (F.st?.draft?.as === 'video' ? 20 : 14) : 10); /* Sloosh takes at most 20 uploaded assets on a quote */

  const tile = (x) => { const k = picked(x); return `<button type="button" class="ph-t${k >= 0 ? ' is-on' : ''}" data-fn-pick="${esc(pickKey(x))}" title="${esc(x.label || '')}">${x.kind === 'video' ? `<video src="${esc(x.url)}" muted preload="metadata"></video>` : `<img src="${esc(A.cdnSized ? A.cdnSized(x.url, 300) : x.url)}" alt="" loading="lazy">`}${k >= 0 ? `<i>${k + 1}</i>` : ''}<span>${esc(x.label || '')}${x.job && x.job !== 'product' ? ` · ${esc((JOBS.find((j) => j[0] === x.job) || [])[1] || x.job)}` : ''}</span></button>`; };
  const pickRow = (p, i) => `<li class="fn-pick"><b>${i + 1}</b><span>${esc(p.label || 'Photo')}</span><select data-fn-job="${i}">${JOBS.map(([v, l]) => `<option value="${v}"${p.job === v ? ' selected' : ''}>${l}</option>`).join('')}</select><input data-fn-keep="${i}" value="${esc(p.keep || '')}" placeholder="${p.job === 'product' ? 'keep the label exact' : p.job === 'style' ? 'match this light' : 'what to keep from it'}"><button type="button" class="icon-btn" data-fn-unpick="${i}" aria-label="Remove">${ic('x', 's14')}</button></li>`;
  const field = (f) => { const v = F.inputs[f.key] ?? ''; const from = F.filled?.[f.key] ? `<small>from ${esc(F.filled[f.key])}</small>` : ''; const miss = (F.missing || []).find((m) => m.key === f.key);
    const inp = f.type === 'select' ? `<select data-fn-in="${esc(f.key)}">${f.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : f.type === 'boolean' ? `<label class="fn-sw"><input type="checkbox" data-fn-in="${esc(f.key)}"${v ? ' checked' : ''}> ${v ? 'On' : 'Off'}</label>`
      : f.type === 'number' ? `<input type="number" data-fn-in="${esc(f.key)}" value="${esc(v)}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}>`
      : f.type === 'color' ? `<input type="color" data-fn-in="${esc(f.key)}" value="${esc(v || '#000000')}">`
      : ['image', 'images', 'video', 'audio'].includes(f.type) ? `<div class="fn-media">${v ? (Array.isArray(v) ? v : [v]).map((u) => `<img src="${esc(u)}" alt="">`).join('') : `<em>${esc(miss ? miss.why : 'Pick from your photos above, or upload')}</em>`}<label class="btn btn-ghost sm">${ic('up', 's14')}Upload<input type="file" hidden data-fn-up="${esc(f.key)}" accept="${f.type === 'video' ? 'video/mp4' : f.type === 'audio' ? 'audio/*' : 'image/*'}"${f.type === 'images' ? ' multiple' : ''}></label>${v ? `<button type="button" class="linkbtn" data-fn-clear="${esc(f.key)}">Clear</button>` : ''}</div>`
      : f.type === 'folder' ? `<em>${esc(miss?.why || 'Not in Brew yet')}</em>` : `<input data-fn-in="${esc(f.key)}" value="${esc(v)}" placeholder="${esc(f.help || '')}">`;
    return `<div class="fn-field${miss ? ' is-missing' : ''}"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${inp}${from}</div>`; };

  const paint = () => {
    const w = $('.ph-m.fn-m'); if (!w) return; const st = F.st; const d = st?.draft; const s = st?.status || {}; const credits = st?.credits;
    const can = !!(s.ok || s.dummy || s.fallback); const whyNot = !can ? s.why || 'Sloosh is not ready.' : s.ok && credits && credits.left <= 0 ? `This brand’s Sloosh share for today is used up (${credits.cap} credits a day).` : '';
    const left = s.dummy ? 'Simulated on this site: no credits are spent.' : s.fallback && !s.ok ? `Sloosh isn’t available yet (${s.fallbackWhy || 'no credits'}). Brew makes this one with Gemini.` : [s.left != null ? `${s.left} credits left on Brew’s workspace today` : '', credits ? `${credits.left} of ${credits.cap} in this brand’s share` : ''].filter(Boolean).join(' · ');
    const q = F.quote; const n = q ? Math.round((q.credits || 0) * 100) / 100 : null;
    w.innerHTML = `<div class="ph-h"><b>${d?.final ? 'Revise the final' : 'Make the final'}</b><button class="icon-btn" data-fn-x aria-label="Close">${ic('x', 's16')}</button></div>
      <div class="ph-b fn-b">
        <p class="fn-status${whyNot ? ' is-off' : ''}">${ic(whyNot ? 'info' : 'sparkles', 's14')}${esc(whyNot || left || 'Ready')}${s.dummy ? ' <span class="dummy-tag">Dummy</span>' : ''}</p>
        ${d ? `<section class="fn-from"><img src="${esc(d.image || '')}" alt="">${d.video ? `<video src="${esc(d.video)}" muted playsinline preload="metadata"></video>` : ''}<div><small>${d.final ? 'From this final' : 'From this draft'}</small><b>${esc(d.title || '')}</b><span>${esc(d.as === 'video' ? 'Video' : 'Image')} · ${esc(d.ratio || '')}</span></div></section>` : ''}
        ${d?.final ? `<section><div class="ph-sh"><small>What to change</small><span>One thing at a time</span></div><input class="fn-input" data-fn-revise value="${esc(F.revise)}" placeholder="e.g. the table to black marble, slightly warmer light"></section>` : ''}
        <section><div class="ph-sh"><small>Your product photos</small><span>Tap to add, in the order the brief names them · ${F.picks.length} of ${maxRefs()}</span></div>
          ${st?.photos?.length ? `<div class="ph-grid">${st.photos.map(tile).join('')}</div>` : '<p class="ph-none">No product photos read from the store yet.</p>'}</section>
        <section><div class="ph-sh"><small>Your references</small><span><a href="#v=refs">Library · References</a></span></div>
          ${st?.references?.length ? `<div class="ph-grid">${st.references.map(tile).join('')}</div>` : '<p class="ph-none">Nothing uploaded yet. Lifestyle shots, past ads, a logo or a look go in the Library’s References tab.</p>'}</section>
        ${F.picks.length ? `<section><div class="ph-sh"><small>What each one is for</small></div><ol class="fn-picks">${F.picks.map(pickRow).join('')}</ol></section>` : ''}
        ${!d?.final ? `<section><div class="ph-sh"><small>The brief</small><span>Subject, setting, light, use</span></div><textarea class="fn-input" data-fn-visual rows="3" placeholder="What the picture shows: the product, where it is, where the light comes from, who is there">${esc(F.visual)}</textarea></section>
        ${d?.as !== 'video' ? `<section><div class="ph-sh"><small>Words on the image</small><span>Exact words, or empty for none</span></div><input class="fn-input" data-fn-text value="${esc(F.text)}" placeholder="e.g. Cold hands? Not any more"></section>` : ''}` : ''}
        <section><div class="ph-sh"><small>How to make it</small></div>
          <div class="fn-ways"><label class="fn-way${F.way === 'brief' ? ' is-on' : ''}"><input type="radio" name="fn-way" value="brief"${F.way === 'brief' ? ' checked' : ''}><b>Brew’s brief</b><span>Our words on the best model for it</span></label>
          ${(st?.spaces || []).map((sp) => `<label class="fn-way${F.way === 'space' && F.space?.id === sp.id ? ' is-on' : ''}"><input type="radio" name="fn-way" value="space:${esc(sp.id)}"${F.way === 'space' && F.space?.id === sp.id ? ' checked' : ''}><b>${esc(sp.name)}</b><span>${esc(sp.about || 'A Sloosh Space')}${sp.credits != null ? ` · about ${esc(sp.credits)} credits` : ''}</span></label>`).join('')}</div>
          ${F.way === 'space' && F.fields ? `<div class="fn-form">${F.fields.map(field).join('')}</div>` : ''}</section>
        ${F.err ? `<p class="st-aerr">${ic('info', 's14')}${esc(F.err)}</p>` : ''}
        ${q ? `<p class="fn-quote">${ic('check', 's14')}${q.provider === 'gemini' ? `Sloosh isn’t available yet (${esc(q.fallbackWhy || 'no credits')}). Brew makes this one with Gemini.` : `<b>${n === 0 ? 'No credits' : `${n} credits`}</b> · ${esc(q.space ? q.space.name || 'Sloosh Space' : q.label || q.model)}`}${q.hold && q.hold !== q.credits ? ` · holds up to ${esc(q.hold)}` : ''}${q.why && q.provider !== 'gemini' ? ` · ${esc(q.why)}` : ''}${q.warning ? ` · ${esc(q.warning)}` : ''}</p>${q.prompt ? `<details class="fn-prompt"><summary>The words Brew sends</summary><pre>${esc(q.prompt)}</pre></details>` : ''}` : ''}
      </div>
      <div class="ph-f"><span>Nothing is spent until you press ${q ? 'Make it' : 'Get the quote'}.</span><button class="btn btn-ghost" data-fn-x>Cancel</button>${q ? `<button class="btn btn-primary" data-fn-run ${F.busy || whyNot ? 'disabled' : ''}>${F.busy ? 'Starting…' : q.provider === 'gemini' ? 'Make it with Gemini' : n === 0 ? 'Make it' : `Make it (${n} credits)`}</button>` : `<button class="btn btn-primary" data-fn-quote ${F.busy || whyNot ? 'disabled' : ''}>${F.busy ? 'Asking Sloosh…' : 'Get the quote'}</button>`}</div>`;
    bind(w);
  };
  const body = () => ({ draftId: F.draftId, refs: F.picks.map((p) => ({ id: p.id, url: p.url, job: p.job, label: p.label, keep: p.keep, kind: p.kind })), visual: F.visual, text: F.text ? [F.text] : [], space: F.way === 'space' && F.space ? { id: F.space.id, name: F.space.name, inputs: F.inputs } : null, revise: F.revise ? { change: F.revise } : null });
  const drop = () => { F.quote = null; };
  const bind = (w) => {
    w.querySelectorAll('[data-fn-x]').forEach((b) => b.onclick = close);
    w.querySelectorAll('[data-fn-pick]').forEach((b) => b.onclick = () => { const k = b.dataset.fnPick; const all = [...(F.st.photos || []), ...(F.st.references || [])]; const x = all.find((y) => pickKey(y) === k); if (!x) return; const i = picked(x);
      if (i >= 0) F.picks.splice(i, 1); else { if (F.picks.length >= maxRefs()) return toast(`Up to ${maxRefs()} references for this one.`); F.picks.push({ ...x, keep: x.keep || '' }); } drop(); paint(); });
    w.querySelectorAll('[data-fn-unpick]').forEach((b) => b.onclick = () => { F.picks.splice(+b.dataset.fnUnpick, 1); drop(); paint(); });
    w.querySelectorAll('[data-fn-job]').forEach((s) => s.onchange = () => { F.picks[+s.dataset.fnJob].job = s.value; drop(); paint(); });
    w.querySelectorAll('[data-fn-keep]').forEach((s) => s.oninput = () => { F.picks[+s.dataset.fnKeep].keep = s.value; drop(); });
    const v = w.querySelector('[data-fn-visual]'); if (v) v.oninput = () => { F.visual = v.value; drop(); };
    const tx = w.querySelector('[data-fn-text]'); if (tx) tx.oninput = () => { F.text = tx.value; drop(); };
    const rv = w.querySelector('[data-fn-revise]'); if (rv) rv.oninput = () => { F.revise = rv.value; drop(); };
    w.querySelectorAll('input[name="fn-way"]').forEach((r) => r.onchange = () => { if (r.value === 'brief') { F.way = 'brief'; F.space = null; F.fields = null; } else { const id = r.value.slice(6); F.way = 'space'; F.space = (F.st.spaces || []).find((s) => String(s.id) === id) || null; F.fields = null; F.inputs = {}; } drop(); paint(); if (F.way === 'space') getQuote(true); });
    w.querySelectorAll('[data-fn-in]').forEach((i) => i.onchange = () => { F.inputs[i.dataset.fnIn] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value; drop(); });
    w.querySelectorAll('[data-fn-clear]').forEach((b) => b.onclick = () => { delete F.inputs[b.dataset.fnClear]; drop(); paint(); });
    w.querySelectorAll('[data-fn-up]').forEach((i) => i.onchange = async () => { const files = [...i.files]; if (!files.length) return; const key = i.dataset.fnUp; const f = F.fields.find((x) => x.key === key); const urls = [];
      for (const file of files) { const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        const r = await api('POST', `/api/brands/${window.BRAND}/references`, { data, label: file.name.replace(/\.[a-z0-9]+$/i, ''), job: (f && /logo/i.test(f.label)) ? 'logo' : /creator|person|face|model/i.test(f?.label || '') ? 'person' : /background|scene/i.test(f?.label || '') ? 'scene' : 'other' }).catch((e) => ({ error: e.message }));
        if (r?.error) return toast(r.error); const ref = r.reference || r.item || r; const url = ref.url || (ref.file ? `/b/${window.BRAND}/${ref.file}` : null); if (url) { urls.push(url); F.st.references = [...(F.st.references || []), { id: ref.id, url, label: ref.label, job: ref.job, kind: ref.kind }]; } }
      if (urls.length) F.inputs[key] = f?.type === 'images' ? [...(F.inputs[key] || []), ...urls] : urls[0]; drop(); paint(); });
    const gq = w.querySelector('[data-fn-quote]'); if (gq) gq.onclick = () => getQuote(false);
    const run = w.querySelector('[data-fn-run]'); if (run) run.onclick = runIt;
  };
  const getQuote = async (soft) => { if (F.busy) return; F.busy = true; F.err = ''; paint();
    const r = await api('POST', `${F.base}/quote`, body()).catch((e) => ({ error: e.message })); F.busy = false;
    if (r?.fields) { F.fields = r.fields; F.missing = r.missing || null; F.filled = r.filled || null; if (r.inputs) F.inputs = { ...r.inputs, ...F.inputs }; }
    if (r?.error) { F.quote = null; F.err = soft && r.missing ? '' : r.error; } else { F.quote = r.quote; if (r.quote?.fields) { F.fields = r.quote.fields; F.filled = r.quote.filled || null; F.inputs = { ...(r.quote.inputs || {}), ...F.inputs }; } }
    paint(); };
  const runIt = async () => { if (F.busy || !F.quote) return; F.busy = true; paint();
    const r = await api('POST', `${F.base}/run`, { draftId: F.draftId }).catch((e) => ({ error: e.message })); F.busy = false;
    if (r?.error) { F.err = r.error; paint(); return; } toast(F.quote.dummy ? 'Making the final (simulated here).' : F.quote.provider === 'gemini' ? 'Brew is making the final with Gemini. It lands here in a minute or two.' : 'Sloosh is making the final. It lands here in a minute or two.'); close(); if (r.change && A.putCh) { A.putCh(r.change); A.paintStudio?.(); } else window.JamRoom?.pull?.(); };
  const close = () => { if ($('.ph-m.fn-m')) A.closeModal(); F.wid = null; F.base = null; };
  /* open: the draft's photos, references and Spaces come from one call; the draft's own product photo is image 1 */
  const open = async (wid, draftId, base = null) => { if (F.wid) close(); Object.assign(F, { base: base || `/api/work/${wid}/final`, wid, draftId, st: null, picks: [], visual: '', text: '', way: 'brief', space: null, inputs: {}, quote: null, busy: false, err: '', fields: null, missing: null, filled: null, revise: '' });
    A.modal('<div class="sheet ph-m fn-m" role="dialog" aria-label="Make the final"><div class="ph-h"><b>Make the final</b></div><div class="ph-b"><p class="ph-none">One moment…</p></div></div>', () => {}); /* the same sheet as Choose a photo (app.js modal) */
    const st = await api('GET', `${F.base}/status?draftId=${encodeURIComponent(draftId || '')}`).catch((e) => ({ error: e.message })); if (st?.error) { toast(st.error); return close(); }
    F.st = st; F.visual = st.draft?.visual || ''; F.text = st.draft?.text || ''; const lead = (st.photos || []).find((p) => p.named) || (st.photos || [])[0] || null; if (lead) F.picks = [{ ...lead, keep: '' }]; /* our version of a rival's ad: their ad is never a picture here; its composition rides in the brief as words (rival-ad.js) */
    if (st.draft?.final) { const prev = { url: st.draft.image || st.draft.video, label: 'The previous final', job: 'other', keep: 'everything that is not the change' }; F.picks = [prev, ...F.picks]; }
    paint(); };
  document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-jm-final]'); if (!b) return; e.preventDefault(); const wid = b.dataset.wid || window.JamRoom?.work?.()?.id || b.closest('[data-wid]')?.dataset.wid; if (!wid) return toast('Open the jam first.'); open(wid, b.dataset.jmFinal); });
  document.addEventListener('click', async (e) => { const b = e.target.closest?.('[data-jm-fnck]'); if (!b) return; e.preventDefault(); const wid = b.dataset.wid; const r = await api('POST', `/api/work/${wid}/final/checkpoint`, { draftId: b.dataset.jmFnck, ok: b.dataset.ok === '1' }).catch((x) => ({ error: x.message })); if (r?.error) toast(r.error); else window.JamRoom?.pull?.(); });
  /* the studio: the same sheet on a change's version */
  document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-fn-studio]'); if (!b) return; e.preventDefault(); open(null, b.dataset.fnStudio, `/api/changes/${b.dataset.fnStudio}/final`); });
  window.Finals = { open, close };
})();
