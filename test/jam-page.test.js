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

// QV round 2, 26 Oct (docs/qv/jam-r2.md): what still ran under the bar, out of the window or out of its box, on every layout.
test('QV r2: "+N more" opens a list you can see on every layout, and the line never pushes it out of the bar', () => {
  const css = CSS();
  assert.match(css, /\.jp \.jp-tx \.jp-l:has\(\.ship-fixes\)\{overflow:visible\}/, 'N-P1-1: the line no longer clips its list');
  assert.match(css, /\.jp \.jp-ship \.ship-fixes\{position:static/, 'N-P1-1: the list is placed on the bar, outside the clipped line');
  assert.match(css, /\.jp \.jp-ship \.ship-fixes ol\{position:absolute;left:16px;[^}]*bottom:calc\(100% \+ 8px\);[^}]*max-height:[^}]*overflow:auto/, 'N-P1-1: over the stage, inside the window');
  assert.match(css, /@container jp-stage \(max-width:700px\)\{\.jp \.jp-ship\{flex-wrap:wrap\}/, 'N-P2-5, 26 Oct: only a stage under ~700px lets the buttons take a row of their own');
  assert.match(css, /\.jp \.jp-ship \.ship-one > \.linkbtn,\.jp \.jp-ship \.ship-one > \.ship-fixes\{flex:none;white-space:nowrap\}/, 'N-P2-5: "+N more" is never cut');
});

