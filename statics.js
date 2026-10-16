// Static Meta ads for a generated brand, made once its ad-creative move (Move 21) is written. Same method as the
// first hand-made set: Gemini places the brand's REAL product photo in a new scene, and the
// headline is set afterwards in exact type (never drawn by the image model, so it is never misspelled). Every
// number on an image must be in the fact sheet or in Move 21; a concept that fails is dropped, never patched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { numbersIn, allowedFrom } from './fact-gate.js';

const SCHEMA = { type: 'object', properties: { ads: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string', description: 'short kebab-case id, unique' },
  product: { type: 'string', description: 'the handle of the product in the photo, from the list' },
  scene: { type: 'string', description: 'one sentence: the new photograph around the real product (setting, light, props). No people\'s bodies shown as results, no before/after, no text in the scene' },
  headline: { type: 'string', description: 'the ad headline set on the image, under 60 characters, plain words, from the move' },
  small: { type: 'string', description: 'one supporting line under the headline, under 70 characters' }
} } } } };

/* the team's statics as feed cards (private/cards.json): one batch card and one card per ad, members only, their images on the
   team route (never b/<slug>/statics/, which anyone may load). privateOf 21: they belong to the team's Move 21 */
/* the team's set is made once; a failed or cut-off try (state running/failed) goes again only after retryMs */
export const teamStaticsDue = (s0, { now = Date.now(), retryMs = 24 * 3600e3 } = {}) => !s0 || (s0.state !== 'done' && now - (+s0.at || 0) >= retryMs);
export const teamStaticUrl = (slug, id) => `b/${slug}/team/statics/${id}.jpg`;
export function teamStaticCards(slug, ids = [], text = {}, { lane = 'core', name = 'the brand' } = {}) {
  if (!ids.length) return [];
  const base = { agent: 'creative', sector: 'creatives', type: 'idea', lane, roles: ['brand', 'growth', 'founder'], kind: 'media', origin: 'build', campaign: 'From your ad plan', liveOnly: true, privateOf: 21, teamStatics: true };
  return [{ ...base, id: 'statics-batch-p', src: 'Move 21 · static ads · your accounts', time: '5 min', images: ids.map((id) => teamStaticUrl(slug, id)),
    title: `${ids.length} ads from your ad plan, written with your account numbers`, sub: `Each one puts a real ${name} product photo in a new scene, with a headline from your Move 21. Only your team sees these.`,
    detail: { why: ['Concepts come from your rewrite of the ad-creative move.', 'Every number on them is in your fact sheet or your connected accounts.'], how: ['Open the set and keep or drop each ad.', 'Edit any of them in the studio.', 'Queue the kept ones as one test.'] }, cta: { label: 'Queue the ads' } },
  ...ids.filter((id) => text[id]?.headline).map((id, i) => ({ ...base, id: `static-${id}-p`, src: 'Move 21 · static ad · your accounts', time: `${12 + i * 17} min`, images: [teamStaticUrl(slug, id)], title: String(text[id].headline).slice(0, 120),
    sub: `${text[id].small ? `${String(text[id].small).replace(/\.?$/, '.')} ` : ''}Made from your Move 21 with a real ${name} photo. Only your team sees it.`,
    detail: { why: ['The concept comes from your rewrite of the ad-creative move.', 'Every number on it is in your fact sheet or your connected accounts.'], how: ['Jam on it to change the words or the scene.', 'Share the brief and your team puts it in the ad account.'] }, cta: { label: 'Generate versions' } }))];
}

/* GET /b/<slug>/team/statics/<id>.jpg: a member of the brand gets the image from private/statics/; anyone else gets 401 (signed
   out) or 403 (signed in, not on the team), never the image. Never cached by a shared proxy */
export async function teamStatic(req, res, slug, name, { viewerOf, signedIn, packs, send }) {
  if (!/^[\w-]+\.jpg$/.test(String(name || ''))) return send(res, 404, 'no', 'text/plain'), true;
  const v = await viewerOf(req, slug).catch(() => ({})); if (!v?.member) return send(res, signedIn(req) ? 403 : 401, 'These ads are for the brand’s team. Sign in or ask them to invite you.', 'text/plain'), true;
  const b = await packs.get(slug, 'private/statics/' + name); if (!b) return send(res, 404, 'no', 'text/plain'), true;
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', vary: 'Cookie' }); res.end(b); return true;
}

