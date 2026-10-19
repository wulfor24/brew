// A card's action never runs from the card: it opens the card's jam with the card's plan as its input (2026-10-14).
// The table is the contract, for every card kind and every action: the plan is non-empty and right for the action, the
// jam's brief carries the summary, the plan and the action's own label, the make step makes the action's widget, and v0
// is the card's own first draft when it has one. Part 1 runs on every card we have plus a synthetic card of every kind
// and every action; part 2 drives the real server (AI mock) on the brands in .brands/, card by card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { planFor, planMd, NAV_LABELS, actionOfCard } from '../card-plan.js';
import { recipeOfCard, ACTIONS } from '../remix.js';
import { familyOf, FAMILY_NAME } from '../studio.js';
import { CTA } from '../seed-template.js';
import { createJamBrief } from '../jam-brief.js';

const ROOTS = [process.env.BRANDS_DIR, '.brands', '../feed/.brands'].filter(Boolean).filter((d) => fs.existsSync(d));
const saved = [];
for (const root of ROOTS.slice(0, 1)) for (const slug of fs.readdirSync(root)) for (const f of ['seed.json', 'pools.json']) {
  const p = path.join(root, slug, f); if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, 'utf8')); (f === 'seed.json' ? j.posts || [] : Object.values(j).flat()).filter((c) => c?.title).forEach((c) => saved.push({ ...c, _brand: slug }));
}
// one card of every kind the feed makes (seen across every saved workspace in the bucket on 2026-10-14)
const K = (id, o) => ({ id, agent: 'creative', sector: 'creatives', type: 'idea', kind: 'media', title: `A ${id} card`, sub: 'What we saw, then the move.', time: '1 hr', ...o });
const KINDS = [
  K('seed-media-idea', { cta: { label: 'Generate versions' }, make: { format: 'single image ad' }, images: ['assets/x.jpg'] }),
  K('seed-rows-decision', { kind: 'rows', type: 'decision', sector: 'storefront', agent: 'storefront', rows: [['Product page', 'Add to cart fails']], cta: { label: 'Fix tracking' } }),
  K('seed-rows-report', { kind: 'rows', type: 'report', sector: 'signals', agent: 'brew', rows: [['Score', '41']], cta: { label: 'Open the scoreboard' } }),
  K('seed-rows-idea-reply', { kind: 'rows', post: { platform: 'reddit', format: 'reply', where: [{ name: 'r/Sneakers', url: 'https://reddit.com/r/Sneakers' }] }, cta: { label: 'Reply in r/Sneakers' } }),
  K('live-price', { kind: 'rows', type: 'decision', sector: 'catalog', agent: 'storefront', origin: 'watcher', liveSrc: { kind: 'catalog', id: 'e1' }, rows: [['Blue Tee', '₹999 → ₹1,099']], cta: { label: 'Update the prices' } }),
  K('live-stock', { kind: 'rows', type: 'decision', sector: 'catalog', origin: 'watcher', badge: ['Out of stock', 'warn'], liveSrc: { kind: 'catalog', id: 'e2' }, rows: [['Blue Tee', 'Out of stock'], ['Red Tee', 'Out of stock']], cta: { label: 'Pause what points there' } }),
  K('live-restock', { kind: 'rows', type: 'decision', sector: 'catalog', origin: 'watcher', rows: [['Blue Tee', 'Back in stock']], cta: { label: 'Restart what was paused' } }),
  K('live-catalog-new', { kind: 'rows', type: 'idea', sector: 'catalog', origin: 'watcher', rows: [['Green Runner', 'New']], cta: { label: 'Plan the launch' } }),
  K('live-links', { kind: 'rows', type: 'decision', sector: 'catalog', origin: 'watcher', rows: [['Old Runner', 'Removed']], cta: { label: 'Fix the links' } }),
  K('live-photos', { kind: 'rows', type: 'decision', sector: 'catalog', origin: 'watcher', cta: { label: 'Add photos' } }),
  K('move-media-idea', { origin: 'move', src: 'Move 21', cta: { label: 'Update landing page' }, sector: 'storefront', agent: 'storefront' }),
  K('move-rows-decision', { origin: 'move', kind: 'rows', type: 'decision', sector: 'signals', agent: 'crm', rows: [['Lapsed buyers', '1,200']], cta: { label: 'Agree with the call' } }),
  K('research-ad', { type: 'competitor', origin: 'watcher', research: { kind: 'ad' }, cta: { label: 'Make our version' } }),
  K('research-trend', { kind: 'rows', type: 'competitor', origin: 'watcher', research: { kind: 'trend' }, rows: [['Sustainable sneakers', '3']], cta: { label: 'Turn into an idea' } }),
  K('research-news', { kind: 'rows', type: 'competitor', origin: 'watcher', research: { kind: 'news' }, cta: { label: 'Turn into an idea' } }),
  K('research-howto', { kind: 'rows', type: 'idea', origin: 'watcher', research: { kind: 'howto' }, cta: { label: 'Start this' } }),
  K('competitor-ads', { kind: 'rows', type: 'competitor', sector: 'ads', agent: 'performance', rows: [['Vessi', '729 live ads']], cta: { label: 'Launch the ad group' } }),
  K('visibility-report', { kind: 'rows', type: 'report', sector: 'visibility', agent: 'visibility', origin: 'watcher', rows: [['ChatGPT', 'Named']], cta: { label: 'Open report' } }),
  K('visibility-answer', { kind: 'answer', type: 'decision', sector: 'visibility', agent: 'visibility', q: 'best sneakers?', a: 'X and Y', cta: { label: 'Draft the page' } }),
  K('ideas-video', { origin: 'ideas', post: { platform: 'instagram', format: 'reel', media: { kind: 'video' } }, cta: { label: 'Make the video' } }),
  K('ideas-post', { kind: 'rows', origin: 'ideas', post: { platform: 'reddit', format: 'post' }, cta: { label: 'Post it' } }),
  K('listen-report', { kind: 'rows', type: 'report', origin: 'listen', sector: 'signals', agent: 'crm', rows: [['General praise', '21']], cta: { label: 'Use their words in a post' } }),
  K('listen-reply', { kind: 'rows', origin: 'listen', post: { platform: 'youtube', format: 'reply' }, cta: { label: 'Reply as the brand' } }),
  K('live-marketplace', { kind: 'rows', type: 'decision', origin: 'live', sector: 'catalog', rows: [['Blue Tee on amazon.in', '₹899']], cta: { label: 'Agree with the call' } }),
  K('conflict', { kind: 'conflict', agent: 'brew', type: 'decision', options: [{ id: 'a', name: 'A', moves: '+2' }, { id: 'b', name: 'B', moves: '+1' }], cta: { label: 'Agree with the call' } }),
  K('chat', { kind: 'chat', chat: [['in', 'Hi'], ['out', 'Hello']], cta: { label: 'Send on WhatsApp' }, sector: 'signals', agent: 'crm' }),
  K('film', { kind: 'film', cta: { label: 'Brief the shoot' } }),
  K('variants', { kind: 'variants', variants: [{ angle: 'A', title: 't', sub: 's' }], cta: { label: 'Generate versions' } }),
  K('result', { kind: 'rows', type: 'report', family: 'result', agent: 'performance', sector: 'ads', rows: [['Number', '+12%']], cta: { label: 'Generate versions' } }),
  K('statics-batch', { images: Array.from({ length: 7 }, (_, i) => `assets/statics/ad${i}.jpg`), cta: { label: 'Queue the ads' } }),
  K('signal', { kind: 'rows', agent: 'brew', type: undefined, origin: 'signal', cta: undefined }),
  K('first-draft-video', { make: { format: 'video ad' }, cta: { label: 'Make the video' } }),
  K('ai-plan', { cta: { label: 'Generate versions' }, plan: { by: 'ai', steps: ['Pick the two best fit reviews', 'Decided: go', 'Write three hooks from them', 'Make the carousel slides', 'Ready to launch on Meta or hand to the team'] } })
];
const DRAFT = { as: 'video', images: ['gen/draft.png'], video: 'gen/draft.mp4', poster: 'gen/draft.png', ratio: '9:16', title: 'The draft', copy: 'Words' };