test('QV r2: the older version keeps Back and Use in the window, and its pill off One | All', () => {
  const css = CSS(), app = APP();
  assert.match(css, /\.jp \.jp-ship\.viewing\{height:auto;/, 'N-P1-2: never the top bar\'s 34px .viewing pill');
  assert.match(css, /\.jp \.jp-ship:not\(:has\(> \.jp-steps\)\) > \.jp-tx,\.jp \.jp-ship:not\(:has\(> \.jp-steps\)\) > \.jp-btns\{grid-row:1\}/, 'a bar with no steps has no empty row');
  assert.match(css, /\.jp \.jp-oldv\{left:16px;right:auto;top:16px\}/, 'N-P1-2: the pill takes the tag\'s corner');
  assert.match(app, /const jpTag = \(ch, viewing\) => \{ if \(viewing\) return '';/, '…which is empty while you look back');
  assert.match(app, /<span>\$\{esc\(vWhy\(viewing\)\)\} · /, 'N-P2-7: the older version says what it was');
  const vWhy = new Function('PRODUCT', 'vLabel', `${app.split('\n').find((l) => l.includes('const vWhy = ')).trim()}\nreturn vWhy;`)('Brew', (v) => v.reason);
  assert.equal(vWhy({ reason: 'Studio: Carousel · 3 slides · $0.096' }), 'Made in Brew Studio');
  assert.equal(vWhy({ reason: 'Shorter · ₹12' }), 'Shorter');
});

test('QV r2: a merge tag stays in its line, and the email body is one block', () => {
  const css = CSS(), app = APP();
  assert.match(app, /<div class="jp-mail-b">\$\{body\.trim\(\) \? `<div class="jp-mail-txt">\$\{mergeTags/, 'N-P1-4: the words are one block, never loose flex items');
  assert.match(css, /\.jp \.tok\{display:inline-flex;[^}]*white-space:nowrap/, 'N-P1-4: "Hi [first name]," on one line');
});

test('QV r2: slide dots, a video and a framed set end above the bar at every size (P1-1, N-P2-1)', () => {
  const app = APP(), css = CSS();
  const sf = app.slice(app.indexOf('const stageFrames = '), app.indexOf('const stagePick = '));
  assert.match(sf, /const over = \(\) => Math\.max\(room\.scrollHeight - room\.clientHeight, jpUnderBar\(\[card, box\.querySelector\('\.stg-nav'\)\]\)\)/, 'a phone\'s floating bar counts');
  assert.match(sf, /box\.classList\.add\('stg-tighter'\)/, 'a story too tall at 130px steps back once more');
  assert.match(fnOf(app, 'jpUnderBar'), /position !== 'fixed'\) return 0/, 'only a floating bar: an in-flow bar is the stage\'s own overflow');
  assert.match(app, /addEventListener\('resize', \(\) => \{ if \(view === 'remix'\) \{ stageFrames\(\); jpFit\(\); jpFoldApply\(\); \} \}\)/, 'a set is fitted again at a new window size, and a text cut at it gets its more');
  assert.match(fnOf(app, 'jpFit'), /under = \(\) => Math\.max\(room\.scrollHeight - room\.clientHeight, jpUnderBar\(/, 'a framed set is measured, its frame\'s padding included');
  assert.match(fnOf(app, 'jpFit'), /getComputedStyle\(bar\)\.position === 'fixed'/, 'a phone\'s framed piece ends above its bar');
  assert.match(fnOf(app, 'fitAd'), /const ph = ad\.querySelector\('\.sv-phone'\); if \(ph\)/, 'N-P2-1: the video phone narrows until its beats and sizes clear the bar');
  assert.match(fnOf(app, 'fitAd'), /if \(!fit\(170\)\) \{ box\.classList\.add\('sv-tight'\); fit\(140\); \}/, 'N-P2-1: then a short window steps the beats and sizes back');
  assert.match(css, /\.jp \.st-asset\.sv-tight \.sv-beats\{flex-wrap:nowrap;/);
  assert.match(css, /\.jp \.st-asset\[data-stg\]\.stg-tighter \.am-h/, 'stg-tighter drops the header and copy');
  assert.match(sf, /box\.classList\.toggle\('stg-stuck', !fit\(130\)\)/, 'still under the bar at the smallest: the dots stick');
  assert.match(fnOf(app, 'jpFit'), /fr\.classList\.toggle\('jp-stuck', under\(\) > 1\)/);
  assert.match(css, /\.jp \.st-asset\[data-stg\]\.stg-stuck \.stg-nav,\.jp \.jp-framed\.jp-stuck \.jp-dots\{position:sticky;bottom:0/, 'the dots never scroll under the bar');
  assert.match(css, /\.jp \.jp-stage-in > \.st-asset\.jp-framed\{padding-bottom:0\}/);
});

test('QV r2: the ad text, the beat chips and a phone\'s priced buttons read whole', () => {
  const css = CSS();
  assert.match(css, /\.jp \.st-asset \.as-meta\.lg:not\(\.is-story\) \.am-text:not\(:focus\)\{white-space:normal\}/, 'N-P2-3: never one line and a bare "…"');
  assert.match(css, /\.jp \.sv-beats li small\{text-transform:none\}/, 'P1-7: "0–3 s", never "0–3 S"');
  assert.match(css, /@media \(max-width:640px\)\{\.jp \.jp-ship > \.jp-btns\{flex-wrap:wrap;/, 'a phone\'s primary drops to its own row rather than lose its price');
});

// Param, 26 Oct: "the bottom section takes up too much vertical space". The bar is one row: the steps a small indicator beside the line.
const lastRule = (css, sel) => { const all = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(new RegExp(`(?:^|})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'g'))]; return all.length ? all[all.length - 1][1] : ''; };
test('the bar is one compact row, its freed height goes to the stage, and every state keeps its hooks', () => {
  const css = CSS(), app = APP(), last = (sel) => lastRule(css, sel), bar = last('.jp .jp-ship');
  assert.match(bar, /display:flex;flex-direction:row;flex-wrap:nowrap/, 'one row: steps, line, buttons'); assert.match(bar, /min-height:64px/); assert.match(bar, /padding:9px 16px 10px/, '64px with a 44px button');
  assert.ok(!/flex-direction:column/.test(bar), 'never the two stacked rows');
  assert.match(css, /\.jp \.jp-ship > \.jp-steps\{flex:none;display:flex;align-items:center;[^}]*border-right/, 'the steps sit inline, left of the line');
  assert.match(last('.jp .jp-ship > .jp-steps li'), /flex-direction:row/, 'a short segment beside each step\'s name');
  assert.match(css, /\.jp \.jp-ship > \.jp-tx\{flex:1 1 0;min-width:0\}/); assert.match(css, /\.jp \.jp-ship > \.jp-btns\{flex:none;margin-left:auto/, 'the buttons on the right');
  assert.match(last('.jp .jp-tx .jp-l:not(:has(.ship-one))'), /-webkit-line-clamp:2/, 'the line wraps to two lines at most, never a row of its own');
  assert.ok(!/@container jp-stage \(max-width:860px\)\{\.jp \.jp-ship\{grid-template-columns/.test(css), 'no second full row at 700–860px');
  assert.match(css, /@container jp-stage \(max-width:860px\)\{\.jp \.jp-ship > \.jp-steps li:not\(\.is-on\)\{font-size:0/, 'a narrow stage names only the step it is at');
  assert.match(css, /@media \(max-width:640px\)\{\.jp \.jp-ship \.jp-btns > details > summary\{min-width:44px;min-height:44px/, 'phones keep 44px targets, ⋯ included');
  assert.match(css, /\.jp-stage\{grid-column:1;display:grid;grid-template-rows:minmax\(0,1fr\) auto/, 'the stage takes whatever height the bar leaves');
  for (const hook of ['ship-fixes', 'data-fix-one', 'data-cs-full', 'data-cs-make', 'data-v-back', 'data-v-use', 'The team makes it', 'ship-redo', 'btn-free']) assert.ok(app.includes(hook), hook);
  assert.match(css, /\.jp \.jp-ship \.ship-fixes ol\{position:absolute;left:16px;[^}]*bottom:calc\(100% \+ 8px\)/, '"+N more" still opens over the stage');
  assert.match(app, /fitAd\(\); jpFit\(\);/, 'the pieces are fitted to the taller stage on every paint');
});

// Param, 26 Oct: a Meta ad's primary text was cut ("Science-First Oil Control Formulated with active...") and could never be read whole.
const jpMoreFn = (app) => { const lines = app.split('\n'), cw = lines.find((l) => l.includes('const cutW = ')).trim(), i = lines.findIndex((l) => l.includes('const jpMore = '));
  return new Function('esc', `${cw}\n${lines.slice(i, i + 2).join('\n')}\nreturn jpMore;`)((x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')); };
test('"… more": a cut text keeps every word in the DOM, opens with a button, and text that fits has none', () => {
  const jpMore = jpMoreFn(APP()), long = 'Science-First Oil Control Formulated with active botanicals that calm the skin and keep the shine away all day';
  assert.equal(jpMore('copy', 'Short and whole', 220), 'Short and whole', 'not cut: no more');
  const h = jpMore('copy', long, 60);
  assert.ok(h.includes(`<span class="jp-fold-f">${long}</span>`), 'the whole words are in the DOM'); assert.match(h, /<span class="jp-fold-c">Science-First Oil Control Formulated with active<\/span>/, 'the cut half, at a word, its … on the button');
  assert.match(h, /<button type="button" class="jp-fold-b" data-jp-fold="copy" data-more="more" aria-expanded="false">… more<\/button>/, 'a keyboard button that says it is folded');
  assert.match(jpMore('x', long, 40, undefined, 'See more'), />… See more</, 'Meta says See more');
  assert.match(jpMore('x', '<b>' + long, 40), /&lt;b>/, 'escaped');
});

test('"… more" on every layout: no frame cuts the brand\'s words without one', () => {
  const app = APP(), fr = app.slice(app.indexOf('const jpFrame = '), app.indexOf('/* the prototype\'s fit()'));
  for (const k of ["jpMore('copy', p.copy, 220)", "jpMore('words', words, 40)", 'jpMore(`cap:${i}`, cap, 120)', 'jpMore(`slide:${k}`, s[0], 40)', "jpMore('h1', h1, 90)", "jpMore('lede', lede, 240)", "jpMore('sum', p.summary || p.what || '', 70)", "jpMore('rule', w0.rule, 60)", "jpMore('media', p.media, 140)", "jpMore('section', p.section, 40)"]) assert.ok(fr.includes(k), k);
  for (const gone of ['esc(jpCut(p.copy', 'esc(jpCut(cap', 'esc(jpCut(h1', 'esc(jpCut(p.summary', 'esc(jpCut(p.media', 'esc(jpCut(p.section', 'jpCut(ch.docLede']) assert.ok(!fr.includes(gone), `still cut: ${gone}`);
  assert.match(fr, /<figcaption title="\$\{esc\(x\)\}" aria-label="\$\{esc\(x\)\}">/, 'a highlight cover\'s whole name, cut the way Instagram cuts it');
  assert.match(fr, /<b title="\$\{esc\(s\[0\]\)\}">/, 'a small slide in All keeps its whole line on hover');
  assert.match(app, /const FOLD_CLAMP = \[\['\.am-text', 'See more'\], \['\.ig-cap', 'more'\]\]/, 'the renderer\'s clamped words: Meta\'s primary text and Instagram\'s caption');
  assert.match(fnOf(app, 'jpFoldApply'), /el\.scrollHeight > el\.clientHeight \+ 1/, 'a clamp gets its more only when it really cuts');
  assert.match(fnOf(app, 'jpFoldApply'), /aria-expanded="\$\{on\}">\$\{on \? 'See less' : `… \$\{lbl\}`\}/);
});

test('"… more" opens in place, the bar never moves, and the open state lives as long as the piece and version', () => {
  const app = APP(), css = CSS();
  for (const f of ['fitAd', 'jpFit']) { const b = fnOf(app, f); assert.match(b, /const refold = jpUnfold\(\); try \{/, `${f} measures folded`); assert.match(b, /\} finally \{ refold\(\); \} \};/, `${f} opens them again`); }
  { const sf = app.slice(app.indexOf('const stageFrames = '), app.indexOf('const stagePick = ')); assert.match(sf, /^const stageFrames = \(\) => \{ const refold = jpUnfold\(\); try \{/, 'a set is fitted folded'); assert.match(sf, /\} finally \{ refold\(\); \} \};/); }
  assert.match(app, /const foldAt = `\$\{ch\.id\}\|\$\{viewing\?\.id \|\| ch\.head\}`[^\n]*if \(RX\.more\?\.at !== foldAt\) RX\.more = \{ at: foldAt, open: \{\} \};/, 'a new tab or version starts folded; a repaint keeps it open');
  assert.match(app, /fitAd\(\); jpFit\(\); jpPortal\(ch\); bfMark\(\); jpFoldApply\(\); if \(foldTop\)/, 'applied after the fits, the stage kept where it was read');
  assert.match(app, /const fo = e\.target\.closest\('\[data-jp-fold\]'\); if \(fo && RX\.ch && RX\.more\) \{[^\n]*stageFrames\(\); fitAd\(\); jpFit\(\); jpFoldApply\(\);[^\n]*focus\([^\n]*return; \} \}/, 'toggled without a repaint, fitted again, focus kept');
  assert.match(app, /button:not\(\.jp-wa-btn\)'\)\) return null;/, 'the button is never a picked part'); assert.match(app, /text: foldTxt\(x\)\.trim\(\)\.slice\(0, 300\)/, 'a picked part is the whole words');
  assert.match(css, /\.jp \.jp-fold:not\(\.is-open\) > \.jp-fold-f,\.jp \.jp-fold\.is-open > \.jp-fold-c\{display:none\}/);
  assert.match(css, /\.jp \.jp-fold-b:focus-visible\{outline:2px solid/, 'keyboard focus shows');
  assert.match(css, /\.jp \.as \.is-cut > \.jp-fold-b\{position:absolute;right:var\(--fold-r,12px\);bottom:0;/, 'on the clamped line\'s end, as Meta draws it');
  assert.match(css, /\.jp \.st-asset\[data-stg\]:not\(\.stg-tighter\) \.as-ig:not\(\.is-story\) \.ig-cap\{display:-webkit-box;[^}]*-webkit-line-clamp:1/, 'a carousel keeps its caption\'s first line on the slide stage');
});

test('"Before it goes" shows every part whole', () => {
  const app = APP(), css = CSS(), pp = fnOf(app, 'publishPanel');
  assert.match(pp, /<dd data-pp-edit="\$\{esc\(x\.k\)\}" title="Click to change" tabindex="0">\$\{esc\(x\.value \|\| ''\)/, 'the value as written, never cut');
  assert.ok(!/jpCut|cutW|line-clamp/.test(pp)); assert.ok(!/\.pp-r dd\{[^}]*(line-clamp|text-overflow|max-height)/.test(css));
  assert.match(css, /\.jp \.pp-r dd\{white-space:pre-line\}/, 'bullets read a line each');
});

// Param, 26 Oct: the stage's tag sat on "View references", and the two reference cards floated at their own widths.
test('the stage\'s top strip is one row: the tag, then the references; a narrow stage folds them into one pill', () => {
  const app = APP(), css = CSS();
  assert.match(app, /\$\{RX\.stage === 'brief' \? '' : `\$\{optTabs\(ch, viewing\)\}\$\{jpStrip\(ch, viewing\)\}`\}\$\{stageH\}/, 'one strip before the piece');
  assert.ok(!/\$\{refBtnHtml\(ch\)\}\$\{rivalReadHtml\(ch\)\}\$\{optTabs/.test(app), 'never the loose cards');
  const st = fnOf(app, 'jpStrip');
  assert.match(st, /<div class="jp-strip">\$\{viewing \? jpOldv\(viewing\) : jpTag\(ch, viewing\)\}/, 'the tag, or the older version\'s pill, first');
  assert.match(st, /<button type="button" class="jp-refs-t" data-jp-refs aria-expanded="\$\{on\}">/, 'one References pill, a button');
  assert.match(st, /<div class="jp-refs-in">\$\{refs\}<\/div>/);
  assert.match(app, /<\/summary><div class="rv-pop">/, 'what we read opens as a popover');
  assert.match(css, /\.jp \.jp-strip\{position:absolute;top:12px;left:16px;right:16px;[^}]*display:flex;[^}]*height:32px/);
  assert.match(css, /\.jp \.jp-stage-in\.st-canvas:has\(> \.jp-strip\)\{padding-top:56px\}/, 'the strip\'s height comes out of the piece\'s room, so every fit counts it');
  assert.match(css, /\.jp \.jp-stage-in:has\(> \.jp-strip\) > \.st-asset\.cs-stage\{padding-top:0!important\}/, 'never the studio\'s 30px on top of it');
  assert.match(css, /\.jp \.jp-strip \.ref-btn,\.jp \.jp-strip \.rv-read\{[^}]*border-radius:999px/, 'pills of one height');
  assert.match(css, /@container jp-stage \(max-width:860px\)\{\.jp \.jp-refs-t\{display:inline-flex;/, 'a narrow stage: one References pill');
  assert.match(css, /\.jp \.jp-refs\.is-open \.jp-refs-in\{position:absolute;top:calc\(100% \+ 8px\);left:0;/, 'its popover');
  assert.match(css, /@media \(max-width:640px\)\{\.jp \.jp-strip\{position:static;/, 'a phone: in the flow'); assert.match(css, /\.jp \.jp-refs-t\{min-height:44px\}/);
  assert.match(css, /\.jp \.jp-stage-in:has\(> \.st-asset > \.stg-mode\) > \.jp-strip,[^{]*\{right:180px\}/, 'One | All keeps its corner');
  assert.match(app, /if \(e\.target\.closest\('\[data-jp-refs\]'\) && RX\.ch\)/); assert.match(app, /if \(RX\.refsOpen && !e\.target\.closest\('\.jp-refs/, 'a tap elsewhere folds it');
});
