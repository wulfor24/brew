// The jam page rebuilt as the approved prototype (26 Oct): every piece knows its layout (one of the ten) and Brew's one line, never
// empty, and the header gets the product the piece is about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, layoutOf, setupLine } from '../jam-shape.js';
import { DELIVERABLES, dlAction } from '../deliverables.js';
import { familyOf } from '../studio.js';

test('every one of the 228 deliverables, and every family, has one of the ten layouts', () => {
  for (const r of DELIVERABLES) { const ch = { dl: r.id, action: dlAction(r), family: familyOf(dlAction(r)), pkg: {} }; assert.ok(LAYOUTS[layoutOf(ch)], `${r.name}: ${layoutOf(ch)}`); }
  const fam = (action, pkg = {}, extra = {}) => layoutOf({ action, family: familyOf(action), pkg, ...extra });
  assert.equal(fam('creative.add_variants'), 'pic'); assert.equal(fam('creative.carousel_ad'), 'set'); assert.equal(fam('creative.ig_story'), 'set');
  assert.equal(fam('creative.short_video'), 'reel'); assert.equal(fam('crm.paid_broadcast'), 'msg'); assert.equal(fam('crm.flow_copy', { channel: 'Email' }), 'mail');
  assert.equal(fam('crm.flow_copy', { channel: 'WhatsApp' }), 'msg'); assert.equal(fam('storefront.page_copy'), 'page'); assert.equal(fam('creative.reddit_post'), 'post');
  assert.equal(fam('performance.pause_losers'), 'acct'); assert.equal(fam('performance.tracking_fix'), 'check'); assert.equal(fam('creative.add_variants', {}, { studio: 'video-ugc' }), 'reel');
});

test('Brew\'s one line is never empty, names the product in bold, and a planning deliverable says what it is', () => {
  const pr = { name: 'MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo' };
  assert.equal(setupLine({ action: 'creative.add_variants', family: 'meta_ad', pkg: { format: '4:5' } }, pr), 'One picture of the **MitoActive + Anti-Hair Fall Shampoo & Conditioner Combo**, Feed 4:5.');
  assert.match(setupLine({ action: 'crm.paid_broadcast', family: 'crm', pkg: { channel: 'WhatsApp', segment: 'Past buyers', buttons: ['Shop'] } }), /One WhatsApp message to \*\*past buyers\*\*, with one button\./);
  assert.match(setupLine({ dl: 'highlight_covers', action: 'creative.p_highlight_covers', family: 'brief', pkg: {} }), /^Highlight covers: cover set in the brand kit/);
  for (const r of DELIVERABLES) { const a = dlAction(r); const l = setupLine({ dl: r.id, action: a, family: familyOf(a), actionLabel: r.name, pkg: {} }); assert.ok(l && l.length > 8 && !/undefined|null/.test(l), `${r.name}: "${l}"`); }
});

import fs from 'node:fs';
test('the shell is the prototype\'s, scoped so the old styles never reach it, and keeps every hook the app relies on', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), css = fs.readFileSync(new URL('../public/jam-page.css', import.meta.url), 'utf8'), html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /<div class="jp[^\n]*<div class="jp-app[^\n]*\$\{jpHead\(ch, viewing\)\}/); assert.match(app, /<section class="jp-stage" aria-label="Stage"><main class="jp-stage-in st-canvas/);
  assert.match(app, /<aside class="jp-panel st-panel"><div class="jp-panel-scroll st-panel-b/, '.st-panel and .st-panel-b stay for the composer, the mic, paste and drop');
  assert.match(app, /ship: 'jp-ship', 'ship-steps': 'jp-steps', 'ship-tx': 'jp-tx', 'ship-btns': 'jp-btns'/, 'the bar keeps its states under its own class names');
  assert.match(app, /\$\('\.std \.ship, \.std \.jp-ship'\)/);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|})\s*([^{}@]+)\{/g) || [];
  for (const r of rules) { const sel = r.replace(/^}?\s*/, '').replace(/\{$/, ''); for (const one of sel.split(',')) { const x = one.trim(); if (!x || /^(from|to|\d+%)$/.test(x)) continue; assert.ok(/^(\.jp\b|\.jp-|:where\(\.jp\)|:root(:not\(\[data-theme="light"\]\))? \.jp|:root\[data-theme="dark"\] \.jp|\.std\.has-jp)/.test(x), `unscoped rule: ${x}`); } }
  assert.ok(html.indexOf('href="jam-page.css"') > html.indexOf('href="stage.css"'), 'loaded last');
});