export function createStatics({ ai, image, packs, launchBrowser, log = console }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // the composer: scene image + exact type, rendered by Chromium at 1080×1350 (4:5)
  const compose = async (browser, sceneBuf, { headline, small, accent }) => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
      const size = headline.length < 20 ? 92 : headline.length < 50 ? 70 : 58;
      await page.setContent(`<!doctype html><html><head><style>
        html,body{margin:0;width:1080px;height:1350px;overflow:hidden;font-family:"Helvetica Neue",Helvetica,Inter,Arial,sans-serif}
        .bg{position:absolute;inset:0;background:url(data:image/png;base64,${sceneBuf.toString('base64')}) center/cover no-repeat}
        .scrim{position:absolute;left:0;right:0;top:0;height:62%;background:linear-gradient(180deg,rgba(12,16,26,.86) 0%,rgba(12,16,26,.62) 45%,rgba(12,16,26,0) 100%)}
        .t{position:absolute;left:72px;right:78px;top:72px}
        .bar{width:64px;height:8px;background:${accent};margin-bottom:26px}
        h1{margin:0;color:#fff;font-weight:700;font-size:${size}px;line-height:1.12;letter-spacing:-.01em}
        p{margin:16px 0 0;color:#d6e2ff;font-size:34px;line-height:1.3}
      </style></head><body><div class="bg"></div><div class="scrim"></div><div class="t"><div class="bar"></div><h1>${esc(headline)}</h1>${small ? `<p>${esc(small)}</p>` : ''}</div></body></html>`, { waitUntil: 'load' });
      return await page.screenshot({ type: 'jpeg', quality: 88 });
    } finally { await page.close().catch(() => {}); }
  };
  // product photos come as png/webp/jpg; Gemini gets a clean JPEG
  const toJpeg = async (browser, buf, type) => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<html><body style="margin:0"><img id="i" src="data:${type || 'image/png'};base64,${buf.toString('base64')}" style="display:block;max-width:1024px;max-height:1024px"></body></html>`, { waitUntil: 'load' });
      const el = await page.$('#i'); return await el.screenshot({ type: 'jpeg', quality: 92 });
    } finally { await page.close().catch(() => {}); }
  };

  /* priv: the team's set, from their private rewrite of Move 21: every file under private/ (private/statics/, private/statics.json),
     never under statics/, which is served to anyone */
  async function make(slug, { move, profile, facts, n = 8, onProgress = () => {}, priv = false }) {
    const pre = priv ? 'private/' : '';
    const prods = (profile.catalog?.products || []).filter((p) => p.img).slice(0, 24);
    if (!prods.length) throw new Error('no product photos to build from');
    const examples = (move.sections || []).flatMap((s) => (s.blocks || []).filter((b) => b.t === 'example' || b.t === 'table').map((b) => b.t === 'example' ? `[${b.title}] ${b.body}` : [b.head, ...(b.rows || [])].map((r) => (r || []).join(' | ')).join('\n'))).join('\n\n').slice(0, 20000);
    const ok = allowedFrom(facts), moveNums = new Set(numbersIn(JSON.stringify(move.sections || [])));
    const r = await ai.call({ model: 'sonnet', schema: SCHEMA, max: 5000, tag: 'statics', prompt: `You turn the ad-creative plan (Move 21) for ${profile.name} into ${n} static Meta ads.\n\nTHE PLAN'S AD CONCEPTS AND EXAMPLES:\n${examples}\n\nPRODUCTS WITH REAL PHOTOS (handle: title, price):\n${prods.map((p) => `- ${p.handle}: ${p.title}${p.priceLabel ? ', ' + p.priceLabel : ''}`).join('\n')}\n\nFACTS YOU MAY QUOTE:\n${Object.values(facts).slice(0, 80).map((f) => `- ${f.label}: ${f.v}`).join('\n')}\n\nWrite ${n} ads, each a different concept from the plan, each built around one real product photo. The headline speaks to shoppers. Only numbers from the facts or the plan; no rival names; no claim the brand's site doesn't make; no before/after, no bodies shown as results; no disclaimers.` });
    const want = (r.json?.ads || []).filter((a) => a.headline && prods.some((p) => p.handle === a.product))
      .filter((a) => numbersIn(`${a.headline} ${a.small}`).every((x) => ok.has(x) || moveNums.has(x)))
      .slice(0, n).map((a, i) => ({ ...a, id: (String(a.id || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ad') + '-' + (i + 1) }));
    if (!want.length) throw new Error('no ad concept passed the fact check');
    const accent = profile.identity?.colors?.[1] || profile.identity?.colors?.[0] || '#82B1FF';
    const browser = await launchBrowser();
    const done = [], text = {};
    try {
      for (const a of want) {
        try {
          const p = prods.find((x) => x.handle === a.product);
          const m = /^\/?b\/[^/]+\/a\/(.+)$/.exec(String(p.img)); const raw = m && (await packs.get(slug, 'assets/' + m[1])); if (!raw) continue;
          const jpg = await toJpeg(browser, raw, /\.png$/i.test(p.img) ? 'image/png' : /\.webp$/i.test(p.img) ? 'image/webp' : 'image/jpeg');
          const tmp = path.join(os.tmpdir(), `st-${slug}-${a.id}.jpg`); fs.writeFileSync(tmp, jpg);
          const scene = await image({ srcFile: tmp, slug, ratio: '4:5', prompt: `Create a new photograph: ${a.scene}. Keep the ${profile.name} product and its label exactly as in the reference photo, including any printed text on the pack. Do not add any other text, captions, logos or watermarks anywhere. No before/after, no bodies shown as results. Premium product ad photography, natural light, clean composition, leave the top third calm for a headline.` });
          fs.rmSync(tmp, { force: true });
          await packs.put(slug, `${pre}statics/raw-${a.id}.png`, scene, 'image/png');
          const out = await compose(browser, scene, { headline: a.headline, small: a.small, accent });
          await packs.put(slug, `${pre}statics/${a.id}.jpg`, out, 'image/jpeg');
          text[a.id] = { headline: a.headline, small: a.small, product: a.product };
          done.push(a.id); onProgress(done.length, want.length);
        } catch (e) { log.warn('[statics]', a.id, e.message); }
      }
    } finally { await browser.close().catch(() => {}); }
    if (!done.length) throw new Error('no image was made');
    await packs.put(slug, `${pre}statics.json`, text);
    return { ids: done, text };
  }
  return { make };
}
