// The jam's chips (UI2): the publish pack, the projected impact and the remake. All read-only towards accounts, all free here:
// the AI is mocked or faked, media is made by ffmpeg/Chromium stand-ins (MEDIA_FAKE), nothing paid is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { runIn } from '../brand-ctx.js';
import { FAMILY_OF, mockPkg } from '../studio.js';
import { buildPack, csv } from '../publish-pack.js';
import { impactInputs, rulesImpact, cleanImpact, projectImpact, PROJECTION } from '../impact.js';
import { realRows } from '../connectors/common.js';

const BRAND = { slug: 'acme', name: 'Acme', host: 'acme.com', sym: '$', config: {}, seed: { brand: { name: 'Acme', host: 'acme.com', colors: ['#123456'] } } };
const ONE = {}; for (const [a, f] of Object.entries(FAMILY_OF)) ONE[f] ||= a; // one action per studio family
const EXPECT = { meta_ad: ['copy.txt'], social: ['copy.txt'], post: ['copy.txt', 'where.txt'], crm: ['whatsapp-template.txt', 'email.html', 'email.txt', 'sms.txt'], store: ['section.html'], listing: ['listings.csv'],
  vis: ['faq.html', 'faq-jsonld.html'], search: ['google-ads-editor.csv'], setup: ['checklist.md'], brief: ['shot-list.md'], outreach: ['email.txt'], meta_ops: ['ads-manager-changes.csv', 'do-this-in-ads-manager.txt'], print: ['print.html', 'print-spec.txt'], decision: ['decision.md'] };
const chOf = (family, action) => ({ id: 'ch_1', family, action: `x.${action}`, actionLabel: `Do ${action}`, target: { name: 'Somewhere', object: 'Thing' }, rollback: 'Undo it', money: false });
const pack = (family, action, pkg, extra = {}) => runIn(BRAND, () => buildPack({ ch: chOf(family, action), pkg, family, version: 3, brand: { name: 'Acme', host: 'acme.com', colors: ['#123456'] }, ...extra }));
const names = (r) => r.entries.map((e) => e.name);
const text = (r, n) => r.entries.find((e) => e.name === n)?.data.toString();

test('every studio family gets a pack: README first, its own files, and nothing claims it was posted', async () => {
  for (const [family, action] of Object.entries(ONE)) {
    const pkg = runIn(BRAND, () => mockPkg(family, action, { title: 'Ten minutes a day', sub: 'A card' }, 0, '', {}));
    const r = await pack(family, action, pkg);
    assert.equal(names(r)[0], 'README.txt', family);
    for (const f of EXPECT[family]) assert.ok(names(r).includes(f), `${family}: ${f} in ${names(r)}`);
    assert.match(r.readme, /changes nothing in your accounts/, family);
    assert.match(r.readme, /WHERE EACH PART GOES\n- /, `${family}: says where it goes`);
    for (const e of r.entries) assert.doesNotMatch(e.data.toString('latin1'), /posted to|published to|we posted|is live now/i, `${family} ${e.name}`);
    assert.doesNotMatch(r.readme, /^0$/m, `${family}: no stray 0 line`);
    assert.match(r.fileName, /^acme-do-.+-v3\.zip$/);
  }
});