test('every layout is drawn in the prototype\'s frame from the piece\'s own package, fitted, never blank', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const fr = app.slice(app.indexOf('const jpFrame = '), app.indexOf('/* ---------- the jam page\'s parts'));
  for (const [L, mark] of [['msg', 'jp-wa'], ['mail', 'jp-inbox'], ['page', 'jp-web-bar'], ['post', 'jp-thread'], ['acct', 'jp-ops'], ['set', 'jp-set-view'], ['reel', 'jp-beats'], ['pic', 'jp-post jp-feed'], ['set', 'jp-hl-row']]) assert.ok(fr.includes(`L === '${L}'`) && fr.includes(mark), `${L}: ${mark}`);
  assert.match(fr, /jp-checks/, 'check and brief: steps to tick');
  assert.ok((fr.match(/jp-empty/g) || []).length >= 4, 'an empty piece says so, never a blank frame');
  assert.match(fr, /if \(ch\.studio \|\| ch\.film \|\| media && \['pic', 'set', 'reel'\]\.includes\(L\)/, 'a made picture or video keeps its platform renderer');
  assert.match(app, /fitAd\(\); jpFit\(\); jpPortal\(ch\); bfMark\(\);/); assert.match(app, /post\.style\.transition = 'none'/, 'measured without the width animation');
  assert.match(app, /\['\.jp-wa-msg, \.jp-sms p', 'Message'\]/, 'point, then ask works on the new frames');
  assert.match(app, /'Shorter', ch\.product\?\.price \? 'Say the price' : 'Plainer words', 'Warmer'/, 'chips follow a picked part, the price only where there is one');
});

