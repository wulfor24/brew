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

  /* platforms: the name as each writes it, a simple mark, its colour */
  const NETS = { instagram: { n: 'Instagram', g: '◎', c: 'linear-gradient(135deg,#feda75,#d62976 55%,#4f5bd5)' }, youtube: { n: 'YouTube', g: '▶', c: '#ff0033' }, facebook: { n: 'Facebook', g: 'f', c: '#1877f2' },
    x: { n: 'X', g: '𝕏', c: '#111' }, twitter: { n: 'X', g: '𝕏', c: '#111' }, linkedin: { n: 'LinkedIn', g: 'in', c: '#0a66c2' }, tiktok: { n: 'TikTok', g: '♪', c: '#111' }, pinterest: { n: 'Pinterest', g: 'P', c: '#e60023' },
    threads: { n: 'Threads', g: '@', c: '#111' }, whatsapp: { n: 'WhatsApp', g: '✆', c: '#25d366' }, snapchat: { n: 'Snapchat', g: '👻', c: '#fffc00' } };
  /* the handle from the link when the read didn't keep one: /arata.in → @arata.in, /company/x → x; a YouTube channel id says "Channel" */
  const handleOf = (c) => { if (c.handle) return `@${String(c.handle).replace(/^@/, '')}`; try { const seg = new URL(c.url).pathname.split('/').filter(Boolean); const last = seg.at(-1) || '';
    if (!last || /^UC[\w-]{20,}$/.test(last)) return 'Channel'; return /^(company|in|channel|c|user)$/.test(seg[0]) && seg.length > 1 ? last : `@${last.replace(/^@/, '')}`; } catch { return ''; } };
  const regionOf = (m) => { try { return /^[A-Z]{2}$/i.test(m) ? new Intl.DisplayNames(['en'], { type: 'region' }).of(String(m).toUpperCase()) : m; } catch { return m; } };
  const flagOf = (m) => /^[A-Z]{2}$/i.test(m) ? String(m).toUpperCase().replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';
  const symOf = (cur) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((x) => x.type === 'currency')?.value || ''; } catch { return ''; } };
  const CHAPTERS = [
    ['story', 'Story'], ['kit', 'Look and kit'], ['voice', 'Voice'], ['words', 'Words'], ['products', 'Products'], ['people', 'People'],
    ['proof', 'Proof'], ['library', 'What {n} publishes'], ['playbooks', 'Playbooks'], ['reach', 'Where {n} shows up'], ['rivals', 'Rivals'], ['rules', 'Rules']
  ];

  function render(el, ctx) {
    const S = { data: ctx.data || null, fam: null, busy: false, cards: [], pending: [], draft: '' };
    const api = ctx.api || (async (m, p, b) => (await fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json());
    const toast = ctx.toast || ((m) => console.log(m));
    const base = `/api/brands/${encodeURIComponent(ctx.slug)}/book`;
    /* the last copy of the book this person saw paints at once (their own device), and the fresh one replaces it when it lands */
    const CK = `bb:${ctx.slug}`; if (!S.data && !ctx.readOnly) { try { const c = JSON.parse(localStorage.getItem(CK) || 'null'); if (c?.book) { S.data = { ...c, stale: true }; } } catch {} }
    const load = async () => { const d = S.data && ctx.readOnly ? S.data : await api('GET', base); if (d && !d.error && !ctx.readOnly) { try { localStorage.setItem(CK, JSON.stringify(d)); } catch {} } if (!d || d.error) { el.innerHTML = `<div class="bb-empty"><p>${esc(d?.error || 'The Brand Book didn’t open. Try again.')}</p></div>`; return; } S.data = d; paint(); if (d.building && !ctx.readOnly) poll(); };
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
      const nevers = (() => { const seen = new Set(); return [...(v.neverSay || []), ...(v.never || [])].filter((x) => x && !seen.has(String(x).toLowerCase()) && seen.add(String(x).toLowerCase())).slice(0, 18); })();
      const list = (path, items, label, cls = 'bb-chips') => items?.length ? `<div class="bb-line"><ul class="${cls}">${items.map((x, i) => `<li>${esc(x)}${rmx(path, i)}</li>`).join('')}</ul>${pen(path, items, 'list', label)}${chip(path)}</div>` : empty(path, label, 'list');
      /* a picker in the book's own style (never the OS dropdown): one pill per option, the chosen one filled; "Name · note" shows the note small */
      const picker = (kind, key, label, opts, cur) => `<div class="bb-pick" role="radiogroup" aria-label="${esc(label)}">${opts.map(([k2, l2]) => { const [a, b] = String(l2).split(' · '); return `<button type="button" role="radio" aria-checked="${cur === k2}" data-pick="${kind}" data-k="${esc(key)}" data-v="${esc(k2)}"><b>${esc(a)}</b>${b ? `<small>${esc(b)}</small>` : ''}</button>`; }).join('')}</div>`;
      const link = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
      const nm = (v.cover || {}).name || v.name || 'the brand', T = (id) => (CHAPTERS.find((c) => c[0] === id)?.[1] || '').replace('{n}', nm);
      const st = v.story || {}, tn = v.tone || {}, w = v.words || {}, pr = v.products || {}, pe = v.people || {}, pf = v.proof || {}, lk = v.look || {}, cov = v.cover || {};
      const lib = v.library || {}, fams = Object.keys(lib).filter((f) => lib[f]?.length); if (!fams.includes(S.fam)) S.fam = fams[0] || null;
      const F = d.options?.families || {};

      /* every chapter is a spread with its own layout and one signature moment, made from the brand's own colours, type, words and pictures */
      const ORDER = ['ad-winners', 'ad-image', 'ig-reel', 'ad-video', 'ig-post', 'ig-carousel', 'ad-carousel', 'tiktok', 'youtube', 'product-photo'];
      const allRefs = Object.entries(lib).sort(([a], [b]) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99).flatMap(([f, xs]) => (xs || []).map((x) => ({ ...x, family: f }))).filter((r) => r?.src);
      const familiesOf = (f) => [f, ...(/reel|video|tiktok/.test(f) ? ['ad-video', 'ig-reel', 'tiktok', 'youtube'] : /carousel/.test(f) ? ['ad-carousel', 'ig-carousel', 'ad-image'] : ['ad-winners', 'ad-image', 'ig-post', 'product-photo'])];
      const refOf = (fs) => fs.map((f) => (lib[f] || [])[0]).find(Boolean) || allRefs[0] || null;
      const ink = roles.find((c) => c.role === 'ink')?.hex || (lum(primary) < 0.3 ? primary : '#141414'), paper = roles.find((c) => c.role === 'background' && lum(c.hex) > 0.75)?.hex || '#fbfaf7';
      el.style.setProperty('--bb-ink', ink); el.style.setProperty('--bb-paper', paper); el.style.setProperty('--bb-on-ink', lum(ink) > 0.55 ? '#141414' : '#ffffff');
      const initials = (s) => String(s || '?').replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
      const tilt = (i) => [-3, 2, -1.5, 3, -2.5, 1.5][i % 6];
      const stars = (r) => '★★★★★'.slice(0, Math.round(r)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r));
      const count = (n) => `<b class="bb-count" data-count="${+n || 0}">${Number(n || 0).toLocaleString()}</b>`;
      const playMock = (p) => { const ref = refOf(familiesOf(p.family)), cta = tn.cta?.examples?.[0] || 'Shop now', head = (w.use || [])[0] || cov.name || v.name || '';
        return `<div class="bb-pm" data-f="${esc(p.family)}">${ref ? `<img src="${esc(ref.src)}" alt="" loading="lazy">` : ''}<div class="bb-pm-in">${k.logo ? `<img class="bb-pm-logo" src="${esc(k.logo)}" alt="">` : ''}<b class="bb-pm-h">${esc(head)}</b><span class="bb-pm-cta">${esc(cta)}</span></div></div>`; };
      const chapters = {
        story: [st.mission || st.positioning ? `<div class="bb-manifesto bb-line"><p>${esc(st.mission || st.positioning)}</p>${pen(st.mission ? 'story.mission' : 'story.positioning', st.mission || st.positioning, 'text', st.mission ? 'Mission' : 'Positioning')}${chip(st.mission ? 'story.mission' : 'story.positioning')}</div>` : empty('story.mission', 'Mission'),
          st.mission && st.positioning && st.positioning !== cov.oneLine ? line('story.positioning', st.positioning, 'Positioning', 'is-sub') : '',
          st.values?.length ? `<div class="bb-line"><ul class="bb-stamps">${st.values.map((x, i) => `<li style="--t:${tilt(i)}deg">${esc(x)}${rmx('story.values', i)}</li>`).join('')}</ul>${pen('story.values', st.values, 'list', 'Values')}${chip('story.values')}</div>` : empty('story.values', 'Values', 'list'),
          (v.pillars || []).length ? `<div class="bb-why"><h3>Why people buy</h3><div class="bb-why-row">${v.pillars.map((p, i) => `<article style="--t:${tilt(i + 2) / 2}deg"><b>${esc(p.pillar)}</b>${p.proof ? `<p>${esc(p.proof)}</p>` : ''}</article>`).join('')}</div></div>` : '',
          (st.founderStory || st.about) && (st.founderStory || st.about) !== (st.mission || st.positioning) ? `<div class="bb-founder bb-line"><span class="bb-kicker">Where it started</span><p>${esc(st.founderStory || st.about)}</p>${pen('story.founderStory', st.founderStory || st.about, 'text', 'Founder story')}</div>` : '',
          (st.founders?.length || st.founded || st.hq) ? `<p class="bb-meta">${[st.founders?.length && `Founded by ${st.founders.map((f) => link(f.url, f.name)).join(' and ')}`, st.founded && `since ${esc(st.founded)}`, st.hq && `in ${esc(st.hq)}`].filter(Boolean).join(', ')}</p>` : '',
          st.press?.length ? `<div class="bb-press"><span class="bb-kicker">As seen in</span><ul>${st.press.map((p) => `<li>${link(p.url, p.outlet || p.name)}</li>`).join('')}</ul></div>` : ''].join(''),
        kit: [roles.length ? `<div class="bb-fan" style="--n:${roles.length}">${roles.map((c, i) => `<button class="bb-chip" data-copy="${esc(c.hex)}" style="--c:${esc(c.hex)};--i:${i};--on:${lum(c.hex) > 0.55 ? '#141414' : '#fff'}" aria-label="Copy ${esc(c.hex)}"><span class="bb-chip-top"></span><span class="bb-chip-l"><b>${esc(c.name || c.hex.toUpperCase())}</b><small>${esc([c.role, c.share].filter(Boolean).join(' · ') || 'colour')}</small>${c.use ? `<em>${esc(c.use)}</em>` : ''}</span></button>`).join('')}</div>${chip('kit.colors')}` : '',
          k.logo || k.mark ? `<div class="bb-logo-row">${[['primary', primary], ['paper', paper], ['ink', ink]].map(([n, bg]) => `<figure class="bb-lt" style="--bg:${esc(bg)}"><img src="${esc(k.logo || k.mark)}" alt="${esc(cov.name || '')} logo" ${lum(bg) < 0.4 ? 'data-inv' : ''}><figcaption>On ${n}</figcaption></figure>`).join('')}${k.mark && k.logo ? `<figure class="bb-lt is-mark" style="--bg:${esc(primary)}"><img src="${esc(k.mark)}" alt="" ${lum(primary) < 0.4 ? 'data-inv' : ''}><figcaption>Mark</figcaption></figure>` : ''}</div>${chip('kit.logo')}` : (edit ? '<p class="bb-add">Drop your logo into the box below.</p>' : ''),
          headFont || bodyFont ? `<div class="bb-poster"><div class="bb-abc" aria-hidden="true">Aa</div><div><span class="bb-kicker">${esc([headFont && `Headings in ${headFont}`, bodyFont && bodyFont !== headFont && `body in ${bodyFont}`].filter(Boolean).join(', '))}</span>
            <p class="bb-spec-h" contenteditable="true" spellcheck="false" aria-label="Type to try the heading font">${esc(cov.tagline || cov.name || v.name || 'Aa Bb Cc')}</p><p class="bb-spec-b" contenteditable="true" spellcheck="false" aria-label="Type to try the body font">${esc(cov.oneLine || st.positioning || 'The quick brown fox jumps over the lazy dog.')}</p><p class="bb-glyphs" aria-hidden="true">ABCDEFGHIJKLM abcdefghijklm 0123456789 &amp;?!</p>${v.typeUse?.heading ? `<small>${esc(v.typeUse.heading)}</small>` : ''}</div></div>` : '',
          lk.notes ? `<div class="bb-lookbook">${(allRefs.slice(0, 3)).map((r, i) => `<img src="${esc(r.src)}" alt="" loading="lazy" style="--t:${tilt(i)}deg">`).join('')}<div class="bb-line"><span class="bb-kicker">${esc(nm)}’s look</span><p class="bb-lede">${esc(lk.notes)}</p>${pen('look.notes', lk.notes, 'text', 'Photo style')}${chip('look.notes')}
            <ul class="bb-tags">${[['Light', lk.light], ['Settings', lk.setting], ['People', lk.people], ['Props', lk.props], ['Framing', lk.framing], ['Words on pictures', lk.wordsOnImage], ['Logo', lk.logoUse], ['Packaging', lk.packaging]].filter((x) => x[1]).map(([t, x]) => `<li><b>${t}</b>${esc(x)}</li>`).join('')}</ul></div></div>` : empty('look.notes', 'Photo style')].join(''),
        voice: [tn.summary ? `<div class="bb-line bb-voice-lead"><p>${esc(tn.summary)}</p>${pen('tone.summary', tn.summary, 'text', 'How the brand sounds')}${chip('tone.summary')}</div>` : empty('tone.summary', 'How the brand sounds'),
          tn.traits?.length ? `<div class="bb-chat">${tn.traits.map((t, i) => `<div class="bb-msg${i % 2 ? ' is-r' : ''}"><span class="bb-av">${k.mark ? `<img src="${esc(k.mark)}" alt="">` : esc(initials(cov.name || v.name))}</span><div><b class="bb-trait-w">${esc(t.trait)}</b>${t.sounds ? `<p class="bb-bubble">${esc(t.sounds)}</p>` : ''}${t.why ? `<small>${esc(t.why)}</small>` : ''}</div></div>`).join('')}${chip('tone.traits')}</div>` : '',
          tn.pairs?.length ? `<div class="bb-versus"><h3>Say it like ${esc(cov.name || v.name || 'us')}</h3>${tn.pairs.map((p) => `<div class="bb-vs"><p class="is-do"><i aria-hidden="true">✓</i>${esc(p.do)}</p><p class="is-dont"><i aria-hidden="true">✕</i>${esc(p.dont)}</p></div>`).join('')}</div>` : '',
          tn.never?.length ? `<div class="bb-nevers">${tn.never.map((n, i) => `<span style="--t:${tilt(i)}deg"><s>${esc(n.text)}</s></span>`).join('')}</div>` : '',
          tn.cta?.examples?.length || tn.cta?.style ? `<div class="bb-ctas"><span class="bb-kicker">${esc(nm)}’s buttons</span><div>${(tn.cta.examples || []).map((x) => `<span class="bb-fake-btn">${esc(x)}</span>`).join('')}</div>${tn.cta.style ? `<p class="bb-quiet">${esc(tn.cta.style)}</p>` : ''}</div>` : '',
          (tn.reading || tn.language) ? `<p class="bb-meta">${[tn.language && `Writes in ${esc(tn.language)}`, tn.reading && esc(tn.reading)].filter(Boolean).join('. ')}</p>` : ''].join(''),
        words: [`<div class="bb-sheet">${[[`${esc(nm)} says`, 'words.use', w.use, 'Words we use', 'is-say'], ['Customers say', 'words.customers', w.customers, 'Words customers use', 'is-cust'], [`${esc(nm)} avoids`, 'words.avoid', w.avoid, 'Words we avoid', 'is-avoid']]
            .filter((c) => c[2]?.length || edit).map(([h, path, xs, label, cls]) => `<div class="bb-sheet-col ${cls}"><span class="bb-kicker">${h}</span>${xs?.length ? `<div class="bb-line"><ul class="bb-stickers">${xs.map((x, i) => `<li style="--t:${tilt(i) / 1.5}deg">${esc(x)}${rmx(path, i)}</li>`).join('')}</ul>${pen(path, xs, 'list', label)}${chip(path)}</div>` : empty(path, label, 'list')}</div>`).join('')}</div>`,
          `${nevers.length || edit ? `<div class="bb-stampzone"><span class="bb-kicker">Never say</span>` : ''}${nevers.length ? `<ul class="bb-rubber">${nevers.map((x, i) => `<li style="--t:${tilt(i)}deg">${esc(x)}${edit && (v.neverSay || []).includes(x) ? `<button class="bb-x" data-unnever="${esc(x)}" aria-label="Remove">×</button>` : ''}</li>`).join('')}</ul>` : ''}${edit ? '<form class="bb-neverf" data-never><input name="w" placeholder="Add a word or claim ${esc(nm)} never uses" aria-label="Add a never-say word"><button>Add</button></form>' : ''}${nevers.length || edit ? '</div>' : ''}`].join(''),
        products: [pr.heroes?.length ? `<div class="bb-shelf">${pr.heroes.map((p) => { const own = (S.refs || []).filter((r) => r.job === 'product' && r.product && r.product.toLowerCase() === String(p.title || '').toLowerCase());
          return `<article class="bb-prod">${rmx('products.heroes', pr.heroes.indexOf(p))}<div class="bb-ped">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}${p.price ? `<span class="bb-tag-price">${esc(p.price)}${p.mrp ? ` <s>${esc(p.mrp)}</s>` : ''}</span>` : ''}</div><h3>${link(p.url, p.title)}</h3>${p.about ? `<p>${esc(p.about)}</p>` : ''}${edit ? `<p class="bb-prod-more">${own.length ? `<span class="bb-thumbs">${own.slice(0, 4).map((r) => `<img src="${esc(r.url)}" alt="${esc(r.label)}" loading="lazy">`).join('')}</span>` : ''}<button class="bb-link" data-prodphoto="${esc(p.title || '')}" title="Its back, a side or a close-up: every picture and video Brew makes of it uses them">${own.length ? `${own.length} photo${own.length > 1 ? 's' : ''}, add more` : '＋ Add photos'}</button></p>` : ''}</article>`; }).join('')}</div>` : '',
          (pr.all?.length || pr.count) > (pr.heroes || []).length ? `<button class="bb-door" data-deep="products"><span>See all ${pr.all?.length || pr.count} ${esc(nm)} products</span><i aria-hidden="true">→</i></button>` : '',
          pr.tiers?.length ? `<div class="bb-stairs">${pr.tiers.map((t, i) => `<button class="bb-step" style="--h:${40 + i * 30}px" data-deep="products" data-tier="${i}"><b>${esc(t.name)}</b><span>${esc(t.from === t.to ? t.from : `${t.from} to ${t.to}`)}</span><small>${t.n} product${t.n === 1 ? '' : 's'} ›</small></button>`).join('')}</div>` : '',
          (pr.offers?.length || pr.guarantee || pr.returns) ? `<div class="bb-perks">${(pr.offers || []).map((o) => `<span>${esc(o)}</span>`).join('')}${pr.guarantee ? `<span>${esc(pr.guarantee)}</span>` : ''}${pr.returns ? `<span>Returns: ${esc(pr.returns)}</span>` : ''}${pr.sells === 'by enquiry' ? '<span>Sells by enquiry</span>' : ''}</div>` : '',
          v.naming?.pattern ? `<p class="bb-meta"><b>How ${esc(nm)} names things:</b> ${esc(String(v.naming.pattern).replace(/[\s.;,:]+$/, ''))}${v.naming.examples?.length ? `, like ${v.naming.examples.map((x) => `“${esc(x)}”`).join(', ')}` : ''}</p>` : ''].join(''),
        people: [pe.personas?.length ? `<div class="bb-cards-tr">${pe.personas.map((p, i) => `<article class="bb-tc" style="--t:${tilt(i) / 1.5}deg"><span class="bb-mono">${esc(initials(p.name))}</span><h3>${esc(p.name)}</h3><p>${esc(p.who)}</p>${p.job ? `<p class="bb-wants"><b>Wants</b> ${esc(p.job)}</p>` : ''}${p.objection ? `<p class="bb-but">“But ${esc(String(p.objection).replace(/^but\s+/i, ''))}”</p>` : ''}</article>`).join('')}</div>` : '',
          pe.objections?.length ? `<div class="bb-objs"><span class="bb-kicker">What makes them hesitate</span>${pe.objections.map((o) => `<details><summary>${esc(o.text)}</summary>${o.answer ? `<p>${esc(o.answer)}</p>` : ''}</details>`).join('')}</div>` : '',
          (pe.praise?.length || pe.complaints?.length) ? `<div class="bb-sheet">${pe.praise?.length ? `<div class="bb-sheet-col is-say"><span class="bb-kicker">Customers love</span><ul class="bb-stickers">${pe.praise.map((x, i) => `<li style="--t:${tilt(i) / 2}deg">${esc(x)}</li>`).join('')}</ul></div>` : ''}${pe.complaints?.length ? `<div class="bb-sheet-col is-avoid"><span class="bb-kicker">Customers complain about</span><ul class="bb-stickers">${pe.complaints.map((x, i) => `<li style="--t:${tilt(i) / 2}deg">${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''].join(''),
        proof: [pf.ratings?.length ? `<div class="bb-scores">${pf.ratings.map((r) => `<div class="bb-score">${r.rating ? `<b class="bb-big-n">${(+r.rating).toFixed(1)}</b><span class="bb-stars" aria-label="${(+r.rating).toFixed(1)} stars">${stars(+r.rating)}</span>` : count(r.count)}<span>${r.rating ? `${Number(r.count).toLocaleString()} reviews on ` : 'reviews on '}${link(r.url, r.where)}</span></div>`).join('')}</div>` : '',
          pf.quotes?.length ? `<div class="bb-notes">${pf.quotes.slice(0, 4).map((q, i) => `<blockquote style="--t:${tilt(i)}deg">${esc(q.text)}${q.product ? `<cite>${esc(q.product)}</cite>` : ''}</blockquote>`).join('')}</div>` : '',
          (v.claims || []).length ? `<div class="bb-claims"><span class="bb-kicker">Claims ${esc(nm)} can make, word for word</span><ul>${v.claims.slice(0, 10).map((c) => `<li><i aria-hidden="true">✓</i>${esc(c.text)}${c.src ? ` <a class="bb-srcl" href="${esc(c.src)}" target="_blank" rel="noopener">source</a>` : ''}</li>`).join('')}</ul></div>` : ''].join(''),
        library: !fams.length ? '' : ctx.print ? fams.map((f) => `<h3>${esc(F[f] || f)}</h3><div class="bb-wall">${lib[f].map((r) => `<figure class="bb-ref"><img src="${esc(r.src)}" alt="" loading="eager">${r.proof ? `<span class="bb-proof">${esc(r.proof)}</span>` : ''}<figcaption>${r.why ? `<b>${esc(r.why)}</b>` : ''}${r.words ? `<span>${esc(r.words)}</span>` : ''}</figcaption></figure>`).join('')}</div>`).join('') : `<div class="bb-tabs" role="tablist">${fams.map((f) => `<button role="tab" aria-selected="${f === S.fam}" data-fam="${esc(f)}">${esc(F[f] || f)}<small>${lib[f].length}</small></button>`).join('')}</div>
          <div class="bb-wall">${(lib[S.fam] || []).map((r, i) => `<figure class="bb-ref${/reel|video|tiktok/.test(S.fam) ? ' is-phone' : ''}">${r.video ? `<video src="${esc(r.video)}" poster="${esc(r.src)}" muted loop playsinline preload="none" data-hoverplay></video>` : `<img src="${esc(r.src)}" alt="" loading="lazy">`}${r.proof ? `<span class="bb-proof" style="--t:${tilt(i)}deg">${esc(r.proof)}</span>` : ''}<figcaption>${r.why ? `<b>${esc(r.why)}</b>` : ''}${r.detail ? `<small class="bb-detail">${esc(r.detail)}</small>` : ''}${r.words ? `<span>${esc(r.words)}</span>` : ''}${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open the original</a>` : ''}</figcaption></figure>`).join('')}</div>`,
        playbooks: (v.playbooks || []).length ? `<div class="bb-plays">${v.playbooks.map((p) => `<article class="bb-play">${playMock(p)}<div><h3>${esc(F[p.family] || p.family)}</h3><dl>${[['Layout', p.layout], ['Headline', p.headline], ['Words on it', p.wordsOnImage], ['Logo', p.logo], ['Call to action', p.cta], ['Never', p.avoid]].filter((x) => x[1]).map(([t, x]) => `<div><dt>${t}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></div></article>`).join('')}</div>` : '',
        /* where they show up: one card per platform (its own mark and colour, the handle read from the link), then the market as passport stamps */
        reach: [(v.channels || []).length ? `<ul class="bb-chan">${v.channels.map((c, i) => { const P = NETS[c.net] || { n: c.net[0].toUpperCase() + c.net.slice(1), g: c.net[0].toUpperCase(), c: 'var(--bb-1)' };
            return `<li style="--t:${tilt(i) / 2}deg;--pc:${P.c}"><a href="${esc(c.url)}" target="_blank" rel="noopener"><span class="bb-chan-g" aria-hidden="true">${P.g}</span><span class="bb-chan-t"><b>${esc(P.n)}</b><span>${esc(handleOf(c))}</span></span><i aria-hidden="true">↗</i></a></li>`; }).join('')}</ul>` : '',
          v.markets?.primary ? `<div class="bb-stamps2">${[v.markets.primary, ...(v.markets.others || [])].slice(0, 4).map((m, i) => `<span class="bb-pass" style="--t:${tilt(i + 2)}deg"><small>${i ? 'Also sells in' : 'Sells mainly in'}</small><b>${flagOf(m)} ${esc(regionOf(m))}</b></span>`).join('')}${v.markets.currency ? `<span class="bb-pass is-cur" style="--t:${tilt(7)}deg"><small>Prices in</small><b>${esc(symOf(v.markets.currency))} ${esc(v.markets.currency)}</b></span>` : ''}${v.markets.festival ? `<span class="bb-pass is-date" style="--t:${tilt(9)}deg"><small>Next big date</small><b>${esc(v.markets.festival)}</b></span>` : ''}</div>` : ''].join(''),
        rivals: (v.rivals || []).length ? `<ul class="bb-rivals">${v.rivals.map((r, i) => `<li>${rmx('rivals', i)}<b>${r.host ? link(`https://${r.host}`, r.name) : esc(r.name)}</b>${r.why ? `<span>${esc(r.why)}</span>` : ''}</li>`).join('')}</ul><p class="bb-quiet">Brew never copies a rival’s product, name, words or people into ${esc(cov.name || 'your')} work.</p>` : '',
        /* rules (jam2/rules.js): plain sentences in four groups; block stops the work, warn flags it; each says where it reaches */
        rules: (() => { const rb = (v.rulebook || []), G = d.options?.groups || { claims: 'Claims and compliance', people: 'People and likeness', ai: 'AI use', safety: 'Brand safety' }, CH = d.options?.channels || {};
          const live = rb.filter((r) => !r.off), off = rb.filter((r) => r.off && !r.choice); if (!live.length) return '';
          const whereOf = (r) => r.where?.channels?.length ? r.where.channels.map((c) => CH[c] || c).join(', ') + ' only' : 'Everywhere';
          const card = (r) => r.choice ? `<li class="bb-rule is-choice"><p>${esc(r.text)}</p>${edit ? picker('comfort', r.choice, d.options?.comfort?.[r.choice]?.label || r.choice, Object.entries(d.options?.comfort?.[r.choice]?.options || {}), r.value) : ''}</li>`
            : `<li class="bb-rule is-${r.strength}${r.src === 'suggested' && !r.confirmed ? ' is-sugg' : ''}"><p>${esc(r.text)}</p><div class="bb-rule-b">${edit ? `<button class="bb-str" data-rstr="${esc(r.id)}" data-to="${r.strength === 'block' ? 'warn' : 'block'}" title="${r.strength === 'block' ? 'Blocks the work. Tap to only warn' : 'Only warns. Tap to block'}">${r.strength === 'block' ? 'Must' : 'Warn'}</button><button class="bb-where" data-rwhere="${esc(r.id)}" aria-haspopup="true">${esc(whereOf(r))}</button>` : `<span class="bb-str">${r.strength === 'block' ? 'Must' : 'Warn'}</span><span class="bb-where">${esc(whereOf(r))}</span>`}${r.src === 'suggested' && !r.confirmed ? `<span class="bb-sugg">Suggested by Brew</span>${edit ? `<button class="bb-link" data-rkeep="${esc(r.id)}">Keep</button>` : ''}` : ''}${edit ? `<button class="bb-x" data-roff="${esc(r.id)}" aria-label="Turn off">×</button>` : ''}</div></li>`;
          return `<p class="bb-meta">Every writer and picture maker follows these. <b>Must</b> stops a piece of work that breaks it; <b>Warn</b> flags it.</p><div class="bb-rulegrid">${Object.entries(G).map(([g, label]) => { const xs = live.filter((r) => r.group === g); return xs.length || edit ? `<section class="bb-rgroup" data-g="${g}"><h3>${esc(label)} <small>${xs.length}</small></h3><ul>${xs.map(card).join('')}</ul></section>` : ''; }).join('')}</div>
            ${edit ? `<form class="bb-neverf bb-rulef" data-rule><input name="r" maxlength="220" placeholder="Add a rule, like “Never show a rival’s product”" aria-label="Add a rule"><button>Add rule</button></form>` : ''}
            ${edit && off.length ? `<details class="bb-roff"><summary>Turned off (${off.length})</summary><ul>${off.map((r) => `<li><s>${esc(r.text)}</s> <button class="bb-link" data-ron="${esc(r.id)}">Turn back on</button></li>`).join('')}</ul></details>` : ''}`; })()
      };
      const subs = { library: `${nm}’s own ads, posts and films, best first. Brew makes new pieces from the ones that match what it’s making.`, playbooks: `Each format, mocked up from ${nm}’s own picture, logo and button, with the rules read from ${nm}’s posts and ads.`, proof: 'Only what can be shown. Brew’s writers quote these and nothing else.', voice: `How ${nm} really talks, in its own lines.`, words: `The words that are ${nm}’s, and the ones that never are.` };
      /* the spreads take turns: paper, the brand's colour, paper, ink… so the book reads as theirs from end to end */
      const TONE = { story: 'paper', kit: 'plain', voice: 'brand', words: 'paper', products: 'plain', people: 'paper', proof: 'brand', library: 'ink', playbooks: 'plain', reach: 'paper', rivals: 'paper', rules: 'plain' };
      /* the studio's defaults sit with the formats they make, and the written voice with the voice: settings, not rules */
      if (edit && v.comfort) {
        const sel = (kind, key, label, opts, cur) => `<div><dt>${esc(label)}</dt><dd>${picker(kind, key, label, opts, cur)}</dd></div>`;
        const how = d.options?.comfort?.how;
        chapters.playbooks = (chapters.playbooks || '') + `<div class="bb-studio"><span class="bb-kicker">Studio defaults</span><dl class="bb-facts">${how ? sel('comfort', 'how', how.label, Object.entries(how.options), v.comfort.how) : ''}${sel('narrator', 'narrator', 'Narrator', (d.options?.narrators || []).map((n) => [n.id, n.label]), v.voice?.narrator)}</dl></div>`;
        chapters.voice = (chapters.voice || '') + `<dl class="bb-facts bb-voicew">${sel('voicew', 'written', `How Brew writes for ${nm}`, Object.entries(d.options?.voices || {}), v.voice?.written)}</dl>`;
      }
      const shown = CHAPTERS.map(([id], i) => [id, i + 1]).filter(([id]) => chapters[id] && chapters[id].replace(/<[^>]+>/g, '').trim());
      const sec = (id, n, body2, sub = '') => `<section class="bb-ch is-${TONE[id] || 'plain'}" id="bb-${id}" data-ch="${id}"><header class="bb-chh"><span class="bb-n">${n}</span><div><h2>${esc(T(id))}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></header>${body2}</section>`;
      const body = shown.map(([id], i) => sec(id, String(i + 1).padStart(2, '0'), chapters[id], subs[id])).join('');
      const collage = allRefs.filter((r) => !/product-photo/.test(r.family || '')).slice(0, 5);
      const cover = `<header class="bb-cover" data-cover><div class="bb-cover-in">${k.logo ? `<img class="bb-cover-logo" src="${esc(k.logo)}" alt="${esc(cov.name || v.name || '')}">` : `<p class="bb-cover-name">${esc(cov.name || v.name || '')}</p>`}
          <span class="bb-cover-k">The ${esc(cov.name || v.name || '')} brand book</span>${((h) => `<h1${h.length > 44 ? ' class="is-long"' : h.length > 24 ? ' class="is-mid"' : ''}>${esc(h)}</h1>`)(cov.tagline || cov.oneLine || cov.name || v.name || '')}${cov.tagline && cov.oneLine ? `<p>${esc(cov.oneLine)}</p>` : ''}
          <div class="bb-cover-strip">${roles.slice(0, 6).map((c) => `<span style="background:${esc(c.hex)}"></span>`).join('')}</div></div>
          ${collage.length ? `<div class="bb-collage" aria-hidden="true">${collage.map((r, i) => `<figure style="--i:${i};--t:${tilt(i) * 2}deg"><img src="${esc(r.src)}" alt="">${r.proof && i < 3 ? `<span>${esc(r.proof)}</span>` : ''}</figure>`).join('')}</div>` : ''}
          ${edit ? `<button class="bb-pen is-cover" data-edit="cover.tagline" data-kind="text" data-label="Tagline" data-value="${esc(cov.tagline || '')}">Edit tagline</button>` : ''}</header>`;
      el.className = 'bb'; el.innerHTML = `
        <div class="bb-bar">${ctx.back ? `<button class="bb-back" data-nav="${esc(ctx.back.nav)}">${esc(ctx.back.label)}</button>` : ''}${edit ? '' : `<span class="bb-made">${ctx.readOnly ? 'A brand book by Brew' : 'Your team edits this book. Ask them to add you.'}</span>`}
          <div class="bb-share"><button class="bb-btn is-main" data-share aria-haspopup="dialog">Share</button></div></div>
        ${d.building && !ctx.readOnly ? `<p class="bb-building"><brew-load class="spin"></brew-load>Brew is writing the voice, story and look from ${esc(v.host || 'the site')}. The rest is already here.</p>` : ''}
        ${v.book?.error && !d.building && edit ? `<p class="bb-note">${esc(v.book.error)}</p>` : ''}
        ${cover}
        <nav class="bb-pager" aria-label="Chapters"><button class="bb-pager-b" data-pager aria-expanded="false"><span class="bb-pager-n">01</span><span class="bb-pager-t">${esc(T(shown[0]?.[0]))}</span><i aria-hidden="true">▾</i></button>
          <ol class="bb-pager-list">${shown.map(([id], i) => `<li><a href="#bb-${id}" data-toc="${id}" data-n="${String(i + 1).padStart(2, '0')}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(T(id))}</a></li>`).join('')}</ol></nav>
        <main class="bb-main">${body || `<p class="bb-note">Brew is still reading ${esc(v.host || 'the site')}. The book fills in as it reads.</p>`}
          ${ctx.readOnly ? `<footer class="bb-foot"><p>Made by Brew from ${esc(v.host || 'the brand’s')} own site, ads and posts.</p><a class="bb-btn is-main" href="/?ref=brand-kit">Make it yours in Brew</a></footer>` : ''}</main>${edit ? dockHtml(v) : ''}`;
      wire();
    }

    function wire() {
      const d = S.data;
      /* a picture that won't load (an expired link, a moved file) leaves no broken box: its card goes, or just the picture */
      /* select any text in the book → a small bar: Change with Brew (the composer, about that line), Rewrite, Remove */
      if (!el.dataset.selGuard) { el.dataset.selGuard = 1; let bar = null, tm = 0;
        const hide = () => { bar?.remove(); bar = null; };
        const place = () => { clearTimeout(tm); tm = setTimeout(() => {
          const sel = getSelection(), txt = String(sel || '').replace(/\s+/g, ' ').trim();
          if (!S.data?.canEdit || ctx.readOnly || !el.isConnected || !sel.rangeCount || txt.length < 2) return hide();
          const node = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement, host = node?.closest?.('.bb-ch, .bb-cover');
          if (!host || !el.contains(host) || node.closest('input, textarea, [contenteditable], .bb-dock, .bb-askbox')) return hide();
          const ch = host.classList.contains('bb-cover') ? 'Cover' : (host.querySelector('.bb-chh h2')?.textContent || 'Book'), r = sel.getRangeAt(0).getBoundingClientRect();
          if (!bar) { bar = document.createElement('div'); bar.className = 'bb-selbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Change this line');
            bar.innerHTML = '<button data-s="ask"><i aria-hidden="true">✦</i> Change with Brew</button><button data-s="rewrite">Rewrite</button><button data-s="remove">Remove</button>';
            bar.onmousedown = (e) => e.preventDefault(); document.body.appendChild(bar); }
          bar.style.setProperty('--bb-1', getComputedStyle(el).getPropertyValue('--bb-1')); bar.style.setProperty('--bb-on', getComputedStyle(el).getPropertyValue('--bb-on'));
          const w = bar.offsetWidth || 300, top = r.top > 64 ? r.top - 48 : r.bottom + 10; bar.style.top = `${top + scrollY}px`; bar.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2)) + scrollX}px`;
          const line = { text: txt.slice(0, 600), ch };
          bar.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { hide(); getSelection().removeAllRanges(); const how = b.dataset.s;
            S.pickLine?.(line, how === 'rewrite' ? 'Rewrite it in the brand’s own voice, same meaning, no new facts.' : how === 'remove' ? 'Remove it from the book.' : null); }); }, 120); };
        document.addEventListener('selectionchange', place); addEventListener('scroll', () => bar && place(), { passive: true });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }); }
      if (!el.dataset.imgGuard) { el.dataset.imgGuard = 1; el.addEventListener('error', (e) => { const t = e.target; if (t?.tagName !== 'IMG') return; (t.closest('.bb-collage figure, .bb-ref, .bb-lookbook > img') || t).remove(); }, true); }
      $$('[data-deep]', el).forEach((b) => b.onclick = () => openDeep(b.dataset.deep, { tier: b.dataset.tier != null ? +b.dataset.tier : null }));
      $$('[data-fam]', el).forEach((b) => b.onclick = () => { S.fam = b.dataset.fam; paint(); $('#bb-library', el)?.scrollIntoView({ block: 'start' }); });
      $$('[data-copy]', el).forEach((b) => b.onclick = async () => { const ok = await copy(b.dataset.copy); b.classList.remove('is-copied'); void b.offsetWidth; b.classList.add('is-copied'); b.dataset.stamp = ok ? 'Copied' : b.dataset.copy; });
      $$('video[data-hoverplay]', el).forEach((vd) => { vd.onmouseenter = () => vd.play().catch(() => {}); vd.onmouseleave = () => vd.pause(); vd.onclick = () => (vd.paused ? vd.play() : vd.pause()); });
      $$('[data-unedit]', el).forEach((b) => b.onclick = () => save({ unedit: b.dataset.unedit }, 'Back to what Brew read.'));
      $$('[data-edit]', el).forEach((b) => b.onclick = () => openEdit(b));
      $$('[data-pick]', el).forEach((b) => b.onclick = () => { if (b.getAttribute('aria-checked') === 'true') return; $$('[data-pick]', b.parentElement).forEach((x) => x.setAttribute('aria-checked', x === b)); /* shows at once; the save repaints */
        const { pick, k, v: val } = b.dataset; save(pick === 'comfort' ? { comfort: { [k]: val } } : pick === 'narrator' ? { voice: { narrator: val } } : { voice: { written: val } }, 'Saved.'); });
      $$('[data-rstr]', el).forEach((b) => b.onclick = () => save({ rule: { set: { id: b.dataset.rstr, strength: b.dataset.to, confirmed: true } } }, b.dataset.to === 'block' ? 'Now a must.' : 'Now a warning.'));
      $$('[data-rkeep]', el).forEach((b) => b.onclick = () => save({ rule: { set: { id: b.dataset.rkeep, confirmed: true } } }, 'Kept.'));
      $$('[data-roff]', el).forEach((b) => b.onclick = () => save({ rule: { drop: b.dataset.roff } }, 'Rule turned off.'));
      $$('[data-ron]', el).forEach((b) => b.onclick = () => save({ rule: { set: { id: b.dataset.ron, off: false } } }, 'Rule back on.'));
      const rf = $('[data-rule]', el); if (rf) rf.onsubmit = (e) => { e.preventDefault(); const t = rf.r.value.trim(); if (t.length < 4) return; save({ rule: { add: { text: t } } }, 'Rule added.'); };
      $$('[data-rwhere]', el).forEach((b) => b.onclick = (e) => { e.stopPropagation(); $('.bb-wmenu')?.remove(); const r = (S.data.book.rulebook || []).find((x) => x.id === b.dataset.rwhere); if (!r) return;
        const CH = S.data.options?.channels || {}, on = new Set(r.where?.channels || []), m = document.createElement('div'); m.className = 'bb-wmenu'; m.setAttribute('role', 'menu');
        m.innerHTML = `<p>Where it applies</p><label><input type="radio" name="w" value="all"${on.size ? '' : ' checked'}> Everywhere</label>${Object.entries(CH).map(([k2, l2]) => `<label><input type="checkbox" value="${esc(k2)}"${on.has(k2) ? ' checked' : ''}> ${esc(l2)} only</label>`).join('')}<button class="bb-btn is-main" data-wok>Save</button>`;
        const rc = b.getBoundingClientRect(); m.style.top = `${rc.bottom + scrollY + 6}px`; m.style.left = `${Math.max(12, Math.min(rc.left + scrollX, innerWidth - 260))}px`; document.body.appendChild(m);
        const all = $('[value=all]', m), boxes = $$('input[type=checkbox]', m); all.onchange = () => boxes.forEach((x) => { x.checked = false; }); boxes.forEach((x) => x.onchange = () => { all.checked = !boxes.some((y) => y.checked); });
        const shut = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', shut); } }; setTimeout(() => document.addEventListener('click', shut), 0);
        $('[data-wok]', m).onclick = () => { const ch = boxes.filter((x) => x.checked).map((x) => x.value); m.remove(); document.removeEventListener('click', shut); save({ rule: { set: { id: r.id, where: ch.length ? { channels: ch } : null, confirmed: true } } }, ch.length ? 'Saved.' : 'Applies everywhere.'); }; });
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
      /* the pager follows the chapter on screen and opens the list of chapters */
      const pager = $('.bb-pager', el), pb = $('[data-pager]', el), toc = $$('[data-toc]', el);
      if (pb) { pb.onclick = () => { const open = pager.classList.toggle('is-open'); pb.setAttribute('aria-expanded', open); };
        toc.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); /* the app routes on #hash: a chapter jump scrolls, it never navigates */ pager.classList.remove('is-open'); pb.setAttribute('aria-expanded', 'false'); $(`#bb-${a.dataset.toc}`, el)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); })); }
      if ('IntersectionObserver' in window && toc.length) { const io = new IntersectionObserver((es) => es.forEach((x) => { if (!x.isIntersecting) return; const id = x.target.dataset.ch;
          toc.forEach((a) => a.classList.toggle('on', a.dataset.toc === id)); const a = toc.find((y) => y.dataset.toc === id); if (a && pb) { $('.bb-pager-n', pb).textContent = a.dataset.n; $('.bb-pager-t', pb).textContent = a.textContent.replace(a.dataset.n, ''); }
          pager?.classList.toggle('is-ink', x.target.classList.contains('is-ink') || x.target.classList.contains('is-brand')); }), { rootMargin: '-35% 0px -60% 0px' });
        $$('.bb-ch', el).forEach((sct) => io.observe(sct)); }
      /* the numbers count up once, as their chapter comes into view */
      const nums = $$('[data-count]', el), calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (nums.length && !calm && 'IntersectionObserver' in window) { const io2 = new IntersectionObserver((es) => es.forEach((x) => { if (!x.isIntersecting) return; io2.unobserve(x.target); const n = +x.target.dataset.count, t0 = performance.now();
          const step = (t) => { const p = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - p, 3); x.target.textContent = Math.round(n * e).toLocaleString(); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }), { threshold: 0.6 });
        nums.forEach((n) => { n.textContent = '0'; io2.observe(n); }); }
      /* the cover's moodboard leans toward the pointer */
      const cv = $('[data-cover]', el); if (cv && !calm && matchMedia('(hover: hover)').matches) { cv.onpointermove = (e) => { const r = cv.getBoundingClientRect(); cv.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3)); cv.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3)); }; cv.onpointerleave = () => { cv.style.setProperty('--mx', 0); cv.style.setProperty('--my', 0); }; }
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
        <div class="bb-askbox"><div class="bb-ideas" data-ideas><div><span>Try</span>${[['Add a rule', 'Add a rule: '], ['Add a hero product', 'Add  to our hero products'], ['New tagline', 'Change our tagline to '], ['Never say a word', 'Never say '], ['Warmer voice', 'Make the voice warmer'], ['Remove a rival', 'Remove  from our rivals']].map(([l, t]) => `<button type="button" data-idea="${esc(t)}">${esc(l)}</button>`).join('')}</div></div>
        <div class="bb-quote" data-quote hidden></div>
        <form class="bb-ask" data-ask><button type="button" class="bb-attach" data-attach aria-label="Add files: guidelines, deck, logo, fonts"><span aria-hidden="true">+</span></button>
          <input name="q" autocomplete="off" placeholder="Tell Brew what to change in ${esc(n)}’s book, or paste a link…" aria-label="Tell Brew what to change">
          <button class="bb-send" aria-label="Send"><span aria-hidden="true">↑</span></button>
          <input type="file" hidden multiple data-files accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.tsv,.json,.png,.jpg,.jpeg,.webp,.svg,.ttf,.otf,.woff,.woff2,.zip"></form></div></div>`;
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
      const drop = () => { S.cards = S.cards.filter((x) => x.u.id !== u.id); (S.gone ||= new Set()).add(u.id); c.remove(); };
      const notNow = () => { drop(); api('POST', base, { dismissUpload: u.id }).catch(() => {}); }; /* remembered, so it doesn't come back on the next visit */
      $('[data-skip]', c).onclick = notNow;
      $('[data-use]', c).onclick = async () => { const paths = $$('[data-path]', c).filter((x) => x.checked).map((x) => x.dataset.path), kitOff = $$('[data-kit]', c).filter((x) => !x.checked).map((x) => x.dataset.kit);
        const ok = await save({ applyUpload: { id: u.id, paths, ...(kitOff.length ? { skipKit: kitOff } : {}), overrideConfirmed: $$('[data-path]', c).some((x) => x.checked && x.closest('li').querySelector('em')) } }, 'Done. Brew writes and makes things this way from now on.');
        if (ok) drop(); };
      return c;
    }
    function thinking(label) { const c = document.createElement('div'); c.className = 'bb-change is-busy'; c.innerHTML = `<header><span class="bb-from">${esc(label)}</span><p><brew-load class="spin"></brew-load> Reading it and working out the changes…</p></header>`; return c; }
    function wireDock() {
      const dock = $('[data-dock]', el); if (!dock) return; const cards = $('[data-cards]', dock), form = $('[data-ask]', dock), q = form.q, files = $('[data-files]', dock);
      /* the cards and the half-typed ask live in S, so a repaint (the book being written, an edit) never loses them */
      /* a card used or dismissed elsewhere (another tab, a teammate, or the copy the page paints from before the book loads) goes */
      { const ups = S.data.book?.uploads; if (Array.isArray(ups)) S.cards = S.cards.filter((c) => { const u = ups.find((x) => x.id === c.u.id); return !u || (!u.applied && !u.dismissed); }); }
      for (const u of (S.data.book?.uploads || []).filter((x) => !x.applied && !x.dismissed && (x.proposed?.length || x.kit || x.neverSay?.length || x.dropNever?.length))) if (!S.cards.some((c) => c.u.id === u.id) && !S.gone?.has(u.id)) S.cards.push({ u });
      for (const c of S.cards) cards.appendChild(changeCard(c.u, c.reply));
      for (const l of S.pending) cards.appendChild(thinking(l));
      q.value = S.draft || ''; q.oninput = () => { S.draft = q.value; };
      const send = async (body, label) => { S.pending.push(label); const w = thinking(label); cards.appendChild(w); w.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const r = await api('POST', `${base}/${body.url || body.data || body.text && body.name ? 'import' : 'ask'}`, body); S.pending = S.pending.filter((x) => x !== label);
        const live = $('[data-cards]', el) || cards; live.querySelectorAll('.bb-change.is-busy').forEach((x) => { if (x.textContent.includes(label)) x.remove(); });
        if (!r || r.error) { const e = document.createElement('div'); e.className = 'bb-change is-err'; e.innerHTML = `<header><p>${esc(r?.error || 'That didn’t go through. Try again.')}</p></header>`; live.appendChild(e); setTimeout(() => e.remove(), 9000); return; }
        if (!r.upload) { toast(r.reply || 'Nothing to change there.'); return; }
        S.cards.push({ u: r.upload, reply: r.reply }); const nc = changeCard(r.upload, r.reply); nc.classList.add('is-new'); live.appendChild(nc); };
      form.onsubmit = (e) => { e.preventDefault(); const x = q.value.trim(); if (!x) return; q.value = ''; S.draft = '';
        if (/^https?:\/\/\S+$/i.test(x)) send({ url: x, private: false }, 'Reading the link'); else askAbout(x); };
      /* a line picked in the book (select any text): the request is about that line, in its chapter */
      const quoteBox = $('[data-quote]', dock);
      const showQuote = () => { const sl = S.sel; quoteBox.hidden = !sl; quoteBox.innerHTML = sl ? `<span>Changing</span><q>${esc(sl.text.length > 90 ? sl.text.slice(0, 88) + '…' : sl.text)}</q><small>${esc(sl.ch)}</small><button type="button" class="bb-x" data-unquote aria-label="Change something else">×</button>` : '';
        const x = $('[data-unquote]', quoteBox); if (x) x.onclick = () => { S.sel = null; showQuote(); q.focus(); }; q.placeholder = sl ? 'What should change? Rewrite it, cut it, make it bolder…' : q.dataset.ph; };
      q.dataset.ph = q.dataset.ph || q.placeholder;
      const askAbout = (x) => { const sl = S.sel; S.sel = null; showQuote();
        send({ text: sl ? `In the “${sl.ch}” part of the book, the team selected this: “${sl.text}”. ${x}` : x }, sl ? `“${sl.text.slice(0, 50)}${sl.text.length > 50 ? '…' : ''}”: ${x.slice(0, 60)}` : `You asked: “${x.slice(0, 80)}”`); };
      S.pickLine = (sl, now) => { S.sel = sl; showQuote(); if (now) askAbout(now); else { q.focus(); dock.scrollIntoView({ block: 'nearest' }); } };
      showQuote();
      $$('[data-idea]', dock).forEach((b) => b.onmousedown = (e) => e.preventDefault()); /* the box keeps focus, so the chips don't fold away under the tap */
      $$('[data-idea]', dock).forEach((b) => b.onclick = () => { const t = b.dataset.idea, at = t.indexOf('  '); q.value = t.replace('  ', ' '); q.focus(); const c = at >= 0 ? at + 1 : q.value.length; q.setSelectionRange(c, c); });
      /* what Brew reads, and the limits the server keeps: a file it can't read says how to send it instead, before any upload */
      const kindOf = (f) => { const e = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
        if (/^(pdf)$/.test(e)) return ['doc', 20e6]; if (/^(docx|pptx|xlsx)$/.test(e)) return ['doc', 20e6]; if (/^(txt|md|markdown|csv|tsv|json)$/.test(e)) return ['doc', 20e6];
        if (/^(png|jpe?g|webp)$/.test(e) || /^image\/(png|jpeg|webp)$/.test(f.type)) return ['image', 8e6]; if (e === 'svg') return ['logo', 6e6]; if (/^(ttf|otf|woff2?)$/.test(e)) return ['font', 4e6]; if (e === 'zip') return ['zip', 20e6];
        const how = { doc: 'Save it as .docx or PDF', ppt: 'Save it as .pptx or PDF', key: 'Export it from Keynote as PDF or .pptx', pages: 'Export it from Pages as PDF or .docx', numbers: 'Export it as .xlsx', heic: 'Send it as JPG or PNG', heif: 'Send it as JPG or PNG', gif: 'Send it as PNG', ai: 'Export it as PDF or SVG', psd: 'Export it as PNG or PDF', fig: 'Paste the Figma link instead', sketch: 'Export it as PDF' }[e];
        return [null, 0, how ? `${how}, then drop it again.` : 'Brew reads PDF, Word, PowerPoint, Excel, text, photos, SVG logos, fonts and ZIPs.']; };
      const upload = async (list) => { for (const f of list) { const [kind, max, how] = kindOf(f);
        if (!kind) { toast(`Brew can’t open ${f.name}. ${how}`); continue; }
        if (f.size > max) { toast(`${f.name} is over ${Math.round(max / 1e6)} MB. ${kind === 'image' ? 'Send a smaller photo.' : 'Send a smaller PDF, or split it.'}`); continue; }
        const data = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = () => res(null); rd.readAsDataURL(f); });
        if (!data) { toast(`${f.name} couldn’t be opened on this device.`); continue; }
        await send({ name: f.name || `pasted.${(f.type.split('/')[1] || 'png')}`, type: f.type, data, private: false }, `Reading ${f.name || 'the pasted picture'}`); } };
      /* paste a screenshot or a copied file straight into the bar */
      q.onpaste = (e) => { const fs = [...(e.clipboardData?.files || [])]; if (!fs.length) return; e.preventDefault(); upload(fs.map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }))); };
      $('[data-attach]', dock).onclick = () => files.click(); files.onchange = () => upload([...files.files]);
      /* drop a file anywhere on the book */
      let depth = 0; const over = () => el.querySelector('.bb-dropzone') || el.appendChild(Object.assign(document.createElement('div'), { className: 'bb-dropzone', innerHTML: `<div><b>Drop it into ${esc(S.data.book?.cover?.name || S.data.book?.name || 'the')} brand book</b><span>Guidelines, decks, logos, fonts, a ZIP. Brew shows you what changes first.</span></div>` }));
      el.ondragenter = (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; depth++; over(); }; el.ondragleave = () => { if (--depth <= 0) { depth = 0; el.querySelector('.bb-dropzone')?.remove(); } };
      el.ondragover = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
      el.ondrop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth = 0; el.querySelector('.bb-dropzone')?.remove(); upload([...e.dataTransfer.files]); };
    }

    /* ---------- share: one sheet, the book's own cover on top; every tile says it worked ---------- */
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; } };
    /* deeper pages: a chapter that has more than a spread can hold opens its own page over the book (Back, Esc or the
       browser's back button returns to the same place). Products: the whole catalogue, filtered by price step. */
    function openDeep(kind, o = {}) {
      $('.bb-deep')?.remove(); const v = S.data?.book || {}, pr = v.products || {}, nm = v.cover?.name || v.name || 'the brand';
      if (kind !== 'products') return;
      const all = pr.all?.length ? pr.all : (pr.heroes || []).map((h) => ({ ...h, hero: true })), tiers = (pr.tiers || []).filter((t) => t.lo != null);
      let f = o.tier != null && tiers[o.tier] ? `t${o.tier}` : 'all';
      const inTier = (p, t) => p.p != null && !p.pack && p.p >= t.lo && p.p <= t.hi;
      const pick = () => f === 'all' ? all : f === 'hero' ? all.filter((p) => p.hero) : f === 'pack' ? all.filter((p) => p.pack) : all.filter((p) => inTier(p, tiers[+f.slice(1)]));
      const tabs = [['all', 'All', all.length], ...(all.some((p) => p.hero) ? [['hero', 'Heroes', all.filter((p) => p.hero).length]] : []), ...tiers.map((t, i) => [`t${i}`, t.name, all.filter((p) => inTier(p, t)).length]), ...(all.some((p) => p.pack) ? [['pack', 'Bundles', all.filter((p) => p.pack).length]] : [])].filter((x) => x[2]);
      const d = document.createElement('div'); d.className = 'bb-deep'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', `All ${nm} products`);
      const grid = () => pick().map((p, i) => `<a class="bb-pc" ${p.url ? `href="${esc(p.url)}" target="_blank" rel="noopener"` : ''} style="--i:${Math.min(i, 24)}"><span class="bb-pc-img">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}${p.hero ? '<em>Hero</em>' : p.pack ? '<em class="is-pack">Bundle</em>' : ''}</span><b>${esc(p.title)}</b><span class="bb-pc-p">${p.price ? esc(p.price) : ''}${p.mrp ? ` <s>${esc(p.mrp)}</s>` : ''}</span></a>`).join('');
      const draw = () => { d.innerHTML = `<div class="bb-deep-in"><header class="bb-deep-h"><button class="bb-back" data-deep-x>Back to the book</button><span class="bb-kicker">Products</span>
          <h2>All ${all.length} ${esc(nm)} products</h2>${pr.count && pr.count > all.length ? `<p class="bb-quiet">Showing ${all.length} of the ${pr.count} on the site.</p>` : ''}
          <div class="bb-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" aria-selected="${k === f}" data-f="${k}">${esc(l)} <small>${n}</small></button>`).join('')}</div></header>
          <div class="bb-pgrid">${grid()}</div></div>`;
        $$('[data-f]', d).forEach((b) => b.onclick = () => { f = b.dataset.f; draw(); });
        $('[data-deep-x]', d).onclick = () => history.state?.bbDeep ? history.back() : close(); };
      const close = () => { d.classList.remove('is-in'); setTimeout(() => d.remove(), 200); removeEventListener('popstate', pop); removeEventListener('hashchange', pop); document.removeEventListener('keydown', esc1); document.documentElement.classList.remove('bb-deep-open'); };
      const pop = () => close(), esc1 = (e) => { if (e.key === 'Escape') history.state?.bbDeep ? history.back() : close(); };
      d.style.cssText = el.style.cssText; /* the book's colours and fonts travel with it: it sits on <body>, above the app's own layers */
      draw(); document.body.appendChild(d); document.documentElement.classList.add('bb-deep-open'); setTimeout(() => d.classList.add('is-in'), 10);
      history.pushState({ ...(history.state || {}), bbDeep: kind }, ''); addEventListener('popstate', pop); addEventListener('hashchange', pop); /* leaving the book from the app's own nav closes it too */ document.addEventListener('keydown', esc1);
      $('[data-deep-x]', d).focus();
    }
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
