// Customer-facing copy: never "ShopOS", "plays" never "moves", and the product's name only from product-name.js (copy pass, 26 Oct).
// The files below are the templates a brand member, invitee, email recipient or demo visitor reads or receives: emails,
// notifications, Slack posts, server pages, legal pages, the landing and demo picker, the Slack manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME, productNameScript } from '../product-name.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const TEMPLATES = ['auth.js', 'confirm-remind.js', 'digest.js', 'jam-mail.js', 'jam-brief.js', 'brief-status.js', 'closed-gate.js',
  'legal-pages.js', 'small-page.js', 'handoff.js', 'mail-layout.js', 'demo-routes.js', 'shopify-app.js', 'connectors/index.js',
  'public/demo-picker.html', 'public/index.html', 'docs/slack-app-manifest.json'];

/* the text a person can read: string literals of a JS file (comments dropped), the text and attributes of an HTML page,
   the string values of a JSON file. Regex literals are not strings, so a pattern that matches old saved copy is not flagged. */
/* a small JS scanner: string and template text (a ${…} reads as {x}), with comments and regex literals skipped */
const jsStrings = (src) => {
  const out = []; let i = 0, last = '';
  const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(?:return|typeof|case|in|of|new|delete|void|throw|else|do)$/;
  const code = (stopAtBrace) => { let depth = 0;
    while (i < src.length) { const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (c === '\'' || c === '"') { let j = i + 1, t = ''; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { t += src[j + 1]; j += 2; } else t += src[j++]; } out.push(t); i = j + 1; last = 'x'; continue; }
      if (c === '`') { i++; out.push(tpl()); last = 'x'; continue; }
      if (c === '/' && REGEX_AFTER.test(last)) { let j = i + 1, cls = false; while (j < src.length && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; } i = j + 1; while (/[a-z]/i.test(src[i] || '')) i++; last = 'x'; continue; }
      if (stopAtBrace) { if (c === '{') depth++; else if (c === '}') { if (!depth) { i++; return; } depth--; } }
      if (!/\s/.test(c)) last = /[\w$]/.test(c) ? (/[\w$]/.test(last.slice(-1)) ? last + c : c) : c;
      i++; } };
  const tpl = () => { let t = '';
    while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { t += src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; t += '{x}'; last = '{'; code(true); continue; } t += src[i++]; }
    i++; return t; };
  code(false); return out;
};
const textOf = (f) => {
  const s = read(f);
  if (f.endsWith('.json')) { const out = []; const walk = (o) => typeof o === 'string' ? out.push(o) : o && typeof o === 'object' && Object.values(o).forEach(walk); walk(JSON.parse(s)); return out; }
  if (f.endsWith('.html')) return [s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, ' ')];
  return jsStrings(s);
};

/* "moves" the verb stays: "moves the jam to Ready", "moves a brief on" */
const MOVE_NOUN = /(?<!spend )\b[Mm]oves?\b(?! (?:a|an|the|it|its|this|that|on|to|into|down|up|over|forward|back)\b)/;
const ADDRESS = /shopos\.ai|shopos-feed/gi;

test('no customer-facing template says ShopOS', () => {
  const bad = []; for (const f of TEMPLATES) for (const t of textOf(f)) if (/\s/.test(t) && /shopos/i.test(t.replace(ADDRESS, ''))) bad.push(`${f}: ${t.slice(0, 120)}`);
  assert.deepEqual(bad, []);
});

test('no customer-facing template calls a play a move', () => {
  const bad = []; for (const f of TEMPLATES) for (const t of textOf(f)) {
    /* a string that is a code value (a key, route, id, class or file name) or a log line is not copy */
    if (!/\s/.test(t) || /^[\w./:-]+$/.test(t) || /^\[[\w -]+\] /.test(t)) continue;
    if (MOVE_NOUN.test(t)) bad.push(`${f}: ${t.slice(0, 160)}`);
  }
  assert.deepEqual(bad, []);
});

test('the product name is one constant, and templates read it from there', () => {
  assert.equal(typeof PRODUCT_NAME, 'string'); assert.ok(PRODUCT_NAME.trim().length > 0);
  assert.equal(productNameScript(), `<script>globalThis.PRODUCT_NAME=${JSON.stringify(PRODUCT_NAME)}</script>`);
  const NAME = new RegExp(`\\b${PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const bad = []; for (const f of TEMPLATES.filter((x) => x.endsWith('.js'))) for (const t of textOf(f)) {
    if (!/\s/.test(t) || /^\[[\w -]+\] /.test(t) || /\(\+https?:/.test(t)) continue; /* a user-agent header, a code value ('brew' kinds, file names) or a log line is not copy */
    if (NAME.test(t)) bad.push(`${f}: ${t.slice(0, 120)}`);
  }
  assert.deepEqual(bad, [], 'type the name through PRODUCT_NAME from product-name.js');
  /* the emails' From name and the page titles are built from the constant */
  for (const f of ['auth.js', 'jam-mail.js', 'server.js', 'legal-pages.js', 'demo-routes.js'])
    assert.match(read(f), /import \{[^}]*PRODUCT_NAME[^}]*\} from '\.\/product-name\.js'/, `${f} imports PRODUCT_NAME`);
  const server = read('server.js');
  assert.match(server, /productNameScript\(\)/, 'every page gets the name in its head');
  assert.match(server, /<title>\$\{name === PRODUCT_NAME \? PRODUCT_NAME/, 'the page title reads the constant');
  /* only product-name.js types the name as a value */
  assert.equal((read('product-name.js').match(new RegExp(`'${PRODUCT_NAME}'`, 'g')) || []).length, 1);
});

test('the served HTML pages say their language and have a description', () => {
  for (const f of ['public/index.html', 'public/demo-picker.html']) {
    const s = read(f); assert.match(s, /<html[^>]*\blang="en"/, `${f} lang`); assert.match(s, /<meta name="description" content="[^"]{20,}"/, `${f} description`);
  }
  for (const f of ['legal-pages.js', 'small-page.js', 'handoff.js', 'shopify-app.js', 'jam2/ready.js']) {
    const s = read(f); assert.match(s, /<html lang="en"/, `${f} lang`); assert.match(s, /<meta name="description"/, `${f} description`);
  }
});
