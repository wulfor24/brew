// Talk instead of type, on every text box. Tap into any box and a mic shows at its corner; tap it, speak, tap again.
// The words appear live while you talk (where the browser can), and the final text comes from the server
// (/api/transcribe: Hindi and English mixed). In a chat box the message sends itself, with 3 seconds to undo;
// in a form box the text is filled in for you to check. New boxes need nothing: it follows focus.
(() => {
  if (window.Mic) return;
  const canRec = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!canRec) { window.Mic = { supported: false }; return; } // no mic here: typing as before, no broken button
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SKIP = 'input[type=email],input[type=password],input[type=url],input[type=number],input[type=tel],input[type=date],input[type=file],input[type=checkbox],input[type=radio],input[type=range],input[type=color],[data-nomic],.lx-text';
  const isBox = (el) => el && el.matches?.('textarea,input:not([type]),input[type=text],input[type=search],[contenteditable=""],[contenteditable=true]') && !el.matches(SKIP) && !el.disabled && !el.readOnly;
  // chat composers send on their own; everything else is filled in
  const SENDS = '#jm-in,#st-in,[data-mic=send]';
  const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mic-b'; btn.setAttribute('aria-label', 'Talk instead of typing'); btn.innerHTML = MIC; btn.hidden = true;
  const bub = document.createElement('div'); bub.className = 'mic-bub'; bub.setAttribute('role', 'status'); bub.hidden = true;
  const add = () => { document.body.append(btn, bub); };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);

  let field = null, rec = null, chunks = [], stream = null, sr = null, heard = '', t0 = 0, timer = null, hideT = null;
  const place = () => { if (!field || !field.isConnected) return hide(); const r = field.getBoundingClientRect(); const own = field.hasAttribute('data-ownmic'); /* a box with its own mic button: no second, floating one */ if (!r.width || r.bottom < 0 || r.top > innerHeight) return hide(true);
    const s = 30, x = Math.min(innerWidth - s - 6, r.right - s - 6), y = field.tagName === 'INPUT' ? Math.max(6, r.top + (r.height - s) / 2) /* a one-line box: centred */ : Math.max(6, r.bottom - s - 6);
    btn.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; btn.hidden = own;
    bub.style.transform = `translate(${Math.round(Math.max(8, Math.min(innerWidth - 288, r.left)))}px,${Math.round(Math.max(8, r.top - 52))}px)`; };
  const hide = (soft) => { if (rec) return; btn.hidden = true; if (!soft) field = null; };
  const show = (el) => { clearTimeout(hideT); field = el; place(); };
  document.addEventListener('focusin', (e) => { if (isBox(e.target)) show(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target === field && !rec) hideT = setTimeout(() => { if (document.activeElement !== btn) hide(); }, 180); });
  addEventListener('scroll', () => field && place(), true); addEventListener('resize', () => field && place());
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the box focused

  const say = (html, keep) => { bub.innerHTML = html; bub.hidden = false; if (!keep) setTimeout(() => { if (!rec) bub.hidden = true; }, 2600); };
  const insert = (el, text) => {
    if (!text) return;
    if (el.isContentEditable) { el.focus(); document.execCommand('insertText', false, (el.textContent.trim() ? ' ' : '') + text); return; }
    const v = el.value || '', a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length, pre = v.slice(0, a), sp = pre && !/\s$/.test(pre) ? ' ' : '';
    const nv = pre + sp + text + v.slice(b); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; setter ? setter.call(el, nv) : (el.value = nv);
    const at = (pre + sp + text).length; try { el.setSelectionRange(at, at); } catch {}
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.focus();
  };
  // a chat box sends what was said after 3 seconds, unless you tap Undo
  const autoSend = (el, text, before) => {
    let n = 3; const tick = () => say(`<span>Sending in ${n}…</span><button type="button" class="mic-undo">Undo</button>`, true);
    tick(); const iv = setInterval(() => { n--; if (n > 0) return tick(); clearInterval(iv); bub.hidden = true;
      if (el.form?.requestSubmit) el.form.requestSubmit(); else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, 1000);
    bub.querySelector('.mic-undo').onclick = () => { clearInterval(iv); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; setter ? setter.call(el, before) : (el.value = before); el.dispatchEvent(new Event('input', { bubbles: true })); say('Kept it out. Edit and send when ready.'); el.focus(); };
  };

  const start = async () => {
    const el = field; if (!el) return;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { say('The mic is blocked. Allow it in the browser’s site settings, or type.'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunks = []; heard = ''; t0 = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => finish(el, rec.mimeType || type || 'audio/webm');
    rec.start(250); btn.classList.add('is-on'); btn.innerHTML = STOP; btn.setAttribute('aria-label', 'Stop and use what I said');
    if (SR) { try { sr = new SR(); sr.lang = document.documentElement.lang === 'hi' ? 'hi-IN' : 'en-IN'; sr.interimResults = true; sr.continuous = true;
      sr.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(' '); say(`<i class="mic-dot"></i><span>${heard.replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c])).slice(-140)}</span>`, true); };
      sr.onerror = () => {}; sr.start(); } catch { sr = null; } }
    const tk = () => { const s = Math.round((Date.now() - t0) / 1000); if (!heard) say(`<i class="mic-dot"></i><span>Listening… ${s}s</span>`, true); if (s >= 120) stop(); };
    tk(); timer = setInterval(tk, 1000);
  };
  const stop = () => { clearInterval(timer); try { sr?.stop(); } catch {} sr = null; if (rec?.state === 'recording') rec.stop(); stream?.getTracks().forEach((x) => x.stop()); btn.classList.remove('is-on'); btn.innerHTML = MIC; btn.setAttribute('aria-label', 'Talk instead of typing'); };
  const finish = async (el, mime) => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] }); rec = null;
    if (blob.size < 1200) { say('Didn’t catch anything. Tap the mic and talk.'); return; }
    say('<i class="mic-spin"></i><span>Writing it down…</span>', true);
    let text = '';
    try { const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': mime.split(';')[0] }, body: blob }); const j = await r.json(); text = j.text || ''; if (!text && j.error) say(j.error); }
    catch { say('Couldn’t reach the server. What you said live is below.'); }
    text = (text || heard || '').trim(); if (!text) { if (!bub.textContent) say('Didn’t catch that. Try again.'); return; }
    const before = el.value ?? ''; insert(el, text);
    if (el.matches(SENDS)) autoSend(el, text, before); else say('Filled in. Check it, then carry on.');
    el.dispatchEvent(new CustomEvent('mic:text', { bubbles: true, detail: { text } }));
  };
  btn.addEventListener('click', () => (rec ? stop() : start()));
  // other code can open the mic on a box directly (the Report back sheet's big button)
  window.Mic = { supported: true, talk: (el) => { show(el); el.focus(); start(); }, stop, get on() { return !!rec; } };
})();
