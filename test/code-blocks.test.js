// node --test test/code-blocks.test.js — code a writer fences (```json …```) is code everywhere it is laid out, for every family
// that can carry it (AI answers markup, store page sections, setup steps): the draft mocks (no product photo over markup), the
// jam's stage (the code as text, never the mock's picture), the brief (editor and shared page) and the publish pack's files.
// Found on the Arata "Fix product markup" jam (19 Oct): a literal "```json" line, JSON-LD as paragraphs, two product photos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitCode, hasCode, codeBlocks, codeExt, wordsHtml } from '../code-md.js';
import { pageHtml, emailHtml, whatsappHtml, mdHtml } from '../draft-mocks.js';
import { draftView } from '../drafts-bg.js';
import { planFor } from '../card-plan.js';
import { buildPack } from '../publish-pack.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const COPY = '# Inject JSON-LD schema into Shopify theme\n\nDefault Shopify metadata misses aggregate reviews.\n\n- Platform: shopify\n- SKUs with Schema: 81\n\n```json\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Slick Organics Private Limited"\n}\n```';
const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';

test('the reader splits fenced code from words; an open fence is code to the end', () => {
  const parts = splitCode(COPY), code = parts.filter((x) => x.code);
  assert.equal(code.length, 1); assert.equal(code[0].lang, 'json');
  assert.equal(JSON.parse(code[0].text)['@type'], 'Organization', 'the block is the JSON as written, nothing around it');
  assert.ok(parts[0].text.includes('Default Shopify metadata'));
  assert.ok(hasCode(COPY)); assert.ok(!hasCode('Plain words with a `tick` in them'));
  assert.deepEqual(codeBlocks('Paste:\n```liquid\n{{ product.title }}').map((b) => [b.lang, b.text]), [['liquid', '{{ product.title }}']]);
  assert.equal(codeExt('json'), 'json'); assert.equal(codeExt('ld+json'), 'json'); assert.equal(codeExt(''), 'txt');
  assert.ok(!wordsHtml(COPY).includes('```'));
});

