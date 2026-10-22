/* The Brand Book page (#v=brand, and the shared /<slug>/brand page). A book dressed in the brand itself: the cover is their
   colour with their logo, every chapter title is set in their own heading font, the colour chips are theirs. Brew's chrome
   stays quiet around it. The team edits any line in place (a source chip says where each line came from), brings their own
   brand book (a file, a ZIP, a link or pasted text) and shares it in one tap: the link, the kit, or a prompt any AI can use.
   window.BrandBook.render(el, { slug, api, toast, readOnly, data }) */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const lum = (hex) => { const h = String(hex || '#888').replace('#', ''), f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const SRC = { team: 'Your team', read: 'From your site' };
  const srcLabel = (s) => !s ? null : s.startsWith('upload:') ? `From ${s.slice(7)}` : SRC[s] || s;
  const fontsLoaded = new Set();
  const loadFont = (name, files = []) => {
    if (!name || fontsLoaded.has(name)) return; fontsLoaded.add(name);
    const own = files.find((f) => f.family === name);
    if (own) { const st = document.createElement('style'); st.textContent = `@font-face{font-family:"${name.replace(/"/g, '')}";src:url("${own.src}");font-display:swap}`; document.head.appendChild(st); return; }
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;600;700&display=swap`; document.head.appendChild(l);
  };

  const CHAPTERS = [
    ['story', 'Story'], ['kit', 'Look and kit'], ['voice', 'Voice'], ['words', 'Words'], ['products', 'Products'], ['people', 'People'],
    ['proof', 'Proof'], ['library', 'What they publish'], ['playbooks', 'Playbooks'], ['reach', 'Where they show up'], ['rivals', 'Rivals'], ['rules', 'Rules']
  ];

  function render(el, ctx) {
    const S = { data: ctx.data || null, fam: null, busy: false };
    const api = ctx.api || (async (m, p, b) => (await fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json());
    const toast = ctx.toast || ((m) => console.log(m));
    const base = `/api/brands/${encodeURIComponent(ctx.slug)}/book`;
    const load = async () => { const d = S.data && ctx.readOnly ? S.data : await api('GET', base); if (!d || d.error) { el.innerHTML = `<div class="bb-empty"><p>${esc(d?.error || 'The Brand Book didn’t open. Try again.')}</p></div>`; return; } S.data = d; paint(); if (d.building && !ctx.readOnly) poll(); };
    let pollT = null; const poll = () => { clearTimeout(pollT); pollT = setTimeout(async () => { if (!el.isConnected) return; const d = await api('GET', base); if (d && !d.error) { const was = S.data.building; S.data = d; if (was && !d.building) { paint(); toast('Your Brand Book is written.'); } else if (d.building) poll(); } }, 6000); };
    const save = async (patch, ok) => { if (S.busy) return; S.busy = true; const d = await api('POST', base, patch); S.busy = false; if (!d || d.error) { toast(d?.error || 'That didn’t save. Try again.'); return false; } S.data = d; paint(); if (ok) toast(ok); return true; };

    function paint() {
      const d = S.data, v = d.book || {}, edit = !!d.canEdit && !ctx.readOnly, k = v.kit || {}, roles = k.roles?.length ? k.roles : (k.colors || []).map((hex) => ({ hex }));
      const primary = roles.find((c) => c.role === 'primary')?.hex || k.accent || '#1d1d1f', accent = roles.find((c) => c.role === 'accent' && c.hex !== primary)?.hex || roles.find((c) => c.hex !== primary && lum(c.hex) < 0.8 && lum(c.hex) > 0.08)?.hex || primary;
      const headFont = k.fonts?.heading, bodyFont = k.fonts?.body; loadFont(headFont, k.fontFiles); loadFont(bodyFont, k.fontFiles);
      el.style.setProperty('--bb-1', primary); el.style.setProperty('--bb-2', accent); el.style.setProperty('--bb-on', lum(primary) > 0.55 ? '#141414' : '#ffffff');
      el.style.setProperty('--bb-head', headFont ? `"${headFont}", Georgia, serif` : 'Georgia, serif'); el.style.setProperty('--bb-body', bodyFont ? `"${bodyFont}", var(--font)` : 'var(--font)');
      const chip = (path) => { const s = v.src?.[path]; return s ? `<span class="bb-src${s.startsWith('upload:') ? ' is-up' : ' is-team'}">${esc(srcLabel(s))}${edit ? `<button class="bb-undo" data-unedit="${esc(path)}" aria-label="Undo: back to what Brew read">Undo</button>` : ''}</span>` : ''; };
      const pen = (path, value, kind = 'text', label = '') => edit ? `<button class="bb-pen" data-edit="${esc(path)}" data-kind="${kind}" data-label="${esc(label)}" data-value="${esc(kind === 'list' ? (value || []).join('\n') : value || '')}" aria-label="Edit ${esc(label || 'this')}">Edit</button>` : '';
      const empty = (path, what, kind = 'text') => edit ? `<p class="bb-add"><button class="bb-addbtn" data-edit="${esc(path)}" data-kind="${kind}" data-label="${esc(what)}" data-value="">Add ${esc(what.toLowerCase())}</button></p>` : '';
      const line = (path, value, label, cls = '') => value ? `<div class="bb-line ${cls}"><p>${esc(value)}</p>${pen(path, value, 'text', label)}${chip(path)}</div>` : empty(path, label);
      const list = (path, items, label, cls = 'bb-chips') => items?.length ? `<div class="bb-line"><ul class="${cls}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${pen(path, items, 'list', label)}${chip(path)}</div>` : empty(path, label, 'list');
      const link = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
      const sec = (id, n, body, sub = '') => body && body.replace(/<[^>]+>/g, '').trim() ? `<section class="bb-ch" id="bb-${id}" data-ch="${id}"><header class="bb-chh"><span class="bb-n">${n}</span><h2>${esc(CHAPTERS.find((c) => c[0] === id)[1])}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</header>${body}</section>` : '';
      const st = v.story || {}, tn = v.tone || {}, w = v.words || {}, pr = v.products || {}, pe = v.people || {}, pf = v.proof || {}, lk = v.look || {}, cov = v.cover || {};
      const lib = v.library || {}, fams = Object.keys(lib).filter((f) => lib[f]?.length); if (!fams.includes(S.fam)) S.fam = fams[0] || null;
      const F = d.options?.families || {};

      const chapters = {
        story: [line('story.positioning', st.positioning, 'Positioning', 'is-lead'), line('story.mission', st.mission, 'Mission'), list('story.values', st.values, 'Values'),
          (v.pillars || []).length ? `<div class="bb-pillars"><h3>Why people buy</h3><ol>${v.pillars.map((p) => `<li><b>${esc(p.pillar)}</b>${p.proof ? `<span>${esc(p.proof)}</span>` : ''}</li>`).join('')}</ol></div>` : '',
          line('story.founderStory', st.founderStory || st.about, 'Founder story'),
          (st.founders?.length || st.founded || st.hq) ? `<dl class="bb-facts">${st.founders?.length ? `<div><dt>Founded by</dt><dd>${st.founders.map((f) => link(f.url, f.name)).join(', ')}</dd></div>` : ''}${st.founded ? `<div><dt>Since</dt><dd>${esc(st.founded)}</dd></div>` : ''}${st.hq ? `<div><dt>Based in</dt><dd>${esc(st.hq)}</dd></div>` : ''}</dl>` : '',
          st.press?.length ? `<div class="bb-press"><h3>As seen in</h3><ul>${st.press.map((p) => `<li>${link(p.url, p.outlet || p.name)}</li>`).join('')}</ul></div>` : ''].join(''),
        kit: [`<div class="bb-logos">${[k.logo, k.mark].filter(Boolean).map((src, i) => `<figure class="bb-logo"><div class="bb-logo-l"><img src="${esc(src)}" alt="${esc(cov.name || '')} ${i ? 'mark' : 'logo'}"></div><div class="bb-logo-d"><img src="${esc(src)}" alt=""></div><figcaption>${i ? 'Mark' : 'Logo'}, on light and on dark</figcaption></figure>`).join('') || (edit ? '<p class="bb-add">Add your logo with Bring your brand book.</p>' : '')}</div>`,
          roles.length ? `<div class="bb-chips-c">${roles.map((c) => `<button class="bb-swatch" data-copy="${esc(c.hex)}" style="--c:${esc(c.hex)}" aria-label="Copy ${esc(c.hex)}"><span class="bb-sw" ${lum(c.hex) > 0.9 ? 'data-light' : ''}></span><b>${esc(c.name || c.hex)}</b><small>${esc([c.role, c.share].filter(Boolean).join(', ') || c.hex)}</small>${c.use ? `<em>${esc(c.use)}</em>` : ''}</button>`).join('')}</div>` : '',
          (headFont || bodyFont) ? `<div class="bb-type">${headFont ? `<div class="bb-spec"><span class="bb-spec-k">Headings in ${esc(headFont)}</span><p class="bb-spec-h" contenteditable="true" spellcheck="false" aria-label="Try the heading font">${esc(cov.tagline || cov.name || 'Aa Bb Cc')}</p>${v.typeUse?.heading ? `<small>${esc(v.typeUse.heading)}</small>` : ''}</div>` : ''}${bodyFont ? `<div class="bb-spec"><span class="bb-spec-k">Body in ${esc(bodyFont)}</span><p class="bb-spec-b" contenteditable="true" spellcheck="false" aria-label="Try the body font">${esc(st.positioning || cov.oneLine || 'The quick brown fox jumps over the lazy dog.')}</p>${v.typeUse?.body ? `<small>${esc(v.typeUse.body)}</small>` : ''}</div>` : ''}</div>` : '',
          lk.notes ? `<div class="bb-look"><h3>Their look</h3>${line('look.notes', lk.notes, 'Photo style', 'is-lead')}<dl class="bb-facts">${[['Light', lk.light, 'look.light'], ['Settings', lk.setting], ['People', lk.people, 'look.people'], ['Props', lk.props], ['Framing', lk.framing], ['Words on pictures', lk.wordsOnImage, 'look.wordsOnImage'], ['Logo', lk.logoUse, 'look.logoUse'], ['Packaging', lk.packaging, 'look.packaging']].filter((x) => x[1]).map(([t, x]) => `<div><dt>${t}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></div>` : empty('look.notes', 'Photo style')].join(''),
        voice: [tn.summary ? `<div class="bb-line is-lead"><p class="bb-big">${esc(tn.summary)}</p>${pen('tone.summary', tn.summary, 'text', 'How the brand sounds')}${chip('tone.summary')}</div>` : empty('tone.summary', 'How the brand sounds'),
          tn.traits?.length ? `<div class="bb-traits">${tn.traits.map((t) => `<article class="bb-trait"><h3>${esc(t.trait)}</h3>${t.sounds ? `<blockquote>${esc(t.sounds)}</blockquote>` : ''}${t.why ? `<p>${esc(t.why)}</p>` : ''}</article>`).join('')}</div>${chip('tone.traits')}` : '',
          tn.never?.length ? `<div class="bb-never"><h3>Never sounds</h3><ul>${tn.never.map((n) => `<li><s>${esc(n.text)}</s>${n.why ? ` <span>${esc(n.why)}</span>` : ''}</li>`).join('')}</ul></div>` : '',
          tn.pairs?.length ? `<div class="bb-pairs"><h3>Say it their way</h3>${tn.pairs.map((p) => `<div class="bb-pair"><p class="is-do">${esc(p.do)}</p><p class="is-dont">${esc(p.dont)}</p></div>`).join('')}</div>` : '',
          tn.cta?.style || tn.cta?.examples?.length ? `<div class="bb-line"><h3>Calls to action</h3>${tn.cta.style ? `<p>${esc(tn.cta.style)}</p>` : ''}${tn.cta.examples?.length ? `<ul class="bb-chips is-cta">${tn.cta.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : '',
          (tn.reading || tn.language) ? `<dl class="bb-facts">${tn.reading ? `<div><dt>Reading level</dt><dd>${esc(tn.reading)}</dd></div>` : ''}${tn.language ? `<div><dt>Writes in</dt><dd>${esc(tn.language)}</dd></div>` : ''}</dl>` : ''].join(''),
        words: [`<div class="bb-wcols">${[['They say', 'words.use', w.use, 'Words we use', 'bb-chips'], ['Customers say', 'words.customers', w.customers?.length ? w.customers : v.language, 'Words customers use', 'bb-chips'], ['They avoid', 'words.avoid', w.avoid, 'Words we avoid', 'bb-chips is-avoid']]
            .filter((c) => c[2]?.length || edit).map(([h, path, xs, label, cls]) => `<div><h3>${h}</h3>${list(path, xs, label, cls)}</div>`).join('')}</div>`,
          `${(v.neverSay || []).length || (v.never || []).length || edit ? `<div class="bb-line"><h3>Never say</h3>` : ''}${(v.neverSay || []).length || (v.never || []).length ? `<ul class="bb-chips is-never">${[...new Set([...(v.neverSay || []), ...(v.never || [])])].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${edit ? '<form class="bb-neverf" data-never><input name="w" placeholder="Add a word or claim they never use" aria-label="Add a never-say word"><button>Add</button></form>' : ''}${(v.neverSay || []).length || (v.never || []).length || edit ? '</div>' : ''}`].join(''),
        products: [pr.heroes?.length ? `<div class="bb-prods">${pr.heroes.map((p) => `<article class="bb-prod">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}<h3>${link(p.url, p.title)}</h3><p class="bb-price">${esc(p.price || '')}${p.mrp ? ` <s>${esc(p.mrp)}</s>` : ''}</p>${p.about ? `<p>${esc(p.about)}</p>` : ''}</article>`).join('')}</div>` : '',
          pr.tiers?.length ? `<div class="bb-tiers">${pr.tiers.map((t) => `<div class="bb-tier"><b>${esc(t.name)}</b><span>${esc(t.from === t.to ? t.from : `${t.from} to ${t.to}`)}</span><small>${t.n} product${t.n === 1 ? '' : 's'}${t.eg ? `, like ${esc(t.eg)}` : ''}</small></div>`).join('')}</div>` : '',
          (pr.offers?.length || pr.guarantee || pr.returns) ? `<dl class="bb-facts">${pr.offers?.length ? `<div><dt>Offers on the site</dt><dd>${pr.offers.map(esc).join('<br>')}</dd></div>` : ''}${pr.guarantee ? `<div><dt>Promise</dt><dd>${esc(pr.guarantee)}</dd></div>` : ''}${pr.returns ? `<div><dt>Returns</dt><dd>${esc(pr.returns)}</dd></div>` : ''}${pr.sells === 'by enquiry' ? '<div><dt>How it sells</dt><dd>By enquiry</dd></div>' : ''}</dl>` : '',
          v.naming?.pattern ? `<div class="bb-line"><h3>How they name things</h3><p>${esc(v.naming.pattern)}</p>${v.naming.examples?.length ? `<ul class="bb-chips">${v.naming.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''].join(''),
        people: [pe.personas?.length ? `<div class="bb-personas">${pe.personas.map((p) => `<article class="bb-persona"><h3>${esc(p.name)}</h3><p>${esc(p.who)}</p>${p.job ? `<p class="bb-quiet">Wants: ${esc(p.job)}</p>` : ''}</article>`).join('')}</div>` : '',
          pe.objections?.length ? `<div class="bb-line"><h3>What makes them hesitate</h3><ul class="bb-list">${pe.objections.map((o) => `<li><b>${esc(o.text)}</b>${o.answer ? `<span>${esc(o.answer)}</span>` : ''}</li>`).join('')}</ul></div>` : '',
          (pe.praise?.length || pe.complaints?.length) ? `<div class="bb-wcols">${pe.praise?.length ? `<div><h3>They love</h3><ul class="bb-list">${pe.praise.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${pe.complaints?.length ? `<div><h3>They complain about</h3><ul class="bb-list">${pe.complaints.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''].join(''),
        proof: [(v.claims || []).length ? `<div class="bb-line"><h3>Claims they can make</h3><ul class="bb-list">${v.claims.slice(0, 10).map((c) => `<li>${esc(c.text)}${c.src ? ` <a class="bb-srcl" href="${esc(c.src)}" target="_blank" rel="noopener">source</a>` : ''}</li>`).join('')}</ul></div>` : '',
          pf.ratings?.length ? `<div class="bb-ratings">${pf.ratings.map((r) => `<div class="bb-rating"><b>${r.rating ? `${esc(r.rating)}★` : esc(Number(r.count).toLocaleString())}</b><span>${r.rating ? `${esc(Number(r.count).toLocaleString())} reviews` : 'reviews'} on ${link(r.url, r.where)}</span></div>`).join('')}</div>` : '',
          pf.quotes?.length ? `<div class="bb-quotes">${pf.quotes.slice(0, 4).map((q) => `<blockquote>${esc(q.text)}${q.product ? `<cite>${esc(q.product)}</cite>` : ''}</blockquote>`).join('')}</div>` : ''].join(''),
        library: fams.length ? `<div class="bb-tabs" role="tablist">${fams.map((f) => `<button role="tab" aria-selected="${f === S.fam}" data-fam="${esc(f)}">${esc(F[f] || f)}<small>${lib[f].length}</small></button>`).join('')}</div>
          <div class="bb-wall">${(lib[S.fam] || []).map((r) => `<figure class="bb-ref">${r.video ? `<video src="${esc(r.video)}" poster="${esc(r.src)}" muted loop playsinline preload="none" data-hoverplay></video>` : `<img src="${esc(r.src)}" alt="" loading="lazy">`}${r.proof ? `<span class="bb-proof">${esc(r.proof)}</span>` : ''}<figcaption>${r.why ? `<b>${esc(r.why)}</b>` : ''}${r.words ? `<span>${esc(r.words)}</span>` : ''}${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open the original</a>` : ''}</figcaption></figure>`).join('')}</div>` : '',
        playbooks: (v.playbooks || []).length ? `<div class="bb-plays">${v.playbooks.map((p) => `<article class="bb-play"><div class="bb-mock" data-f="${esc(p.family)}"><span class="bb-mock-h"></span><span class="bb-mock-l"></span></div><h3>${esc(F[p.family] || p.family)}</h3><dl>${[['Layout', p.layout], ['Headline', p.headline], ['Words on it', p.wordsOnImage], ['Logo', p.logo], ['Call to action', p.cta], ['Never', p.avoid]].filter((x) => x[1]).map(([t, x]) => `<div><dt>${t}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></article>`).join('')}</div>` : '',
        reach: [(v.channels || []).length ? `<ul class="bb-chan">${v.channels.map((c) => `<li><a href="${esc(c.url)}" target="_blank" rel="noopener"><b>${esc(c.net === 'x' ? 'X' : c.net[0].toUpperCase() + c.net.slice(1))}</b>${c.handle ? `<span>@${esc(c.handle)}</span>` : ''}</a></li>`).join('')}</ul>` : '',
          v.markets?.primary ? `<dl class="bb-facts"><div><dt>Sells mainly in</dt><dd>${esc(v.markets.primary)}${v.markets.others?.length ? `, also ${esc(v.markets.others.join(', '))}` : ''}</dd></div>${v.markets.currency ? `<div><dt>Currency</dt><dd>${esc(v.markets.currency)}</dd></div>` : ''}${v.markets.festival ? `<div><dt>Next big date</dt><dd>${esc(v.markets.festival)}</dd></div>` : ''}</dl>` : ''].join(''),
        rivals: (v.rivals || []).length ? `<ul class="bb-list is-rivals">${v.rivals.map((r) => `<li><b>${r.host ? link(`https://${r.host}`, r.name) : esc(r.name)}</b>${r.why ? `<span>${esc(r.why)}</span>` : ''}</li>`).join('')}</ul><p class="bb-quiet">Brew never copies a rival’s product, name, words or people into ${esc(cov.name || 'your')} work.</p>` : '',
        rules: !ctx.readOnly && v.comfort ? `<dl class="bb-facts is-rules">${Object.entries(d.options?.comfort || {}).map(([key, o]) => `<div><dt>${esc(o.label)}</dt><dd>${edit ? `<select data-comfort="${esc(key)}" aria-label="${esc(o.label)}">${Object.entries(o.options).map(([ok, ol]) => `<option value="${esc(ok)}"${v.comfort[key] === ok ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>` : esc(o.options[v.comfort[key]] || '')}</dd></div>`).join('')}
          <div><dt>Narrator</dt><dd>${edit ? `<select data-narrator aria-label="Narrator voice">${(d.options?.narrators || []).map((n) => `<option value="${esc(n.id)}"${v.voice?.narrator === n.id ? ' selected' : ''}>${esc(n.label)}</option>`).join('')}</select>` : esc(v.voice?.narrator || '')}</dd></div>
          <div><dt>Written voice</dt><dd>${edit ? `<select data-voicew aria-label="Written voice">${Object.entries(d.options?.voices || {}).map(([vk, vl]) => `<option value="${esc(vk)}"${v.voice?.written === vk ? ' selected' : ''}>${esc(vl)}</option>`).join('')}</select>` : esc(d.options?.voices?.[v.voice?.written] || '')}</dd></div></dl>` : ''
      };
      const subs = { library: 'Their own work, best first. Brew makes new pieces from the ones that match what it’s making.', playbooks: 'How each format usually looks for them, read from their own posts and ads.', proof: 'Only what can be shown. Brew’s writers quote these and nothing else.' };
      const shown = CHAPTERS.map(([id], i) => [id, i + 1]).filter(([id]) => chapters[id] && chapters[id].replace(/<[^>]+>/g, '').trim());
      const body = shown.map(([id], i) => sec(id, String(i + 1).padStart(2, '0'), chapters[id], subs[id])).join('');
      const ups = (v.uploads || []).filter((u) => !u.applied);
      el.className = 'bb'; el.innerHTML = `
        <div class="bb-bar">${ctx.back ? `<button class="bb-back" data-nav="${esc(ctx.back.nav)}">${esc(ctx.back.label)}</button>` : ''}${edit ? `<button class="bb-btn" data-import>Bring your brand book</button>` : `<span class="bb-made">${ctx.readOnly ? 'A brand book by Brew' : 'Your team edits this book. Ask them to add you.'}</span>`}
          <div class="bb-share"><button class="bb-btn is-main" data-share aria-haspopup="menu">Share</button></div></div>
        ${d.building && !ctx.readOnly ? `<p class="bb-building"><brew-load class="spin"></brew-load>Brew is writing the voice, story and look from ${esc(v.host || 'the site')}. The rest is already here.</p>` : ''}
        ${v.book?.error && !d.building && edit ? `<p class="bb-note">${esc(v.book.error)}</p>` : ''}
        ${ups.length && edit ? `<p class="bb-note">${ups.length} upload${ups.length > 1 ? 's' : ''} waiting: <button class="bb-link" data-import>review the changes</button></p>` : ''}
        <header class="bb-cover"><div class="bb-cover-in">${k.logo ? `<img class="bb-cover-logo" src="${esc(k.logo)}" alt="${esc(cov.name || v.name || '')}">` : `<p class="bb-cover-name">${esc(cov.name || v.name || '')}</p>`}
          <h1>${esc(cov.tagline || cov.oneLine || cov.name || v.name || '')}</h1>${cov.tagline && cov.oneLine ? `<p>${esc(cov.oneLine)}</p>` : ''}
          <div class="bb-cover-strip">${roles.slice(0, 6).map((c) => `<span style="background:${esc(c.hex)}"></span>`).join('')}</div></div>
          ${edit ? `<button class="bb-pen is-cover" data-edit="cover.tagline" data-kind="text" data-label="Tagline" data-value="${esc(cov.tagline || '')}">Edit tagline</button>` : ''}</header>
        <div class="bb-body"><nav class="bb-toc" aria-label="Chapters"><ol>${shown.map(([id], i) => `<li><a href="#bb-${id}" data-toc="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(CHAPTERS.find((c) => c[0] === id)[1])}</a></li>`).join('')}</ol></nav>
          <main class="bb-main">${body || `<p class="bb-note">Brew is still reading ${esc(v.host || 'the site')}. The book fills in as it reads.</p>`}
          ${ctx.readOnly ? `<footer class="bb-foot"><p>Made by Brew from ${esc(v.host || 'the brand’s')} own site, ads and posts.</p><a class="bb-btn is-main" href="/?ref=brand-kit">Make it yours in Brew</a></footer>` : ''}</main></div>`;
      wire();
    }

    function wire() {
      const d = S.data;
      $$('[data-fam]', el).forEach((b) => b.onclick = () => { S.fam = b.dataset.fam; paint(); $('#bb-library', el)?.scrollIntoView({ block: 'start' }); });
      $$('[data-copy]', el).forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast(`Copied ${b.dataset.copy}`); });
      $$('video[data-hoverplay]', el).forEach((vd) => { vd.onmouseenter = () => vd.play().catch(() => {}); vd.onmouseleave = () => vd.pause(); vd.onclick = () => (vd.paused ? vd.play() : vd.pause()); });
      $$('[data-unedit]', el).forEach((b) => b.onclick = () => save({ unedit: b.dataset.unedit }, 'Back to what Brew read.'));
      $$('[data-edit]', el).forEach((b) => b.onclick = () => openEdit(b));
      $$('[data-comfort]', el).forEach((s) => s.onchange = () => save({ comfort: { [s.dataset.comfort]: s.value } }, 'Saved.'));
      const nr = $('[data-narrator]', el); if (nr) nr.onchange = () => save({ voice: { narrator: nr.value } }, 'Saved.');
      const vw = $('[data-voicew]', el); if (vw) vw.onchange = () => save({ voice: { written: vw.value } }, 'Saved.');
      const nf = $('[data-never]', el); if (nf) nf.onsubmit = (e) => { e.preventDefault(); const x = nf.w.value.trim(); if (x) save({ never: x }, `Brew will never write “${x}”.`); };
      $$('[data-import]', el).forEach((b) => b.onclick = openImport);
      $('[data-share]', el).onclick = (e) => openShare(e.currentTarget);
      /* the index follows the chapter on screen */
      const toc = $$('[data-toc]', el); if ('IntersectionObserver' in window && toc.length) { const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) toc.forEach((a) => a.classList.toggle('on', a.dataset.toc === x.target.dataset.ch)); }), { rootMargin: '-20% 0px -70% 0px' }); $$('.bb-ch', el).forEach((s) => io.observe(s)); }
    }

    /* ---------- edit any line in place ---------- */
    function openEdit(b) {
      const path = b.dataset.edit, kind = b.dataset.kind, host = b.closest('.bb-line, .bb-add, .bb-cover') || b.parentElement;
      const f = document.createElement('form'); f.className = 'bb-editf';
      f.innerHTML = `<label><span>${esc(b.dataset.label || 'Edit')}${kind === 'list' ? ' (one per line)' : ''}</span><textarea rows="${kind === 'list' ? 5 : 3}">${esc(b.dataset.value || '')}</textarea></label>
        <div class="bb-editb"><label class="bb-priv"><input type="checkbox" name="priv"> Keep this out of the shared link and kit</label><button type="button" class="bb-btn" data-x>Cancel</button><button class="bb-btn is-main">Save</button></div>`;
      host.after(f); host.hidden = true; const ta = $('textarea', f); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      $('[data-x]', f).onclick = () => { f.remove(); host.hidden = false; };
      f.onsubmit = (e) => { e.preventDefault(); const raw = ta.value.trim(); const value = kind === 'list' ? raw.split('\n').map((x) => x.trim()).filter(Boolean) : raw;
        save({ edit: { path, value, private: f.priv.checked } }, 'Saved. Brew writes this way from now on.'); };
    }

    /* ---------- share: the link, the kit, a prompt any AI can use ---------- */
    function openShare(at) {
      $('.bb-menu')?.remove(); const sh = S.data.share || {}, abs = (p) => new URL(p, location.origin).href, name = S.data.book?.cover?.name || S.data.book?.name || 'this brand';
      const ask = `Use the brand book at ${abs(sh.md)} for everything you write or design for ${name}: follow its voice, words, never-say list, look and claims.`;
      const m = document.createElement('div'); m.className = 'bb-menu'; m.setAttribute('role', 'menu');
      m.innerHTML = `<button role="menuitem" data-s="link">Copy the link</button><button role="menuitem" data-s="ai">Copy for any AI</button>
        <a role="menuitem" href="https://chatgpt.com/?q=${encodeURIComponent(ask)}" target="_blank" rel="noopener">Open in ChatGPT</a><a role="menuitem" href="https://claude.ai/new?q=${encodeURIComponent(ask)}" target="_blank" rel="noopener">Open in Claude</a><button role="menuitem" data-s="gemini">Open in Gemini</button>
        <hr><a role="menuitem" href="${esc(sh.zip)}" download>Download the kit (.zip)</a><a role="menuitem" href="${esc(sh.md)}" target="_blank" rel="noopener">brand.md</a><a role="menuitem" href="${esc(sh.json)}" target="_blank" rel="noopener">brand.json</a>
        <p>The link and kit hold what Brew read plus your team’s edits. Anything you kept private stays out.</p>`;
      document.body.appendChild(m); const r = at.getBoundingClientRect(); m.style.top = `${r.bottom + 8 + scrollY}px`; m.style.right = `${Math.max(12, innerWidth - r.right)}px`;
      const close = (e) => { if (!m.contains(e.target) && e.target !== at) { m.remove(); document.removeEventListener('click', close, true); } }; setTimeout(() => document.addEventListener('click', close, true));
      m.onclick = async (e) => { const s = e.target.closest('[data-s]')?.dataset.s; if (!s) return; e.preventDefault();
        if (s === 'link') { await navigator.clipboard?.writeText(abs(sh.page)); toast('Link copied. Anyone with it sees the brand book.'); }
        if (s === 'ai' || s === 'gemini') { const md = await fetch(sh.md).then((r) => r.text()).catch(() => ''); await navigator.clipboard?.writeText(md || ask); toast(md ? 'Brand book copied. Paste it into any AI chat or project.' : 'Copied the link for your AI.'); if (s === 'gemini') window.open('https://gemini.google.com/app', '_blank', 'noopener'); }
        m.remove(); };
    }

    /* ---------- bring your brand book: files, a ZIP, a link or text; Brew proposes, the team takes it in one tap ---------- */
    function openImport() {
      $('.bb-sheet')?.remove(); const v = S.data.book || {}, waiting = (v.uploads || []).filter((u) => !u.applied);
      const sh = document.createElement('div'); sh.className = 'bb-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-label', 'Bring your brand book');
      sh.innerHTML = `<div class="bb-sheet-in"><header><h2>Bring your brand book</h2><button class="bb-btn" data-close aria-label="Close">Close</button></header>
        <p class="bb-quiet">Wherever it lives. Brew reads it and shows you what it would change before anything does.</p>
        <label class="bb-drop" tabindex="0"><input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.key,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.svg,.ttf,.otf,.woff,.woff2,.zip"><b>Drop files here or choose them</b><span>Guidelines PDF, a deck, Word or Excel, your logo, font files, or a ZIP of all of it</span></label>
        <form class="bb-linkf"><input name="u" type="url" placeholder="Paste a link: Google Drive or Docs, Notion, Figma, Canva, a brand portal or any page" aria-label="Link to your brand book"><button class="bb-btn">Read it</button></form>
        <details class="bb-textd"><summary>Or paste your tone notes and rules</summary><form class="bb-textf"><textarea name="t" rows="5" placeholder="How you sound, words you never use, claims you can make…"></textarea><button class="bb-btn">Read it</button></form></details>
        <label class="bb-priv"><input type="checkbox" name="keep" checked> Keep what’s in these private (left out of the shared link and kit)</label>
        <div class="bb-props"></div></div>`;
      document.body.appendChild(sh); const props = $('.bb-props', sh), keep = () => $('[name=keep]', sh).checked;
      const close = () => { sh.remove(); }; $('[data-close]', sh).onclick = close; sh.onclick = (e) => { if (e.target === sh) close(); };
      const busy = (t) => { props.insertAdjacentHTML('afterbegin', `<p class="bb-reading" data-busy><brew-load class="spin"></brew-load>${esc(t)}</p>`); };
      const done = () => $('[data-busy]', props)?.remove();
      const show = (u) => { const card = document.createElement('div'); card.className = 'bb-prop'; card.dataset.id = u.id;
        const kitBits = [u.kit?.colors?.length ? `<li><label><input type="checkbox" checked data-kit="colors"> Colours <span class="bb-dots">${u.kit.colors.map((c) => `<i style="background:${esc(c.hex)}" title="${esc(c.hex)}"></i>`).join('')}</span></label></li>` : '',
          u.kit?.fonts && Object.keys(u.kit.fonts).length ? `<li><label><input type="checkbox" checked data-kit="fonts"> Fonts: ${esc(Object.entries(u.kit.fonts).map(([r, f]) => `${f} for ${r === 'heading' ? 'headings' : 'body'}`).join(', '))}</label></li>` : '',
          u.kit?.logo ? `<li><label><input type="checkbox" checked data-kit="logo"> Logo <img src="${esc(u.kit.logo)}" alt="" class="bb-mini"></label></li>` : '',
          u.neverSay?.length ? `<li><label><input type="checkbox" checked data-kit="never"> Never say: ${esc(u.neverSay.slice(0, 8).join(', '))}${u.neverSay.length > 8 ? '…' : ''}</label></li>` : ''].join('');
        card.innerHTML = `<h3>From ${esc(u.name)}</h3><ul>${kitBits}${(u.proposed || []).map((x) => `<li><label><input type="checkbox" ${x.confirmed ? '' : 'checked'} data-path="${esc(x.path)}"> <b>${esc(x.label)}</b>${x.confirmed ? ' <em>you confirmed the current one</em>' : ''}<span>${esc(Array.isArray(x.value) ? x.value.map((y) => typeof y === 'object' ? Object.values(y).filter(Boolean).join(': ') : y).join('; ') : typeof x.value === 'object' ? Object.values(x.value || {}).flat().filter(Boolean).join('; ') : x.value)}</span></label></li>`).join('')}</ul>
          <div class="bb-editb"><button class="bb-btn" data-skip>Not now</button><button class="bb-btn is-main" data-use>Use these</button></div>`;
        props.appendChild(card);
        $('[data-skip]', card).onclick = () => card.remove();
        $('[data-use]', card).onclick = async () => { const paths = $$('[data-path]', card).filter((c) => c.checked).map((c) => c.dataset.path), kitOff = $$('[data-kit]', card).filter((c) => !c.checked).map((c) => c.dataset.kit);
          const ok = await save({ applyUpload: { id: u.id, paths, ...(kitOff.length ? { skipKit: kitOff } : {}), overrideConfirmed: $$('[data-path]', card).some((c) => c.checked && c.closest('li').querySelector('em')) } }, `Brand Book updated from ${u.name}.`);
          if (ok) card.remove(); if (!$('.bb-prop', sh)) close(); };
      };
      for (const u of waiting) show({ ...u, proposed: u.proposed || [] });
      const send = async (body, label) => { busy(`Reading ${label}`); const r = await api('POST', `${base}/import`, { ...body, private: keep() }); done();
        if (!r || r.error) { props.insertAdjacentHTML('afterbegin', `<p class="bb-err">${esc(r?.error || 'That didn’t go through. Try again.')}</p>`); return; }
        if (r.upload.kind === 'font' || r.upload.kind === 'logo' || r.upload.proposed?.length || r.upload.kit || r.upload.neverSay?.length) show(r.upload); };
      const files = async (list) => { for (const f of list) { if (f.size > 25e6) { props.insertAdjacentHTML('afterbegin', `<p class="bb-err">${esc(f.name)} is over 25 MB. Upload it as a smaller PDF.</p>`); continue; }
        const data = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); }); await send({ name: f.name, type: f.type, data }, f.name); } };
      const drop = $('.bb-drop', sh), inp = $('input[type=file]', sh); inp.onchange = () => files([...inp.files]);
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('is-over'); }; drop.ondragleave = () => drop.classList.remove('is-over');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('is-over'); files([...e.dataTransfer.files]); };
      $('.bb-linkf', sh).onsubmit = (e) => { e.preventDefault(); const u = e.target.u.value.trim(); if (u) send({ url: u }, 'the link'); };
      $('.bb-textf', sh).onsubmit = (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (t) send({ text: t, name: 'Your notes' }, 'your notes'); };
    }

    if (S.data) paint(); else { el.innerHTML = '<div class="bb-empty"><brew-load class="spin"></brew-load><p>Opening the Brand Book</p></div>'; }
    load();
  }
  window.BrandBook = { render };
})();
