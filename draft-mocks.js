// What a first draft looks like where it will live, as one picture for the feed card: an email in an inbox, a WhatsApp
// message in a chat, a page section on a phone, a collection or catalog ad (a hero picture over a grid of the brand's
// real catalog photos). Pure HTML builders; drafts-bg.js shoots them with Chromium (drafts.js createMakers render).
// Every word is the draft's own, every photo is the brand's real product photo or the draft's hero, nothing invented.

import { splitCode, hasCode, codePre } from './code-md.js';

const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const hexOk = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
const lum = (h) => { const n = parseInt(h.slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
/* the brand's strongest colour that still carries white text */
export const accentOf = (brand = {}) => (brand.colors || []).filter(hexOk).find((c) => lum(c) < 0.4) || '#171717';

/* the draft's Markdown, read for a mock: the subject and preview lines lifted out, the body as simple HTML */
export function splitCopy(copy = '') {
  let subject = '', preview = '', button = ''; const keep = [];
  for (const raw of String(copy || '').split('\n')) {
    const l = raw.replace(/^\s*[*_]{0,2}/, '').replace(/[*_]{0,2}\s*$/, '');
    const m = /^(subject(?: line)?|preview(?: text)?|preheader|button|cta|headline)\s*[*_]{0,2}\s*[:\-]\s*(.+)$/i.exec(l.trim());
    if (m) { const k = m[1].toLowerCase(), v = m[2].replace(/[*_]{2}/g, '').replace(/^["“]|["”]$/g, '').trim(); if (k.startsWith('subject') || k === 'headline') subject ||= v; else if (k.startsWith('preview') || k === 'preheader') preview ||= v; else button ||= v; continue; }
    keep.push(raw);
  }
  return { subject, preview, button, body: keep.join('\n').trim() };
}
/* code the writer fenced (```json …```) is a code block, never a "```json" paragraph */
export function mdHtml(md = '', { max = 1400 } = {}) {
  return splitCode(String(md || '').slice(0, max)).map((x) => (x.code ? codePre(x, esc) : mdText(x.text))).join('');
}
function mdText(md = '') {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(\S(?:.*?\S)?)\*(?=\W|$)/g, '$1<b>$2</b>').replace(/(^|\W)_(\S(?:.*?\S)?)_(?=\W|$)/g, '$1<i>$2</i>').replace(/\[(.+?)\]\([^)]*\)/g, '<u>$1</u>');
  const out = []; let list = null, n = 0;
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trim(); if (!l) { if (list) { out.push(`</${list}>`); list = null; } continue; }
    const h = /^#{1,6}\s+(.+)$/.exec(l), li = /^[-*•]\s+(.+)$/.exec(l), ol = /^\d+[.)]\s+(.+)$/.exec(l);
    if (li || ol) { const k = li ? 'ul' : 'ol'; if (list !== k) { if (list) out.push(`</${list}>`); out.push(`<${k}>`); list = k; } out.push(`<li>${inline((li || ol)[1])}</li>`); continue; }
    if (list) { out.push(`</${list}>`); list = null; }
    out.push(h ? `<h3>${inline(h[1])}</h3>` : `<p>${inline(l)}</p>`); n++;
  }
  if (list) out.push(`</${list}>`);
  return out.join('');
}
const BASE = (w, h, css) => `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:"Helvetica Neue",Helvetica,Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}pre.code{margin:0 0 14px;padding:20px 22px;border-radius:14px;background:#0f172a;color:#e2e8f0;font:19px/1.42 Menlo,"SF Mono",Consolas,monospace;white-space:pre-wrap;word-break:break-word;text-align:left}pre.code code{font:inherit}${css}</style></head>`;
const fade = 'mask-image:linear-gradient(180deg,#000 90%,transparent);-webkit-mask-image:linear-gradient(180deg,#000 90%,transparent)';

