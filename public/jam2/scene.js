// Jam v2: one scene, one renderer. A board's picture is a list of layers (background, product, person, text, logo, badge,
// image) at exact positions on a canvas of the platform's size. The browser shows this HTML to edit it; the server shoots the
// same HTML with Chromium to download it, so what the brand sees is what they post. Pure: no DOM, no Node, runs in both.
//   scene: { w, h, bg: { color, src, fit, filter }, kit: { fonts: { heading, body }, colors: [] }, layers: [layer] }
//   layer: { id, kind: 'bg'|'product'|'person'|'image'|'text'|'logo'|'badge'|'shape', x, y, w, h, rot, z, hidden, locked,
//            src, fit, shadow, words, role: 'headline'|'sub'|'cta'|'small', style: { font, size, weight, color, align, bg, radius, pad, upper, lh } }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (x, d = 0) => (Number.isFinite(+x) ? Math.max(-20000, Math.min(20000, +x)) : d);
const clamp = (x, lo, hi, d) => (Number.isFinite(+x) ? Math.max(lo, Math.min(hi, +x)) : d);
/* single quotes: the stack goes inside a style="…" attribute, where a double quote would end it (and drop the size after it) */
const SAFE_FONTS = "'Helvetica Neue',Helvetica,Inter,Arial,sans-serif";
export const fontStack = (name) => { const n = String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 40); return n ? `'${n}',${SAFE_FONTS}` : SAFE_FONTS; };
/* the kit's fonts: a face the brand uploaded to its Brand Book (kit.files: [{ family, src, weight, style }], every weight kept) is loaded from its own file; any
   other name from Google Fonts; a font that is neither falls back to the safe stack, which the gate notes. srcOf turns a stored
   src into what the page can load (the server passes data: URIs) */