// QV 26 Oct (docs/qv/jam.md): layout, the bar and the frames, for every layout and brand.
const APP = () => fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), CSS = () => fs.readFileSync(new URL('../public/jam-page.css', import.meta.url), 'utf8');
const fnOf = (app, n) => { const i = app.indexOf(`const ${n} = `); return app.slice(i, app.indexOf('\n  const ', i + 10)); };
test('QV 26 Oct: the bar says one thing once, paid actions carry their price, and the line is cut at a word', () => {
  const app = APP(), fn = (n) => fnOf(app, n);
  assert.ok(!/slice\(0, 110\)/.test(app), 'P1-2: the line is never hard-sliced mid-word');
  assert.match(fn('lineCut'), /replace\(\/\\s\+\\S\*\$\/, ''\)/, 'P1-2: cut at a word'); assert.match(fn('lineCut'), /…/);
  assert.match(fn('checkLine'), /title="\$\{esc\(x\.t\)\}"/, 'P1-2: the whole line on hover');
  assert.match(fn('checkLine'), /const own = [^;]*data-cs-full[^;]*data-fix-one/, 'P1-3: the line leaves out the action the bar button already is');
  assert.match(fn('checkLine'), /const act = own \? '' :/);
  assert.match(fn('lineIdx'), /!x\.soft && x\.k !== 'preview'/, 'P1-3: the line and the button name the same item');
  assert.match(app, /head = look\.length \? checkLine\(ch, main\)/, 'P1-3: the line is drawn once the button is known');
  assert.match(fn('fullAct'), /data-cs-full>\$\{esc\(fullLbl\(\)\)\}/, 'P1-3: Make the full one carries its price'); assert.match(fn('fullAct'), /data-cs-open>Price the full one/, '…or opens the set-up that prices it');
  assert.match(fn('fullLbl'), /Make the full one · \$\{moneyOf\(f\.usd\)\}/);
  assert.ok(!/>Make the full one<\/button>/.test(app), 'P1-3: no unpriced Make the full one link anywhere');
  assert.match(app, /class="ship-one\/\.test\(String\(head\)\) \? 'warn' : 'ok'/, 'P2-24: a red line never sits beside the green ok dot');
});

test('QV 26 Oct: sets, ads and phones are measured to fit above the bar; the first draft never shows the card as copy', () => {
  const app = APP(), css = CSS();
  const sf = app.slice(app.indexOf('const stageFrames = '), app.indexOf('const stagePick = '));
  assert.match(sf, /room\.scrollHeight - room\.clientHeight/, 'P1-1: what runs under the bar is measured'); assert.match(sf, /stg-tight/, 'then the set steps back');
  assert.match(css, /\.jp \.cs-sizes\{position:static\}/, 'P1-1: the sizes are never pulled over the dots');
  assert.match(css, /\.jp \.st-asset\[data-stg\] \.as-meta:not\(\.is-story\) \.am-h\{display:flex\}/, 'P1-10: a carousel ad keeps its page header');
  assert.match(css, /\.jp \.st-asset\[data-stg\] \.as-meta\.lg:not\(\.is-story\) \.am-text\{-webkit-line-clamp:2/);
  const ss = app.slice(app.indexOf('const studioStage = '), app.indexOf('const stageFrames = ') > app.indexOf('const studioStage = ') ? app.indexOf('const stageFrames = ') : undefined);
  assert.match(ss, /const wr = !made && !making && !viewing && !!ch\.copyPending/, 'P1-20: a Studio preview being written is a skeleton'); assert.match(ss, /cs-stage\$\{wr \? ' is-writing' : ''\}/);
  assert.match(css, /\.jp \.st-panel-b\.is-chat > \.it-ask\{bottom:var\(--cmp-foot-h\)\}/, 'P1-13: the ask box stands on Memory · Connectors');
  assert.match(css, /@container jp-stage \(max-width:860px\)/, 'P1-2: a narrow stage gives the line its own row');
  assert.match(app, /const wa = fr\.querySelector\('\.jp-wa'\)/, 'P2-9: the WhatsApp phone is fitted');
  { const cw = fnOf(app, 'cutW'), cls = /\.replace\(\/\[([^\]]*)\]\+\$\/, ''\) \+ '…'/.exec(cw)?.[1] || ''; assert.ok(['.', ',', ';', ':', '…', '·', '–', '—'].every((c) => cls.includes(c)), 'P2-1: never "work.…"'); }
  assert.ok(!/'<i><\/i>'\.repeat\(6\)/.test(app), 'P2-5: no empty grey profile grid');
});

test('QV 26 Oct: the page frame names the domain once (P2-8)', () => {
  const lines = APP().split('\n'), a = lines.find((l) => l.includes("const pg = String(p.pages || '')")).trim().replace(/\/\*.*$/, ''), b = lines.find((l) => l.includes('const url = !pg ? host')).trim();
  const urlOf = new Function('host', 'p', 'jpCut', `${a}\n${b}\nreturn url;`), cut = (x, n) => (x.length > n ? x.slice(0, n) : x);
  assert.equal(urlOf('arata.in', { pages: 'arata.in/blogs/news' }, cut), 'arata.in/blogs/news');
  assert.equal(urlOf('arata.in', { pages: 'https://www.arata.in/blogs/news' }, cut), 'arata.in/blogs/news');
  assert.equal(urlOf('www.nutrova.com', { pages: 'nutrova.com/pages/faq' }, cut), 'nutrova.com/pages/faq');
  assert.equal(urlOf('arata.in', { pages: '/products/x' }, cut), 'arata.in/products/x');
  assert.equal(urlOf('arata.in', { pages: 'Product page' }, cut), 'arata.in · Product page');
  assert.equal(urlOf('arata.in', {}, cut), 'arata.in');
});