/* an email as it opens on a phone: sender, subject, the brand's header, a real product photo, the words and the button */
export function emailHtml({ brand = {}, title = '', copy = '', photo = null, w = 1080, h = 1350 }) {
  if (hasCode(copy)) photo = null; /* markup or a snippet is not about a product: no product photo over it */
  const { subject, preview, button, body } = splitCopy(copy), ac = accentOf(brand), name = brand.name || brand.host || 'Brand';
  return `${BASE(w, h, `body{background:#eef0f3;padding:56px 70px}.app{height:100%;background:#fff;border-radius:36px;overflow:hidden;box-shadow:0 18px 60px rgba(15,20,30,.14);display:flex;flex-direction:column}
    .top{padding:38px 46px 26px;border-bottom:1px solid #e7e9ee}.from{display:flex;align-items:center;gap:20px}.av{width:72px;height:72px;border-radius:50%;background:${ac};color:#fff;display:grid;place-items:center;font-weight:700;font-size:34px}
    .from b{display:block;font-size:30px;color:#111}.from small{font-size:24px;color:#6b7280}.subj{margin:24px 0 0;font-size:40px;line-height:1.18;font-weight:700;color:#111}.pre{margin:8px 0 0;font-size:25px;color:#6b7280}
    .mail{flex:1;overflow:hidden;padding:0 0 30px;${fade}}.band{background:${ac};color:#fff;text-align:center;padding:22px;font-size:30px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .hero{display:block;width:100%;height:440px;object-fit:cover}.txt{padding:30px 54px 0;color:#1f2937;font-size:29px;line-height:1.42}.txt h3{font-size:36px;margin:0 0 14px;color:#111}.txt p{margin:0 0 16px}.txt ul,.txt ol{margin:0 0 16px;padding-left:36px}
    .btn{display:inline-block;margin:8px 54px 0;padding:22px 44px;border-radius:12px;background:${ac};color:#fff;font-size:28px;font-weight:700}`)}
    <body><div class="app"><div class="top"><div class="from"><span class="av">${esc(name[0] || 'B')}</span><span><b>${esc(name)}</b><small>to you · now</small></span></div>
    <h1 class="subj">${esc(subject || title)}</h1>${preview ? `<p class="pre">${esc(preview)}</p>` : ''}</div>
    <div class="mail"><div class="band">${esc(name)}</div>${photo ? `<img class="hero" src="${photo}" alt="">` : ''}<div class="txt">${mdHtml(body)}</div>${button ? `<span class="btn">${esc(button)}</span>` : ''}</div></div></body></html>`;
}

/* a WhatsApp message from the brand's business account: the product photo as an image message, the words as a bubble */
export function whatsappHtml({ brand = {}, title = '', copy = '', photo = null, w = 1080, h = 1350 }) {
  if (hasCode(copy)) photo = null; /* markup or a snippet is not about a product: no product photo over it */
  const { body, button } = splitCopy(copy), ac = accentOf(brand), name = brand.name || brand.host || 'Brand';
  return `${BASE(w, h, `body{background:#efeae2;display:flex;flex-direction:column}.bar{background:#075e54;color:#fff;display:flex;align-items:center;gap:22px;padding:40px 44px 30px}.av{width:76px;height:76px;border-radius:50%;background:${ac};display:grid;place-items:center;font-weight:700;font-size:34px;border:3px solid rgba(255,255,255,.5)}
    .bar b{display:block;font-size:34px}.bar small{font-size:24px;opacity:.85}.chat{flex:1;padding:36px 40px;overflow:hidden;${fade}}.day{margin:0 auto 26px;width:max-content;background:#fff;border-radius:12px;padding:8px 20px;font-size:22px;color:#54656f}
    .b{max-width:840px;background:#fff;border-radius:0 22px 22px 22px;padding:16px 18px 12px;box-shadow:0 2px 2px rgba(0,0,0,.08);margin-bottom:18px;font-size:30px;line-height:1.38;color:#111b21}.b img{display:block;width:100%;height:520px;object-fit:cover;border-radius:14px;margin-bottom:12px}
    .b p{margin:0 0 12px}.b ul,.b ol{margin:0 0 12px;padding-left:34px}.b h3{font-size:31px;margin:0 0 10px}.t{display:block;text-align:right;font-size:21px;color:#667781}.lnk{margin-top:6px;border-top:1px solid #e9edef;padding-top:14px;text-align:center;color:#027eb5;font-weight:600}`)}
    <body><div class="bar"><span class="av">${esc(name[0] || 'B')}</span><span><b>${esc(name)}</b><small>Business account</small></span></div>
    <div class="chat"><div class="day">Today</div><div class="b">${photo ? `<img src="${photo}" alt="">` : ''}${mdHtml(body || title, { max: 900 })}${button ? `<div class="lnk">${esc(button)}</div>` : ''}<span class="t">10:24</span></div></div></body></html>`;
}

/* a page section on a phone: the store's address bar, the section's headline and words over a real product photo */
export function pageHtml({ brand = {}, title = '', copy = '', photo = null, w = 1080, h = 1350 }) {
  if (hasCode(copy)) photo = null; /* markup or a snippet is not about a product: no product photo over it */
  const { subject, body, button } = splitCopy(copy), ac = accentOf(brand), name = brand.name || 'Brand', host = brand.host || '';
  return `${BASE(w, h, `body{background:#e9ebef;padding:50px 120px 0}.ph{height:100%;background:#fff;border-radius:52px 52px 0 0;overflow:hidden;box-shadow:0 18px 60px rgba(15,20,30,.16);display:flex;flex-direction:column}
    .url{margin:30px 34px 0;background:#f1f3f5;border-radius:18px;padding:16px 24px;font-size:24px;color:#4b5563;text-align:center}.nav{display:flex;justify-content:space-between;align-items:center;padding:26px 40px;font-weight:800;font-size:32px;color:#111;border-bottom:1px solid #eef0f2}
    .nav i{width:38px;height:4px;background:#111;display:block;box-shadow:0 11px 0 #111,0 -11px 0 #111}.pg{flex:1;overflow:hidden;${fade}}.hero{display:block;width:100%;height:470px;object-fit:cover}
    .sec{padding:34px 44px}.sec h1{margin:0 0 18px;font-size:46px;line-height:1.12;color:#111;letter-spacing:-.01em}.sec .tx{font-size:27px;line-height:1.45;color:#374151}.sec .tx p{margin:0 0 14px}.sec .tx ul,.sec .tx ol{margin:0 0 14px;padding-left:34px}.sec .tx h3{font-size:31px;margin:6px 0 10px;color:#111}
    .btn{display:block;margin:10px 0 0;padding:26px;border-radius:14px;background:${ac};color:#fff;text-align:center;font-size:29px;font-weight:700}`)}
    <body><div class="ph"><div class="url">${esc(host)}</div><div class="nav"><span>${esc(name)}</span><i></i></div>
    <div class="pg">${photo ? `<img class="hero" src="${photo}" alt="">` : ''}<div class="sec"><h1>${esc(subject || title)}</h1><div class="tx">${mdHtml(body, { max: 1100 })}</div>${button ? `<span class="btn">${esc(button)}</span>` : ''}</div></div></div></body></html>`;
}

/* a collection or catalog ad as it runs on Instagram: the hero picture over a grid of real catalog products */
export function collectionHtml({ brand = {}, title = '', hero = null, products = [], catalog = false, w = 1080, h = 1350 }) {
  const name = brand.name || brand.host || 'Brand', ac = accentOf(brand), ps = products.filter((p) => p?.img).slice(0, 4);
  const tiles = ps.map((p) => `<figure><img src="${p.img}" alt=""><figcaption><b>${esc(String(p.t || '').slice(0, 34))}</b>${p.price ? `<span>${esc(p.price)}</span>` : ''}</figcaption></figure>`).join('');
  return `${BASE(w, h, `body{background:#fff;display:flex;flex-direction:column}.top{display:flex;align-items:center;gap:20px;padding:28px 34px}.av{width:66px;height:66px;border-radius:50%;background:${ac};color:#fff;display:grid;place-items:center;font-weight:700;font-size:30px}
    .top b{display:block;font-size:28px;color:#111}.top small{font-size:22px;color:#6b7280}.hero{position:relative;height:${catalog ? 0 : 640}px;overflow:hidden;background:#f3f4f6}.hero img{width:100%;height:100%;object-fit:cover;display:block}
    .hero::after{content:'';position:absolute;inset:auto 0 0 0;height:55%;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.6))}.hero h2{position:absolute;z-index:1;left:34px;right:34px;bottom:28px;margin:0;color:#fff;font-size:46px;line-height:1.12;text-shadow:0 2px 18px rgba(0,0,0,.45)}.cap{margin:${catalog ? '4px 34px 18px' : '0'};font-size:40px;font-weight:700;color:#111;line-height:1.15}
    .grid{flex:1;min-height:0;grid-auto-rows:minmax(0,1fr);display:grid;grid-template-columns:repeat(${catalog ? 2 : Math.max(1, Math.min(4, ps.length))},1fr);gap:6px;padding:6px}.grid figure{margin:0;min-height:0;display:flex;flex-direction:column;background:#f6f7f9;overflow:hidden}
    .grid img{width:100%;flex:1;min-height:0;object-fit:cover;display:block;background:#fff}.grid figcaption{padding:12px 14px 14px;font-size:22px;color:#111;line-height:1.25}.grid figcaption b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.grid figcaption span{color:#4b5563}
    .cta{display:flex;justify-content:space-between;align-items:center;padding:22px 34px;background:${ac};color:#fff;font-size:28px;font-weight:700}`)}
    <body><div class="top"><span class="av">${esc(name[0] || 'B')}</span><span><b>${esc(name)}</b><small>Sponsored</small></span></div>
    ${catalog ? `<p class="cap">${esc(title)}</p>` : `<div class="hero">${hero ? `<img src="${hero}" alt="">` : ''}<h2>${esc(title)}</h2></div>`}
    <div class="grid">${tiles}</div><div class="cta"><span>Shop now</span><span>›</span></div></body></html>`;
}
