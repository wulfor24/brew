#!/usr/bin/env node
/* The jam, rendered and measured (26 Oct: no test ever drew the page, so a sideways bar, two scrollbars, bubbles under the bar
   and all-caps labels reached Param). Opens each jam link in headless Chrome at three window sizes, walks every deliverable tab,
   Creative and Brief, and every panel tab, and fails on what a person would see as broken:
   - the page wider than the window (a sideways scrollbar)
   - a scroll box inside another scroll box, or one wider than what it shows, in the panel
   - a ship bar taller than 72px (its message runs onto lines)
   - the stage's last piece out of reach once scrolled to the bottom (under the bar)
   - a label in the panel, the brief or the bar drawn in capitals by CSS
   Any brand: pass jam links (a share link opens without signing in).
     node tools/audit-layout.mjs 'https://brew.joinsquareup.com/<slug>#remix=<card>/<change>&s=<token>' [more links…]
   Exit 1 when anything fails. */
import { launchBrowser } from '../pdf/render.js';

const SIZES = [[1000, 600], [1280, 800], [390, 844]];
const urls = process.argv.slice(2).filter((u) => /^https?:\/\//.test(u));
if (!urls.length) { console.error('usage: node tools/audit-layout.mjs <jam link> [more…]'); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* what the page looks like now: everything measured in the page */
const measure = () => {
  const out = [], vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const de = document.documentElement; if (de.scrollWidth > innerWidth + 1) out.push(`page is ${de.scrollWidth - innerWidth}px wider than the window`);
  const scrolls = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2; };
  const panel = document.querySelector('.st-panel-b');
  if (panel && vis(panel)) {
    if (panel.scrollWidth > panel.clientWidth + 1) out.push(`panel scrolls sideways by ${panel.scrollWidth - panel.clientWidth}px`);
    const inner = [...panel.querySelectorAll('*')].filter((el) => vis(el) && scrolls(el) && el.tagName !== 'TEXTAREA' && !el.closest('.cs-styles, .cs-grid, .j2-pop'));
    if (inner.length && scrolls(panel)) out.push(`a scroll box inside the scrolling panel (${inner[0].className || inner[0].tagName})`);
    const ta = [...panel.querySelectorAll('textarea')].find((t) => vis(t) && t.scrollHeight > t.clientHeight + 4); if (ta) out.push('a text box in the panel scrolls inside the panel');
  }
  const bar = document.querySelector('.std .ship'); if (bar && vis(bar) && bar.getBoundingClientRect().height > 72) out.push(`ship bar is ${Math.round(bar.getBoundingClientRect().height)}px tall`);
  const stage = document.querySelector('.std .st-asset, .std .tbm-scroll');
  if (stage && vis(stage)) { const sc = [stage, ...stage.querySelectorAll('*')].find((el) => scrolls(el)) || stage; sc.scrollTop = sc.scrollHeight;
    const last = [...stage.querySelectorAll('.wa2-chat > *, .am-chat > *, .tbm-f, .as-meta > :last-child')].filter(vis).pop();
    if (last && bar && vis(bar) && !stage.closest('.is-brief')) { const lr = last.getBoundingClientRect(), br = bar.getBoundingClientRect(); if (lr.bottom > br.top + 2 && lr.top < br.bottom) out.push('the stage’s last piece sits under the ship bar'); } }
  const caps = [...document.querySelectorAll('.st-panel *, .tbm-doc *, .std .ship *')].find((el) => vis(el) && getComputedStyle(el).textTransform === 'uppercase' && /[a-z]/i.test(el.textContent || '') && !el.closest('.st-asset, .cs-look, .j2-sti'));
  if (caps) out.push(`capital letters by CSS: "${(caps.textContent || '').trim().slice(0, 30)}"`);
  return out;
};

const b = await launchBrowser(); let bad = 0;
try {
  for (const url of urls) for (const [w, h] of SIZES) {
    const page = await b.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90e3 }); await page.waitForSelector('.std', { timeout: 60e3 }); await wait(2500);
      const tabs = await page.$$eval('[data-dl-open]', (xs) => xs.map((x) => x.dataset.dlOpen)); const chs = [null, ...tabs];
      for (const ch of chs) {
        if (ch) { await page.click(`[data-dl-open="${ch}"]`).catch(() => {}); await wait(2500); }
        const label = await page.$eval('.dl-pill.on', (x) => x.textContent.trim()).catch(() => 'this jam');
        for (const stage of ['creative', 'brief']) {
          if (await page.$(`[data-tb-stage="${stage}"]`)) { await page.click(`[data-tb-stage="${stage}"]`); await wait(stage === 'brief' ? 4000 : 1500); }
          for (const tab of await page.$$eval('.st-tabs [data-tab]', (xs) => xs.map((x) => x.dataset.tab))) {
            await page.click(`.st-tabs [data-tab="${tab}"]`).catch(() => {}); await wait(1200);
            const found = await page.evaluate(measure);
            for (const f of found) { bad++; console.log(`✖ ${w}x${h} · ${label} · ${stage} · ${tab}: ${f}`); }
          }
        }
        if (ch) await page.click('[data-tb-stage="creative"]').catch(() => {});
      }
      for (const e of errs) { bad++; console.log(`✖ ${w}x${h} · script error: ${e.slice(0, 160)}`); }
      console.log(`· ${w}x${h} ${url.split('#')[0]}: ${chs.length} deliverable${chs.length > 1 ? 's' : ''} checked`);
    } catch (e) { bad++; console.log(`✖ ${w}x${h} · ${url.split('#')[0]}: ${e.message}`); } finally { await page.close().catch(() => {}); }
  }
} finally { await b.close(); }
console.log(bad ? `\n${bad} layout problem${bad > 1 ? 's' : ''}` : '\nNo layout problems'); process.exit(bad ? 1 : 0);
