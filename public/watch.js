/* What Brew watches for you (#v=watch): everything Brew reads from outside for one brand, as a fun spread in the brand's own
   colours and type, made of the Brand Book's toys: a poster cover with source stickers, a wall of sticky notes for what people say,
   a shelf with hanging price tags for where it sells, trading cards for rivals and chat bubbles for AI answers. Quiet: a block
   with nothing in it is left out, each block shows a handful and folds the rest, every number has its date and link, and a source
   that couldn't be read is one torn note, never a zero. Motion plays only for what's new this week and respects reduced motion.
   window.BrandWatch.render(el, { slug, api, toast, back }) */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lum = (hex) => { const h = String(hex || '#888').replace('#', ''), f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255 || 0); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const tilt = (i) => [-3, 2, -1.5, 3, -2.5, 1.5, -1, 2.5][i % 8];
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());
  const short = (n) => (n == null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const day = (d) => { if (!d) return ''; const t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  const money = (n, cur) => (n == null ? '' : `${cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur === 'GBP' ? '£' : cur === 'EUR' ? '€' : ''}${Number(n).toLocaleString()}`);
  const stars = (r) => (r ? `<span class="wx-stars" aria-label="${r} out of 5">★ ${(+r).toFixed(1)}</span>` : '');
  const ext = (u, inner, cls = '') => (u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="${cls}">${inner}</span>`);
  const logo = (src, name, cls = 'wx-logo') => (src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('b'),{className:'${cls} is-txt',textContent:'${esc(String(name || '?')[0])}'}))">` : `<b class="${cls} is-txt">${esc(String(name || '?')[0])}</b>`);
  const more = (n, label, body) => (n > 0 ? `<details class="wx-more"><summary>${esc(label)}</summary>${body}</details>` : '');

  function render(el, ctx) {
    const api = ctx.api, slug = encodeURIComponent(ctx.slug), S = { tab: 'you' };
    el.innerHTML = '<div class="wx wx-loading"><brew-load class="spin"></brew-load></div>';
    Promise.all([api('GET', `/api/brands/${slug}/watch`), api('GET', `/api/brands/${slug}/book`).catch(() => null)]).then(([d, book]) => {
      if (!d || d.error) { el.innerHTML = `<div class="wx"><p class="wx-empty">${esc(d?.error || 'This page didn’t load. Reload to try again.')}</p></div>`; return; }
      S.d = d; theme(book?.book || {}); paint();
    });

    /* the brand's own colours and fonts, the same way the Brand Book wears them */
    function theme(v) {
      const k = v.kit || {}, roles = k.roles?.length ? k.roles : (k.colors || []).map((hex) => ({ hex }));
      const primary = roles.find((c) => c.role === 'primary')?.hex || k.accent || '#1d1d1f';
      const accent = roles.find((c) => c.role === 'accent' && c.hex !== primary)?.hex || roles.find((c) => c.hex !== primary && lum(c.hex) < 0.8 && lum(c.hex) > 0.08)?.hex || primary;
      const ink = roles.find((c) => c.role === 'ink')?.hex || (lum(primary) < 0.3 ? primary : '#141414'), paper = roles.find((c) => c.role === 'background' && lum(c.hex) > 0.75)?.hex || '#fbfaf7';
      const set = (n, x) => el.style.setProperty(n, x);
      set('--bb-1', primary); set('--bb-2', accent); set('--bb-on', lum(primary) > 0.55 ? '#141414' : '#ffffff'); set('--bb-ink', ink); set('--bb-paper', paper); set('--bb-on-ink', lum(ink) > 0.55 ? '#141414' : '#ffffff');
      const hf = k.fonts?.heading, bf = k.fonts?.body; set('--bb-head', hf ? `"${hf}", Georgia, serif` : 'Georgia, serif'); set('--bb-body', bf ? `"${bf}", var(--font)` : 'var(--font)');
      for (const f of [hf, bf].filter(Boolean)) { const id = `wxf-${f}`; if (document.getElementById(id)) continue; const l = Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;600;700;800&display=swap` }); document.head.appendChild(l); }
      S.logo = k.logo || null; S.cur = v.currency || null;
    }

    function paint() {
      const d = S.d, h = d.header || {};
      el.innerHTML = `<div class="wx">
        ${ctx.back ? `<div class="bb-bar"><button class="bb-back" data-wx-back>${esc(ctx.back.label)}</button></div>` : ''}
        ${cover(d, h)}
        ${d.people ? people(d.people) : ''}
        ${d.sell ? sell(d.sell) : ''}
        ${d.rivals ? rivals(d.rivals) : ''}
        ${d.show && !d.show.error ? show(d.show, d.name) : d.show?.error ? `<div class="wx-torn"><b>AI answers</b> ${esc(d.show.error)}</div>` : ''}
        ${cant(d.cant || [])}
        <p class="wx-foot">Brew reads all of this again on its own: what people say every day, shelves and marketplaces every week, web traffic every month.</p>
      </div>`;
      el.querySelector('[data-wx-back]')?.addEventListener('click', () => ctx.back?.go?.());
      el.querySelectorAll('[data-wx-tab]').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.wxTab; paint(); el.querySelector('.wx-say')?.scrollIntoView({ block: 'nearest' }); }));
      el.querySelectorAll('[data-wx-flip]').forEach((b) => b.addEventListener('click', () => b.closest('.wx-card').classList.toggle('is-flipped')));
      el.querySelectorAll('[data-wx-heard]').forEach((b) => b.addEventListener('click', () => ctx.openHeard?.(b.dataset.wxHeard ? { theme: b.dataset.wxHeard } : {})));
    }

    /* the cover: a poster in their colour, one big count line, and every place Brew read stuck on as a sticker */
    function cover(d, h) {
      const parts = [h.heard ? `<b>${fmt(h.heard)}</b> things people said` : '', h.places ? `<b>${h.places}</b> places` : '', h.rivals ? `<b>${h.rivals}</b> rivals` : '', h.cities ? `<b>${h.cities}</b> ${h.cities === 1 ? 'city' : 'cities'}` : ''].filter(Boolean);
      return `<section class="wx-cover"><div class="wx-cover-in">
        ${S.logo ? `<img class="bb-cover-logo" src="${esc(S.logo)}" alt="">` : ''}
        <span class="bb-cover-k">Watched for you, every day</span>
        <h1>What Brew watches for ${esc(d.name)}</h1>
        ${parts.length ? `<p class="wx-count">${parts.join('<i>·</i>')}</p>` : ''}</div>
        <div class="wx-stickers" aria-hidden="true">${(h.logos || []).map((l, i) => `<span class="wx-sticker" style="--t:${tilt(i) * 2}deg;--i:${i}" title="${esc(l.name)}">${logo(l.logo, l.name, 'wx-st-img')}<small>${esc(l.name)}</small></span>`).join('')}</div></section>`;
    }

    /* What people say: the number split you / your category, topics as rubber stamps, quotes as sticky notes */
    function people(p) {
      const notes = (p.notes?.[S.tab] || []);
      const note = (n, i) => `<figure class="wx-note${n.mood === 'neg' ? ' is-neg' : n.mood === 'pos' ? ' is-pos' : ''}" style="--t:${tilt(i)}deg">${ext(n.url, `<blockquote>“${esc(n.text)}”</blockquote>`)}<figcaption>${n.rating ? stars(n.rating) : ''}<span>${esc(n.who || '')}</span><span>${esc(n.where)}${n.at ? ` · ${day(n.at)}` : ''}</span></figcaption></figure>`;
      return `<section class="wx-sp is-paper wx-say"><div class="wx-sp-h"><span class="wx-k">What people say</span><h2>${fmt(p.total)} things people said</h2>
        <p class="wx-sub">${fmt(p.you)} about ${esc(p.name)} · ${fmt(p.category)} about your category and rivals${p.at ? ` · read ${day(p.at)}` : ''}</p></div>
        ${p.topics?.length ? `<div class="wx-stamps">${p.topics.slice(0, 6).map((t, i) => `<button class="wx-stamp${t.week > 0 ? ' is-new' : ''}" style="--t:${tilt(i)}deg" data-wx-heard="${esc(t.name)}">${esc(t.name)}<b>${t.n}</b></button>`).join('')}</div>` : ''}
        <div class="wx-tabs" role="tablist">${[['you', `About ${p.name}`, p.notes?.you?.length], ['category', 'About your category', p.notes?.category?.length]].filter(([, , n]) => n).map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-wx-tab="${k}">${esc(l)}</button>`).join('')}</div>
        ${notes.length ? `<div class="wx-wall">${notes.slice(0, 4).map(note).join('')}</div>${more(notes.length - 4, `${notes.length - 4} more`, `<div class="wx-wall">${notes.slice(4).map((n, i) => note(n, i + 4)).join('')}</div>`)}` : ''}
        ${p.tagged?.filter((n) => n.image).length ? `<div class="wx-sub-h"><b>People who tag you</b><span>Real posts by customers and creators, ready to ask for a repost</span></div><div class="wx-polaroids">${p.tagged.filter((n) => n.image).slice(0, 5).map((n, i) => `<a class="wx-pol" style="--t:${tilt(i + 2)}deg" href="${esc(n.url)}" target="_blank" rel="noopener">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc(n.who || '')}</span></a>`).join('')}</div>` : ''}
        <button class="bb-btn" data-wx-heard="">Read everything people said</button></section>`;
    }

    /* Where you sell: one shelf per platform, the brand's packs standing on it with hanging price tags; rivals as one line each */
    function sell(s) {
      const shelves = s.shelves.filter((x) => x.at || x.error), mk = s.marketplaces || [];
      const tag = (x) => `<span class="wx-tag">${x.price != null ? `<b>${money(x.price, S.cur)}</b>` : ''}${x.mrp && x.mrp > x.price ? `<s>${money(x.mrp, S.cur)}</s>` : ''}${x.rating ? stars(x.rating) : ''}</span>`;
      const pack = (x, i) => `<div class="wx-pack${x.inStock === false ? ' is-out' : ''}" style="--i:${i}">${ext(x.url, `${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<b class="wx-pack-n">${esc(String(x.name || '').slice(0, 30))}</b>`}`)}${tag(x)}<small>${esc(String(x.name || '').slice(0, 46))}${x.unit ? ` · ${esc(x.unit)}` : ''}</small>${x.inStock === false ? '<span class="wx-oos">Out of stock</span>' : ''}${x.eta ? `<span class="wx-eta">${x.eta} min</span>` : ''}</div>`;
      const shelf = (x) => {
        const head = `<header class="wx-shelf-h">${logo(x.logo, x.label)}<b>${esc(x.label)}</b>${x.city ? `<span class="wx-passport">${esc(x.city)}</span>` : ''}<small>${x.error ? `Couldn’t read this time${x.at ? `, showing ${day(x.at)}` : ''}` : `${day(x.at)}`}</small></header>`;
        const own = x.own?.length ? `<div class="wx-shelf-row">${x.own.slice(0, 5).map(pack).join('')}</div>` : x.listed === 0 ? `<p class="wx-none">${x.onSite ? `Your site links to ${esc(x.label)}, but Brew didn’t find your listing in its search${x.city ? ` in ${esc(x.city)}` : ''}` : `${esc(S.d.name)} isn’t listed on ${esc(x.label)}${x.city ? ` in ${esc(x.city)}` : ''}`}${x.rivals.length ? `${x.onSite ? '. ' : ', but '}${x.rivals.length} rival${x.rivals.length === 1 ? ' is' : 's are'}${x.onSite ? ' there' : ''}` : ''}.</p>` : '';
        const rv = x.rivals?.length ? `<ul class="wx-rv">${x.rivals.slice(0, 5).map((r) => `<li><b>${esc(r.name)}</b><span>${r.n} listed${r.minPrice ? ` · from ${money(r.minPrice, S.cur)}` : ''}${r.rating ? ` · ★ ${r.rating}` : ''}${r.out ? ` · <em>${r.out} out of stock</em>` : ''}</span></li>`).join('')}</ul>` : '';
        const ch = x.changes?.length ? `<div class="wx-changes">${x.changes.slice(0, 3).map((c, i) => `<span class="wx-change" style="--t:${tilt(i) * 2}deg">${c.kind === 'stock' ? `${esc(c.who)}: ${esc(String(c.name).slice(0, 40))} went out of stock` : `${esc(c.who)}: ${esc(String(c.name).slice(0, 34))} ${money(c.from, S.cur)} → ${money(c.to, S.cur)}`}</span>`).join('')}</div>` : '';
        const rvw = x.reviews?.length ? `<div class="wx-mini-notes">${x.reviews.slice(0, 2).map((r, i) => `<figure class="wx-note is-small" style="--t:${tilt(i + 1)}deg">${ext(r.url, `<blockquote>“${esc(r.text)}”</blockquote>`)}<figcaption>${stars(r.rating)}<span>${esc(r.who || '')}${r.verified ? ' · verified buyer' : ''}</span></figcaption></figure>`).join('')}</div>` : '';
        return `<article class="wx-shelf${x.error ? ' is-err' : ''}">${head}${ch}${own}${rv}${rvw}</article>`;
      };
      const listed = shelves.filter((x) => x.listed), rest = shelves.filter((x) => !x.listed);
      const amz = mk.filter((m) => m.listings.length).map((m) => ({ html: `<article class="wx-shelf"><header class="wx-shelf-h">${logo(m.logo, m.label)}<b>${esc(m.label)}</b><small>From the read</small></header><div class="wx-shelf-row">${m.listings.slice(0, 4).map((l, i) => pack({ ...l, name: l.name || `${l.ratings ? `${fmt(l.ratings)} ratings` : 'Listing'}`, image: null }, i)).join('')}</div></article>` }));
      const also = (s.alsoOn || []).length ? `<p class="wx-also"><b>Your site also links to</b> ${s.alsoOn.map((a) => `<a class="wx-also-chip" href="${esc(a.url)}" target="_blank" rel="noopener">${logo(a.logo, a.label)}${esc(a.label)}</a>`).join('')}</p>` : '';
      if (!shelves.length && !amz.length && !also) return '';
      const n = listed.length + amz.length, all = [...listed.map((x) => ({ html: shelf(x) })), ...amz], show = all.slice(0, 3), fold = [...all.slice(3).map((x) => x.html), ...rest.map(shelf)];
      return `<section class="wx-sp is-color"><div class="wx-sp-h"><span class="wx-k">Where you sell</span><h2>On ${n} ${n === 1 ? 'shelf' : 'shelves'} outside your site</h2><p class="wx-sub">Prices, stock and stars, yours next to your rivals’, checked every week</p></div>
        <div class="wx-shelves">${show.map((x) => x.html).join('')}</div>${also}
        ${more(fold.length, `${all.length > 3 ? `${all.length - 3} more shel${all.length - 3 === 1 ? 'f' : 'ves'}` : ''}${all.length > 3 && rest.length ? ', and ' : ''}${rest.length ? `where you aren’t listed (${rest.length})` : ''}`.replace(/^w/, 'W'), `<div class="wx-shelves">${fold.join('')}</div>`)}</section>`;
    }

    /* What rivals do: one trading card per rival; tap flips it to what changed this week */
    function rivals(rs) {
      const card = (r, i) => `<article class="wx-card" style="--t:${tilt(i)}deg"><button class="wx-card-in" data-wx-flip aria-label="Flip ${esc(r.name)}">
        <div class="wx-face"><header>${logo(r.logo, r.name)}<b>${esc(r.name)}</b></header>
          <dl>${r.visits != null ? `<div><dt>Visits a month</dt><dd>${short(r.visits)}</dd></div>` : ''}${r.liveAds != null ? `<div><dt>Live Meta ads</dt><dd>${fmt(r.liveAds)}</dd></div>` : r.adsError ? `<div><dt>Live Meta ads</dt><dd class="wx-q">couldn’t read</dd></div>` : ''}${r.followers != null ? `<div><dt>Instagram</dt><dd>${short(r.followers)}</dd></div>` : ''}</dl>
          ${r.longest ? `<span class="wx-badge" style="--t:${tilt(i + 3) * 2}deg">Longest ad: ${r.longest.days} days</span>` : ''}
          <small class="wx-turn">${r.week.length ? 'This week ↻' : 'Tap to turn ↻'}</small></div>
        <div class="wx-back">${r.week.length ? r.week.map((w) => `<p><b>${esc(w.text)}</b>${(w.items || []).map((x) => `<span>${esc(x)}</span>`).join('')}</p>`).join('') : '<p><b>Quiet this week</b><span>No launches or price moves seen on its store.</span></p>'}
          ${r.longest?.hook ? `<p><b>Its longest-running ad</b><span>“${esc(r.longest.hook)}”${r.longest.since ? ` · since ${day(r.longest.since)}` : ''}</span></p>` : ''}${r.sources?.Search != null ? `<p><b>Where its visits come from</b><span>${Object.entries(r.sources).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2')} ${v}%`).join(' · ')}</span></p>` : ''}</div></button></article>`;
      return `<section class="wx-sp is-ink"><div class="wx-sp-h"><span class="wx-k">What rivals do</span><h2>${rs.length} rivals, one card each</h2><p class="wx-sub">Tap a card to turn it over</p></div>
        <div class="wx-cards">${rs.slice(0, 6).map(card).join('')}</div></section>`;
    }

    /* How you show up: the AI answers as a chat, the brand's own name lit in its colour */
    function show(s, name) {
      const lit = (t, names) => { let x = esc(t); for (const n of [...names].sort((a, b) => b.length - a.length)) { const re = new RegExp(`(${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'); x = x.replace(re, `<mark class="${n.toLowerCase() === String(name).toLowerCase() ? 'is-you' : ''}">$1</mark>`); } return x; };
      const bars = [{ name, un: s.brand?.un || 0, you: true }, ...(s.rivals || [])].sort((a, b) => b.un - a.un);
      return `<section class="wx-sp is-paper"><div class="wx-sp-h"><span class="wx-k">How you show up</span><h2>${s.brand?.un ? `Named in ${s.brand.un} of ${s.of} AI answers` : `Not named in ${s.of} AI answers yet`}</h2><p class="wx-sub">When a shopper asks without naming a brand · ${s.tools} AI tools${s.at ? ` · ${day(s.at)}` : ''}</p></div>
        <div class="wx-race">${bars.slice(0, 5).map((b) => `<div class="wx-lane${b.you ? ' is-you' : ''}"><span>${esc(b.name)}</span><i style="--w:${s.of ? Math.max(3, Math.round(b.un / s.of * 100)) : 3}%"></i><b>${b.un}</b></div>`).join('')}</div>
        <div class="wx-chat">${(s.bubbles || []).map((b) => `<div class="wx-q-b">${esc(b.q)}</div><div class="wx-a-b"><small>${esc(b.tool || 'AI')}</small><p>${lit(b.text, [name, ...b.names])}</p></div>`).join('')}</div></section>`;
    }

    /* what couldn't be read: one torn note, never a zero */
    function cant(xs) {
      if (!xs.length) return '';
      return `<div class="wx-torn" role="note"><b>Couldn’t read ${esc(xs.map((x) => x.name).join(', '))} this time.</b> What they showed before still counts, and Brew tries again on the next read.</div>`;
    }
  }
  window.BrandWatch = { render };
})();
