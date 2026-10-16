// Brew move PDF template: Move JSON (see SPEC.md) + brand info -> standalone print HTML.
// Chromium paged media: named pages (`page: cover`) for the cover and closing page (full bleed, no
// running footer), @page margin boxes for the running footer and page number, page counter reset so
// the first body page is page 1. Fonts and textures load from feed/pdf/ by file URL (offline-safe).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { coverArt } from './brand-art.js';

const PDF_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ASSET_BASE = pathToFileURL(PDF_DIR + path.sep).href;

export const GROUPS = {
  know: { h: 'Know the brand', sub: 'Foundation', short: 'KNOW THE BRAND' },
  found: { h: 'Be found', sub: 'Organic', short: 'BE FOUND' },
  reach: { h: 'Reach people', sub: 'Paid, social, creators', short: 'REACH PEOPLE' },
  convert: { h: 'Convert the visit', sub: 'Site and listings', short: 'CONVERT THE VISIT' },
  keep: { h: 'Keep the customer', sub: 'Retention', short: 'KEEP THE CUSTOMER' },
  expand: { h: 'Expand and operate', sub: 'B2B and ops', short: 'EXPAND & OPERATE' },
};
const GROUP_ORDER = ['know', 'found', 'reach', 'convert', 'keep', 'expand'];

// ---------- text helpers ----------
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Escape, then allow **bold** and `code` (paths). Newlines become <br>. */
export function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>');
  return t.replace(/\n/g, '<br>');
}
// red wavy rule under every H1: one vector path across the content width (493pt)
const WAVE_W = 493.3, WAVE_P = 13.6, WAVE_A = 2.15;
const WAVE_D = (() => {
  let d = `M0 3.5`;
  for (let x = 0; x < WAVE_W; x += WAVE_P) {
    const h = WAVE_P / 2;
    d += ` C${(x + h * 0.36).toFixed(2)} ${(3.5 - WAVE_A * 1.33).toFixed(2)} ${(x + h * 0.64).toFixed(2)} ${(3.5 - WAVE_A * 1.33).toFixed(2)} ${(x + h).toFixed(2)} 3.5`;
    d += ` S${(x + h + h * 0.64).toFixed(2)} ${(3.5 + WAVE_A * 1.33).toFixed(2)} ${(x + WAVE_P).toFixed(2)} 3.5`;
  }
  return d;
})();
const WAVE = `<svg class="wave" viewBox="0 0 ${WAVE_W} 7" preserveAspectRatio="xMinYMid slice" aria-hidden="true"><path d="${WAVE_D}" fill="none" stroke="#a9121f" stroke-width="1.15"/></svg>`;
const h1 = (text) => `<h1 class="h1"><span>${esc(up(text))}</span>${WAVE}</h1>`;
const up = (s) => String(s ?? '').toUpperCase();
const pad2 = (n) => String(n ?? 0).padStart(2, '0');
// footer strings go into CSS `content: "..."`
const cssStr = (s) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';

// ---------- pieces ----------
const MARK = `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22.2" fill="none" stroke="currentColor" stroke-width="2.4"/>
<path d="M17.2 11.5c-3 4 3 8.2 0 12.4s3 8.4 0 12.6M24 11.5c-3 4 3 8.2 0 12.4s3 8.4 0 12.6M30.8 11.5c-3 4 3 8.2 0 12.4s3 8.4 0 12.6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>`;

function lockup() {
  return `<div class="lockup">${MARK}<div><div class="lk-name">Brew</div><div class="lk-team">DEPLOYMENT TEAM</div></div></div>`;
}