const FONT_SRC = /^(\/b\/[a-z0-9-]+\/a\/font-[\w.-]+|data:(font|application)\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)$/;
export const fontName = (f) => String(f || '').replace(/[^\w \-]/g, '').trim().slice(0, 40);
export const fontLink = (kit = {}, srcOf = (x) => x) => { const fs = [...new Set([kit.fonts?.heading, kit.fonts?.body].filter(Boolean).map(fontName).filter((f) => f.length >= 2))];
  const own = new Map(); for (const x of (Array.isArray(kit.files) ? kit.files : []).filter((y) => y?.family && y.src)) { const k = fontName(x.family).toLowerCase(); own.set(k, [...(own.get(k) || []), x]); }
  return fs.map((f) => { /* every uploaded weight and style of the family, so a bold headline uses the Bold file */
    const faces = (own.get(f.toLowerCase()) || []).map((x) => ({ ...x, src: srcOf(x.src) })).filter((x) => x.src && FONT_SRC.test(x.src));
    if (faces.length) return `<style>${faces.map((x) => `@font-face{font-family:'${f}';src:url("${x.src}");font-weight:${+x.weight || 400};font-style:${x.style === 'italic' ? 'italic' : 'normal'};font-display:block}`).join('')}</style>`;
    /* the plain family first (a one-weight face like Anton loads), then its bolder weights where it has them (Google refuses a
       weight list a family can't serve, and only that link fails) */
    const fam = encodeURIComponent(f).replace(/%20/g, '+');
    return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fam}&display=swap"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fam}:wght@400;600;700;800&display=swap">`; }).join(''); };

/* a style value goes inside style="…": only plain CSS words, numbers, colours and gradients (no quotes, ; < > or url()) */
const css = (v, d = '') => { const x = String(v ?? '').trim(); return x && x.length < 200 && /^[#\w\s.,%()+-]+$/.test(x) && !/url\s*\(|expression/i.test(x) ? x : d; };
const pick = (v, ok, d) => (ok.includes(v) ? v : d);
export function layerStyle(l) {
  const s = l.style || {}, rot = num(l.rot);
  const base = [`left:${num(l.x)}px`, `top:${num(l.y)}px`, `width:${num(l.w, 100)}px`, l.kind === 'text' ? '' : `height:${num(l.h, 100)}px`, `z-index:${num(l.z, 1)}`, rot ? `transform:rotate(${rot}deg)` : '', l.hidden ? 'display:none' : ''];
  if (l.kind === 'text' || l.kind === 'badge') base.push(`font-family:${fontStack(s.font)}`, `font-size:${clamp(s.size, 6, 600, 48)}px`, `font-weight:${clamp(s.weight, 100, 900, 700)}`, `color:${css(s.color, '#fff')}`, `text-align:${pick(s.align, ['left', 'center', 'right'], 'left')}`, `line-height:${clamp(s.lh, 0.6, 3, 1.12)}`,
    css(s.bg) ? `background:${css(s.bg)}` : '', s.pad ? `padding:${clamp(s.pad, 0, 400, 0)}px` : '', s.radius ? `border-radius:${clamp(s.radius, 0, 2000, 0)}px` : '', s.upper ? 'text-transform:uppercase' : '', s.shadow ? 'text-shadow:0 2px 18px rgba(0,0,0,.35)' : '', 'white-space:pre-wrap', 'overflow-wrap:break-word', 'letter-spacing:-.01em');
  if (l.blend === 'multiply') base.push('mix-blend-mode:multiply');
  if (l.kind === 'shape') base.push(`background:${css(s.bg, 'rgba(0,0,0,.4)')}`, s.radius ? `border-radius:${num(s.radius)}px` : '');
  return base.filter(Boolean).join(';');
}
const imgHtml = (l, srcOf) => { const src = srcOf(l.src); if (!src) return ''; const fit = pick(l.fit, ['cover', 'contain', 'fill'], l.kind === 'bg' ? 'cover' : 'contain');
  const sh = l.shadow ? `filter:drop-shadow(0 ${Math.round(num(l.h) * 0.03)}px ${Math.round(num(l.h) * 0.04)}px rgba(0,0,0,.35));` : '';
  return `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:${fit};${sh}" draggable="false" alt="">`; };

/* the scene as an HTML body fragment. srcOf turns a stored src ('gen/x.jpg', '/b/slug/refs/..', 'https://..') into what the page
   can load (the server passes data: URIs so Chromium needs no network); editable adds data-id for the canvas */
export function sceneBody(scene, { srcOf = (s) => s, editable = false } = {}) {
  const bg = scene.bg || {}, layers = [...(scene.layers || [])].sort((a, b) => num(a.z, 1) - num(b.z, 1));
  const bgImg = bg.src ? `<img class="j2-bgimg" src="${esc(srcOf(bg.src))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${pick(bg.fit, ['cover', 'contain', 'fill'], 'cover')};${css(bg.filter) ? `filter:${css(bg.filter)};` : ''}" draggable="false" alt="">` : '';
  const NAME = { text: 'Words', product: 'Product', logo: 'Logo', badge: 'Badge', image: 'Picture', person: 'Person' };
  const ls = layers.map((l) => { const id = editable ? ` data-id="${esc(l.id)}" data-kind="${esc(l.kind)}"${NAME[l.kind] && !l.hidden ? ` tabindex="0" role="button" aria-label="${esc(NAME[l.kind])}${l.words ? `: ${esc(String(l.words).slice(0, 60))}` : ''}"` : ''}` : '';
    const inner = l.kind === 'text' || l.kind === 'badge' ? esc(l.words || '') : l.kind === 'shape' ? '' : imgHtml(l, srcOf);
    return `<div class="j2-l j2-${esc(l.kind)}${l.locked ? ' j2-locked' : ''}"${id} style="position:absolute;${layerStyle(l)}">${inner}</div>`; }).join('');
  return `<div class="j2-scene" style="position:relative;width:${num(scene.w, 1080)}px;height:${num(scene.h, 1350)}px;overflow:hidden;background:${css(bg.color, '#eee')}">${bgImg}${ls}</div>`;
}
export function sceneHtml(scene, o = {}) {
  return `<!doctype html><html><head><meta charset="utf-8">${fontLink(scene.kit, o.srcOf)}<style>html,body{margin:0;padding:0;background:transparent}*{box-sizing:border-box}</style></head><body>${sceneBody(scene, o)}</body></html>`;
}

/* a new size from the same scene: layers keep their place by anchor (top/centre/bottom, left/centre/right) and scale with
   the shorter side, so a 4:5 ad becomes a 9:16 story with no model call (only an outpainted background costs anything) */
export function reflow(scene, w, h) {
  const k = Math.min(w / scene.w, h / scene.h), out = JSON.parse(JSON.stringify(scene)); out.w = w; out.h = h;
  for (const l of out.layers || []) {
    const cx = (num(l.x) + num(l.w) / 2) / scene.w, cy = (num(l.y) + num(l.h, num(l.style?.size, 48) * 2) / 2) / scene.h;
    l.w = Math.round(num(l.w) * k); if (l.h != null) l.h = Math.round(num(l.h) * k); if (l.style?.size) l.style.size = Math.round(l.style.size * k); if (l.style?.pad) l.style.pad = Math.round(l.style.pad * k);
    const ax = cx < 0.34 ? 'l' : cx > 0.66 ? 'r' : 'c', ay = cy < 0.34 ? 't' : cy > 0.66 ? 'b' : 'c';
    l.x = Math.round(ax === 'l' ? num(l.x) * (w / scene.w) : ax === 'r' ? w - (scene.w - num(l.x) - num(l.w) / k) * (w / scene.w) - l.w : w * cx - l.w / 2);
    const hh = l.h != null ? l.h : num(l.style?.size, 48) * 2;
    l.y = Math.round(ay === 't' ? num(l.y) * (h / scene.h) : ay === 'b' ? h - (scene.h - num(l.y)) * (h / scene.h) : h * cy - hh / 2);
    if (l.kind === 'bg') { l.x = 0; l.y = 0; l.w = w; l.h = h; }
  }
  /* a tall frame keeps words out of the top and bottom sixth, where Stories and Reels draw their own bars */
  if (h / w > 1.6) for (const l of out.layers || []) if (l.kind === 'text' || l.kind === 'badge') { const top = Math.round(h * 0.15), bot = Math.round(h * 0.82); if (l.y < top) l.y = top; if (l.y > bot) l.y = bot; }
  return out;
}

/* the type presets every static starts from: the brand's heading font and colours, words always real type, never drawn */
/* words that read on a colour: dark on a light or pastel brand colour, white on a dark one */
export const inkOn = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return '#ffffff'; const n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return (L + 0.05) / 0.0556 > 1.05 / (L + 0.05) ? '#111111' : '#ffffff'; }; /* the higher-contrast of the two (WCAG) */
export function typePreset(name, { w, h, kit = {}, headline = '', sub = '', cta = '', badge = '' }) {
  const head = kit.fonts?.heading || null, body = kit.fonts?.body || head, ink = kit.ink || '#ffffff', accent = kit.accent || kit.colors?.[0] || '#111111', u = Math.min(w, h * 1.25), pad = Math.round(u * 0.065); /* sized from the shorter side: a wide banner's headline can't cover the product */
  const tall = h / w > 1.6, top = tall ? Math.round(h * 0.16) : pad, big = Math.round(u * (headline.length < 26 ? 0.085 : headline.length < 48 ? 0.068 : 0.056));
  const L = [];
  if (name === 'bottom-bar') {
    L.push({ id: 'shade', kind: 'shape', x: 0, y: Math.round(h * (tall ? 0.6 : 0.62)), w, h: Math.round(h * (tall ? 0.4 : 0.38)), z: 5, style: { bg: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.72))' } });
    L.push({ id: 'headline', kind: 'text', role: 'headline', words: headline, x: pad, y: Math.round(h * (tall ? 0.66 : 0.68)), w: w - pad * 2, z: 6, style: { font: head, size: big, weight: 800, color: ink } });
    if (sub) L.push({ id: 'sub', kind: 'text', role: 'sub', words: sub, x: pad, y: Math.round(h * (tall ? 0.66 : 0.68)) + Math.round(big * 2.5), w: w - pad * 2, z: 6, style: { font: body, size: Math.round(big * 0.45), weight: 500, color: ink } });
  } else if (name === 'side-card') {
    L.push({ id: 'card', kind: 'shape', x: pad, y: top, w: Math.round(w * 0.56), h: Math.round(h * 0.34), z: 5, style: { bg: 'rgba(255,255,255,.94)', radius: Math.round(w * 0.02) } });
    L.push({ id: 'headline', kind: 'text', role: 'headline', words: headline, x: pad * 2, y: top + pad, w: Math.round(w * 0.56) - pad * 2, z: 6, style: { font: head, size: Math.round(big * 0.8), weight: 800, color: '#111' } });
    if (sub) L.push({ id: 'sub', kind: 'text', role: 'sub', words: sub, x: pad * 2, y: top + pad + Math.round(big * 2.2), w: Math.round(w * 0.56) - pad * 2, z: 6, style: { font: body, size: Math.round(big * 0.38), weight: 500, color: '#333' } });
  } else { /* top */
    L.push({ id: 'shade', kind: 'shape', x: 0, y: 0, w, h: Math.round(h * (tall ? 0.45 : 0.42)), z: 5, style: { bg: 'linear-gradient(180deg,rgba(0,0,0,.66),rgba(0,0,0,0))' } });
    L.push({ id: 'headline', kind: 'text', role: 'headline', words: headline, x: pad, y: top, w: w - pad * 2, z: 6, style: { font: head, size: big, weight: 800, color: ink, shadow: true } });
    if (sub) L.push({ id: 'sub', kind: 'text', role: 'sub', words: sub, x: pad, y: top + Math.round(big * 2.4), w: w - pad * 2, z: 6, style: { font: body, size: Math.round(big * 0.45), weight: 500, color: ink, shadow: true } });
  }
  if (badge) L.push({ id: 'badge', kind: 'badge', role: 'small', words: badge, x: w - pad - Math.round(w * 0.32), y: tall ? Math.round(h * 0.5) : Math.round(h * 0.52), w: Math.round(w * 0.32), z: 7, style: { font: body, size: Math.round(w * 0.028), weight: 700, color: '#111', bg: '#fff', radius: 999, pad: Math.round(w * 0.016), align: 'center' } });
  if (cta) L.push({ id: 'cta', kind: 'badge', role: 'cta', words: cta, x: pad, y: h - pad - Math.round(w * 0.075) - (tall ? Math.round(h * 0.16) : 0), w: Math.round(w * 0.36), z: 7, style: { font: body, size: Math.round(w * 0.03), weight: 700, color: inkOn(accent), bg: accent, radius: 999, pad: Math.round(w * 0.02), align: 'center' } });
  return L;
}
export const PRESETS = ['top', 'bottom-bar', 'side-card'];
/* a body of text as sentences and the breaks between them: even items are sentences, odd items the space or newline after.
   The canvas makes each sentence selectable; joining the list gives the text back exactly */
export const sentencesOf = (body) => String(body || '').split(/((?<=[.!?…])\s+|\n+)/);
