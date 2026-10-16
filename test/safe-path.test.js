// The publish pack zipped server files through a crafted photo path (assets/../../server.js). Never again.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makePhotoFile } from '../safe-path.js';
const PUB = path.resolve('public'), BR = path.resolve('.brands'), pf = makePhotoFile(PUB, BR);
test('photo paths stay inside public/ or a brand pack', () => {
  for (const bad of ['assets/../../server.js', 'assets/../../../../../../proc/self/environ', '../server.js', 'gen/..\\..\\x', 'b/../a/x.png', '/etc/passwd/..', 'assets/%2e%2e/x', '']) {
    const f = pf(bad); assert.ok(f === null || f.startsWith(PUB + path.sep) || f.startsWith(BR + path.sep), `${bad} → ${f}`);
    assert.ok(!f || !/server\.js$|environ$|passwd/.test(f), `${bad} must not reach ${f}`); }
  assert.equal(pf('assets/brew-mark.svg'), path.join(PUB, 'assets/brew-mark.svg'));
  assert.equal(pf('b/arata-in/a/mark.svg'), path.join(BR, 'arata-in', 'assets', 'mark.svg'));
  assert.equal(pf('/etc/passwd'), path.join(PUB, 'etc/passwd'), 'an absolute path is read as page-relative, inside public/');
});