const checkPlan = (c, pl, why) => {
  const label = c.cta?.label;
  if (NAV_LABELS.has(label) || /^build-/.test(c.id || '')) { assert.ok(!pl, `${why}: a place to go has no plan`); return; }
  assert.ok(pl, `${why}: no plan`);
  const { action } = actionOfCard(c), r = recipeOfCard(c);
  assert.equal(pl.action, r.primary || r.actionKeys[0], `${why}: plan is for the card's own action`);
  assert.equal(pl.action, action);
  assert.equal(pl.family, familyOf(pl.action), `${why}: plan family`); assert.ok(FAMILY_NAME[pl.family], `${why}: family name`);
  assert.ok(pl.steps.length >= 3 && pl.steps.length <= 6, `${why}: ${pl.steps.length} steps`);
  assert.ok(pl.steps.every((s) => s.t && !/\bdecided\b/i.test(s.t)), `${why}: a step says decided or is empty`);
  assert.equal(pl.steps.filter((s) => s.k === 'make').length, 1, `${why}: exactly one make step`);
  assert.equal(pl.steps[pl.steps.length - 1].k, 'ready', `${why}: ends ready to share the brief`);
  assert.match(pl.steps[pl.steps.length - 1].t, /ready/i);
  assert.equal(pl.cta, label || pl.cta, `${why}: the plan ends on the card's own button`);
  assert.ok(pl.summary.endsWith(`Next: ${pl.cta}.`), `${why}: summary ends on the action: ${pl.summary}`);
  assert.ok(pl.batch ? pl.n === 0 : pl.n >= 1, `${why}: make count`);
};

