/* The Brand Book page (#v=brand, and the shared /<slug>/brand page). A book dressed in the brand itself: the cover is their
   colour with their logo, every chapter title is set in their own heading font, the colour chips are theirs. Brew's chrome
   stays quiet around it. The team edits any line in place (a source chip says where each line came from), brings their own
   brand book (a file, a ZIP, a link or pasted text) and shares it in one tap: the link, the kit, or a prompt any AI can use.
   window.BrandBook.render(el, { slug, api, toast, readOnly, data }) */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const lum = (hex) => { const h = String(hex || '#888').replace('#', ''), f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const SRC = { team: 'Your team', read: 'From your site', shopify: 'From your Shopify settings' };
  const srcLabel = (s) => !s ? null : s.startsWith('upload:') ? `From ${s.slice(7)}` : SRC[s] || s;
  const fontsLoaded = new Set();
  /* a face loads once per file: an uploaded file for a name that first loaded from Google still takes over (names match in any case) */
  const loadFont = (name, files = []) => {
    if (!name) return; const own = (files || []).find((f) => String(f.family || '').toLowerCase() === String(name).toLowerCase()), key = `${name}|${own?.src || 'google'}`; if (fontsLoaded.has(key)) return; fontsLoaded.add(key);
    if (own && /^\/b\/[a-z0-9-]+\/a\/font-[\w.-]+$/.test(own.src)) { const st = document.createElement('style'); st.textContent = `@font-face{font-family:"${name.replace(/["\\<>]/g, '')}";src:url("${own.src}");font-display:swap}`; document.head.appendChild(st); return; }
    const fam = encodeURIComponent(name).replace(/%20/g, '+'); for (const href of [`https://fonts.googleapis.com/css2?family=${fam}&display=swap`, `https://fonts.googleapis.com/css2?family=${fam}:wght@400;600;700&display=swap`]) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
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
    const loadRefs = async () => { const r = await api('GET', `/api/brands/${encodeURIComponent(ctx.slug)}/references`).catch(() => null); S.refs = Array.isArray(r?.items) ? r.items : []; };
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
      const rmx = (path, i) => edit ? `<button class="bb-x" data-rm="${esc(path)}" data-i="${i}" aria-label="Remove">×</button>` : '';
      const list = (path, items, label, cls = 'bb-chips') => items?.length ? `<div class="bb-line"><ul class="${cls}">${items.map((x, i) => `<li>${esc(x)}${rmx(path, i)}</li>`).join('')}</ul>${pen(path, items, 'list', label)}${chip(path)}</div>` : empty(path, label, 'list');
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
          `${(v.neverSay || []).length || (v.never || []).length || edit ? `<div class="bb-line"><h3>Never say</h3>` : ''}${(v.neverSay || []).length || (v.never || []).length ? `<ul class="bb-chips is-never">${[...new Set([...(v.neverSay || []), ...(v.never || [])])].map((x) => `<li>${esc(x)}${edit && (v.neverSay || []).includes(x) ? `<button class="bb-x" data-unnever="${esc(x)}" aria-label="Remove">×</button>` : ''}</li>`).join('')}</ul>` : ''}${edit ? '<form class="bb-neverf" data-never><input name="w" placeholder="Add a word or claim they never use" aria-label="Add a never-say word"><button>Add</button></form>' : ''}${(v.neverSay || []).length || (v.never || []).length || edit ? '</div>' : ''}`].join(''),
        products: [pr.heroes?.length ? `<div class="bb-prods">${pr.heroes.map((p) => { const own = (S.refs || []).filter((r) => r.job === 'product' && r.product && r.product.toLowerCase() === String(p.title || '').toLowerCase());
          return `<article class="bb-prod">${rmx('products.heroes', pr.heroes.indexOf(p))}${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}<h3>${link(p.url, p.title)}</h3><p class="bb-price">${esc(p.price || '')}${p.mrp ? ` <s>${esc(p.mrp)}</s>` : ''}</p>${p.about ? `<p>${esc(p.about)}</p>` : ''}${edit ? `<p class="bb-prod-more">${own.length ? `<span class="bb-thumbs">${own.slice(0, 4).map((r) => `<img src="${esc(r.url)}" alt="${esc(r.label)}" loading="lazy">`).join('')}</span>` : ''}<button class="bb-link" data-prodphoto="${esc(p.title || '')}" title="Its back, a side or a close-up: every picture and video Brew makes of it uses them">${own.length ? `${own.length} photo${own.length > 1 ? 's' : ''} · add more` : '＋ Add photos'}</button></p>` : ''}</article>`; }).join('')}</div>` : '',
          pr.tiers?.length ? `<div class="bb-tiers">${pr.tiers.map((t) => `<div class="bb-tier"><b>${esc(t.name)}</b><span>${esc(t.from === t.to ? t.from : `${t.from} to ${t.to}`)}</span><small>${t.n} product${t.n === 1 ? '' : 's'}${t.eg ? `, like ${esc(t.eg)}` : ''}</small></div>`).join('')}</div>` : '',
          (pr.offers?.length || pr.guarantee || pr.returns) ? `<dl class="bb-facts">${pr.offers?.length ? `<div><dt>Offers on the site</dt><dd>${pr.offers.map(esc).join('<br>')}</dd></div>` : ''}${pr.guarantee ? `<div><dt>Promise</dt><dd>${esc(pr.guarantee)}</dd></div>` : ''}${pr.returns ? `<div><dt>Returns</dt><dd>${esc(pr.returns)}</dd></div>` : ''}${pr.sells === 'by enquiry' ? '<div><dt>How it sells</dt><dd>By enquiry</dd></div>' : ''}</dl>` : '',
          v.naming?.pattern ? `<div class="bb-line"><h3>How they name things</h3><p>${esc(v.naming.pattern)}</p>${v.naming.examples?.length ? `<ul class="bb-chips">${v.naming.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''].join(''),
        people: [pe.personas?.length ? `<div class="bb-personas">${pe.personas.map((p) => `<article class="bb-persona"><h3>${esc(p.name)}</h3><p>${esc(p.who)}</p>${p.job ? `<p class="bb-quiet">Wants: ${esc(p.job)}</p>` : ''}</article>`).join('')}</div>` : '',
          pe.objections?.length ? `<div class="bb-line"><h3>What makes them hesitate</h3><ul class="bb-list">${pe.objections.map((o) => `<li><b>${esc(o.text)}</b>${o.answer ? `<span>${esc(o.answer)}</span>` : ''}</li>`).join('')}</ul></div>` : '',
          (pe.praise?.length || pe.complaints?.length) ? `<div class="bb-wcols">${pe.praise?.length ? `<div><h3>They love</h3><ul class="bb-list">${pe.praise.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${pe.complaints?.length ? `<div><h3>They complain about</h3><ul class="bb-list">${pe.complaints.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''].join(''),
        proof: [(v.claims || []).length ? `<div class="bb-line"><h3>Claims they can make</h3><ul class="bb-list">${v.claims.slice(0, 10).map((c) => `<li>${esc(c.text)}${c.src ? ` <a class="bb-srcl" href="${esc(c.src)}" target="_blank" rel="noopener">source</a>` : ''}</li>`).join('')}</ul></div>` : '',
          pf.ratings?.length ? `<div class="bb-ratings">${pf.ratings.map((r) => `<div class="bb-rating"><b>${r.rating ? `${(+r.rating).toFixed(1)}★` : esc(Number(r.count).toLocaleString())}</b><span>${r.rating ? `${esc(Number(r.count).toLocaleString())} reviews` : 'reviews'} on ${link(r.url, r.where)}</span></div>`).join('')}</div>` : '',
          pf.quotes?.length ? `<div class="bb-quotes">${pf.quotes.slice(0, 4).map((q) => `<blockquote>${esc(q.text)}${q.product ? `<cite>${esc(q.product)}</cite>` : ''}</blockquote>`).join('')}</div>` : ''].join(''),
        library: !fams.length ? '' : ctx.print ? fams.map((f) => `<h3>${esc(F[f] || f)}</h3><div class="bb-wall">${lib[f].map((r) => `<figure class="bb-ref"><img src="${esc(r.src)}" alt="" loading="eager">${r.proof ? `<span class="bb-proof">${esc(r.proof)}</span>` : ''}<figcaption>${r.why ? `<b>${esc(r.why)}</b>` : ''}${r.words ? `<span>${esc(r.words)}</span>` : ''}</figcaption></figure>`).join('')}</div>`).join('') : fams.length ? `<div class="bb-tabs" role="tablist">${fams.map((f) => `<button role="tab" aria-selected="${f === S.fam}" data-fam="${esc(f)}">${esc(F[f] || f)}<small>${lib[f].length}</small></button>`).join('')}</div>
          <div class="bb-wall">${(lib[S.fam] || []).map((r) => `<figure class="bb-ref">${r.video ? `<video src="${esc(r.video)}" poster="${esc(r.src)}" muted loop playsinline preload="none" data-hoverplay></video>` : `<img src="${esc(r.src)}" alt="" loading="lazy">`}${r.proof ? `<span class="bb-proof">${esc(r.proof)}</span>` : ''}<figcaption>${r.why ? `<b>${esc(r.why)}</b>` : ''}${r.detail ? `<small class="bb-detail">${esc(r.detail)}</small>` : ''}${r.words ? `<span>${esc(r.words)}</span>` : ''}${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open the original</a>` : ''}</figcaption></figure>`).join('')}</div>` : '',
        playbooks: (v.playbooks || []).length ? `<div class="bb-plays">${v.playbooks.map((p) => `<article class="bb-play"><div class="bb-mock" data-f="${esc(p.family)}"><span class="bb-mock-h"></span><span class="bb-mock-l"></span></div><h3>${esc(F[p.family] || p.family)}</h3><dl>${[['Layout', p.layout], ['Headline', p.headline], ['Words on it', p.wordsOnImage], ['Logo', p.logo], ['Call to action', p.cta], ['Never', p.avoid]].filter((x) => x[1]).map(([t, x]) => `<div><dt>${t}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></article>`).join('')}</div>` : '',
        reach: [(v.channels || []).length ? `<ul class="bb-chan">${v.channels.map((c) => `<li><a href="${esc(c.url)}" target="_blank" rel="noopener"><b>${esc(c.net === 'x' ? 'X' : c.net[0].toUpperCase() + c.net.slice(1))}</b>${c.handle ? `<span>@${esc(c.handle)}</span>` : ''}</a></li>`).join('')}</ul>` : '',
          v.markets?.primary ? `<dl class="bb-facts"><div><dt>Sells mainly in</dt><dd>${esc(v.markets.primary)}${v.markets.others?.length ? `, also ${esc(v.markets.others.join(', '))}` : ''}</dd></div>${v.markets.currency ? `<div><dt>Currency</dt><dd>${esc(v.markets.currency)}</dd></div>` : ''}${v.markets.festival ? `<div><dt>Next big date</dt><dd>${esc(v.markets.festival)}</dd></div>` : ''}</dl>` : ''].join(''),
        rivals: (v.rivals || []).length ? `<ul class="bb-list is-rivals">${v.rivals.map((r, i) => `<li>${rmx('rivals', i)}<b>${r.host ? link(`https://${r.host}`, r.name) : esc(r.name)}</b>${r.why ? `<span>${esc(r.why)}</span>` : ''}</li>`).join('')}</ul><p class="bb-quiet">Brew never copies a rival’s product, name, words or people into ${esc(cov.name || 'your')} work.</p>` : '',
        rules: !ctx.readOnly && v.comfort ? `<dl class="bb-facts is-rules">${Object.entries(d.options?.comfort || {}).map(([key, o]) => `<div><dt>${esc(o.label)}</dt><dd>${edit ? `<select data-comfort="${esc(key)}" aria-label="${esc(o.label)}">${Object.entries(o.options).map(([ok, ol]) => `<option value="${esc(ok)}"${v.comfort[key] === ok ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>` : esc(o.options[v.comfort[key]] || '')}</dd></div>`).join('')}
          <div><dt>Narrator</dt><dd>${edit ? `<select data-narrator aria-label="Narrator voice">${(d.options?.narrators || []).map((n) => `<option value="${esc(n.id)}"${v.voice?.narrator === n.id ? ' selected' : ''}>${esc(n.label)}</option>`).join('')}</select>` : esc(v.voice?.narrator || '')}</dd></div>
          <div><dt>Written voice</dt><dd>${edit ? `<select data-voicew aria-label="Written voice">${Object.entries(d.options?.voices || {}).map(([vk, vl]) => `<option value="${esc(vk)}"${v.voice?.written === vk ? ' selected' : ''}>${esc(vl)}</option>`).join('')}</select>` : esc(d.options?.voices?.[v.voice?.written] || '')}</dd></div></dl>` : ''
      };
      const subs = { library: 'Their own work, best first. Brew makes new pieces from the ones that match what it’s making.', playbooks: 'How each format usually looks for them, read from their own posts and ads.', proof: 'Only what can be shown. Brew’s writers quote these and nothing else.' };
      const shown = CHAPTERS.map(([id], i) => [id, i + 1]).filter(([id]) => chapters[id] && chapters[id].replace(/<[^>]+>/g, '').trim());
      const body = shown.map(([id], i) => sec(id, String(i + 1).padStart(2, '0'), chapters[id], subs[id])).join('');
      const ups = (v.uploads || []).filter((u) => !u.applied);
      el.className = 'bb'; el.innerHTML = `
        <div class="bb-bar">${ctx.back ? `<button class="bb-back" data-nav="${esc(ctx.back.nav)}">${esc(ctx.back.label)}</button>` : ''}${edit ? '' : `<span class="bb-made">${ctx.readOnly ? 'A brand book by Brew' : 'Your team edits this book. Ask them to add you.'}</span>`}
          <div class="bb-share"><button class="bb-btn is-main" data-share aria-haspopup="dialog">Share</button></div></div>
        ${d.building && !ctx.readOnly ? `<p class="bb-building"><brew-load class="spin"></brew-load>Brew is writing the voice, story and look from ${esc(v.host || 'the site')}. The rest is already here.</p>` : ''}
        ${v.book?.error && !d.building && edit ? `<p class="bb-note">${esc(v.book.error)}</p>` : ''}
        <header class="bb-cover"><div class="bb-cover-in">${k.logo ? `<img class="bb-cover-logo" src="${esc(k.logo)}" alt="${esc(cov.name || v.name || '')}">` : `<p class="bb-cover-name">${esc(cov.name || v.name || '')}</p>`}
          <h1>${esc(cov.tagline || cov.oneLine || cov.name || v.name || '')}</h1>${cov.tagline && cov.oneLine ? `<p>${esc(cov.oneLine)}</p>` : ''}
          <div class="bb-cover-strip">${roles.slice(0, 6).map((c) => `<span style="background:${esc(c.hex)}"></span>`).join('')}</div></div>
          ${edit ? `<button class="bb-pen is-cover" data-edit="cover.tagline" data-kind="text" data-label="Tagline" data-value="${esc(cov.tagline || '')}">Edit tagline</button>` : ''}</header>
        <div class="bb-body"><nav class="bb-toc" aria-label="Chapters"><ol>${shown.map(([id], i) => `<li><a href="#bb-${id}" data-toc="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(CHAPTERS.find((c) => c[0] === id)[1])}</a></li>`).join('')}</ol></nav>
          <main class="bb-main">${body || `<p class="bb-note">Brew is still reading ${esc(v.host || 'the site')}. The book fills in as it reads.</p>`}
          ${ctx.readOnly ? `<footer class="bb-foot"><p>Made by Brew from ${esc(v.host || 'the brand’s')} own site, ads and posts.</p><a class="bb-btn is-main" href="/?ref=brand-kit">Make it yours in Brew</a></footer>` : ''}</main></div>${edit ? dockHtml(v) : ''}`;
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
      
      /* a product's own extra photos (its back, a side, a close-up): every picture and video Brew makes of it uses them, so no side is guessed */
      $$('[data-prodphoto]', el).forEach((b) => b.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp'; inp.multiple = true;
        inp.onchange = async () => { const files = [...inp.files].slice(0, 6); if (!files.length) return; b.disabled = true; b.textContent = 'Adding…'; let ok = 0; const bad = [];
          for (const f of files) { if (f.size > 8e6) { bad.push(`${f.name} is over 8 MB`); continue; } const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
            const x = data ? await api('POST', `/api/brands/${encodeURIComponent(ctx.slug)}/references`, { data, label: `${b.dataset.prodphoto} · ${f.name}`.slice(0, 80), job: 'product', product: b.dataset.prodphoto }) : { error: 'it couldn’t be read' };
            if (x?.ok) ok++; else bad.push(`${f.name}: ${x?.error || 'it didn’t upload'}`); }
          await loadRefs(); paint(); const name = esc(b.dataset.prodphoto);
          toast([ok ? `${ok} photo${ok > 1 ? 's' : ''} added. Every picture and video of ${name} now uses ${ok > 1 ? 'them' : 'it'}.` : '', bad.length ? `Not added: ${esc(bad.join('; '))}.` : ''].filter(Boolean).join(' ')); };
        inp.click(); });
      if (S.data?.canEdit && !ctx.readOnly && !S.refs && !S.refsLoading) { /* the team's own view only (wire() has no `edit` of its own) */ S.refsLoading = true; loadRefs().then(() => { S.refsLoading = false; if (S.refs.length) paint(); }); }
      /* × on any list item: the list is saved without it (an edit, so Undo brings the read back) */
      $$('[data-rm]', el).forEach((b) => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const path = b.dataset.rm, i = +b.dataset.i, cur = path.split('.').reduce((x, k2) => x?.[k2], S.data.book);
        if (!Array.isArray(cur)) return; save({ edit: { path, value: cur.filter((_, j) => j !== i) } }, 'Removed. Undo is on the chip.'); });
      $$('[data-unnever]', el).forEach((b) => b.onclick = () => save({ unnever: b.dataset.unnever }, `Brew may use “${b.dataset.unnever}” again.`));
      $('[data-share]', el).onclick = () => openShare();
      wireDock();
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
    /* ---------- the composer: tell Brew anything, paste a link or drop files; every change comes back as a card to take ---------- */
    function dockHtml(v) {
      const n = v.cover?.name || v.name || 'your brand';
      return `<div class="bb-dock" data-dock><div class="bb-cards" data-cards></div>
        <div class="bb-ideas" data-ideas>${['Add a product to our heroes', 'Change our tagline to …', 'Never say “…”', 'Make the voice warmer', 'Remove a rival'].map((x) => `<button type="button" data-idea="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <form class="bb-ask" data-ask><button type="button" class="bb-attach" data-attach aria-label="Add files: guidelines, deck, logo, fonts"><span aria-hidden="true">+</span></button>
          <input name="q" autocomplete="off" placeholder="Tell Brew what to change in ${esc(n)}’s book, or paste a link…" aria-label="Tell Brew what to change">
          <button class="bb-send" aria-label="Send"><span aria-hidden="true">↑</span></button>
          <input type="file" hidden multiple data-files accept=".pdf,.doc,.docx,.ppt,.pptx,.key,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.svg,.ttf,.otf,.woff,.woff2,.zip"></form></div>`;
    }
    const valText = (x) => x == null || x === '' ? '' : esc(x);
    function changeCard(u, reply) {
      const c = document.createElement('div'); c.className = 'bb-change'; c.dataset.id = u.id;
      const kit = u.kit || {}, rows = [
        ...(u.proposed || []).map((x) => `<li><label><input type="checkbox" ${x.confirmed ? '' : 'checked'} data-path="${esc(x.path)}"><span class="bb-ch-l">${esc(x.label)}</span>${x.confirmed ? '<em>you confirmed the old one</em>' : ''}</label>
          <div class="bb-diff">${x.before ? `<s>${valText(x.before)}</s><i aria-hidden="true">→</i>` : '<i class="bb-new">new</i>'}<b>${valText(x.after) || '<span class="bb-quiet">removed</span>'}</b></div></li>`),
        kit.colors?.length ? `<li><label><input type="checkbox" checked data-kit="colors"><span class="bb-ch-l">Colours</span></label><div class="bb-diff"><span class="bb-dots">${kit.colors.map((c2) => `<i style="background:${esc(c2.hex)}" title="${esc(c2.hex)}"></i>`).join('')}</span></div></li>` : '',
        kit.fonts && Object.keys(kit.fonts).length ? `<li><label><input type="checkbox" checked data-kit="fonts"><span class="bb-ch-l">Fonts</span></label><div class="bb-diff"><b>${esc(Object.entries(kit.fonts).map(([r, f]) => `${f} for ${r === 'heading' ? 'headings' : 'body'}`).join(', '))}</b></div></li>` : '',
        kit.logo ? `<li><label><input type="checkbox" checked data-kit="logo"><span class="bb-ch-l">Logo</span></label><div class="bb-diff"><img src="${esc(kit.logo)}" alt="" class="bb-mini"></div></li>` : '',
        u.neverSay?.length || u.dropNever?.length ? `<li><label><input type="checkbox" checked data-kit="never"><span class="bb-ch-l">Never say</span></label><div class="bb-diff">${(u.neverSay || []).map((w) => `<b class="bb-tag is-add">+ ${esc(w)}</b>`).join('')}${(u.dropNever || []).map((w) => `<b class="bb-tag is-drop">− ${esc(w)}</b>`).join('')}</div></li>` : ''].join('');
      c.innerHTML = `<header><span class="bb-from">${u.kind === 'ask' ? 'You asked' : `From ${esc(u.from ? `${u.from}: ` : '')}${esc(u.name)}`}</span>${u.kind === 'ask' ? `<b>${esc(u.name)}</b>` : ''}${reply ? `<p>${esc(reply)}</p>` : ''}</header>
        <ul>${rows}</ul><footer><button type="button" class="bb-btn" data-skip>Not now</button><button type="button" class="bb-btn is-brand" data-use>Use these</button></footer>`;
      $('[data-skip]', c).onclick = () => c.remove();
      $('[data-use]', c).onclick = async () => { const paths = $$('[data-path]', c).filter((x) => x.checked).map((x) => x.dataset.path), kitOff = $$('[data-kit]', c).filter((x) => !x.checked).map((x) => x.dataset.kit);
        const ok = await save({ applyUpload: { id: u.id, paths, ...(kitOff.length ? { skipKit: kitOff } : {}), overrideConfirmed: $$('[data-path]', c).some((x) => x.checked && x.closest('li').querySelector('em')) } }, 'Done. Brew writes and makes things this way from now on.');
        if (ok) c.remove(); };
      return c;
    }
    function thinking(label) { const c = document.createElement('div'); c.className = 'bb-change is-busy'; c.innerHTML = `<header><span class="bb-from">${esc(label)}</span><p><brew-load class="spin"></brew-load> Reading it and working out the changes…</p></header>`; return c; }
    function wireDock() {
      const dock = $('[data-dock]', el); if (!dock) return; const cards = $('[data-cards]', dock), form = $('[data-ask]', dock), q = form.q, files = $('[data-files]', dock);
      for (const u of (S.data.book?.uploads || []).filter((x) => !x.applied && (x.proposed?.length || x.kit || x.neverSay?.length))) cards.appendChild(changeCard(u));
      const send = async (body, label) => { const w = thinking(label); cards.appendChild(w); w.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const r = await api('POST', `${base}/${body.url || body.data || body.text && body.name ? 'import' : 'ask'}`, body); w.remove();
        if (!r || r.error) { const e = document.createElement('div'); e.className = 'bb-change is-err'; e.innerHTML = `<header><p>${esc(r?.error || 'That didn’t go through. Try again.')}</p></header>`; cards.appendChild(e); setTimeout(() => e.remove(), 9000); return; }
        if (!r.upload) { toast(r.reply || 'Nothing to change there.'); return; }
        cards.appendChild(changeCard(r.upload, r.reply)); };
      form.onsubmit = (e) => { e.preventDefault(); const x = q.value.trim(); if (!x) return; q.value = '';
        if (/^https?:\/\/\S+$/i.test(x)) send({ url: x, private: false }, 'Reading the link'); else send({ text: x }, `You asked: “${x.slice(0, 80)}”`); };
      $$('[data-idea]', dock).forEach((b) => b.onclick = () => { q.value = b.dataset.idea.replace(/ …|“…”/, ''); q.focus(); });
      const upload = async (list) => { for (const f of list) { if (f.size > 25e6) { toast(`${f.name} is over 25 MB. Upload it as a smaller PDF.`); continue; }
        const data = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); }); await send({ name: f.name, type: f.type, data, private: false }, `Reading ${f.name}`); } };
      $('[data-attach]', dock).onclick = () => files.click(); files.onchange = () => upload([...files.files]);
      /* drop a file anywhere on the book */
      let depth = 0; const over = () => el.querySelector('.bb-dropzone') || el.appendChild(Object.assign(document.createElement('div'), { className: 'bb-dropzone', innerHTML: `<div><b>Drop it into ${esc(S.data.book?.cover?.name || S.data.book?.name || 'the')} brand book</b><span>Guidelines, decks, logos, fonts, a ZIP. Brew shows you what changes first.</span></div>` }));
      el.ondragenter = (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; depth++; over(); }; el.ondragleave = () => { if (--depth <= 0) { depth = 0; el.querySelector('.bb-dropzone')?.remove(); } };
      el.ondragover = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
      el.ondrop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; el.querySelector('.bb-dropzone')?.remove(); upload([...e.dataTransfer.files]); };
    }

    /* ---------- share: one sheet, the book's own cover on top; every tile says it worked ---------- */
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; } };
    function openShare() {
      $('.bb-share-sheet')?.remove(); const d = S.data, v = d.book || {}, sh = d.share || {}, abs = (p) => new URL(p, location.origin).href, name = v.cover?.name || v.name || 'this brand', k = v.kit || {};
      const ask = `Use the brand book at ${abs(sh.md)} for everything you write or design for ${name}: follow its voice, words, never-say list, look and claims.`;
      const w = document.createElement('div'); w.className = 'bb-share-sheet'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', `Share ${name}’s brand book`);
      w.style.setProperty('--bb-1', el.style.getPropertyValue('--bb-1')); w.style.setProperty('--bb-2', el.style.getPropertyValue('--bb-2')); w.style.setProperty('--bb-on', el.style.getPropertyValue('--bb-on')); w.style.setProperty('--bb-head', el.style.getPropertyValue('--bb-head'));
      w.innerHTML = `<div class="bb-ss"><button class="bb-ss-x" data-x aria-label="Close">✕</button>
        <div class="bb-ss-cover">${k.logo ? `<img src="${esc(k.logo)}" alt="">` : ''}<b>${esc(name)}</b><span>${esc(v.cover?.tagline || v.cover?.oneLine || 'Brand book')}</span><div class="bb-ss-strip">${(k.roles || []).slice(0, 5).map((c) => `<i style="background:${esc(c.hex)}"></i>`).join('')}</div></div>
        <div class="bb-ss-body"><h2>Share the brand book</h2><p>What Brew read plus your team’s edits. Anything you kept private stays out.</p>
          <div class="bb-tiles"><button class="bb-tile" data-copy-link><b>Copy link</b><span>Anyone with it sees the book</span></button>
            <a class="bb-tile" href="${esc(sh.pdf || sh.page + '.pdf')}" target="_blank" rel="noopener"><b>PDF</b><span>Print-ready, every chapter</span></a>
            <a class="bb-tile" href="${esc(sh.zip)}" download><b>Brand kit</b><span>Logos, colours, fonts, references, PDF</span></a></div>
          <h3>Use it with any AI</h3><div class="bb-ais"><a href="https://chatgpt.com/?q=${encodeURIComponent(ask)}" target="_blank" rel="noopener">ChatGPT</a><a href="https://claude.ai/new?q=${encodeURIComponent(ask)}" target="_blank" rel="noopener">Claude</a><button data-gemini>Gemini</button><button data-prompt>Copy as prompt</button></div></div></div>`;
      document.body.appendChild(w); setTimeout(() => w.classList.add('is-in'), 16);
      const close = () => { w.classList.remove('is-in'); setTimeout(() => w.remove(), 180); document.removeEventListener('keydown', esc1); }, esc1 = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc1); w.onclick = (e) => { if (e.target === w) close(); }; $('[data-x]', w).onclick = close;
      const done = (b, label) => { const o = b.innerHTML; b.classList.add('is-done'); b.innerHTML = `<b>${label}</b>`; setTimeout(() => { b.classList.remove('is-done'); b.innerHTML = o; }, 1800); };
      /* a browser that blocks the clipboard still gets the link: shown, selected, ready to copy by hand */
      const showLink = (text) => { let i = $('.bb-ss-link', w); if (!i) { i = document.createElement('input'); i.className = 'bb-ss-link'; i.readOnly = true; i.setAttribute('aria-label', 'Link to copy'); $('.bb-tiles', w).after(i); } i.value = text; i.focus(); i.select(); };
      $('[data-copy-link]', w).onclick = async (e) => { const b = e.currentTarget; if (await copy(abs(sh.page))) done(b, 'Copied ✓'); else { done(b, 'Press ⌘C'); showLink(abs(sh.page)); } };
      const md = () => fetch(sh.md).then((r) => r.text()).catch(() => '');
      $('[data-prompt]', w).onclick = async (e) => { const b = e.currentTarget; const t = await md(); if (await copy(t || ask)) done(b, 'Copied ✓'); else { done(b, 'Press ⌘C'); showLink(ask); } };
      $('[data-gemini]', w).onclick = async (e) => { const b = e.currentTarget; const t = await md(); await copy(t || ask); done(b, 'Copied, paste it in'); window.open('https://gemini.google.com/app', '_blank', 'noopener'); };
    }

    if (S.data) paint(); else { el.innerHTML = '<div class="bb-empty"><brew-load class="spin"></brew-load><p>Opening the Brand Book</p></div>'; }
    load();
  }
  window.BrandBook = { render };
})();
