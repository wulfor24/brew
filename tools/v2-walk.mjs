#!/usr/bin/env node
// Walk the v2 onboarding headlessly, the way a person would with the keyboard: the beats, the tutorial, the sunrise, the
// stack, the gate, then the feed. Fails on any screen that shows "undefined", "NaN" or "null", on a JS error, on a progress
// bar ahead of the read, or on more than one confirm POST. Writes PNGs and a JSON log to --out (default: $TMPDIR/v2-walk).
//   node tools/v2-walk.mjs --url http://localhost:4200/cozysnugglet-shop [--dark] [--mobile] [--out DIR] [--landing]
//   --stack: the morning stack instead (FEED_STACK): a browser that finished onboarding opens the feed with ?stack=1 → the day's
//   stack with its "n of N" counter, two verbs, Esc → the feed; a reload the same day shows no stack; ?stack=0 and ?go=feed never do.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../pdf/render.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const URL0 = arg('--url', 'http://localhost:4200/cozysnugglet-shop');
const OUT = arg('--out', path.join(process.env.TMPDIR || '/tmp', 'v2-walk')); fs.mkdirSync(OUT, { recursive: true });
const log = [], bad = [];
const note = (m, o = {}) => { log.push({ t: Date.now(), m, ...o }); console.log(m, Object.keys(o).length ? JSON.stringify(o) : ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport(has('--mobile') ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 860 });
if (has('--dark')) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) bad.push(`console: ${m.text()}`); });
let confirms = 0; page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/brands\/[^/]+\/confirm$/.test(r.url())) confirms++; });

let shot = 0;
const snap = async (name) => { const f = path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: f }); return f; };
const text = () => page.evaluate(() => document.body.innerText || '');
const check = async (where) => { const t = await text(); for (const re of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/]) if (re.test(t)) bad.push(`${where}: text shows ${re}`);
  const prog = await page.evaluate(() => { const bar = document.querySelector('.v2-bar i'), dots = document.querySelectorAll('.v2-dots li.is-done').length; return bar ? { w: parseFloat(bar.style.width), dots } : null; });
  if (prog && prog.w > Math.max(3, Math.round(100 * prog.dots / 7)) + 1) bad.push(`${where}: bar ${prog.w}% ahead of ${prog.dots} done stages`); };
const dbg = () => page.evaluate(() => (window.OB2 && window.OB2.debug ? window.OB2.debug() : null)).catch(() => null);
const view = () => page.evaluate(() => window.__BREW?.view).catch(() => null);

const url = new URL(URL0); url.searchParams.set('v', '2');
await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
await sleep(1500);
if (has('--landing')) { await snap('hero'); await check('hero'); note('hero ok'); await browser.close(); process.exit(bad.length ? 1 : 0); }