test('every card we have, and one of every kind, gets a plan for its own action', () => {
  const all = [...saved, ...KINDS]; assert.ok(all.length >= KINDS.length);
  for (const c of all) checkPlan(c, planFor(c), `${c._brand || 'kind'} ${c.id} “${c.cta?.label}”`);
});

test('every action in the registry makes a correct plan of its own widget', () => {
  for (const [agent, acts] of Object.entries(ACTIONS)) for (const k of Object.keys(acts)) {
    const action = `${agent}.${k}`, c = K(`a-${k}`, { cta: { label: acts[k].label } }), pl = planFor(c, { action });
    assert.equal(pl.action, action); assert.equal(pl.family, familyOf(action), action);
    assert.ok(pl.steps.length >= 3 && pl.steps.some((s) => s.k === 'make') && pl.steps.at(-1).k === 'ready', action);
    assert.ok(!pl.steps.some((s) => /\bdecided\b/i.test(s.t)), action);
  }
});

test('every button the product writes opens a plan, except the ones that are a place to go', () => {
  for (const label of [...Object.keys(CTA), 'Start this', 'Turn into an idea', 'Make our version', 'Post it', 'Use their words in a post', 'Reply in r/Sneakers', 'Send on WhatsApp']) {
    const pl = planFor(K('l', { cta: { label } }));
    if (NAV_LABELS.has(label)) assert.equal(pl, null, label); else { assert.ok(pl?.steps?.length >= 3, label); assert.equal(pl.cta, label); }
  }
});

test('“Generate versions” on a card with winning ads: name them, write one hook, make the one ad, review, ready', () => {
  const pl = planFor(K('gv', { cta: { label: 'Generate versions' }, make: { format: 'carousel ad' }, rows: [['Ad “Fit room”', 'CTR 2.1%'], ['Ad “Rain test”', 'CTR 1.8%'], ['Audience', '25-44']] }));
  assert.match(pl.steps[0].t, /Pick the winning ads: Ad “Fit room” and Ad “Rain test”$/);
  assert.match(pl.steps[1].t, /Write the ad, with one strong hook/); assert.equal(pl.steps[2].k, 'make'); assert.match(pl.steps[2].t, /Make the carousel ad$/);
  assert.match(pl.steps[3].t, /Review/); assert.match(pl.steps[4].t, /Ready: share the brief so the team launches it on Meta Ads/);
  assert.equal(pl.n, 1);
  assert.doesNotMatch(JSON.stringify(pl), /\b[23] (?:versions|options|cuts|ads|hooks)\b|three /i, 'nowhere promises several');
});