test('pack contents: Ads Editor rows with match types, a marketplace CSV, FAQ markup and llms.txt, the Ads Manager list', async () => {
  const s = await pack('search', 'search_ad', { adGroup: 'Serum', keywords: ['hair serum (phrase)', '[minoxidil alternative]', 'scalp care'], negatives: ['free (broad)'], headlines: ['A', 'B', 'C'], descriptions: ['D1', 'D2'], finalUrl: 'https://acme.com/p', dailyBudget: 900 });
  const rows = text(s, 'google-ads-editor.csv').trim().split('\n');
  assert.match(rows[0], /^Campaign,Campaign Type,Campaign Status,Ad group,Ad Group Status,Keyword,Criterion Type,Headline 1,Headline 2,Headline 3,Description 1,Description 2,Final URL/); assert.match(rows[1], /,Search,Paused,/); assert.match(rows[1], /Maximize conversions$/);
  assert.ok(rows.some((r) => /,hair serum,Phrase,/.test(r)) && rows.some((r) => /,minoxidil alternative,Exact,/.test(r)) && rows.some((r) => /,scalp care,Broad,/.test(r)) && rows.some((r) => /,free,Negative Broad,/.test(r)));
  assert.ok(rows.some((r) => /Responsive search ad/.test(r) && /https:\/\/acme\.com\/p/.test(r)));
  const l = await pack('listing', 'listing_titles', { product: 'Serum', name: 'Acme Serum', items: [{ marketplace: 'Amazon', now: 'As listed today', new: 'Acme Serum, 30 ml' }], searchTerms: 'hair, serum' });
  assert.equal(text(l, 'listings.csv'), csv([['marketplace', 'product', 'current_title', 'new_title', 'bullets', 'backend_search_terms', 'images'], ['Amazon', 'Serum', 'As listed today', 'Acme Serum, 30 ml', '', 'hair, serum', '']]));
  const v = await pack('vis', 'llms_txt', { file: 'llms.txt', entries: [{ q: 'Is it vegan?', a: 'Yes.', source: 'Label' }] });
  assert.ok(names(v).includes('llms.txt')); assert.match(text(v, 'faq-jsonld.html'), /"@type": "FAQPage"/); assert.match(text(v, 'llms.txt'), /## Is it vegan\?\nYes\.\nSource: Label/);
  const m = await pack('meta_ops', 'pause_losers', { summary: 'Pause two', items: [{ name: 'Set A', now: 'On', next: 'Paused' }], rule: 'CPA over stop line 48h' });
  assert.match(text(m, 'do-this-in-ads-manager.txt'), /Brew changes nothing in your ad account/); assert.match(text(m, 'ads-manager-changes.csv'), /Set A,On,Paused/);
  const p = await pack('print', 'print_insert', { front: 'Thanks', size: 'A6 card', quantity: 500, goesIn: 'Every box' }, { renderPdf: async () => Buffer.from('%PDF-1.4 fake') });
  assert.ok(names(p).includes('print.pdf') && !names(p).includes('print.html'), 'a PDF when the renderer works');
  const p2 = await pack('print', 'print_insert', { front: 'Thanks', size: 'A6 card' }, { renderPdf: async () => { throw new Error('no chrome'); } });
  assert.ok(names(p2).includes('print.html')); assert.match(p2.readme, /STILL TO DO\n- print\.pdf couldn’t be made/);
});

const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('an ad’s creative comes in 1:1, 4:5 and 9:16, and a remade version brings its own media', { skip: !ffmpeg && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-chips-')), img = path.join(dir, 'c.png'), vid = path.join(dir, 'v.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=400x500', '-frames:v', '1', img]);
  fs.writeFileSync(vid, 'fake mp4');
  const read = async (rel) => (rel === 'gen/c.png' || rel === 'gen/s2.png' ? img : rel === 'gen/v.mp4' ? vid : null);
  const r = await pack('meta_ad', 'add_variants', { primaryText: 'Hi', headline: 'H', cta: 'Shop now', format: '4:5', image: 'gen/c.png', imageBrief: 'x' }, { read });
  for (const s of ['1x1', '4x5', '9x16']) assert.ok(names(r).some((n) => n.startsWith(`media/creative-${s}.`)), `${s} in ${names(r)}`);
  const sq = r.entries.find((e) => e.name === 'media/creative-1x1.jpg').data; fs.writeFileSync(path.join(dir, 'sq.jpg'), sq);
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(dir, 'sq.jpg')]).toString().trim();
  assert.equal(dims, '400,400', 'the 1:1 is a centre crop');
  const st = await pack('store', 'page_copy', { pages: 'PDP', section: 'End', heading: 'H', body: 'B', draft: { as: 'carousel', images: ['gen/c.png', 'gen/s2.png'], slides: [{ text: 'One' }, { text: 'Two' }], text: false, remade: true } }, { read });
  assert.ok(names(st).includes('media/carousel-01.png') && names(st).includes('media/carousel-02.png') && names(st).includes('carousel.txt'), names(st).join(' '));
  const cr = await pack('crm', 'flow_copy', { channel: 'WhatsApp', trigger: 'Day 21', segment: 'Buyers', message: 'Hi {first_name}', draft: { as: 'video', images: ['gen/c.png'], video: 'gen/v.mp4', script: [{ beat: 'Hook', line: 'Hi' }], pending: true } }, { read });
  assert.ok(names(cr).includes('media/video-video.mp4') && names(cr).includes('video.txt')); assert.match(cr.readme, /still being made/);
});

