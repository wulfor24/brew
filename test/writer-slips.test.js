// A fresh draft never opens on "Needs a fix": the writer and the checks share one rule, and what a writer slips on is found
// (and mended once in remix.js liveOptions) before anyone sees it. Any brand, any channel (26 Oct, Arata WhatsApp broadcast).
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimFlags, writerSlips, CLAIMS_RULE, COPY_RULE } from '../claims.js';
import { fieldsBrief } from '../studio.js';

test('a measured result written as a multiple ("by 7.4X") is a claim to back', () => {
  assert.equal(claimFlags('Our shampoo reduces hair fall by 7.4X.', '').length, 1);
  assert.equal(claimFlags('It boosts shine by 3 times.', '').length, 1);
  assert.equal(claimFlags('Ships in 2 boxes', '').length, 0);
});

test('the writer is told what the checker holds back: a proof phrase on the product page is not enough', () => {
  assert.match(CLAIMS_RULE, /scientifically proven/);
  assert.match(CLAIMS_RULE, /being on the product page is not enough/);
  assert.match(COPY_RULE, /it\\?'s not X/);
});

test('slips in a WhatsApp message: claims, the turn, paise on a price, label lines, "- " lists, length', () => {
  const msg = 'The Biological Root\n\nTackle hair fall directly.\n\nYour 3-Step Routine\n- Serum (30 ml)\n- Shampoo (200 ml)\n\nLab-Backed Action\nOur shampoo is scientifically proven to reduce hair fall by 7.4X.\n\nScience isn’t guesswork; it’s lab work. Get it for ₹2,182.15.';
  const s = writerSlips(msg, { source: 'Our shampoo is scientifically proven', chat: true, prices: ['₹2,182'] }).join(' | ');
  for (const k of [/scientifically proven/, /7\.4X/, /isn’t A/, /₹2,182, not ₹2,182\.15/, /"- " lists/, /label lines/]) assert.match(s, k);
  assert.match(writerSlips('x'.repeat(720), { chat: true }).join(' '), /720-character/);
});

test('clean copy, an email with labels and a $39.99 price, has no slips', () => {
  assert.deepEqual(writerSlips('Warm toes all winter.\n\nWhy it works\n- Soft fleece\n- Stays warm\n\nNow $39.99.', { chat: false, prices: ['$39.99'] }), []);
  assert.deepEqual(writerSlips('Hi {first_name}, your *serum combo* is back at ₹2,182. Tap below to get yours.', { chat: true, prices: ['₹2,182'] }), []);
});

test('a customer message is briefed for the phone when it goes on WhatsApp or SMS', () => {
  const b = fieldsBrief('crm', 'crm.paid_broadcast');
  assert.match(b, /under 600 characters/);
  assert.match(b, /no "- " lists/);
});
