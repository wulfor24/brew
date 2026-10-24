/* Play while it brews (Catch the beans): an optional little game for the minutes a creative takes to make. Loaded only when
   someone opens it from the creative stage (creative-stage.js), never before. Beans and drops in the brand's colours fall; move
   the cup with the mouse, a finger or the arrow keys; a burnt bean costs a life. It speeds up, keeps a best score per person
   (on this device), pauses when the tab is hidden, and goes slower with no shake for reduced motion. The creative's progress
   stays on top the whole time; when it lands the game pauses and says so, with the score. Canvas only, no libraries. */
(() => {
  if (window.BrewGame?.ready) return;
  const css = `.bg-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  .bg-box{position:relative;width:min(420px,100%);height:min(640px,calc(100vh - 32px));background:var(--bg,#fff);color:var(--fg,#111);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .bg-top{padding:12px 14px 10px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--line,#eee)}
  .bg-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px}
  .bg-row b{font-size:14px}.bg-row small{color:var(--fg-3,#777);font-size:12px}
  .bg-bar{height:5px;border-radius:99px;background:var(--surface-2,#eee);overflow:hidden}.bg-bar i{display:block;height:100%;width:0;background:var(--fg,#111);transition:width .6s}
  .bg-x{border:0;background:var(--surface-2,#f0f0f0);color:var(--fg,#111);width:30px;height:30px;border-radius:99px;font-size:15px;cursor:pointer;flex:none}
  .bg-cv{flex:1;display:block;width:100%;touch-action:none;cursor:none}
  .bg-msg{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;padding:0 24px;display:flex;flex-direction:column;gap:10px;align-items:center;pointer-events:none}
  .bg-msg b{font-size:20px}.bg-msg span{font-size:13px;color:var(--fg-2,#555)}
  .bg-msg button{pointer-events:auto;border:0;background:var(--fg,#111);color:var(--on-fg,#fff);border-radius:99px;padding:10px 18px;font-weight:700;cursor:pointer}
  .bg-msg .bg-alt{background:var(--surface-2,#eee);color:var(--fg,#111)}`;
  const KEY = 'brew-game-best';
  const best = () => { try { return +localStorage.getItem(KEY) || 0; } catch { return 0; } };
  const keepBest = (n) => { try { if (n > best()) localStorage.setItem(KEY, String(n)); } catch {} };
  const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const cssVar = (k, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d; } catch { return d; } };
  let G = null;

  function open({ progress = () => null, brand = [], onSee = null } = {}) {
    if (G) return; if (!document.getElementById('bg-css')) { const st = document.createElement('style'); st.id = 'bg-css'; st.textContent = css; document.head.appendChild(st); }
    const ov = document.createElement('div'); ov.className = 'bg-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Play while it brews');
    ov.innerHTML = `<div class="bg-box"><div class="bg-top"><div class="bg-row"><b>Catch the beans</b><button class="bg-x" aria-label="Close the game">✕</button></div>
      <div class="bg-row"><small class="bg-line">Your creative is being made</small><small class="bg-score">0 · best ${best()}</small></div><div class="bg-bar"><i></i></div></div>
      <canvas class="bg-cv"></canvas><div class="bg-msg"><b>Catch the beans</b><span>Move the cup with your mouse, a finger or ← →. Catch beans and drops; dodge the burnt ones. Three lives.</span><button class="bg-go">Start</button></div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), cx = cv.getContext('2d'), box = ov.querySelector('.bg-box'), msg = ov.querySelector('.bg-msg');
    const colors = [...(brand.length ? brand : []), cssVar('--fg', '#111111')].filter(Boolean).slice(0, 4);
    const slow = calm() ? 0.6 : 1;
    G = { ov, run: false, over: false, landed: false, score: 0, lives: 3, t: 0, items: [], cup: { x: 0.5, w: 64 }, keys: {}, last: 0, spawn: 0 };
    const fit = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; cx.setTransform(d, 0, 0, d, 0, 0); G.W = r.width; G.H = r.height; };
    fit(); addEventListener('resize', fit);
    const at = (e) => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; G.cup.x = Math.max(0, Math.min(1, x / r.width)); };
    cv.addEventListener('pointermove', at); cv.addEventListener('touchmove', (e) => { e.preventDefault(); at(e); }, { passive: false });
    const kd = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { G.keys[e.key] = true; e.preventDefault(); } if (e.key === 'Escape') close(); };
    const ku = (e) => { G.keys[e.key] = false; };
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    const vis = () => { if (document.hidden && G?.run) pause('Paused', 'The tab was hidden. Your creative keeps being made.'); };
    document.addEventListener('visibilitychange', vis);
    const start = () => { Object.assign(G, { run: true, over: false, score: G.over ? 0 : G.score, lives: G.over ? 3 : G.lives, items: G.over ? [] : G.items, last: performance.now() }); msg.style.display = 'none'; requestAnimationFrame(tick); };
    function pause(title, line, buttons = '<button class="bg-go">Play on</button>') { G.run = false; msg.style.display = ''; msg.innerHTML = `<b>${title}</b><span>${line}</span>${buttons}`; }
    msg.addEventListener('click', (e) => { if (e.target.closest('.bg-go')) start(); if (e.target.closest('.bg-see')) { close(); onSee?.(); } });
    ov.querySelector('.bg-x').onclick = close; ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    function close() { if (!G) return; keepBest(G.score); removeEventListener('resize', fit); removeEventListener('keydown', kd); removeEventListener('keyup', ku); document.removeEventListener('visibilitychange', vis); clearInterval(G.pi); ov.remove(); G = null; }
    G.close = close;
    /* the creative's progress, every second: its line, how long so far; when it lands the game stops and says so */
    const line = ov.querySelector('.bg-line'), bar = ov.querySelector('.bg-bar i'), t0 = Date.now();
    G.pi = setInterval(() => { if (!G) return; const m = progress(); const secs = (Date.now() - (m?.at || t0)) / 1e3;
      if (m) { line.textContent = `Making ${String(m.line || 'your creative').slice(0, 60)} · ${secs < 60 ? `${Math.round(secs)} s` : `${Math.floor(secs / 60)} min`}`; bar.style.width = `${Math.min(92, (secs / (m.video ? 300 : 70)) * 100)}%`; }
      else if (!G.landed) done(); }, 1000);
    function done() { if (!G || G.landed) return; G.landed = true; bar.style.width = '100%'; line.textContent = 'Your creative is ready'; keepBest(G.score);
      pause('Your creative is ready', `You caught ${G.score}${G.score >= best() && G.score ? ' — a new best' : ''}.`, `<button class="bg-see">See it</button><button class="bg-go bg-alt">Keep playing</button>`); }
    G.done = done;
    const bean = (x, y, r, burnt) => { cx.save(); cx.translate(x, y); cx.rotate(0.5); cx.fillStyle = burnt ? '#1b1b1b' : '#7a4a2a'; cx.beginPath(); cx.ellipse(0, 0, r * 0.75, r, 0, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = burnt ? '#5a5a5a' : '#c79a6b'; cx.lineWidth = Math.max(1.5, r / 5); cx.beginPath(); cx.moveTo(0, -r * 0.8); cx.quadraticCurveTo(r * 0.3, 0, 0, r * 0.8); cx.stroke(); if (burnt) { cx.fillStyle = '#ff5a3c'; cx.fillRect(-1.5, -r - 6, 3, 5); } cx.restore(); };
    const drop = (x, y, r, c) => { cx.fillStyle = c; cx.beginPath(); cx.moveTo(x, y - r * 1.3); cx.quadraticCurveTo(x + r, y, x, y + r); cx.quadraticCurveTo(x - r, y, x, y - r * 1.3); cx.fill(); };
    const cup = () => { const w = G.cup.w, x = G.cup.x * (G.W - w), y = G.H - 54; cx.fillStyle = cssVar('--fg', '#111'); cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + w, y); cx.lineTo(x + w - 8, y + 40); cx.lineTo(x + 8, y + 40); cx.closePath(); cx.fill();
      cx.strokeStyle = cssVar('--fg', '#111'); cx.lineWidth = 5; cx.beginPath(); cx.arc(x + w + 2, y + 16, 10, -1.2, 1.2); cx.stroke();
      cx.fillStyle = cssVar('--bg', '#fff'); cx.font = '700 22px system-ui, sans-serif'; cx.textAlign = 'center'; cx.fillText('b', x + w / 2, y + 28); return { x, y, w }; };
    function tick(now) {
      if (!G || !G.run) return; const dt = Math.min(0.05, (now - G.last) / 1000); G.last = now; G.t += dt;
      const speed = (110 + G.t * 6) * slow, every = Math.max(0.35, 1.1 - G.t * 0.012);
      if (G.keys.ArrowLeft) G.cup.x = Math.max(0, G.cup.x - dt * 1.4); if (G.keys.ArrowRight) G.cup.x = Math.min(1, G.cup.x + dt * 1.4);
      G.spawn -= dt; if (G.spawn <= 0) { G.spawn = every; const r = Math.random(), kind = r < 0.18 + Math.min(0.17, G.t * 0.004) ? 'burnt' : r < 0.32 ? 'drop' : 'bean';
        G.items.push({ kind, x: 16 + Math.random() * (G.W - 32), y: -20, r: kind === 'drop' ? 9 : 11, v: speed * (0.85 + Math.random() * 0.35), c: colors[Math.floor(Math.random() * colors.length)] || '#3b82f6' }); }
      cx.clearRect(0, 0, G.W, G.H); cx.fillStyle = cssVar('--surface', '#f7f7f7'); cx.fillRect(0, 0, G.W, G.H);
      const c = cup();
      for (const it of G.items) { it.y += it.v * dt;
        if (!it.gone && it.y + it.r >= c.y && it.y - it.r <= c.y + 14 && it.x >= c.x - 4 && it.x <= c.x + c.w + 4) { it.gone = true;
          if (it.kind === 'burnt') { G.lives--; if (!calm()) box.animate?.([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 180 }); }
          else G.score += it.kind === 'drop' ? 2 : 1; }
        if (!it.gone) it.kind === 'bean' ? bean(it.x, it.y, it.r, false) : it.kind === 'burnt' ? bean(it.x, it.y, it.r, true) : drop(it.x, it.y, it.r, it.c); }
      G.items = G.items.filter((it) => !it.gone && it.y < G.H + 30);
      cx.fillStyle = cssVar('--fg', '#111'); cx.font = '600 13px system-ui, sans-serif'; cx.textAlign = 'left'; cx.fillText('♥'.repeat(Math.max(0, G.lives)), 12, 22);
      ov.querySelector('.bg-score').textContent = `${G.score} · best ${Math.max(best(), G.score)}`;
      if (G.lives <= 0) { G.over = true; keepBest(G.score); return pause('Out of beans', `You caught ${G.score}. Best: ${best()}.${G.landed ? ' Your creative is ready.' : ' Your creative is still being made.'}`, `${G.landed ? '<button class="bg-see">See it</button>' : ''}<button class="bg-go${G.landed ? ' bg-alt' : ''}">Play again</button>`); }
      requestAnimationFrame(tick); }
    G.start = start;
  }
  window.BrewGame = { ready: true, open, done: () => G?.done?.(), close: () => G?.close?.(), isOpen: () => !!G };
})();