function cover(move, brand, isIndex) {
  const kicker = isIndex ? `${up(move.kicker || 'THE PLAYBOOK')} · INDEX` : `${up(move.kicker)} · MOVE ${pad2(move.n)}${move.family ? '' : ` OF ${move.of || 50}`}`;
  const sub = move.subtitle || move.gives;
  return `<section class="cover">
<img class="tex tex-waves" src="${ASSET_BASE}assets/cover-waves.png" alt="">
<img class="tex tex-mesh" src="${ASSET_BASE}assets/cover-mesh.png" alt="">
${lockup()}
<div class="prepared">PREPARED FOR <b>${esc(up(brand.name))}</b>${brand.descriptor ? ` · ${esc(up(brand.descriptor))}` : ''}</div>
<div class="cv-main">
  <div class="cv-kicker">${esc(kicker)}</div>
  <h1 class="cv-title">${esc(up(move.title))}</h1>
  ${sub ? `<div class="cv-sub">${inline(up(sub))}</div>` : ''}
</div>
${coverArt({ colors: brand.colors, hero: brand.hero, name: brand.name })}
${move.stat ? `<div class="cv-stat"><div class="cv-stat-n">${esc(move.stat)}</div>${move.statLabel ? `<div class="cv-stat-l">${esc(up(move.statLabel))}</div>` : ''}</div>` : ''}
<div class="cv-foot">
  <div>BREW × ${esc(up(brand.name))}<br>WORKING DOCUMENT</div>
  <div>${esc(up(brand.dateLabel || ''))}<br>${esc(up(brand.version || 'V1 · FOR DISCUSSION'))}</div>
  <div>CONFIDENTIAL<br>${esc(up(brand.name))} LEADERSHIP ONLY</div>
</div>
</section>`;
}

function summaryBox(move, brand, isIndex) {
  const a = isIndex ? ['WHAT THIS IS', move.gives] : [`WHAT THIS GIVES ${up(brand.name)}`, move.gives];
  const b = isIndex
    ? ['HOW TO READ IT', move.howTo || 'The six groups follow a customer from first search to repeat order. Each document ends with a 30-day deployment table and the metric we are held to.']
    : ['LIVE 30 DAYS AFTER WE START', move.live];
  return `<div class="summary${isIndex ? ' ix' : ''}">
  <div class="sm-stat">${move.stat ? `<div class="sm-stat-n">${esc(move.stat)}</div>` : ''}${move.statLabel ? `<div class="sm-stat-l">${esc(up(move.statLabel))}</div>` : ''}</div>
  <div class="sm-text">
    ${a[1] ? `<div class="sm-h">${esc(a[0])}</div><p>${inline(a[1])}</p>` : ''}
    ${b[1] ? `<div class="sm-h">${esc(b[0])}</div><p>${inline(b[1])}</p>` : ''}
  </div>
</div>`;
}

