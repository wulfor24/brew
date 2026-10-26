// FEED-QA-10: inside Brew the ShopOS team (the real service team, SCOPE.md) is said once, plainly, with who they are, in one
// phrase everywhere a person is asked to send them the brief: "the ShopOS team, Brew’s build crew".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('one phrase for who the ShopOS team are, wherever the brief is sent to them', () => {
  const share = read('share.js'), jr = read('jam-room.js'), app = read('app.js');
  assert.match(share, /Send it to our team, the build crew: we take it from here\./);
  assert.ok(!/ShopOS team and they take it from here/.test(share + jr + app), 'the old line is gone');
  assert.match(jr, /title="Our team, the build crew, gets it by email/);
  assert.match(app, /'Our team, the build crew, gets it by email and makes it\.'/);
  assert.match(app, /The build crew takes it from here\. Its status shows in the top bar\./);
  assert.ok(!/ShopOS/.test(app.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/data-rx="share-shopos"|'share-shopos'|=== 'shopos'|'shopos'|shoposWho|share-shopos/g, '')), 'no "ShopOS" in app.js copy');
});
