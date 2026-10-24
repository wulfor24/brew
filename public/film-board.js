/* The founder storyboard on the v1 stage (Param, 24 Oct): a film brief is drawn as the film it will be. One frame per shot
   with its time, what is seen and the line; every word edits in place. The founder films it for real: Brew never makes an AI
   founder, so a person shot is a sketch, and "Read it on camera" opens a teleprompter over the phone's own camera that can
   record the take on the device. The board itself comes from the server (film-board.js → ch.film); the pack carries
   storyboard.md, script.txt and captions.srt. app.js owns the page: init({ tapi, esc, ch, saved, ... }). */
(() => {
  const H = {}; let TP = null;
  const srcOf = (s) => (!s ? '' : /^(https?:|data:|blob:|\/)/.test(s) ? s : '/' + s);
  const KIND = { person: 'To camera', hands: 'Hands', product: 'Product', scene: 'Scene' };
  /* a person is drawn, never generated: head and shoulders in line, so nobody mistakes it for the founder */
  const sketch = (who) => `<svg class="fb-sk" viewBox="0 0 90 160" aria-hidden="true"><circle cx="45" cy="62" r="17"/><path d="M14 132c3-26 16-40 31-40s28 14 31 40"/><text x="45" y="152" text-anchor="middle">${H.esc(who)}</text></svg>`;
  const hand = '<svg class="fb-hand" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10m0-4.5v-1a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L4 15.5a1.6 1.6 0 0 1 2.5-2L8 15"/></svg>';
  const sec = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
  const ed = (k, v, ph) => `<span class="fb-ed" data-fb-edit="${k}" tabindex="0">${v ? H.esc(v) : `<em>${H.esc(ph)}</em>`}</span>`;

  function frame(f, s, i) {
    const pic = s.who === 'person' ? sketch(f.talent.replace(/^the /i, '').replace(/\s*[(,].*$/, '').slice(0, 18) || 'On camera')
      : f.img && s.who !== 'scene' ? `<img src="${H.esc(srcOf(f.img))}" alt="">${s.who === 'hands' ? hand : ''}`
      : `<span class="fb-scene">${H.esc(s.shot.slice(0, 60))}</span>`;
    const said = s.say ? 'Said to camera' : f.vo ? 'Voiceover' : 'On screen';
    return `<figure class="fb-f is-${s.who}"><div class="fb-pic r${f.format.replace(':', '')}">${pic}<span class="fb-t">${sec(s.from)}–${sec(s.to)} s</span><span class="fb-k">${KIND[s.who]}</span></div>
      <figcaption><b>${i + 1}</b>${ed(`${i}.shot`, s.shot, 'What we see')}<p>${ed(`${i}.line`, s.line, 'The line')}</p><small>${said}</small>${f.shots.length > 1 ? `<button class="fb-x" data-fb-drop="${i}" aria-label="Drop shot ${i + 1}" title="Drop this shot">×</button>` : ''}</figcaption></figure>`;
  }

  function html(ch) {
    const f = ch.film, p = ch.pkg || {}; if (!f) return '';
    const meta = [['Where', p.location], ['Due', p.deadline]].filter(([, v]) => v && !/^to confirm$/i.test(v));
    return `<div class="fb" data-fb>
      <div class="fb-top"><small>Storyboard · ${f.total} s · ${H.esc(f.format)} · ${f.shots.length} shots</small><h3>${ed('title', p.title, 'Working title')}</h3>
        <p class="fb-cam">On camera: <b>${H.esc(f.talent)}</b>, filmed for real. Brew draws the frames; it never makes an AI ${f.founder ? 'founder' : 'person'}.</p></div>
      <div class="fb-strip">${f.shots.map((s, i) => frame(f, s, i)).join('')}<button class="fb-add" data-fb-add title="Add a shot">＋<small>Add a shot</small></button></div>
      ${f.readSec > f.total + 2 ? `<p class="fb-warn">The lines take about ${f.readSec} s to say, longer than this ${f.total} s film: trim a line, or ask in the chat for a ${Math.ceil(f.readSec / 5) * 5} s cut.</p>` : ''}
      <div class="fb-acts">${f.script ? `<button class="j2-pri" data-fb-tp>Read it on camera</button><span>${f.vo ? 'The voiceover' : 'The lines said to camera'} take about ${Math.max(1, f.readSec)} s to say</span>` : '<span>Add a line to a shot to get the script</span>'}</div>
      ${(p.deliverables || []).length ? `<div class="sh-chips">${p.deliverables.map((d) => `<span>${H.esc(d)}</span>`).join('')}</div>` : ''}
      ${meta.length ? `<dl class="sh-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${H.esc(v)}</dd></div>`).join('')}</dl>` : ''}</div>`;
  }

  async function save(pkg, reason) { const ch = H.ch(); if (!ch) return;
    const r = await H.tapi('POST', `/api/changes/${ch.id}/edit`, { pkg, reason }).catch((e) => ({ error: e?.message || 'That didn’t save.' }));
    if (r.error) { H.toast?.(H.esc(r.error)); H.sound?.('error'); return H.paint(); }
    H.saved(r.change); H.sound?.('tick'); }
  const scenes = () => (H.ch()?.film?.shots || []).map((x) => ({ shot: x.shot, line: x.line })); /* the shots as the board reads them (a row holding several shots is split), so an edit saves them split */
  function commit(el) { const k = el.dataset.fbEdit, now = el.innerText.replace(/\s+/g, ' ').trim(), was = el.dataset.was ?? ''; el.removeAttribute('contenteditable'); delete el.dataset.was;
    if (now === was) { if (!now) H.paint(); return; } /* unchanged: no repaint (the next click lands first time); an empty one gets its placeholder back */
    if (k === 'title') return save({ title: now || was }, 'Working title changed');
    const [i, col] = k.split('.'), rows = scenes(); if (!rows[+i]) return H.paint(); rows[+i][col] = now; save({ scenes: rows }, `Shot ${+i + 1} changed`); }

  function click(e) {
    const g = (s) => e.target.closest(s); if (!g('[data-fb], #fb-tp')) return false;
    const el = g('[data-fb-edit]'); if (el) { if (el.isContentEditable) return true; el.dataset.was = el.querySelector('em') ? '' : el.textContent; if (el.querySelector('em')) el.textContent = ''; el.contentEditable = 'plaintext-only'; el.focus(); return true; }
    if (g('[data-fb-add]')) { const rows = scenes(); rows.push({ shot: 'Close-up: the product', line: '' }); save({ scenes: rows }, 'A shot added'); return true; }
    const d = g('[data-fb-drop]'); if (d) { const rows = scenes(); if (rows.length > 1) { rows.splice(+d.dataset.fbDrop, 1); save({ scenes: rows }, `Shot ${+d.dataset.fbDrop + 1} dropped`); } return true; }
    if (g('[data-fb-tp]')) { prompter(H.ch()); return true; }
    return tpClick(e);
  }
  const editing = () => !!document.activeElement?.closest?.('.fb [contenteditable]');
  document.addEventListener('focusout', (e) => { const el = e.target.closest?.('[data-fb-edit]'); if (el?.isContentEditable) commit(el); });
  addEventListener('keydown', (e) => { if (TP && e.key === 'Escape') return tpClose(); if (TP && e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); return tpToggle(); }
    const el = e.target.closest?.('[data-fb-edit]'); if (!el?.isContentEditable) return;
    if (e.key === 'Escape') { el.textContent = el.dataset.was || ''; el.removeAttribute('contenteditable'); H.paint(); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } });

  /* the teleprompter: big lines scrolling over the front camera, mirrored like a mirror; recording stays on this device */
  function prompter(ch) {
    const f = ch?.film; if (!f?.script) return;
    const lines = f.script.split(/\n\n+/);
    const el = document.createElement('div'); el.id = 'fb-tp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Teleprompter');
    el.innerHTML = `<video class="tp-cam" playsinline muted></video><div class="tp-shade"></div>
      <div class="tp-read"><div class="tp-txt">${lines.map((l) => `<p>${H.esc(l)}</p>`).join('')}<p class="tp-end">That’s the take.</p></div></div><i class="tp-eye" aria-hidden="true"></i>
      <div class="tp-count" hidden></div>
      <div class="tp-bar"><button data-tp="go" class="j2-pri">Start</button><span class="tp-g"><button data-tp="slow" aria-label="Slower">−</button><small>Speed</small><button data-tp="fast" aria-label="Faster">+</button></span>
        <span class="tp-g"><button data-tp="small" aria-label="Smaller text">A−</button><button data-tp="big" aria-label="Bigger text">A+</button></span>
        <button data-tp="cam">Camera</button><button data-tp="rec" hidden>Record</button><a class="tp-save" hidden download>Save the take</a><button data-tp="x" aria-label="Close">Close</button></div>`;
    document.body.appendChild(el); document.body.classList.add('tp-open');
    TP = { el, on: false, y: 0, last: 0, speed: 38, size: innerWidth < 600 ? 30 : 44, stream: null, rec: null, parts: [], url: null };
    el.querySelector('.tp-txt').style.fontSize = TP.size + 'px';
  }
  const tpBtn = (k) => TP?.el.querySelector(`[data-tp="${k}"]`);
  function tick(t) { if (!TP?.on) return; const dt = TP.last ? (t - TP.last) / 1000 : 0; TP.last = t; const r = TP.el.querySelector('.tp-read');
    r.scrollTop += TP.speed * dt; if (r.scrollTop + r.clientHeight >= r.scrollHeight - 2) { tpStop(); return; } requestAnimationFrame(tick); }
  function tpStart() { if (TP.counting || TP.on) return; const c = TP.el.querySelector('.tp-count'); let n = 3; TP.counting = true; c.hidden = false; c.textContent = n; tpBtn('go').disabled = true;
    const step = () => { if (!TP) return; n -= 1; if (n > 0) { c.textContent = n; setTimeout(step, 700); return; } c.hidden = true; tpBtn('go').disabled = false; TP.counting = false; TP.on = true; TP.last = 0; tpBtn('go').textContent = 'Pause'; requestAnimationFrame(tick); };
    setTimeout(step, 700); }
  function tpStop() { if (!TP) return; TP.on = false; tpBtn('go').textContent = 'Start'; }
  function tpToggle() { if (!TP || TP.counting) return; if (TP.on) tpStop(); else { const r = TP.el.querySelector('.tp-read'); if (r.scrollTop + r.clientHeight >= r.scrollHeight - 2) r.scrollTop = 0; tpStart(); } }
  async function tpCam() { if (TP.stream) { TP.stream.getTracks().forEach((x) => x.stop()); TP.stream = null; TP.el.classList.remove('has-cam'); tpBtn('rec').hidden = true; return; }
    try { TP.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: true }); }
    catch { H.toast?.('The camera didn’t open. Allow the camera for this site, or read from the screen without it.'); return; }
    const v = TP.el.querySelector('.tp-cam'); v.srcObject = TP.stream; v.play().catch(() => {}); TP.el.classList.add('has-cam'); tpBtn('rec').hidden = !window.MediaRecorder; }
  function tpRec() { if (TP.rec) { TP.rec.stop(); return; }
    const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
    const me = TP, parts = []; me.rec = new MediaRecorder(me.stream, type ? { mimeType: type } : {}); const rec = me.rec;
    rec.ondataavailable = (ev) => ev.data.size && parts.push(ev.data);
    /* the take is saved even when the teleprompter was closed while recording: it downloads straight away */
    rec.onstop = () => { const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' }), name = `take-${Date.now()}.${/mp4/.test(blob.type) ? 'mp4' : 'webm'}`, url = URL.createObjectURL(blob);
      if (TP !== me) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60e3); H.toast?.('Your take was saved to this device.'); return; }
      const a = me.el.querySelector('.tp-save'); if (me.url) URL.revokeObjectURL(me.url); me.url = url; a.href = url; a.download = name; a.hidden = false; me.rec = null; tpBtn('rec').textContent = 'Record again'; me.el.classList.remove('is-rec'); tpStop(); };
    TP.rec.start(); TP.el.classList.add('is-rec'); tpBtn('rec').textContent = 'Stop'; TP.el.querySelector('.tp-save').hidden = true; const r = TP.el.querySelector('.tp-read'); r.scrollTop = 0; if (!TP.on) tpStart(); }
  function tpClose() { if (!TP) return; TP.on = false; TP.rec?.state === 'recording' && TP.rec.stop(); TP.stream?.getTracks().forEach((x) => x.stop()); const u = TP.url; TP.el.remove(); document.body.classList.remove('tp-open'); TP = null; if (u) setTimeout(() => URL.revokeObjectURL(u), 60e3); }
  function tpClick(e) { if (!TP || !e.target.closest('#fb-tp')) return false; const b = e.target.closest('[data-tp]'); if (!b) return true; const k = b.dataset.tp, txt = TP.el.querySelector('.tp-txt');
    if (k === 'go') tpToggle(); else if (k === 'slow') TP.speed = Math.max(12, TP.speed - 8); else if (k === 'fast') TP.speed = Math.min(140, TP.speed + 8);
    else if (k === 'small' || k === 'big') { TP.size = Math.min(80, Math.max(20, TP.size + (k === 'big' ? 6 : -6))); txt.style.fontSize = TP.size + 'px'; }
    else if (k === 'cam') tpCam(); else if (k === 'rec') tpRec(); else if (k === 'x') tpClose();
    return true; }

  window.FilmBoard = { init: (h) => Object.assign(H, h), html, click, editing, open: (ch) => prompter(ch), close: tpClose };
})();
