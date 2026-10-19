// FEED-ARV-03 leftovers: a sent brief says when it went ("Sent 4:12 pm") wherever its ticket and status show, and every
// WhatsApp button goes through the one "WhatsApp isn't connected" sheet (Brew has no WhatsApp connection), never wa.me unchecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withTeam } from '../brief-status.js';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), jr = fs.readFileSync(new URL('../public/jam-room.js', import.meta.url), 'utf8');

test('the pill items carry when the brief was sent; the client says it in the reader’s clock', () => {
  const sent = Date.UTC(2026, 9, 19, 10, 42); const r = withTeam([{ id: 'w1', title: 'T', ticket: 'BR-3', jamBrief: { status: 'received', statusAt: sent + 6e5, sharedAt: sent } }]);
  assert.equal(r.items[0].sentAt, sent); assert.equal(r.items[0].at, sent + 6e5);
  const src = app.slice(app.indexOf('  const sentLine = '), app.indexOf('  const ago = (ms) => {'));
  const sentLine = new Function('SRV', `${src}; return sentLine;`)({ clock: sent + 36e5 });
  assert.match(sentLine(sent), /^Sent \d{1,2}:\d{2} [ap]m$/); assert.equal(sentLine(null), '');
  assert.match(new Function('SRV', `${src}; return sentLine;`)({ clock: sent + 864e5 })(sent), /^Sent yesterday \d{1,2}:\d{2} [ap]m$/);
  assert.match(app, /Sent to the ShopOS team[^\n]*sentLine\(w0\.jamBrief\.sharedAt\)/, 'the jam’s sent bar'); assert.match(app, /j2-sent[^\n]*sentLine\(jb\.sharedAt\)/, 'the brief sheet');
});

test('WhatsApp buttons go through the one not-connected sheet', () => {
  assert.ok(!/href="https:\/\/wa\.me\//.test(app), 'no bare wa.me link in the share sheet');
  assert.match(app, /if \(conn\('whatsapp'\)\) \{ window\.open/); assert.match(app, /waNeed\(\{ title: 'Share on WhatsApp'/);
  assert.match(jr, /return A\.waNeed\(\{ title: 'Send it for approval'/); assert.match(app, /window\.__BREW = \{ waNeed: \(o\) => waNeed\(o\)/);
});