if (has('--stack')) {
  const slug = url.pathname.replace(/^\//, '').split('/')[0], SK = `${slug}-demo-v1`;
  /* this browser finished onboarding (the first load above set the brand's "born" mark, so the state below survives) */
  const setS = (patch) => page.evaluate(([k, patch]) => { let S = {}; try { S = JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) {} S = { ...S, onboarded: true, viewer: { ...(S.viewer || {}), ...patch } }; localStorage.setItem(k, JSON.stringify(S)); }, [SK, patch]);
  const stackUp = () => page.waitForSelector('.v2-card:not(.is-wait)', { timeout: 25000 }).then(() => true).catch(() => false);
  const count = () => page.evaluate(() => document.querySelector('#v2-count')?.textContent || '');
  const feedUp = () => page.evaluate(() => !!document.querySelector('#col .card[data-post]'));
  await setS({ stackDay: '' });
  const u1 = new URL(URL0); u1.searchParams.set('v', '2'); u1.searchParams.set('stack', '1'); await page.goto(u1.toString(), { waitUntil: 'domcontentloaded' });
  if (!(await stackUp())) bad.push('stack: no card came up in 25 s'); else {
    await sleep(600); await snap('morning'); await check('morning');
    const c0 = await count(), head = await page.evaluate(() => document.querySelector('.v2-tut h1')?.textContent || ''), total = +(c0.split(' of ')[1] || 0);
    note('morning stack', { head, count: c0, view: await view() });
    if (!/^1 of \d+$/.test(c0)) bad.push(`stack: counter "${c0}" is not "1 of N"`);
    if (!(await page.$('#v2-skip'))) bad.push('stack: no "Open the feed" button');
    await page.keyboard.press('ArrowRight'); await sleep(1100); const c1 = await count(); if (total > 1 && c1 !== `2 of ${total}`) bad.push(`stack: after Keep the counter says "${c1}"`);
    if (total > 2) { await page.keyboard.press('ArrowLeft'); await sleep(1100); const c2 = await count(); if (c2 !== `3 of ${total}`) bad.push(`stack: after Not for me the counter says "${c2}"`); }
    await page.keyboard.press('o'); await sleep(700); await snap('morning-open'); await check('morning-open');
    await page.keyboard.press('Escape'); await sleep(3000); await snap('feed-after-stack'); await check('feed-after-stack');
    if ((await view()) !== 'feed' || !(await feedUp())) bad.push(`stack: Esc did not open the feed (view ${await view()})`);
    const kept = await page.evaluate(([k]) => { try { const S = JSON.parse(localStorage.getItem(k) || '{}'); return { hearts: Object.keys(S.hearts || {}).length, dismissed: Object.keys(S.dismissed || {}).length, day: S.viewer?.stackDay }; } catch (e) { return null; } }, [SK]);
    note('after the stack', kept); if (!kept?.hearts) bad.push('stack: Keep wrote no heart'); if (total > 2 && !kept?.dismissed) bad.push('stack: Not for me wrote nothing'); if (!kept?.day) bad.push('stack: the day was not marked');
  }
  /* the same day again: the feed, no stack */
  const u2 = new URL(URL0); u2.searchParams.set('v', '2'); await page.goto(u2.toString(), { waitUntil: 'domcontentloaded' }); await sleep(3500); await snap('same-day'); await check('same-day');
  if (await page.$('.v2-card')) bad.push('stack: came up twice on the same day'); if (!(await feedUp())) bad.push('same-day: no feed');
  /* a new day but ?stack=0: no stack */
  await setS({ stackDay: '' }); const u3 = new URL(URL0); u3.searchParams.set('v', '2'); u3.searchParams.set('stack', '0'); await page.goto(u3.toString(), { waitUntil: 'domcontentloaded' }); await sleep(3500);
  if (await page.$('.v2-card')) bad.push('stack: ?stack=0 still shows it'); if (!(await feedUp())) bad.push('stack=0: no feed');
  /* a new day, the flag on, but an email link (?go=feed): the feed itself */
  await setS({ stackDay: '' }); const u4 = new URL(URL0); u4.searchParams.set('v', '2'); u4.searchParams.set('stack', '1'); u4.searchParams.set('go', 'feed'); await page.goto(u4.toString(), { waitUntil: 'domcontentloaded' }); await sleep(3500); await snap('go-feed'); await check('go-feed');
  if (await page.$('.v2-card')) bad.push('stack: shown on a ?go=feed link'); if (!(await feedUp())) bad.push('go=feed: no feed');
  /* a card link (#card=): the feed with the card, no stack */
  await setS({ stackDay: '' }); const u5 = new URL(URL0); u5.searchParams.set('v', '2'); u5.hash = '#card=none'; await page.goto(u5.toString(), { waitUntil: 'domcontentloaded' }); await sleep(3500);
  if (await page.$('.v2-card')) bad.push('stack: shown on a #card= link');
  const v = await view(); note('end', { view: v, bad: bad.length });
  fs.writeFileSync(path.join(OUT, 'walk.json'), JSON.stringify({ url: URL0, mode: 'stack', log, bad, view: v }, null, 2));
  await browser.close();
  if (bad.length) { console.error('\nPROBLEMS:\n- ' + bad.join('\n- ')); process.exit(1); }
  console.log(`\nok · ${shot} screens in ${OUT}`); process.exit(0);
}

/* the beats: press what the screen asks for, until the sunrise */
let guard = 0, lastBeat = '';
while (guard++ < 80) {
  const d = await dbg(); if (!d) { await sleep(800); continue; }
  const beat = d.beat, kind = await page.evaluate(() => { const s = document.querySelector('#v2-stage > *'); return s ? s.className : ''; });
  if (beat !== lastBeat) { await snap(beat); await check(beat); note(`beat ${beat}`, { kind, ready: d.st.ready, steps: d.st.steps.filter((x) => x && x.state === 'done').length }); lastBeat = beat; }
  if (d.st.error) { note('read error screen', { msg: d.st.error }); break; }
  if (kind.includes('v2-done')) { await snap('done'); await check('done'); note('done screen', { findings: d.st.findings.length }); break; }
  if (kind.includes('v2-slide')) { await sleep(900); await page.keyboard.press('Space'); }
  else if (kind.includes('v2-tut')) { const h = await page.evaluate(() => document.querySelector('.v2-tut h1')?.textContent || ''); await page.keyboard.press(/keep/.test(h) ? 'ArrowRight' : /Open/.test(h) ? 'o' : /drop/.test(h) ? 'ArrowLeft' : 'ArrowRight'); await sleep(2800); }
  else if (kind.includes('v2-hold')) { await sleep(2000); }
  else if (kind.includes('v2-tap')) { const multi = await page.$('#v2-confirm'); await page.keyboard.press('1'); await sleep(250); if (multi) await page.keyboard.press('Space'); }
  else await sleep(600);
  await sleep(500);
}
if (confirms > 1) bad.push(`confirm POSTed ${confirms} times`);
/* the sunrise → the stack (a reload) → three verbs → the gate → the trial → the feed */
await page.keyboard.press('Space'); await sleep(4500); await snap('stack'); await check('stack');
for (let i = 0; i < 3; i++) { const card = await page.$('.v2-card:not(.is-wait)'); if (!card) break; await page.keyboard.press(i === 1 ? 'ArrowLeft' : 'ArrowRight'); await sleep(1400); }
await snap('gate'); await check('gate'); note('gate', { text: (await text()).split('\n').find((l) => /Unlock|moves/.test(l)) || '' });
await page.keyboard.press('Space'); await sleep(1200); await snap('plan'); await check('plan');
await page.keyboard.press('Space'); await sleep(3500); await snap('after-gate'); await check('after-gate');
const v = await view(); note('end', { view: v, confirms, bad: bad.length });
fs.writeFileSync(path.join(OUT, 'walk.json'), JSON.stringify({ url: URL0, log, bad, confirms, view: v }, null, 2));
await browser.close();
if (bad.length) { console.error('\nPROBLEMS:\n- ' + bad.join('\n- ')); process.exit(1); }
console.log(`\nok · ${shot} screens in ${OUT}`);
