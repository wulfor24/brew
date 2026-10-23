// Access for a real client (2026-10-15): anyone can open a shared jam link; signing in makes them a guest of that one jam,
// never a team member; what the team told Brew and the brand memory are the team's only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shareToken, parseShare, handoffPath, parseToken } from '../handoff.js';
import { createMemoryRoutes } from '../memory-routes.js';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('a jam link names its jam; an old workspace link only lets people look; a forged one fails', () => {
  const tok = shareToken('t_ab12cd34', 'wk_9'); assert.deepEqual(parseShare(tok), { tid: 't_ab12cd34', wid: 'wk_9' });
  assert.deepEqual(parseShare(shareToken('t_ab12cd34')), { tid: 't_ab12cd34', wid: null });
  assert.equal(parseShare(tok.replace('wk_9', 'wk_8')), null, 'a link for one jam cannot be edited into another');
  const h = handoffPath({ id: 't_ab12cd34' }, { id: 'wk_9' }).slice(3); assert.deepEqual(parseToken(h), { tid: 't_ab12cd34', wid: 'wk_9' });
});

test('a shared link never adds anyone to the brand team', () => {
  assert.doesNotMatch(src('server.js'), /addMember\([^)]*Joined from a shared link/);
  assert.doesNotMatch(src('feed-service.js'), /addMember/);
  assert.match(src('feed-service.js'), /const guestOk = /);
});

const run = async (routes, method, path, viewer) => {
  let out = null; const res = {}; const send = (r, code, body) => { out = { code, body }; };
  const R = createMemoryRoutes({ memory: { repo: async () => ({ facts: [{ text: 'secret plan' }] }), add: async () => ({ added: 1, same: [] }) }, viewerOf: async () => viewer, readBody: async () => ({ text: 'a note from someone' }), send, exists: async () => true });
  await R({ method }, res, new URL('http://x' + path)); return out;
};

test('brand memory: the team reads and writes it; a visitor or a stranger gets nothing, claimed or not', async () => {
  const p = '/api/brands/acme-com/memory';
  assert.equal((await run(null, 'GET', p, { member: false, claimed: false, email: null })).code, 401);
  assert.equal((await run(null, 'GET', p, { member: false, claimed: true, email: 'x@gmail.com' })).code, 403);
  assert.equal((await run(null, 'POST', p, { member: false, claimed: false, email: null })).code, 401, 'an unclaimed brand is no longer open to write');
  const ok = await run(null, 'GET', p, { member: true, claimed: true, email: 'a@acme.com' }); assert.equal(ok.code, 200); assert.equal(ok.body.facts[0].text, 'secret plan');
});

test('what the team told Brew is team-only, and the mic needs sign-in', () => {
  const s = src('server.js');
  assert.match(s, /what the team told Brew \(pasted call notes, emails\): the brand's team only/);
  assert.match(s, /\/api\/transcribe'\) \{ if \(auth\.signinOn\(\) && process\.env\.DEMO_MODE !== '1' && !auth\.user\(req\)\) return send\(res, 401/);
});

test('a pack file never leaves its brand folder: ../ and absolute names read and write nothing', async () => {
  const os = await import('node:os'); const path = await import('node:path'); const { createPacks } = await import('../brand-pack.js');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-trav-')); fs.writeFileSync(path.join(ROOT, 'secret.txt'), 'KEY=1');
  const P = createPacks({ ROOT, PUB: path.join(ROOT, 'public'), bucket: null, gToken: null, log: { log() {}, warn() {}, error() {} } });
  await P.put('acme-com', 'pdf/01 One.pdf', Buffer.from('pdf'));
  assert.equal((await P.get('acme-com', 'pdf/01 One.pdf')).toString(), 'pdf');
  for (const bad of ['pdf/../../../secret.txt', '../secret.txt', '/etc/passwd', 'pdf/..', 'statics/..']) assert.equal(await P.get('acme-com', bad), null, bad);
  await assert.rejects(() => P.put('acme-com', '../../escape.txt', 'x'));
  assert.match(src('server.js'), /a file name only: never a path/);
});

test('a read (about $6) starts only for someone signed in; the page signs them in and starts it after', () => {
  const s = src('server.js'), a = src('public/app.js');
  assert.match(s, /if \(!me && auth\.signinOn\(\) && process\.env\.BUILD_SIGNIN !== '0'\) return send\(res, 200, \{ error: b\.fresh \? .*signin: true \}\), true;/);
  assert.match(a, /if \(r\?\.signin\) \{ going\(true, 'Taking you to sign in…'\); location\.href = `\/auth\/google\?next=\$\{encodeURIComponent\('\/\?build='/);
  assert.match(a, /get\('build'\); if \(bq\)/, 'back from Google, the read starts by itself');
});

test('on live a brand is for its team: moves, PDFs, read, facts, Heard and stories are gated; the feed is empty outside the team; the demo stays open', () => {
  const s = src('server.js'), f = src('feed-service.js');
  const re = /const TEAM_READ = (\/.*\/);/.exec(s); assert.ok(re, 'TEAM_READ exists'); const TR = eval(re[1]);
  for (const p of ['/api/brands/acme-com/watch', '/api/brands/acme-com/moves', '/api/brands/acme-com/moves/7', '/api/brands/acme-com/moves/cadence', '/api/brands/acme-com/findings', '/api/brands/acme-com/check', '/api/brands/acme-com/facts', '/api/brands/acme-com/heard', '/api/brands/acme-com/heard/items', '/api/brands/acme-com/build', '/api/brands/acme-com/updates', '/api/brands/acme-com/summary']) assert.ok(TR.test(p), p);
  assert.ok(!TR.test('/api/brands/acme-com/status'), 'progress stays public');
  assert.match(s, /const teamRead = async \(req, slug\) => \{ if \(process\.env\.DEMO_MODE === '1'/);
  assert.match(s, /if \(!\(await teamRead\(req, slug\)\)\) return send\(res, auth\.user\(req\) \? 403 : 401, 'These moves are for the brand’s team/);
  assert.match(s, /if \(!\(await teamRead\(req, slug\)\)\) p = \{ \.\.\.p, seed: \{ \.\.\.p\.seed, posts: \[\]/);
  assert.match(f, /const outside = br\.kind === 'generated' && o\.liveTeamOnly\?\.\(\) && !viewer\?\.member && !viewer\?\.gen;/);
  assert.match(f, /crypto\.randomBytes\(p === 't' \? 8 : 4\)/, 'workspace ids are 64 bits');
  assert.match(f, /if \(n > 20\) \{ send\(res, 429/, 'at most 20 new workspaces an hour from one address outside a team');
});