function table(b) {
  const head = b.head || [];
  const rows = b.rows || [];
  const cols = Math.max(head.length, ...rows.map((r) => r.length), 1);
  const th = head.length ? `<thead><tr>${head.map((h) => `<th>${inline(up(h))}</th>`).join('')}</tr></thead>` : '';
  const tb = rows.map((r) => `<tr>${Array.from({ length: cols }, (_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('');
  const cls = cols >= 6 ? 'tbl tbl-wide' : 'tbl';
  return `<table class="${cls}">${th}<tbody>${tb}</tbody></table>${b.caption ? `<p class="caption">${inline(b.caption)}</p>` : ''}`;
}

// Monospace diagrams: shrink the font so the longest line fits the box (DejaVu Sans Mono advance = 0.602em,
// inner width ~454pt); diagrams under 46 lines never split across pages.
function diagram(b) {
  const text = String(b.text ?? '').replace(/\s+$/g, '').replace(/\t/g, '    ');
  const ls = text.split('\n');
  const longest = Math.max(1, ...ls.map((l) => [...l].length));
  const size = Math.max(4.6, Math.min(7.15, 454 / (longest * 0.602)));
  const cls = ls.length < 46 ? 'diagram keep' : 'diagram';
  return `<figure class="${cls}"><span class="tag">${esc(up(b.label || 'DIAGRAM'))}</span><pre style="font-size:${size.toFixed(2)}pt">${esc(text)}</pre></figure>`;
}

function example(b) {
  const paras = String(b.body ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return `<div class="ex">${b.title ? `<h3 class="ex-title">${inline(up(b.title))}</h3>` : ''}
<div class="ex-cards">${b.label ? `<span class="tag">${esc(up(b.label))}</span>` : ''}${paras.map((p) => `<div class="ex-card">${inline(p)}</div>`).join('')}</div></div>`;
}

function block(b) {
  switch (b?.t) {
    case 'p': return `<p>${inline(b.text)}</p>`;
    case 'h3': case 'h2': return `<h3 class="sub">${inline(up(b.text))}</h3>`;
    case 'h4': return `<h4>${inline(b.text)}</h4>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${(b.items || []).map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table': return table(b);
    case 'diagram': return diagram(b);
    case 'example': return example(b);
    case 'callout': return `<div class="callout">${b.title ? `<div class="co-h">${inline(up(b.title))}</div>` : ''}<p>${inline(b.text)}</p></div>`;
    default: return b?.text ? `<p>${inline(b.text)}</p>` : '';
  }
}

// h3 = the red small-caps sub-head of the hand-made PDFs ("PROFILE 1: TRAYA"). Bold run-in heads
// ("Angle A: Outcome with a timeline") are written as **bold** at the start of a paragraph.
function blocks(list) {
  return (list || []).map(block).join('\n');
}

function sourcesList(sources) {
  return `<ul class="sources">${sources.map((s) => {
    const label = typeof s === 'string' ? s : s.label || s.url || '';
    const url = typeof s === 'string' ? '' : s.url || '';
    const at = typeof s === 'string' ? '' : s.at || '';
    const urlTxt = url && !String(label).includes(url) ? ` <span class="src-url">${esc(url.replace(/^https?:\/\//, ''))}</span>` : '';
    return `<li>${inline(label)}${urlTxt}${at ? `, read ${esc(at)}` : ''}</li>`;
  }).join('')}</ul>`;
}

/* the evidence lines a move rests on (meta.cites, moves-engine citeMove): shown under a Sources section the move wrote itself */
const evidenceOf = (move) => (move.meta?.cites || []).filter((c) => c.kind === 'ledger' || c.kind === 'signal');
function evidenceList(move) {
  const xs = evidenceOf(move); if (!xs.length) return '';
  return `<h3>Evidence lines</h3><ul class="sources cites">${xs.map((c) => `<li>${inline(`${c.label}: ${c.v}`)}${c.src ? ` <span class="src-url">${esc(String(c.url || c.src).replace(/^https?:\/\//, ''))}</span>` : ''}${c.at ? `, read ${esc(c.at)}` : ''} <span class="src-key">${esc(c.key)}</span></li>`).join('')}</ul>`;
}

function section(s, move) {
  if (s.kind === 'sources') {
    /* the move's own sources section, then the evidence lines it cites (they are already in move.sources when it wrote none) */
    const body = (s.blocks && s.blocks.length) ? blocks(s.blocks) + evidenceList(move) : sourcesList(move.sources || []);
    return `<div class="sec sec-sources"><h2>${esc(up(s.h || 'Sources'))}</h2>${body}</div>`;
  }
  return `<section class="sec sec-${esc(s.kind || 'other')}">${h1(s.h)}
${blocks(s.blocks)}
</section>`;
}

function indexRows(items) {
  return items.map((m) => `<div class="ix-row">
  <div class="ix-n">${pad2(m.n)}</div>
  <div class="ix-body"><div class="ix-t">${esc(m.title)}</div><div class="ix-g">${inline(m.gives || '')}</div></div>
  <div class="ix-stat">${m.stat ? `<div class="ix-stat-n">${esc(m.stat)}</div>` : ''}${m.statLabel ? `<div class="ix-stat-l">${esc(up(m.statLabel))}</div>` : ''}</div>
</div>`).join('');
}

function indexSections(move, opts) {
  let items = move.index;
  if (!items || !items.length) {
    items = (opts.moves || []).filter((m) => m && m.n !== 0).map((m) => ({ n: m.n, group: m.group, title: m.title, gives: m.gives, stat: m.stat, statLabel: m.statLabel }));
  }
  items = [...items].sort((a, b) => a.n - b.n);
  const out = [];
  for (const g of GROUP_ORDER) {
    const list = items.filter((m) => (m.group || 'know') === g);
    if (!list.length) continue;
    const G = GROUPS[g];
    out.push(`<section class="sec sec-index">${h1(G.h)}
<h2>${esc(up(G.sub))} · ${list.length} MOVE${list.length === 1 ? '' : 'S'}</h2>
${indexRows(list)}</section>`);
  }
  return out.join('\n');
}

function closing(move, brand, isIndex) {
  const kicker = isIndex ? up(move.kicker || 'THE PLAYBOOK') : up(move.kicker);
  return `<section class="cover closing">
<img class="tex tex-close" src="${ASSET_BASE}assets/closing-waves.png" alt="">
<div class="cl-kicker">${esc(kicker)}</div>
<h1 class="cl-title">DAY 30<br>AT ${esc(up(brand.name))}</h1>
<div class="cl-flow">
${move.live ? `<div class="cl-live"><div class="cl-live-h">WHAT IS LIVE</div><p>${inline(move.live)}</p></div>` : ''}
<div class="cl-cta">NEXT STEP: A 45-MINUTE WORKING SESSION. WE BRING THE <b>BUILD</b> PLAN, YOU BRING THE DATA WE FLAGGED AS "TO CONFIRM".</div>
<div class="cl-own">EVERYTHING IN THIS DOCUMENT IS BUILT, RUN AND OWNED BY THE BREW DEPLOYMENT TEAM. ${esc(up(brand.name))} APPROVES, WE <b>SHIP</b>.</div>
</div>
<div class="cl-foot"><div class="cl-logo">Brew</div><div class="cl-right">DEPLOYMENT TEAM<br>BREW</div></div>
</section>`;
}

function toConfirmBlock(move) {
  const list = (move.toConfirm || []).filter(Boolean);
  if (!list.length) return '';
  return `<div class="sec sec-confirm"><h2>TO CONFIRM WITH ${esc(up(move.brandName || ''))}</h2><ul>${list.map((t) => `<li>${inline(t)}</li>`).join('')}</ul></div>`;
}

// ---------- CSS ----------
function css(footerLeft) {
  const A = ASSET_BASE;
  return `
@font-face { font-family: 'ShopSerif'; src: url('${A}fonts/Tinos-Regular.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'ShopSerif'; src: url('${A}fonts/Tinos-Bold.ttf') format('truetype'); font-weight: 700; }
@font-face { font-family: 'ShopSans'; src: url('${A}fonts/Inter-Variable.ttf') format('truetype'); font-weight: 100 900; }
@font-face { font-family: 'ShopMono'; src: url('${A}fonts/DejaVuSansMono.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'ShopMono'; src: url('${A}fonts/DejaVuSansMono-Bold.ttf') format('truetype'); font-weight: 700; }

:root { --ink:#111112; --red:#a9121f; --red-lt:#f0525c; --panel:#f2f2f0; --rule:#c9c9c6; --char:#19191b; --off:#f1e9df;
  --serif:'ShopSerif','Tinos','Liberation Serif','Times New Roman',serif; --sans:'ShopSans','Inter',Helvetica,Arial,sans-serif;
  --mono:'ShopMono','DejaVu Sans Mono',Menlo,monospace; }

@page { size: A4; margin: 48pt 51pt 54pt 51pt;
  @bottom-left { content: ${cssStr(footerLeft)}; font-family: var(--sans); font-size: 5.25pt; letter-spacing: .045em; color: #222; vertical-align: top; padding-top: 30pt; white-space: nowrap; }
  @bottom-right { content: counter(page); font-family: var(--sans); font-size: 5.25pt; color: #222; vertical-align: top; padding-top: 30pt; }
}
@page :first { counter-reset: page -1; }
@page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: var(--sans); color: var(--ink); font-size: 10.15pt; line-height: 1.56; letter-spacing: .003em; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  font-feature-settings: "calt" 0; text-rendering: geometricPrecision; }
.panel-bg { position: fixed; inset: 0; background: var(--panel); z-index: -1; }

/* ---------- cover ---------- */
.cover { page: cover; position: relative; width: 210mm; height: 296.6mm; overflow: hidden; background: var(--char); color: var(--off); break-after: page; z-index: 1; }
.tex { position: absolute; left: 0; pointer-events: none; }
.tex-waves { top: 0; width: 100%; height: 100%; opacity: .2; }
.tex-mesh { bottom: 0; width: 100%; height: auto; opacity: .34; }
.tex-close { top: 0; width: 100%; height: 100%; opacity: .3; }
.lockup { position: absolute; left: 45pt; top: 44.5pt; display: flex; align-items: flex-start; gap: 9pt; color: var(--off); }
.mark { width: 24pt; height: 24pt; margin-top: 7.4pt; }
.lk-name { font-family: var(--serif); font-size: 24.6pt; line-height: 1; letter-spacing: -.005em; }
.lk-team { font-family: var(--sans); font-weight: 800; font-size: 7.7pt; letter-spacing: .08em; color: #c9c2b8; margin-top: 1.2pt; }
.prepared { position: absolute; right: 46pt; top: 45.5pt; background: #fff; color: var(--ink); font-weight: 500; font-size: 8.15pt; letter-spacing: .042em;
  padding: 11pt 11.5pt 10.6pt; line-height: 1.2; box-shadow: 2.6pt 2.6pt 0 #0d0d0e; white-space: nowrap; }
.prepared b { color: var(--red); font-weight: 700; }
.cv-main { position: absolute; left: 45.4pt; top: 242.5pt; width: 400pt; }
.cv-kicker { font-weight: 800; font-size: 8.45pt; letter-spacing: .105em; color: var(--red-lt); }
.cv-title { font-family: var(--serif); font-weight: 400; font-size: 55.4pt; line-height: 49.5pt; margin: 6.4pt 0 0 0; letter-spacing: -.008em; color: var(--off); max-width: 366pt; }
.cv-sub { display: inline-block; margin-top: 16.5pt; background: #fff; color: var(--ink); width: 310pt; padding: 10.5pt 12.7pt 9.5pt; font-weight: 500; font-size: 9.3pt;
  line-height: 16.5pt; letter-spacing: .035em; box-shadow: 2.6pt 2.6pt 0 #0d0d0e; }
.art { position: absolute; left: 408pt; top: 330pt; width: 168pt; height: 315pt; display: flex; align-items: center; justify-content: center; }
.art-bottle { left: 452pt; top: 338pt; width: 80pt; height: 305pt; }
.art-cutout img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 6pt 14pt rgba(0,0,0,.45)); }
.art-photo .art-card { background: #fff; padding: 8pt; box-shadow: 3pt 3pt 0 #0d0d0e; max-width: 100%; max-height: 100%; display: flex; }
.art-photo img { max-width: 152pt; max-height: 300pt; object-fit: contain; display: block; }
.cv-stat { position: absolute; left: 45pt; bottom: 117pt; }
.cv-stat-n { font-family: var(--serif); font-size: 48pt; line-height: 1; letter-spacing: -.012em; white-space: nowrap; }
.cv-stat-l { font-weight: 800; font-size: 8.4pt; letter-spacing: .045em; color: #d9d2c9; margin-top: 0; }
.cv-foot { position: absolute; left: 45pt; right: 45.5pt; top: 768pt; border-top: .75pt solid #e9e3da; padding-top: 7pt; display: grid; grid-template-columns: 198pt 194pt 1fr;
  font-weight: 800; font-size: 7.95pt; line-height: 9.8pt; letter-spacing: .05em; color: #d7d0c8; }

/* ---------- closing ---------- */
.closing { break-before: page; break-after: auto; }
.cl-kicker { position: absolute; left: 45pt; top: 135pt; font-weight: 800; font-size: 8.3pt; letter-spacing: .09em; color: var(--red-lt); }
.cl-title { position: absolute; left: 45pt; top: 155pt; margin: 0; font-family: var(--serif); font-weight: 400; font-size: 44pt; line-height: 40pt; letter-spacing: -.012em; color: var(--off); }
.cl-flow { position: absolute; left: 45pt; right: 46pt; top: 277pt; }
.cl-live { border: 1.1pt solid #ebe4da; padding: 21pt 23pt 22pt; margin-bottom: 40pt; }
.cl-live-h { font-weight: 800; font-size: 6.9pt; letter-spacing: .08em; color: var(--red-lt); margin-bottom: 4pt; }
.cl-live p { margin: 0; font-size: 11.4pt; line-height: 1.5; letter-spacing: .008em; color: #f3ede5; }
.cl-cta, .cl-own { width: 340pt; background: #fff; color: var(--ink); font-weight: 500; letter-spacing: .035em; box-shadow: 2.6pt 2.6pt 0 #0d0d0e; }
.cl-cta { font-size: 9.1pt; line-height: 16.2pt; padding: 10pt 12pt 9pt; }
.cl-own { margin-top: 18pt; font-size: 7.9pt; line-height: 14.4pt; padding: 8.5pt 12pt 7.5pt; }
.cl-cta b, .cl-own b { color: var(--red); font-weight: 700; }
.cl-foot { position: absolute; left: 45pt; right: 45.5pt; top: 764pt; border-top: .75pt solid #e9e3da; padding-top: 6pt; display: flex; justify-content: space-between; align-items: flex-start; }
.cl-logo { font-family: var(--serif); font-size: 23.6pt; line-height: 1.15; color: var(--off); }
.cl-right { text-align: right; font-weight: 800; font-size: 7.9pt; line-height: 9.6pt; letter-spacing: .05em; color: #d7d0c8; padding-top: 5.5pt; }

/* ---------- body ---------- */
main { position: relative; }
.summary { display: grid; grid-template-columns: 186pt 1fr; align-items: center; border: 1.25pt solid var(--ink); padding: 29pt 22pt 29pt 29pt;
  margin: 0; break-inside: avoid; }
.sm-stat-n { display: inline-block; white-space: nowrap; font-family: var(--serif); font-size: 28pt; line-height: 1.05; letter-spacing: -.01em; }
.sm-stat-l { font-weight: 800; font-size: 7.4pt; line-height: 1.5; letter-spacing: .045em; margin-top: 3pt; max-width: 150pt; }
.sm-h { font-weight: 800; font-size: 7.5pt; letter-spacing: .055em; color: var(--red); line-height: 1.2; margin-top: 10pt; }
.sm-h:first-child { margin-top: 0; }
.summary.ix .sm-text p { font-size: 8.9pt; }
.sm-text p { margin: 1pt 0 0; font-size: 9.75pt; line-height: 1.55; letter-spacing: .012em; max-width: 252pt; }

.sec { break-inside: auto; }
.h1 { font-family: var(--serif); font-weight: 400; font-size: 28pt; line-height: 1.1; letter-spacing: -.004em; margin: 32pt 0 22pt; padding-bottom: 13pt; position: relative;
  break-after: avoid; break-inside: avoid; }
.h1 .wave { position: absolute; left: 0; bottom: 0; width: 100%; height: 7pt; display: block; overflow: hidden; }
.summary + .sec .h1 { margin-top: 26pt; }
h2, h3.sub, h3.ex-title { font-family: var(--sans); font-weight: 800; font-size: 8.15pt; letter-spacing: .06em; color: var(--red); margin: 22pt 0 7pt; line-height: 1.35; break-after: avoid; }
.h1 + h2, .h1 + h3.sub { margin-top: 0; }
h4 { font-weight: 700; font-size: 10.15pt; margin: 12pt 0 6pt; line-height: 1.4; break-after: avoid; }
p { margin: 0 0 8pt; orphans: 2; widows: 2; }
strong { font-weight: 700; }
h3 code, h2 code { color: inherit; font-size: .98em; font-weight: 400; letter-spacing: .02em; background: #e4e4e2; }
code { font-family: var(--mono); font-size: .76em; background: #e3e3e1; padding: .5pt 3pt; border-radius: 1pt; white-space: nowrap; color: #222; }
ul, ol { margin: 0 0 8pt; padding-left: 13.5pt; }
li { margin: 0 0 3.2pt; padding-left: 0; }
ul li::marker { font-size: .9em; }
p + ul, p + ol { margin-top: -1pt; }

.tbl { width: 100%; border-collapse: collapse; margin: 6pt 0 14pt; font-size: 7.75pt; line-height: 1.5; letter-spacing: .028em; }
.tbl thead { display: table-header-group; }
.tbl th { text-align: left; vertical-align: bottom; font-weight: 800; font-size: 6.7pt; letter-spacing: .07em; padding: 7pt 5pt 5.6pt; border-bottom: 1.4pt solid var(--ink); line-height: 1.3; }
.tbl td { vertical-align: top; padding: 4.9pt 5pt 4.7pt; border-bottom: .55pt solid var(--rule); }
.tbl td:first-child { font-weight: 700; }
.tbl th:first-child, .tbl td:first-child { padding-left: 5pt; }
.tbl tr { break-inside: avoid; }
.tbl-wide { letter-spacing: .02em; }
.tbl-wide td, .tbl-wide th { padding-left: 4pt; padding-right: 4pt; }
.tbl code { font-size: .85em; }
.caption { font-size: 8.5pt; color: #333; margin-top: -6pt; }

.diagram { position: relative; margin: 8pt 0 14pt; background: #fff; border: 1.4pt solid var(--ink); padding: 15pt 18pt 14pt; break-inside: auto; }
.diagram.keep { break-inside: avoid; }
.diagram pre { margin: 0; font-family: var(--mono); font-size: 7.15pt; line-height: 1.36; white-space: pre; color: var(--ink); overflow: hidden; }
.tag { position: absolute; top: 2pt; right: 2pt; background: var(--ink); color: #fff; font-family: var(--sans); font-weight: 800; font-size: 6.2pt; letter-spacing: .06em; padding: 2.4pt 4.6pt 2.2pt; line-height: 1.2; }

.ex { margin: 0 0 8pt; }
.ex-cards { position: relative; width: 70%; margin: 6pt 0 12pt; font-size: 0; line-height: 0; }
.ex-cards .tag { top: -4pt; right: -4pt; z-index: 2; }
.ex-card { display: inline-block; vertical-align: top; max-width: 100%; background: #fff; border: .9pt solid var(--ink); box-shadow: 2.4pt 2.4pt 0 var(--ink); padding: 8.5pt 11pt 7pt;
  font-weight: 500; font-size: 8.05pt; line-height: 1.8; letter-spacing: .045em; text-transform: uppercase; margin: 0 3pt 2.5pt 0; break-inside: avoid; }

.callout { border: 1.25pt solid var(--ink); padding: 13pt 16pt 9pt; margin: 8pt 0 14pt; break-inside: avoid; background: transparent; }
.co-h { font-weight: 800; font-size: 7.15pt; letter-spacing: .055em; color: var(--red); margin-bottom: 3pt; }
.callout p:last-child { margin-bottom: 0; }

.sec-sources h2, .sec-confirm h2 { margin-top: 22pt; }
.sources .src-url { font-family: var(--mono); font-size: .76em; color: #444; }

/* ---------- index (move 00) ---------- */
.ix-row { display: grid; grid-template-columns: 47pt 1fr 100pt; gap: 0 10pt; padding: 10pt 0 11pt; border-bottom: .55pt solid var(--rule); break-inside: avoid; }
.ix-n { font-family: var(--serif); font-size: 20pt; line-height: 1; padding-top: 2pt; }
.ix-t { font-weight: 800; font-size: 7.6pt; line-height: 1.4; margin-bottom: 2pt; }
.ix-g { font-size: 7.4pt; line-height: 1.6; letter-spacing: .01em; }
.ix-stat { text-align: right; }
.ix-stat-n { font-family: var(--serif); font-size: 15.5pt; line-height: 1.05; }
.ix-stat-l { font-weight: 800; font-size: 5.3pt; letter-spacing: .05em; color: #555; margin-top: 2.5pt; line-height: 1.45; }
.sec-index .h1 + h2 { margin-bottom: 4pt; }
`;
}

// Runs in Chrome before printing: cover stat font fits a 206pt line (61pt max, as in the hand-made covers),
// the cover title shrinks until it is at most 4 lines and title + subtitle clear the stat, the summary-box stat fits its column.
const FIT_JS = `(function(){
  var PT = 96/72;
  function fitWidth(el, maxPt, startPt, minPt){ if(!el) return; var f = startPt; el.style.fontSize = f+'pt';
    while (f > minPt && el.scrollWidth > maxPt*PT) { f -= 0.5; el.style.fontSize = f+'pt'; } }
  fitWidth(document.querySelector('.cv-stat-n'), 206, 61, 30);
  var t = document.querySelector('.cv-title'), main = document.querySelector('.cv-main'), st = document.querySelector('.cv-stat');
  if (t && main) { var f = 55.4, limit = st ? st.getBoundingClientRect().top - 14*PT : 640*PT;
    while (f > 30 && (main.getBoundingClientRect().bottom > limit || t.getBoundingClientRect().height > 4.3 * f * 0.894 * PT)) { f -= 1.5; t.style.fontSize = f+'pt'; t.style.lineHeight = (f*0.894)+'pt'; } }
  fitWidth(document.querySelector('.sm-stat-n'), 122, 36, 16);
})();`;

/**
 * Full standalone HTML for one move.
 * @param {object} move  Move JSON (SPEC.md). n === 0 renders the playbook index variant.
 * @param {object} brand { name, descriptor, host, hero, dateLabel, version, colors? }
 * @param {object} [opts] { moves: [...] } other moves, used to build the 00 index when move.index is absent.
 */
export function moveHtml(move, brand, opts = {}) {
  if (!move || typeof move !== 'object') throw new Error('moveHtml: move required');
  brand = { name: 'Brand', ...brand };
  const isIndex = move.n === 0 || move.kind === 'index';
  const footerLeft = `BREW DEPLOYMENT TEAM × ${up(brand.name)} · ${up(move.title)}`;
  const sections = (move.sections || []).map((s) => section(s, move)).join('\n');
  const hasSources = (move.sections || []).some((s) => s.kind === 'sources');
  const autoSources = !hasSources && (move.sources || []).length ? `<div class="sec sec-sources"><h2>SOURCES</h2>${sourcesList(move.sources)}</div>` : '';
  const body = [summaryBox(move, brand, isIndex), sections, isIndex ? indexSections(move, opts) : '', autoSources, toConfirmBlock({ ...move, brandName: brand.name })].join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(pad2(move.n))} ${esc(move.title)}</title>
<style>${css(footerLeft)}</style></head>
<body>
<div class="panel-bg"></div>
${cover(move, brand, isIndex)}
<main>
${body}
</main>
${closing(move, brand, isIndex)}
<script>${FIT_JS}</script>
</body></html>`;
}