test('a plan the writer gave with AI keeps its words, drops "decided", and keeps the action’s own make and ready steps', () => {
  const pl = planFor(KINDS.find((c) => c.id === 'ai-plan'));
  assert.equal(pl.by, 'ai'); assert.ok(!pl.steps.some((s) => /decided/i.test(s.t)));
  assert.equal(pl.steps[0].t, 'Pick the two best fit reviews'); assert.equal(pl.steps.filter((s) => s.k === 'make').length, 1); assert.equal(pl.steps.at(-1).k, 'ready');
});

test('the jam’s brief opens on the card: the summary, the plan and the action’s own label', () => {
  const JB = createJamBrief({ cardOf: (t, id) => t.cards.get(id), planOf: (t, c) => planFor(c), isMock: () => true, spend: () => false, now: () => 1, clean: (x) => x, cardBrief: () => '', seatLine: () => '' });
  for (const c of [...KINDS, ...saved.slice(0, 400)]) {
    const pl = planFor(c); if (!pl) continue;
    const t = { cards: new Map([[c.id, c]]), decided: {} }, w = { id: 'w1', cardId: c.id, title: c.title, versions: [{ n: 1, title: c.title, sub: c.sub }], current: 1, cardPlan: pl };
    const md = JB.seed(t, w).md;
    assert.ok(md.includes(String(c.title).slice(0, 40)), `${c.id}: the case`);
    for (const s of pl.steps) assert.ok(md.includes(s.t), `${c.id}: step “${s.t}” in the brief`);
    assert.ok(md.includes(`**Next:** ${pl.cta}.`), `${c.id}: the brief ends on “${pl.cta}”`);
  }
  // a brief written before plans gets the plan: rewritten when untouched, added at the end when someone edited it
  const c = KINDS[0], pl = planFor(c), t = { cards: new Map([[c.id, c]]) };
  const old = { id: 'w2', cardId: c.id, versions: [], doc: { md: '# Old\n\nSomeone wrote this.', rev: 3, edits: [{ by: 'you' }] } };
  const md = JB.seed(t, old).md; assert.ok(md.startsWith('# Old\n\nSomeone wrote this.') && md.includes(`**Next:** ${pl.cta}.`));
});

test('the first draft rides on the plan, so the jam opens on it', () => {
  const pl = planFor(KINDS.find((c) => c.id === 'first-draft-video'), { draft: DRAFT });
  assert.deepEqual(pl.draft.images, DRAFT.images); assert.equal(pl.draft.video, DRAFT.video);
});

