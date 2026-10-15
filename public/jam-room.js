/* The jam pane: the right side of the card page.
   Brief: one document anyone can type in. It starts as the card's own story (what it says, recommends, measures,
   what its moves say) and becomes the brief the next people work from. Chat: AI by default, @someone for a teammate
   or the ShopOS team. Anything on the left (a recommendation, a move passage, a selection) can be added to the brief.
   Design: the feed system's paper and tokens. No score, no locks, no effects; a quiet list of what's still missing. */
(() => {
  const A = window.__BREW; if (!A) return;
  const { $, $$, esc, ic, face, avatar, toast, AGENT } = A;
  const BNAME = () => window.FEED_DATA?.[window.BRAND]?.brand?.name || 'the brand'; // the brand this page is for
  const EARLY = ['drafting', 'team', 'needs_you', 'shared'];
  const JM = { cid: null, tab: 'brief', draft: '', busy: '', previews: {}, moves: {}, flash: [], saveT: null, confirm: null, menu: false, importing: false, focusIn: false };
  const DPx = () => A.currentDetail && A.currentDetail();
  const W = () => { const p = DPx(); return p?._work || null; };
  /* real people. The demo site keeps the simulated teammates (Dummy); everywhere else @ means a real person on the team */
  const DEMO = !!window.BREW_DEMO;
  const ME = () => window.LIVE?.me || window.LIVE?.user || null;
  const myEmail = () => String(ME()?.email || '').toLowerCase();
  const shortName = (p) => String(p?.name || p?.email || 'Someone').trim().split(/\s+/)[0].replace(/@.*/, '');
  const hue = (s) => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  const initials = (p) => (p?.name || p?.email || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
  const pAv = (p, n = 24) => p?.pic ? `<img class="av av-img" src="${esc(p.pic)}" alt="" referrerpolicy="no-referrer" style="width:${n}px;height:${n}px">` : `<span class="av" style="--ac:hsl(${hue(p?.email)} 38% 42%);width:${n}px;height:${n}px">${esc(initials(p))}</span>`;
  /* everyone this jam can tag: the team, people invited to it, and this jam's guests; never yourself */
  const realPeople = (w = W()) => { const me = myEmail(), seen = new Map(), add = (x, sub) => { const e = String(x.email || '').toLowerCase(); if (!e || e === me || seen.has(e)) return; seen.set(e, { k: e, email: e, name: x.name || e.replace(/@.*/, ''), sub, pic: x.pic || null, html: pAv({ ...x, email: e }, 20) }); };
    (window.LIVE?.access?.team || []).forEach((x) => add(x, x.role === 'owner' ? 'Admin' : ''));
    (w?.people || []).forEach((x) => add(x, x.guest || x.how === 'guest' ? 'Guest' : ''));
    (window.LIVE?.access?.invited || []).forEach((e) => add({ email: e }, 'Invited'));
    return [...seen.values()]; };
  /* the people a message tags: every @Name in it that is someone on the list (longest name first) */
  const tagsIn = (text) => { const out = new Set(), list = realPeople().sort((a, b) => b.name.length - a.name.length); const low = ` ${text.toLowerCase()}`;
    for (const x of list) { const n = `@${x.name.toLowerCase()}`; let i = low.indexOf(n); while (i >= 0) { const after = low[i + n.length]; if ((low[i - 1] === ' ' || low[i - 1] === '\n') && (!after || /[\s,.:;!?]/.test(after))) { out.add(x.email); break; } i = low.indexOf(n, i + 1); } }
    return [...out]; };

  /* ---------- Markdown ⇄ the editable doc ---------- */
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const toHtml = (md, flash = []) => {
    const out = []; let list = null, head = 'Top';
    const close = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    const mark = () => (flash.includes(head) ? ' class="is-new"' : '');
    for (const raw of String(md || '').split('\n')) {
      const l = raw.trimEnd();
      let m;
      if ((m = l.match(/^#\s+(.*)/))) { close(); head = 'Top'; out.push(`<h1>${inline(m[1])}</h1>`); continue; }
      if ((m = l.match(/^#{2,3}\s+(.*)/))) { close(); head = m[1].trim(); out.push(`<h2${mark()}>${inline(m[1])}</h2>`); continue; }
      if ((m = l.match(/^\s*[-*]\s+(.*)/))) { (list ||= []).push(`<li${mark()}>${inline(m[1])}</li>`); continue; }
      close(); if (l.trim()) out.push(`<p${mark()}>${inline(l)}</p>`);
    }
    close(); return out.join('') || '<p><br></p>';
  };
  const textOf = (el) => { let s = ''; el.childNodes.forEach((n) => { if (n.nodeType === 3) s += n.textContent; else if (n.nodeName === 'BR') s += ''; else if (n.nodeName === 'B' || n.nodeName === 'STRONG') s += `**${textOf(n)}**`; else s += textOf(n); }); return s.replace(/ /g, ' '); };
  const toMd = (root) => {
    const lines = [];
    root.childNodes.forEach((n) => {
      if (n.nodeType === 3) { if (n.textContent.trim()) lines.push(n.textContent.trim(), ''); return; }
      const tag = n.nodeName, t = textOf(n).trim();
      if (tag === 'H1') lines.push(`# ${t}`, '');
      else if (tag === 'H2' || tag === 'H3') lines.push(`## ${t}`, '');
      else if (tag === 'UL' || tag === 'OL') { $$('li', n).forEach((li) => { const x = textOf(li).trim(); if (x) lines.push(`- ${x}`); }); lines.push(''); }
      else if (tag === 'LI') { if (t) lines.push(`- ${t}`); }
      else if (t) lines.push(t, '');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  /* ---------- data ---------- */
  const ensureWork = async () => {
    const p = DPx(); if (!p) return null; if (p._work && !(['measuring', 'result'].includes(p._work.stage) && !String(p.id).startsWith('work:'))) return p._work;
    // live or measured: asking for more starts the next version, the live one keeps measuring
    const { _work, ...card } = p; const r = await A.tapi('POST', '/api/work', { cardId: p.id, card, decided: A.S.decided?.[p.id] || null });
    if (!r.work) { toast('Couldn’t start the jam. Try again.'); return null; }
    A.putWork(r.work); A.repaintDetail(); return r.work;
  };
  const take = (w, changed) => { if (!w) return; A.putWork(w); if (changed?.length) JM.flash = changed; A.repaintDetail(); };
  const pvKey = (p) => p.id + '|' + (A.S.decided?.[p.id] || '');
  const docOf = (p, w) => w?.doc || JM.previews[pvKey(p)] || null;
  const loadPreview = (p) => { const k = pvKey(p); if (JM.previews[k] !== undefined) return; JM.previews[k] = null; A.tapi('GET', `/api/cards/${p.id}/brief?decided=${encodeURIComponent(A.S.decided?.[p.id] || '')}`).then((r) => { if (r.doc) { JM.previews[k] = r.doc; if (DPx()?.id === p.id) paint(); } }); };
  const loadMoves = (p) => { if (JM.moves[p.id] !== undefined) return paintMoves(p); JM.moves[p.id] = null; A.tapi('GET', `/api/cards/${p.id}/moves`).then((r) => { JM.moves[p.id] = r.moves || []; if (DPx()?.id === p.id) paintMoves(p); }); };

  /* ---------- the pane ---------- */
  const people = (w) => {
    const out = [{ html: `<span class="jm-fav">${face(w?.agent && w.agent !== 'brew' ? w.agent : 'creative')}</span>`, t: AGENT[w?.agent] || 'AI' }];
    if (!DEMO) { const here = new Set((JM.here?.[w?.id] || []).map((x) => x.email)); (w?.people || []).forEach((x) => out.push({ html: `${pAv(x, 24)}${here.has(x.email) ? '<i class="jm-here" title="Here now"></i>' : ''}`, t: `${pName(x)}${x.email === myEmail() ? ' (you)' : ''}${here.has(x.email) ? ' · here now' : ''}` })); return out; }
    const names = new Set(); (w?.thread || []).forEach((m) => { if (m.from === 'colleague' && m.who) names.add(m.who); }); if (w?.with?.kind === 'team') names.add(w.with.name);
    names.forEach((n) => { const c = A.B.colleagues.map((x) => A.colleague(x.id)).find((x) => x.name === n || x.role === n) || { ini: n.slice(0, 2).toUpperCase(), color: '#666' }; out.push({ html: avatar(c, 24), t: n }); });
    if (w?.with?.kind === 'brew' || (w?.thread || []).some((m) => m.from === 'brew')) out.push({ html: '<span class="av pod-av" style="width:24px;height:24px">B</span>', t: 'ShopOS team' });
    return out;
  };
  /* Brew's replies read as a short document: **bold**, "## heading" or a lone **line** as a heading, "1." and "-" lists */
  const mdLite = (body) => { const out = []; let list = null; const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    const inl = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/“(go ahead|save|cancel|just the top 6|drop \d+|change \d+ to …|add belief: …)”/gi, '<code>$1</code>');
    for (const raw of String(body || '').split('\n')) { const l = raw.trimEnd(); let m;
      if (!l.trim()) { close(); continue; }
      if ((m = l.match(/^#{1,3}\s+(.+)$/)) || (m = l.match(/^\*\*([^*]+)\*\*$/))) { close(); out.push(`<h5 class="jm-h">${inl(m[1])}</h5>`); continue; }
      if ((m = l.match(/^(\d+)\.\s+(.+)$/))) { if (list !== 'ol') { close(); out.push(`<ol class="jm-ol" start="${m[1]}">`); list = 'ol'; } out.push(`<li>${inl(m[2])}</li>`); continue; }
      if ((m = l.match(/^[-•]\s+(.+)$/))) { if (list !== 'ul') { close(); out.push('<ul class="jm-ul">'); list = 'ul'; } out.push(`<li>${inl(m[1])}</li>`); continue; }
      close(); out.push(`<p>${inl(l)}</p>`); }
    close(); return out.join(''); };
  const msgHtml = (m, w) => {
    const edited = m.edited?.length ? `<div class="jm-edited"><button class="jm-ed-k" data-jm-flash="${esc(m.edited.join('|'))}">${ic('check', 's12')}Updated ${m.edited.length} part${m.edited.length > 1 ? 's' : ''} of the brief</button>${m.edited.map((x) => `<button class="jm-ed-c" data-jm-flash="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : '';
    if (m.from === 'system') return `<div class="jm-sys">${esc(m.body)}${edited}</div>`;
    const tagged = (body) => { let h = esc(body); for (const x of [...realPeople(w), ...(DEMO ? [] : [SHOPOS])]) h = h.replace(new RegExp(`(^|\\s)@${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,.:;!?])`, 'gi'), (all, sp) => `${sp}<b class="jm-tag">@${esc(x.name)}</b>`); return h; };
    if (m.from === 'me' && m.by && m.by.email !== myEmail()) return `<div class="jm-m">${pAv(m.by, 26)}<div class="jm-mb"><small>${esc(pName(m.by))}</small><div class="jm-bub">${tagged(m.body)}</div>${edited}</div></div>`; /* a teammate's message */
    if (m.from === 'me') return `<div class="jm-m me"><div class="jm-bub">${tagged(m.body)}</div>${edited}</div>`;
    const who = m.from === 'ai' ? `<span class="jm-fav">${face(w.agent && w.agent !== 'brew' ? w.agent : 'creative')}</span>` : m.from === 'colleague' ? avatar(A.B.colleagues.map((x) => A.colleague(x.id)).find((x) => x.name === m.who || x.role === m.who) || { ini: (m.who || '?').slice(0, 2).toUpperCase(), color: '#666' }, 26) : '<span class="av pod-av" style="width:26px;height:26px">B</span>';
    return `<div class="jm-m">${who}<div class="jm-mb"><small>${esc(m.who || (m.from === 'ai' ? AGENT[w.agent] || 'AI' : 'Brew'))}${m.from === 'colleague' && w.with?.channel ? ` · ${esc(w.with.channel)}` : ''}${m.from === 'colleague' ? '<span class="dummy-tag" title="A simulated teammate reply">Dummy</span>' : ''}</small><div class="jm-bub${m.from === 'ai' ? ' is-md' : ''}">${m.from === 'ai' ? mdLite(m.body) : esc(m.body)}</div>${edited}</div></div>`;
  };
  const questions = (w) => {
    const qs = w?.plan?.questions || []; if (!qs.length) return ''; const open = qs.filter((q) => !q.answer);
    const owner = (o, q) => (q?.waiting && !DEMO ? q.waiting : o === 'ai' ? AGENT[w.agent] || 'AI' : o === 'brew' ? 'ShopOS team' : DEMO ? A.colleague(o).name : 'someone');
    return `<details class="jm-qs"${open.length ? ' open' : ''}><summary>Open questions <span>${open.length ? `${open.length} open` : 'all answered'}</span></summary>
      <ul>${qs.map((q) => `<li class="${q.answer ? 'done' : ''}"><b>${esc(q.q)}</b>${q.answer ? `<p>${esc(q.answer)}</p>` : `<div class="jm-q-a">${q.asked ? `<span><span class="spin"></span>Asked ${esc(owner(q.owner, q))}</span>` : !DEMO && q.owner !== 'ai' ? `<button class="linkbtn" data-jq-who="${esc(q.id)}">Ask someone</button>${JM.askQ === q.id ? `<div class="jm-pick" role="menu">${realPeople(w).filter((x) => x.sub !== 'Invited').map((x) => `<button role="menuitem" data-jq-askp="${esc(q.id)}|${esc(x.email)}">${x.html}<b>${esc(x.name)}</b></button>`).join('') || '<small>Invite your team first: Team and access, in your account menu.</small>'}</div>` : ''}` : `<button class="linkbtn" data-jq-ask="${esc(q.id)}">Ask ${esc(owner(q.owner))}</button>`}<button class="linkbtn" data-jm-answer="${esc(q.id)}">Answer it</button></div>`}</li>`).join('')}</ul></details>`;
  };
  // the people the @ being typed could mean (none once a full name and a space are in)
  const mentionMatches = () => { if (JM.noMention) return []; const m = JM.draft.match(/(^|\s)@([\w ]*)$/); if (!m) return []; const q = m[2].toLowerCase();
    if (q.endsWith(' ') && mentionList().some((x) => x.name.toLowerCase() === q.trim())) return []; // already picked
    return mentionList().filter((x) => x.name.toLowerCase().startsWith(q.trimStart())); };
  const SHOPOS = { k: 'brew', name: 'ShopOS team', sub: 'Gets an email to join', html: '<span class="av pod-av" style="width:20px;height:20px">B</span>' };
  const mentionList = () => (DEMO ? [...A.B.colleagues.map((x) => A.colleague(x.id)).map((c) => ({ k: c.id, name: c.name, sub: c.role !== c.name ? c.role : '', html: avatar(c, 20) }))] : [...realPeople(), SHOPOS]);
  const shoposIn = (text) => /(^|\s)@shopos team(?=$|[\s,.:;!?])/i.test(text);
  const pName = (p) => `${p?.staff ? 'ShopOS team · ' : ''}${p?.name || p?.email || 'Someone'}`; /* a shopos.ai account shows as the ShopOS team */
  /* who has the jam: give it to someone, or ask someone for their OK on this version (they get an email) */
  const assignHtml = (w) => { if (DEMO || !w) return ''; const a = w.assignee, ppl = realPeople(w);
    const label = a ? `${pAv(a, 18)}<span>${a.ask === 'approve' ? `Waiting on ${esc(shortName(a))}’s OK` : `${esc(shortName(a))} has it`}</span>` : `${ic('person', 's14')}<span>Assign</span>`;
    const pop = JM.assign ? `<div class="jm-menu jm-assign-m" role="menu"><div class="jm-seg" role="group"><button data-jm-amode="work" aria-pressed="${JM.assign !== 'approve'}">Give it to</button><button data-jm-amode="approve" aria-pressed="${JM.assign === 'approve'}">Ask for OK on v${esc(w.current || 1)}</button></div>
      ${ppl.length ? ppl.map((x) => `<button role="menuitem" data-jm-assignto="${esc(x.email)}">${x.html}<b>${esc(x.name)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('') : '<small class="jm-assign-none">Nobody else is on the team yet. Invite them from Team and access.</small>'}
      ${a ? '<hr><button role="menuitem" data-jm-assignto="">Nobody</button>' : ''}</div>` : '';
    return `<span class="jm-assign"><button class="jm-assign-b${a ? ' is-on' : ''}" data-jm-assign aria-expanded="${!!JM.assign}">${label}</button>${pop}</span>`; };
  const typingHtml = (w) => { const ty = (JM.here?.[w?.id] || []).filter((x) => x.typing); return ty.length ? `<div class="jm-sys jm-typing-who">${esc(ty.map(shortName).join(' and '))} ${ty.length > 1 ? 'are' : 'is'} typing<span class="jm-typing"><i></i><i></i><i></i></span></div>` : ''; };
  const shipHtml = (w, doc) => {
    if (w && !EARLY.includes(w.stage)) return JM.later ? `<div class="jm-later">${JM.later}</div>` : '';
    /* the team replied: the answer they need is one tap */
    if (w?.stage === 'needs_you') return `<div class="jm-ship is-split"><button class="btn btn-primary jm-go" data-approve>${ic('check', 's16')}<span>Approve v${esc(w.current || 1)}</span></button><button class="linkbtn jm-alt" data-jm-tab="chat">Or tell them what to change in the chat</button></div>`;
    if (w?.jamBrief) return `<div class="jm-ship is-sent"><span>${ic('check', 's16')}<b>Brief shared</b> · ${esc(w.ticket || '')}</span><button class="linkbtn" data-jm-ship="${esc(w.jamBrief.to || 'shopos')}">Copy it again</button><button class="linkbtn" data-jm-view>View the brief</button></div>`;
    if (JM.confirm) return `<div class="jm-ship is-ask"><p>Still missing: <b>${esc(JM.confirm.join(', ').toLowerCase())}</b>. Whoever runs it will ask you. Share it anyway?</p><div><button class="btn btn-ghost" data-jm-noship>Keep jamming</button><button class="btn btn-primary" data-jm-ship="${esc(JM.to || 'shopos')}" data-force>${ic('copy', 's16')}Copy it anyway</button></div></div>`;
    // the jam ends with Share the brief: to the ShopOS team or to your own team. Both copy the brief and its link; nothing is
    // sent from Brew. Before that: the card's make step, then whatever the brief still misses.
    const p = DPx(), c = p && A.cardOf ? A.cardOf(p) : null, miss = doc?.missing || [];
    const two = `<span class="jm-share-k">Share the brief with</span><button class="btn btn-primary jm-go" data-jm-ship="shopos">${ic('copy', 's16')}<span>ShopOS team</span></button><button class="btn btn-ghost" data-jm-ship="team">My team</button>`;
    const share = `<button class="btn btn-ghost jm-share" data-jm-share aria-expanded="${!!JM.share}" aria-label="Share" title="Share">${ic('link', 's16')}</button>${JM.share ? `<div class="jm-menu jm-share-m" role="menu"><button data-jm-move="whatsapp">${ic('chat', 's14')}WhatsApp</button><button data-jm-move="slack"><span class="slack-ic sm">#</span>Slack</button><button data-jm-handoff>${ic('link', 's14')}Copy the link to everything</button></div>` : ''}`;
    /* the card's action, before the plan's make step ran: it makes the draft here first */
    if (JM.pick) return `<div class="jm-ship is-split">${two}${share}<button class="linkbtn jm-alt" data-jm-unpick>Not yet</button></div>`; /* "Or share the brief": the two ways, before or after the make step */
    const pl = w?.cardPlan || c?.plan, made = !pl || pl.made || (w?.drafts || []).some((d) => d.state === 'ready' && !d.seeded) || (w && w.stage !== 'drafting');
    if (pl && !made) { const busy = JM.making || (w?.drafts || []).some((d) => d.state === 'making'); return `<div class="jm-ship is-split"><button class="btn btn-primary jm-go" data-jm-make="auto"${busy ? ' disabled' : ''}>${busy ? '<span class="spin"></span>Making it…' : `${ic('sparkles', 's16')}<span>${esc(pl.cta)}</span>`}</button>${share}<button class="linkbtn jm-alt" data-jm-pick>Or share the brief with the team</button></div>`; }
    if (miss.length) return `<div class="jm-ship is-split"><button class="btn btn-primary jm-go" data-jm-fill="${esc(miss[0])}">${ic('hand', 's16')}<span>Next: ${esc(String(miss[0]).toLowerCase())}${miss.length > 1 ? ` <small>+${miss.length - 1}</small>` : ''}</span></button>${share}<button class="linkbtn jm-alt" data-jm-pick>Or share the brief with the team as it is</button></div>`;
    return `<div class="jm-ship is-split">${two}${share}</div>`;
  };
  // the Brief tab leads with the final version: the canvas still, then the plan rows and how we'll know
  const briefTop = (p, w) => {
    if (!window.Canvas || !p) return ''; const c = A.cardOf ? A.cardOf(p) : p, bp = w?.doc?.plan || {}, k = w?.contract, kn = c?.know;
    const rows = [['What changes', bp.change], ['Who it’s for', bp.audience], ['When', bp.when], ['Budget', bp.budget], ['Owner', bp.owner]].filter(([, v]) => v);
    const H = { esc, ic, face, slotHtml: A.slotHtml, B: A.B, AGENT: A.AGENT || {}, ago: A.ago };
    return `<section class="jm-final"><small class="jm-kind">The final version${w?.current ? ` · v${w.current}` : ''}</small>${window.Canvas.thumb(p, c, w, A.currentDetail?.()?._ch || null, H)}
      ${rows.length ? `<dl class="jm-final-rows">${rows.map(([kk, v]) => `<div><dt>${esc(kk)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${k || kn ? `<p class="jm-final-know">${ic('trendup', 's14')}<b>How we’ll know:</b> ${esc(k ? `${k.metric.name}, ${k.how.toLowerCase()}, grade ${k.plannedGrade}, read after ${k.window} days` : `${bp.metric || kn.metric}, ${String(kn.bestHow || '').toLowerCase()}, grade ${kn.bestGrade} at best`)}</p>` : ''}</section>`;
  };
  // first drafts: one tap makes the asset the brief asks for (AI picks the form) or in a form you pick
  const AS = { image: ['pic', 'Image'], carousel: ['grid', 'Carousel'], video: ['vid', 'Video'], voice: ['mic', 'Voice'], text: ['txt', 'Text'], email: ['send', 'Email'], whatsapp: ['chat', 'WhatsApp message'], page: ['doc', 'Page section'], collection: ['grid', 'Collection ad'], catalog: ['grid', 'Catalog ad'] };
  const draftHtml = (d) => {
    const lab = AS[d.as] || ['sparkles', 'Draft'];
    const media = d.state === 'making' ? `<div class="jm-dr-mk"><span class="spin"></span><span>${esc(d.step || 'Making it')}…</span></div>`
      : d.video ? `<video class="jm-dr-m" src="${esc(d.video)}"${d.image ? ` poster="${esc(d.image)}"` : ''} controls playsinline loop preload="metadata" style="aspect-ratio:${esc((d.ratio || '9:16').replace(':', '/'))}"></video>`
      : d.slides?.length ? `<div class="jm-dr-sl" style="--ar:${esc((d.ratio || '4:5').replace(':', '/'))}">${d.slides.map((x, i) => `<a href="${esc(x.image)}" target="_blank" rel="noopener" title="Slide ${i + 1}: ${esc(x.text)}"><img src="${esc(x.image)}" alt="Slide ${i + 1}: ${esc(x.text)}" loading="lazy"></a>`).join('')}</div>`
      : d.render || d.image ? `<img class="jm-dr-m" src="${esc(d.render || d.image)}" alt="${esc(d.title || 'Draft image')}"${d.photo || (d.render && d.image) ? ` data-fb="${esc([d.render ? d.image : null, d.photo].filter(Boolean).join('|'))}"` : ''} style="aspect-ratio:${esc(d.render ? '4/5' : (d.ratio || '4:5').replace(':', '/'))}">` : ''; /* render: an email, chat, page or product-grid mock made before the jam opened */
    const audio = d.audio && d.state !== 'making' ? `<div class="jm-dr-au">${d.video ? '<small>Voiceover</small>' : ''}<audio src="${esc(d.audio)}" controls preload="none"></audio></div>` : '';
    const file = d.zip || d.video || d.render || d.image || d.audio;
    return `<article class="jm-dr is-${esc(d.state)}">${media}${audio}
      <div class="jm-dr-b"><small class="jm-dr-k">${ic(lab[0], 's12')}${esc(lab[1])}${d.state === 'making' ? '' : ` · ${esc(d.title || 'First draft')}`}</small>
        ${d.copy ? `<div class="jm-dr-copy">${toHtml(d.copy)}</div>` : ''}
        ${d.err ? `<p class="jm-dr-note is-err">${esc(d.err)}</p>` : d.note ? `<p class="jm-dr-note">${esc(d.note)}</p>` : ''}
        ${d.state === 'making' ? '' : `<div class="jm-dr-acts">${file ? `<a class="linkbtn" href="${esc(file)}" download>${ic('down', 's14')}${d.zip ? `Download all ${d.slides?.length || ''} slides` : 'Download'}</a>` : ''}${d.copy ? `<button class="linkbtn" data-jm-drcopy="${esc(d.id)}">${ic('copy', 's14')}Copy the words</button>` : ''}<button class="linkbtn" data-jm-make="${esc(d.asked || 'auto')}">${ic('refresh', 's14')}Another take</button><button class="linkbtn jm-dr-x" data-jm-drop="${esc(d.id)}" aria-label="Remove this draft">${ic('x', 's14')}</button></div>`}</div></article>`;
  };
  const draftsHtml = (w) => (w?.drafts?.length ? `<section class="jm-drafts" aria-label="Drafts">${w.drafts.map(draftHtml).join('')}</section>` : '');
  const makeHtml = (w) => {
    if (['deploying', 'measuring', 'result'].includes(w?.stage)) return '';
    const busy = JM.making || (w?.drafts || []).some((d) => d.state === 'making');
    return `<div class="jm-make"><button class="btn btn-ghost jm-make-go" data-jm-make="auto"${busy ? ' disabled' : ''}>${busy ? '<span class="spin"></span>Making the draft…' : `${ic('sparkles', 's16')}Make the first draft`}</button>
      <div class="jm-make-as" role="group" aria-label="Or make it as">${Object.entries(AS).map(([k, [i, l]]) => `<button class="icon-btn" data-jm-make="${k}" title="Make it as ${l.toLowerCase()}" aria-label="Make it as ${l.toLowerCase()}"${busy ? ' disabled' : ''}>${ic(i, 's16')}</button>`).join('')}</div></div>`;
  };
  /* the card's other ways to play it, as a quiet hint: tapping one puts it in the box to jam on */
  /* an empty chat opens on the case: what we saw, why it matters, the card's plan, and the one thing to press next */
  const caseHtml = (p, w) => { const c = p && A.cardOf ? A.cardOf(p) : null; if (!c?.title) return '';
    const cut = (x, n) => { x = String(x || '').trim(); return x.length > n ? x.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : x; };
    const why = (c.detail?.why || []).filter((x) => x && !/^[^:]{2,60}:\s*[₹$€£]?[\d.,]+\s*$/.test(x) && !/^[^:“"]{2,90}\([^)]*\):/.test(x) /* evidence rows (label (source): value), not reasons */).slice(0, 2), miss = (w?.doc?.missing || []).map((x) => String(x).toLowerCase());
    const pl = w?.cardPlan || c.plan, made = !pl || pl.made || (w?.drafts || []).some((d) => d.state === 'ready' && !d.seeded) || (w && w.stage !== 'drafting');
    const next = pl && !made ? `Press “${pl.cta}” below. Brew makes the first draft here; change it, then share the brief.`
      : miss.length ? `Tell me in the chat: ${miss.join('; ')}. Then share the brief.`
      : 'Happy with it? Share the brief with the ShopOS team or your own team from the bottom bar. It copies the brief and a link to everything.';
    return `<div class="case"><small class="case-k">The case${c.src ? ` · ${esc(c.src)}` : ''}</small><b class="case-t">${esc(cut(c.title, 140))}</b>${c.sub ? `<p>${esc(cut(c.sub, 240))}</p>` : ''}
      ${why.length ? `<div class="case-s"><small>Why it matters</small><ul>${why.map((x) => `<li>${esc(cut(x, 200))}</li>`).join('')}</ul></div>` : ''}
      ${pl?.steps?.length ? `<div class="case-s"><small>The plan</small><ol>${pl.steps.map((x) => `<li>${esc(x.t)}</li>`).join('')}</ol></div>` : ''}
      <p class="case-next">${esc(next)}</p></div>`; };
  const altsHtml = (p) => { const w0 = W() || A.workOfCard?.(p?.id); if (w0 && !['drafting'].includes(w0.stage)) return ''; /* only while it's still being shaped */ const alts = (A.pageOf?.(p?.id)?.options || []).filter((o) => !o.pick && o.name).slice(0, 3); if (!alts.length) return '';
    return `<p class="jm-alts">Or try: ${alts.map((o) => `<button type="button" class="linkbtn" data-jm-alt="${esc(`What if we ${String(o.name).replace(/^./, (x) => x.toLowerCase())} instead?${o.says ? ` (${o.says})` : ''}`)}">${esc(o.name)}</button>`).join('<span aria-hidden="true"> · </span>')}</p>`; };
  const paneHtml = (p, w) => {
    const doc = docOf(p, w), th = w?.thread || [], ps = people(w), tab = JM.tab, shipped = ['deploying', 'measuring', 'result'].includes(w?.stage);
    const msgs = th.filter((m) => m.from !== 'system' || m.edited?.length || /brief|moved|sent/i.test(m.body || ''));
    return `<div class="jm" data-jm>
      <header class="jm-h"><div class="jm-tabs" role="tablist"><button role="tab" data-jm-tab="chat" aria-selected="${tab === 'chat'}">Chat${msgs.length ? ` <span>${msgs.length}</span>` : ''}</button><button role="tab" data-jm-tab="brief" aria-selected="${tab === 'brief'}">Brief</button></div>
        ${assignHtml(w)}<span class="jm-people" title="${esc(ps.map((x) => x.t).join(', '))}">${ps.map((x) => `<span class="jm-pp">${x.html}</span>`).join('')}</span>
        <button class="icon-btn jm-more" data-jm-menu aria-label="More" aria-expanded="${JM.menu}">${ic('more', 's16')}</button>
        ${JM.menu ? `<div class="jm-menu" role="menu"><button data-jm-move="whatsapp">${ic('chat', 's14')}Take it to WhatsApp</button><button data-jm-move="slack"><span class="slack-ic sm">#</span>Take it to Slack</button><button data-jm-import>${ic('copy', 's14')}Paste a chat back in</button><button data-jm-handoff>${ic('link', 's14')}Copy the full handoff link</button>${W() ? `<hr><button data-jm-fresh>${ic('refresh', 's14')}Start fresh</button><button data-jm-discard class="is-bad">${ic('minus', 's14')}Discard this jam</button>` : ''}</div>` : ''}</header>
      <div class="jm-b">${tab === 'brief' ? `
        ${w?.doc?.moved ? `<div class="jm-note">The jam is on ${w.doc.moved.to === 'whatsapp' ? 'WhatsApp' : 'Slack'}. When you’re done there, <button class="linkbtn" data-jm-import>paste the chat back</button> and the brief updates.</div>` : ''}
        ${JM.importing ? `<div class="jm-import"><textarea id="jm-imp" rows="5" placeholder="Paste the WhatsApp or Slack chat, or just type what you agreed"></textarea><div><button class="linkbtn" data-jm-imp-x>Cancel</button><button class="btn btn-primary sm" data-jm-imp>${ic('sparkles', 's14')}Update the brief</button></div></div>` : ''}
        ${shipped ? `<div class="jm-shipped">${ic('check', 's14')}<span><b>${w.stage === 'result' ? 'Shipped and measured' : w.stage === 'measuring' ? `Live on ${esc(w.deploy?.target || 'your account')}` : 'Shipping now'}</b> · this is the brief that went out. Ask below to start the next version.</span></div>` : ''}
        ${A.SPLIT ? briefTop(p, w) : draftsHtml(w)}
        <small class="jm-kind">${esc(doc?.kind || 'Brief')}${w?.doc?.edits?.[0] ? ` · edited by ${esc(w.doc.edits[0].by === 'you' ? 'you' : w.doc.edits[0].by)}` : ' · from the card'}</small>
        ${doc ? `<article class="jm-doc" contenteditable="${shipped || (w?.jamBrief && !EARLY.includes(w.stage)) ? 'false' : 'true'}" spellcheck="true" data-jm-doc aria-label="The brief. Type to edit.">${toHtml(doc.md, JM.flash)}</article>` : '<div class="sk" style="height:320px;border-radius:12px"></div>'}
        ${shipped ? '' : doc?.missing?.length ? `<p class="jm-missing">Still missing: ${doc.missing.map((x) => `<button class="linkbtn" data-jm-fill="${esc(x)}">${esc(x.toLowerCase())}</button>`).join(', ')}</p>` : doc ? `<p class="jm-missing ok">${ic('check', 's14')}Everything the next team needs is in here.</p>` : ''}
        ${questions(w)}${A.SPLIT ? draftsHtml(w) : ''}`
      : `<div class="jm-thread" id="jm-thread">${A.SPLIT && caseHtml(p, w) ? `<div class="jm-empty has-case">${caseHtml(p, w)}${msgs.length ? '' : altsHtml(p)}</div>` : ''}${msgs.length ? msgs.map((m) => msgHtml(m, w)).join('') : A.SPLIT && caseHtml(p, w) ? '' : `<div class="jm-empty"><b>What should change?</b><span>Type or talk. ${A.SPLIT ? 'The left side updates as you go.' : 'Everything agreed lands in the brief.'} @ brings in a teammate or the ShopOS team.</span>${altsHtml(p)}</div>`}${typingHtml(w)}${JM.busy ? `<div class="jm-m"><span class="jm-fav">${face(w?.agent || 'creative')}</span><div class="jm-mb"><div class="jm-bub"><span class="jm-typing"><i></i><i></i><i></i></span></div></div></div>` : ''}</div>`}
      </div>
      <form class="jm-compose" id="jm-f">${(() => { const ms = mentionMatches(); if (!ms.length) return ''; JM.mi = Math.min(JM.mi || 0, ms.length - 1); return `<div class="jm-mentions" role="listbox">${ms.map((x, i) => `<button type="button" role="option" aria-selected="${i === JM.mi}" class="${i === JM.mi ? 'is-on' : ''}" data-jm-mention="${esc(x.name)}">${x.html}<b>${esc(x.name)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('')}</div>`; })()}
        <textarea id="jm-in" rows="1"${A.SPLIT ? ' data-nomic' : ''} placeholder="${shipped ? 'Ask for the next version, or @ someone…' : w?.with?.kind === 'team' ? `Reply to ${esc(w.with.name)}, or ask AI…` : A.SPLIT ? 'What should change?' : 'Ask AI to change the brief, or @ someone…'}" aria-label="Message">${esc(JM.draft)}</textarea>${A.SPLIT && window.Composer?.tools ? `<span class="jm-tools">${window.Composer.tools()}<span class="jm-tools-r">${window.Mic?.supported ? `<button type="button" class="jm-mic" data-cmp-talk aria-label="Talk instead of typing">${ic('mic', 's16')}</button>` : ''}<button class="jm-send" aria-label="Send" ${JM.busy ? 'disabled' : ''}>${ic('up', 's16')}</button></span></span>` : `<button class="jm-send" aria-label="Send" ${JM.busy ? 'disabled' : ''}>${ic('up', 's16')}</button>`}</form>
      ${A.SPLIT && window.Composer?.foot ? window.Composer.foot() : ''}${A.SPLIT ? '' : makeHtml(w)}${shipHtml(w, doc)}
    </div>`;
  };

  // the card page calls this every time it paints
  const decorateDetail = (dp, DP) => {
    if (!dp || !DP) return; const p = DP.p, w = DP.w;
    if (JM.cid !== p.id) Object.assign(JM, { cid: p.id, tab: DP.opts?.jamTab || (A.SPLIT ? 'chat' : w?.thread?.length && w.stage !== 'drafting' ? 'chat' : 'brief'), share: false, draft: DP.opts?.draft || '', busy: '', flash: [], confirm: null, menu: false, importing: false });
    JM.later = w && !EARLY.includes(w.stage) ? ($('.dp-f', dp)?.innerHTML || '') : '';
    if (!w) loadPreview(p); loadMoves(p); pollDrafts();
    dp.classList.add('has-jm'); paint(dp);
  };
  const paint = (dp = $('#dp')) => {
    const side = dp && $('.dp-side', dp), p = DPx(); if (!side || !p) return;
    const keep = document.activeElement?.id === 'jm-in', th = $('#jm-thread'), near = th ? th.scrollHeight - th.scrollTop - th.clientHeight < 80 : true, bs = $('.jm-b', side)?.scrollTop;
    side.innerHTML = paneHtml(p, p._work);
    const nb = $('.jm-b', side), nt = $('#jm-thread'); const nMsg = nt ? $$('.jm-m', nt).length : 0, grew = nMsg > (JM.nMsg?.[p.id] || 0); JM.nMsg = { ...(JM.nMsg || {}), [p.id]: nMsg };
    /* the case stays first in the chat and scrolls up as messages come: a fresh chat is read from its top, a new message brings the chat down to it */
    if (nt && $('.case', nt)) { if (nb) nb.scrollTop = !nMsg ? 0 : grew ? nb.scrollHeight : bs || nb.scrollHeight; } else if (nt && near) nt.scrollTop = nt.scrollHeight; else if (nb && bs) nb.scrollTop = bs;
    const i = $('#jm-in'); grow(i); if (keep) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    if (JM.flash.length) { const first = $('.jm-doc .is-new'); if (first && JM.tab === 'brief') first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTimeout(() => { JM.flash = []; $$('.jm-doc .is-new').forEach((x) => x.classList.remove('is-new')); }, 2600); }
  };
  const grow = (i) => { if (!i) return; i.style.height = 'auto'; i.style.height = Math.min(140, i.scrollHeight) + 'px'; };

  // the left column: each card's source moves as chips that open what the move says
  const paintMoves = (p) => {
    const box = $('#dp-moves'); if (!box) return; const ms = JM.moves[p.id];
    if (!ms) { box.hidden = ms === null ? false : true; return; }
    if (!ms.length) { box.hidden = true; return; }
    box.hidden = false; $('.dp-moves-l', box).innerHTML = ms.map((m) => `<button class="dp-move" data-jm-movedoc="${m.n}"><span class="dp-move-n">Move ${String(m.n).padStart(2, '0')}</span><b>${esc(m.title)}</b>${m.stat ? `<small>${esc(m.stat)} ${esc((m.statLabel || '').toLowerCase())}</small>` : ''}${ic('right', 's14')}</button>`).join('');
  };
  const moveSheet = (n) => {
    const p = DPx(), m = (JM.moves[p?.id] || []).find((x) => x.n === +n); if (!m) return;
    const tag = (x) => `Move ${String(m.n).padStart(2, '0')} · ${x}`;
    A.modal(`<div class="sheet mv-sheet"><button class="icon-btn rx-close" data-close aria-label="Close">${ic('x', 's18')}</button>
      <small class="mv-k">Move ${String(m.n).padStart(2, '0')} of 50 · Brew × ${esc(BNAME())}</small><h2>${esc(m.title)}</h2>
      ${m.stat ? `<p class="mv-stat"><b>${esc(m.stat)}</b> ${esc((m.statLabel || '').toLowerCase())}</p>` : ''}
      ${m.gives ? `<section><h4>What it gives ${esc(BNAME())}</h4><p data-sel-from="${esc(tag('What it gives'))}">${esc(m.gives)}</p></section>` : ''}
      ${m.live ? `<section><h4>Live 30 days after we start</h4><p>${esc(m.live)}</p></section>` : ''}
      ${m.passages?.length ? `<section><h4>What it says about this card</h4>${m.passages.map((x) => `<div class="mv-pass"><small>${esc(x.h)}</small><p>${esc(x.text)}</p><button class="btn btn-ghost sm" data-add="${esc(x.text)}" data-from="${esc(tag(x.h))}">${ic('plus', 's14')}Add to brief</button></div>`).join('')}</section>` : ''}
      ${m.why ? `<section><h4>Why it matters</h4><p>${esc(m.why)}</p></section>` : ''}
      ${m.measure ? `<section><h4>How it’s measured</h4><p>${esc(m.measure)}</p><button class="btn btn-ghost sm" data-add="${esc(m.measure)}" data-from="${esc(tag('How we measure'))}">${ic('plus', 's14')}Add to brief</button></section>` : ''}
      ${m.sections?.length ? `<section><h4>Everything in the move</h4><ul class="mv-secs">${m.sections.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></section>` : ''}</div>`);
  };

  /* ---------- actions ---------- */
  const saveDoc = async (el) => {
    clearTimeout(JM.saveT); JM.saveT = null; const md = toMd(el); const w = await ensureWork(); if (!w) return;
    const cur = (w.doc || {}).md; if (md === cur) return;
    const r = await A.tapi('POST', `/api/work/${w.id}/doc`, { md, rev: w.doc?.rev });
    if (r.stale) { A.putWork(r.work); toast('Someone else edited the brief. Showing the latest.'); return A.repaintDetail(); }
    if (r.work) { A.putWork(r.work); if (document.activeElement?.closest?.('[data-jm-doc]')) { const k = $('.jm-kind'); if (k) k.textContent = `${r.work.doc.kind} · saved`; } else A.repaintDetail(); }
  };
  const send = async (text) => {
    text = String(text || '').trim(); if (!text || JM.busy) return; const w = await ensureWork(); if (!w) return;
    // the longest name that the @ starts with
    const target = text.startsWith('@') ? mentionList().filter((x) => text.slice(1).toLowerCase().startsWith(x.name.toLowerCase()) && /^($|[\s,:])/.test(text.slice(1 + x.name.length))).sort((a, b) => b.name.length - a.name.length)[0] : null;
    JM.draft = ''; JM.tab = 'chat';
    /* a message that tags someone goes to them (and their inbox), not to AI */
    const tags = DEMO ? [] : tagsIn(text), toShopos = !DEMO && shoposIn(text);
    if (!DEMO && (tags.length || toShopos)) { JM.busy = 'team'; w.thread = [...(w.thread || []), { id: 'tmp', from: 'me', body: text, by: ME() }]; paint();
      const r = await A.tapi('POST', `/api/work/${w.id}/message`, { body: text, mentions: tags, shopos: toShopos }); JM.busy = '';
      if (r.error) { JM.draft = text; toast(esc(r.error)); return paint(); }
      const names = [...(r.tagged || []).map((e) => realPeople().find((x) => x.email === e)?.name || e), ...(toShopos ? ['The ShopOS team'] : [])];
      if (names.length) toast(`${ic('send', 's16')}${esc(names.join(', '))} will get an email`); return take(r.work); }
    if (target && DEMO) {
      if (!A.conn('slack')) { JM.draft = text; return A.openConnect('slack', { then: () => send(text), why: 'Your teammate answers in Slack. Replies land in the jam and the brief.' }); }
      JM.busy = 'team'; paint();
      const r = w.with?.kind === 'team' && w.with.id === target.k ? await A.tapi('POST', `/api/work/${w.id}/message`, { body: text }) : await A.tapi('POST', `/api/work/${w.id}/send`, { to: 'team', note: text, colleague: target.k, name: target.name, names: A.S.slack?.names, channel: A.S.slack?.channel });
      JM.busy = ''; if (r.work?.with?.channel) toast(`Simulated: nothing is posted to Slack. ${esc(target.name)} answers here as a Dummy.`); return take(r.work);
    }
    if (w.with?.kind === 'team' && w.stage === 'team' && JM.replyTeam) { const r = await A.tapi('POST', `/api/work/${w.id}/message`, { body: text }); return take(r.work); }
    JM.busy = 'ai'; w.thread = [...(w.thread || []), { id: 'tmp', from: 'me', body: text }]; paint();
    const r = await A.tapi('POST', `/api/work/${w.id}/doc/ask`, { text }); JM.busy = '';
    if (r.error) { toast('That didn’t go through. Try again.'); return paint(); }
    take(r.work, r.changed); A.counts();
  };
  const addToBrief = async (text, from) => {
    const w = await ensureWork(); if (!w) return; toast(`${ic('sparkles', 's16')}Adding it to the brief…`);
    const r = await A.tapi('POST', `/api/work/${w.id}/doc/add`, { text, from }); if (r.error) return toast('Couldn’t add that. Try again.');
    JM.tab = 'brief'; take(r.work, r.changed); toast(`${ic('check', 's16')}Added to the brief${r.changed?.length ? `: ${esc(r.changed.join(', '))}` : ''}`);
  };
  /* Share the brief: freeze it (BR-n), then copy it with the link to the full read-only brief, for the ShopOS team or your team */
  const ship = async (to, force) => {
    const w = await ensureWork(); if (!w) return; const el = $('[data-jm-doc]'); if (el && JM.saveT) await saveDoc(el);
    JM.to = to;
    const r = await A.tapi('POST', `/api/work/${w.id}/doc/ship`, { to, force: !!force, base: location.origin, decided: A.S.decided?.[DPx()?.id] || null });
    if (r.needs) { JM.confirm = r.needs; return paint(); }
    JM.confirm = null; JM.pick = false; if (r.error) return toast(esc(r.error));
    const text = r.share?.text || r.work?.jamBrief?.md || '';
    let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch (e) {}
    JM.tab = 'chat'; take(r.work); A.counts();
    toast(copied ? `${ic('copy', 's16')}Brief ${esc(r.work.ticket || '')} copied. Paste it where ${to === 'team' ? 'your team' : 'the ShopOS team'} works.` : `${ic('info', 's16')}Brief ${esc(r.work.ticket || '')} is ready. Open it with View the brief and copy it from there.`);
  };
  const viewBrief = () => { const w = W(); const d = w?.jamBrief || w?.doc; if (!d) return; const ho = w.jamBrief?.handoff?.url, sent = !!w.jamBrief;
    A.modal(`<div class="sheet jm-bv"><header class="jm-bv-h"><span class="jm-bv-k">${ic(sent ? 'send' : 'hand', 's14')}${esc(d.kind || 'Brief')}</span>${w.ticket ? `<span class="jm-bv-t">${esc(w.ticket)}</span>` : ''}${sent ? `<span class="jm-bv-s">${ic('check', 's14')}Brief shared</span>` : ''}<button class="icon-btn" data-close aria-label="Close">${ic('x', 's18')}</button></header>
      <div class="jm-bv-body">${ho ? `<div class="jm-handoff">${ic('link', 's18')}<span><b>The full brief, read-only</b><small>Card, options, moves, package and assets, the jam chat and the studio chat</small></span><a class="btn btn-primary sm" href="${esc(ho)}" target="_blank" rel="noopener">Open</a><button class="btn btn-ghost sm" data-jm-copyho="${esc(ho)}">Copy link</button></div>` : ''}
      <article class="jm-doc is-read">${toHtml(d.md)}</article>
      ${d.missing?.length ? `<p class="jm-missing">${ic('clock', 's14')}Sent with these still open: ${esc(d.missing.join(', ').toLowerCase())}</p>` : ''}</div></div>`); };
  const move = async (to) => {
    const w = await ensureWork(); if (!w) return; JM.menu = false;
    if (to === 'slack' && !A.conn('slack')) return A.openConnect('slack', { then: () => move('slack'), why: 'Post the brief to a Slack channel and jam there.' });
    const win = to === 'whatsapp' ? window.open('', '_blank') : null;
    const r = await A.tapi('POST', `/api/work/${w.id}/jb/move`, { to, channel: A.S.slack?.channel, base: location.origin, decided: A.S.decided?.[DPx()?.id] || null }); if (r.error) { win?.close(); return toast(esc(r.error)); }
    try { await navigator.clipboard?.writeText(r.text); } catch (e) {}
    if (win) win.location.href = 'https://wa.me/?text=' + encodeURIComponent(r.text);
    toast(to === 'whatsapp' ? `${ic('chat', 's16')}Opened WhatsApp with the full context: card, options, brief, package, assets and both chats, plus a link to all of it. It’s copied too.` : `${ic('copy', 's16')}Copied the full context with a link to all of it. Brew doesn’t post to Slack: paste it in ${esc(A.S.slack?.channel || 'your channel')}.`);
    take(r.work);
  };

  // a draft is made in the background; the jam is polled until it lands (the doc being typed in is never repainted)
  const pollDrafts = () => {
    clearTimeout(JM.pollT); const w = W(); if (!w || !(w.drafts || []).some((d) => d.state === 'making')) return;
    JM.pollT = setTimeout(async () => { const w0 = W(); if (!w0) return; const r = await A.tapi('POST', `/api/work/${w0.id}/jb`, {});
      if (r.work && W()?.id === w0.id) { A.putWork(r.work); if (isEditing()) { const m = $('.jm-make'); if (m) m.outerHTML = makeHtml(r.work); } else A.repaintDetail(); } pollDrafts(); }, 4000);
  };
  const makeDraft = async (as) => {
    if (JM.making) return; JM.making = true; if (!A.SPLIT) JM.tab = 'brief'; paint(); /* split: the draft shows on the canvas, the chat stays */
    const w = await ensureWork(); if (!w) { JM.making = false; return paint(); }
    const el = $('[data-jm-doc]'); if (el && JM.saveT) await saveDoc(el);
    const r = await A.tapi('POST', `/api/work/${w.id}/draft`, { as }); JM.making = false;
    if (r.error && !r.work) { toast(esc(r.error)); return paint(); }
    if (r.error) toast(esc(r.error));
    take(r.work); $('.jm-drafts')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); pollDrafts();
  };

  /* ---------- selection → "Add to brief" ---------- */
  const pill = () => $('#jm-addsel') || (() => { const b = document.createElement('button'); b.id = 'jm-addsel'; b.className = 'jm-addsel'; b.hidden = true; b.innerHTML = `${ic('plus', 's14')}Add to brief`; document.body.appendChild(b); return b; })();
  document.addEventListener('mouseup', (e) => {
    setTimeout(() => {
      const b = pill(), sel = getSelection(), text = String(sel || '').trim();
      const host = sel.rangeCount && sel.getRangeAt(0).commonAncestorContainer; const el = host && (host.nodeType === 1 ? host : host.parentElement);
      const zone = el?.closest?.('#dp .dr-b, .mv-sheet'); if (!zone || el.closest('[data-jm-doc]') || text.length < 12 || e.target.closest?.('#jm-addsel')) { if (!e.target.closest?.('#jm-addsel')) b.hidden = true; return; }
      const r = sel.getRangeAt(0).getBoundingClientRect(); b.style.left = Math.max(8, Math.min(innerWidth - 140, r.left + r.width / 2 - 60)) + 'px'; b.style.top = Math.max(8, r.top - 40) + 'px';
      b.dataset.text = text.slice(0, 2000); b.dataset.from = el.closest('.mv-sheet') ? ($('.mv-sheet h2')?.textContent ? `Move: ${$('.mv-sheet h2').textContent}` : 'a move') : 'the card'; b.hidden = false;
    }, 10);
  });
  document.addEventListener('mousedown', (e) => { if (e.target.closest?.('#jm-addsel')) e.preventDefault(); });

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const sb = t.closest('#jm-addsel'); if (sb) { sb.hidden = true; getSelection()?.removeAllRanges(); return addToBrief(sb.dataset.text, sb.dataset.from); }
    const ad = t.closest('[data-add]'); if (ad && DPx()) { e.preventDefault(); if (ad.closest('.mv-sheet')) A.closeModal(); return addToBrief(ad.dataset.add, ad.dataset.from || 'the card'); }
    const mv = t.closest('[data-jm-movedoc]'); if (mv) return moveSheet(mv.dataset.jmMovedoc);
    const ch2 = t.closest('[data-jm-copyho]'); if (ch2) { try { await navigator.clipboard.writeText(ch2.dataset.jmCopyho); } catch (e) {} return toast(`${ic('check', 's16')}Link copied`); }
    if (t.closest('[data-jm-view]')) return viewBrief();
    /* drafts are made from the canvas and the + menu too, both outside the pane */
    const mk = t.closest('[data-jm-make]'); if (mk && DPx()) return makeDraft(mk.dataset.jmMake);
    if (!t.closest('[data-jm]')) { if ((JM.menu && !t.closest('[data-jm-menu]')) || JM.assign) { JM.menu = false; JM.assign = null; paint(); } return; }
    const alt = t.closest('[data-jm-alt]'); if (alt) { const box = $('#jm-in'); if (box) { box.value = alt.dataset.jmAlt; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); } return; }
    const tb = t.closest('[data-jm-tab]'); if (tb) { JM.tab = tb.dataset.jmTab; return paint(); }
    const dc = t.closest('[data-jm-drcopy]'); if (dc) { const d = (W()?.drafts || []).find((x) => x.id === dc.dataset.jmDrcopy); try { await navigator.clipboard.writeText(d?.copy || ''); } catch (e) {} return toast(`${ic('check', 's16')}Copied`); }
    const dd = t.closest('[data-jm-drop]'); if (dd) { const w = W(); if (!w) return; const r = await A.tapi('POST', `/api/work/${w.id}/draft/${dd.dataset.jmDrop}/drop`, {}); return take(r.work); }
    if (t.closest('[data-jm-menu]')) { JM.menu = !JM.menu; JM.assign = null; return paint(); }
    if (t.closest('[data-jm-assign]')) { JM.assign = JM.assign ? null : 'work'; JM.menu = false; return paint(); }
    const am = t.closest('[data-jm-amode]'); if (am) { JM.assign = am.dataset.jmAmode; return paint(); }
    const at = t.closest('[data-jm-assignto]'); if (at) { const ask = JM.assign === 'approve' ? 'approve' : 'work'; JM.assign = null; const w = await ensureWork(); if (!w) return; const email = at.dataset.jmAssignto;
      const r = await A.tapi('POST', `/api/work/${w.id}/assign`, { email, ask }); if (r.error) { toast(esc(r.error)); return paint(); }
      if (email) toast(`${ic('send', 's16')}${esc(realPeople().find((x) => x.email === email)?.name || email)} will get an email`); return take(r.work); }
    if (t.closest('[data-jm-share]')) { JM.share = !JM.share; return paint(); }
    const mo = t.closest('[data-jm-move]'); if (mo) { JM.share = false; return move(mo.dataset.jmMove); }
    if (t.closest('[data-jm-fresh]')) { JM.menu = false; const w = W(); if (w) A.libAct.fresh('jam', w.id); return; }
    if (t.closest('[data-jm-discard]')) { JM.menu = false; const w = W(); if (w) A.libAct.discard('jam', w.id); return; }
    if (t.closest('[data-jm-handoff]')) { JM.menu = false; paint(); const w = await ensureWork(); if (!w) return; const r = await A.tapi('GET', `/api/work/${w.id}/handoff?base=${encodeURIComponent(location.origin)}`); if (!r.handoff) return toast('Couldn’t make the link. Try again.'); try { await navigator.clipboard.writeText(r.handoff.links.jam); } catch (e) {} return toast(`${ic('link', 's16')}Link copied. It opens this jam as it is now.`); }
    if (t.closest('[data-jm-import]')) { JM.menu = false; JM.importing = true; JM.tab = 'brief'; paint(); return $('#jm-imp')?.focus(); }
    if (t.closest('[data-jm-imp-x]')) { JM.importing = false; return paint(); }
    if (t.closest('[data-jm-imp]')) { const v = $('#jm-imp')?.value.trim(); if (!v) return; const w = await ensureWork(); if (!w) return; const b = t.closest('button'); b.disabled = true; b.innerHTML = '<span class="spin"></span>Reading the chat…'; const r = await A.tapi('POST', `/api/work/${w.id}/jb/import`, { text: v }); JM.importing = false; if (r.error) { toast(esc(r.error)); return paint(); } return take(r.work, r.changed); }
    const fl = t.closest('[data-jm-flash]'); if (fl) { JM.tab = 'brief'; JM.flash = fl.dataset.jmFlash.split('|'); return paint(); }
    const fi = t.closest('[data-jm-fill]'); if (fi) { JM.draft = `Add ${fi.dataset.jmFill.toLowerCase()}: `; paint(); const i = $('#jm-in'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
    const qw = t.closest('[data-jq-who]'); if (qw) { JM.askQ = JM.askQ === qw.dataset.jqWho ? null : qw.dataset.jqWho; return paint(); }
    const qp = t.closest('[data-jq-askp]'); if (qp) { const [qid, email] = qp.dataset.jqAskp.split('|'); JM.askQ = null; const w = await ensureWork(); if (!w) return; const r = await A.tapi('POST', `/api/work/${w.id}/plan/ask`, { qid, email }); if (r.error) return toast(esc(r.error)); toast(`${ic('send', 's16')}Asked. ${esc(realPeople().find((x) => x.email === email)?.name || email)} will get an email.`); return take(r.work); }
    const qa = t.closest('[data-jm-answer]'); if (qa) { const q = (W()?.plan?.questions || []).find((x) => x.id === qa.dataset.jmAnswer); JM.answering = q?.id || null; JM.draft = q ? `Answer to “${q.q}”: ` : ''; paint(); const i = $('#jm-in'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
    const mn = t.closest('[data-jm-mention]'); if (mn) { JM.draft = JM.draft.replace(/@[\w ]*$/, `@${mn.dataset.jmMention} `); paint(); const i = $('#jm-in'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
    if (t.closest('[data-jm-pick]')) { JM.pick = true; return paint(); }
    if (t.closest('[data-jm-unpick]')) { JM.pick = false; return paint(); }
    const sh = t.closest('[data-jm-ship]'); if (sh) { sh.disabled = true; return ship(sh.dataset.jmShip === 'team' ? 'team' : 'shopos', sh.hasAttribute('data-force')); }
    if (t.closest('[data-jm-noship]')) { JM.confirm = null; return paint(); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'jm-f') return; e.preventDefault(); const v = $('#jm-in').value.trim(); if (!v) return;
    // an answer to an open question also closes the question
    const qid = JM.answering; JM.answering = null; const m = v.match(/^Answer to “(.+?)”:\s*(.+)$/s);
    if (qid && m) { const w = W(); if (w) A.tapi('POST', `/api/work/${w.id}/plan/answer`, { qid, answer: m[2].trim() }).then((r) => r.work && A.putWork(r.work)); }
    send(v);
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'jm-in') { const had = /(^|\s)@[\w ]*$/.test(JM.draft); JM.draft = e.target.value; JM.mi = 0; JM.noMention = false; grow(e.target); if (had !== /(^|\s)@[\w ]*$/.test(JM.draft) || /(^|\s)@[\w ]*$/.test(JM.draft)) paint(); return; }
    const d = e.target.closest?.('[data-jm-doc]'); if (d) { clearTimeout(JM.saveT); JM.saveT = setTimeout(() => saveDoc(d), 900); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id !== 'jm-in') return;
    // with the @ list open, Enter and Tab pick the person and arrows move between them; Enter sends only when it's closed
    const opts = $$('.jm-mentions [data-jm-mention]');
    if (opts.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); JM.mi = ((JM.mi || 0) + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; opts.forEach((o, i) => { o.classList.toggle('is-on', i === JM.mi); o.setAttribute('aria-selected', i === JM.mi); }); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); opts[JM.mi || 0]?.click(); return; }
      if (e.key === 'Escape') { e.preventDefault(); JM.noMention = true; paint(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#jm-f')?.requestSubmit(); }
  });
  document.addEventListener('focusout', (e) => { const d = e.target.closest?.('[data-jm-doc]'); if (!d) return; (JM.saveT ? saveDoc(d) : Promise.resolve()).then(() => setTimeout(() => { if (!document.activeElement?.closest?.('[data-jm-doc]')) A.repaintDetail(); }, 0)); });

  /* ---------- entry points: every jam opens on its card ---------- */
  const open = (p, opts = {}) => {
    const tab = opts.mode === 'team' || opts.draft ? 'chat' : 'brief';
    const draft = opts.draft || (opts.mode === 'team' ? (DEMO ? `@${A.colleagueForCard(p).name} ` : '@') : '');
    JM.cid = null; A.openDetail(p, { jamTab: tab, draft });
    if (opts.starter) setTimeout(() => send(opts.starter), 50);
    setTimeout(() => { const i = $('#jm-in'); if (i && draft) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 120);
  };
  const openFromCtx = (ctx = {}) => {
    const mode = ctx.tab === 'slack' ? 'team' : ctx.tab === 'team' ? 'brew' : null;
    const post = ctx.post || (ctx.thread?.cardId ? A.byId(ctx.thread.cardId) : null);
    if (post) return open(post, { mode, draft: typeof ctx.ask === 'string' ? ctx.ask : '' });
    const S0 = ctx.moves ? { title: `Lift ${BNAME()}’s score`, starter: 'Which three moves lift our score fastest? Plan the first one with me.' }
      : ctx.batch ? { title: 'Week-one statics batch', starter: 'Plan the week-one static ads from our best-selling products.' }
      : ctx.bulk ? { title: `${ctx.bulk.length} saved cards, ${ctx.bulk.length} plans`, starter: '' }
      : ctx.signal ? { title: ctx.signal, starter: `Let’s act on this: ${ctx.signal}` } : { title: ctx.thread?.t || 'New jam', starter: '' };
    // a shortcut jam (moves, batch, these saved cards, this signal) is one jam: open the one already running instead of starting a copy
    const ctxKey = ctx.moves ? 'moves' : ctx.batch ? 'batch' : ctx.bulk ? 'bulk:' + ctx.bulk.map((x) => x.id).sort().join(',') : ctx.signal ? 'signal:' + ctx.signal : null;
    const live = (w) => !['deploying', 'measuring', 'result'].includes(w.stage);
    // jams made before shortcuts carried a key are matched by their title
    const running = ctxKey && (A.WORK.items.find((w) => w.ctxKey === ctxKey && live(w)) || A.WORK.items.find((w) => !w.ctxKey && live(w) && String(w.cardId).startsWith('jam-') && w.title === S0.title));
    const asCard = (w) => (String(w.cardId).startsWith('jam-') ? { id: w.cardId, title: w.title, sub: '', agent: w.agent || 'brew', sector: w.sector || 'creatives', kind: 'rows', bundle: w.bundle || null, _work: w } : A.byId(w.cardId) ? { ...A.byId(w.cardId), _work: w } : A.pseudoPost(w));
    if (running) return open(asCard(running), { mode });
    const card = { id: 'jam-' + Date.now().toString(36), title: S0.title, sub: S0.starter || 'A fresh jam. Say what you want made.', agent: 'brew', sector: ctx.bulk ? 'ads' : 'creatives', kind: 'rows', ctxKey };
    // several cards: one brief with one plan per card, made now, so nothing gets merged by a starter message
    if (ctx.bulk) return (async () => { const bundle = ctx.bulk.map((x) => x.id); const r = await A.tapi('POST', '/api/work', { cardId: card.id, card: { ...card, bundle, sub: `${bundle.length} plans in one brief, one per card.` } });
      if (!r.work) return toast('Couldn’t start the jam. Try again.'); A.putWork(r.work); open(asCard(r.work), { mode }); })();
    return open({ ...card, _new: true }, { mode, starter: S0.starter });
  };
  const fromHash = () => { const m = location.hash.match(/^#jam=([^&]+)/); if (!m) return; const w = A.WORK.items.find((x) => x.id === m[1]); if (w) open(A.byId(w.cardId) ? { ...A.byId(w.cardId), _work: w } : A.pseudoPost(w), { mode: 'chat' }); };
  const isEditing = () => !!document.activeElement?.closest?.('[data-jm-doc]');

  /* ---------- @ in every other composer (the jam page's chat #st-in, any textarea[data-at]): the same people as the
     jam pane, in a list that floats above the box (fixed, so no panel clips it). The jam pane's own box keeps its list */
  const AT = { box: null, i: 0 }, AT_BOX = '#st-in, textarea[data-at]';
  const atQuery = (box) => { const m = box.value.slice(0, box.selectionEnd ?? box.value.length).match(/(^|\s)@([\w ]*)$/); if (!m) return null; const q = m[2].toLowerCase();
    return q.endsWith(' ') && mentionList().some((x) => x.name.toLowerCase() === q.trim()) ? null : q; }; // a full name and a space: picked
  const atClose = () => { $('.at-pop')?.remove(); AT.box = null; };
  const atPaint = (box) => { const q = atQuery(box), ms = q == null ? [] : mentionList().filter((x) => x.name.toLowerCase().startsWith(q.trimStart())); if (!ms.length) return atClose();
    AT.box = box; AT.i = Math.min(AT.i, ms.length - 1); let pop = $('.at-pop'); if (!pop) { pop = document.createElement('div'); pop.className = 'jm-mentions at-pop'; pop.setAttribute('role', 'listbox'); document.body.appendChild(pop); }
    pop.innerHTML = ms.map((x, i) => `<button type="button" role="option" aria-selected="${i === AT.i}" class="${i === AT.i ? 'is-on' : ''}" data-at-pick="${esc(x.name)}">${x.html}<b>${esc(x.name)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('');
    const r = (box.closest('.it-row') || box).getBoundingClientRect(), w = Math.min(Math.max(r.width, 220), 360, innerWidth - 16); /* as wide as the composer row */
    Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`, width: `${w}px`, bottom: `${innerHeight - r.top + 6}px` }); };
  const atPick = (name) => { const box = AT.box; if (!box) return; const end = box.selectionEnd ?? box.value.length, head = box.value.slice(0, end).replace(/@[\w ]*$/, `@${name} `);
    box.value = head + box.value.slice(end); atClose(); box.focus(); box.setSelectionRange(head.length, head.length); box.dispatchEvent(new Event('input', { bubbles: true })); };
  document.addEventListener('input', (e) => { if (e.target.matches?.(AT_BOX)) { AT.i = 0; atPaint(e.target); } });
  document.addEventListener('keydown', (e) => { if (!AT.box || e.target !== AT.box || !$('.at-pop')) return; const opts = $$('.at-pop [data-at-pick]'); // before the box's own Enter-to-send
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { AT.i = (AT.i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; opts.forEach((o, i) => { o.classList.toggle('is-on', i === AT.i); o.setAttribute('aria-selected', i === AT.i); }); }
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') atPick(opts[AT.i]?.dataset.atPick);
    else if (e.key === 'Escape') atClose(); else return;
    e.preventDefault(); e.stopImmediatePropagation(); }, true);
  document.addEventListener('mousedown', (e) => { const b = e.target.closest?.('[data-at-pick]'); if (b) { e.preventDefault(); return atPick(b.dataset.atPick); } if (AT.box && !e.target.closest?.('.at-pop')) atClose(); }, true);
  document.addEventListener('focusout', (e) => { if (e.target === AT.box) setTimeout(() => { if (document.activeElement !== AT.box) atClose(); }, 120); });
  /* ---------- / commands in every chat box: type / and the commands show, filtered as you type; Enter or Tab picks ---------- */
  const CMDS = [{ cmd: '/update-brand-learnings', alias: ['learn', 'learnings', 'brand-learnings', 'update-learnings'], sub: 'Teach Brew from a call, notes or emails. Paste them after it' }];
  const SL = { box: null, i: 0 }, SL_BOX = '#st-in, textarea[data-at], #jm-in';
  const slMatches = (box) => { const m = box.value.slice(0, box.selectionEnd ?? box.value.length).match(/^\s*\/([\w-]*)$/); if (!m) return []; const q = m[1].toLowerCase();
    return CMDS.filter((c) => c.cmd.slice(1).startsWith(q) || c.alias.some((a) => a.startsWith(q)) || (q.length > 1 && c.cmd.includes(q))); };
  const slClose = () => { $('.sl-pop')?.remove(); SL.box = null; };
  const slPaint = (box) => { const ms = slMatches(box); if (!ms.length) return slClose(); SL.box = box; SL.i = Math.min(SL.i, ms.length - 1);
    let pop = $('.sl-pop'); if (!pop) { pop = document.createElement('div'); pop.className = 'jm-mentions at-pop sl-pop'; pop.setAttribute('role', 'listbox'); document.body.appendChild(pop); }
    pop.innerHTML = ms.map((c, i) => `<button type="button" role="option" aria-selected="${i === SL.i}" class="${i === SL.i ? 'is-on' : ''}" data-sl-pick="${esc(c.cmd)}"><b>${esc(c.cmd)}</b><small>${esc(c.sub)}</small></button>`).join('');
    const r = (box.closest('.it-row') || box.closest('form') || box).getBoundingClientRect(), w = Math.min(Math.max(r.width, 260), 420, innerWidth - 16);
    Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`, width: `${w}px`, bottom: `${innerHeight - r.top + 6}px` }); };
  const slPick = (cmd) => { const box = SL.box; if (!box) return; const end = box.selectionEnd ?? box.value.length, head = `${cmd} `;
    box.value = head + box.value.slice(end); slClose(); box.focus(); box.setSelectionRange(head.length, head.length); box.dispatchEvent(new Event('input', { bubbles: true })); window.Sound?.play?.('tick'); };
  document.addEventListener('input', (e) => { if (e.target.matches?.(SL_BOX)) { SL.i = 0; slPaint(e.target); } });
  document.addEventListener('keydown', (e) => { if (!SL.box || e.target !== SL.box || !$('.sl-pop')) return; const opts = $$('.sl-pop [data-sl-pick]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { SL.i = (SL.i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length; opts.forEach((o, i) => { o.classList.toggle('is-on', i === SL.i); o.setAttribute('aria-selected', i === SL.i); }); }
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') slPick(opts[SL.i]?.dataset.slPick);
    else if (e.key === 'Escape') slClose(); else return;
    e.preventDefault(); e.stopImmediatePropagation(); }, true);
  document.addEventListener('mousedown', (e) => { const b = e.target.closest?.('[data-sl-pick]'); if (b) { e.preventDefault(); return slPick(b.dataset.slPick); } if (SL.box && !e.target.closest?.('.sl-pop')) slClose(); }, true);
  document.addEventListener('focusout', (e) => { if (e.target === SL.box) setTimeout(() => { if (document.activeElement !== SL.box) slClose(); }, 120); });
  addEventListener('resize', atClose); addEventListener('scroll', (e) => { if (AT.box && !e.target?.closest?.('.at-pop')) atClose(); }, true);
  /* a message from the jam page that starts with @someone goes to them (Slack) or the Brew team, on the card's own jam */
  const mentionOf = (text) => (text.startsWith('@') ? mentionList().filter((x) => text.slice(1).toLowerCase().startsWith(x.name.toLowerCase()) && /^($|[\s,:])/.test(text.slice(1 + x.name.length))).sort((a, b) => b.name.length - a.name.length)[0] : null);
  const sendTo = async (p, text) => { text = String(text || '').trim();
    if (!DEMO) { const tags = tagsIn(text), toShopos = shoposIn(text); if ((!tags.length && !toShopos) || !p) return false; let w = A.workOfCard(p.id); if (!w) { const { _work, _ch, ...card } = p; const r = await A.tapi('POST', '/api/work', { cardId: p.id, card, decided: A.S.decided?.[p.id] || null }); w = r.work; if (w) A.putWork(w); }
      if (!w) { toast('That didn’t go through. Try again.'); return true; } const r = await A.tapi('POST', `/api/work/${w.id}/message`, { body: text, mentions: tags, shopos: toShopos }); if (r.work) A.putWork(r.work); toast(r.error ? esc(r.error) : `${ic('send', 's16')}Sent. They’ll get an email.`); return true; }
    const target = mentionOf(text); if (!target || !p) return false;
    let w = A.workOfCard(p.id); if (!w || ['measuring', 'result'].includes(w.stage)) { const { _work, _ch, ...card } = p; const r = await A.tapi('POST', '/api/work', { cardId: p.id, card, decided: A.S.decided?.[p.id] || null }); w = r.work; if (w) A.putWork(w); }
    if (!w) { toast('That didn’t go through. Try again.'); return true; }
    if (target.k === 'brew') { const r = w.with?.kind === 'brew' ? await A.tapi('POST', `/api/work/${w.id}/message`, { body: text }) : await A.tapi('POST', `/api/work/${w.id}/send`, { to: 'brew', note: text.replace(/^@[\w ]*?Brew team[\s,:]*/i, '') || text }); if (r.work) A.putWork(r.work); toast(`${ic('send', 's16')}Sent to the Brew team`); return true; }
    if (!A.conn('slack')) { A.openConnect('slack', { then: () => sendTo(p, text), why: 'Your teammate answers in Slack. Replies land in the jam and the brief.' }); return true; }
    const r = w.with?.kind === 'team' && w.with.id === target.k ? await A.tapi('POST', `/api/work/${w.id}/message`, { body: text }) : await A.tapi('POST', `/api/work/${w.id}/send`, { to: 'team', note: text, colleague: target.k, name: target.name, names: A.S.slack?.names, channel: A.S.slack?.channel });
    if (r.work) A.putWork(r.work); toast(`Simulated: nothing is sent. ${esc(target.name)} answers here as a Dummy.`); return true; };

  /* who has this jam open (from the open jam's poll): true when it changed, so the strip repaints */
  const setHere = (wid, list) => { const k = (list || []).map((x) => `${x.email}:${x.typing ? 1 : 0}`).sort().join(','), was = (JM.hereK ||= {})[wid]; JM.hereK[wid] = k; (JM.here ||= {})[wid] = list || []; return was !== undefined ? was !== k : !!list?.length; };
  window.JamRoom = { setHere, open, openFromCtx, close: () => {}, decorateDetail, fromHash, isOpen: () => false, isEditing, paint, addToBrief, send, sendTo, mentionOf, toHtml: (md) => toHtml(md) };
})();
