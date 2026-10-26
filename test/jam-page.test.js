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
