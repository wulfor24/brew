/* Brew prototype: read → moves → feed → jam → share the brief.
   Screens: start → setup → who is this for → what do you want → connect → team → feed / deck.
   Every card: heart (more like this), save, jam. The jam ends with Share the brief (share.js, jam-room.js).
   DUMMY: connected accounts and the Pro plan are simulated and tagged (see DUMMY.md). */
(() => {
  // the brand this page is for (server.js injects its seed): a generated brand's, or the Brew landing shell
  const BR = window.BRAND || Object.keys(window.FEED_DATA)[0];
  const B = window.FEED_DATA[BR];
  // the reviews connector goes by its app's own name when we know it (Judge.me, Loox), from its name, account or the read's review platforms
  { const rc = B?.connectors?.reviews; if (rc) { const t = [rc.name, rc.account, ...(B.reviews?.platforms || []).map((p) => p?.name)].join(' ');
    rc.name = /judge\.?me/i.test(t) ? 'Judge.me' : /loox/i.test(t) ? 'Loox' : String(rc.name || 'Reviews').replace(/^(reviews on\s+)+/i, 'Reviews on '); } }
  /* Marketplaces is not a connector for now (2026-10-16): no Connect, no onboarding row; the real marketplaces show as Coming soon on the connectors page */
  if (B?.connectors?.marketplaces) delete B.connectors.marketplaces;
  for (const r of Object.values(B?.roles || {})) if (Array.isArray(r.connectors)) r.connectors = r.connectors.filter((k) => k !== 'marketplaces');
  const GEN = !!B.generated, LANDING = BR === 'brew';
  const DEMO_LAND = LANDING && !!window.BREW_DEMO;
  // a review source named after a site ("amazon.com") reads as a second marketplace in Connectors: name it as reviews
  { const rc = B.connectors?.reviews; if (rc && /\.[a-z]{2,}$/i.test(String(rc.name || '')) && !/^reviews on |^judge\.me$/i.test(rc.name)) rc.name = `Reviews on ${rc.name}`; }
  // a generated brand's own words for the shared screens (products from its lanes, a rival it really has)
  const GX = (() => { const prods = Object.values(B.lanes || {}).flatMap((l) => String(l.line || '').split(' · ').map((x) => x.split(',')[0].trim())).filter(Boolean);
    return { p1: prods[0] || 'your best seller', p2: prods[1] || prods[0] || 'your best seller', rival: (B.rivalLogos || [])[0]?.[0] || 'your top rival', india: (window.BREW_MONEY?.cur || (/₹/.test(JSON.stringify(B.lanes || {})) ? 'INR' : '')) === 'INR' }; })(); // a brand built by the reader + moves engine
  const LSP = () => BR + '-'; // localStorage is per brand
  { const f0 = window.fetch.bind(window); window.fetch = (u, o = {}) => { if (typeof u === 'string' && u.startsWith('/api/')) { o = { ...o, headers: { ...(o.headers || {}), 'x-brand': B.slug || BR } }; } return f0(u, o); }; }
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const root = $('#root');
  document.body.classList.add('fs');
  const dayPart = () => { const h = new Date().getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };
  /* markdown the model or a source left in copy (**bold**, ### Headline, [text](link)) reads as plain words everywhere (QA UI) */
  const esc = (s) => String(s ?? '').replace(/\*\*([^*\n]{1,300})\*\*/g, '$1').replace(/(^|\n)#{1,6}\s+/g, '$1').replace(/\[([^\]\n]{1,200})\]\((https?:[^)\s]+)\)/g, '$1').replace(/\u2039(?=\s?\d)/g, '₹').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* written copy shown as written: blank lines are paragraphs, a short CAPS or "Label:" line is a small heading (also when the
     label leads its line: "CUSHIONING Look for…"), "- " / "• " lines are a list, a quoted line is a quote. Every stage uses it,
     so formatting never depends on which card it is. */
  /* code the writer fenced (```json …```) is code, never prose (the same reader as code-md.js on the server) */
  const splitCode = (s) => { const out = []; let buf = [], code = null;
    const push = () => { const t = buf.join('\n'); buf = []; if (code) { const x = t.replace(/^\s*\n|\n\s*$/g, ''); if (x.trim()) out.push({ code: true, lang: code.lang, text: x }); } else if (t.trim()) out.push({ code: false, text: t }); };
    for (const l of String(s ?? '').replace(/\r/g, '').split('\n')) { const m = /^\s*```\s*([\w+#./-]*)/.exec(l); if (m) { push(); code = code ? null : { lang: m[1].toLowerCase() }; continue; } buf.push(l); }
    push(); return out; };
  const hasCode = (s) => /(^|\n)\s*```/.test(String(s ?? ''));
  const codePre = (b) => `<pre class="rx-code"${b.lang ? ` data-lang="${esc(b.lang)}"` : ''}><code>${esc(b.text)}</code></pre>`;
  const rich = (text) => hasCode(text) ? splitCode(text).map((x) => (x.code ? codePre(x) : richText(x.text))).join('') : richText(text);
  /* a line or field that may carry code: as written when it's plain, as words and code blocks when it isn't */
  const txt = (s) => (hasCode(s) ? `<span class="rx">${rich(s)}</span>` : esc(s));
  const richText = (text) => {
    // a CAPS label run inline after a sentence ("…plain words. CUSHIONING Look for…") starts its own block
    const t = String(text ?? '').replace(/\r/g, '').trim().replace(/([.!?”"])[ \t]+(?=[A-Z][A-Z'’&/?-]{2,}(?:[ \t]+[A-Z'’&/?-]{2,})*[ \t]+(?:[A-Z][a-z]|[“"]))/g, '$1\n\n'); if (!t) return '';
    // a label: a run of CAPS words (3+ letters in all) alone on its line, or leading text that starts like a sentence or a quote
    const lead = /^([A-Z][A-Z0-9'’&/?-]*(?:\s+[A-Z0-9'’&/?-]+)*?)(?::\s*|\s+)(?=[A-Z][a-z]|[“"‘'])(.*)$/;
    const caps = (x) => x.replace(/[^A-Za-z]/g, '').length >= 3 && x.length <= 40 && x === x.toUpperCase() && /[A-Z]/.test(x);
    const quote = (l) => { const m = l.match(/^["“]([^"”]{4,})["”]\s*(.*)$/); return m ? `<q class="rx-q">${esc(m[1])}${m[2] ? `<span class="rx-by"> ${esc(m[2].replace(/^[-–—,]\s*/, ''))}</span>` : ''}</q>` : null; };
    const line = (l) => quote(l) || `<span class="rx-l">${esc(l)}</span>`;
    return t.split(/\n\s*\n/).map((blk) => {
      const lines = blk.split('\n').map((l) => l.trim()).filter(Boolean), out = []; let list = [];
      const flush = () => { if (list.length) { out.push(`<ul class="rx-ul">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); list = []; } };
      for (const l of lines) {
        const b = l.match(/^(?:[-•*]|\d{1,2}[.)](?!\d))\s+(.*)$/); if (b) { list.push(b[1]); continue; } flush();
        const hd = l.match(/^#{1,6}\s+(.+)$/); if (hd) { out.push(`<b class="rx-h">${esc(hd[1].replace(/[*_]{2}/g, ''))}</b>`); continue; } /* a Markdown heading, never "# Title" */
        if (caps(l.replace(/:$/, '')) || /^[^:]{2,36}:$/.test(l)) { out.push(`<b class="rx-h">${esc(l.replace(/:$/, ''))}</b>`); continue; }
        const m = l.match(lead); if (m && caps(m[1])) { out.push(`<b class="rx-h">${esc(m[1])}</b>`, line(m[2])); continue; }
        out.push(line(l));
      }
      flush(); return `<div class="rx-p">${out.join('')}</div>`;
    }).join('');
  };

  const poss = (n) => `${esc(n)}${/s$/i.test(String(n ?? '').trim()) ? '’' : '’s'}`; // Allbirds’ feed, Comet’s feed
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  /* a rival's ad card, or one built on a rival's ad (rival-ad.js isRivalCard): its poster is only ever shown as theirs */
  const isRival = (p) => p?.research?.kind === 'ad' || !!p?.research?.ad || p?.make?.from === 'rival';
  /* the brand's own date and hour (its zone from the pack; else its offset; else this browser's clock) */
  const brandClock = () => { const z = window.BREW_MONEY || {}, now = new Date(); const pad = (n) => String(n).padStart(2, '0');
    try { if (z.tz) { const P = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: z.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value])); return { day: `${P.year}-${P.month}-${P.day}`, hour: +P.hour }; } } catch (e) { /* an unknown zone: the offset below */ }
    if (Number.isFinite(+z.tzOffsetH) && z.tzOffsetH !== null) { const d = new Date(now.getTime() + +z.tzOffsetH * 36e5); return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() }; }
    return { day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, hour: now.getHours() }; };
  const api = async (p, body) => { try { const r = await fetch(p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json(); if (refused(j)) demoSheet(j.host); return j; } catch (e) { return { error: String(e), fallback: true }; } };
  /* demo mode: new work (moves, drafts, images, jams) is made for the brand's team and SquareUp. Anyone else who tries gets this
     one sheet instead of an error: their work email, or the demo stores */
  const DEMO_STORES = 'https://demo.joinsquareup.com';
  /* free mailboxes never prove a brand (auth.js FREE): they get their own words on the team wall */
  const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|zoho|gmx|yandex|mail|rediffmail)\.[a-z.]+$/i;
  /* only the access gate's refusal (demo + an error) asks for a work email: a plan or send that merely ran on a demo account
     (no real account connected) also says demo, and the brand's team and Brew's own people must never see this sheet for it */
  const refused = (j) => !!(j?.demo && j.error);
  /* back to this exact page and sheet after signing in (path, query and hash); the page reloads, so access is asked again */
  const workEmailHref = () => { const back = location.pathname + location.search + location.hash; return window.LIVE?.me ? `/auth/logout?next=${encodeURIComponent(`/auth/google?next=${encodeURIComponent(back)}`)}` : `/auth/google?next=${encodeURIComponent(back)}`; };
  const demoSheet = (host) => setTimeout(() => demoSheetNow(host), 120); // after the click's own render, which may close sheets
  const demoSheetNow = (host) => { if (document.querySelector('.demo-sheet')) return; if (window.LIVE?.access?.full || window.LIVE?.full) return; /* Brew's own people have every brand: switching email can't help them */ const h = host || window.LIVE?.access?.host || B.brand.host, n = B.brand.name, me = window.LIVE?.me;
    modal(`<div class="sheet demo-sheet"><h3>You’re seeing ${esc(n)} in demo mode</h3><p>Brew makes new work for ${esc(n)}${/s$/i.test(n || '') ? '’' : '’s'} team. Sign in with your work email at ${esc(h)}, or ask the team to invite you.${me ? ` You’re signed in as ${esc(me.email)}.` : ''}</p>
      <div class="cx-btns"><a class="btn btn-ghost" href="${DEMO_STORES}" target="_blank" rel="noopener">See demo stores</a><a class="btn btn-primary" href="${workEmailHref()}">${me ? 'Switch to your work email' : 'Sign in with your work email'}</a></div></div>`); };

  /* ---------- icons (lucide, 2px) ---------- */
  const P = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    paste: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    heart: '<path class="ic-heart" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    bookmark: '<path class="ic-bm" d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    right: '<path d="m9 18 6-6-6-6"/>', left: '<path d="m15 18-6-6 6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    down: '<path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M5 20h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    pic: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    vid: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    txt: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    deck: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    feed: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    volOn: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    volOff: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
    inf: '<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    person: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    personAdd: '<circle cx="10" cy="8" r="4.5"/><path d="M17 21a7 7 0 0 0-14 0"/><path d="M19 8v6"/><path d="M16 11h6"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    menu: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    eyeoff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    minus: '<path d="M5 12h14"/>', copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    sliders: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    done: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    trendup: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    board: '<rect width="6" height="16" x="3" y="4" rx="1.5"/><rect width="6" height="10" x="9" y="4" rx="1.5"/><rect width="6" height="13" x="15" y="4" rx="1.5"/>',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'
  };
  const ic = (k, s = '') => `<svg class="ic ${s}" viewBox="0 0 24 24" aria-hidden="true">${P[k]}</svg>`;
  const SO = (bg = 'currentColor', ink = 'var(--bg)') => `<svg viewBox="0 0 200 200" aria-hidden="true"><rect width="200" height="200" rx="56" fill="${bg}"/><path d="M62 38h26v62.5a50 50 0 1 1-26 43.8z" fill="${ink}"/><circle cx="112" cy="138" r="24" fill="${bg}"/><path d="M128 30c10 9 10 19 0 28M150 34c10 9 10 19 0 28" fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round"/></svg>`; // the Brew mark
  const AGENT = { creative: 'Creative director', performance: 'Performance marketer', storefront: /[?&]storefront=1\b/.test(location.search) ? 'Storefront manager' : 'Catalog manager' /* Storefront hidden: it owns catalog cards (FEED-ARV-05) */, visibility: 'AI visibility', crm: 'CRM specialist', brew: 'Brew' };
  const face = (a) => `<span class="face ${a}" aria-hidden="true"><i></i><i></i></span>`;
  // real brand marks: a padded mark on a white tile, or the brand's own full-bleed app icon; marketplaces stack three
  const LOGOS = { shopify: ['shopify.svg'], meta: ['meta.svg'], google: ['google.svg'], ga4: ['google-analytics.svg'], whatsapp: ['whatsapp.svg'], slack: ['slack.svg'], klaviyo: ['klaviyo.png'], loox: ['loox.png', 1], judgeme: ['judgeme.png', 1], amazon: ['amazon.svg', 1], nykaa: ['nykaa.png', 1], blinkit: ['blinkit.png', 1], flipkart: ['flipkart.svg'], myntra: ['myntra.png', 1], walmart: ['walmart.svg'], target: ['target.svg'], etsy: ['etsy.svg'], ebay: ['ebay.svg'] };
  const logoTile = (k, size) => { const [f, full] = LOGOS[k]; return `<span class="cx-logo${full ? ' is-full' : ''}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * .26)}px"><img src="assets/logos/${f}" alt="" loading="lazy"></span>`; };
  // rival brands: their own site icons, saved in assets/logos/brands
  const RIVALS = B.rivalLogos || [];
  const rivalIn = (txt) => RIVALS.find(([n]) => new RegExp(`\\b${n}\\b`, 'i').test(txt || ''));
  const rivalLogo = (name, size = 16) => { const r = rivalIn(name); return r ? `<span class="cx-logo rv-logo" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * .28)}px" title="${esc(r[0])}"><img src="${String(r[1]).includes('/') ? r[1] : `assets/logos/brands/${r[1]}.png`}" alt="${esc(r[0])}"></span>` : ''; };
  // a source we don't have a mark for (a card can name one the connector list doesn't): a neutral plug, never a crash
  const glyph = (id, size = 34) => { const c = B.connectors[id]; if (!c) return `<span class="cx-glyph" style="--gc:#8a8a8a;width:${size}px;height:${size}px">${ic('plug', 's16')}</span>`;
    if (id === 'marketplaces') { const s2 = Math.round(size * .56); const ks = (B.marketLogos || (GEN ? String(c.name).toLowerCase().split(/[^a-z]+/) : ['amazon', 'nykaa', 'blinkit'])).filter((k) => LOGOS[k]); // only the marketplaces this brand sells on
      if (ks.length === 1) return logoTile(ks[0], size).replace('class="cx-logo', `title="${esc(c.name)}" class="cx-logo`); /* one marketplace: its own full-size tile, not a lone corner of a stack */
      if (ks.length) return `<span class="cx-logos" style="width:${size}px;height:${size}px" title="${esc(c.name)}">${ks.map((k) => logoTile(k, s2)).join('')}</span>`; }
    // the reviews connector is whichever app the brand uses: show that app's own mark
    // (the name is often just "Reviews": the live account line and the read's review platforms say which app it is)
    const rvTxt = id === 'reviews' ? [c.name, c.account, window.LiveConn?.L?.conns?.[id]?.account, ...(B.reviews?.platforms || []).map((p) => p?.name)].join(' ') : '';
    const rv = rvTxt && (/judge\.?me/i.test(rvTxt) ? 'judgeme' : /loox/i.test(rvTxt) ? 'loox' : null); if (rv) return logoTile(rv, size).replace('class="cx-logo', `title="${esc(c.name)}" class="cx-logo`);
    if (LOGOS[id]) return logoTile(id, size).replace('class="cx-logo', `title="${esc(c.name)}" class="cx-logo`);
    return `<span class="cx-glyph" style="--gc:${c.color};width:${size}px;height:${size}px;font-size:${Math.round(size * .5)}px">${esc(c.glyph)}</span>`; };
  const avatar = (c, s = 28) => `<span class="av" style="--ac:${c.color};width:${s}px;height:${s}px">${esc(c.ini)}</span>`;
  /* the live site has no fictional pod: Brew's lines carry the Brew mark (the demo keeps its sample roster) */
  const brewAv = (px = 24) => `<span class="av pod-av brew-av" style="width:${px}px;height:${px}px" title="Brew">${SO()}</span>`;
  const podFaces = () => window.BREW_DEMO ? `<span class="pod">${B.pod.map((p) => `<span class="av pod-av" title="${esc(p.role)}">${esc(p.ini)}</span>`).join('')}</span>` : `<span class="pod">${brewAv(24)}</span>`;

  /* ---------- theme ---------- */
  /* the one light/dark switch: top right of the header, or in the jam's own header where the app header is hidden */
  const themeBtn = () => `<button class="icon-btn th-btn" aria-label="Switch theme" title="Switch theme" data-theme-btn>${ic(curTheme() === 'dark' ? 'sun' : 'moon')}</button>`;
  const setTheme = (t) => { document.documentElement.dataset.theme = t; ls.set('feed-theme', t); $$('[data-theme-btn]').forEach((b) => (b.innerHTML = ic(t === 'dark' ? 'sun' : 'moon'))); };
  const curTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (ls.get('feed-theme')) document.documentElement.dataset.theme = ls.get('feed-theme');
  const r0 = document.documentElement.style; r0.setProperty('--brand-1', B.brand.wash[0]); r0.setProperty('--brand-2', B.brand.wash[1]); r0.setProperty('--brand-3', B.brand.wash[2]);
  B.brand.fonts.forEach((href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); });

  /* ---------- toast ---------- */
  let toastT;
  const toast = (html) => { $('.toast')?.remove(); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.innerHTML = html; document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2800); };
  /* a button waiting on the server: a spinner and what it is doing, so a slow answer never reads as a dead click. Returns the
     undo; a button repainted away in the meantime is left alone */
  const busyBtn = (b, label = '') => { if (!b) return () => {}; const html = b.innerHTML; b.disabled = true; b.classList.add('is-wait'); b.setAttribute('aria-busy', 'true'); b.innerHTML = `<brew-load class="spin"></brew-load>${b.matches('.icon-btn') ? '' : esc(label)}`; /* an icon button has no room for words: the spinner alone */
    return () => { if (!b.isConnected) return; b.disabled = false; b.classList.remove('is-wait'); b.removeAttribute('aria-busy'); b.innerHTML = html; }; };
  /* an area waiting to fill (a sheet, a list, a page): the Brew loader big, one line saying what it is doing, a quieter line under.
     size: '' (a section), 'sm' (a row or a small box), 'screen' (a whole view) */
  /* a page that fetches before it paints: after a beat, the old page gives way to the loader, so a tap never reads as nothing.
     It only paints if nothing else painted there first; the returned cancel stops it */
  const holdView = (title, sub = '', el = null) => { const box = el || $('#view') || root, was = box?.firstElementChild;
    const t = setTimeout(() => { if (!box?.isConnected || box.firstElementChild !== was) return; box.innerHTML = box === root ? `<main class="screen">${loader(title, sub, 'screen')}</main>` : loader(title, sub, 'screen'); }, 160);
    return () => clearTimeout(t); };
  const loader = (title = '', sub = '', size = '') => `<div class="bload${size ? ` is-${size}` : ''}" role="status" aria-live="polite"><brew-load class="spin"></brew-load>${title ? `<b>${esc(title)}</b>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;

  /* =========================================================
     State: one object, kept in localStorage. Reset demo clears it.
     ========================================================= */
  const KEY = `${LSP()}demo-v1`;
  const fresh = () => ({
    onboarded: false, viewer: { role: 'founder', wants: ['decision', 'idea'], lane: Object.keys(B.lanes || {})[0] || 'core', hindi: false, name: '' }, /* the brand's first product line, never a lane it doesn't have */
    hearts: {}, saved: [...B.saved], snoozed: {}, boost: {}, dismissed: {}, fewer: {}, done: {}, conn: {}, pro: false,
    slack: { channel: '#growth', names: {} },
    log: [],
    extra: [], batches: B.batches.map((b) => ({ ...b })), sessions: 0, ticket: 1041
  });
  let S = (() => { try { return { ...fresh(), ...JSON.parse(ls.get(KEY) || '{}') }; } catch (e) { return fresh(); } })();

  /* ---------- the feed service (server): one tenant per browser; re-created from a snapshot if the server restarted ---------- */
  let TID = ls.get(`${LSP()}tenant`), lastSync = '', syncP = null;
  const snapshot = () => ({ onboarded: S.onboarded, viewer: S.viewer, conn: S.conn, pro: S.pro, hearts: Object.keys(S.hearts), saved: S.saved, dismissed: S.dismissed, fewer: S.fewer, done: S.done, extra: S.extra });
  let tenantP = null;
  const ensureTenant = (force) => { if (TID && !force) return Promise.resolve(TID); if (tenantP) return tenantP;
    tenantP = api('/api/tenants', { url: B.brand.host, brand: B.slug || BR, snapshot: snapshot() }).then((r) => { TID = r.id; ls.set(`${LSP()}tenant`, TID); lastSync = ''; tenantP = null; return TID; }); return tenantP; };
  const tapi = async (method, p, body, retry = true) => {
    await ensureTenant();
    try {
      const r = await fetch(p.replace(':t', TID), { method, headers: { 'content-type': 'application/json', 'x-tenant': TID, ...(window.Composer?.headers() || {}) }, body: body ? JSON.stringify(body) : undefined }); // the jam's model and memory choice
      const j = await r.json().catch(() => ({}));
      if (j?.signin && j.jam) { toast('Sign in to take part in this jam. Taking you there…'); setTimeout(() => { location.href = `/auth/google?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`; }, 900); return j; }
      if (refused(j)) demoSheet(j.host);
      if (r.status === 404 && j.error === 'unknown tenant' && retry) { await ensureTenant(true); return tapi(method, p, body, false); }
      return j;
    } catch (e) { return { error: String(e), fallback: true }; }
  };
  const stateKey = () => JSON.stringify({ viewer: S.viewer, conn: S.conn, pro: S.pro });
  const syncNow = async () => { const k = stateKey(); if (k !== lastSync) { lastSync = k; syncP = tapi('PUT', '/api/tenants/:t/state', JSON.parse(k)); } if (syncP) await syncP; };
  let wiping = false;
  const save = () => { if (wiping) return; ls.set(KEY, JSON.stringify(S)); if (TID && stateKey() !== lastSync) syncNow(); };
  S.sessions++;
  // remind me tomorrow: a snoozed card comes back to the top on the next visit
  Object.keys(S.snoozed).forEach((id) => { S.boost[id] = 30; delete S.snoozed[id]; });
  save();

  /* who is signed in: one copy, from Google sign-in (live.js window.LIVE.me); nothing about a person is typed in twice */
  const ME = () => window.LIVE?.me || window.LIVE?.user || null;
  /* an address we can really email: never the demo's stand-in (demo-…@demo.brew) */
  const mailMe = () => { const m = ME(), e = m?.email; return e && !m.demo && !/@demo\.brew$/i.test(e) ? e : null; };
  const myFirst = () => { const n = ME()?.name; const f = n ? String(n).trim().split(/\s+/)[0] : null; return f && !/^you$/i.test(f) ? f : null; }; /* a placeholder 'You' is not a name */
  const hiName = (R) => { const n = myFirst() || R?.name; return n && !/^you$/i.test(n) ? `, ${esc(n)}` : ''; };
  const ROLE = () => B.roles[S.viewer.role] || B.roles[Object.keys(B.roles)[0]];
  /* the views this person may use: a team member limited by the brand's admin gets only theirs; everyone else every view */
  const mySeats = () => { const s0 = window.LIVE?.access?.role ? window.LIVE.access.seats : null; return Array.isArray(s0) ? s0.filter((k) => B.roles[k]) : null; };
  const seatEntries = () => { const m = mySeats(); return Object.entries(B.roles).filter(([k]) => !m || m.includes(k)); };
  const noSeats = () => { const m = mySeats(); return !!m && !m.length; };
  /* sign in right after the read: anyone can watch their brand being read, then Google sign-in opens the feed
     (and lets the moves be written). after = where to land once signed in: check | who | feed */
  const needSignin = () => GEN && !!window.LIVE?.signin && !window.LIVE?.me;
  /* the read is in and waits for a person to check it (confirm-remind.js waitingOnCheck) */
  const waitsOnCheck = (s) => !!s && !s.done && !s.cancelled && !s.error && !s.confirmedAt && s.stages?.read?.state === 'done' && s.stages?.confirm?.state === 'waiting';
  /* the time left on a brand's moves: only the server's measured pace (status.etaMin), never a guess */
  /* when Brew starts writing on its own if nobody checks the read (status/check writeAt), in the reader's local time */
  const writeAtLine = (s) => { const t = typeof s?.writeAt === 'number' ? s.writeAt : Date.parse(s?.writeAt || ''); if (!(t > Date.now())) return `Brew starts your brief ${Number.isFinite(t) ? 'in a moment' : 'in a few minutes'} with what it read, unless you check first.`;
    return `Brew starts your brief at ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} with what it read, unless you check first.`; };
  const etaOf = (s) => { const m = s?.etaMin; if (!(m > 0)) return ''; return ` · about ${m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 >= 10 ? ` ${m % 60} min` : ''}`} left`; };
  const signWall = (after) => {
    /* signed in, but not with an email at the brand (and not invited): the read is theirs to look at, the moves wait for the team */
    /* on any path (feed, onboarding, check): their feed would be empty, so the demo stores are the way in. A shared jam's guest
       (a share token, or a jam link) is let through: feed-service guestOk decides what they see */
    const A0 = window.LIVE?.access, guestLink = !!SHARE || /^#(jam|work)=/.test(location.hash) || ls.get(`${LSP()}guest`) === '1'; /* a guest back without the link */
    if (GEN && window.LIVE?.me && A0 && !A0.gen && !A0.full && !guestLink) {
      view = 'signin'; $('#su-done')?.remove(); $('#buddy')?.remove(); window.scrollTo(0, 0);
      const me = window.LIVE.me.email, h = A0.host || B.brand.host, n = esc(B.brand.name), free = FREE_MAIL.test(String(me).split('@')[1] || '');
      root.innerHTML = `<main class="screen sign-wall"><div class="sw-card">
        <div class="sw-mark"><img src="${B.brand.mark}" alt=""></div>
        <h1>${n} is for ${n}${/s$/i.test(B.brand.name || '') ? '’' : '’s'} team</h1>
        <p>${free ? `A personal email like ${esc(me)} can’t open a brand.` : `You’re signed in as ${esc(me)}, which isn’t on ${n}${/s$/i.test(B.brand.name || '') ? '’' : '’s'} team.`} ${A0.claimed ? `Sign in with your work email at ${esc(h)}, or ask the team to invite you.` : `Sign in with your work email at ${esc(h)} to open it.`}</p>
        <p>Just looking around? The demo stores show Brew end to end, with nothing to set up.</p>
        <a class="btn btn-primary lg sw-go" href="${DEMO_STORES}">See demo stores</a>
        <a class="btn btn-ghost" href="${workEmailHref()}">Switch to your work email</a></div></main>`;
      return true;
    }
    if (!needSignin()) return false;
    view = 'signin'; $('#su-done')?.remove(); $('#buddy')?.remove(); window.scrollTo(0, 0);
    if (after === 'who') ls.set(`${LSP()}continue`, '1');
    const next = after === 'check' ? `/${BR}#check` : location.pathname + location.search + location.hash, team = after === 'team'; /* a deep link (a jam, a card) comes back to itself after sign-in */
    /* 'team': a signed-out visitor at a brand's page. What Brew read stays with the brand's team, so no read replay with
       nothing in it: a plain sign-in for the team, true whether the brand is still being read or long finished */
    root.innerHTML = `<main class="screen sign-wall"><div class="sw-card">
      <div class="sw-mark"><img src="${B.brand.mark}" alt=""></div>
      ${team ? '' : `<span class="sw-ok">${ic('check', 's14')}${esc(B.brand.name)} is read</span>`}
      <h1>${team ? `Sign in to open ${esc(B.brand.name)}` : 'Sign in to see your feed'}</h1>
      <p>${team ? `${esc(B.brand.name)}’s feed and moves are for its team. Sign in with your work email at ${esc(B.brand.host)}, or ask the team to invite you.` : `We’ve read ${esc(B.brand.host)}: the store, reviews, rivals and ads. Sign in with your work email at ${esc(B.brand.host)} to open ${esc(B.brand.name)}’s feed and get the moves written.`}</p>
      <a class="btn btn-primary lg sw-go" href="/auth/google?next=${encodeURIComponent(next)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</a>
      <small>Brew gets your Google name, email and photo, nothing else.</small></div></main>`;
    return true;
  };
  const fitSeat = () => { const m = mySeats(); if (m?.length && !m.includes(S.viewer.role)) { S.viewer.role = m[0]; if (!S.viewer.wantsTouched) S.viewer.wants = defaultWants(m[0]); return true; } return false; };
  // a teammate you renamed (Growth lead → Pranav) gets their own initials, not the role's
  const colleague = (id) => { const c = B.colleagues.find((x) => x.id === id) || B.colleagues[0], nm = S.slack.names[c.id]; return { ...c, name: nm || c.name, ini: nm ? nm.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() : c.ini }; };
  const conn = (id) => !!S.conn[id];
  let view = 'feed';
  /* V1 hides Storefront everywhere (testing notes 18 Oct, QA FEED-ARV-05): its column, its ring row, its cards (feed-service visible),
     its agent in the roster and its tag. ?storefront=1 shows it all to us */
  const SF_ON = /[?&]storefront=1\b/.test(location.search), SFQ = SF_ON ? '?sf=1' : '';
  const AGENTS5 = ['creative', 'performance', 'storefront', 'visibility', 'crm'], AGENTS_ON = AGENTS5.filter((a) => a !== 'storefront' || SF_ON);
  /* how a move's number is said (QA FEED-QA-12, move-label.js on the server): weekly moves are numbered from 1001 inside Brew and
     read "Weekly move 11" (badge "W11"), never "Move 1011" */
  const mvLabel = (n) => (+n > 1000 ? `Weekly move ${+n - 1000}` : +n >= 100 ? 'Timely move' : `Move ${String(n).padStart(2, '0')}`), mvNum = (n) => (+n > 1000 ? `W${+n - 1000}` : +n >= 100 ? 'T' : String(n).padStart(2, '0')); /* timely moves (100–999 by hash) carry no number (move-label.js) */
  let GO_LINK = false; /* opened from a Brew email (?go=feed): the feed itself, never the morning stack first */

  /* card as the viewer sees it: role copy, then live numbers for connected sources */
  const cardOf = (p) => {
    let c = { ...p };
    const r = p.byRole?.[S.viewer.role]; if (r) c = { ...c, ...r };
    if (p.live) Object.entries(p.live).forEach(([cid, o]) => { if (conn(cid)) c = { ...c, ...o, liveFrom: cid }; });
    /* Another take (remix.js mirrorTake → p.take): the card's draft slot shows it; the card's own title and why stay the move's.
       Being drawn: the old picture says a new one is coming. Didn't come through: the old picture, and the reason under it */
    if (p.take && (p.take.image || p.take.drawing || p.take.drawError)) { const t = p.take, d0 = c.draft || {}, base = d0.images?.length ? d0.images : (p.research?.kind === 'ad' || p.research?.ad ? [] : (c.images || []).slice(0, 1)); /* a rival's poster is never the stand-in for our take */
      if (t.image) c.draft = { ...d0, as: 'take', images: [t.image], video: null, poster: null, render: null, headline: t.title, title: t.title, copy: t.body, fallback: base[0] || d0.fallback, remaking: false, photoOnly: false, takeErr: null };
      else if (base.length || d0.video) c.draft = { ...d0, as: 'take', images: base, headline: t.title || d0.headline, copy: t.body || d0.copy, remaking: !!t.drawing, photoOnly: false, takeErr: t.drawing ? null : t.drawError }; }
    if (p.done) c.done = p.done; /* only what really happened: the server's own record, never a tap remembered in this browser */
    if (p.kind === 'conflict' && S.decided?.[p.id]) c.done = 'Decided: ' + (p.options.find((o) => o.id === S.decided[p.id])?.name || '');
    return c;
  };
  let RINGS = null;
  /* a studio link (#remix=…) boots the feed underneath first: until the studio opens, keep its full-page layout and hide the feed */
  let BOOT_RX = /^#remix=/.test(location.hash); const endBootRx = () => { if (!BOOT_RX) return; BOOT_RX = false; document.body.classList.remove('rx-boot'); document.body.dataset.view = view; };
  const loadStories = async () => { const r = await tapi('GET', `/api/tenants/:t/stories${SFQ}`); if (r.rings) RINGS = r.rings; };
  /* the rings come after the feed: the feed paints first, the rings slot in when they land (never with a story open) */
  let ringsP = null;
  const ringsLater = () => { if (ringsP) return ringsP; ringsP = loadStories().catch(() => {}).finally(() => { ringsP = null; const el = $('.stories'); if (el && !$('#sv') && RINGS) el.outerHTML = storiesHtml(); }); return ringsP; };
  /* stories keep arriving through the day (each lives 24 h): re-read the rings every 10 minutes while the feed is on screen */
  setInterval(async () => { if (document.hidden || view !== 'feed' || LANDING || !$('.stories')) return; try { await loadStories(); const el = $('.stories'); if (el && !$('#sv')) el.outerHTML = storiesHtml(); } catch {} }, 10 * 60e3);
  let ALL = {}, SCORES = {}, LIMIT = null, PINNED = new Set(), NEWIDS = [], NEWSET = new Set(), saveTouched = 0, SRV = { health: {}, clock: Date.now() }, WORK = { items: [], notes: [], unread: 0, needsYou: 0 };
  const allPosts = () => Object.values(ALL).length ? Object.values(ALL) : B.posts;
  const byId = (id) => ALL[id] || B.posts.find((p) => p.id === id);

  /* ranking lives in the feed service (freshness + impact + affinity + seat − fatigue, then interleave) */
  const loadFeed = async () => {
    await syncNow();
    const r = await tapi('GET', `/api/tenants/:t/feed${SFQ}`); ringsLater(); if (r.error) return null;
    ALL = r.cards; SCORES = r.scores || {}; LIMIT = r.limit; PINNED = new Set(r.pinned || []); SRV.health = r.health || {}; SRV.healthLive = r.healthLive || {}; SRV.aiRing = r.aiRing || null; SRV.clock = r.clock; SRV.yesterday = r.yesterday || [];
    NEWSET = new Set(r.newIds || []);
    /* saves live on the server (every device); the ones this browser kept before that go up once */
    if (Array.isArray(r.saved)) { if (!S.savedSync) { S.savedSync = 1; const up = S.saved.filter((id) => !r.saved.includes(id)); up.forEach((id) => tapi('POST', `/api/cards/${encodeURIComponent(id)}/feedback`, { kind: 'save' })); S.saved = [...new Set([...r.saved, ...up])]; }
      else if (Date.now() - saveTouched > 5000) S.saved = r.saved.slice(); }
    if (r.batches) S.batches = r.batches;
    Object.values(ALL).forEach((c) => { if (c.done && !S.done[c.id]) S.done[c.id] = c.done; });
    if (r.decided) S.decided = { ...r.decided };
    FEED = r.order.map((id) => ALL[id]).filter(Boolean); RANKED = FEED.slice(); return r;
  };
  const rank = () => FEED;
  const affinity = () => { const a = { agent: {}, lane: {}, type: {} }; Object.keys(S.hearts).forEach((id) => { const p = byId(id); if (!p) return; a.agent[p.agent] = (a.agent[p.agent] || 0) + 1; a.lane[p.lane] = (a.lane[p.lane] || 0) + 1; a.type[p.type] = (a.type[p.type] || 0) + 1; }); return a; };

  /* what each action needs connected first */
  const NEEDS = { 'Queue the 12': 'meta', 'Publish Campaign': 'meta', 'Publish the campaign': 'meta', 'Shift budget': 'meta', 'Rotate creative': 'meta', 'Apply the plan': 'meta', 'Run Monday decisions': 'meta', 'Lock the Diwali set': 'meta',
    'Update landing page': 'shopify', 'Apply Update': 'shopify', 'Turn on guest checkout': 'shopify', 'Approve 6 popups': 'shopify', 'Publish the page': 'shopify',
    'Push 5 titles': 'marketplaces', 'Draft the listing': 'marketplaces', 'Send on WhatsApp': 'whatsapp', 'Turn on the journey': 'whatsapp', 'Send the review ask': 'loox', 'Draft the replies': 'loox', 'Add the photos': 'marketplaces',
    'Launch the ad group': 'google', 'Fix tracking': 'google', 'Approve the flows': 'klaviyo' };

  /* =========================================================
     1. Start
     ========================================================= */
  /* onboarding frame: the form on the left, a live preview of the feed on the right */
  const OB_STEPS = ['Your role', 'Focus', 'Tools', 'Team'];
  const lockup = () => /^brew$/i.test(B.brand.name || '') ? `<span class="ob2-lock"><span class="so-mark">${SO()}</span><span><b>Brew</b></span></span>`
    : `<span class="ob2-lock"><span class="so-mark">${SO()}</span><i>×</i><img src="${B.brand.mark}" alt=""><span><b>Brew</b> for ${esc(B.brand.name)}</span></span>`;
  /* only the steps this person will see: the role tapped on the reading screen, or "Just me" (no team step), drop out */
  const obSteps = () => OB_STEPS.map((t, i) => ({ t, n: i + 1 })).filter((x) => !(x.n === 1 && !S.onboarded && qAns('seat')) && !(x.n === 4 && S.viewer.teamSize === 'me'));
  const shell = (inner, step, show) => { const all = step ? obSteps() : [], at = Math.max(1, all.findIndex((x) => x.n === step) + 1); return `<main class="screen ob2${step ? '' : ' ob2-start'}">
      <section class="ob2-form"><header class="ob2-top">${lockup()}${step ? '<button class="btn btn-ghost sm" data-ob-skip>Skip to my feed</button>' : ''}</header>
        ${step ? `<ol class="ob2-steps">${all.map((x, i) => `<li class="${i + 1 < at ? 'done' : i + 1 === at ? 'on' : ''}"><i>${i + 1 < at ? ic('check', 's14') : i + 1}</i><span>${x.t}</span></li>`).join('')}</ol>` : ''}
        <div class="ob2-body">${inner}</div></section>
      <aside class="ob2-show" id="ob-show" aria-hidden="true">${show || (step ? pvLast : '')}</aside></main>`; };
  /* why a read failed, said once: the server's reason when it already tells them what to do, else the reason and what to do */
  const readFail = (msg) => { const m = String(msg || '').trim() || 'The store did not open for us.'; return /try again|check the address/i.test(m) ? m : `${m.replace(/\.?$/, '.')} Check the address, or try again in a few minutes.`; };
  /* who may run Brew on a store, said once on the landing and the check page (no gate behind it) */
  const OWN_LINE = 'Run Brew on your own store, or one you work on. Your team claims the workspace; others only see what’s public.';
  /* is it a website address? { ok } | { name, guess } (a brand name with no dot: one guess, <name>.com) | { bad } */
  const siteOf = (raw) => { const x = String(raw || '').trim(), host = x.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./i, '').toLowerCase();
    if (/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return { ok: true };
    if (!/[./:]/.test(x) && /^[\p{L}\p{N}][\p{L}\p{N} &'’-]{0,60}$/u.test(x) && x.split(/\s+/).length <= 2) { /* a brand name is a word or two ("Footshop", "Only Natural"); a sentence is not a site */ const g = x.toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, ''); return { name: true, guess: g ? `${g}.com` : null }; }
    return { bad: true }; };
  const start = () => {
    /* the start page; a brand page's read begins at setup */
    document.body.classList.remove('deck-on'); view = 'start';
    const art = B.startArt || ['assets/intro-1.jpg', 'assets/intro-2.jpg', 'assets/intro-3.jpg'];
    // the landing page shows what the feed says, for any brand: no one brand's photos, no one country's money
    const LAND_CARDS = [['crm', 'Heard this week', '14 people asked the same sizing question on Reddit. Answer it once, everywhere.', '#1c2a44'], ['visibility', 'AI answers', 'ChatGPT names you in 1 of 4 buyer questions. Here is how to get to 2.', '#2b2440'], ['creative', 'Coming up', 'The next big sale day is in 5 weeks. Planning starts today.', '#3a2a1f']];
    window.scrollTo(0, 0); root.innerHTML = shell(`
        <span class="ob2-eyebrow">Design partner preview</span>
        <h1 class="ob2-h">Your store’s marketing team, in one feed.</h1>
        <p class="ob2-lede">${DEMO_LAND ? 'Pick a real brand below and watch it run. Brew reads' : 'Add your website. Brew reads'} your store, reviews, rivals and AI answers, then ${SF_ON ? 'five' : 'four'} agents bring you ideas you shape together and hand over as one brief.</p>
        ${DEMO_LAND ? `<div class="ob2-demos" id="demos" aria-busy="true">${loader('Finding the demo brands', '', 'sm')}</div>` : `<form class="ob2-url" id="url-form" autocomplete="off">${ic('link', 's18')}<input id="url-in" value="${LANDING ? '' : B.brand.host}" placeholder="yourbrand.com" aria-label="Your website" aria-describedby="url-err" inputmode="url" enterkeyhint="go" autocapitalize="off" spellcheck="false"${window.BREW_DEMO && !LANDING ? ` readonly aria-readonly="true" title="This demo is set up for ${esc(B.brand.host)}"` : ''}><button class="btn btn-primary" id="go" type="submit">Build my feed ${ic('right', 's16')}</button></form>${LANDING ? `<p class="ob2-err" id="url-err" role="alert" hidden></p><p class="ob2-own">${OWN_LINE}</p>` : ''}`}
        <div class="ob2-agents">${AGENTS_ON.map((a) => `<span title="${AGENT[a]}">${face(a)}</span>`).join('')}<small>${SF_ON ? 'Creative, ads, storefront, AI answers and retention agents' : 'Creative, ads, AI answers and retention agents'}</small></div>
        <p class="ob2-foot">${LANDING ? `Brew reads the live site, its reviews, rivals and AI answers, then writes its moves. Every number has a source. ${DEMO_LAND ? 'Connected accounts are a demo workspace, and nothing is sent.' : window.LIVE?.me ? `Signed in as ${esc(window.LIVE.me.email)}.` : window.LIVE?.signin ? 'Sign in with Google. Email sign-in is coming.' : window.LIVE?.dummy === false ? '' : 'Connected accounts are a demo workspace.'}` : `Every idea comes from the Brew × ${esc(B.brand.name)} move documents.${window.LIVE?.dummy === false ? '' : ' Connected numbers are a demo workspace.'}`}</p>${LANDING && !DEMO_LAND ? '<div class="ob2-recent" id="recent"></div>' : ''}${LANDING ? '<p class="ob2-legal">Preview · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>' : ''}`, 0,
      `<div class="ob2-wash"></div><div class="ob2-collage">${LANDING ? LAND_CARDS.map((c, i) => `<figure class="cl cl${i} cl-txt" style="--clc:${c[3]}">${face(c[0])}<small>${esc(c[1])}</small><b>${esc(c[2])}</b></figure>`).join('') : art.map((src, i) => `<figure class="cl cl${i}"><img src="${src}" alt=""></figure>`).join('')}
        <div class="cl-chip c1">${face('creative')}<span><b>Creative director</b>12 ads ready for this week</span></div>
        <div class="cl-chip c2">${face('performance')}<span><b>Performance marketer</b>Two ad versions, drafted</span><em>Jam</em></div></div>`);
    // the tap shows at once: the button spins and says what is happening until the brand's page opens
    const going = (on, t) => { const b = $('#go'), i = $('#url-in'); if (!b) return; b.disabled = on; if (i) i.readOnly = on; $('#url-form')?.classList.toggle('is-busy', on);
      if (on) { b.dataset.t ??= b.innerHTML; b.innerHTML = `<brew-load class="spin"></brew-load>${esc(t)}`; } else if (b.dataset.t) b.innerHTML = b.dataset.t; };
    /* a refusal stays under the field with its reason until they change the address (never a toast that is gone in 3 s);
       a brand name with no dot gets one suggestion that fills the field, never a read started on a guess */
    const urlErr = (t, guess) => { const el = $('#url-err'), i = $('#url-in'); if (!el) return; el.hidden = !t; i?.setAttribute('aria-invalid', t ? 'true' : 'false');
      el.innerHTML = t ? `${ic('info', 's14')}<span>${esc(t)}</span>${guess ? ` <button type="button" class="linkbtn" data-url-guess="${esc(guess)}">Use ${esc(guess)}</button>` : ''}` : '';
      el.querySelector('[data-url-guess]')?.addEventListener('click', (e) => { i.value = e.currentTarget.dataset.urlGuess; urlErr(''); i.focus(); }); };
    const go = async (e) => { e?.preventDefault(); if ($('#go').disabled) return;
      if (LANDING) { // a new brand: start the real read and open its own page
        const url = $('#url-in').value.trim(); if (!url) return $('#url-in').focus();
        const site = siteOf(url); if (!site.ok) { urlErr(site.name ? 'That looks like a name. Paste the website address instead.' : 'That doesn’t look like a website. Try yourbrand.com', site.guess); return $('#url-in').focus(); }
        urlErr(''); going(true, 'Opening your store…');
        const r = await api('/api/brands', { url }).then((j) => (j?.fallback ? null : j)).catch(() => null); /* a dropped network is the plain line below, never "TypeError: Failed to fetch" (QA 19 Oct) */
        if (r?.signin) { going(true, 'Taking you to sign in…'); location.href = `/auth/google?next=${encodeURIComponent('/?build=' + encodeURIComponent(url))}`; return; }
        if (!r?.slug) { going(false); urlErr(r?.error || 'That address did not open. Check it and try again.'); if (r?.demoStores) $('#url-err')?.insertAdjacentHTML('beforeend', ` <a class="linkbtn" href="${DEMO_STORES}">See demo stores</a>`); return $('#url-in').focus(); }
        location.href = '/' + r.slug; return; }
      $('#go').disabled = true; await ensureTenant(true); setup(); };
    if (DEMO_LAND) { // the demo site: only the brands that are ready, and a click starts that brand's tour
      api('/api/demo/brands').then((r) => { const el = $('#demos'); if (!el) return; el.removeAttribute('aria-busy');
        const list = (r?.brands || []).filter((x) => x.loaded); if (!list.length) { el.innerHTML = '<p class="ob2-foot">No demo brands are ready yet.</p>'; return; }
        const src = (x) => (/^https?:/.test(x || '') ? x : '/' + String(x || '').replace(/^\//, ''));
        el.innerHTML = `<small>Pick a brand to start the tour</small><div class="ob2-demo-grid">${list.map((x) => { const m = x.look?.mark || x.look?.logo || x.logo;
          return `<button class="ob2-demo" type="button" data-slug="${esc(x.slug)}"><span class="ob2-demo-mk">${m ? `<img src="${esc(src(m))}" alt="">` : `<i>${esc(String(x.name || '?')[0])}</i>`}</span><span class="ob2-demo-t"><b>${esc(x.name)}</b><small>${esc(x.look?.category || x.host)}</small></span>${ic('right', 's16')}</button>`; }).join('')}</div>`;
        el.querySelectorAll('[data-slug]').forEach((b) => (b.onclick = async () => { const slug = b.dataset.slug; el.querySelectorAll('button').forEach((x) => (x.disabled = true)); b.classList.add('on');
          try { Object.keys(localStorage).filter((k) => k.startsWith(slug + '-')).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
          await fetch(`/api/demo/${slug}/start?d=new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'onboarding' }) }).catch(() => {});
          location.href = '/' + slug; })); });
      return; }
    $('#url-form').onsubmit = go; $('#url-in').addEventListener('input', () => urlErr(''));
    // back from Google sign-in with the address they typed: carry on
    const bq = LANDING && new URLSearchParams(location.search).get('build'); if (bq) { $('#url-in').value = bq; history.replaceState(null, '', '/'); setTimeout(go, 150); }
    if (LANDING && new URLSearchParams(location.search).get('signin') === 'failed') { history.replaceState(null, '', '/'); toast(`${ic('info', 's16')}Google sign-in did not finish. Try again.`); }
    // the landing shows only the demo brands that are fully ready; a tap starts that brand's tour on the demo site
    if (LANDING) api('/api/demo-brands').then((r) => { const el = $('#recent'); if (!el || !r?.brands?.length) return;
      el.innerHTML = `<small>See it run on a real brand</small><div class="ob2-demo-row">${r.brands.map((x) => `<a class="ob2-demo" href="${esc(x.tour)}" aria-label="Start the ${esc(x.name)} tour"><span class="ob2-demo-mk">${x.logo ? `<img src="${esc(x.logo)}" alt="${esc(x.name)}" data-name="${esc(x.name)}">` : `<i>${esc(x.name)}</i>`}</span><span class="ob2-demo-t">Start the tour</span>${ic('right', 's16')}</a>`).join('')}</div>`;
      /* always a wordmark: a square mark or a logo that fails to load becomes the brand's name set as text */
      el.querySelectorAll('.ob2-demo-mk img').forEach((im) => { const word = () => { const i = document.createElement('i'); i.textContent = im.dataset.name; im.replaceWith(i); };
        const chk = () => { if (!im.naturalWidth || im.naturalWidth / im.naturalHeight < 1.8) word(); };
        if (im.complete) chk(); else { im.onload = chk; im.onerror = word; } }); });
  };
  /* =========================================================
     2. Setup: the store is read, the agents wake up
     ========================================================= */
  // a finding from the read: what we saw, and where (the source chip opens it)
  const srcHref = (src) => { const x = String(src || '').trim(); if (/^https?:\/\//.test(x)) return x; if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(x)) return 'https://' + x; return null; };
  const srcShort = (src) => { const x = String(src || '').replace(/^https?:\/\//, '').replace(/^www\./, ''); return x.length > 42 ? x.slice(0, 40) + '…' : x; };
  // the cursor pill's line while the mouse is over a finding: what Brew found, said about the brand
  const gist = (c) => { const n = B.brand.name, t = String(c.t || '');
    if (c.kind === 'text') return `Found the story behind ${n}`;
    if (c.kind === 'kit') return `Found ${n}’s logo, colours and type`;
    if (c.kind === 'grid') return `Found ${n}’s best-selling product photos`;
    if (c.kind === 'quotes') return `Found what your customers think about ${n}`;
    if (c.kind === 'ad') return `Found the ads ${n} and its rivals run`;
    if (c.kind === 'film') return `Found the videos around ${n}`;
    if (c.kind === 'answer') return `Found what AI tools say about ${n}`;
    if (c.kind === 'rows') return /checkout|path/i.test(t) ? `Walked ${n}’s path to checkout` : /catalog|product/i.test(t) ? `Found everything ${n} sells` : `Found ${t.toLowerCase()} for ${n}`;
    return `Found ${t.toLowerCase() || 'something'} for ${n}`; };
  /* a font's family name only (reader/stages/brand.js fontName): reads saved before 22 Oct can carry Google Fonts weights ("Cormorant:100,100italic,…") */
  const fontOnly = (v) => { let f = String(v ?? ''); try { f = decodeURIComponent(f); } catch (e) {} f = f.replace(/\+/g, ' ').split(/[|&]/)[0].split(/[:@;]/)[0].replace(/["']/g, '').replace(/\s+/g, ' ').trim(); return f.slice(0, 60).trim(); };
  /* a read step's line as saved: the brand step ends with the font, which older reads saved with its Google Fonts weights */
  const stepLine = (t) => String(t ?? '').replace(/(\b[A-Za-z][\w .-]*?)(?::|%3A)[0-9][0-9a-z,|:%@;+ .-]*$/i, '$1');
  const scrCard = (c) => {
    let body = '';
    if (c.kind === 'text') body = `<p class="fc-p">${esc(c.p)}</p>`;
    if (c.kind === 'kit') { const cols = (c.colors || B.brand.colors || []).slice(0, 4), tn = fontOnly(c.typeName || B.brand.typeName), ff = String(c.face || B.brand.face || '').split(',').map((x) => fontOnly(x)).filter(Boolean).map((x) => `'${x.replace(/'/g, '')}'`).concat('sans-serif').join(', ');
      body = `<div class="fc-kit"><div class="fc-logo"><img src="${c.logo || B.brand.logo}" alt="${esc(B.brand.name)} logo"></div>
        <div class="fc-sw">${cols.map((x) => `<span><i style="background:${x}"></i><small>${esc(x)}</small></span>`).join('')}</div>
        ${tn ? `<div class="fc-type"><b style="font-family:${esc(ff)}">Aa</b><span title="${esc(tn)}">${esc(tn)}</span></div>` : ''}</div>`; }
    if (c.kind === 'quotes') body = `<div class="fc-quotes">${c.quotes.map((q) => `<blockquote>${esc(String(q).replace(/^[“"]|[”"]$/g, ''))}</blockquote>`).join('')}</div>`;
    if (c.kind === 'rows') body = `<dl class="fc-rows">${c.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    if (c.kind === 'grid') body = `<div class="fc-grid">${c.imgs.slice(0, 4).map((x) => `<span><img src="${x}" alt="" loading="lazy"></span>`).join('')}</div>`;
    if (c.kind === 'film' || c.kind === 'ad') body = `${c.img ? `<div class="fc-media"><img src="${c.img}" alt="" loading="lazy">${c.kind === 'film' ? `<i>${ic('play', 's16')}</i>` : ''}</div>` : ''}${c.copy ? `<p class="fc-p">${esc(c.copy)}</p>` : ''}`;
    if (c.kind === 'answer') body = `<div class="fc-ans"><span class="fc-q">${ic('chat', 's14')}${esc(c.q)}</span><p class="fc-p">${esc(c.a)}</p></div>`;
    const href = srcHref(c.src), cap = c.cap || c.foot;
    return `<article class="scr fc" data-gist="${esc(gist(c))}"><header><h5>${esc(c.t)}</h5>${c.src ? `<${href ? `a href="${esc(href)}" target="_blank" rel="noopener"` : 'span'} class="fc-src" title="${esc(c.src)}">${ic('link', 's14')}${esc(srcShort(c.src))}</${href ? 'a' : 'span'}>` : ''}</header>${body}${cap ? `<footer>${esc(cap)}</footer>` : ''}</article>`;
  };
  const cursorSvg = () => `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="var(--fg)" stroke="var(--bg)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  // on the setup read the mouse itself is a Brew-style cursor: the black arrow with its label pill (fine pointers only; touch keeps nothing)
  const meCursor = () => {
    if (meCursor.on || !matchMedia('(pointer:fine)').matches) return; meCursor.on = true;
    document.body.insertAdjacentHTML('beforeend', `<div class="me-cur" id="me-cur">${cursorSvg()}<span></span></div>`);
    const el = $('#me-cur'), sp = el.querySelector('span');
    addEventListener('mousemove', (e) => { const on = !!$('.screen.setup') && !$('#qfull') && !!e.target.closest?.('.su-main') && !e.target.closest?.('button,a,.su-done'); document.body.classList.toggle('has-me-cur', on); if (!on) return; /* never over the questions or a button */
      // over a card: what we found there, in short; elsewhere: how much of the brand is read so far
      const card = e.target.closest?.('.scr.fc'), n = $$('#scr .scr').length;
      const say = card?.dataset.gist || (n ? `${B.brand.name}: ${n} finding${n > 1 ? 's' : ''}${$('#su-done') ? '' : ' so far'}` : `Reading ${B.brand.name}`);
      if (sp.textContent !== say) sp.textContent = say;
      // near the right edge the pill sits to the left of the arrow so it is never cut off
      const w = el.offsetWidth, flip = e.clientX + w > innerWidth - 12; el.classList.toggle('flip', flip);
      el.style.transform = `translate(${flip ? e.clientX - w + 18 : e.clientX - 4}px,${e.clientY - 2}px)`; }, { passive: true });
    document.addEventListener('mouseleave', () => document.body.classList.remove('has-me-cur'));
  };
  const setup = async () => {
    if (needSignin() && signWall('team')) return; /* signed out: the read is the team's, so ask them to sign in first */
    if (GEN && window.LIVE?.me && window.LIVE?.access && !window.LIVE.access.gen && !(B.steps || []).length && signWall('check')) return; /* signed in from outside the team: the read was kept from them, so no empty replay */
    meCursor();
    view = 'setup'; holdView('Opening the read', '', root);
    // the rivals step shows what the Ad Library research really found (research.js), not a canned line
    const res = await fetch('/api/research').then((r) => r.json()).catch(() => null);
    const ra = !GEN && res?.ads?.items?.length ? res.ads : null; // a generated brand's reader already shows its real ads
    /* the ads step quotes the one count (pack-numbers.js, window.BREW_NUMBERS) when the brand has it: the same rivals and numbers as the check page */
    const NB = window.BREW_NUMBERS, steps = ra && !NB?.rivalAds ? B.steps.map((x) => x.k === 'ads' ? { ...x, done: `${ra.brands.length} rivals: ${ra.brands.reduce((n, b) => n + (b.live || 0), 0).toLocaleString('en-IN')} live ads` } : x) : B.steps;
    const cards = ra ? B.scrape.map((c) => c.kind === 'ad' ? { ...c, src: `Meta Ad Library · ${B.config?.countryName || 'live'}`, img: ra.items[0].poster, copy: ra.items.slice(0, 3).map((a) => `${a.brand}: ${a.hook}`).join(' · '), foot: `${ra.items[0].brand}'s top ad has run ${ra.items[0].days} days in ${ra.items[0].versions} versions.` } : c) : B.scrape;
    /* v1 (19 Oct, from the prototype): the read shows once, then five questions take the whole screen while the read carries on
       behind them, then the read comes back with everything that landed meanwhile (OB2.questions, questions.js). Once per
       brand per browser; no tutorial, stack or gate on v1 */
    /* answered before by this signed-in person (another browser, a private window, their phone): the answers come back from the
       server (GET /setup, kept per person per brand) and the questions are not asked again */
    if (GEN && window.OB2?.questions && !window.OB2.qState().qDone) { const sv = (await tapi('GET', '/api/tenants/:t/setup').catch(() => null))?.setup;
      if (sv?.done) { const done = {}; if (sv.role && B.roles?.[sv.role]) { S.viewer.role = sv.role; done.seat = sv.role; } if (Array.isArray(sv.wants) && sv.wants.length) { S.viewer.wants = sv.wants; S.viewer.wantsTouched = true; done.first = sv.wants; }
        if (Array.isArray(sv.channels)) { S.viewer.channels = sv.channels; done.channels = sv.channels; } save(); ls.set(`${LSP()}q1`, JSON.stringify({ qDone: true, done, fromServer: true })); } }
    const QM = GEN && !!window.OB2?.questions && !window.OB2.qState().qDone;
    root.innerHTML = `
      <main class="screen setup">
        <aside class="su-rail">
          <div class="host"><img src="${B.brand.mark}" alt="">${esc(B.brand.host)}</div>
          <ol class="steps">${steps.map((s, i) => `<li class="step" data-i="${i}"><span class="dot"></span><div><b>${esc(s.t)}</b><span>Queued</span></div></li>`).join('')}</ol>
          <div class="roster"><h4>Setting up your agents</h4>${AGENTS_ON.map((a) => `<div class="agent-row" data-a="${a}">${face(a)}<div><b>${AGENT[a]}</b><span class="st">Waiting</span></div></div>`).join('')}</div>
        </aside>
        <section class="su-main">
          <div class="su-head"><h2>Reading ${esc(B.brand.name)}</h2><span>Your store, reviews, rivals and AI answers.</span><button class="btn btn-ghost sm skip" id="skip">Skip ahead</button></div>
          <div class="scr-grid" id="scr"></div>
        </section>
      </main>
      <div class="buddy" id="buddy" style="opacity:0">${cursorSvg()}<span>Brew</span></div>`;
    let skipped = false, failed = false, readIn = false, Q = null, qOpened = false;
    const buddy = $('#buddy');
    /* the done bar waits for both: the read (readP) and, with the questions, the last answer (qP, which also says whether the
       taps already confirmed the read) */
    let readyGo, qGo; const readP = new Promise((r) => (readyGo = r)), qP = QM ? new Promise((r) => (qGo = r)) : Promise.resolve({});
    const qBuf = [], toQ = (ev) => { if (!QM) return; if (Q) Q.feed(ev); else qBuf.push(ev); };
    const keepSetup = () => { const d = window.OB2.qState().done || {}, ok = (k) => d[k] != null && d[k] !== 'skip';
      tapi('PUT', '/api/tenants/:t/setup', { ...(ok('seat') ? { role: S.viewer.role } : {}), ...(ok('first') ? { wants: S.viewer.wants } : {}), ...(ok('channels') ? { channels: S.viewer.channels || [] } : {}), done: true }).catch(() => {}); };
    /* the question layer: full screen, one question in the middle, five marks for progress, the read as one quiet line */
    const readLine = () => { const done = $$('.step.done').length, n = $$('#scr .scr').length; return readIn ? `${esc(B.brand.name)} is read · ${n} findings` : `<brew-load class="spin"></brew-load>Reading ${esc(B.brand.name)} · ${done} of ${steps.length} · ${n} findings`; };
    const qLayer = () => { if ($('#qfull')) return; document.body.insertAdjacentHTML('beforeend', `<div class="qfull" id="qfull" role="dialog" aria-modal="true" aria-label="A few questions">
        <header class="qf-top"><span class="qf-read" id="qf-read">${readLine()}</span><ol class="qf-prog" id="qf-prog" aria-hidden="true"></ol><button class="btn btn-ghost sm" id="qf-skip">Skip questions</button></header>
        <div class="qf-mid"><div class="ob2-body v2-body qf-stage" id="v2-stage"></div></div></div>`);
      document.body.classList.add('qf-on'); $('#qf-skip').onclick = () => Q?.skip(); };
    const qClose = () => { $('#qfull')?.remove(); document.body.classList.remove('qf-on'); };
    const qPaint = () => { const el = $('#qf-read'); if (el) el.innerHTML = readLine(); };
    const qOpen = () => { $('#su-ask')?.remove(); qLayer(); if (qOpened) return; qOpened = true;
      window.OB2.questions({
        onShow: qLayer, /* a product or rival question whose data landed late */
        onStep: (i, n) => { const el = $('#qf-prog'); if (el) el.innerHTML = Array.from({ length: n }, (_, k) => `<li class="${k < i ? 'done' : k === i ? 'on' : ''}"></li>`).join(''); },
        onWait: () => { qClose(); if (!readIn && !$('#su-wait')) document.body.insertAdjacentHTML('beforeend', `<div class="su-done" id="su-wait"><brew-load class="spin"></brew-load><div><b>Thanks. Brew is still reading ${esc(B.brand.name)}.</b><span>Your feed opens from here the moment the read is in.</span></div></div>`); },
        onDone: (r) => { qClose(); keepSetup(); qGo(r || {}); }
      }).then((h) => { Q = h; qBuf.splice(0).forEach((ev) => h.feed(ev)); }); };
    /* the read once: after a handful of findings (or a few seconds) a bar offers the questions; the read never stops for them */
    const askText = () => readIn ? `<b>${esc(B.brand.name)} is read.</b><span>Five quick taps, so your feed fits you.</span>` : '<b>Brew keeps reading in the background.</b><span>Five quick taps meanwhile, so your feed fits you.</span>';
    const askBar = () => { const t0 = $('#su-ask-t'); if (t0) t0.innerHTML = askText(); if (!QM || qOpened || skipped || failed || $('#su-ask')) return;
      document.body.insertAdjacentHTML('beforeend', `<div class="su-done" id="su-ask"><span class="su-ok">${ic('sparkles', 's18')}</span><div id="su-ask-t">${askText()}</div><button class="linkbtn" id="su-ask-no">Skip</button><button class="btn btn-primary lg" id="su-ask-go">Answer 5 questions ${ic('right', 's18')}</button></div>`);
      $('#su-ask-go').onclick = qOpen; $('#su-ask-go').focus();
      $('#su-ask-no').onclick = () => { $('#su-ask')?.remove(); qOpened = true; window.OB2.questions({ onDone: (r) => { keepSetup(); qGo(r || {}); } }).then((h) => { Q = h; qBuf.splice(0).forEach((ev) => h.feed(ev)); h.skip(); }); }; };
    if (QM) setTimeout(askBar, 9000);
    const fly = (el, say) => { if (!el) return; const sp = buddy.querySelector('span'), was = buddy.offsetWidth; const prev = sp.textContent; sp.textContent = say; const r = el.getBoundingClientRect(), w = Math.max(was, buddy.offsetWidth); sp.textContent = prev; clearTimeout(fly.t); fly.t = setTimeout(() => (sp.textContent = say), 900); clearTimeout(fly.h); fly.h = setTimeout(() => { buddy.style.opacity = 0; }, 2800); buddy.style.opacity = 1; buddy.style.transform = `translate(${Math.max(8, Math.min(r.left + r.width * .6, r.right - w - 8, innerWidth - w - 16))}px,${Math.min(r.top + 26, innerHeight - 60)}px)`; }; // the label swaps once the cursor lands, so a longer one never sticks out mid-flight
    // POST /tenants started the read; GET /tenants/:id/onboarding streams each step and finding as it lands
    const es = new EventSource(`/api/tenants/${TID}/onboarding`);
    $('#skip').onclick = () => { if (failed) return; skipped = true; /* a read that failed has nothing to skip ahead to (QA 19 Oct) */ es.close(); Q?.stop(); qClose(); $('#buddy')?.remove(); $$('#su-done,#su-ask,#su-wait').forEach((x) => x.remove()); if (signWall('who')) return; afterRead(); };
    es.onmessage = async (m) => {
      if (skipped) return es.close();
      let ev; try { ev = JSON.parse(m.data); } catch (e) { return; } const li = ev.i != null ? $(`.step[data-i="${ev.i}"]`) : null;
      toQ(ev);
      if (ev.type === 'step' && ev.state === 'reading' && li) { li.classList.add('reading'); if (!li.querySelector('.spin')) li.querySelector('.dot').innerHTML = '<brew-load class="spin"></brew-load>'; li.querySelector('span:last-child').textContent = `Reading ${ev.tick}`; }
      if (ev.type === 'finding') { $('#scr').insertAdjacentHTML('beforeend', scrCard(ev.finding)); const el = $('#scr').lastElementChild; el.classList.add('fresh'); $$('#scr .scr.fresh').forEach((x) => x !== el && x.classList.remove('fresh')); if (!$('#qfull')) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); if (ev.say && !$('#qfull')) setTimeout(() => fly(el, ev.say), 350); if ($$('#scr .scr').length >= 6) askBar(); qPaint(); }
      if (ev.type === 'agent') { const row = $(`.agent-row[data-a="${ev.agent}"]`); if (row) { row.classList.add('on'); row.querySelector('.st').textContent = 'Has ideas ready'; } }
      if (ev.type === 'step' && ev.state === 'done' && li) { li.classList.remove('reading'); li.classList.add('done'); li.classList.toggle('empty', !!ev.empty); li.querySelector('.dot').innerHTML = ic(ev.empty ? 'minus' : 'check', 's14'); li.querySelector('span:last-child').textContent = stepLine(ev.done); qPaint(); } /* a step that found nothing or could not finish gets a dash, never a tick */
      if (ev.type === 'error') { failed = true; es.close(); buddy.remove(); qClose(); $('#skip')?.remove(); const hd = $('.su-head h2'); if (hd) hd.textContent = `We couldn’t read ${B.brand.name}`; /* no "Reading …", no Skip ahead into an empty feed */ $$('#su-ask,#su-wait').forEach((x) => x.remove()); $$('.step.reading').forEach((el) => { el.classList.remove('reading'); el.querySelector('.dot').innerHTML = ic('minus', 's14'); });
        $$('.agent-row').forEach((r) => { r.classList.remove('on'); r.querySelector('.st').textContent = 'Nothing read'; }); /* nothing was read, so no agent has ideas */
        document.body.insertAdjacentHTML('beforeend', `<div class="su-done" id="su-done"><div><b>We couldn’t read ${esc(B.brand.name)}.</b><span>${esc(readFail(ev.msg))}</span></div><button class="btn btn-primary lg" id="su-next">Back to the start</button></div>`);
        $('#su-next').onclick = () => { location.href = '/'; }; return; }
      if (ev.type === 'ready') { es.close(); if (ev.name && ev.name !== B.brand.name) { B.brand.name = ev.name; const h = $('.su-head h2'); if (h) h.textContent = `Reading ${ev.name}`; document.title = document.title.replace(/^[^·]*·/, `${ev.name} ·`); } finishRead(); }
    };
    const finishRead = async () => {
      if (readIn) return; readIn = true; $$('.agent-row').forEach((r) => { r.classList.add('on'); r.querySelector('.st').textContent = 'Has ideas ready'; });
      buddy.style.opacity = 0; await wait(500); if (skipped) return; buddy.remove();
      // a brand read earlier can say "ready" before any step: show what was read, not seven "Queued" rows and 0 findings
      steps.forEach((x, i) => { const el = $(`.step[data-i="${i}"]`); if (el && !el.classList.contains('done')) { const empty = x.state === 'empty'; el.classList.remove('reading'); el.classList.add('done'); el.classList.toggle('empty', empty); el.querySelector('.dot').innerHTML = ic(empty ? 'minus' : 'check', 's14'); el.querySelector('span:last-child').textContent = stepLine(x.done) || (empty ? 'Nothing found' : 'Done'); } });
      if (!$$('#scr .scr').length && cards.length) $('#scr').innerHTML = cards.map(scrCard).join('');
      qPaint(); askBar(); readyGo();
    };
    // stop here: the presenter moves on when the room has taken it in
    const showDone = async (q = {}) => {
      if (skipped || failed || $('#su-done')) return; $$('#su-ask,#su-wait').forEach((x) => x.remove());
      const n = $$('#scr .scr').length, posted = !!q.posted;
      /* every read leads to "Is this right?"; the feed is a quiet skip. Saving with nothing changed rewrites nothing (recheckIfLate needs checkTouched) */
      document.body.insertAdjacentHTML('beforeend', `<div class="su-done" id="su-done"><span class="su-ok">${ic('check', 's18')}</span><div><b>${esc(B.brand.name)} is read.</b><span>${steps.length} sources, ${n} findings. Your feed starts from these.</span></div>${GEN ? '<button class="linkbtn" id="su-skip">Skip to my feed</button>' : ''}<button class="btn btn-primary lg" id="su-next">${GEN ? 'Check what we read' : 'Set up my feed'} ${ic('right', 's18')}</button></div>`);
      if (skipped) return;
      /* the questions confirmed the read: a reload, so the feed opens with the real logo, products and cards (as after the check page) */
      const toFeed = (b) => { if (signWall('who')) return; if (posted) { b.disabled = true; return continueToFeed(); } $('#su-done').remove(); afterRead(); };
      $('#su-next').onclick = (e) => { const b = e.currentTarget; if (!GEN) return toFeed(b); if (signWall('check')) return; b.disabled = true; b.innerHTML = '<brew-load class="spin"></brew-load>Opening'; checkRead().finally(() => $('#su-done')?.remove()); }; $('#su-next').focus();
      $('#su-skip')?.addEventListener('click', (e) => toFeed(e.currentTarget));
    };
    Promise.all([readP, qP]).then(([, q]) => showDone(q));
    /* the stream drops (a restart): while questions are open, the status poll says when the read is in; otherwise on to the seat, as before */
    const poll = async () => { if (skipped || readIn) return; const s = await api(`/api/brands/${B.slug || BR}/status`).catch(() => null);
      if (s?.stages?.read?.state === 'done') { toQ({ type: 'ready' }); return finishRead(); } setTimeout(poll, 8000); };
    es.onerror = () => { if (skipped || readIn) return; es.close(); if (QM && GEN) return poll(); buddy.remove(); if (signWall('who')) return; afterRead(); };
  };

  /* ---------- "Check what we read": the brand confirms the facts everything else is built on ---------- */
  const COUNTRIES = [['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'UAE'], ['CA', 'Canada'], ['AU', 'Australia'], ['SG', 'Singapore'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'], ['CZ', 'Czechia'], ['PL', 'Poland']];
  const CURRENCIES = ['INR', 'USD', 'GBP', 'AED', 'CAD', 'AUD', 'SGD', 'EUR', 'CZK', 'PLN'];
  const checkRead = async () => {
    if (signWall('check')) return;
    view = 'check'; window.scrollTo(0, 0); const slug = B.slug || BR; if (!S.onboarded) obAt('check'); holdView('Opening what we read', '', root);
    const D = await api(`/api/brands/${slug}/check`); if (!D || D.error) { toast(`${ic('info', 's16')}${esc(D?.error || 'Could not load what we read')}`); return waitMoves({ fromCheck: true }); }
    const st = { hero: new Set(D.products.filter((x) => x.hero).map((x) => x.handle)), removed: new Set(), addProducts: [], removeRivals: new Set(), addRivals: [], who: {}, sources: {}, company: {} };
    const srcLine = (x) => x.src ? `<a class="ck2-src" ${x.url ? `href="${esc(x.url)}" target="_blank" rel="noopener"` : ''}>${ic('link', 's14')}${esc(srcShort(x.src))}${x.at ? ` · ${esc(x.at)}` : ''}</a>` : `<span class="ck2-src is-none">Not found on the site</span>`;
    const field = (x, group) => { const opts = x.type === 'country' ? COUNTRIES : x.type === 'currency' ? CURRENCIES.map((c) => [c, c]) : null;
      const wide = x.key === 'descriptor';
      return `<label class="ck2-f${wide ? ' ck2-wide' : ''}"><span>${esc(x.label)}</span>${wide ? `<textarea data-g="${group}" data-k="${x.key}" rows="1" placeholder="Add it if you know it">${esc(x.v)}</textarea>` : opts ? `<select data-g="${group}" data-k="${x.key}">${(opts.some(([v]) => v === x.v) ? opts : [[x.v, x.v || 'To confirm'], ...opts]) /* a market the read couldn't call is asked, never guessed */.map(([v, n]) => `<option value="${esc(v)}"${v === x.v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<input data-g="${group}" data-k="${x.key}" value="${esc(x.v)}" placeholder="Add it if you know it">`}${x.src ? '' : '<span class="ck2-src is-none">Not found on the site</span>'}</label>`; };
    /* one line per section says where its fields were read, instead of a source under every field */
    const readFrom = (xs) => { const hs = [...new Set(xs.filter((x) => x.src).map((x) => srcShort(x.src).replace(/^(?:https?:\/\/)?(?:www\.)?/, '').split('/')[0]))], at = xs.find((x) => x.at)?.at;
      return hs.length ? `Read from ${esc(hs.slice(0, 2).join(' and '))}${at ? ` on ${esc(fmtDay(Date.parse(at)) || at)}` : ''}` : ''; };
    const prodTile = (x) => `<div class="ck2-p${st.hero.has(x.handle) ? ' is-hero' : ''}" data-h="${esc(x.handle)}" data-star="${esc(x.handle)}" role="button" tabindex="0" aria-pressed="${st.hero.has(x.handle)}" title="Tap to lead with it, or leave it out"><div class="ck2-pi">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : ''}</div>
      <div class="ck2-pt"><b>${esc(x.title)}</b><span>${esc(x.price || '')}</span></div>
      <div class="ck2-pa"><button class="ck2-x" data-rmp="${esc(x.handle)}" title="Not a real product, remove" aria-label="Remove ${esc(x.title)}">×</button></div></div>`;
    const rivalTile = (r) => `<div class="ck2-r" data-host="${esc(r.host)}"><img src="${esc(r.logo)}" alt="" loading="lazy"><div><b>${esc(r.name || r.host)}</b><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.host)}</a>${r.live ? `<small>${r.live} live ad${r.live === 1 ? '' : 's'}</small>` : ''}</div><button class="ck2-x" data-rmr="${esc(r.host)}" title="Not a rival, remove">×</button></div>`;
    const sourceRow = (x) => `<div class="ck2-s${x.found ? '' : ' is-miss'}" data-sk="${x.key}"><div><span>${esc(x.label)}</span><b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.v)}</a>` : esc(x.v)}</b></div>
      <button class="linkbtn" data-fix="${x.key}">${x.found ? 'Change' : 'Add the link'}</button><div class="ck2-fix" hidden><input data-src="${x.key}" placeholder="${esc(x.hint)}" inputmode="url"><small>We read it from that link. Typed numbers are never used.</small></div></div>`;
    root.innerHTML = `<main class="screen ck2"><div class="ck2-wrap">
      <header class="ck2-head">${D.logo ? `<span class="ck2-logo"><img src="${esc(D.logo)}" alt=""></span>` : ''}<button class="btn btn-ghost sm ck2-skip" id="ck-skip">${S.onboarded ? 'Skip to my feed' : 'Skip for now'}</button><div><h1>Is this right?</h1><p>${D.started ? 'Brew is writing with what it read. Fix anything that’s off and the brief and your first moves are rewritten with it.' : `${writeAtLine(D)} Fix anything that’s off.`}</p></div></header>
      <section class="ck2-card"><h2>Who you are <small>${readFrom(D.who)}</small></h2><div class="ck2-grid">${D.who.map((x) => field(x, 'who')).join('')}</div></section>
      <section class="ck2-card"><h2>What you sell <small>${D.read != null && D.count > D.read ? `${D.read} of ${Number(D.count).toLocaleString('en-IN')}` : D.count} read · tap to choose the ones to lead with</small></h2>${D.storeNote ? `<p class="ck2-note">${ic('info', 's14')}${esc(D.storeNote)}</p>` : ''}<div class="ck2-prods${D.products.length > 8 ? ' is-cap' : ''}" id="ck2-prods">${D.products.map(prodTile).join('')}</div>${D.products.length > 8 ? `<button class="linkbtn ck2-all" data-ckall>Show ${D.products.length - 8} more</button>` : ''}
        <form class="ck2-add" data-add="product"><input placeholder="Paste a product page link to add it" inputmode="url"><button class="btn btn-ghost sm">Add product</button></form></section>
      <section class="ck2-card"><h2>Who you compete with</h2><div class="ck2-rivals" id="ck2-rivals">${D.rivals.length ? D.rivals.map(rivalTile).join('') : '<p class="ck2-empty">No rivals yet. Add the brands you lose sales to.</p>'}</div>
        <form class="ck2-add" data-add="rival"><input placeholder="Paste a rival’s website, e.g. rivalbrand.com" inputmode="url"><button class="btn btn-ghost sm">Add rival</button></form></section>
      <section class="ck2-card"><h2>Where you show up</h2><div class="ck2-srcs">${D.sources.map(sourceRow).join('')}</div></section>
      ${D.company.length ? `<details class="q-more ck2-co"><summary>Company details (optional)</summary><div class="ck2-grid">${D.company.map((x) => field(x, 'company')).join('')}</div></details>` : ''}
      <p class="q-note">Anything without a source is written as “to confirm”.</p>
      <p class="q-note">${OWN_LINE}</p>
      <div class="ck2-bar"><button class="btn btn-primary lg" id="ck-go">${D.started ? 'Save my corrections' : 'Looks right, write my moves'} ${ic('right', 's18')}</button></div>
    </div></main>`;
    const paintStars = () => $$('.ck2-p').forEach((el) => { const on = st.hero.has(el.dataset.h); el.classList.toggle('is-hero', on); el.setAttribute('aria-pressed', on); });
    root.onclick = (e) => {
      const ca = e.target.closest('[data-ckall]'); if (ca) { $('#ck2-prods')?.classList.remove('is-cap'); ca.remove(); return; }
      const s1 = !e.target.closest('[data-rmp]') && e.target.closest('[data-star]'); if (s1) { const h = s1.dataset.star; st.hero.has(h) ? st.hero.delete(h) : st.hero.add(h); paintStars(); return; }
      const rp = e.target.closest('[data-rmp]'); if (rp) { st.removed.add(rp.dataset.rmp); st.hero.delete(rp.dataset.rmp); rp.closest('.ck2-p').remove(); return; }
      const rr = e.target.closest('[data-rmr]'); if (rr) { st.removeRivals.add(rr.dataset.rmr); rr.closest('.ck2-r').remove(); return; }
      const fx = e.target.closest('[data-fix]'); if (fx) { const box = fx.parentElement.querySelector('.ck2-fix'); box.hidden = !box.hidden; if (!box.hidden) box.querySelector('input').focus(); }
    };
    root.onkeydown = (e) => { const t = e.target.closest?.('.ck2-p'); if (t && e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); } };
    $$('.ck2-add').forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); const inp = f.querySelector('input'), u = inp.value.trim(); if (!u) return; const btn = f.querySelector('button'); btn.disabled = true; btn.innerHTML = '<brew-load class="spin"></brew-load>Reading';
      const r = await api(`/api/brands/${slug}/check`, f.dataset.add === 'product' ? { addProducts: [u] } : { addRivals: [u] }); btn.disabled = false; btn.textContent = f.dataset.add === 'product' ? 'Add product' : 'Add rival';
      if (r?.notes?.length) toast(`${ic('info', 's16')}${esc(r.notes[0])}`);
      if (r?.data) { inp.value = ''; if (f.dataset.add === 'product') { const nw = r.data.products.find((x) => x.added && !$(`.ck2-p[data-h="${CSS.escape(x.handle)}"]`)); if (nw) { st.hero.add(nw.handle); $('#ck2-prods').insertAdjacentHTML('afterbegin', prodTile({ ...nw, hero: true })); } }
        else { const have = new Set($$('.ck2-r').map((x) => x.dataset.host)); r.data.rivals.filter((x) => !have.has(x.host) && !st.removeRivals.has(x.host)).forEach((x) => { $('.ck2-empty')?.remove(); $('#ck2-rivals').insertAdjacentHTML('beforeend', rivalTile(x)); }); } } });
    /* the quiet skip every setup step has: Brew writes with what it read at the time it said; the setup goes on (or back to the feed) */
    $('#ck-skip').onclick = () => { if (S.onboarded) { clearTimeout(waitMoves.t); return location.replace(location.pathname + location.search); } continueToFeed(); };
    $('#ck-go').onclick = async () => { const go = $('#ck-go'); go.disabled = true; go.innerHTML = '<brew-load class="spin"></brew-load>Saving';
      const v2 = { hero: [...st.hero], removed: [...st.removed], removeRivals: [...st.removeRivals], who: {}, company: {}, sources: {} };
      $$('[data-g]').forEach((el) => { const orig = [...D.who, ...D.company].find((x) => x.key === el.dataset.k); if (orig && String(orig.v) !== el.value.trim() && el.value.trim()) v2[el.dataset.g][el.dataset.k] = el.value.trim(); });
      $$('[data-src]').forEach((el) => { if (el.value.trim()) v2.sources[el.dataset.src] = el.value.trim(); });
      const r = await api(`/api/brands/${slug}/confirm`, { v2 }); if (r?.notes?.length) toast(`${ic('info', 's16')}${esc(r.notes.join(' '))}`);
      /* the moves write in the background: straight on to the seat picker (a reload, so the feed has the brand's real look and cards) */
      if (r?.signin || r?.error) { toast(`${ic('info', 's16')}${esc(r.error || 'Sign in to continue.')}`); go.disabled = false; go.innerHTML = `${D.started ? 'Save my corrections' : 'Looks right, write my moves'} ${ic('right', 's18')}`; return; }
      /* a correction after the moves started still reaches the brief: say what is being rewritten, then carry on */
      if (r?.recheck?.words) { toast(`${ic('refresh', 's16')}Rewriting the brief and your first moves with ${esc(r.recheck.words)}`); await wait(1800); }
      if (S.onboarded) { clearTimeout(waitMoves.t); location.replace(location.pathname + location.search); } else continueToFeed(); }; /* set up already: back to the feed, not the seat picker */
  };
  /* ---------- the moves take a while: show what we have now, and email when they are ready ---------- */
  const waitMoves = async (o = {}) => {
    view = 'wait'; root.onclick = null; root.onkeydown = null; window.scrollTo(0, 0); const slug = B.slug || BR; clearTimeout(waitMoves.t); if (!$('.wt2')) holdView('Opening', '', root);
    const [st, f] = await Promise.all([api(`/api/brands/${slug}/status`), api(`/api/brands/${slug}/findings`)]);
    if (st?.done && !o.stay) return continueToFeed();
    if (waitsOnCheck(st) && !o.stay && !o.fromCheck) return checkRead(); /* nothing is being written yet: the check is what it waits for */
    const nm = esc(st?.name || B.brand.name), cards = f?.cards || [], mail = ls.get(`${LSP()}mail`);
    const stages = (s) => { const g = s?.stages || {}, n = s?.movesDone || 0, N = +s?.total || 0; /* one count: the brand's playbook (status.total); none until the engine has counted it */
      const row = (state, t, sub) => `<li class="is-${state}"><i>${state === 'done' ? ic('check', 's14') : state === 'run' ? '<brew-load class="spin"></brew-load>' : ''}</i><div><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}</div></li>`;
      return `<ol class="wt2-steps">${row('done', 'Read your site', 'Products, reviews, ads, rivals, AI answers')}${row(g.brief?.state === 'done' ? 'done' : g.confirm?.state === 'done' ? 'run' : 'wait', 'Write the brand brief', '')}
        ${row(n >= 10 ? 'done' : g.brief?.state === 'done' ? 'run' : 'wait', 'The first 10 moves', `${Math.min(n, 10)} of 10 · positioning, customers, rivals, pricing`)}${row(N && n >= N ? 'done' : n >= 10 ? 'run' : 'wait', N ? `All ${N} moves` : 'The rest of the moves', N ? `${n} of ${N} written${etaOf(s)}` : `${n} written`)}</ol>
        <div class="wt2-bar"><i style="width:${Math.max(4, N ? Math.round(100 * Math.min(n, N) / N) : 0)}%"></i></div>`; };
    const mailBox = (em) => mailMe() && !window.BREW_DEMO && ls.get(`${LSP()}mail-mute`) !== mailMe() ? mailOnHtml(mailMe(), 'wt2-mailed') /* signed in: already on, with Mute */
      : em ? `<div class="wt2-mailed">${ic('check', 's16')}<span>We’ll email <b>${esc(em)}</b> when they’re ready.</span><button class="linkbtn" id="wt-change">Change</button></div>`
      : window.BREW_DEMO ? '<p class="wt2-note">The demo sends no email. Open what we have now; new moves land in the feed.</p>' /* the demo's visitor has no real address */
      : mailMe() ? `<form class="wt2-mail" id="wt-mail"><input type="hidden" id="wt-email" value="${esc(mailMe())}"><button class="btn btn-primary sm" type="submit">${ic('bell', 's14')}Email me when they’re ready</button><small class="wt2-to">To ${esc(mailMe())}</small></form>` /* signed in: we know the address */
      : `<form class="wt2-mail" id="wt-mail"><label for="wt-email">Get an email when they’re ready</label><div class="wt2-in"><input type="email" id="wt-email" required placeholder="you@${esc(B.brand.host || 'brand.com')}" autocomplete="email"><button class="btn btn-primary sm" type="submit">Notify me</button></div></form>`;
    root.innerHTML = `<main class="screen wt2"><div class="wt2-wrap">
      <aside class="wt2-side"><div class="wt2-panel">
        <div class="wt2-brand">${B.brand.logo ? `<span class="ck2-logo"><img src="${esc(st?.logo ? '/' + String(st.logo).replace(/^\//, '') : B.brand.logo)}" alt=""></span>` : ''}<span class="wt2-live"><span class="dot"></span>Working</span></div>
        <h1>Figuring out the best moves for ${nm}</h1>
        <p>${+st?.total ? `${+st.total} plans` : 'A set of plans'}, each with its sources, a 30-day rollout and what to watch. They land one by one; the time left shows once we can measure the pace.${st?.stages?.confirm?.state === 'waiting' ? ` ${writeAtLine(st)}` : ''}</p>
        <div id="wt-stages">${stages(st)}</div>
        <div id="wt-mailbox">${mailBox(mail)}</div>
        <button class="btn btn-primary lg wt2-go" id="wt-go">Open what we have now ${ic('right', 's18')}</button>
        <small class="wt2-note">Your feed already has what we found. New cards land as each move is written.</small>
      </div></aside>
      <section class="wt2-main"><h2>What we already found <small>${cards.length} findings, each with its source</small></h2><div class="wt2-grid">${cards.map(scrCard).join('')}</div></section>
    </div></main>`;
    const bindMail = () => { const f0 = $('#wt-mail'); if (f0) f0.onsubmit = async (e) => { e.preventDefault(); const em = $('#wt-email').value.trim(); const btn = f0.querySelector('button'); btn.disabled = true;
        const r = await api(`/api/brands/${slug}/notify`, { email: em }); btn.disabled = false;
        if (r?.ok) { ls.set(`${LSP()}mail`, em); $('#wt-mailbox').innerHTML = mailBox(em); bindMail(); } else toast(`${ic('info', 's16')}${esc(r?.error || 'That did not go through. Try again.')}`); };
      const ch = $('#wt-change'); if (ch) ch.onclick = () => { ls.del(`${LSP()}mail`); $('#wt-mailbox').innerHTML = mailBox(null); bindMail(); $('#wt-email')?.focus(); }; };
    bindMail();
    $('#wt-go').onclick = continueToFeed;
    const poll = async () => { if (view !== 'wait') return; const s2 = await api(`/api/brands/${slug}/status`); const el = $('#wt-stages'); if (el && s2) el.innerHTML = stages(s2);
      if (s2?.done) { const lv = $('.wt2-live'); if (lv) lv.innerHTML = `${ic('check', 's14')}Ready`; const go = $('#wt-go'); if (go) go.innerHTML = `${+s2.total ? `All ${+s2.total}` : 'All the'} moves are ready. Open the feed ${ic('right', 's18')}`; return; } /* every move is written: say so, and stop asking */
      waitMoves.t = setTimeout(poll, 12e3); };
    waitMoves.t = setTimeout(poll, 12e3);
  };
  // the page was opened before the read: reload so the feed has the real logo, colours, products and cards, then carry on to the seat picker
  const continueToFeed = () => { clearTimeout(waitMoves.t); if (S.obStep === 'check') { delete S.obStep; save(); } /* past the check: the reload opens the next step, not the check again */ ls.set(`${LSP()}continue`, '1'); location.reload(); };

  /* =========================================================
     3. Onboarding: who is this for, what do you want, connect, team
     ========================================================= */
  document.addEventListener('click', (e) => { if (e.target.closest('[data-ob-skip]')) { finishOnboarding(); } });
  /* the right-hand preview: the real ranked feed for the seat being picked */
  const pvCard = (p) => { const c = cardOf(p), img = (c.images || [])[0], f = window.fx || ((x) => x);
    return `<div class="pv-card">${img ? `<img src="${img}" alt="">` : `<span class="pv-ph">${face(p.agent)}</span>`}<div><small>${face(p.agent)}${esc(fromLabel(c))}</small><b>${esc(f(c.title))}</b><span>${esc(c.cta?.label || 'Open')} ${ic('right', 's14')}</span></div></div>`; };
  let pvSeq = 0, pvLast = '';
  const obPreview = async () => {
    const host = $('#ob-show'); if (!host) return; const seq = ++pvSeq, R = ROLE();
    const paint = (cards, all = cards) => { if (seq !== pvSeq || !$('#ob-show')) return;
      const yes = yesOf(all).length; /* the greeting's own rule, on the same ranked feed: no padded minimum */
      host.innerHTML = `<div class="ob2-wash"></div><div class="pv">
        <p class="pv-cap">Your feed, as ${/^[AEIOU]/.test(R.name) ? 'an' : 'a'} ${esc(R.name.toLowerCase())}</p>
        <div class="pv-win"><div class="pv-bar"><i></i><i></i><i></i><span>${location.host}</span></div>
          <div class="pv-in"><small>Today</small><h3>${dayPart()}${hiName(R)}</h3>
            <div class="pv-tiles">${yes ? `<span class="hot"><b>${yes}</b>need your yes</span>` : ''}${all.length ? `<span><b>${all.length}</b>${all.length === 1 ? 'card' : 'cards'}</span>` : ''}<span><b>5</b>agents on it</span></div>
            ${cards.slice(0, 3).map(pvCard).join('')}</div></div></div>`; pvLast = host.innerHTML.replace('class="pv"', 'class="pv still"'); };
    let cards = [];
    let all = [];
    if (TID) { const r = await loadFeed(); if (r && RANKED.length) { all = RANKED; cards = RANKED.slice(0, 8); } }
    if (!cards.length) { all = B.posts.filter((p) => !p.onlyWhen && (!p.roles || p.roles.includes(S.viewer.role)) && !p.kind?.startsWith?.('conf')); cards = all.slice(0, 8); }
    paint(cards, all);
  };
  const LANE_IMG = B.laneImg || {};
  const obNav = (next, back) => `<div class="ob2-nav">${back ? `<button class="btn btn-ghost lg" id="ob-back">${ic('left', 's18')} Back</button>` : '<span></span>'}<button class="btn btn-primary lg" id="ob-next">${next} ${ic('right', 's18')}</button></div>`;
  /* the first person from the brand to set it up claims it (eligible: a work email at the brand, nobody on it yet), so Invite
     your team and @tags work for them from here */
  let claiming = null;
  const claimFirst = () => { const A0 = window.LIVE?.access; if (!(GEN && window.LIVE?.me && A0 && !A0.role)) return Promise.resolve(); if (claiming) return claiming; /* Brew staff (full) get an error back: nothing to claim */
    return (claiming = api(`/api/brands/${B.slug || BR}/claim`, {}).then((r) => { if (!r || r.error) return; if (r.access && window.LIVE) window.LIVE.access = { ...A0, ...r.access }; else A0.role = r.role || 'owner'; }).catch(() => {}).finally(() => { claiming = null; })); };
  /* the voice tap (v1 questions) becomes a brand rule every draft reads; only the team saves it, so after the claim */
  const pushVoice = () => { const v = S.viewer.voice; if (!GEN || !v || S.viewer.voiceSaved === v) return;
    tapi('POST', `/api/brands/${B.slug || BR}/voice`, { voice: v }).then((r) => { if (r && !r.error) { S.viewer.voiceSaved = v; save(); } }).catch(() => {}); };
  /* what the reading screen's questions already asked (questions.js): those screens are not asked twice */
  const qAns = (id) => { const d = window.OB2?.qState?.().done?.[id]; return d != null && d !== false && d !== 'skip'; }; /* a tap keeps its value, a brand tap true, a skip 'skip' */
  /* the setup step this browser is on (per brand, in S): a refresh opens the same step, never the one before it */
  const OB_AT = { check: () => checkRead(), who: () => whoFor(), want: () => wantWhat(), connect: () => connectWhat(), team: () => teamStep() }; /* check: a refresh on "Is this right?" reopens it, not the whole read (QA 19 Oct) */
  const obAt = (k) => { if (S.obStep !== k) { S.obStep = k; save(); } };
  const resumeOb = () => { if (signWall(S.obStep === 'check' ? 'check' : 'who')) return; claimFirst().then(pushVoice); view = 'ob'; (OB_AT[S.obStep] || whoFor)(); };
  const afterRead = () => { if (signWall('who')) return; if (OB_AT[S.obStep] && S.obStep !== 'who') return resumeOb(); claimFirst().then(pushVoice); if (qAns('seat') && S.viewer.role) { view = 'ob'; return wantWhat(); } whoFor(); };
  const whoFor = () => {
    if (signWall('who')) return;
    claimFirst();
    view = 'ob'; if (!S.onboarded) obAt('who');
    window.scrollTo(0, 0); root.innerHTML = shell(`
      <h1 class="ob2-h">Who’s this feed for?</h1><p class="ob2-lede">Pick your seat. The feed ranks and words every card for it. You can switch any time.</p>
      <div class="ob2-grid">${seatEntries().map(([k, r]) => `<button class="ob2-tile" data-role="${k}" aria-pressed="${S.viewer.role === k}">${face(r.face)}<b>${esc(r.title)}</b><span>${esc(r.line)}</span><i class="ob2-tick">${ic('check', 's14')}</i></button>`).join('')}</div>
      ${obNav('Next')}`, 1);
    obPreview();
    $$('[data-role]').forEach((b) => b.onclick = () => { S.viewer.role = b.dataset.role; if (!S.viewer.wantsTouched) S.viewer.wants = defaultWants(b.dataset.role); $$('[data-role]').forEach((x) => x.setAttribute('aria-pressed', x === b)); save(); obPreview(); });
    $('#ob-next').onclick = () => { save(); wantWhat(); };
  };
  const defaultWants = (r) => ({ founder: ['decision', 'competitor'], growth: ['decision', 'report'], brand: ['idea', 'competitor'], ecom: ['decision', 'report'], crm: ['decision', 'idea'] }[r]);
  const wantWhat = () => {
    /* during onboarding, what the reading-screen questions asked is not asked again (a later Tune shows everything) */
    const noWants = !S.onboarded && qAns('first'), noLane = !S.onboarded && qAns('lead'); if (!S.onboarded) obAt('want');
    const laneIds = Object.keys(B.lanes || {}), lanePics = laneIds.every((k) => LANE_IMG[k]) && new Set(laneIds.map((k) => LANE_IMG[k])).size === laneIds.length; /* a photo only when each product has its own: one shared picture on every chip tells them apart by nothing */
    window.scrollTo(0, 0); root.innerHTML = shell(`
      <div class="ob3">${noWants && noLane ? '<h1 class="ob2-h">Anything Brew should know?</h1><p class="ob2-lede">What works for you, what doesn’t, what you’ve learned. Optional.</p>' : noWants ? '<h1 class="ob2-h">Anything Brew should know?</h1><p class="ob2-lede">The product you’re pushing, and what you’ve learned. Both optional.</p>' : '<h1 class="ob2-h">What should come first?</h1><p class="ob2-lede">Pick up to two, and tell Brew what you’ve learned.</p>'}
      ${noWants ? '' : `<section class="ob3-s"><small class="ob3-k">Show me first</small>
        <div class="ob3-pills">${Object.entries(B.wants).map(([k, w]) => `<button class="ob3-pill" data-want="${k}" aria-pressed="${S.viewer.wants.includes(k)}" title="${esc(w.line)}">${ic('check', 's14')}${esc(w.name)}</button>`).join('')}</div></section>`}
      ${noLane ? '' : `<section class="ob3-s"><small class="ob3-k">The product you’re pushing</small>
        <div class="ob3-pills">${Object.entries(B.lanes).map(([k, l]) => `<button class="ob3-pill${lanePics ? ' ob3-prod' : ''}" data-lane="${k}" aria-pressed="${S.viewer.lane === k}">${lanePics ? `<img src="${LANE_IMG[k]}" alt="">` : ''}${esc(l.name)}</button>`).join('')}</div></section>`}
      <section class="ob3-s"><small class="ob3-k">In your own words</small>
        <div class="ob3-say"><textarea id="ob-say" data-nomic data-ownmic rows="1" placeholder="Type here, or tap the mic and talk.">${esc(S.viewer.focusNote || '')}</textarea>${window.Mic?.supported ? `<button type="button" class="ob3-mic" id="ob-say-mic" aria-label="Talk instead of typing" title="Talk instead of typing">${ic('mic', 's16')}</button>` : ''}</div>
        <small id="ob-said" class="ob3-said">${S.viewer.focusNote ? `${ic('check', 's14')}Saved. Your moves, docs and cards follow this.` : ''}</small></section></div>
      ${obNav('Next', true)}`, 2);
    obPreview();
    $$('[data-want]').forEach((b) => b.onclick = () => {
      const k = b.dataset.want, w = S.viewer.wants;
      if (w.includes(k)) S.viewer.wants = w.filter((x) => x !== k); else { w.push(k); if (w.length > 2) w.shift(); }
      S.viewer.wantsTouched = true;
      $$('[data-want]').forEach((x) => x.setAttribute('aria-pressed', S.viewer.wants.includes(x.dataset.want))); save(); obPreview();
    });
    $$('[data-lane]').forEach((b) => b.onclick = () => { S.viewer.lane = b.dataset.lane; $$('[data-lane]').forEach((x) => x.setAttribute('aria-pressed', x === b)); save(); obPreview(); });
    /* in their own words: the server maps it onto the picks, keeps the words, and lifts the cards that match */
    const sayIt = async () => { const ta = $('#ob-say'), text = ta?.value.trim(); if (!text || text === S.viewer.focusNote) return true; const said = $('#ob-said'); if (window.__obSayBusy) return true; window.__obSayBusy = true; said.textContent = 'Reading it…';
      const r = await tapi('POST', '/api/tenants/:t/focus', { text }); window.__obSayBusy = false; if (r.error) { said.textContent = r.error; return false; }
      S.viewer.focusNote = text; S.viewer.focusTerms = r.terms || []; if (r.wants?.length) { S.viewer.wants = r.wants; S.viewer.wantsTouched = true; } if (r.lane) S.viewer.lane = r.lane; save();
      $$('[data-want]').forEach((x) => x.setAttribute('aria-pressed', S.viewer.wants.includes(x.dataset.want))); $$('[data-lane]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.lane === S.viewer.lane));
      said.innerHTML = `${ic('check', 's14')}${r.learning ? 'Got it. Brew is learning from this. Your moves, docs and cards follow it.' : 'Got it. Your feed follows this.'}`; obPreview(); return true; };
    $('#ob-say-mic')?.addEventListener('click', (e) => { const b = e.currentTarget; if (window.Mic?.on) { window.Mic.stop(); b.classList.remove('is-on'); b.setAttribute('aria-label', 'Talk instead of typing'); return; } window.Mic?.talk($('#ob-say')); b.classList.add('is-on'); b.setAttribute('aria-label', 'Stop and use what I said'); const w = setInterval(() => { if (!window.Mic?.on) { b.classList.remove('is-on'); clearInterval(w); } }, 400); }); $('#ob-say').addEventListener('blur', () => sayIt()); const fitSay = (t) => { t.style.height = 'auto'; t.style.height = Math.min(200, t.scrollHeight + 2) + 'px'; }; /* grows with what they write (a saved note opens at its full height) */
    $('#ob-say').addEventListener('input', (e) => fitSay(e.target)); fitSay($('#ob-say')); $('.ob3-say').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#ob-say').focus(); });
    $('#ob-say').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sayIt(); } });
    $('#ob-back').onclick = whoFor; $('#ob-next').onclick = async () => { await sayIt(); connectWhat(); };
  };
  const connectWhat = () => {
    /* the tools picked on the reading screen come first (each still needs its own sign-in, so nothing is preselected) */
    const ids = [...new Set([...(S.viewer.tools || []), ...ROLE().connectors])].filter((k) => B.connectors?.[k]); if (!S.onboarded) obAt('connect');
    window.scrollTo(0, 0); root.innerHTML = shell(`
      <h1 class="ob2-h">Connect your tools</h1><p class="ob2-lede">${window.LiveConn?.boss?.() === false ? 'Your admin connects these. Once they’re on, cards swap targets for your real numbers.' : 'Cards swap targets for your real numbers. Optional, and you can do it later from any card.'}</p>
      <div class="ob2-cx">${ids.map((id) => cxRow(id)).join('')}</div>
      <p class="ob2-foot">${ic('lock', 's14')} ${window.LIVE?.dummy === false ? `Read-only. Brew never changes your accounts${ids.includes('slack') ? '; Slack posts only to the channel you pick' : ''}.` : 'Demo workspace. No real account is touched.'}</p>
      ${obNav('Next', true)}`, 3);
    obPreview();
    $('#ob-back').onclick = wantWhat; $('#ob-next').onclick = () => (S.viewer.teamSize === 'me' ? finishOnboarding() : teamStep()); /* "Just me" on the reading screen: no invite step */
  };
  const cxRow = (id) => { const c = B.connectors[id], used = view === 'ob' && (S.viewer.tools || []).includes(id);
    return `<div class="cx-row" data-cxrow="${id}">${glyph(id, 40)}<span class="lg-tx"><b>${esc(c.name)}${c.optional ? ' <span class="src-opt">optional</span>' : ''}${used ? ' <span class="src-opt">You use this</span>' : ''}</b><span>${esc(c.kind)}</span></span>
      ${conn(id) ? `<span class="cx-on">${ic('check', 's14')} Connected</span>` : window.LiveConn?.boss?.() === false ? `<span class="cx-ask">Admin connects</span>` : `<button class="btn btn-primary sm" data-cx="${id}">Connect</button>`}</div>`; };
  /* the last step: invite the people you'll jam with. They get an email and see only the views you pick. Admins invite;
     a teammate sees who's already here. Nothing about anyone is typed twice: you are who you signed in as */
  const IV = { sent: [], busy: false, chips: [], seats: null, warn: false, open: false };
  const teamStep = () => {
    const ac = window.LIVE?.access, boss = !!ac?.role /* admins and teammates both invite; a teammate only to their own views */, team = (ac?.team || []).filter((x) => x.email !== ME()?.email);
    if (!GEN || !ME() || !ac?.role) return finishOnboarding(); /* only a brand's own team brings people in */
    if (!S.onboarded) obAt('team');
    const seats = seatEntries(); IV.seats = (IV.seats || []).filter((k) => seats.some(([s0]) => s0 === k)); if (!IV.seats?.length) IV.seats = [seats.find(([k]) => k !== S.viewer.role)?.[0] || seats[0]?.[0]];
    const seatWords = (ks) => ks.length >= Object.keys(B.roles || {}).length ? 'Everything' : ks.map((k) => B.roles[k]?.title || k).join(', ');
    const okMail = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && e !== ME()?.email;
    const row = (x) => `<li class="iv-p">${pAv(x, 28)}<b>${esc(x.name || x.email)}</b><small>${esc(x.tag)}</small></li>`;
    const list = [...IV.sent.map((x) => ({ email: x.email, tag: `Invited · ${seatWords(x.seats || [])}` })), ...team.map((x) => ({ ...x, tag: x.role === 'owner' ? 'Admin' : 'On the team' }))];
    /* one field for everyone: type or paste emails, each becomes a chip; one view for the batch, one Invite */
    const chip = (e, i) => `<span class="iv-chip${okMail(e) ? '' : ' bad'}">${esc(e)}<button type="button" data-iv-x="${i}" aria-label="Remove ${esc(e)}">${ic('x', 's12')}</button></span>`;
    window.scrollTo(0, 0); root.innerHTML = shell(`
      <h1 class="ob2-h">Invite your team</h1><p class="ob2-lede">Jam on any card together. When someone tags them or needs their OK, they get an email.</p>
      ${boss ? `<form class="iv-form" id="iv-f" novalidate>
        <label class="iv-box" for="iv-email">${IV.chips.map(chip).join('')}<input id="iv-email" type="email" placeholder="${IV.chips.length ? 'Add another' : `name@${esc(B.brand.host || 'brand.com')}, name2@…`}" autocomplete="off" aria-label="Emails to invite"></label>
        <div class="iv-act"><details class="iv-seat" id="iv-seat"${IV.open ? ' open' : ''}><summary>They see <b>${esc(seatWords(IV.seats))}</b></summary>
            <div class="iv-menu" role="group" aria-label="What they see">${seats.map(([k, r]) => `<label class="iv-opt"><input type="checkbox" data-iv-seat="${k}"${IV.seats.includes(k) ? ' checked' : ''}><span>${esc(r.title)}</span><i>${ic('check', 's14')}</i></label>`).join('')}</div></details>
          <button class="btn btn-primary" id="iv-go">Invite${IV.chips.length > 1 ? ` ${IV.chips.length}` : ''}</button></div></form>
        <p class="iv-msg" id="iv-msg" role="status"${IV.warn ? ' data-kind="warn"' : ' hidden'}>${IV.warn ? 'Invites saved, but the emails didn’t send. Copy the links from Team and access.' : ''}</p>`
      : `<p class="iv-note">${ic('person', 's14')}Only an admin invites people. Ask ${esc(team.find((x) => x.role === 'owner')?.name || 'your admin')} to add anyone missing.</p>`}
      ${list.length ? `<ul class="iv-list">${list.map(row).join('')}</ul>` : ''}
      ${obNav(IV.sent.length || team.length ? 'Open my feed' : 'Skip for now', true)}`, 4);
    obPreview();
    const f = $('#iv-f');
    if (f) { const msg = (kind, t) => { const el = $('#iv-msg'); el.hidden = !t; el.dataset.kind = kind; el.textContent = t || ''; };
      const inp = $('#iv-email'), redraw = () => { teamStep(); setTimeout(() => $('#iv-email')?.focus(), 20); };
      const take = (text) => { const got = String(text).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); if (!got.length) return false;
        IV.chips = [...new Set([...IV.chips, ...got])]; return true; };
      inp.onkeydown = (e) => { if ([',', ';', ' ', 'Enter', 'Tab'].includes(e.key) && inp.value.trim()) { if (e.key === 'Tab') return; e.preventDefault(); take(inp.value); redraw(); }
        else if (e.key === 'Backspace' && !inp.value && IV.chips.length) { IV.chips.pop(); redraw(); } };
      inp.onpaste = (e) => { const t = e.clipboardData?.getData('text') || ''; if (!/[\s,;]/.test(t.trim())) return; e.preventDefault(); take(inp.value + ' ' + t); redraw(); };
      $$('[data-iv-x]').forEach((el) => { el.onclick = (e) => { e.preventDefault(); IV.chips.splice(+el.dataset.ivX, 1); redraw(); }; });
      const menu = $('#iv-seat'); menu.ontoggle = () => { IV.open = menu.open; };
      $$('[data-iv-seat]').forEach((el) => { el.onchange = () => { const k = el.dataset.ivSeat, on = el.checked;
        IV.seats = on ? [...new Set([...IV.seats, k])] : IV.seats.filter((x) => x !== k);
        if (!IV.seats.length) { IV.seats = [k]; el.checked = true; } /* at least one view */
        menu.querySelector('summary b').textContent = seatWords(IV.seats); }; });
      const shut = (e) => { if (!menu.isConnected) return document.removeEventListener('click', shut); if (menu.open && !menu.contains(e.target)) { menu.open = false; IV.open = false; } };
      document.addEventListener('click', shut);
      f.onsubmit = async (e) => { e.preventDefault(); if (IV.busy) return; IV.busy = true; take(inp.value); inp.value = '';
        const todo = IV.chips.slice();
        if (!todo.length) { IV.busy = false; msg('bad', 'Add an email to invite.'); return inp.focus(); }
        if (todo.some((x) => !okMail(x))) { IV.busy = false; teamStep(); return msg('bad', todo.includes(ME()?.email) ? 'One of those is you. You’re already on the team.' : 'Fix or remove the emails in red.'); }
        $('#iv-go').disabled = true; $('#iv-go').textContent = 'Sending…';
        const left = []; let err = '';
        for (const email of todo) { const r = await api(`/api/brands/${B.slug || BR}/team`, { action: 'invite', email, seats: IV.seats });
          if (r.error) { left.push(email); err = r.error; continue; }
          if ((r.members || r.team) && window.LIVE) window.LIVE.access = { ...window.LIVE.access, ...r };
          if (r.warn) IV.warn = true;
          IV.sent = [{ email, seats: IV.seats.slice() }, ...IV.sent.filter((x) => x.email !== email)]; }
        IV.busy = false; IV.open = false; IV.chips = left; redraw(); if (err) msg('bad', err); }; }
    $('#ob-back').onclick = connectWhat; $('#ob-next').onclick = finishOnboarding;
  };
  /* the two counts, named the same everywhere: the cards the feed shows, and the moves (plans) they come from */
  const CARDS_WORD = (n) => `card${n === 1 ? '' : 's'} in your feed`, MOVES_WORD = (n) => `move${n === 1 ? '' : 's'} in your plan`;
  const movesInPlan = () => { const n = +BREW?.movesDone || +window.MOVES_WRITTEN || 0, t = +BREW?.total || +window.MOVES_TOTAL || 0; return t ? Math.min(n, t) : n; }; /* the seed's count (pack-numbers.js) until status loads: always a number */
  const finishOnboarding = async () => {
    if ($('#ready') || finishOnboarding.busy) return; // a double-click on Next must not stack a second ready card
    S.onboarded = true; delete S.obStep; save(); sound('win'); tapi('POST', '/api/tenants/:t/ready'); claimFirst().then(pushVoice); /* the voice tap, if it did not save yet */
    /* the cards count is the feed's own: before the feed has loaded, load it (a few seconds at most), so it never says 0 */
    finishOnboarding.busy = true; if (!rank().length) await Promise.race([loadFeed().catch(() => null), wait(4000)]); finishOnboarding.busy = false; if ($('#ready')) return;
    const n = rank().length || (B.posts || []).filter((p) => !p.onlyWhen).length, R = ROLE();
    const nc = Object.keys(S.conn).filter(conn).length;
    const mvTile = () => { const m = movesInPlan(); return `<div data-mv-tile${m ? '' : ' hidden'}><b class="tnum">${m}</b>${MOVES_WORD(m)}</div>`; }; /* no 0 tile (quiet UI) */
    if (GEN && !BREW) loadMV().then(() => { const el = $('#ready [data-mv-tile]'); if (el) el.outerHTML = mvTile(); }).catch(() => {});
    document.body.insertAdjacentHTML('beforeend', `<div class="ready" id="ready"><div class="ready-card">
      <span class="so-mark" style="width:30px;height:30px">${SO()}</span>
      ${n ? `<h3>Your feed is ready${myFirst() ? ', ' + esc(myFirst()) : ''}.</h3>
      <p>${n} ${n === 1 ? 'card' : 'cards'}, picked for ${/^[AEIOU]/i.test(R.name) ? 'an' : 'a'} ${esc(R.name.toLowerCase())}. Each comes from a move in your plan. Tap any card to see more.</p>`
      : `<h3>Your cards are on their way${myFirst() ? ', ' + esc(myFirst()) : ''}.</h3>
      <p>Brew starts writing the moves your cards come from when you open your feed. Each card lands there as its move is done.</p>`}
      <div class="counts">${n ? `<div><b class="tnum">${n}</b>${CARDS_WORD(n)}</div>` : ''}${mvTile()}<div><b class="tnum">5</b>agents</div>${nc ? `<div><b class="tnum">${nc}</b>connected</div>` : ''}</div>
      ${window.BREW_NUMBERS?.storeNote ? `<p class="ready-note">${esc(window.BREW_NUMBERS.storeNote)}</p>` : ''}
      <button class="lm" id="open-feed"><span class="lm-rim"><span class="lm-in">Open my feed ${ic('right', 's18')}</span></span></button>
    </div></div>`);
    $('#open-feed').onclick = () => { $$('.ready').forEach((x) => x.remove()); feed(); };
    $('#open-feed').focus();
  };

  /* =========================================================
     4. The feed
     ========================================================= */
  const mediaSlot = (imgs, opts = {}) => {
    const fit = opts.fit === 'contain' ? ' contain' : '';
    const port = opts.portrait || imgs.some((x) => String(x).includes('statics/')) ? ' portrait' : '', extra = opts.extra || '';
    const bg = opts.fitBg ? ` style="background:${opts.fitBg}"` : '';
    const f = opts.filter ? ` style="filter:${opts.filter}"` : '';
    const fb = opts.fallback ? ` data-fb="${esc([].concat(opts.fallback).filter(Boolean).join('|'))}"` : ''; /* what the page shows if a picture can't load (onAssetError) */
    if (imgs.length === 1) return `<div class="media${fit}${port}"${bg}><img src="${imgs[0]}" alt="${esc(opts.alt || '')}" loading="lazy"${fb}${f}>${extra}</div>`;
    return `<div class="media${fit}${port}" data-car="0"${bg}>${extra}<div class="track">${imgs.map((s) => `<img src="${s}" alt="" loading="lazy"${fb}${f}>`).join('')}</div>
      <button class="nav l" aria-label="Previous">${ic('left', 's16')}</button><button class="nav r" aria-label="Next">${ic('right', 's16')}</button>
      <div class="dots">${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div></div>`;
  };
  const barHtml = (cta, done) => {
    if (done) return `<button class="bar is-done" data-label="${esc(cta.label)}"><span class="lead">${ic('check', 's16')}${esc(done)}</span>${ic('right', 's16 chev')}</button>`;
    // real brand marks, never a letter standing in for one
    const mark = cta.logo === 'meta' ? '<span class="mark is-logo"><img src="assets/logos/meta.svg" alt="Meta"></span>' : ic('inf', 's16');
    return `<button class="bar" data-label="${esc(cta.label)}"><span class="lead">${mark}${esc(cta.label)}</span>${ic('right', 's16 chev')}</button>`;
  };
  /* like, then jam on the left; save on the right */
  const actsHtml = (p) => `<div class="acts">
      <button class="icon-btn" data-act="heart" aria-pressed="${!!S.hearts[p.id]}" aria-label="More like this">${ic('heart')}</button>
      <button class="icon-btn" data-act="jam" aria-label="Jam with the team">${ic('hand')}</button>
      ${proofBtn(p)}
      <button class="icon-btn" data-act="take" aria-label="Another take, a free draft" title="Another take · Free draft">${ic('refresh')}</button>
      <span class="sp"></span>
      <button class="icon-btn" data-act="save" aria-pressed="${S.saved.includes(p.id)}" aria-label="Save for later">${ic('bookmark')}</button></div>`;
  /* the proof on every card (evidence.js via /api/cards/:cid/evidence): why Brew suggested it, and the hard evidence behind it */
  const proofBtn = (p) => { if (/^(build-|status-)/.test(String(p.id || '')) || p.kind === 'status') return ''; /* a status card ("All 56 moves are written") claims nothing to prove */ const n = +p.proof?.n || 0; return `<button class="icon-btn pf-btn${p.proof?.strength === 'thin' ? ' is-thin' : ''}" data-act="proof" aria-label="Why this card, and the proof" title="Why Brew suggested this, and the proof">${ic('shield')}${n ? `<span class="pf-n">${n}</span>` : ''}</button>`; };
  const pfDay = (s) => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''; };
  /* the sheet says only what a brand needs: the one reason, the few numbers behind it (each with where it came from) and the plan it
     belongs to. Kind labels, move source lists and repeats stay out; the full plan is one tap away */
  const pfSrc = (x) => { const src = /^what brew counted$/i.test(x.src || '') || x.kind === 'row' && !x.src ? 'Brew’s count' : /^brew’s maths/i.test(x.src || '') ? 'Brew’s maths' : /^(?:https?:\/\/)?(?:www\.)?([\w-]+(?:\.[\w-]+)+)\/\S*$/i.test(x.src || '') ? x.src.replace(/^(?:https?:\/\/)?(?:www\.)?([^/]+).*$/i, '$1') /* a page address reads as its site */ : x.src || '';
    const t = esc([src, pfDay(x.at)].filter(Boolean).join(' · '));
    return x.url ? `<a class="pf-src" href="${esc(x.url)}" target="_blank" rel="noopener">${t || 'Source'}${ic('external', 's12')}</a>` : t ? `<span class="pf-src">${t}</span>` : ''; };
  /* a short number sits in its own column; a longer value ("226 reviews, 4.47★") goes on its own line; what people wrote reads as a quote.
     A page Brew read that says its number in its label ("MitoActive price: ₹1,499") shows that number like any other */
  const pfRow = (x) => { let v = String(x.value || ''), l = String(x.label || '');
    if (!v && x.kind === 'source') { const m = l.match(/^(.{3,}?):\s*(.+)$/), t = m && m[2].replace(/\s*\([^)]*\)?\s*…?$/, '').replace(/…$/, '').trim(); if (t && /\d/.test(t) && t.length <= 24) { l = m[1]; v = t; } }
    const label = `${esc(l)}${x.extra ? ` · ${esc(x.extra)}` : ''}`;
    if (v && v.length <= 9) return `<li class="pf-r"><b class="pf-v">${esc(v)}</b><span class="pf-l">${label}</span>${pfSrc(x)}</li>`;
    const quote = /^(quote|voice|ad|idea|read|team)$/.test(x.kind) && v.length > 24; if (quote) v = v.replace(/^[“"]\s*|\s*[”"]$/g, '');
    return `<li class="pf-r is-text">${v ? quote ? `<q class="pf-q">${esc(v)}</q>` : `<b class="pf-v">${esc(v)}</b>` : ''}<span class="pf-l">${label}</span>${pfSrc(x)}</li>`; };
  /* what the proof rests on, said plainly, and the accounts that would check it against the brand's real numbers. A card from public
     data says so; its connectors are the ones for its area (ads → Meta/Google Ads, store → Shopify/Analytics, customers → Klaviyo) */
  const PF_CX = { ads: ['meta', 'google', 'shopify'], creatives: ['meta', 'shopify'], storefront: ['shopify', 'ga4'], catalog: ['shopify', 'ga4'], visibility: ['ga4', 'google'], signals: ['shopify', 'klaviyo'],
    'rival-weakness': ['meta', 'shopify'], 'social-posts': ['meta'], 'price-offer': ['shopify', 'ga4'], cro: ['shopify', 'ga4'], seo: ['ga4', 'google'], 'ai-seo': ['ga4'], listening: ['shopify', 'reviews'], automation: ['klaviyo', 'shopify'] };
  const pfBasis = (items, p, needs) => { const c = p ? cardOf(p) : {}, host = String(B.brand?.host || '').replace(/^www\./, ''), on = (x) => { const h = String(x.url || '').match(/^https?:\/\/(?:www\.)?([^/]+)/)?.[1] || ''; return host && (h === host || h.endsWith('.' + host)); };
    const said = new Set(), acct = new Set();
    for (const x of items) { const src = `${x.src || ''} ${x.url || ''}`;
      if (x.kind === 'account') acct.add(String(x.src || '').replace(/^Your\s+|\s+account$/gi, ''));
      else if (x.kind === 'voice' || /judge\.?me|loox|okendo|yotpo|reviews?/i.test(src) && !/ad library/i.test(src)) said.add('customer reviews');
      else if (x.kind === 'team') said.add('what your team told Brew');
      else if (x.kind === 'quote') said.add('what people say online');
      else if (x.kind === 'ad') said.add('rivals’ live ads');
      else if (x.kind === 'trend') said.add('Google searches');
      else if (x.kind === 'web' || x.url && !on(x) && x.kind === 'source') said.add('other sites Brew read');
      else said.add('your public store pages'); }
    const list = [...said], join = (a) => a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '';
    const ids = [...new Set([...(needs || []), ...(PF_CX[c.family] || []), ...(PF_CX[c.sector] || []), 'shopify', 'ga4', 'meta'])].filter((id) => B.connectors?.[id] && !conn(id)).slice(0, 3);
    const real = acct.size ? `<p class="pf-basis is-real">${ic('check', 's14')}<span>Checked against your ${esc(join([...acct]))} account${acct.size > 1 ? 's' : ''}.</span></p>` : '';
    const pub = list.length ? `<p class="pf-basis">${acct.size ? `Also from ${esc(join(list))}` : `Based on ${esc(join(list))}, not your sales or ad numbers yet`}.</p>` : '';
    const ask = !acct.size && ids.length ? `<div class="pf-cx"><span>Connect to check this against your real numbers</span><div class="pf-cx-b">${ids.map((id) => `<button type="button" class="chip" data-pf-cx="${id}">${glyph(id, 18)}${esc(B.connectors[id].name)}</button>`).join('')}</div></div>` : '';
    return `${real}${pub}${ask}`; };
  const proofHtml = (e, p) => {
    /* one row per number: the same price read twice (the page and the card's own count) shows once, the sourced one kept */
    const seen = new Map(); for (const x of (e.items || []).filter((x) => x.value || x.url)) { const k = String(x.value || x.url).replace(/\s+/g, '').toLowerCase(), o = seen.get(k); if (!o || (!o.url && x.url)) seen.set(k, x); }
    /* the real data first (numbers, accounts, what customers said), then the pages Brew read */
    const items = [...seen.values()].sort((a, b) => (a.kind === 'source') - (b.kind === 'source'));
    const w = e.why || {}, moves = e.moves || [], SHOW = 4;
    const lead = w.because ? `<p class="pf-because">${esc(w.because)}</p>` : (w.reasons || []).length ? `<p class="pf-because">${esc(w.reasons.join('. ').replace(/\.\./g, '.'))}</p>` : '';
    const rows = items.length ? `<h4 class="pf-h">The real data behind it</h4><ul class="pf-rows">${items.slice(0, SHOW).map(pfRow).join('')}</ul>${items.length > SHOW ? `<details class="pf-more"><summary>${items.length - SHOW} more</summary><ul class="pf-rows">${items.slice(SHOW).map(pfRow).join('')}</ul></details>` : ''}` : '';
    const gap = (e.unbacked || []).length ? `<p class="pf-note">${ic('info', 's14')}<span>No source found yet for ${esc(e.unbacked.slice(0, 3).join(', '))}. Check before you use ${e.unbacked.length > 1 ? 'them' : 'it'}.</span></p>` : '';
    /* does the data prove the claim (proof-logic.js): a claim with no data of its kind, or data that says the opposite, is said first */
    const cl = { ...(e.claim || {}) };
    /* a result only the brand's own accounts show: what this page has connected decides whether it asks to connect or says it isn't matched yet */
    if (cl.metric) { const miss = (cl.metricNeeds || []).filter((id) => B.connectors?.[id] && !conn(id)); cl.needs = miss;
      cl.note = miss.length ? `Brew can’t see your ${cl.metric} yet, so this part is a guess.` /* the connect buttons below ask */ : `Brew hasn’t matched this to your ${cl.metric} yet, so treat that part as a guess.`; }
    const check = cl.note ? `<p class="pf-note is-claim">${ic('info', 's14')}<span>${esc(cl.note)}</span></p>` : '';
    const none = !items.length && !cl.note ? `<p class="pf-note">${ic('info', 's14')}<span>No real data behind this one yet. Treat it as an idea to check, not a fact.</span></p>` : '';
    /* the move is Brew's reasoning from this data, never proof itself: a quiet link to the write-up, after the data */
    const plan = moves.length ? `<button type="button" class="pf-wu" data-pf-move="${moves[0].n}">How Brew worked it out: ${esc(moves[0].title)}${ic('right', 's14')}</button>` : '';
    /* stepped back on what the team said (brand-learnings.js): said first, so nobody acts on it without knowing */
    const contra = e.contra ? `<p class="pf-note is-claim">${ic('info', 's14')}<span>Brew moved this off the top: ${esc(e.contra)}</span></p>` : '';
    return `${lead}${contra}${check}${rows}${gap}${none}${pfBasis(items, p, cl.needs)}${plan}`;
  };
  /* "what's the evidence behind this?" in the jam: the card's proof as Saw / Plan / Data / So, and a way to the whole sheet */
  const proofMsg = (m) => { const x = m.proof || {}, a = (u, l) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>` : esc(l));
    const rows = [...(x.saw || []).map((s) => ['Saw', `<b>${esc(s.v)}</b> · ${esc(s.l)}${s.src ? ` <small>(${s.url ? a(s.url, s.src) : esc(s.src)})</small>` : ''}`]), ...((x.data || []).length ? [['Read', x.data.map((d) => a(d.url, d.l)).join(' · ')]] : []), ...(x.so ? [['So', esc(x.so)]] : []), ...((x.unbacked || []).length ? [['Check', `Not matched to a source yet: ${esc(x.unbacked.join(', '))}`]] : [])];
    return `<p>Here’s what this card is based on.</p>${rows.length ? `<dl class="pf-ev">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '<p>Brew has no source line for this card yet, so treat it as an idea to check, not a fact.</p>'}${m.cardId ? `<button type="button" class="chip j1-chip" data-pf-card="${esc(m.cardId)}">${ic('shield', 's14')}See all the proof</button>` : ''}`; };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-pf-card]'); if (!b) return; const p = byId(b.dataset.pfCard); if (p) openProof(p); });
  const openProof = async (p) => {
    modal(`<div class="sheet pick-sheet pf-sheet" role="dialog" aria-label="Why this card, and the proof"><header class="sh-h"><b class="sh-t">${ic('shield', 's16')}Why Brew suggests this</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="pf-b"><div class="sk" style="height:44px"></div><div class="sk" style="height:140px;margin-top:16px"></div></div></div>`, (w) => {
      w.addEventListener('click', (ev) => { const x = ev.target.closest('[data-pf-cx]'); if (x) { ev.stopPropagation(); closeModal(); return openConnect(x.dataset.pfCx, { why: 'Brew checks its cards against your real numbers, not just your public pages.', then: () => openProof(p) }); }
        const m = ev.target.closest('[data-pf-move]'); if (!m) return; closeModal(); openMove(+m.dataset.pfMove); }); });
    const r = await tapi('GET', `/api/cards/${encodeURIComponent(p.id)}/evidence`).catch(() => null), box = $('#modal .pf-b'); if (!box) return;
    box.innerHTML = r?.evidence ? proofHtml(r.evidence, p) : `<p class="pf-note">${ic('info', 's14')}The proof didn’t load. Try again in a moment.</p>`;
  };
  // card times read as times: "26 min" → "26 min ago" ("Just now", "Mon", "Yesterday" stay as they are)
  /* a card is Dummy only when it is simulated: a demo row, a simulated account's card (dummy, from connectors/index.js
     forViewer), or a pack's sample card that waits for an account (onlyWhen without a real read behind it). A card from a real
     connected account (liveOnly, the team's rewrite, a public marketplace read) is real and never tagged (Arata, 22 Oct) */
  const dummyCard = (p) => !!(p && (p.dummy || p.demo || ((p.onlyWhen || /^live-/.test(String(p.id || ''))) && !p.liveOnly && !p.publicLive && p.privateOf == null)));
  const agoText = (x) => String(x || '').replace(/^(\d+\s*(?:s|sec|secs|min|mins|m|hr|hrs|h|hour|hours|d|day|days|wk|wks|week|weeks))$/i, '$1 ago');
  /* a card says where it came from in plain words (not which agent wrote it): "From your competitors", "From your store" */
  const FROM_FAMILY = { 'rival-weakness': 'From your competitors', listening: 'From your customers', 'social-posts': 'For your socials', seo: 'From Google search', 'ai-seo': 'From AI answers', seasonal: 'Coming up on the calendar', weather: 'From the weather', 'price-offer': 'Prices and offers', cro: 'From your store', automation: 'Saves you time', result: 'Your results' };
  const FROM_SECTOR = { ads: 'From your ads', storefront: 'From your store', catalog: 'From your store', visibility: 'From AI answers', signals: 'From your customers' };
  const FROM_CAMPAIGN = { 'Popular ads': 'From your competitors', Trends: 'Trending in your category', 'How to': 'Step-by-step guide', 'More like this': 'More like what you liked', 'New from your agents': 'New idea for you', 'From your ad plan': 'From your ad plan' };
  /* whose ad it is (FEED-NOT-02): a rival's ad says "Seen on <rival>"; once our version is drawn on it, "Our version of <rival>'s
     ad"; an ad of ours says "Made for you". The rival's name: the card's own (rivalName), the studio's rival read, the make line
     ("Our version of X's image ad") or the ad card's title ("X: live 30 days…"), so saved cards say it too */
  const AD_FORMATS = new Set(['single image ad', 'carousel ad', 'collection ad', 'catalog ad', 'video ad', 'reel']);
  const rivalOf = (c = {}) => { if (!(c.research?.kind === 'ad' || c.research?.ad || c.make?.from === 'rival')) return null;
    return { name: c.rivalName || c.rival?.brand || (String(c.make?.what || '').match(/^Our version of (.+?)['’]s\b/) || [])[1] || (c.research?.kind === 'ad' ? (String(c.title || '').match(/^([^:]{2,40}):\s/) || [])[1] : '') || '' }; };
  const oursOn = (c = {}) => !!(c.draft?.images?.length || c.draft?.video || c.take?.image);
  const ourVersionOf = (n) => (n ? `Our version of ${n}’s ad` : 'Our version of a rival’s ad');
  const whoseAd = (c = {}) => { const rv = rivalOf(c); if (rv && (c.research?.kind === 'ad' || c.make?.from === 'rival')) return oursOn(c) ? ourVersionOf(rv.name) : rv.name ? `Seen on ${rv.name}` : 'Seen on a rival’s ads';
    if (!rv && (/^static-/.test(String(c.id || '')) /* a finished static from the ad plan */ || (AD_FORMATS.has(c.make?.format) && oursOn(c)) /* an ad Brew drew; a card that only asks for one shows a stand-in product photo, not ours */)) return 'Made for you'; return ''; };
  const fromLabel = (c = {}) => {
    const r = c.research?.kind, wa = whoseAd(c); if (wa) return wa;
    if (r === 'ad' || (c.type === 'competitor' && c.sector === 'ads')) return 'From your competitors';
    if (r === 'trend') return 'Trending in your category';
    if (r === 'howto') return 'Step-by-step guide';
    if (isToldCard(c)) return 'From your team'; /* a card made from what the team told Brew: says so once, in the header */
    if (FROM_CAMPAIGN[c.campaign]) return FROM_CAMPAIGN[c.campaign];
    if (c.type === 'competitor') return 'From your competitors';
    if (c.from) return c.from; /* what the card rests on (card-from.js, stamped by the server): the move's discipline, where it was heard */
    if (FROM_FAMILY[c.family]) return FROM_FAMILY[c.family];
    if (c.origin === 'told') return 'From your team';
    if (c.stream === 'heard' || c.origin === 'listen') return c.heard?.kind === 'thread' ? `Asked on ${c.post?.platformLabel || 'Reddit'}` : 'Heard online';
    if (c.origin === 'ideas') return 'New idea for you';
    /* the sector names the team that handles a card, not its source: it only stands in when the card's words back it */
    const words = `${c.title || ''} ${c.sub || ''}`;
    if (c.sector === 'visibility') return /\bAI\b|ChatGPT|Gemini|Perplexity|assistants?\b/i.test(words) ? 'From AI answers' : 'Getting found';
    if (c.sector === 'signals') return /customer|buyer|shopper|review|order|repeat|people (say|ask)/i.test(words) ? 'From your customers' : c.type === 'idea' ? 'New idea for you' : 'From Brew';
    if (FROM_SECTOR[c.sector]) return FROM_SECTOR[c.sector];
    if (c.type === 'idea') return 'New idea for you';
    return 'From Brew';
  };
  /* the campaign line only when it adds something the label does not already say */
  const campLine = (c) => (c.campaign && !FROM_CAMPAIGN[c.campaign] ? c.campaign : '');
  const head = (agent, sub, badge, more = true, title = AGENT[agent]) => `<header class="card-head">${face(agent)}<div class="who"><b>${esc(title)}</b><span>${esc(sub)}</span></div>${badge ? `<span class="badge ${badge[1]}">${esc(String(badge[0]).replace(/\b(\w+)s (\1)\b/gi, '$2'))}</span>` : ''}${more ? `<button class="icon-btn" data-more aria-label="More">${ic('more', 's18')}</button>` : ''}</header>`;
  const srcLine = (c) => c.src ? `<div class="src-line" title="${esc(c.src)}">${c.type === 'competitor' && rivalIn(`${c.src} ${c.title}`) ? rivalLogo(`${c.src} ${c.title}`, 14) : ic('link', 's14')}<span class="src-tx">${esc(c.src)}${c.liveFrom ? ` · <b>live from ${esc(B.connectors[c.liveFrom].name)}</b>` : ''}</span></div>` : '';

  const slotHtml = (c) => {
    if (c.kind === 'media') return mediaSlot(c.images, { fit: c.fit, fitBg: c.fitBg, alt: c.title, filter: c.gradeF });
    if (c.kind === 'conflict') { const dec = S.decided?.[c.id];
      return `<div class="inset cf-slot">${c.options.map((o) => `<div class="cf-opt${o.id === (dec || c.pick) ? ' on' : ''}"><span class="cf-dot">${o.id === dec ? ic('check', 's14') : ''}</span><span class="lg-tx"><b>${esc(o.name)}</b><span>Moves ${esc(o.moves)}</span></span>${o.id === c.pick && !dec ? '<span class="badge info">Brew pick</span>' : ''}</div>`).join('')}${c.needs ? `<p class="cf-needs">${ic('person', 's14')}Needs ${esc(c.needs)} before anything ships</p>` : ''}</div>`; }
    if (c.kind === 'answer') return `<div class="inset ans-slot"><div class="ans-q">${ic('chat', 's14')}${esc(c.q)}</div><p>${esc(c.a)}</p><span class="badge bad">${B.brand.name} not named</span></div>`;
    if (c.kind === 'variants') return `${c.images?.length ? mediaSlot(c.images.slice(0, 1), { filter: c.gradeF }) : ''}<div class="inset var-slot">${c.loading ? '<div class="sk" style="height:58px"></div><div class="sk" style="height:58px"></div><div class="sk" style="height:58px"></div>' : (c.variants || []).map((v) => `<div class="var"><span class="chip">${esc(v.angle || 'Version')}</span><b>${esc(v.title)}</b><span>${esc(v.sub)}</span></div>`).join('')}</div>`;
    /* a long value stacks under its label (left, full width) so the label never wraps word by word beside it */
    return `<div class="inset"><div class="rows">${nonZero(c.rows || []).map(([k, v]) => { v = toldRowV(c, k, v); return `<div${String(v).length > 28 ? ' class="is-long"' : ''}><span>${esc(k)}</span><b>${esc(v)}</b></div>`; }).join('')}</div></div>`;
  };
  /* a told card's "From" names the files the team added, readably (saved cards carry "Upload (Arata-Performance-Audit_compressed.pdf, …)") */
  const isToldCard = (c) => c?.origin === 'told' || /^told-/.test(c?.id || '');
  const toldRowV = (c, k, v) => !isToldCard(c) || !/^from$/i.test(k) ? v : String(v).replace(/\b(?:uploads?|files?)\s*\(/gi, '').replace(/[()]/g, '').replace(/\s*(?:…|\.\.\.)\s*$/, '')
    .split(/\s*,\s*/).filter(Boolean).map((f) => f.replace(/\.(pdf|docx?|txt|md|png|jpe?g|csv|xlsx?)$/i, '').replace(/[_-]?compressed$/i, '').replace(/[_-]+/g, ' ').replace(/\s*(…|\.\.\.)$/, '').trim()).filter(Boolean).join(', ');
  // a card that has work in flight says where it is, in one row, from the same phase model as the card page
  const STATUS = { jamming: (w) => STAGE[w.stage], ready: () => 'Ready to share', shared: (w) => `Brief shared${w.ticket ? ` · ${w.ticket}` : ''}` };
  const statusRow = (p, c) => { const w = workOfCard(p.id), ph = w ? phaseOf(p, w, c) : null; if (!ph || !STATUS[ph]) return '';
    /* a team jam says who's in it: tapping the card joins the same jam, never a second one */
    const ppl = !window.BREW_DEMO ? (w.people || []) : [], faces = ppl.length > 1 ? `<span class="lt-faces">${ppl.slice(0, 3).map((x) => pAv(x, 16)).join('')}</span>` : '';
    return `<button class="live-row st-row is-${ph}" data-st-open="${esc(p.id)}"><span class="live-pill">${esc(PHASE[ph])}</span>${faces}<span class="live-tx">${esc(ppl.length > 1 && ph === 'jamming' ? `${ppl.length} people · ${STATUS[ph](w)}` : STATUS[ph](w))}</span>${ic('right', 's14')}</button>`; };
  const doneText = (p, c) => c.done || null;
  const paintStatus = () => { if (view !== 'feed' && view !== 'deck') return; $$(view === 'deck' ? '.dcol .card[data-id]' : '#col .card[data-id]').forEach((el) => { const p = byId(el.dataset.id); if (!p || p.liveChange) return; const html = statusRow(p, cardOf(p)), cur = $('.st-row', el);
    if (cur) { if (html) cur.outerHTML = html; else cur.remove(); } else if (html) $('.body', el)?.insertAdjacentHTML('afterbegin', html);
    const c = cardOf(p), dn = doneText(p, c), bar = $(':scope > .bar', el); if (bar && dn && !bar.classList.contains('is-busy') && !$('.sp-ask', el)) bar.outerHTML = barHtml(c.cta, dn); }); };
  // what a card asks to be made, from its move (format and pieces)
  const MAKE_IC = { 'carousel ad': 'grid', 'instagram carousel': 'grid', 'collection ad': 'grid', 'catalog ad': 'grid', 'instagram stories': 'phone', 'instagram post': 'pic', 'single image ad': 'pic', 'video ad': 'vid', reel: 'vid', 'whatsapp message': 'chat', email: 'send', 'page section': 'doc' };
  /* saved pieces were cut at 100 characters mid-word ("…data and s"): end on the last whole word with … (cards-gen.js now cuts on a word) */
  const mkWhole = (x) => { const p = String(x || '').replace(/\s+/g, ' ').trim(); return p.length >= 99 && !/[.!?…)]$/.test(p) ? `${p.replace(/\S*$/, '').replace(/[\s,;:·.–—-]+$/, '')}…` : p; };
  /* the pieces never repeat the format beside it: "Page section on /: JSON-LD …" reads "Homepage: JSON-LD …", "Email · 1 email:
     day-3 note" reads "Email · Day-3 note"; a count above one stays (19 Oct) */
  const mkPieces = (c) => { const f = c.make.format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), p = mkWhole(c.make.pieces), m = p.match(new RegExp(`^(?:(?:1|one|a)\\s+)?${f}s?(?:\\s+on\\s+(\\/\\S*?))?\\s*:\\s*`, 'i'));
    if (!m) return p; const rest = p.slice(m[0].length); if (!rest) return '';
    return m[1] ? `${m[1] === '/' ? 'Homepage' : m[1]}: ${rest}` : rest[0].toUpperCase() + rest.slice(1); };
  /* "Page section" is the builder's word: say which page (QA FEED-ARV-06) */
  const pageName = (c) => /\/products?\/|product pages?|\bPDPs?\b/i.test(`${c.make?.pieces || ''} ${c.title || ''}`) ? 'Product page' : 'Store page';
  const mkName = (f, c) => (/^page sections?$/i.test(f) && c ? pageName(c) : f[0].toUpperCase() + f.slice(1)).replace(/\bwhatsapp\b/i, 'WhatsApp').replace(/\binstagram\b/i, 'Instagram');
  const makeChip = (c) => { if (!c.make?.format) return ''; const f = mkName(c.make.format, c), pc = mkPieces(c);
    return `<p class="mk-chip" title="${esc([f, pc].filter(Boolean).join(' · '))}">${ic(MAKE_IC[c.make.format] || 'sparkles', 's14')}<b>${esc(f)}</b>${pc ? `<span>${esc(pc)}</span>` : ''}</p>`; };
  /* the first draft Brew made for this card (drafts-bg.js, served as card.draft): the asset itself in place of the lane photo.
     A clip plays muted and looped only while it is on screen (armDraftVideos); slides use the feed's own carousel */
  const DRAFT_IC = { video: 'vid', carousel: 'grid', collection: 'grid', catalog: 'grid', email: 'send', whatsapp: 'chat', page: 'doc', image: 'pic' };
  /* under the draft, the ad as it would run, like a caption: its headline in bold and the first line of its copy (never the memo) */
  /* a template variable reads as what it stands for: {first_name} and WhatsApp's {{1}} show as a "first name" chip, never raw (QA UI 20 Oct) */
  const TOK_N = { 1: 'first name', 2: 'product', 3: 'detail' };
  const tokSpan = (h) => String(h).replace(/\{\{\s*(\d)\s*\}\}/g, (m, n) => `<span class="tok">${TOK_N[n] || 'detail'}</span>`).replace(/\{\{?\s*([a-z_ ]+?)\s*\}?\}/gi, (m, k) => `<span class="tok">${k.replace(/_/g, ' ')}</span>`);
  /* a row whose value is only a zero ("Live Meta ads 0", "Cart delay 0 seconds") is a zero tile: it goes; a card of only zeros keeps its rows (QA UI 20 Oct) */
  const ZERO = /^\s*(?:[₹$€£]\s?)?0(?:\.0+)?\s*(?:%|seconds?|days?|ads?|reviews?|items?|products?|x)?\s*$/i;
  const nonZero = (rows) => { const xs = (rows || []).filter((r) => Array.isArray(r)); const kept = xs.filter((r) => !ZERO.test(String(r[1] ?? ''))); return kept.length ? kept : xs; };
  const draftCap = (d) => { const h = String(d.headline || d.title || '').trim(), line = String(d.copy || '').split(/\n+/).map((x) => x.trim()).find(Boolean) || '';
    return h || line ? `<div class="fd-cap">${h ? `<b>${tokSpan(esc(h))}</b>` : ''}${line && line !== h ? `<span>${tokSpan(esc(line))}</span>` : ''}</div>` : ''; };
  const draftSlot = (c) => { const d = c.draft; if (!d || !(d.video || d.images?.length)) return '';
    /* a stand-in (the product photo alone, or a picture being made again) says a new one is coming; it is never called a first draft */
    const lab = d.remaking || d.photoOnly ? `<span class="fd-lab is-wait">${ic('refresh', 's12')}New picture coming</span>` : d.takeErr ? `<span class="fd-lab is-wait" title="${esc(d.takeErr)}">${ic('info', 's12')}No new picture</span>` : `<span class="fd-lab">${ic(DRAFT_IC[d.as] || 'sparkles', 's12')}${d.as === 'take' ? 'Another take' : 'First draft'}</span>`, port = d.ratio !== '1:1';
    const fb = [d.fallback, ...(isRival(c) ? [] : c.images || [])].filter((x) => x && !(d.images || []).includes(x)); /* never a rival's poster under our draft */ /* the real product photo, if the draft's picture can't load */
    /* a reel (9:16) fills the card's width in a 4:5 frame: the whole reel centred over a blurred copy of itself, never a narrow
       box with an empty side (17 Oct); every other draft keeps its own shape */
    const tall = d.ratio === '9:16' ? ' r916' : '', bgUrl = tall ? d.poster || d.render || d.images?.[0] || '' : '', bgSt = bgUrl ? ` style="--fd-bg:url(&quot;${esc(bgUrl)}&quot;)"` : '';
    if (d.video) return `<div class="media fd${port ? ' portrait' : ''}${tall}"${bgSt}><video class="fd-v" src="${esc(d.video)}"${d.poster ? ` poster="${esc(d.poster)}"` : ''}${fb.length ? ` data-fb="${esc(fb.join('|'))}"` : ''} playsinline muted loop preload="none" aria-label="${esc(d.title || 'First draft video')}"></video>${lab}</div>${draftCap(d)}`;
    return mediaSlot(d.images.map(esc), { alt: d.headline || d.title || 'First draft', portrait: port, extra: lab, fallback: fb }).replace('<div class="media', `<div${bgSt} class="media fd${tall}`) + draftCap(d); };
  /* a Signals card that rests on an account Brew can't read yet says so on the card, in one line with one Connect (QA FEED-ARV-07):
     the account is the one the proof sheet names (feed-service pub: proof.needs), the store first like the column guide */
  const needOf = (p) => { if (p?.sector !== 'signals') return null; const ids = (p.proof?.needs || []).filter((id) => B.connectors?.[id] && !conn(id));
    return ids.includes('shopify') ? 'shopify' : ids[0] || null; };
  const needLine = (p) => { const id = needOf(p); if (!id) return ''; const nm = B.connectors[id].name, admin = window.LiveConn?.boss?.() === false;
    return `<div class="card-need">${ic('plug', 's14')}<span>Connect ${esc(nm)} to see this</span>${admin ? '<small>Your admin connects it</small>' : `<button class="btn btn-ghost sm" data-cx="${esc(id)}">Connect</button>`}</div>`; };
  const postCard = (p, i) => {
    const c = cardOf(p);
    const isNew = PINNED.has(p.id);
    const sub = [isNew ? 'Just in' : agoText(c.time), campLine(c)].filter(Boolean).join(' · ');
    const lc = null; /* Do it now was cut: nothing goes live from Brew, so no card shows a Live row */
    const live = lc ? `<button class="live-row" data-livech data-card="${esc(p.id)}" title="${esc(`${lc.label}${lc.scope ? ' · ' + lc.scope : ''} · ${byTeam(lc.by) ? 'shipped by the ShopOS team' : 'shipped by Brew'}. Open the history`)}"><span class="live-pill"><i class="pulse"></i>Live</span><span class="live-tx">${esc(lc.label)}</span><span class="live-v">v${lc.v}</span>${ic('right', 's14')}</button>` : '';
    const body = `<div class="body">${live || statusRow(p, c)}${p.told && !isToldCard(c) ? `<span class="told-tag" title="This card uses what your team told Brew">${ic('book', 's12')}From what your team told Brew</span>` : ''}<h3>${esc(c.title)}</h3><p>${esc(c.sub)}</p>${makeChip(c)}${aisLine(p)}${needLine(p)}${isToldCard(c) ? '' : srcLine(c)}</div>`;
    const fd = ['conflict', 'answer'].includes(c.kind) ? '' : draftSlot(c); /* a draft replaces the lane photo; a rows card keeps its rows under the words */
    const media = !!fd || c.kind === 'media' || (c.kind === 'variants' && c.images?.length);
    const dn = doneText(p, c), rows = fd && c.kind === 'rows' && c.rows?.length ? slotHtml(c) : '';
    /* "New": made since the last visit and not seen before it; "Start here": the first card to open on a first visit */
    const tags = `${NEWSET.has(p.id) && !isNew ? '<span class="new-tag">New</span>' : ''}${p.id === START_ID ? `<button class="start-tag" data-start>${ic('sparkles', 's12')}Start here</button>` : ''}`;
    const hd = head(c.agent, sub, c.badge, true, fromLabel(c)).replace('<button class="icon-btn" data-more', `${tags}<button class="icon-btn" data-more`);
    return `<article class="card${c.liveFrom ? ' is-live' : ''}${dummyCard(p) ? ' is-dummy' : ''}${isNew ? ' is-new' : ''}${fd ? ' has-draft' : ''}${p.id === START_ID ? ' is-start' : ''}" data-post="${i}" data-id="${esc(p.id)}">${hd}${fd || slotHtml(c)}${media ? barHtml(c.cta, dn) + actsHtml(p) + body + rows : actsHtml(p) + body + barHtml(c.cta, dn)}</article>`;
  };

  const introCard = () => `<article class="card" data-intro>${head('brew', 'Welcome', null, false)}
      <div class="media portrait" data-car="0"><div class="track">${B.intro.map((s) => `<div class="intro-slide" style="--s1:${s.c}"><img src="${s.img}" alt=""><h2>${esc(s.h)}</h2></div>`).join('')}</div>
      <button class="nav l" aria-label="Previous">${ic('left', 's16')}</button><button class="nav r" aria-label="Next">${ic('right', 's16')}</button></div>
      <div class="body" style="padding-top:12px"><p>Each card is one idea. Tap it for details. Heart it to see more like it.</p></div></article>`;

  /* a measured health (health.js, B.health.public) shows what was measured: nothing is added on top of it (connecting a tool or
     a weekly card used to bump a ring, so Arata's AI ring read 21 over rows adding to 15). Only the simulated health moves */
  const healthNow = () => { const h = JSON.parse(JSON.stringify(B.health)); if (!B.health.public) { Object.entries(B.connectors).forEach(([id, c]) => { if (conn(id)) Object.entries(c.health || {}).forEach(([k, d]) => { const r = h.rings.find((x) => x.k === k); if (r) r.v += d; }); }); Object.entries(SRV.health || {}).forEach(([k, d]) => { const r = h.rings.find((x) => x.k === k); if (r) r.v += d; }); }
    /* AI answers come from ONE check, the newest of the read and the weekly run: its score, the rows under it, its finding and
       the rival panel (health.js aiRingFromRun), never one check's score over another's rows */
    const ai = h.rings.findIndex((x) => x.k === 'AI answers'), w = SRV.aiRing;
    if (B.health.public && ai >= 0 && w?.read && (h.rings[ai].read === false || String(w.at || '') >= String(h.rings[ai].at || h.rings[ai].stand?.at || ''))) {
      h.rings[ai] = w; h.moves = [...(h.moves || []).filter((x) => x.k !== 'AI answers'), ...(w.fixT ? [{ k: 'AI answers', t: w.fixT }] : [])]; } /* the team's own accounts: the ring says what they read (the score stays simulated) */ Object.entries(SRV.healthLive || {}).forEach(([k, x]) => { const r = h.rings.find((y) => y.k === k); if (r && x?.what) { r.what = x.what; r.parts = x.parts; } }); if (!SF_ON) { h.rings = h.rings.filter((r) => r.k !== 'Storefront'); h.moves = (h.moves || []).filter((x) => x.k !== 'Storefront'); } /* V1 hides Storefront: the ring keeps its other rows (QA FEED-ARV-05) */ const rd = h.rings.filter((r) => r.read !== false); h.score = rd.length ? Math.round(rd.reduce((a, r) => a + r.v, 0) / rd.length) : 0; return h; };
  /* the rings: three arcs, no composite number in the middle (an average of ads, the store and AI answers means nothing on its own) */
  const ringSvg = (h) => { const R = [52, 40, 28];
    return `<svg viewBox="0 0 130 130" width="100%" role="img" aria-label="${h.rings.map((r) => `${r.k} ${r.read === false ? 'not read' : `${r.v} of 100`}`).join(', ')}">${h.rings.map((r, i) => { const c = 2 * Math.PI * R[i]; return `<circle cx="65" cy="65" r="${R[i]}" fill="none" stroke="var(--surface-2)" stroke-width="8"/><circle class="ring-arc" cx="65" cy="65" r="${R[i]}" fill="none" stroke="var(--fg)" stroke-opacity="${1 - i * .3}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(c * (r.read === false ? 0 : r.v) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 65 65)"/>`; }).join('')}</svg>`; };
  /* Store health (2026-10-19, Param: "this card makes no sense, its CTA makes no sense"): one finding, said plainly; each ring
     says what it found (its weakest check, not how it is scored) and opens to show every check; the button opens the move that
     fixes the weakest ring (matched by the move's skill), never an empty jam. A ring that couldn't be read says so. */
  const HC_SKILLS = { 'AI answers': { _: ['ai-seo', 'content-strategy', 'programmatic-seo'] },
    Creative: { 'Hook variety': ['ad-creative', 'video'], Formats: ['video', 'image', 'ad-creative'], Volume: ['ads', 'ad-creative'], 'Live ads': ['ads', 'ad-creative'], _: ['ad-creative', 'ads'] },
    Storefront: { 'Mobile speed': ['cro', 'site-architecture'], 'Reaching checkout': ['cro', 'signup'], 'Guest checkout': ['signup', 'cro'], 'Payment options': ['cro', 'signup'], 'Photos per product': ['image', 'cro'], 'Reviews on the site': ['customer-research', 'emails', 'cro'], _: ['cro', 'copywriting'] } };
  const hcWeak = (r) => (r.parts || []).filter((x) => x.of).sort((a, b) => a.v / a.of - b.v / b.of)[0] || null;
  const hcLine = (r) => { if (r.read === false) return r.what; const w = hcWeak(r); if (!w) return r.what;
    return w.v >= w.of ? `Every check passed: ${(r.parts || []).map((x) => x.k.toLowerCase()).join(', ')}` : `${w.k}: ${w.note}`; };
  let HC_MOVES = null; /* the brand's moves with their skills (GET /api/brands/:slug/moves), once per page */
  const hcMoves = async () => { if (HC_MOVES || !GEN) return HC_MOVES; const r = await api(`/api/brands/${B.slug || BR}/moves`).catch(() => null); HC_MOVES = (r?.moves || []).filter((m) => m.skill && +m.n >= 1 && +m.n < 1000); return HC_MOVES; }; /* private moves come back only to team members (server.js), who can open them */
  const hcFix = (low) => { if (!low || low.read === false || !HC_MOVES?.length) return null; const map = HC_SKILLS[low.k] || {}, w = hcWeak(low);
    for (const sk of [...(w && map[w.k] || []), ...(map._ || [])]) { const m = HC_MOVES.find((x) => x.skill === sk); if (m) return m; } return null; };
  const hcCta = (low) => { const m = hcFix(low);
    return m ? `<p class="hc-fix">${ic('doc', 's14')}<span>The fix · ${mvLabel(m.n)}</span><b>${esc((window.fx || ((x) => x))(m.title))}</b></p><button class="bar" data-hc-move="${esc(m.n)}"><span class="lead">${ic('right', 's16')}Open the move</span>${ic('right', 's16 chev')}</button>`
      : `<button class="bar" data-hc-how><span class="lead">${ic('info', 's16')}How each ring is scored</span>${ic('right', 's16 chev')}</button>`; };
  /* AI answers: where the brand and its rivals stand (ai-standing.js), from the read's answers or the weekly check, whichever
     is newer. Counted where the shopper named no brand (that is where new buyers come from); an unread source says so */
  const aiStand = () => (B.health?.rings ? healthNow().rings.find((x) => x.k === 'AI answers')?.stand || null : null); /* the same check as the ring above it */
  /* the brands the answers name most, beside the known rivals (st.named): counted where the shopper named no brand when any are */
  const aisNamed = (nm) => { if (!nm || nm.error) return null; const un = !!nm.unOf && nm.list.some((r) => r.un), c = (r) => (un ? r.un : r.n);
    return { c, of: un ? nm.unOf : nm.of, top: nm.list.filter(c) }; };
  const aisClip = (q, n = 64) => { q = String(q || '').replace(/\?$/, ''); return q.length > n ? q.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : q; };
  const aisOf = (st) => st.unOf ? [(x) => x.un, st.unOf] : [(x) => x.n, st.of];
  const aisHtml = (st, { compact = false } = {}) => {
    if (!st) return compact ? '' : `<p class="ais-note">The AI answers haven’t been read for ${esc(B.brand.name)} yet.</p>`;
    if (st.error) return `<p class="ais-note">${esc(st.error)}</p>`;
    const [cnt, of] = aisOf(st), nq = st.unOf ? st.qs.filter((q) => !q.branded).length : st.questions;
    const forOf = (r, you) => { const qs = you ? st.qs.filter((q) => q.brand && (!st.unOf || !q.branded)).map((q) => q.q) : (r.qs || []).filter((q) => !st.unOf || !q.branded).map((q) => q.q);
      return qs.length ? `Named for “${esc(aisClip(qs[0]))}”${qs.length > 1 ? ` and ${qs.length - 1} more` : ''}` : 'Not named in any of these answers'; };
    const row = (r, you) => `<div class="ais-row${you ? ' is-you' : ''}"><b>${esc(r.name)}${you ? ' <small>you</small>' : ''}</b><span class="ais-bar"><i style="width:${of ? Math.round((100 * cnt(r)) / of) : 0}%"></i></span><em>${cnt(r)} of ${of}</em>${compact ? '' : `<p class="ais-q">${forOf(r, you)}</p>`}</div>`;
    const rv = st.rivals.slice(0, compact ? 3 : 6), top = [...st.rivals].sort((a, b) => b.n - a.n).find((r) => r.n);
    return `${compact ? '' : `<div class="ais-hd"><p class="ais-h">Who AI names when shoppers ask</p><button class="icon-btn pf-btn" data-ais-proof="${esc(st.src || 'weekly')}" aria-label="The questions Brew asked, why, and each AI’s answer" title="The questions Brew asked, why, and each AI’s answer">${ic('shield')}<span class="pf-n">${st.questions || ''}</span></button></div>`}<p class="ais-sub">${st.unOf ? `${of} answers to ${nq} question${nq === 1 ? '' : 's'} where the shopper named no brand` : `${of} answers to ${nq} shopper question${nq === 1 ? '' : 's'}`}, from ${st.tools} AI tool${st.tools === 1 ? '' : 's'}${st.at ? ` · ${esc(fmtDay(Date.parse(st.at)) || st.at)}` : ''}</p>
      <div class="ais-rows">${row(st.brand, true)}${rv.map((r) => row(r)).join('')}</div>
      ${!compact && (st.knownUnnamed || []).length ? `<p class="ais-note">Not named in any of these answers: ${esc(st.knownUnnamed.join(', '))}.</p>` : ''}
      ${st.rivalsError ? `<p class="ais-note">${esc(st.rivalsError)}</p>` : !st.rivals.length ? `<p class="ais-note">Brew hasn’t found ${esc(B.brand.name)}’s rivals yet, so only ${esc(B.brand.name)} is counted.</p>` : ''}
      ${!compact && st.unOf && st.of > st.unOf ? `<p class="ais-note">Counting the questions that name a brand too: ${esc(st.brand.name)} ${st.brand.n} of ${st.of}${top ? `, ${esc(top.name)} ${top.n} of ${st.of}` : ''}.</p>` : ''}
      ${st.named?.error ? `<p class="ais-note">${esc(st.named.error)}</p>` : (() => { const nm = aisNamed(st.named); if (!nm) return '';
        return `<p class="ais-h2">Named most often</p>${nm.of !== of ? `<p class="ais-sub">Counted in ${nm.of} answers${st.named.at ? ` from ${esc(fmtDay(Date.parse(st.named.at)) || st.named.at)}` : ''}</p>` : ''}${nm.top.length ? `<div class="ais-rows">${nm.top.slice(0, compact ? 3 : 5).map((r) => `<div class="ais-row"><b>${esc(r.name)}</b><span class="ais-bar"><i style="width:${nm.of ? Math.round((100 * nm.c(r)) / nm.of) : 0}%"></i></span><em>${nm.c(r)} of ${nm.of}</em></div>`).join('')}</div>` : `<p class="ais-note">These answers name no other brands.</p>`}`; })()}`; };
  /* the AI answers card's proof (Param, 19 Oct: "why should I trust you?"): how Brew asked, each question with why it is there,
     and every tool's own answer with the brands it named and its sources; the team adds the questions their customers ask */
  /* one glance (Param, 19 Oct: "aim for 15/10, one quick glance"): the score as a big number and a dot per answer, the biggest gap,
     who gets named instead, then every question as a row: how many people search it (a bar) and one dot per AI tool (filled = names you) */
  const AIV_TOOL = { chatgpt: ['GPT', '#10a37f'], gemini: ['Gem', '#4285f4'], perplexity: ['Pplx', '#20808d'], claude: ['Cl', '#d97757'], copilot: ['Cop', '#7a5af8'], 'google ai overviews': ['AIO', '#ea4335'] };
  const aivTool = (t) => AIV_TOOL[String(t).toLowerCase()] || [String(t).slice(0, 3), '#8a8a8a'];
  const aivVol = (w) => { const m = String(w?.label || '').match(/^([\d.,]+)\s?([kKmM]?)\s+Google searches a month/); if (!m || w.kind !== 'search') return 0; const n = parseFloat(m[1].replace(/,/g, '')); return n * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1); };
  const aivFmt = (n) => (n >= 1e5 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(n)));
  const aiAnsHtml = (a) => { const day = a.at ? fmtDay(typeof a.at === 'number' ? a.at : Date.parse(a.at)) : '';
    const tools = a.tools.length ? a.tools : [...new Set(a.questions.flatMap((x) => x.answers.map((y) => y.tool)))];
    const toolList = tools.join(', ').replace(/, ([^,]*)$/, ' and $1') || 'the AI tools';
    const un = a.questions.filter((x) => !x.branded), br = a.questions.filter((x) => x.branded);
    const all = un.flatMap((x) => x.answers), named = all.filter((y) => y.named).length;
    /* 1. the score: a big number and one dot per answer */
    const hero = all.length ? `<div class="aiv-hero"><div class="aiv-big${!named ? ' is-zero' : named / all.length < 1 / 3 ? ' is-low' : ''}"><b>${named}</b><span>of ${all.length}</span></div><div class="aiv-hm"><p>answers name <b>${esc(a.brand)}</b> when a shopper asks without naming a brand</p><div class="aiv-dots" aria-hidden="true">${all.map((y) => `<i class="${y.named ? 'is-y' : ''}"></i>`).join('')}</div></div></div>`
      : `<p class="pf-because">Brew asks ${esc(toolList)} what shoppers ask, every week.</p>`;
    /* 2. the biggest gap: the most-searched question no tool names the brand for */
    const gap = un.filter((x) => x.answers.length && !x.answers.some((y) => y.named)).map((x) => ({ x, v: aivVol(x.why) })).sort((p, q) => q.v - p.v)[0];
    const gapHtml = gap ? `<div class="aiv-gap">${ic('trendup', 's16')}<p><b>Biggest gap:</b> “${esc(gap.x.q)}”${gap.v ? ` gets ${esc(aivFmt(gap.v))} searches a month` : ''}, and no AI names ${esc(a.brand)}.</p></div>` : '';
    /* 3. who the answers name instead */
    /* the same brand counts as the AI answers card beside it (aiStand: products folded into their brand); the answers' rival names if it isn't loaded */
    const st = aiStand(), [cOf] = st && !st.error ? aisOf(st) : [null];
    let top = cOf ? (st.rivals || []).map((r) => [r.name, cOf(r) || 0]).filter((x) => x[1] > 0) : [];
    if (!top.length) { const cnt = new Map(); for (const y of all) for (const b of new Set(y.rivals || [])) if (b && b.toLowerCase() !== String(a.brand).toLowerCase()) cnt.set(b, (cnt.get(b) || 0) + 1); top = [...cnt]; }
    top = top.sort((p, q) => q[1] - p[1]).slice(0, 4); const mx = Math.max(named, top[0]?.[1] || 0, 1);
    /* the brand on top, against the brands the answers name instead */
    const bar = (b, n, you) => `<div class="aiv-ir${you ? ' is-you' : ''}"><span>${esc(b)}${you ? ' <small>you</small>' : ''}</span><i><u style="width:${n ? Math.max(6, Math.round((n / mx) * 100)) : 0}%"></u></i><b>${n}</b></div>`;
    const inst = top.length ? `<div class="aiv-inst"><h4 class="pf-h">Who AI names, out of ${all.length} answers</h4>${bar(a.brand, named, true)}${top.map(([b, n]) => bar(b, n)).join('')}</div>` : '';
    /* 4. the questions: demand bar and one dot per tool */
    const vmax = Math.max(1, ...a.questions.map((x) => aivVol(x.why)));
    const head = `<div class="aiv-th"><span>Question, and how many search it</span><span class="aiv-cols">${tools.map((t) => { const [s, c] = aivTool(t); return `<abbr title="${esc(t)}" style="--tc:${c}">${esc(s)}</abbr>`; }).join('')}</span></div>`;
    const demand = (x) => { const v = aivVol(x.why); if (v) return `<span class="aiv-d"><i><u style="width:${Math.max(4, Math.round((v / vmax) * 100))}%"></u></i>${esc(aivFmt(v))} a month</span>`;
      const w = x.why || {}; const l = w.kind === 'thread' ? String(w.label || '').split(':')[0].replace(/^Asked on (\w)/, (m, c) => `Asked on ${c.toUpperCase()}`).replace(/, (\S+ replies)$/, ' · $1') : w.kind === 'suggest' ? 'Google suggests it' : w.kind === 'team' ? 'Added by your team' : w.kind === 'product' ? String(w.label || '').split(' (')[0] : 'Written by Brew';
      return `<span class="aiv-d is-txt">${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(l)}</a>` : esc(l)}</span>`; };
    const ansRow = (y) => { const names = [...new Set([...(y.rivals || []), ...(y.brands || [])])].slice(0, 8);
      return `<li class="aiq-a"><b>${esc(y.tool)}</b><div class="aiq-ab"><span class="aiq-names">${names.length ? esc(names.join(', ')) : 'Names no brand'}</span>${y.text ? `<details class="aiq-full"><summary>Read the answer</summary><p class="aiq-t">${esc(y.text)}${y.full ? '' : '…'}</p>${y.sources.length ? `<p class="aiq-src">Sources: ${esc(y.sources.join(', '))}</p>` : ''}</details>` : ''}</div><span class="aiq-tag ${y.named ? 'is-y' : 'is-n'}">${y.named ? `${ic('check', 's14')}You` : 'Not you'}</span></li>`; };
    const row = (x) => { const cells = tools.map((t) => { const y = x.answers.find((z) => z.tool === t); return `<i class="aiv-c${!y ? ' is-none' : y.named ? ' is-y' : ''}" title="${esc(t)}: ${!y ? 'not asked yet' : y.named ? `names ${esc(a.brand)}` : `doesn’t name ${esc(a.brand)}`}">${y?.named ? ic('check', 's12') : ''}</i>`; }).join('');
      return `<details class="aiv-q${gap && gap.x === x ? ' is-gap' : ''}"><summary><span class="aiv-qm"><span class="aiv-qt">${esc(x.q)}</span>${demand(x)}</span><span class="aiv-cols">${cells}</span></summary>${x.answers.length ? `<ul class="aiq-as">${x.answers.map(ansRow).join('')}</ul>` : ''}</details>`; };
    const block = (xs, h) => xs.length ? `<section class="aiv-sec"><h4 class="pf-h">${h}</h4>${head}${xs.map(row).join('')}</section>` : '';
    const note = !a.sourced && a.questions.length ? `<p class="pf-note">${ic('info', 's14')}<span>Brew wrote these questions from your category; they aren’t checked against real searches yet. Questions people really search for land within the day.</span></p>`
      : a.pending ? `<p class="pf-note">${ic('clock', 's14')}<span>Brew is asking new questions from real searches now. These are the last answers until they land.</span></p>` : '';
    const add = a.canAdd ? (a.teamLeft ? `<form class="aiq-add" data-aiq-add><label for="aiq-in">Add a question your customers ask</label><div><input id="aiq-in" maxlength="160" placeholder="Which serum works for thinning at the crown?" autocomplete="off"><button class="btn btn-primary sm" type="submit">Ask it</button></div></form>` : `<p class="pf-basis">Your team has added 3 questions, the most Brew keeps.</p>`) : '';
    return `${hero}${gapHtml}${note}${inst}${block(un, 'When shoppers name no brand')}${block(br, `When shoppers ask about ${esc(a.brand)}`)}
      <p class="pf-basis aiv-how">Asked ${esc(toolList)} as a shopper in ${esc(a.country || 'your market')} would${day ? `, on ${esc(day)}` : ''}. The same questions every week, so weeks compare. Tap a question to read each answer.</p>
      ${a.method?.errors?.length ? `<p class="pf-basis">Some sources couldn’t be read last time; the next refresh tries again.</p>` : ''}${add}`; };
  const openAiProof = async (src) => {
    modal(`<div class="sheet pick-sheet pf-sheet ai-sheet" role="dialog" aria-label="How Brew checks AI answers"><header class="sh-h"><b class="sh-t">${ic('shield', 's16')}How Brew checks AI answers</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="pf-b"><div class="sk" style="height:64px"></div><div class="sk" style="height:180px;margin-top:12px"></div></div></div>`, (w) => {
      w.addEventListener('submit', async (ev) => { const f = ev.target.closest('[data-aiq-add]'); if (!f) return; ev.preventDefault(); const i = $('input', f), b = $('button', f), v = i.value.trim(); if (!v) return;
        const done = busyBtn(b, 'Asking…'); const r = await tapi('POST', '/api/tenants/:t/ai-questions', { q: v }).catch(() => null); done();
        if (!r?.ok) return toast(esc(r?.error || 'That didn’t go through. Try again.'));
        toast(`${ic('check', 's16')}${esc(r.note)}`); paint(); if (r.asked) setTimeout(paint, 75e3); }); });
    const paint = async () => { const r = await tapi('GET', `/api/tenants/:t/ai-answers?src=${encodeURIComponent(src || 'weekly')}`).catch(() => null), box = $('#modal .ai-sheet .pf-b'); if (!box) return;
      box.innerHTML = r?.ai ? aiAnsHtml(r.ai) : `<p class="pf-note">${ic('info', 's14')}<span>The questions didn’t load. Try again in a moment.</span></p>`; };
    paint(); };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-ais-proof]'); if (!b) return; e.preventDefault(); e.stopPropagation(); openAiProof(b.dataset.aisProof); }, true);
  /* the one line on an AI answers card: who the answers name, beside the brand */
  const aisLine = (p) => { if (fromLabel(p) !== 'From AI answers') return ''; const st = aiStand(), nm = aisNamed(st?.named)?.top.length ? aisNamed(st.named) : null; if (!st || st.error || (!st.rivals.length && !nm)) return '';
    const [cnt, of] = aisOf(st), top = st.rivals.filter((r) => cnt(r)).slice(0, 2);
    /* no known rival named: say who the answers do name instead */
    return `<p class="ais-line">${ic('sparkles', 's14')}<span>${top.length ? `AI names ${top.map((r) => `${esc(r.name)} in ${cnt(r)}`).join(', ')} of ${of} answers; ${esc(st.brand.name)} in ${cnt(st.brand)}` : nm ? `AI names ${nm.top.slice(0, 2).map((r) => `${esc(r.name)} in ${nm.c(r)}`).join(', ')} of ${nm.of} answers${nm.of === of ? `; ${esc(st.brand.name)} in ${cnt(st.brand)}` : ''}` : `AI names none of ${esc(st.rivals.slice(0, 3).map((r) => r.name).join(', '))} in ${of} answers; ${esc(st.brand.name)} in ${cnt(st.brand)}`}</span></p>`.replace(/ in (\d+)/g, ' in&nbsp;$1'); }; /* a count never wraps away from its name ("Arata in" / "0") */
  const healthCard = () => { const h = healthNow(), read = h.rings.filter((r) => r.read !== false), low = [...read].sort((a, b) => a.v - b.v)[0] || null;
    const fixLine = low && (h.moves || []).find((x) => x.k === low.k)?.t;
    const [said, todo] = fixLine ? [fixLine.split(/(?<=\.)\s+/)[0], fixLine.split(/(?<=\.)\s+/).slice(1).join(' ')] : [null, null];
    const head1 = !read.length ? `${B.brand.name}’s store couldn’t be read this time.` : said || (low && low.v < 60 ? `${low.k} is ${B.brand.name}’s weakest ring, at ${low.v} of 100.` : `${B.brand.name}’s store reads well on every ring.`);
    const sub1 = !read.length ? 'The next refresh tries again. Nothing here is a guess.' : said ? (todo || '') /* a finding with no action sentence stands alone: the move under the rings is the action */ : (low && low.v < 60 ? hcLine(low) : `The lowest is ${low.k}, at ${low.v} of 100.`);
    const when = B.health.at ? (fmtDay(Date.parse(B.health.at)) || B.health.at) : '';
    if (GEN && !HC_MOVES) hcMoves().then(() => { const el = $('.card[data-health] [data-hc-how]'); if (el && hcFix(low)) el.outerHTML = hcCta(low); }).catch(() => {});
    return `<article class="card hc${B.health.dummy ? ' is-dummy' : ''}" data-health>${head('brew', B.health.public ? `From your public site${Object.values(SRV.healthLive || {}).some((x) => x?.what) ? ' and your accounts' : ''}${when ? ` · ${esc(when)}` : ''}` : `Up ${h.delta + Object.keys(S.conn).filter(conn).length} this week`, null, false, 'Store health')}
      <div class="body hc-body"><h3>${esc(head1)}</h3>${sub1 ? `<p>${esc(sub1)}</p>` : ''}</div>
      <div class="inset"><div class="ring-wrap">${ringSvg(h)}<div class="ring-rows hc-rows">${h.rings.map((r) => `<details class="hc-ring${r === low ? ' is-low' : ''}"><summary><b>${esc(r.k)}</b><em>${r.read === false ? '–' : `${r.v}<small>/100</small>`}</em><span>${esc(hcLine(r))}${r.was != null && r.was !== r.v ? ` <small class="hc-was">Was ${r.was}${r.changed ? `: ${esc(r.changed)}` : ''}</small>` : ''}</span></summary>${(r.parts || []).length ? `<ul class="hc-parts">${r.parts.filter((x, i, all) => !((x.real || all.some((y) => +y.v)) && (x.v === 0 || x.v === '0'))) /* a zero reading stays quiet; the ring's own score says it once */.map((x) => `<li><span>${esc(x.k)}</span><b>${esc(String(x.v))}${x.of != null ? `<small>/${x.of}</small>` : x.real ? '<small> from your account</small>' : ''}</b><small>${esc(x.note || '')}${(x.at || r.at) ? ` · checked ${esc(fmtDay(Date.parse(x.at || r.at)) || x.at || r.at)}` : ''}</small></li>`).join('')}</ul>` : ''}${r.k === 'AI answers' && aiStand()?.rivals ? `<div class="ais ais-mini">${aisHtml(aiStand(), { compact: true })}<button class="linkbtn hc-ais" data-ais-proof="${esc(aiStand().src || 'weekly')}">${ic('shield', 's14')}Every question and each AI’s answer</button></div>` : ''}${r.src ? `<p class="hc-src">${ic('link', 's14')}${esc(r.src)}</p>` : ''}</details>`).join('')}</div></div></div>
      ${read.length ? hcCta(low) : ''}</article>`; };

  const teamCard = () => { const bs = S.batches.filter((b) => !b.roles || b.roles.includes(S.viewer.role) || b.team).slice(0, 4); const need = bs.filter((b) => b.st === 'Needs you').length;
    const tone = (b) => b.st === 'Needs you' ? 'warn' : b.st === 'Done' ? 'ok' : b.st === 'Stopped' ? 'bad' : 'run';
    return `<article class="card tm2" data-team>${head('brew', GEN ? 'Live from your workspace' : 'Your team is working', null, false)}
      <div class="tm2-body"><h3>${GEN ? (() => { const n = bs.filter((b) => b.st === 'Running' || b.st === 'Needs you').length; return n ? `${n} thing${n === 1 ? '' : 's'} in progress` : 'All caught up'; })() : `${bs.length} batches this week`}<small>${need ? `${need} need${need > 1 ? '' : 's'} you` : 'Nothing is waiting on you'}</small></h3>
      <ul class="tm2-list">${bs.map((b) => `<li class="is-${tone(b)}"${b.workId ? ` data-witem="${esc(b.workId)}"` : ''}><span class="tm2-ic">${b.team ? `<i class="bmark">${SO()}</i>` : face(b.agent)}</span>
        <div class="tm2-tx"><div class="tm2-top"><b>${esc(b.t)}</b><em>${esc(b.st === 'Running' ? `${b.pct}%` : b.st)}</em></div><span>${esc(b.s)}</span>${b.st === 'Running' ? `<div class="tm2-bar"><i style="width:${Math.max(3, b.pct || 0)}%"></i></div>` : ''}</div></li>`).join('')}</ul></div>
      <button class="tm2-foot" data-nav="${GEN ? 'work' : 'work'}"><span>${GEN ? 'See it all on the Work board' : 'Open the Work board'}</span>${ic('right', 's16')}</button></article>`; };

  // DUMMY: the Pro plan (DUMMY.md #4). The 10-a-day cap was cut, so saved packs' "A feed that keeps going" tile is dropped.
  const deckCard = () => `<article class="card is-dummy" data-upsell>${head('brew', 'Pro', null, false)}<div class="inset"><div class="up-tiles">${B.upsell.filter(([k]) => k !== 'more').map(([k, t, s, img]) => `<div class="up-tile"><img src="${img}" alt="" loading="lazy"><b>${esc(t)}</b><span>${esc(s)}</span></div>`).join('')}</div></div>
      <div class="body"><h3>See everything side by side.</h3><p>One column per area: ads, creatives, store and more.</p></div>${barHtml({ label: 'Open the deck' })}</article>`;

  const connectCard = (id, why) => { const c = B.connectors[id];
    return `<article class="card is-connect" data-connect-card="${id}">${head('brew', 'Needs access', null, false)}
      <div class="cn-body"><div class="cn-top">${glyph(id, 40)}<h3>See this with real numbers</h3></div>
        <p>${esc(why || `Connect ${c.name} to swap targets for your real numbers.`)}</p>
        <ul class="cn-list">${c.changed.map((t) => `<li>${ic('sparkles', 's14')}${esc(t)}</li>`).join('')}</ul></div>
      <button class="bar" data-cx="${id}"><span class="lead">${ic('plug', 's16')}Connect ${esc(c.name)}</span>${ic('right', 's16')}</button></article>`; };

  /* the three counts on the greeting, and the full pages behind them */
  /* one rule for each count, read from the ranked feed only (loadFeed), never from FEED, which the deck, the lists and
     the library reuse for their own rows: the greeting tile, the list behind it, its tab and the setup preview agree */
  /* today's window: the number picked on the reading screen ("How many moves a morning?"), else the full 14 */
  const todayN = () => +S.viewer.perDay || 14;
  const todayOf = (ranked) => ranked.slice(0, todayN()).filter((p) => !cardOf(p).done);
  const yesOf = (ranked) => todayOf(ranked).filter((p) => p.type === 'decision');
  /* waits on you: an OK asked of the jam, or a teammate tagged you and you have not replied (askMe, per viewer) */
  const needsMe = (w) => w.waitsOnMe ?? (w.stage === 'needs_you' || !!w.askMe);
  const gLists = () => { const vis = todayOf(RANKED);
    return { yes: yesOf(RANKED), spend: vis.filter((p) => B.spends.includes(p.cta?.label)), board: WORK.items.filter(needsMe).sort((a, b) => b.updatedAt - a.updatedAt) }; };
  const QHEAD = {
    yes: ['Need your yes', 'Calls only you can make', 'Calls only you can make. Each opens its jam: the plan, the draft, then your yes.', 'check'],
    spend: ['Spend money', 'Budgets, campaigns and the site', 'These change budgets, campaigns or the site. Each opens its jam; nothing goes live until you approve it there.', 'wallet'],
    board: ['On your board', 'Work sent back for your OK', 'Work your team or Brew sent back. Each one waits on you before it can ship.', 'board']
  };
  /* the greeting's tiles, from the same lists the pages behind them read (gLists: yesOf on the ranked feed). Drawn again on every
     refresh (counts), so "Need your yes" never drifts from its list (QA FEED-QA-07/21) */
  const gTile = (k) => { const list = GSTAT[k], n = list.length; if (!n) return ''; /* no zero tiles: an empty list says nothing */
    return `<button class="gt${k === 'yes' && n ? ' hot' : ''}" data-gstat="${k}" aria-label="${n} ${QHEAD[k][0]}: open the list"><b class="gt-n">${n}</b><span class="gt-l">${QHEAD[k][0]}</span><span class="gt-s">${QHEAD[k][1]}</span><span class="gt-go">${ic('right', 's14')}</span></button>`; };
  const gTiles = () => { const tiles = ['yes', 'spend', 'board'].map(gTile).filter(Boolean); return tiles.length ? `<div class="g-today" style="--n:${tiles.length}">${tiles.join('')}</div>` : ''; };
  const paintTiles = () => { const g = $('#col .greet:not(.g2)'); if (!g || view !== 'feed') return; GSTAT = gLists(); const html = gTiles(), cur = $('.g-today', g);
    if (cur) { if (html) { if (cur.outerHTML !== html) cur.outerHTML = html; } else cur.remove(); } else if (html) g.insertAdjacentHTML('beforeend', html); };
  const greeting = () => {
    const R = ROLE(), part = dayPart();
    GSTAT = gLists();
    const af = affinity(); const tags = [...Object.entries(af.agent).map(([k, n]) => [AGENT[k], n]), ...Object.entries(af.lane).map(([k, n]) => [B.lanes[k]?.name, n])].sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
    const day = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div class="greet"><small class="g-day">${esc(day)}</small><h2>${part}${hiName(R)}</h2>
      ${tags.length ? `<p class="g-taste">Tuned to what you like: ${esc(tags.join(' and '))}</p>` : ''}
      ${gTiles()}</div>`;
  };

  let FEED = [], RANKED = [], GSTAT = { yes: [], spend: [], board: [] }, QTAB = 'yes';
  /* full page: one list per count, each row acts in one tap or opens the card */
  /* a calm list: the photo only when there is one, the title, one line, and the one action. The row itself opens the card */
  const qThumb = (p, c) => { const img = (c.images || p.images || [])[0]; return img ? `<span class="q-thumb"><img src="${img}" alt="" loading="lazy"></span>` : ''; };
  const qRow = (p, i) => { const c = cardOf(p);
    return `<article class="card q-card${(c.images || p.images || [])[0] ? '' : ' no-img'}${dummyCard(p) ? ' is-dummy' : ''}" data-post="${i}" data-id="${esc(p.id)}">${qThumb(p, c)}
      <div class="q-body"><div class="q-meta">${face(p.agent)}${c.badge ? `<span class="badge ${c.badge[1]}">${esc(c.badge[0])}</span>` : `<span>${esc(fromLabel(c))}</span>`}</div>
        ${p.told && !isToldCard(c) ? `<span class="told-tag" title="This card uses what your team told Brew">${ic('book', 's12')}From what your team told Brew</span>` : ''}<h3>${esc(c.title)}</h3><p>${esc(c.sub)}</p></div>
      <div class="q-acts">${barHtml(c.cta || { label: 'Open' }, c.done)}</div></article>`; };
  const wRow = (w) => `<article class="card q-card${w.img ? '' : ' no-img'}">${w.img ? `<span class="q-thumb"><img src="${w.img}" alt=""></span>` : ''}
      <div class="q-body"><div class="q-meta">${w.askMe ? pAv(w.askMe, 22) : w.with?.kind === 'team' ? avatar(colleague(w.with.id), 22) : face(w.agent || 'brew')}<b>${w.askMe ? `From ${esc(w.askMe.who)}` : w.with ? `From ${esc(w.with.name)}` : 'From Brew'}</b><span>· ${ago(w.updatedAt)}</span><span class="badge warn">Needs you</span></div>
        <h3>${esc(curV(w)?.title || w.title)}</h3><p>${esc(w.askMe ? plain(w.askMe.body) : curV(w)?.sub || 'Version ' + w.current + ' is ready for your OK.')}</p></div>
      <div class="q-acts"><button class="btn btn-primary" data-witem="${w.id}">Review ${ic('right', 's16')}</button></div></article>`;
  const renderQueue = async (k = QTAB) => {
    QTAB = k; view = 'queue'; document.body.classList.remove('deck-on'); $('#stk').innerHTML = ''; $('#notes').innerHTML = '';
    $$('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', 'false'));
    if (!$('.qpage')) $('#view').innerHTML = `<div class="qpage"><div class="sk" style="height:140px;border-radius:20px"></div><div class="sk" style="height:160px;border-radius:20px"></div></div>`;
    await Promise.all([loadFeed(), pullWork(true)]); if (view !== 'queue') return;
    const L = gLists(); GSTAT = L;
    const list = L[k]; if (k !== 'board') FEED = list;
    const tab = (t) => `<button role="tab" aria-selected="${t === k}" data-qtab="${t}">${ic(QHEAD[t][3], 's16')}${QHEAD[t][0]}<span class="q-n">${L[t].length}</span></button>`;
    const empty = `<div class="empty">${ic('check')}<b>Nothing waiting</b><span>You’re clear here. New calls land as your agents finish.</span></div>`;
    $('#view').innerHTML = `<div class="qpage">
      <button class="q-back" data-nav="feed">${ic('left', 's16')}Feed</button>
      <header class="q-head"><h1>${QHEAD[k][0]} <span>${list.length}</span></h1><p>${QHEAD[k][1]}</p></header>
      <div class="q-tabs" role="tablist">${['yes', 'spend', 'board'].map(tab).join('')}</div>
      <div class="q-list">${list.length ? (k === 'board' ? list.map(wRow).join('') : list.map(qRow).join('')) : empty}</div>
      ${k === 'board' && list.length ? `<button class="btn btn-ghost q-more" data-nav="work">${ic('board', 's16')} Open the whole board</button>` : ''}
    </div>`;
    $$('[data-qtab]').forEach((b) => b.onclick = () => renderQueue(b.dataset.qtab));
    counts(); window.scrollTo(0, 0);
  };
  const openGStat = (k) => renderQueue(k);
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-gstat]'); if (g) openGStat(g.dataset.gstat); });
  const appShell = () => {
    root.innerHTML = `
      <div class="app">
        <nav class="rail" aria-label="Main">
          <button class="so-mark so-home" data-nav="feed" aria-label="Home: your feed" title="Home">${SO()}</button>
          <div class="rl-mid">
            <button class="icon-btn rl" aria-label="Feed" data-nav="feed">${ic('home')}<span class="rl-tx" aria-hidden="true">Feed</span></button>
            <button class="icon-btn rb rl" aria-label="Work" data-nav="work">${ic('board')}<span class="rl-tx" aria-hidden="true">Work</span><i data-count="work"></i></button>
            <button class="icon-btn rb rl" aria-label="Notifications" data-bell>${ic('bell')}<span class="rl-tx" aria-hidden="true">Notifications</span><i data-count="bell"></i></button>
          </div>
          <div class="rl-foot">
            <button class="icon-btn rl" aria-label="What Brew learned" data-nav="learned">${ic('book')}<span class="rl-tx" aria-hidden="true">What Brew learned</span></button>
            <button class="icon-btn rl" aria-label="Connectors" data-nav="connectors">${ic('plug')}<span class="rl-tx" aria-hidden="true">Connectors</span></button>
            <button class="icon-btn rl lc-acct" aria-label="Your account" data-lacct>${window.LIVE?.me?.pic ? `<img src="${esc(window.LIVE.me.pic)}" alt="" referrerpolicy="no-referrer">` : ic('person')}<span class="rl-tx" aria-hidden="true">${window.LIVE?.me ? esc(window.LIVE.me.email) : 'Account'}</span></button>
          </div>
        </nav>
        <div class="stage" id="stage">
          <div class="wash" aria-hidden="true"></div>
          <div class="topbar">
            <div class="seg glass-chrome" role="tablist">
              <button role="tab" aria-selected="true" data-nav="feed">${ic('feed', 's16')}Feed</button>
              <button role="tab" aria-selected="false" data-nav="deck">${ic('deck', 's16')}Deck</button>
            </div>
            <div class="topbar-r"><button class="chip j1-pill" data-team-pill hidden title="Briefs with the ShopOS team">${ic('send', 's14')}<span data-count="team"></span><i class="t2-live" aria-hidden="true"></i></button><button class="icon-btn rb phone-only" aria-label="Notifications" data-bell>${ic('bell')}<i data-count="bell"></i></button><button class="icon-btn phone-only lc-acct" aria-label="Your account" data-lacct>${window.LIVE?.me?.pic ? `<img src="${esc(window.LIVE.me.pic)}" alt="" referrerpolicy="no-referrer">` : ic('person')}</button><button class="chip viewing" data-viewing aria-label="Switch the seat you view as">${face(ROLE().face)}<span><i class="va">Viewing as </i><b>${esc(ROLE().name)}</b></span>${ic('chev', 's14')}</button>${themeBtn()}</div>
          </div>
          <div id="view"></div>
          <div class="stk-layer" id="stk"></div>
          <div class="notes-layer" id="notes"></div>
        </div>
      </div>
      <button class="fab" aria-label="Jam with the team" data-open-jam>${ic('hand')}</button>`;
  };
  /* the first open of the feed after onboarding starts a new brand's moves (build.js feedOpened); once per page, a no-op after that */
  const feedOpened = () => { if (!GEN || LANDING || feedOpened.sent) return; feedOpened.sent = true; api(`/api/brands/${B.slug || BR}/feed-open`, {}).then((r) => { if (r?.woke && BREW && !BREW.done) { BREW = null; loadMV(); } }); };
  const feed = async () => { if (signWall('feed')) return endBootRx();
    feedOpened(); appShell(); const rh = location.hash.match(/^#remix=([^&]+)/); const hp = hashParams(); const h = hp.card ? [null, hp.card] : null; pulseT || (pulseT = setTimeout(pulse, 4000)); window.scrollTo(0, 0); await Promise.all([pullWork(true), renderFeed()]); const p = h && byId(h[1]); if (p) openDetail(p); else if (h) { history.replaceState(null, '', location.pathname); toast('That card is no longer in the feed.'); } if (hp.work) { const wk = WORK.items.find((x) => x.id === hp.work); if (wk) openDetail(byId(wk.cardId) ? { ...byId(wk.cardId), _work: wk } : pseudoPost(wk)); } if (location.hash.startsWith('#jam=')) window.JamRoom?.fromHash(); if (location.hash.startsWith('#jam2=')) { const j2 = decodeURIComponent(location.hash.slice(6)), studio = (() => { try { return sessionStorage.getItem('brew-jam2-studio') === '1'; } catch { return false; } })(), go = (n = 0) => (window.Jam2 ? (window.Jam2.on() || studio) && window.Jam2.openId(j2, tapi) : n < 40 && setTimeout(() => go(n + 1), 100)); go(); } /* a Studio jam opened from v1 comes back on reload too */ /* Jam v2: a reload or a shared address reopens the jam */ if (hp.v && hp.v !== 'feed' && VIEWS()[hp.v]) VIEWS()[hp.v](); const [rcid, rch] = rh ? decodeURIComponent(rh[1]).split('/') : []; const rp = rcid && byId(rcid); if (rp) await openRemix(rp, rch).catch(() => {}); endBootRx(); };
  const counts = () => {
    const sv = $('[data-count="saved"]'), wk = $('[data-count="work"]');
    if (sv) sv.textContent = S.saved.length || ''; if (wk) { const n = WORK.items.filter(needsMe).length; wk.textContent = n || ''; wk.classList.toggle('hot', !!n); }
    $$('[data-count="bell"]').forEach((b) => { b.textContent = WORK.unread || ''; b.classList.toggle('hot', !!WORK.unread); });
    const vb = $('[data-viewing]'); if (vb) vb.innerHTML = `${face(ROLE().face)}<span><i class="va">Viewing as </i><b>${esc(ROLE().name)}</b></span>${ic('chev', 's14')}`;
    $$('.rail [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === (['jams', 'remixes', 'refs'].includes(view) ? 'saved' : ['move', 'moves', 'brand'].includes(view) ? 'learned' : view)));
    { const tp = $('[data-team-pill]'), wt = WORK.withTeam || { n: 0 }, n = wt.n || 0; if (tp) { tp.hidden = !n; tp.querySelector('[data-count="team"]').innerHTML = tp.classList.contains('j1-pill') ? `<b>${n}</b><span class="j1-more">&nbsp;with the team</span>` : `${n} with the team`; tp.classList.toggle('is-ask', !!wt.needsInfo); } }
    paintTiles(); paintTabbar();
  };
  /* phones: a native tab bar like Instagram (Feed, Deck, new jam, Work, Library) and the section's name in the header */
  const TABS = [['feed', 'feed', 'Feed'], ['deck', 'deck', 'Deck'], ['+', 'plus', 'New jam'], ['work', 'board', 'Work'], ['saved', 'bookmark', 'Library']];
  const TITLES = { feed: `${B.brand.name}`, deck: 'Deck', work: 'Work', saved: 'Library', jams: 'Library', remixes: 'Library', refs: 'Library', learned: 'Learned', moves: 'Moves', move: 'Move', connectors: 'Connectors', tune: 'Your feed', queue: `${B.brand.name}`, remix: 'Remix' };
  const paintTabbar = () => {
    document.body.dataset.view = BOOT_RX ? 'remix' : view; /* a studio link is the studio from the first paint, even while the feed boots underneath */
    /* the feed's stickers and margin notes sit in layers outside the page: leaving the feed clears them, or they float over the next page (a brand sticker covered the move page's number) */
    if (view !== 'feed') { const k = $('#stk'); if (k?.firstChild) k.innerHTML = ''; } if (view !== 'feed' && view !== 'saved') { const nl = $('#notes'); if (nl?.firstChild) nl.innerHTML = ''; }
    let bar = $('#tabbar');
    if (!bar) { bar = document.createElement('nav'); bar.id = 'tabbar'; bar.className = 'tabbar'; bar.setAttribute('aria-label', 'Tabs');
      bar.innerHTML = TABS.map(([k, icn, n]) => k === '+' ? `<button class="tb-new" data-tbjam aria-label="${n}">${ic(icn, 's18')}</button>` : `<button data-nav="${k}" aria-label="${n}">${ic(icn)}<span>${n}</span>${k === 'work' ? '<i data-count="tbwork"></i>' : ''}</button>`).join('');
      document.body.appendChild(bar); bar.addEventListener('click', (e) => { if (e.target.closest('[data-tbjam]')) openJam({}); }); }
    const cur = ['jams', 'remixes'].includes(view) ? 'saved' : view;
    $$('[data-nav]', bar).forEach((b) => b.setAttribute('aria-current', b.dataset.nav === cur ? 'page' : 'false'));
    const n = WORK.items.filter(needsMe).length, wb = $('[data-count="tbwork"]', bar); if (wb) { wb.textContent = n || ''; wb.hidden = !n; }
    const tb = $('.topbar'); if (tb && !$('.tb-title', tb)) $('.seg', tb)?.insertAdjacentHTML('afterend', '<button class="tb-title" data-nav="feed" aria-label="Home: your feed"></button>');
    const tt = $('.topbar .tb-title'); if (tt) tt.textContent = TITLES[view] || `${B.brand.name}`;
  };

  /* sounds: small synthesized cues on the moments that matter (a pick, an approval, going live, a result, a new update),
     with a light haptic on phones. Quiet by design, silent on navigation, one switch in the menu turns them off */
  const SND = { ctx: null, on: ls.get(`${LSP()}sound`) !== 'off', last: {} };
  const actx = () => { if (!SND.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; SND.ctx = new C(); } if (SND.ctx.state === 'suspended') SND.ctx.resume(); return SND.ctx; };
  addEventListener('pointerdown', () => { if (SND.on) actx(); }, { once: true, capture: true });
  const tone = (c, f, at, dur, { type = 'sine', vol = .07, to = null, att = .006 } = {}) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02); };
  const noise = (c, at, dur, { from = 600, to = 2400, vol = .05 } = {}) => { const n = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + at; src.buffer = n; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .3); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + dur + .02); };
  const CUES = {
    tick: [(c) => tone(c, 1760, 0, .05, { vol: .035 }), 8],
    pop: [(c) => tone(c, 520, 0, .09, { to: 880, vol: .05 }), 0],
    select: [(c) => { tone(c, 659, 0, .09, { type: 'triangle', vol: .05 }); tone(c, 880, .07, .12, { type: 'triangle', vol: .05 }); }, 12],
    approve: [(c) => { tone(c, 1046.5, 0, .35, { vol: .06 }); tone(c, 1318.5, .09, .45, { vol: .055 }); }, [10, 40, 10]],
    live: [(c) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, i * .07, .28, { type: 'triangle', vol: .05 })), 22],
    win: [(c) => { [783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => tone(c, f, i * .08, .4, { vol: .055 })); tone(c, 3136, .34, .5, { vol: .018 }); }, [15, 40, 15, 40, 30]],
    ping: [(c) => tone(c, 880, 0, .3, { vol: .045 }), 0],
    knock: [(c) => { tone(c, 196, 0, .12, { type: 'triangle', vol: .09 }); tone(c, 196, .16, .12, { type: 'triangle', vol: .08 }); }, [12, 70, 12]],
    send: [(c) => noise(c, 0, .18, { from: 500, to: 3200, vol: .04 }), 0],
    sweep: [(c) => noise(c, 0, .22, { from: 3000, to: 400, vol: .04 }), 0],
    error: [(c) => tone(c, 160, 0, .16, { type: 'triangle', vol: .08 }), 30],
    // the fun ones: stickers, faces, switches, sheets, swipes
    peel: [(c) => { noise(c, 0, .12, { from: 2600, to: 5200, vol: .03 }); tone(c, 300, .02, .09, { to: 540, vol: .03 }); }, 6],
    stick: [(c) => { tone(c, 230, 0, .13, { to: 90, vol: .08 }); noise(c, 0, .06, { from: 1400, to: 300, vol: .03 }); }, 12],
    swish: [(c) => noise(c, 0, .13, { from: 800, to: 2800, vol: .025 }), 0, 180],
    boop: [(c) => { tone(c, 420, 0, .09, { to: 860, vol: .05 }); tone(c, 860, .075, .09, { to: 520, vol: .04 }); }, 8, 120],
    heart: [(c) => { tone(c, 523.25, 0, .14, { to: 1046.5, vol: .05 }); tone(c, 1567.98, .08, .12, { vol: .02 }); }, 10],
    unheart: [(c) => tone(c, 700, 0, .11, { to: 350, vol: .04 }), 0],
    toggleOn: [(c) => { tone(c, 900, 0, .04, { type: 'triangle', vol: .04 }); tone(c, 1350, .035, .05, { type: 'triangle', vol: .04 }); }, 6],
    toggleOff: [(c) => { tone(c, 1350, 0, .04, { type: 'triangle', vol: .035 }); tone(c, 900, .035, .05, { type: 'triangle', vol: .035 }); }, 6],
    step: [(c) => tone(c, 1250, 0, .03, { type: 'triangle', vol: .022 }), 0, 60],
    sheetUp: [(c) => { noise(c, 0, .18, { from: 400, to: 1900, vol: .022 }); tone(c, 300, 0, .15, { to: 520, vol: .018 }); }, 0],
    sheetDown: [(c) => { noise(c, 0, .18, { from: 1900, to: 400, vol: .022 }); tone(c, 520, 0, .15, { to: 300, vol: .018 }); }, 0],
    ratchet: [(c) => tone(c, 2400, 0, .016, { type: 'square', vol: .01 }), 3, 35],
    bubble: [(c) => { tone(c, 600, 0, .07, { to: 1200, vol: .04 }); tone(c, 900, .05, .07, { to: 1500, vol: .035 }); tone(c, 760, .1, .06, { to: 1300, vol: .025 }); }, 0],
    // the moments that landed later: a final or a long job ready, a jam reply, a tool connected, a swipe-stack keep or drop
    ready: [(c) => { tone(c, 1318.5, 0, .4, { vol: .05 }); tone(c, 2637, .05, .5, { vol: .015 }); }, [10, 40, 10]],
    reply: [(c) => tone(c, 659.25, 0, .3, { type: 'triangle', vol: .04 }), 0, 600],
    connected: [(c) => { tone(c, 392, 0, .3, { type: 'triangle', vol: .05 }); tone(c, 523.25, .09, .4, { type: 'triangle', vol: .05 }); }, [10, 40, 10]],
    keep: [(c) => noise(c, 0, .16, { from: 700, to: 3000, vol: .035 }), 8, 120],
    drop: [(c) => noise(c, 0, .16, { from: 2400, to: 500, vol: .025 }), 0, 120] };
  /* the cues themselves are designed sounds, rendered offline with earshot (tools/sfx: cues.json, build.sh) into public/sfx/<cue>.mp3
     and decoded while the page is idle (an offline context decodes without a tap), so even the first tap plays the real cue; a cue
     whose file isn't in yet (or failed) plays its synth above instead */
  SND.buf = {};
  const loadSfx = () => { if (SND.loading) return; const C = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!C) return; SND.loading = true; let dc; try { dc = new C(1, 1, 44100); } catch (e) { return; }
    const go = () => Object.keys(CUES).forEach((k) => fetch(`/sfx/${k}.mp3`).then((r) => r.ok ? r.arrayBuffer() : Promise.reject()).then((a) => new Promise((ok, no) => dc.decodeAudioData(a, ok, no))).then((b) => { SND.buf[k] = b; }).catch(() => {}));
    (window.requestIdleCallback || setTimeout)(go, { timeout: 2000 }); };
  const sfxOut = (c) => { if (SND.out?.context !== c) { SND.out = c.createGain(); SND.out.gain.value = .8; SND.out.connect(c.destination); } return SND.out; };
  if (SND.on) addEventListener('load', () => setTimeout(loadSfx, 800), { once: true });
  const SOFT = new Set(['sheetUp', 'sheetDown', 'step', 'swish']); // background cues: one tap is one sound, so these give way to any cue just played
  const sound = (k) => { if (!SND.on || !CUES[k] || document.hidden) return; const now = Date.now(); if (now - (SND.last[k] || 0) < (CUES[k][2] ?? 250)) return; if (SOFT.has(k) && now - (SND.any || 0) < 150) return; SND.last[k] = SND.any = now;
    const c = actx(); if (c) try { const b = SND.buf[k]; if (b) { const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = .97 + Math.random() * .06; s.connect(sfxOut(c)); s.start(); } else { loadSfx(); CUES[k][0](c); } } catch (e) {} // a hair of pitch drift, so repeats never sound stamped
    const hz = CUES[k][1]; if (hz && innerWidth <= 760 && navigator.vibrate) try { navigator.vibrate(hz); } catch (e) {} };
  // was this moment a tap (or a key)? Screens that move on by themselves stay silent
  ['pointerdown', 'click', 'keydown'].forEach((ev) => addEventListener(ev, () => { SND.tap = Date.now(); }, true));
  const tapped = (ms = 1500) => Date.now() - (SND.tap || 0) < ms;
  window.__sound = sound; window.__tapped = tapped; window.Sound = { play: sound };
  // every copy, wherever it's made (the jam, share, live, menus all write the clipboard themselves): a tick once it has it
  if (navigator.clipboard?.writeText) try { const wt = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (s) => wt(s).then((v) => { sound('tick'); return v; }); } catch (e) {}
  // user moments, by what was tapped (navigation stays silent)
  /* the newer actions, on the same cues as the old ones (first match wins, so these specific ones go first): opening a sheet or
     a jam, a pick, making it live, sharing, copying, switching versions, AI fixing, a mention, closing, declining */
  const SOUND_NEW = [['[data-jm-ship],[data-share-to],[data-share-force]', 'live'], ['.ob2-prod [data-x],.v2-rival [data-x]', 'sweep'],
    ['[data-rx^="share"],[data-jm-pick],[data-jm-move],a[href^="https://wa.me"]', 'send'],
    ['[data-share-copy],[data-jm-copyho],[data-jm-drcopy],[data-jm-handoff],[data-dpsave],[data-pm="save"],[data-st-briefsave],[data-ph-pick]', 'tick'],
    ['[data-sv-card],[data-sv-open],[data-sv-work],[data-ph-use],[data-top^="approve"],[data-add],.ob2-tile,.ob2-prod,[data-knob],[data-knob-apply]', 'select'],
    ['[data-rx="fix"],[data-rx="variants"],[data-rx="image"],[data-rx="plan"],[data-ph-ai],[data-jm-make],[data-cv-ask],[data-act="take"],[data-verb="take"]', 'bubble'],
    ['[data-v-view],[data-ver],[data-cv-chv],[data-vmenu]', 'step'], ['[data-jm-mention]', 'boop'],
    ['[data-open-jam],[data-jam-studio],[data-open-studio],[data-rx="open"],[data-verb="open"]', 'pop'], ['[data-ph-open]', 'sheetUp'], ['[data-svx]', 'sheetDown'],
    ['[data-top^="decline"],[data-jm-discard]', 'sweep']];
  const SOUND_ON = [...SOUND_NEW, ['[data-act="save"],[data-cp-save]', 'tick'], ['[data-cp-go],.cp-go', 'select'], ['[data-approve]', 'approve'],
    ['[data-bt-queue]', 'live'], ['.story,[data-story],.cp-visual img,[data-inst],.so-home', 'pop'], ['[data-npclear],[data-npdel]', 'sweep'],
    ['.sv-tap,[data-th-go],[data-th-i],.media .nav,.media .dots i', 'step'], ['[data-newcards]', 'bubble']];
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-act="heart"],[data-cp-heart]'); if (h) return sound(h.getAttribute('aria-pressed') === 'true' ? 'unheart' : 'heart');
    const sw = e.target.closest('.sw,[role="switch"],[data-m="sound"]'); if (sw) return setTimeout(() => { const el = sw.matches('.sw') ? sw : sw.querySelector('.sw') || sw; sound(el.getAttribute('aria-checked') === 'true' ? 'toggleOn' : 'toggleOff'); }, 0);
    // an agent face is a little creature: tap it and it squishes and boops
    const f = e.target.closest('.face'); if (f) { f.classList.remove('is-boop'); void f.offsetWidth; f.classList.add('is-boop'); setTimeout(() => f.classList.remove('is-boop'), 420); sound('boop'); }
    for (const [sel, k] of SOUND_ON) if (e.target.closest(sel)) return sound(k); }, true);
  addEventListener('keydown', (e) => { if ($('#th') && /Arrow(Left|Right)/.test(e.key)) sound('step'); });
  // dragging a Deck column's width clicks like a ratchet
  { let gx = null; document.addEventListener('pointerdown', (e) => { if (e.target.closest('.grab')) gx = e.clientX; }, true);
    addEventListener('pointermove', (e) => { if (gx == null) return; if (Math.abs(e.clientX - gx) >= 24) { gx = e.clientX; sound('ratchet'); } }, { passive: true });
    addEventListener('pointerup', () => { gx = null; }); }
  document.addEventListener('submit', (e) => { if (e.target.closest('#dp, .std, .jm, .rxp, #url-form')) sound('send'); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('#jm-in, .std textarea, .std input[type="text"]') && String(e.target.value || '').trim() && !$('.jm-mentions:not([hidden])')) sound('send'); }, true);
  /* phones and the keyboard: track the part of the screen the keyboard leaves visible, so pinned inputs sit right above it
     (iOS doesn't shrink the page when the keyboard opens), hide the tab bar while typing, and scroll the field into view */
  if (window.visualViewport) { const vv = visualViewport, de = document.documentElement;
    const upd = () => { const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop); de.style.setProperty('--vvh', `${Math.round(vv.height)}px`); de.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`); document.body.classList.toggle('kb-open', kb > 120 || (vv.height < innerHeight * .78 && !!document.activeElement?.matches?.('input,textarea,[contenteditable="true"],[contenteditable=""]'))); };
    vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); addEventListener('focusin', () => setTimeout(upd, 60)); addEventListener('focusout', () => setTimeout(upd, 120)); upd(); }
  addEventListener('focusin', (e) => { const el = e.target; if (innerWidth > 760 || !el.matches?.('input,textarea,[contenteditable="true"],[contenteditable=""]') || el.closest('.dp-side.is-open')) return;
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320); });
  /* add to home screen: the system prompt where the browser offers one (Android, desktop Chrome), clear steps where it doesn't (iPhone Safari) */
  const INSTALL = { prompt: null };
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); INSTALL.prompt = e; });
  addEventListener('appinstalled', () => { INSTALL.prompt = null; $('#inst')?.remove(); toast(`${ic('check', 's16')}${B.brand.name} is on your home screen`); });
  const openInstall = async () => {
    $('#inst')?.remove();
    if (INSTALL.prompt) { const p = INSTALL.prompt; INSTALL.prompt = null; p.prompt(); const r = await p.userChoice.catch(() => null); if (r?.outcome === 'accepted') ls.set(`${LSP()}installed`, '1'); return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), android = /android/i.test(navigator.userAgent);
    const step = (n, t) => `<li><em>${n}</em><span>${t}</span></li>`;
    const steps = ios ? step(1, `Tap <b>Share</b> ${ic('up', 's14')} at the bottom of Safari`) + step(2, 'Scroll down and tap <b>Add to Home Screen</b>') + step(3, `Tap <b>Add</b>. ${B.brand.name} opens full screen, like an app`)
      : android ? step(1, 'Tap the <b>⋮</b> menu at the top right') + step(2, 'Tap <b>Add to Home screen</b> or <b>Install app</b>') + step(3, 'Tap <b>Install</b>')
      : step(1, 'In Chrome or Edge, click the <b>install</b> icon at the right of the address bar') + step(2, `Click <b>Install</b>. ${B.brand.name} opens in its own window`);
    modal(`<div class="sheet inst-sheet"><img class="inst-ic" src="${esc(String(B.brand?.mark || 'icons/icon-192.png').replace(/^\//, ''))}" alt=""><h3>Add ${B.brand.name} to your home screen</h3><p>One tap to open your feed, full screen, like any other app.</p><ol class="inst-steps">${steps}</ol><button class="btn btn-primary" data-close>Got it</button></div>`);
  };
  // a one-time nudge on phones, a few seconds into the feed; dismissed for good with ✕
  const maybeInstallNudge = () => { if (isStandalone() || innerWidth > 700 || ls.get(`${LSP()}inst-x`) || $('#inst') || view !== 'feed') return;
    const el = document.createElement('div'); el.id = 'inst'; el.className = 'inst';
    el.innerHTML = `<img src="${esc(String(B.brand?.mark || 'icons/icon-192.png').replace(/^\//, ''))}" alt=""><span><b>Get ${B.brand.name} on your home screen</b><small>Opens full screen, like an app</small></span><button class="inst-add" data-inst>Add</button><button class="inst-x" data-instx aria-label="Not now">${ic('x', 's14')}</button>`;
    document.body.appendChild(el); };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-inst]')) openInstall(); if (e.target.closest('[data-instx]')) { ls.set(`${LSP()}inst-x`, '1'); $('#inst')?.remove(); } });
  setTimeout(maybeInstallNudge, 9000);

  const smooth7 = (v) => v.map((_, i) => { const w = v.slice(Math.max(0, i - 6), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; }).slice(6);
  const sparkPath = (v, w, h, pad = 2, mx = Math.max(...(v || []), 1), mn = Math.min(...(v || []))) => { if (!v?.length) return ''; return v.map((y, i) => `${i ? 'L' : 'M'}${(pad + (i / (v.length - 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((y - mn) / (mx - mn || 1)) * (h - 2 * pad)).toFixed(1)}`).join(''); };
  // ring covers: one designed disc per ring, same family, so the row reads as a set
  const RING_ART = { brand: ['mark', 'r-brand'], recap: ['clock', 'r-recap'], trends: ['trendup', 'r-trends'], ads: ['megaphone', 'r-ads'], news: ['news', 'r-news'], howto: ['bulb', 'r-howto'] };
  const ringCover = (r) => { const [icon, cls] = RING_ART[r.k] || ['sparkles', 'r-news'];
    return `<span class="cover ${cls}">${icon === 'mark' ? `<img src="${B.brand.mark}" alt="">` : ic(icon)}</span>`; };
  /* Recap (what happened since your last visit) sits right after the brand's own ring, only when the server sent one */
  /* unseen rings first (each set keeps its own order), like stories anywhere */
  const ringKeys = (S2) => { const ks = (ROLE().stories || []).filter((k) => k !== 'recap'); if (S2.recap) ks.splice(ks[0] === 'brand' ? 1 : 0, 0, 'recap'); const on = ks.filter((k) => S2[k] && (k === 'brand' || S2[k].slides?.length)); /* a ring with nothing to show is hidden (QA FEED-QA-28) */ return [...on.filter((k) => !S2[k].seen), ...on.filter((k) => S2[k].seen)]; };
  const storiesHtml = () => { const S2 = storySets(); return `<div class="stories">${ringKeys(S2).map((k, i) => `<button class="story${S2[k].seen ? ' seen' : ''}${S2[k].loading ? ' loading' : ''}" data-story="${k}" title="${esc(S2[k].title)}"><span class="ring">${ringCover(S2[k])}</span><span class="st-l">${esc(S2[k].title)}</span></button>`).join('')}</div>`; };

  /* the end of a free day: a swipeable set of what Pro adds, in Brew's own art, ending on the one button */
  document.addEventListener('click', (e) => { if (e.target.closest('[data-gopro]')) openPlan('feed'); });

  /* a brand's first run: until its moves are written, one card says the real feed is on its way, with the time
     left and an email when it is ready (the same notify as the wait screen) */
  let BREW = null, mvT = 0;
  /* the moves stopped (a daily cap, a pause, retries, AI paused): say what happened and offer to write the rest, never "Brewing" forever */
  const brewStuck = () => !!(BREW && (BREW.capped || BREW.pausedDay || BREW.retryMoves || BREW.aiPausedAt));
  /* signed in: the moves-ready email is already on for them (the server emails the creator and the team), with a way to mute it */
  const mailOnHtml = (em, cls) => `<p class="${cls}" data-mailon>${ic('check', 's14')}<span>We’ll email <b>${esc(em)}</b> when your moves are ready.</span> <button class="linkbtn" type="button" data-mailmute>Mute</button></p>`;
  const brewingInner = () => { const n = BREW?.movesDone || 0, N = +BREW?.total || 50, em = ls.get(`${LSP()}mail`), stuck = brewStuck();
    return `<div class="bw-art"><img src="assets/brew/moves-brewing.jpg" alt="" decoding="async"><span class="bw-k"><span class="dot"></span>${stuck ? 'Paused' : 'Brewing'}</span></div>
      <div class="body">${stuck ? `<h3>${esc(BREW.state || 'The moves are paused')}</h3><p>${n} of ${N} moves in your plan are written. The cards from them are in your feed now.</p>`
        : `<h3>New cards land here as each move is written</h3><p>${n} of ${N} moves in your plan written${etaOf(BREW)}. Start with the top ad.</p>`}${BREW?.recheck?.words && !BREW.recheckDone ? `<p class="bw-meta">${ic('refresh', 's14')}Rewriting the brief and your first moves with ${esc(BREW.recheck.words)}</p>` : ''}
        <div class="bw-bar"><i style="width:${Math.max(3, Math.round(100 * Math.min(n, N) / N))}%"></i></div>${stuck ? `<button class="btn btn-primary sm" type="button" data-mvpro>${PAYWALL ? 'Continue with Pro' : 'Write the rest'}</button>` : ''}
        ${window.BREW_DEMO ? '' /* the demo sends no email, and its visitor has no real address */
          : mailMe() && ls.get(`${LSP()}mail-mute`) !== mailMe() ? mailOnHtml(mailMe(), 'bw-mailed')
          : em ? `<p class="bw-mailed">${ic('check', 's14')}<span>We’ll email <b>${esc(em)}</b> when they’re in.</span></p>`
          : mailMe() ? `<form class="bw-mail" data-bwmail><input type="hidden" value="${esc(mailMe())}"><button class="btn btn-ghost sm" type="submit" title="To ${esc(mailMe())}">Email me when they’re in</button></form>`
          : `<form class="bw-mail" data-bwmail><input type="email" required placeholder="you@${esc(B.brand.host || 'brand.com')}" autocomplete="email" aria-label="Your email"><button class="btn btn-primary sm" type="submit">Email me</button></form>`}</div>`; };
  /* Mute: only said once the server confirms it (until it can, the email's own mute link does it) */
  document.addEventListener('click', async (e) => { const b = e.target.closest('[data-mailmute]'); if (!b) return; const em = mailMe(); if (!em) return; b.disabled = true;
    const r = await api(`/api/brands/${B.slug || BR}/notify`, { email: em, mute: true }).catch(() => null);
    if (r?.muted) { ls.set(`${LSP()}mail-mute`, em); ls.del(`${LSP()}mail`); const p = b.closest('[data-mailon]'); if (p) p.innerHTML = `<span>No emails from Brew for this brand. Turn them back on from any Brew email.</span>`; toast(`${ic('check', 's16')}Muted`); }
    else { b.disabled = false; toast(`${ic('info', 's16')}Couldn’t mute it from here. Use the mute link in the email.`); } });
  /* Write the rest, on the feed's paused card (the Learned page binds its own) */
  document.addEventListener('click', async (e) => { const b = e.target.closest('[data-brewing] [data-mvpro]'); if (!b) return; const go = async () => { const r = await api(`/api/brands/${B.slug || BR}/pro`, {}); if (!r || r.error) { toast(r?.error || 'Couldn’t start the moves. Try again.'); return false; } return true; };
    if (!S.pro && PAYWALL) return openPlan('moves', go); const done = busyBtn(b, 'Starting…'); if (await go()) { toast('Writing the rest of the moves.'); BREW = null; await loadMV(); const el = $('[data-brewing]'); if (el) { const h = brewingCard(); if (h) el.outerHTML = h; else el.remove(); } done(); b.disabled = true; } else done(); }); /* started: it stays off, so the rest is never asked for twice */
  /* the read waits a little for a person to check it; then Brew starts writing with what it read (status.writeAt, local time) */
  const checkWaitCard = () => GEN && waitsOnCheck(BREW) ? `<article class="card brew-wait is-check" data-brewing><div class="body"><span class="bw-k2">${ic('clock', 's14')}Waiting for you${BREW.waitingSince ? ` · ${ago(BREW.waitingSince)}` : ''}</span>
      <h3>Check what we read for ${esc(B.brand.name)}</h3><p>The brand brief and the moves are written from what you confirm. ${writeAtLine(BREW)}</p>
      <button class="btn btn-primary sm" type="button" data-checkread>Check what we read ${ic('right', 's14')}</button></div></article>` : '';
  /* one count with the feed's own "moves" card: the strip shows only while status says moves are still being written */
  const brewingCard = () => checkWaitCard() || (GEN && BREW && !BREW.done && +BREW.total && (BREW.movesDone || 0) < +BREW.total && !BREW.cancelled ? `<article class="card brew-wait" data-brewing>${brewingInner()}</article>` : '');
  document.addEventListener('click', (e) => { if (e.target.closest('[data-checkread]')) ensureTenant(true).then(checkRead); });
  const loadMV = async () => { if (!GEN || BREW?.done) return; const was = BREW; BREW = await api(`/api/brands/${B.slug || BR}/status`).catch(() => null) || BREW; if (was && BREW && was !== BREW && !BREW.done && was.createdAt === BREW.createdAt && +was.movesDone > +BREW.movesDone) BREW = { ...BREW, movesDone: was.movesDone }; /* the count never goes back within a build (QA FEED-QA-21) */
    clearTimeout(mvT); if (BREW && !BREW.done) mvT = setTimeout(async () => { await loadMV(); const el = $('[data-brewing]'); if (el && !el.contains(document.activeElement)) { const h = brewingCard(); if (h) el.outerHTML = h; else el.remove(); } }, 60e3); };
  document.addEventListener('submit', async (e) => { const f = e.target.closest('[data-bwmail]'); if (!f) return; e.preventDefault(); const em = f.querySelector('input').value.trim(), b = f.querySelector('button'); b.disabled = true;
    const r = await api(`/api/brands/${B.slug || BR}/notify`, { email: em }); b.disabled = false;
    if (r?.ok) { ls.set(`${LSP()}mail`, em); const el = f.closest('[data-brewing]'); if (el) el.innerHTML = brewingInner(); toast(`${ic('check', 's16')}We’ll email you when they’re in`); } else toast(`${ic('info', 's16')}${esc(r?.error || 'That did not go through. Try again.')}`); });
  /* each card is reported once per page load: a redraw, a refresh or a new page of cards never counts it again */
  let shownQ = new Set(), shownT = 0, impIO = null; const REPORTED = new Set();
  const trackImpressions = (more) => {
    if (!more || !impIO) { impIO?.disconnect(); impIO = new IntersectionObserver((en) => en.forEach((e) => { const id = e.target.dataset.id; if (!e.isIntersecting || !id) return; impIO.unobserve(e.target); if (REPORTED.has(id)) return; REPORTED.add(id); shownQ.add(id); clearTimeout(shownT); shownT = setTimeout(() => { const ids = [...shownQ]; shownQ.clear(); if (ids.length) tapi('POST', '/api/tenants/:t/events', { shown: ids }); }, 1500); }), { threshold: 0.6 }); }
    $$('#col .card[data-post]:not([data-io]), #deck .card[data-post]:not([data-io])').forEach((c) => { c.dataset.io = '1'; impIO.observe(c); });
  };
  const lazyImgs = (h) => String(h).replace(/<img (?![^>]*\bloading=)/g, '<img loading="lazy" decoding="async" ');
  /* the feed is drawn 15 cards at a time; the next 15 come as the reader nears the end (a sentinel), never all at once */
  const FEED_PAGE = 15; let FEED_AT = 0, FEED_X = { asked: new Set(), wait: [] }, moreIO = null, START_ID = null;
  /* the end of the feed is a calm finish line (QA FEED-NOT-06, FEED-14/15): done for today, what tomorrow brings, Find more as a
     quiet link, and Yesterday folded under it (the cards this person saw or acted on the day before). No prices: pricing is parked */
  const tomorrowLine = () => { const d = new Date(`${brandClock().day}T12:00:00Z`), mon = !isNaN(d) && d.getUTCDay() === 0, n = +S.viewer.perDay || 0;
    return `Tomorrow morning your agents bring ${n ? `your ${n} for the day` : 'a fresh set of cards'}${mon ? ', and Monday’s round-up of the week' : ''}.`; };
  const ydayHtml = () => { const ys = (SRV.yesterday || []).filter((y) => y?.id && y.title); if (!ys.length) return '';
    return `<details class="fe-y"><summary>Yesterday <small>${ys.length}</small></summary><ul>${ys.map((y) => `<li><button class="linkbtn" data-yday="${esc(y.id)}"><b>${esc(y.title)}</b><small>${esc(y.did)}</small></button></li>`).join('')}</ul></details>`; };
  const feedEndHtml = () => `<div class="feed-end fe2"><b>You’re done for today</b><span>${esc(tomorrowLine())}</span><button class="linkbtn fe-more" data-find-more>${ic('refresh', 's14')}Find more</button>${ydayHtml()}</div>`;
  document.addEventListener('click', (e) => { const y = e.target.closest('[data-yday]'); if (!y) return; const p = byId(y.dataset.yday) || (ALL[y.dataset.yday] ? { ...ALL[y.dataset.yday] } : null); if (p) openDetail(p); else toast('That card is no longer here.'); });
  /* cards FEED[from..to) with what sits between them: a connect card from the sixth card on (never above the first pictures), the
     welcome after the third card on a first visit only, the team card after the fourth, and the Pro card on the demo site only */
  const feedRun = (from, to) => { const out = [], X = FEED_X, end = Math.min(to, FEED.length);
    for (let i = from; i < end; i++) { const p = FEED[i];
      out.push(i < 2 ? postCard(p, i) : lazyImgs(postCard(p, i))); /* the first two cards' pictures load at once; the rest as they near the screen */
      const need = p.conn || (p.live && Object.keys(p.live)[0]) || NEEDS[p.cta?.label];
      if (need && B.connectors[need] && !conn(need) && !X.asked.has(need) && X.asked.size < 3 && i < 24) { X.asked.add(need); X.wait.push(need); }
      if (i >= 5 && X.wait.length) out.push(connectCard(X.wait.shift()));
      if (i === 2 && S.sessions <= 1) out.push(introCard());
      if (i === 3 && (!GEN || S.batches.length)) out.push(teamCard());
      if (i === 8 && (!GEN || window.BREW_DEMO)) out.push(deckCard()); /* DUMMY (Pro, DUMMY.md #4): not on a real brand's live feed */
      if (+S.viewer.perDay && i === +S.viewer.perDay - 1 && end > i + 1) out.push(`<p class="feed-today">${ic('check', 's14')}That’s today’s ${+S.viewer.perDay}. The rest are below, whenever you want them.</p>`); /* the "moves a morning" answer */
    }
    if (end >= FEED.length) while (X.wait.length) out.push(connectCard(X.wait.shift())); /* a short feed still gets its connect card, last */
    return out.join(''); };
  const feedMore = () => { const s = $('#feed-more'); if (!s || view !== 'feed') return; const from = FEED_AT; FEED_AT = Math.min(FEED.length, FEED_AT + FEED_PAGE);
    s.insertAdjacentHTML('beforebegin', feedRun(from, FEED_AT)); if (FEED_AT >= FEED.length) { moreIO?.disconnect(); s.outerHTML = feedEndHtml(); }
    requestAnimationFrame(() => { placeStickers(); placeNotes(); trackImpressions(true); }); };
  const armMore = () => { moreIO?.disconnect(); const s = $('#feed-more'); if (!s) return; if (!('IntersectionObserver' in window)) { while ($('#feed-more')) feedMore(); return; }
    moreIO = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) { feedMore(); const n = $('#feed-more'); if (n) { moreIO.disconnect(); moreIO.observe(n); } } }, { rootMargin: '1200px 0px' }); moreIO.observe(s); };
  /* "N new since your last visit": only when there are some (quiet UI: nothing at 0) */
  const newLineHtml = () => { const n = FEED.filter((p) => NEWSET.has(p.id)).length; return n ? `<p class="new-since" role="status"><i class="pulse"></i>${n} new since your last visit</p>` : ''; };
  const renderFeed = async (settle) => {
    if (LANDING || !$('#view')) return; // the landing page has no feed
    const again = view === 'feed' && !!$('#col .card[data-post]'), keepN = again ? FEED_AT : 0; /* a redraw keeps as many cards as were drawn, so the reader keeps their place */
    view = 'feed'; document.body.classList.remove('deck-on');
    $$('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.nav === 'feed'));
    if (!$('#col')) $('#view').innerHTML = `<div class="feedcol" id="col"><div class="sk" style="height:120px;border-radius:20px"></div><div class="sk" style="height:420px;border-radius:20px"></div></div>`;
    await Promise.all([loadFeed(), loadMV()]); if (view !== 'feed') return;
    if (brewingCard()) FEED = FEED.filter((p) => p.id !== 'build-moves'); /* one progress bar above the first idea, not two */
    /* the first session starts on something to look at: the first card with a first draft (or the static ads) leads, marked Start here */
    START_ID = null; if (S.sessions <= 1) { const k = FEED.findIndex((p) => p.draft?.images?.length || p.draft?.video || p.id === 'statics-batch'); if (k >= 0) { START_ID = FEED[k].id; if (k > 0) FEED.unshift(...FEED.splice(k, 1)); } }
    const parts = [greeting(), `<div id="newpill" class="newpill" hidden></div>`, storiesHtml(), brewingCard()];
    if (!GEN || B.health.score) parts.push(healthCard()); // a generated brand shows a score only once something real was measured
    parts.push(newLineHtml());
    FEED_X = { asked: new Set(), wait: [] }; FEED_AT = Math.min(FEED.length, Math.max(FEED_PAGE, keepN));
    parts.push(feedRun(0, FEED_AT));
    parts.push(FEED_AT < FEED.length ? '<div class="feed-more" id="feed-more" aria-hidden="true"></div>' : feedEndHtml());
    if (!$('#view')) return; // the page changed while the feed loaded
    $('#view').innerHTML = `<div class="feedcol${settle ? ' settle' : ''}" id="col">${parts.join('')}</div>`;
    counts(); save(); pulseSince = SRV.clock;
    requestAnimationFrame(() => { placeStickers(); placeNotes(); trackImpressions(); armMore(); });
  };
  /* the feed refreshing itself: new cards slide in at the top, a card whose draft or words changed is redrawn in place, and
     nothing else moves (no rebuild, the reader keeps their place) */
  const insertNew = async () => {
    if (view !== 'feed' || !$('#col .card[data-post]')) { await renderFeed(true); return 0; }
    const was = FEED.slice(), have = new Set(was.map((p) => p.id)); const r = await loadFeed(); if (!r || view !== 'feed') { FEED = was; return 0; }
    const now0 = FEED, fresh = now0.filter((p) => !have.has(p.id) && !cardOf(p).done && !(p.id === 'build-moves' && brewingCard()));
    FEED = [...fresh, ...was.map((p) => ALL[p.id] || p)];
    const col = $('#col'), y0 = scrollY, anchor = scrollY > 240 ? [...$$('#col .card[data-post]')].find((el) => el.getBoundingClientRect().bottom > 80) : null, top0 = anchor?.getBoundingClientRect().top;
    $$('#col .card[data-post]').forEach((el) => { const i = FEED.findIndex((p) => p.id === el.dataset.id); if (i < 0) return; el.dataset.post = i;
      const o = was.find((p) => p.id === el.dataset.id), n = FEED[i]; if (o && n !== o && (JSON.stringify(o.draft || null) !== JSON.stringify(n.draft || null) || JSON.stringify(o.take || null) !== JSON.stringify(n.take || null) || o.title !== n.title || o.done !== n.done) && !el.contains(document.activeElement)) el.outerHTML = postCard(n, i); });
    if (fresh.length) { const first = $('#col .card[data-post]'); const html = fresh.map((p, i) => postCard(p, i)).join(''); if (first) first.insertAdjacentHTML('beforebegin', html); else col.insertAdjacentHTML('afterbegin', html);
      fresh.forEach((p) => $(`#col .card[data-id="${CSS.escape(p.id)}"]`)?.classList.add('is-new')); FEED_AT += fresh.length; }
    const nl = $('#col .new-since'), nh = newLineHtml(); if (nl) { if (nh) nl.outerHTML = nh; else nl.remove(); } else if (nh) $('#col .card[data-post]')?.insertAdjacentHTML('beforebegin', nh);
    if (anchor && top0 != null && document.body.contains(anchor)) scrollTo(0, y0 + anchor.getBoundingClientRect().top - top0); /* reading further down: the new cards wait above without moving the page */
    counts(); pulseSince = SRV.clock; requestAnimationFrame(() => { placeStickers(); placeNotes(); trackImpressions(true); });
    return fresh.length; };

  /* ---------- first-draft clips: muted, looped, played only while at least 60% on screen (any view that shows feed cards) ---------- */
  { const still = matchMedia('(prefers-reduced-motion: reduce)');
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((en) => en.forEach((e) => { const v = e.target; if (e.isIntersecting && !still.matches && !document.hidden) { v.preload = 'auto'; v.play().catch(() => {}); } else if (!v.paused) v.pause(); }), { threshold: 0.6 }) : null;
    const arm = (root) => root.querySelectorAll?.('video.fd-v:not([data-armed])').forEach((v) => { v.dataset.armed = '1'; v.muted = true; io?.observe(v); });
    if (io) { new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.('video.fd-v') ? arm(n.parentNode) : arm(n))))).observe(document.body, { childList: true, subtree: true }); arm(document); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) document.querySelectorAll('video.fd-v').forEach((v) => v.pause()); }); }

  /* ---------- carousels ---------- */
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.media .nav'); if (!nav) return;
    const m = nav.closest('.media'); const n = m.querySelectorAll('.track > *').length;
    let i = (+m.dataset.car + (nav.classList.contains('r') ? 1 : -1) + n) % n; m.dataset.car = i;
    m.querySelector('.track').style.transform = `translateX(${-100 * i}%)`;
    m.querySelectorAll('.dots i').forEach((d, j) => d.classList.toggle('on', j === i));
  });

  /* =========================================================
     Stickers: logos only, left gutter, peel from the nearest corner
     ========================================================= */
  const STK = () => ({ brand: { w: 68, h: 68, art: `<img src="${B.brand.mark}" alt="">` }, brew: { w: 66, h: 66, art: SO('#111', '#fff') }, word: { w: 108, h: 70, art: `<img src="${B.brand.logo}" alt="">`, cls: 'is-word' }, brewInv: { w: 60, h: 60, art: SO('#fff', '#111') } });
  const ORDER = ['brand', 'brew', 'word', 'brewInv', 'brand', 'brew', 'word', 'brewInv', 'brand'];
  const ROT = [-7, 6, -4, 8, -6, 4, -5, 7, -3];
  const SP = new Map(); const ptr = { x: -9999, y: -9999 }; let raf = 0, idle = 0, moving = false, drag = null;
  const placeStickers = () => {
    const layer = $('#stk'); if (!layer) return; layer.innerHTML = ''; SP.clear();
    const col = $('#col'); if (!col || innerWidth < 1060 || view !== 'feed') return;
    const st = $('#stage').getBoundingClientRect(), c = col.getBoundingClientRect();
    const gutter = c.left - st.left; if (gutter < 200) return;
    const top = c.top - st.top, end = top + col.offsetHeight - 260, D = STK();
    ORDER.forEach((k, i) => {
      const y = top + 360 + i * 980; if (y > end) return;
      const d = D[k]; const cx = gutter / 2 + (i % 2 ? 30 : -30);
      const x = Math.max(16, Math.min(cx - d.w / 2, gutter - d.w - 48));
      const el = document.createElement('div');
      el.className = `stk ${d.cls || ''}`; el.dataset.corner = 'br';
      el.style.cssText = `left:${x}px;top:${y}px;width:${d.w}px;height:${d.h}px;--r:${ROT[i]}deg`;
      el.innerHTML = `<div class="stk-art">${d.art}</div><span class="stk-shine"></span><span class="stk-curl"></span>`;
      layer.appendChild(el);
    });
  };
  const spr = (el) => { if (!SP.has(el)) SP.set(el, { x: 0, y: 0, r: 0, vr: 0, s: 1, vs: 0, p: 0, vp: 0, vx: 0, corner: 'br' }); return SP.get(el); };
  const step = (o, k, t, K, Dm, dt) => { const v = 'v' + k; o[v] += (K * (t - o[k]) - Dm * o[v]) * dt; o[k] += o[v] * dt; };
  const tick = () => {
    let busy = false;
    $$('#stk .stk').forEach((el) => {
      const o = spr(el), base = parseFloat(el.style.getPropertyValue('--r')) || 0, r = el.getBoundingClientRect(), isDrag = drag && drag.el === el;
      const corners = { tl: [r.left, r.top], tr: [r.right, r.top], bl: [r.left, r.bottom], br: [r.right, r.bottom] };
      let best = 'br', bd = Infinity; for (const [k, [cx, cy]] of Object.entries(corners)) { const d = Math.hypot(ptr.x - cx, ptr.y - cy); if (d < bd) { bd = d; best = k; } }
      const near = isDrag ? 1 : Math.max(0, 1 - bd / 120);
      if (!isDrag && near > .05 && best !== o.corner && o.p < .08) { o.corner = best; el.dataset.corner = best; }
      const tp = isDrag ? .9 : near * .75 + (moving ? .12 : 0);
      step(o, 'r', isDrag ? Math.max(-12, Math.min(12, o.vx * .6)) : 0, 260, 20, 1 / 60); step(o, 's', isDrag ? 1.06 : 1, 500, 26, 1 / 60); step(o, 'p', tp, 320, 22, 1 / 60); o.vx *= .8;
      el.style.transform = `translate(${o.x}px,${o.y}px) rotate(${(base + o.r).toFixed(2)}deg) scale(${o.s.toFixed(3)})`;
      el.style.setProperty('--peel', (Math.max(0, o.p) * 34).toFixed(1) + 'px');
      if (Math.abs(o.vr) + Math.abs(o.vp) * 40 + Math.abs(tp - o.p) * 40 > .04 || near > 0 || isDrag) busy = true;
    });
    idle = busy ? 0 : idle + 1; raf = idle > 12 ? 0 : requestAnimationFrame(tick);
  };
  const kick = () => { idle = 0; if (!raf) raf = requestAnimationFrame(tick); };
  addEventListener('pointermove', (e) => { ptr.x = e.clientX; ptr.y = e.clientY; if (drag) { const o = drag.o; o.x = drag.ox + e.clientX - drag.x; o.y = drag.oy + e.clientY - drag.y; o.vx = e.clientX - drag.lx; drag.lx = e.clientX; } if ($('#stk')?.childElementCount) kick(); }, { passive: true });
  let scrollT;
  addEventListener('scroll', () => { const l = $('#stk'); if (!l) return; l.style.setProperty('--shx', ((scrollY / 1400) % 1 * 200 - 50).toFixed(1) + '%'); moving = true; kick(); clearTimeout(scrollT); scrollT = setTimeout(() => { moving = false; kick(); }, 300); }, { passive: true });
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest('#stk .stk'); if (!el) return; e.preventDefault(); const o = spr(el); drag = { el, o, x: e.clientX, y: e.clientY, ox: o.x, oy: o.y, lx: e.clientX }; el.classList.add('is-drag'); kick(); window.__sound?.('peel'); });
  addEventListener('pointerup', () => { if (drag) { drag.el.classList.remove('is-drag'); drag = null; kick(); window.__sound?.('stick'); } });
  addEventListener('pointermove', () => { if (drag && Math.abs(drag.o.vx) > 22) window.__sound?.('swish'); }, { passive: true });

  /* ---------- margin notes ---------- */
  const ARROW = '<svg viewBox="0 0 48 24" aria-hidden="true"><path d="M46 14 C 34 4, 18 4, 4 10 M4 10 l7 -5 M4 10 l8 3"/></svg>';
  /* a note after every 2 or 3 cards, as long as the brand has notes. The gaps are random but fixed for this visit (a seed
     kept for the session), so a repaint never moves them. A card with its own note gets it, arrow and all; between cards
     without one, the next note from the feed's pool, never the same one twice in a row */
  const NOTE_SEED = (() => { try { const k = 'brew-note-seed', v = +sessionStorage.getItem(k); if (v) return v; const n = 1 + Math.floor(Math.random() * 1e9); sessionStorage.setItem(k, String(n)); return n; } catch { return 1 + Math.floor(Math.random() * 1e9); } })();
  const noteGap = (k) => { let x = (NOTE_SEED ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0; x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0; x = (x ^ (x >>> 13)) >>> 0; return 2 + (x % 2); }; // 2 or 3
  const placeNotes = () => {
    const layer = $('#notes'); if (!layer) return; layer.innerHTML = ''; $$('.mnote.is-inline').forEach((n) => n.remove());
    if (view !== 'feed' && view !== 'saved') return;
    const wide = innerWidth >= 1060, st = $('#stage').getBoundingClientRect(), cards = $$('#col .card[data-post]');
    const seen = new Set(), pool = cards.map((c) => cardOf(FEED[+c.dataset.post] || {}).note).filter((n) => n?.h && !seen.has(n.h) && seen.add(n.h));
    if (!pool.length) return;
    let lastBottom = -1e9, since = 0, slot = 0, gap = noteGap(0), last = '', ptr = NOTE_SEED % pool.length; /* notes never land on the one above them */
    const near = (i) => new Set(cards.slice(i + 1, i + 4).map((c) => cardOf(FEED[+c.dataset.post] || {}).note?.h).filter(Boolean)); /* a note its own card is about to show */
    const fromPool = (avoid) => { for (const ok of [(n) => n.h !== last && !avoid.has(n.h), (n) => n.h !== last || pool.length === 1]) for (let k = 0; k < pool.length; k++) { const n = pool[(ptr + k) % pool.length]; if (ok(n)) { ptr = (ptr + k + 1) % pool.length; return n; } } return null; };
    cards.forEach((card, i) => {
      if (since < gap) { since++; return; } /* the note goes before this card, once gap cards have passed since the last */
      const p = cardOf(FEED[+card.dataset.post] || {}), own = p?.note?.h && p.note.h !== last ? p.note : null, note = own || fromPool(near(i)); if (!note) { since++; return; }
      const eyebrow = own && p.liveFrom ? `live from ${B.connectors[p.liveFrom].name.toLowerCase()}` : note.k;
      const html = `<span class="k">${esc(eyebrow)}</span><span class="h">${esc(note.h)}</span>`;
      if (!wide) { const n = document.createElement('div'); n.className = 'mnote is-inline'; n.innerHTML = html; card.before(n); }
      else {
        const r = card.getBoundingClientRect(), anchor = card.querySelector('.media, .inset') || card, a = anchor.getBoundingClientRect();
        const top = a.top - st.top + Math.min(90, a.height * .3); if (top < lastBottom + 24) { since++; return; } lastBottom = top + 110; /* no room: the next card takes it */
        const n = document.createElement('div'); n.className = `mnote${own ? '' : ' is-loose'}`; n.innerHTML = (own ? ARROW : '') + html; /* only a card's own note points at it */
        n.style.left = (r.right - st.left + 44) + 'px'; n.style.top = top + 'px'; layer.appendChild(n);
      }
      last = note.h; since = 1; gap = noteGap(++slot);
    });
    const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add('on')), { threshold: .4 });
    $$('#notes .mnote').forEach((n) => io.observe(n));
  };
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { placeStickers(); placeNotes(); }, 200); });

  /* =========================================================
     The action bar. A card's action never runs from the card (feed, card page, queue lists, deck, stories): it opens the
     card's jam with the card's plan as its input. The jam makes the work; Share the brief hands it over
     ========================================================= */
  const logIt = (t, by, icon = 'done') => { S.log.unshift({ t, by, when: 'Just now', icon }); save(); };
  // a bar lives on a feed card or on the card page (data-cp-cta), which carries the same data-post
  const barBox = (bar) => bar.closest('.card,[data-cp-cta]');
  // the money question, as a tray under the action: what it spends, the weekly meter, launch or not yet
  /* buttons that are a place to go, not a card's action */
  const NAV_CTA = { 'Open the deck': () => renderDeck(), 'See all with Pro': () => openPlan('feed'), 'Start a new batch': () => openJam({ batch: true, tab: 'team' }), 'Open the moves': () => { renderMoves(); nav('#v=moves', true, 'view', 'moves'); } };
  /* the card's jam, opened on its plan: the same place tapping the card goes */
  const openCardJam = (p) => { if (!p) return; $$('.sp-ask').forEach((x) => x.remove()); S.jamOn = { ...(S.jamOn || {}), [p.id]: true }; save(); return openDetail(p, { fromCta: true }); };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-start]'); if (!b) return; const card = b.closest('.card[data-post]'); const p = card && FEED[+card.dataset.post]; if (p) openCardJam(p); }); /* Start here opens its jam */
  document.addEventListener('click', (e) => {
    const bar = e.target.closest('.card .bar, [data-cp-cta] .bar'); if (!bar || bar.hasAttribute('data-cx') || bar.classList.contains('is-busy')) return;
    const label = bar.dataset.label, card = barBox(bar);
    if (NAV_CTA[label]) return NAV_CTA[label]();
    const p = card.dataset.post ? FEED[+card.dataset.post] : null; if (!p) return;
    openCardJam(p);
  });

  /* the health card's two buttons: open the move that fixes the weakest ring, or open every ring's checks */
  document.addEventListener('click', (e) => { const mv = e.target.closest('[data-hc-move]'); if (mv) { openMove(+mv.dataset.hcMove); return; }
    const how = e.target.closest('[data-hc-how]'); if (how) { const c = how.closest('.card'); const all = [...c.querySelectorAll('.hc-ring')], open = all.every((d) => d.open); all.forEach((d) => (d.open = !open)); } });
  /* ---------- heart, remix, save, jam ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.card'); const i = +card.dataset.post; const p = FEED[i]; if (!p) return;
    if (b.dataset.act === 'heart') {
      const on = !S.hearts[p.id]; b.setAttribute('aria-pressed', on);
      if (!on) { delete S.hearts[p.id]; save(); tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'unheart' }); return; }
      S.hearts[p.id] = true; save();
      toast(`${ic('heart', 's16')}You’ll see more like this`);
      // the feed service writes CardFeedback(heart) and asks the creative agent for a child card
      const r = await tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'heart' });
      if (!r.child || view !== 'feed') return;
      await rerenderKeep(r.child.id);
      for (let k = 0; k < 40; k++) { await wait(1500); const c = await tapi('GET', `/api/cards/${r.child.id}`); if (c.card && !c.card.loading) { if (view === 'feed') rerenderKeep(r.child.id, true); break; } }
    }
    if (b.dataset.act === 'save') toggleSave(p, b);
    if (b.dataset.act === 'jam') openDetail(p, { jam: true });
    if (b.dataset.act === 'proof') openProof(p);
  });
  const toggleSave = (p, b) => {
    const on = !S.saved.includes(p.id);
    S.saved = on ? [p.id, ...S.saved] : S.saved.filter((x) => x !== p.id); save(); saveTouched = Date.now();
    /* kept on the server too: every device this person opens shows it, and a save lifts cards like it */
    if (byId(p.id) && !/^(work:|jam-)/.test(String(p.id))) tapi('POST', `/api/cards/${encodeURIComponent(p.id)}/feedback`, { kind: on ? 'save' : 'unsave' }).then((r) => { if (Array.isArray(r?.saved) && Date.now() - saveTouched > 1500) S.saved = r.saved.slice(); });
    $$(`.card[data-id="${p.id}"] [data-act="save"]`).forEach((x) => x.setAttribute('aria-pressed', on));
    toast(on ? `${ic('bookmark', 's16')}Saved` : 'Removed from Saved');
    counts(); if (view === 'saved' && !on) renderSaved();
  };
  const rerenderKeep = async (id, quiet) => {
    const y = scrollY; await renderFeed(); scrollTo(0, y);
    const c = $(`#col .card[data-id="${id}"]`); if (c && !quiet) { c.classList.add('is-new'); setTimeout(() => c.classList.remove('is-new'), 2400); }
  };
  /* v1: cards whose take changed are drawn again where they are; the feed keeps its order (insertNew's pattern, no new cards) */
  const redrawTakes = async (ids) => { if (view !== 'feed' || !ids?.length) return; const was = FEED.slice(); const r = await loadFeed(); if (!r || view !== 'feed') { FEED = was; return; }
    FEED = was.map((p) => ALL[p.id] || p);
    for (const id of ids) { const el = $(`#col .card[data-id="${CSS.escape(id)}"]`); const i = el ? +el.dataset.post : -1; if (!el || FEED[i]?.id !== id || el.contains(document.activeElement)) continue; el.outerHTML = postCard(FEED[i], i); }
    requestAnimationFrame(() => { placeStickers(); placeNotes(); }); };
  /* Another take keeps the card in place; the new take shows on its draft when drawn */
  document.addEventListener('click', async (e) => { const b = e.target.closest('.card [data-act="take"]'); if (!b) return; e.stopImmediatePropagation();
    const p = FEED[+b.closest('.card').dataset.post]; if (!p || b.disabled) return; const done = busyBtn(b, 'Starting…');
    const r = await tapi('POST', `/api/cards/${p.id}/remix`, { queue: true, take: true }).catch((er) => ({ error: er.message })); done();
    if (r?.error || !r?.queued) return toast(`${ic('info', 's16')}${esc(r?.error || 'Another take isn’t available yet.')}`);
    await redrawTakes([p.id]);
    toast(`${ic(r.drawError ? 'info' : 'refresh', 's16')}${esc(r.drawError || (r.drawing ? 'Another take is on its way. It shows on this card when it’s ready.' : 'Another take is on this card.'))}`); }, true);

  /* ---------- the ··· menu on every card ---------- */
  const closePop = () => $('#pop')?.remove();
  /* every popover (the account menu, both sign-in states, and #pop) closes on Escape and when the view changes (QA UI 20 Oct) */
  const closePops = () => { document.getElementById('lc-pop')?.remove(); closePop(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (document.getElementById('lc-pop') || $('#pop'))) closePops(); });
  window.addEventListener('hashchange', closePops); window.addEventListener('popstate', closePops);
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-more]');
    if (!m) { if (!e.target.closest('#pop') && !e.target.closest('[data-team-pill]')) closePop(); return; }
    const card = m.closest('.card'); const p = FEED[+card.dataset.post]; if (!p) return;
    closePop();
    const r = m.getBoundingClientRect();
    const pop = document.createElement('div'); pop.id = 'pop'; pop.className = 'pop is-fixed';
    pop.style.left = Math.max(12, Math.min(innerWidth - 248, r.right - 236)) + 'px';
    const saved = S.saved.includes(p.id);
    pop.innerHTML = `<button data-pm="save">${ic('bookmark', 's16')}${saved ? 'Remove from Saved' : 'Save for later'}</button>
      <button data-pm="snooze">${ic('clock', 's16')}Remind me tomorrow</button>
      <button data-pm="slack">${ic('send', 's16')}Share to Slack</button>
      <button data-pm="copy">${ic('copy', 's16')}Copy link to card</button><hr>
      <button data-pm="no">${ic('eyeoff', 's16')}Not interested</button>
      <button data-pm="fewer">${ic('minus', 's16')}Show fewer from ${esc(AGENT[p.agent])}</button>`;
    document.body.appendChild(pop);
    const ph = pop.offsetHeight; pop.style.top = (r.bottom + 6 + ph > innerHeight - 12 ? Math.max(12, r.top - 6 - ph) : r.bottom + 6) + 'px';
    pop.onclick = (ev) => { const a = ev.target.closest('[data-pm]')?.dataset.pm; if (!a) return; closePop();
      if (a === 'save') toggleSave(p);
      // on the deck, rebuild the columns in place so nobody loses their spot; elsewhere repaint the view
      const after = () => (view === 'deck' && document.body.classList.contains('deck-on') ? buildDeck() : renderView());
      const leave = (el) => { if (!el) return; el.style.transition = 'opacity .22s, transform .22s'; el.style.opacity = '0'; el.style.transform = 'scale(.98)'; };
      if (a === 'snooze') { leave(card); tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'snooze' }).then(after); toast(`${ic('clock', 's16')}Back tomorrow`); }
      if (a === 'slack') shareSlack(p);
      if (a === 'copy') copyLink(p, workOfCard(p.id));
      if (a === 'no') { leave(card); S.dismissed[p.id] = true; save(); toast(`${ic('eyeoff', 's16')}Hidden. ${esc(AGENT[p.agent])} will learn from it.`); tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'not_interested' }).then(after); }
      if (a === 'fewer') { S.fewer[p.agent] = (S.fewer[p.agent] || 0) + 1; save(); toast(`${ic('minus', 's16')}Fewer from ${esc(AGENT[p.agent])}. Their cards move down.`); tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'fewer_agent' }).then(after); }
    };
  });
  // the card's popup follows nothing once its column scrolls, so any scroll closes it
  addEventListener('scroll', (e) => { if ($('#pop') && !e.target.closest?.('#pop')) closePop(); }, { capture: true, passive: true });
  /* the brand's Slack is really connected (live site): Brew posts it, in the channel picked when Slack was connected or another */
  const realSlack = () => !window.BREW_DEMO && window.LIVE?.conns?.slack?.state === 'live' && !window.LIVE.conns.slack.dummy;
  const postSlack = async (c, url) => {
    const L0 = await fetch(`/api/brands/${window.BRAND}/slack/channels`, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ error: 'You look offline. Try again.' }));
    if (L0.error) return toast(esc(L0.error));
    let ch = (L0.channels || []).find((x) => x.id === L0.channel) || (L0.channels || [])[0]; if (!ch) return toast('Brew can’t see any channel in Slack yet. Invite @Brew to one.');
    const top = (L0.channels || []).slice(0, 8);
    modal(`<div class="sheet pick-sheet sl-sheet"><header class="sh-h"><b class="sh-t">Post to Slack</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="sl-chans">${top.map((x) => `<button class="chip" data-sl-id="${esc(x.id)}" aria-pressed="${x.id === ch.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="sl-post"><span class="slack-ic">#</span><div><b>Brew <small>APP</small></b><p><b>${esc(c.title)}</b></p><p>${esc(c.sub || '')}</p><div class="sl-unfurl">${face(c.agent)}<span><b>${esc(AGENT[c.agent])}</b><small>${esc(url.replace(/^https?:\/\//, '').slice(0, 46))}…</small></span></div></div></div>
      <label class="sl-note"><input id="sl-note" placeholder="Add a note (optional)" maxlength="240"></label>
      <div class="sh-foot"><button class="btn btn-ghost sm" data-close>Cancel</button><button class="btn btn-primary sm" data-sl-go>${ic('send', 's16')}Post to <span data-sl-ch>${esc(ch.name)}</span></button></div></div>`, (m) => {
      $$('[data-sl-id]', m).forEach((b) => (b.onclick = () => { ch = top.find((x) => x.id === b.dataset.slId) || ch; $$('[data-sl-id]', m).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('[data-sl-ch]', m).textContent = ch.name; }));
      $('[data-sl-go]', m).onclick = async (ev) => { const btn = ev.currentTarget, done = busyBtn(btn, 'Posting…');
        const r = await fetch(`/api/brands/${window.BRAND}/slack/post`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: ch.id, title: c.title, sub: c.sub || '', note: $('#sl-note', m).value.trim(), url }) }).then((x) => x.json()).catch(() => ({ error: 'You look offline. Try again.' }));
        if (r.error) { done(); return toast(esc(r.error)); }
        closeModal(); logIt(c.title, `Posted to ${ch.name}`, 'send'); toast(`${ic('check', 's16')}Posted to ${esc(ch.name)} in Slack. The link opens this card.`); };
    });
  };
  // Share to Slack: connect once, pick the channel, see the exact post, then post it with a link that opens this card
  const shareSlack = async (p) => {
    if (!conn('slack')) return openConnect('slack', { then: () => shareSlack(p), why: 'Share cards to a channel and approve them from the thread.' });
    const c = cardOf(p), url = await linkFor(p, workOfCard(p.id));
    if (realSlack()) return postSlack(c, url);
    const chans = ['#growth', '#brand', '#d2c-ops', '#founders'];
    modal(`<div class="sheet pick-sheet sl-sheet"><header class="sh-h"><b class="sh-t">Share to Slack</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="sl-chans">${chans.map((ch) => `<button class="chip" data-sl-chan="${ch}" aria-pressed="${S.slack.channel === ch}">${ch}</button>`).join('')}</div>
      <div class="sl-post"><span class="slack-ic">#</span><div><b>Brew <small>APP</small></b><p><b>${esc(c.title)}</b></p><p>${esc(c.sub || '')}</p><div class="sl-unfurl">${face(c.agent)}<span><b>${esc(AGENT[c.agent])}</b><small>${esc(url.replace(/^https?:\/\//, '').slice(0, 46))}…</small></span></div></div></div>
      <label class="sl-note"><input id="sl-note" placeholder="Add a note (optional)" maxlength="240"></label>
      <div class="sh-foot"><button class="btn btn-ghost sm" data-close>Cancel</button><button class="btn btn-primary sm" data-sl-go>${ic('copy', 's16')}Copy for <span data-sl-ch>${esc(S.slack.channel)}</span></button></div></div>`, (m) => {
      $$('[data-sl-chan]', m).forEach((b) => (b.onclick = () => { S.slack.channel = b.dataset.slChan; save(); $$('[data-sl-chan]', m).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('[data-sl-ch]', m).textContent = S.slack.channel; }));
      $('[data-sl-go]', m).onclick = () => { const note = $('#sl-note', m).value.trim(); try { navigator.clipboard?.writeText(`${note ? note + '\n' : ''}${c.title}\n${url}`); } catch (e) {}
        closeModal(); logIt(c.title, `Copied for ${S.slack.channel}`, 'send'); toast(`${ic('copy', 's16')}Copied. Paste it in ${esc(S.slack.channel)}; the link opens this card for anyone in ${poss(B.brand.name)} workspace.`); };
    });
  };
  /* =========================================================
     Card panel = the workspace. Read the card, change it with AI (default), send it to your team
     or to Brew, approve, deploy (happens off the feed), then measure and close the loop.
     ========================================================= */
  const STAGE = { drafting: 'Drafting', team: 'With your team', needs_you: 'Needs you', ready: 'Ready to share', shared: 'Brief shared' };
  const STEPS = [['drafting', 'Draft'], ['review', 'Review'], ['ready', 'Ready'], ['shared', 'Brief shared']];
  const stepOf = (st) => ({ team: 'review', needs_you: 'review' }[st] || st);
  /* when a brief went to the ShopOS team, in the reader's own clock: "Sent 4:12 pm", "Sent yesterday 9:05 am", "Sent Mon 4:12 pm", "Sent 18 Oct" */
  const sentLine = (ms) => { if (!ms) return ''; const d = new Date(ms), n = new Date(SRV.clock || Date.now()), day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), dd = Math.round((day(n) - day(d)) / 864e5);
    const hm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([AP])M$/i, (m, x) => ` ${x.toLowerCase()}m`);
    return dd <= 0 ? `Sent ${hm}` : dd === 1 ? `Sent yesterday ${hm}` : dd < 7 ? `Sent ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hm}` : `Sent ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`; };
  const ago = (ms) => { const d = Math.max(0, (SRV.clock || Date.now()) - ms) / 60e3; return d < 1 ? 'just now' : d < 60 ? `${Math.round(d)}m ago` : d < 1440 ? `${Math.round(d / 60)}h ago` : `${Math.round(d / 1440)}d ago`; };
  const curV = (w) => w.versions.find((v) => v.n === w.current) || w.versions[w.versions.length - 1];
  const workOfCard = (id) => WORK.items.find((w) => w.cardId === id && w.stage !== 'shared') || WORK.items.find((w) => w.cardId === id);
  const pseudoPost = (w) => ({ id: 'work:' + w.id, agent: w.agent || 'brew', sector: w.sector || 'creatives', kind: w.img ? 'media' : 'rows', images: w.img ? [w.img] : null, title: w.title, sub: curV(w)?.sub || '', cta: { label: w.cta || 'Deploy' }, time: ago(w.updatedAt), _work: w });
  /* the people who ship are the ShopOS team; work saved before the rename still says "Brew team" */
  const byTeam = (s) => /^(the )?(brew|shopos) team$/i.test(String(s || ''));
  const teamFix = (w) => { if (w?.with?.kind === 'brew' && byTeam(w.with.name)) w.with = { ...w.with, name: 'ShopOS team' }; if (w?.deploy && byTeam(w.deploy.by)) w.deploy = { ...w.deploy, by: 'ShopOS team' }; return w; };
  const putWork = (w) => { if (!w) return; teamFix(w); const i = WORK.items.findIndex((x) => x.id === w.id); if (i < 0) WORK.items.unshift(w); else WORK.items[i] = w; };
  const pullWork = async (quiet) => {
    const r = await tapi('GET', '/api/tenants/:t/work'); if (r.error) return;
    const known = new Set(WORK.notes.map((n) => n.id)), first = !WORK.loaded;
    // anything that moved: a lane change, a new reading, a new version, read state. Not every move posts a note (readings never do)
    const sig = (x) => (x.items || []).map((w) => `${w.id}:${w.stage}:${w.updatedAt}:${w.unread ? 1 : 0}:${w.current}:${w.measure?.readings?.length || 0}:${w.result?.verdict || ''}`).join('|');
    const moved = !first && sig(r) !== sig(WORK), before = new Map(WORK.items.map((w) => [w.id, sig({ items: [w] })]));
    (r.items || []).forEach(teamFix); WORK = { ...r, loaded: true };
    const fresh = first ? [] : r.notes.filter((n) => !known.has(n.id));
    if (fresh.length && !first && document.visibilityState === 'visible') { const ks = fresh.map((n) => n.kind); sound(ks.includes('result') ? (fresh.some((n) => n.kind === 'result' && /beat|won/i.test(n.text)) ? 'win' : 'ping') : ks.includes('needs_you') ? 'knock' : ks.includes('live') ? 'live' : ks.includes('ready') ? 'approve' : 'ping'); }
    if (fresh.length && !quiet) toast(`${ic('done', 's16')}${esc(fresh[0].text)}${fresh.length > 1 ? ` <small>+${fresh.length - 1} more</small>` : ''}`);
    counts(); paintStatus(); paintNotes();
    if (fresh.length || moved || quiet === 'force') { if (view === 'work') renderWork(); else if (view === 'jams') renderJams(false); const dp = $('#dp'), dw = DP && (DP.p._work?.id || workOfCard(DP.p.id)?.id), nw = dw && WORK.items.find((x) => x.id === dw);
      if (dp && dw && (fresh.some((n) => n.itemId === dw || n.itemId === dp.dataset.work) || (nw && before.get(dw) !== sig({ items: [nw] })))) repaintDetail(); }
  };
  // why this card is here, in words a client reads: what lifted it, what held it back, where it sits today,
  // and a way to say if it was useful (that feedback re-ranks the feed and teaches Brew)
  const paceOfN = (n) => (n == null || !Number.isFinite(+n) ? null : +n === 0 ? 'none' : +n < 10 ? 'few' : +n < 50 ? 'ten' : 'always'); /* channel-fit paceOf */
  const reasonsOf = (p, sc) => { const r = [], role = ROLE();
    if (sc.seat > 0) r.push({ up: true, ic: 'person', t: `Picked for your seat: ${role.title}`, w: sc.seat });
    if (sc.impact > 0) r.push({ up: true, ic: 'trendup', t: sc.impactV ? `About ${inrS(sc.impactV)} a month at stake` : sc.impactPct ? 'Moves a number you track' : 'Could move revenue', w: sc.impact });
    if (sc.isDecision) r.push({ up: true, ic: 'hand', t: 'A call only you can make', w: 1 });
    if (sc.fresh > 0) r.push({ up: true, ic: 'clock', t: sc.fresh >= 4 ? 'New today' : 'Still recent', w: sc.fresh });
    if (sc.affinity > 0) r.push({ up: true, ic: 'heart', t: `Like the ${AGENT[p.agent]} cards you liked`, w: sc.affinity });
    if (sc.boost > 0) r.push({ up: true, ic: 'refresh', t: 'You asked to see it again', w: sc.boost });
    if (sc.look > 0) r.push({ up: true, ic: 'pic', t: sc.look >= 3 ? 'Its first draft is ready to look at' : 'An ad to look at', w: sc.look });
    if (sc.fatigue < 0) r.push({ up: false, ic: 'eyeoff', t: sc.quiet ? 'You opened it a while ago and its jam has gone quiet, so it’s moving down' : `You’ve seen it ${sc.seen > 1 ? `on ${sc.seen} days` : 'before'}, so it’s moving down`, w: -sc.fatigue });
    if (sc.feedback < 0) r.push({ up: false, ic: 'minus', t: `Fewer from ${AGENT[p.agent]}, as you asked`, w: -sc.feedback });
    if (sc.chan < 0) r.push({ up: false, ic: 'minus', t: 'For a channel you don’t run', w: -sc.chan });
    if (sc.pace > 0) r.push({ up: true, ic: 'trendup', t: ['none', 'few'].includes(S.viewer.adPace || paceOfN(window.BREW_NUMBERS?.ownAds?.n)) ? 'Groundwork first, as you run few ads' : 'New ads first, as you run them most weeks', w: sc.pace });
    return r.sort((a, b) => (b.up - a.up) || b.w - a.w); };
  const rankHtml = (id) => { const sc = SCORES[id], p = byId(id); if (!sc || !p) return '';
    const rs = reasonsOf(p, sc), pos = FEED.findIndex((x) => x.id === id), top = rs.filter((x) => x.up).slice(0, 2).map((x) => x.t);
    const fb = DP?.fb?.[id] || null;
    return `<details class="cp-rank"${DP?.rankOpen ? ' open' : ''}><summary><i class="cp-m-ic">${ic('sliders', 's16')}</i><span><small>Why you’re seeing this</small><b>${esc(top[0] || 'Ranked for your seat')}</b></span>${pos >= 0 ? `<em class="cp-rank-sc">#${pos + 1}<small>in your feed</small></em>` : ''}${ic('down', 's16')}</summary>
      <div class="cp-rank-b"><ul class="cp-why">${rs.map((x) => `<li class="${x.up ? 'is-up' : 'is-down'}"><i>${ic(x.ic, 's14')}</i><span>${esc(x.t)}</span></li>`).join('')}</ul>
        <div class="cp-fb">${fb === 'sent' ? `<p class="cp-fb-done">${ic('check', 's14')}Thanks. Your feed and Brew both learn from this.</p>` : `<span>Was this useful?</span>
          <button class="cp-act sm${S.hearts[id] ? ' is-on' : ''}" data-fb="up">${ic('heart', 's14')}More like this</button>
          <button class="cp-act sm" data-fb="down">${ic('eyeoff', 's14')}Not for me</button>
          <button class="cp-act sm" data-fb="why">${ic('chat', 's14')}Tell us why</button>
          ${fb === 'why' || fb === 'down' ? `<form class="cp-fb-f" data-fb-form><input placeholder="${fb === 'down' ? 'What would make it useful? (optional)' : 'What’s useful or off about this card?'}" autocomplete="off"><button class="btn btn-primary sm">Send</button></form>` : ''}`}</div></div></details>`; };
  const threadHtml = (w) => w.thread.map((m) => {
    if (m.from === 'system') return `<div class="th-sys">${esc(m.body)}</div>`;
    if (m.from === 'me') return `<div class="msg me"><div class="tx">${esc(m.body)}</div></div>`;
    const who = m.from === 'ai' ? face(w.agent || 'creative') : m.from === 'colleague' ? avatar(B.colleagues.map((c) => colleague(c.id)).find((c) => c.name === m.who || c.role === m.who) || { ini: (m.who || '?').slice(0, 2).toUpperCase(), color: '#555' }, 28) : window.BREW_DEMO ? `<span class="av pod-av">${esc((B.pod.find((x) => x.role === m.who) || { ini: 'SO' }).ini)}</span>` : brewAv(28);
    return `<div class="msg">${who}<div class="tx"><b>${esc(m.who || 'Agent')}${m.via === 'slack' ? ' <small>in Slack</small>' : m.from === 'colleague' && w.with?.channel ? ` <small>in ${esc(w.with.channel)}</small>` : ''}</b><span class="tx-b">${esc(m.body)}</span>
      ${m.tiles ? `<div class="tiles">${m.tiles.map((t, i) => `<button class="tile${m.picked === i ? ' on' : ''}" data-pick="${m.id}:${i}"><span class="chip">${esc(t.angle || 'Version')}</span><b>${esc(t.title)}</b><span>${esc(t.sub)}</span><em>${m.picked === i ? 'Saved as a version' : 'Use this'}</em></button>`).join('')}</div>` : ''}</div></div>`;
  }).join('');
  let DP = null; // { p, w, to, opts }
  // studio chat and jam thread, one timeline
  const mergedThread = (w, ch) => {
    const studio = (ch.thread || []).map((m, i) => ({ at: m.at || 0, i, html: m.from === 'you' ? `<div class="msg me"><div class="tx">${esc(m.text)}</div></div>` : `<div class="msg">${face(ch.agent)}<div class="tx"><b>${esc(AGENT[ch.agent])} <small>in the studio</small></b><span class="tx-b">${esc(m.text)}</span>${m.v ? `<em class="vchip">v${m.v}</em>` : ''}</div></div>` }));
    const jam = (w.thread || []).map((m, i) => ({ at: m.at || 0, i: 1000 + i, html: threadHtml({ ...w, thread: [m] }) }));
    return [...studio, ...jam].sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.html).join('');
  };
  /* history: the card page, the remix options, a package in the studio and each view are entries of their own,
     so the browser's Back and ours walk the same path. route() makes the screen match the URL. */
  const nav = (hash, push, a, v = view) => { const st = { a, v }; hash = typeof hash === 'string' && hash.startsWith('#') ? location.pathname + hash : hash; if (push) history.pushState(st, '', hash); else history.replaceState(st, '', hash); };
  const VIEWS = () => { const v = VIEWS0(); v.tune = renderTune; return v; };
  const VIEWS0 = () => ({ feed: renderFeed, deck: renderDeck, saved: renderSaved, jams: (f) => renderJams(f !== false), remixes: (f) => renderJams(f !== false), refs: (f) => renderReferences(f !== false), done: renderWork, work: renderWork, connectors: renderConnectors, learned: renderLearned, brand: () => renderBrand(), heard: () => renderHeard(), facts: () => renderFacts(), moves: renderMoves, move: renderMove, queue: () => renderQueue() });
  const route = () => {
    const hp = hashParams(), rm = location.hash.match(/^#remix=([^/&]+)(?:\/([^&]+))?/);
    if (rm) { const p = byId(decodeURIComponent(rm[1]));
      /* a link to a card this view hasn't loaded (from Learned, the deck, a pasted URL): load the cards once, then open it; never a dead link */
      if (!p) { if (route.tried === location.hash) return; route.tried = location.hash; loadFeed().then(() => { if (byId(decodeURIComponent(rm[1]))) route(); else toast('That card isn’t in this feed any more.'); }); return; }
      route.tried = null; closePop(); closeModal(); if (DP) closeDetail(true);
      if (view !== 'remix' || RX.p?.id !== p.id) return openRemix(p, rm[2], { fromHistory: true });
      if ((rm[2] || null) !== (RX.ch?.id || null)) return rm[2] ? openStudio(rm[2], { fromHistory: true }) : backToOptions(true);
      return; }
    const target = hp.v && VIEWS()[hp.v] ? hp.v : history.state?.v && VIEWS()[history.state.v] ? history.state.v : 'feed';
    if (view === 'remix') { RX.ch = null; view = target; VIEWS()[target](); }
    const wk = hp.work && WORK.items.find((x) => x.id === hp.work);
    const p = hp.card ? byId(hp.card) : wk ? (byId(wk.cardId) ? { ...byId(wk.cardId), _work: wk } : pseudoPost(wk)) : null;
    if (p) { if (DP?.p?.id !== p.id || (p._work && DP?.w?.id !== p._work.id)) openDetail(p, { fromHistory: true }); return; }
    if (hp.jam) { if (!DP) window.JamRoom?.fromHash(); return; }
    if (DP) closeDetail(true);
    if (!$('#view')) return; /* no feed on screen yet (sign-in, the read, onboarding): a view link waits for the feed to open */
    if ((view !== target || (target === 'move' && hp.m != null && +hp.m !== MV.n)) && !['remix'].includes(view)) { closePop(); closeModal(); /* Back from the Pro sheet or a menu leaves it behind */ VIEWS()[target](); window.scrollTo(0, 0); }
  };
  addEventListener('popstate', route);
  /* links carry the workspace: a signed token opens this same tenant, so the card shows exactly where it is now */
  let SHARE = null;
  /* a link carries its jam (wid): signing in from it makes someone a guest of that jam only; without one it only lets them look */
  const SHARES = {};
  const shareTok = async (wid) => { if (SHARE && (!wid || SHARE.includes(`~${wid}~`))) return SHARE; const k = wid || '';
    if (!(k in SHARES)) SHARES[k] = (await tapi('GET', `/api/tenants/:t/share${wid ? `?wid=${encodeURIComponent(wid)}` : ''}`)).token || null; return SHARES[k]; };
  const hashOf = (p, w) => String(p.id).startsWith('work:') || (p._work && !String(p.id).startsWith('jam-') && workOfCard(p.id)?.id !== p._work.id) ? `#work=${encodeURIComponent(w?.id || p._work?.id)}` : String(p.id).startsWith('jam-') && w ? `#jam=${encodeURIComponent(w.id)}` : `#card=${encodeURIComponent(p.id)}`;
  const linkFor = async (p, w) => { const t = await shareTok(w?.id || p?._work?.id || workOfCard(p?.id)?.id); return `${location.origin}/${hashOf(p, w)}${t ? `&s=${t}` : ''}`; };
  const copyLink = async (p, w) => { const u = await linkFor(p, w); try { await navigator.clipboard.writeText(u); } catch (er) {} toast(`${ic('copy', 's16')}Link copied. It opens this exactly as it is now.`); };
  const hashParams = () => Object.fromEntries(location.hash.replace(/^#/, '').split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, ''] : [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
  const closeDetail = (fromHistory) => { document.body.classList.remove('sheet-open'); $('#dp')?.remove(); $('#dp-scrim')?.remove(); DP = null; if (!fromHistory && /^#(card|work|jam)=/.test(location.hash)) history.replaceState({ a: 'view', v: view }, '', location.pathname); };
  const NOPKG = new Set(); /* cards with no package: they keep the canvas jam, and we don't ask again */
  const openDetail = (p, opts = {}) => {
    if (window.JamRoom && (opts.jam || opts.sendBrew || opts.to === 'team' || opts.to === 'brew')) return window.JamRoom.open(p, { mode: opts.to, draft: opts.draft, sendBrew: opts.sendBrew });
    { const w0 = p._work || workOfCard(p.id), late = ['shared', 'team', 'needs_you', 'ready'].includes(w0?.stage);
      /* no in-between page: tapping a card goes straight into its jam (studio, or the canvas jam when it has no package) */
      if (!opts.noStudio && !opts.fromWork && !late && !jamOn(p, w0) && !String(p.id).startsWith('sig-')) { S.jamOn = { ...(S.jamOn || {}), [p.id]: true }; save(); return openRemix(p, null, { make: opts.fromCta ? cardOf(p).cta?.label || '' : '' }); } }
    { const w0 = p._work || workOfCard(p.id); if (!opts.noStudio && jamOn(p, w0) && (w0?.changeId || !NOPKG.has(p.id)) && !['shared', 'team', 'needs_you', 'ready'].includes(w0?.stage) && !opts.fromWork) return openRemix(p, w0?.changeId || null, { make: opts.fromCta ? cardOf(p).cta?.label || '' : '' }); } /* a jam from before the studio links its package on the way in; from the card's button it also makes what the button names */
    closePop(); closeModal(); closeJam();
    const wasOpen = !!DP && !!$('#dp');
    const w = p._work || workOfCard(p.id);
    DP = { p, w, opts, to: opts.to || (w && ['team', 'brew', 'needs_you'].includes(w.stage) && w.with ? w.with.kind : 'ai'), picking: null };
    if (!$('#dp')) { const el = document.createElement('div'); el.innerHTML = `<div class="scrim" id="dp-scrim"></div><aside class="drawer dp" id="dp" role="dialog" aria-label="Card"></aside>`; document.body.appendChild(el); $('#dp-scrim').onclick = closeDetail; }
    // the hand icon opens the jam as a side drawer; opening the card itself is a full page
    const full = !opts.jam && !opts.drawer; $('#dp').classList.toggle('dp-full', full); $('#dp-scrim').hidden = full;
    const rw = $('.rail')?.getBoundingClientRect().width; if (rw) document.documentElement.style.setProperty('--rail-w', rw + 'px');
    { const h = hashOf(p, w); if (!opts.fromHistory && (!String(p.id).startsWith('jam-') || w)) { nav(h + (SHARE ? `&s=${SHARE}` : ''), !wasOpen, 'dp'); if (!SHARE) shareTok(w?.id).then((t) => { if (t && DP?.p?.id === p.id && location.hash.startsWith(h)) history.replaceState(history.state, '', location.pathname + `${h}&s=${t}`); }); } }
    if (w && w.unread) tapi('POST', '/api/tenants/:t/notes/read', { itemId: w.id }).then(() => { w.unread = false; WORK.notes.forEach((n) => { if (n.itemId === w.id) n.read = true; }); WORK.unread = WORK.notes.filter((n) => !n.read).length; counts(); });
    repaintDetail(); loadLearned(p);
    if (opts.jam || opts.draft) setTimeout(() => { const i = $('#dp-in'); if (!i) return; if (opts.draft) i.value = opts.draft; i.focus(); }, 80);
  };
  /* ---------- the card page: the card, enlarged, laid out like a decision ----------
     hero (the card itself) → the options (one is our pick) → our recommendation → backed by the moves → how we measure.
     The page data comes from /api/cards/:cid/page (prebuilt for seed cards, built once for the rest). */
  const PAGE = {};
  const LEARNED = {};
  const loadLearned = (p) => { if (/^(work:|jam-)/.test(String(p.id))) return; tapi('GET', `/api/cards/${encodeURIComponent(p.id)}/learned`).then((r) => { const was = JSON.stringify(LEARNED[p.id] || null); LEARNED[p.id] = r.learned || []; if (DP?.p?.id === p.id && JSON.stringify(LEARNED[p.id]) !== was) repaintDetail(); }); };
  const loadPage = (p) => { if (PAGE[p.id] !== undefined || String(p.id).startsWith('work:') || String(p.id).startsWith('jam-')) return; PAGE[p.id] = null;
    tapi('GET', `/api/cards/${encodeURIComponent(p.id)}/page`).then((r) => { PAGE[p.id] = r.page || false; if (DP?.p?.id === p.id) repaintDetail(); }); };
  const localPage = (c) => { const how = c.detail?.how || [];
    return { lead: c.sub, options: [{ id: 'o1', name: c.cta?.label || 'Do what it recommends', says: how[0] || c.sub, effect: how.slice(1).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ') || (c.detail?.why || [])[0] || '', moves: [], pick: true }], reason: (c.detail?.why || [])[0] || '', follows: [], moves: [] }; };
  const mv2 = (n) => mvNum(n);
  const KIND = { report: 'Report', idea: 'Idea', decision: 'Decision', competitor: 'Competitor watch' };
  /* one name per area everywhere: the deck's column names (QA FEED-ARV-08: Catalog was "Marketplaces" here); Storefront only with ?storefront=1 */
  const SECTOR = { ads: 'Ads', creatives: 'Creatives', ...(SF_ON ? { storefront: 'Storefront' } : {}), catalog: 'Catalog', visibility: 'AI answers', signals: 'Signals' };
  // how we measure it, on the card page: today → target on a track, what we watch, how it's attributed
  const cpMeasure = (m, w, f) => { const reads = w?.measure?.readings || [], res = w?.result, has = m.connected && m.baseline != null;
    return `<div class="cp-m">
      ${res ? '' : `<div class="cp-m-track"><div class="cp-m-pt"><small>Today</small><b>${has ? esc(f(m.baseline)) : 'Not set yet'}</b></div>
        <div class="cp-m-line"><i></i><span>${ic('clock', 's14')}Check on day ${esc(m.window)}</span></div>
        <div class="cp-m-pt is-goal"><small>Target</small><b>${esc(m.targetLabel || f(m.target))}</b></div></div>`}
      ${!m.connected ? `<div class="cp-m-cx">${ic('plug', 's16')}<span>Connect <b>${esc(m.fromName)}</b> and we set today’s number from your real data.</span><button class="btn btn-ghost sm" data-cx="${esc(m.from)}">Connect</button></div>` : ''}
      ${m.watch?.length ? `<div class="cp-m-sec"><small>What to watch along the way</small><div class="cp-m-watch">${m.watch.map((x) => `<span><i></i>${esc(x)}</span>`).join('')}</div></div>` : ''}
      ${m.attribution ? `<p class="cp-m-attr">${ic('link', 's14')}<span><b>How we know it was this:</b> ${esc(m.attribution)}</span></p>` : ''}</div>`; };
  // the measure for the option that's open: what we read for THIS path, where, the target, when, and when we stop
  // "Cost per first order on the static" is the same number as "Cost per first order": compare the metric, not where it's read
  const metricFam = (x) => String(x || '').toLowerCase().replace(/\s+(on|in|for|from|across|via)\s+.*$/, '').replace(/[^a-z0-9₹% ]/g, '').trim();
  const cpOptMeasure = (om, m, w, f) => { const same = m && metricFam(om.metric) === metricFam(m.metric), has = same && m.connected && m.baseline != null;
    return `<div class="cp-m">
      ${om.where ? `<p class="cp-m-where">${ic('grid', 's14')}${esc(om.where)}</p>` : ''}
      <div class="cp-m-track"><div class="cp-m-pt"><small>Today</small><b>${has ? esc(f(m.baseline)) : 'At go-live'}</b></div>
        <div class="cp-m-line"><i></i><span>${ic('clock', 's14')}Read on day ${esc(om.window)}</span></div>
        <div class="cp-m-pt is-goal${om.target ? '' : ' is-open'}"><small>Target</small><b>${om.target ? esc(om.target) : 'Set with you'}</b></div></div>
      ${om.guard ? `<p class="cp-m-guard">${ic('lock', 's14')}<span><b>We stop if</b> ${esc(om.guard)}</span></p>` : ''}
      ${om.watch?.length ? `<div class="cp-m-sec"><small>What to watch along the way</small><div class="cp-m-watch">${om.watch.map((x) => `<span><i></i>${esc(x)}</span>`).join('')}</div></div>` : ''}
      ${m && !same ? `<p class="cp-m-north">${ic('trendup', 's14')}<span><b>The goal behind it:</b> ${esc(m.metric)}, ${m.connected && m.baseline != null ? `${esc(f(m.baseline))} → ` : 'target '}${esc(m.targetLabel || f(m.target))}</span></p>` : ''}
      ${m && !m.connected ? `<div class="cp-m-cx">${ic('plug', 's16')}<span>Connect <b>${esc(m.fromName)}</b> and we set today’s numbers from your real data.</span><button class="btn btn-ghost sm" data-cx="${esc(m.from)}">Connect</button></div>` : ''}
      ${m?.attribution ? `<p class="cp-m-attr">${ic('link', 's14')}<span><b>How we know it was this:</b> ${esc(m.attribution)}</span></p>` : ''}</div>`; };
  /* how we measure it, designed from the brief (w.doc.measure): an ordered list of blocks the server wrote for THIS
     outcome (checkpoints, a holdout, a funnel, a ratio, stop rules, open questions). Draw whatever came back, in order. */
  const cpSpec = (ms, m, w, f) => { const B = {
      scope: (b) => `<p class="cp-m-where">${ic('grid', 's14')}${esc(b.text)}</p>`,
      track: (b) => { let prev = 0; const seg = (p) => { const r = b.read && b.read > prev && b.read < p.day ? b.read : null; prev = p.day; return `<div class="cp-m-line"><i></i>${r ? `<span>${ic('clock', 's14')}Read on day ${r}</span>` : ''}</div>`; };
        return `<div class="cp-m-track${b.points.length > 1 ? ' is-multi' : ''}"><div class="cp-m-pt"><small>Today</small><b>${m?.connected && m.baseline != null && b.start === 'At go-live' ? esc(f(m.baseline)) : esc(b.start)}</b></div>
          ${b.points.map((p, i) => `${seg(p)}<div class="cp-m-pt ${i === b.points.length - 1 ? 'is-goal' : 'is-check'}"><small>${esc(p.label || (i === b.points.length - 1 ? 'Target' : 'Check'))} · day ${p.day}</small><b>${esc(p.value)}</b></div>`).join('')}</div>`; },
      compare: (b) => `<div class="cp-m-sec"><small>Who we compare</small><div class="cp-m-cmp">${b.groups.map((g, i) => `<div class="${i ? 'is-hold' : ''}">${g.share ? `<em>${esc(g.share)}</em>` : ''}<b>${esc(g.name)}</b>${g.gets ? `<span>${esc(g.gets)}</span>` : ''}</div>`).join('<i>vs</i>')}</div>${b.result ? `<p class="cp-m-res">${ic('trendup', 's14')}${esc(b.result)}</p>` : ''}</div>`,
      funnel: (b) => `<div class="cp-m-sec"><small>The path to it</small><div class="cp-m-fun">${b.steps.map((x) => `<span><b>${esc(x.label)}</b>${x.value ? `<em>${esc(x.value)}</em>` : ''}</span>`).join(ic('right', 's14'))}</div></div>`,
      formula: (b) => `<div class="cp-m-sec"><small>How we count it</small><div class="cp-m-frac"><span>${esc(b.top)}</span><i></i><span>${esc(b.bottom)}</span></div>${b.text ? `<p class="cp-m-res">${esc(b.text)}</p>` : ''}</div>`,
      guard: (b) => b.rules.map((r) => `<p class="cp-m-guard">${ic('lock', 's14')}<span><b>We stop if</b> ${esc(r.if)}${r.then ? `<em> → ${esc(r.then)}</em>` : ''}</span></p>`).join(''),
      watch: (b) => `<div class="cp-m-sec"><small>What to watch along the way</small><div class="cp-m-watch">${b.items.map((x) => `<span><i></i>${esc(x)}</span>`).join('')}</div></div>`,
      north: (b) => `<p class="cp-m-north">${ic('trendup', 's14')}<span><b>The goal behind it:</b> ${esc(b.text)}</span></p>`,
      attribution: (b) => `<p class="cp-m-attr">${ic('link', 's14')}<span><b>How we know it was this:</b> ${esc(b.text)}</span></p>`,
      open: (b) => `<div class="cp-m-sec cp-m-open"><small>Still open</small><div class="cp-m-qs">${b.items.map((q) => `<button class="chip" data-m-ask="${esc(q)}">${ic('sparkles', 's14')}${esc(q)}</button>`).join('')}</div></div>` };
    const done = !!w?.result, body = ms.blocks.filter((b) => B[b.type] && !(done && (b.type === 'track' || b.type === 'open'))).map((b) => B[b.type](b));
    return `<div class="cp-m is-spec">${body.join('')}
      ${m && !m.connected ? `<div class="cp-m-cx">${ic('plug', 's16')}<span>Connect <b>${esc(m.fromName)}</b> and we set today’s numbers from your real data.</span><button class="btn btn-ghost sm" data-cx="${esc(m.from)}">Connect</button></div>` : ''}
      </div>`; };
  // an open question about the measure goes to the jam: AI answers it in the brief, and the section redraws from it
  document.addEventListener('click', (e) => { const q = e.target.closest('[data-m-ask]'); if (!q) return; e.preventDefault(); window.JamRoom?.send?.(q.dataset.mAsk); });
  /* a new jam has no card: the left side shows what the jam is making. A live preview drafted from the brief
     (an ad, a WhatsApp message or a page), the plan at a glance with the gaps one tap from AI, and what to ask next. */
  const JAM_STARTS = GEN ? [`A new ad for ${GX.p1}`, 'A message to last month’s buyers', 'A change to the product page', `A creator brief for ${GX.p2}`] : ['A new ad for the Anti-Grey Serum', 'A WhatsApp message to last month’s buyers', 'A change to the product page', 'A creator brief for the Pack of 3'];
  // only the exact product gets its photo; anything else (e.g. the Anti-Grey Serum, which has no shot yet) gets a type-only design
  const JB_NEXT = { ad: ['Give me 3 headline options', 'Who exactly should see this?', 'What should the visual show?'], ops: ['Which campaigns does this touch?', 'How much spend moves, and when?'], crm: ['Write the message itself', 'Who should not get this?', 'What time should it go out?'],
    store: ['Write the new page copy', 'Which pages change first?'], catalog: ['Rewrite the top listing title', 'Which marketplaces first?'], brief: ['List the deliverables', 'What’s the budget?'], general: ['What’s the goal in one line?', 'Who is this for?'] };
  const mdPlain = (x) => String(x || '').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/\*\*|__|`/g, '').trim();
  // "Jam on all": the left side lists the plans the brief holds, one per card
  const bundleBoardHtml = (p, w, cards) => `<header class="jb-head"><span class="jb-kind">${face('brew')}${cards.length} plans · one brief</span><h1>${esc(w?.title || p.title)}</h1>
      <p>Each card keeps its own plan in the brief. Ask in the chat to change one, or to merge them into one plan.</p></header>
      <ol class="jb-plans">${cards.map((x, i) => { const cc = cardOf(x); return `<li><span class="jbp-n">${i + 1}</span>${x.images?.[0] ? `<img src="${esc(x.images[0])}" alt="" loading="lazy">` : `<span class="jbp-ph">${face(x.agent)}</span>`}
        <span class="jbp-tx"><small>${esc(fromLabel(cc))}</small><b>${esc(cc.title)}</b><span>${esc(cc.sub || '')}</span></span>
        <button class="btn btn-ghost sm" data-jb-card="${esc(x.id)}">Open card</button></li>`; }).join('')}</ol>`;
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-jb-card]'); if (!b) return; const x = byId(b.dataset.jbCard); if (x) openDetail(x); });
  const jamBoardHtml = (p, c, w) => {
    const bundle = (p.bundle || w?.bundle || []).map(byId).filter(Boolean); if (bundle.length) return bundleBoardHtml(p, w, bundle);
    const d = w?.doc || {}, md = String(d.md || ''), lines = md.split('\n'), th = w?.thread || [];
    const said = th.filter((m) => m.from === 'me' && !m.learn).length, started = said > 0; /* brand learnings pasted here are not what the jam makes */
    if (!started) return `<header class="jb-head"><span class="jb-kind">${face('brew')}New jam</span><h1>What do you want made?</h1><p>Say it in the chat. The brief writes itself as you talk, and this side shows it coming to life.</p></header>
      <div class="jb-starts">${JAM_STARTS.map((x, i) => `<button class="jb-start" data-jb-send="${esc(x)}" style="animation-delay:${i * 50}ms">${ic('sparkles', 's16')}<span>${esc(x)}</span>${ic('right', 's16')}</button>`).join('')}</div>`;
    const title0 = mdPlain((lines.find((l) => /^#\s/.test(l)) || '').replace(/^#\s+/, '')), first = mdPlain(th.find((m) => m.from === 'me' && !m.learn)?.body || '').replace(/^@\S+\s*/, '');
    const title = title0 && !/^new jam$/i.test(title0) ? title0 : first.slice(0, 80);
    const body = lines.filter((l) => l.trim() && !/^#/.test(l)).map(mdPlain).filter((l) => l && !/fresh jam|say what you want made/i.test(l));
    // the preview shows only what customers would read: copy the brief actually contains, never the chat or internal notes
    const prof = d.profile || 'general', bp = d.plan || {}, isCustomer = ['ad', 'crm', 'store', 'catalog', 'vis'].includes(prof);
    const hook = bp.headline || d.hook || '', capText = bp.body || '', btn = bp.button || '';
    const photo = null; // a product photo comes from the drafts, not a fixed set
    const caption = capText;
    const preview = prof === 'crm'
      ? `<div class="jb-pv jb-wa"><div class="jb-wa-top">${face('crm')}<b>${B.brand.name}</b><small>Business account</small></div><div class="jb-wa-body"><div class="jb-wa-msg">${photo ? `<img src="${photo}" alt="">` : ''}<p><b>${esc(hook)}</b></p>${caption ? `<p>${esc(caption)}</p>` : ''}<small>12:04</small></div><div class="jb-wa-btns"><span>${esc(btn || 'Shop now')}</span><span>Not now</span></div></div></div>`
      : prof === 'store' || prof === 'catalog' || prof === 'vis'
      ? `<div class="jb-pv jb-web"><div class="jb-web-bar"><i></i><i></i><i></i><span>${prof === 'catalog' ? (B.sym === '₹' ? 'amazon.in' : 'amazon.com') : `${B.brand.host}`}</span></div><div class="jb-web-hero"><div><small>${B.brand.name}</small><b>${esc(hook)}</b>${caption ? `<p>${esc(caption)}</p>` : ''}<span class="jb-web-cta">${esc(btn || 'Add to cart')}</span></div>${photo ? `<img src="${photo}" alt="">` : `<span class="jb-type sm"><i>${esc(String(B.brand.name || '').toUpperCase())}</i></span>`}</div></div>`
      : `<div class="jb-pv jb-ig"><div class="jb-ig-top"><span class="jb-ig-av">${esc((B.brand.name || "B")[0])}</span><span><b>${B.brand.host}</b><small>Sponsored</small></span></div><div class="jb-ig-img${photo ? '' : ' is-type'}">${photo ? `<img src="${photo}" alt="">` : `<i class="jb-ig-mark">${esc(String(B.brand.name || '').toUpperCase())}</i>`}<b>${esc(hook)}</b></div><div class="jb-ig-cta">${esc(btn || 'Shop now')}${ic('right', 's14')}</div>${caption ? `<p class="jb-ig-cap"><b>${B.brand.host}</b> ${esc(caption)}</p>` : ''}</div>`;
    // the plan at a glance: the fields read from the brief (exact values), falling back to the keyword scan
    const PLAN_ROWS = [['What changes', 'change'], ['Who it’s for', 'audience'], ['When', 'when'], ['Budget', 'budget'], ['Owner', 'owner'], ['How we measure it', (b) => b.metric && `${b.metric}${b.target ? `: ${b.target}` : ''}${b.window ? `, read on day ${b.window}` : ''}`], ['Stop rule', 'guard']];
    const spec = d.plan ? PLAN_ROWS.map(([label, k]) => ({ label, value: String((typeof k === 'function' ? k(bp) : bp[k]) || '').replace(/^what changes:\s*/i, '').replace(/^(owner|when|budget):\s*(open\.?\s*)?(to be named\.?)?$/i, '').trim() })) : (d.spec || []), gaps = spec.filter((x) => !x.value).length, sent = !!w?.jamBrief;
    const people = [...new Set(th.filter((m) => m.from !== 'system').map((m) => m.from === 'me' ? 'You' : m.from === 'ai' ? (AGENT[w.agent] || 'AI') : m.who || 'Brew'))];
    return `<header class="jb-head"><span class="jb-kind">${face(w?.agent && w.agent !== 'brew' ? w.agent : 'brew')}${esc(d.kind || 'Brief')}${sent ? ` · ${esc(w.ticket || 'sent')}` : ''}</span><h1>${esc(title)}</h1>
        <p class="jb-who">${people.map(esc).join(', ')} · ${said} message${said > 1 ? 's' : ''}${gaps ? ` · <b>${gaps} to settle</b>` : ' · <b class="ok">ready to send</b>'}</p></header>
      <div class="jb-grid">
        ${!isCustomer ? `<section class="jb-pv-wrap jb-decide"><small class="jb-label">${ic('hand', 's14')}What this decides</small><div class="jb-dec"><b>${esc(title)}</b>${bp.why ? `<p class="jb-why"><span>Why</span>${esc(bp.why)}</p>` : ''}${bp.option ? '' : '<p class="jb-none">Nothing is decided yet. The brief fills in as you jam.</p>'}</div></section>`
          : !hook ? `<section class="jb-pv-wrap"><small class="jb-label">${ic('sparkles', 's14')}What customers will see</small><div class="jb-pv jb-empty-pv">${ic('sparkles')}<b>No customer copy yet</b><span>The brief has the plan, not the words. Ask AI to write the headline and text customers will read.</span><button class="jb-ask" data-jb-send="Write the customer-facing copy for this: a headline, the body text and the button. Only what customers will read.">${ic('sparkles', 's14')}Write the copy</button></div></section>`
          : `<section class="jb-pv-wrap"><small class="jb-label">${ic('sparkles', 's14')}What customers will see <em>from the brief</em></small>${preview}${bp.why || bp.change ? `<p class="jb-why"><span>Why</span>${esc(bp.why || bp.change)}</p>` : ''}</section>`}
        <section class="jb-plan"><small class="jb-label">${ic('grid', 's14')}The plan at a glance</small>
          ${spec.filter((x) => x.value).map((x) => `<div class="jb-row"><small>${esc(x.label)}</small><p>${esc(x.value)}</p></div>`).join('') || '<p class="jb-none">Nothing settled yet. It fills in as you jam.</p>'}
          ${gaps ? `<div class="jb-gaps"><small>Still to settle</small><div>${spec.filter((x) => !x.value).map((x) => `<button class="chip" data-jm-fill="${esc(x.label)}" title="Write it yourself">${esc(x.label)}</button>`).join('')}</div>
            <button class="jb-ask" data-jb-send="${esc(`Draft these for the brief: ${spec.filter((x) => !x.value).map((x) => x.label.toLowerCase()).join(', ')}. Use only what we know, and ask me for anything missing.`)}">${ic('sparkles', 's14')}Ask AI to draft ${gaps > 1 ? `these ${gaps}` : 'it'}</button></div>` : ''}
          ${!gaps && !sent ? `<button class="cp-go jb-ship" data-jm-ship>${ic('send', 's16')}Send to the ShopOS team${ic('right', 's16')}</button>` : ''}</section>
      </div>
      <section class="jb-next"><small class="jb-label">${ic('chat', 's14')}Ask next</small><div>${(d.next?.length ? d.next : JB_NEXT[prof] || JB_NEXT.general).filter((x) => !th.some((m) => m.from === 'me' && mdPlain(m.body).toLowerCase() === x.toLowerCase())).map((x) => `<button class="chip" data-jb-send="${esc(x)}">${esc(x)}</button>`).join('')}</div></section>`;
  };
  /* where the card is now. The left side always leads with this; what came before folds into "How we got here". */
  const PHASE = { fresh: 'Card', decided: 'Decided', jamming: 'In the jam', ready: 'Ready', shared: 'Brief shared', done: 'Done' };
  const phaseOf = (p, w, c) => { const st = w?.stage;
    if (st === 'shared') return 'shared'; if (st === 'ready') return 'ready';
    if (['team', 'needs_you'].includes(st) || (!window.BREW_DEMO && (w?.people || []).length > 1 && st === 'drafting')) return 'jamming';
    if (!w && c?.done && p.kind !== 'conflict') return 'done';
    if (S.decided?.[p.id] || w?.decided) return 'decided';
    return st === 'drafting' && (w.thread || []).some((m) => m.from === 'me') ? 'jamming' : 'fresh'; };
  const PAST = ['shared', 'done'];
  const stepperHtml = (w) => { const si = STEPS.findIndex(([k]) => k === stepOf(w.stage));
    return `<div class="stepper cp-steps">${STEPS.map(([k, n], i) => `<span class="${i < si ? 'done' : i === si ? 'on' : ''}">${i < si ? ic('check', 's14') : ''}${n}</span>`).join('')}</div>`; };
  // the plan as the brief states it right now: who, when, budget, owner
  const planRows = (w) => { const b = w?.doc?.plan; if (!b) return ''; const rows = [['Who', b.audience], ['When', b.when], ['Budget', b.budget], ['Owner', b.owner], ['Target', b.target && `${b.target}${b.window ? `, read on day ${b.window}` : ''}`]].filter(([, v]) => v);
    return rows.length ? `<dl class="cp-plan">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}<p>${ic('copy', 's14')}From your brief, updates as it changes</p></dl>` : ''; };
  const nowHtml = (ph, p, c, w, pg, m, ch) => {
    if (ph === 'fresh') return '';
    const dec = S.decided?.[p.id] || w?.decided, chosen = pg?.options.find((o) => o.id === dec), d = w?.deploy, v = w ? curV(w) : null;
    const last = (w?.thread || []).filter((x) => x.from !== 'system' && x.from !== 'me').slice(-1)[0];
    const band = (kind, k, title, line, body = '', acts = '') => `<section class="cp-now is-${kind}" id="cp-now">
        <div class="cp-now-k">${ic(kind === 'shared' ? 'copy' : kind === 'jamming' ? 'hand' : kind === 'ready' ? 'zap' : 'check', 's14')}<span>${esc(k)}</span>${w?.ticket ? `<em>${esc(w.ticket)}</em>` : ''}${w ? (() => { const tot = Math.max(w.current, ...w.versions.map((x) => x.n || 0)); return `<em>v${w.current}${tot > 1 ? ` of ${tot}` : ''}</em>`; })() : ''}</div>
        <h2>${esc(title)}</h2>${line ? `<p class="cp-now-l">${line}</p>` : ''}${body}
        ${w ? stepperHtml(w) : ''}${acts ? `<div class="cp-now-acts">${acts}</div>` : ''}</section>`;
    if (ph === 'done') return band('done', 'Done', c.done, 'Ran from this card. Jam in the brief to take it further.');
    if (ph === 'decided') {
      // the card's one-tap action carries out Brew's pick; another path goes through the brief
      const cta = (chosen?.pick || !chosen) && c.cta?.label && !p._work && FEED.some((x) => x.id === p.id) && !c.done ? `<div class="cp-cta is-in" data-cp-cta data-post="${FEED.findIndex((x) => x.id === p.id)}">${barHtml(c.cta, null)}</div>` : '';
      return band('decided', w && w.stage === 'drafting' ? 'Decided · drafting' : 'Your call', chosen ? chosen.name : 'You picked a path', (w?.doc?.plan?.change || chosen?.effect) ? `<b>What changes:</b> ${esc(w?.doc?.plan?.change || chosen.effect)}` : '', cta + planRows(w),
        `${!cta && !w?.jamBrief ? `<button class="btn btn-primary sm" data-cp-ship>${ic('copy', 's14')}Share the brief</button>` : ''}<button class="linkbtn" data-cp-undo>Change my pick</button><span class="cp-now-hint">${ic('hand', 's14')}${cta ? 'Run it now, or jam on it first' : 'The brief already says this path'}</span>`);
    }
    if (ph === 'jamming') {
      const st = w.stage;
      const title = st === 'drafting' ? 'Shaping the brief' : st === 'needs_you' ? `v${w.current} needs your yes` : st === 'team' ? `With ${w.with?.name || 'your team'}${w.with?.channel ? ` in ${w.with.channel}` : ''}` : `Shaping the brief`;
      const auto = last && /usually (replies|back)/i.test(last.body || ''), line = last && !auto ? `<b>${esc(last.who || (last.from === 'ai' ? AGENT[w.agent] : 'Brew'))}:</b> ${esc(String(last.body).slice(0, 220))}` : st === 'brew' ? 'Usually back in 12 to 24 hours. Add anything in the chat.' : '';
      return band('jamming', STAGE[st], title, line, planRows(w), st === 'needs_you' ? `<button class="btn btn-primary sm" data-approve>${ic('check', 's14')}Approve v${w.current}</button>` : '');
    }
    if (ph === 'ready') return band('ready', 'Ready to share', `v${w.current} is approved`, chosen ? `Going with <b>${esc(chosen.name)}</b>. Share the brief from the jam.` : 'Share the brief from the jam.', planRows(w));
    if (ph === 'shared') return band('shared', 'Brief shared', w.ticket ? `Brief ${w.ticket}` : 'The brief is out', `Shared with ${w.jamBrief?.to === 'team' ? 'your team' : 'the ShopOS team'}${w.jamBrief?.sharedAt ? ` ${esc(ago(w.jamBrief.sharedAt))}` : ''}. The jam ends here.`, planRows(w), `<button class="btn btn-ghost sm" data-cp-ship>${ic('copy', 's14')}Copy it again</button>`);
    return '';
  };
  // the trail: the path we chose, the others, why, and when each step happened
  const howHtml = (p, w, pg) => {
    const dec = S.decided?.[p.id] || w?.decided, L = 'ABCD', chosen = pg?.options.find((o) => o.id === dec);
    const hist = (w?.history || []).map(([st, at]) => `<li><b>${esc(STAGE[st] || st)}</b><small>${esc(ago(at))}</small></li>`).join('');
    return `<details class="cp-how"><summary>${ic('clock', 's16')}<span><small>How we got here</small><b>${chosen ? `Went with ${esc(chosen.name)}` : 'The options and the steps so far'}</b></span>${ic('down', 's16')}</summary>
      <div class="cp-how-b">${pg ? pg.options.map((o, i) => `<div class="cp-how-o${o.id === dec ? ' is-chosen' : ''}"><span class="cp-n">${o.id === dec ? ic('check', 's14') : L[i]}</span><div><b>${esc(o.name)}</b>${o.id === dec ? '<em class="cp-tag ok">Chosen</em>' : o.pick ? `<em class="cp-tag pick">Brew pick</em>` : ''}<p>${esc(o.effect || o.says || '')}</p></div></div>`).join('') : ''}
        ${pg?.reason ? `<p class="cp-how-why"><b>Why Brew picked it:</b> ${esc(pg.reason)}</p>` : ''}
        ${hist ? `<ol class="cp-how-t">${hist}</ol>` : ''}
        ${pg?.moves?.length ? `<p class="cp-how-mv">${ic('link', 's14')}Backed by ${pg.moves.map((x) => `${mvLabel(x.n)}`).join(', ')}</p>` : ''}</div></details>`;
  };
  // the card's own buttons on its page: remix it in the studio, save it, jam on it
  const cpActs = (p, ch) => { const canRemix = false, saved = S.saved.includes(p.id);
    const liked = !!S.hearts[p.id], canLike = !/^(work:|jam-)/.test(String(p.id)) && !!byId(p.id);
    return `<div class="cp-acts">${canLike ? `<button class="cp-act is-like" data-cp-heart aria-pressed="${liked}" aria-label="More like this">${ic('heart', 's16')}<span>${liked ? 'Liked' : 'Like'}</span></button>` : ''}${canRemix ? `<button class="cp-act" data-cp-remix>${ic('shuffle', 's16')}<span>${ch ? `Open in studio · v${curN(ch)}` : 'Remix in studio'}</span></button>` : ''}
      <button class="cp-act" data-cp-save aria-pressed="${saved}">${ic('bookmark', 's16')}<span>${saved ? 'Saved' : 'Save'}</span></button>
      <button class="cp-act" data-cp-jam>${ic('hand', 's16')}<span>Jam on it</span></button></div>`; };
  // lessons about the person read as their own preferences, in "you" voice: never "this person …", never "judged"
  const VERB = { wants: 'want', prefers: 'prefer', likes: 'like', needs: 'need', goes: 'go', takes: 'take', tends: 'tend', values: 'value', expects: 'expect', asks: 'ask', chooses: 'choose', picks: 'pick', reads: 'read', approves: 'approve', avoids: 'avoid', trusts: 'trust', cares: 'care', leans: 'lean', favours: 'favour', favors: 'favor', wants: 'want', checks: 'check', skips: 'skip', sends: 'send', keeps: 'keep', ships: 'ship', launches: 'launch', pushes: 'push', has: 'have', is: 'are', does: 'do', reviews: 'review', decides: 'decide', moves: 'move', looks: 'look', likes: 'like' };
  const youVoice = (t) => { let s = String(t || '').trim();
    s = s.replace(/^(this|the) (person|user|viewer|founder|customer)(’s|'s)\s+/i, 'Your ').replace(/^(this|the) (person|user|viewer|founder)\s+/i, 'You ').replace(/^(usually|often|always|rarely|never)\s+(\w+)/i, (m, a, v) => `You ${a.toLowerCase()} ${VERB[v.toLowerCase()] || v}`);
    s = s.replace(/^You (usually |often |always |rarely |never |mostly |tends to )?(\w+)/, (m, adv, v) => `You ${adv || ''}${VERB[v.toLowerCase()] || v}`);
    if (!/^(You|Your)\b/.test(s) && /^(wants|prefers|likes|needs|goes|takes|values|expects|avoids|trusts|leans|favou?rs)\b/i.test(s)) s = s.replace(/^(\w+)/, (v) => `You ${VERB[v.toLowerCase()] || v}`);
    return s.replace(/\bthis person(’s|'s)\b/gi, 'your').replace(/\bthis person\b/gi, 'you').replace(/\bbe judged\b/gi, 'be checked').replace(/\bjudging\b/gi, 'checking').replace(/\bjudged\b/gi, 'checked').replace(/\bjudge\b/gi, 'check'); };
  // what Brew also weighed for its pick, grouped: the team's rules, what worked before, and you
  const WEIGH = [['brand', 'Your team’s rules', 'book'], ['result', 'What worked before', 'trendup'], ['you', 'How you like to work', 'person']];
  const weighedHtml = (xs) => { if (!xs?.length) return '';
    const groups = WEIGH.map(([k, label, icon]) => [label, icon, xs.filter((x) => (x.k === 'seat' ? 'you' : x.k) === k)]).filter(([, , g]) => g.length);
    return `<div class="cp-weighed"><small>Also weighed</small><div class="cp-wg">${groups.map(([label, icon, g]) => `<section><h5>${ic(icon, 's14')}${esc(label)}</h5><ul>${g.map((x) => `<li>${x.value ? `<span>${esc(x.text)}</span><b class="${x.win ? 'is-up' : 'is-flat'}">${esc(x.value)}</b>` : `<span>${esc(x.k === 'you' || x.k === 'seat' ? youVoice(x.text) : x.text)}${x.n > 1 ? ` <em>×${x.n}</em>` : ''}</span>`}</li>`).join('')}</ul></section>`).join('')}</div></div>`; };
  // a "three more" card: the versions are the card. Full-width tiles you pick from, then "Go with B" writes it into the brief
  const VL = ['A', 'B', 'C', 'D'];
  const varPicker = (p, c) => { const vs = c.variants || [], sel = S.varPick?.[p.id];
    if (c.loading || !vs.length) return `<div class="vp"><div class="vp-grid">${'<div class="vp-t is-sk"><div class="sk" style="height:120px"></div></div>'.repeat(3)}</div></div>`;
    return `<div class="vp" data-vp="${esc(p.id)}"><div class="vp-grid">${vs.map((v, i) => `<button class="vp-t${sel === i ? ' is-on' : ''}" data-vpi="${i}" aria-pressed="${sel === i}" style="--d:${i * 60}ms">
        <span class="vp-top"><i class="vp-l">${sel === i ? ic('check', 's14') : VL[i]}</i><em>${esc(v.angle || 'Version')}</em></span>
        <b>${esc(plain(v.title))}</b><span class="vp-s">${esc(plain(v.sub))}</span></button>`).join('')}</div>
      <div class="vp-f">${sel == null ? `<span class="vp-hint">${ic('hand', 's14')}Tap a version to pick it</span>` : `<span class="vp-hint is-on">Version ${VL[sel]} · ${esc(vs[sel].angle || '')}</span><button class="vp-go" data-vpgo>${ic('check', 's14')}Go with ${VL[sel]}</button>`}</div></div>`; };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-vpi]'); if (t && DP) { const id = t.closest('[data-vp]').dataset.vp, i = +t.dataset.vpi; S.varPick = { ...(S.varPick || {}), [id]: S.varPick?.[id] === i ? undefined : i }; save(); sound('select'); return repaintDetail(true); }
    if (e.target.closest('[data-vpgo]') && DP) { const c = cardOf(DP.p), i = S.varPick?.[DP.p.id], v = c.variants?.[i]; if (!v) return;
      window.JamRoom?.addToBrief?.(`We go with version ${VL[i]} (${v.angle || 'version'}): ${plain(v.title)}. ${plain(v.sub)}`); sound('approve');
      if (typeof setSheet === 'function' && innerWidth <= 760) setSheet(true); toast(`${ic('check', 's16')}Version ${VL[i]} is in the brief`); }
  });
  /* ---------- the split jam ----------
     A fresh card stays a feed card: the made thing big, the ways to play it as visual tiles, one Jam button.
     Once someone jams, the left side is only the canvas (canvas.js): the thing being made, changing as you jam. */
  const CV_H = () => ({ esc, ic, face, slotHtml, B, AGENT, ago });
  const jamOn = (p, w) => !!(S.jamOn?.[p.id] || S.decided?.[p.id] || (w && ((w.thread || []).some((x) => x.from === 'me') || w.decided || w.stage !== 'drafting' || (w.drafts || []).length)));
  const splitJamHtml = (p, c, w, ch, m) => {
    loadPage(p); /* the jam chat names the card's other ways as a quiet hint */
    const ph = phaseOf(p, w, c), pg = PAGE[p.id] || localPage(c);
    return `${ph === 'shared' ? nowHtml(ph, p, c, w, pg, m, ch) : ''}${window.Canvas.html(p, c, w, ch, CV_H())}`;
  };
  const splitFreshHtml = (p, c, w, ch) => {
    loadPage(p);
    const pg = PAGE[p.id] || (PAGE[p.id] === false || String(p.id).startsWith('work:') ? localPage(c) : null), L = 'ABCD', ag = c.agent || 'brew';
    const pick = pg?.options.find((o) => o.pick), openId = DP.openOpt?.[p.id] || pick?.id, cur = pg?.options.find((o) => o.id === openId) || pg?.options[0];
    const own = ['media', 'answer', 'conflict'].includes(c.kind);
    const big = c.kind === 'variants' ? varPicker(p, c) : own ? `<div class="cpf-visual">${slotHtml(c)}</div>` : c.images?.length ? `<div class="cpf-visual">${mediaSlot(c.images, { alt: c.title })}</div>` : window.Canvas.hasStill(p, c, w, ch, CV_H()) ? `<div class="cpf-visual is-canvas">${window.Canvas.thumb(p, c, w, ch, CV_H(), cur)}</div>` : '';
    const sameRows = /is-canvas/.test(big) && window.Canvas.blocksFor?.(c, w, ch)?.[0] === 'change'; /* the change table already shows these numbers */
    const stats = c.rows?.length && !sameRows ? `<div class="cp-stats">${c.rows.slice(0, 4).map(([k, v], i) => `<div class="cp-stat${String(v).length > 22 ? ' is-long' : ''}" style="--d:${120 + i * 50}ms"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>` : '';
    const liked = !!S.hearts[p.id], saved = S.saved.includes(p.id), canLike = !/^(work:|jam-)/.test(String(p.id)) && !!byId(p.id), i0 = pg ? pg.options.indexOf(cur) : -1;
    return `<article class="cpf ag-${esc(ag)}">
        <header class="cpf-h"><div class="cp-meta">${face(ag)}<span>${esc(fromLabel(c))}</span>${c.type ? `<em>${esc(KIND[c.type] || c.type)}</em>` : ''}</div>
          <span class="cpf-icons">${canLike ? `<button class="icon-btn" data-cp-heart aria-pressed="${liked}" aria-label="${liked ? 'Liked' : 'More like this'}">${ic('heart', 's18')}</button>` : ''}<button class="icon-btn" data-cp-save aria-pressed="${saved}" aria-label="${saved ? 'Saved' : 'Save'}">${ic('bookmark', 's18')}</button></span></header>
        ${big}
        <h1 class="cp-t">${esc(c.title)}</h1><p class="cp-s">${esc(c.sub)}</p>${makeChip(c)}${stats}
        <div class="cpf-go"><button class="btn btn-primary cpf-jam" data-cp-jamgo>${ic('hand', 's16')}Jam on it</button>
          ${c.cta?.label && !c.done ? `<button class="linkbtn cpf-doit" data-cp-doit>${esc(c.cta.label)} ${ic('right', 's14')}</button>` : ''}</div>
      </article>`;
  };
  const cardPageHtml = (p, c, w, ch, m) => {
    if (String(p.id).startsWith('jam-')) return jamBoardHtml(p, c, w);
    if (window.Canvas) return jamOn(p, w) ? splitJamHtml(p, c, w, ch, m) : splitFreshHtml(p, c, w, ch);
    loadPage(p);
    const pg = PAGE[p.id] || (PAGE[p.id] === false || String(p.id).startsWith('work:') || String(p.id).startsWith('jam-') ? localPage(c) : null);
    const dec = S.decided?.[p.id] || w?.decided, pick = pg?.options.find((o) => o.pick), ag = c.agent || 'brew', ph = phaseOf(p, w, c), past = PAST.includes(ph);
    const visual = c.kind === 'media' || c.kind === 'answer' ? `<div class="cp-visual">${slotHtml(c)}</div>` : '';
    const stats = c.rows?.length ? `<div class="cp-stats">${c.rows.slice(0, visual ? 3 : 4).map(([k, v], i) => `<div class="cp-stat${String(v).length > 22 ? ' is-long' : ''}" style="--d:${120 + i * 50}ms"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>` : '';
    const L = 'ABCD', openId = DP.openOpt?.[p.id] || dec || pick?.id, cur = pg?.options.find((o) => o.id === openId) || pg?.options[0];
    // the brief is the source of truth: its target, read day, metric and stop rule win over the card's defaults
    const bp = w?.doc?.plan || null, fromBrief = (k) => bp?.[k] && String(bp[k]).trim();
    // the brief's target for this metric is THE target on the page: the measure track, the goal line and the header all read it
    const mB = m && bp?.target && (!fromBrief('metric') || metricFam(bp.metric) === metricFam(m.metric)) ? { ...m, targetLabel: String(bp.target).trim(), window: fromBrief('window') ? bp.window : m.window } : m;
    const om0 = cur?.measure, onPlan = !dec || dec === cur?.id;
    // the brief describes the chosen path (else the Brew pick): its measure design shows on that path's tile only
    const briefOpt = dec || pg?.options?.find((o) => o.pick)?.id || pg?.options?.[0]?.id, ms = w?.doc?.measure?.blocks?.length && (!cur || cur.id === briefOpt) ? w.doc.measure : null;
    const om = om0 && onPlan && bp ? { ...om0, ...(fromBrief('target') ? { target: bp.target } : {}), ...(fromBrief('window') ? { window: bp.window } : {}), ...(fromBrief('guard') ? { guard: bp.guard } : {}), ...(fromBrief('metric') ? { metric: bp.metric } : {}), brief: ['target', 'window', 'guard', 'metric'].some(fromBrief) } : om0;
    const tile = (o, i) => { const chosen = dec === o.id, on = o.id === cur?.id;
      return `<button class="cp-tile${on ? ' is-on' : ''}${chosen ? ' is-chosen' : ''}${o.pick ? ' is-pick' : ''}${dec && !chosen ? ' is-dim' : ''}" role="tab" aria-selected="${on}" data-cp-open="${esc(o.id)}" style="--d:${160 + i * 60}ms">
        <span class="cp-n">${chosen ? ic('check', 's14') : L[i]}</span><b>${esc(o.name)}</b>
        ${chosen ? '<em class="cp-tag ok">Going with this</em>' : o.pick ? `<em class="cp-tag pick">${ic('sparkles', 's14')}Brew pick${pg.reason ? `<span class="cp-why" role="tooltip"><b>Why Brew suggests this</b>${esc(pg.reason)}${o.moves?.length ? `<small>Backed by ${o.moves.length === 1 ? 'Move' : 'Moves'} ${o.moves.map((n) => esc(mv2(n))).join(', ')}</small>` : ''}</span>` : ''}</em>` : '<em class="cp-tag"></em>'}</button>`; };
    const panel = (o) => { const i = pg.options.indexOf(o), chosen = dec === o.id;
      return `<div class="cp-panel${chosen ? ' is-chosen' : o.pick ? ' is-pick' : ''}" role="tabpanel" style="--x:${(i + .5) / pg.options.length}">
        <p class="cp-says">${esc(o.says || o.name)}</p>
        ${o.effect ? `<div class="cp-eff">${ic('zap', 's16')}<div><small>What changes</small><p>${esc(o.effect)}</p></div></div>` : ''}
        <footer>${o.moves?.length ? `<span class="cp-backs"><small>Backed by</small>${o.moves.map((n) => `<button class="cp-mv" data-cp-mv="${n}">Move ${mv2(n)}</button>`).join('')}</span>` : '<span></span>'}
          ${chosen ? `<span class="cp-done">${ic('check', 's16')}Your pick<button class="linkbtn" data-cp-undo>Change</button></span>` : `<button class="cp-go" data-cp-go="${esc(o.id)}">Go with ${L[i]}${ic('right', 's16')}</button>`}</footer></div>`; };
    const mvCard = (x, i) => `<article class="cp-move" id="cp-mv-${x.n}" style="--d:${i * 50}ms">
        <header><span class="cp-move-n">${mv2(x.n)}</span><h4>${esc(x.title)}</h4></header>
        ${x.number ? `<p class="cp-move-num">${esc(x.number)}</p>` : ''}
        <p class="cp-move-s">${esc(x.says || x.plain)}</p>
        ${x.points?.length ? `<details class="cp-pts"><summary>${x.points.length === 1 ? 'Key detail' : `${x.points.length} key details`}</summary><ul>${x.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}</article>`;
    const mFmt = (v) => /^(₹|\$|£|€|[ACS]\$)$/.test(m.unit || '') ? m.unit + Math.round(v) : m.unit === '%' ? (+v).toFixed(1) + '%' : v;
    return `${nowHtml(ph, p, c, w, pg, m, ch)}${ph !== 'fresh' ? '<small class="cp-k-card">The card</small>' : ''}<header class="cp-hero ag-${esc(ag)}${visual ? ' has-visual' : ''}${ph !== 'fresh' ? ' is-recap' : ''}">
        <div class="cp-hero-main">
          <div class="cp-meta">${face(ag)}<span>${esc(fromLabel(c))}</span>${c.type ? `<em>${esc(KIND[c.type] || c.type)}</em>` : ''}${SECTOR[c.sector] ? `<em>${esc(SECTOR[c.sector])}</em>` : ''}</div>
          <h1 class="cp-t">${esc(c.title)}</h1><p class="cp-s">${esc(c.sub)}</p>${makeChip(c)}
          ${stats}${c.kind === 'variants' ? varPicker(p, c) : ''}
        </div>${visual}
        ${!past && pg?.lead && pg.lead !== c.sub ? `<p class="cp-lead"><span>${ic('sparkles', 's14')}The call</span>${esc(pg.lead)}</p>` : ''}</header>
      <div class="cp-do">${(ph === 'fresh' || (ph === 'jamming' && w?.stage === 'drafting')) && c.cta?.label && !p._work && FEED.some((x) => x.id === p.id) ? `<div class="cp-cta" data-cp-cta data-post="${FEED.findIndex((x) => x.id === p.id)}"><span class="cp-cta-k">${ic('zap', 's14')}${c.done ? 'Done' : 'The action this card recommends'}</span>${barHtml(c.cta, c.done)}</div>` : ''}${cpActs(p, ch)}</div>
      ${p.sector === 'visibility' && aiStand() ? `<section class="cp-sec ais"><h2>Where you stand in AI answers</h2>${aisHtml(aiStand())}</section>` : ''}${past ? howHtml(p, w, pg) : pg && c.kind !== 'variants' ? `<section class="cp-sec cp-pick-sec"><h2>${dec ? 'Your call' : 'Pick your path'}<small>${dec ? 'it’s in the brief' : `${pg.options.length} ways to play it`}</small></h2>
          <div class="cp-tiles" role="tablist" style="--n:${pg.options.length}">${pg.options.map(tile).join('')}</div>${cur ? panel(cur) : ''}</section>
        ${pick && pg.reason && ['fresh', 'decided'].includes(ph) ? `<section class="cp-rec">${face(ag)}<div><small>Why Brew picks ${L[pg.options.indexOf(pick)]}</small><p>${esc(pg.reason)}</p>
          ${pg.follows?.length ? `<ol class="cp-follows" aria-label="What follows"><li class="cp-follows-k">Then</li>${pg.follows.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
          ${c.needs ? `<p class="cp-needs">${ic('person', 's14')}Needs ${esc(c.needs)} before anything ships.</p>` : ''}
          ${weighedHtml(LEARNED[p.id])}</div></section>` : ''}
        ${pg.moves?.length ? `<section class="cp-sec"><h2>Backed by ${pg.moves.length} move${pg.moves.length > 1 ? 's' : ''}<small>the plans Brew wrote for ${B.brand.name}</small></h2><div class="cp-moves">${pg.moves.map(mvCard).join('')}</div></section>` : ''}`
      : c.kind === 'variants' ? '' : `<section class="cp-sec"><h2>Pick your path</h2><div class="cp-tiles" style="--n:3">${[0, 1, 2].map(() => '<div class="sk" style="height:92px;border-radius:18px"></div>').join('')}</div></section>`}
      ${c.detail?.watch || m || om || ms || c.know ? `<div class="cp-duo">${c.detail?.watch && !past ? `<p class="cp-watch">${ic('eyeoff', 's16')}<span><b>Watch out</b>${esc(c.detail.watch)}</span></p>` : ''}
        ${ms ? `<details class="cp-measure is-spec"${DP.mOpen ? ' open' : ''}><summary><i class="cp-m-ic">${ic('trendup', 's16')}</i><span><small>How we measure it</small><b>${esc(ms.metric)}</b></span><em class="cp-m-goal">${esc(ms.summary || 'Set with you')}<small>${ms.how === 'ai' ? 'designed from your brief' : 'from your brief'}</small></em>${ic('down', 's16')}</summary>${cpSpec(ms, mB, w, mFmt)}</details>`
          : past && m ? `<details class="cp-measure"${DP.mOpen ? ' open' : ''}><summary><i class="cp-m-ic">${ic('trendup', 's16')}</i><span><small>How we measure it</small><b>${esc(m.metric)}</b></span><em class="cp-m-goal">${bp?.target ? esc(bp.target) : esc(mFmt(m.target))}<small>${bp?.target ? 'from your brief · ' : ''}in ${esc(bp?.window || m.window)} days</small></em>${ic('down', 's16')}</summary>${cpMeasure(mB, w, mFmt)}</details>`
          : om ? `<details class="cp-measure is-opt"${DP.mOpen ? ' open' : ''}><summary><i class="cp-m-ic">${ic('trendup', 's16')}</i><span><small>${dec === cur.id ? 'How we measure it' : `How we’d measure ${L[pg.options.indexOf(cur)]}`}</small><b>${esc(om.metric)}</b></span><em class="cp-m-goal">${om.target ? esc(om.target) : 'Set with you'}<small>${om.brief ? 'from your brief · ' : ''}day ${esc(om.window)}</small></em>${ic('down', 's16')}</summary>${cpOptMeasure(om, mB, w, mFmt)}</details>`
          : m ? `<details class="cp-measure"${DP.mOpen ? ' open' : ''}><summary><i class="cp-m-ic">${ic('trendup', 's16')}</i><span><small>How we measure it</small><b>${esc(m.metric)}</b></span><em class="cp-m-goal">${bp?.target ? esc(bp.target) : esc(mFmt(m.target))}<small>${bp?.target ? 'from your brief · ' : ''}in ${esc(bp?.window || m.window)} days</small></em>${ic('down', 's16')}</summary>${cpMeasure(mB, w, mFmt)}</details>` : ''}</div>` : ''}
      ${p._work || ph !== 'fresh' ? '' : rankHtml(p.id)}
      ${(() => { const src = []; if (c.link) src.push(`<a class="cp-src" href="${esc(c.link.url)}" target="_blank" rel="noopener">${ic('link', 's14')}${esc(c.link.label)}${ic('right', 's14')}</a>`); if (c.src && !/^moves?\s+\d/i.test(c.src)) src.push(`<span class="cp-src is-plain">${esc(c.src)}</span>`); if (c.liveFrom) src.push(`<span class="cp-src is-live"><i class="pulse"></i>Live from ${esc(B.connectors[c.liveFrom].name)}</span>`); return src.length ? `<footer class="cp-srcs"><small>Sources</small>${src.join('')}</footer>` : ''; })()}`;
  };
  // going with an option: remembered on the card, and written into the brief so the jam starts from it
  // the pick lives on the server, so other devices and shared links see it too
  const pushDecided = (cid, id) => { if (/^(work:|jam-)/.test(String(cid))) return; tapi('POST', `/api/cards/${encodeURIComponent(cid)}/decided`, { id: id || null }).then((r) => { if (r.error) { toast(esc(r.error === 'already shipped' ? 'It’s already live. Make the next version instead.' : r.error)); } }); };
  const goWith = async (p, id) => {
    const pg = PAGE[p.id] || localPage(cardOf(p)), o = pg.options.find((x) => x.id === id); if (!o) return;
    S.decided = { ...(S.decided || {}), [p.id]: id }; save(); repaintDetail(); pushDecided(p.id, id);
    const i = FEED.findIndex((x) => x.id === p.id), el = $(`.card[data-id="${p.id}"]`); if (el && i >= 0) el.outerHTML = postCard(FEED[i], i);
    burstAt($(`.cp-tile.is-chosen .cp-n`));
    // no jam yet: the card's brief simply redraws around the choice. A jam in progress gets it written in.
    const wk = DP.w || workOfCard(p.id);
    if (!wk) { window.JamRoom?.paint?.(); return; }
    await tapi('POST', `/api/work/${wk.id}/decided`, { id });
    window.JamRoom?.addToBrief?.(`We go with: ${o.name}. ${o.says || ''} What changes: ${o.effect || ''}${o.measure ? ` How we measure it: ${o.measure.metric}${o.measure.where ? ` on ${o.measure.where}` : ''}, ${o.measure.target || 'target set before go-live'}, read on day ${o.measure.window}.${o.measure.guard ? ` Stop rule: ${o.measure.guard}` : ''}` : ''}`.trim(), 'Your options');
  };
  const burstAt = (el) => { if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return; const r = el.getBoundingClientRect(), box = document.createElement('div'); box.className = 'cp-burst'; box.style.left = r.left + r.width / 2 + 'px'; box.style.top = r.top + r.height / 2 + 'px';
    for (let i = 0; i < 12; i++) { const s = document.createElement('i'), a = (Math.PI * 2 * i) / 12; s.style.setProperty('--dx', Math.cos(a) * 34 + 'px'); s.style.setProperty('--dy', Math.sin(a) * 34 + 'px'); box.appendChild(s); }
    document.body.appendChild(box); setTimeout(() => box.remove(), 700); };
  /* the jam plan: goal, the change, open questions with owners, readiness. It ends with Share the brief. */
  /* a question a person owns goes to a real teammate (the demo site keeps its simulated ones) */
  const REALQ = !window.BREW_DEMO;
  const ownerName = (o, w, q) => o === 'ai' ? AGENT[w.agent] || 'AI' : o === 'brew' ? 'ShopOS team' : REALQ ? (q?.waiting || 'someone') : colleague(o).name;
  const ownerChip = (o, w, q) => o === 'ai' ? face(w.agent || 'creative') : o === 'brew' ? `<span class="av pod-av">B</span>` : REALQ ? (q?.ownerEmail ? pAv({ email: q.ownerEmail, name: q.waiting, pic: (window.LIVE?.access?.team || []).find((x) => x.email === q.ownerEmail)?.pic }, 20) : `<span class="av" style="width:20px;height:20px;border-radius:50%">${ic('person', 's12')}</span>`) : avatar(colleague(o), 20);
  const askPick = (q) => { const me = String(ME()?.email || '').toLowerCase(), ppl = (window.LIVE?.access?.team || []).filter((x) => x.email !== me);
    return ppl.length ? `<select class="jq-who" data-jq-person="${q.id}" aria-label="Who to ask"><option value="">Ask someone…</option>${ppl.map((x) => `<option value="${esc(x.email)}">${esc(x.name || x.email)}</option>`).join('')}</select>` : `<small>Invite your team to ask them</small>`; };
  const qBy = (by = '') => by === 'you' ? 'You' : by.startsWith('ai:') ? AGENT[by.slice(3)] || 'AI' : by.startsWith('teammate:') ? by.slice(9) : by === 'brew' ? 'ShopOS team' : by === 'learned' ? 'Learned check' : by === 'earlier' ? 'Earlier' : by;
  document.addEventListener('change', async (e) => { const sel = e.target.closest?.('[data-jq-person]'); if (!sel || !sel.value || !DP?.w) return; sel.disabled = true;
    const r = await tapi('POST', `/api/work/${DP.w.id}/plan/ask`, { qid: sel.dataset.jqPerson, email: sel.value }); if (r.error) { sel.disabled = false; return toast(esc(r.error)); }
    putWork(r.work); repaintDetail(); toast(`${ic('send', 's16')}Asked. ${esc(sel.selectedOptions[0]?.textContent || 'They')} will get an email.`); });
  // when the jam changes something on the left (a plan row, the Now band, an option, the measure, the draft preview),
  // that piece glows softly for a moment so you see what moved. Compared block by block, before and after the repaint
  const LEFT_BLOCKS = ['.cp-now-k', '.cp-now h2', '.cp-now-l', '.cp-plan > div', '.stepper', '.cp-t', '.cp-s', '.cp-lead', '.cp-stat', '.cp-tile', '.cp-panel > *', '.cp-rec p', '.cp-follows', '.cp-move', '.cp-measure > summary', '.cp-m-pt', '.cp-m-guard', '.rp-stats > div', '.jb-head', '.jb-pv', '.jb-row', '.jb-plan > *', '.jb-gaps', '.jb-next', '.cp-how-o'];
  const snapLeft = (dp) => { const m = new Map(), b = $('.dr-b', dp); if (!b) return m;
    LEFT_BLOCKS.forEach((sel) => $$(sel, b).forEach((el, i) => m.set(`${sel}#${el.dataset.cpOpen || $('dt', el)?.textContent || i}`, el.textContent.replace(/\s+/g, ' ').trim()))); return m; };
  const flashLeft = (dp, before) => { const b = $('.dr-b', dp); if (!b) return; let n = 0;
    LEFT_BLOCKS.forEach((sel) => $$(sel, b).forEach((el, i) => { const k = `${sel}#${el.dataset.cpOpen || $('dt', el)?.textContent || i}`, t = el.textContent.replace(/\s+/g, ' ').trim();
      if (before.has(k) ? before.get(k) !== t : before.size && t && !el.closest('.cp-tiles, .cp-moves')) { if (n++ > 12) return; el.classList.remove('is-changed'); void el.offsetWidth; el.classList.add('is-changed'); setTimeout(() => el.classList.remove('is-changed'), 2600); } })); };
  // phones: Brief / Chat is a bottom sheet (like Instagram comments), a bar at the bottom that opens to most of the screen,
  // instead of a second scroll box under the whole page. It stays open across repaints and opens itself when anything jumps to the chat
  const PHONE = () => innerWidth <= 900;
  /* the sheet follows the width: a rotated phone or a narrowed window gets it without a repaint */
  matchMedia('(max-width:900px)').addEventListener?.('change', () => { const dp = $('#dp'); if (dp) { dp.classList.toggle('has-sheet', PHONE()); if (!PHONE()) document.body.classList.remove('sheet-open'); } });
  const sheetBtn = (dp) => { const h = $('.dp-side .jm-h', dp); if (h && !$('[data-jmsheet]', h)) h.insertAdjacentHTML('beforeend', `<button class="jm-sheet-t" data-jmsheet aria-label="Open or close the brief">${ic('up', 's16')}</button>`); };
  const jmSheet = (dp) => { const side = $('.dp-side', dp); if (!side) return; sheetBtn(dp);
    // the pane repaints its own header (tab switches, new messages): put the open/close arrow back each time
    if (!dp._sheetMo) { dp._sheetMo = new MutationObserver(() => sheetBtn(dp)); dp._sheetMo.observe(dp, { childList: true, subtree: true }); }
    side.classList.toggle('is-open', !!DP?.sheet); dp.classList.toggle('has-sheet', PHONE()); };
  const setSheet = (on) => { if (!DP) return; if (!!DP.sheet !== on) window.__sound?.(on ? 'sheetUp' : 'sheetDown'); DP.sheet = on; const side = $('#dp .dp-side'); side?.classList.toggle('is-open', on); document.body.classList.toggle('sheet-open', on && PHONE()); };
  document.addEventListener('click', (e) => { if (!PHONE()) return; const h = e.target.closest('#dp .dp-side .jm-h'); if (!h) return;
    if (e.target.closest('[data-jmsheet]')) { e.preventDefault(); return setSheet(!DP?.sheet); }
    if (!DP?.sheet) return setSheet(true);
    if (!e.target.closest('button, a, input, [role="tab"]')) setSheet(false); }, true);
  document.addEventListener('focusin', (e) => { if (PHONE() && e.target.closest?.('#dp .dp-side') && !DP?.sheet) setSheet(true); });
  const repaintDetail = (force) => {
    const dp = $('#dp'); if (!dp || !DP) return;
    if (window.JamRoom?.isEditing?.() && !force) { DP.dirty = true; return; }
    DP.dirty = false;
    const { p } = DP; const w = DP.w = p._work ? WORK.items.find((x) => x.id === p._work.id) || p._work : workOfCard(p.id);
    const c = cardOf(p), d = c.detail || {}, v = w ? curV(w) : null;
    if (w?.decided && S.decided?.[p.id] !== w.decided && !String(p.id).startsWith('work:')) { S.decided = { ...(S.decided || {}), [p.id]: w.decided }; save(); }
    // a jam from the remix studio continues the package: same preview, versions and conversation
    const ch = w?.changeId && DP.ch?.id === w.changeId ? DP.ch : null;
    if (w?.changeId && !ch && DP.loadingCh !== w.changeId) { DP.loadingCh = w.changeId; tapi('GET', `/api/changes/${w.changeId}`).then((r) => { if (r.change && DP && DP.w?.changeId === r.change.id) { DP.ch = r.change; repaintDetail(); } }); }
    const m = w?.measure || c.measure || null;
    const prevScroll = $('.dr-b', dp)?.scrollTop; if ($('.cp-rank', dp)) DP.rankOpen = $('.cp-rank', dp).open;
    dp.dataset.work = w?.id || '';
    const rows = c.kind !== 'rows' && nonZero(c.rows || []).length ? `<div class="inset"><div class="rows">${nonZero(c.rows).map(([k, vv]) => `<div><span>${esc(k)}</span><b>${esc(vv)}</b></div>`).join('')}</div></div>` : '';
    const rel = FEED.filter((x) => x.id !== p.id && !x.parentCardId && (x.lane === p.lane || x.agent === p.agent)).slice(0, 3);
    const st = w?.stage, si = st ? STEPS.findIndex(([k]) => k === stepOf(st)) : -1;
    const stepper = w ? `<div class="stepper">${STEPS.map(([k, n], i) => `<span class="${i < si ? 'done' : i === si ? 'on' : ''}">${i < si ? ic('check', 's14') : ''}${n}</span>`).join('')}</div>
      <div class="stage-line"><span class="badge ${st === 'needs_you' ? 'warn' : st === 'result' ? (w.result?.win ? 'ok' : 'warn') : 'info'}">${STAGE[st]}</span>${w.with ? `<span>with ${esc(w.with.name)}${w.with.channel ? ' in ' + esc(w.with.channel) : ''}</span>` : ''}${w.ticket ? `<span>${esc(w.ticket)}</span>` : ''}<span>v${w.current} of ${w.versions.length}</span></div>` : '';
    const versions = w && w.versions.length > 1 ? `<div class="vers">${w.versions.map((x) => `<button class="${x.n === w.current ? 'on' : ''}" data-ver="${x.n}" title="${esc(x.note || '')}">v${x.n}<small>${esc(x.by === 'you' ? 'You' : x.by === 'ai' ? 'AI' : x.by === 'brew' ? 'Brew' : x.by === 'colleague' ? 'Team' : 'Agent')}</small></button>`).join('')}</div>` : '';
    const preview = v && w.current > 1 ? `<div class="dp-ver">${v.images?.[0] ? `<img src="${v.images[0]}" alt="">` : ''}<div><small>v${v.n} · ${esc(v.note || '')}</small><b>${esc(v.title)}</b><p>${esc(v.sub)}</p></div></div>` : '';
    const footer = (() => {
      const to = DP.to;
      const seg = `<div class="to-seg" role="tablist"><span>To</span><button data-to="ai" aria-selected="${to === 'ai'}">${ic('sparkles', 's14')}AI</button><button data-to="team" aria-selected="${to === 'team'}"># Team</button><button data-to="brew" aria-selected="${to === 'brew'}">${ic('person', 's14')}Brew</button></div>`;
      const ph = to === 'ai' ? 'Tell AI how you want it…' : to === 'team' ? (w?.with?.kind === 'team' ? `Reply to ${w.with.name}…` : 'Add a note for your colleague…') : (w?.with?.kind === 'brew' ? 'Reply to the ShopOS team…' : 'What should Brew do with it?');
      const chips = to === 'ai' && (!st || st === 'drafting') ? `<div class="sugg dp-chips">${(c.images ? ['Make it shorter', 'A Hindi version', 'Try a different angle', 'Cut it for Reels'] : ['Make it simpler', 'Say it for WhatsApp', 'What would this cost?', 'Add a stronger number']).map((x) => `<button class="chip" data-chip="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : '';
      const compose = `${chips}${seg}<form class="compose" id="dp-f"><input id="dp-in" placeholder="${esc(ph)}" autocomplete="off"><button aria-label="Send">${ic('up', 's16')}</button></form>`;
      const two = `<div class="dp-ctas"><button class="btn btn-ghost" data-send="team"><span class="slack-ic sm">#</span>Jam with team</button></div>`;
      if (DP.picking) return `<div class="picker"><b>Send v${w ? w.current : 1} to a colleague</b><div class="sugg">${B.colleagues.map((x) => `<button class="chip" data-col="${x.id}" aria-pressed="${DP.picking === x.id}">@${esc(colleague(x.id).name)}</button>`).join('')}</div>
          <form class="compose" id="dp-pick"><input id="dp-note" placeholder="Note (optional)"><button aria-label="Send">${ic('up', 's16')}</button></form><button class="linkbtn" data-cancel-pick>Cancel</button></div>`;
      const open = w?.plan ? w.plan.questions.filter((q) => !q.answer).length : 0;
      const ready = w?.plan ? (open ? `<button class="btn btn-ghost dp-rfs" disabled>${ic('zap', 's14')}Ready to share · ${open} open</button>` : `<button class="btn btn-primary dp-rfs" data-approve>${ic('zap', 's16')}Ready to share</button>`) : `<button class="linkbtn dp-ready" data-approve ${w ? '' : 'hidden'}>${ic('check', 's14')} Looks good, mark ready</button>`;
      if (!w || st === 'drafting') return `${compose}${two}${ready}`;
      if (st === 'team' || st === 'brew') return `<p class="dp-wait"><brew-load class="spin"></brew-load>${st === 'team' ? `Waiting on ${esc(w.with.name)} in ${esc(w.with.channel)}` : `Shared with the ShopOS team as ${esc(w.ticket || 'a brief')}.`}</p>${compose}`;
      if (st === 'needs_you') return `<div class="dp-ctas"><button class="btn btn-primary" data-approve>${ic('check', 's16')}Approve v${w.current}</button></div>${compose}`;
      if (st === 'ready') return `<div class="dp-ctas"><button class="btn btn-primary" data-cp-ship>${ic('copy', 's16')}Share the brief</button></div><button class="linkbtn" data-reopen>Another round first</button>`;
      return '';
    })();
    const sideScroll = $('.dp-side-b', dp)?.scrollTop;
    const phH = phaseOf(p, w, c);
    const dhHtml = `<div class="dr-h dh"><button class="q-back dh-back" data-x aria-label="Back">${ic('left', 's16')}<span>Back</span></button><i class="dh-sep"></i>
        <div class="dh-who">${face(c.agent)}<b>${esc(fromLabel(c))}<small>${esc([agoText(c.time), campLine(c)].filter(Boolean).join(' · '))}</small></b></div>
        <span class="dh-pill dp-kind is-${phH}"><i></i>${PHASE[phH]}</span>${c.badge ? `<span class="badge ${c.badge[1]} dh-badge">${esc(c.badge[0])}</span>` : ''}
        <div class="dh-acts"><button class="dh-share" title="Copy a link to this, as it is now" data-dplink>${ic('link', 's16')}<span>Copy link</span></button><button class="icon-btn" aria-label="Close" data-x>${ic('x', 's18')}</button></div></div>`;
    const before = dp.dataset.pid === String(p.id) + (w?.id || '') ? snapLeft(dp) : null; dp.dataset.pid = String(p.id) + (w?.id || '');
    dp.innerHTML = `<div class="dp-page"><div class="dr-b">${dhHtml}
        ${String(p.id).startsWith('jam-') ? stepper : ''}
        ${cardPageHtml(p, c, w, ch, m)}
      </div>
      <aside class="dp-side"><div class="dp-side-b">${ch && (ch.thread?.length || w?.thread?.length) ? `<section class="dp-thread"><h4>Conversation <small>studio and jam</small></h4>${mergedThread(w, ch)}</section>` : w?.thread?.length ? `<section class="dp-thread"><h4>Conversation</h4>${threadHtml(w)}</section>` : `<div class="dp-side-empty">${ic('hand')}<b>Jam on this card</b><span>Ask AI to change it, pull in a teammate on Slack, or hand it to the ShopOS team. Everything you say and every version lands here.</span></div>`}</div>
      <div class="dr-f dp-f">${footer}</div></aside></div>`;
    window.JamRoom?.decorateDetail(dp, DP);
    if (before) flashLeft(dp, before);
    jmSheet(dp); dp.classList.toggle('is-fresh', !String(p.id).startsWith('jam-') && !jamOn(p, w));
    const body = $('.dr-b', dp), side = $('.dp-side-b', dp); if (prevScroll) body.scrollTop = prevScroll; if (DP.scrollThread) { side.scrollTop = side.scrollHeight; DP.scrollThread = false; } else if (sideScroll) side.scrollTop = sideScroll;
  };
  const ensureWork = async () => { if (DP.w) return DP.w; const { _work, ...card } = DP.p; const r = await tapi('POST', '/api/work', { cardId: DP.p.id, card }); putWork(r.work); if (DP.p._work) DP.p = { ...DP.p, _work: r.work }; DP.w = r.work; return r.work; };
  const busy = (on, label) => { const f = $('#dp .dp-f'); if (!f) return; f.classList.toggle('is-busy', on); if (on) f.insertAdjacentHTML('afterbegin', `<p class="dp-wait dp-busy"><brew-load class="spin"></brew-load>${esc(label)}</p>`); else $('.dp-busy', f)?.remove(); };
  /* moves disagree: brief the owner on Slack with every option and our pick */
  const conflictNote = (p) => { const c = cardOf(p), pk = c.options.find((o) => o.id === c.pick);
    return `Moves disagree: ${c.title} ${c.options.map((o, i) => `(${i + 1}) ${o.name}, moves ${o.moves}`).join('. ')}. We recommend ${pk.name}: ${c.reason} Agree, or pick another?`; };
  const pullIn = (p) => { if (!DP) return; DP.picking = p.owner || colleagueForCard(p).id; return sendTo('team', conflictNote(p)); };
  const sendTo = async (to, note) => {
    /* the live site: "Jam with team" is the jam on Slack (the real post and its thread); the demo keeps the simulated teammate */
    if (to === 'team' && !window.BREW_DEMO && window.LIVE?.avail?.slack && !window.LIVE.avail.slack.dummy) {
      if (!conn('slack')) return openConnect('slack', { then: () => sendTo(to, note), why: 'The jam runs in a Slack thread: replies land here, and new assets go there for review.' });
      const w = await ensureWork(); busy(true, 'Posting to Slack…');
      const r = await tapi('POST', `/api/work/${w.id}/jb/move`, { to: 'slack', base: location.origin }); busy(false);
      if (r.error) return toast(esc(r.error)); putWork(r.work); repaintDetail();
      return toast(`${ic('check', 's16')}The jam is live in ${esc(r.posted?.channel || 'Slack')}. Replies land here; new assets go there for review.`);
    }
    /* the live site has no simulated colleague: without the real Slack above there is nobody to pick */
    if (to === 'team' && !window.BREW_DEMO) return toast(`${ic('info', 's16')}Slack isn’t set up for ${esc(B.brand.name)} yet. Tag a teammate in the jam with @their name.`);
    if (to === 'team' && !conn('slack')) return openConnect('slack', { then: () => { const q = DP?.p || FEED[0]; openDetail(q); if (q.kind === 'conflict') return pullIn(q); DP.picking = colleagueForCard(DP.p).id; repaintDetail(); }, why: 'Your colleague reviews the card in Slack and approves it there.' });
    if (to === 'team' && !note && DP.picking == null) { DP.picking = colleagueForCard(DP.p).id; return repaintDetail(); }
    const w = await ensureWork(); busy(true, 'Asking your teammate…');
    const r = await tapi('POST', `/api/work/${w.id}/send`, { to, note: note || '', colleague: DP.picking, name: DP.picking ? colleague(DP.picking).name : undefined, names: S.slack.names, channel: S.slack.channel });
    if (r.error || !r.work) { busy(false); DP.picking = null; return toast(esc(r.error || 'That didn’t go through. Try again.')); }
    DP.picking = null; putWork(r.work); DP.to = to; DP.scrollThread = true; repaintDetail(); counts();
    toast(`${ic('send', 's16')}Sent to ${esc(r.work.with.name)} in ${esc(r.work.with.channel)}`);
  };
  const colleagueForCard = (p) => p?.owner ? colleague(p.owner) : colleague(p?.sector === 'creatives' || p?.sector === 'visibility' ? 'brandm' : p?.sector === 'ads' ? 'perf' : p?.sector === 'storefront' || p?.sector === 'catalog' ? 'ops' : 'growth');
  /* the chip or send button that asked spins until the answer is in, like Make it yours (the panel's busy line stays too) */
  const sendComposer = (text, el) => { if (!text) return; const done = el ? busyBtn(el, el.matches('.chip') ? el.textContent.trim() : '') : () => {};
    return Promise.resolve(sendComposer0(text)).finally(done); };
  const sendComposer0 = async (text) => {
    if (!text) return; const to = DP.to;
    if (to !== 'ai' && (!DP.w || DP.w.with?.kind !== to)) return sendTo(to, text);
    const w = await ensureWork();
    busy(true, to === 'ai' ? 'Routing, then writing…' : 'Sending…');
    const r = to === 'ai' ? await tapi('POST', `/api/work/${w.id}/iterate`, { body: text }) : await tapi('POST', `/api/work/${w.id}/message`, { body: text });
    busy(false); if (r.error) return toast('That didn’t go through. Try again.');
    putWork(r.work); DP.scrollThread = true; if (r.change) DP.ch = r.change;
    if (r.decision?.route === 'team') { DP.to = 'brew'; toast(`${ic('person', 's16')}Needs ${esc(r.decision.label)}. Finish the jam, then share the brief.`); }
    repaintDetail(); counts();
  };
  // "Tell us why" on the card page: a note for the ShopOS team that Brew also learns from
  document.addEventListener('submit', async (e) => { const f = e.target.closest?.('[data-fb-form]'); if (!f || !DP) return; e.preventDefault();
    const text = f.querySelector('input').value.trim(), p = DP.p, was = DP.fb?.[p.id];
    if (text) await tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'note', text, useful: was === 'down' ? false : null });
    DP.fb = { ...(DP.fb || {}), [p.id]: 'sent' }; repaintDetail(); toast(`${ic('check', 's16')}Thanks. Brew will learn from it.`); });
  document.addEventListener('click', async (e) => {
    const dp = e.target.closest('#dp'); if (!dp || !DP) return;
    const t = e.target;
    if (t.closest('[data-x]')) return history.state?.a === 'dp' ? history.back() : closeDetail();
    if (t.closest('[data-dpsave]')) { toggleSave(DP.p); t.closest('[data-dpsave]').setAttribute('aria-pressed', S.saved.includes(DP.p.id)); return; }
    const o = t.closest('[data-dp-open]'); if (o) { const x = byId(o.dataset.dpOpen); if (x) openDetail(x); return; }
    const to = t.closest('[data-to]'); if (to) { DP.to = to.dataset.to; DP.picking = null; repaintDetail(); $('#dp-in')?.focus(); return; }
    const ch = t.closest('[data-chip]'); if (ch) return sendComposer(ch.dataset.chip, ch);
    const sd = t.closest('[data-send]'); if (sd) return sendTo(sd.dataset.send);
    const jb = t.closest('[data-jb-send]'); if (jb) { const done = busyBtn(jb, 'Sending…'); return Promise.resolve(window.JamRoom?.send?.(jb.dataset.jbSend)).finally(done); }
    const cg = t.closest('[data-cp-go]'); if (cg) return goWith(DP.p, cg.dataset.cpGo);
    const co = t.closest('[data-cp-open]'), cob = t.closest('button,a,details'); if (co && (!cob || cob === co)) { DP.mOpen = !!$('.cp-measure')?.open; DP.openOpt = { ...(DP.openOpt || {}), [DP.p.id]: co.dataset.cpOpen }; repaintDetail(); const cm2 = $('.cp-measure.is-opt'); cm2?.classList.add('is-swap'); return; }
    if (t.closest('[data-cp-undo]')) { if (DP.w && DP.w.stage === 'shared') return toast('The brief is shared. Make the next version instead.'); const d = { ...(S.decided || {}) }; delete d[DP.p.id]; S.decided = d; save(); pushDecided(DP.p.id, null); if (DP.w) { DP.w.decided = null; tapi('POST', `/api/work/${DP.w.id}/decided`, { id: null }); } return repaintDetail(); }
    if (t.closest('[data-dplink]')) return copyLink(DP.p, DP.w);
    if (t.closest('[data-cp-remix]')) { const card = byId(DP.p.id), chId = DP.ch?.id; if (!card) return; closeDetail(true); return openRemix(card, chId); }
    if (t.closest('[data-cp-save]')) { toggleSave(DP.p); return repaintDetail(); }
    const fbb = t.closest('[data-fb]'); if (fbb) { const k = fbb.dataset.fb, p = DP.p; DP.rankOpen = true; DP.fb = { ...(DP.fb || {}) };
      if (k === 'up') { if (!S.hearts[p.id]) { S.hearts[p.id] = true; save(); tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'heart' }); $$(`.card[data-id="${p.id}"] [data-act="heart"]`).forEach((x) => x.setAttribute('aria-pressed', true)); } DP.fb[p.id] = 'sent'; return repaintDetail(); }
      if (k === 'down') { S.dismissed[p.id] = true; save(); tapi('POST', `/api/cards/${p.id}/feedback`, { kind: 'not_interested' }); DP.fb[p.id] = 'down'; repaintDetail(); return $('[data-fb-form] input')?.focus(); }
      DP.fb[p.id] = 'why'; repaintDetail(); return $('[data-fb-form] input')?.focus(); }
    // the same signal as the heart on the feed card: it re-ranks the feed and asks the agent for more like it
    if (t.closest('[data-cp-heart]')) { const p = DP.p, on = !S.hearts[p.id];
      if (on) S.hearts[p.id] = true; else delete S.hearts[p.id]; save(); repaintDetail();
      $$(`.card[data-id="${p.id}"] [data-act="heart"]`).forEach((x) => x.setAttribute('aria-pressed', on));
      if (on) toast(`${ic('heart', 's16')}You’ll see more like this`);
      const r = await tapi('POST', `/api/cards/${p.id}/feedback`, { kind: on ? 'heart' : 'unheart' });
      if (on && r.child) loadLearned(p); return; }
    if (t.closest('[data-cp-jam]')) { $('[data-jm-tab="chat"]')?.click(); setTimeout(() => $('#jm-in')?.focus(), 60); return; }
    const jg = t.closest('[data-cp-jamgo],[data-cp-doit]');
    if (jg) { const p = DP.p, pg = PAGE[p.id] || localPage(cardOf(p)), id = DP.openOpt?.[p.id] || pg?.options?.find((o) => o.pick)?.id;
      S.jamOn = { ...(S.jamOn || {}), [p.id]: true }; save(); sound('select');
      /* the card's action opens its jam on the plan; nothing is decided or run until someone does it in the jam */
      if (jg.dataset.cpDoit != null) { await openRemix(p); return; }
      if (id && !S.decided?.[p.id]) await goWith(p, id); else repaintDetail(true);
      { await openRemix(p); return; }
      if (typeof setSheet === 'function' && PHONE()) setSheet(true);
      $('[data-jm-tab="chat"]')?.click(); setTimeout(() => $('#jm-in')?.focus(), 80);
      return; }
    if (t.closest('[data-cp-ship]')) { const b = $('[data-jm] [data-jm-ship]'); if (b) b.click(); else toast('Open the brief to send it.'); return; }
    const cm = t.closest('[data-cp-mv]'); if (cm) { const el = $(`#cp-mv-${cm.dataset.cpMv}`); el?.closest('details')?.setAttribute('open', ''); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash'); } return; }
    const col = t.closest('[data-col]'); if (col) { DP.picking = col.dataset.col; repaintDetail(); return; }
    if (t.closest('[data-cancel-pick]')) { DP.picking = null; return repaintDetail(); }
    const pk = t.closest('[data-pick]'); if (pk) { const [msgId, i] = pk.dataset.pick.split(':'); const r = await tapi('POST', `/api/work/${DP.w.id}/pick`, { msgId, i: +i }); putWork(r.work); DP.scrollThread = true; repaintDetail(); toast(`${ic('check', 's16')}Saved as v${r.work.current}`); return; }
    const ver = t.closest('[data-ver]'); if (ver) { const r = await tapi('POST', `/api/work/${DP.w.id}/version`, { n: +ver.dataset.ver }); putWork(r.work); DP.ch = null; repaintDetail(); return; }
    const js = t.closest('[data-jam-studio]'); if (js) { e.preventDefault(); const card = byId(DP.ch.cardId); closeDetail(true); if (card) openRemix(card, js.dataset.jamStudio); return; }
    if (t.closest('[data-approve]')) { const w = await ensureWork(); const r = await tapi('POST', `/api/work/${w.id}/approve`, { rev: w.current }); if (r.work) putWork(r.work); repaintDetail(); counts(); toast(r.stale ? `${ic('info', 's16')}${esc(r.error)}` : `${ic('zap', 's16')}Ready. Share the brief when you are.`); return; }
    if (t.closest('[data-reopen]') || t.closest('[data-next]')) { { const r = await tapi('POST', `/api/work/${DP.w.id}/reopen`); putWork(r.work); } DP.to = 'ai'; repaintDetail(); $('#dp-in')?.focus(); return; }
    const ja = t.closest('[data-jq-ask]'); /* data-jq-person (a real teammate) is a select: see the change listener below */ if (ja) { const r = await tapi('POST', `/api/work/${DP.w.id}/plan/ask`, { qid: ja.dataset.jqAsk }); putWork(r.work); repaintDetail(); showLearned(r.learned); askedCopy(r); return; }
    if (t.closest('[data-jq-all]')) { const r = await tapi('POST', `/api/work/${DP.w.id}/plan/ask`, { all: true }); putWork(r.work); repaintDetail(); showLearned(r.learned); askedCopy(r); return; }
    const jn = t.closest('[data-jq-ans]'); if (jn) { DP.answering = jn.dataset.jqAns; repaintDetail(); $(`[data-jqf="${DP.answering}"] input`)?.focus(); return; }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'dp-f') { e.preventDefault(); const v = $('#dp-in').value.trim(); $('#dp-in').value = ''; sendComposer(v, e.target.querySelector('button')); }
    const jf = e.target.closest('[data-jqf]'); if (jf) { e.preventDefault(); const v = $('input', jf).value.trim(); if (!v) return; tapi('POST', `/api/work/${DP.w.id}/plan/answer`, { qid: jf.dataset.jqf, answer: v }).then((r) => { DP.answering = null; putWork(r.work); repaintDetail(); showLearned(r.learned); }); }
    if (e.target.id === 'jq-add') { e.preventDefault(); const v = $('#jq-add input').value.trim(); if (!v) return; tapi('POST', `/api/work/${DP.w.id}/plan/add`, { q: v }).then((r) => { putWork(r.work); repaintDetail(); }); }
    if (e.target.id === 'dp-pick') { e.preventDefault(); sendTo('team', $('#dp-note').value.trim() || `@${colleague(DP.picking).name} can you look at this before it goes out?`); }
  });
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-post]'); if (!card || card.closest('#dp') || card.closest('[data-witem]')) return;
    if (e.target.closest('button, a, input, textarea, select, label, [data-more], .ask')) return;
    const p = FEED[+card.dataset.post]; if (p) openDetail(p);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#dp') && !$('#th')) { e.stopImmediatePropagation(); closeDetail(); } }, true);

  /* theatre: tap a card's picture to browse every asset full screen. Arrows, keys, swipe, a thumbnail strip, Esc closes */
  const TH = { srcs: [], i: 0, title: '' };
  const paintTheatre = () => { const el = $('#th'); if (!el) return; const { srcs, i } = TH;
    $('.th-img', el).src = srcs[i]; $('.th-n', el).textContent = `${i + 1} / ${srcs.length}`;
    $$('.th-strip button', el).forEach((b, k) => b.setAttribute('aria-current', k === i));
    $('.th-strip [aria-current="true"]', el)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    $$('.th-nav', el).forEach((b) => (b.hidden = srcs.length < 2)); };
  const openTheatre = (srcs, i = 0, title = '') => {
    if (!srcs.length) return; $('#th')?.remove(); Object.assign(TH, { srcs, i: Math.max(0, Math.min(i, srcs.length - 1)), title, back: document.activeElement });
    const el = document.createElement('div'); el.id = 'th'; el.className = 'th'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title || 'Assets');
    el.innerHTML = `<header class="th-top"><span class="th-t">${esc(title)}</span><span class="th-n"></span><button class="th-x" data-th-x aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="th-stage" data-th-stage><button class="th-nav l" data-th-go="-1" aria-label="Previous">${ic('left', 's18')}</button><img class="th-img" alt=""><button class="th-nav r" data-th-go="1" aria-label="Next">${ic('right', 's18')}</button></div>
      ${srcs.length > 1 ? `<div class="th-strip">${srcs.map((x, k) => `<button data-th-i="${k}" aria-label="Asset ${k + 1}"><img src="${esc(x)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}`;
    document.body.appendChild(el); document.body.classList.add('th-on'); paintTheatre(); $('.th-x', el).focus(); };
  const closeTheatre = () => { $('#th')?.remove(); document.body.classList.remove('th-on'); TH.back?.focus?.(); };
  const stepTheatre = (d) => { TH.i = (TH.i + d + TH.srcs.length) % TH.srcs.length; paintTheatre(); };
  document.addEventListener('click', (e) => {
    const th = e.target.closest('#th');
    if (th) { if (e.target.closest('[data-th-x]') || e.target === th || e.target.matches('[data-th-stage]')) return closeTheatre();
      const g = e.target.closest('[data-th-go]'); if (g) return stepTheatre(+g.dataset.thGo);
      const k = e.target.closest('[data-th-i]'); if (k) { TH.i = +k.dataset.thI; return paintTheatre(); } return; }
    // the asset on a card page: every picture in that visual, starting from the one showing
    const img = e.target.closest('#dp .cp-visual img'); if (!img || e.target.closest('.nav, .dots, button')) return;
    const box = img.closest('.media') || img.closest('.cp-visual'), imgs = $$('img', box), track = $('.track', box);
    const at = box.dataset.car != null ? +box.dataset.car : track && track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : imgs.indexOf(img);
    e.preventDefault(); e.stopPropagation(); openTheatre([...new Set(imgs.map((x) => x.getAttribute('src')))], at, DP?.p ? cardOf(DP.p).title : '');
  }, true);
  addEventListener('keydown', (e) => { if (!$('#th')) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeTheatre(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepTheatre(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); stepTheatre(-1); } }, true);
  { let x0 = null; addEventListener('touchstart', (e) => { if (e.target.closest('#th .th-stage')) x0 = e.touches[0].clientX; }, { passive: true });
    addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) stepTheatre(dx < 0 ? 1 : -1); }, { passive: true }); }

  /* =========================================================
     Work board: every card you are working on, by stage. Needs you has its own column.
     ========================================================= */
  // six lanes, left to right, in the order work actually moves. Team and Brew share one lane (the tile says who);
  // deploying and measuring share one (the tile says which). The server moves every item between lanes on its own.
  // Work is laid out as a deck: the same sidebar, full-height columns and card anatomy as the Deck, one column per lane.
  // Lanes run in the order work moves; the server moves every item between them on its own.
  // lanes in the order that matters to you: what waits on you first, the background AI lane last and slim (Param 2026-10-16)
  /* every lane header is one short line of one height, so the underlines align; the full words and what the lane holds are its title */
  const WB_COLS = [
    { k: 'you', name: 'Needs you', full: 'Needs you', sub: 'Someone is waiting on your answer', stages: ['needs_you'], emo: '✋', dot: 'var(--warn)' },
    { k: 'drafting', name: 'Drafting', full: 'Drafting', sub: 'You and AI, before anyone else sees it', stages: ['drafting'], emo: '✏️', dot: 'var(--fg-3)' },
    { k: 'with', name: 'With teammate', full: 'With a teammate', sub: 'A teammate is looking at it', stages: ['team'], emo: '💬', dot: 'var(--info)' },
    { k: 'ready', name: 'Ready', full: 'Ready to share', sub: 'Approved; share the brief from the jam', stages: ['ready'], emo: '✅', dot: 'var(--ok)' },
    { k: 'shared', name: 'Brief shared', full: 'Brief shared', sub: 'With the ShopOS team or your team; the jam ends here', stages: ['shared'], emo: '📋', dot: '#16a37f' }];
  // a remixed message keeps its copy as the title ("नमस्ते {first_name}, …"). On the board the title is what the work is; the copy goes underneath
  const MSGY = /\{\{?\s*\w+|\n|^(hi|hey|hello|dear|नमस्ते)\b/i;
  const wbTitle = (w) => { const t = String(w.title || curV(w)?.title || '').trim(); return !MSGY.test(t) && t.length <= 90 ? t : w.chg?.actionLabel || byId(w.cardId)?.title || plain(t).slice(0, 70); };
  const wbCopy = (w) => { const t = String(curV(w)?.title || w.title || '').trim(); return MSGY.test(t) || t.length > 90 ? plain(t).slice(0, 160) : ''; };
  // the status badge in the card head, the way Deck cards carry theirs
  const wbBadge = (w) => {
    if (needsMe(w)) return '<span class="badge warn">Your answer</span>';
    if (w.stage === 'needs_you') return `<span class="badge info">Waiting on ${esc(w.assignee?.name || 'your team')}</span>`;
    if (w.stage === 'team') return `<span class="badge info">With ${esc(w.with?.name || 'your team')}</span>`;
    if (w.stage === 'ready') return '<span class="badge ok">Approved</span>';
    if (w.stage === 'shared') return `<span class="badge ok">Shared${w.ticket ? ' · ' + esc(w.ticket) : ''}</span>`;
    return w.versions.length > 1 ? `<span class="badge">v${w.current} of ${w.versions.length}</span>` : ''; };
  // the body under the title: the ask, the reading, the result, or what the draft says
  const wbBody = (w) => {
    if (w.askMe) return `<div class="wb-say">${pAv(w.askMe, 22)}<div><b>${esc(w.askMe.who)}</b><span>${esc(plain(w.askMe.body).slice(0, 200))}</span></div></div>`;
    const msg = (w.thread || []).filter((x) => x.body && !['system', 'me'].includes(x.from)).slice(-1)[0];
    if (['needs_you', 'team'].includes(w.stage) && msg) { const tm = w.with?.kind === 'team' ? colleague(w.with.id) : null;
      const who = msg.who || w.with?.name || 'Brew';
      return `<div class="wb-say">${tm ? avatar({ ...tm, ini: who.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() }, 22) : face(msg.from === 'brew' ? 'brew' : w.agent || 'brew')}<div><b>${esc(who)}</b><span>${esc(plain(msg.body).slice(0, 200))}</span></div></div>`; }
    const copy = wbCopy(w); if (copy) return `<blockquote class="wb-copy">${esc(copy)}</blockquote>`;
    const sub = plain(curV(w)?.sub || byId(w.cardId)?.sub || ''); return sub ? `<p>${esc(sub.slice(0, 220))}</p>` : ''; };
  const wbFoot = (w) => needsMe(w) ? `<span class="wb-go is-hot">Answer ${esc(w.askMe?.who || w.with?.name || 'them')}${ic('right', 's16')}</span>`
    : w.stage === 'ready' ? `<span class="wb-go">Share the brief${ic('right', 's16')}</span>`
    : `<span class="wb-go is-quiet">Open${ic('right', 's16')}</span>`;
  const tileHtml = (w) => `<article class="card wb-card${w.unread ? ' is-unread' : ''}" data-witem="${w.id}" tabindex="0">
      <header class="card-head">${face(w.agent || 'brew')}<div class="who"><b>${esc(AGENT[w.agent] || 'Brew')}</b><span>${ago(w.updatedAt)}</span></div>${wbBadge(w)}</header>
      ${w.img ? `<div class="media portrait"><img src="${esc(w.img)}" alt="" loading="lazy"></div>` : ''}
      <div class="body">${(() => { const c = w.whose || w.cardSnap || {}, rv = rivalOf(c), wa = rv ? ourVersionOf(rv.name) : whoseAd({ ...c, images: c.images?.length ? c.images : w.img ? [w.img] : [] }); return wa ? `<small class="wb-whose">${esc(wa)}</small>` : ''; })() /* whose ad it is, like the feed: "Made for you" on our own (FEED-NOT-02) */}<h3>${w.unread ? '<i class="wb-new"></i>' : ''}${esc(wbTitle(w))}</h3>${wbBody(w)}</div>${wbFoot(w)}</article>`;
  const wbStrip = (w) => { const say = needsMe(w) ? `Answer ${esc(w.askMe?.who || w.with?.name || 'them')}` : w.stage === 'needs_you' ? `Waiting on ${esc(w.assignee?.name || 'your team')}` : w.stage === 'team' ? `With ${esc(w.with?.name || 'your team')}` : w.stage === 'ready' ? 'Approved · share the brief' : w.stage === 'shared' ? `Brief shared${w.ticket ? ' · ' + esc(w.ticket) : ''}` : w.versions?.length > 1 ? `Draft v${w.current} of ${w.versions.length}` : 'Draft';
    return `<div class="wb-strip is-${esc(needsMe(w) ? 'needs_you' : w.stage === 'needs_you' ? 'team' : w.stage)}">${w.unread ? '<i class="wb-new"></i>' : ''}<b>${say}</b><span>${ago(w.updatedAt)}</span>${ic('right', 's14')}</div>`; };
  const workTile = (w) => { const p = w.cardId && byId(w.cardId), i = p ? FEED.indexOf(p) : -1;
    return i < 0 ? tileHtml(w) : `<div class="wb-fc${w.unread ? ' is-unread' : ''}" data-witem="${w.id}">${wbStrip(w)}${postCard(p, i)}</div>`; };
  /* the background lane: many moves written at once read as one row, not one row each */
  const bgGroup = (xs) => { const runs = xs.filter((x) => /^bg-m/.test(x.id)), q = xs.filter((x) => /^bg-q/.test(x.id)), rest = xs.filter((x) => !/^bg-[mq]/.test(x.id));
    const one = runs.length > 1 ? [{ id: 'bg-mall', kind: 'run', t: `Writing ${runs.length} moves`, s: runs.slice(0, 3).map((x) => x.s).filter(Boolean).join(' · ') + (runs.length > 3 ? ` · ${runs.length - 3} more` : ''), meta: 'Each takes 6 to 9 minutes; they run side by side', pct: Math.round(runs.reduce((a, x) => a + (x.pct || 0), 0) / runs.length) }] : runs;
    const nx = q.length > 1 ? [{ id: 'bg-qall', kind: 'next', t: `Up next: ${q.length} moves`, s: q.map((x) => x.s).filter(Boolean).join(' · '), meta: 'Start as a slot frees up' }] : q;
    return [...one, ...rest, ...nx]; };
  /* ---------- the Work board's last lane: what AI is doing in the background, right now ---------- */
  const WB_IC = { ai: 'cpu', drafting: 'txt', with: 'chat', you: 'hand', ready: 'check', shared: 'copy' };
  const AI_COL0 = { k: 'ai', name: 'AI is working on', sub: 'In the background, right now', stages: [], emo: '⚙️', dot: '#111' };
  /* the lane says what is really happening: "Working on 1, 2 queued", "3 queued", never "working on 3" when all wait */
  const bgState = (xs) => { const run = xs.filter((x) => x.kind === 'run').length, q = xs.filter((x) => x.kind === 'next' && x.id !== 'bg-w').length, f = xs.filter((x) => x.kind === 'fail').length;
    const parts = [run && `working on ${run}`, q && `${q} queued`, f && `${f} stopped`].filter(Boolean), line = parts.join(', ');
    return { name: run ? 'AI is working on' : q ? 'AI, queued' : 'AI in the background', n: run || q || f || xs.length, sub: line ? line[0].toUpperCase() + line.slice(1) : 'In the background, right now' }; };
  const aiCol = () => { const b = bgState(BG.items); return { ...AI_COL0, name: b.name, sub: b.sub, count: b.n }; };
  const BG = { items: [], t: null };
  const mins = (s) => s < 60 ? 'under a minute' : `${Math.round(s / 60)} min`;
  const loadBG = async () => {
    clearTimeout(BG.t); const slug = B.slug || BR; const out = [];
    if (GEN) { const b = await api(`/api/brands/${slug}/build`);
      if (b && !b.error) {
        b.inflight.forEach((x) => out.push({ id: 'bg-m' + x.n, kind: 'run', t: `Writing ${mvLabel(x.n)}`, s: x.title, meta: `${mins(x.secs)} so far · usually 6 to 9`, pct: Math.min(92, Math.round(100 * x.secs / 480)) }));
        b.failed.forEach((x) => out.push({ id: 'bg-f' + x.n, kind: 'fail', t: `${mvLabel(x.n)} stopped`, s: `${x.title} · ${x.msg}`, meta: 'It gets another try once the rest are written' }));
        if (b.statics?.state === 'running') out.push({ id: 'bg-st', kind: 'run', t: 'Making your static ads', s: 'From Move 21, on your real product photos', meta: 'About 5 minutes', pct: 40 });
        b.queue.slice(0, 3).forEach((x) => out.push({ id: 'bg-q' + x.n, kind: 'next', t: `Up next: ${mvLabel(x.n)}`, s: x.title, meta: 'Starts when a slot frees up' }));
        if (!b.inflight.length && b.done < 51 && !b.failed.length && !b.queue.length) out.push({ id: 'bg-w', kind: 'next', t: 'Waiting to start', s: b.state || '', meta: '' });
      } }
    const r = await api('/api/research'); (r?.running || []).forEach((k) => out.push({ id: 'bg-r' + k, kind: 'run', t: { ads: 'Reading rival ads', own: 'Reading your live ads', trends: 'Reading Google Trends', news: 'Reading industry news', howto: 'Writing this week’s playbooks' }[k] || 'Research', s: 'For your story rings', meta: 'A minute or two', pct: 50 }));
    const was = JSON.stringify(BG.items); BG.items = out;
    if (view === 'work' && was !== JSON.stringify(out)) renderWork();
    BG.t = view === 'work' || view === 'moves' ? setTimeout(loadBG, 10e3) : null;
  };
  const bgTile = (x) => `<article class="card wb-card wb-bg is-${x.kind}"><div class="wb-bg-h">${face('brew')}<span><b>${esc(x.t)}</b><small>${esc(x.s || '')}</small></span>${x.kind === 'run' ? '<span class="wb-bg-live"><span class="dot"></span>Now</span>' : x.kind === 'fail' ? `<button class="btn btn-ghost sm" data-bgretry>Retry</button>` : ''}</div>
    ${x.kind === 'run' ? `<div class="wb-bg-bar"><i style="width:${x.pct || 30}%"></i></div>` : ''}${x.meta ? `<p class="wb-bg-meta">${esc(x.meta)}</p>` : ''}</article>`;
  document.addEventListener('click', async (e) => { if (!e.target.closest('[data-bgretry]')) return; const r = await api(`/api/brands/${B.slug || BR}/retry`, {}); toast(`${ic('refresh', 's16')}${esc(r?.note || 'Retrying the stopped moves')}`); loadBG(); });
  const renderWork = () => {
    if (!BG.t) loadBG();
    view = 'work'; document.body.classList.add('deck-on'); $('#stk').innerHTML = ''; $('#notes').innerHTML = '';
    $$('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', 'false'));
    const items = WORK.items.filter((w) => !w.archived && !w.discarded);
    /* the AI lane only while AI is doing something; the five lanes only once something is in progress */
    const ai = BG.items.length ? aiCol() : null, cols = ai ? [...WB_COLS, ai] : WB_COLS;
    const nOf = (c) => c.count ?? by(c).length; /* the AI lane counts what is running, else what waits */
    const by = (c) => c.k === 'ai' ? bgGroup(BG.items) : items.filter((w) => c.k === 'you' ? needsMe(w) : !needsMe(w) && (c.stages.includes(w.stage) || (c.k === 'with' && w.stage === 'needs_you'))).sort((a, b) => (b.unread - a.unread) || b.updatedAt - a.updatedAt);
    // the board redraws on its own as work moves: keep where you were scrolled, sideways and in every column
    const keep = $('#wb-deck') ? { x: $('#wb-deck').scrollLeft, y: Object.fromEntries($$('.wb-col').map((c) => [c.dataset.bcol, $('.col-body', c)?.scrollTop || 0])) } : null;
    /* an empty lane is its title only: no 0, no placeholder sentence */
    const lane = (c) => { const list = by(c), n = nOf(c), tip = c.k === 'ai' ? c.sub : `${c.full || c.name}: ${c.sub}`;
      return `<section class="dcol wb-col${list.length ? '' : ' is-empty'}${c.k === 'ai' ? ' is-ai' : ''}" data-bcol="${c.k}" style="--lane:${c.dot}"><div class="col-head"><div class="col-top" title="${esc(tip)}"><h2><span class="col-emo" aria-hidden="true">${ic(WB_IC[c.k] || 'board', 's16')}</span>${esc(c.name)}</h2><span class="col-fill"></span>${n ? `<span class="wb-n">${n}</span>` : ''}</div><hr></div>
          <div class="col-body">${c.k === 'ai' ? `<p class="wb-ai-sub">${esc(c.sub)}</p>` : ''}${list.map(c.k === 'ai' ? bgTile : workTile).join('')}</div></section>`; };
    const head = `<div class="wb-head"><span><b>Work</b><small>From first draft to a shared brief. Cards move on their own as people reply.</small></span><button class="side-act" data-wbjam>${ic('hand', 's16')} Start a new jam</button><button class="side-act" data-nav="jams">${ic('book', 's16')} Jams in the Library</button></div>`;
    const tabs = cols.filter((c) => nOf(c) > 0); /* phones and tablets: a chip per lane that has something */
    $('#view').innerHTML = `<div class="deck-wrap wb-deck"><div class="deck-main">${head}
      ${!items.length ? `<div class="deck wb-zero-deck" id="wb-deck" style="--col-w:440px"><div class="wb-zero-main"><div class="wb-zero">${ic('board')}<h2>Nothing in progress yet</h2><p>Open a card in the feed and start a jam. It shows up here and moves on its own, from first draft to shared brief.</p><button class="btn btn-primary" data-nav="feed">${ic('feed', 's16')}Open the feed</button></div></div>${ai ? lane(ai) : ''}</div>`
        : `<div class="wb-tabs" role="tablist">${tabs.map((c, i) => `<button role="tab" data-wbnav="${c.k}" aria-current="${i === 0}" title="${esc(c.full || c.name)}"><i style="background:${c.dot}"></i>${esc(c.name)}<em>${nOf(c)}</em></button>`).join('')}</div><div class="deck" id="wb-deck" style="--col-w:440px">${cols.map(lane).join('')}</div>`}</div></div>`;
    // phones: the lane tabs follow your swipe
    { const d = $('#wb-deck'); let tm; if (d) d.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(() => { const cols = $$('.wb-col', d).filter((c) => c.offsetParent !== null), x = d.scrollLeft + 8; if (!cols.length) return; const cur = cols.reduce((a, c) => (c.offsetLeft - cols[0].offsetLeft <= x ? c : a), cols[0]); $$('.wb-tabs [data-wbnav]').forEach((b) => { const on = b.dataset.wbnav === cur.dataset.bcol; b.setAttribute('aria-current', on); if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }); }, 80); }, { passive: true }); }
    if (keep && $('#wb-deck')) { const d = $('#wb-deck'); d.style.scrollBehavior = 'auto'; d.scrollLeft = keep.x; $$('.wb-col').forEach((c) => { const b = $('.col-body', c); if (b) b.scrollTop = keep.y[c.dataset.bcol] || 0; }); d.style.scrollBehavior = ''; }
    counts();
  };
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-wbnav]'); if (n) { const col = $(`[data-bcol="${n.dataset.wbnav}"]`), d = $('#wb-deck'); if (col && d) d.scrollTo({ left: d.scrollLeft + col.getBoundingClientRect().left - d.getBoundingClientRect().left, behavior: e.isTrusted ? 'smooth' : 'instant' }); $$('[data-wbnav]').forEach((b) => b.setAttribute('aria-current', b === n)); return; }
    if (e.target.closest('[data-wbjam]')) openJam({});
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('.wb-card[data-witem]')) e.target.click(); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-witem]'); if (!t) return;
    if (t.classList.contains('wb-fc') && e.target.closest('.card button, .card a, .card input, .card textarea, .card select, .card label, .card [data-more], .card .ask')) return; /* the feed card's own buttons work as in the feed */
    const w = WORK.items.find((x) => x.id === t.dataset.witem); if (!w) return; closePop();
    // the exact item you tapped: one card can have several (one per remix), so never let the card pick its own
    openDetail(w.cardId && byId(w.cardId) ? { ...byId(w.cardId), _work: w } : pseudoPost(w));
  });

  /* ---------- notifications ---------- */
  // notifications: a full-height panel beside the rail, above everything (card pages included).
  // What needs you first, then today, then earlier. Tap one to open that exact jam; it's marked read.
  const NOTE_KIND = { needs_you: ['hand', 'warn', 'Needs you'], ready: ['check', 'ok', 'Ready'], live: ['zap', 'info', 'Live'], reading: ['trendup', 'info', 'Reading'], result: ['trendup', 'ok', 'Result'], update: ['done', '', 'Update'] };
  const noteRow = (n) => { const [icn, tone] = NOTE_KIND[n.kind] || NOTE_KIND.update, w = WORK.items.find((x) => x.id === n.itemId);
    return `<button class="np-row${n.read ? '' : ' is-unread'}" data-note="${esc(n.id)}" data-witem="${esc(n.itemId)}">
      <span class="np-ic${tone ? ' is-' + tone : ''}">${n.img ? `<img src="${esc(n.img)}" alt="">` : ''}<i>${ic(icn, 's14')}</i></span>
      <span class="np-tx"><b>${esc(plain(n.text))}</b><small>${esc(plain(n.title || w?.title || '').slice(0, 80))}${n.title || w ? ' · ' : ''}${ago(n.at)}</small>${n.more ? `<small class="np-more">+${n.more} earlier update${n.more > 1 ? 's' : ''}</small>` : ''}</span>${n.read ? '' : '<em class="np-dot" aria-label="Unread"></em>'}<span class="np-del" data-npdel="${esc(n.itemId || n.id)}" role="button" aria-label="Clear" title="Clear">${ic('x', 's14')}</span></button>`; };
  const paintNotes = () => { const pop = $('#pop.np'); if (!pop) return; const all = WORK.notes.slice(0, 40), now = SRV.clock || Date.now();
    // one row per jam: its newest note, with how many earlier ones it folds (readings would otherwise flood the list)
    const per = new Map(); all.forEach((n) => { const k = n.itemId || n.id; if (!per.has(k)) per.set(k, { ...n, more: 0, unread: n.read ? 0 : 1 }); else { const x = per.get(k); x.more++; if (!n.read) { x.unread++; x.read = false; } } });
    const rows = [...per.values()];
    const you = rows.filter((n) => !n.read && (n.kind === 'needs_you' || WORK.items.find((w) => w.id === n.itemId)?.stage === 'needs_you')), rest = rows.filter((n) => !you.includes(n));
    const today = rest.filter((n) => now - n.at < 864e5), older = rest.filter((n) => now - n.at >= 864e5);
    const grp = (name, list) => list.length ? `<section class="np-g"><h4>${name}<em>${list.length}</em></h4>${list.map(noteRow).join('')}</section>` : '';
    const unread = all.filter((n) => !n.read).length; // same count as the bell badge
    pop.innerHTML = `<header class="np-h"><div><b>Notifications</b><small>${unread ? `${unread} unread` : 'All caught up'}</small></div>${unread ? '<button class="np-all" data-allread>Mark all read</button>' : ''}${all.length ? '<button class="np-all" data-npclear>Clear all</button>' : ''}<button class="np-x" data-npx aria-label="Close">${ic('x', 's16')}</button></header>
      <div class="np-b">${all.length ? grp('Needs you', you) + grp('Today', today) + grp('Earlier', older) : `<div class="np-empty">${ic('bell')}<b>Nothing yet</b><span>When a teammate replies, something goes live or a result lands, it shows up here.</span></div>`}</div>
      <footer class="np-f"><button data-nav="work">${ic('board', 's16')}Open Work${ic('right', 's14')}</button></footer>`; };
  const openNotes = () => {
    if ($('#pop.np')) return closePop(); closePop();
    const pop = document.createElement('div'); pop.id = 'pop'; pop.className = 'np'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(pop); paintNotes();
    pop.addEventListener('click', async (e) => {
      if (e.target.closest('[data-npx]')) return closePop();
      const del = e.target.closest('[data-npdel]'); if (del) { e.stopPropagation(); e.preventDefault(); const id = del.dataset.npdel; WORK.notes = WORK.notes.filter((n) => n.itemId !== id && n.id !== id); WORK.unread = WORK.notes.filter((n) => !n.read).length; const w = WORK.items.find((x) => x.id === id); if (w) w.unread = false; counts(); paintNotes(); tapi('POST', '/api/tenants/:t/notes/clear', { itemId: id }); return; }
      if (e.target.closest('[data-npclear]')) { WORK.notes = []; WORK.unread = 0; WORK.items.forEach((w) => (w.unread = false)); counts(); paintNotes(); await tapi('POST', '/api/tenants/:t/notes/clear', {}); if (view === 'work') renderWork(); return; }
      if (e.target.closest('[data-nav]')) return closePop();
      if (e.target.closest('[data-allread]')) { await tapi('POST', '/api/tenants/:t/notes/read', {}); WORK.notes.forEach((n) => (n.read = true)); WORK.items.forEach((w) => (w.unread = false)); WORK.unread = 0; counts(); paintNotes(); if (view === 'work') renderWork(); else if (view === 'jams') renderJams(false); return; }
      const r = e.target.closest('[data-note]'); if (r) { const id = r.dataset.witem, mine = WORK.notes.filter((x) => x.itemId === id && !x.read); if (mine.length) { mine.forEach((x) => (x.read = true)); WORK.unread = Math.max(0, (WORK.unread || 0) - mine.length); counts(); tapi('POST', '/api/tenants/:t/notes/read', { ids: mine.map((x) => x.id), itemId: id }); } }
    }, true);
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#pop.np')) { e.stopImmediatePropagation(); closePop(); } }, true);
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-bell]'); if (b) { e.stopPropagation(); openNotes(b); } }, true);

  /* ---------- pulse: watchers post while you look; work items change while you're elsewhere ---------- */
  let pulseSince = 0, pulseT = 0;
  /* a tab in the background asks nothing (it polled /work every 6 s all day); it catches up the moment it is looked at */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pulseT) { clearTimeout(pulseT); pulseT = setTimeout(pulse, 300); } });
  const pulse = async () => {
    clearTimeout(pulseT);
    if (document.hidden) { pulseT = setTimeout(pulse, 60e3); return; }
    if (TID && S.onboarded) {
      await pullWork();
      if (view === 'feed' && pulseSince) { const r = await tapi('GET', `/api/tenants/:t/pulse?since=${pulseSince}`); const pill = $('#newpill');
        const ids = (r.ids || []).filter((id) => !PINNED.has(id));
        if (pill && ids.length) { NEWIDS = ids; pill.hidden = false; pill.innerHTML = `<button data-newcards>${ic('up', 's14')}${ids.length} new card${ids.length > 1 ? 's' : ''} · show</button>`; }
        if ((r.updated || []).length) await redrawTakes(r.updated); /* the take landed on the card it was asked from, same place in the feed */ }
    }
    pulseT = setTimeout(pulse, DP?.w && DP.w.stage === 'team' && window.BREW_DEMO ? 2500 : 10e3);
  };
  /* the open jam: every 3 s it says who's here (and typing) and comes back only when the jam changed, so a teammate's
     message, edit or new version shows up within seconds (the server marks it read for you) */
  let jamPollT = 0;
  let jamPollGen = 0; /* one loop only: a call while a poll is in flight supersedes it (two loops used to multiply the requests) */
  const jamPoll = async () => {
    clearTimeout(jamPollT); const gen = ++jamPollGen;
    /* the card page's jam, or the studio's (the jam page): the same heartbeat says you're here, marks what you've read and
       brings a teammate's message or version in either place */
    const inStudio = !DP && view === 'remix' && !!RX.p && !!RX.ch;
    const w = DP ? DP.p._work || workOfCard(DP.p.id) : inStudio ? workOfCard(RX.p.id) : null;
    if (w?.id && TID && !document.hidden) {
      const box = $(inStudio ? '#st-in' : '#jm-in'), typing = document.activeElement === box && !!box?.value.trim();
      const r = await tapi('GET', `/api/jams/${encodeURIComponent(w.id)}?since=${w.updatedAt || 0}${typing ? '&typing=1' : ''}`).catch(() => null);
      if (r && !r.error) { const changedHere = window.JamRoom?.setHere?.(w.id, r.here || []);
        if (inStudio) { if (view === 'remix' && workOfCard(RX.p?.id)?.id === w.id) await studioJamTick(r, changedHere); }
        else if (r.work) { putWork(r.work); counts(); repaintDetail(); } else if (changedHere) window.JamRoom?.paint?.(); }
    }
    if (gen !== jamPollGen) return; /* a newer call took over while this one waited */
    jamPollT = setTimeout(jamPoll, document.hidden ? 60e3 : 3000);
  };
  setTimeout(jamPoll, 3000);
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-newcards]'); if (!b) return;
    b.disabled = true; await tapi('POST', '/api/tenants/:t/pin', { ids: NEWIDS }); NEWIDS = [];
    await renderFeed(true);
    const first = $('.card.is-new'); (first || $('#col')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  /* the feed refreshes itself: every few minutes while it's open, and when you come back to it. New cards slide in
     at the top only while you're near the top; further down the "new cards" pill waits so nothing jumps under you */
  let lastFresh = Date.now(), freshing = false;
  const busyNow = () => !!(DP || $('#sv') || $('#modal') || document.activeElement?.matches?.('input, textarea, [contenteditable]'));
  const refreshFeed = async ({ force = false } = {}) => {
    if (freshing || view !== 'feed' || LANDING || !TID || (!force && (document.hidden || busyNow() || scrollY > 240))) return false;
    freshing = true;
    try { if (pulseSince) { const r = await tapi('GET', `/api/tenants/:t/pulse?since=${pulseSince}`); const ids = (r.ids || []).filter((id) => !PINNED.has(id)); if (ids.length) await tapi('POST', '/api/tenants/:t/pin', { ids }); }
      NEWIDS = []; const pill = $('#newpill'); if (pill) pill.hidden = true; await insertNew(); lastFresh = Date.now(); return true; }
    catch (e) { return false; } finally { freshing = false; }
  };
  setInterval(() => { if (Date.now() - lastFresh > 3 * 60e3) refreshFeed(); }, 30e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastFresh > 2 * 60e3) refreshFeed(); });
  // pull down at the top of the feed to refresh (touch screens)
  { let y0 = null, dy = 0; const bar = () => $('#ptr') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ptr', className: 'ptr', innerHTML: `<span class="ptr-i">${ic('down', 's16')}</span>` }));
    addEventListener('touchstart', (e) => { y0 = view === 'feed' && scrollY <= 0 && !busyNow() && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (scrollY > 0) { y0 = null; dy = 0; } const b = bar(); const d = Math.min(90, dy * .5);
      b.style.transform = `translate(-50%, ${d - 44}px)`; b.style.opacity = Math.min(1, d / 50); b.classList.toggle('is-ready', d >= 60); }, { passive: true });
    addEventListener('touchend', async () => { if (y0 == null) return; const b = $('#ptr'), go = b?.classList.contains('is-ready'); y0 = null;
      if (!b) return; if (!go) { b.style.transform = ''; b.style.opacity = 0; return; }
      b.classList.add('is-busy'); b.querySelector('.ptr-i').innerHTML = '<brew-load class="spin"></brew-load>'; b.style.transform = 'translate(-50%, 16px)';
      await refreshFeed({ force: true }); b.classList.remove('is-busy', 'is-ready'); b.querySelector('.ptr-i').innerHTML = ic('down', 's16'); b.style.transform = ''; b.style.opacity = 0; }); }

  /* =========================================================
     How it works: the engine behind the feed, live (engineering spec v13)
     ========================================================= */
  const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  /* money in the brand's own currency: lakh and crore for INR, K and M elsewhere */
  const MONEY = window.BREW_MONEY || { cur: 'INR', sym: '₹', locale: 'en-IN' }; if (!B.sym) B.sym = MONEY.sym;
  const inrS = (v) => MONEY.cur === 'INR' ? (v >= 1e7 ? `₹${+(v / 1e7).toFixed(1)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(1)} lakh` : `₹${Math.round(v).toLocaleString('en-IN')}`)
    : v >= 1e6 ? `${MONEY.sym}${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${MONEY.sym}${+(v / 1e3).toFixed(1)}K` : `${MONEY.sym}${Math.round(v).toLocaleString(MONEY.locale)}`;
  const renderView = () => ({ tune: renderTune, feed: renderFeed, saved: renderSaved, jams: () => renderJams(false), remixes: () => renderJams(false), refs: () => renderReferences(false), done: renderWork, work: renderWork, connectors: renderConnectors, deck: renderDeck, learned: renderLearned, heard: () => renderHeard(), facts: () => renderFacts(), moves: renderMoves, move: renderMove, remix: () => (RX.p ? openRemix(RX.p) : renderFeed()), queue: () => renderQueue() }[view] || renderFeed)();

  /* ---------- nav ---------- */
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) { const v = n.dataset.nav; closePop(); closeModal();
      if (v === 'deck' && !S.pro && PAYWALL) return openPlan('deck'); /* the Pro offer opens over where you are; closing it leaves you there, not on a #v=deck that isn't open */
      if (DP) closeDetail(true); $('#rxd')?.remove(); $('#rxd-scrim')?.remove(); RX.ch = null; VIEWS()[v](); const vh = v === 'feed' ? '' : `#v=${v}`; nav(vh || location.pathname, location.hash !== vh, 'view', v); window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-theme-btn]')) { setTheme(curTheme() === 'dark' ? 'light' : 'dark'); return; }
    if (e.target.closest('[data-open-jam]')) { openJam({ tab: 'ai' }); return; }
    /* Your seat (Tune): who the feed is for */
    if (e.target.closest('[data-r2-tune]')) { closePop(); closeModal(); $('#vw-pop')?.remove(); whoFor(); return; }
    /* Find more: the free watchers look now and what they find (else research you had not seen) lands at the top; nothing new is said plainly */
    const fm = e.target.closest('[data-find-more]'); if (fm) { fm.disabled = true; fm.innerHTML = '<brew-load class="spin"></brew-load>Looking'; (async () => { const r = await tapi('POST', '/api/tenants/:t/find-more');
      if (r?.error || r?.fallback) { const ok = await refreshFeed({ force: true }); toast(ok ? 'Pulled in the latest. New cards land at the top as your agents finish.' : 'Already refreshing. New cards land at the top.'); }
      else { if (r.made) { await insertNew(); window.scrollTo({ top: Math.max(0, ($('#col .card.is-new') || $('#col'))?.getBoundingClientRect().top + scrollY - 90), behavior: 'smooth' }); } toast(`${ic(r.made ? 'sparkles' : 'info', 's16')}${esc(r.message || (r.made ? 'New cards at the top.' : 'Nothing new right now.'))}`); }
      const b = $('[data-find-more]'); if (b) { b.disabled = false; b.innerHTML = `${ic('refresh', 's14')}Find more`; } })(); return; }
    const tpl = e.target.closest('[data-team-pill]'); if (tpl) { e.stopPropagation(); if ($('#pop.t2-pop')) return closePop(); closePop(); const it = WORK.withTeam?.items || [];
      const pop = document.createElement('div'); pop.id = 'pop'; pop.className = 'pop t2-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Briefs with the ShopOS team');
      pop.innerHTML = `<header><b>With the ShopOS team</b><small>Brew’s build crew: briefs you sent and where each one is</small></header>${it.map((x) => `<button class="t2-bi" data-witem="${esc(x.wid)}"><span class="t2-bt"><b>${esc(x.title || 'Brief')}</b><small>${esc([x.ticket, x.sentAt ? sentLine(x.sentAt) : '', x.at && x.at !== x.sentAt ? `${x.label || 'Updated'} ${ago(x.at)}` : ''].filter(Boolean).join(' · '))}</small></span><span class="t2-bs is-${esc(x.status)}">${esc(x.label || x.status)}</span></button>`).join('') || '<p class="t2-empty">Nothing with the team right now.</p>'}<footer><button class="linkbtn" data-nav="done">All briefs ${ic('right', 's14')}</button></footer>`;
      document.body.appendChild(pop); const r = tpl.getBoundingClientRect(); pop.style.top = `${r.bottom + 8}px`; pop.style.right = `${Math.max(12, innerWidth - r.right)}px`; return; }
    if (e.target.closest('[data-viewing]')) { openViewing(e.target.closest('[data-viewing]')); return; }
    const cx = e.target.closest('[data-cx]'); if (cx) { openConnect(cx.dataset.cx); return; }
    const la = e.target.closest('[data-lacct]'); if (la) { openAcct(la); return; }
    const s = e.target.closest('[data-story]'); if (s) { s.classList.add('seen'); openStory(s.dataset.story); }
  });

  /* ---------- viewing as: switch role, re-rank live ---------- */
  // a small menu under the "Viewing as" pill: one row per seat, the current one tinted
  const openViewing = (at) => {
    const ex = $('#vw-pop'); if (ex) { ex.remove(); return; }
    const anchor = at?.getBoundingClientRect ? at : $('[data-viewing]'), r = anchor?.getBoundingClientRect();
    const el = document.createElement('div'); el.id = 'vw-pop'; el.className = 'vw-pop'; el.setAttribute('role', 'menu');
    el.innerHTML = `<header><b>Viewing as</b><span>${mySeats() ? (mySeats().length > 1 ? 'The views your admin gave you.' : 'The view your admin gave you.') : 'Each seat gets its own ranking and headlines.'}</span></header>
      <div class="vw-list">${seatEntries().map(([k, rl]) => `<button class="vw-row${S.viewer.role === k ? ' is-on' : ''}" role="menuitemradio" aria-checked="${S.viewer.role === k}" data-pickrole="${k}"><span class="vw-ic">${face(rl.face)}</span><span class="vw-tx"><b>${esc(rl.title)}</b><small>${esc(rl.line)}</small></span>${S.viewer.role === k ? ic('check', 's16') : ''}</button>`).join('')}</div>
      <button class="vw-tune" data-tune-feed>${ic('sliders', 's16')}<span>Tune my feed</span>${ic('right', 's14')}</button>`;
    document.body.appendChild(el);
    if (!r?.width) { el.style.top = '72px'; el.style.left = `${Math.max(12, (innerWidth - el.offsetWidth) / 2)}px`; }
    else { const w = el.offsetWidth; el.style.top = `${r.bottom + 8}px`; el.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.right - w))}px`; }
    const close = () => { el.remove(); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key); };
    const out = (e) => { if (!el.contains(e.target) && !e.target.closest('[data-viewing]')) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key); }, 0);
    $$('[data-pickrole]', el).forEach((b) => b.onclick = () => { close(); if (b.dataset.pickrole !== S.viewer.role) setRole(b.dataset.pickrole); });
    $('[data-tune-feed]', el).onclick = () => { close(); whoFor(); };
    $('.vw-row.is-on', el)?.focus();
  };
  const setRole = (k) => {
    if (mySeats() && !mySeats().includes(k)) return;
    S.viewer.role = k; if (!S.viewer.wantsTouched) S.viewer.wants = defaultWants(k); save();
    if (view === 'deck') { colOrder(); buildDeck(); counts(); scrollToCol(ROLE().deckFirst); }
    else { window.scrollTo({ top: 0 }); renderFeed(true); }
    toast(`${face(ROLE().face)}Now viewing as ${esc(ROLE().title)}`);
  };

  /* ---------- menu: tune, connectors, demo controls, reset ---------- */
  // "3 of 7 connected", or nothing when none is (no zero counts anywhere)
  const cxCount = (short) => { const n = Object.keys(S.conn).filter(conn).length; return n ? `${n} of ${Object.keys(B.connectors).length}${short ? '' : ' connected'}` : ''; };
  /* ui=1 has no brand menu: the account popup holds what it did. Library, Fact sheet, Sounds, Add to home screen, Start again,
     and demo controls (demo site or Brew staff only); What Brew learned and Connectors only on phones (the rail has them on desktop). */
  const acctIt = (attr, icon, label, meta = '', cls = '') => `<button class="lc-it${cls}" ${attr}>${ic(icon, 's16')}<b>${label}</b>${meta ? `<span>${meta}</span>` : ''}</button>`;
  const acctRows = () => `<div class="lc-grp">${acctIt('data-nav="saved"', 'bookmark', 'Library', S.saved.length ? `${S.saved.length} saved` : '')}${acctIt('data-nav="learned"', 'book', 'What Brew learned', '', ' lc-phone')}${acctIt('data-nav="facts"', 'doc', 'Fact sheet')}${acctIt('data-nav="connectors"', 'plug', 'Connectors', cxCount(true), ' lc-phone')}</div>
    <div class="lc-grp">${acctIt('data-acct="sound"', 'bell', 'Sounds', `<i class="sw" aria-checked="${SND.on}" aria-hidden="true"><i></i></i>`)}${isStandalone() ? '' : acctIt('data-acct="install"', 'phone', 'Add to home screen')}</div>
    <div class="lc-grp">${demoOk() ? acctIt('data-acct="demo"', 'sliders', 'Demo controls', 'Press .') : ''}${acctIt(`data-acct="restart" title="${window.BREW_DEMO ? 'Reset the demo and start from the website' : 'Clears what this browser kept for this feed and goes back to the first page. Your saved cards stay with your account'}"`, 'link', 'Start again')}</div>`;
  const acctBind = (pop) => pop.addEventListener('click', (e) => { const t = e.target.closest('[data-acct],[data-nav]'); if (!t) return; const k = t.dataset.acct;
    if (k === 'sound') { SND.on = !SND.on; ls.set(`${LSP()}sound`, SND.on ? 'on' : 'off'); t.querySelector('.sw')?.setAttribute('aria-checked', SND.on); if (SND.on) sound('approve'); return; }
    pop.remove(); if (k === 'install') openInstall(); if (k === 'setup') start(); if (k === 'demo') openDemo(); if (k === 'restart') startAgain(); });
  window.BrewAcct = { rows: acctRows, bind: acctBind };
  const openAcct = (btn) => { if (window.LiveConn && (window.LIVE?.signin || window.LIVE?.me)) return window.LiveConn.menu(btn);
    document.getElementById('lc-pop')?.remove(); const pop = document.createElement('div'); pop.id = 'lc-pop'; pop.className = 'lc-pop';
    const r = btn.getBoundingClientRect(); pop.style.left = (r.right + 10) + 'px'; pop.style.bottom = Math.max(12, innerHeight - r.bottom) + 'px';
    pop.innerHTML = `<div class="lc-me"><span><b>${esc(B.brand.name)}</b><small>Viewing as ${esc(ROLE().name)}</small></span></div>${acctRows()}${window.LiveConn?.helpRows?.() || ''}`;
    document.body.appendChild(pop); acctBind(pop); pop.querySelector('[data-ldelete]')?.addEventListener('click', () => { pop.remove(); window.LiveConn?.deleteSheet?.(); });
    setTimeout(() => document.addEventListener('click', function off(e) { if (!pop.contains(e.target) && !btn.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0); };
  // wipe everything this demo keeps in the browser (state, workspace, shared-link owner) and land on the website step
  const resetDemo = () => { if (window.BREW_DEMO) return demoStart('onboarding'); wiping = true; closeModal();
    try { Object.keys(localStorage).filter((k) => k.startsWith(`${LSP()}`)).forEach((k) => ls.del(k)); } catch (e) { ls.del(KEY); ls.del(`${LSP()}tenant`); ls.del(`${LSP()}tenant-own`); }
    location.replace(location.pathname); };
  /* demo controls: the demo site, or Brew staff (LIVE.full) on the live site; nothing else opens them */
  const demoOk = () => !!(window.BREW_DEMO || window.LIVE?.full);
  /* Start again (the live site): forget what this browser kept for this brand (onboarding done, workspace, continue, born) and go
     back to the first page, where a link is pasted and the read, the fetching screen and the setup play again. Nothing on the
     server changes, nobody is signed out, other brands' keys are untouched. The demo site keeps its own reset. */
  const startAgain = () => { if (window.BREW_DEMO) return resetDemo(); wiping = true; closeModal();
    /* by exact key, never by prefix: brand "x" must not wipe brand "x-in" */
    [KEY, ...['tenant', 'tenant-own', 'continue', 'born'].map((k) => LSP() + k)].forEach((k) => ls.del(k));
    location.replace('/'); };

  let aiMode = 'mock';
  api(`/api/config?brand=${encodeURIComponent((B && B.slug) || BR || '')}`).then((c) => { aiMode = c.ai || 'mock';
    /* the AI credit is out (ai.js pause): say so once per visit, rather than letting chats and drafts fail quietly */
    let seen = false; try { seen = !!sessionStorage.getItem('brew-paused'); sessionStorage.setItem('brew-paused', c.paused ? '1' : ''); } catch {}
    if (c.paused && !seen) { setTimeout(() => toastLong(`${ic('info', 's16')}Brew’s writing is paused for a while. Everything here still opens; new replies, drafts and rewrites wait until it’s back.`, 12000), 1500); }
    /* this brand's share of today's budget (server budget.js) is used up: say which part, once per visit, instead of drafts failing quietly */
    const NOUN = { text: 'writing', image: 'pictures', video: 'videos', voice: 'voiceovers' }, out = Object.entries(c.share || {}).filter(([, x]) => x && x.out).map(([k, x]) => [NOUN[k] || k, x.out]);
    let told = false; try { told = sessionStorage.getItem('brew-share') === out.map((x) => x.join(':')).join(','); sessionStorage.setItem('brew-share', out.map((x) => x.join(':')).join(',')); } catch {}
    if (out.length && !told && !c.paused) { const mine = out.filter(([, w]) => w === 'brand').map(([n]) => n), all = out.filter(([, w]) => w === 'all').map(([n]) => n);
      const sayLater = (f) => (['setup', 'ob'].includes(view) || $('#qfull') ? setTimeout(() => sayLater(f), 4000) : f()); /* never over the read or the questions: it waits for the feed */
      /* said when someone goes to make something, not as a 12-second overlay on the first screen (QA UI 20 Oct) */
      const msg = `${ic('info', 's16')}${mine.length ? `This brand’s share of today’s ${mine.join(' and ')} is used up. ` : ''}${all.length ? `Brew’s budget for ${all.join(' and ')} is used up today across all brands. ` : ''}It resets at midnight UTC; everything else still works.`;
      const onMake = (e) => { if (!e.target.closest?.('[data-jm-make],[data-cv-ask],[data-cta-make],.jm-go')) return; document.removeEventListener('click', onMake, true); setTimeout(() => toastLong(msg, 7000), 300); };
      document.addEventListener('click', onMake, true); void sayLater; } }).catch(() => {});
  /* ---------- the demo site (DEMO_MODE): a session per visitor, its accounts are demo accounts the server connects ---------- */
  const DSLUG = () => B.slug || BR;
  const clearLocal = () => { wiping = true; try { Object.keys(localStorage).filter((k) => k.startsWith(LSP())).forEach((k) => ls.del(k)); } catch (e) {} };
  const demoStart = async (from) => { closeModal(); clearLocal(); await fetch(`/api/demo/${DSLUG()}/start?d=new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, connect: from === 'feed' ? 'all' : null }) }).catch(() => {});
    if (from === 'feed') ls.set(KEY, JSON.stringify({ onboarded: true })); location.replace(`/${DSLUG()}`); };
  /* no page load: a reload would restart the onboarding. The accounts are read again and the screen you are on repaints */
  const demoConnect = async (ids, on = true) => { closeModal(); const what = ids === 'all' ? 'every account' : esc(B.connectors[ids[0]]?.name || ids[0]);
    toast(`<brew-load class="spin"></brew-load>${on ? 'Connecting' : 'Disconnecting'} ${what}`); await api(`/api/demo/${DSLUG()}/connect`, { ids, on });
    const L2 = await fetch(`/api/brands/${DSLUG()}/live`, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
    if (L2 && window.LIVE) { Object.assign(window.LIVE, L2); window.LiveConn?.overlay(B, S); }
    for (const id of ids === 'all' ? Object.keys(B.connectors) : ids) S.conn[id] = on;
    save();
    if (view === 'ob') $$('[data-cxrow]').forEach((r) => (r.outerHTML = cxRow(r.dataset.cxrow))); else await refreshAfterConnect();
    toast(`${ic('check', 's16')}${what[0].toUpperCase() + what.slice(1)} ${on ? 'connected' : 'disconnected'}`); };
  const openDemoSite = async () => { const ses = await api(`/api/demo/${DSLUG()}/session`).catch(() => null); const on = new Set(ses?.connected || []);
    modal(`<div class="sheet pick-sheet demo"><b class="sh-t">Demo controls</b><p class="sh-p">This is a demo of ${esc(B.brand.name)}. Moves, PDFs and drafts are ready; connected accounts are demo accounts built from ${esc(B.brand.host || 'the store')}'s real products and prices. Everything else is live.</p>
      <h4>Start again</h4><div class="row2"><button class="btn btn-primary sm" data-x="onboarding">From onboarding</button><button class="btn btn-ghost sm" data-x="feed">Straight to the connected feed</button></div>
      <h4>Jump to</h4><div class="row2"><button class="btn btn-ghost sm" data-x="j-setup">The read</button><button class="btn btn-ghost sm" data-x="j-check">Check what we read</button><button class="btn btn-ghost sm" data-x="j-wait">Moves being written</button><button class="btn btn-ghost sm" data-x="j-feed">Feed</button><button class="btn btn-ghost sm" data-x="j-moves">Moves</button><button class="btn btn-ghost sm" data-x="j-cx">Connectors</button></div>
      <h4>Accounts</h4><div class="sugg">${(ses?.all || []).filter((k) => B.connectors[k] || ['slack', 'linear', 'asana', 'notion'].includes(k)).map((k) => `<button class="chip" data-dcx="${k}" aria-pressed="${on.has(k)}">${esc(B.connectors[k]?.name || k[0].toUpperCase() + k.slice(1))}</button>`).join('')}</div>
      <div class="row2"><button class="btn btn-ghost sm" data-x="all">Connect all</button><button class="btn btn-ghost sm" data-x="none">Disconnect all</button></div>
      <h4>Seat</h4><div class="sugg">${seatEntries().map(([k, r]) => `<button class="chip" data-d-role="${k}" aria-pressed="${S.viewer.role === k}">${esc(r.name)}</button>`).join('')}</div>
      <h4>Time</h4><div class="row2"><button class="btn btn-ghost sm" data-x="day">Skip a day</button><button class="btn btn-ghost sm" data-x="week">Skip a week</button><button class="btn btn-ghost sm" data-x="run">Run all watchers now</button></div>
      <h4>Share</h4><div class="row2"><button class="btn btn-ghost sm" data-x="share">Copy a link to this demo</button><a class="btn btn-ghost sm" href="/">Other brands</a></div></div>`, (m) => {
      $$('[data-d-role]', m).forEach((b) => b.onclick = () => { closeModal(); setRole(b.dataset.dRole); });
      $$('[data-dcx]', m).forEach((b) => b.onclick = () => demoConnect([b.dataset.dcx], b.getAttribute('aria-pressed') !== 'true'));
      $$('[data-x]', m).forEach((b) => b.onclick = async () => { const x = b.dataset.x;
        if (x === 'onboarding' || x === 'feed') return demoStart(x);
        if (x === 'all' || x === 'none') return demoConnect('all', x === 'all');
        closeModal();
        if (x === 'j-setup') { await ensureTenant(true); return setup(); } if (x === 'j-check') { await ensureTenant(true); return checkRead(); } if (x === 'j-wait') return waitMoves({ stay: true });
        if (x === 'j-feed') { S.onboarded = true; save(); $$('.ready').forEach((r) => r.remove()); if (!$('#view')) appShell(); if (location.hash) nav(location.pathname, true, 'view', 'feed'); return renderFeed(); }
        if (x === 'j-moves' || x === 'j-cx') { const v = x === 'j-moves' ? 'moves' : 'connectors'; S.onboarded = true; save(); $$('.ready').forEach((r) => r.remove()); if (!$('#view')) appShell(); nav(`#v=${v}`, true, 'view', v); VIEWS()[v](); window.scrollTo(0, 0); return; }
        const more = (r) => (r?.pending ? '. The creative agent is writing one more' : '');
        if (x === 'day' || x === 'week') { toast(`<brew-load class="spin"></brew-load>Skipping ${x === 'day' ? 'a day' : 'a week'}`); const r = await tapi('POST', '/api/tenants/:t/clock', { days: x === 'day' ? 1 : 7 }); toast(`${ic('clock', 's16')}${x === 'day' ? 'A day' : 'A week'} later: ${r.made || 0} new cards${more(r)}`); if ($('#view')) renderView(); return; }
        if (x === 'run') { toast('<brew-load class="spin"></brew-load>Running every watcher'); const r = await tapi('POST', '/api/tenants/:t/watchers/run-all'); toast(`${ic('check', 's16')}${r.made || 0} cards proposed by the watchers${more(r)}`); if (view === 'feed') renderFeed(); return; }
        if (x === 'share') { try { await navigator.clipboard.writeText(ses.share); toast(`${ic('check', 's16')}Link copied. Whoever opens it sees this demo as it is now.`); } catch (e) { toastLong(esc(ses.share), 8000); } }
      }); }); };
  const openDemo = () => !demoOk() ? undefined : window.BREW_DEMO ? openDemoSite() : modal(`<div class="sheet pick-sheet demo"><b class="sh-t">Demo controls</b><p class="sh-p">For whoever is presenting. Changes apply instantly and skip the connect sheets.</p>
      <h4>Seat</h4><div class="sugg">${seatEntries().map(([k, r]) => `<button class="chip" data-d-role="${k}" aria-pressed="${S.viewer.role === k}">${esc(r.name)}</button>`).join('')}</div>
      <h4>Connectors</h4><div class="sugg">${Object.entries(B.connectors).map(([k, c]) => `<button class="chip" data-d-cx="${k}" aria-pressed="${conn(k)}">${esc(c.name)}</button>`).join('')}</div>
      <div class="row2"><button class="btn btn-ghost sm" data-d="all">Connect all</button><button class="btn btn-ghost sm" data-d="none">Disconnect all</button><button class="btn btn-ghost sm" data-d="pro">${S.pro ? 'Pro is on' : 'Turn on Pro'}</button></div>
      <h4>AI</h4><div class="sugg"><button class="chip" data-d-ai="live" aria-pressed="${aiMode === 'live'}">Live (Claude + Gemini)</button><button class="chip" data-d-ai="mock" aria-pressed="${aiMode === 'mock'}">Mock (free, scripted)</button></div>
      <h4>Agents and time</h4><div class="row2"><button class="btn btn-ghost sm" data-d="run">Run all watchers now</button><button class="btn btn-ghost sm" data-d="day">Skip ahead a day</button><button class="btn btn-ghost sm" data-d="research">Refresh research (~$0.50)</button></div>
      <h4>Jump to</h4><div class="row2"><button class="btn btn-ghost sm" data-d="start">Onboarding</button><button class="btn btn-ghost sm" data-d="feed">Feed</button><button class="btn btn-ghost sm" data-d="deck">Deck</button></div>
      <button class="btn btn-primary sm" data-d="reset" style="margin-top:6px">Reset demo</button></div>`, (m) => {
    $$('[data-d-role]', m).forEach((b) => b.onclick = () => { closeModal(); setRole(b.dataset.dRole); });
    $$('[data-d-cx]', m).forEach((b) => b.onclick = () => { const k = b.dataset.dCx; S.conn[k] = !conn(k); save(); b.setAttribute('aria-pressed', conn(k)); refreshAfterConnect(); });
    $$('[data-d-ai]', m).forEach((b) => b.onclick = async () => { const r = await api('/api/config', { ai: b.dataset.dAi }); aiMode = r.ai; $$('[data-d-ai]', m).forEach((x) => x.setAttribute('aria-pressed', x.dataset.dAi === aiMode)); toast(aiMode === 'live' ? 'AI is live' : 'AI is on mock'); });
    $$('[data-d]', m).forEach((b) => b.onclick = async () => { const d = b.dataset.d;
      if (d === 'research') { closeModal(); await api('/api/research/refresh', {}); toast(`${ic('refresh', 's16')}Researching ads, trends, news and how-tos. The rings update in a few minutes.`); return; }
      if (d === 'run') { closeModal(); const r = await tapi('POST', '/api/tenants/:t/watchers/run-all'); toast(`${ic('check', 's16')}${r.made} cards proposed by the watchers`); if (view === 'feed') renderFeed(); return; }
      if (d === 'day') { closeModal(); const r = await tapi('POST', '/api/tenants/:t/clock', { days: 1 }); toast(`${ic('clock', 's16')}A day later: ${r.made} new cards, free quota reset`); renderView(); return; }
      if (d === 'all' || d === 'none') { Object.keys(B.connectors).forEach((k) => (S.conn[k] = d === 'all')); save(); closeModal(); refreshAfterConnect(); }
      if (d === 'pro') { S.pro = true; save(); b.textContent = 'Pro is on'; refreshAfterConnect(null, 'pro'); }
      if (d === 'start') { closeModal(); start(); } if (d === 'feed') { closeModal(); if (!$('#view')) appShell(); renderFeed(); } if (d === 'deck') { closeModal(); if (!$('#view')) appShell(); S.pro = true; renderDeck(); }
      if (d === 'reset') resetDemo(); });
  });
  addEventListener('keydown', (e) => { if (e.key === '.' && demoOk() && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) openDemo(); });

  /* =========================================================
     Connectors: a dummy OAuth sheet, a streamed sync, then what changed
     ========================================================= */
  // after a connect (or disconnect): the server learns it, then the feed, the work, the open card page and the jam all refetch
  let refreshing = null;
  const refreshAfterConnect = (id, why) => refreshing ||= (async () => {
    if (!$('#view')) return;
    const before = new Set(FEED.map((p) => p.id));
    try { await loadFeed(); await pullWork(true); } catch (e) {}
    if (view === 'deck' && document.body.classList.contains('deck-on')) buildDeck(); else if (view === 'deck') await renderFeed(); else await renderView(); counts();
    if (DP?.p) { const fresh = ALL[DP.p.id] || byId(DP.p.id); if (fresh) DP.p = fresh; if (String(DP.p.id).startsWith('work:')) { const w = WORK.items.find((x) => 'work:' + x.id === DP.p.id); if (w) DP.p = pseudoPost(w); } if (DP.w) DP.w = WORK.items.find((x) => x.id === DP.w.id) || DP.w; repaintDetail(true); window.JamRoom?.paint?.(); }
    if (why === 'pro') { const added = FEED.filter((p) => !before.has(p.id)).length; toast(`${ic('sparkles', 's16')}You’re on Pro. ${added ? `${added} more card${added > 1 ? 's' : ''} in your feed, and every agent posts all day.` : 'Every agent now posts all day.'}`); }
    if (id && B.connectors[id]) { const added = FEED.filter((p) => !before.has(p.id)).length, live = FEED.filter((p) => p.live?.[id]).length;
      sound('connected'); toast(`${ic('check', 's16')}${esc(B.connectors[id].name)} connected. Refreshed with ${B.connectors[id].demo ? 'the demo account’s estimated numbers' : 'your real numbers'}${live ? `: ${live} card${live > 1 ? 's' : ''} now live` : ''}${added ? `, ${added} new` : ''}.`); }
  })().finally(() => { refreshing = null; });
  const openConnect = (id, opts = {}) => {
    const c = B.connectors[id]; if (!c) return;
    if (conn(id)) { opts.then?.(); return; }
    /* the live site connects real accounts through live.js only: never the sample sign-in sheet, never S.conn set by hand */
    if (!window.BREW_DEMO) { if (window.LiveConn?.open(id, { ...opts })) return; toast(`${ic('info', 's16')}${window.LiveConn && !window.LiveConn.isReady?.() || window.LIVE?.off ? 'Connecting isn’t available here.' : 'Couldn’t reach Brew. Reload and try again.'}`); return; }
    if (!opts.demo && window.LiveConn?.open(id, { ...opts, demo: () => openConnect(id, { ...opts, demo: true }) })) return;
    const onboarding = view === 'ob';
    modal(`<div class="sheet cx-sheet">
      <div class="cx-step" data-s="1">
        <div class="cx-pair"><span class="cx-so">${SO()}</span><span class="cx-link" aria-hidden="true"><i></i><i></i><i></i></span>${glyph(id, 52)}</div>
        <header class="cx-head"><h3>Connect ${esc(c.name)}</h3>${opts.why ? `<p>${esc(opts.why)}</p>` : `<p>Brew reads it to put your real numbers on the cards.</p>`}</header>
        <div class="cx-box">
          <label class="cx-acct"><input type="radio" checked name="acct">${glyph(id, 32)}<span class="cx-acct-t"><b>${esc(c.account)}</b><small>${esc(B.brand.name)} · ${esc(B.brand.tagline || B.brand.host)}</small></span><i class="cx-tick">${ic('check', 's14')}</i></label>
          <div class="cx-can"><small>Brew will be able to</small><ul class="cx-perms">${c.perms.map((p) => `<li>${ic('check', 's14')}<span>${esc(p)}</span></li>`).join('')}</ul></div></div>
        ${id === 'slack' ? `<div class="cx-chan"><small>Post jams to</small>${['#growth', '#brand', '#d2c-ops', '#founders'].map((ch) => `<button class="chip" data-chan="${ch}" aria-pressed="${S.slack.channel === ch}">${ch}</button>`).join('')}</div>` : ''}
        <div class="cx-btns"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-allow>Allow access</button></div>
        <small class="cx-fine">${ic('lock', 's14')}<span>${opts.demo ? 'Demo account: numbers built from what we read. Nothing touches a real account.' : 'Demo workspace. Nothing leaves this page.'}</span></small>
      </div>
      <div class="cx-step" data-s="2" hidden><div class="cx-pair sm">${glyph(id, 36)}<b>Connecting ${esc(c.name)}</b></div><ol class="cx-log"></ol></div>
      <div class="cx-step" data-s="3" hidden><span class="plan-check">${ic('check')}</span><h3>${esc(c.name)} is connected</h3>
        ${(c.stats || []).length ? `<div class="cx-read"><small>What Brew read${c.demo ? ' <em>Demo account</em>' : ''}</small><dl>${c.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>` : ''}
        <p class="sh-p">Here is what changed in your feed:</p>
        <ul class="cx-changed">${((c.demo && c.changedDemo?.length) ? c.changedDemo : c.changed).map((t) => `<li>${ic('sparkles', 's14')}${esc(t)}</li>`).join('')}</ul>
        <button class="btn btn-primary" data-see>${onboarding ? 'Continue' : opts.then ? 'Carry on' : 'See it in the feed'}</button></div></div>`, (m) => {
      $$('[data-chan]', m).forEach((b) => b.onclick = () => { S.slack.channel = b.dataset.chan; $$('[data-chan]', m).forEach((x) => x.setAttribute('aria-pressed', x === b)); save(); });
      $('[data-allow]', m).onclick = async () => {
        $('[data-s="1"]', m).hidden = true; $('[data-s="2"]', m).hidden = false;
        const log = $('.cx-log', m);
        for (const line of c.log) { log.insertAdjacentHTML('beforeend', `<li><brew-load class="spin"></brew-load>${esc(line)}</li>`); await wait(620); const li = log.lastElementChild; li.firstElementChild.outerHTML = ic('check', 's14'); }
        await wait(300);
        S.conn[id] = true; save();
        // the feed refreshes now, whether or not they tap the button (closing the sheet must not leave stale numbers)
        const done = onboarding ? Promise.resolve() : refreshAfterConnect(id);
        $('[data-s="2"]', m).hidden = true; $('[data-s="3"]', m).hidden = false;
        $('[data-see]', m).onclick = () => {
          closeModal();
          if (onboarding) { $$(`[data-cxrow="${id}"]`).forEach((r) => (r.outerHTML = cxRow(id))); return; }
          if (opts.then) { done.then(() => opts.then()); return; }
          done.then(() => highlightConnected(id));
        };
      };
    });
  };
  const highlightConnected = (id) => {
    if (view !== 'feed') return;
    const ids = B.posts.filter((p) => p.onlyWhen === id || p.live?.[id]).map((p) => p.id);
    const first = ids.map((x) => $(`#col .card[data-id="${x}"]`)).filter(Boolean);
    first.forEach((c) => { c.classList.add('is-new'); setTimeout(() => c.classList.remove('is-new'), 2600); });
    if (first[0]) first[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`${ic('check', 's16')}${esc(B.connectors[id].name)} is live. ${first.length} card${first.length === 1 ? '' : 's'} changed.`);
  };

  /* =========================================================
     Library views: Saved, My jams, Approved and shipped, Connectors
     ========================================================= */
  const libShell = (title, sub, inner) => {
    view = view; document.body.classList.remove('deck-on'); $('#stk').innerHTML = ''; $('#notes').innerHTML = '';
    $$('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', 'false'));
    $('#view').innerHTML = `<div class="feedcol" id="col"><div class="lib-head"><h2>${title}</h2><p>${sub}</p></div>${inner}</div>`; counts();
  };
  /* the Library: one wide page, three tabs. Each tab is cut into categories you can jump to with a chip;
     every category is a grid of compact tiles, two rows at a time, so nothing scrolls for ever */
  let REMIXES = null;
  const pullRemixes = async () => { const r = await tapi('GET', '/api/tenants/:t/remixes'); if (!r.error) REMIXES = r.remixes || []; return REMIXES || []; };
  const JAM_DONE = ['shared'];
  const LIB = { cat: { saved: 'all', jams: 'all', remixes: 'all' }, open: new Set(), scope: null /* jams: mine | team */ };
  const libTabs = (k) => { const tabs = [['saved', 'Saved', S.saved.length], ['jams', window.BREW_DEMO ? 'My jams' : 'Jams', WORK.items.filter((w) => !JAM_DONE.includes(w.stage)).length], ['refs', 'References', REFS.items ? REFS.items.length : '']];
    return `<div class="lib-seg" role="tablist">${tabs.map(([v, n, c]) => `<button role="tab" data-nav="${v}" aria-selected="${k === v}">${n}${c !== '' && +c !== 0 ? `<em>${c}</em>` : ''}</button>`).join('')}</div>`; }; /* no "0" counts on the tabs (quiet rule) */
  const libEmpty = (icon, h, s) => `<div class="lib-empty"><span class="le-ic">${ic(icon)}</span><b>${h}</b><span>${s}</span><button class="btn btn-ghost sm" data-nav="feed">Go to the feed</button></div>`;
  // cats: [{ k, name, hint, items: [html], tone }]; the chips filter, "all" shows every category two rows deep
  const libGrid = (tab, cats, empty, extra = '') => {
    const live = cats.filter((c) => c.items.length); if (!live.length) return empty;
    const cur = live.some((c) => c.k === LIB.cat[tab]) ? LIB.cat[tab] : 'all', total = live.filter((c) => !c.hideInAll).reduce((n, c) => n + c.items.length, 0);
    const chips = `<div class="lib-cats">${[{ k: 'all', name: 'All', items: { length: total } }, ...live].map((c) => `<button class="lib-cat${c.tone ? ' is-' + c.tone : ''}" data-lcat="${tab}:${c.k}" aria-pressed="${cur === c.k}">${esc(c.name)}<em>${c.items.length}</em></button>`).join('')}${extra}</div>`;
    const cap = 6;
    const sec = (c) => { const key = tab + ':' + c.k, all = cur !== 'all' || LIB.open.has(key) || c.items.length <= cap + 1;
      return `<section class="lib-sec${c.tone ? ' is-' + c.tone : ''}"><header><b>${esc(c.name)}</b><em>${c.items.length}</em>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</header>
        <div class="lt-grid">${(all ? c.items : c.items.slice(0, cap)).join('')}</div>
        ${all ? '' : `<button class="lib-more" data-lmore="${key}">Show all ${c.items.length}${ic('right', 's14')}</button>`}</section>`; };
    const shown = cur === 'all' ? live.filter((c) => !c.hideInAll) : live.filter((c) => c.k === cur);
    return chips + (shown.length ? shown.map(sec).join('') : empty);
  };
  const libPage = (k, sub, inner) => { libShell('Library', sub, libTabs(k) + `<div class="lib-body">${inner}</div>`); $('#col')?.classList.add('lib-col'); };
  const FAM_IC = { meta_ad: 'megaphone', meta_ops: 'sliders', crm: 'send', store: 'grid', vis: 'sparkles', search: 'link', listing: 'grid', decision: 'check', brief: 'book', setup: 'cpu', print: 'book' };
  const thumb = (img, agent, icon) => `<span class="lr-th" data-agent="${esc(agent || 'brew')}"><i>${ic(icon || 'sparkles', 's16')}</i>${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}</span>`;
  const plain = (s) => String(s || '').replace(/\{\{?\s*[\w.]+\s*\}?\}/g, '').replace(/\s+([,.!?।])/g, '$1').replace(/^[\s,.]+/, '').replace(/\s{2,}/g, ' ').trim();
  // a tile: thumbnail + eyebrow + time, a two-line title, one line of context, a footer with who/where and the state
  const tile = ({ attr, img, agent, icon, eyebrow, title, line, who, pill, when, dot, menu, off }) => `<button class="lt${dot ? ' is-unread' : ''}${off ? ' is-off' : ''}" ${attr}>
      <span class="lt-top">${thumb(img, agent, icon)}<span class="lt-eb">${eyebrow}</span><span class="lt-when">${when || ''}</span>${menu ? `<span class="lt-menu" role="button" tabindex="0" aria-label="More" data-lmenu="${menu}">${ic('more', 's16')}</span>` : ''}</span>
      <b class="lt-t" title="${esc(plain(title))}">${esc(plain(title))}</b>${line ? `<span class="lt-l">${line}</span>` : ''}
      <span class="lt-f"><span class="lt-who">${who || ''}</span>${pill || ''}</span></button>`;
  const pillOf = (txt, tone) => `<span class="lr-pill${tone ? ' is-' + tone : ''}">${esc(txt)}</span>`;
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-lcat]'); if (c) { const [tab, k] = c.dataset.lcat.split(':'); LIB.cat[tab] = k; VIEWS()[tab](false); return; }
    const m = e.target.closest('[data-lmore]'); if (m) { LIB.open.add(m.dataset.lmore); VIEWS()[m.dataset.lmore.split(':')[0]](false); }
  });

  const renderSaved = () => {
    view = 'saved';
    const list = S.saved.map(byId).filter(Boolean); FEED = [];
    const row = (p) => { const c = cardOf(p); return tile({ attr: `data-lsaved="${esc(p.id)}"`, img: p.images?.[0], agent: p.agent, icon: 'bookmark', eyebrow: esc(fromLabel(c)), when: esc(p.time || ''),
      title: c.title, line: esc(plain(c.sub || '')), who: p.cta?.label ? `${ic('right', 's14')}${esc(p.cta.label)}` : '', pill: B.spends.includes(p.cta?.label) ? pillOf('Spends money', 'warn') : '' }); };
    const agents = [...new Set(list.map((p) => p.agent))];
    const cats = agents.map((a) => ({ k: a, name: AGENT[a] || a, items: list.filter((p) => p.agent === a).map(row) }));
    libPage('saved', 'Cards you kept for later. Open one, jam on them together, or send the brief to the ShopOS team.',
      libGrid('saved', cats, libEmpty('bookmark', 'Nothing saved yet', 'Tap the bookmark on any card to keep it here.'),
        list.length ? `<span class="lib-acts"><button class="btn btn-ghost sm" data-bulk="jam">${ic('hand', 's16')}Jam on all</button><button class="btn btn-primary sm" data-bulk="team">${ic('send', 's16')}Send brief</button></span>` : ''));
    $$('[data-bulk]').forEach((b) => b.onclick = () => openJam({ bulk: list, tab: b.dataset.bulk === 'team' ? 'team' : 'ai' }));
    $$('[data-lsaved]').forEach((b) => b.onclick = () => { const p = byId(b.dataset.lsaved); if (p) openDetail(p); });
    if (!REMIXES) pullRemixes().then(() => { if (view === 'saved') $('.lib-seg')?.replaceWith(htmlEl(libTabs('saved'))); });
  };
  const htmlEl = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
  // grouped by where the work is now (same as the Work board), not by who it was with last
  const withKind = (w) => w.stage === 'team' ? 'team' : w.stage === 'shared' ? 'shared' : 'ai';
  /* team jams (not the demo site): the real people in it, and who has it */
  const pInit = (p) => (p?.name || p?.email || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
  const pHue = (e) => [...String(e || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  const pAv = (p, n = 18) => p?.pic ? `<img class="av av-img" src="${esc(p.pic)}" alt="" referrerpolicy="no-referrer" style="width:${n}px;height:${n}px;border-radius:50%">` : `<span class="av" style="--ac:hsl(${pHue(p?.email)} 38% 42%);width:${n}px;height:${n}px;border-radius:50%;font-size:${Math.max(8, Math.round(n * 0.4))}px">${esc(pInit(p))}</span>`;
  const firstOf = (p) => String(p?.name || p?.email || '').trim().split(/\s+/)[0].replace(/@.*/, '');
  const realWho = (w) => { const me = String(ME()?.email || '').toLowerCase(), ppl = (w.people || []), others = ppl.filter((x) => x.email !== me);
    if (w.assignee) return `${pAv(w.assignee)}${w.assignee.email === me ? (w.assignee.ask === 'approve' ? 'Needs your OK' : 'You have it') : esc(firstOf(w.assignee)) + (w.assignee.ask === 'approve' ? '’s OK' : ' has it')}`;
    if (!others.length) return `${ic('sparkles', 's14')}${ppl.length ? 'You and AI' : 'AI'}`;
    return `<span class="lt-faces">${others.slice(0, 3).map((x) => pAv(x)).join('')}</span>${esc(others.slice(0, 2).map(firstOf).join(', '))}${others.length > 2 ? ` +${others.length - 2}` : ''}${ppl.some((x) => x.email === me) ? ' and you' : ''}`; };
  const jamWho = (w) => window.BREW_DEMO ? jamWho0(w) : realWho(w);
  const jamWho0 = (w) => ({ team: `${ic('send', 's14')}${esc(w.with?.name || 'Your team')} on Slack`, shared: `${ic('copy', 's14')}Brief shared${w.ticket ? ' · ' + esc(w.ticket) : ''}`, ai: `${ic('sparkles', 's14')}You and AI` })[withKind(w)];
  const jamLast = (w) => { const m = (w.thread || []).filter((x) => x.body).slice(-1)[0]; if (m) return `<i>${m.from === 'me' ? (m.by && m.by.email !== String(ME()?.email || '').toLowerCase() ? esc(firstOf(m.by)) : 'You') : esc(m.who || AGENT[m.from] || 'Brew')}:</i> ${esc(plain(m.body))}`; return esc(plain(curV(w)?.sub || '') || 'Brief started'); };
  const STAGE_PILL = { needs_you: ['Needs you', 'warn'], ready: ['Ready to share', 'ok'], shared: ['Brief shared', 'ok'], team: ['With your team', ''], drafting: ['Drafting', ''] };
  const jamTile = (w) => { const [pt, tone] = STAGE_PILL[w.stage] || [w.stage, ''];
    return tile({ attr: `data-witem="${w.id}"`, img: w.img, agent: w.agent, icon: 'hand', eyebrow: esc(AGENT[w.agent] || 'Brew'), when: ago(w.discarded || w.updatedAt), title: w.title, line: jamLast(w), who: w.discarded ? `${ic('minus', 's14')}Discarded` : jamWho(w), pill: !w.discarded && ['ready', 'shared'].includes(w.stage) ? pillOf(pt, tone) : '', dot: !w.discarded && w.unread, menu: `jam:${w.id}${w.discarded ? ':off' : ''}`, off: !!w.discarded }); };
  const renderJams = async (fresh = true) => {
    view = 'jams';
    const paint = () => {
      if (view !== 'jams') return;
      if (!WORK.loaded && !WORK.items.length) return libPage('jams', 'Everything you’re planning with AI and your team.', loader('Opening your jams')); /* never "No jams yet" before the list is in */
      const by = (a, b) => b.updatedAt - a.updatedAt, all = [...WORK.items].sort(by);
      if (!window.BREW_DEMO && WORK.me) { /* team jams: mine (started, tagged, asked, given, replied) and the whole team's */
        const me = String(WORK.me.email).toLowerCase(), mine = all.filter((w) => w.mine || w.assignee?.email === me);
        const scope = LIB.scope || (mine.length ? 'mine' : 'team'), items = scope === 'mine' ? mine : all;
        const needs = (w) => (w.assignee?.email === me) || (w.stage === 'needs_you' && !w.assignee && w.startedBy?.email === me);
        const open = items.filter((w) => !JAM_DONE.includes(w.stage) && !needs(w));
        const cats = [
          { k: 'you', name: 'Needs you', hint: 'Given to you, or waiting on your OK', tone: 'hot', items: items.filter((w) => !JAM_DONE.includes(w.stage) && needs(w)).map(jamTile) },
          { k: 'open', name: 'Jamming', hint: scope === 'mine' ? 'Jams you’re in' : 'Every jam on the team', items: open.map(jamTile) },
          { k: 'shipped', name: 'Brief shared', hint: 'With the ShopOS team or your team', items: items.filter((w) => JAM_DONE.includes(w.stage)).map(jamTile) },
          { k: 'off', name: 'Discarded', hint: 'Restore any of these from the ··· menu', tone: 'muted', hideInAll: true, items: [...(WORK.discarded || [])].filter((w) => scope === 'team' || w.mine).sort((a, b) => b.discarded - a.discarded).map(jamTile) }];
        const seg = `<div class="lib-scope" role="tablist"><button role="tab" data-jscope="mine" aria-selected="${scope === 'mine'}">My jams<em>${mine.length}</em></button><button role="tab" data-jscope="team" aria-selected="${scope === 'team'}">Team jams<em>${all.length}</em></button></div>`;
        return libPage('jams', 'Jams you’re in, and everything your team is jamming on.', seg + libGrid('jams', cats, libEmpty('hand', scope === 'mine' ? 'Nothing for you yet' : 'No jams yet', scope === 'mine' ? 'Jam on any card, or wait for a teammate to tag you. Team jams shows what everyone is on.' : 'Open any card and press Jam. Your team sees it here and can join in.'), `<button class="lib-link" data-nav="work">${ic('board', 's16')}Work board</button>`));
      }
      const items = all;
      const open = items.filter((w) => !JAM_DONE.includes(w.stage) && w.stage !== 'needs_you');
      const cats = [
        { k: 'you', name: 'Needs you', hint: 'Answer these to keep them moving', tone: 'hot', items: items.filter(needsMe).map(jamTile) },
        { k: 'team', name: 'With your team', hint: 'On Slack', items: open.filter((w) => withKind(w) === 'team').map(jamTile) },
        { k: 'ai', name: 'Drafting with AI', hint: 'Just you and AI so far', items: open.filter((w) => withKind(w) === 'ai').map(jamTile) },
        { k: 'shipped', name: 'Brief shared', hint: 'With the ShopOS team or your team', items: items.filter((w) => JAM_DONE.includes(w.stage)).map(jamTile) },
        { k: 'off', name: 'Discarded', hint: 'Restore any of these from the ··· menu', tone: 'muted', hideInAll: true, items: [...(WORK.discarded || [])].sort((a, b) => b.discarded - a.discarded).map(jamTile) }];
      libPage('jams', 'Everything you’re planning with AI and your team.',
        libGrid('jams', cats, libEmpty('hand', 'No jams yet', 'Open any card and press Jam. The brief, the chat and who it’s with live here.'), `<button class="lib-link" data-nav="work">${ic('board', 's16')}Work board</button>`));
    };
    paint(); if (fresh) { await pullWork(true); paint(); }
    if (!REMIXES) { await pullRemixes(); paint(); }
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-jscope]'); if (!b) return; LIB.scope = b.dataset.jscope; LIB.cat.jams = 'all'; renderJams(false); });
  /* References: what the brand uploaded for Brew's generators (references.js). Any image or MP4, each with a label, a job
     (what it is for) and one line on what to keep. The same tiles as the rest of the Library; the photo picker shows them too */
  const REFS = { items: null, jobs: ['product', 'scene', 'style', 'person', 'logo', 'other'], edit: null };
  const REF_JOB = { product: 'Product', scene: 'Scene', style: 'Style', person: 'Person', logo: 'Logo', other: 'Other' };
  const REF_HINT = { product: 'The exact thing to show', scene: 'Places and settings to put it in', style: 'Light, colour and mood to match', person: 'People and faces to keep', logo: 'Marks that must appear as they are', other: 'Everything else' };
  const refUrl = (r) => r.url.replace(/^\//, ''); /* the page has <base href="/">: b/<slug>/refs/… like gen/… */
  const pullRefs = async () => { const r = await tapi('GET', `/api/brands/${encodeURIComponent(mvSlug())}/references`); if (!r.error) { REFS.items = r.items || []; if (r.jobs?.length) REFS.jobs = r.jobs; } return REFS.items || []; };
  const refTile = (r) => { const ed = REFS.edit === r.id;
    return `<div class="lt rf-t${ed ? ' is-edit' : ''}" data-rf="${esc(r.id)}">
      <span class="rf-media">${r.kind === 'video' ? `<video src="${esc(refUrl(r))}" muted playsinline preload="metadata"></video><i>${ic('play', 's14')}</i>` : `<img src="${esc(refUrl(r))}" alt="" loading="lazy">`}</span>
      ${ed ? `<label class="rf-f"><small>Name</small><input data-rf-label maxlength="80" value="${esc(r.label)}"></label>
        <label class="rf-f"><small>Job</small><select data-rf-job>${REFS.jobs.map((j) => `<option value="${j}"${j === r.job ? ' selected' : ''}>${REF_JOB[j] || j}</option>`).join('')}</select></label>
        <label class="rf-f"><small>Keep</small><input data-rf-keep maxlength="160" placeholder="e.g. match its light" value="${esc(r.keep || '')}"></label>
        <span class="lt-f"><button class="linkbtn" data-rf-remove>${ic('minus', 's14')}Remove</button><span class="rf-acts"><button class="btn btn-ghost sm" data-rf-cancel>Cancel</button><button class="btn btn-primary sm" data-rf-save>Save</button></span></span>`
      : `<b class="lt-t" title="${esc(r.label)}">${esc(r.label)}</b>${r.keep ? `<span class="lt-l">${esc(r.keep)}</span>` : ''}
        <span class="lt-f"><span class="lt-who">${esc(REF_JOB[r.job] || r.job)}${r.kind === 'video' ? ' · video' : r.w && r.h ? ` · ${r.w}×${r.h}` : ''}</span><button class="linkbtn" data-rf-edit>Edit</button></span>`}</div>`; };
  const refUpload = async (files) => { files = [...files].slice(0, 12); if (!files.length) return; const IMG = /^image\/(png|jpeg|webp)$/; const skipped = []; let n = 0;
    const read = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(null); r.readAsDataURL(f); });
    toast(`<brew-load class="spin"></brew-load>Uploading ${files.length === 1 ? esc(files[0].name) : files.length + ' files'}…`);
    for (const f of files) { const img = IMG.test(f.type), vid = f.type === 'video/mp4'; if (!(img || vid) || (img && f.size > 8e6) || (vid && f.size > 25e6)) { skipped.push(f.name); continue; }
      const data = await read(f); if (!data) { skipped.push(f.name); continue; }
      const r = await tapi('POST', `/api/brands/${encodeURIComponent(mvSlug())}/references`, { data, label: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim(), job: img ? (REFS.cat && REFS.cat !== 'all' ? REFS.cat : 'other') : 'scene' });
      if (r.error) { toast(esc(r.error)); break; } n++; if (r.items) REFS.items = r.items; if (view === 'refs') renderReferences(false); }
    if (n || skipped.length) toast(`${n ? `${ic('check', 's16')}${n} added` : ''}${skipped.length ? `${n ? '. ' : ''}Skipped ${esc(skipped.join(', '))}: PNG, JPG or WebP up to 8 MB, MP4 up to 25 MB` : ''}`); };
  const renderReferences = async (fresh = true) => {
    view = 'refs';
    const paint = () => { if (view !== 'refs') return;
      const all = REFS.items || [], cur = REFS.cat && all.some((r) => r.job === REFS.cat) ? REFS.cat : 'all', shown = cur === 'all' ? all : all.filter((r) => r.job === cur);
      const up = `<label class="btn btn-primary sm rf-up">${ic('plus', 's16')}Upload<input type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4" data-rf-file hidden></label>`;
      const chips = all.length ? `<div class="lib-cats"><button class="lib-cat" data-rfcat="all" aria-pressed="${cur === 'all'}">All<em>${all.length}</em></button>${REFS.jobs.filter((j) => all.some((r) => r.job === j)).map((j) => `<button class="lib-cat" data-rfcat="${j}" aria-pressed="${cur === j}">${REF_JOB[j] || j}<em>${all.filter((r) => r.job === j).length}</em></button>`).join('')}<span class="lib-acts">${up}</span></div>` : '';
      const body = !REFS.items ? `<div class="lib-load"><brew-load class="spin"></brew-load></div>`
        : !all.length ? `<div class="lib-empty"><span class="le-ic">${ic('pic')}</span><b>No references yet</b><span>Upload the photos, past ads and looks you want Brew to work from.</span>${up}</div>`
        : chips + `<section class="lib-sec"><header><b>${cur === 'all' ? 'All' : esc(REF_JOB[cur])}</b><em>${shown.length}</em>${cur !== 'all' ? `<small>${esc(REF_HINT[cur] || '')}</small>` : ''}</header><div class="lt-grid rf-grid">${shown.map(refTile).join('')}</div></section>`;
      libPage('refs', 'Photos, past ads, looks, logos and clips Brew works from. Each one says what it is for and what to keep.', body); };
    paint(); if (fresh || !REFS.items) { await pullRefs(); paint(); }
  };
  document.addEventListener('change', (e) => { if (e.target.matches?.('[data-rf-file]')) { refUpload(e.target.files); e.target.value = ''; } });
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-rfcat]'); if (c) { REFS.cat = c.dataset.rfcat; return renderReferences(false); }
    const t = e.target.closest('[data-rf]'); if (!t) return; const id = t.dataset.rf, api = (path, body) => tapi('POST', `/api/brands/${encodeURIComponent(mvSlug())}/references/${encodeURIComponent(id)}${path}`, body);
    if (e.target.closest('[data-rf-edit]')) { REFS.edit = id; return renderReferences(false); }
    if (e.target.closest('[data-rf-cancel]')) { REFS.edit = null; return renderReferences(false); }
    if (e.target.closest('[data-rf-save]')) { const r = await api('', { label: $('[data-rf-label]', t).value, job: $('[data-rf-job]', t).value, keep: $('[data-rf-keep]', t).value }); if (r.error) return toast(esc(r.error)); REFS.items = r.items || REFS.items; REFS.edit = null; return renderReferences(false); }
    if (e.target.closest('[data-rf-remove]')) { const r = await api('/remove', {}); if (r.error) return toast(esc(r.error)); REFS.items = r.items || (REFS.items || []).filter((x) => x.id !== id); REFS.edit = null; toast(`${ic('check', 's16')}Removed`); return renderReferences(false); }
    if (e.target.closest('video')) { const v = e.target.closest('video'); v.paused ? v.play().catch(() => {}) : v.pause(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('[data-rf-label],[data-rf-keep]')) { e.preventDefault(); e.target.closest('[data-rf]')?.querySelector('[data-rf-save]')?.click(); } });
  document.addEventListener('timeupdate', (e) => { const v = e.target; if (!v.classList?.contains('sv-vid') || !v.duration) return; const bar = v.parentElement.querySelector('.sv-pbar i'); if (bar) bar.style.width = `${(v.currentTime / v.duration) * 100}%`; }, true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remix]'); if (!b) return;
    const r = (REMIXES || []).find((x) => x.id === b.dataset.remix); if (!r) return;
    const p = byId(r.cardId) || { id: r.cardId, title: r.cardTitle || r.title, sub: '', agent: r.agent || 'creative', sector: 'creatives', kind: 'rows' };
    openRemix(p, r.batch ? undefined : r.id);
  });
  /* discard, restore and start fresh, for jams and remixes. Discarding never deletes: it moves to Discarded, one tap brings it back */
  const libRepaint = () => { if (view === 'jams') renderJams(false); else if (view === 'remixes') renderJams(false); else if (view === 'refs') renderReferences(false); else if (view === 'saved') $('.lib-seg')?.replaceWith(htmlEl(libTabs('saved'))); counts(); };
  const libAct = {
    async discard(kind, id, o = {}) {
      const r = await tapi('POST', kind === 'jam' ? `/api/work/${id}/discard` : `/api/changes/${id}/discard`, {});
      if (r.error) { toast(esc(r.error)); return false; }
      await Promise.all([pullWork(true), pullRemixes()]);
      if (!o.quiet) { if (kind === 'jam' && DP && (DP.w?.id === id || DP.p?._work?.id === id)) closeDetail(); if (kind === 'remix' && view === 'remix' && RX.ch?.id === id && RX.p) { RX.ch = null; leaveRemix(); } /* the studio is the card's jam: discarded, it leaves (reopening would make a new jam) */
        libRepaint(); toastLong(`${ic('check', 's16')}<span>${kind === 'jam' ? 'Jam' : 'Remix'} discarded. It’s under Discarded.</span> <button class="linkbtn" data-lrestore="${kind}:${id}">Undo</button>`, 6000); }
      return true;
    },
    async restore(kind, id) {
      const r = await tapi('POST', kind === 'jam' ? `/api/work/${id}/restore` : `/api/changes/${id}/restore`, {});
      if (r.error) return toast(esc(r.error));
      await Promise.all([pullWork(true), pullRemixes()]); libRepaint(); toast(`${ic('check', 's16')}Restored`);
    },
    // start fresh: put this one under Discarded and open a clean one on the same card (or the same set of cards)
    async fresh(kind, id) {
      if (kind === 'jam') {
        const w = WORK.items.find((x) => x.id === id) || (WORK.discarded || []).find((x) => x.id === id); if (!w) return;
        if (!w.discarded && !(await libAct.discard('jam', id, { quiet: true }))) return;
        closePop(); if (DP) closeDetail(true);
        if (String(w.cardId).startsWith('jam-')) {
          const bulk = (w.bundle || []).map(byId).filter(Boolean);
          return window.JamRoom?.openFromCtx(bulk.length ? { bulk } : w.ctxKey === 'moves' ? { moves: true } : w.ctxKey === 'batch' ? { batch: true } : {});
        }
        const p = byId(w.cardId); if (!p) { libRepaint(); return toast('That card is no longer in the feed, so there is nothing to start again from.'); }
        toast(`${ic('refresh', 's16')}Fresh jam. The old one is under Discarded.`); return window.JamRoom?.openFromCtx({ post: p });
      }
      const rx = (REMIXES || []).find((x) => x.id === id); const cardId = rx?.cardId || RX.ch?.cardId; if (!cardId) return;
      if (!rx?.discarded && !(await libAct.discard('remix', id, { quiet: true }))) return;
      const p = byId(cardId) || (RX.p?.id === cardId ? RX.p : null); RX.ch = null;
      if (!p) { libRepaint(); return toast('That card is no longer in the feed, so there is nothing to start again from.'); }
      toast(`${ic('refresh', 's16')}Fresh remix. The old one is under Discarded.`); openRemix(p);
    }
  };
  const libMenu = (anchor, spec) => {
    closePop(); const [kind, id, off] = spec.split(':'), r = anchor.getBoundingClientRect();
    const pop = document.createElement('div'); pop.id = 'pop'; pop.className = 'pop lib-pop';
    pop.style.top = (r.bottom + scrollY + 6) + 'px'; pop.style.left = Math.max(12, Math.min(innerWidth - 248, r.right - 236)) + 'px';
    const item = (k, icon, h, sub, cls = '') => `<button data-la="${k}" class="${cls}" role="menuitem"><span class="lp-ic">${ic(icon, 's16')}</span><span class="lp-tx"><b>${h}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
    pop.setAttribute('role', 'menu');
    pop.innerHTML = off ? item('restore', 'refresh', 'Restore', `Back to ${kind === 'jam' ? 'Jams' : 'My remixes'}`)
      : item('fresh', 'refresh', 'Start fresh', `Begin a clean ${kind === 'jam' ? 'jam' : 'remix'} on this card`) + '<hr>' + item('discard', 'minus', 'Discard', 'You can restore it later', 'is-bad');
    document.body.appendChild(pop);
    pop.onclick = (e) => { const b = e.target.closest('[data-la]'); if (!b) return; closePop(); libAct[b.dataset.la](kind, id); };
  };
  // capture phase: the menu sits inside a tile that opens on click
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-lmenu]'); if (m) { e.preventDefault(); e.stopImmediatePropagation(); return libMenu(m, m.dataset.lmenu); }
    const u = e.target.closest('[data-lrestore]'); if (u) { e.stopImmediatePropagation(); $('.toast')?.remove(); const [k, id] = u.dataset.lrestore.split(':'); libAct.restore(k, id); }
  }, true);
  // Connectors: what's connected at a glance, then every source as a card. Status top right, what it unlocks, one clear action
  /* DUMMY: marketplaces are Coming soon cards, no connect (DUMMY.md row 7). The ones the read saw the brand sell on come first,
     then the big ones in its country */
  const MARKETS = { amazon: 'Amazon', flipkart: 'Flipkart', myntra: 'Myntra', nykaa: 'Nykaa', blinkit: 'Blinkit', walmart: 'Walmart', target: 'Target', etsy: 'Etsy', ebay: 'eBay' };
  const soonMarkets = () => { const india = B.config?.country ? B.config.country === 'IN' : B.sym === '₹' || /\.in$/.test(B.brand?.host || ''); /* the selling market, never the domain of an exporter */
    const own = (B.marketLogos || []).map((k) => String(k).toLowerCase()).filter((k) => MARKETS[k]);
    return [...new Set([...own, ...(india ? ['amazon', 'flipkart', 'myntra', 'nykaa', 'blinkit'] : ['amazon', 'walmart', 'target', 'etsy', 'ebay'])])].slice(0, 5); };
  const soonSec = () => { const ks = soonMarkets(); if (!ks.length) return '';
    return `<section class="cn-sec cn-soon"><h3>Marketplaces<em>${ks.length}</em><small>Listings, ranks, stock and reviews</small></h3><div class="cn-soon-g">${ks.map((k) => `<article class="cn-soon-c">${logoTile(k, 36)}<div class="cn-name"><b>${MARKETS[k]}</b></div><span class="cn-soon-tag">Coming soon</span></article>`).join('')}</div></section>`; };
  const renderConnectors = () => {
    view = 'connectors';
    const list = Object.entries(B.connectors), on = list.filter(([id]) => conn(id)), need = list.filter(([id, c]) => !conn(id) && !c.optional), opt = list.filter(([id, c]) => !conn(id) && c.optional);
    const LC = window.LiveConn;
    /* bento: a connected card with numbers and notes spans two tiles, numbers beside what it's doing */
    const cnDoing = (id, c) => (conn(id) && c.demo && c.changedDemo?.length ? c.changedDemo : c.changed || []);
    const accessOf = (id) => (id === 'slack' ? 'Posts to your channel' : 'Read-only access'); /* Slack posts the cards and jams the team sends; every other connector only reads */
    const cnScore = ([id, c]) => (c.stats || []).length * 2 + cnDoing(id, c).length;
    const WIDE = new Set(on.filter(([, c]) => (c.stats || []).length >= 2).sort((a, b) => cnScore(b) - cnScore(a)).slice(0, Math.floor(on.length / 3)).map(([id]) => id));
    const cnWide = (id) => WIDE.has(id); /* the richest third of the connected ones: one wide tile per row of a 3-up grid */
    const card = ([id, c]) => `<article class="cn-card${conn(id) ? ' is-on' : ''}${c.live ? ' is-live' : ''}${cnWide(id) ? ' is-wide' : ''}" data-cn="${id}">
        <header>${glyph(id, 40)}<div class="cn-name"><b>${esc(c.name)}</b><span title="${esc(c.kind)}">${esc(c.kind)}</span></div>${LC?.status(id) || (conn(id) ? `<span class="cn-st is-on"><i></i>${c.demo ? 'Demo' : 'Connected'}</span>` : c.optional ? '<span class="cn-st">Optional</span>' : '<span class="cn-st is-off"><i></i>Not connected</span>')}</header>
        <div class="cn-mid">${conn(id) && (c.stats || []).length ? `<dl class="cn-stats">${c.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${c.demo ? '<small class="cn-demo">Demo account numbers, built from what we read</small>' : ''}` : ''}
        ${(conn(id) && c.demo && c.changedDemo?.length ? c.changedDemo : c.changed || []).length ? `<div class="cn-will"><small>${conn(id) ? 'What it’s doing' : 'What it unlocks'}</small><ul>${(conn(id) && c.demo && c.changedDemo?.length ? c.changedDemo : c.changed).slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}</div>
        <footer>${LC?.footer(id) || (conn(id) ? `<span class="cn-acct">${ic('check', 's14')}${esc(c.account)}</span><button class="cn-btn is-ghost" data-unlink="${id}">Disconnect</button>` : `<span class="cn-acct is-muted">${ic(id === 'slack' ? 'send' : 'lock', 's14')}${accessOf(id)}</span><button class="cn-btn" data-cx="${id}">Connect${ic('right', 's14')}</button>`)}</footer></article>`;
    const sec = (name, hint, items) => items.length ? `<section class="cn-sec"><h3>${name}<em>${items.length}</em>${hint ? `<small>${hint}</small>` : ''}</h3><div class="cn-grid">${items.map(card).join('')}</div></section>` : '';
    const pct = Math.round(on.length / list.length * 100);
    libShell(`Connectors${LC?.L?.dummy === false ? '' : ' <span class="dummy-tag" title="Connected accounts are simulated in this demo">Dummy</span>'}`, LC?.intro() || (LC?.L?.dummy === false ? `Every source Brew reads for ${B.brand.name}. Connected accounts are read-only (Slack posts to the channel you pick) and only ${B.brand.name}’s team sees them.` : `Every source Brew reads for ${B.brand.name}. Connected accounts are simulated in this demo (Dummy): connecting shows what would change, and nothing touches a real account.`),
      `<div class="cn-sum">${on.length ? `<div class="cn-sum-n"><b>${on.length}</b><span>of ${list.length} connected</span></div><div class="cn-bar"><i style="width:${pct}%"></i></div>` : '<div class="cn-sum-n"><span>Connect your accounts</span></div>'}<div class="cn-logos">${list.map(([id]) => `<span class="${conn(id) ? '' : 'is-off'}" title="${esc(B.connectors[id].name)}">${glyph(id, 28)}</span>`).join('')}</div></div>
       ${sec('Not connected yet', 'Connect these to unlock the cards that need them', need)}${sec('Connected', '', on)}${sec('Optional', 'Nice to have', opt)}${soonSec()}`);
    $('#col')?.classList.add('lib-col', 'cn-col'); if (LC && $('#col')) { LC.bindPage(document.getElementById('view') || $('#col')); }
    $$('[data-unlink]').forEach((b) => b.onclick = () => { S.conn[b.dataset.unlink] = false; save(); toast(`${esc(B.connectors[b.dataset.unlink].name)} disconnected`); renderConnectors(); refreshAfterConnect(); });
  };

  /* =========================================================
     Deck: TweetDeck for the brand (Pro, a Dummy)
     ========================================================= */
  const SECTORS = {
    signals: { name: 'Signals', dot: '#fafafa', emo: '📡' }, catalog: { name: 'Catalog', dot: '#e8e8e8', emo: '📦' }, creatives: { name: 'Creatives', dot: '#d4d4d4', emo: '🎨' },
    ads: { name: 'Ads', dot: '#a3a3a3', emo: '📣' }, storefront: { name: 'Storefront', dot: '#8a8a8a', emo: '🛍️' }, visibility: { name: 'AI answers', dot: '#6b6b6b', emo: '🤖' }
  };
  let COL_ORDER = [];
  const colOrder = () => { const base = ['signals', 'catalog', 'creatives', 'ads', 'storefront', 'visibility']; const f = ROLE().deckFirst; COL_ORDER = [f, ...base.filter((k) => k !== f).sort((a, b) => (ROLE().sector[b] || 0) - (ROLE().sector[a] || 0))]; };
  const byCol = (k) => FEED.map((p, i) => [p, i]).filter(([p]) => p.sector === k);
  const colState = {}; ['signals', 'catalog', 'creatives', 'ads', 'storefront', 'visibility'].forEach((k) => (colState[k] = { hidden: false }));
  const COL_MIN = 380, COL_MAX = 900, COL_SNAP = [380, 480, 600, 720, 840];
  let colW = 480;
  /* DUMMY: a sample signal with made-up numbers, shown only with a simulated Shopify (DUMMY.md row 2); tagged Dummy in the card */
  const SIGS = [
    { h: '642 people whose payment failed or whose order came back', why: 'Brew drafts a short note for each reason the order failed. Your team sends it from your own tools.', n: '642', r: '511', ch: B.config?.country === 'IN' || B.sym === '₹' ? 'WhatsApp' : 'Email', when: '3h' }
  ];
  /* what Signals reads, in the order it needs them: the store first (nothing to read without it), then reviews, then email.
     WhatsApp is not here: Brew sending was cut, so there is nothing for it to read */
  const andList = (a) => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
  const SOURCES0 = ['shopify', 'reviews', 'klaviyo'];
  const SIG_WHY = { shopify: { need: 'Needed first', why: 'Your orders and checkouts. Without them Signals has nothing to read.', gets: 'People who left at checkout, and customers due to buy again' },
    reviews: { need: 'Adds more', why: 'Your reviews.', gets: 'Reviews still waiting for a reply' },
    klaviyo: { need: 'Optional', why: 'Your email flows.', gets: 'Emails that should go out on their own but are switched off' } };
  const sigSources = () => SOURCES0.filter((id) => B.connectors?.[id]); /* a source the brand has no connector for is skipped, never read */
  const sigLive = () => conn('shopify');
  const sigFake = () => !!window.BREW_DEMO && sigLive() && !window.LiveConn?.isLive?.('shopify'); /* DUMMY: demo site only, and never next to a connected Shopify */
  /* the Signals column always shows when the brand has a store connector: with nothing connected it says what to connect
     and why (18 Oct testing notes: an empty or hidden column read as broken) */
  const sigEmpty = () => !window.BREW_DEMO && !byCol('signals').length && !B.connectors?.shopify;
  /* V1 hides the Storefront column (testing notes 18 Oct: not ready, it overwhelms the customer); ?storefront=1 shows it to us */
  const STOREFRONT_COL = SF_ON;
  const deckCols = () => COL_ORDER.filter((k) => !(k === 'signals' && sigEmpty()) && (k !== 'storefront' || STOREFRONT_COL));
  const sigCard = (s) => `<article class="sig-card is-dummy"><div class="sig-top">${face('crm')}<b>CRM specialist</b><span class="when">· ${s.when}</span><span class="dummy-tag" title="A sample signal: the numbers are made up in this prototype">Dummy</span></div><hr class="sig-rule">
      <div class="sig-main"><h3>${esc(s.h)}</h3><p>${esc(s.why)}</p><div class="sig-nums"><div><b>${s.n}</b><span>people</span></div><div><b>${s.r}</b><span>can be reached</span></div><div><b>${s.ch}</b><span>best way to reach them</span></div></div></div>
      <button class="sig-open" data-sig-open>${ic('person', 's16')}See who they are${ic('right', 's16')}</button></article>`;
  /* one source: what it is, why Signals needs it, and its state in a word (a connected account that stopped reading says so) */
  const sigState = (id) => { const x = window.LiveConn?.L?.conns?.[id];
    if (x && (x.needsReconnect || (x.daysLeft != null && x.daysLeft < 0))) return ['bad', 'Sign-in expired: connect again'];
    if (x?.stale) return ['bad', 'Stopped reading: connect again'];
    if (conn(id)) return ['ok', 'Connected'];
    if (x?.state === 'syncing') return ['busy', 'Reading…'];
    return null; };
  const srcRow = (id) => { const s = B.connectors[id], w = SIG_WHY[id] || { need: s.optional ? 'Optional' : '', why: s.kind }, st = sigState(id), admin = window.LiveConn?.boss?.() === false;
    const right = st?.[0] === 'ok' ? `<span class="src-ok">${ic('check', 's14')}Connected</span>` : st?.[0] === 'busy' ? `<span class="src-state">${st[1]}</span>`
      : admin ? `<span class="src-state">${st ? st[1] : 'Your admin connects it'}</span>` : `<button class="src-btn" data-cx="${id}">${st ? 'Connect again' : 'Connect'}</button>`;
    return `<div class="src${st?.[0] === 'ok' ? ' is-on' : ''}${st?.[0] === 'busy' ? ' is-busy' : ''}">${glyph(id, 34)}<span class="src-t"><b>${esc(s.name)}${w.need ? ` <span class="src-opt">${w.need}</span>` : ''}</b><span>${esc(w.why)}${st?.[0] === 'bad' ? ` <em class="src-bad">${st[1]}.</em>` : ''}</span></span>${right}</div>`; };
  /* the guide: what Signals does, what it needs first and why, the steps, and what lands here. Every brand, live or demo */
  const sigGuide = () => { const srcs = sigSources(), store = B.connectors?.shopify?.name || 'your store';
    const gets = srcs.map((id) => SIG_WHY[id]?.gets).filter(Boolean);
    return `<article class="sig-lock sig-guide"><div class="sig-lock-body">
        <h3>Signals tells you which customers to reach today.</h3>
        <p class="sig-lede">It reads ${esc(store)}${srcs.includes('reviews') ? ' and your reviews' : ''} once a day and finds the people worth a message right now.</p>
        <p class="sig-sec">What it needs</p>
        <div class="sig-srcs">${srcs.map(srcRow).join('')}</div>
        <p class="sig-sec">How it works</p>
        <ol class="sig-steps"><li><b>You connect ${esc(store)}.</b> Read-only: Brew can look, but can't change anything or message anyone.</li>
          <li><b>Brew reads it once a day.</b> Orders, checkouts${srcs.includes('reviews') ? ', reviews' : ''}${srcs.includes('klaviyo') ? ' and email flows' : ''}.</li>
          <li><b>A card lands here.</b> It says who, how many, and what to tell them. Your team sends it from your own tools.</li></ol>
        ${gets.length ? `<p class="sig-sec">What you get</p><div class="sig-will">${gets.map((g) => `<div><i></i>${esc(g)}</div>`).join('')}</div>` : ''}
      </div></article>`; };
  // once the store is connected: one slim strip, what is read and what one tap adds
  const sigStrip = () => { const more = sigSources().filter((id) => id !== 'shopify' && !conn(id) && !sigState(id)), bad = sigSources().filter((id) => sigState(id)?.[0] === 'bad');
    const n = byCol('signals').length;
    return `<div class="sig-strip"><p>${bad.length ? `${ic('info', 's14')}${esc(B.connectors[bad[0]].name)} stopped reading. Connect it again so Signals keeps finding people.`
      : `<i class="pulse"></i>Brew reads ${esc(andList(sigSources().filter(conn).map((id) => B.connectors[id].name)))} once a day. ${n ? 'Each card below is a group of people to reach.' : 'Nothing to act on yet; new people land here as Brew finds them.'}`}${!bad.length && more.length ? ` Connect ${esc(andList(more.map((id) => B.connectors[id].name)))} to find more.` : ''}</p>
      <div class="sig-pills">${sigSources().map((id) => { const c = B.connectors[id], st = sigState(id); return st?.[0] === 'ok' ? `<span class="sig-pill is-on">${glyph(id, 16)}${esc(c.name)}${ic('check', 's14')}</span>` : window.LiveConn?.boss?.() === false ? '' : `<button class="sig-pill" data-cx="${id}">${glyph(id, 16)}${esc(c.name)}${st ? '<small>connect again</small>' : SIG_WHY[id]?.need === 'Optional' ? '<small>optional</small>' : ''}</button>`; }).join('')}</div></div>`; };
  const sigBody = () => {
    if (!sigSources().length) return '';
    if (!sigLive() || sigState('shopify')?.[0] === 'bad') return sigGuide();
    /* a real Shopify shows only what it really found (those arrive as live cards in this column), never the sample signal */
    return sigStrip() + (sigFake() ? SIGS.map(sigCard).join('') : '');
  };
  const colHTML = (k) => {
    const cards = byCol(k), sb = k === 'signals' ? sigBody() : k === 'visibility' ? `<article class="sig-lock ais-card"><div class="sig-lock-body ais">${aisHtml(aiStand())}</div></article>` : '';
    return `<section class="dcol" data-col="${k}">
        <div class="col-head"><div class="col-top"><h2><span class="col-emo" aria-hidden="true">${SECTORS[k].emo}</span>${SECTORS[k].name}</h2><span class="col-fill"></span>
          <span class="col-menu"><button class="col-dots" aria-label="Column options">${ic('more', 's18')}</button>
            <div class="col-pop"><button data-colact="refresh">${ic('refresh', 's16')} Refresh new cards</button><button data-colact="hide">${ic('x', 's16')} Hide this column</button></div></span></div><hr></div>
        <div class="col-body">${sb ? `<div class="sig-body">${sb}</div>` : ''}${cards.map(([p, i]) => postCard(p, i)).join('')}${cards.length ? `<p class="col-end">You are caught up on ${SECTORS[k].name.toLowerCase()}.</p>` : ''}</div>
        <span class="grab" role="separator" aria-orientation="vertical" aria-label="Column width"></span></section>`;
  };
  const sideHTML = () => `
    <div class="side-brand" data-nav="feed" role="button" tabindex="0" title="Home: your feed"><i class="bmark"><img src="${B.brand.mark}" alt=""></i><span><b>${B.brand.name}</b><span>Your deck</span></span></div>
    <p class="side-note">Every agent has its own column and posts all day.${sigEmpty() ? '' : ' Signals reads your orders and tells you which customers to reach today.'}</p>
    <div class="side-rule"></div>
    <div class="side-nav">${deckCols().map((k) => { const n = k === 'signals' ? byCol(k).length + (sigFake() ? SIGS.length : 0) : byCol(k).length;
      return `<button data-colnav="${k}" class="${colState[k].hidden ? 'muted' : ''}" aria-current="false"><i class="col-dot" style="background:${SECTORS[k].dot}"></i>${SECTORS[k].name}<span class="n">${n || ''}</span></button>`; }).join('')}</div>
    <div class="side-acts"><button class="side-act" data-side="dash">${ic('grid', 's16')} Open dashboard</button><button class="side-act" data-side="jam">${ic('hand', 's16')} Jam with the team</button><button class="side-act" data-side="tune">${ic('sparkles', 's16')} Tune the deck</button></div>`;
  const deckEl = () => $('#deck');
  // the column you picked stays highlighted, even when the deck can't scroll far enough to make it the leftmost one;
  // your own scrolling hands the highlight back to whichever column leads
  let navPin = null;
  const markNav = (k) => $$('.side-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.colnav === k)));
  const scrollToCol = (k) => { navPin = k; markNav(k); const d = deckEl(), c = d && $(`.dcol[data-col="${k}"]`, d); if (c) d.scrollTo({ left: d.scrollLeft + c.getBoundingClientRect().left - d.getBoundingClientRect().left, behavior: 'smooth' }); };
  let leadIO = null;
  let layoutLoaded = false;
  const saveLayout = () => tapi('PUT', '/api/tenants/:t/deck-layout', { hidden: Object.keys(colState).filter((k) => colState[k].hidden), colWidth: Math.round(colW) });
  const buildDeck = async () => {
    const d0 = deckEl(); if (!d0) return; await syncNow();
    const r = await tapi('GET', `/api/tenants/:t/deck${SFQ}`); if (r.error) return;
    ALL = r.cards; SCORES = r.scores || SCORES; FEED = Object.values(r.columns).flat().map((id) => ALL[id]).filter(Boolean);
    if (!layoutLoaded) { layoutLoaded = true; (r.layout.hidden || []).forEach((k) => colState[k] && (colState[k].hidden = true)); colW = r.layout.colWidth || colW; }
    const d = deckEl(); if (!d) return;
    const keep = d.scrollLeft, keepY = Object.fromEntries($$('.dcol', d).map((c) => [c.dataset.col, $('.col-body', c)?.scrollTop || 0])); document.body.classList.add('col-dragging');
    d.innerHTML = deckCols().filter((k) => !colState[k].hidden).map(colHTML).join('');
    d.style.setProperty('--col-w', colW + 'px');
    $('#deck-side').innerHTML = sideHTML();
    $('#deck-tabs').innerHTML = $$('.dcol', d).map((c, i) => `<button class="dtab" role="tab" data-i="${i}">${SECTORS[c.dataset.col].name}</button>`).join('');
    $$('.dcol', d).forEach((c) => { const b = $('.col-body', c); if (b && keepY[c.dataset.col]) b.scrollTop = keepY[c.dataset.col]; });
    d.scrollLeft = keep; markTab();
    requestAnimationFrame(() => { d.scrollLeft = keep; document.body.classList.remove('col-dragging'); });
    if (leadIO) leadIO.disconnect();
    const seen = new Set();
    leadIO = new IntersectionObserver((en) => { en.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))); const lead = [...seen].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
      if (navPin && [...seen].some((c) => c.dataset.col === navPin)) return markNav(navPin); if (lead) markNav(lead.dataset.col); }, { root: d, threshold: 0.55 });
    $$('.dcol', d).forEach((c) => leadIO.observe(c));
  };
  const markTab = () => { const d = deckEl(); if (!d) return; const cols = $$('.dcol', d); if (!cols.length) return; const r = d.getBoundingClientRect(), mid = r.left + d.clientWidth / 2;
    let i = cols.findIndex((c) => { const b = c.getBoundingClientRect(); return b.left <= mid && b.right > mid; }); if (i < 0) i = d.scrollLeft <= 0 ? 0 : cols.length - 1;
    $$('#deck-tabs .dtab').forEach((t, j) => { t.classList.toggle('on', j === i); t.setAttribute('aria-selected', String(j === i)); }); };
  const renderDeck = () => {
    if (!S.pro && PAYWALL) return openPlan('deck');
    if (!$('#view')) appShell();
    view = 'deck'; window.scrollTo(0, 0); $('#stk').innerHTML = ''; $('#notes').innerHTML = '';
    document.body.classList.add('deck-on'); colOrder();
    $$('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.nav === 'deck'));
    $('#view').innerHTML = `<div class="deck-wrap"><aside class="deck-side" id="deck-side"></aside><div class="deck-main"><div class="deck-tabs" id="deck-tabs" role="tablist" aria-label="Columns"></div><div class="deck" id="deck">${loader('Laying out your deck')}</div></div></div>`;
    buildDeck(); counts();
    deckEl().addEventListener('scroll', () => requestAnimationFrame(markTab), { passive: true });
    ['wheel', 'touchstart', 'keydown'].forEach((ev) => deckEl().addEventListener(ev, (e) => { if (ev !== 'wheel' || Math.abs(e.deltaX) > Math.abs(e.deltaY)) navPin = null; }, { passive: true }));
  };
  document.addEventListener('click', (e) => {
    if (view !== 'deck') return;
    const t = e.target;
    const nav = t.closest('[data-colnav]'); if (nav) { const k = nav.dataset.colnav; if (!colState[k]) { scrollToCol(k); return; } if (colState[k].hidden) { colState[k].hidden = false; saveLayout(); buildDeck(); toast(`${SECTORS[k].name} is back`); } else scrollToCol(k); return; }
    const tab = t.closest('.dtab'); if (tab) { const c = $$('#deck .dcol')[+tab.dataset.i]; if (c) scrollToCol(c.dataset.col); return; }
    const dots = t.closest('.col-dots'); if (dots) { const pop = dots.nextElementSibling, on = pop.classList.contains('on'); $$('.col-pop').forEach((x) => x.classList.remove('on')); pop.classList.toggle('on', !on); return; }
    const act = t.closest('[data-colact]'); $$('.col-pop').forEach((x) => x.classList.remove('on'));
    if (act) { const col = act.closest('.dcol'), k = col.dataset.col;
      if (act.dataset.colact === 'refresh') { const had = new Set(byCol(k).map(([p]) => p.id)); col.classList.add('is-refreshing'); col.insertAdjacentHTML('beforeend', `<div class="col-wait">${loader('Checking for new cards', '', 'sm')}</div>`);
        (async () => { await buildDeck(); col.classList.remove('is-refreshing'); col.querySelector('.col-wait')?.remove(); /* a failed fetch leaves the old column */ const c2 = $(`.dcol[data-col="${k}"]`); $('.col-body', c2)?.scrollTo({ top: 0, behavior: 'smooth' });
          const fresh = byCol(k).filter(([p]) => !had.has(p.id)).length; toast(fresh ? `${ic('sparkles', 's16')}${fresh} new in ${SECTORS[k].name}` : `${ic('check', 's16')}${SECTORS[k].name} is up to date`); })(); }
      if (act.dataset.colact === 'hide') { colState[k].hidden = true; saveLayout(); buildDeck(); toast(`${SECTORS[k].name} hidden`); }
      return; }
    const sg = window.BREW_DEMO ? t.closest('.sig-card') : null; if (sg) { const s0 = SIGS[$$('.sig-card').indexOf(sg)]; if (s0) openDetail({ id: 'sig-' + s0.n, agent: 'crm', sector: 'signals', type: 'decision', kind: 'rows', lane: 'core', time: s0.when, title: s0.h, sub: s0.why, rows: [['People', s0.n], ['Can be reached', s0.r], ['Best way to reach them', s0.ch]], cta: { label: 'Draft the message' }, detail: { why: [s0.why], how: ['Brew drafts one short note for each reason the order failed.', 'You check it in the jam.', 'Your team sends it from your own tools.'] } }); return; }
    const side = t.closest('[data-side]'); if (side) { const s = side.dataset.side; if (s === 'jam') openJam({ tab: 'ai' }); if (s === 'dash') openDash(); if (s === 'tune') openTune(); }
  });
  let colDrag = null, wRaf = null;
  const setColW = (w) => { colW = w; deckEl()?.style.setProperty('--col-w', Math.round(w) + 'px'); };
  const settleW = (to) => { cancelAnimationFrame(wRaf); const from = colW, t0 = performance.now(); const tk = (now) => { const t = Math.min(1, (now - t0) / 260); setColW(from + (to - from) * (1 - Math.pow(1 - t, 3.2))); if (t < 1) wRaf = requestAnimationFrame(tk); }; wRaf = requestAnimationFrame(tk); };
  document.addEventListener('pointerdown', (e) => { const g = e.target.closest('.grab'); if (!g) return; cancelAnimationFrame(wRaf); colDrag = { x: e.clientX, w: colW }; g.setPointerCapture(e.pointerId); });
  document.addEventListener('pointermove', (e) => { if (colDrag) setColW(Math.max(COL_MIN, Math.min(COL_MAX, colDrag.w + (e.clientX - colDrag.x)))); });
  const endDrag = () => { if (!colDrag) return; colDrag = null; const snap = COL_SNAP.reduce((a, b) => (Math.abs(b - colW) < Math.abs(a - colW) ? b : a)); settleW(snap); colW = snap; saveLayout(); };
  document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag); window.addEventListener('blur', endDrag);
  const openDash = () => { const bs = S.batches, n = (f) => bs.filter(f).length;
    const done = n((b) => b.st === 'Done'), need = n((b) => /needs you/i.test(b.st)), run = bs.length - done - need;
    const pill = (b) => b.st === 'Running' ? `<span class="db-st"><span class="db-bar"><i style="width:${Math.max(4, b.pct)}%"></i></span>${b.pct}%</span>`
      : `<span class="db-st is-${b.tone === 'warn' ? 'warn' : b.tone === 'ok' || b.st === 'Done' ? 'ok' : 'mute'}">${b.st === 'Done' ? ic('check', 's14') : ''}${esc(b.st)}</span>`;
    modal(`<div class="sheet pick-sheet db-sheet"><header class="sh-h"><b class="sh-t">What your team is working on</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="db-sum"><div><b>${bs.length}</b><span>this week</span></div><div><b>${done}</b><span>done</span></div><div class="${need ? 'is-warn' : ''}"><b>${need}</b><span>need you</span></div><div><b>${Math.max(0, run)}</b><span>in progress</span></div></div>
      <div class="db-list">${bs.map((b) => `<div class="db-row">${b.team ? podFaces() : face(b.agent)}<div class="db-tx"><b>${esc(b.t)}</b><span>${esc(b.s)}</span></div>${pill(b)}</div>`).join('') || '<p class="sh-p">Nothing in progress yet.</p>'}</div></div>`); };
  const WIDTHS = [['Narrow', 380], ['Medium', 480], ['Wide', 600]];
  const openTune = () => {
    const row = (k) => { const on = !colState[k].hidden, n = byCol(k).length + (k === 'signals' && sigFake() ? SIGS.length : 0); return `<button class="tn-row${on ? '' : ' is-off'}" data-tune="${k}" aria-pressed="${on}"><span class="tn-emo" aria-hidden="true">${SECTORS[k].emo}</span><span class="tn-tx"><b>${SECTORS[k].name}</b><span>${n ? `${n} card${n === 1 ? '' : 's'}` : 'Nothing yet'}</span></span><span class="sw" aria-checked="${on}" aria-hidden="true"><i></i></span></button>`; };
    const paintT = (m) => { $('.tn-list', m).innerHTML = deckCols().map(row).join(''); const near = WIDTHS.reduce((a, b) => (Math.abs(b[1] - colW) < Math.abs(a[1] - colW) ? b : a))[1]; $$('[data-tw]', m).forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.tw === near))); bindT(m); };
    const bindT = (m) => $$('[data-tune]', m).forEach((b) => (b.onclick = () => { const k = b.dataset.tune;
      if (!colState[k].hidden && COL_ORDER.filter((x) => !colState[x].hidden).length === 1) return toast('Keep at least one column on screen');
      colState[k].hidden = !colState[k].hidden; saveLayout(); buildDeck(); paintT(m); }));
    modal(`<div class="sheet pick-sheet tn-sheet"><header class="sh-h"><b class="sh-t">Tune the deck</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <p class="sh-p">Pick the columns you want on screen and how wide they are.</p>
      <div class="tn-list"></div>
      <div class="tn-w"><small>Column width</small><div class="seg-mini">${WIDTHS.map(([l, w]) => `<button data-tw="${w}">${l}</button>`).join('')}</div></div>
      <div class="sh-foot"><button class="btn btn-primary sm" data-close>Done</button></div></div>`, (m) => {
      $$('[data-tw]', m).forEach((b) => (b.onclick = () => { settleW(+b.dataset.tw); colW = +b.dataset.tw; saveLayout(); paintT(m); }));
      paintT(m);
    });
  };

  /* ---------- Pro: offered the moment you reach for it; the demo starts a trial ---------- */
  const PLAN_WHY = { deck: ['Open the deck with Pro', 'Every agent gets its own column.'], feed: ['See everything with Pro', 'Every card your agents make, all day.'], moves: ['Write every move with Pro', 'Brew carries on from where it paused and writes the rest of the moves.'] };
  /* the Pro paywall is off for now (Param 2026-10-16): the deck opens for everyone, a Pro button just goes where it leads,
     and nothing switches S.pro on (that would start the paid all-day feed). Set PAYWALL = true to bring the offer back. */
  const PAYWALL = false;
  const openPlan = (why = 'deck', onPro = null) => !PAYWALL ? (why === 'moves' ? onPro?.() : renderDeck()) : modal(`<div class="sheet plan-sheet plan2"><button class="icon-btn plan-x" data-close aria-label="Close">${ic('x', 's18')}</button>
      <div class="plan-pick"><div class="plan-top"><h3>${esc((PLAN_WHY[why] || PLAN_WHY.feed)[0])}<span class="dummy-tag" title="No billing in this prototype: the trial switches Pro on">Dummy</span></h3><p>${esc((PLAN_WHY[why] || PLAN_WHY.feed)[1])}</p></div>
        <div class="plans"><div class="plan"><header><b>Free</b><span>Your plan</span></header><span class="price">$0</span><ul><li>${ic('check', 's14')}Every card in the feed</li><li>${ic('check', 's14')}Jam on every card</li><li>${ic('check', 's14')}Stories and trends</li></ul></div>
        <div class="plan pro"><header><b>Pro</b></header><span class="price">$7<em>a month, billed yearly</em></span><ul><li>${ic('check', 's14')}A feed that keeps going</li><li>${ic('check', 's14')}The deck</li><li>${ic('check', 's14')}Signals: who to talk to next</li><li>${ic('check', 's14')}Custom agents</li>${why === 'moves' ? `<li>${ic('check', 's14')}Every move written</li>` : ''}</ul></div></div>
        <button class="btn btn-primary plan-go" data-up>Start the 14-day trial</button><small class="plan-fine">No card needed. Dummy: there is no billing in this prototype.</small></div>
      <div class="plan-done" hidden><span class="plan-check">${ic('check')}</span><h3>You’re on Pro</h3><p>${why === 'moves' ? 'Brew is writing the rest of the moves. Cards land as each one is written.' : 'Your agents now post all day. The deck and Signals are open.'}</p>
        <button class="btn btn-primary" data-resume>${why === 'moves' ? 'Back to the moves' : 'Open the deck'}</button><button class="btn btn-ghost sm" data-close>Back to my feed</button></div></div>`,
    (m) => {
      $('[data-up]', m).onclick = (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Starting your trial'; setTimeout(async () => { S.pro = true; save(); if (onPro) await onPro(); $('.plan-pick', m).hidden = true; $('.plan-done', m).hidden = false; refreshAfterConnect(null, 'pro'); }, 1100); };
      $('[data-resume]', m).onclick = () => { closeModal(); if (why === 'moves') return renderLearned(); renderDeck(); toast(matchMedia('(max-width:700px)').matches ? 'Swipe sideways between columns' : 'Drag a column edge to resize it'); };
    });

  /* ---------- modal helper ---------- */
  const modal = (html, bind) => { const swap = !!$('#modal'); closeModal(true); if (!swap) sound('sheetUp'); /* a sheet rises; one sheet giving way to the next stays quiet */ const w = document.createElement('div'); w.id = 'modal'; w.innerHTML = `<div class="scrim" data-close></div><div class="modal" data-close>${html}</div>`; document.body.appendChild(w); document.body.classList.add('modal-on'); $('.modal', w).addEventListener('click', (e) => { const c = e.target.closest('[data-close]'); if (c && (c === e.target || c.tagName === 'BUTTON')) closeModal(); }); $('.scrim', w).onclick = closeModal; bind?.(w); requestAnimationFrame(() => shadeActs(w)); };
  /* a sheet's sticky buttons draw their top line only while something scrolls under them */
  const shadeActs = (w) => { const bar = w && $('.rv-acts', w); if (!bar) return; let sc = bar.parentElement; while (sc && sc !== w && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; if (!sc || sc === w) return;
    const set = () => bar.classList.toggle('is-over', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 2); sc.addEventListener('scroll', set, { passive: true }); set(); };
  const closeModal = (quiet) => { if ($('#modal') && quiet !== true) sound('sheetDown'); $('#modal')?.remove(); document.body.classList.remove('modal-on');
    /* a tray closed with "Not yet" hands the studio's button back; it used to stay disabled until a reload */
    $$('.std .ship [data-rx].is-busy').forEach((b) => { b.disabled = false; b.classList.remove('is-busy'); }); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#sv')) closeStory(); else if ($('#modal')) closeModal(); else if ($('#jam')) closeJam(); else closePop(); } });

  /* =========================================================
     The studio: any card → versioned changes (the thing being made), ending with Share the brief.
     Anything a person must plan or decide opens a jam.
     Every edit, reroll, restore and undo is a version; what you pick and change is what Brew learns.
     ========================================================= */
  const RX = { p: null, list: [], earlier: [], recipe: null, learned: null, busy: false, intent: '', line: '', scope: {}, ch: null, cmp: [], sending: false, autoImg: {} };
  // one plain route per package: what happens when you commission it
  const RXROUTE = {
    live: { tone: 'ok', icon: 'check', tag: 'Ready to share', btn: 'Share the brief', note: '' },
    deploy: { tone: 'info', icon: 'copy', tag: 'Ready to share', btn: 'Share the brief', note: 'It costs money or can’t be undone, so the team that runs it decides from your brief.' },
    jam: { tone: 'warn', icon: 'hand', tag: 'Needs a plan first', btn: 'Jam with my team', note: '' },
    fix: { tone: 'warn', icon: 'sparkles', tag: 'Needs a fix', btn: 'Fix it with AI', note: '' },
    confirm: { tone: 'warn', icon: 'check', tag: 'Confirm your checks', btn: 'Review my checks', note: '' }
  };
  const authorName = (a = '') => a === 'you' ? 'You' : a.startsWith('ai:') ? AGENT[a.slice(3)] || 'AI' : a === 'deploy-team' ? 'ShopOS team' : a === 'learning' ? 'Learning' : a.startsWith('teammate:') ? a.slice(9) : a === 'brew' ? 'ShopOS team' : 'System';
  const showLearned = (arr) => { (arr || []).forEach((r, i) => setTimeout(() => toastLong(`${ic('sparkles', 's16')}<span><b>Learned:</b> ${esc(r.text)}</span> <button class="linkbtn" data-nav="learned">See it</button>`, 5200), i * 2600)); };
  let toastLT = null;
  const toastLong = (html, ms = 10000) => { $('.toast')?.remove(); clearTimeout(toastT); clearTimeout(toastLT); const t = document.createElement('div'); t.className = 'toast toast-long'; t.setAttribute('role', 'status'); t.innerHTML = html; document.body.appendChild(t); toastLT = setTimeout(() => t.remove(), ms); };
  /* claims Brew's own check flagged in a move (meta.issues): shown as "to review", never hidden behind a verified badge */
  const claimsOf = (m) => (m?.meta?.issues || []).filter((x) => / (fact|quote|motive|absent|disclaimer):/.test(String(x))).map((x) => String(x).replace(/^\S+\s+\w+:\s*/, '').trim()).filter(Boolean).slice(0, 15);
  /* Asking a teammate copies the question: Brew sends nothing, and their answer is added here by hand. */
  const askedCopy = (r) => {
    if (!r?.copy) { toast(r?.work ? 'Brew suggested what it could. The rest is yours to answer.' : 'Couldn’t ask right now.'); return; }
    const who = [...new Set(r.asked || [])].join(', ');
    navigator.clipboard?.writeText(r.copy).then(() => toast(`${ic('copy', 's16')}Copied the question for ${esc(who)}. Brew doesn’t send it: paste it to them, then add their answer here.`), () => toast(`Ask ${esc(who)} directly, then add their answer here.`));
  };
  const imgOf = (ch) => ch.pkg?.image || ch.after?.images?.[0] || null;
  /* until a photo is made for it, the jam shows the card's own product photo (never a static: those carry their own words) */
  const cardPhoto = () => { if (!RX.p) return null; const im = (RX.p.images || cardOf(RX.p).images || []).find((x) => typeof x === 'string' && !/statics\//.test(x) && !/^\/?research\//.test(x) && !/\/a\/ad-[^/]+$/.test(x.split('?')[0])); return im || null; }; /* a rival's ad is the look of our version, never its picture */

  /* ---------- a social post, as it will look on its platform ----------
     X: a thread of posts joined by the reply line, with the character count. Reddit, LinkedIn, Quora, a Facebook group,
     Pinterest and a short video each get their own native frame. The picture or video to add is the attached media slot
     (the product photos the brief uses, then the brief in one line), never small print under the post. */
  const PM_NAME = { x_post: 'X', reddit_post: 'Reddit', linkedin_post: 'LinkedIn', quora_answer: 'Quora', fb_group_post: 'Facebook group', pinterest_pin: 'Pinterest', short_video: 'Short video', comment_reply: 'Comment reply' };
  const pmKind = (ch, p) => { const a = String(ch.action || '').split('.').pop(), pl = String(p.platform || '');
    if (PM_NAME[a]) return a;
    return /\b(x|twitter)\b/i.test(pl) ? 'x_post' : /reddit/i.test(pl) ? 'reddit_post' : /linkedin/i.test(pl) ? 'linkedin_post' : /quora/i.test(pl) ? 'quora_answer' : /facebook/i.test(pl) ? 'fb_group_post' : /pinterest/i.test(pl) ? 'pinterest_pin' : /short|tiktok|reel|youtube/i.test(pl) ? 'short_video' : 'post'; };
  const pmHandle = (p) => String(p.account || '').replace(/^@/, '') || String(B.brand.host || B.brand.name).replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  const pmThread = (copy) => { if (window.PostOpen?.thread) return window.PostOpen.thread(copy); /* one splitter for the stage and Copy and open */ const parts = String(copy || '').trim().split(/\n\s*\n(?=\s*\d{1,2}\s*[/.)]\s)/); return parts.length > 1 ? parts.map((x) => x.replace(/^\s*\d{1,2}\s*[/.)]\s*/, '').trim()) : [String(copy || '').trim()]; };
  const pmText = (t) => esc(t).replace(/(^|\s)([#@][\p{L}\p{N}_]+)/gu, '$1<span class="pm-tag">$2</span>').replace(/\n/g, '<br>');
  const pmBrief = (m) => { let s = String(m || '').replace(/\s*Use the reference photos? of[\s\S]*$/i, '').replace(/https?:\/\/\S+/g, '').replace(/\(\s*[, ]*\)/g, '').replace(/^\s*(real|vertical|square)[^:.]{0,48}:\s(?!\d)/i, '').trim();
    const ss = s.split(/(?<=\.)\s+/); while (ss.length > 1 && ss[0].length < 70 && /^(real|vertical|square|horizontal|\d)/i.test(ss[0])) ss.shift(); s = ss.join(' '); return s.charAt(0).toUpperCase() + s.slice(1); };
  /* store photos come as 4,000px originals; Shopify's CDN serves a small copy from the same address */
  /* the image CDN's own resize, so the feed never loads a 2000px original: Shopify (?width), Cloudinary-style paths (w_2000 →
     w_600: images.puma.com and most Next.js stores), Salesforce Commerce (?sw=), imgix and WordPress-style (?w=) */
  const cdnSized = (u, w) => { try { const x = new URL(u, location.href);
    if (/(^|\.)cdn\.shopify\.com$/.test(x.hostname) || x.pathname.startsWith('/cdn/shop/')) { x.searchParams.set('width', w); return x.toString(); }
    if (/\/image\/upload\//.test(x.pathname) && /(^|[,/])w_\d+/.test(x.pathname)) { x.pathname = x.pathname.replace(/(^|[,/])w_\d+/, `$1w_${w}`).replace(/,h_\d+/, ''); return x.toString(); }
    if (/demandware\.static|\/dw\/image\//.test(x.href)) { x.searchParams.set('sw', w); return x.toString(); }
    if (/(^|\.)imgix\.net$/.test(x.hostname) || x.searchParams.has('w')) { x.searchParams.set('w', w); return x.toString(); }
    return u; } catch { return u; } };
  const pmMedia = (ch, p, lg, { ratio = '', video = false } = {}) => {
    const made = imgOf(ch); if (!p.media && !made && !(p.photos || []).length) return lg && view === 'remix' ? `<div class="pm-media pm-add"><button class="btn btn-ghost sm" data-ph-open>${ic('pic', 's14')}Add a photo</button></div>` : '';
    if (video && p.video) return `<div class="pm-media sv-media" style="aspect-ratio:9/16"><video class="sv-vid" src="${esc(p.video)}"${p.poster ? ` poster="${esc(p.poster)}"` : ''} muted autoplay loop playsinline preload="metadata" data-sv-play></video>
      <button type="button" class="sv-snd" data-sv-sound aria-label="Turn the sound on" title="Sound">${ic('volOff', 's16')}</button><span class="sv-pbar" aria-hidden="true"><i></i></span></div>`;
    const isVid = video || /\b(video|footage|reel|9:16|seconds|clip)\b/i.test(p.media || '');
    if ((p.photos || []).length > 1) return `<div class="pm-media"><div class="pm-refs n${Math.min(p.photos.length, 3)}">${p.photos.slice(0, 4).map((u) => `<img src="${esc(cdnSized(u, 800))}" alt="" loading="lazy" decoding="async">`).join('')}</div></div>`; /* the product photos the team picked */
    if (made) return `<div class="pm-media"${ratio ? ` style="aspect-ratio:${ratio}"` : ''}><img src="${esc(made)}" alt="" style="filter:${esc(ch.gradeF || 'none')}"></div>`;
    const refs = [...new Set((String(p.media).match(/https?:\/\/[^\s,)]+?\.(?:jpe?g|png|webp)(?:\?[^\s,)]*)?/gi) || []))];
    const pics = (refs.length ? refs : /\b(product|pair|shoe|bottle|pack|item)\b/i.test(p.media) ? [cardPhoto()].filter(Boolean) : []).slice(0, 3);
    const brief = pmBrief(p.media), short = brief.length > 150 ? brief.slice(0, 149).replace(/\s+\S*$/, '') + '…' : brief;
    return `<div class="pm-media is-slot${pics.length ? ' has-ref' : ''}"${/^(9\/16|2\/3)$/.test(ratio) ? ` style="aspect-ratio:${ratio}"` : ''}>
      ${pics.length ? `<div class="pm-refs n${pics.length}">${pics.map((u) => `<img src="${esc(cdnSized(u, 800))}" alt="" loading="lazy" decoding="async">`).join('')}</div>` : ''}
      <div class="pm-slot-tx"><b>${ic(isVid ? 'vid' : 'pic', 's14')}${isVid ? 'Video to add' : 'Photo to add'}</b>${video ? '' /* inside the phone only the label: the note itself goes under the phone (svNote), so it never runs over the hook or the caption */ : lg && brief.length > 150 ? `<details><summary>${esc(short)}</summary><p>${esc(brief)}</p></details>` : `<span>${esc(short)}</span>`}</div></div>`;
  };
  /* a reel's "Video to add" note, under the phone (FEED-QA-19): long shot notes overlapped the hook inside the mockup */
  const svNote = (ch, p, lg) => { if (p.video || imgOf(ch) || (p.photos || []).length > 1 || !p.media) return ''; const brief = pmBrief(p.media); if (!brief) return '';
    const short = brief.length > 150 ? brief.slice(0, 149).replace(/\s+\S*$/, '') + '…' : brief;
    return `<div class="sv-note"><b>${ic('vid', 's14')}Video to add</b>${lg && brief.length > 150 ? `<details><summary>${esc(short)}</summary><p>${esc(brief)}</p></details>` : `<span>${esc(short)}</span>`}</div>`;
  };
  const pmAv = (round = true) => `<span class="pm-av${round ? '' : ' sq'}"><img src="${esc(B.brand.mark)}" alt=""></span>`;
  const pmIc = { reply: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', repost: '<path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/>', like: P.heart.replace(' class="ic-heart"', ''), views: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>', up: '<path d="M9 18v-6H5l7-7 7 7h-4v6H9z"/>', down: '<path d="M15 6v6h4l-7 7-7-7h4V6h6z"/>', thumb: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>', share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>', send: P.send };
  const pmI = (k) => `<svg class="ic s14" viewBox="0 0 24 24" aria-hidden="true">${pmIc[k] || ''}</svg>`;
  const pmBar = (items) => `<footer class="pm-bar">${items.map(([k, t]) => `<span>${pmI(k)}${t ? `<em>${esc(t)}</em>` : ''}</span>`).join('')}</footer>`;
  const postMock = (ch, p, lg) => {
    const kind = pmKind(ch, p), name = B.brand.name, h = pmHandle(p), wh = (p.where || []).filter((w) => w.name), tags = (p.hashtags || []).filter((t) => t && !String(p.copy || '').toLowerCase().includes(String(t).toLowerCase())); /* a tag already in the copy is not added twice */
    const where1 = wh[0], comm = where1 && !/search/i.test(where1.name) ? where1.name.replace(/\s*\(.*\)\s*$/, '') : '';
    let body = '', count = '';
    if (kind === 'x_post') {
      const posts = pmThread(p.copy); if (tags.length) posts[posts.length - 1] += `\n\n${tags.join(' ')}`;
      const shown = lg ? posts : posts.slice(0, 2); count = posts.length > 1 ? `${posts.length} posts` : '';
      body = `<div class="pm pm-x">${shown.map((t, i) => { const n = [...t].length;
        return `<article class="xp${i < shown.length - 1 ? ' has-next' : ''}">${pmAv()}<div class="xp-b"><header><b>${esc(name)}</b><span>@${esc(h)}</span></header><p>${pmText(t)}</p>${i === 0 ? pmMedia(ch, p, lg, { ratio: '16/9' }) : ''}
          <div class="xp-f">${pmBar([['reply', ''], ['repost', ''], ['like', ''], ['views', '']])}<small class="xp-cc${n > 280 ? ' over' : ''}" title="Characters in this post">${n}/280</small></div></div></article>`; }).join('')}${!lg && posts.length > 2 ? `<small class="pm-more">+${posts.length - 2} more in the thread</small>` : ''}</div>`;
    } else if (kind === 'reddit_post') {
      const sub = /^r\//i.test(comm) ? comm : '', reply = !p.title || /\breply\b/i.test(String(p.platform || '')); /* "Reddit reply": a title an AI fix added is not shown as a new post */
      body = `<div class="pm pm-rd${reply ? ' is-reply' : ''}"><header class="rd-h">${sub ? `<span class="rd-sub">r/</span><b>${esc(sub)}</b><span>· u/${esc(h)}_team</span>` : `${pmAv()}<b>u/${esc(h)}_team</b>`}<span>· now</span></header>
        ${reply ? '<small class="rd-re">Reply in the thread</small>' : `<h3 class="rd-t">${esc(p.title)}</h3>`}<p class="pm-body">${pmText(String(p.copy || '').slice(0, lg ? 6000 : 320))}</p>${pmMedia(ch, p, lg)}
        ${pmBar([['up', 'Vote'], ['reply', reply ? 'Reply' : 'Comment'], ['share', 'Share']]).replace('<span>', '<span class="rd-vote">').replace('<em>Vote</em>', `<em>Vote</em>${pmI('down')}`)}</div>`;
    } else if (kind === 'linkedin_post') {
      body = `<div class="pm pm-li"><header class="li-h">${pmAv(false)}<div><b>${esc(p.author || name)}</b><small>${esc(p.author ? p.authorRole || `Founder, ${name}` : comm || 'Company page')}</small><small>Now · Public</small></div><span class="li-f">+ Follow</span></header>
        <p class="pm-body">${pmText(String(p.copy || '').slice(0, lg ? 6000 : 300))}${tags.length ? `<br><br>${pmText(tags.join(' '))}` : ''}</p>${pmMedia(ch, p, lg, { ratio: '1/1' })}
        ${pmBar([['thumb', 'Like'], ['reply', 'Comment'], ['repost', 'Repost'], ['send', 'Send']])}</div>`;
    } else if (kind === 'quora_answer') {
      body = `<div class="pm pm-qa">${p.title ? `<h3 class="qa-q">${esc(p.title)}</h3>` : ''}<header class="qa-h">${pmAv()}<div><b>${esc(name)} team</b><small>Works at ${esc(name)} · Now</small></div></header>
        <p class="pm-body">${pmText(String(p.copy || '').slice(0, lg ? 6000 : 300))}</p>${pmMedia(ch, p, lg)}
        ${pmBar([['up', 'Upvote'], ['reply', 'Comment'], ['share', 'Share']])}</div>`;
    } else if (kind === 'pinterest_pin') {
      body = `<div class="pm pm-pin">${pmMedia(ch, p, lg, { ratio: '2/3' }) || `<div class="pm-media is-slot" style="aspect-ratio:2/3"></div>`}<div class="pin-b"><h3>${esc(p.title || '')}</h3><p class="pm-body">${pmText(String(p.copy || '').slice(0, lg ? 1200 : 160))}</p>${tags.length ? `<p class="pm-body">${pmText(tags.join(' '))}</p>` : ''}
        <footer class="pin-f">${pmAv()}<b>${esc(name)}</b><span class="pin-go">Visit</span></footer></div></div>`;
    } else if (kind === 'short_video') {
      /* the words over the phone: beat 1's on-screen text, never the script's tags ("(On-screen text) …", "(Sound effect: …)") */
      const TAGS = /\(\s*(?:on-?screen(?: text)?|text overlay|caption|sound(?: effect)?|sfx|voice-?over|vo|said|voice)\s*(?::\s*[^)]*)?\)/gi;
      const shownOf = (l) => { const s0 = String(l || ''), m = /\(\s*on-?screen(?: text)?\s*(?::\s*([^)]*))?\)\s*([^()]*)/i.exec(s0); return (m ? (m[1] || m[2]) : s0.replace(TAGS, ' ')).replace(/\s{2,}/g, ' ').trim(); };
      /* a beat's line in plain labels: "On screen: …", "Sound: …", what is said as is (the script's own "(On-screen text)" tags never show) */
      const beatLine = (l) => { const parts = []; let last = 0, kind = '', m; const re = /\(\s*(on-?screen(?: text)?|text overlay|caption|sound(?: effect)?|sfx|voice-?over|vo)\s*(?::\s*([^)]*))?\)/gi, s0 = String(l || ''), push = (k, t) => { t = String(t || '').trim(); if (t) parts.push([k, t]); };
        while ((m = re.exec(s0))) { push(kind, s0.slice(last, m.index)); const k = /sound|sfx/i.test(m[1]) ? 'Sound' : /voice|vo/i.test(m[1]) ? 'Says' : 'On screen'; if (m[2]) { push(k, m[2]); kind = ''; } else kind = k; last = re.lastIndex; }
        push(kind, s0.slice(last)); return parts.map(([k, t]) => (k ? `<i class="sv-tag">${k}:</i> ${esc(t)}` : esc(t))).join('<br>'); };
      const sc = p.script || [], hook = shownOf(sc[0]?.line) || p.title || String(p.copy || '').split('\n')[0];
      /* the clip itself: made on the stage (a first frame of the real product, animated, the hook read over it) */
      const hk = String(hook || '').split(/\s+/).slice(0, 14).join(' '), newHook = p.video && p.videoHook && p.videoHook.trim() !== hk.trim(), newPic = p.video && p.poster && p.image && p.image !== p.poster, stale = newHook || newPic;
      const make = lg && view === 'remix' && !ch.batchKey ? (ch.videoPending ? `<div class="sv-make is-busy"><brew-load class="spin"></brew-load>${esc(ch.videoStep || 'Making the video')}…</div>`
        : !stale && !ch.videoError ? '' /* the jam's main button makes the first video (stepBar) */ : !p.video || stale ? `<div class="sv-make is-row">${ch.videoError ? `<small>${esc(ch.videoError)}</small>` : ''}<button class="btn btn-ghost sm" data-rx="video">${ic('vid', 's14')}${stale ? (newPic ? 'Remake the video with this photo' : 'Remake the video for this hook') : ch.videoError ? 'Make it again' : 'Make the video'}${freeTag(true)}</button></div>` : '') : '';
      body = `<div class="pm pm-sv"><div class="sv-phone">${pmMedia(ch, p, lg, { ratio: '9/16', video: true }) || '<div class="pm-media is-slot" style="aspect-ratio:9/16"></div>'}${p.video || (p.wordsIn && p.wordsIn === imgOf(ch)) /* the picture already carries its headline: never a second one over it */ ? '' : `<p class="sv-hook">${esc(hook || '')}</p>`}${/is-row/.test(make) ? '' : make}
          <div class="sv-side">${pmI('like')}${pmI('reply')}${pmI('share')}</div><div class="sv-cap"><b>@${esc(h)}</b><span class="sv-cap-t">${esc(String(p.title || String(p.copy || '').split('\n')[0] || '').replace(/["“”]/g, '').replace(/\s{2,}/g, ' ').trim())}</span>${tags.length ? `<span class="pm-tag sv-cap-tags">${esc(tags.slice(0, 4).join(' '))}</span>` : ''}</div></div>${/is-row/.test(make) ? make : ''}${svNote(ch, p, lg)}
        ${lg && sc.length ? `<ol class="sv-beats">${sc.map((x, i) => `<li><small>${esc(x.beat || `Beat ${i + 1}`)}</small><b>${beatLine(x.line)}</b><span>${esc(x.shot || '')}</span></li>`).join('')}</ol>` : ''}</div>`;
    } else {
      body = `<div class="pm pm-fb"><header class="fb-h">${pmAv()}<div><b>${esc(name)} team</b><small>${esc(comm ? `in ${comm}` : kind === 'fb_group_post' ? 'Group post' : (p.platform || 'Post'))} · Now</small></div></header>
        ${p.title ? `<h3 class="fb-t">${esc(p.title)}</h3>` : ''}<p class="pm-body">${pmText(String(p.copy || '').slice(0, lg ? 6000 : 300))}${tags.length ? `<br><br>${pmText(tags.join(' '))}` : ''}</p>${pmMedia(ch, p, lg)}
        ${pmBar([['thumb', 'Like'], ['reply', 'Comment'], ['share', 'Share']])}</div>`;
    }
    const line = [esc(p.platform || PM_NAME[kind] || 'Post'), count, p.postAt ? esc(p.postAt) : ''].filter(Boolean).join(' · ');
    const whereHtml = wh.length && lg ? `<p class="pm-where">${ic('link', 's14')}<span>Post in ${wh.slice(0, 3).map((w) => /^https?:/.test(w.url || '') ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : esc(w.name)).join(', ')}${where1.rule ? `${tipBtn(where1.rule)}` : ''}</span></p>` : '';
    return `<div class="as as-pm${lg ? ' lg' : ''}"><p class="pm-line">${line}</p>${body}${whereHtml}</div>`;
  };

  /* ---------- the other stages, full size: each looks like the place it will live ----------
     A message is a WhatsApp chat or an inbox email; an FAQ answer is the page; a budget change is an Ads Manager table;
     a decision, a setup and a production brief are a clean sheet of paper. The small previews keep their compact form. */
  const tokHtml = (s) => tokSpan(esc(s)).replace(/\n/g, '<br>');
  const stageMock = (ch, p) => {
    const name = esc(B.brand.name), quiet = (xs) => { const t = xs.filter(Boolean).map(esc).join(' · '); return t ? `<p class="pm-line">${t}</p>` : ''; };
    if (ch.family === 'crm') {
      const chn = String(p.channel || 'WhatsApp'), btns = (p.buttons || []).filter(Boolean), meta = quiet([chn, p.trigger, p.segment, p.code && `code ${p.code}`]);
      if (/mail/i.test(chn)) return `<div class="as as-pm lg">${meta}<div class="pm ml"><div class="ml-top"><b class="ml-subj">${esc(p.subject || `A note from ${B.brand.name}`)}</b>
          <div class="ml-from">${pmAv()}<div><b>${name}</b><small>to <span class="tok">first name</span></small></div><small class="ml-t">10:02</small></div></div>
          <div class="ml-body"><p>${tokHtml(p.message || '')}</p>${btns.map((b, i) => `<span class="ml-btn${i ? ' alt' : ''}">${esc(b)}</span>`).join('')}</div>
          <p class="ml-foot">${name} · ${esc(B.brand.host || '')} · Unsubscribe</p></div></div>`;
      return `<div class="as as-pm lg">${meta}<div class="pm wa2${/sms|text/i.test(chn) ? ' is-sms' : ''}"><div class="wa2-h">${pmAv()}<div><b>${name}</b><small>${/sms|text/i.test(chn) ? 'Text message' : 'Business account'}</small></div></div>
        <div class="wa2-chat"><span class="wa2-day">Today</span><div class="wa2-msg"><p>${tokHtml(p.message || '')}</p><small>10:02</small></div>${btns.length ? `<div class="wa2-btns">${btns.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</div></div></div>`;
    }
    if (ch.family === 'outreach') return `<div class="as as-pm lg">${quiet(['Email', p.company])}<div class="pm ml"><div class="ml-top"><b class="ml-subj">${esc(p.subject || `A note from ${B.brand.name}`)}</b>
          <div class="ml-from">${pmAv()}<div><b>${name}</b><small>to ${esc(p.to || 'the right person')}</small></div></div></div>
          <div class="ml-body"><p>${tokHtml(p.body || '')}</p></div></div></div>`;
    if (ch.family === 'vis' && /\.(llms_txt|schema_fix)$/.test(ch.action)) return ''; /* a file (llms.txt, product markup) shows as the file it is, not as an FAQ page */
    if (ch.family === 'vis') { const es = p.entries || [];
      return `<div class="as as-web as-faq lg"><div class="aw-bar"><i></i><i></i><i></i><span>${esc(p.file || `${B.brand.host}/faq`)}</span></div>
        <div class="faq-b"><h3>Questions people ask</h3>${es.map((e, i) => `<details class="faq-q"${i < 2 ? ' open' : ''}><summary>${esc(e.q)}${ic('chev', 's16')}</summary><p>${txt(e.a)}${e.source ? tipBtn(`Source: ${e.source}`) : ''}</p></details>`).join('')}
        ${p.asOf ? `<small class="faq-asof">Updated ${esc(String(p.asOf).replace(/^as of\s*/i, ''))}</small>` : ''}</div></div>`; }
    if (ch.family === 'meta_ops') { const items = p.items || [];
      return `<div class="as as-pm lg">${quiet(['Meta Ads Manager', ch.actionLabel, p.checkAt])}<div class="pm am2"><table><thead><tr><th>Ad set or ad</th><th>Now</th><th>After</th></tr></thead>
        <tbody>${items.map((r) => `<tr><td><span class="am2-on"></span>${esc(r.name)}</td><td>${esc(r.now)}</td><td><b>${esc(r.next)}</b></td></tr>`).join('')}</tbody></table>
        ${p.rule ? `<p class="am2-rule">${ic('eyeoff', 's14')}<span><b>Rule</b> ${esc(p.rule)}</span></p>` : ''}${p.spendChangeWeek ? `<p class="am2-spend ${p.spendChangeWeek > 0 ? 'up' : 'down'}">${p.spendChangeWeek > 0 ? '+' : '−'}${inrS(Math.abs(p.spendChangeWeek))} a week</p>` : ''}</div></div>`; }
    if (ch.family === 'setup') return `<div class="as as-sheet lg"><small class="sh-k">${esc(p.tool || 'Setup')}</small><h3>${esc(p.what || '')}</h3>
        <ol class="sh-steps">${(p.steps || []).map((x) => `<li><span class="sh-box"></span><span>${txt(x)}</span></li>`).join('')}</ol>${p.verify ? `<p class="sh-done">${ic('check', 's16')}<span><b>Done when</b> ${esc(p.verify)}</span></p>` : ''}</div>`;
    if (ch.family === 'brief') { const meta = [['Talent', p.talent], ['Where', p.location], ['Due', p.deadline]].filter(([, v]) => v);
      return `<div class="as as-sheet lg"><small class="sh-k">Production brief</small><h3>${esc(p.title || '')}</h3>${(p.deliverables || []).length ? `<div class="sh-chips">${p.deliverables.map((d) => `<span>${esc(d)}</span>`).join('')}</div>` : ''}
        <ol class="sh-shots">${(p.scenes || []).map((s, i) => `<li><span class="sh-n">${i + 1}</span><div><b>${esc(s.shot || '')}</b>${s.line ? `<span>${esc(s.line)}</span>` : ''}</div></li>`).join('')}</ol>
        ${meta.length ? `<dl class="sh-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}</div>`; }
    if (!['meta_ad', 'social', 'post', 'search', 'print', 'listing', 'store'].includes(ch.family)) return `<div class="as as-sheet lg"><small class="sh-k">Decision</small><h3>${esc(p.decision || '')}</h3>${p.why ? `<p class="sh-lead">${esc(p.why)}</p>` : ''}
        ${(p.changes || []).length ? `<h5>What changes</h5><ul class="sh-list">${p.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${p.owner ? `<div class="sh-sign"><small>Who decides</small><b>${esc(p.owner)}</b></div>` : ''}</div>`;
    return '';
  };

  /* ---------- the asset, as it will run, in its channel's frame ---------- */
  /* the card's first draft is v0 on the stage, exactly as the card showed it: a text draft (an email, a chat, a page) is its
     picture until new words replace it; a clip plays where the widget shows its picture */
  /* CRE-07: the ad's headline edits in place, one step: click it on the preview, type, Enter (or click away) saves it as a new
     version through the same POST /edit as the brief form; Esc puts it back. Only on the jam's stage, on the version in use */
  const hlHtml = (ch, p, lg) => (lg && view === 'remix' && !RX.viewing && ch.state !== 'jam' && !ch.batchKey && RX.ch?.id === ch.id
    ? `<b class="am-hl" data-hl-edit role="button" tabindex="0" title="Click to change the headline" spellcheck="true">${esc(p.headline || '')}</b>` : `<b>${esc(p.headline || '')}</b>`);
  const assetHtml = (ch, size = 'sm') => {
    const p = ch.pkg || {}, d = p.draft;
    /* a version remade as a reel, a carousel or a picture (/remake) shows as that format: the clip, the slides, the picture, or its words while they're made */
    if (d?.remade) { const L = size === 'lg' ? ' lg' : '';
      if (d.as === 'video' && d.video) return `<div class="as as-draft as-remade${L}"><video class="as-vid" src="${esc(d.video)}"${d.poster ? ` poster="${esc(d.poster)}"` : ''} controls playsinline muted loop preload="metadata"></video></div>`;
      if (d.as === 'carousel' && d.images?.length) return `<div class="as as-draft as-remade as-car${L}">${d.images.map((u, i) => `<img src="${esc(u)}" alt="${esc((d.slides || [])[i]?.text || `Slide ${i + 1}`)}" loading="lazy">`).join('')}</div>`;
      if (d.as === 'image' && d.images?.[0]) return `<div class="as as-draft as-remade${L}"><img src="${esc(d.images[0])}" alt="${esc(d.title || '')}"></div>`;
      const lines = d.as === 'video' ? (d.script || []).map((x) => x.line || x.shot || '') : (d.slides || []).map((x) => x.text || '');
      /* "being made" only while a remake really runs (the server's remakePending); otherwise one tap makes it again, never a dead end */
      const busy = !!ch.remakePending, again = !busy && L && view === 'remix' && !ch.realOnly && ch.state !== 'live';
      return `<div class="as as-draft as-remade is-words${L}"><p class="as-rw-k">${d.as === 'video' ? 'Reel' : d.as === 'carousel' ? 'Carousel' : 'Picture'} · ${busy ? 'the media is being made' : ch.remakeError ? esc(ch.remakeError) : 'words only'}</p>${d.overlay ? `<b>${esc(d.overlay)}</b>` : ''}<ol>${lines.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${again ? `<button type="button" class="btn btn-primary sm as-rw-again" data-j2-remake="${esc(d.as)}">${ic('refresh', 's14')}Make it again${freeTag(d.as === 'video')}</button>` : ''}</div>`; }
    /* a text draft that is code (product markup, llms.txt, a snippet): the code itself, readable, never the mock's picture of it
       with a product photo on top; the file it goes in heads it */
    if (d?.text && d.code) return `<div class="as as-file as-code${size === 'lg' ? ' lg' : ''}"><div class="af-h">${ic('doc', 's14')}${esc(String(p.file || d.title || '').replace(/^page section:\s*/i, ''))}</div><div class="rx">${rich(d.code)}</div></div>`;
    if (d?.text && d.images?.[0]) return `<div class="as as-draft${size === 'lg' ? ' lg' : ''}"><img src="${esc(d.images[0])}" alt="${esc(d.title || 'First draft')}"></div>`;
    let html = assetHtml0(ch, size);
    /* a widget with no picture of its own (a page, a message, a brief) still opens on the card's draft picture */
    if (d && !d.text && !p.video && d.images?.[0] && !['meta_ad', 'social', 'post'].includes(ch.family) /* an ad or a post has its own picture: never a second one stacked above it */ && !html.includes(esc(d.images[0]))) html = `<div class="as as-draft${size === 'lg' ? ' lg' : ''}"><img src="${esc(d.images[0])}" alt="${esc(d.title || 'First draft')}"></div>${html}`;
    if (!p.video || html.includes(`src="${esc(p.video)}"`)) return html;
    const vid = `<video class="as-vid" src="${esc(p.video)}"${p.poster ? ` poster="${esc(p.poster)}"` : ''} controls playsinline muted loop preload="metadata"></video>`;
    const pic = p.image || p.poster, re = pic ? new RegExp(`<img\\b[^>]*\\bsrc="${esc(pic).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`) : null;
    return re && re.test(html) ? html.replace(re, vid) : `<div class="as as-draft${size === 'lg' ? ' lg' : ''}">${vid}</div>${html}`; };
  const assetHtml0 = (ch, size = 'sm') => {
    const p = ch.pkg || {}, lg = size === 'lg', act = String(ch.action).split('.').pop();
    const pending = ch.imagePending ? `<div class="as-pending"><brew-load class="spin"></brew-load>Making the creative…</div>` : '';
    if (ch.family === 'meta_ad' && act === 'whatsapp_ad' && !lg) return `<div class="as as-chat">${(p.chat || []).slice(0, 3).map((m) => `<div class="wa ${m.from === 'in' ? 'in' : 'out'}">${esc(m.text)}</div>`).join('')}</div>`;
    // several pictures in one ad or post: a row that swipes, each with its own photo and words
    const rows = p.cards || p.slides || [], pics = p.cardImages || [];
    const swipe = (cls, inner) => `<div class="as-swipe ${cls}" style="--ar:${esc((p.format || '1:1').replace(':', '/'))}">${inner}</div>`;
    const picOf = (i) => pics[i] || (i === 0 ? p.image || null : null); // only photos made for this ad; the card's own image carries its own words
    const morePics = lg && rows.length > 1 && !ch.imagePending && rows.some((_, i) => !picOf(i)) ? `<button class="btn btn-ghost sm as-allpics" data-rx="images-all">${ic('sparkles', 's14')}Make the photo for every ${ch.family === 'social' ? 'slide' : 'card'}</button>` : '';
    if (ch.family === 'meta_ad' && rows.length) return `<div class="as as-meta as-multi${lg ? ' lg' : ''}"><div class="am-h"><span class="am-logo"><img src="${esc(B.brand.mark)}" alt=""></span><div><b>${B.brand.name}</b><small>Sponsored</small></div></div>
        <p class="am-text">${esc(p.primaryText || '')}</p>
        ${swipe('am-cards', rows.slice(0, lg ? 10 : 3).map((r, i) => `<figure class="am-card"><div class="am-cm">${picOf(i) ? `<img src="${esc(picOf(i))}" alt="" style="filter:${esc(ch.gradeF || 'none')}">` : `<span class="am-cm-e">${ic('pic', 's16')}</span>`}${i === 0 ? pending : ''}</div><figcaption><b>${esc(r.headline || '')}</b>${r.text ? `<span>${esc(r.text)}</span>` : ''}<em>${esc(p.cta || 'Shop now')}</em></figcaption></figure>`).join(''))}
        <small class="am-count">${rows.length} cards · swipe</small>${morePics}</div>`;
    if (ch.family === 'meta_ad' && (p.products?.length || p.productSet)) {
      const img = imgOf(ch), coll = !!p.products?.length;
      return `<div class="as as-meta as-coll${lg ? ' lg' : ''}"><div class="am-h"><span class="am-logo"><img src="${esc(B.brand.mark)}" alt=""></span><div><b>${B.brand.name}</b><small>Sponsored</small></div></div>
        <p class="am-text">${esc(p.primaryText || '')}</p>
        <div class="am-media${img ? '' : ' noimg'}" style="aspect-ratio:${coll ? '16/9' : '1/1'}">${img ? `<img src="${esc(img)}" alt="" style="filter:${esc(ch.gradeF || 'none')}">` : `<div class="am-empty">${ic('sparkles', 's16')}<span>${coll ? 'The cover is made in the studio' : 'Each person sees products from the set'}</span></div>`}${!coll && p.frame ? `<span class="am-frame">${esc(p.frame)}</span>` : ''}${pending}${!img && lg && !ch.imagePending ? `<div class="am-make"><button class="btn btn-primary sm" data-rx="image">${ic('sparkles', 's14')}Make the ${coll ? 'cover' : 'sample photo'}</button></div>` : ''}</div>
        ${coll ? `<div class="am-grid">${p.products.slice(0, 4).map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : `<p class="am-set">${ic('grid', 's14')}<span><b>Product set:</b> ${esc(p.productSet)}</span></p>`}
        <div class="am-foot"><div><small>${B.brand.host}</small>${hlHtml(ch, p, lg)}${coll && p.instantPage ? `<span>Opens: ${esc(p.instantPage)}</span>` : ''}</div><span class="am-cta">${esc(p.cta || 'Shop now')}</span></div></div>`;
    }
    if (ch.family === 'social') {
      const story = p.format === '9:16', handle = p.account || `@${String(B.brand.name).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
      const slides = rows.length ? rows : [{ onSlide: p.overlay || '', imageBrief: p.imageBrief }];
      return `<div class="as as-ig${story ? ' is-story' : ''}${lg ? ' lg' : ''}"><div class="ig-h"><span class="am-logo"><img src="${esc(B.brand.mark)}" alt=""></span><b>${esc(handle)}</b>${p.postAt ? `<small>${esc(p.postAt)}</small>` : ''}</div>
        ${swipe('ig-slides', slides.slice(0, lg ? 10 : 3).map((r, i) => `<figure class="ig-slide">${picOf(i) ? `<img src="${esc(picOf(i))}" alt="" style="filter:${esc(ch.gradeF || 'none')}">` : ''}${r.onSlide ? `<figcaption>${esc(r.onSlide)}</figcaption>` : ''}${i === 0 ? pending : ''}${slides.length > 1 ? `<span class="ig-n">${i + 1}/${slides.length}</span>` : ''}</figure>`).join(''))}
        ${!picOf(0) && lg && !ch.imagePending ? `<div class="ig-make"><button class="btn btn-primary sm" data-rx="image">${ic('sparkles', 's14')}Make the first photo</button></div>` : ''}${morePics}
        ${story ? (p.stickers ? `<p class="ig-st">${ic('chat', 's14')}${esc(p.stickers)}</p>` : '') : `<p class="ig-cap"><b>${esc(handle)}</b> ${esc(p.caption || '').replace(/\n/g, '<br>')}${(p.hashtags || []).length ? `<span class="ig-tags">${esc(p.hashtags.join(' '))}</span>` : ''}</p>`}</div>`;
    }
    if (ch.family === 'meta_ad') {
      const made = imgOf(ch), img = made || (lg ? cardPhoto() : null), ratio = (p.format || '4:5').replace(':', '/'), [rw, rh] = (p.format || '4:5').split(':').map(Number);
      return `<div class="as as-meta${lg ? ' lg' : ''}" style="--ar:${(rw / rh) || 0.8}"><div class="am-h"><span class="am-logo"><img src="${esc(B.brand.mark)}" alt=""></span><div><b>${B.brand.name}</b><small>Sponsored</small></div></div>
        <p class="am-text">${esc(p.primaryText || '')}</p>
        <div class="am-media${img ? '' : ' noimg'}" style="aspect-ratio:${ratio}">${img ? `<img src="${esc(img)}" alt="" style="filter:${esc(ch.gradeF || 'none')}">` : !lg ? `<div class="am-empty">${ic('sparkles', 's16')}<span>The photo is made in the studio</span></div>` : ''}${p.overlay && p.image && p.wordsIn !== p.image /* a final with its words set in the picture */ ? `<span class="am-ov">${esc(p.overlay)}</span>` : ''}${pending}${!p.image && lg && !ch.imagePending ? (img ? `<button class="am-newpic" data-rx="image">${ic('sparkles', 's14')}New photo for this ad${freeTag()}</button>` : `<div class="am-make"><span>No photo for this version yet</span><button class="btn btn-primary sm" data-rx="image">${ic('sparkles', 's14')}Make the photo${freeTag()}</button></div>`) : ''}</div>
        <div class="am-foot"><div><small>${B.brand.host}</small>${hlHtml(ch, p, lg)}${p.description ? `<span>${esc(p.description)}</span>` : ''}</div><span class="am-cta">${esc(p.cta || 'Shop now')}</span></div>
        ${lg && act === 'whatsapp_ad' && p.chat?.length ? `<div class="am-chat"><small>When they tap, WhatsApp opens with</small>${p.chat.map((m) => `<div class="wa ${m.from === 'in' ? 'in' : 'out'}">${esc(m.text)}</div>`).join('')}</div>` : ''}</div>`;
    }
    if (ch.family === 'post') return postMock(ch, p, lg);
    if (lg) { const sm = stageMock(ch, p); if (sm) return sm; }
    if (ch.family === 'search') return `<div class="as as-file as-search"><div class="af-h">${ic('link', 's14')}Google Search · ${esc(p.adGroup || '')}</div><div class="srch"><small>Sponsored · ${esc(String(p.finalUrl || `${B.brand.host}`).replace(/^https?:\/\//, ''))}</small><b>${esc((p.headlines || []).slice(0, 3).join(' | '))}</b><p>${esc((p.descriptions || [])[0] || '')}</p></div>
      ${lg ? `<div class="af-e"><b>Keywords</b><p>${esc((p.keywords || []).join(' · '))}</p>${(p.negatives || []).length ? `<small>Not for: ${esc(p.negatives.join(', '))}</small>` : ''}</div>` : ''}</div>`;
    if (ch.family === 'setup') return `<div class="as as-doc"><small>${esc(p.tool || 'Setup')}</small><h4>${esc(p.what || '')}</h4><ol>${(p.steps || []).slice(0, lg ? 10 : 3).map((x) => `<li><span>${txt(x)}</span></li>`).join('')}</ol>${p.verify ? `<p class="ad-meta">${ic('check', 's14')} Done when: ${esc(p.verify)}</p>` : ''}</div>`;
    if (ch.family === 'print') return `<div class="as as-print"><div class="pr-card"><small>Front</small><div class="rx">${rich(p.front)}</div></div>${p.back ? `<div class="pr-card back"><small>Back</small><p>${esc(p.back)}</p>${p.qr ? `<span class="pr-qr">QR · ${esc(p.qr)}</span>` : ''}</div>` : ''}<p class="ad-meta">${esc([p.size, p.quantity && `${p.quantity} cards`, p.goesIn].filter(Boolean).join(' · '))}</p></div>`;
    if (ch.family === 'listing') return `<div class="as as-ops as-listing"><div class="ao-h">${ic('grid', 's14')}Marketplace listings · ${esc(p.product || '')}</div>
      ${p.name ? `<div class="al-name"><small>One name everywhere</small><b>${esc(p.name)}</b></div>` : ''}
      <ul class="ao-list">${(p.items || []).slice(0, lg ? 20 : 4).map((r) => `<li><b>${esc(r.marketplace)}</b>${r.now ? `<del>${esc(r.now)}</del>` : ''}<span class="al-new">${esc(r.new)}</span></li>`).join('')}</ul>
      ${lg && (p.bullets || []).length ? `<div class="al-bul"><small>Bullets on every listing</small><ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
      ${(p.photoSet || []).length || (ch.imagePending && (p.photoShots || []).length) ? `<div class="al-photos"><small>${ch.imagePending ? 'Making the listing photos…' : (p.photoSet || []).some((x) => x.own) ? `${p.photoSet.length} of your product photos for every listing <span class="dummy-tag" title="No photo could be made here, so these are the store’s own photos in the shots’ places">Dummy</span>` : `${p.photoSet.length} photos for every listing`}</small><div class="al-tiles">${(ch.imagePending && !(p.photoSet || []).length ? p.photoShots.map((shot) => ({ shot })) : p.photoSet).map((x) => `<figure class="al-tile">${x.image ? `<img src="${esc(x.image)}" alt="${esc(x.shot)}" loading="lazy">` : '<span class="sk"></span>'}<figcaption>${esc(x.shot)}</figcaption></figure>`).join('')}</div></div>`
        : lg && /listing_content$/.test(String(ch.action || '')) && !ch.imagePending && !p.photoBrief /* no photo can be made or placed: the shots stay as the photo brief */ ? `<div class="am-make"><button class="btn btn-primary sm" data-rx="listing-photos">${ic('sparkles', 's14')}Make the photos</button></div>` : ''}
      ${lg && p.images && !(p.photoSet || []).length ? `<p class="ao-rule">${ic('grid', 's14')}<span>${p.photoBrief ? '<b>Photo brief</b> ' : ''}${esc(p.images)}</span></p>` : ''}${p.reason ? `<p class="ao-rule"><span>${esc(p.reason)}</span></p>` : ''}</div>`;
    if (ch.family === 'meta_ops') return `<div class="as as-ops"><div class="ao-h">${ic('megaphone', 's14')}Meta Ads Manager · ${esc(ch.actionLabel)}</div>
      <ul class="ao-list">${(p.items || []).map((r) => `<li><b>${esc(r.name)}</b><div class="ao-ch"><span>${esc(r.now)}</span>${ic('right', 's14')}<strong>${esc(r.next)}</strong></div></li>`).join('')}</ul>
      ${p.rule ? `<p class="ao-rule">${ic('eyeoff', 's14')}<span><b>Rule:</b> ${esc(p.rule)}${p.checkAt ? ` · ${esc(p.checkAt)}` : ''}</span></p>` : ''}
      ${p.spendChangeWeek ? `<p class="ao-spend ${p.spendChangeWeek > 0 ? 'up' : 'down'}">${p.spendChangeWeek > 0 ? '+' : '−'}${inrS(Math.abs(p.spendChangeWeek))} a week</p>` : ''}</div>`;
    /* CRE-15: a landing page draft (remix.js landingOf): hero with the one button, three benefit blocks with the brand's photos,
       one real review quote when the read has one; the same browser frame as a page section */
    if (ch.family === 'store' && p.landing?.hero) { const L = p.landing;
      return `<div class="as as-web as-landing"><div class="aw-bar"><i></i><i></i><i></i><span>${esc(B.brand.host || '')}</span></div><div class="lp">
        <section class="lp-hero"><small class="aw-where">Landing page</small><h3>${esc(L.hero)}</h3>${L.sub ? `<p>${esc(L.sub)}</p>` : ''}<span class="aw-btn">${esc(L.cta || 'Shop now')}</span></section>
        ${(L.benefits || []).length ? `<section class="lp-ben">${L.benefits.slice(0, size === 'lg' ? 3 : 2).map((b) => `<figure>${b.img ? `<img src="${esc(cdnSized(b.img, 600))}" alt="" loading="lazy" decoding="async">` : '<span class="lp-ph"></span>'}<figcaption><b>${esc(b.title)}</b>${b.body ? `<span>${esc(b.body)}</span>` : ''}</figcaption></figure>`).join('')}</section>` : ''}
        ${L.quote?.text ? `<blockquote class="lp-q"><p>“${esc(L.quote.text)}”</p><cite>${esc(L.quote.who || 'A customer review')}</cite></blockquote>` : ''}</div></div>`; }
    if (ch.family === 'store') return `<div class="as as-web"><div class="aw-bar"><i></i><i></i><i></i><span>${esc((String(p.pages || '').match(/(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s,;)]*/i) || [`${B.brand.host}`])[0].replace(/^www\./, ''))}</span></div>
      <div class="aw-body"><small class="aw-where">${esc([String(p.pages || '').replace(/(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/gi, '').replace(/^[\s,;·-]+|[\s,;·-]+$/g, ''), p.section].filter(Boolean).join(' · '))}</small><h4>${esc(p.heading || '')}</h4><div class="rx">${rich(p.body)}</div>${(p.bullets || []).length ? `<ul>${p.bullets.map((x) => `<li>${ic('check', 's14')}${esc(x)}</li>`).join('')}</ul>` : ''}
      ${p.priceAfter ? `<div class="aw-price">${p.priceBefore ? `<del>${esc(p.priceBefore)}</del>` : ''}<b>${esc(p.priceAfter)}</b></div>` : ''}${p.button ? `<span class="aw-btn">${esc(p.button)}</span>` : ''}</div></div>`;
    if (ch.family === 'vis') return `<div class="as as-file"><div class="af-h">${ic('link', 's14')}${esc(p.file || `${B.brand.host}/faq`)}${p.asOf ? `<span>${esc(p.asOf)}</span>` : ''}</div>${(p.entries || []).slice(0, lg ? 8 : 2).map((e) => `<div class="af-e"><b>${esc(e.q)}</b><p>${txt(e.a)}</p>${e.source ? `<small>Source: ${esc(e.source)}</small>` : ''}</div>`).join('')}</div>`;
    if (ch.family === 'outreach') return `<div class="as as-doc"><small>Email to ${esc([p.to, p.company].filter(Boolean).join(', ') || 'a business')}</small><h4>${esc(p.subject || '')}</h4><p>${esc(String(p.body || '').slice(0, lg ? 2000 : 220))}</p></div>`;
    if (ch.family === 'crm') {
      const wa = p.channel !== 'Email';
      return `<div class="as as-phone${wa ? ' wa-ph' : ''}"><div class="ap-h">${wa ? `<span class="av" style="--ac:#25D366;width:22px;height:22px">A</span><b>${B.brand.name}</b><small>${esc(p.channel || 'WhatsApp')}</small>` : `<b>${esc(p.subject || `${B.brand.name}`)}</b><small>from ${B.brand.name}</small>`}</div>
        <div class="ap-msg rx">${rich(p.message)}${(p.buttons || []).length ? `<div class="ap-btns">${p.buttons.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</div>
        <small class="ap-meta">${esc([p.trigger, p.segment].filter(Boolean).join(' · '))}${p.code ? ` · code ${esc(p.code)}` : ''}</small></div>`;
    }
    if (ch.family === 'brief') return `<div class="as as-doc"><small>Production brief</small><h4>${esc(p.title || '')}</h4>${(p.deliverables || []).length ? `<p>${esc(p.deliverables.join(' · '))}</p>` : ''}
      <ol>${(p.scenes || []).slice(0, lg ? 10 : 3).map((s) => `<li><b>${esc(s.shot)}</b><span>${esc(s.line)}</span></li>`).join('')}</ol>${lg ? `<p class="ad-meta">${esc([p.talent, p.location, p.deadline].filter(Boolean).join(' · '))}</p>` : ''}</div>`;
    return `<div class="as as-doc as-dec"><small>Decision</small><h4>${esc(p.decision || '')}</h4><p>${esc(p.why || '')}</p>${(p.changes || []).length ? `<ul>${p.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${p.owner ? `<p class="ad-meta">Who decides: ${esc(p.owner)}</p>` : ''}</div>`;
  };

  /* ---------- start: three packages to work from ---------- */
  const optCard = (ch) => {
    const R = RXROUTE[ch.verdict] || RXROUTE.jam, st = ch.state;
    const tag = st === 'jam' ? ['warn', `${ic('hand', 's14')}In a jam`] : [R.tone, `${ic(R.icon, 's14')}${R.tag}`];
    return `<article class="rxc" data-open-studio="${ch.id}" tabindex="0">
      <div class="rxc-h"><span class="pill ${tag[0]}">${tag[1]}</span>${ch.money && ch.amount > 0 ? `<span class="rxc-cost">${inrS(ch.amount)}/wk</span>` : ''}</div>
      ${ch.fromCard ? `<span class="rxc-src">${ic('check', 's14')}What the card suggests</span>` : ''}
      <div><small class="rxc-fam">${face(ch.agent)}${esc(ch.familyName)}${ch.target.conn ? ` · ${esc(ch.target.name)}` : ''}</small><h3 class="rxc-t">${esc(ch.actionLabel)}</h3></div>
      ${ch.why ? `<p class="rxc-why">${esc(ch.why)}</p>` : ''}
      ${ch.from ? `<p class="rxc-from">${ic('book', 's14')}<span>From ${esc(ch.from)}</span></p>` : ''}
      <div class="rxc-pv">${assetHtml(ch, 'sm')}</div>
      <div class="rxc-f"><small>${ch.versions.length > 1 ? `${ch.versions.length} versions` : 'New'}${ch.missing?.length ? ` · missing ${esc(ch.missing.join(', '))}` : ''}</small><span class="rxc-open">Open in studio ${ic('right', 's16')}</span></div>
    </article>`;
  };
  const heroCard = (c) => `<div class="rxp-card2"><div class="rxp-card2-h">${face(c.agent)}<small>${esc(fromLabel(c))}</small>${c.badge ? `<span class="badge ${c.badge[1]}">${esc(c.badge[0])}</span>` : ''}</div>
          <div class="rxp-card2-b">${c.images ? `<img src="${esc(c.images[0])}" alt="">` : ''}<div><b>${esc(c.title)}</b><p>${esc(c.sub || '')}</p>
            ${(c.rows || []).length ? `<dl>${c.rows.slice(0, 4).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
            ${(c.detail?.how || []).length ? `<ol>${c.detail.how.slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
            ${c.cta?.label ? `<span class="rxp-cta">${ic('inf', 's14')}The card’s action: <b>${esc(c.cta.label)}</b></span>` : ''}</div></div></div>`;
  const paintStart = () => {
    const pg = $('#view .rxp'); if (!pg) return;
    const c = cardOf(RX.p), r = RX.recipe, L = RX.learned; const typed = $('#rx-in')?.value || '';
    pg.innerHTML = `<nav class="rxp-top"><button class="q-back" data-rx-back>${ic('left', 's16')}Feed</button>${themeBtn()}</nav>
      <header class="rxp-hero">
        ${heroCard(c)}
        <h1>What should this card become?</h1>
        <p class="rxp-sub">The first package does exactly what the card suggests. The other two reach the same goal another way. Open one to shape it, then ship it.</p>
        ${r ? `<div class="rxp-chips">${r.intents.map((x) => `<button class="chip${/^Follow Move/.test(x) ? ' chip-move' : ''}" data-intent="${esc(x)}" aria-pressed="${RX.intent === x}" title="${esc(x)}">${/^Follow Move/.test(x) ? `${ic('book', 's14')}${esc(x.replace(/^Follow /, ''))}` : esc(x)}</button>`).join('')}</div>
        <form class="rxp-in" id="rx-ask"><input id="rx-in" placeholder="e.g. a Hindi version for North India, end on the price" autocomplete="off" value="${esc(typed)}"><button class="btn btn-primary">${ic('sparkles', 's16')}Make it</button></form>` : '<div class="sk" style="height:96px;border-radius:14px"></div>'}
        ${L?.rules?.length ? `<p class="rxp-learned">${ic('book', 's14')}<span>Following what you taught it: ${esc(L.rules.slice(0, 2).join(' · '))}${L.rules.length > 2 ? ' …' : ''}</span><button class="linkbtn" data-nav="learned">See all</button></p>` : ''}
      </header>
      <section class="rxp-body">
        <div class="rxp-sec"><h2>${RX.busy ? 'Making packages' : 'Packages'}</h2>${RX.busy ? `<span class="rxp-status"><brew-load class="spin"></brew-load>${esc(RX.busy)}</span>` : RX.line ? `<span class="rxp-status">${esc(RX.line)}</span>` : ''}</div>
        <div class="rxp-grid">${RX.busy && !RX.list.length ? '<div class="sk rxc-sk"></div>'.repeat(3) : RX.list.map(optCard).join('')}</div>
        ${RX.earlier.length ? `<details class="rxp-earlier"><summary>Earlier remixes of this card (${RX.earlier.length})</summary><div class="rxp-grid">${RX.earlier.map(optCard).join('')}</div></details>` : ''}
      </section>`;
  };

  /* ---------- batch: a card that already holds finished ads ("Queue the 12") ----------
     Every ad is its own tile: keep it, drop it, or remix it in the studio. The kept ones queue together. */
  /* a card that already holds its finished ads (public set, or the team's private one): the same test as the server's (card-plan.js) */
  const isBatchCard = (p) => (p?.images || []).length >= 3 && p.images.every((x) => /^\/?(assets\/statics\/|b\/[a-z0-9-]+\/(team\/)?statics\/)/.test(x));
  const BSTATE = {};
  const batchTile = (ch, i) => {
    const drop = ch.pick === 'drop', on = BSTATE[ch.state], fix = !on && ch.verdict && ch.verdict !== 'live';
    const img = imgOf(ch), edited = ch.versions.length > 1;
    return `<article class="bt${drop ? ' is-drop' : ''}" data-bt="${ch.id}">
      <button class="bt-img" data-open-studio="${ch.id}" aria-label="Open ad ${i + 1} in the studio">${img ? `<img src="${esc(img)}" alt="">` : ''}${ch.pkg?.overlay && /^gen\//.test(img || '') && ch.pkg?.wordsIn !== img ? `<span class="am-ov">${esc(ch.pkg.overlay)}</span>` : ''}<span class="bt-n">${i + 1}</span>${edited ? `<span class="bt-v">v${curN(ch)}</span>` : ''}</button>
      <div class="bt-b"><b>${esc(ch.pkg?.headline || ch.after?.title || '')}</b>
        <span class="pill ${on ? on[0] : drop ? '' : fix ? 'warn' : 'ok'}">${on ? `<i class="pulse"></i>${on[1]}` : drop ? 'Dropped' : fix ? `${ic('x', 's14')}Needs a fix` : `${ic('check', 's14')}Ready`}</span></div>
      ${on ? '' : `<div class="bt-f"><button class="btn btn-ghost sm" data-open-studio="${ch.id}">${ic('sparkles', 's14')}Remix</button>
        <div class="bt-pick" role="group" aria-label="Keep or drop"><button data-pick="keep" aria-pressed="${!drop}">${ic('check', 's14')}Keep</button><button data-pick="drop" aria-pressed="${drop}">${ic('x', 's14')}Drop</button></div></div>`}
    </article>`;
  };
  const paintBatch = () => {
    const pg = $('#view .rxp'); if (!pg) return;
    const c = cardOf(RX.p), B = RX.batch, items = B?.items || [];
    const kept = items.filter((x) => x.pick !== 'drop'), waiting = kept.filter((x) => !BSTATE[x.state]), shipped = items.filter((x) => BSTATE[x.state]).length;
    const fixes = waiting.filter((x) => x.verdict && x.verdict !== 'live');
    pg.innerHTML = `<nav class="rxp-top"><button class="q-back" data-rx-back>${ic('left', 's16')}Feed</button>${themeBtn()}</nav>
      <header class="rxp-hero">${heroCard(c)}
        <h1>Pick your ${items.length || ''} ads</h1>
        <p class="rxp-sub">Keep the ones you like and drop the rest. Tap any ad to change it in the studio. Then open what you kept as one jam.</p></header>
      <section class="rxp-body">
        <div class="rxp-sec"><h2>${items.length} ads</h2><span class="rxp-status">${kept.length} kept${items.length - kept.length ? ` · ${items.length - kept.length} dropped` : ''}${shipped ? ` · ${shipped} in the jam` : ''}</span>
          ${items.length ? `<span class="bt-all"><button class="linkbtn" data-pick-all="keep">Keep all</button><button class="linkbtn" data-pick-all="drop">Drop all</button></span>` : ''}</div>
        <div class="bt-grid">${items.length ? items.map(batchTile).join('') : '<div class="sk bt-sk"></div>'.repeat(8)}</div>
      </section>
      ${items.length ? `<div class="bt-bar"><div class="ship-tx"><b>${waiting.length ? `${waiting.length} ad${waiting.length > 1 ? 's' : ''} ready for the jam` : shipped ? 'Everything you kept is in the jam' : 'Keep at least one ad'}</b><span>${fixes.length ? `Fix ${fixes.map((x) => `ad ${x.batchIndex + 1}`).join(', ')} first: open it and tap “Fix it with AI”.` : 'The ads you keep open as one jam with their brief: download them, or share the brief. Nothing is launched from Brew.'}</span></div>
        ${!waiting.length && shipped ? `<button class="btn btn-primary ship-go" data-nav="work">${ic('right', 's16')}Follow it in Work</button>` : `<button class="btn btn-primary ship-go" data-bt-queue ${!waiting.length || fixes.length || RX.queueing ? 'disabled' : ''}>${RX.queueing ? '<brew-load class="spin"></brew-load>Opening the jam…' : `${ic('zap', 's16')}Open as a jam${waiting.length ? ` · ${waiting.length}` : ''}`}</button>`}</div>` : ''}`;
  };
  const loadBatch = async () => { const g = await tapi('GET', `/api/cards/${RX.p.id}/batch`); if (g.batch) { RX.batch = g; if (view === 'remix' && !RX.ch) paintBatch(); } return g; };
  document.addEventListener('click', async (e) => {
    if (view !== 'remix' || RX.ch || !RX.batch) return;
    const pk = e.target.closest('[data-pick]'); const tile = pk?.closest('[data-bt]');
    if (pk && tile) { const ch = RX.batch.items.find((x) => x.id === tile.dataset.bt); if (!ch) return; ch.pick = pk.dataset.pick; paintBatch(); tapi('POST', `/api/changes/${ch.id}/pick`, { pick: ch.pick }); return; }
    const all = e.target.closest('[data-pick-all]'); if (all) { RX.batch.items.filter((x) => !BSTATE[x.state]).forEach((x) => { x.pick = all.dataset.pickAll; tapi('POST', `/api/changes/${x.id}/pick`, { pick: x.pick }); }); return paintBatch(); }
    if (e.target.closest('[data-bt-queue]')) {
      RX.queueing = true; paintBatch();
      const r = await tapi('POST', `/api/cards/${RX.p.id}/batch/queue`, {}); RX.queueing = false;
      if (r.needs) { paintBatch(); return openConnect(r.needs, { then: () => $('[data-bt-queue]')?.click(), why: `The jam needs ${r.name}.` }); }
      if (r.blocked) { toast(esc(`Ad ${r.blocked[0].n}: ${r.blocked[0].why}`)); return paintBatch(); }
      if (r.error) { toast(esc(r.error)); return paintBatch(); }
      RX.batch = { ...RX.batch, ...r }; paintBatch(); pullWork(true); showLearned(r.learned);
      toast(`${ic('zap', 's16')}The ads you kept are in one jam. Follow it in Work and share the brief when it’s ready.`);
    }
  });

  /* ---------- the studio ----------
     Top: back, title, the version you're on. Centre: the asset as it will run (or an older version, previewed).
     Right: Iterate (ask, then adjust) · Details (the spec) · History (preview, compare, use). Bottom: the ship bar. */
  const asPkg = (ch, v) => (v ? { ...ch, pkg: { ...ch.pkg, ...v.snapshot, knobs: v.snapshot.knobs || {} }, gradeF: (window.__GR || {})[v.snapshot.grade] || 'none', imagePending: false } : ch);
  const curN = (ch) => ch.versions.find((v) => v.id === ch.head)?.n || ch.versions.length;
  const fieldView = (f, p) => {
    const v = p[f.k]; if (v == null || v === '' || (Array.isArray(v) && !v.length)) return f.req ? `<div class="dv"><dt>${esc(f.label)}</dt><dd class="miss">Missing</dd></div>` : '';
    const val = f.type === 'rows' ? `<ol class="dv-rows">${v.map((r) => `<li>${f.cols.map((c) => r[c] ? `<span class="dv-c dv-${c}">${esc(c === 'from' ? (r[c] === 'in' ? 'Customer' : `${B.brand.name}`) : r[c])}</span>` : '').join('')}</li>`).join('')}</ol>` : f.type === 'list' ? `<ul class="dv-list">${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : f.type === 'number' ? esc(f.label.includes('₹') ? inrS(v) : v) : esc(v);
    return `<div class="dv${f.type === 'rows' || f.type === 'long' || f.type === 'list' ? ' wide' : ''}"><dt>${esc(f.label)}${f.pub ? '<em>public</em>' : ''}</dt><dd>${val}</dd></div>`;
  };
  const fieldEdit = (f, p) => {
    const v = p[f.k], lab = `<span>${esc(f.label)}${f.req ? ' <i>required</i>' : ''}</span>`;
    if (f.type === 'rows') return `<div class="fe fe-rows" data-rows="${f.k}" data-cols="${f.cols.join(',')}">${lab}${(v?.length ? v : [{}]).map((r) => `<div class="fe-row">${f.cols.map((c) => `<label><small>${esc({ q: 'Question', a: 'Answer', source: 'Source', name: 'Name', now: 'Now', next: 'After', shot: 'Shot', line: 'Line', from: 'From', text: 'Text' }[c] || c)}</small>${c === 'a' || c === 'line' || c === 'text' ? `<textarea data-c="${c}" rows="3">${esc(r[c] || '')}</textarea>` : `<input data-c="${c}" value="${esc(r[c] || '')}">`}</label>`).join('')}<button type="button" class="linkbtn fe-del" data-delrow>Remove</button></div>`).join('')}<button type="button" class="btn btn-ghost sm" data-addrow="${f.k}">${ic('sparkles', 's14')}Add one</button></div>`;
    if (f.type === 'long') return `<label class="fe">${lab}<textarea name="${f.k}" rows="4">${esc(v || '')}</textarea></label>`;
    if (f.type === 'list') return `<label class="fe">${lab}<textarea name="${f.k}" rows="4" placeholder="One per line">${esc((v || []).join('\n'))}</textarea></label>`;
    if (f.type === 'select') return `<label class="fe">${lab}<select name="${f.k}">${f.opts.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.type === 'number') return `<label class="fe">${lab}<input name="${f.k}" type="number" value="${esc(v ?? '')}"></label>`;
    return `<label class="fe">${lab}<input name="${f.k}" value="${esc(v || '')}"></label>`;
  };
  const readSpec = (form, ch) => {
    const pkg = {};
    ch.fields.forEach((f) => {
      if (f.type === 'rows') { pkg[f.k] = $$('.fe-row', $(`[data-rows="${f.k}"]`, form)).map((row) => Object.fromEntries(f.cols.map((c) => [c, $(`[data-c="${c}"]`, row)?.value || '']))).filter((r) => Object.values(r).some(Boolean)); return; }
      const el = form.elements[f.k]; if (!el) return;
      pkg[f.k] = f.type === 'list' ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : f.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
    });
    return pkg;
  };
  /* the long explanation behind a short status line: a small (i) that shows it on hover, focus or tap */
  const tipBtn = (t) => t ? `<button type="button" class="tip-i" aria-label="${esc(t)}" data-tip="${esc(t)}">${ic('info', 's14')}</button>` : '';
  /* every tooltip floats in one layer above the page (fixed, on body), so no panel, card or canvas edge can clip it; it
     flips below when there's no room above, shifts to stay inside the window, and long words (links) wrap */
  const tipShow = (el) => { let t = $('#tipx'); if (!t) { t = document.createElement('div'); t.id = 'tipx'; t.setAttribute('role', 'tooltip'); document.body.appendChild(t); }
    t.textContent = el.dataset.tip; t.style.left = '0px'; t.style.top = '0px'; t.classList.add('on');
    const r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight, x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)), up = r.top - h - 8;
    t.style.left = `${x}px`; t.style.top = `${up >= 8 ? up : Math.min(r.bottom + 8, innerHeight - h - 8)}px`; };
  const tipHide = () => $('#tipx')?.classList.remove('on');
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) tipShow(el); else tipHide(); }); /* a repaint can remove the button under the pointer: the next move hides the tip */
  document.addEventListener('click', (e) => { if (!e.target.closest?.('[data-tip]')) tipHide(); }, true); addEventListener('hashchange', tipHide);
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) tipHide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) tipShow(el); });
  document.addEventListener('focusout', (e) => { if (e.target.closest?.('[data-tip]')) tipHide(); });
  addEventListener('scroll', tipHide, true); addEventListener('resize', tipHide);
  /* while a reply takes its time (about a minute on Flash), the bar says what the studio is doing and for how long: the
     server's step (change.thinking, remix.js think()) every 3 s, the clock every 1.5 s; never a bare spinner */
  const thinkLine = () => { const s = Math.round((Date.now() - (RX.thinkT0 || Date.now())) / 1000);
    const step = RX.think?.step || (RX.fixing ? 'Checking it against the facts, the product and what this change is meant to be' : 'Reading the brief and your note');
    return `${step} · ${s}s${s >= 35 ? ' · a full answer takes about a minute on this model' : ''}`; };
  const thinkStop = () => { clearInterval(RX.thinkI); RX.thinkI = null; RX.think = null; RX.thinkT0 = null; };
  const thinkStart = (id) => { thinkStop(); RX.thinkT0 = Date.now(); let n = 0;
    RX.thinkI = setInterval(async () => { if (!RX.sending) return thinkStop(); const el = $('#ship-think'); if (++n % 2 === 0) { const q = await tapi('GET', `/api/changes/${id}`).catch(() => null); if (q?.change?.thinking) RX.think = q.change.thinking; } if (el) el.textContent = thinkLine(); }, 1500); };
  /* ---------- the jam's one way forward (Param, 19 Oct: "super confusing"): the step in plain words (Pick one → Draft → Final →
     Send), ONE main button that does the next step, and the rest under ···. Send brief = the ShopOS team gets it by email and makes
     it (its status shows in the top bar); Share with my team = copy the brief and a link to paste in your own team's chat ---------- */
  const shipMenu = (ch, items) => items.length ? `<details class="rd2-more ship-more" data-keep="ship-more"><summary aria-label="More ways to share">${ic('more', 's16')}</summary><div class="rd2-menu">${items.map(([attr, icon, label, sub]) => `<button type="button" ${attr}>${ic(icon, 's16')}<span><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`).join('')}</div></details>` : '';
  const optOn = (ch) => { const op = ch.options; return op ? op.list.find((x) => x.id === (op.picked || op.on)) || null : null; };
  const isReel = (ch) => ch.family === 'post' && /short_video$/.test(String(ch.action || ''));
  /* the one-tap final's price: a free quote, asked once per version on the stage (RX.fq), written on the button */
  const fqKey = (ch) => `${ch.id}|${ch.head}`;
  const fqFetch = async (ch) => { const k = fqKey(ch); RX.fq ||= {}; if (RX.fq[k]?.st === 'loading') return RX.fq[k]; RX.fq[k] = { st: 'loading' };
    const r = await tapi('POST', `/api/changes/${ch.id}/final/quote`, { auto: true }).catch((e) => ({ error: e.message }));
    RX.fq[k] = r?.quote ? { st: 'ok', q: r.quote } : { st: 'err', err: r?.error || 'Sloosh didn’t answer.' };
    if (view === 'remix' && RX.ch?.id === ch.id) paintStudio(); return RX.fq[k]; };
  /* say before it runs whether it costs (CRE-10/RMX-10/CRE-05): drafts are on Brew, so every draft-making button carries a quiet
     "Free draft" (a clip adds how long it takes); only the final shows credits (finalBtn) */
  const FREE = 'Free draft', FREE_CLIP = 'Free draft · about two minutes' /* the same wait the chat says when the clip starts (remix.js makeOne): a first frame, then Veo */;
  const freeTag = (clip = false) => `<small class="btn-free" title="${clip ? FREE_CLIP : FREE}">${FREE}${clip ? `<span class="btn-free-t">${FREE_CLIP.slice(FREE.length)}</span>` : ''}</small>`; /* a phone keeps just Free draft */
  const finalBtn = (ch) => { const what = isReel(ch) || ch.pkg?.video ? 'reel' : 'picture'; RX.fq ||= {}; const f = RX.fq[fqKey(ch)];
    if (!f) { setTimeout(() => fqFetch(ch), 0); return `<button class="btn btn-primary ship-go" disabled><brew-load class="spin"></brew-load>Make the final ${what}</button>`; }
    if (f.st === 'loading') return `<button class="btn btn-primary ship-go" disabled><brew-load class="spin"></brew-load>Make the final ${what}</button>`;
    if (f.st === 'err') return `<button class="btn btn-primary ship-go" data-fn-one title="${esc(f.err)}">${ic('sparkles', 's16')}Make the final ${what}</button>`;
    const q = f.q, n = Math.round((q.credits || 0) * 100) / 100, cost = q.dummy ? 'simulated' : q.provider === 'gemini' ? 'with Gemini' : n ? `${n} credits` : 'no credits';
    return `<button class="btn btn-primary ship-go" data-fn-one title="${esc(q.provider === 'gemini' ? `Sloosh isn’t ready (${q.fallbackWhy || 'no credits'}), so Brew makes it with Gemini.` : `Made on Sloosh with ${q.label || q.model || 'its best model'}. Tap once to make it.`)}">${ic('sparkles', 's16')}Make the final ${what} · ${esc(cost)}</button>`; };
  /* a final the person started here stays "making" on this screen until it lands or fails: a read that left before the tap
     (the job poll, the jam tick) can come back after it without finalPending, and the button turned clickable again (Param, 21 Oct) */
  const nFinals = (ch) => (ch.versions || []).filter((v) => v.final).length;
  const finalGoing = (ch) => { const g = ch && RX.fgo?.[ch.id]; if (!g) return null;
    const landed = nFinals(ch) > g.nf, failed = !ch.finalPending && (ch.imageError || ch.videoError || '') !== g.err && !!(ch.imageError || ch.videoError);
    if (landed || failed || Date.now() - g.at > 40 * 60e3) { delete RX.fgo[ch.id]; if (landed && view === 'remix' && RX.ch?.id === ch.id) toast(`${ic('check', 's16')}Your final ${g.what} is ready.`); return null; }
    return ch.finalPending || g.fp; };
  const fnOne = async (btn) => { const ch = RX.ch; if (!ch) return; const k = fqKey(ch); let f = RX.fq?.[k];
    btn.disabled = true; btn.innerHTML = '<brew-load class="spin"></brew-load>Starting…';
    /* no price yet, or it ran out: ask again; a new price is shown first, never spent unseen */
    if (!f || f.st !== 'ok' || (f.q.expiresAt && f.q.expiresAt < Date.now() + 5e3)) { const was = f?.q?.credits; f = await fqFetch(ch);
      if (f.st !== 'ok') return toast(`${ic('info', 's16')}${esc(f.err)}`); if (was != null && Math.abs((f.q.credits || 0) - was) > 0.001) return toast(`${ic('info', 's16')}The price is now ${Math.round(f.q.credits * 100) / 100} credits. Tap again to make it.`); }
    const what = isReel(ch) || ch.pkg?.video ? 'reel' : 'picture'; RX.fgo ||= {}; /* locked from the tap on: a repaint while the run is asked never shows the button again */
    RX.fgo[ch.id] = { at: Date.now(), nf: nFinals(ch), err: ch.imageError || ch.videoError || '', what, fp: { at: Date.now(), fallback: f.q.provider === 'gemini' } };
    const r = await tapi('POST', `/api/changes/${ch.id}/final/run`, { expect: f.q.quoteId }).catch((e) => ({ error: e.message }));
    delete RX.fq[k];
    if (r?.error) delete RX.fgo[ch.id];
    if (r?.requote) { await fqFetch(ch); return toast(`${ic('info', 's16')}${esc(r.error)}`); }
    if (r?.error) { toast(`${ic('info', 's16')}${esc(r.error)}`); return paintStudio(); }
    const c1 = r?.change || ch; RX.fgo[ch.id] = { ...RX.fgo[ch.id], err: c1.imageError || c1.videoError || '', fp: c1.finalPending || RX.fgo[ch.id].fp };
    if (r?.change) { RX.ch = r.change; putCh(r.change); } toast(`${ic('sparkles', 's16')}Making the final ${what}. It takes a few minutes; we’ll notify you when it’s ready.`); paintStudio(); };
  /* Copy and open (post-open.js): the post, copied, and the exact place opened in a new tab, filled in where the platform allows */
  const postOpenOf = (ch) => { try { const im = imgOf(ch) || ch.pkg?.photos?.[0] || null; return window.PostOpen?.of(ch, { card: RX.p ? cardOf(RX.p) : null, brandUrl: B.brand.host ? `https://${String(B.brand.host).replace(/^https?:\/\//, '')}` : '', image: im ? new URL(im, location.href).href : '' }) || null; } catch { return null; } };
  const PO_WHERE = (po) => ({ x_post: 'X', reddit_post: /thread/.test(po.label) ? 'the thread' : 'Reddit', linkedin_post: 'LinkedIn', quora_answer: 'the question', fb_group_post: 'the group', pinterest_pin: 'Pinterest' })[po.kind] || 'the thread';
  const poBtn = (po, primary) => `<button class="btn ${primary ? 'btn-primary' : 'btn-ghost'} ship-go" data-rx="post-open" title="${esc(po.url.split('?')[0])}">${ic('send', 's16')}${esc(po.label)}</button>`;
  const stepBar = (ch) => {
    const p = ch.pkg || {}, op = null, opt = null, /* one, always: an old jam's options never ask to pick one */ _op = ch.options, media = PH_FAM.includes(ch.family) && !ch.realOnly && (ch.family !== 'post' || isReel(ch) || p.image || p.media || p.video);
    const fin = ch.versions.find((v) => v.id === ch.head)?.final, fix = ch.verdict === 'fix', reel = isReel(ch) || !!p.video;
    const steps = [...(op ? ['Pick one'] : []), 'Draft', ...(media ? ['Final'] : []), 'Send'];
    const at = op && !op.picked ? 'Pick one' : media && !fin ? 'Draft' : media ? 'Final' : 'Draft';
    const strip = `<ol class="ship-steps" aria-label="Steps">${steps.map((x) => `<li class="${x === at ? 'is-on' : steps.indexOf(x) < steps.indexOf(at) ? 'is-done' : ''}">${esc(x)}</li>`).join('')}</ol>`;
    const nm = opt ? ` · <em>${esc(opt.name)}</em>` : '';
    let head, tip, main;
    const po = postOpenOf(ch); /* Reddit, Quora, X, LinkedIn, Pinterest, a group: copy it and open the place (post-open.js) */
    const send = `<button class="btn btn-primary ship-go" data-tb-open>${ic('send', 's16')}Send brief</button>`; /* the brief opens on the stage first: read it, edit it, then Download or Send */
    const job = jobOf(ch), fp = finalGoing(ch);
    if (job && !fp) { head = `<brew-load class="spin"></brew-load>${esc(job)}${nm}`; tip = media ? 'Brew makes a quick draft first, so you can check the idea. The final is made after.' : 'It lands here on its own in a moment.'; main = `<button class="btn btn-primary ship-go" disabled>${esc(job)}…</button>`; }
    else if (op && !op.picked) { head = `Pick one of ${op.list.length}`; tip = 'Tap the options above the stage to compare them, then use the one you like. The others stay in History.';
      main = `<button class="btn btn-primary ship-go" ${opt ? `data-opt-use="${esc(opt.id)}"` : 'disabled'}>${ic('check', 's16')}${opt ? `Use ${esc(opt.name)}` : 'Pick one above'}</button>`; }
    else if (fix) { head = `Needs a fix: ${esc((ch.fixes || [])[0] || 'see the checks')}`; tip = `Before it can ship: ${(ch.fixes || []).join('; ')}.`; main = `<button class="btn btn-primary ship-go" data-rx="fix">${ic('sparkles', 's16')}Fix it with AI${freeTag()}</button>`; }
    else if (fp) { head = `<brew-load class="spin"></brew-load>${fp.fallback ? 'Brew' : 'Sloosh'} is making the final${nm}`; tip = 'It takes a few minutes. We’ll notify you when it’s ready; you can leave this page.'; main = `<button class="btn btn-primary ship-go" disabled aria-busy="true"><brew-load class="spin"></brew-load>Making the final ${reel ? 'reel' : 'picture'}…</button>`; }
    else if (media && !fin && isReel(ch) && !p.video) { head = `Script ready${nm}`; tip = 'Make the video to see it moving. It’s a quick draft; the final reel is made after.'; main = `<button class="btn btn-primary ship-go" data-rx="video">${ic('vid', 's16')}Make the video${freeTag(true)}</button>`; }
    else if (media && !fin) { head = `Draft ${reel ? 'video' : 'photo'} ready${nm}`; tip = `A quick draft made by Brew to check the idea. The final ${reel ? 'reel' : 'picture'} is made on Sloosh, ready to post. Then Send brief.`; main = finalBtn(ch); }
    else if (media) { head = `Final ready${nm}`; tip = 'Send brief: the ShopOS team, Brew’s build crew, gets it by email and posts or runs it. Its status shows in the top bar.'; main = send; }
    else if (po) { head = `Ready${nm}`; tip = `${po.filled ? `Opens ${PO_WHERE(po)} with the post filled in, and copies it too.` : `Copies the post and opens ${PO_WHERE(po)}; paste it there.`} You post it yourself; Brew never posts in communities for you.${po.rule ? ` ${po.rule}` : ''}`; main = poBtn(po, true); }
    /* a post with no thread to open: its main button copies the post (it said "you post it yourself" over a Send brief button: QA J-20) */
    else if (ch.family === 'post' && ch.target?.conn !== 'meta' && (p.copy || p.title)) { head = `Ready${nm}`; tip = 'Copy the post and paste it where it goes. You post it yourself; Brew never posts in communities for you. The brief carries it too.'; main = `<button class="btn btn-primary ship-go" data-rx="copy-post">${ic('copy', 's16')}Copy the post</button>`; }
    else { head = `Ready${nm}`; tip = 'Send brief: the ShopOS team, Brew’s build crew, gets it by email and runs it. Its status shows in the top bar.'; main = send; }
    const items = [];
    /* a final reel or picture is post-ready: its caption and hashtags one tap away, beside Download (Param, 21 Oct) */
    if (media && fin && !fp && (p.copy || p.title)) items.push(['data-rx="copy-post"', 'copy', 'Copy the caption', 'Title, caption and hashtags, ready to paste with the final.']);
    if (po && !fix && !job && !/data-rx="post-open"/.test(main)) items.push(['data-rx="post-open"', 'send', po.label, po.filled ? `Opens ${PO_WHERE(po)} with the post filled in.` : `Copies the post and opens ${PO_WHERE(po)}.`]);
    if (!/data-rx="share-shopos"/.test(main)) items.push(['data-rx="share-shopos"', 'send', 'Send the brief now', 'The ShopOS team, Brew’s build crew, gets it by email and makes it.']);
    items.push(['data-rx="share-team"', 'copy', 'Share with my team', 'Copy the brief and a link to paste in your team’s chat.']);
    if (media && (p.image || p.video || p.draft?.images?.length) && !fp) items.push([`data-fn-studio="${esc(ch.id)}"`, 'sparkles', fin ? 'Change the final…' : 'Choose how the final is made…', 'Pick the photos, the model or a Sloosh Space yourself.']);
    if (dlTool(ch, ch)) items.push(['data-st-dl', 'down', 'Download', 'This version’s files, as they are now.']);
    /* Redo it: one new take beside the one way forward, whenever the version can still change (not while something is being made) */
    const busy = !!job;
    const redo = !busy && !(op && !op.picked) ? `<button class="btn btn-ghost ship-redo" data-rx="variants" title="A new take from a new angle, a free draft. This one stays in History.">${ic('shuffle', 's16')}Redo it${freeTag()}</button>` : '';
    return `<div class="ship one ${fix ? 'warn' : 'ok'}">${strip}<div class="ship-tx is-step"><b><span class="ship-l">${head}</span>${tipBtn(tip)}</b></div><div class="ship-btns">${shipMenu(ch, items)}${redo}${main}</div></div>`; };
  /* the options as tabs above the stage, named by their angle, never v1–v5 */
  /* one, always: no option tabs, not even on jams saved with options (the one on the stage is the one; the rest are in History) */
  const optTabs = (ch, viewing) => { const op = null; if (!op || viewing || ch.batchKey) return '';
    if (op.picked) { const it = op.list.find((x) => x.id === op.picked); return it ? `<div class="st-opts is-picked"><span>${ic('check', 's14')}Using <b>${esc(it.name)}</b></span><button type="button" class="linkbtn" data-opt-change>Change</button></div>` : ''; }
    const HAS = { final: 'Final', video: 'Video', photo: 'Photo', words: isReel(ch) ? 'Script' : 'Words' };
    return `<div class="st-opts" role="tablist" aria-label="Options">${op.list.map((it) => `<button type="button" role="tab" class="st-opt${it.id === op.on ? ' is-on' : ''}" data-opt="${esc(it.id)}" aria-selected="${it.id === op.on}">${it.image ? `<img src="/${esc(String(it.image).replace(/^\//, ''))}" alt="" loading="lazy">` : `<i class="st-opt-l">${esc(it.letter)}</i>`}<span><b>${esc(it.name)}</b><small>${esc(it.letter)} · ${HAS[it.has] || ''}</small></span></button>`).join('')}${op.list.length < 6 ? `<button type="button" class="st-opt is-add" data-opt-more${RX.sending ? ' disabled' : ''}><i class="st-opt-l">+</i><span><b>One more</b><small>A different angle</small></span></button>` : ''}</div>`; };
  const shipBar = (ch, viewing) => {
    if (viewing) return `<div class="ship viewing"><div class="ship-tx"><b>You’re looking at v${viewing.n}</b><span>${esc(viewing.reason || '')} · ${esc(authorName(viewing.author))}</span></div><div class="ship-btns"><button class="btn btn-ghost" data-v-back>Back to v${curN(ch)}</button><button class="btn btn-primary" data-v-use="${viewing.id}">Use v${viewing.n}</button></div></div>`;
    if (RX.sending) { if (!RX.thinkI) thinkStart(ch.id); return `<div class="ship busy"><div class="ship-tx"><b><brew-load class="spin"></brew-load>${esc(RX.sending)}</b><span id="ship-think">${esc(thinkLine())}</span></div><div class="ship-btns"><button class="btn btn-primary ship-go" disabled>${ic('sparkles', 's16')}Working…</button></div></div>`; }
    if (RX.thinkI) thinkStop();
    /* once Share the brief is gone (sent, live), the link can still be copied: a small icon next to what's left */
    const lnk = `<button class="icon-btn ship-link" data-st-link aria-label="Copy the link to this jam" title="Copy the link">${ic('link', 's16')}</button>`;
    if (ch.batchKey && ch.state !== 'jam') {
      const N = RX.p?.images?.length || 12, fix = ch.verdict === 'fix', drop = ch.pick === 'drop';
      return `<div class="ship ${fix ? 'warn' : drop ? '' : 'ok'}"><div class="ship-tx"><b>${ic(fix ? 'x' : drop ? 'x' : 'check', 's16')}Ad ${ch.batchIndex + 1} of ${N} · ${drop ? 'Dropped' : fix ? 'Needs a fix' : 'Kept'}: v${curN(ch)}</b><span>${fix ? `Before it can queue: ${esc((ch.fixes || []).join('; '))}.` : 'Every change saves as a new version. It queues with the other ads you keep.'}</span></div>
        <div class="ship-btns">${fix ? `<button class="btn btn-ghost" data-rx="fix">${ic('sparkles', 's16')}Fix it with AI</button>` : ''}<button class="btn btn-ghost" data-st-pick="${drop ? 'keep' : 'drop'}">${drop ? 'Keep it' : 'Drop it'}</button><button class="btn btn-primary ship-go" data-st-back>Back to all ${N}</button></div></div>`;
    }
    /* the jam page: one way out, the tray (it shows exactly what changes, the limit, how we'll know and what's missing) */
    /* sent: the bar says where it is, not how to send it again */
    if (!ch.batchKey) { const w0 = workOfCard(RX.p?.id); if (w0 && w0.stage === 'needs_you') return `<div class="ship warn"><div class="ship-tx"><b>${ic('hand', 's16')}${esc(w0.with?.name || 'The ShopOS team')} needs your OK${w0.ticket ? `: ${esc(w0.ticket)}` : ''}</b><span>They replied in the conversation. Read it, then approve or change it.</span></div><div class="ship-btns"><button class="btn btn-primary" data-st-convo>${ic('chat', 's16')}Open the conversation</button>${lnk}</div></div>`;
      if (w0 && w0.stage === 'team') return `<div class="ship info"><div class="ship-tx"><b>${ic('send', 's16')}With ${esc(w0.with?.name || 'your team')}</b><span>They look at it in the conversation. Share the brief when it’s ready.</span></div><div class="ship-btns"><button class="btn btn-ghost" data-st-convo>${ic('chat', 's16')}Open the conversation</button>${lnk}</div></div>`;
      if (w0 && w0.stage === 'shared' && w0.jamBrief?.to !== 'team') { const it = (WORK.withTeam?.items || []).find((x) => x.wid === w0.id); /* sent: the ShopOS team has it by email; its status follows in the top bar */
        return `<div class="ship ok"><div class="ship-tx"><b>${ic('check', 's16')}Sent to the ShopOS team${w0.ticket ? ` · ${esc(w0.ticket)}` : ''}${it?.label ? ` · ${esc(it.label)}` : ''}${w0.jamBrief?.sharedAt ? ` · ${esc(sentLine(w0.jamBrief.sharedAt))}` : ''}</b><span>Brew’s build crew takes it from here. Its status shows in the top bar.</span></div><div class="ship-btns"><button class="btn btn-ghost" data-st-brief>${ic('doc', 's16')}The brief</button>${lnk}</div></div>`; }
      if (w0 && w0.stage === 'shared') return `<div class="ship ok"><div class="ship-tx"><b>${ic('check', 's16')}Brief shared${w0.ticket ? `: ${esc(w0.ticket)}` : ''}</b><span>With ${w0.jamBrief?.to === 'team' ? 'your team' : 'the ShopOS team'}. The jam ends here.</span></div><div class="ship-btns"><button class="btn btn-ghost" data-st-brief>${ic('doc', 's16')}The brief</button><button class="btn btn-ghost" data-rx="share-${w0.jamBrief?.to === 'team' ? 'team' : 'shopos'}">${ic('copy', 's16')}Copy it again</button>${lnk}</div></div>`; }
    /* before the plan's make step has run, the jam's main button is the card's own action: it makes the work, it ships nothing */
    if (!ch.batchKey && ch.state !== 'jam' && jobOf(ch)) return stepBar(ch); /* being made: the bar says what, never Draft or Ready */
    if (!ch.batchKey && ch.state !== 'jam' && !planMade(ch)) { const pl = planOf(ch);
      return `<div class="ship one ok"><div class="ship-tx"><b>${ic('sparkles', 's16')}<span class="ship-l">${ch.v0 === 'draft' ? 'First draft' : 'Draft'} · v${curN(ch)}</span>${tipBtn(`${planGo(ch, pl).line}. Then share the brief.`)}</b></div>
        <div class="ship-btns">${shipMenu(ch, [['data-rx="share-shopos"', 'send', 'Send the brief now', 'The ShopOS team, Brew’s build crew, gets it by email and makes it.'], ['data-rx="share-team"', 'copy', 'Share with my team', 'Copy the brief and a link to paste in your team’s chat.']])}<button class="btn btn-primary" data-rx="plan">${ic('sparkles', 's16')}${esc(planGo(ch, pl).label)}${freeTag(isReel(ch))}</button></div></div>`; }
    if (!ch.batchKey && ch.state !== 'jam') return stepBar(ch);
    if (ch.state === 'jam') return `<div class="ship warn"><div class="ship-tx"><b>${ic('hand', 's16')}Being planned in a jam</b><span>Answer the open questions there, then it ships.</span></div><div class="ship-btns">${postOpenOf(ch) ? poBtn(postOpenOf(ch), false) /* a ready post can still be copied out while the jam plans it */ : ''}<button class="btn btn-primary" data-rx="open">Open the jam</button></div></div>`;
    const R = RXROUTE[ch.verdict] || RXROUTE.jam, blocks = ch.checks.filter((x) => !x.ok && !x.soft);
    const what = ch.verdict === 'confirm' ? `Tick your own checks first: ${esc((ch.confirm || []).join('; '))}.` : ch.verdict === 'fix' ? `Before it can ship: ${esc((ch.fixes || []).join('; '))}.` : ch.verdict === 'live' ? `Brew updates ${esc(ch.target.object.toLowerCase())} on ${esc(ch.target.name)} automatically, watches the result, and can roll it back.` : ch.verdict === 'deploy' ? `${esc(ch.teamWhy || 'It needs a person')}, so the ShopOS team ships it. You send them a brief with everything they need${ch.money && ch.amount > 0 ? `: about ${inrS(ch.amount)} a week` : ''}.` : esc(blocks[0]?.k || ch.reasons[0] || 'A person needs to plan or decide this first.');
    const scopes = ch.verdict === 'live' && ch.scope.length > 1 ? `<div class="ship-scope"><small>Run on</small>${ch.scope.map((s) => `<button class="chip" data-scope="${s.n}" aria-pressed="${(RX.scope[ch.id] || ch.scope[0].n) === s.n}" title="${s.locked ? `Above ${esc(ch.trust.name)} trust, so it goes to a jam` : ''}">${s.locked ? ic('lock', 's14') : ''}${esc(s.label)}</button>`).join('')}</div>` : '';
    return `<div class="ship ${R.tone}"><div class="ship-tx"><b>${ic(R.icon, 's16')}${R.tag}: v${curN(ch)}</b><span>${what}</span>${scopes}</div>
      <div class="ship-btns">${ch.verdict !== 'jam' ? `<button class="btn btn-ghost" data-rx="jam">${ic('hand', 's16')}Jam with my team</button>` : ''}${ch.verdict === 'fix' ? `<button class="btn btn-ghost" data-tab="details">Edit details</button>` : ''}<button class="btn btn-primary ship-go" data-rx="${ch.verdict === 'fix' ? 'fix' : ch.verdict === 'confirm' ? 'mychecks' : 'share'}">${ic(R.icon, 's16')}${ch.verdict === 'fix' && (ch.thread || []).slice(-1)[0]?.text?.startsWith('I couldn’t fix') ? 'Try again' : R.btn}</button></div></div>`;
  };
  /* the studio's knobs and quick asks come from one shared list; keep only what fits this brand (no haircare scenes on a shoe brand, no Hindi outside India) */
  const OFF_BRAND = /post-pregnancy|dermatologist|^women 30\+$|^for women 30\+$|^men 25-34$|gym-goers|bathroom shelf|lab blue/i;
  const inIndia = () => (B.config?.country ? B.config.country === 'IN' : B.sym === '₹');
  const fitsBrand = (x) => (!OFF_BRAND.test(String(x).trim()) && (inIndia() || !/\b(hindi|hinglish)\b/i.test(String(x))));
  const fitKnobs = (ks) => (ks || []).map((k) => ({ ...k, opts: (k.opts || []).filter(fitsBrand) })).filter((k) => k.opts.length > 1);
  const fitSuggest = (xs) => (xs || []).filter(fitsBrand);
  /* a version's short name (2-4 words). The server names it; an older server only sends the reason, so cut that to four words */
  const vLabel = (v) => { if (v.label) return v.label; const r = String(v.reason || '').replace(/\s*\(AI offline\)/i, '').replace(/^Knob:\s*/i, ''); if (/^Remix/i.test(r) || !r || v.n === 1) return 'First draft'; const w = r.replace(/https?:\/\/\S+/g, '').replace(/[“”"]/g, '').split(/\s+/).filter(Boolean); return w.slice(0, 4).join(' ').replace(/[,.;:]+$/, '') + (w.length > 4 ? '…' : ''); };
  /* in the chat, a version is one quiet line ("Made v2 · As a thread"); the strip above the stage is where versions live */
  const madeNote = (ch, vs) => vs.length ? `<p class="lg-made">${ic('check', 's14')}<span>Made ${vs.map((v) => { const on = (RX.viewing || ch.head) === v.id; return `<button class="linkbtn" data-v-view="${v.id}" aria-pressed="${on}" title="${esc(on ? 'Showing' : `Show v${v.n}`)}">v${v.n}</button>`; }).join(', ')}${vs.length === 1 ? ` · ${esc(vLabel(vs[0]))}` : ''}</span></p>` : '';
  /* first thing on the chat: the case in plain words (what we saw, why it matters) and what you do next, as steps */
  /* the card's plan (card-plan.js), and whether its make step has run: before it has, the jam's main button is the card's own action */
  const planOf = (ch) => ch?.plan || (RX.p ? cardOf(RX.p).plan : null) || null;
  /* one, always (Param, 19 Oct: "let's not give 3 options anywhere: lead with only 1 and let them redo it"): the card's button
     makes the one version on the stage what the card asked for, and Redo it makes the next take. hasMade: the stage already
     holds it (a short video's clip, an ad's or a post's picture, a written family's words), so the plan's button steps aside */
  /* the one job running on this change right now, in plain words ('' when nothing is): every status line (the step bar,
     the case’s next step, the chips) asks this first, so none says Ready or Draft while something is being made */
  const jobOf = (ch) => !ch ? '' : finalGoing(ch) ? `${finalGoing(ch).fallback ? 'Brew' : 'Sloosh'} is making the final` : ch.copyPending || ch.ctaQueued ? 'Writing the first draft' : ch.remakePending ? (ch.remakePending.step || 'Making it') : ch.videoPending ? (ch.videoStep || 'Making the video') : ch.ctaPending ? String(ch.ctaPending) : ch.imagePending ? (ch.family === 'listing' ? 'Making the listing photos' : 'Making the photo') : '';
  const hasDraft = (ch) => { const p = ch?.pkg || {}; return ch?.v0 === 'draft' || !!(p.video || /^\/?gen\//.test(p.image || '') || p.draft?.images?.length || p.draft?.video); };
  const hasMade = (ch) => { if (!ch || ch.copyPending) return false; if (ch.videoPending || ch.imagePending || ch.remakePending || ch.ctaPending) return true; /* being made: the button that makes it steps aside */ const p = ch.pkg || {}, rows = p.cards || p.slides || [];
    if (isReel(ch)) return !!p.video; if (['meta_ad', 'social'].includes(ch.family) && !ch.realOnly) return rows.length > 1 ? rows.every((_, i) => (p.cardImages || [])[i]) : !!(/^\/?gen\//.test(p.image || '') || p.draft?.images?.length); return true; };
  /* a saved plan may still carry the card's own non-making label ("Open the scoreboard"): the button says what it does (card-plan.js NOT_MAKING_LABEL) */
  const planLabel = (l) => (!l ? 'Make it' : /^(?:open|see|agree|approve|publish|shift|pause|restart|launch|turn on|queue|start the tests|fix tracking|fix the links|update the prices|review draft|win their|show how|work on this|send|set the watch|set up the rules|ship|apply|run|lock)\b/i.test(l) ? 'Make the draft' : l);
  const planGo = (ch, pl) => ({ label: planLabel(pl?.cta), line: `Brew makes the ${pl?.make?.one || pl?.make?.what || 'version'} on the stage${isReel(ch) ? ' and films it' : ['meta_ad', 'social'].includes(ch?.family) ? ' with its picture' : ''}; redo it if it isn’t right` });
  const planMade = (ch) => !!(ch?.planRun || ch?.batchKey || planOf(ch)?.batch || ch?.state === 'jam' || !planOf(ch) || hasMade(ch));
  const planBusy = (ch) => { const pl = planOf(ch); return pl?.n ? `Making ${pl.n > 1 ? `${pl.n} ${pl.make?.what || 'versions'}` : `the ${pl.make?.what || 'version'}`}…` : 'Working on it…'; };
  /* first thing on the chat: the case in plain words, the card's plan toward its action, and the one thing to press next */
  const caseBrief = (ch) => { const c = cardOf(RX.p), d = c.detail || {}, cut = (x, n) => { x = String(x || '').trim(); return x.length > n ? x.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : x; };
    const why = (d.why || []).filter((x) => x && !/^[^:]{2,60}:\s*[₹$€£]?[\d.,]+\s*$/.test(x) && !/^[^:“"]{2,90}\([^)]*\):/.test(x) /* evidence rows (label (source): value), not reasons */).slice(0, 2), fix = ch.verdict === 'fix';
    const pl = planOf(ch), made = planMade(ch), opens = (ch.pkg?.where || []).some((w) => /^https?:/.test(w.url || '')), rule = (ch.pkg?.where || []).map((w) => w.rule).find(Boolean);
    const next = jobOf(ch) ? `${jobOf(ch)} now. It lands on the stage on its own; then change it or share the brief.` : !made && pl ? `Press “${planGo(ch, pl).label}” below. ${planGo(ch, pl).line}. Change it, then share the brief.`
      : fix ? `Fix this first: ${(ch.fixes || []).join('; ')}. Press “Fix it with AI”, or tell me how.`
      : postOpenOf(ch) ? `Happy with it? Press “${postOpenOf(ch).label}”: Brew copies the post and opens the place; you post it yourself. Not right? Redo it.${rule ? ` ${rule}` : ''}`
      : ch.family === 'post' && ch.target?.conn !== 'meta' ? `Happy with it? Share the brief: it carries the post and where it goes; you post it yourself. Not right? Redo it.${rule ? ` ${rule}` : ''}` : 'Happy with it? Share the brief with the ShopOS team, Brew’s build crew, or your own team. Not right? Redo it, or tell me what to change.';
    return `<div class="case"><small class="case-k">The case${c.src ? ` · ${esc(c.src)}` : ''}</small>
      <b class="case-t">${esc(cut(c.title, 140))}</b>${c.sub ? `<p>${esc(cut(c.sub, 240))}</p>` : ''}
      ${why.length ? `<div class="case-s"><small>Why it matters</small><ul>${why.map((x) => `<li>${esc(cut(x, 200))}</li>`).join('')}</ul></div>` : ''}
      ${pl?.steps?.length ? `<details class="case-s case-plan" data-keep="plan"><summary><small>The plan · ${pl.steps.length} step${pl.steps.length > 1 ? 's' : ''}</small></summary><ol>${pl.steps.map((x) => `<li>${esc(x.t)}</li>`).join('')}</ol></details>` : ''}
      <p class="case-next">${esc(next)}</p></div>`; };
  /* cuts made together ("More like this", "three cuts", the plan's make step): a strip of their own photos to swipe and tap */
  const cutsStrip = (ch, vs) => vs.length ? `<div class="lg-cuts" role="list">${vs.map((v) => { const s = v.snapshot || {}, img = s.image || s.draft?.images?.[0], on = (RX.viewing || ch.head) === v.id;
      return `<button type="button" role="listitem" class="lg-cut${on ? ' is-on' : ''}" data-v-view="${v.id}" aria-pressed="${on}" title="${esc(`v${v.n} · ${vLabel(v)}`)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="lg-cut-ph">${ch.imagePending ? '<brew-load class="spin"></brew-load>' : ic('pic', 's16')}</span>`}<b>v${v.n}</b><small>${esc(vLabel(v))}</small></button>`; }).join('')}</div>` : '';
  /* the jam is the team's room: the studio's chat holds the jam's own lines too (teammates' messages and tags, the ShopOS team,
     people joining, taking it or asking for an OK), in time order with the studio's, each with who said it */
  const JAM_SYS = /brief|moved|sent|joined|gave|asked|approved|took|photo|final|received|progress|delivered|needs/i;
  /* the v1 studio's first view stays quiet (FEED-NOT-04): two quick asks, a Free draft note, the mic and the box; every other
     chip (the photo, Post to…, Projected impact, Make it a reel/carousel, more asks) waits behind More, once per jam */
  const v1Chips = (ch) => { const dis = RX.sending ? ' disabled' : '';
    const asks = fitSuggest(ch.suggest).slice(0, PH_FAM.includes(ch.family) ? 3 : 4).map((x) => `<button type="button" class="chip${RX.sending && RX.from === x ? ' is-wait' : ''}" data-say="${esc(x)}"${dis}>${RX.sending && RX.from === x ? '<brew-load class="spin"></brew-load>' : ''}${esc(x)}</button>`);
    const rest = [...(PH_FAM.includes(ch.family) && !phTools(ch, ch, null) ? [`<button type="button" class="chip chip-ph" data-ph-open>${ic('pic', 's14')}Change the photo</button>`] : []),
      ...j2Acts(ch, (attr, icon, label, cls = '') => `<button type="button" class="chip j1-chip${cls}" ${attr}${dis}>${icon ? ic(icon, 's14') : ''}${esc(label)}</button>`)];
    const all = [...asks, ...rest], first = all.slice(0, 2), more = all.slice(2), open = RX.moreChips === ch.id;
    return `<div class="it-sugg${open ? ' is-open' : ''}">${first.join('')}${more.length ? (open ? more.join('') : `<button type="button" class="chip it-more" data-chips-more aria-expanded="false">${ic('more', 's14')}More</button>`) : ''}${all.length ? `<small class="it-free" title="Every change here is a draft made by Brew, free. Only the final costs credits.">${FREE}s</small>` : ''}</div>`; };
  const chatTab = (ch, edit) => {
    const msgs = ch.thread || [], vById = (id) => ch.versions.find((v) => v.id === id), JR = window.JamRoom, w = RX.p ? workOfCard(RX.p.id) : null, me = String(ME()?.email || '').toLowerCase();
    const one = (m) => m.from === 'you' ? (me && m.by?.email && String(m.by.email).toLowerCase() !== me && JR?.teamMsg /* a teammate's ask, with their face and name */ ? `<div class="st-jm">${JR.teamMsg({ from: 'me', by: m.by, body: m.text }, w || {})}</div>` : `<div class="lgm you">${(m.imgs || []).length ? `<div class="st-msg-imgs">${m.imgs.map((u) => `<a href="${esc(/^(data:|https?:|\/)/.test(u) ? u : '/' + u)}" target="_blank" rel="noopener"><img src="${esc(/^(data:|https?:|\/)/.test(u) ? u : '/' + u)}" alt="Attached screenshot"></a>`).join('')}</div>` : ''}<p>${esc(m.text)}</p></div>`)
      : `<div class="lgm ai">${face(ch.agent)}<div>${m.proof ? proofMsg(m) : `<p>${esc(m.text)}</p>`}${m.v && ch.versions[m.v - 1] ? madeNote(ch, [ch.versions[m.v - 1]]) : ''}${(m.vs || []).length && !(ch.options && m.vs.every((id) => ch.options.list.some((x) => x.id === id))) /* options show as tabs above the stage */ ? (m.cuts && PH_FAM.includes(ch.family) ? cutsStrip(ch, m.vs.map(vById).filter(Boolean)) : madeNote(ch, m.vs.map(vById).filter(Boolean))) : ''}${m.rewrite && edit ? `<button type="button" class="chip j1-chip" data-say="Rewrite it"${RX.sending ? ' disabled' : ''}>${ic('sparkles', 's14')}Rewrite it</button>` : ''}${m.remakeAgain && edit && !ch.remakePending && !ch.realOnly ? `<button type="button" class="chip j1-chip" data-j2-remake="${esc(m.remakeAgain)}"${RX.sending ? ' disabled' : ''}>${ic('refresh', 's14')}Make it again</button>` : ''}</div></div>`;
    const jam = w && JR?.teamMsg ? (w.thread || []).filter((m) => m && m.id !== 'tmp' && !m.learn && (m.from !== 'system' || m.edited?.length || JAM_SYS.test(m.body || ''))).map((m, i) => ({ at: m.at || 0, i: 1e4 + i, html: `<div class="st-jm" data-st-jam>${JR.teamMsg(m, w)}</div>` })) : [];
    const log = [...msgs.map((m, i) => ({ at: m.at || 0, i, html: one(m) })), ...jam].sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.html).join('') + (w && JR?.typingHtml ? JR.typingHtml(w) : '');
    /* the ShopOS team asked for something: what they need sits on the composer until it is answered */
    const ni = w?.jamBrief?.status === 'needs_info' ? (w.jamBrief.history || []).find((h) => h.s === 'needs_info') : null;
    const niHtml = ni ? `<div class="st-needs" role="status">${ic('hand', 's16')}<div><b>${esc(ni.name || 'The ShopOS team')} needs something from you${w.ticket ? ` · ${esc(w.ticket)}` : ''}</b>${ni.note ? `<p>${esc(ni.note)}</p>` : ''}<small>Answer with @ShopOS team in your message: it goes to them by email.</small></div></div>` : '';
    return `<div class="it-log">${RX.p ? `<div class="it-empty">${face(ch.agent)}${caseBrief(ch)}</div>` : ''}${log || (RX.p ? '' : `<div class="it-empty">${face(ch.agent)}<p>What should change? Each change makes a new version, and you can always go back.</p></div>`)}${j2Extra(ch)}${RX.sending ? `<div class="lgm ai pending">${face(ch.agent)}<p><brew-load class="spin"></brew-load>${esc(RX.sending)}</p></div>` : ''}</div>
      ${edit ? `<form class="it-ask" id="st-say">${niHtml}${v1Chips(ch)}${stAttHtml()}<div class="it-row${window.Composer?.tools ? ' has-cmp' : ''}"><textarea id="st-in" rows="2" data-nomic placeholder="What should change? Or @ someone">${esc(RX.draft || '')}</textarea>${window.Composer?.tools ? `<span class="jm-tools">${window.Composer.tools()}<span class="jm-tools-r">${window.Mic?.supported ? `<button type="button" class="jm-mic" data-cmp-talk aria-label="Talk instead of typing" title="Talk instead of typing">${ic('mic', 's16')}</button>` : ''}<button class="jm-send${RX.sending ? ' is-wait' : ''}" aria-label="Send" ${RX.sending ? 'disabled aria-busy="true"' : ''}>${RX.sending ? '<brew-load class="spin"></brew-load>' : ic('up', 's16')}</button></span></span>` : `<button class="btn btn-primary${RX.sending ? ' is-wait' : ''}" aria-label="Send" ${RX.sending ? 'disabled aria-busy="true"' : ''}>${RX.sending ? '<brew-load class="spin"></brew-load>' : ic('up', 's16')}</button>`}</div></form>${window.Composer?.foot ? window.Composer.foot() : ''}` : `<p class="it-locked">It’s in a jam. Shape it there.</p>`}`;
  };
  const adjustTab = (ch, edit) => edit ? `<p class="hs-tip">Turn a knob and the package is rewritten to match. Knobs marked “new photo” make a new creative.</p>
      ${fitKnobs(ch.knobs).map((k) => { const multi = false /* one version, always: a knob makes one new take, never several to pick from (QA J-11) */, sel = (RX.knobSel || {})[k.k] || [], cur = (ch.pkg.knobs || {})[k.k];
        return `<div class="kn"><span>${esc(k.label)}${k.kind === 'image' ? ' <em>new photo</em>' : multi ? ' <em>pick one or more</em>' : ''}</span><div>${k.opts.map((o) => `<button class="chip${multi && sel.includes(o) ? ' picked' : ''}" data-knob="${k.k}" data-v="${esc(o)}" data-multi="${multi ? 1 : ''}" aria-pressed="${multi ? sel.includes(o) : cur === o}" ${RX.sending ? 'disabled' : ''}>${multi && sel.includes(o) ? ic('check', 's14') : ''}${esc(o)}${!multi || !sel.length ? (cur === o ? '' : '') : ''}</button>`).join('')}</div>
          ${multi && sel.length ? `<div class="kn-apply"><button class="btn btn-primary sm" data-knob-apply="${k.k}" ${RX.sending ? 'disabled' : ''}>${sel.length > 1 ? `Make ${sel.length} versions` : `Apply ${esc(sel[0])}`}</button><button class="linkbtn" data-knob-clear="${k.k}">Clear</button>${sel.length > 1 ? '<small>One version for each, side by side</small>' : ''}</div>` : multi && cur ? `<small class="kn-cur">Now: ${esc(cur)}</small>` : ''}</div>`; }).join('')}
      <div class="adj-more"><button class="btn btn-ghost sm" data-rx="variants" ${RX.sending ? 'disabled' : ''}>${ic('shuffle', 's14')}Redo it</button>${['meta_ad', 'social'].includes(ch.family) ? `<button class="btn btn-ghost sm" data-rx="image">${ic('sparkles', 's14')}New photo</button>` : ''}</div>${RX.sending ? `<p class="rxp-status"><brew-load class="spin"></brew-load>${esc(RX.sending)}</p>` : ''}`
    : `<p class="it-locked">It’s in a jam. Shape it there.</p>`;
  const mineHtml = (ch, edit) => `<section class="dt-mine"><h4 class="dt-h">Your checks</h4>
      ${(ch.myChecks || []).length ? `<ul class="mc-list">${ch.myChecks.map((m) => `<li class="${m.done ? 'done' : ''}"><button class="mc-box" data-mc="${m.id}" aria-pressed="${!!m.done}" aria-label="Tick">${m.done ? ic('check', 's14') : ''}</button><span>${esc(m.text)}${m.always ? '<em>every time</em>' : ''}</span>${edit ? `<button class="linkbtn mc-x" data-mc-rm="${m.id}" aria-label="Remove">${ic('x', 's14')}</button>` : ''}</li>`).join('')}</ul>` : '<p class="dt-empty">Add what you want ticked before this ships. Only you tick these.</p>'}
      ${edit ? `<form class="mc-add" id="mc-add"><input name="t" placeholder="e.g. Legal OK’d the study footnote" autocomplete="off"><label class="mc-always"><input type="checkbox" name="always"> Every ${esc((ch.familyName || 'package').toLowerCase())}</label><button class="btn btn-ghost sm">Add</button></form>` : ''}
    </section>
    <section class="dt-mine"><h4 class="dt-h">Your notes</h4>
      ${(ch.notes || []).map((n) => `<div class="nt"><p>${esc(n.text)}</p><small>${ago(n.at)}${edit ? ` · <button class="linkbtn" data-nt-rm="${n.id}">Remove</button>` : ''}</small></div>`).join('') || '<p class="dt-empty">Notes stay with this package. The AI reads them, and the ShopOS team sees them in the brief.</p>'}
      <form class="mc-add nt-add" id="nt-add"><textarea name="t" rows="2" placeholder="Add a note"></textarea><button class="btn btn-ghost sm">Add note</button></form>
    </section>`;
  const briefTop2 = (ch) => { const w = workOfCard(RX.p?.id), bp = w?.doc?.plan || {}, k = w?.contract, kn = RX.p ? cardOf(RX.p).know : null;
    const rows = [['What changes', bp.change], ['Who it’s for', bp.audience], ['When', bp.when], ['Budget', bp.budget], ['Owner', bp.owner], ['Stop rule', bp.guard]].filter(([, v]) => v);
    const know = k ? `${k.metric.name}, ${k.how.toLowerCase()}, grade ${k.plannedGrade}, read after ${k.window} days` : kn ? `${bp.metric || kn.metric}, ${String(kn.bestHow || '').replace(/^./, (x) => x.toLowerCase())}${kn.bestGrade ? `, grade ${kn.bestGrade} at best` : ''}` : '';
    return `<section class="bf-top"><small class="dt-k">The final version · v${curN(ch)}</small>${rows.length ? `<dl class="bf-rows">${rows.map(([kk, v]) => `<div><dt>${esc(kk)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '<p class="dt-empty">Who it’s for, when and the budget fill in as you jam.</p>'}
      ${know ? `<p class="bf-know">${ic('trendup', 's14')}<b>How we’ll know:</b> ${esc(know)}</p>` : ''}${w?.doc?.missing?.length ? `<p class="bf-miss">Still missing: ${w.doc.missing.map((x) => `<button class="linkbtn" data-st-fill="${esc(x)}">${esc(String(x).toLowerCase())}</button>`).join(', ')}</p>` : ''}</section><h4 class="dt-h">The package</h4>`; };
  const briefExtra = (ch) => { const w = workOfCard(RX.p?.id), md = w?.doc?.md || '';
    return `<section class="bf-doc"><div class="bf-doc-h"><h4 class="dt-h">The brief</h4><span>${RX.briefEdit ? '' : `<button class="linkbtn" data-st-briefedit>Edit</button> · `}<button class="linkbtn" data-st-brief>Full hand-off ${ic('right', 's14')}</button></span></div>
      ${RX.briefSync ? `<p class="dt-empty bf-syncing" role="status"><brew-load class="spin"></brew-load>Bringing the brief up to v${curN(ch)}…</p>` : ''}
      ${RX.briefEdit ? `<textarea class="bf-ed" id="bf-ed" rows="14">${esc(md)}</textarea><div class="dt-actions"><button type="button" class="btn btn-ghost sm" data-st-briefcancel>Cancel</button><button type="button" class="btn btn-primary sm" data-st-briefsave>Save the brief</button></div>`
        : md ? `${bfComments(w)}<article class="bf-md" data-bf-md>${window.JamRoom?.toHtml ? window.JamRoom.toHtml(md) : esc(md)}</article>` : '<p class="dt-empty">The brief is written as you jam.</p>'}</section>`; };
  /* comments on the brief: select words in it → Comment → say what's wrong; "Fix with AI" rewrites those parts in one pass (doc/fix) */
  const bfComments = (w) => { const cs = w?.doc?.comments || [], busy = RX.bfFix === w?.id;
    if (!cs.length) return `<p class="bf-hint">${ic('chat', 's14')}Select any words in the brief to comment. AI fixes them for you.</p>`;
    return `<div class="bf-cms"><ol>${cs.map((c) => `<li>${c.quote ? `<q>${esc(c.quote.length > 90 ? c.quote.slice(0, 89) + '…' : c.quote)}</q>` : ''}<p>${esc(c.note || 'Make this part right')}</p>${busy ? '' : `<button class="icon-btn" data-bf-cmrm="${esc(c.id)}" aria-label="Remove comment">${ic('x', 's14')}</button>`}</li>`).join('')}</ol>
      <button class="btn btn-primary sm${busy ? ' is-wait' : ''}" data-bf-fix ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? `<span class="spin"></span>Fixing the brief…` : `${ic('sparkles', 's14')}Fix ${cs.length === 1 ? 'it' : `all ${cs.length}`} with AI`}</button></div>`; };
  /* each open comment's words are marked in the brief (first match inside one paragraph or bullet) */
  const bfMark = () => { const art = $('[data-bf-md]'), cs = workOfCard(RX.p?.id)?.doc?.comments || []; if (!art || !cs.length) return;
    for (const c of cs) { const q = String(c.quote || '').trim(); if (q.length < 2) continue;
      const tw = document.createTreeWalker(art, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) { const i = n.data.indexOf(q); if (i < 0) continue;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); const m = document.createElement('mark'); m.className = 'bf-mk'; m.title = c.note || 'Comment'; try { r.surroundContents(m); } catch {} break; } } };
  /* mode 'bf': the jam brief (comment, or fix with AI); mode 'tb': the team brief on the stage, where any selection, or a tap on a
     part, is changed with AI (Param, 23 Oct: "entire brief should be select and change using AI") */
  const bfPop = { el: null, quote: '', mode: 'bf', k: null };
  const bfPopClose = () => { bfPop.el?.remove(); bfPop.el = null; bfPop.quote = ''; bfPop.k = null; };
  const bfPopAt = (rect, quote, mode = 'bf') => { bfPopClose(); bfPop.quote = quote; bfPop.mode = mode; const el = document.createElement('div'); el.className = 'bf-pop';
    el.innerHTML = mode === 'tb' ? `<button class="btn btn-primary sm" data-bf-cmgo>${ic('sparkles', 's14')}Change with AI</button>` : `<button class="btn btn-primary sm" data-bf-cmgo>${ic('chat', 's14')}Comment</button>`; document.body.appendChild(el); bfPop.el = el;
    const top = Math.min(innerHeight - 60, rect.bottom + 8), left = Math.max(12, Math.min(innerWidth - el.offsetWidth - 12, rect.left + rect.width / 2 - el.offsetWidth / 2));
    el.style.top = `${top}px`; el.style.left = `${left}px`; };
  const bfPopForm = () => { const el = bfPop.el; if (!el) return; el.classList.add('is-form');
    const tbK = bfPop.mode === 'tb' && bfPop.k ? (TBS.brief?.sections || []).find((x) => x.k === bfPop.k) : null;
    el.innerHTML = bfPop.mode === 'tb'
      ? `<q>${esc(bfPop.quote.length > 120 ? bfPop.quote.slice(0, 119) + '…' : bfPop.quote)}</q><textarea id="bf-cm-in" rows="3" placeholder="What should it say instead?"></textarea><div>${tbK?.edited ? '<button class="linkbtn" data-tb-putback>Put Brew’s back</button><span class="sp"></span>' : ''}<button class="btn btn-ghost sm" data-bf-cancel>Cancel</button><button class="btn btn-primary sm" data-tb-aigo>${ic('sparkles', 's14')}Change it</button></div>`
      : `<q>${esc(bfPop.quote.length > 120 ? bfPop.quote.slice(0, 119) + '…' : bfPop.quote)}</q><textarea id="bf-cm-in" rows="3" placeholder="What’s wrong or what should it say?"></textarea><div><button class="btn btn-ghost sm" data-bf-cmadd>Add comment</button><button class="btn btn-primary sm" data-bf-cmfix>${ic('sparkles', 's14')}Fix with AI</button></div>`;
    const r = el.getBoundingClientRect(); if (r.bottom > innerHeight - 8) el.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`; if (r.right > innerWidth - 8) el.style.left = `${Math.max(8, innerWidth - r.width - 8)}px`; $('#bf-cm-in', el)?.focus(); };
  const bfSel = () => { if (bfPop.el?.classList.contains('is-form')) return; const s = getSelection(), art = $('[data-bf-md]'), tb = $('.tbm-doc:not(.tbm-wait)');
    if (!s || s.isCollapsed || (!art && !tb) || !s.rangeCount || view !== 'remix') return bfPopClose(); const r = s.getRangeAt(0); const mode = art?.contains(r.commonAncestorContainer) ? 'bf' : tb?.contains(r.commonAncestorContainer) ? 'tb' : null; if (!mode) return bfPopClose();
    const q = s.toString().replace(/\s+/g, ' ').trim(); if (q.length < 2) return bfPopClose(); bfPopAt(r.getBoundingClientRect(), q, mode); };
  { let tm = 0; document.addEventListener('selectionchange', () => { clearTimeout(tm); tm = setTimeout(bfSel, 250); }); }
  document.addEventListener('mousedown', (e) => { if (bfPop.el && !bfPop.el.contains(e.target) && !e.target.closest?.('[data-bf-md],.tbm-doc')) bfPopClose(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && bfPop.el) { e.stopImmediatePropagation(); bfPopClose(); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'bf-cm-in' && bfPop.mode === 'tb') { e.preventDefault(); bfPop.el?.querySelector('[data-tb-aigo]')?.click(); } }, true);
  const bfFix = async (w) => { if (!w || RX.bfFix) return; RX.bfFix = w.id; paintStudio();
    const r = await tapi('POST', `/api/work/${w.id}/doc/fix`, {}).catch((e) => ({ error: e.message })); RX.bfFix = null; if (r.work) putWork(r.work);
    toast(r.error ? `${ic('info', 's16')}${esc(r.error)}` : `${ic('check', 's16')}${esc(r.reply || `Fixed ${r.fixed === 1 ? 'the comment' : `${r.fixed} comments`}`)}`); if (view === 'remix') paintStudio(); };
  document.addEventListener('click', async (e) => { if (!bfPop.el?.contains(e.target)) return; const w = workOfCard(RX.p?.id); if (!w) return bfPopClose();
    if (e.target.closest('[data-bf-cmgo]')) return bfPopForm();
    if (e.target.closest('[data-bf-cancel]')) return bfPopClose();
    if (e.target.closest('[data-tb-putback]')) { const k = bfPop.k; bfPopClose(); const r = await tapi('POST', `/api/work/${w.id}/team-brief/edit`, { k, t: '' }); if (r.brief) { TBS.brief = r.brief; TBS.pdf = null; tbWarm(); } return paintStudio(); }
    if (e.target.closest('[data-tb-aigo]')) { const ask = $('#bf-cm-in')?.value.trim() || '', quote = bfPop.quote, k = bfPop.k; if (!ask) return $('#bf-cm-in')?.focus(); bfPopClose(); getSelection()?.removeAllRanges();
      const h = k ? (TBS.brief?.sections || []).find((x) => x.k === k)?.h : ''; return tbAi(h ? `In "${h}": ${ask}` : ask, k ? '' : quote); }
    const fix = e.target.closest('[data-bf-cmfix]'); if (!fix && !e.target.closest('[data-bf-cmadd]')) return;
    const note = $('#bf-cm-in')?.value.trim() || '', quote = bfPop.quote; bfPopClose(); getSelection()?.removeAllRanges();
    const r = await tapi('POST', `/api/work/${w.id}/doc/comment`, { quote, note }).catch((er) => ({ error: er.message })); if (r.work) putWork(r.work);
    if (r.error) return toast(`${ic('info', 's16')}${esc(r.error)}`); if (fix) return bfFix(r.work || w); toast(`${ic('check', 's16')}Comment added`); paintStudio(); });
  const detailsTab = (ch, pkgCh, edit) => (RX.editing && edit ? '' : `<div class="tbm-share"><span><b>Hand it to the team</b><small>The brief opens on the stage: check it, then download or send the PDF.</small></span><button class="btn btn-primary sm" data-tb-open>${ic('send', 's14')}Share</button></div>`) + (RX.editing && edit
    ? `<form id="st-spec" class="dt-form">${ch.fields.map((f) => fieldEdit(f, ch.pkg)).join('')}<div class="dt-actions"><button type="button" class="btn btn-ghost" data-spec-cancel>Cancel</button><button class="btn btn-primary">Save as v${ch.versions.length + 1}</button></div></form>`
    : `${briefTop2(ch)}<div class="dt-head"><span class="pill ${ch.missing.length ? 'warn' : 'ok'}">${ch.missing.length ? `${ch.missing.length} missing` : 'Complete'}</span>${edit && !RX.viewing ? `<button class="btn btn-ghost sm" data-spec-edit>Edit details</button>` : ''}</div>
       <dl class="dt-list">${ch.fields.map((f) => fieldView(f, pkgCh.pkg)).join('')}</dl>
       ${mineHtml(ch, edit)}
       <h4 class="dt-h">Brew checks</h4><ul class="dt-checks">${ch.checks.filter((x) => !x.mine).map((x) => `<li class="${x.ok ? 'ok' : x.soft ? 'soft' : 'bad'}">${ic(x.ok ? 'check' : 'x', 's14')}<span>${esc(x.k)}</span>${x.learned ? '<em>learned</em>' : ''}</li>`).join('')}</ul>
       <p class="dt-note">${ic('refresh', 's14')}If it goes wrong: ${esc(ch.rollback)}.</p>
       ${briefExtra(ch)}`);
  const historyTab = (ch) => {
    const cmp = RX.cmp.length === 2 ? RX.cmp.map((id) => ch.versions.find((v) => v.id === id)).filter(Boolean).sort((a, b) => a.n - b.n) : null;
    const val = (s, k) => { const v = s?.[k]; return Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? Object.values(x).join(' · ') : x)).join(' / ') : v ?? ''; };
    const keys = cmp ? ch.fields.map((f) => f.k).concat(['image']).filter((k) => JSON.stringify(cmp[0].snapshot?.[k] ?? '') !== JSON.stringify(cmp[1].snapshot?.[k] ?? '')) : [];
    return `<p class="hs-tip">Tap a version to switch to it. Your next change builds from there; nothing is lost.${RX.cmp.length < 2 ? ' Tick two to compare.' : ''}</p>
      ${cmp ? `<div class="hs-cmp"><div class="hs-cmp-h"><b>v${cmp[0].n} → v${cmp[1].n}</b><button class="linkbtn" data-cmp-clear>Clear</button></div>${keys.map((k) => `<div class="hs-d"><small>${esc(ch.fields.find((f) => f.k === k)?.label || k)}</small><del>${esc(String(val(cmp[0].snapshot, k)) || 'none')}</del><ins>${esc(String(val(cmp[1].snapshot, k)) || 'none')}</ins></div>`).join('') || '<p>No differences.</p>'}</div>` : ''}
      <ol class="hs-list">${ch.versions.slice().reverse().map((v) => { const s = v.snapshot || {}, isHead = v.id === ch.head, isLive = v.id === ch.live, isView = RX.viewing === v.id;
        return `<li class="${isHead ? 'head' : ''}${isView ? ' viewing' : ''}"><input type="checkbox" data-cmp="${v.id}" ${RX.cmp.includes(v.id) ? 'checked' : ''} aria-label="Compare v${v.n}">
          <button class="hs-v" data-v-view="${v.id}">${s.image ? `<img src="${esc(s.image)}" alt="">` : `<span class="hs-n">v${v.n}</span>`}<span class="hs-tx"><b>v${v.n}${isHead ? ' <em>current</em>' : ''}${isLive ? ' <em class="live">live</em>' : ''}</b><span>${esc(vLabel(v))}</span><small>${esc(authorName(v.author))} · ${ago(v.at)}</small></span></button></li>`; }).join('')}</ol>`;
  };
  // every version in order, one tap to switch. The canvas shows the one you're on (the newest, unless you switch).
  /* in the action row with Share: the photos on the version (made, picked, or the product photos the post's brief names) and its words */
  const REF_RX = /https?:\/\/[^\s,)]+?\.(?:jpe?g|png|webp)(?:\?[^\s,)]*)?/gi;
  const dlAssets = (p) => { const own = [...new Set([p.video, p.image, ...(p.photos || []), ...(p.cardImages || []), ...(p.image || (p.photos || []).length ? [] : String(p.media || '').match(REF_RX) || [])].filter((u) => u && typeof u === 'string'))];
    return own.length ? own : [cardPhoto()].filter(Boolean); }; /* nothing made yet: the photo the preview shows goes in the download too */
  const dlCopy = (ch, p) => { const val = (v) => Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? Object.values(x).filter(Boolean).join(' · ') : x)).join('\n') : v ?? '';
    const fields = (ch.fields || []).length ? ch.fields : [{ k: 'title', label: 'Title' }, { k: 'copy', label: 'Post' }, { k: 'hashtags', label: 'Hashtags' }];
    return fields.filter((f) => !/^(imageBrief|media|format|knobs|utm)$/.test(f.k)).map((f) => [f.label || f.k, String(val(p?.[f.k])).trim()]).filter(([, v]) => v).map(([k, v]) => `${k}\n${v}`).join('\n\n'); };
  const dlTool = (ch, pkgCh) => { if (pkgCh.imagePending || ch.imagePending) return ''; const p = pkgCh.pkg || {}, k = dlAssets(p).length, words = !!dlCopy(ch, p); if (!k && !words) return '';
    /* says exactly what you get: "Download photo + text (zip)"; a quiet line under Ready, never a third big button */
    const what = `${k ? `${p.video ? (k > 1 ? 'video + photo' : 'video') : k > 1 ? `${k} photos` : 'photo'}${words ? ' + text' : ''}` : 'text'}`, zip = k + (words ? 1 : 0) > 1;
    return `<button class="st-dl" data-st-dl title="Download this version’s ${what}${zip ? ' as one zip' : ''}">${ic('down', 's14')}<span>${zip ? `Download all <small>${what} · zip</small>` : `Download ${what}`}</span></button>`; };
  const downloadVersion = async (ch, pkgCh, btn) => {
    const p = pkgCh.pkg || {}, urls = dlAssets(p), copy = dlCopy(ch, p), n = pkgCh === ch ? curN(ch) : (ch.versions.find((v) => v.id === RX.viewing)?.n || curN(ch));
    const base = `${String(B.brand?.name || BR).replace(/[^\w-]+/g, '-')}-${String(ch.actionLabel || 'draft').toLowerCase().replace(/[^\w]+/g, '-')}-v${n}`.replace(/-+/g, '-');
    if (!urls.length && !copy) return toast('Nothing to download yet.');
    btn?.classList.add('is-busy');
    try {
      /* one picture that won't load never sinks the rest: the zip carries what came through, and says if something didn't */
      const got = (await Promise.all(urls.map(async (u, i) => { try { const r = await fetch(cdnSized(u, 2048)); if (!r.ok) return null; const b = await r.blob(); return { blob: b, name: `${base}-${/^video\//.test(b.type) ? 'video' : 'photo'}${urls.length > 1 ? '-' + String(i + 1).padStart(2, '0') : ''}.${extOf(b.type, u)}` }; } catch { return null; } }))).filter(Boolean);
      if (got.length < urls.length) toast(`${urls.length - got.length} picture${urls.length - got.length === 1 ? '' : 's'} couldn’t be fetched; the rest is in the download.`);
      if (!got.length && !copy) throw new Error('nothing');
      if (got.length + (copy ? 1 : 0) === 1) return got.length ? saveBlob(got[0].blob, got[0].name) : saveBlob(new Blob([copy + '\n'], { type: 'text/plain;charset=utf-8' }), `${base}-text.txt`);
      const files = await Promise.all(got.map(async (g) => ({ name: g.name, data: new Uint8Array(await g.blob.arrayBuffer()) })));
      if (copy) files.push({ name: `${base}-text.txt`, data: new TextEncoder().encode(copy + '\n') });
      saveBlob(zipStore(files), `${base}.zip`);
    } catch { toast('Couldn’t download it. Try again in a moment.'); } finally { btn?.classList.remove('is-busy'); } };
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const zipStore = (files) => { /* stored (no compression): images are already compressed */
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    for (const f of files) { const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, f.data.length, 4], [22, f.data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, f.data.length, 4], [24, f.data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(h, name, f.data); cen.push(c, name); off += 30 + name.length + f.data.length; }
    const size = cen.reduce((a, x) => a + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, n]) => n === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    return new Blob([...parts, ...cen, e], { type: 'application/zip' }); };
  const saveBlob = (blob, name) => { const u = URL.createObjectURL(blob), a = Object.assign(document.createElement('a'), { href: u, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
  const extOf = (type, url) => ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'image/jpeg': 'jpg' })[type] || (String(url).match(/\.(jpe?g|png|webp|gif|mp4)(\?|$)/i) || [])[1] || 'jpg';
  /* change the photo: the brand's own product photos, an upload, or a new one made with AI from what you describe */
  const PH_FAM = ['meta_ad', 'social', 'post'];
  const phTools = (ch, pkgCh, viewing) => { const p = pkgCh.pkg || {}; if (!PH_FAM.includes(ch.family) || viewing || ch.state === 'jam') return '';
    if (ch.family === 'post' && !p.media && !p.image) return '';
    const fin = ''; /* Make the final is the ship bar's main button now (stepBar); the full sheet is under ··· */
    return `<div class="st-atools"><button class="btn btn-ghost sm" data-ph-open ${ch.imagePending ? 'disabled' : ''}>${ic('pic', 's14')}${ch.imagePending ? (ch.finalPending ? 'Making the final…' : 'Making a new photo…') : p.image || (p.photos || []).length ? 'Change photo' : 'Choose a photo'}</button>${fin}${!ch.imagePending && ch.imageError ? `<small class="st-aerr">${ic('info', 's14')}${esc(/stopped|budget|offline|sloosh|credit|final|quote|space/i.test(ch.imageError) ? ch.imageError : 'The new photo didn’t come through. Make it again.')}</small>` : ''}</div>`; };
  const PH = { sel: [], data: null };
  const phPaint = (w) => { const d = PH.data, ch = RX.ch; if (!d || !ch) return; const max = d.max || 1;
    $('.ph-m', w).innerHTML = `<div class="ph-h"><b>${ch.pkg?.image ? 'Change the photo' : 'Choose a photo'}</b><button class="icon-btn" data-ph-x aria-label="Close">${ic('x', 's16')}</button></div>
      <div class="ph-b">
        <section class="ph-ai${d.ai ? '' : ' is-off'}"><small>Describe the photo you want</small>
          <textarea id="ph-brief" rows="3" placeholder="${d.ai ? 'e.g. The grey pair on a desk next to a laptop, morning light, no people' : ''}" ${d.ai ? '' : 'disabled'}>${esc(PH.brief || '')}</textarea>
          <div class="ph-row">${d.ai ? `<button class="btn btn-primary sm" data-ph-ai>${ic('sparkles', 's14')}Make it with AI${freeTag()}</button><span>Uses your product photo as the reference${PH.sel.length ? ' (the one you picked below)' : ''}. Lands as a new version in about a minute.</span>` : `<span>${esc(d.aiWhy || '')} Pick one below or upload yours.</span>`}</div></section>
        <section><div class="ph-sh"><small>Your product photos</small><span>${max > 1 ? `Pick up to ${max}` : 'Pick one'}</span></div>
          ${d.photos.length ? `<div class="ph-grid">${d.photos.map((x, i) => { const k = PH.sel.indexOf(x.img); return `<button class="ph-t${k >= 0 ? ' is-on' : ''}" data-ph-pick="${i}" title="${esc(x.t)}"><img src="${esc(cdnSized(x.img, 300))}" alt="" loading="lazy">${k >= 0 ? `<i>${max > 1 ? k + 1 : ic('check', 's14')}</i>` : ''}<span>${esc(x.t)}${x.out ? ' · sold out' : ''}</span></button>`; }).join('')}</div>` : '<p class="ph-none">No product photos read from the store yet.</p>'}</section>
        ${(d.references || []).some((r) => r.kind === 'image') ? `<section><div class="ph-sh"><small>Your references</small><span>From the Library</span></div>
          <div class="ph-grid">${d.references.map((r, i) => { if (r.kind !== 'image') return ''; const u = r.url.replace(/^\//, ''), k = PH.sel.indexOf(u); return `<button class="ph-t${k >= 0 ? ' is-on' : ''}" data-ph-ref="${i}" title="${esc(r.label)}"><img src="${esc(u)}" alt="" loading="lazy">${k >= 0 ? `<i>${max > 1 ? k + 1 : ic('check', 's14')}</i>` : ''}<span>${esc(r.label)} · ${esc(r.job)}</span></button>`; }).join('')}</div></section>` : ''}
        <section><div class="ph-sh"><small>Or upload your own</small></div><label class="ph-up">${ic('plus', 's16')}<span>Add a photo (PNG, JPG or WebP, up to 8 MB)</span><input type="file" accept="image/png,image/jpeg,image/webp" data-ph-file hidden></label></section>
      </div>
      <div class="ph-f"><span>${PH.sel.length ? `${PH.sel.length} picked. The words stay the same; it saves as a new version.` : 'Nothing changes until you choose.'}</span><button class="btn btn-ghost" data-ph-x>Cancel</button><button class="btn btn-primary" data-ph-use ${PH.sel.length ? '' : 'disabled'}>Use ${PH.sel.length > 1 ? `these ${PH.sel.length}` : 'this photo'}</button></div>`; };
  const phDone = (r) => { if (r.error) return toast(esc(r.error)); closeModal(); RX.ch = r.change; putCh(r.change); RX.viewing = null; RX.tab = 'iterate'; RX.resetScroll = true; paintStudio(); };
  const openPhotos = async () => { const ch = RX.ch; if (!ch) return; const bs = [...document.querySelectorAll('[data-ph-open]')]; if (bs.some((x) => x.classList.contains('is-busy'))) return;
    bs.forEach((x) => x.classList.add('is-busy')); /* the picker loads the product photos first: show it's on its way */
    const d = await tapi('GET', `/api/changes/${ch.id}/photos`).catch(() => ({ error: 'Couldn’t load the photos. Try again.' })); bs.forEach((x) => x.classList.remove('is-busy')); if (d.error) return toast(esc(d.error));
    PH.data = d; PH.sel = (d.current || []).filter((u) => d.photos.some((x) => x.img === u) || (d.references || []).some((r) => r.url.replace(/^\//, '') === u)); PH.brief = '';
    modal(`<div class="sheet ph-m" role="dialog" aria-label="Change the photo"></div>`, (w) => { phPaint(w);
      w.addEventListener('input', (e) => { if (e.target.id === 'ph-brief') PH.brief = e.target.value; });
      w.addEventListener('change', async (e) => { const f = e.target.closest('[data-ph-file]')?.files?.[0]; if (!f) return; if (f.size > 8e6) return toast('That photo is over 8 MB.');
        const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); }); phDone(await tapi('POST', `/api/changes/${ch.id}/photo`, { upload: data })); });
      w.addEventListener('click', async (e) => { e.stopPropagation();
        if (e.target.closest('[data-ph-x]')) return closeModal();
        const pk = e.target.closest('[data-ph-pick],[data-ph-ref]'); if (pk) { const u = pk.dataset.phRef != null ? PH.data.references[+pk.dataset.phRef].url.replace(/^\//, '') : PH.data.photos[+pk.dataset.phPick].img, max = PH.data.max || 1; PH.sel = PH.sel.includes(u) ? PH.sel.filter((x) => x !== u) : max === 1 ? [u] : [...PH.sel, u].slice(-max); return phPaint(w); }
        if (e.target.closest('[data-ph-use]')) return phDone(await tapi('POST', `/api/changes/${ch.id}/photo`, { urls: PH.sel }));
        const ai = e.target.closest('[data-ph-ai]'); if (ai) { busyBtn(ai, 'Starting…'); const brief = [PH.brief.trim(), PH.sel[0] ? `Use this product: ${PH.data.photos.find((x) => x.img === PH.sel[0])?.t || ''}` : ''].filter(Boolean).join('. ');
          if (PH.sel.length) await tapi('POST', `/api/changes/${ch.id}/photo`, { urls: PH.sel.slice(0, 1) }); /* the picked product is the AI's reference */
          return phDone(await tapi('POST', `/api/changes/${ch.id}/photo`, { ai: true, brief })); }
      }); }); };
  window.__openPhotos = () => openPhotos(); /* the composer's + menu opens it in the studio */
  const timeline = (ch, viewing) => ch.versions.length < 2 ? '' : `<nav class="st-tl" aria-label="Versions">${ch.versions.map((v) => {
      const on = viewing ? v.id === viewing.id : v.id === ch.head;
      return `<button class="st-tl-v${on ? ' is-on' : ''}" data-v-view="${v.id}" aria-pressed="${on}" title="${esc(v.reason || '')}"><b>v${v.n}</b><span>${esc(vLabel(v))}</span>${v.id === ch.live ? '<i class="st-tl-live">live</i>' : ''}</button>`; }).join('')}</nav>`;
  /* every widget fits the stage: a Meta ad's photo gets the height its header, copy and footer leave (so it never
     scrolls); any other widget with a picture (a carousel, a post, an Instagram slide, a phone) narrows until it fits,
     never under 320px. Text widgets (a page, an email, a sheet) keep their reading width and scroll in the stage */
  const fitAd = () => { const box = $('.std .st-asset'), ad = box && box.firstElementChild; if (!ad || innerWidth < 861) return;
    const m = $('.am-media', ad) || $('.as-swipe, .pm-media, .sv-phone', ad); ad.style.width = ''; if (!m || ad.querySelector('.am-chat')) return;
    const im = $('img', m); if (im && !im.complete) im.addEventListener('load', fitAd, { once: true });
    const cs = getComputedStyle(box), roomH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4, roomW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    /* the Meta ad on the stage is sized like a post in Instagram's feed: 470px wide, and the photo between 1.91:1 and 4:5
       (Instagram crops anything taller to 4:5), so a tall photo never makes the ad taller than it would run */
    if (ad.matches('.as-meta.lg') && m.matches('.am-media')) { const ar = (im?.naturalWidth && im.naturalWidth / im.naturalHeight) || parseFloat(getComputedStyle(ad).getPropertyValue('--ar')) || .8;
      ad.style.width = Math.round(Math.min(roomW, 470)) + 'px'; m.style.aspectRatio = String(Math.min(1.91, Math.max(0.8, ar))); return; }
    for (let i = 0; i < 2 && ad.offsetHeight > roomH && m.offsetHeight > 0; i++) { const rest = ad.offsetHeight - m.offsetHeight, k = (roomH - rest) / m.offsetHeight; if (k >= 1 || k <= 0) break;
      ad.style.width = Math.round(Math.max(320, Math.min(roomW, ad.offsetWidth * k))) + 'px'; } };
  addEventListener('resize', () => { if (view === 'remix') fitAd(); });
  /* the options under the chat: the card's own next step, the brief, photo, the family's quick asks, more versions, the knobs, the files */
  /* the files, the projection and the remakes: the same three chips in both designs (ui=1 puts them after its quick asks) */
  /* "Make our version": what Brew read from the rival's ad (rival-ad.js), so the team sees the angle, hook and look it is working from */
  const rivalReadHtml = (ch) => { const r = ch?.rival; if (!r) return '';
    const rd = r.read, row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
    const sum = [r.angle, rd?.from === 'video' ? 'from the video' : null].filter(Boolean).join(' · ');
    return `<details class="rv-read" data-keep="rv-read"><summary>${r.poster ? `<img src="/${esc(String(r.poster).replace(/^\//, ''))}" alt="" loading="lazy">` : ''}<span><b>What Brew read from ${esc(r.brand)}’s ad</b>${sum ? `<small>${esc(sum)}</small>` : ''}</span></summary>
      ${rd ? `<dl>${row('What stops the scroll', rd.stopper)}${row('Hook', rd.hookPattern)}${row('Who it speaks to', rd.audience)}${row('Proof', rd.proof)}${row('Layout', rd.layout)}${row('Look', rd.look)}${(rd.beats || []).length ? `<div><dt>Beats</dt><dd><ol>${rd.beats.map((b) => `<li>${esc(b)}</li>`).join('')}</ol></dd></div>` : ''}</dl>
        ${(rd.works || []).length ? `<p class="rv-works"><b>What makes it work</b></p><ul>${rd.works.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="rv-note">Ours keeps the angle, hook and composition, with your product and your words. Nothing of theirs is copied.</p>`
        : `<p class="rv-note">${r.hook ? `Their hook: “${esc(r.hook)}”. ` : ''}Brew reads the rest of their ad as it writes the first version.</p>`}
      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">See their ad in the Ad Library ${ic('external', 's14')}</a>` : ''}</details>`; };
  /* View references: the ad or viral video "Make our version" remakes (feed-service refSummary), theirs, shown only as a reference.
     The jam's canvas never uses their picture; this sheet is the one place it plays */
  const REF_OF = {};
  const refBtnHtml = (ch) => { const r = ch?.ref; if (!r) return ''; REF_OF[ch.id] = r;
    const what = r.kind === 'viral' ? `${r.platformName} video by ${r.author}${r.scoreText ? ` · ${r.scoreText} their usual views` : ''}` : `${r.brand}’s ${r.format === 'video' ? 'video' : 'image'} ad`;
    return `<button type="button" class="ref-btn" data-refs="${esc(ch.id)}">${r.poster ? `<img src="/${esc(String(r.poster).replace(/^\//, ''))}" alt="" loading="lazy">` : `<span class="ref-ic">${ic('film', 's16')}</span>`}<span><b>View references</b><small>${esc(what)}</small></span>${ic('chev', 's14')}</button>`; };
  const bigN = (n) => (n == null ? '' : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
  const openRefs = (r) => { if (!r) return; const src = (u) => `/${String(u).replace(/^\//, '')}`, row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
    const ytId = !r.video && r.platform === 'youtube' ? (String(r.url || '').match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{11})/) || [])[1] : null; /* YouTube files can't be saved (403): its own player */
    const media = ytId ? `<iframe class="ref-media ref-yt" src="https://www.youtube-nocookie.com/embed/${esc(ytId)}" title="${esc(r.author || 'YouTube video')}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>` : r.video ? `<video class="ref-media" src="${esc(src(r.video))}"${r.poster ? ` poster="${esc(src(r.poster))}"` : ''} controls playsinline preload="metadata"></video>` : r.poster ? `<img class="ref-media" src="${esc(src(r.poster))}" alt="">` : `<p class="rv-note">Brew couldn’t save their file this time. Open the original below.</p>`;
    const stats = r.kind === 'viral' ? [row('Views', bigN(r.views)), r.scoreText && row('Their usual', `${bigN(r.usual)} · this got ${r.scoreText}`), row('Posted', r.days != null ? `${r.days} day${r.days === 1 ? '' : 's'} ago` : ''), row('Format', [r.format, r.pacing].filter(Boolean).join(' · '))].join('')
      : [row('Running', r.days != null ? `${r.days} day${r.days === 1 ? '' : 's'}${r.versions ? ` in ${r.versions} version${r.versions > 1 ? 's' : ''}` : ''}` : ''), row('Angle', r.angle)].join('');
    const link = r.url ? `<a class="btn btn-ghost" href="${esc(r.url)}" target="_blank" rel="noopener">${r.kind === 'viral' ? `Watch it on ${esc(r.platformName)}` : 'See it in the Ad Library'} ${ic('external', 's14')}</a>` : '';
    modal(`<div class="sheet pick-sheet ref-sheet" role="dialog" aria-label="References"><header class="sh-h"><b class="sh-t">${ic('film', 's16')}References</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="ref-b">${media}<p class="ref-tag">Theirs, for reference only: ${esc(r.kind === 'viral' ? `${r.author}${r.handle && r.handle !== r.author ? ` (${r.handle})` : ''} on ${r.platformName}` : r.brand)}</p>
        ${stats ? `<dl class="ref-dl">${stats}</dl>` : ''}${r.hook ? `<p><b>Hook</b> “${esc(r.hook)}”</p>` : ''}${r.why ? `<p><b>Why it works</b> ${esc(r.why)}</p>` : ''}
        ${(r.beats || []).filter((b) => b.shot || b.text).length ? `<p><b>Beats</b></p><ol class="ref-beats">${r.beats.filter((b) => b.shot || b.text).map((b) => `<li>${b.t ? `<small>${esc(b.t)}</small> ` : ''}${esc(b.shot)}${b.text ? ` <i>“${esc(b.text)}”</i>` : ''}</li>`).join('')}</ol>` : ''}
        <p class="rv-note">Ours keeps the format and structure, with your product and your words.</p></div>
      ${link ? `<div class="rv-acts">${link}</div>` : ''}</div>`); };
  const j2Acts = (ch, c) => { const out = [];
    out.push(c('data-j2-pack', 'down', j2PackLabel(ch), ' is-pack'));
    out.push(c('data-j2-impact', 'trendup', 'Projected impact'));
    if (['meta_ad', 'social', 'post'].includes(ch.family) && ch.state !== 'live' && !ch.realOnly /* Reddit, Quora, a Facebook group: real photos only, no AI reel or carousel */) { const as = ch.pkg?.draft?.as || (/carousel/.test(String(ch.action)) ? 'carousel' : /short_video|reel/.test(String(ch.action)) ? 'video' : ''), busyMedia = ch.imagePending || ch.videoPending || ch.remakePending; if (busyMedia) out.push(`<button type="button" class="chip j2-chip" disabled>${ic('clock', 's14')}${esc(jobOf(ch) || 'Making it')}…</button>`); else { if (as !== 'video') out.push(c('data-j2-remake="video"', 'film', 'Make it a reel')); if (as !== 'carousel') out.push(c('data-j2-remake="carousel"', 'layers', 'Make it a carousel')); } }
    return out; };
  /* the publish pack: read-only, the final files and copy to post yourself. Brew writes to no account */
  const j2PackLabel = (ch) => { const pf = String(ch.pkg?.platform || ch.pkg?.where?.[0]?.name || '').trim();
    if (ch.target?.conn === 'meta') return 'Get the Ads Manager files'; /* a Meta ad (or a Meta video ad) is made in Ads Manager, never posted to Instagram */
    return ({ meta_ad: 'Get the Ads Manager files', social: 'Post to Instagram', post: pf ? `Post to ${pf}` : 'Get the post', crm: 'Get the message', store: 'Get the HTML', listing: 'Get the listing sheet', vis: 'Get the FAQ files', search: 'Get the Google Ads sheet', setup: 'Get the checklist', brief: 'Get the shot list', meta_ops: 'Get the change list', print: 'Get the print file' })[ch.family] || 'Get the files'; };
  const J2 = { imp: {}, pack: {} }; /* per change: the projection and the pack, shown in the chat */
  const j2Sg = (x) => { const v = +x; return Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${j2Num(Math.abs(v))}` : '–'; };
  /* a money unit reads as a money range ($15–$40); anything else as a signed change (+4.3 to +17.3 % better) */
  const j2Range = (im) => { const u = String(im.unit || '').trim(), cur = { usd: '$', inr: '₹', eur: '€', gbp: '£' }[u.toLowerCase()] || (/^[$₹€£¥]$/.test(u) ? u : '');
    return cur ? `${esc(cur)}${j2Num(im.low)}–${esc(cur)}${j2Num(im.high)}` : `${j2Sg(im.low)} to ${j2Sg(im.high)}<small> ${esc(u)}</small>`; };
  const j2Num = (x) => { const v = +x; return Number.isFinite(v) ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : String(+v.toFixed(1))) : '–'; };
  const j2Key = (ch) => `${ch.id}:${RX.viewing || ch.head || 'v0'}`, j2ImpKey = (ch) => `${ch.id}:${ch.head || 'v0'}`; /* a projection is always of the head version */
  const j2Extra = (ch) => { const im = J2.imp[j2ImpKey(ch)], pk = J2.pack[j2Key(ch)]; let h = '';
    if (pk) h += `<div class="lgm ai">${face(ch.agent)}<div>${pk.busy ? `<p><brew-load class="spin"></brew-load>Putting the files together…</p>` : pk.error ? `<p>${esc(pk.error)}</p>` : `<p>${esc(j2PackLabel(ch))}: your files are ready. The final ${esc((ch.familyName || 'files').toLowerCase())} and its copy, to post yourself. Brew changes nothing in your accounts.</p><div class="j2-pack"><a class="btn btn-ghost sm" href="/${esc(pk.url)}" download="${esc(pk.name)}">${ic('down', 's14')}${esc(pk.name)}</a><small>${(pk.files || []).length} files</small></div>${(pk.todo || []).length ? `<p class="j2-todo">Still to do: ${pk.todo.map(esc).join(' · ')}</p>` : ''}`}</div></div>`;
    if (im) h += `<div class="lgm ai">${face('performance')}<div>${im.busy ? `<p><brew-load class="spin"></brew-load>Reading this card’s results and benchmarks, then handing it to the Performance marketer…</p>` : im.error ? `<p>${esc(im.error)}</p>` : `<p>Here’s the likely lift if this runs. ${esc(im.label || 'A projection, not a promise')}.</p>
        <div class="j2-imp"><b>${j2Range(im)}</b><span>${esc(im.metric || '')}${im.windowLabel ? `, ${esc(im.windowLabel)}` : ''}</span><em class="j2-conf is-${esc(im.confidence || 'low')}">${esc(im.confidence || 'low')} confidence</em></div>
        ${(im.basis || []).length ? `<details class="j2-why" data-keep="j2-why"><summary>What it’s based on</summary><ul>${im.basis.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${(im.assumptions || []).length ? `<small>Assumed</small><ul>${im.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${(im.gaps || []).length ? `<small>Couldn’t read</small><ul>${im.gaps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</details>` : ''}${im.note ? `<p class="j2-todo">${esc(im.note)}</p>` : ''}`}</div></div>`;
    return h; };
  const j2Run = async (kind, ch, arg) => {
    const jk = j2Key(ch);
    if (kind === 'pack') { J2.pack[jk] = { busy: true }; paintStudio(); const r = await tapi('GET', `/api/changes/${ch.id}/pack${RX.viewing ? `?v=${encodeURIComponent(RX.viewing)}` : ''}`);
      J2.pack[jk] = r.pack || { error: r.error || 'The files didn’t come together. Try again.' }; if (RX.ch?.id === ch.id) paintStudio();
      if (r.pack?.url) { const a = document.createElement('a'); a.href = '/' + r.pack.url; a.download = r.pack.name || 'brew-pack.zip'; document.body.appendChild(a); a.click(); a.remove(); } return; }
    if (kind === 'impact') { const ik = j2ImpKey(ch); J2.imp[ik] = { busy: true }; paintStudio(); const r = await tapi('GET', `/api/changes/${ch.id}/impact`); J2.imp[ik] = r.impact || { error: r.error || 'The projection didn’t come back. Try again.' }; if (RX.ch?.id === ch.id) paintStudio(); return; }
    if (kind === 'remake') { RX.sending = arg === 'video' ? 'Making it a reel…' : 'Making it a carousel…'; paintStudio(); const r = await tapi('POST', `/api/changes/${ch.id}/remake`, { as: arg }); if (RX.ch?.id === ch.id) RX.sending = null;
      if (r.change) putCh(r.change); if (view !== 'remix' || RX.ch?.id !== ch.id) return; /* you moved on: the new version waits in its own jam */
      if (r.error || !r.change) { toast(esc(r.error || 'That didn’t work. Try again.')); return paintStudio(); }
      RX.ch = r.change; RX.viewing = null; if (r.making === false && r.why) toast(esc(r.why)); return paintStudio(); } };
  /* the studio says where its draft came from: a rival's ad → "Our version of <rival>'s ad" (FEED-NOT-02), else the card */
  const studioFrom = (ch) => { const rv = rivalOf(RX.p ? cardOf(RX.p) : {}) || (ch.rival ? { name: ch.rival.brand || '' } : null); if (rv) return esc(ourVersionOf(rv.name || ch.rival?.brand || '')); const c = RX.p ? cardOf(RX.p) : null; return esc((c && (whoseAd(c) || fromLabel(c))) || 'Made for you'); }; /* the feed's own label ("Made for you", "From your ads"), never from “title” (FEED-NOT-02) */
  /* ---------- brief mode: the team brief on the stage (team-brief.js). Creative | Brief switch above the stage; each section is
     a quick edit; Download PDF, or Send PDF as an email draft with the PDF and the creatives attached ---------- */
  const TBS = { for: null, brief: null, busy: false, err: null, files: null, filesFor: null };
  const tbWork = () => workOfCard(RX.p?.id);
  const tbSwitch = () => tbWork() ? `<div class="tbm-switch" role="tablist" aria-label="Stage">${[['creative', 'Creative', 'pic'], ['brief', 'Brief', 'doc']].map(([k, n, i]) => `<button role="tab" data-tb-stage="${k}" aria-selected="${(RX.stage || 'creative') === k}">${ic(i, 's14')}${n}</button>`).join('')}</div>` : '';
  const tbLoad = async (fresh = false) => { const w = tbWork(); if (!w || (TBS.busy && !fresh)) return; if (TBS.for !== w.id) Object.assign(TBS, { brief: null, files: null, filesFor: null, pdf: null }); TBS.for = w.id; TBS.busy = true; TBS.err = null; TBS.head = RX.ch?.head || null; if (view === 'remix') paintStudio();
    const r = await tapi('GET', `/api/work/${w.id}/team-brief${fresh ? '?fresh=1' : ''}`).catch((e) => ({ error: e.message })); TBS.busy = false;
    if (r.brief) TBS.brief = r.brief; else TBS.err = r.error || 'The brief didn’t come together. Try again.'; if (view === 'remix') paintStudio();
    if (r.brief) tbWarm(); };
  /* the PDF and the files are made ready in the background while the brief is read, so Send opens the email at once (a share
     sheet only opens straight after the click) */
  const tbWarm = async () => { if (TBS.warming) return; TBS.warming = true; try { const w = tbWork(); if (!w) return; const r = await tapi('POST', `/api/work/${w.id}/team-brief/pdf`, {}).catch(() => ({}));
      if (r.pdf && TBS.for === w.id) { TBS.pdf = r.pdf; if (r.brief) TBS.brief = r.brief; await tbFiles(r.pdf).catch(() => {}); } } finally { TBS.warming = false; } };
  const tbOpen = () => { if (!tbWork()) return toast('Open the jam first, then share its brief.'); RX.stage = 'brief'; RX.tbEdit = null; paintStudio(); $('.tbm-scroll')?.scrollTo?.(0, 0); if (!TBS.brief || TBS.for !== tbWork().id || TBS.brief.stale) tbLoad(); };
  /* the brief starts writing the moment the jam opens (Param, 23 Oct), so Brief is ready when it's tapped; once the first draft is in */
  const tbAuto = (ch) => { const w = tbWork(); if (!w || ch.copyPending || TBS.busy) return; if (TBS.for !== w.id || (!TBS.brief && !TBS.err)) return tbLoad();
    if (TBS.brief && TBS.head && ch.head && TBS.head !== ch.head) return tbLoad();
    /* a teammate changed the brief (its stamp moved), or the jam brief moved while the brief is on the stage */
    if (TBS.brief && w.teamBrief?.rev && TBS.brief.rev && w.teamBrief.rev > TBS.brief.rev) return tbLoad();
    if (TBS.brief && RX.stage === 'brief' && w.doc?.rev != null && TBS.brief.docRev != null && w.doc.rev !== TBS.brief.docRev) tbLoad(); }; /* a new version of the ad: the brief follows it (Param, 23 Oct: it stayed on v1) */
  /* change the brief with AI: a selection, a tapped part or a chat line; the parts it changed light up for a moment */
  const tbAi = async (ask, quote = '') => { const w = tbWork(); if (!w || RX.tbAi) return; RX.tbAi = true; paintStudio();
    const r = await tapi('POST', `/api/work/${w.id}/team-brief/ai`, { ask, quote }).catch((er) => ({ error: er.message })); RX.tbAi = false;
    if (r.brief) { TBS.brief = r.brief; TBS.pdf = null; tbWarm(); tbLit(r.changed); } toast(r.error ? `${ic('info', 's16')}${esc(r.error)}` : `${ic('check', 's16')}${esc(r.said || 'Brief changed')}`); if (view === 'remix') paintStudio(); };
  const tbLit = (ks) => { RX.tbNew = ks || []; clearTimeout(RX.tbNewT); RX.tbNewT = setTimeout(() => { RX.tbNew = []; document.querySelectorAll('.tbm-doc .is-new').forEach((n) => n.classList.remove('is-new')); }, 4000); };
  const tbText = (s) => { const L = String(s || '').split('\n').map((l) => l.trim()).filter(Boolean); if (!L.length) return '<p class="tbm-none">To confirm.</p>';
    return L.map((l) => /^[-•]\s+/.test(l) ? `<li>${esc(l.replace(/^[-•]\s+/, ''))}</li>` : `<p>${esc(l)}</p>`).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`); };
  const tbStage = (ch) => { const b = TBS.for === tbWork()?.id ? TBS.brief : null;
    if (!b) return `<div class="tbm-doc tbm-wait">${TBS.err ? `<p>${esc(TBS.err)}</p><button class="btn btn-ghost sm" data-tb-retry>Try again</button>` : `<p role="status"><brew-load class="spin"></brew-load>Writing the brief for the team: what to make, why, the evidence and the final files…</p>`}</div>`;
    const cr = b.creatives || [];
    return `<article class="tbm-doc" aria-label="The team brief">
      <header class="tbm-h"><span class="tbm-brand">${b.mark ? `<img src="${esc(b.mark)}" alt="">` : ''}${esc(b.brand)}</span><span class="tbm-k">Brief${b.memo.ref ? ` · ${esc(b.memo.ref)}` : ''}${b.version ? ` · v${b.version}` : ''}</span></header>
      ${b.stale ? `<p class="tbm-stale">${ic('refresh', 's14')}The ad changed since this was written. <button class="linkbtn" data-tb-retry="fresh">Bring it up to date</button></p>` : ''}
      ${RX.tbAi ? `<p class="tbm-stale" role="status"><brew-load class="spin"></brew-load>Changing the brief…</p>` : TBS.busy ? `<p class="tbm-stale" role="status"><brew-load class="spin"></brew-load>Bringing the brief up to the latest version…</p>` : ''}
      <h1 class="tbm-title${(RX.tbNew || []).includes('title') ? ' is-new' : ''}">${esc(b.title)}</h1>
      <dl class="tbm-memo"><div${(RX.tbNew || []).includes('from') ? ' class="is-new"' : ''}><dt>From</dt><dd>${esc(b.memo.from || `${b.brand} team`)}</dd></div><div${(RX.tbNew || []).includes('to') ? ' class="is-new"' : ''}><dt>To</dt><dd>${esc(b.memo.to)}</dd></div><div${(RX.tbNew || []).includes('due') ? ' class="is-new"' : ''}><dt>Due</dt><dd>${esc(b.memo.due || 'To confirm')}</dd></div><div><dt>Files</dt><dd>${cr.length ? `${cr.length} attached` : 'None yet'}</dd></div></dl>
      ${cr.length ? `<div class="tbm-files">${cr.map((c) => `<figure><a href="/${esc(c.url)}" target="_blank" rel="noopener">${c.kind === 'video' ? `<video src="/${esc(c.url)}" ${c.poster ? `poster="/${esc(c.poster)}"` : ''} muted playsinline preload="metadata"></video>` : `<img src="/${esc(c.url)}" alt="">`}</a><figcaption>${esc(c.label)}</figcaption></figure>`).join('')}</div>` : ''}
      ${b.sections.map((x) => `<section class="tbm-sec${x.locked ? ' is-locked' : ''}${(RX.tbNew || []).includes(x.k) ? ' is-new' : ''}"${x.locked ? ` title="The final words come from the ad: change them on the Creative side"` : ` data-tb-ai="${esc(x.k)}" tabindex="0" role="button" aria-label="Change ${esc(x.h)} with AI"`}><h2>${esc(x.h)}${x.edited ? '<em>changed</em>' : ''}${x.locked ? '<em>from the ad</em>' : `<span class="tbm-pen">${ic('sparkles', 's14')}</span>`}</h2>${x.k === 'words' ? `<div class="tbm-words">${esc(x.t)}</div>` : tbText(x.t)}</section>`
        + (x.k === 'why' && (b.evidence || []).length ? `<section class="tbm-sec tbm-ev"><h2>The evidence</h2><ul>${b.evidence.map((e, i) => `<li><span>${esc(e.say)}</span>${e.src ? `<small>${esc(e.src)}</small>` : ''}<button class="icon-btn" data-tb-evrm="${i}" aria-label="Leave this out">${ic('x', 's14')}</button></li>`).join('')}</ul></section>` : '')).join('')}
      <footer class="tbm-f"><button class="linkbtn" data-rx="share-shopos">Or send it to the ShopOS team</button><span class="sp"></span><button class="btn btn-ghost" data-tb-pdf>${ic('down', 's16')}Download PDF</button><button class="btn btn-primary" data-tb-send>${ic('send', 's16')}Send PDF</button></footer>
    </article>`; };
  /* the PDF (made once per state of the brief) and the creatives, as files */
  const tbPdf = async () => { const w = tbWork(); if (!w) return null; if (TBS.pdf && TBS.brief?.pdf?.url === TBS.pdf.url) return TBS.pdf; const r = await tapi('POST', `/api/work/${w.id}/team-brief/pdf`, {}).catch((e) => ({ error: e.message }));
    if (r.brief) TBS.brief = r.brief; if (r.pdf) TBS.pdf = r.pdf; if (r.error || !r.pdf) { toast(`${ic('info', 's16')}${esc(r.error || 'The PDF didn’t come together. Try again.')}`); return null; } return r.pdf; };
  const asciiName = (s) => String(s || 'file').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim() || 'file';
  const tbFiles = async (pdf) => { const key = `${pdf.url}|${(TBS.brief?.creatives || []).map((c) => c.url).join(',')}`; if (TBS.filesFor === key && TBS.files) return TBS.files;
    const get = async (url, name, type) => { const r = await fetch('/' + url); if (!r.ok) return null; const b = await r.blob(); return new File([b], asciiName(name), { type: type || b.type }); };
    const out = [await get(pdf.url, pdf.name, 'application/pdf')];
    for (const c of TBS.brief?.creatives || []) { const f = await get(c.url, c.name); if (f && f.size < 20e6) out.push(f); }
    TBS.files = out.filter(Boolean); TBS.filesFor = key; return TBS.files; };
  const dl = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  /* an email draft: the share sheet (Mail, Outlook…) where the browser can share files, else a .eml that opens as an unsent
     draft in Mail or Outlook with everything attached. Brew sends nothing itself */
  const b64 = async (blob) => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/.{76}/g, '$&\r\n'); };
  const utf8b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  /* the email that goes with the brief: what to make, why, the strongest evidence, what's attached, when, a backup link. In Gmail
     (no attachments through a link) it opens with one line for the sender: which downloaded files to attach, then delete it */
  const tbMailText = (b, o = {}) => { const sec = (k) => String(b.sections.find((x) => x.k === k)?.t || '').trim(), clipT = (t, n) => (t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t);
    const flat = (t) => t.split('\n').map((l) => l.replace(/^[-•]\s+/, '').trim()).filter(Boolean).join(' ');
    const pdfName = o.pdf?.name || 'the brief (PDF)', cr = b.creatives || [], files = [pdfName, ...cr.map((c) => c.name)];
    const L = [];
    if (o.gmail) L.push(`[Before you send: attach the ${files.length} file${files.length > 1 ? 's' : ''} Brew just saved to your Downloads (${files.join(', ')}), then delete this line.]`, '');
    L.push('Hi,', '', `We’d like you to make this for ${b.brand || 'us'}: ${clipT(flat(sec('what')), 260)}`, '', `Why: ${clipT(flat(sec('why')), 360)}`);
    const ev = (b.evidence || []).slice(0, 3); if (ev.length) L.push('', 'What backs it:', ...ev.map((e) => `- ${clipT(e.say, 160)}${e.src ? ` (${e.src})` : ''}`));
    const who = flat(sec('who')); if (who && !/^to confirm/i.test(who)) L.push('', `Who it’s for: ${clipT(who, 220)}`);
    L.push('', 'Attached:', `- ${pdfName}: the full brief, with the final words, specs, rules and how we’ll judge it`, ...cr.map((c) => `- ${c.name}: ${c.kind === 'video' ? 'the final video' : 'the final creative'}, use it as it is`));
    const open = sec('open').split('\n').map((l) => l.replace(/^[-•]\s+/, '').trim()).filter((l) => l && !/^nothing open/i.test(l)).slice(0, 3);
    if (open.length) L.push('', 'Still to confirm with us:', ...open.map((l) => `- ${clipT(l, 140)}`));
    L.push('', b.memo.due ? `We need it by ${b.memo.due}. ` + 'Reply here with any questions before you start.' : 'Tell us when you can have it ready, and reply here with any questions before you start.');
    if (o.link) L.push('', `If an attachment didn’t come through, the brief is here: ${o.link}`);
    L.push('', 'Thanks,', b.memo.from || `${b.brand} team`); return L.join('\n'); };
  const tbSubject = (b) => `Brief: ${b.title}${b.brand ? ` · ${b.brand}` : ''}`;
  const tbEml = async (b, files, pdf) => { const B = `brew-${Math.random().toString(36).slice(2)}`, subj = tbSubject(b);
    const parts = [`--${B}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${utf8b64(tbMailText(b, { pdf })).replace(/.{76}/g, '$&\r\n')}\r\n`];
    for (const f of files) parts.push(`--${B}\r\nContent-Type: ${f.type || 'application/octet-stream'}; name="${f.name}"\r\nContent-Disposition: attachment; filename="${f.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${await b64(f)}\r\n`);
    return new Blob([`To: \r\nSubject: =?UTF-8?B?${utf8b64(subj)}?=\r\nX-Unsent: 1\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${B}"\r\n\r\n${parts.join('')}--${B}--\r\n`], { type: 'message/rfc822' }); };
  /* Send PDF asks where: Gmail (the files download, the draft opens written) or a Mail / Outlook draft with everything attached */
  const tbSendSheet = () => modal(`<div class="sheet pick-sheet tbm-send" role="dialog" aria-label="Send the brief"><header class="sh-h"><b class="sh-t">${ic('send', 's16')}Send the brief</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <p class="sh-p">Brew writes the email; you pick who it goes to and send it. Nothing is sent for you.</p>
      <button class="tbm-opt" data-tb-gmail><span class="tbm-opt-i tbm-gm" aria-hidden="true">M</span><span><b>Open in Gmail</b><small>The PDF and ${(TBS.brief?.creatives || []).length ? 'the creatives download' : 'downloads'}, and a Gmail draft opens with the email written. Attach the files from Downloads and send.</small></span>${ic('right', 's16')}</button>
      <button class="tbm-opt" data-tb-mail><span class="tbm-opt-i" aria-hidden="true">${ic('send', 's16')}</span><span><b>Mail or Outlook draft</b><small>Everything already attached. It opens as a draft in Mail or Outlook, or in your share menu.</small></span>${ic('right', 's16')}</button></div>`);
  const tbGmail = async (btn) => { const win = window.open('', '_blank'); /* opened inside the click, so it is never blocked; filled in when the files are ready */
    if (win) win.document.write('<!doctype html><title>Opening Gmail…</title><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#555">Writing the email…</body>');
    const done = busyBtn(btn, 'Getting the files…'); try {
      const pdf = await tbPdf(); if (!pdf) { win?.close(); return; } const b = TBS.brief, cr = b.creatives || [];
      dl('/' + pdf.url, pdf.name); cr.forEach((c, i) => setTimeout(() => dl('/' + c.url, c.name), (i + 1) * 350));
      const body = tbMailText(b, { gmail: true, pdf, link: `${location.origin}/${pdf.url}` });
      const url = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${encodeURIComponent(tbSubject(b))}&body=${encodeURIComponent(body)}`;
      if (win && !win.closed) win.location.replace(url); else window.open(url, '_blank', 'noopener');
      closeModal(); toast(`${ic('check', 's16')}Gmail draft opened. ${cr.length + 1} file${cr.length ? 's' : ''} saved to Downloads: drag ${cr.length ? 'them' : 'it'} into the draft. If your browser asks, allow the downloads.`);
    } catch (e) { win?.close(); toast(`${ic('info', 's16')}That didn’t go through. Try again.`); } finally { done(); } };
  const tbSend = async (btn) => { const done = busyBtn(btn, 'Getting it ready…'); try {
      const pdf = await tbPdf(); if (!pdf) return; const files = await tbFiles(pdf), b = TBS.brief; closeModal();
      if (navigator.canShare?.({ files }) && navigator.share) { try { await navigator.share({ files, title: tbSubject(b), text: tbMailText(b, { pdf }) }); toast(`${ic('check', 's16')}Pick your email app: the PDF and files are attached`); return; } catch (e) { if (e?.name === 'AbortError') return; } }
      dl(URL.createObjectURL(await tbEml(b, files, pdf)), `${asciiName(`Brief - ${b.title}`).slice(0, 80)}.eml`);
      toast(`${ic('check', 's16')}Email draft downloaded: open it and it opens in Mail or Outlook, ready to send, with the PDF${files.length > 1 ? ` and ${files.length - 1} file${files.length > 2 ? 's' : ''}` : ''} attached`);
    } finally { done(); } };
  const tbDownload = async (btn) => { const done = busyBtn(btn, 'Making the PDF…'); try { const pdf = await tbPdf(); if (!pdf) return; dl('/' + pdf.url, pdf.name);
      const cr = TBS.brief?.creatives || []; if (cr.length) toast(`${ic('check', 's16')}PDF downloaded. <button class="linkbtn" data-tb-files>Download the ${cr.length} file${cr.length > 1 ? 's' : ''} too</button>`); } finally { done(); } };
  document.addEventListener('click', async (e) => { const g = (sel) => e.target.closest?.(sel); if (view !== 'remix' || !RX.ch) return;
    if (g('[data-tb-open]')) { e.preventDefault(); return tbOpen(); }
    const st = g('[data-tb-stage]'); if (st) { if (st.dataset.tbStage === 'brief') return tbOpen(); RX.stage = 'creative'; RX.tbEdit = null; return paintStudio(); }
    const rt = g('[data-tb-retry]'); if (rt) return tbLoad(rt.dataset.tbRetry === 'fresh');
    const ed = g('[data-tb-ai]'); if (ed && !g('a,button') && getSelection()?.isCollapsed !== false) { const x = (TBS.brief?.sections || []).find((s) => s.k === ed.dataset.tbAi); if (!x) return; bfPopAt(ed.getBoundingClientRect(), x.t, 'tb'); bfPop.k = x.k; bfPop.el.style.top = `${Math.max(8, Math.min(innerHeight - 220, ed.getBoundingClientRect().top + 28))}px`; return bfPopForm(); }
    if (g('[data-tb-cancel]')) { $('#tbm-ed')?.blur(); RX.tbEdit = null; return paintStudio(); }
    const sv = g('[data-tb-save]'), rs = g('[data-tb-reset]'); if (sv || rs) { const w = tbWork(), k = RX.tbEdit, t = rs ? '' : $('#tbm-ed')?.value || ''; $('#tbm-ed')?.blur(); RX.tbEdit = null;
      const r = await tapi('POST', `/api/work/${w.id}/team-brief/edit`, { k, t }); if (r.brief) { TBS.brief = r.brief; TBS.pdf = null; tbWarm(); } if (r.error) toast(esc(r.error)); return paintStudio(); }
    const ev = g('[data-tb-evrm]'); if (ev) { const r = await tapi('POST', `/api/work/${tbWork().id}/team-brief/evidence`, { i: +ev.dataset.tbEvrm }); if (r.brief) { TBS.brief = r.brief; TBS.pdf = null; tbWarm(); } return paintStudio(); }
    const pd = g('[data-tb-pdf]'); if (pd) return tbDownload(pd);
    if (g('[data-tb-send]')) return tbSendSheet();
    const gm = g('[data-tb-gmail]'); if (gm) return tbGmail(gm);
    const ml = g('[data-tb-mail]'); if (ml) return tbSend(ml);
    if (g('[data-tb-files]')) { (TBS.brief?.creatives || []).forEach((c, i) => setTimeout(() => dl('/' + c.url, c.name), i * 300)); } });
  addEventListener('keydown', (e) => { if (view !== 'remix' || RX.stage !== 'brief') return; const ed = e.target.closest?.('[data-tb-ai]'); if (ed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ed.click(); }
    if (e.target.id === 'tbm-ed') { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); e.target.blur(); RX.tbEdit = null; paintStudio(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('[data-tb-save]')?.click(); } } }, true);
  const paintStudio = () => {
    const pg = $('#view .std'); const ch = RX.ch; if (!pg || !ch) return;
    window.__GR = { Original: 'none', Warm: 'sepia(.25) saturate(1.25) hue-rotate(-8deg)', Quiet: 'saturate(.6) brightness(1.05) contrast(.92)', Vivid: 'saturate(1.6) contrast(1.08)', 'Golden hour': 'sepia(.45) saturate(1.4) brightness(1.05)' };
    if ($('#st-in')) RX.draft = $('#st-in').value;
    const viewing = RX.viewing && RX.viewing !== ch.head ? ch.versions.find((v) => v.id === RX.viewing) : null; if (!viewing) RX.viewing = null;
    const pkgCh = asPkg(ch, viewing), edit = ch.state !== 'jam', tab = RX.tab && RX.tab !== 'history' ? RX.tab : 'iterate'; /* history is the dropdown on the History button now */
    const formFocus = document.activeElement?.closest?.('#st-spec');
    if (formFocus || document.activeElement?.id === 'bf-ed' || document.activeElement?.id === 'tbm-ed' || document.activeElement?.id === 'bf-cm-in' || bfPop.el?.classList.contains('is-form') || document.activeElement?.matches?.('[data-hl-edit][contenteditable]')) { pollJob(ch); return; } // never repaint under someone typing in the spec or the brief (the job poll keeps going, so no status is left behind)
    const logScroll = $('.st-panel-b')?.scrollTop, tbmScroll = $('.tbm-scroll')?.scrollTop || 0; /* brief mode keeps its place through a repaint */
    /* an open panel stays open through a repaint (the jam's 3-second poll, a video landing): Param, 19 Oct, "What Brew read" closed in 2 s */
    const keepOpen = RX.keepFor === ch.id ? new Set([...pg.querySelectorAll('details[data-keep][open]')].map((d) => d.dataset.keep)) : new Set(); RX.keepFor = ch.id;
    /* a repaint from the jam's poll (a teammate's line, a version) never takes the box from someone typing in it */
    const typingAt = document.activeElement?.id === 'st-in' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    pg.innerHTML = `<header class="st-top"><button class="q-back" data-st-back>${ic('left', 's16')}${ch.batchKey ? `All ${RX.p?.images?.length || ''} ads` : 'Back'}</button>
        <div class="st-ttl"><b>${esc(ch.actionLabel)}${ch.target.conn && ch.target.name ? ` <span>on ${esc(ch.target.name)}</span>` : ''}</b><small>${face(ch.agent)}${esc(ch.familyName)} · ${studioFrom(ch)}</small></div>${tbSwitch()}${studioJamCtl()}
        <div class="st-vwrap"><button class="st-vpill${RX.vmenu ? ' is-open' : ''}" data-vmenu aria-haspopup="dialog" aria-expanded="${!!RX.vmenu}" title="Version history">${ic('clock', 's14')}<span>History</span>${ic('chev', 's14')}</button>${RX.vmenu ? `<div class="st-vmenu" role="dialog" aria-label="Version history"><div class="st-vmenu-h"><b>Versions</b><small>${ch.versions.length} saved · nothing is ever lost</small></div><div class="st-vmenu-b">${historyTab(ch)}</div></div>` : ''}</div>${themeBtn()}<button class="icon-btn st-more" aria-label="More" data-lmenu="remix:${esc(ch.id)}">${ic('more', 's16')}</button></header>
      <div class="st-body">
        <main class="st-canvas${RX.stage === 'brief' ? ' is-brief' : ''}">${RX.stage === 'brief' ? `<div class="tbm-scroll">${tbStage(ch)}</div>` : `${refBtnHtml(ch)}${rivalReadHtml(ch)}${optTabs(ch, viewing)}<div class="st-asset${ch.copyPending ? ' is-writing' : ''}">${ch.copyPending ? `<p class="st-writing" role="status"><brew-load class="spin"></brew-load>Writing the first draft from the card…</p>` : ''}${!ch.copyPending && ch.ctaPending ? `<p class="st-writing" role="status"><brew-load class="spin"></brew-load>${esc(ch.ctaPending)}…</p>` : ''}${assetHtml(pkgCh, 'lg')}</div>${phTools(ch, pkgCh, viewing)}${shipBar(ch, viewing).replace(/(<div class="ship-tx"><b>[\s\S]*?<\/b>)/, (m) => m + dlTool(ch, pkgCh))}`}</main>
        <aside class="st-panel"><div class="st-tabs" role="tablist">${[['iterate', 'Chat'], ['adjust', 'Adjust'], ['details', 'Brief']].map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${n}</button>`).join('')}</div>
          <div class="st-panel-b${tab === 'iterate' ? ' is-chat' : ''}">${tab === 'iterate' ? chatTab(ch, edit) : tab === 'adjust' ? adjustTab(ch, edit) : tab === 'details' ? detailsTab(ch, pkgCh, edit) : chatTab(ch, edit)}</div></aside>
      </div>`;
    /* Change photo sits on the photo itself, never under the post. A swiping carousel gets a still frame around it, so the
       button stays put while the slides scroll */
    /* a reel's photo and video tools: one quiet row right under the phone */
    { const at = $('.st-atools'), ph = $('.st-asset .sv-phone'), mk = $('.st-asset .sv-make.is-row'); if (ph) { if (at) { ph.after(at); if (mk) { at.append(...mk.children); mk.remove(); } } } }
    if (keepOpen.size) pg.querySelectorAll('details[data-keep]').forEach((d) => { if (keepOpen.has(d.dataset.keep)) d.open = true; });
    if (typingAt) { const box = $('#st-in'); if (box) { box.focus(); try { box.setSelectionRange(typingAt[0], typingAt[1]); } catch {} } }
    /* a share in flight keeps its spinner through the jam's repaints */
    if (RX.busyRx) { const b = pg.querySelector(`[data-rx="${RX.busyRx.act}"]`); if (b) { b.disabled = true; b.classList.add('is-wait'); b.setAttribute('aria-busy', 'true'); b.innerHTML = `<brew-load class="spin"></brew-load>${esc(RX.busyRx.lbl)}`; } }
    fitAd(); bfMark(); { const ts = $('.tbm-scroll'); if (ts && tbmScroll) ts.scrollTop = tbmScroll; }
    const pb = $('.st-panel-b'); const nT = (ch.thread || []).length + (RX.sending ? 1 : 0) + Object.keys(J2.imp).length + Object.keys(J2.pack).length;
    if (tab === 'iterate') pb.scrollTop = (ch.thread || []).length || RX.sending || j2Extra(ch) ? pb.scrollHeight : 0; /* the case stays first in the chat and scrolls up as it grows; a fresh chat is read from its top */ else if (logScroll && !RX.resetScroll) pb.scrollTop = logScroll; RX.resetScroll = false;
    tbAuto(ch);
    pollJob(ch);
  };
  /* the headline in place (hlHtml): click → type → Enter or click away saves a version; Esc cancels */
  const hlStart = (el) => { if (el.isContentEditable || RX.sending) return; el.dataset.was = el.textContent; el.contentEditable = 'plaintext-only'; if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; el.focus();
    try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch {} };
  const hlSave = async (el) => { const was = el.dataset.was ?? '', now = el.textContent.replace(/\s+/g, ' ').trim(); el.removeAttribute('contenteditable'); delete el.dataset.was; const ch = RX.ch;
    if (!ch || !now || now === was.trim()) { el.textContent = was; return; }
    const r = await tapi('POST', `/api/changes/${ch.id}/edit`, { pkg: { headline: now }, reason: 'New headline' }).catch((e) => ({ error: e.message }));
    if (r.error) { el.textContent = was; return toast(`${ic('info', 's16')}${esc(r.error)}`); }
    if (r.change) { RX.ch = r.change; putCh(r.change); } toast(`${ic('check', 's16')}Headline saved as v${curN(RX.ch)}`); paintStudio(); };
  document.addEventListener('click', (e) => { const el = e.target.closest?.('[data-hl-edit]'); if (el && view === 'remix') hlStart(el); });
  addEventListener('keydown', (e) => { const el = e.target.closest?.('[data-hl-edit]'); if (!el) return; /* capture: Esc and Enter here never reach the studio's own keys */
    if (!el.isContentEditable) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); hlStart(el); } return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); el.blur(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); el.textContent = el.dataset.was ?? el.textContent; el.dataset.was = el.textContent; el.blur(); } }, true);
  document.addEventListener('focusout', (e) => { const el = e.target.closest?.('[data-hl-edit]'); if (el?.isContentEditable) hlSave(el); });
  /* while a job runs, read the change again every few seconds and repaint, until every pending flag has cleared */
  const pollJob = (ch) => { clearTimeout(RX.pollT);
    if (jobOf(ch)) RX.pollT = setTimeout(async () => { if (view !== 'remix' || RX.ch?.id !== ch.id) return; const q = await tapi('GET', `/api/changes/${ch.id}`).catch(() => ({})); if (q.change) { RX.ch = q.change; putCh(q.change); const c2 = q.change, err = (c2.imageError || c2.videoError || '') !== (ch.imageError || ch.videoError || '') && (c2.imageError || c2.videoError);
      /* the job it was making is in (or failed); an ad's first copy is followed by its photo, so that one waits for the photo */
      if (!jobOf(c2) && !(ch.copyPending && ['meta_ad', 'social'].includes(c2.family) && !err)) sound(err ? 'error' : 'ready'); } paintStudio(); if (ch.copyPending && q.change && !q.change.copyPending) autoImage(q.change); }, ch.copyPending ? 1500 : 3000); };
  /* copy inside the tap: the old copy command runs at once; the clipboard API is the fallback, and never waits forever
     (it can hang on a permission prompt, and the button then looked dead: no copy, no toast) */
  const copyText = async (s) => { try { const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) sound('tick'); if (ok) return true; } catch (e) {}
    try { return await Promise.race([navigator.clipboard.writeText(s).then(() => true), wait(1500).then(() => false)]); } catch (e) { return false; } };
  /* the jam's own link: this card, this change, the latest version and state, in this workspace (the token opens it for a teammate) */
  const jamLink = async (p, w) => { const t = await shareTok(w?.id).catch(() => null), chId = RX.p?.id === p.id && RX.ch?.id ? RX.ch.id : w?.changeId || '';
    return `${location.origin}${location.pathname}#remix=${encodeURIComponent(p.id)}${chId ? `/${chId}` : ''}${t ? `&s=${t}` : ''}`; };
  const copyJamLink = async (p) => { const u = await jamLink(p, workOfCard(p.id)); toast(await copyText(u) ? `${ic('link', 's16')}Link copied` : 'Couldn’t copy the link. Try again.'); };
  /* the one "WhatsApp isn't connected" sheet (FEED-ARV-03): Brew has no WhatsApp connection (sending was cut), so a WhatsApp
     button never opens wa.me unchecked. It says so, offers the route that works (primary), and keeps "Open WhatsApp and send
     it myself" named for what it is. Used by the share sheet here and by the jam's approval (jam-room.js move) */
  const waNeed = ({ title, p, primary, onPrimary, onSelf }) => modal(`<div class="sheet pick-sheet wa-need"><header class="sh-h"><b class="sh-t">${ic('chat', 's16')}${esc(title)}</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="wa-state"><span class="wa-dot"></span>WhatsApp isn’t connected</div>
      <p class="sh-p">${esc(p)}</p>
      <div class="wa-acts"><button class="btn btn-primary" data-wa-go>${esc(primary)}</button><button class="btn btn-ghost" data-wa-self>Open WhatsApp and send it myself</button></div></div>`, (m) => {
      $('[data-wa-go]', m).onclick = () => { closeModal(); onPrimary?.(); };
      $('[data-wa-self]', m).onclick = () => { closeModal(); onSelf?.(); }; });
  /* opens at once and fills in place: the full summary can take a while to write, and a sheet that pops up late lands over whatever is open by then */
  const shareSheet = async (p) => {
    let url = '', text = '';
    modal(`<div class="sheet share-sheet"><header class="sh-h"><b class="sh-t">${ic('hand', 's16')}Jam with your team</b><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <p class="share-p">One link to this jam: the latest version, the chat and the brief. What they say comes back here.</p>
      <div class="share-btns"><button class="btn btn-ghost" data-share-wa>${ic('chat', 's16')}WhatsApp</button><button class="btn btn-ghost" data-share-copy="slack"><span class="slack-ic sm">#</span>Copy for Slack</button><button class="btn btn-primary" data-share-copy="link">${ic('link', 's16')}Copy the link</button></div></div>`, (m) => {
      $$('[data-share-copy]', m).forEach((b) => (b.onclick = async () => { if (!url) return toast('One moment, making the link…'); const slack = b.dataset.shareCopy === 'slack';
        toast(await copyText(slack ? text || `${p.title}\n${url}` : url) ? `${ic('check', 's16')}${slack ? 'Copied for Slack' : 'Link copied'}` : 'Couldn’t copy. Try again.'); }));
      /* WhatsApp is checked first: not connected, so the sheet says so; copying the link is the way that works, and opening WhatsApp yourself stays */
      $('[data-share-wa]', m).onclick = () => { if (!url) return toast('One moment, making the link…'); const msg = text || `${p.title}\n${url}`;
        if (conn('whatsapp')) { window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener'); return; }
        waNeed({ title: 'Share on WhatsApp', p: 'Brew can’t send it on WhatsApp or see what your team says there. Copy the link and paste it in your chat: what they say in the jam comes back here.', primary: 'Copy the link',
          onPrimary: async () => toast(await copyText(url) ? `${ic('check', 's16')}Link copied` : 'Couldn’t copy. Try again.'), onSelf: () => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener') }); }; });
    const m = $('#modal'), wa = () => {};
    const w = workOfCard(p.id) || (await tapi('POST', '/api/work', { cardId: p.id })).work; if (!w) { if (m?.isConnected) closeModal(); return toast('Couldn’t make the link. Try again.'); }
    url = await jamLink(p, w); wa();
    const chId = RX.p?.id === p.id && RX.ch?.id ? RX.ch.id : '';
    const r = await tapi('GET', `/api/work/${w.id}/handoff?base=${encodeURIComponent(location.origin)}${chId ? `&ch=${encodeURIComponent(chId)}` : ''}`).catch(() => ({}));
    if (r?.text) { text = r.text; wa(); } };
  window.__paintStudio = () => paintStudio(); /* the composer's menus repaint the studio */
  const findCh = (id) => (RX.ch?.id === id ? RX.ch : null) || RX.list.concat(RX.earlier).find((x) => x.id === id);
  const putCh = (ch) => { if (!ch) return; for (const arr of [RX.list, RX.earlier]) { const i = arr.findIndex((x) => x.id === ch.id); if (i >= 0) arr[i] = ch; } if (RX.ch?.id === ch.id) RX.ch = ch; };
  const paintRemix = () => (RX.ch ? paintStudio() : RX.batch ? paintBatch() : paintStart());
  const runRemix = async () => {
    if (RX.busy) return; const prompt = $('#rx-in')?.value.trim() || '';
    RX.busy = 'Writing it from the card. About 15 seconds.'; RX.earlier = [...RX.list, ...RX.earlier]; RX.list = []; RX.line = ''; paintStart();
    const r = await tapi('POST', `/api/cards/${RX.p.id}/remix`, { intent: RX.intent, prompt });
    RX.busy = false; if (r.error) { RX.line = 'That didn’t work. Try again.'; return paintStart(); }
    RX.list = r.changes; RX.line = r.live ? r.line : 'AI is offline, so these are templates built from the card. Open one and edit it, or try again shortly.'; paintStart(); showLearned(r.learned);
  };
  const PRE_CH = new Map(); // a package that came back with its jam's work: the studio opens on it without asking again
  const openStudio = async (id, o = {}) => {
    let ch = findCh(id) || PRE_CH.get(id); PRE_CH.delete(id); if (!ch) { const stop = holdView('Opening the jam'); const g = await tapi('GET', `/api/changes/${id}`); stop(); ch = g.change; }
    /* a link to a jam this browser can't open (another workspace's, or gone): open the card's own jam, never a blank page */
    if (!ch) { if (RX.p && !o.noFallback) { history.replaceState(history.state, '', `${location.pathname}#remix=${RX.p.id}`); return openRemix(RX.p, null, { fromHistory: true, noFallback: true }); } $('#view').innerHTML = `<div class="rxp"><p class="rx-gone">${ic('info', 's16')}This jam can’t be opened here. <button class="linkbtn" data-nav="feed">Back to the feed</button></p></div>`; return; }
    Object.assign(RX, { ch, viewing: null, cmp: [], tab: 'iterate', editing: false, draft: '', knobSel: {}, briefEdit: false, sending: null, att: [], stage: 'creative', tbEdit: null }); /* a reply still running in another jam never freezes this one */ tapi('POST', `/api/changes/${ch.id}/open`, {}); REMIXES = null; if (!o.fromHistory) nav(`#remix=${RX.p.id}/${ch.id}`, !o.replace, o.deep ? 'rx-deep' : 'rx-ch'); /* from the card page it replaces the card: Back goes to the feed, not round again */
    $('#view').innerHTML = `<div class="std"></div>`; window.scrollTo(0, 0); paintStudio();
    autoImage(ch);
  };
  // a Meta ad without its own creative gets one on the way in (once per package), after its first copy is written
  const autoImage = async (ch) => {
    if (['meta_ad', 'social'].includes(ch.family) && !ch.copyPending && !ch.remakePending && !ch.versions.some((v) => v.snapshot?.image || v.snapshot?.draft?.video) && !ch.imagePending && !ch.imageError && aiMode === 'live' && !RX.autoImg[ch.id] && !ls.get(`${LSP()}img-${ch.id}`)) { RX.autoImg[ch.id] = 1; ls.set(`${LSP()}img-${ch.id}`, '1'); /* once per change, ever: a failed or slow photo is never retried on its own (each try costs) */ const r = await tapi('POST', `/api/changes/${ch.id}/image`, {}); if (r.change && RX.ch?.id === ch.id) { RX.ch = r.change; putCh(r.change); paintStudio(); } }
  };
  const jamWait = () => { $('.jam-wait')?.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="jam-wait" role="status" aria-live="polite"><p><brew-load class="spin"></brew-load>Opening the jam…</p></div>`); return $('.jam-wait'); };
  const openRemix = async (p, chId, o = {}) => {
    const j2Label = o.make || cardOf(p).cta?.label || '', j2Ok = window.Jam2 && !String(p?.id || '').startsWith('jam-') && !/^(open (the )?(report|moves|scoreboard)|see what changed|run monday decisions|see it all)/i.test(j2Label);
    if (j2Ok && window.Jam2.on()) { closeDetail(true); return window.Jam2.open(p, j2Label, tapi); } /* Jam v2 (?v=2): the card's button opens the new jam */
    /* v1: a button that makes a picture, a set or a video opens Brew Studio (set up from the card, priced before anything is made);
       words, messages, briefs and batch cards stay in v1's own jam */
    if (j2Ok && !chId && !o.v1 && !window.BREW_DEMO) { if (openRemix.asking) return; openRemix.asking = true; const wait = jamWait(); /* one press, one jam; the wait shows at once */
      try { const k = await tapi('POST', '/api/jam2/studio-for', { cardId: p.id, cta: j2Label }).catch(() => null);
        if (k?.studio) { closeDetail(true); try { sessionStorage.setItem('brew-jam2-studio', '1'); } catch {} return window.Jam2.open(p, j2Label, tapi); } }
      finally { openRemix.asking = false; wait?.remove(); } }
    // Remix is the jam now: versions and quick turns live on the jam's canvas
    /* the jam page is the studio: one widget on a stage, Chat · Adjust · Details · History, versions. It works on the
       card's own package (made once per jam); a card with no package (a pure decision) keeps the canvas jam */
    const fromCard = !!DP;
    $('#inst')?.remove(); /* the home-screen nudge belongs to the feed, never over the jam's buttons */
    { closePop(); closeModal(); S.jamOn = { ...(S.jamOn || {}), [p.id]: true }; save();
      /* a batch card opens its N finished ads (keep or drop each), never one package made from its first picture; a jam linked to
         such a package before this fix opens the batch too */
      if (isBatchCard(p) && chId && (p._work || workOfCard(p.id))?.changeId === chId) chId = null;
      if (!chId && !isBatchCard(p)) { let w = p._work || workOfCard(p.id);
        /* making the jam's package takes a few seconds the first time: say so at once, never a dead tap */
        const wait = !w?.changeId ? jamWait() : null;
        try {
          const link = window.LIVE?.access?.gen !== false; /* demo mode: no package is made, the canvas jam opens */
          if (!w) { const r = await tapi('POST', '/api/work', { cardId: p.id, link }); w = r.work; if (w) putWork(w); if (r.change) PRE_CH.set(r.change.id, r.change); } /* the work and its package in one trip */
          if (w && !w.changeId && link) { const r = await tapi('POST', `/api/work/${w.id}/link-change`, {}); if (r.work) { putWork(r.work); w = r.work; } if (r.change) PRE_CH.set(r.change.id, r.change); }
        } finally { wait?.remove(); }
        chId = w?.changeId || null; }
      if (!chId) { NOPKG.add(p.id); return openDetail(p, { noStudio: true }); } }
    closePop(); if (DP) closeDetail(true); closeModal(); closeJam();
    const from = view;
    Object.assign(RX, { p, list: [], earlier: [], recipe: null, learned: null, busy: false, intent: '', line: '', scope: {}, ch: null, viewing: null });
    view = 'remix'; document.body.dataset.view = 'remix'; endBootRx(); /* the studio's full-page layout from its first paint, not when the counts next repaint */ document.body.classList.remove('deck-on'); $('#stk').innerHTML = ''; $('#notes').innerHTML = '';
    $$('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', 'false'));
    if (!o.fromHistory && !chId) nav(`#remix=${p.id}`, true, 'rx'); RX.from = from === 'remix' ? RX.from : from;
    RX.batch = isBatchCard(p) ? { items: [] } : null;
    $('#view').innerHTML = chId ? `<div class="std"><p class="std-wait"><brew-load class="spin"></brew-load>Opening the jam…</p></div>` : `<div class="rxp"></div>`; window.scrollTo(0, 0); if (!chId) RX.batch ? paintBatch() : paintStart(); /* going straight to a studio: its empty frame, never the options page in between */
    /* the card's making button ("Generate versions", "Make the video", "Draft the post"…): the studio opens making it, once per jam */
    if (chId && o.make && !o.fromHistory) { const r = await tapi('POST', `/api/changes/${chId}/cta-make`, { label: o.make }).catch(() => null); if (r?.change) PRE_CH.set(chId, r.change); }
    if (chId) return openStudio(chId, o.fromHistory ? o : { deep: true, replace: fromCard });
    if (RX.batch) { const g = await loadBatch(); if (g.batch) return; RX.batch = null; paintStart(); }
    const g = await tapi('GET', `/api/cards/${p.id}/remix`);
    if (view !== 'remix' || RX.p !== p || RX.ch) return;
    if (g.error) { RX.line = 'This card can’t be remixed yet.'; return paintStart(); }
    RX.recipe = g.recipe; RX.learned = g.learned;
    const drafts = g.changes.filter((x) => x.state === 'draft');
    if (g.changes.length) { RX.list = (drafts.length ? drafts : g.changes).slice(0, 3).sort((a, b) => (b.fromCard ? 1 : 0) - (a.fromCard ? 1 : 0)); RX.earlier = g.changes.filter((x) => !RX.list.includes(x)); paintStart(); } else runRemix();
  };
  // links and the back button: #remix=<card>[/<change>] opens it, an empty hash leaves it
  // a typed or pasted URL lands here too (history traversal also fires popstate; route() is idempotent)
  addEventListener('hashchange', route);
  const backToOptions = async (fromHistory) => { RX.ch = null; RX.viewing = null; if (fromHistory !== true) nav(`#remix=${RX.p.id}`, false, 'rx'); $('#view').innerHTML = `<div class="rxp"></div>`; if (RX.batch || isBatchCard(RX.p)) { RX.batch ||= { items: [] }; paintBatch(); window.scrollTo(0, 0); return loadBatch(); } if (!RX.recipe) { const g = await tapi('GET', `/api/cards/${RX.p.id}/remix`); RX.recipe = g.recipe; RX.learned = g.learned; RX.list = g.changes.slice(0, 3); RX.earlier = g.changes.slice(3); } paintStart(); window.scrollTo(0, 0); };
  // our Back from the options page: back to wherever the remix was opened from (the card page, the feed, Work…)
  const leaveRemix = () => { RX.ch = null; pullWork(true); if (['rx', 'rx-deep'].includes(history.state?.a)) return history.back(); nav(location.pathname, false, 'view'); view = RX.from || 'feed'; (VIEWS()[view] || renderFeed)(); window.scrollTo(0, 0); };
  /* the brief follows the package quietly, so it is always the final version */
  /* the brief follows the package without an AI rewrite on every edit: an edit only notes what was asked (lazy, no AI); the
     brief catches up when it is opened here (syncBriefNow) and when it is sent or shared (the server's doc/ship) */
  const syncBrief = (ch, said) => { const w = workOfCard(RX.p?.id); if (!w || !ch?.pkg) return;
    tapi('POST', `/api/work/${w.id}/doc/sync`, { lazy: true, said: String(said || '').slice(0, 200) }).then((r) => { if (r.work) putWork(r.work); }).catch(() => {}); };
  const syncBriefNow = () => { const w = workOfCard(RX.p?.id); if (!w || !RX.ch?.pkg || RX.briefSync) return; RX.briefSync = true;
    tapi('POST', `/api/work/${w.id}/doc/sync`, { now: true }).then((r) => { RX.briefSync = false; if (r.work) putWork(r.work); if (view === 'remix' && RX.tab === 'details' && !RX.briefEdit) paintStudio(); }).catch(() => { RX.briefSync = false; }); };
  /* the jam's own controls in the studio's header: Assign / Ask for OK (jam-room.js), who's in it and who's here now */
  const studioJamCtl = () => { const w = RX.p ? workOfCard(RX.p.id) : null, JR = window.JamRoom; if (!w || !JR?.assignHtml || window.BREW_DEMO) return '<span class="st-jamctl"></span>';
    return `<span class="st-jamctl" data-st-jam>${JR.crewHtml ? JR.crewHtml(w) : JR.assignHtml(w) + (JR.peopleHtml?.(w) || '')}</span>`; };
  /* the studio's jam moved (jamPoll): a teammate's message or version, an assign, a status. The jam is put in place, the change is
     read again (its versions and chat are the team's), and the studio repaints; presence alone only redraws the header strip */
  const studioJamTick = async (r, changedHere) => {
    if (r.work) { putWork(r.work); counts(); const ch = RX.ch;
      if (ch && !RX.sending) { const q = await tapi('GET', `/api/changes/${ch.id}`).catch(() => null); if (q?.change && RX.ch?.id === ch.id && !RX.sending) { RX.ch = q.change; putCh(q.change); } }
      if (view === 'remix') paintStudio(); return; }
    if (changedHere) { const el = $('.st-jamctl'); if (el) el.outerHTML = studioJamCtl(); const ty = $('.st-panel-b .jm-typing-who'), w = workOfCard(RX.p?.id); if (w && window.JamRoom?.typingHtml) { const h = window.JamRoom.typingHtml(w); if (ty) ty.outerHTML = h || ''; else if (h) $('.st-panel-b .it-log')?.insertAdjacentHTML('beforeend', h); } }
  };
  /* screenshots and images in the studio chat: paste (⌘V), drop on the panel, or + → A screenshot. Shrunk here (1600px JPEG),
     shown as chips above the box, and sent with the next message: the AI sees them (remix.js takeAtts) */
  const stAttHtml = () => (RX.att || []).length ? `<div class="st-atts">${RX.att.map((u, i) => `<span class="st-att"><img src="${esc(u)}" alt="Screenshot ${i + 1}"><button type="button" data-st-attrm="${i}" aria-label="Remove image">${ic('x', 's14')}</button></span>`).join('')}<small>${RX.att.length === 1 ? 'Goes with your next message' : `${RX.att.length} images go with your next message`}</small></div>` : '';
  const shrinkImg = (f) => new Promise((res) => { const fr = new FileReader(); fr.onerror = () => res(null); fr.onload = () => { const im = new Image(); im.onerror = () => res(null); im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.width, im.height)), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/jpeg', 0.85)); }; im.src = fr.result; }; fr.readAsDataURL(f); });
  const stAttach = async (files) => { const imgs = [...(files || [])].filter((f) => /^image\//.test(f.type)); if (!imgs.length || view !== 'remix' || !RX.ch) return false;
    RX.att ||= []; if (RX.att.length >= 4) { toast('Up to 4 images a message.'); return true; }
    for (const f of imgs.slice(0, 4 - RX.att.length)) { const u = await shrinkImg(f); if (u) RX.att.push(u); }
    paintStudio(); $('#st-in')?.focus(); return true; };
  window.__stAttach = stAttach; /* the composer's + → A screenshot */
  document.addEventListener('paste', (e) => { if (view !== 'remix' || !RX.ch || !e.target.closest?.('#st-say')) return; const fs = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type)); if (!fs.length) return; e.preventDefault(); stAttach(fs); });
  document.addEventListener('dragover', (e) => { if (view === 'remix' && RX.ch && e.target.closest?.('.st-panel') && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.target.closest('.st-panel').classList.add('is-drop'); } });
  document.addEventListener('dragleave', (e) => { if (e.target.closest?.('.st-panel') && !e.relatedTarget?.closest?.('.st-panel')) $('.st-panel.is-drop')?.classList.remove('is-drop'); });
  document.addEventListener('drop', (e) => { const pn = e.target.closest?.('.st-panel'); if (!pn || view !== 'remix' || !RX.ch) return; pn.classList.remove('is-drop'); const fs = [...(e.dataTransfer?.files || [])]; if (!fs.some((f) => /^image\//.test(f.type))) return; e.preventDefault(); stAttach(fs); });
  const stSay = async (msg, path = 'iterate', body) => {
    const ch = RX.ch; if (!ch || RX.sending) return;
    /* a message that tags someone anywhere in it goes to them and the jam (sendTo: they get an email); the AI hears it only
       when it also asks for a change ("Make the headline shorter @Ana"), and then only that part */
    if (path === 'iterate' && RX.p && (window.JamRoom?.hasTag ? window.JamRoom.hasTag(String(msg || '').trim()) : window.JamRoom?.mentionOf?.(String(msg || '').trim()))) {
      const said = String(msg).trim(); RX.draft = ''; if ($('#st-in')) $('#st-in').value = '';
      await window.JamRoom.sendTo(RX.p, said); paintStudio();
      const ask = window.JamRoom.changeAsk?.(said); if (!ask) return; msg = ask; body = undefined; }
    const att = path === 'iterate' && !body ? (RX.att || []).slice() : []; if (att.length) { RX.att = []; body = { message: msg, images: att }; }
    RX.from = path === 'iterate' ? String(msg || '') : null; /* the chip or box that asked: it spins while RX.sending */
    RX.sending = path === 'variants' || path === 'more' ? 'Writing a new take…' : path === 'plan' ? planBusy(ch) : path === 'knob' ? `Applying ${msg}…` : body?.fix ? 'Fixing it…' : 'Working on it…';
    if (path === 'iterate') { ch.thread = [...(ch.thread || []), { from: 'you', text: msg || 'Look at the screenshot', imgs: att, at: 9e15 /* last in the timeline until the server's copy lands */ }]; RX.draft = ''; if ($('#st-in')) $('#st-in').value = ''; RX.tab = 'iterate'; }
    RX.viewing = null; RX.resetScroll = true; paintStudio(); if (path === 'iterate') sound('send');
    const r = await tapi('POST', `/api/changes/${ch.id}/${path}`, body || { message: msg });
    if (r.brief && TBS.for === tbWork()?.id) { TBS.brief = r.brief; TBS.pdf = null; tbWarm(); tbLit(r.changed); if (RX.stage !== 'brief') toast(`${ic('check', 's16')}Brief changed. <button class="linkbtn" data-tb-open>See it</button>`); }
    RX.sending = false; if (r.error) { if (att.length && !RX.att?.length) RX.att = att; /* a failed send keeps its screenshots */ sound('error'); toast(esc(r.error)); return paintStudio(); }
    if (path === 'iterate') sound('reply'); else if (['variants', 'more', 'plan'].includes(path)) sound('ready'); /* the answer, or the new take or plan, is in; a knob stays quiet */
    RX.ch = r.change; putCh(r.change); RX.resetScroll = true; if (Array.isArray(body?.v) || path === 'variants' || path === 'plan') RX.tab = 'iterate'; if (path === 'plan') pullWork(true); paintStudio(); showLearned(r.learned); if (!r.answered) syncBrief(r.change, msg); /* a question changed nothing: no brief rewrite */ if (r.pickPhotos) openPhotos();
  };
  /* a post for X, LinkedIn, Reddit, Quora, a Facebook group or Pinterest: Brew copies it and opens the exact place; you post it.
     Nothing is posted into a community on anyone's behalf */
  const rxAct = async (act, ch, btn) => {
    const id = ch.id;
    if (act === 'open') { const w = WORK.items.find((x) => x.id === ch.workId) || (await tapi('GET', '/api/tenants/:t/work')).items?.find((x) => x.id === ch.workId); if (w) { putWork(w); openDetail({ ...RX.p, _work: w }, { jam: true }); } else openDetail(RX.p, { jam: true }); /* a jam this viewer doesn't hold yet: the normal path joins it, never a dead tap (QA UI) */ return; }
    if (act === 'variants') return stSay('', 'variants', {});
    if (act === 'plan') return stSay('', 'plan', {}); /* the card's action, pressed in the jam: the plan's make step */
    if (act === 'mychecks') { RX.tab = 'details'; RX.editing = false; paintStudio(); $('.dt-mine')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (act === 'fix') {
      const m = `Fix before it ships: ${(ch.fixes || []).join('; ')}`; RX.fixing = true; RX.tab = 'iterate';
      await stSay(m, 'iterate', { message: `${m}. Keep it about the same product and the same kind of change. Change nothing else.`, fix: true, show: m }); RX.fixing = false;
      const after = RX.ch; if (after && after.verdict !== 'fix') toast(`${ic('check', 's16')}Fixed. ${esc((RXROUTE[after.verdict] || RXROUTE.jam).tag)}: v${curN(after)}`); else toast('Some of it still needs you. Edit it, try again, or jam with your team.');
      return paintStudio();
    }
    if (act === 'video') { const r = await tapi('POST', `/api/changes/${id}/video`, {}); if (r.change) { RX.ch = r.change; putCh(r.change); } if (!r.video) { sound('error'); toast(esc(r.error || 'No video right now')); } else if (!jobOf(r.change || {})) sound('ready'); return paintStudio(); }
    if (act === 'images-all') { const r = await tapi('POST', `/api/changes/${id}/image`, { all: true }); if (r.change) { RX.ch = r.change; putCh(r.change); } if (!r.image) { sound('error'); toast(esc(r.why || 'No images right now')); } else if (!jobOf(r.change || {})) sound('ready'); return paintStudio(); }
    if (act === 'listing-photos') { const r = await tapi('POST', `/api/changes/${id}/listing-photos`, {}); if (r.change) { RX.ch = r.change; putCh(r.change); } if (!r.image) toast(esc(r.why || 'No photos right now')); return paintStudio(); }
    if (act === 'image') { const r = await tapi('POST', `/api/changes/${id}/image`, {}); if (r.change) { RX.ch = r.change; putCh(r.change); } if (!r.image) { sound('error'); toast(esc(r.why || 'No image right now')); } else if (!jobOf(r.change || {})) sound('ready'); /* still making: the job poll plays it when it lands */ return paintStudio(); }
    if (act === 'copy-post') { const p = ch.pkg || {}; const txt = [p.title, p.copy, (p.hashtags || []).join(' ')].filter(Boolean).join('\n\n'); if (!txt) return toast('Nothing to copy yet.'); return copyText(txt).then((ok) => (ok !== false ? toast(`${ic('check', 's16')}Post copied. Paste it where it goes.`) : toastLong(esc(txt).replace(/\n/g, '<br>'), 10000))); }
    if (act === 'post-open') { const po = postOpenOf(ch); if (!po) return toast('Nothing to post yet.'); const copied = copyText(po.text); const win = window.open(po.url, '_blank', 'noopener');
      const ok = await copied; if (!win) return toast(`${ic('info', 's16')}${ok ? 'Copied. ' : ''}Your browser blocked the new tab. <a href="${esc(po.url)}" target="_blank" rel="noopener">Open it here</a>.`);
      return toast(ok ? `${ic('check', 's16')}${esc(window.PostOpen.said(po))}` : `${ic('info', 's16')}The new tab is open, but copying didn’t work. Copy the post from the stage.`); }
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    /* the jam's one exit: Share the brief (share.js). share-shopos / share-team copy it straight away; share asks which */
    if (/^share/.test(act)) { if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); } window.__shareDone = () => { pullWork(true); if (view === 'remix' && RX.ch?.id === id) paintStudio(); }; const to = act === 'share-shopos' ? 'shopos' : act === 'share-team' ? 'team' : null; const lbl = to === 'shopos' ? 'Sending…' : 'Copying…', done0 = to ? busyBtn(btn, lbl) : () => {}; if (to) RX.busyRx = { act, lbl }; const done = () => { done0(); if (!to) return; RX.busyRx = null; if (btn && !btn.isConnected && view === 'remix') paintStudio(); }; /* Send brief spins until the email is out */ return Promise.resolve(window.Share.open(RX.p, to)).finally(done); }
    if (act === 'jam') { const r = await tapi('POST', `/api/changes/${id}/jam`, ch._scope ? { scope: ch._scope } : {}); if (r.error) return toast(esc(r.error)); putCh(r.change); putWork(r.work); paintRemix(); showLearned(r.learned); openDetail({ ...RX.p, _work: r.work }, { jam: true }); toast(`${ic('hand', 's16')}Jam opened: ${r.work.plan?.questions.filter((q) => !q.answer).length || 0} questions to answer, then it ships.`); return; }
  };
  document.addEventListener('click', async (e) => {
    const rf = e.target.closest('[data-refs]'); if (rf) { e.stopPropagation(); return openRefs(REF_OF[rf.dataset.refs]); }
    const so = e.target.closest('[data-st-open]'); if (so) { e.stopPropagation(); const p = byId(so.dataset.stOpen); if (p) openDetail(p); return; }
    const lc = e.target.closest('[data-livech]'); if (lc) { e.stopPropagation(); const p = byId(lc.dataset.card); const ch = p?.liveChange?.changeId; if (p) openRemix(p, ch); return; }
    if (view !== 'remix') return;
    if (e.target.closest('[data-vmenu]')) { RX.vmenu = !RX.vmenu; return paintStudio(); }
    { const k = e.target.closest('[data-j2-pack],[data-j2-impact],[data-j2-remake]'); if (k && RX.ch) return j2Run(k.hasAttribute('data-j2-pack') ? 'pack' : k.hasAttribute('data-j2-impact') ? 'impact' : 'remake', RX.ch, k.dataset.j2Remake); }
    const nm = e.target.closest('[data-nav-move]'); if (nm) { closeModal(); location.hash = `#v=move&m=${nm.dataset.navMove}`; return; }
    if (e.target.closest('[data-ph-open]')) return openPhotos();
    { const dl = e.target.closest('[data-st-dl]'); if (dl && RX.ch) { const ch = RX.ch, v = RX.viewing && RX.viewing !== ch.head ? ch.versions.find((x) => x.id === RX.viewing) : null; return downloadVersion(ch, asPkg(ch, v), dl); } }
    if (RX.vmenu && !e.target.closest('.st-vmenu')) { RX.vmenu = false; paintStudio(); if (!e.target.closest('[data-tab],[data-rx],[data-st-back]')) return; }
    if (e.target.closest('[data-rx-back]')) return leaveRemix();
    if (e.target.closest('[data-st-back]')) return !RX.batch ? leaveRemix() : history.state?.a === 'rx-ch' ? history.back() : backToOptions();
    const os = e.target.closest('[data-open-studio]'); if (os) return openStudio(os.dataset.openStudio);
    const it = e.target.closest('[data-intent]'); if (it) { RX.intent = RX.intent === it.dataset.intent ? '' : it.dataset.intent; if (RX.intent) runRemix(); else paintStart(); return; }
    const tb = e.target.closest('[data-tab]'); if (tb) { RX.tab = tb.dataset.tab; RX.editing = false; RX.resetScroll = true; if (RX.tab === 'details') syncBriefNow(); /* the Brief opened: it catches up with the version on the stage */ return paintStudio(); }
    const sc = e.target.closest('[data-scope]'); if (sc) { RX.scope[RX.ch.id] = +sc.dataset.scope; return paintStudio(); }
    const vv = e.target.closest('[data-v-view]'); if (vv) {
      const id = vv.dataset.vView, ch = RX.ch; RX.vmenu = false; if (id === ch.head) { RX.viewing = null; return paintStudio(); }
      // live or in a jam: you can only look. Otherwise switching is the same as using it (nothing is lost).
      if (ch.state === 'jam') { RX.viewing = id; return paintStudio(); }
      const r = await tapi('POST', `/api/changes/${ch.id}/restore`, { versionId: id }); if (r.error) return toast(esc(r.error));
      RX.ch = r.change; putCh(r.change); RX.viewing = null; return paintStudio(); }
    if (e.target.closest('[data-v-back]')) { RX.viewing = null; return paintStudio(); }
    /* options: a tab shows that option on the stage, Use picks it (the others fold away), Change opens the choice again */
    const ob = e.target.closest('[data-opt],[data-opt-use],[data-opt-change]'); if (ob && RX.ch) { if (ob.classList.contains('is-on') && ob.dataset.opt) return;
      const body = ob.dataset.optChange != null ? { opt: null } : ob.dataset.optUse ? { opt: ob.dataset.optUse } : { opt: ob.dataset.opt, use: false };
      const done = busyBtn(ob, ob.textContent.trim().length < 18 ? ob.textContent.trim() : ''); const r = await tapi('POST', `/api/changes/${RX.ch.id}/options/pick`, body).catch((er) => ({ error: er.message })); done();
      if (r?.error) return toast(`${ic('info', 's16')}${esc(r.error)}`); RX.ch = r.change; putCh(r.change); RX.viewing = null; paintStudio();
      if (body.opt && body.use !== false) toast(`${ic('check', 's16')}Using ${esc(optOn(r.change)?.name || 'it')}. Your next change builds on it.`); return; }
    if (e.target.closest('[data-chips-more]') && RX.ch) { RX.moreChips = RX.ch.id; paintStudio(); return; } /* the rest of the chips, once asked for */
    const om = e.target.closest('[data-opt-more]'); if (om && RX.ch) { om.disabled = true; om.querySelector('b').textContent = 'Writing…'; const r = await tapi('POST', `/api/changes/${RX.ch.id}/more`, {}).catch((er) => ({ error: er.message }));
      if (r?.error) { toast(`${ic('info', 's16')}${esc(r.error)}`); return paintStudio(); } RX.ch = r.change; putCh(r.change); RX.viewing = null; return paintStudio(); }
    const f1 = e.target.closest('[data-fn-one]'); if (f1) return fnOne(f1);
    const vu = e.target.closest('[data-v-use]'); if (vu) { const r = await tapi('POST', `/api/changes/${RX.ch.id}/restore`, { versionId: vu.dataset.vUse }); if (r.error) return toast(esc(r.error)); RX.ch = r.change; putCh(r.change); RX.viewing = null; paintStudio(); toast(`${ic('check', 's16')}Now on v${curN(r.change)}. Your next change builds from here.`); return; }
    const cb = e.target.closest('[data-cmp]'); if (cb) { const v = cb.dataset.cmp; RX.cmp = RX.cmp.includes(v) ? RX.cmp.filter((x) => x !== v) : [...RX.cmp, v].slice(-2); return paintStudio(); }
    if (e.target.closest('[data-cmp-clear]')) { RX.cmp = []; return paintStudio(); }
    if (e.target.closest('[data-spec-edit]')) { RX.editing = true; return paintStudio(); }
    const mc = e.target.closest('[data-mc]'); if (mc) { const done = mc.getAttribute('aria-pressed') !== 'true'; const r = await tapi('POST', `/api/changes/${RX.ch.id}/checks`, { id: mc.dataset.mc, done }); if (r.change) { RX.ch = r.change; putCh(r.change); paintStudio(); if (done && r.change.verdict !== 'confirm' && !(r.change.confirm || []).length) toast(`${ic('check', 's16')}All your checks are ticked`); } return; }
    const mr = e.target.closest('[data-mc-rm]'); if (mr) { const r = await tapi('POST', `/api/changes/${RX.ch.id}/checks`, { id: mr.dataset.mcRm, remove: true }); if (r.change) { RX.ch = r.change; putCh(r.change); paintStudio(); } return; }
    const nr = e.target.closest('[data-nt-rm]'); if (nr) { const r = await tapi('POST', `/api/changes/${RX.ch.id}/notes`, { id: nr.dataset.ntRm, remove: true }); if (r.change) { RX.ch = r.change; putCh(r.change); paintStudio(); } return; }
    if (e.target.closest('[data-spec-cancel]')) { RX.editing = false; document.activeElement?.blur?.(); return paintStudio(); }
    const kp = e.target.closest('[data-knob-apply]'); if (kp) { const k = kp.dataset.knobApply, vals = (RX.knobSel || {})[k] || []; RX.knobSel[k] = []; const label = (RX.ch.knobs || []).find((x) => x.k === k)?.label || k; return stSay(`${label}: ${vals.join(' + ')}`, 'knob', { k, v: vals.length > 1 ? vals : vals[0] }); }
    const kc = e.target.closest('[data-knob-clear]'); if (kc) { RX.knobSel[kc.dataset.knobClear] = []; return paintStudio(); }
    const km = e.target.closest('[data-knob][data-multi="1"]'); if (km) { RX.knobSel ||= {}; const k = km.dataset.knob, v = km.dataset.v, cur = RX.knobSel[k] || []; RX.knobSel[k] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]; return paintStudio(); }
    const kn = e.target.closest('[data-knob]'); if (kn) return stSay(`${kn.closest('.kn').querySelector('span').textContent.replace(' new photo', '')}: ${kn.dataset.v}`, 'knob', { k: kn.dataset.knob, v: kn.dataset.v });
    const sy = e.target.closest('[data-say]'); if (sy) return stSay(sy.dataset.say);
    const ar = e.target.closest('[data-addrow]'); if (ar) { const box = $(`[data-rows="${ar.dataset.addrow}"]`); const rows = $$('.fe-row', box); const tpl = rows[rows.length - 1].cloneNode(true); $$('input,textarea', tpl).forEach((x) => (x.value = '')); rows[rows.length - 1].after(tpl); return; }
    const dr = e.target.closest('[data-delrow]'); if (dr) { const box = dr.closest('.fe-rows'); if ($$('.fe-row', box).length > 1) dr.closest('.fe-row').remove(); return; }
    if (e.target.closest('[data-st-convo]')) { const w = workOfCard(RX.p?.id), p0 = RX.p; RX.ch = null; nav(location.pathname, false, 'view'); view = 'feed'; await renderFeed(); return openDetail({ ...p0, ...(w ? { _work: w } : {}) }, { noStudio: true }); }
    const atr = e.target.closest('[data-st-attrm]'); if (atr) { RX.att = (RX.att || []).filter((_, i) => i !== +atr.dataset.stAttrm); return paintStudio(); }
    const cmr = e.target.closest('[data-bf-cmrm]'); if (cmr) { const w = workOfCard(RX.p?.id); if (!w) return; const r = await tapi('POST', `/api/work/${w.id}/doc/comment`, { id: cmr.dataset.bfCmrm, remove: true }); if (r.work) putWork(r.work); return paintStudio(); }
    if (e.target.closest('[data-bf-fix]')) return bfFix(workOfCard(RX.p?.id));
    if (e.target.closest('[data-st-briefedit]')) { RX.briefEdit = true; return paintStudio(); }
    if (e.target.closest('[data-st-briefcancel]')) { RX.briefEdit = false; return paintStudio(); }
    if (e.target.closest('[data-st-briefsave]')) { const w = workOfCard(RX.p?.id), md = $('#bf-ed')?.value || ''; if (!w) return; const r = await tapi('POST', `/api/work/${w.id}/doc`, { md, rev: w.doc?.rev });
      if (r.stale) toast('Someone else edited the brief. Showing the latest.'); if (r.work) putWork(r.work); RX.briefEdit = false; toast(`${ic('check', 's16')}Brief saved`); return paintStudio(); }
    const sf = e.target.closest('[data-st-fill]'); if (sf) { RX.tab = 'iterate'; RX.draft = `${sf.dataset.stFill}: `; paintStudio(); $('#st-in')?.focus(); return; }
    if (e.target.closest('[data-st-link]')) { if (RX.p) copyJamLink(RX.p); return; }
    if (e.target.closest('[data-st-brief]')) { const w = workOfCard(RX.p?.id); if (!w) return; const r = await tapi('GET', `/api/work/${w.id}/handoff?base=${encodeURIComponent(location.origin)}`); const u = r.handoff?.links?.page; if (u) window.open(u, '_blank', 'noopener'); else toast('The brief isn’t ready yet.'); return; }
    const sp = e.target.closest('[data-st-pick]'); if (sp && RX.ch) { const ch = RX.ch; ch.pick = sp.dataset.stPick; paintStudio(); tapi('POST', `/api/changes/${ch.id}/pick`, { pick: ch.pick }).then((r) => { if (r.change && RX.ch?.id === ch.id) { RX.ch = r.change; paintStudio(); } }); return; }
    /* the reel on the stage: the speaker turns the sound on and off, a tap on the picture pauses and plays */
    const snd = e.target.closest('[data-sv-sound]'); if (snd) { const v = snd.parentElement.querySelector('video'); if (v) { v.muted = !v.muted; if (!v.muted) v.play().catch(() => {}); snd.innerHTML = ic(v.muted ? 'volOff' : 'volOn', 's16'); snd.setAttribute('aria-label', v.muted ? 'Turn the sound on' : 'Turn the sound off'); } return; }
    const pv = e.target.closest('[data-sv-play]'); if (pv) { if (pv.paused) pv.play().catch(() => {}); else pv.pause(); pv.closest('.sv-media')?.classList.toggle('is-paused', pv.paused); return; }
    const a = e.target.closest('[data-rx]'); if (a && RX.ch) rxAct(a.dataset.rx, RX.ch, a);
  });
  // a picture that fails to load is never a broken box showing its alt text (onAssetError, public/asset-fallback.js):
  // our own file is asked for once more (one another instance is still copying to the bucket), then the card's fallback
  // (data-fb: the real product photo), then, for a generated creative, the empty state below; anywhere else a quiet surface
  document.addEventListener('error', (e) => {
    const im = e.target; if (!im || (im.tagName !== 'IMG' && im.tagName !== 'VIDEO')) return;
    if (im.tagName === 'IMG' && im.closest('.lr-th')) { im.remove(); return; }
    const step = window.BrewAsset ? window.BrewAsset.onError(im, { later: (f) => setTimeout(f, 1500) }) : 'dead'; if (step !== 'dead') return;
    if (im.tagName === 'VIDEO' || !/^\/?gen\//.test(im.dataset.src0 || im.getAttribute('src') || '')) { if (window.BrewAsset) window.BrewAsset.quiet(im); else { im.alt = ''; im.style.visibility = 'hidden'; } return; }
    const box = im.closest('.am-media');
    if (!box) { // anywhere else (feed card, card page, carousel): a quiet placeholder with a small way to make it again
      const src = im.dataset.src0 || im.getAttribute('src'), cid = im.closest('.card[data-id]')?.dataset.id || (im.closest('#dp') && DP?.p && !/^(work:|jam-)/.test(String(DP.p.id)) ? DP.p.id : null);
      const ph = document.createElement('div'); ph.className = 'img-dead'; ph.dataset.src = src;
      ph.innerHTML = cid ? `<button class="img-redo" data-img-redo="${esc(cid)}" title="This image was lost. Make it again.">${ic('refresh', 's14')}<span>Make image</span></button>` : '';
      im.replaceWith(ph); return; }
    box.classList.add('noimg'); box.querySelector('.am-ov')?.remove(); im.remove();
    box.insertAdjacentHTML('beforeend', box.closest('.st-asset') ? `<div class="am-make"><span>This photo needs making again</span><button class="btn btn-primary sm" data-rx="image">${ic('sparkles', 's14')}Make the photo</button></div>` : `<div class="am-empty">${ic('sparkles', 's16')}<span>The photo is made in the studio</span></div>`);
  }, true);
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-img-redo]'); if (!b) return; e.stopPropagation(); e.preventDefault();
    const ph = b.closest('.img-dead'), cid = b.dataset.imgRedo; if (b.disabled) return;
    b.disabled = true; b.innerHTML = `<brew-load class="spin"></brew-load><span>Making…</span>`;
    const r = await tapi('POST', `/api/cards/${encodeURIComponent(cid)}/image`, { src: ph?.dataset.src });
    if (r.error || !r.url) { b.disabled = false; b.innerHTML = `${ic('refresh', 's14')}<span>Try again</span>`; sound('error'); return toast(esc(r.error || 'That didn’t work. Try again.')); }
    sound('ready'); if (r.card) { ALL[cid] = r.card; const i = FEED.findIndex((x) => x.id === cid); if (i >= 0) FEED[i] = r.card; if (DP?.p?.id === cid) DP.p = r.card; }
    $$(`.img-dead[data-src="${CSS.escape(ph.dataset.src)}"]`).forEach((x) => { const im = document.createElement('img'); im.src = r.url; im.alt = ''; x.replaceWith(im); });
    pullWork(true);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (view !== 'remix') return;
    if (e.key === 'Escape' && RX.viewing) { RX.viewing = null; paintStudio(); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'st-in') { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'rx-ask') { e.preventDefault(); runRemix(); }
    if (e.target.id === 'mc-add') { e.preventDefault(); const f = e.target, text = f.t.value.trim(); if (!text) return; const r = await tapi('POST', `/api/changes/${RX.ch.id}/checks`, { text, always: f.always.checked }); if (r.change) { RX.ch = r.change; putCh(r.change); paintStudio(); showLearned(r.learned); } return; }
    if (e.target.id === 'nt-add') { e.preventDefault(); const text = e.target.t.value.trim(); if (!text) return; const r = await tapi('POST', `/api/changes/${RX.ch.id}/notes`, { text }); if (r.change) { RX.ch = r.change; putCh(r.change); paintStudio(); toast(`${ic('check', 's16')}Note saved`); } return; }
    if (e.target.id === 'st-say') { e.preventDefault(); const v = $('#st-in').value.trim(); if (!v && !RX.att?.length) return; stSay(v); }
    if (e.target.id === 'st-spec') { e.preventDefault(); const ch = RX.ch; const pkg = readSpec(e.target, ch); document.activeElement?.blur?.(); const r = await tapi('POST', `/api/changes/${ch.id}/edit`, { pkg }); if (r.error) return toast(esc(r.error)); RX.ch = r.change; putCh(r.change); RX.editing = false; paintStudio(); toast(`${ic('check', 's16')}Saved as v${curN(r.change)}`); showLearned(r.learned); }
  });

  /* ---------- The moves: every plan Brew wrote for the brand, as it is written, with the PDFs ---------- */
  /* one plain sentence under each group of moves (QA UI 20 Oct) */
  const MV_SUB = { know: 'Who you are, who buys and who you’re up against.', found: 'Showing up when people search and ask AI.', reach: 'Ads, social and creators that bring new people in.', convert: 'Pages and listings that turn a visit into an order.', keep: 'Messages that bring buyers back.', expand: 'New channels, partners and how the work runs.' };
  const MV_GROUPS = [['know', 'Know the brand', 1, 10], ['found', 'Be found', 11, 19], ['reach', 'Reach people', 20, 28], ['convert', 'Convert the visit', 29, 38], ['keep', 'Keep the customer', 39, 44], ['expand', 'Expand and operate', 45, 50]];
  const MV = { t: null, open: null };
  const mvSlug = () => B.slug || BR;
  const pdfUrl = (f, dl) => `/b/${mvSlug()}/pdf/${encodeURIComponent(f)}${dl ? '?dl=1' : ''}`;
  const MVT = { tab: 'moves' };
  const renderMoves = async () => {
    const stop = view !== 'moves' ? holdView('Opening your moves') : () => {}; view = 'moves'; counts(); $('#stk').innerHTML = ''; $('#notes').innerHTML = ''; /* header title and rail match the section on a direct link too */ clearTimeout(MV.t); const slug = mvSlug();
    const [r, bd, up, hs] = await Promise.all([api(`/api/brands/${slug}/moves`), GEN ? api(`/api/brands/${slug}/build`) : null, GEN ? api(`/api/brands/${slug}/updates`) : null, null /* the weekly history route is not in Brew yet (feed/ work never ported): no 404 on every visit (QA UI) */]); stop(); if (view !== 'moves') return;
    const U = up && !up.error ? up : null, nStale = U?.stale?.length || 0;
    const ms = r?.moves || [], by = Object.fromEntries(ms.map((m) => [m.n, m])), pdfs = r?.pdfs || {}, st = r?.status || {}, b = bd && !bd.error ? bd : null;
    const done = ms.filter((m) => m.n >= 1 && m.n < 1000 && !m.cadence).length, extra = ms.length - done, building = !!b && !st.done; // the playbook (status.total): not the index, not weekly moves (1001+)
    const live = new Map((b?.inflight || []).map((x) => [x.n, x])), failed = new Map((b?.failed || []).map((x) => [x.n, x]));
    const kick = (m) => String(m?.kicker || '').replace(/\s*·\s*(?:weekly\s+|timely\s+)?move\s+\d+.*$/i, ''); /* the number shows once, on the left; a timely move's hidden number never shows (QA 20 Oct) */
    const card = (m) => `<article class="mv2-c" data-mv="${m.n}" tabindex="0"><div class="mv2-k"><span>${mvNum(m.n)}</span>${kick(m) ? `<i>${esc(kick(m).toLowerCase())}</i>` : ''}</div>
      <h4>${esc(m.title)}</h4>${m.past ? `<p class="mv2-st is-past"><b>Ended</b> ${esc(m.past.name)} finished ${esc(fmtDay(Date.parse(m.past.end)) || m.past.end)}</p>` /* a festival plan after its festival (festival-past.js) */ : m.stat ? `<p class="mv2-st"><b>${esc(m.stat)}</b> ${esc(String(m.statLabel || '').toLowerCase())}</p>` : m.gives ? `<p>${esc(m.gives)}</p>` : ''}
      ${m.n != null ? `<a class="mv2-pdf" href="${pdfUrl(`move-${m.n}.pdf`)}" target="_blank" rel="noopener" title="Open the PDF" aria-label="Open the PDF" data-stop>${ic('doc', 's14')}</a>` : ''}</article>`;
    const pend = (n) => { const x = live.get(n), f = failed.get(n);
      return `<li class="${x ? 'is-run' : f ? 'is-fail' : ''}"><span class="mv2-n">${mvNum(n)}</span><b>${esc(x?.title || f?.title || (b?.queue || []).find((q) => q.n === n)?.title || '')}</b><em>${x ? `<brew-load class="spin"></brew-load>Writing · ${mins(x.secs)}` : f ? 'Stopped · retries soon' : building ? 'Queued' : 'Not written'}</em></li>`; };
    const groupsHtml = MV_GROUPS.map(([k, name, a, z]) => { const ns = [...Array.from({ length: z - a + 1 }, (_, i) => a + i), ...ms.filter((m) => m.n > 50 && m.n < 1000 && m.group === k).map((m) => m.n)], w = ns.filter((n) => by[n]), p = ns.filter((n) => !by[n]); /* listening-era (51-65) and dynamic (100+) moves sit in their own group */
      return `<section class="mv2-sec" id="mvg-${k}"><header><h3>${esc(name)}</h3>${p.length ? `<span>${w.length} of ${ns.length}</span>` : ''}</header>
        ${MV_SUB[k] ? `<p class="mv2-gsub">${MV_SUB[k]}</p>` : ''}${w.length ? `<div class="mv2-grid${w.length > 6 ? ' mv2-cap' : ''}">${w.map((n) => card(by[n])).join('')}</div>${w.length > 6 ? `<button class="linkbtn mv2-all" data-mvall>Show all ${w.length}</button>` : ''}` : ''}${(() => { const hot = p.filter((n) => live.has(n) || failed.has(n)), rest = p.filter((n) => !live.has(n) && !failed.has(n)), names = rest.map((n) => (b?.queue || []).find((q) => q.n === n)?.title).filter(Boolean);
          return `${hot.length ? `<ul class="mv2-pend">${hot.map(pend).join('')}</ul>` : ''}${rest.length ? `<p class="mv2-later">${rest.length} more ${building ? 'to write' : 'not written yet'}${names.length ? `: ${esc(names.slice(0, 4).join(', '))}${names.length > 4 ? '…' : ''}` : ''}</p>` : ''}`; })()}</section>`; }).join('');
    /* moves written on a cadence (1001+: audit, listening, automation), newest families on top */
    const fam = ms.filter((m) => m.n >= 1000 || (m.n > 50 && m.n < 1000 && !MV_GROUPS.some(([k]) => k === m.group))).sort((a, b) => b.n - a.n);
    const famHtml = fam.length ? `<section class="mv2-sec"><header><h3>This week</h3><span>${fam.length} new from the weekly audit and listening</span></header><div class="mv2-grid mv2-cap">${fam.map(card).join('')}</div>${fam.length > 6 ? `<button class="linkbtn mv2-all" data-mvall>Show all ${fam.length}</button>` : ''}</section>` : '';
    /* week by week (history.js): one line a week, move changes and the quality numbers there is enough data to call; hidden until there are two weeks */
    const wks = hs && !hs.error ? hs.weeks || [] : [], wkArrow = (m) => (m.dir === 'up' ? ' ↑' : m.dir === 'down' ? ' ↓' : '');
    const wkLine = (w) => { const mv = w.moves || {}, ch = [mv.new ? `${mv.new} new` : '', mv.rewritten ? `${mv.rewritten} rewritten` : '', mv.retired ? `${mv.retired} retired` : ''].filter(Boolean).join(' · ');
      const q = (w.summary?.metrics || []).filter((m) => !m.thin && m.den && m.now != null && (m.num > 0 || m.dir === 'down')).map((m) => `<span class="${m.better === true ? 'is-up' : m.better === false ? 'is-down' : ''}">${esc(m.label)} ${Math.round(m.now * 100)}%${wkArrow(m)}</span>`).join('');
      return `<li><time>${fmtDay(w.start)}</time><div><p>${ch || 'No move changes'}${ch ? ` <button class="linkbtn" data-wk="${esc(w.week)}">See changes</button>` : ''}</p><p class="wk-q">${q || `<em>${w.summary?.verdict === 'first' ? 'First week on record' : 'Too few cards seen to call it'}</em>`}</p><div class="wk-x" data-wkx="${esc(w.week)}" hidden></div></div></li>`; };
    const histHtml = wks.length > 1 ? `<details class="q-more mv2-wk"><summary>Week by week</summary><ul class="bd-log wk-log">${wks.map(wkLine).join('')}</ul></details>` : '';
    const stepper = (b) => { const s1 = b.stages, one = (state, t) => `<li class="is-${state}"><i>${state === 'done' ? ic('check', 's14') : state === 'run' ? '<brew-load class="spin"></brew-load>' : ''}</i><span>${t}</span></li>`;
      const d10 = b.core ?? Math.min(b.done, 10);
      return `<ol class="bd-steps">${one(s1.read === 'done' ? 'done' : 'run', 'Read the site')}${one(s1.confirm === 'done' ? 'done' : s1.read === 'done' ? 'run' : 'wait', 'You checked it')}${one(s1.brief === 'done' ? 'done' : s1.confirm === 'done' ? 'run' : 'wait', 'Brand brief')}
        ${one(d10 >= 10 ? 'done' : s1.brief === 'done' ? 'run' : 'wait', `First 10 · ${d10}/10`)}${one(b.done >= (+b.total || 50) ? 'done' : d10 >= 10 ? 'run' : 'wait', `All moves · ${b.done}/${+b.total || 50}`)}${one(b.done >= (+b.total || 50) ? 'done' : 'wait', 'PDFs on download')}${one(b.statics?.state === 'done' ? 'done' : b.statics?.state === 'running' ? 'run' : b.statics?.state === 'failed' ? 'fail' : 'wait', 'Static ads')}</ol>`; };
    const buildHtml = !b ? `<div class="bd-empty">${GEN ? 'Build details are not available yet.' : `${poss(B.brand.name)} moves were written by the Brew team by hand, so there is no live build to show.`}</div>` : `
      ${stepper(b)}
      <div class="q-stack">
        ${!b.inflight.length && !b.failed.length && !b.queue.length && b.done >= (+b.total || 50) ? `<section class="bd-card bd-fin"><h3>${ic('check', 's16')}All ${b.done} moves are written</h3><p>Each one opens as a PDF when you download it, and Updates rewrites the ones that go out of date.</p><div class="bd-fin-b"><button class="btn btn-ghost sm" data-mvt="moves">See the moves</button>${GEN ? '<button class="btn btn-ghost sm" data-mvt="updates">Updates</button>' : ''}</div></section>` : ''}
        ${b.inflight.length ? `<section class="bd-card"><h3>Writing now</h3>${b.inflight.map((x) => `<div class="bd-run"><brew-load class="spin"></brew-load><div><b>${mvLabel(x.n)} · ${esc(x.title)}</b><span>${mins(x.secs)} so far · usually 6 to 9</span></div></div>`).join('')}</section>` : ''}
        ${b.failed.length ? `<section class="bd-card is-fail"><h3>Stopped <small>they get another try</small><button class="btn btn-ghost sm" data-bgretry>Retry now</button></h3>${b.failed.map((x) => `<div class="bd-row"><b>${mvLabel(x.n)} · ${esc(x.title)}</b><span>${esc(x.msg)}</span></div>`).join('')}</section>` : ''}
        ${b.queue.length ? `<section class="bd-card"><h3>Up next</h3><ol class="bd-q">${b.queue.map((x) => `<li><span>${mvNum(x.n)}</span>${esc(x.title)}</li>`).join('')}</ol></section>` : ''}
        ${b.usd > 0 ? `<p class="q-note">Spent $${b.usd.toFixed(2)} of a $${b.cap} cap on writing, research and images for this brand.</p>` : ''}
        ${b.events.length ? `<details class="q-more"><summary>Activity</summary><ul class="bd-log">${b.events.map((e) => `<li class="is-${e.type}"><time>${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(e.text)}</span></li>`).join('')}</ul></details>` : ''}
      </div>`;
    const upHtml = !U ? `<div class="bd-empty">${GEN ? 'Updates open once the moves are written.' : `${poss(B.brand.name)} moves were written by hand, so Brew doesn’t refresh them.`}</div>` : (() => {
      const lc = U.lastCheck, chk = U.checking, rw = U.rewriting;
      const est = (n) => `about $${Math.max(1, Math.round(n * U.estMove))}`;
      const stale = U.stale.map((x) => `<label class="up-mv is-${x.priority}"><input type="checkbox" data-upn="${x.n}" ${x.priority === 'high' ? 'checked' : ''} ${U.canRewrite ? '' : 'disabled'}><div><div class="up-mvh"><span>${mvNum(x.n)}</span><button class="linkbtn" data-mv="${x.n}">${esc(x.title)}</button>${x.priority === 'high' ? '' : '<em>worth a look</em>'}</div>
        <p>${esc(x.why)}</p></div></label>`).join('');
      return `<div class="up q-stack">
        <section class="up-hero"><div class="up-hl"><h3>${chk ? 'Checking now…' : lc ? `Last checked ${fmtWhen(lc.at)}` : 'Not checked yet'}</h3>
          <p>${chk ? `<brew-load class="spin"></brew-load> Reading ${esc(B.brand.name)} again. About 3 minutes.` : lc ? esc(lc.summary || 'Nothing material changed.') : 'Brew re-reads the site, reviews, ads and rivals, then rewrites only the moves that quote what changed.'}</p>
          ${U.lastError && !chk ? `<p class="up-err">The last check stopped: ${esc(U.lastError.msg)}</p>` : ''}</div>
          <button class="btn btn-ghost" data-upcheck ${chk || !U.canRewrite ? 'disabled' : ''} title="${U.building ? 'Opens once the core moves are written' : 'About 3 min · about $1'}">${ic('refresh', 's16')}${chk ? 'Checking…' : 'Check now'}</button>
          <label class="up-auto"><input type="checkbox" data-upauto ${U.auto ? 'checked' : ''}><span class="up-sw"></span><span><b>Keep them current on their own</b><small>${U.auto ? `Weekly${U.next ? `, next ${fmtDay(U.next)}` : ''}, and the day your catalog changes, within a weekly budget.` : 'Off. Nothing is checked or rewritten unless you ask.'}</small></span></label></section>
        ${U.pot ? `<p class="q-note up-pot">This week: $${U.pot.spent.toFixed(2)} of $${U.pot.cap} spent on rewrites${U.pot.waiting ? ` · ${U.pot.waiting} move${U.pot.waiting === 1 ? ' waits' : 's wait'} for next week` : ''}.</p>` : ''}
        ${U.connect ? `<p class="q-note up-conn">${(() => { const c = U.connect, who = c.names.join(' and ') || 'Your account', are = c.names.length > 1 ? 'are' : 'is';
          return c.waiting ? `${esc(who)} ${are} connected. Brew rewrites your moves with your real numbers ${c.due && c.due > Date.now() ? `in about ${Math.max(1, Math.round((c.due - Date.now()) / 60e3))} min` : 'shortly'}, in case you connect more.`
            : c.later ? `${esc(who)} ${are} connected. ${c.written} of ${c.n} moves are rewritten with your real numbers; the rest carry on tomorrow.`
            : `${esc(who)} ${are} connected. Rewriting ${c.n ? `all ${c.n}` : 'your'} moves with your real numbers.`; })()}</p>` : ''}
        ${rw ? `<section class="bd-card"><h3>Rewriting now <small>${rw.length}</small></h3>${rw.map((x) => `<div class="bd-run">${x.done ? `<span class="up-done">${ic('check', 's14')}</span>` : '<brew-load class="spin"></brew-load>'}<div><b>${mvLabel(x.n)} · ${esc(x.title)}</b><span>${x.done ? 'Rewritten' : x.secs != null ? `${mins(x.secs)} so far` : 'Waiting its turn'}</span></div></div>`).join('')}</section>` : ''}
        ${nStale ? `<section class="up-out"><h3>Out of date <small>${nStale}</small></h3><div class="up-list">${stale}</div>
          <footer class="up-foot"><button class="btn btn-primary" data-uprw ${U.canRewrite ? '' : 'disabled'}>Rewrite the ticked moves</button><span data-upest>${est(U.stale.filter((x) => x.priority === 'high').length)}</span></footer></section>` : lc ? '<p class="q-note">Every move matches the latest read.</p>' : ''}
        ${lc && (lc.changes || []).length ? `<details class="q-more"><summary>What changed · ${lc.changes.length}</summary><ul class="up-ch">${lc.changes.slice(0, 24).map((c) => `<li class="is-${c.kind}"><i>${c.kind === 'new' ? 'New' : c.kind === 'removed' ? 'Gone' : 'Changed'}</i><span>${esc(c.label)}</span><b>${c.kind === 'changed' ? `${esc(c.was)} → ${esc(c.now)}` : esc(c.now || c.was || '')}</b></li>`).join('')}</ul>
          ${(lc.spotted || []).length ? `<p class="up-note">New rivals spotted, not added: ${lc.spotted.map((x) => esc(x.name || x.host)).join(', ')}.</p>` : ''}</details>` : ''}
        ${U.history.length ? `<details class="q-more"><summary>Rewritten before</summary><ul class="bd-log">${U.history.map((h) => `<li><time>${fmtDay(h.at)}</time><span>${h.auto ? 'On its own' : 'You asked'}: ${h.moves.map((x) => `${mvLabel(x.n)}`).join(', ')}${h.usd ? ` · $${h.usd.toFixed(2)}` : ''}</span></li>`).join('')}</ul></details>` : ''}
      </div>`; })();
    /* Build is a tab only while there is something to watch; once done it is one link away */
    const showBuild = building || !!b?.failed?.length || MVT.tab === 'build';
    if (MVT.tab === 'build' && !b && GEN) MVT.tab = 'moves';
    $('#view').innerHTML = `<div class="feedcol lib-col mv2">
      <header class="mv2-head"><button class="rd-back" data-nav="learned">${ic('right', 's16')}<span>What Brew learned</span></button><h2>The moves</h2><p>${(() => { const core = ms.filter((m) => m.n >= 1 && m.n < 1000).length, wk = fam.length; /* one count everywhere: the playbook (status.total), never the index (00) or weekly moves (1001+), which count apart */
          return building ? `${core} of ${+st.total || 50} moves written for ${esc(B.brand.name)} so far.` : `${+st.total || core} moves for ${esc(B.brand.name)}${wk ? `, plus ${wk} new this week` : ''}. Every card in your feed comes from one of them.`; })()}</p>
        <div class="mv2-meta">${by[0] ? '<button class="linkbtn" data-mv="0">Read the index</button>' : ''}<button class="linkbtn" data-nav="facts">Fact sheet</button>${!showBuild && b ? '<button class="linkbtn" data-mvt="build">Build log</button>' : ''}</div></header>
      <div class="mv2-seg" role="tablist"><button role="tab" data-mvt="moves" aria-selected="${MVT.tab === 'moves'}">Moves</button>${GEN ? `<button role="tab" data-mvt="updates" aria-selected="${MVT.tab === 'updates'}">Updates${nStale ? `<span class="cnt">${nStale}</span>` : U?.checking || U?.rewriting ? '<span class="dot"></span>' : ''}</button>` : ''}${showBuild ? `<button role="tab" data-mvt="build" aria-selected="${MVT.tab === 'build'}">Build${building ? '<span class="dot"></span>' : ''}</button>` : ''}</div>
      ${nStale && MVT.tab === 'moves' ? `<button class="up-banner" data-mvt="updates"><b>${nStale} move${nStale === 1 ? ' is' : 's are'} out of date</b><i>Review ${ic('right', 's14')}</i></button>` : ''}
      ${MVT.tab === 'moves' ? `<nav class="mv2-nav">${famHtml ? '<a href="#mvg-fam" data-mvjump="fam">This week</a>' : ''}${MV_GROUPS.map(([k, name, a, z]) => { const w = Array.from({ length: z - a + 1 }, (_, i) => a + i).filter((n) => by[n]).length; return `<a href="#mvg-${k}" data-mvjump="${k}">${esc(name)}${w < z - a + 1 ? `<em>${w}/${z - a + 1}</em>` : ''}</a>`; }).join('')}</nav>${famHtml ? `<div id="mvg-fam">${famHtml}</div>` : ''}${groupsHtml}${histHtml}` : MVT.tab === 'updates' ? upHtml : `<div class="bd">${buildHtml}</div>`}
    </div>`;
    $$('[data-mv]').forEach((x) => x.onclick = (e) => { if (e.target.closest('[data-stop]')) return; openMove(+x.dataset.mv); });
    $$('[data-mvt]').forEach((x) => x.onclick = () => { MVT.tab = x.dataset.mvt; renderMoves(); });
    $$('[data-wk]').forEach((x) => x.onclick = async () => { const box = $(`[data-wkx="${x.dataset.wk}"]`); if (!box) return; if (!box.hidden) { box.hidden = true; return; }
      const c = (await api(`/api/brands/${slug}/history/${encodeURIComponent(x.dataset.wk)}`))?.changes || {}, nn = mvNum;
      const eng = (q) => (q?.seen >= 10 && q?.seenBefore >= 10 && q.now != null && q.before != null ? ` Engaged ${Math.round(q.before * 100)}% → ${Math.round(q.now * 100)}%.` : '');
      box.innerHTML = `<ul class="wk-ch">${(c.rewritten || []).map((m) => `<li><span>${nn(m.n)}</span><div><b>${m.before?.title && m.before.title !== m.title ? `${esc(m.before.title)} → ` : ''}${esc(m.title)}</b><p>${esc(m.because || 'Rewritten')}${m.learnings?.length ? `, with learnings from ${esc(m.learnings.join(', '))}` : ''}.${eng(m.quality)}</p></div></li>`).join('')}
        ${(c.new || []).map((m) => `<li><span>${nn(m.n)}</span><div><b>${esc(m.title)}</b><p>New</p></div></li>`).join('')}${(c.retired || []).map((m) => `<li class="is-gone"><span>${nn(m.n)}</span><div><b>${esc(m.title)}</b><p>Retired</p></div></li>`).join('')}</ul>`;
      box.hidden = false; });
    $$('[data-mvall]').forEach((x) => x.addEventListener('click', (e) => { e.currentTarget.previousElementSibling.classList.remove('mv2-cap'); e.currentTarget.remove(); }));
    $$('[data-mvjump]').forEach((x) => x.onclick = (e) => { e.preventDefault(); $(`#mvg-${x.dataset.mvjump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    const upEst = () => { const k = $$('[data-upn]:checked').length, el = $('[data-upest]'); if (el) el.textContent = `${k ? `about $${Math.max(1, Math.round(k * (U?.estMove || 1.7)))}` : 'Tick a move'} · 8 to 10 min`; const bt = $('[data-uprw]'); if (bt) bt.disabled = !k || !U?.canRewrite; };
    $$('[data-upn]').forEach((x) => x.onchange = upEst); if ($('[data-upn]')) upEst();
    $('[data-upcheck]')?.addEventListener('click', async (e) => { busyBtn(e.currentTarget, 'Checking…'); const r = await api(`/api/brands/${slug}/updates`, { action: 'check' }); toast(r?.error ? esc(r.error) : 'Checking for updates. This takes about 3 minutes.'); renderMoves(); });
    $('[data-uprw]')?.addEventListener('click', async (e) => { const ns = $$('[data-upn]:checked').map((x) => +x.dataset.upn); if (!ns.length) return; busyBtn(e.currentTarget, 'Starting…'); const r = await api(`/api/brands/${slug}/updates`, { action: 'rewrite', moves: ns }); toast(r?.error ? esc(r.error) : `Rewriting ${ns.length} move${ns.length === 1 ? '' : 's'}. About 8 to 10 minutes.`); renderMoves(); });
    $('[data-upauto]')?.addEventListener('change', async (e) => { await api(`/api/brands/${slug}/updates`, { action: 'auto', on: e.target.checked }); toast(e.target.checked ? 'The moves will keep themselves current.' : 'Automatic updates are off.'); renderMoves(); });
    const busy = U?.checking || U?.rewriting;
    if (building || busy) MV.t = setTimeout(() => view === 'moves' && renderMoves(), MVT.tab !== 'moves' || busy ? 8e3 : 15e3);
  };
  function fmtDay(t) { return t ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''; }
  function fmtWhen(t) { return t ? `${fmtDay(t)}, ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''; }
  // a move, read in the product: the same sections as the PDF
  // a move opens as its own page: #v=move&m=NN (back returns to the Moves page)
  const openMove = (n) => { MV.n = n; nav(`#v=move&m=${n}`, true, 'view', 'move'); renderMove(); };
  const renderMove = async () => {
    view = 'move'; counts(); clearTimeout(MV.t); const n = +(hashParams().m ?? MV.n ?? 0), slug = mvSlug(); MV.n = n;
    $('#view').innerHTML = `<div class="rd"><div class="sk" style="height:60vh;border-radius:24px"></div></div>`; window.scrollTo(0, 0);
    const [m, list, up] = await Promise.all([api(`/api/brands/${slug}/moves/${n}`), api(`/api/brands/${slug}/moves`), GEN ? api(`/api/brands/${slug}/updates`) : null]); if (view !== 'move') return;
    const stl = (up?.stale || []).find((x) => x.n === n), rwing = (up?.rewriting || []).find((x) => x.n === n && !x.done);
    if (!m || m.error) { $('#view').innerHTML = `<div class="rd"><div class="bd-empty">${mvLabel(n)} is not written yet. <button class="linkbtn" data-nav="moves">Back to the moves</button></div></div>`; return; }
    const pdfs = list?.pdfs || {}, all = (list?.moves || []).map((x) => x.n).sort((a, b) => a - b), at = all.indexOf(n), prev = all[at - 1], next = all[at + 1];
    const byN = Object.fromEntries((list?.moves || []).map((x) => [x.n, x]));
    const grp = MV_GROUPS.find(([, , a, z]) => n >= a && n <= z), kick = String(m.kicker || '').replace(/\s*·\s*move\s+\d+\s+of\s+\d+\s*$/i, '');
    const t = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const block = (b) => {
      if (b.t === 'h3') return `<h3>${t(b.text)}</h3>`;
      if (b.t === 'list') return `<${b.ordered ? 'ol' : 'ul'}>${(b.items || []).map((x) => `<li>${t(x)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
      if (b.t === 'table') return `<figure class="rd-tbl"><div class="rd-tw"><table><thead><tr>${(b.head || []).map((h) => `<th>${t(h)}</th>`).join('')}</tr></thead><tbody>${(b.rows || []).map((r) => `<tr>${(r || []).map((c) => `<td>${t(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${b.caption ? `<figcaption>${t(b.caption)}</figcaption>` : ''}</figure>`;
      if (b.t === 'diagram') return `<figure class="rd-dg"><pre>${esc(b.text)}</pre></figure>`;
      if (b.t === 'example') return `<aside class="rd-ex"><span>${t(b.label || 'Worked example')}</span>${b.title ? `<h4>${t(b.title)}</h4>` : ''}<div>${t(b.body || '').split(/\n{2,}/).map((p) => `<p>${p.replace(/^#{1,4}\s*(.+)$/gm, '<b class="rd-exh">$1</b>').replace(/\n/g, '<br>')}</p>`).join('')}</div></aside>`;
      if (b.t === 'callout') return `<aside class="rd-co">${b.title ? `<b>${t(b.title)}</b>` : ''}<p>${t(b.text || '')}</p></aside>`;
      return `<p>${t(b.text || '')}</p>`; };
    const secs = (m.sections || []).filter((x) => x.h), legacy = secs.length && !secs[0].blocks, hasSrc = secs.some((x) => /^sources?\b/i.test(x.h));
    const sid = (i) => `rd-s${i}`;
    /* the index is written once, at the start; this part is live: every move written so far, new ones included, by group */
    const allW = (list?.moves || []).filter((x) => x.n > 0).sort((a2, b2) => a2.n - b2.n);
    const written = allW.filter((x) => x.n < 1000); /* one count with the Moves page: weekly moves (1001+) are listed but counted apart (QA 20 Oct) */
    const liveIdx = n === 0 && written.length ? `<section id="rd-all" class="rd-all"><h2>Every move so far <small>${written.length}</small></h2>${[...MV_GROUPS, ['new', 'Added since', 51, 9999]].map(([, name, lo, hi]) => { const g = allW.filter((x) => x.n >= lo && x.n <= hi); return g.length ? `<h3>${esc(name)}</h3><ol class="rd-all-l">${g.map((x) => `<li><button data-goto="${x.n}"><span>${mvNum(x.n)}</span><b>${esc(x.title || '')}</b>${x.n > 50 ? '<em>New</em>' : ''}</button></li>`).join('')}</ol>` : ''; }).join('')}</section>` : '';
    const feedCards = allPosts().filter((p) => new RegExp(`^moves?\\s[^·]*\\b0?${n}\\b`, 'i').test(p.src || '')).slice(0, 4);
    $('#view').innerHTML = `<div class="rd">
      <div class="rd-bar rd2-bar"><button class="rd-back" data-nav="moves">${ic('right', 's16')}<span>All moves</span></button>
        <div class="rd-acts"><span class="rd-pn"><button ${prev == null ? 'disabled' : `data-goto="${prev}"`} title="Previous move" aria-label="Previous move">${ic('right', 's16')}</button><button ${next == null ? 'disabled' : `data-goto="${next}"`} title="Next move" aria-label="Next move">${ic('right', 's16')}</button></span>
          ${n != null ? `<a class="btn btn-primary sm" href="${pdfUrl(`move-${n}.pdf`)}" target="_blank" rel="noopener">${ic('doc', 's16')}Open the PDF</a>
          <details class="rd2-more"><summary class="icon-btn" aria-label="More for this move" title="More">${ic('more', 's16')}</summary><div class="rd2-menu"><a href="${pdfUrl(`move-${n}.pdf`, 1)}">${ic('down', 's16')}Download the PDF</a>${GEN && n ? `<button data-rdrw ${!up?.canRewrite || rwing ? 'disabled' : ''} title="${up?.building ? 'Opens once the moves are written' : 'Writes this move again from the latest evidence'}">${rwing ? '<brew-load class="spin"></brew-load>Rewriting…' : `${ic('refresh', 's16')}Rewrite with the latest`}</button>` : ''}</div></details>` : ''}</div></div>
      ${(() => { /* the move at one glance, weighted for the brand reading it (Param, 19 Oct: "simple, visual, one quick-glance
         grasp; right weight to the right elements, from the brand's point of view"): what the move is, the problem in their own
         number, what is live in 30 days; then the plan, week by week, what we need from them and how we'll know; trust and
         freshness are one quiet line each, and the full write-up sits under it for whoever wants the detail */
        const claims = GEN && !m.meta?.verified ? claimsOf(m) : [], about = topicCase(String(kick || '').replace(/\s*·\s*move\s+\d+\s*$/i, '').trim().toLowerCase()).replace(/(\d+\s)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/g, (x, d, mo) => d + mo[0].toUpperCase() + mo.slice(1)) || (grp ? grp[1] : '');
        const statB = n === 0 && written.length ? String(written.length) : m.stat, g = n === 0 ? {} : moveGlance(m), bn = esc(B.brand.name);
        const fresh = stl ? (() => { const st0 = rwing ? 'now' : stl.refresh || (up?.auto === false ? 'off' : 'soon'), why = `<small>${esc(stl.why)}</small>`, wd = up?.potNext ? new Date(up.potNext).toLocaleDateString('en-IN', { weekday: 'long' }) : 'next week';
          if (st0 === 'now') return `<div class="rd2-fresh is-now"><brew-load class="spin"></brew-load><p><b>Refreshing with the latest now.</b> It updates here when done.${why}</p></div>`;
          if (st0 === 'queued' || st0 === 'soon') return `<div class="rd2-fresh is-now">${ic('refresh', 's16')}<p><b>Out of date. Brew is refreshing it with the latest</b>, usually within the hour.${why}</p></div>`;
          if (st0 === 'next-week') return `<div class="rd2-fresh">${ic('refresh', 's16')}<p><b>Out of date.</b> It refreshes on its own on ${esc(wd)}, when the week’s refresh budget starts again.${why}</p>${GEN && up?.canRewrite ? `<button class="btn btn-ghost sm" data-rdrw>Refresh now</button>` : ''}</div>`;
          return `<div class="rd2-fresh">${ic('refresh', 's16')}<p><b>Out of date.</b> Automatic updates are off for ${bn}.${why}</p>${GEN && up?.canRewrite ? `<button class="btn btn-primary sm" data-rdrw>Refresh now</button>` : ''}</div>`; })() : '';
        return `<header class="rd-hero rd2-hero">
        <p class="rd2-kick">${n === 0 ? 'The index' : `${mvLabel(n)}${about ? ` · ${esc(about)}` : ''}`}</p>
        <h1>${esc(n === 0 && written.length ? String(m.title || '').replace(/^\S+(?=\s+moves?\b)/i, String(written.length)) : m.title)}</h1>
        ${m.gives ? `<p class="rd2-sub">${esc(m.gives)}</p>` : ''}
        ${fresh}
        <div class="rd2-why">${statB ? `<div class="rd2-num"><b>${esc(statB)}</b>${m.statLabel ? `<span>${esc(/[a-z]/.test(m.statLabel) ? m.statLabel : capsOff(m.statLabel))}</span>` : ''}</div>` : ''}
          ${(g.found || []).length ? `<div class="rd2-found"><h2>What we found</h2><ul>${g.found.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}</div>
        ${m.live ? `<div class="rd2-live"><h2>Live in 30 days</h2><p>${esc(m.live)}</p></div>` : ''}
        ${(g.steps || []).length ? `<div class="rd2-blk"><h2>The plan</h2><ol class="rd2-steps">${g.steps.map((x, i) => `<li><i>${i + 1}</i><span>${esc(x)}</span></li>`).join('')}</ol></div>` : ''}
        ${(g.weeks || []).length ? `<div class="rd2-blk"><h2>Week by week</h2><ol class="rd2-weeks" style="--n:${g.weeks.length}">${g.weeks.map((x) => `<li><b>${esc(x.w)}</b><span>${esc(x.live)}</span></li>`).join('')}</ol></div>` : ''}
        ${(g.needs || []).length || g.measure ? `<div class="rd2-two">${(g.needs || []).length ? `<div class="rd2-blk"><h2>What we need from ${bn}</h2><ul class="rd2-needs">${g.needs.map((x) => `<li>${ic('check', 's14')}<span>${esc(x)}</span></li>`).join('')}</ul></div>` : ''}
          ${g.measure ? `<div class="rd2-blk"><h2>How we’ll know it worked</h2><div class="rd2-goal"><p>${esc(g.measure.metric)}</p>${g.measure.big ? `<div class="rd2-ft"><span><small>Today</small><b>${esc(g.measure.from)}</b></span>${ic('right', 's16')}<span><small>${esc(g.measure.when)}</small><b>${esc(g.measure.to)}</b></span></div>` : `<dl class="rd2-ft2"><div><dt>Today</dt><dd>${esc(g.measure.from)}</dd></div><div><dt>${esc(g.measure.when)}</dt><dd>${esc(g.measure.to)}</dd></div></dl>`}</div></div>` : ''}</div>` : ''}
        <div class="rd2-foot">${m.meta?.verified ? `<p class="rd2-trust is-ok">${ic('check', 's14')}Every number checked</p>` : claims.length ? `<details class="rd2-trust"><summary>${ic('check', 's14')}Numbers checked · ${claims.length} ${claims.length === 1 ? 'line' : 'lines'} to confirm${ic('right', 's14 chev')}</summary><ul>${claims.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p>Read these as the writer’s view until someone confirms them.</p></details>` : ''}
          ${!stl && m.meta?.version > 1 ? `<p class="rd2-ver">Updated ${fmtDay(m.meta.rewrittenAt)}${m.meta.because ? `: ${esc(m.meta.because)}` : ''}</p>` : ''}</div>
        ${secs.length ? `<p class="rd2-full">The full move<small>Every finding, table and source</small></p>` : ''}</header>`; })()}
      <div class="rd-main"><nav class="rd-toc" aria-label="Contents"><small>On this page</small>${liveIdx ? '<a href="#rd-all" data-toc="all">Every move so far</a>' : ''}${secs.map((x, i) => `<a href="#${sid(i)}" data-toc="${i}">${esc(x.h)}</a>`).join('')}${(m.sources || []).length && !hasSrc ? `<a href="#rd-src" data-toc="src">Sources</a>` : ''}</nav>
        <article class="rd-art">${liveIdx}${secs.map((x, i) => `<section id="${sid(i)}"><h2>${esc(x.h)}</h2>${legacy ? (x.paras || []).map((p) => `<p>${t(p)}</p>`).join('') : (x.blocks || []).map(block).join('')}</section>`).join('')}
          ${(m.toConfirm || []).length ? `<section class="rd-tc"><h2>To confirm with ${esc(B.brand.name)}</h2><ul>${m.toConfirm.map((x) => `<li>${t(x)}</li>`).join('')}</ul></section>` : ''}
          ${(m.sources || []).length && !hasSrc ? `<section id="rd-src" class="rd-src"><h2>Sources</h2><ol>${m.sources.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || x.url)}</a>` : esc(x.label)}${x.at ? `<time>${esc(x.at)}</time>` : ''}</li>`).join('')}</ol></section>` : ''}
          ${hasSrc && (m.meta?.cites || []).some((c) => c.kind === 'ledger' || c.kind === 'signal') ? `<section class="rd-src"><h2>Evidence lines</h2><ol>${m.meta.cites.filter((c) => c.kind === 'ledger' || c.kind === 'signal').map((c) => `<li>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(`${c.label}: ${c.v}`)}</a>` : esc(`${c.label}: ${c.v}${c.src ? ` (${c.src})` : ''}`)}${c.at ? `<time>${esc(c.at)}</time>` : ''}</li>`).join('')}</ol></section>` : ''}
          ${feedCards.length ? `<section class="rd-feed"><h2>In your feed from this move</h2><div>${feedCards.map((p) => `<button data-opencard="${esc(p.id)}">${face(p.agent)}<span><b>${esc(p.title)}</b><small>${esc(p.cta?.label || 'Open')}</small></span>${ic('right', 's16')}</button>`).join('')}</div></section>` : ''}
          <nav class="rd-next">${prev != null ? `<button data-goto="${prev}"><small>Previous</small><b>${mvLabel(prev)} · ${esc(byN[prev]?.title || '')}</b></button>` : '<span></span>'}${next != null ? `<button data-goto="${next}" class="is-next"><small>Next</small><b>${mvLabel(next)} · ${esc(byN[next]?.title || '')}</b></button>` : ''}</nav>
        </article></div></div>`;
    $$('[data-goto]', $('#view')).forEach((x) => x.onclick = () => openMove(+x.dataset.goto));
    $$('[data-rdrw]', $('#view')).forEach((x) => x.onclick = async () => {
      if (x.dataset.sure !== '1') { $$('[data-rdrw]').forEach((y) => { y.dataset.sure = '1'; y.innerHTML = `Refresh · about $${(+up?.estMove || 0.1).toFixed(2)}? Yes`; }); return; }
      $$('[data-rdrw]').forEach((y) => { y.disabled = true; y.innerHTML = '<brew-load class="spin"></brew-load>Rewriting…'; });
      const r = await api(`/api/brands/${slug}/updates`, { action: 'rewrite', moves: [n] }); toast(r?.error ? esc(r.error) : `Refreshing ${mvLabel(n)} with the latest. It updates here when done.`);
      if (r?.error) renderMove(); else MV.t = setTimeout(() => view === 'move' && MV.n === n && renderMove(), 60e3); });
    if (rwing) MV.t = setTimeout(() => view === 'move' && MV.n === n && renderMove(), 30e3);
    $$('[data-opencard]', $('#view')).forEach((x) => x.onclick = () => { const p = byId(x.dataset.opencard); if (p) openDetail(p); });
    $$('[data-toc]', $('#view')).forEach((x) => x.onclick = (e) => { e.preventDefault(); document.getElementById(x.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    // scrollspy: the contents rail follows where you are
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; const id = e.target.id; $$('.rd-toc a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id)); }), { rootMargin: '-20% 0px -70% 0px' });
    $$('.rd-art section[id]').forEach((x) => io.observe(x));
  };

  /* the move's parts a brand reads first, taken from the move itself (every move is written to the same template: What we
     found ends in Key takeaways, The plan has numbered steps, the 30-day table has a week, what the brand provides and what is
     live, How we measure starts with its metric, today's number and the target). Nothing here is written or guessed: a part
     the move doesn't have is left out */
  const moveGlance = (m) => { const secs = (m?.sections || []).filter((x) => x.h && x.blocks), sec = (re) => secs.find((x) => re.test(x.h));
    const plain = (x) => String(x || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
    const first = (x) => { const p = plain(x); const m1 = p.match(/^(.{20,170}?[.!?])(\s|$)/); return m1 ? m1[1] : p.length > 170 ? p.slice(0, 169).replace(/\s+\S*$/, '') + '…' : p; };
    const tbl = (s0) => (s0?.blocks || []).find((b) => b.t === 'table' && (b.head || []).length && (b.rows || []).length);
    const col = (t0, re) => (t0.head || []).findIndex((h) => re.test(String(h)));
    const out = {};
    const fd = sec(/what we found/i); if (fd) { const bl = fd.blocks, k = bl.findIndex((b) => b.t === 'h3' && /takeaway/i.test(b.text || '')), li = (k >= 0 ? bl.slice(k) : []).find((b) => b.t === 'list') || null;
      if (li) out.found = li.items.slice(0, 3).map((x) => { const p = plain(x), mm = p.match(/^([^:]{3,60}):\s*(.+)$/); return mm ? `<b>${esc(mm[1])}:</b> ${esc(first(mm[2]))}` : esc(first(p)); });
      else { const ft = fd.blocks.find((b) => b.t === 'table' && col(b, /what we found|finding|result/i) >= 0 && col(b, /signal|check|what we read/i) >= 0); /* no takeaways: the signals table, "signal: what we found" */
        if (ft) { const ck = col(ft, /signal|check|what we read/i), cf = col(ft, /what we found|finding|result/i); out.found = ft.rows.slice(0, 3).filter((r) => plain(r[cf])).map((r) => `<b>${esc(plain(r[ck]))}:</b> ${esc(first(r[cf]))}`); }
        else { const ls = [...fd.blocks].reverse().find((b) => b.t === 'list' && (b.items || []).length); if (ls) out.found = ls.items.slice(0, 3).map((x) => { const p = plain(x), mm = p.match(/^([^:]{3,60}):\s*(.+)$/); return mm ? `<b>${esc(mm[1])}:</b> ${esc(first(mm[2]))}` : esc(first(p)); }); } } }
    const pl = sec(/^the plan/i); if (pl) out.steps = pl.blocks.filter((b) => b.t === 'h3').map((b) => plain(b.text).replace(/^\d+[.)]\s*/, '')).filter((x) => x && !/not doing|decision rule|watch trigger|^cadence|creative cadence|what we are not/i.test(x)).slice(0, 5);
    const wk = tbl(sec(/30-day|deployment|rollout/i)); if (wk) { const cw = col(wk, /week/i), cl = col(wk, /live/i), cn = col(wk, /provide|from you|needs?|brings|gives/i);
      if (cw >= 0 && cl >= 0) out.weeks = wk.rows.slice(0, 6).map((r) => ({ w: /^\d+$/.test(String(r[cw]).trim()) ? `Week ${String(r[cw]).trim()}` : plain(r[cw]), live: first(r[cl]) })).filter((x) => x.live);
      if (cn >= 0) out.needs = [...new Set(wk.rows.map((r) => plain(r[cn])).filter((x) => x && !/^(none|nothing|n\/a|-|–)\.?$/i.test(x)).map((x) => first(x)))].slice(0, 4); }
    const ms = tbl(sec(/how we measure/i)); if (ms) { const cm = col(ms, /metric/i), cb = col(ms, /baseline|today|now/i), ct = col(ms, /target|goal/i), r = ms.rows[0];
      if (cm >= 0 && cb >= 0 && ct >= 0 && r) { const tidy = (x) => plain(x).replace(/^(?:target|goal):\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        const from = /^to be (?:instrumented|pulled|measured|set)/i.test(plain(r[cb])) ? 'Not measured yet' : tidy(r[cb]), to = tidy(r[ct]);
        out.measure = { metric: tidy(r[cm]), from, to, big: from.length <= 18 && to.length <= 18 /* short numbers get the big Today → target; sentences read as two lines */, when: (String(ms.head[ct]).match(/\d+[- ]day/i)?.[0] || 'Target').replace(/(\d+)[- ]day/i, 'Day $1') }; } }
    return out; };
  /* a label written in capitals, in sentence case: acronyms stay (AI, SEO), the brand keeps its own spelling, "vs" goes lower */
  const capsOff = (x) => { const bn = B.brand?.name || ''; let o = topicCase(String(x || '').toLowerCase()).replace(/\bVS\b/g, 'vs'); if (bn) o = o.replace(new RegExp(`\\b${bn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), bn); return o; };
  /* the move page's ⋯ menu closes on a click anywhere else, or Escape */
  document.addEventListener('click', (e) => $$('.rd2-more[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.rd2-more[open]').forEach((d) => (d.open = false)); });

  /* ---------- What we heard: everything people said, asked or not, with where it came from ---------- */
  // real marks where we have one; a lettered tile otherwise (never a vendor's name)
  const SRC_LOGO = [[/youtube/i, 'youtube.svg'], [/reddit/i, 'reddit.svg'], [/instagram/i, 'instagram.svg'], [/^x$|\bx posts?\b|twitter/i, 'x.svg'], [/amazon/i, 'amazon.svg'], [/nykaa/i, 'nykaa.png'], [/flipkart/i, 'flipkart.svg'], [/facebook|\bmeta\b/i, 'meta.svg'], [/google/i, 'google.svg'], [/chatgpt|openai/i, 'openai.svg'], [/gemini/i, 'googlegemini.svg'], [/perplexity/i, 'perplexity.svg'], [/whats ?app/i, 'whatsapp.svg']];
  const SRC_MK = { tiktok: ['♪', '#111'], threads: ['@', '#111'], linkedin: ['in', '#0a66c2'], pinterest: ['P', '#e60023'], telegram: ['➤', '#229ed9'], trustpilot: ['★', '#00b67a'], walmart: ['W', '#0071ce'], myntra: ['M', '#ff3f6c'], news: ['N', '#475569'], web: ['W', '#64748b'], site: ['★', 'var(--fg)', 'var(--bg)'], maps: ['G', '#34a853'], appstore: ['A', '#0a84ff'] };
  const srcMark = (id, name) => { const k = `${id || ''} ${name || ''}`, f = SRC_LOGO.find(([rx]) => rx.test(k))?.[1];
    if (f) return `<span class="hd-lg"><img src="assets/logos/${f}" alt=""></span>`;
    const [t, c, tc] = SRC_MK[Object.keys(SRC_MK).find((x) => k.toLowerCase().includes(x)) || ''] || [String(name || id || '?')[0].toUpperCase(), '#64748b'];
    return `<span class="hd-lg is-mk" style="--mk:${c}${tc ? `;color:${tc}` : ''}">${esc(t)}</span>`; }; /* a tile in the theme's ink takes the page colour for its mark, so it never goes white on white in dark mode */
  // topics are stored lowercase: show them in sentence case that keeps acronyms (“AI pivot”, “SPF 50”, “COD returns”)
  const ACRO = /^(ai|seo|ugc|ui|ux|uk|us|usa|eu|uae|spf|pr|cta|roi|d2c|dtc|cod|emi|gst|mrp|faq|pdp|qr|tv|ott|ipo|ceo|vs)$/i;
  const topicCase = (t) => String(t || '').split(/(\s+)/).map((w, i) => (ACRO.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join('');
  const HD = { f: { src: '', mode: '', theme: '', q: '' }, x: null, t: null };
  const hdQs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  /* ---------- The fact sheet: every fact Brew may quote, with its source and the day it was read. The team fixes it with
     choices or a link Brew reads (a typed number is never taken on trust); visitors of a claimed brand only read it ---------- */
  const FS = { open: null, all: new Set() };
  const renderFacts = async (embed = false) => {
    if (!embed) view = 'facts'; counts(); const slug = mvSlug();
    if (!$('#fs')) { libShell('Fact sheet', `Every number and name Brew may quote for ${esc(B.brand.name)}, and where it came from.`, `<div class="fsx" id="fs">${loader('Opening the fact sheet')}</div>`); $('#col')?.classList.add('lib-col', 'fs-col'); }
    const D = await api(`/api/brands/${slug}/facts`); if (embed ? !$('#fs') : view !== 'facts') return;
    if (!D || D.error) { $('#fs').innerHTML = `<p class="lx-empty">${esc(D?.error || 'The fact sheet did not open. Try again.')}</p>`; return; }
    paintFacts(D);
  };
  const fsWhen = (s) => { if (!s) return ''; const t = Date.parse(s); return Number.isFinite(t) ? (String(s).length > 10 ? fmtWhen(t) : fmtDay(t)) : esc(s); };
  const paintFacts = (D) => {
    const el = $('#fs'); if (!el) return;
    const srcOf = (r) => r.tool ? `<span class="fs-src is-conn${r.stale ? ' is-stale' : ''}">${ic('plug', 's14')}${esc(r.tool)}${Number.isFinite(Date.parse(r.syncedAt)) ? ` · ${ago(Date.parse(r.syncedAt))}` : ''}${r.stale ? ` · stale${r.staleWhy ? ` (${esc(r.staleWhy)})` : ''}: not used until it reads again` : ''}</span>` : r.src ? `${r.url ? `<a class="fs-src" href="${esc(r.url)}" target="_blank" rel="noopener"` : '<span class="fs-src"'} title="${esc(srcShort(r.src))}${r.at ? ` · read ${esc(String(fsWhen(r.at)).replace(/<[^>]+>/g, ''))}` : ''}">${esc(srcShort(r.src).replace(/^(?:https?:\/\/)?(?:www\.)?/, ''))}${r.url ? '</a>' : '</span>'}` : '<span class="fs-src is-none">No source</span>';
    const hint = (r) => r.kind === 'price' ? 'Paste the product page link' : r.kind === 'rival' ? 'Paste the rival’s website' : r.kind === 'instagram' ? 'Paste your Instagram profile link' : r.kind === 'adpage' ? 'Paste your Facebook page link' : r.kind === 'reviews' ? 'Paste the page where your reviews live' : 'Paste a page that shows the right value';
    // labels keep what a person would say; where it was read already shows on the source line
    const lab = (t) => String(t || '').replace(/\s*\((?:shopify\s*)?\/[^)]*\)/i, '').replace(/\s*\([^)]*\.(?:json|xml)\)/i, '');
    const row = (r) => `<li class="fs-r${FS.open === r.k ? ' is-open' : ''}" data-fk="${esc(r.k)}"><span class="fs-l">${esc(lab(r.label))}</span><div class="fs-m"><b class="fs-v">${esc(r.v)}</b>${r.was ? `<small class="fs-was">site said ${esc(r.was.v)}</small>` : ''}${r.by === 'team' ? '<em class="fs-tag">Fixed by your team</em>' : r.by === 'daily' ? '<em class="fs-tag">Checked today</em>' : ''}</div><span class="fs-meta">${srcOf(r)}</span>
      ${r.canRemove || r.canLink ? `<button class="linkbtn fs-e" data-fslink="${esc(r.k)}" aria-expanded="${FS.open === r.k}">${FS.open === r.k ? 'Close' : 'Edit'}</button>
      <form class="fs-fix" data-fsform="${esc(r.k)}" ${FS.open === r.k ? '' : 'hidden'}>${r.canLink ? `<input type="url" inputmode="url" required placeholder="${esc(hint(r))}"><button class="btn btn-primary sm">Read it</button>` : ''}${r.canRemove ? `<button type="button" class="btn btn-ghost sm" data-fsrm="${esc(r.k)}">Not true any more</button>` : ''}${r.canLink ? '<small>Brew reads the page and takes the value from it. Typed numbers are never used.</small>' : ''}</form>` : ''}</li>`;
    const C = D.choices, chip = (on, attr, label) => `<button class="fs-chip${on ? ' is-on' : ''}" ${attr} aria-pressed="${!!on}" title="${label.replace(/<[^>]*>/g, '')}">${label}</button>`; /* a long product name is cut with an ellipsis; the title holds it whole */
    const choices = !C ? '' : `<section class="fs-g fs-ch" id="fsg-choices"><header><h3>Products, rivals and market</h3></header>
      <div class="fs-cb"><h4>Hero products <small>★ the ones to lead with · × not a real product</small></h4><div class="fs-chips">${C.products.map((x) => `<span class="fs-pc">${chip(x.hero, `data-fshero="${esc(x.handle)}"`, `★ ${esc(x.title)}`)}<button class="fs-px" data-fsrmp="${esc(x.handle)}" title="Not a real product, remove" aria-label="Remove ${esc(x.title)}">×</button></span>`).join('')}</div>
        <form class="fs-add" data-fsadd="product"><input type="url" inputmode="url" required placeholder="Paste a product page link to add it"><button class="btn btn-ghost sm">Add product</button></form></div>
      <div class="fs-cb"><h4>Rivals</h4><div class="fs-chips">${C.rivals.map((r) => `<span class="fs-pc"><span class="fs-chip is-static">${esc(r.name || r.host)}</span><button class="fs-px" data-fsrmr="${esc(r.host)}" title="Not a rival, remove" aria-label="Remove ${esc(r.name || r.host)}">×</button></span>`).join('') || '<span class="fs-none">No rivals yet.</span>'}</div>
        <form class="fs-add" data-fsadd="rival"><input type="url" inputmode="url" required placeholder="Paste a rival’s website"><button class="btn btn-ghost sm">Add rival</button></form></div>
      <div class="fs-cb"><h4>Market</h4><div class="fs-mk">${C.market.map((x) => { const opts = x.type === 'country' ? COUNTRIES : x.type === 'currency' ? CURRENCIES.map((c) => [c, c]) : null;
        return `<label><span>${esc(x.label)}</span>${opts ? `<select data-fswho="${x.key}">${(opts.some(([v]) => v === x.v) ? opts : [[x.v, x.v], ...opts]).map(([v, n]) => `<option value="${esc(v)}"${v === x.v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<input data-fswho="${x.key}" value="${esc(x.v)}">`}</label>`; }).join('')}<button class="btn btn-ghost sm" data-fswhogo>Save market</button></div></div></section>`;
    const log = (D.edits || []).length ? `<section class="fs-g"><header><h3>Changes</h3></header><ul class="fs-log">${D.edits.slice(0, 12).map((e) => `<li><time>${fmtWhen(e.at)}</time><span><b>${esc(e.by)}</b> ${esc(e.what)}</span></li>`).join('')}</ul></section>` : '';
    const q = (FS.q || '').toLowerCase(), hit = (r) => !q || `${lab(r.label)} ${r.v}`.toLowerCase().includes(q);
    const groups = D.groups.map((g) => ({ ...g, rows: g.rows.filter(hit) })).filter((g) => g.rows.length), focusQ = document.activeElement?.matches?.('[data-fsq]');
    el.innerHTML = `<div class="fs-top"><label class="hd-search fs-q">${ic('search', 's16')}<input data-fsq data-nomic type="search" placeholder="Find a fact" value="${esc(FS.q || '')}" aria-label="Find a fact"></label><span>${q ? `${groups.reduce((n, g) => n + g.rows.length, 0)} of ${D.total}` : `${D.total} facts`}</span>${D.daily ? `<span title="${esc(D.daily.summary || '')}">Prices and stock checked ${fmtWhen(D.daily.at)}</span>` : ''}${D.canEdit ? '' : `<span class="fs-ro">${ic('lock', 's14')}Only ${esc(B.brand.name)}’s team can change these</span>`}</div>
      ${!q && D.groups.length > 2 ? `<nav class="mv2-nav fs-nav">${D.groups.map((g) => `<a href="#fsg-${g.k}" data-fsjump="${g.k}">${esc(g.name)}</a>`).join('')}${choices ? '<a href="#fsg-choices" data-fsjump="choices">Hero products and rivals</a>' : ''}</nav>` : ''}
      ${q && !groups.length ? '<p class="lx-empty">No fact matches that.</p>' : ''}
      ${groups.map((g) => { const all = q || FS.all.has(g.k) || g.rows.length <= 10; return `<section class="fs-g" id="fsg-${g.k}"><header><h3>${esc(g.name)}<em>${g.rows.length}</em></h3></header><ul class="fs-list">${(all ? g.rows : g.rows.slice(0, 8)).map(row).join('')}</ul>${all ? '' : `<button class="linkbtn fs-more" data-fsall="${g.k}">Show all ${g.rows.length}</button>`}</section>`; }).join('')}
      ${q ? '' : choices + log}`;
    const qi = $('[data-fsq]', el); qi.oninput = () => { clearTimeout(FS.t); FS.t = setTimeout(() => { FS.q = qi.value.trim(); paintFacts(D); }, 200); };
    if (focusQ) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    const busy = (b, on, t) => { b.disabled = on; if (on) { b.dataset.t = b.textContent; b.innerHTML = `<brew-load class="spin"></brew-load>${t || 'Reading'}`; } else b.textContent = b.dataset.t || b.textContent; };
    const send = async (body, b, t) => { if (b) busy(b, true, t); const r = await api(`/api/brands/${mvSlug()}/facts`, body); if (b) busy(b, false);
      if (!r || r.error) { toast(`${ic('info', 's16')}${esc(r?.error || 'That did not go through. Try again.')}`); return null; }
      (r.notes || []).slice(0, 1).forEach((n) => toast(`${ic('info', 's16')}${esc(n)}`));
      toast(`${ic('check', 's16')}Saved.${r.flagged?.length ? ` ${r.flagged.length} move${r.flagged.length === 1 ? '' : 's'} that quoted it marked out of date.` : ''}`);
      FS.open = null; if (r.data && $('#fs')) paintFacts(r.data); return r; };
    el.onclick = async (e) => {
      const fj = e.target.closest('[data-fsjump]'); if (fj) { e.preventDefault(); document.getElementById(`fsg-${fj.dataset.fsjump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const sa = e.target.closest('[data-fsall]'); if (sa) { FS.all.add(sa.dataset.fsall); paintFacts(D); return; }
      const lk = e.target.closest('[data-fslink]'); if (lk) { const k = lk.dataset.fslink; FS.open = FS.open === k ? null : k; $$('.fs-fix', el).forEach((f) => { f.hidden = f.dataset.fsform !== FS.open; }); $$('[data-fslink]', el).forEach((b) => { const on = b.dataset.fslink === FS.open; b.textContent = on ? 'Close' : 'Edit'; b.setAttribute('aria-expanded', on); }); $(`.fs-fix[data-fsform="${CSS.escape(k)}"] input`, el)?.focus(); return; }
      const rm = e.target.closest('[data-fsrm]'); if (rm) { const r = D.groups.flatMap((g) => g.rows).find((x) => x.k === rm.dataset.fsrm); if (r && confirm(`Remove “${r.label}: ${r.v}” from the fact sheet? Brew stops quoting it, and moves that quote it are marked out of date.`)) send({ action: 'remove', key: r.k }, rm, 'Removing'); return; }
      const hr = e.target.closest('[data-fshero]'); if (hr) { const hero = C.products.filter((x) => (x.handle === hr.dataset.fshero ? !x.hero : x.hero)).map((x) => x.handle); send({ action: 'choices', hero }, null); return; }
      const rp = e.target.closest('[data-fsrmp]'); if (rp) { if (confirm('Remove this product? Its price leaves the fact sheet.')) send({ action: 'choices', removed: [rp.dataset.fsrmp] }, null); return; }
      const rr = e.target.closest('[data-fsrmr]'); if (rr) { if (confirm('Remove this rival?')) send({ action: 'choices', removeRivals: [rr.dataset.fsrmr] }, null); return; }
      const wg = e.target.closest('[data-fswhogo]'); if (wg) { const who = {}; $$('[data-fswho]', el).forEach((x) => { const o = C.market.find((m) => m.key === x.dataset.fswho); if (o && x.value.trim() && x.value.trim() !== String(o.v)) who[o.key] = x.value.trim(); }); if (Object.keys(who).length) send({ action: 'choices', who }, wg, 'Saving'); else toast(`${ic('info', 's16')}Nothing changed.`); }
    };
    $$('.fs-fix', el).forEach((f) => f.onsubmit = (e) => { e.preventDefault(); send({ action: 'link', key: f.dataset.fsform, url: f.querySelector('input').value.trim() }, f.querySelector('button')); });
    $$('.fs-add', el).forEach((f) => f.onsubmit = (e) => { e.preventDefault(); const u = f.querySelector('input').value.trim(); send({ action: 'choices', ...(f.dataset.fsadd === 'product' ? { addProducts: [u] } : { addRivals: [u] }) }, f.querySelector('button')); });
  };
  const openHeard = (f = {}) => { HD.f = { src: '', mode: '', theme: '', q: '', ...f }; nav('#v=heard', true, 'view', 'heard'); renderHeard(); };
  const renderHeard = async (more = false) => {
    view = 'heard'; if (!more) { HD.x = null; libShell('What we heard', `Everything people said about ${esc(B.brand.name)}. Tap a quote to open where it was said.`, `<div class="hd" id="hd">${loader('Gathering what people said')}</div>`); $('#col')?.classList.add('lib-col', 'hd-col'); }
    const off = more ? HD.x?.items.length || 0 : 0, r = await api(`/api/brands/${encodeURIComponent(BR)}/heard/items?${hdQs({ ...HD.f, offset: off, limit: 60 })}`);
    if (view !== 'heard' || !r || r.error) { if (!more && $('#hd')) $('#hd').innerHTML = `<p class="lx-empty">${r?.error ? esc(r.error) : 'Nothing heard yet. Brew listens every day; the first quotes land here within a day.'}</p>`; return; }
    HD.x = more && HD.x ? { ...r, items: [...HD.x.items, ...r.items] } : r; paintHeard(); };
  const paintHeard = () => { const el = $('#hd'); if (!el || !HD.x) return; const x = HD.x, f = HD.f, n0 = (n) => Number(n || 0).toLocaleString(), focus = document.activeElement?.matches?.('[data-hd-q]');
    const all = (x.sources || []).reduce((a, s) => a + (s.n || 0), 0), md = x.modes || {};
    const row = (k, v, label, n, on, mk = '') => `<button class="hd-row${on ? ' is-on' : ''}" data-hd-f="${k}" data-v="${esc(v)}">${mk || '<span class="hd-lg is-dot"></span>'}<span>${esc(label)}</span>${n != null ? `<b>${n0(n)}</b>` : ''}</button>`;
    const chip = (k, v, label, n, on) => `<button class="hd-chip${on ? ' is-on' : ''}" data-hd-f="${k}" data-v="${esc(v)}">${esc(label)}${n != null ? `<b>${n0(n)}</b>` : ''}</button>`;
    /* hashtag tails go; fancy-Unicode names read as plain letters; the platform shows once (its logo and one word) */
    const hdText = (t) => { const s0 = String(t || '').trim(), cut = s0.replace(/(?:\s*#[\p{L}\p{N}_]+)+[\s#]*$/u, '').trim(); return cut.length >= 24 ? cut : s0; };
    const plain = (t) => String(t || '').normalize('NFKC').replace(/[^\p{L}\p{N}\s@._'’-]+/gu, '').replace(/\s+/g, ' ').trim();
    const fig = (q) => { const name = q.sourceName || q.source || q.platform || '', when = q.postedAt ? fmtDay(q.postedAt) : '', url = q.link || q.url, who = plain(q.author), where = [q.where, q.sub].find((w) => w && w !== name && plain(w) !== who) || '';
      return `<figure class="hd-q${q.mode === 'asked' ? ' is-asked' : ''}">${url ? `<a class="hd-qa" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Open where it was said"></a>` : ''}<blockquote>${esc(hdText(q.quote || q.text))}</blockquote>
        <figcaption>${srcMark(q.platform || q.source, name)}<span class="hd-qs"><b>${esc(who || name)}</b><em>${esc([who ? name : '', where, when].filter(Boolean).join(' · '))}${q.rating ? ` · ${'★'.repeat(q.rating)}` : ''}</em></span>${q.mode === 'asked' ? '<i class="hd-asked">Asked</i>' : ''}${url ? `<u>${ic('right', 's14')}</u>` : ''}</figcaption></figure>`; };
    /* the same post read twice (a cross-post, a re-read) shows once */
    const seenQ = new Set(), items = x.items.filter((q) => { const t0 = String(q.quote || q.text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), k = t0.length > 60 ? t0.slice(0, 60) : `${t0}|${q.author || ''}`; if (!t0 || seenQ.has(k)) return false; seenQ.add(k);
      const w = String(q.quote || q.text || '').trim().split(/\s+/), tags = w.filter((x) => x.startsWith('#')).length; return !(tags >= 3 && w.length - tags < 6); });
    const th0 = x.themes || [], thN = HD.allT ? th0.length : 10, thI = th0.findIndex((t) => t.name === f.theme), th = thI >= thN ? [th0[thI], ...th0.filter((_, i) => i !== thI)] : th0; /* ten topics and "N more"; a picked topic always shows */
    const top = th0.slice(0, 5), topMx = Math.max(1, ...top.map((t) => t.n || 0));
    const sum = !f.theme && !f.q && top.length >= 3 ? `<section class="hd-sum" aria-label="What people talk about most"><span class="hd-l">What people talk about most</span><div class="hd-bars">${top.map((t, i) => `<button class="hd-bar${i ? '' : ' is-top'}" data-hd-f="theme" data-v="${esc(t.name)}"><span class="hd-bt"><b>${esc(topicCase(t.name))}</b><em>${n0(t.n)}</em></span><i style="--w:${Math.round((t.n || 0) / topMx * 100)}%"></i></button>`).join('')}</div></section>` : '';
    el.innerHTML = `${sum}<div class="hd-top"><b class="hd-n">${n0(x.total)}</b><span>${f.src || f.mode || f.theme || f.q ? 'match' : `quotes${x.at ? ` · read ${ago(x.at)}` : ''}`}</span></div>
      <div class="hd-grid"><aside class="hd-tools" aria-label="Filters">
        <label class="hd-search">${ic('search', 's16')}<input data-hd-q data-nomic type="search" placeholder="Search the words" value="${esc(f.q)}" aria-label="Search what people said"></label>
        <div class="hd-grp"><span class="hd-l">Where</span>${row('src', '', 'Everywhere', all, !f.src, `<span class="hd-stack">${(x.sources || []).slice(0, 3).map((s) => srcMark(s.id, s.name)).join('')}</span>`)}${(x.sources || []).filter((s, i) => HD.allS || i < 6 || f.src === s.id).map((s) => row('src', s.id, s.name, s.n, f.src === s.id, srcMark(s.id, s.name))).join('')}${!HD.allS && (x.sources || []).length > 6 ? `<button class="hd-row is-more" data-hd-alls><span>${x.sources.length - 6} more places</span></button>` : ''}</div>
        ${md.asked || f.mode ? `<div class="hd-grp"><span class="hd-l">How we heard</span>${row('mode', '', 'All of it', (md.heard || 0) + (md.asked || 0), !f.mode)}${row('mode', 'heard', 'Heard without asking', md.heard || 0, f.mode === 'heard')}${row('mode', 'asked', 'Asked in communities', md.asked || 0, f.mode === 'asked')}</div>` : ''}
        ${th.length ? `<div class="hd-grp"><span class="hd-l">Topic</span><div class="hd-chips">${chip('theme', '', 'Any', null, !f.theme)}${th.filter((t) => !sum || !top.includes(t) /* the five in the bar above are not listed twice (QA UI 20 Oct) */).slice(0, Math.min(thN, 24)).map((t) => chip('theme', t.name, topicCase(t.name), t.n, f.theme === t.name)).join('')}${th.length > thN ? `<button class="hd-chip is-more" data-hd-allt>${th.length - thN} more</button>` : ''}</div></div>` : ''}
      </aside><div class="hd-main">${items.length ? `<div class="hd-wall">${items.map(fig).join('')}</div>${x.items.length < x.total ? `<button class="btn btn-ghost sm hd-more" data-hd-more>Show more (${n0(x.total - x.items.length)} left)</button>` : '<p class="hd-end">That’s everything.</p>'}` : '<p class="lx-empty">Nothing matches. Try another filter.</p>'}</div></div>`;
    $$('[data-hd-f]', el).forEach((b) => b.onclick = () => { HD.f[b.dataset.hdF] = b.dataset.v; renderHeard(); });
    const qi = $('[data-hd-q]', el); qi.oninput = () => { clearTimeout(HD.t); HD.t = setTimeout(() => { HD.f.q = qi.value.trim(); renderHeard(); }, 350); };
    if (focus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    $('[data-hd-more]', el)?.addEventListener('click', () => renderHeard(true));
    $('[data-hd-allt]', el)?.addEventListener('click', () => { HD.allT = true; paintHeard(); });
    $('[data-hd-alls]', el)?.addEventListener('click', () => { HD.allS = true; paintHeard(); }); };

  /* ---------- What Brew learned: lessons, rules, checks, trust, winners. All editable. ---------- */
  const LX = { all: false };
  // message copy reads as a message, never as a template
  const lxCopy = (x) => String(x || '').replace(/^\s*(hi|hey|hello)\s*\{[a-z_]+\},?\s*/i, '').replace(/\{[a-z_]+\}/gi, '…').replace(/\s*\n+\s*/g, ' ').trim();
  const lxSw = (on, attr, id, label) => `<button class="linkbtn lx-pz" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" ${attr}="${id}">${on ? 'Pause' : 'Resume'}</button>`;
  const lxTools = (kind, id) => `<span class="lx-tools"><button class="linkbtn" data-lx-edit="${kind}:${id}">Edit</button><button class="linkbtn" data-lx-forget="${kind}:${id}">Forget</button></span>`;
  const lxHead = (id, h, n, hint) => `<header class="lx-h" id="${id}"><h3>${h}${n !== '' ? `<em>${n}</em>` : ''}</h3>${hint ? `<p>${hint}</p>` : ''}</header>`;
  const lxMeter = (n, of) => `<span class="lx-meter" aria-label="${n} of ${of}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const lxBuildLine = (st) => { const N = +st.total || 50, n = Math.max(0, Math.min(N, +st.movesDone || 0)); return /\bmoves?\b/i.test(st.state || '') ? String(st.state) : `Writing the moves: ${n} of ${N}`; };
  const lxBuild = (st) => { const n = Math.max(0, Math.min(51, +st.movesDone || 0)); return `<small class="lx-build" data-lx-build>${esc(lxBuildLine(st))}</small><i class="lx-bar" aria-hidden="true"><b style="width:${Math.round((n / 51) * 100)}%"></b></i>`; };
  const lxBuildPoll = async () => { if (view !== 'learned' || !$('[data-lx-build]')) return; const st = await api(`/api/brands/${mvSlug()}/status`); if (view !== 'learned' || !st || st.error) return;
    if (st.done) return renderLearned(); const el = $('[data-lx-build]'); if (!el) return; el.textContent = lxBuildLine(st); const bar = $('.lx-bar b'); if (bar) bar.style.width = `${Math.round((Math.min(51, +st.movesDone || 0) / 51) * 100)}%`; lxBuild.t = setTimeout(lxBuildPoll, 15e3); };
  const renderLearned0 = async () => {
    const stop = view !== 'learned' ? holdView('Opening what Brew learned') : () => {}; view = 'learned';
    const bq = encodeURIComponent(BR), [L, HD, MEM, MVS, CAL, UPS, TOLD] = await Promise.all([tapi('GET', '/api/tenants/:t/learning'), api(`/api/brands/${bq}/heard`), api(`/api/brands/${bq}/memory`), api(`/api/brands/${mvSlug()}/moves`), api(`/api/brands/${bq}/calendar?days=120`), GEN ? api(`/api/brands/${mvSlug()}/updates`) : null, api(`/api/brands/${bq}/told`)]); if (L.error || view !== 'learned') return;
    const heard = HD?.heard || null, memLines = (MEM?.facts || []).filter((f) => f.scope === 'brand').sort((a, b) => (b.n || 1) - (a.n || 1) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const agents = Object.keys(L.trust), all = L.lessons || [], on = (xs) => xs.filter((x) => x.on).length;
    // measured lessons lead: the loop closed and the number moved (or didn't), so this is the strongest thing it knows
    const moved = all.filter((x) => x.results?.length), lessons = all.filter((x) => !x.results?.length);
    // the same thing done five times in a row reads as one line
    const runs = []; (L.signals || []).forEach((s) => { const k = s.kind + '|' + (s.agent || '') + '|' + (s.intent || ''), last = runs[runs.length - 1]; if (last && last.k === k) last.n++; else runs.push({ k, s, n: 1 }); });
    /* a lesson is its sentence plus one faint line: why it was learned, and when. Pause, edit and forget wait for a hover */
    const lessonHtml = (x) => { const st = x.steps?.[0], why = x.why?.[0] || (st?.title ? `From “${String(st.title).slice(0, 60)}”` : `When you ${st?.step || 'acted'}`);
      return `<article class="lx-item${x.on ? '' : ' off'}"><div class="lx-body">
        <p class="lx-text" data-lx-text="lesson:${x.id}">${esc(x.kind === 'you' ? youVoice(x.text) : x.text)}</p>
        <p class="lx-src">${x.on ? '' : '<span class="lx-paused">Paused</span>'}${esc(why)} · ${ago(x.at)}${x.n > 1 ? ` · seen ${x.n}×` : ''}</p></div>
        <div class="lx-ctl">${lxSw(x.on, 'data-ls-on', x.id, 'Use this lesson')}${lxTools('lesson', x.id)}</div></article>`; };
    const lxDir = (m) => { const n = (x) => parseFloat(String(x).replace(/[^\d.]/g, '')); const a = n(m.before), b = n(m.after), p = String(m.change || '').replace(/^[+−-]/, ''); return Number.isFinite(a) && Number.isFinite(b) && a !== b ? `${b < a ? '↓' : '↑'} ${p}` : p; };
    const movedHtml = (x) => { const r = x.results[0]; return `<article class="lx-item lx-moved${x.on ? '' : ' off'}${r.win ? ' is-win' : ' is-flat'}">
        <div class="lx-body"><div class="lx-meta"><span class="lx-tag ${r.win ? 'is-you' : 'is-warn'}">${r.win ? 'Moved the number' : 'Didn’t move it'}</span><span>From “${esc(String(x.steps?.[0]?.title || '').slice(0, 56))}” · ${ago(x.at)}${x.results.length > 1 ? ` · confirmed by ${x.results.length} results` : ''}</span></div>
        <p class="lx-text" data-lx-text="lesson:${x.id}">${esc(x.kind === 'you' ? youVoice(x.text) : x.text)}</p>
        <div class="lx-res">${x.results.slice(0, 3).map((m) => `<div class="lx-m"><small>${esc(m.metric)}${m.where ? ` · ${esc(m.where)}` : ''}${m.window ? ` · ${m.window} days` : ''}</small><span><b>${esc(m.before)}</b>${ic('right', 's14')}<b class="${m.win ? 'up' : 'flat'}">${esc(m.after)}</b><em>${esc(lxDir(m))}</em><i>target ${esc(m.target)}</i></span></div>`).join('')}</div></div>
        <div class="lx-ctl">${lxSw(x.on, 'data-ls-on', x.id, 'Use this lesson')}${lxTools('lesson', x.id)}</div></article>`; };
    const ruleHtml = (r) => `<article class="lx-item${r.on ? '' : ' off'}">
        <div class="lx-body"><div class="lx-meta"><span class="lx-tag is-rule">${r.source === 'you' ? 'You taught it' : r.source === 'jam' ? `From ${r.n} jam answers` : /Brew|deploy/i.test(r.source || '') ? `From ${r.n} ShopOS team changes` : `From ${r.n} of your edits`}</span><span>${ago(r.createdAt)}</span></div>
        <p class="lx-text" data-lx-text="rule:${r.id}">${esc(r.text)}</p>
        ${r.example ? `<div class="lx-ex"><span class="lx-b">${esc(r.example.before)}</span>${ic('right', 's14')}<span class="lx-a">${esc(r.example.after)}</span></div>` : ''}</div>
        <div class="lx-ctl">${lxSw(r.on, 'data-ln-on', r.id, 'Follow this rule')}${lxTools('rule', r.id)}</div></article>`;
    const checkHtml = (a) => `<article class="lx-item${a.on ? '' : ' off'}"><div class="lx-body"><div class="lx-meta"><span class="lx-tag is-rule">Answered the same in ${a.n} jams</span></div><p class="lx-text">${esc(a.q)}</p><p class="lx-why">${ic('check', 's14')}<span>It answers “${esc(a.answer)}” by itself now</span></p></div>
        <div class="lx-ctl">${lxSw(a.on, 'data-ln-on', a.id, 'Use this check')}<span class="lx-tools"><button class="linkbtn" data-lx-forget="rule:${a.id}">Forget</button></span></div></article>`;
    const forming = (xs, label) => xs.length ? `<div class="lx-forming"><h5>${label}</h5>${xs.map((f) => `<div class="lx-fr"><span>${esc(f.text || f.q)}</span><small class="lx-fr-n">${f.n} of ${L.promoteAt}</small>${lxMeter(f.n, L.promoteAt)}</div>`).join('')}</div>` : '';
    /* Heard: one quiet row into the full page, with the three biggest topics */
    const srcs = (heard?.sources || []).map((s) => (typeof s === 'string' ? { id: s, name: s, n: null } : s));
    const heardHtml = !heard ? '' : `<section class="lx-sec">${lxHead('lx-heard', 'What people say', '', '')}<button class="lx-heard-row" data-hd-open><span class="hd-stack">${srcs.slice(0, 3).map((s) => srcMark(s.id, s.name)).join('')}</span><span><b>${Number(heard.total ?? heard.items ?? 0).toLocaleString()} things people said</b><small>${srcs.slice(0, 3).map((s) => `${esc(s.name)}${s.n != null ? ` ${Number(s.n).toLocaleString()}` : ''}`).join(' · ')}${heard.at ? ` · read ${ago(heard.at)}` : ''}</small></span>${ic('right', 's16')}</button>
      ${(heard.failed || []).length ? `<p class="lx-failed">${ic('info', 's14')}Couldn’t read ${esc(heard.failed.map((x) => x.name).join(', '))} this time. What they said before still counts.</p>` : ''}
      ${(heard.themes || []).length ? `<div class="lx-topics">${heard.themes.slice(0, 4).map((t) => `<button class="hd-chip" data-hd-theme="${esc(t.name)}">${esc(topicCase(t.name))}<b>${t.n}</b></button>`).join('')}</div>` : ''}</section>`;
    /* the brand memory, grouped under plain headings; each line says where it came from in a few words, never raw ids */
    const MEM_T = [['what-works', 'What works'], ['voice', `How ${B.brand.name} sounds`], ['creative-style', 'How its ads look'], ['audience', 'Who buys'], ['products', 'Products'], ['offers', 'Offers'], ['channels', 'Where it sells'], ['rules', 'House rules']];
    const memSrc = (f) => { const ls = (f.sources || [f.source]).filter(Boolean).map((x) => String(x.label || '')), cnt = {}, other = [];
      ls.forEach((l) => { const k = /own meta ad/i.test(l) ? 'Meta ad' : /instagram/i.test(l) ? 'Instagram post' : /measured result/i.test(l) ? 'measured result' : /lesson/i.test(l) ? 'shipped work' : null; if (k) cnt[k] = (cnt[k] || 0) + 1; else other.push(l.replace(/,?\s*read \d{4}-\d\d-\d\d.*$/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim()); });
      const more = +((ls.join(' ').match(/\+(\d+)/) || [])[1] || 0);
      const parts = [...Object.entries(cnt).map(([k, n]) => (k === 'measured result' || k === 'shipped work' ? k : `${n + (k === 'Meta ad' || k === 'Instagram post' ? more : 0)} ${k}${n + more > 1 ? 's' : ''}`)), ...other.slice(0, 1)];
      const at = f.updatedAt || f.source?.at; return [parts[0] ? parts.join(', ') : '', at ? fmtDay(at) : ''].filter(Boolean).join(' · '); };
    const memGroups = MEM_T.map(([k, name]) => [name, memLines.filter((f) => f.topic === k).slice(0, 3)]).filter(([, xs]) => xs.length);
    const memHtml = memGroups.length ? `<details class="q-more"><summary>What Brew knows about ${esc(B.brand.name)}</summary>
      ${memGroups.map(([name, xs]) => `<div class="mem-g"><h4>${esc(name)}</h4>${xs.map((f) => `<div class="mem-l"><p>${esc(f.text)}</p><small>${esc(memSrc(f))}</small></div>`).join('')}</div>`).join('')}</details>` : '';
    // the brand's own upcoming moments (its markets only), each with when Brew starts planning it
    const evs = (CAL?.events || []).slice(0, 4), dd = (t) => Math.round((new Date(t) - (SRV.clock || Date.now())) / 864e5);
    const calHtml = evs.length ? `<section class="lx-sec">${lxHead('lx-cal', 'Coming up', '', '')}
      <ul class="hd-cal">${evs.map((e) => { const d = dd(e.date), p = e.planAt ? dd(e.planAt) : null; return `<li><span class="hd-cal-d"><b>${new Date(e.date).toLocaleDateString([], { day: 'numeric' })}</b><small>${new Date(e.date).toLocaleDateString([], { month: 'short' })}</small></span><div><b>${esc(e.name)}</b><small>${d > 0 ? `in ${d} day${d === 1 ? '' : 's'}` : e.end && e.end !== e.date ? `on now, until ${new Date(e.end).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : 'today'}${d > 0 && p != null ? ` · ${p <= 0 ? (e.move ? 'move ready' : 'planning now') : `planning in ${p} day${p === 1 ? '' : 's'}`}` : ''}</small></div>${e.move?.n != null ? `<button class="linkbtn" data-goto-move="${e.move.n}">Open move</button>` : ''}</li>`; }).join('')}</ul></section>` : '';
    /* trust: one line while every agent sits at the same level; the list only once they differ */
    const tl = agents.map((a) => L.trust[a]), same = tl.length && tl.every((t) => t.level === tl[0].level && !t.clean);
    const trustHtml = !agents.length ? '' : same ? `<p class="q-note">${tl[0].level < tl[0].max ? `Every agent is at ${esc(tl[0].name)}: ${L.cleanToLevelUp} clean launches move one up, an undo moves it down.` : `Every agent is at the top level.`}</p>`
      : `<section class="lx-sec">${lxHead('lx-trust', 'How much it does alone', '', `${L.cleanToLevelUp} clean launches move an agent up.`)}<div class="lx-trust">${agents.map((a) => { const t = L.trust[a]; return `<div class="lx-tr">${face(a)}<div><div class="lx-tr-top"><b>${esc(AGENT[a])}</b><span>${esc(t.name)}</span></div>${lxMeter(t.level + 1, L.levels.length)}</div></div>`; }).join('')}</div></section>`;
    /* the moves: every plan Brew wrote for the brand, one quiet row into the full page */
    const mvAll = MVS?.moves || [], mvCore = mvAll.filter((m) => m.n >= 1 && m.n < 1000).length, mvWk = mvAll.filter((m) => m.n >= 1000).length, mvStale = UPS?.stale?.length || 0;
    /* while the moves are still being written, the row says how far along (one line and a thin bar), from the build status */
    const mvSt = GEN ? MVS?.status : null, mvBuilding = !!mvSt && !mvSt.done && !mvSt.error && !mvSt.cancelled;
    const movesHtml = mvAll.length || mvBuilding ? `<section class="lx-sec">${lxHead('lx-moves', 'The moves', '', '')}<button class="lx-heard-row" data-nav="moves"><span class="lg-ic">${ic('doc', 's16')}</span><span><b>${mvCore} move${mvCore === 1 ? '' : 's'} for ${esc(B.brand.name)}${mvWk ? `, plus ${mvWk} new this week` : ''}</b>${mvBuilding ? lxBuild(mvSt) : `<small>${mvStale ? `${mvStale} out of date · ` : ''}Every card in your feed comes from one of them</small>`}</span>${ic('right', 's16')}</button>${mvBuilding && mvSt.capped ? `<div class="lx-pro"><button class="btn btn-primary sm" data-mvpro>${PAYWALL ? 'Continue with Pro' : 'Write the rest'}</button></div>` : ''}</section>` : '';
    clearTimeout(lxBuild.t); if (mvBuilding) lxBuild.t = setTimeout(lxBuildPoll, 15e3);
    // What your team told Brew (brand-learnings.js, learned.json): goals, beliefs and facts from the calls, notes and emails the team added; about 6 show, the rest fold
    const told = TOLD?.told, toldRows = told ? [['essence', 'Essence'], ['goals', 'Goals and plans'], ['beliefs', 'Beliefs'], ['tried', 'What they tried'], ['facts', 'Facts they stated']].flatMap(([k, h]) => (told[k] || []).map((x) => ({ ...x, h }))) : [];
    // one heading per group (Goals, Beliefs, Facts), each line plain; with more than one source, each line names its own
    const oneSrc = (told?.sources || []).length <= 1, toldList = (xs) => xs.map((x, i) => `${i === 0 || xs[i - 1].h !== x.h ? `<h4>${esc(x.h)}</h4>` : ''}<div class="mem-l"><p>${esc(x.text)}</p>${oneSrc || !x.source ? '' : `<small>${esc(x.source)}</small>`}</div>`).join('');
    const TOLD_N = 4;
    const toldHtml = toldRows.length ? `<section class="lx-sec mem-g">${lxHead('lx-told', 'What your team told Brew', toldRows.length, `From ${oneSrc ? esc(told.sources?.[0]?.label || 'your team') : `${told.sources.length} calls, notes and emails`}. The moves follow these.`)}
      ${toldList(toldRows.slice(0, TOLD_N))}${toldRows.length > TOLD_N ? `<details class="q-more"><summary>${toldRows.length - TOLD_N} more</summary>${toldList(toldRows.slice(TOLD_N))}</details>` : ''}</section>` : '';
    const anyLearned = moved.length + lessons.length + L.rules.length + L.autoChecks.length + toldRows.length;
    /* ui=1: one row of what Brew holds, each tile opens its part; a tile with nothing in it never shows */
    const lxOverview = () => { const t = (attr, n, k, sub) => `<button class="lx-ov-t" ${attr}><b>${n}</b><span>${k}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
      const ppl = heard ? Number(heard.total ?? heard.items ?? 0) : 0, learnedN = moved.length + lessons.length;
      const tiles = [mvCore && t('data-nav="moves"', mvCore, 'Moves', mvWk ? `+${mvWk} this week` : mvStale ? `${mvStale} out of date` : 'Every card comes from one'),
        toldRows.length && t('data-lx-jump="lx-told"', toldRows.length, 'Team notes', 'Calls, notes and emails'),
        learnedN && t('data-lx-jump="lx-lessons"', learnedN, 'Lessons', 'From what you ship'),
        L.rules.length && t('data-lx-jump="lx-rules"', L.rules.length, L.rules.length === 1 ? 'Rule' : 'Rules', 'Every agent follows'),
        ppl && t('data-hd-open', ppl.toLocaleString(), 'Things people said', srcs.slice(0, 2).map((x) => x.name).join(', '))].filter(Boolean);
      return tiles.length ? `<div class="lx-ov">${tiles.join('')}</div>` : ''; };
    libShell('What Brew learned', 'From what you pick, edit and ship, and anything you drop on this page. Edit, pause or forget any of it.',
      `<div class="lx" data-m2-drop>${lxBook() + lxDropBig() + lxOverview()}
        ${mvBuilding ? movesHtml : ''}
        
        ${toldHtml}
        ${moved.length ? `<section class="lx-sec">${lxHead('lx-moved', 'What moved the number', moved.length, '')}${moved.map(movedHtml).join('')}</section>` : ''}
        ${(() => { const you = lessons.filter((x) => x.kind === 'you'), br = lessons.filter((x) => x.kind !== 'you');
          if (!you.length && !br.length && !moved.length) return ''; /* no lessons yet: no empty section (quiet rule, QA UI 20 Oct) */
          return `${you.length ? `<section class="lx-sec">${lxHead('lx-lessons', 'How you work', you.length, '')}${you.map(lessonHtml).join('')}</section>` : ''}${br.length ? `<section class="lx-sec">${lxHead('lx-lessons-b', `What it learned about ${esc(B.brand.name)}`, br.length, '')}${br.map(lessonHtml).join('')}</section>` : ''}`; })()}
        <section class="lx-sec">${lxHead('lx-rules', 'Rules', L.rules.length || '', L.rules.length ? '' : `Teach one, or edit the same way ${L.promoteAt} times and it becomes one.`)}
          ${L.rules.map(ruleHtml).join('')}<form class="lx-teach" id="ln-teach">${ic('plus', 's16')}<input id="ln-in" placeholder="Teach a rule, e.g. never say ‘guaranteed’" autocomplete="off" aria-label="Teach a rule"><button class="btn sm">Add</button></form>${forming(L.forming, 'Forming from your edits')}</section>
        ${L.autoChecks.length || L.questions.length ? `<section class="lx-sec">${lxHead('lx-checks', 'Questions it answers itself', L.autoChecks.length || '', '')}${L.autoChecks.map(checkHtml).join('')}${forming(L.questions, 'On their way')}</section>` : ''}
        ${heardHtml}${calHtml}
        ${L.exemplars.length ? `<section class="lx-sec">${lxHead('lx-wins', 'Winners it learns from', L.exemplars.length, '')}${L.exemplars.map((x) => { const tt = lxCopy(x.title), sb = lxCopy(x.sub); return `<div class="lx-win">${face(x.agent)}<div><b>${esc(tt)}</b>${sb && !sb.startsWith(tt) ? `<span>${esc(sb)}</span>` : ''}<small>${esc(AGENT[x.agent] || '')} · ${ago(x.at)}</small></div></div>`; }).join('')}</section>` : ''}
        ${trustHtml}
        ${'' /* "What Brew knows about <brand>" (memHtml) and "What it read lately" (runs) are hidden (Param, 2026-10-16) */}
      </div>`);
    $('#col')?.classList.add('lib-col', 'lx-col');
    $$('[data-hd-open]').forEach((b) => b.addEventListener('click', () => openHeard())); /* the overview tile and the row both open it */
    /* paused at the free spend cap: Pro carries the build on to every move */
    $('[data-mvpro]')?.addEventListener('click', (e) => { const b = e.currentTarget, go = async () => { const r = await api(`/api/brands/${mvSlug()}/pro`, {}); if (!r || r.error) { toast(r?.error || 'Pro couldn’t start the moves. Try again.'); return false; } return true; };
      if (!S.pro && PAYWALL) return openPlan('moves', go); const done = busyBtn(b, 'Starting…'); go().then((ok) => { done(); if (ok) { b.disabled = true; toast('Writing the rest of the moves.'); renderLearned(); } }); });
    $$('[data-hd-theme]').forEach((b) => b.onclick = () => openHeard({ theme: b.dataset.hdTheme }));
    $$('[data-goto-move]').forEach((b) => b.onclick = () => openMove(+b.dataset.gotoMove));
  };
  const renderLearned = () => renderLearned0();
  /* the Brand Book (brand-book.js), part of What Brew learned: the brand's whole profile, dressed in its own colours and type; edited in place, shared in one tap */
  const renderBrand = () => {
    view = 'brand'; counts(); document.body.classList.remove('deck-on'); $('#stk').innerHTML = ''; $('#notes').innerHTML = '';
    $('#view').innerHTML = '<div class="bb-host" id="bbk"></div>';
    if (!window.BrandBook) { $('#bbk').innerHTML = '<p class="lx-empty">The Brand Book didn’t load. Reload the page.</p>'; return; }
    window.BrandBook.render($('#bbk'), { slug: mvSlug(), api: tapi, toast, back: { nav: 'learned', label: 'What Brew learned' } });
  };
  /* ui=1: the big drop box on What Brew learned (the whole page still takes a drop) */
  /* the Brand Book sits at the top of what Brew learned: the brand's voice, look and own best work, in one place (brand-book.js) */
  const lxBook = () => `<button class="lx-book" data-nav="brand"><span class="lx-book-ic">${ic('palette')}</span><span><b>Brand Book</b><span>Your voice, words, look and best work in one place. Every ad, post and email Brew makes follows it. Add your own guidelines there.</span></span>${ic('right', 's16')}</button>`;
  const lxDropBig = () => `<div class="m2-drop lx-drop" data-m2-drop><span class="m2-up">${ic('upload')}</span><b>Drop anything here</b><span>Brand guides, past ads, product sheets, screenshots. Brew reads them and keeps what matters.</span><button class="lx-drop-btn" data-m2-pick>Upload files</button><input type="file" multiple hidden accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.tsv,.json,.png,.jpg,.jpeg,.webp,.mp4" data-m2-file></div>`;
  /* Drop anything here: pick or drop files, then say where they go (brand memory / my preferences).
     Brand memory reads every file (PDF, Word, PowerPoint, Excel and photos through the server, drop-read.js), shows the learnings
     draft to check, and on Save they reach the brief, Brew's memory, the moves they change and the feed (brand-learnings.js) */
  const DROP_TXT = /^text\/|json|csv|markdown/, DROP_IMG = /^image\/(png|jpeg|webp)$/;
  const dropRead = (f, how) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(null); r[how](f); });
  const isTxtFile = (f) => !DROP_IMG.test(f.type) && (DROP_TXT.test(f.type) || /\.(txt|md|markdown|csv|tsv|json)$/i.test(f.name));
  const dropMax = (f) => (/\.mp4$/i.test(f.name) ? 25e6 : DROP_IMG.test(f.type) ? 8e6 : 20e6);
  /* one file → its words, read on the server (drop/read); a photo or MP4 for the brand also joins its References there */
  const dropText = async (f, dest) => {
    if (f.size > dropMax(f)) return { error: `${f.name} is over ${Math.round(dropMax(f) / 1e6)} MB.` };
    const txt = isTxtFile(f), v = await dropRead(f, txt ? 'readAsText' : 'readAsDataURL'); if (v == null) return { error: `${f.name} didn’t open.` };
    return tapi('POST', `/api/brands/${encodeURIComponent(mvSlug())}/drop/read`, { dest, name: f.name, type: f.type, ...(txt ? { text: v } : { data: v }) }); };
  /* the review: groups in the order a strategy reads (plans first), each line with the words it rests on */
  const KIND_H = { goal: 'Goals and plans', belief: 'Beliefs and guardrails', fact: 'Facts', tried: 'What they tried', essence: 'Essence' };
  const dzKb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const dzClock = (ms) => { const s0 = Math.floor(ms / 1000); return `${Math.floor(s0 / 60)}:${String(s0 % 60).padStart(2, '0')}`; };
  const dzSame = (a, b) => { const f = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); return f(a) === f(b) || f(b).includes(f(a)); }; /* a quote that is the line itself adds nothing */
  const dzStep = (state, t, d = '') => `<li class="dz-step is-${state}"><span class="dz-dot">${state === 'done' ? ic('check', 's14') : state === 'on' ? '<brew-load class="spin"></brew-load>' : ''}</span><span><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span></li>`;
  /* the learnings reply (brand-learnings.js replyText): **headings**, "- " lines and plain lines */
  const dlReply = (t) => { const bold = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); let ul = false; const out = [];
    for (const ln of String(t).split('\n')) { const li = /^\s*-\s+(.*)$/.exec(ln); if (li) { if (!ul) { out.push('<ul>'); ul = true; } out.push(`<li>${bold(li[1])}</li>`); continue; }
      if (ul) { out.push('</ul>'); ul = false; } const h = /^\*\*(.+)\*\*$/.exec(ln.trim()); if (h) out.push(`<b class="dl-h">${esc(h[1])}</b>`); else if (ln.trim()) out.push(`<p>${bold(ln)}</p>`); }
    if (ul) out.push('</ul>'); return out.join(''); };
  const m2Drop = (files) => { files = [...files].slice(0, 8); if (!files.length) return;
    const dest = (k, icon, t, d) => `<button class="m2-dest" data-m2-dest="${k}">${ic(icon, 's18')}<span><b>${t}</b><small>${d}</small></span></button>`;
    const name1 = files.length === 1 ? files[0].name : `${files.length} files`;
    modal(`<div class="sheet m2-sheet"><header class="sh-h dz-h"><span class="dz-ht"><b class="sh-t">${esc(name1)}</b><small class="dz-sub">${files.length === 1 ? dzKb(files[0].size) : files.map((f) => esc(f.name)).join(', ')}</small></span><button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header><div class="m2-body"><p class="m2-q">Where should this go?</p>${dest('memory', 'book', 'Add to brand memory', 'Brew reads it, you check what it learned, then the brief, moves and feed follow.')}${dest('prefs', 'person', 'Save to my preferences', 'Shapes what the feed shows me, not what the brand says.')}</div></div>`, (m) => {
      const sheet = $('.m2-sheet', m), body = $('.m2-body', m), paint = (html, foot = '') => { body.innerHTML = html; $('.dz-foot', sheet)?.remove(); if (foot) sheet.insertAdjacentHTML('beforeend', `<footer class="dz-foot">${foot}</footer>`); };
      const head = (t, sub) => { $('.sh-t', sheet).textContent = t; $('.dz-sub', sheet).textContent = sub || ''; };
      const after = () => { if (['learned', 'rules'].includes(document.body.dataset.m2) || view === 'learned') renderLearned(); if (view === 'tune') renderTune(); };
      const say = (text) => tapi('POST', `/api/brands/${encodeURIComponent(mvSlug())}/learnings/answer`, { text });
      /* the result: what changed in the brief, the moves and the feed, each in its own block */
      const answered = (r) => { const c = r.changed; sheet.classList.add('is-wide'); body.scrollTop = 0;
        if (!c) { head(r.cancelled ? 'Nothing saved' : 'Nothing new to save', ''); return paint(`<div class="dz-reply">${dlReply(r.reply || '')}</div>`, `<span></span><button class="btn btn-primary sm" data-close>Done</button>`); }
        head(`Saved to ${B.brand.name}’s brand context`, `${c.learned} learning${c.learned === 1 ? '' : 's'}${c.again ? ` · ${c.again} it already knew` : ''}${c.conflicts ? ` · ${c.conflicts} left to the fact sheet` : ''}`);
        const mv = (x) => `<li><span class="dz-mn">${esc(mvNum(x.n))}</span><span>${esc(x.title || mvLabel(x.n))}</span></li>`, t = (x) => `<li><span>${esc(x.title || x)}</span>${x.why ? `<small>${esc(x.why)}</small>` : ''}</li>`;
        const moves = [c.rewrite.length ? `<p class="dz-k">${c.queued ? 'Rewriting next, after the work running now' : 'Rewriting now'} · ${c.rewrite.length}</p><ul class="dz-ul">${c.rewrite.map(mv).join('')}</ul>` : '',
          r.pending ? `<p class="dz-k">${r.pending.all} moves change with this</p><p class="dz-note">Rewrite all of them, or the ${r.pending.top} that matter most within this upload’s budget.</p><div class="dz-acts"><button class="btn btn-primary sm" data-dl-say="go ahead">Rewrite all ${r.pending.all}</button><button class="btn btn-ghost sm" data-dl-say="just the top ones">Just the top ${r.pending.top}</button></div>` : '',
          c.weekly.length ? `<details class="dz-more"><summary>${c.weekly.length} more in the weekly run</summary><ul class="dz-ul">${c.weekly.map(mv).join('')}</ul></details>` : '',
          c.fresh ? `<p class="dz-k">New moves · up to ${c.fresh}</p><p class="dz-note">Written from this in a few minutes, once the rewrite is in.</p>` : c.freshWhy ? `<p class="dz-note">New moves from this ${esc(c.freshWhy)}.</p>` : '',
          c.rewriteError ? `<p class="dz-note is-warn">The rewrite can’t start now: ${esc(c.rewriteError)}. The moves are marked on the Moves tab.</p>` : ''].join('') || '<p class="dz-note">No move needed changing.</p>';
        const feed = [c.add.length ? `<p class="dz-k">New on your feed · ${c.add.length}</p><ul class="dz-ul">${c.add.map(t).join('')}</ul>` : '', c.up.length ? `<p class="dz-k">Moved to the top · ${c.up.length}</p><ul class="dz-ul">${c.up.map(t).join('')}</ul>` : '', c.hide.length ? `<p class="dz-k">Off the top · ${c.hide.length}</p><ul class="dz-ul">${c.hide.map(t).join('')}</ul>` : ''].join('') || `<p class="dz-note">${c.rewrite.length || r.pending ? 'The feed reorders as the rewritten moves land.' : 'No card needed to move.'}</p>`;
        paint(`<div class="dz-res"><section class="dz-card"><h4>${ic('book', 's16')}Brief and memory</h4><p class="dz-note">Every move, card and jam reads these now, each with its source. They sit on this page under What the team told Brew.</p></section>
          <section class="dz-card"><h4>${ic('layers', 's16')}Moves</h4>${moves}</section><section class="dz-card"><h4>${ic('feed', 's16')}Your feed</h4>${feed}<p class="dz-note">Cards built on this carry “From what your team told Brew”.</p></section></div>`,
          `<span></span><button class="btn btn-ghost sm" data-close>Done</button><button class="btn btn-primary sm" data-dz-feed>Open the feed</button>`);
        loadFeed().catch(() => {}); after();
        $('[data-dz-feed]', sheet)?.addEventListener('click', () => { closeModal(); location.hash = ''; location.reload(); });
        $$('[data-dl-say]', body).forEach((b) => (b.onclick = async () => { const done = busyBtn(b, 'Starting…'); const x = await say(b.dataset.dlSay); done(); if (x.error) return toast(esc(x.error)); toast(`${ic('check', 's16')}${esc(String(x.reply || '').split('\n')[0])}`); b.closest('.dz-acts')?.remove(); })); };
      /* the review: every line kept unless unticked, editable in place, with the words it rests on */
      const showDraft = (r, notes) => { const d = r.draft, gone = new Set(), edits = new Map(), n = d.items.length; sheet.classList.add('is-wide');
        head(`What Brew learned from ${files.length === 1 ? files[0].name : `${files.length} files`}`, `${n} learning${n === 1 ? '' : 's'}${d.chars ? ` from ${d.chars.toLocaleString('en-US')} characters` : ''}${d.again ? ` · ${d.again} it already knew left out` : ''} · nothing saved yet`);
        const ks = Object.keys(KIND_H).filter((k) => d.items.some((x) => x.kind === k));
        const row = (x, i) => `<li class="dz-row" data-i="${i + 1}"><button class="dz-tog" role="checkbox" aria-checked="true" aria-label="Keep line ${i + 1}" data-dz-tog>${ic('check', 's14')}</button><span class="dz-n" aria-hidden="true">${i + 1}</span><div class="dz-txt"><p class="dz-t" data-dz-t>${esc(x.text)}</p>${x.quote && !dzSame(x.quote, x.text) ? `<p class="dz-q">“${esc(x.quote)}”</p>` : ''}</div><button class="dz-ed" data-dz-ed>Edit</button></li>`;
        paint(`${notes}${d.replace ? '<p class="dz-note">Brew saved this upload before. Change what it keeps, then Save.</p>' : ''}${d.clipped ? `<p class="dz-note">It was long, so Brew read the first ${d.clipped.toLocaleString('en-US')} characters.</p>` : ''}
          <nav class="dz-chips">${ks.map((k) => `<a href="#dz-${k}" data-dz-jump="${k}">${KIND_H[k]}<b>${d.items.filter((x) => x.kind === k).length}</b></a>`).join('')}</nav>
          ${ks.map((k) => `<section class="dz-sec" id="dz-${k}"><header><h4>${KIND_H[k]}</h4><button class="linkbtn" data-dz-all="${k}">Untick all</button></header><ul>${d.items.map((x, i) => [x, i]).filter(([x]) => x.kind === k).map(([x, i]) => row(x, i)).join('')}</ul></section>`).join('')}
          ${d.conflicts?.length ? `<section class="dz-sec"><header><h4>Left out: the fact sheet wins on numbers</h4></header>${d.conflicts.map((c) => `<p class="dz-note">It says ${esc(c.says)}; ${esc(c.label || 'the fact sheet')} reads ${esc(String(c.v))}${c.src ? ` from ${esc(c.src)}` : ''}.</p>`).join('')}</section>` : ''}`,
          `<p class="dz-why">Save updates the brief, rewrites the moves this changes and reorders your feed.</p><button class="btn btn-ghost sm" data-dl-cancel>Cancel</button><button class="btn btn-primary sm" data-dl-save>Save ${n}</button>`);
        body.scrollTop = 0;
        const sync = () => { const k = n - gone.size, b = $('[data-dl-save]', sheet); b.textContent = k ? `Save ${k}${gone.size ? ` of ${n}` : ''}` : 'Nothing to save'; b.disabled = !k;
          $$('[data-dz-all]', body).forEach((a) => { const rows = $$(`#dz-${a.dataset.dzAll} .dz-row`, body); a.textContent = rows.every((r0) => gone.has(+r0.dataset.i)) ? 'Tick all' : 'Untick all'; }); };
        const set = (li, on) => { const i = +li.dataset.i; if (on) gone.delete(i); else gone.add(i); li.classList.toggle('is-off', !on); $('[data-dz-tog]', li).setAttribute('aria-checked', String(on)); };
        body.onclick = (e) => { const tg = e.target.closest('[data-dz-tog]'); if (tg) { const li = tg.closest('.dz-row'); set(li, li.classList.contains('is-off')); return sync(); }
          const al = e.target.closest('[data-dz-all]'); if (al) { const rows = $$(`#dz-${al.dataset.dzAll} .dz-row`, body), on = rows.every((r0) => gone.has(+r0.dataset.i)); rows.forEach((r0) => set(r0, on)); return sync(); }
          const jp = e.target.closest('[data-dz-jump]'); if (jp) { e.preventDefault(); $(`#dz-${jp.dataset.dzJump}`, body)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
          const ed = e.target.closest('[data-dz-ed]'); if (ed) { const t = $('[data-dz-t]', ed.closest('.dz-row')); t.contentEditable = 'true'; t.classList.add('is-editing'); t.focus(); const rg = document.createRange(); rg.selectNodeContents(t); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(rg); } };
        body.addEventListener('keydown', (e) => { const t = e.target.closest?.('[data-dz-t].is-editing'); if (!t) return; if (e.key === 'Enter') { e.preventDefault(); t.blur(); } if (e.key === 'Escape') { e.stopPropagation(); t.textContent = d.items[+t.closest('.dz-row').dataset.i - 1].text; t.blur(); } });
        body.addEventListener('focusout', (e) => { const t = e.target.closest?.('[data-dz-t].is-editing'); if (!t) return; t.contentEditable = 'false'; t.classList.remove('is-editing'); const i = +t.closest('.dz-row').dataset.i, v = t.textContent.replace(/\s+/g, ' ').trim();
          if (v && v !== d.items[i - 1].text) { edits.set(i, v); t.closest('.dz-row').classList.add('is-edited'); } else { t.textContent = d.items[i - 1].text; edits.delete(i); t.closest('.dz-row').classList.remove('is-edited'); } });
        $('[data-dl-cancel]', sheet).onclick = async () => { await say('cancel'); closeModal(); toast('Nothing was saved.'); };
        $('[data-dl-save]', sheet).onclick = async (e) => { const done = busyBtn(e.currentTarget, 'Saving…');
          for (const [i, v] of edits) if (!gone.has(i)) { const x = await say(`change ${i} to ${v}`); if (x.error) { done(); return toast(esc(x.error)); } } /* edits first: dropping renumbers the lines */
          if (gone.size) { const x = await say(`drop ${[...gone].sort((a, b) => a - b).join(' ')}`); if (x.error) { done(); return toast(esc(x.error)); } }
          head('Saving', 'Updating the brief, finding the moves this changes and reordering your feed'); paint(`<ol class="dz-steps">${dzStep('done', 'Brief and memory')}${dzStep('on', 'Finding the moves this changes', 'Brew reads every move against what you saved')}${dzStep('todo', 'Reordering your feed')}</ol>`);
          const x = await say('save'); done(); if (x.error) { head('That didn’t save', ''); return paint(`<p class="dz-note is-warn">${esc(x.error)}</p>`, `<span></span><button class="btn btn-primary sm" data-close>Close</button>`); } answered(x); }; sync(); };
      $$('[data-m2-dest]', m).forEach((b) => (b.onclick = async () => { const d = b.dataset.m2Dest; $$('[data-m2-dest]', m).forEach((x) => (x.disabled = true)); b.classList.add('is-busy');
        /* brand memory: read every file, then one learnings draft for all of them; steps and a clock while it works */
        if (d === 'memory') {
          const st = files.map((f) => ({ f, note: dzKb(f.size) })), t0 = Date.now(); let phase = 'read', timer = null;
          const slow = files.some((f) => !isTxtFile(f) && !/\.(docx|pptx|xlsx)$/i.test(f.name));
          const draw = () => { if (!document.body.contains(body)) return clearInterval(timer);
            paint(`<ol class="dz-steps">${dzStep(phase === 'read' ? 'on' : 'done', files.length === 1 ? 'Reading the file' : `Reading ${files.length} files`, st.map((x) => `${esc(x.f.name)} · ${esc(x.note)}`).join('<br>'))}${dzStep(phase === 'learn' ? 'on' : phase === 'read' ? 'todo' : 'done', 'Pulling out what Brew should learn', 'Goals and plans, beliefs, facts and what they tried')}${dzStep('todo', 'You check it, then save')}</ol>
              <p class="dz-clock">${dzClock(Date.now() - t0)}<small>${slow ? 'PDFs and photos take a minute or two. You can leave this open.' : 'Usually under a minute.'}</small></p>`); };
          head('Reading what you dropped', 'Nothing is saved until you check it'); draw(); timer = setInterval(draw, 1000);
          const texts = [], bad = []; let refs = 0;
          for (const x of st) { x.note = 'reading…'; const r = await dropText(x.f, 'memory');
            if (r?.team) { clearInterval(timer); closeModal(); return toast(esc(r.error)); }
            if (r?.error) { x.note = 'couldn’t read it'; bad.push(`${x.f.name}: ${r.error}`); } else { x.note = r.ref && !r.ref.error ? 'read · added to References' : 'read'; if (r.ref && !r.ref.error && !r.ref.same) refs++; if (r.text) texts.push(`--- ${x.f.name} ---\n${r.text}`); } }
          const notes = `${refs ? `<p class="dz-note">${ic('check', 's14')}${refs} picture${refs === 1 ? '' : 's'} added to References, so new pictures and videos can work from ${refs === 1 ? 'it' : 'them'}.</p>` : ''}${bad.length ? `<p class="dz-note is-warn">${bad.map(esc).join('<br>')}</p>` : ''}`;
          if (!texts.length) { clearInterval(timer); head('Nothing to learn from', ''); paint(notes || '<p class="dz-note">There was nothing in it to read.</p>', `<span></span><button class="btn btn-primary sm" data-close>Done</button>`); if (refs) after(); return; }
          phase = 'learn'; draw();
          const r = await tapi('POST', `/api/brands/${encodeURIComponent(mvSlug())}/drop`, { dest: 'memory', text: texts.join('\n\n'), files: files.map((f) => f.name) }); clearInterval(timer);
          if (r?.error) { closeModal(); sound('error'); return toast(esc(r.error)); }
          if (!r.learn) { closeModal(); toast(`${ic('check', 's16')}Added to brand memory`); return after(); } /* the demo site: a direct memory note */
          sound('ready'); if (r.draft?.items?.length && !r.saved) return showDraft(r, notes);
          return answered(r); /* nothing new in it, or already saved */
        }
        /* my preferences: the words of a PDF, Word, PowerPoint or Excel file; a photo or text file as before */
        let r = null; const skipped = []; let cut = false;
        for (const f of files) { const img = DROP_IMG.test(f.type), txt = isTxtFile(f);
          if (img && f.size > 8e6) { skipped.push(f.name); continue; }
          let body0 = null;
          if (img || txt) { const v = await dropRead(f, img ? 'readAsDataURL' : 'readAsText'); if (v == null) { skipped.push(f.name); continue; } body0 = img ? { data: v } : { text: v }; }
          else { const x = await dropText(f, d); if (x?.error || !x?.text) { skipped.push(f.name); continue; } body0 = { text: x.text }; }
          r = await tapi('POST', `/api/brands/${encodeURIComponent(mvSlug())}/drop`, { dest: d, name: f.name, ...body0 }); if (r?.error) break; if (r?.cut) cut = true; }
        if (!r && skipped.length) { closeModal(); return toast(`Brew couldn’t read ${esc(skipped.join(', '))}. It reads PDF, Word, PowerPoint, Excel, text files and photos (PNG, JPG, WebP).`); }
        closeModal(); if (!r || r.error) { sound('error'); return toast(esc(r?.error || 'That didn’t save. Try again.')); }
        sound('ready'); toast(`${ic('check', 's16')}Saved to your preferences${cut ? '. It was long, so Brew kept the first 4,000 characters' : ''}${skipped.length ? `. Couldn’t read ${esc(skipped.join(', '))}` : ''}`); if (d === 'prefs') { loadFeed().catch(() => {}); after(); } })); }); };
  document.addEventListener('click', (e) => { const pk = e.target.closest('[data-m2-pick]'); if (pk) { (pk.closest('.m2-drop') || pk.parentElement)?.querySelector('[data-m2-file]')?.click(); } });
  document.addEventListener('change', (e) => { if (e.target.matches?.('[data-m2-file]')) { m2Drop(e.target.files); e.target.value = ''; } });
  ['dragover', 'dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { const z = e.target.closest?.('[data-m2-drop]'); if (!z) return; e.preventDefault(); z.classList.toggle('is-over', ev === 'dragover'); if (ev === 'drop') sound('send'), m2Drop(e.dataTransfer?.files || []); }));
  /* Your feed: what Brew picked up from your hearts and saves, your seat, and Tune (per-agent weights land with the tuning API) */
  /* Your feed: what Brew picked up from your choices (each one can be dropped), topics, each agent Less / Normal / More,
     your saved preferences, and your seat. /api/tenants/:t/tuning; ranking moves an agent ±4 and a topic +2 */
  const TU = { d: null };
  const renderTune = async () => { view = 'tune'; const R = ROLE();
    const tuT = 'Your feed', tuS = 'What Brew shows you more and less of. Only you see this.';
    if (!TU.d) libShell(tuT, tuS, loader('Opening your feed settings'));
    const r = await tapi('GET', '/api/tenants/:t/tuning'); if (view !== 'tune') return; if (r.error) { libShell(tuT, tuS, `<p class="lx-empty">${esc(r.error)}</p>`); return; }
    TU.d = r; const tn = r.tuning || {}, sig = r.signals || [], W = r.weights || ['less', 'normal', 'more'];
    const ign = new Set(tn.ignored || []);
    libShell(tuT, tuS, `<section class="lx-sec">${lxHead('lx-picked', 'Picked up from your choices', sig.length || '', sig.length ? 'From your hearts, Not for me and Fewer. Drop any that are wrong.' : 'Heart, save or skip cards; Brew learns what to show you more of.')}
        ${sig.map((x) => `<div class="tu-sig${ign.has(x.id) ? ' is-off' : ''}"><span class="tu-k is-${esc(x.kind)}">${ic(x.kind === 'like' ? 'heart' : 'minus', 's14')}</span><span class="tu-t"><b>${esc(x.text)}</b>${x.why ? `<small>${esc(x.why)}</small>` : ''}</span>${ign.has(x.id) ? `<button class="linkbtn" data-tu-sigback="${esc(x.id)}">Use it again</button>` : `<button class="icon-btn" data-tu-sigx="${esc(x.id)}" aria-label="Stop counting this">${ic('x', 's16')}</button>`}</div>`).join('')}</section>
      <section class="lx-sec">${lxHead('lx-topics', 'Topics', (tn.topics || []).length || '', 'Cards about these come first.')}<form class="tu-add" data-tu-topic><input placeholder="Add a topic, e.g. sunscreen" maxlength="40" autocomplete="off"><button class="btn btn-ghost sm">Add</button></form>
        <div class="m2-chips">${(tn.topics || []).map((t) => `<span class="chip">${esc(t)}<button class="linkbtn" data-tu-topicx="${esc(t)}" aria-label="Remove ${esc(t)}">${ic('x', 's14')}</button></span>`).join('')}</div></section>
      <section class="lx-sec">${lxHead('lx-agents', 'Agents', '', 'How much each agent shows up in your feed.')}${(r.agents || []).map((a) => `<div class="tu-ag">${face(a.id)}<span class="tu-t"><b>${esc(a.name || AGENT[a.id])}</b></span><span class="tu-seg" role="radiogroup" aria-label="${esc(a.name)}">${W.map((w) => `<button role="radio" aria-checked="${(a.weight || 'normal') === w}" data-tu-w="${esc(a.id)}:${w}">${w[0].toUpperCase() + w.slice(1)}</button>`).join('')}</span></div>`).join('')}</section>
      ${(tn.notes || []).length ? `<section class="lx-sec">${lxHead('lx-prefs', 'My preferences', tn.notes.length, 'From what you dropped into My preferences.')}${tn.notes.map((n) => `<div class="tu-sig"><span class="tu-t"><b>${esc(n.text || n.name || '')}</b></span><button class="icon-btn" data-tu-notex="${esc(n.id)}" aria-label="Remove">${ic('x', 's16')}</button></div>`).join('')}</section>` : ''}
      ${tuSetup()}
      <section class="lx-sec">${lxHead('lx-seat', 'Your seat', '', '')}<button class="lx-heard-row" data-r2-tune>${face(R.face)}<span><b>${esc(R.name)}</b><small>Who the feed is for, what comes first and your focus</small></span>${ic('right', 's16')}</button></section>`);
    $('#col')?.classList.add('lib-col', 'tu-col'); };
  /* the reading screen's answers, changeable here (so "change it later" is true): moves a morning, channels, ads last month, and
     the brand's voice (the team's, so only for its people) */
  const TU_SET = { perDay: [[3, '3'], [5, '5'], [10, '10']], adPace: [['none', 'None'], ['few', 'A few'], ['ten', '10+'], ['always', 'Always on']], voice: [['site', 'Like our site'], ['warmer', 'Warmer'], ['sharper', 'Sharper'], ['plainer', 'Plainer']] };
  const TU_CH = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['google', 'Google'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['marketplace', 'Marketplaces']];
  const tuSetup = () => { const v = S.viewer, team = !!(window.LIVE?.me && window.LIVE.access?.role) && GEN; /* the voice saves for the brand's members only (brand-memory saveVoicePick) */
    const seg = (k, label, cur) => `<div class="tu-ag"><span class="tu-t"><b>${label}</b></span><span class="tu-seg" role="radiogroup" aria-label="${label}">${TU_SET[k].map(([x, t]) => `<button role="radio" aria-checked="${String(cur) === String(x)}" data-tu-v="${k}:${x}">${t}</button>`).join('')}</span></div>`;
    return `<section class="lx-sec">${lxHead('lx-setup', 'Your setup', '', 'From the questions while Brew read your store.')}
      ${seg('perDay', 'Moves a morning', v.perDay || '')}
      <div class="tu-ag"><span class="tu-t"><b>Channels you run</b><small>Every one you run. Cards for the others sit lower.</small></span><span class="tu-seg">${TU_CH.map(([x, t]) => `<button aria-pressed="${(v.channels || []).includes(x)}" data-tu-ch="${x}">${t}</button>`).join('')}</span></div>
      ${seg('adPace', 'Ads last month', v.adPace || '')}
      ${team ? seg('voice', 'Brand voice', v.voice || 'site') : ''}</section>`; };
  const tuPut = async (body) => { const r = await tapi('PUT', '/api/tenants/:t/tuning', body); if (r.error) return toast(esc(r.error)); TU.d = r; renderTune(); };
  document.addEventListener('click', async (e) => { if (view !== 'tune') return; const t = e.target;
    const sv = t.closest('[data-tu-v]'); if (sv) { const [k, v0] = sv.dataset.tuV.split(':'); S.viewer[k] = k === 'perDay' ? +v0 : v0; save(); if (k === 'voice') pushVoice(); return renderTune(); }
    const cv = t.closest('[data-tu-ch]'); if (cv) { const x = cv.dataset.tuCh, cur = S.viewer.channels || []; S.viewer.channels = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]; save(); tapi('PUT', '/api/tenants/:t/setup', { channels: S.viewer.channels }).catch(() => {}); return renderTune(); }
    const w = t.closest('[data-tu-w]'); if (w) { const [id, v] = w.dataset.tuW.split(':'); return tuPut({ weights: { ...(TU.d?.tuning?.weights || {}), [id]: v } }); }
    const tx = t.closest('[data-tu-topicx]'); if (tx) return tuPut({ topics: (TU.d?.tuning?.topics || []).filter((x) => x !== tx.dataset.tuTopicx) });
    const sx = t.closest('[data-tu-sigx]'); if (sx) { await tapi('DELETE', `/api/tenants/:t/tuning/signals/${encodeURIComponent(sx.dataset.tuSigx)}`); return renderTune(); }
    const sb = t.closest('[data-tu-sigback]'); if (sb) { await tapi('POST', `/api/tenants/:t/tuning/signals/${encodeURIComponent(sb.dataset.tuSigback)}/restore`); return renderTune(); }
    const nx = t.closest('[data-tu-notex]'); if (nx) { await tapi('DELETE', `/api/tenants/:t/tuning/notes/${encodeURIComponent(nx.dataset.tuNotex)}`); return renderTune(); } });
  document.addEventListener('submit', (e) => { const f = e.target.closest?.('[data-tu-topic]'); if (!f) return; e.preventDefault(); const v = $('input', f).value.trim(); if (!v) return;
    const cur = TU.d?.tuning?.topics || []; if (cur.length >= 12) return toast('Twelve topics at most. Remove one first.'); tuPut({ topics: [...cur.filter((x) => x.toLowerCase() !== v.toLowerCase()), v] }); });
  const lxPut = (kind, id, body) => tapi('PUT', kind === 'lesson' ? `/api/tenants/:t/learning/lessons/${id}` : `/api/tenants/:t/learning/rules/${id}`, body);
  const lxKeep = async () => { const y = window.scrollY; await renderLearned(); window.scrollTo(0, y); };
  document.addEventListener('click', async (e) => {
    if (view !== 'learned') return;
    const lsw = e.target.closest('[data-ls-on]'); if (lsw) { const v = lsw.getAttribute('aria-checked') !== 'true'; lsw.setAttribute('aria-checked', v); lsw.closest('.lx-item')?.classList.toggle('off', !v); await lxPut('lesson', lsw.dataset.lsOn, { on: v }); return lxKeep(); }
    const sw = e.target.closest('[data-ln-on]'); if (sw) { const v = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', v); sw.closest('.lx-item')?.classList.toggle('off', !v); await lxPut('rule', sw.dataset.lnOn, { on: v }); return lxKeep(); }
    const ed = e.target.closest('[data-lx-edit]'); if (ed) {
      const el = $(`[data-lx-text="${ed.dataset.lxEdit}"]`); if (!el) return; el.dataset.was = el.textContent; el.contentEditable = 'true'; el.classList.add('is-editing'); el.focus();
      const rg = document.createRange(); rg.selectNodeContents(el); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(rg); return;
    }
    const fg = e.target.closest('[data-lx-forget]'); if (fg) {
      const [kind, id] = fg.dataset.lxForget.split(':'); const item = fg.closest('.lx-item'); item?.classList.add('is-gone');
      await lxPut(kind, id, { forget: true }); toast(`${ic('check', 's16')}Forgotten. It won’t use that again.`); return lxKeep();
    }
    const j = e.target.closest('[data-lx-jump]'); if (j) { e.preventDefault(); document.getElementById(j.dataset.lxJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('[data-lx-all]')) { LX.all = !LX.all; return lxKeep(); }
  });
  // inline edit: Enter saves, Esc puts it back, leaving the field saves
  const lxSave = async (el) => {
    if (!el.classList.contains('is-editing')) return; el.classList.remove('is-editing'); el.contentEditable = 'false';
    const v = el.textContent.replace(/\s+/g, ' ').trim(), [kind, id] = el.dataset.lxText.split(':');
    if (!v || v === el.dataset.was) { el.textContent = el.dataset.was; return; }
    await lxPut(kind, id, { text: v }); toast(`${ic('check', 's16')}Saved. Every remix follows the new wording.`); lxKeep();
  };
  document.addEventListener('keydown', (e) => { const el = e.target.closest?.('.lx-text.is-editing'); if (!el) return; if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = el.dataset.was; el.blur(); } });
  document.addEventListener('focusout', (e) => { const el = e.target.closest?.('.lx-text.is-editing'); if (el) lxSave(el); });
  document.addEventListener('submit', async (e) => { if (e.target.id !== 'ln-teach') return; e.preventDefault(); const v = $('#ln-in').value.trim(); if (!v) return; await tapi('POST', '/api/tenants/:t/learning/rules', { text: v }); toast(`${ic('check', 's16')}Rule added. Every remix follows it now.`); lxKeep(); });

  /* =========================================================
     Jam: one drawer, three tabs. AI · a colleague on Slack · the ShopOS team.
     ========================================================= */
  const closeJam = () => { $('#jam')?.remove(); $('#jam-scrim')?.remove(); };
  const colleagueFor = (p) => colleague(p?.sector === 'creatives' || p?.sector === 'visibility' ? 'brandm' : p?.sector === 'ads' ? 'perf' : p?.sector === 'storefront' || p?.sector === 'catalog' ? 'ops' : 'growth');

  const openJam = (ctx) => window.JamRoom.openFromCtx(ctx); // the jam room (jam-room.js)

  /* =========================================================
     Stories
     ========================================================= */
  const storySets = () => RINGS ? Object.fromEntries(RINGS.map((x) => [x.k, x])) : {};
  let svT, svI = 0, svKey, svLeft = 0, svStart = 0, svDur = 0;
  const svAgo = (ms) => { const d = Math.floor((Date.now() - ms) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
  const fmtDate = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
  const closeStory = () => { clearTimeout(svT); $('#sv')?.remove(); };
  const openStory = (k) => {
    const rg = storySets()[k];
    if (!rg || !rg.slides.length) { toast(`${ic('clock', 's16')}${rg?.loading ? 'Your agents are researching this now. Back in a minute.' : 'Nothing here yet.'}`); return; }
    rg.seen = true; tapi('POST', `/api/tenants/:t/stories/${k}/seen`, { n: rg.slides.length });
    svKey = k; svI = 0; closeStory();
    const w = document.createElement('div'); w.className = 'sv'; w.id = 'sv'; document.body.appendChild(w);
    w.onclick = (e) => { if (e.target === w) closeStory(); };
    // swipe down to close, like Instagram: the story follows your finger, the backdrop fades, let go past a third (or flick) and it drops away
    { let y0 = 0, x0 = 0, t0 = 0, dy = 0, drag = false;
      const card = () => $('.sv-card', w);
      w.addEventListener('touchstart', (e) => { if (e.touches.length !== 1 || e.target.closest('.sv-btn,[data-svx],a')) return; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = Date.now(); dy = 0; drag = false; }, { passive: true });
      w.addEventListener('touchmove', (e) => { if (!t0) return; const t = e.touches[0]; dy = t.clientY - y0; const dx = t.clientX - x0;
        if (!drag && dy > 10 && dy > Math.abs(dx) * 1.2) { drag = true; w.classList.add('is-dragging'); }
        if (!drag) return; e.preventDefault(); const d = Math.max(0, dy), c = card();
        if (c) c.style.transform = `translateY(${d}px) scale(${Math.max(.86, 1 - d / 1600)})`; w.style.setProperty('--sv-bg', Math.max(0, .92 - d / 700).toFixed(3)); }, { passive: false });
      const end = () => { if (!t0) return; const v = dy / Math.max(1, Date.now() - t0), c = card(); t0 = 0;
        if (!drag) return; drag = false; w.dataset.dragged = '1'; setTimeout(() => delete w.dataset.dragged, 50); w.classList.remove('is-dragging');
        if (dy > innerHeight / 3 || (dy > 60 && v > .6)) { window.__sound?.('sheetDown'); w.classList.add('is-closing'); if (c) c.style.transform = `translateY(${innerHeight}px) scale(.86)`; w.style.setProperty('--sv-bg', 0); setTimeout(closeStory, 220); }
        else { if (c) c.style.transform = ''; w.style.removeProperty('--sv-bg'); } };
      w.addEventListener('touchend', end); w.addEventListener('touchcancel', end);
      // a drag is not a tap: don't let the release jump to the next slide
      w.addEventListener('click', (e) => { if (w.dataset.dragged) { e.stopPropagation(); e.preventDefault(); } }, true); }
    paintStory();
  };
  // one slide's media + text, by type
  /* every rival and news story ends on one line for the brand and one button (QA FEED-ARV-10): its take, else a line read from the story */
  const forUs = (sl) => { const t = sl.take || sl.forUs; return t ? `<p class="sv-take"><b>For ${esc(B.brand.name)}:</b> ${esc(t)}</p>` : ''; };
  const slideHtml = (s, sl) => {
    const src = (t) => `<div class="sv-src">${esc(t)}</div>`;
    if (sl.type === 'ad') return `${sl.video ? `<video src="${sl.video}" poster="${sl.poster}" autoplay muted playsinline loop></video>` : `<img src="${sl.poster}" alt="">`}
      <div class="sv-tx sv-ad">
        <span class="sv-chip">${rivalLogo(sl.brand, 16)}${esc(sl.brand)} · live ${sl.days} days · ${sl.versions} version${sl.versions > 1 ? 's' : ''}</span>
        <h3>${esc(sl.title)}</h3>
        ${sl.why ? `<p>${esc(sl.why)}</p>` : `<p>${esc(sl.headline)}</p>`}
        ${forUs(sl)}
        <div class="sv-acts"><button class="sv-btn pri" data-sv-card="ad" data-id="${esc(sl.id)}">${ic('sparkles', 's14')}Make our version</button></div>
        <div class="sv-src">${esc(`${s.source} · ${sl.total ? `${sl.brand} runs ${sl.total} ads · ` : ''}checked ${svAgo(s.updatedAt)}`)}${sl.url ? ` · <a href="${esc(sl.url)}" target="_blank" rel="noopener">See it in the Ad Library</a>` : ''}</div></div>`;
    if (sl.type === 'trend') {
      const W = 320, H = 150, cols = ['#fff', '#82B1FF', '#FFDDBF'];
      return `<div class="wash2 sv-dark"></div><div class="sv-tx sv-mid">
        <span class="sv-chip">Search interest${sl.where ? ` · ${esc(sl.where)}` : ''} · 7-day average</span><h3>${esc(sl.h)}</h3><p>${esc(sl.p)}</p>
        <svg class="sv-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Search interest, last 90 days">${(() => { const sm = sl.series.map((x) => smooth7(x.values)), all = sm.flat(); return sm.map((v, i) => `<path d="${sparkPath(v, W, H, 4, Math.max(...all, 1), 0)}" style="stroke:${cols[i]}"/>`).join(''); })()}</svg>
        <div class="sv-legend">${sl.series.map((x, i) => `<span><i style="background:${cols[i]}"></i>${esc(x.term)}${x.change != null ? ` <b>${x.change > 0 ? '+' : ''}${x.change}%</b>` : ''}</span>`).join('')}</div>
        <div class="sv-axis"><span>${fmtDate(sl.dates?.[0])}</span><span>${fmtDate(sl.dates?.[1])}</span></div>
        <div class="sv-acts"><button class="sv-btn pri" data-sv-card="trend" data-id="${esc(sl.id)}">${ic('sparkles', 's14')}Turn into an idea</button></div>
        ${src(`${s.source} · checked ${svAgo(s.updatedAt)}`)}</div>`;
    }
    if (sl.type === 'rising') return `<div class="wash2 sv-dark"></div><div class="sv-tx sv-mid">
        <span class="sv-chip">Rising searches${sl.where ? ` · ${esc(sl.where)}` : ''}</span><h3>${esc(sl.h)}</h3><p>${esc(sl.p)}</p>
        <ol class="sv-rise">${(sl.rising || []).map((r) => `<li><span>${esc(r.q)}</span><b>${esc(r.v)}</b></li>`).join('')}</ol>
        <div class="sv-acts"><button class="sv-btn pri" data-sv-card="trend" data-id="${esc(sl.id)}">${ic('sparkles', 's14')}Turn into an idea</button></div>
        ${src(`${s.source} · checked ${svAgo(s.updatedAt)}`)}</div>`;
    if (sl.type === 'news') return `${sl.img ? `<img src="${sl.img}" alt="">` : svBack(sl)}
      <div class="sv-tx"><span class="sv-chip"><img class="sv-fav" src="https://www.google.com/s2/favicons?domain=${esc(sl.domain)}&sz=32" alt="">${esc(sl.source || sl.domain)}${sl.date ? ` · ${fmtDate(sl.date)}` : ''}</span>
        <h3>${esc(sl.h)}</h3><p>${esc(sl.p)}</p>${forUs(sl)}
        ${sl.id ? `<div class="sv-acts"><button class="sv-btn pri" data-sv-card="news" data-id="${esc(sl.id)}">${ic('sparkles', 's14')}${esc(sl.cta || 'Turn into an idea')}</button></div>` : ''}
        <div class="sv-src">Found by web search · ${esc(svAgo(s.updatedAt))}${sl.url ? ` · <a href="${esc(sl.url)}" target="_blank" rel="noopener">Read the story</a>` : ''}</div></div>`;
    if (sl.type === 'brand') { const btn = sl.workId ? `<button class="sv-btn pri" data-sv-work="${esc(sl.workId)}">Review it ${ic('right', 's14')}</button>` : sl.cardId ? `<button class="sv-btn pri" data-sv-open="${esc(sl.cardId)}">${esc(sl.cta || 'Open the card')} ${ic('right', 's14')}</button>` : '';
      const hero = sl.pct != null ? `<div class="sv-hero stat svpg"><span><small>${esc(sl.st === 'Running' ? 'Done so far' : sl.st || 'Progress')}</small><b>${sl.pct}%</b></span><div class="sv-prog"><div style="width:${sl.pct}%"></div></div><em class="plain">${esc(AGENT[sl.agent] || '')}</em></div>` : sl.stat ? `<div class="sv-hero stat"><span><small>Before</small><b>${esc(sl.stat[0])}</b></span>${ic('right', 's18')}<span><small>Now</small><b>${esc(sl.stat[1])}</b></span><em>${esc(/^[+−-]/.test(sl.stat[2]) ? sl.stat[2] : (sl.win ? '+' : '') + sl.stat[2])}</em></div>` : `<div class="sv-hero">${face(sl.agent || 'brew')}<small>${esc(AGENT[sl.agent || 'brew'])}</small></div>`;
      return `${sl.img ? `<img src="${sl.img}" alt="">` : `${svBack(sl)}${hero}`}
      <div class="sv-tx"><span class="sv-chip">${sl.agent ? face(sl.agent) : ''}${esc(sl.chip)}</span><h3>${esc(sl.h)}</h3><p>${esc(sl.p)}</p>
        ${btn ? `<div class="sv-acts">${btn}</div>` : ''}${src(`${B.brand.name} · from your feed, work and results`)}</div>`; }
    if (sl.type === 'recap') { /* Recap: one slide per thing that moved since the last visit; every row opens the thing */
      const row = (r) => { const at = r.workId ? `data-sv-work="${esc(r.workId)}"` : r.cardId ? `data-sv-open="${esc(r.cardId)}"` : r.move != null ? `data-sv-move="${r.move}"` : '';
        return `<${at ? 'button' : 'div'} class="sv-rc${r.warn ? ' warn' : ''}${r.up === true ? ' up' : r.up === false ? ' down' : ''}" ${at}>${r.img ? `<img src="${esc(r.img)}" alt="">` : ''}<span><b>${esc(r.t)}</b>${r.s ? `<small>${esc(r.s)}</small>` : ''}</span>${at ? ic('right', 's14') : ''}</${at ? 'button' : 'div'}>`; };
      const body = sl.kind === 'summary' ? `<ul class="sv-tally">${(sl.tally || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
        : `${sl.p ? `<p>${esc(sl.p)}</p>` : ''}${(sl.rows || []).length > 1 || sl.conn || !(sl.rows || [])[0] ? `<div class="sv-rcs">${(sl.rows || []).map(row).join('')}</div>` : ''}`;
      const one = (sl.rows || []).length === 1 && !sl.conn ? sl.rows[0] : null;
      const btn = sl.conn ? `<button class="sv-btn pri" data-sv-conn>See your accounts ${ic('right', 's14')}</button>` : one?.workId ? `<button class="sv-btn pri" data-sv-work="${esc(one.workId)}">Open the jam ${ic('right', 's14')}</button>` : one?.cardId ? `<button class="sv-btn pri" data-sv-open="${esc(one.cardId)}">Open the card ${ic('right', 's14')}</button>` : one?.move != null ? `<button class="sv-btn pri" data-sv-move="${one.move}">Read the move ${ic('right', 's14')}</button>` : '';
      return `${sl.img ? `<img src="${esc(sl.img)}" alt="">` : `${svBack(sl)}${sl.big ? `<div class="sv-hero stat"><span><small>${esc(sl.bigLabel || '')}</small><b>${sl.big}</b></span></div>` : ''}`}
      <div class="sv-tx sv-recap"><span class="sv-chip">${esc(sl.chip)}</span><h3>${esc(sl.h)}</h3>${body}
        ${btn ? `<div class="sv-acts">${btn}</div>` : ''}${src(`${B.brand.name} · ${s.source || 'since your last visit'}`)}</div>`; }
    if (sl.type === 'howto') return `${sl.img ? `<img src="${sl.img}" alt="">` : svBack(sl)}
      <div class="sv-tx"><span class="sv-chip">How to · this week</span><h3>${esc(sl.h)}</h3><p>${esc(sl.p)}</p>
        <ol class="sv-steps">${sl.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <div class="sv-acts"><button class="sv-btn pri" data-sv-card="howto" data-id="${esc(sl.id)}">${ic('sparkles', 's14')}Start this</button></div>
        ${src(`${s.source}`)}</div>`;
    return `${sl.img ? `<img src="${sl.img}" alt="">` : svBack(sl)}
      <div class="sv-tx">${sl.from ? `<span class="sv-chip">${esc(sl.from)}</span>` : ''}<h3>${esc(sl.h)}</h3><p>${esc(sl.p)}</p></div>`;
  };
  /* a slide without its own photo: the product it talks about, faint behind the text, else a plain dark slide */
  const svBack = (sl) => sl.bg ? `<div class="sv-back"><img src="${esc(sl.bg)}" alt=""></div>` : '<div class="sv-back"></div>';
  const slideMs = (sl) => { const words = [sl.h, sl.title, sl.p, sl.why, sl.take, ...(sl.steps || [])].join(' ').split(/\s+/).length; return Math.min(15000, Math.max(5000, 2500 + words * 230)); };
  // story media: a blurred copy fills the card; tall media goes full-bleed, anything wider sits whole in a frame above the text
  const fitMedia = (card) => {
    const m = [...card.children].find((x) => x.matches('img,video')); if (!m) return;
    const src = m.tagName === 'VIDEO' ? m.poster : m.src;
    if (src) { const bg = document.createElement('img'); bg.className = 'sv-bg'; bg.src = src; bg.alt = ''; card.prepend(bg); }
    m.classList.add('sv-m');
    const place = () => {
      const iw = m.videoWidth || m.naturalWidth, ih = m.videoHeight || m.naturalHeight; if (!iw || !ih) return;
      const tx = $('.sv-tx', card), H = card.clientHeight, room = H - (tx ? tx.offsetHeight : 0) - 56 - 22 - 20;
      card.style.setProperty('--txh', (tx ? tx.offsetHeight : 200) + 'px');
      if (iw / ih <= .66 && room >= 300) { card.classList.add('m-full'); return; }
      // long text: the picture fills a band above the text and fades into it, instead of sitting under the words
      if (room < 160 || iw / ih <= .8) { m.style.height = (H - (tx ? tx.offsetHeight : 200) + 40) + 'px'; card.classList.add('m-band'); return; }
      const f = document.createElement('div'); f.className = 'sv-frame'; f.style.bottom = (H - 56 - room) + 'px';
      m.style.maxHeight = room + 'px'; m.replaceWith(f); f.appendChild(m); card.classList.add('m-framed');
      if (m.tagName === 'VIDEO') m.play?.().catch(() => {});
    };
    if (m.tagName === 'VIDEO') { if (m.readyState >= 1) place(); else m.addEventListener('loadedmetadata', place, { once: true }); }
    else if (m.complete && m.naturalWidth) place(); else m.addEventListener('load', place, { once: true });
  };
  const paintStory = () => {
    const s = storySets()[svKey], sl = s?.slides[svI], w = $('#sv'); if (!w || !sl) return closeStory();
    svDur = slideMs(sl); svLeft = svDur;
    w.innerHTML = `<div class="sv-card t-${sl.type || 'note'}" role="dialog" aria-label="${esc(s.title)}">${slideHtml(s, sl)}
      <div class="sv-bars">${s.slides.map((_, i) => `<i class="${i < svI ? 'done' : i === svI ? 'on' : ''}"><b style="animation-duration:${svDur}ms"></b></i>`).join('')}</div>
      <div class="sv-top">${face('brew')}${esc(s.title)}<span class="sv-n">${svI + 1} of ${s.slides.length}</span><button class="icon-btn" aria-label="Close" data-svx>${ic('x', 's18')}</button></div>
      <button class="sv-tap l" aria-label="Previous"></button><button class="sv-tap r" aria-label="Next"></button></div>`;
    const card = $('.sv-card', w);
    fitMedia(card);
    $('[data-svx]', w).onclick = closeStory;
    const next = () => { if (svI < s.slides.length - 1) { svI++; paintStory(); } else closeStory(); };
    const run = () => { clearTimeout(svT); svStart = Date.now(); svT = setTimeout(next, svLeft); card.classList.remove('paused'); };
    const pause = () => { clearTimeout(svT); svLeft = Math.max(0, svLeft - (Date.now() - svStart)); card.classList.add('paused'); };
    $('.sv-tap.r', w).onclick = next; $('.sv-tap.l', w).onclick = () => { svI = Math.max(0, svI - 1); paintStory(); };
    // hold anywhere to pause, like stories everywhere; hovering the buttons pauses too
    let held = 0;
    card.addEventListener('pointerdown', (e) => { if (e.target.closest('.sv-btn,[data-svx]')) return; held = setTimeout(() => { held = -1; pause(); }, 180); });
    card.addEventListener('pointerup', () => { if (held === -1) { card.dataset.justHeld = '1'; run(); } else clearTimeout(held); held = 0; }, true);
    card.addEventListener('click', (e) => { if (card.dataset.justHeld) { e.stopPropagation(); delete card.dataset.justHeld; } }, true);
    $$('.sv-acts', w).forEach((a) => { a.onmouseenter = pause; a.onmouseleave = run; });
    $$('[data-sv-card]', w).forEach((b) => b.onclick = async () => {
      pause(); b.disabled = true; b.innerHTML = '<brew-load class="spin"></brew-load>Opening…';
      const r = await tapi('POST', '/api/tenants/:t/research-card', { kind: b.dataset.svCard, id: b.dataset.id });
      if (!r.card) { toast('Could not open that one'); run(); return; }
      ALL[r.card.id] = r.card; closeStory();
      openCardJam(r.card); /* the story's card opens its jam on the card's plan, like every card action */
    });
    $$('[data-sv-open]', w).forEach((b) => b.onclick = () => { const p = byId(b.dataset.svOpen); closeStory(); if (p) openDetail(p); });
    $$('[data-sv-move]', w).forEach((b) => b.onclick = () => { const n = +b.dataset.svMove; closeStory(); openMove(n); });
    $$('[data-sv-conn]', w).forEach((b) => b.onclick = () => { closeStory(); renderConnectors(); });
    $$('[data-sv-work]', w).forEach((b) => b.onclick = () => { const id = b.dataset.svWork; closeStory(); renderWork(); setTimeout(() => $(`[data-witem="${id}"]`)?.click(), 400); });
    const v = $('video', w); if (v) v.play?.().catch(() => {});
    run();
  };

  /* ---------- go ---------- */
  // jam-room.js (the Jam Room) works from these
  window.__BREW = { sound: (k) => sound(k), openRefs: (r) => openRefs(r), shoposWho: 'the ShopOS team, Brew’s build crew', waNeed: (o) => waNeed(o), busyBtn: (b, l) => busyBtn(b, l), loader: (t, s2, z) => loader(t, s2, z), putCh: (ch) => putCh(ch), paintStudio: () => paintStudio(), modal: (h, b) => modal(h, b), closeModal: () => closeModal(), refreshAfterConnect: (id) => refreshAfterConnect(id), glyph: (id, n) => glyph(id, n), demoSheet: (h) => demoSheet(h), shareSheet: (p) => shareSheet(p), pageOf: (id) => PAGE[id] || null, studioCard: () => (view === 'remix' ? RX.p : null), studioV: () => (view === 'remix' && RX.ch ? curN(RX.ch) : null) /* the version on the jam's stage, for the sheets */, libAct, cxDone: (id) => $$(`[data-cxrow="${id}"]`).forEach((r) => (r.outerHTML = cxRow(id))), $, $$, esc, wait, ic, face, avatar, podFaces, brewAv, SO, movesTotal: () => +BREW?.total || 0, toast, toastLong, B, AGENT, save, ROLE, colleague, conn, cardOf, byId, tapi, putWork, counts, inrS, openConnect, openDetail, closeDetail, closePop, closeModal, modal, assetHtml, renderView, renderWork, workOfCard, pseudoPost, colleagueForCard,
    get S() { return S; }, get WORK() { return WORK; }, get view() { return view; }, setChange: (ch) => { if (DP && ch) DP.ch = ch; }, currentDetail: () => DP && (DP.w ? { ...DP.p, _work: DP.w, _ch: DP.ch || null } : DP.p), slotHtml, ago, repaintDetail: () => repaintDetail(true), detailDirty: () => !!DP?.dirty, fitKnobs, fitSuggest,
    /* the reading screen's questions (questions.js), canvas.js */ isRival, GEN, LANDING, DEMO_LAND, api, ls, LSP, get TID() { return TID; }, signWall, needSignin, ensureTenant, scrCard, seatEntries, defaultWants, loadFeed, rank, openRemix, openPlan, teamStep, finishOnboarding, checkRead, waitMoves, whoFor, continueToFeed, hashParams };
  // #setup replays onboarding (it only plays once otherwise, because finishing it is saved in this browser)
  const adoptShare = async () => { const tok = hashParams().s; if (!tok) return;
    const own = tok.split('~')[0]; if (own === TID) return;
    const r = await fetch(`/api/share/${encodeURIComponent(tok)}`).then((x) => x.json()).catch(() => ({ error: 'offline' }));
    /* a shared link needs a signed-in person: sign in, then land back on this exact jam */
    if (r.signin) { location.href = `/auth/google?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`; return new Promise(() => {}); }
    /* a teammate: it is the team's jam already, so it opens in their own workspace */
    if (r.member && r.jam) { history.replaceState(null, '', `${location.pathname}#jam=${encodeURIComponent(r.jam)}`); return; }
    if (!r.tenant) { toast(esc(r.error || 'That link has expired.')); return; }
    if (TID) ls.set(`${LSP()}tenant-own`, TID);
    TID = r.tenant; ls.set(`${LSP()}tenant`, TID); SHARE = tok;
    S.onboarded = true; if (r.viewer) S.viewer = { ...S.viewer, ...r.viewer }; S.conn = { ...(r.conn || {}) }; S.pro = !!r.pro; S.decided = { ...(r.decided || {}) };
    lastSync = stateKey(); ls.set(KEY, JSON.stringify(S));
    /* anyone can look; signing in makes them a guest of this one jam (never the whole team) */
    if (r.guest) ls.set(`${LSP()}guest`, '1'); /* the team wall lets them back in later without the link (signWall) */
    setTimeout(() => toast(r.guest ? `${ic('person', 's16')}You’re in this jam as a guest. You can chat, edit the brief and make drafts.` : r.signedIn ? `${ic('person', 's16')}You’re viewing ${esc(B.brand.name)}’s shared jam` : `${ic('person', 's16')}You’re viewing a shared jam. Sign in to take part.`), 900); };
  // real connected accounts (live.js) replace the demo numbers before anything renders
  if (window.BREW_DEMO && !LANDING) { document.body.insertAdjacentHTML('beforeend', `<button class="demo-pill" type="button" title="Demo controls (press .)" aria-label="Demo controls">${ic('sliders', 's14')}<span>Demo</span></button>`); $('.demo-pill').onclick = () => openDemo(); }
  Promise.resolve(window.LIVE_P).catch(() => null).then(() => {
  /* a brand wiped and read again is a new brand: what this browser saved for the old one (onboarding done, its workspace) goes,
     so the read, the check and the setup steps play again instead of opening straight onto the feed */
  const born = window.LIVE?.born; if (GEN && !LANDING && !window.BREW_DEMO && born && ls.get(`${LSP()}born`) !== String(born)) {
    if (ls.get(`${LSP()}born`) || S.onboarded || TID) { ['tenant', 'tenant-own', 'continue', 'v2', 'q1'].forEach((k) => ls.del(LSP() + k)); ls.del(KEY); S = fresh(); TID = null; lastSync = ''; }
    ls.set(`${LSP()}born`, String(born)); }
  window.LiveConn?.overlay(B, S); fitSeat(); save();
  /* ?go=feed (every Brew email, and invites as ?go=feed&joined=1): read before joined=1 strips the query. A signed-in person skips
     the read replay and the setup steps; the hash after it still applies (#check, #v=moves, #team, #jam=…) */
  const GO_FEED = /[?&]go=feed\b/.test(location.search); if (GO_FEED) { GO_LINK = true; const u0 = new URL(location.href); u0.searchParams.delete('go'); history.replaceState(null, '', u0.pathname + u0.search + u0.hash);
    if (GEN && !LANDING && window.LIVE?.me && !S.onboarded) { S.onboarded = true; save(); } }
  if (/[?&]joined=1/.test(location.search)) { history.replaceState(null, '', location.pathname + location.hash); setTimeout(() => toast(`${ic('check', 's14')}You’re on ${esc(B.brand.name)}’s team`), 600); }
  if (location.hash === '#team' && ['owner', 'admin'].includes(window.LIVE?.access?.role)) setTimeout(() => window.LiveConn?.teamSheet(), 700);
  const cxBack = /[#&]cx(err)?=/.test(location.hash) ? (() => { try { const k = `brew-cxback:${window.BRAND}`, v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch (e) { return null; } })() : null;
  if (hashParams().s) adoptShare().then(() => { if (S.onboarded) feed(); else start(); });
  else if (LANDING) start(); // the landing is only ever the paste-a-URL page
  else if (GEN && location.hash === '#check') ensureTenant(true).then(checkRead); // reopen "Is this right?"
  else if (GEN && location.hash === '#wait') ensureTenant(true).then(waitMoves);
  else if (GEN && cxBack === 'ob') ensureTenant(true).then(() => { view = 'ob'; connectWhat(); }); // back from a platform's sign-in: the step it left from
  else if (GEN && cxBack === 'check') ensureTenant(true).then(checkRead);
  else if (GEN && cxBack === 'wait') ensureTenant(true).then(waitMoves);
  /* a link from a Brew email (?go=feed) or to a jam or card (#jam=, #card=, #work=, #v=): a signed-in person goes straight there,
     never through the read replay and the setup steps again (those stay at #setup) */
  else if (GEN && location.hash !== '#setup' && (S.onboarded || window.LIVE?.me) && (GO_FEED || /^#(jam|card|work|v)=/.test(location.hash))) { if (!S.onboarded) { S.onboarded = true; save(); } ensureTenant().then(() => { fitSeat(); save(); feed(); }); }
  else if (S.onboarded && location.hash !== '#setup') feed(); else { const askedSetup = location.hash === '#setup'; if (askedSetup) history.replaceState(null, '', location.pathname); if (GEN && ls.get(`${LSP()}continue`)) { ls.del(`${LSP()}continue`); ensureTenant(true).then(afterRead); } else if (GEN && !askedSetup && OB_AT[S.obStep] && !S.onboarded) ensureTenant(true).then(resumeOb); /* a refresh mid-setup: the same step */ else if (GEN && !(window.BREW_DEMO && location.hash !== '#setup')) ensureTenant(true).then(setup); else start(); } /* the demo site's tour starts on the address screen */
  if (/[#&]cx(err)?=/.test(location.hash)) setTimeout(() => window.LiveConn?.resume(), 900); });
})();