/* ---------- the projected impact ---------- */
const recipe = { name: 'Paid ads', metric: { name: 'Cost per first order', lower: true }, window: 14, timingLine: 'Checks on day 1, 3 and 7; decides on day 14.' };
const ledger = realRows([{ key: 'meta.spend.30d', label: 'Meta spend, 30 days', v: '₹1,20,000', method: 'account:meta', src: 'Meta' }, { key: 'meta.roas', label: 'ROAS', v: '9.9x', method: 'connected account', demo: true }]);

test('impact: a labelled estimate from the grade, the family and real account rows only; demo rows never count', () => {
  const x = impactInputs({ card: { id: 'm04-1', title: 'T' }, ch: { actionLabel: 'Launch a test' }, grade: { impact: 3, confidence: 0.6, effort: 2, why: 'Rivals run it' }, recipe, measure: { from: 'meta', metric: 'Cost per first order', baseline: null, window: 7 }, ledger, connected: { meta: true } });
  assert.equal(x.window, 14, 'the family’s window leads'); assert.deepEqual(x.rows.map((e) => e.key), ['meta.spend.30d']);
  const r = rulesImpact(x);
  assert.equal(r.metric, 'Cost per first order'); assert.equal(r.direction, 'down'); assert.ok(r.low < r.high && r.low >= 0);
  assert.ok(r.basis.some((b) => /graded this move 3 of 5/.test(b)) && r.basis.some((b) => /Meta spend, 30 days: ₹1,20,000/.test(b)));
  assert.ok(!JSON.stringify(r).includes('9.9x'), 'a simulated row is never a basis');
  const none = rulesImpact(impactInputs({ card: {}, ch: {}, recipe, measure: { from: 'meta' }, ledger: [], connected: {} }));
  assert.equal(none.confidence, 'low'); assert.ok(none.assumptions.some((a) => /no grade yet/.test(a)) && none.assumptions.some((a) => /isn’t connected/.test(a)));
});

test('impact: the AI’s unbacked numbers become assumptions; a failed AI is said, never hidden, and the rules stand', async () => {
  const x = impactInputs({ card: {}, ch: {}, grade: { impact: 4, confidence: 0.8, effort: 1 }, recipe, ledger, connected: { meta: true } });
  const unbacked = (s) => (/18%/.test(s) ? ['18%'] : []);
  const j = { metric: 'Cost per first order', low: 12, high: 4, unit: '% better', direction: 'down', windowDays: 14, confidence: 'high', basis: ['Meta spend is ₹1,20,000 a month', 'Category CTR is 18%'], assumptions: ['It runs 14 days'] };
  const c = cleanImpact(j, x, unbacked);
  assert.deepEqual([c.low, c.high], [4, 12], 'the range is ordered');
  assert.deepEqual(c.basis, ['Meta spend is ₹1,20,000 a month']); assert.ok(c.assumptions.some((a) => /^Assumed, not from your facts: Category CTR is 18%/.test(a)));
  const ok = await projectImpact(x, { ai: async () => j, unbacked });
  assert.equal(ok.by, 'ai'); assert.equal(ok.estimate, true); assert.equal(ok.label, PROJECTION); assert.ok(!ok.aiError);
  const bad = await projectImpact(x, { ai: async () => { throw new Error('vertex 503'); }, unbacked, log: { warn() {} } });
  assert.equal(bad.by, 'rules'); assert.match(bad.aiError, /didn’t come through \(vertex 503\)/); assert.equal(bad.estimate, true);
  const junk = await projectImpact(x, { ai: async () => ({ low: 'lots' }), unbacked });
  assert.equal(junk.by, 'rules'); assert.match(junk.aiError, /unusable/);
  const gaps = impactInputs({ card: {}, ch: {}, recipe, ledger: [{ key: 'shopify.orders', label: 'Orders', error: 'timeout' }] });
  assert.match(gaps.gaps[0], /couldn’t be read .* this time; the next refresh tries again/);
});

