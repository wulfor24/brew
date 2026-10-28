// Releases only add (Param, 28 Oct): a deploy or a promotion never ships a tree that lacks a commit the site already runs.
// 28 Oct: a promotion that had waited behind another shipped eb5a427 over aafda87, and the Shopify own-app fix left production.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('promote.sh refuses an image that does not contain what production runs, checked under the lock', () => {
  const s = read('tools/promote.sh'), lock = s.indexOf('--if-generation-match=0'), check = s.indexOf('merge-base --is-ancestor "$LIVE_SHA" "$SHA"');
  assert.ok(check > 0, 'the ancestor check is there'); assert.ok(check > lock, 'it runs after the lock is taken');
  assert.ok(check < s.indexOf('--tag=candidate'), 'and before anything on production changes');
  assert.match(s, /ROLLBACK:-0\}" != 1/, 'only an explicit ROLLBACK=1 skips it');
});

test('deploy.sh refuses a tree that does not contain what staging runs', () => {
  const s = read('deploy.sh'), check = s.indexOf('merge-base --is-ancestor "$LIVE_SHA" HEAD');
  assert.ok(check > 0); assert.ok(check < s.indexOf('gcloud run deploy shopos-feed'), 'before the deploy');
  assert.match(s, /ROLLBACK:-0\}" != 1/);
});

test('the check itself: an older or side commit is refused, a newer one passes', () => {
  const git = (...a) => { try { execFileSync('git', a, { stdio: 'ignore' }); return true; } catch { return false; } };
  const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(), parent = execFileSync('git', ['rev-parse', 'HEAD~1']).toString().trim();
  assert.equal(git('merge-base', '--is-ancestor', parent, head), true, 'live older, shipping newer: adds');
  assert.equal(git('merge-base', '--is-ancestor', head, parent), false, 'live newer, shipping older: refused');
});