/* ---------- part 2: the real server, every card of the brands in .brands/ (skipped when they are not here) ---------- */
const LOCAL = ['allbirds-com', 'wearcomet-com'].filter((s) => fs.existsSync(path.join('.brands', s, 'seed.json')));
test('on the server, every card’s action opens its jam on the plan; nothing runs; the make step makes its widget; v0 is the draft', { skip: !LOCAL.length && 'no .brands/ here', timeout: 240e3 }, async () => {
  const PORT = 4460 + Math.floor(Math.random() * 30);
  const env = { ...process.env, PORT: String(PORT), AI_MOCK: '1', BUILD_RESUME_OFF: '1', HEAL_OFF: '1', RESEARCH_OFF: '1', LIVE_OFF: '1', TREG_OFF: '1', BUILD_NO_IP_LIMIT: '1', DRAFTS_BG_OFF: '1' };
  delete env.K_SERVICE;
  const srv = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((ok, no) => { const tm = setTimeout(() => no(new Error('server did not start')), 30e3); srv.stdout.on('data', (d) => { if (/Brew Feed on/.test(String(d))) { clearTimeout(tm); ok(); } }); });
    const rows = [];
    for (const slug of LOCAL) {
      let TID = '';
      const j = async (m, p, b) => (await fetch(`http://localhost:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-brand': slug, 'x-tenant': TID }, body: b ? JSON.stringify(b) : undefined })).json();
      const host = JSON.parse(fs.readFileSync(path.join('.brands', slug, 'seed.json'), 'utf8')).brand?.host || slug;
      TID = (await j('POST', '/api/tenants', { url: host, brand: slug, snapshot: { onboarded: true } })).id;
      const cards = Object.values((await j('GET', `/api/tenants/${TID}/feed`)).cards || {});
      assert.ok(cards.length > 10, `${slug}: ${cards.length} cards`);
      for (const c of cards) {
        const why = `${slug} ${c.id} “${c.cta?.label}”`, pl = c.plan;
        checkPlan(c, pl, why);
        if (!pl) continue;
        // the card's action: the jam, never a run
        const a = await j('POST', `/api/cards/${c.id}/actions`, { label: c.cta?.label, confirmSpend: true });
        assert.equal(a.jam, true, `${why}: opens the jam`); assert.ok(!a.run, `${why}: ran from the card`);
        assert.equal(a.work.stage, 'drafting', `${why}: the card moved its work to ${a.work.stage}`); assert.ok(!a.work.deploy, `${why}: deploy from the card`);
        assert.equal(a.work.cardPlan?.cta, pl.cta, `${why}: the jam's input is the card's plan`);
        assert.ok(a.work.doc?.md?.includes(`**Next:** ${pl.cta}.`), `${why}: the brief ends on the action`);
        const lk = await j('POST', '/api/work', { cardId: c.id, link: true }); const ch = lk.change || (lk.work?.changeId && (await j('GET', `/api/changes/${lk.work.changeId}`)).change);
        if (!ch) { rows.push([slug, c.id, c.kind, c.type, c.cta?.label, pl.action, 'canvas jam', '', '']); continue; }
        assert.equal(ch.plan?.cta, pl.cta, `${why}: the jam's package carries the plan`);
        assert.equal(ch.family, pl.family, `${why}: the jam's widget is the plan's (${ch.family} vs ${pl.family})`);
        const v0 = ch.versions[0]?.snapshot || {};
        if (c.draft && !pl.batch) { const d = c.draft; if (ch.pkg.draft?.text) assert.equal(ch.pkg.draft.images[0], d.images[0], `${why}: v0 is the card's text draft`);
          else { if (d.images?.[0]) assert.equal(v0.image, d.images[0], `${why}: v0 is the card's first draft`); if (d.video) assert.equal(v0.video, d.video, `${why}: v0 plays the card's clip`); } }
        const r = await j('POST', `/api/changes/${ch.id}/plan`, {});
        assert.ok(!r.error, `${why}: ${r.error}`);
        if (pl.batch) { assert.ok(!r.change.planRun, `${why}: a batch is already made`); rows.push([slug, c.id, c.kind, c.type, c.cta?.label, pl.action, pl.family, 0, !!c.draft]); continue; }
        assert.equal(r.change.planRun?.n, pl.n, `${why}: made ${r.change.planRun?.n} of ${pl.n}`);
        assert.equal(r.change.versions.length, 1 + pl.n, `${why}: versions on the stage`);
        assert.ok(r.change.versions.slice(1).every((v) => v.snapshot && familyOf(v.snapshot.action || ch.action) === pl.family), `${why}: every version is the action's widget`);
        if (c.draft?.video) assert.ok(r.change.versions.slice(1).every((v) => v.snapshot.video === c.draft.video), `${why}: versions keep the draft clip`);
        rows.push([slug, c.id, c.kind, c.type, c.cta?.label, pl.action, pl.family, pl.n, !!c.draft]);
      }
      // nothing went live, nothing was booked against the weekly spend, no card claims it shipped
      const work = await j('GET', `/api/tenants/${TID}/work`);
      assert.ok(work.items.every((w) => w.stage === 'drafting' && !w.deploy), `${slug}: something left drafting`);
      const feed = await j('GET', `/api/tenants/${TID}/feed`); assert.ok(Object.values(feed.cards).every((c) => !c.done), `${slug}: a card says done`);
    }
    if (process.env.PLAN_MATRIX) fs.writeFileSync(process.env.PLAN_MATRIX, rows.map((r) => r.join('\t')).join('\n'));
    assert.ok(rows.length > 20);
  } finally { srv.kill(); }
});