test('the chips stay read-only: no account writes, no posted wording; demo visitors may not remake', () => {
  const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const pk = src('publish-pack.js'), im = src('impact.js'), rx = src('remix.js'), fs0 = src('feed-service.js');
  for (const s of [pk, im]) { assert.doesNotMatch(s, /\bfetch\(|treg|connectors\/(meta|shopify|google|klaviyo)/, 'the pack and impact call no outside service'); assert.doesNotMatch(s, /Posted to/); }
  const block = rx.slice(rx.indexOf("on('GET', '/api/changes/:chid/pack'"), rx.indexOf("on('GET', '/api/changes/:chid/photos'"));
  assert.doesNotMatch(block, /Posted to|\.publish\(|graph\.facebook|admin\/api/);
  const DEMO_OK = new RegExp(/const DEMO_OK = \/(.+)\/;/.exec(fs0)[1]);
  assert.ok(!DEMO_OK.test('/api/changes/ch_1/remake'), 'a demo visitor can’t make media');
});
test('a jam guest reaches its own change’s chips (remake too), never discard or restore', async () => {
  const { guestAllows } = await import('../feed-service.js'), g = { wids: ['w1'], changes: { ch_1: { workId: 'w1' } } };
  for (const r of ['pack', 'impact', 'remake']) assert.ok(guestAllows(`/api/changes/ch_1/${r}`, g), `a guest may use ${r}`); /* remake: Param, 25 Oct */
  for (const r of ['discard', 'restore']) assert.ok(!guestAllows(`/api/changes/ch_1/${r}`, g), `a guest may not ${r}`);
  assert.ok(!guestAllows('/api/changes/ch_2/pack', g), 'not another jam’s change');
});

/* ---------- on the server (AI mock; MEDIA_FAKE makes media with ffmpeg and Chromium, free) ---------- */
const SLUG = ['arata-in'].find((s) => fs.existsSync(path.join('.brands', s, 'seed.json')));
test('on the server: every family’s change packs, projects and remakes; media lands on its version', { skip: !SLUG && 'no .brands/ here', timeout: 240e3 }, async () => {
  const PORT = 4500 + Math.floor(Math.random() * 40);
  const env = { ...process.env, PORT: String(PORT), AI_MOCK: '1', MEDIA_FAKE: ffmpeg ? '1' : '0', PACK_PDF: '0', BUILD_RESUME_OFF: '1', HEAL_OFF: '1', RESEARCH_OFF: '1', LIVE_OFF: '1', TREG_OFF: '1', BUILD_NO_IP_LIMIT: '1', DRAFTS_BG_OFF: '1' };
  delete env.K_SERVICE;
  const srv = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((ok, no) => { const tm = setTimeout(() => no(new Error('server did not start')), 30e3); srv.stdout.on('data', (d) => { if (/Brew Feed on/.test(String(d))) { clearTimeout(tm); ok(); } }); });
    let TID = ''; const j = async (m, p, b) => (await fetch(`http://localhost:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-brand': SLUG, 'x-tenant': TID }, body: b ? JSON.stringify(b) : undefined })).json();
    TID = (await j('POST', `/api/tenants?brand=${SLUG}`, { snapshot: { onboarded: true } })).id;
    const fams = {}, cards = Object.values((await j('GET', `/api/tenants/${TID}/feed`)).cards);
    for (let i = 0; i < cards.length && Object.keys(fams).length < 12; i += 8) for (const r of await Promise.all(cards.slice(i, i + 8).map((c) => j('POST', `/api/cards/${c.id}/remix`, {})))) for (const ch of r.changes || []) fams[ch.family] ||= ch;
    assert.ok(Object.keys(fams).length >= 8, `families: ${Object.keys(fams)}`);
    for (const [f, ch] of Object.entries(fams)) {
      const pk = (await j('GET', `/api/changes/${ch.id}/pack`)).pack;
      assert.ok(pk?.readOnly && pk.files[0] === 'README.txt' && EXPECT[f].every((x) => pk.files.includes(x) || (f === 'print' && x === 'print.html')), `${f}: ${pk?.files}`);
      const z = await fetch(`http://localhost:${PORT}/${pk.url}`); assert.equal(z.status, 200); assert.equal(Buffer.from(await z.arrayBuffer()).subarray(0, 2).toString(), 'PK');
      assert.equal((await j('GET', `/api/changes/${ch.id}/pack?v=99`)).error, 'That version isn’t on this change.');
      const im = (await j('GET', `/api/changes/${ch.id}/impact`)).impact;
      assert.ok(im.estimate && im.label === PROJECTION && Number.isFinite(im.low) && im.low <= im.high && ['low', 'medium', 'high'].includes(im.confidence) && im.window > 0, `${f}: ${JSON.stringify(im)}`);
      assert.equal((await j('GET', `/api/changes/${ch.id}/impact`)).impact.cached, true, `${f}: cached per head version`);
      const as = ['video', 'carousel', 'image'][Object.keys(fams).indexOf(f) % 3];
      const rm = await j('POST', `/api/changes/${ch.id}/remake`, { as });
      assert.ok(!rm.error, `${f} ${as}: ${rm.error}`); assert.equal(rm.change.versions.length, ch.versions.length + 1, `${f}: a new version`);
      const d = rm.change.pkg.draft; assert.equal(d.as, as); assert.equal(d.remade, true);
      if (as === 'carousel') assert.ok(d.slides.length >= 3, `${f}: ${d.slides.length} slides`); if (as === 'video') assert.ok(d.script.length >= 3); if (as === 'image') assert.ok(d.overlay || d.imageBrief);
      assert.ok(rm.making || rm.why, `${f}: says whether media is coming`);
      const im2 = (await j('GET', `/api/changes/${ch.id}/impact`)).impact; assert.ok(!im2.cached, `${f}: a new head version gets a new projection`);
      if (rm.making) for (let i = 0; i < 90; i++) { await new Promise((ok) => setTimeout(ok, 1000)); const g = (await j('GET', `/api/changes/${ch.id}`)).change; if (g.remakePending) continue;
        assert.ok(!g.remakeError, `${f} ${as}: ${g.remakeError}`); const v = g.versions.find((x) => x.id === rm.version.id).snapshot.draft;
        assert.ok(v.images.length && !v.pending && (as !== 'video' || v.video), `${f} ${as}: media on its version`); break; }
    }
    assert.equal((await j('POST', `/api/changes/${Object.values(fams)[0].id}/remake`, { as: 'gif' })).error, 'Remake as a video, a carousel or an image.');
    assert.equal((await j('GET', '/api/changes/ch_nope/pack')).error, 'not found');
  } finally { srv.kill(); }
});

test('a member’s projection never reaches a guest, and a double tap makes one remake', () => {
  const rx = fs.readFileSync(new URL('../remix.js', import.meta.url), 'utf8');
  assert.match(rx, /const \{ impact: _imp, packMeta: _pk, \.\.\.pub \} = ch;/, 'the change payload never carries cached projections');
  assert.match(rx, /key = `\$\{head\?\.id \|\| 'v0'\}:\$\{mock \|\| !mem \? 'rules' : 'ai'\}:\$\{mem \? 'm' : 'g'\}`/, 'the projection cache is per member or guest');
  assert.match(rx, /const ai = mem && !mock/, 'only the brand’s team spends AI on a projection');
  assert.match(rx, /REMAKING\.add\(ch\.id\);/, 'the remake is held before the AI call');
  assert.match(rx, /if \(ch\.packMeta\[key\] && \(await genFile\(key\)\)\) return/, 'a pack is built once per version');
});
