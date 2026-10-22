// Jam v2: the two exits. "Ready to post" is one link (/p/<token>) with every approved board in every size it runs in, one
// Download all, and copy buttons for the caption, post text, hashtags and alt text: the brand posts it from its own accounts.
// "Hand off" is a brief link (/brief/<token>) for an agency, a creator or the team, with the scripts and briefs on it. Both links
// are signed, open to anyone who has them, never expire, and the brand can turn them off (revoke). Nothing here posts anywhere.
import crypto from 'node:crypto';
import { reflow } from '../public/jam2/scene.js';
import { recipe, SIZES } from './catalogue.js';
import { headOf } from './core.js';

const KEYS = [...new Set([process.env.HANDOFF_SECRET, process.env.ANTHROPIC_API_KEY, process.env.K_SERVICE ? null : 'local'].filter(Boolean))].map((k) => crypto.createHash('sha256').update('brew-jam2:' + k).digest('hex'));
const sig = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64url').slice(0, 14);
export const tokenFor = (kind, slug, jid, nonce) => `${slug}~${jid}~${nonce}~${sig(KEYS[0], `${kind}/${slug}/${jid}/${nonce}`)}`;
export const parseToken = (kind, tok) => { const [slug, jid, nonce, s] = String(tok || '').split('~'); if (!slug || !jid || !nonce || !s) return null;
  return KEYS.some((k) => { const a = Buffer.from(sig(k, `${kind}/${slug}/${jid}/${nonce}`)), b = Buffer.from(s); return a.length === b.length && crypto.timingSafeEqual(a, b); }) ? { slug, jid, nonce } : null; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createReady({ maker, zipBuffer, log = console }) {
  /* the approved boards, each with its files in every size it runs in (re-laid out free from the same scene) */
  async function packOf(jam) {
    const out = [];
    for (const b of jam.boards) {
      const t = b.approved ? b.takes.find((x) => x.id === b.approved.takeId) : null; if (!t) continue;
      const r = recipe(b.recipe), files = [];
      if (t.slides?.length) t.slides.forEach((s, i) => files.push({ label: `Slide ${i + 1}`, file: s.file, size: b.size }));
      else if (t.scene && t.file) { files.push({ label: SIZES[b.size]?.label || b.size, file: t.file, size: b.size });
        for (const sz of (r.sizes || []).filter((x) => x !== b.size)) { const s = SIZES[sz]; if (!s) continue; const key = `${t.id}:${sz}`; t.sizes ||= {};
          if (!t.sizes[sz]) { try { t.sizes[sz] = await maker.render(reflow(t.scene, s.w, s.h)); } catch (e) { log.warn?.('[jam2] size', sz, e.message); continue; } }
          files.push({ label: s.label, file: t.sizes[sz], size: sz, key }); } }
      else if (t.file) files.push({ label: r.label, file: t.file });
      const w = t.words || {};
      out.push({ board: b.id, label: b.label || r.label, kind: r.kind, recipe: r.id, files, rows: w.rows || [], cols: w.cols || [], caption: [w.caption, (w.hashtags || []).join(' ')].filter(Boolean).join('\n\n'), body: w.body || '', subject: w.subject || '', alt: w.alt || w.headline || '', hashtags: w.hashtags || [], blocks: w.blocks || [], shots: t.timeline?.shots || [] });
    }
    return out;
  }
  async function zip(jam) {
    const items = await packOf(jam), files = [];
    for (const it of items) { const dir = it.label.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || it.board;
      for (const f of it.files) { const p = await maker.fileOf(f.file); if (!p) continue; const ext = String(f.file).split('.').pop(); files.push({ name: `${dir}/${(f.size || f.label).replace(/[^\w-]+/g, '-')}.${ext}`, data: (await import('node:fs')).readFileSync(p) }); }
      /* a change list goes as the sheet its tool takes; a video's voiceover as a captions file; an email as HTML */
      const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, H = (v) => String(v ?? '').replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
      if (it.rows?.length) files.push({ name: `${dir}/sheet.csv`, data: Buffer.from([(it.cols?.length ? it.cols : ['What', 'Where', 'Change']).map(csv).join(','), ...it.rows.map((r) => [r.a, r.b, r.c].map(csv).join(','))].join('\n'), 'utf8') });
      if (it.shots?.length && it.shots.some((x) => x.vo)) { let t0 = 0; const ts = (x) => `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor(x / 60) % 60).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')},000`;
        files.push({ name: `${dir}/captions.srt`, data: Buffer.from(it.shots.map((x, i) => { const a = t0; t0 += +x.sec || 4; return x.vo ? `${i + 1}\n${ts(a)} --> ${ts(t0)}\n${x.vo}\n` : ''; }).filter(Boolean).join('\n'), 'utf8') }); }
      if (it.kind === 'message' && it.body && it.subject) files.push({ name: `${dir}/email.html`, data: Buffer.from(`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>${H(it.subject)}</h2>${String(it.body).split(/\n+/).map((x) => `<p>${H(x)}</p>`).join('')}</body></html>`, 'utf8') });
      const txt = [it.subject && `Subject: ${it.subject}`, it.caption, it.body, it.alt && `Alt text: ${it.alt}`, ...it.blocks.map((b) => `## ${b.title}\n${b.text}`)].filter(Boolean).join('\n\n');
      if (txt) files.push({ name: `${dir}/caption.txt`, data: Buffer.from(txt, 'utf8') }); }
    return zipBuffer(files);
  }
  const STEPS = ['received', 'in progress', 'delivered'];
  const page = (jam, items, { kind = 'post', brand = '' } = {}) => {
    const card = (it) => `<section class="it"><h2>${esc(it.label)}</h2>${kind === 'brief' && it.status ? `<div class="st" data-board="${esc(it.board)}">${['sent', ...STEPS].map((s) => `<span class="${['sent', ...STEPS].indexOf(s) <= ['sent', ...STEPS].indexOf(it.status) ? 'on' : ''}">${esc(s)}</span>`).join('')}${STEPS.filter((s) => STEPS.indexOf(s) > STEPS.indexOf(it.status)).slice(0, 1).map((s) => `<button data-status="${esc(s)}">Mark ${esc(s)}</button>`).join('')}</div>` : ''}
      ${it.files.length ? `<div class="files">${it.files.map((f) => `<figure>${/\.mp4$/.test(f.file) ? `<video src="/${esc(f.file)}" controls playsinline></video>` : `<img src="/${esc(f.file)}" alt="${esc(it.alt)}">`}<figcaption>${esc(f.label)} · <a href="/${esc(f.file)}" download>Download</a></figcaption></figure>`).join('')}</div>` : ''}
      ${it.subject ? `<div class="copy"><b>Subject</b><p>${esc(it.subject)}</p><button data-copy="${esc(it.subject)}">Copy</button></div>` : ''}
      ${it.caption ? `<div class="copy"><b>Caption</b><p>${esc(it.caption).replace(/\n/g, '<br>')}</p><button data-copy="${esc(it.caption)}">Copy caption</button></div>` : ''}
      ${it.body ? `<div class="copy"><b>Post text</b><p>${esc(it.body).replace(/\n/g, '<br>')}</p><button data-copy="${esc(it.body)}">Copy text</button></div>` : ''}
      ${it.alt ? `<div class="copy small"><b>Alt text</b><p>${esc(it.alt)}</p><button data-copy="${esc(it.alt)}">Copy</button></div>` : ''}
      ${it.rows?.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px"><tr>${(it.cols?.length ? it.cols : ['What', 'Where', 'Change']).map((c) => `<th style="text-align:left;border-bottom:1px solid var(--line);padding:6px">${esc(c)}</th>`).join('')}</tr>${it.rows.map((r) => `<tr>${[r.a, r.b, r.c].map((c) => `<td style="border-bottom:1px solid var(--line);padding:6px">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''}
      ${it.blocks.length ? `<div class="doc">${it.blocks.map((b) => `<h3>${esc(b.title)}</h3><p>${esc(b.text).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
      ${it.shots.length && !it.files.length ? `<ol class="shots">${it.shots.map((s) => `<li><b>${esc(s.sec)} s</b> ${esc(s.see)}${s.vo ? `<br><i>VO: ${esc(s.vo)}</i>` : ''}${s.words ? `<br>On screen: ${esc(s.words)}` : ''}</li>`).join('')}</ol>` : ''}</section>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(kind === 'brief' ? 'Brief' : 'Ready to post')}: ${esc(jam.title)}</title>
<style>:root{--bg:#f6f5f2;--ink:#14161a;--mute:#6b6f76;--card:#fff;--line:#e6e3dc;--acc:#111}@media (prefers-color-scheme:dark){:root{--bg:#0f1012;--ink:#ecebe8;--mute:#9a9ca1;--card:#17181b;--line:#2a2b2f;--acc:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,Inter,sans-serif}main{max-width:980px;margin:0 auto;padding:28px 16px 60px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:22px}h1{margin:0;font-size:24px}header p{margin:4px 0 0;color:var(--mute)}
.all{background:var(--acc);color:var(--bg);padding:11px 18px;border-radius:999px;text-decoration:none;font-weight:600}.it{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px}
.it h2{margin:0 0 12px;font-size:17px}.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}figure{margin:0}figure img,figure video{width:100%;border-radius:10px;display:block;background:var(--line)}
figcaption{font-size:13px;color:var(--mute);margin-top:6px}figcaption a{color:inherit}.copy{border-top:1px solid var(--line);margin-top:14px;padding-top:12px;display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:start}
.copy b{grid-column:1/-1;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute)}.copy p{margin:0;white-space:normal}.copy button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit;font-size:13px}
.st{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:-4px 0 12px}.st span{font-size:12px;border-radius:999px;padding:3px 9px;background:var(--line);color:var(--mute)}.st span.on{background:#e3f4e8;color:#166534}.st button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:5px 12px;cursor:pointer;font:inherit;font-size:13px}
.doc h3{font-size:14px;margin:14px 0 4px}.doc p{margin:0}.shots{padding-left:18px}footer{color:var(--mute);font-size:13px;margin-top:24px}</style></head><body><main>
<header><div><h1>${esc(jam.title)}</h1><p>${esc(brand)}${brand ? ' · ' : ''}${kind === 'brief' ? 'Brief to make this' : 'Everything ready to post from your own accounts'}</p></div>${kind === 'post' && items.some((i) => i.files.length) ? '<a class="all" href="?zip=1">Download all</a>' : ''}</header>
${items.length ? items.map(card).join('') : '<p>Nothing approved yet.</p>'}
<footer>Made with Brew. ${kind === 'brief' ? 'Questions go back to the team that sent this.' : 'Brew doesn’t post anything: you post it.'}</footer></main>
<script>document.addEventListener('click',async(e)=>{const st=e.target.closest('[data-status]');if(st){st.disabled=true;const r=await fetch(location.pathname+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({board:st.closest('[data-board]').dataset.board,status:st.dataset.status})});if(r.ok)location.reload();else st.disabled=false;return}const b=e.target.closest('[data-copy]');if(!b)return;try{await navigator.clipboard.writeText(b.dataset.copy);const t=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=t,1400)}catch{}});</script></body></html>`; };
  return { packOf, zip, page };
}