test('a draft mock whose words are code shows a code block and no product photo (page, email, chat)', () => {
  for (const make of [pageHtml, emailHtml, whatsappHtml]) {
    const h = make({ brand: { name: 'Arata', host: 'arata.in' }, title: 'Page section: JSON-LD Schema Integration', copy: COPY, photo: PHOTO });
    assert.ok(!h.includes('```'), `${make.name}: no literal fence`);
    assert.match(h, /<pre class="code" data-lang="json"><code>\{\n {2}&quot;@context&quot;/, `${make.name}: the JSON-LD as a code block`);
    assert.ok(!h.includes(PHOTO), `${make.name}: no product photo over markup`);
  }
  // a plain page keeps its product photo
  assert.ok(pageHtml({ brand: { name: 'Arata' }, title: 'Hair serum', copy: 'Two drops a night.', photo: PHOTO }).includes(PHOTO));
  assert.ok(!mdHtml(COPY).includes('# Inject'), 'the heading is a heading');
});

test('the jam stage gets the draft code: draft view → card plan → the jam package (and old jams heal)', () => {
  const d = { k: 2, cardId: 'm13-1', kind: 'page', as: 'page', title: 'Page section: JSON-LD Schema Integration', copy: COPY, render: 'gen/mock.jpg', photo: 'https://cdn.example.com/serum-roller.png' };
  const v = draftView(d, { id: 'm13-1', images: ['https://cdn.example.com/serum.png'] });
  assert.equal(v.code, COPY, 'the full copy, fences and all'); assert.equal(v.fallback, undefined, 'no product photo behind a markup draft');
  assert.equal(draftView({ ...d, copy: 'Plain page words.' }, null).code, undefined, 'plain words carry no code');
  const pl = planFor({ id: 'm13-1', title: 'Inject JSON-LD schema into Shopify theme', sub: 'Add the markup', cta: { label: 'Fix product markup on Shopify' } }, { draft: v });
  assert.equal(pl.draft.code, COPY);
  const rx = read('remix.js');
  assert.match(rx, /text, \.\.\.\(text \? \{ code: d\.code \|\| null \} : \{\}\)/, 'seedV0 puts the code on the package');
  assert.match(rx, /const healDraftCode = /); assert.match(rx, /healDraftCode\(t, ch\);/, 'old jams look their code up on read');
  const bg = read('drafts-bg.js');
  assert.match(bg, /async function healCodeMocks\(/); assert.match(bg, /await healCodeMocks\(p, cache\)/, 'saved mocks are shot again without the photo');
});

/* the browser's renderers: rich() (every stage), txt() (FAQ answers, setup steps), the stage's code draft, the brief editor */
const fnSrc = (src, from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert.ok(i >= 0 && j > i, `${from} found`); return src.slice(i, j); };
const app = read('public/app.js');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const { rich, txt } = new Function('esc', `${fnSrc(app, '  const splitCode = ', '  const poss = ')}; return { rich, txt };`)(esc);

test('the stage renders fenced code as a code block (rich, txt) for every family', () => {
  const h = rich(COPY);
  assert.ok(!h.includes('```'), 'no literal fence on the stage');
  assert.match(h, /<pre class="rx-code" data-lang="json"><code>\{/);
  assert.match(h, /<b class="rx-h">Inject JSON-LD schema into Shopify theme<\/b>/, 'a Markdown heading, never "# Title"');
  assert.match(h, /<ul class="rx-ul"><li>Platform: shopify<\/li>/);
  assert.equal(txt('Plain answer.'), 'Plain answer.'); assert.match(txt('Add this:\n```html\n<b>x</b>\n```'), /<pre class="rx-code" data-lang="html"><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/);
  assert.ok(rich('A store section body.\n\nSecond paragraph.').includes('rx-p'), 'plain words read as before');
  // the families that can carry code use them: the store body (rich), the FAQ answers and setup steps (txt), a code draft
  assert.match(app, /<p>\$\{txt\(e\.a\)\}/); assert.match(app, /<span class="sh-box"><\/span><span>\$\{txt\(x\)\}/); assert.match(app, /<li><span>\$\{txt\(x\)\}<\/span><\/li>/);
  assert.match(app, /if \(d\?\.text && d\.code\) return `<div class="as as-file as-code/, 'a code draft shows as code, before the mock picture');
  assert.ok(app.indexOf('if (d?.text && d.code)') < app.indexOf('if (d?.text && d.images?.[0])'));
});

test('the brief editor keeps a fenced block as one code block, and the shared brief page shows it as code', () => {
  const jr = read('public/jam-room.js');
  const toHtml = new Function('esc', `${fnSrc(jr, '  const inline = ', '  const textOf = ')}; return toHtml;`)(esc);
  const h = toHtml(COPY);
  assert.ok(!h.includes('```')); assert.match(h, /<pre class="rx-code" data-lang="json"><code>\{\n {2}&quot;@context&quot;/); assert.ok(!/<p>\s*&quot;@type/.test(h), 'no JSON lines as paragraphs');
  assert.match(jr, /if \(tag === 'PRE'\) \{ lines\.push\('```'/, 'and it goes back to the same fence when edited');
  assert.match(read('handoff.js'), /const md = \(s\) => splitCode\(s\)\.map/);
});

test('the publish pack ships code as code: the markup draft as a file, page sections and FAQ answers as code blocks, setup steps as fences', async () => {
  const vis = await buildPack({ ch: { action: 'visibility.schema_fix', actionLabel: 'Fix product markup' }, family: 'vis', pkg: { file: 'Product markup (JSON-LD)', entries: [{ q: 'Is it good?', a: 'Use this:\n```json\n{"a":1}\n```' }], draft: { text: true, code: COPY } }, brand: { name: 'Arata' } });
  const f = vis.entries.find((e) => e.name === 'code/markup-1.json'); assert.ok(f, 'the draft\'s JSON-LD as its own file');
  assert.equal(JSON.parse(f.data.toString())['@type'], 'Organization'); assert.match(vis.readme, /code\/markup-1\.json/);
  const faq = vis.entries.find((e) => e.name === 'faq.html').data.toString(); assert.ok(!faq.includes('```')); assert.match(faq, /<pre class="code" data-lang="json">/);
  const store = await buildPack({ ch: { action: 'store.section' }, family: 'store', pkg: { heading: 'Markup', body: 'Paste in the theme.\n\n```html\n<script type="application/ld+json">{}</script>\n```' }, brand: { name: 'Arata' } });
  const sec = store.entries.find((e) => e.name === 'section.html').data.toString();
  assert.ok(!sec.includes('```')); assert.match(sec, /<pre class="code" data-lang="html"><code>&lt;script type=&quot;application\/ld\+json&quot;&gt;\{\}&lt;\/script&gt;<\/code><\/pre>/);
  const setup = await buildPack({ ch: { action: 'setup.theme', actionLabel: 'Add the snippet' }, family: 'setup', pkg: { tool: 'Shopify', steps: ['Open the theme', 'Paste this:\n```liquid\n{{ product.title }}\n```'] }, brand: { name: 'Arata' } });
  const md = setup.entries.find((e) => e.name === 'checklist.md').data.toString();
  assert.match(md, /- \[ \] Paste this:\n\n```liquid\n\{\{ product\.title \}\}\n```/);
});
